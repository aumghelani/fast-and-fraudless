"""Call-guard eval: the 10 SYNTHETIC scripted calls through ASR -> cues -> payee check -> rules.

Ground truth comes from data/scenario/call_scripts.md (HOLD vs not-HOLD). Writes Mongo meta "eval_calls".

On the box:     python -m backend.eval_calls
On a laptop:    python -m backend.eval_calls --asr local --llm none --no-mongo
"""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

import numpy as np  # noqa: E402

from backend import calls, rules  # noqa: E402
from backend.config import settings  # noqa: E402
from backend.cues import parse_amount, perceive  # noqa: E402


def load_expected(path: Path) -> dict:
    """{"CALL-01": "HOLD", "CALL-02": "NO HOLD", ...} from the demo headings and the eval table."""
    text = path.read_text(encoding="utf-8")
    out = {}
    for m in re.finditer(r"^###\s*(CALL-\d{2})\b.*?expected\s+\*\*([^*]+)\*\*", text, re.M):
        out[m.group(1)] = m.group(2).strip()
    for m in re.finditer(r"^\|\s*(CALL-\d{2})\s*\|.*\|\s*([^|]+?)\s*\|\s*$", text, re.M):
        out[m.group(1)] = m.group(2).strip()
    return dict(sorted(out.items()))


def is_hold(expected: str) -> bool:
    return expected.upper().startswith("HOLD")


def default_model() -> str:
    for p in (os.environ.get("TW_PARAKEET", ""), r"D:\DellXNvidia\models\parakeet-tdt-0.6b-v3",
              str(Path.home() / "tw/models/parakeet-tdt-0.6b-v3"), "/models/parakeet-tdt-0.6b-v3"):
        if p and Path(p).exists():
            return p
    return "/models/parakeet-tdt-0.6b-v3"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--asr", choices=("http", "local"), default="http",
                    help="http = ASR service at TW_ASR_URL; local = transformers Parakeet in this process")
    ap.add_argument("--model", default=None, help="Parakeet path for --asr local")
    ap.add_argument("--device", default=None, help="--asr local device (default: cuda if available else cpu)")
    ap.add_argument("--llm", choices=("vllm", "none"), default="vllm",
                    help="vllm = Nemotron cue extraction (keyword fallback if unreachable); none = keywords only")
    ap.add_argument("--no-mongo", action="store_true", help="no payee ring check and no meta write")
    ap.add_argument("--audio-dir", default=None)
    ap.add_argument("--scripts", default=None, help="call_scripts.md")
    ap.add_argument("--json-out", default=None)
    args = ap.parse_args(argv)

    audio_dir = Path(args.audio_dir) if args.audio_dir else calls.audio_dir()
    scripts = Path(args.scripts) if args.scripts else calls._resolve(
        settings.scenario_file.parent / "call_scripts.md", "scenario", "call_scripts.md")
    expected = load_expected(scripts)
    if not expected:
        print(f"no expected outcomes found in {scripts}", file=sys.stderr)
        return 2

    if args.asr == "local":
        from asr.server import ParakeetASR
        model = args.model or default_model()
        print(f"loading Parakeet locally from {model} ...", flush=True)
        asr = ParakeetASR(model, device=args.device)
        transcribe, asr_label = asr.transcribe, f"parakeet-local-{asr.device}-{asr.dtype}"
    else:
        if not calls.asr_ok():
            print(f"ASR service not healthy at {settings.asr_url} (use --asr local)", file=sys.stderr)
            return 2
        transcribe, asr_label = calls.asr_http, "parakeet-http"

    import soundfile as sf

    per_call = []
    for cid, exp in expected.items():
        hits = sorted(audio_dir.glob(f"{cid}*.wav"))
        if not hits:
            print(f"{cid}: no audio in {audio_dir}, skipped", file=sys.stderr)
            continue
        x, sr = sf.read(str(hits[0]), dtype="float32")
        if x.ndim > 1:
            x = x.mean(axis=1)
        if sr != settings.sample_rate:
            x = np.interp(np.arange(0, len(x) * settings.sample_rate / sr) * sr / settings.sample_rate,
                          np.arange(len(x)), x).astype(np.float32)
        t = time.time()
        windows = calls.split_windows(x)            # same <=10 s quiet-point windows as the live path
        transcript = " ".join(s for s in (transcribe(w).strip() for w in windows) if s)
        asr_s = time.time() - t

        t = time.time()
        cues, cue_source = perceive(transcript, use_llm=args.llm != "none")
        cue_s = time.time() - t
        ctx = calls.build_context(cid, "EVAL")
        amount = ctx["amount"] if ctx["amount_fixed"] else parse_amount(transcript)
        if args.no_mongo:
            pc = {"in_ring": False, "ring_id": None, "hops": None, "path": [], "error": "not checked (--no-mongo)"}
        else:
            pc = calls.payee_check(ctx["payee_account"], ctx["customer_account"])
        d = rules.decide(cues, ctx["customer"], amount, pc)
        rec = d["recommendation"]
        hold = rec == "HOLD"
        per_call.append({
            "call": cid, "clip": hits[0].name, "expected": exp, "expected_hold": is_hold(exp),
            "recommendation": rec, "hold": hold, "correct": hold == is_hold(exp),
            "cues": [c["cue"] for c in cues], "cue_quotes": cues, "cue_source": cue_source,
            "amount": amount, "payee_in_ring": bool(pc.get("in_ring")), "ring_id": pc.get("ring_id"),
            "payee_check_error": pc.get("error"), "reasons": d["reasons"],
            "transcript": transcript, "audio_s": round(len(x) / settings.sample_rate, 1),
            "windows": len(windows), "asr_s": round(asr_s, 2), "cue_s": round(cue_s, 2),
        })

    scams = [p for p in per_call if p["expected_hold"]]
    normals = [p for p in per_call if not p["expected_hold"]]
    sources = sorted({p["cue_source"] for p in per_call})
    summary = {
        "_id": "eval_calls", "label": "SYNTHETIC calls read by teammates",
        "scam_caught": sum(p["hold"] for p in scams), "scam_total": len(scams),
        "false_holds": sum(p["hold"] for p in normals), "normal_total": len(normals),
        "verify_flags": sum(p["recommendation"] == "VERIFY" for p in per_call),
        "asr": asr_label, "cues": "+".join(sources), "payee_check": "off (--no-mongo)" if args.no_mongo else "mongo rings",
        "per_call": per_call, "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }

    print()
    print(f"{'call':8} {'expected':9} {'got':8} {'ok':3} {'ring':5} {'cues':48} {'amount':>9} {'asr_s':>6}")
    for p in per_call:
        print(f"{p['call']:8} {('HOLD' if p['expected_hold'] else 'no hold'):9} {p['recommendation']:8} "
              f"{'Y' if p['correct'] else 'N':3} {('yes' if p['payee_in_ring'] else '-'):5} "
              f"{','.join(c for c in p['cues'] if c != 'AMOUNT_STATED')[:48]:48} "
              f"{(p['amount'] or 0):>9,.0f} {p['asr_s']:>6.1f}")
    print()
    print(f"scam calls caught {summary['scam_caught']}/{summary['scam_total']}, "
          f"false HOLDs {summary['false_holds']}/{summary['normal_total']}, VERIFY flags {summary['verify_flags']}  "
          f"[asr={asr_label}, cues={summary['cues']}, payee check={summary['payee_check']}] SYNTHETIC")

    if args.json_out:
        Path(args.json_out).write_text(json.dumps(summary, indent=1, default=str), encoding="utf-8")
    if not args.no_mongo:
        from backend.db import db, now
        doc = dict(summary)
        doc["at"] = now()
        db().meta.replace_one({"_id": "eval_calls"}, doc, upsert=True)
        print("wrote meta.eval_calls")
    return 0


if __name__ == "__main__":
    sys.exit(main())

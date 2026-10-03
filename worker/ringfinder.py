"""Tripwire ring finder.

Plain pandas. On the GB10 run it on the GPU with:
    python -m cudf.pandas worker/ringfinder.py --data /tw/data/ibm-aml-hi-medium
The same file without `-m cudf.pandas` is the CPU baseline (used for the CPU-vs-GPU bench).

What it does (see ARCHITECTURE.md section 6):
  * replays the bank's transactions in time order on a simulated clock
  * every cycle, detects fan-in / fan-out rings in the trailing window on the GPU
  * writes rings, their transactions, tick, eval and bench docs to MongoDB
Deterministic code only: no model is involved in detection.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd

ON_GPU = "cudf" in sys.modules  # set when launched via `python -m cudf.pandas`

COLS = ["ts", "from_bank", "src", "to_bank", "dst", "amount_rec", "cur_rec",
        "amount", "currency", "format", "is_laundering"]
STR_COLS = {"from_bank": "str", "src": "str", "to_bank": "str", "dst": "str",
            "cur_rec": "str", "currency": "str", "format": "str"}
# Approximate USD rates, display only (detection uses counts, not amounts).
USD = {"US Dollar": 1.0, "Euro": 1.09, "Yuan": 0.14, "Yen": 0.0068, "UK Pound": 1.27,
       "Rupee": 0.012, "Ruble": 0.011, "Canadian Dollar": 0.74, "Australian Dollar": 0.66,
       "Swiss Franc": 1.12, "Mexican Peso": 0.058, "Brazil Real": 0.18, "Shekel": 0.27,
       "Saudi Riyal": 0.27, "Bitcoin": 27000.0}


def log(*a):
    print(f"[ringfinder {'GPU' if ON_GPU else 'CPU'} {time.strftime('%H:%M:%S')}]", *a, flush=True)


# ---------------------------------------------------------------- loading
def load_transactions(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, header=0, names=COLS, dtype=STR_COLS)
    df["txn_row"] = np.arange(len(df), dtype="int64")          # stable id: T<row in file>
    df["ts"] = pd.to_datetime(df["ts"], format="%Y/%m/%d %H:%M")
    df["usd"] = df["amount"] * df["currency"].map(USD).fillna(1.0)
    df = df.sort_values(["ts", "txn_row"]).reset_index(drop=True)
    return df


def load_attempts(path: str) -> list[dict]:
    """Labelled laundering attempts from <name>_Patterns.txt."""
    attempts, cur = [], None
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if line.startswith("BEGIN"):
                cur = {"type": line.split("-", 1)[1].split(":")[0].strip(), "rows": []}
            elif line.startswith("END"):
                if cur:
                    attempts.append(cur)
                cur = None
            elif cur is not None and line:
                p = line.split(",")
                cur["rows"].append((p[0], p[2], p[4], float(p[7])))
    return attempts


def attempts_frame(attempts: list[dict], df: pd.DataFrame) -> pd.DataFrame:
    """Map each labelled attempt transaction to its txn_row (join on ts, src, dst, amount)."""
    recs = [{"attempt": i, "type": a["type"], "ts": r[0], "src": r[1], "dst": r[2], "amount": r[3]}
            for i, a in enumerate(attempts) for r in a["rows"]]
    at = pd.DataFrame(recs)
    at["ts"] = pd.to_datetime(at["ts"], format="%Y/%m/%d %H:%M")
    key = df[["ts", "src", "dst", "amount", "txn_row"]]
    m = at.merge(key, on=["ts", "src", "dst", "amount"], how="left")
    return m.drop_duplicates(subset=["attempt", "ts", "src", "dst", "amount"])


# ---------------------------------------------------------------- detection
def detect(processed: pd.DataFrame, window: pd.DataFrame, k_in: int, k_out: int, hub_max: int,
           formats: tuple[str, ...] = ("ACH",), cross_bank: bool = True):
    """Return list of (hub, kind, edges_df) for fan-in / fan-out hubs in the window.

    Channel filter (measured on HI-Small labels): 86.6% of laundering transactions are ACH
    (laundering rate 0.75% vs ~0.02% for other formats) and 98% cross banks."""
    def clean(x):
        m = (x["src"] != x["dst"]) & x["format"].isin(list(formats))
        if cross_bank:
            m = m & (x["from_bank"] != x["to_bank"])
        return x[m]

    w = clean(window)
    p = clean(processed)
    # all-time (so far) distinct counterparties: big numbers = merchants / banks, not mules
    deg_in_all = p.groupby("dst")["src"].nunique()
    deg_out_all = p.groupby("src")["dst"].nunique()

    fin = w.groupby("dst")["src"].nunique()
    fin = fin[fin >= k_in]
    fin = fin[deg_in_all.reindex(fin.index).fillna(0) <= hub_max]

    fout = w.groupby("src")["dst"].nunique()
    fout = fout[fout >= k_out]
    fout = fout[deg_out_all.reindex(fout.index).fillna(0) <= hub_max]

    rings = []
    if len(fin):
        e = w[w["dst"].isin(fin.index)]
        for hub, g in e.groupby("dst"):
            rings.append((hub, "FAN-IN", g))
    if len(fout):
        e = w[w["src"].isin(fout.index)]
        for hub, g in e.groupby("src"):
            rings.append((hub, "FAN-OUT", g))
    return rings


# ---------------------------------------------------------------- mongo sink
class Sink:
    """Writes to MongoDB, or just records in memory when --dry-run."""

    def __init__(self, uri: str | None):
        self.db = None
        if uri:
            from pymongo import MongoClient
            self.db = MongoClient(uri, serverSelectionTimeoutMS=5000)["tripwire"]
            self.db.command("ping")

    def reset(self):
        """Fresh replay: clear worker-owned state (and the agent's derived state for those rings)."""
        if self.db is None:
            return
        for c in ("rings", "transactions", "cases", "sar_drafts"):
            self.db[c].delete_many({})
        self.db.meta.delete_many({"_id": {"$in": ["tick", "eval_rings", "worker"]}})
        self.db.watch_state.delete_many({"_id": {"$in": ["rings_agent"]}})

    def meta(self, _id: str, doc: dict):
        if self.db is not None:
            self.db.meta.update_one({"_id": _id}, {"$set": doc}, upsert=True)

    def ring(self, ring: dict, txns: list[dict], is_new: bool):
        if self.db is None:
            return
        # idempotent: safe across worker restarts (insert on first sight, update afterwards)
        self.db.rings.replace_one({"_id": ring["_id"]}, ring, upsert=True)
        if txns:
            from pymongo import UpdateOne
            self.db.transactions.bulk_write(
                [UpdateOne({"_id": t["_id"]}, {"$set": t}, upsert=True) for t in txns], ordered=False)


def to_host(df: pd.DataFrame) -> pd.DataFrame:
    """Small frames only: make sure we have real pandas objects for Python iteration."""
    return df.to_pandas() if hasattr(df, "to_pandas") else df


# ---------------------------------------------------------------- main loop
def run(args):
    t0 = time.time()
    name = os.path.basename(args.data.rstrip("/\\")).replace("ibm-aml-", "")
    prefix = {"hi-medium": "HI-Medium", "hi-small": "HI-Small"}.get(name.lower(), name)
    df = load_transactions(os.path.join(args.data, f"{prefix}_Trans.csv"))
    load_s = time.time() - t0
    log(f"loaded {len(df):,} transactions in {load_s:.1f}s")

    attempts = load_attempts(os.path.join(args.data, f"{prefix}_Patterns.txt"))
    at = attempts_frame(attempts, df)
    att_last_ts = at.groupby("attempt")["ts"].max()
    att_type = at.groupby("attempt")["type"].first()
    log(f"{len(attempts):,} labelled attempts; {at['txn_row'].notna().mean():.1%} of their txns matched")

    sink = Sink(None if args.dry_run else args.mongo)
    if args.reset:
        sink.reset()
        log("reset: cleared rings/transactions/cases/sar_drafts/tick/eval")
    sink.meta("worker", {"status": "running", "mode": "gpu" if ON_GPU else "cpu", "rows": int(len(df)),
                         "load_s": round(load_s, 2), "started": datetime.now(timezone.utc)})

    ts_np = df["ts"].values if not hasattr(df["ts"], "to_numpy") else df["ts"].to_numpy()
    start, end = pd.Timestamp(ts_np[0]), pd.Timestamp(ts_np[-1])
    window = pd.Timedelta(days=args.window_days)
    cursor = start + window if args.dry_run else start
    flagged_rows: set[int] = set()
    escalated_rows: set[int] = set()
    rings: dict[str, dict] = {}       # hub+episode -> ring doc
    hub_episode: dict[str, tuple[str, pd.Timestamp]] = {}
    counter = 0
    last_n, last_t = 0, time.time()
    cycle_times = []

    while cursor <= end + pd.Timedelta(minutes=1):
        c0 = time.time()
        n = int(np.searchsorted(ts_np, np.datetime64(cursor), side="right"))
        processed = df.iloc[:n]
        lo = int(np.searchsorted(ts_np, np.datetime64(cursor - window), side="left"))
        win = df.iloc[lo:n]

        for hub, kind, g in detect(processed, win, args.k_in, args.k_out, args.hub_max,
                                   tuple(args.formats.split(",")), not args.same_bank_ok):
            g = to_host(g)
            prev = hub_episode.get(hub)
            if prev and cursor - prev[1] <= window:
                ring_id = prev[0]
            else:
                counter += 1
                ring_id = f"R-{counter:03d}"
            hub_episode[hub] = (ring_id, cursor)
            rows = [int(r) for r in g["txn_row"].tolist()]
            new_rows = [r for r in rows if r not in flagged_rows]
            is_new = ring_id not in rings
            if not is_new and not new_rows:
                continue
            flagged_rows.update(rows)
            accounts = sorted(set(g["src"].tolist()) | set(g["dst"].tolist()))
            edges = [{"src": s, "dst": d, "amount": round(float(a), 2), "currency": c,
                      "usd": round(float(u), 2), "ts": pd.Timestamp(t).isoformat(), "txn_id": f"T{int(r)}"}
                     for s, d, a, c, u, t, r in zip(g["src"], g["dst"], g["amount"], g["currency"],
                                                     g["usd"], g["ts"], g["txn_row"])]
            span_h = (pd.Timestamp(g["ts"].max()) - pd.Timestamp(g["ts"].min())).total_seconds() / 3600
            amt_med = float(g["usd"].median())
            # Escalation score (measured on HI-Small labels: keeps 92% of true rings, precision 4.5% -> 49%):
            # laundering rings spread over hours/days with larger amounts; benign bursts happen within one hour.
            tier = "escalate" if (span_h >= args.min_span_h and amt_med >= args.min_amt_usd) else "watch"
            if tier == "escalate":
                escalated_rows.update(rows)
            ring = {"_id": ring_id, "type": kind, "hub": hub, "accounts": accounts, "edges": edges,
                    "total_usd": round(float(g["usd"].sum()), 2), "n_txns": len(edges),
                    "tier": tier, "span_h": round(span_h, 1), "amt_med_usd": round(amt_med, 2),
                    "found_at": datetime.now(timezone.utc), "sim_time": cursor.isoformat(),
                    "labelled_share": round(float(g["is_laundering"].mean()), 3), "status": "new"}
            if not is_new:
                ring["found_at"] = rings[ring_id]["found_at"]
            rings[ring_id] = ring
            txns = [{"_id": e["txn_id"], "ring_id": ring_id, **{k: e[k] for k in
                     ("src", "dst", "amount", "currency", "usd", "ts")}} for e in edges]
            sink.ring(ring, txns, is_new)
            if is_new and not args.quiet and tier == "escalate":
                log(f"{ring_id} {kind} hub={hub} accounts={len(accounts)} txns={len(edges)} "
                    f"labelled={ring['labelled_share']:.0%} sim={cursor:%Y-%m-%d %H:%M}")

        # ---- eval (honest: only attempts that have fully happened by now)
        done = att_last_ts[att_last_ts <= cursor].index
        sub = at[at["attempt"].isin(done)]
        if len(sub):
            hit = sub["txn_row"].isin(list(flagged_rows))
            share = hit.groupby(sub["attempt"]).mean()
            recovered = int((share >= 0.5).sum())
            by_type = {}
            for typ, grp in share.groupby(att_type.reindex(share.index)):
                by_type[str(typ)] = [int((grp >= 0.5).sum()), int(len(grp))]
        else:
            recovered, by_type = 0, {}
        fl = df[df["txn_row"].isin(list(flagged_rows))] if flagged_rows else df.iloc[:0]
        precision_all = float(fl["is_laundering"].mean()) if len(fl) else None
        es = df[df["txn_row"].isin(list(escalated_rows))] if escalated_rows else df.iloc[:0]
        precision = float(es["is_laundering"].mean()) if len(es) else None
        if len(sub):
            recovered_esc = int((sub["txn_row"].isin(list(escalated_rows)).groupby(sub["attempt"]).mean() >= 0.5).sum())
        else:
            recovered_esc = 0
        sink.meta("eval_rings", {"rings_recovered": recovered, "rings_total": int(len(done)),
                                 "rings_total_all": len(attempts), "by_type": by_type,
                                 "flagged_precision": None if precision is None else round(precision, 3),
                                 "flagged_precision_all": None if precision_all is None else round(precision_all, 3),
                                 "rings_recovered_escalated": recovered_esc,
                                 "rings_found": len(rings),
                                 "rings_escalated": sum(1 for r in rings.values() if r.get("tier") == "escalate"),
                                 "sim_time": cursor.isoformat()})

        cycle_times.append(time.time() - c0)
        now = time.time()
        sink.meta("tick", {"tx_total": n, "tx_per_sec": round((n - last_n) / max(now - last_t, 1e-6), 1),
                           "replay_time": cursor.isoformat(), "cycle_s": round(cycle_times[-1], 3)})
        last_n, last_t = n, now

        if args.dry_run:
            cursor += pd.Timedelta(hours=args.dry_step_hours)
        else:
            time.sleep(max(0.0, args.cycle_s - (time.time() - c0)))
            cursor += pd.Timedelta(seconds=args.speed * max(time.time() - c0, args.cycle_s))

    total = time.time() - t0
    log(f"done: {len(rings)} rings ({sum(1 for r in rings.values() if r.get('tier') == 'escalate')} escalated), "
        f"recovered {recovered}/{len(done)} (escalated-only {recovered_esc}), precision escalated {precision} all {precision_all}, "
        f"by_type {by_type}, avg cycle {np.mean(cycle_times):.2f}s, total {total:.1f}s")
    sink.meta("worker", {"status": "finished", "total_s": round(total, 1)})
    return {"rings": len(rings), "recovered": recovered, "total": int(len(done)), "precision": precision,
            "by_type": by_type, "load_s": load_s, "avg_cycle_s": float(np.mean(cycle_times)), "total_s": total}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=os.environ.get("TW_DATA", "/tw/data/ibm-aml-hi-medium"))
    ap.add_argument("--mongo", default=os.environ.get("TW_MONGO", "mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true"))
    ap.add_argument("--k-in", type=int, default=int(os.environ.get("TW_K_IN", 5)))
    ap.add_argument("--k-out", type=int, default=int(os.environ.get("TW_K_OUT", 5)))
    ap.add_argument("--hub-max", type=int, default=int(os.environ.get("TW_HUB_MAX", 20)))
    ap.add_argument("--window-days", type=float, default=float(os.environ.get("TW_WINDOW_DAYS", 4)))
    ap.add_argument("--speed", type=float, default=float(os.environ.get("TW_SPEED", 1440)),
                    help="sim seconds per real second (1440 = 1 sim day per real minute)")
    ap.add_argument("--cycle-s", type=float, default=float(os.environ.get("TW_CYCLE_S", 3)))
    ap.add_argument("--min-span-h", type=float, default=float(os.environ.get("TW_MIN_SPAN_H", 2)))
    ap.add_argument("--min-amt-usd", type=float, default=float(os.environ.get("TW_MIN_AMT_USD", 4000)))
    ap.add_argument("--formats", default=os.environ.get("TW_FORMATS", "ACH"))
    ap.add_argument("--same-bank-ok", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="no Mongo, no sleeping: sweep the data and print eval")
    ap.add_argument("--dry-step-hours", type=float, default=12)
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--reset", action="store_true", help="clear worker-owned Mongo state before replaying")
    run(ap.parse_args())


if __name__ == "__main__":
    main()

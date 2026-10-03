"""Tripwire ring finder.

Plain pandas. On the GB10 run it on the GPU with:
    python -m cudf.pandas worker/ringfinder.py --data /tw/data/ibm-aml-hi-medium
The same file without `-m cudf.pandas` is the CPU baseline (used for the CPU-vs-GPU bench).

What it does (see ARCHITECTURE.md section 6):
  * replays the bank's transactions in time order on a simulated clock
  * every cycle, detects fan-in / fan-out rings in the trailing window on the GPU
  * writes rings, their transactions, tick, eval and bench docs to MongoDB
  * resumes from Mongo after a crash (default unless --reset); --loop stays alive after the data ends
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


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


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
    # join on integer cents: GPU and CPU float parsing differ in the last bits (E-028)
    at["cents"] = (at["amount"] * 100).round().astype("int64")
    key = df[["ts", "src", "dst", "amount", "txn_row"]].copy()
    key["cents"] = (key["amount"] * 100).round().astype("int64")
    m = at.merge(key.drop(columns=["amount"]), on=["ts", "src", "dst", "cents"], how="left")
    return m.drop_duplicates(subset=["attempt", "ts", "src", "dst", "cents"])


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
        rings += [(hub, "FAN-IN", g) for hub, g in _host_groups(w[w["dst"].isin(fin.index)], "dst")]
    if len(fout):
        rings += [(hub, "FAN-OUT", g) for hub, g in _host_groups(w[w["src"].isin(fout.index)], "src")]
    return rings


HOST_COLS = ("src", "dst", "amount", "currency", "usd", "ts", "txn_row", "is_laundering")


def _host_groups(e: pd.DataFrame, key: str):
    """Split the (small) flagged-edge frame per hub on the host with numpy.

    Iterating a GPU groupby in Python costs one device round-trip per hub (measured: GPU at 1%,
    38 s cycles on HI-Medium). Copy the few needed columns to host once, then split there."""
    arr = {c: e[c].to_numpy() for c in HOST_COLS}
    if len(arr[key]) == 0:
        return []
    order = np.argsort(arr[key], kind="stable")
    keys = arr[key][order]
    uniq, first = np.unique(keys, return_index=True)
    bounds = list(first) + [len(keys)]
    return [(u, {c: arr[c][order[bounds[i]:bounds[i + 1]]] for c in HOST_COLS}) for i, u in enumerate(uniq)]


# ---------------------------------------------------------------- mongo sink
class Sink:
    """Writes to MongoDB, or just records in memory when --dry-run."""

    def __init__(self, uri: str | None, db_name: str = "tripwire"):
        self.db = None
        if uri:
            from pymongo import MongoClient
            self.db = MongoClient(uri, serverSelectionTimeoutMS=5000)[db_name]
            self.db.command("ping")

    def reset(self):
        """Fresh replay: clear worker-owned state (and the agent's derived state for those rings)."""
        if self.db is None:
            return
        for c in ("rings", "transactions", "cases", "sar_drafts"):
            self.db[c].delete_many({})
        self.db.meta.delete_many({"_id": {"$in": ["tick", "eval_rings", "worker"]}})
        self.db.watch_state.delete_many({"_id": {"$in": ["rings_agent", "ringfinder"]}})

    def meta(self, _id: str, doc: dict, inc: dict | None = None):
        if self.db is not None:
            upd = {"$set": doc, **({"$inc": inc} if inc else {})}
            self.db.meta.update_one({"_id": _id}, upd, upsert=True)

    def ring(self, ring: dict, txns: list[dict], is_new: bool, esc: bool = False):
        if self.db is None:
            return
        # idempotent: safe across worker restarts (insert on first sight, update afterwards)
        self.db.rings.replace_one({"_id": ring["_id"]}, ring, upsert=True)
        if txns:
            from pymongo import UpdateOne
            # esc: row was written by an escalated ring (never unset), so a resume restores the escalated set
            self.db.transactions.bulk_write(
                [UpdateOne({"_id": t["_id"]}, {"$set": {**t, "esc": True} if esc else t}, upsert=True)
                 for t in txns], ordered=False)

    def checkpoint(self, cursor: pd.Timestamp, hubs: list):
        """Hub episodes still inside the window ([hub, ring_id, sim ns]): makes a resume exact."""
        if self.db is not None:
            self.db.watch_state.replace_one({"_id": "ringfinder"}, {"replay_time": cursor.isoformat(),
                                                                   "hubs": hubs}, upsert=True)

    def load_state(self, rows: int, lab_by_row: np.ndarray) -> dict | None:
        """Resume point: cursor, ring counter, rings, hub episodes, flagged/escalated rows and label counters."""
        if self.db is None:
            return None
        tick = self.db.meta.find_one({"_id": "tick"}) or {}
        worker = self.db.meta.find_one({"_id": "worker"}) or {}
        if not tick.get("replay_time"):
            return None
        if worker.get("rows") not in (None, rows):
            log(f"not resuming: Mongo holds a run over {worker.get('rows')} rows, data has {rows} (use --reset)")
            return None
        rings, hub_episode, counter, esc_ids = {}, {}, 0, set()
        for r in self.db.rings.find({}, {"hub": 1, "sim_time": 1, "tier": 1, "found_at": 1}):
            rid = str(r["_id"])
            rings[rid] = {"found_at": r.get("found_at"), "tier": r.get("tier")}
            if rid.startswith("R-") and rid[2:].isdigit():
                counter = max(counter, int(rid[2:]))
            if r.get("tier") == "escalate":
                esc_ids.add(rid)
            hub, st = r.get("hub"), r.get("sim_time")
            if hub and st:
                st = pd.Timestamp(st)
                if hub not in hub_episode or st > hub_episode[hub][1]:
                    hub_episode[hub] = (rid, st)
        ck = self.db.watch_state.find_one({"_id": "ringfinder"}) or {}
        seen_ns = {h: (rid, int(ns)) for h, rid, ns in ck.get("hubs") or []}
        for h, (rid, ns) in seen_ns.items():   # the latest of last detection and last write wins
            if h not in hub_episode or pd.Timestamp(ns) > hub_episode[h][1]:
                hub_episode[h] = (rid, pd.Timestamp(ns))
        exact = bool(worker.get("esc_flags"))   # older runs: approximate escalated rows by the ring's tier
        flagged, escalated = [], []
        for t in self.db.transactions.find({}, {"ring_id": 1, "esc": 1}):
            tid = str(t["_id"])
            if not (tid.startswith("T") and tid[1:].isdigit()) or int(tid[1:]) >= rows:
                continue
            flagged.append(int(tid[1:]))
            if (t.get("esc") if exact else t.get("ring_id") in esc_ids):
                escalated.append(int(tid[1:]))
        fl = np.unique(np.asarray(flagged, dtype="int64"))
        es = np.unique(np.asarray(escalated, dtype="int64"))
        return {"cursor": pd.Timestamp(tick["replay_time"]), "counter": counter, "rings": rings,
                "hub_episode": hub_episode, "seen_ns": seen_ns,
                "flagged_rows": set(fl.tolist()), "escalated_rows": set(es.tolist()),
                "flagged_lab": [int(lab_by_row[fl].sum()), int(len(fl))],
                "escalated_lab": [int(lab_by_row[es].sum()), int(len(es))], "exact": exact}


def to_host(df: pd.DataFrame) -> pd.DataFrame:
    """Small frames only: make sure we have real pandas objects for Python iteration."""
    return df.to_pandas() if hasattr(df, "to_pandas") else df


# ---------------------------------------------------------------- main loop
def run(args):
    t0 = time.time()
    name = os.path.basename(args.data.rstrip("/\\")).replace("ibm-aml-", "")
    prefix = {"hi-medium": "HI-Medium", "hi-small": "HI-Small"}.get(name.lower(), name)
    sink = Sink(None if args.dry_run else args.mongo, args.db)
    sink.meta("worker", {"status": "loading", "heartbeat": utcnow(), "pid": os.getpid()})
    df = load_transactions(os.path.join(args.data, f"{prefix}_Trans.csv"))
    load_s = time.time() - t0
    log(f"loaded {len(df):,} transactions in {load_s:.1f}s")

    attempts = load_attempts(os.path.join(args.data, f"{prefix}_Patterns.txt"))
    at = attempts_frame(attempts, df)
    att_last_ts = at.groupby("attempt")["ts"].max()
    att_type = at.groupby("attempt")["type"].first()
    log(f"{len(attempts):,} labelled attempts; {at['txn_row'].notna().mean():.1%} of their txns matched")

    state, restore_s = None, 0.0
    if args.reset:
        sink.reset()
        log("reset: cleared rings/transactions/cases/sar_drafts/tick/eval")
    elif sink.db is not None:   # resume is the default; --resume only makes it explicit
        r0 = time.time()
        lab = np.zeros(len(df), dtype="int8")
        lab[np.asarray(df["txn_row"].to_numpy())] = np.asarray(df["is_laundering"].to_numpy())
        state = sink.load_state(int(len(df)), lab)
        restore_s = time.time() - r0
    worker = {"status": "running", "mode": "gpu" if ON_GPU else "cpu", "rows": int(len(df)), "data": prefix,
              "load_s": round(load_s, 2), "started": utcnow(), "heartbeat": utcnow(), "pid": os.getpid()}
    if state:
        sink.meta("worker", {**worker, "resumed_from": state["cursor"].isoformat(), "resumed_at": utcnow()},
                  inc={"resumes": 1})
    else:
        sink.meta("worker", {**worker, "esc_flags": True})   # this run writes the esc flag from the start

    ts_np = df["ts"].values if not hasattr(df["ts"], "to_numpy") else df["ts"].to_numpy()
    start, end = pd.Timestamp(ts_np[0]), pd.Timestamp(ts_np[-1])
    window = pd.Timedelta(days=args.window_days)
    stepped = args.dry_run or args.step_hours > 0    # fixed sim steps, no sleeping
    step_h = args.dry_step_hours if args.dry_run else args.step_hours
    cursor = start + window if stepped else start
    flagged_rows: set[int] = set()
    escalated_rows: set[int] = set()
    flagged_lab, escalated_lab = [0, 0], [0, 0]   # [labelled laundering, total] running counts (no 32M scans)
    rings: dict[str, dict] = {}       # hub+episode -> ring doc
    hub_episode: dict[str, tuple[str, pd.Timestamp]] = {}
    counter = 0
    if state:
        cursor, counter, rings, hub_episode = state["cursor"], state["counter"], state["rings"], state["hub_episode"]
        flagged_rows, escalated_rows = state["flagged_rows"], state["escalated_rows"]
        flagged_lab, escalated_lab = state["flagged_lab"], state["escalated_lab"]
        log(f"resumed at sim {cursor:%Y-%m-%d %H:%M}: {len(rings):,} rings (last R-{counter:03d}), "
            f"{len(flagged_rows):,} flagged rows{'' if state['exact'] else ' (escalated rows approximated)'}, "
            f"restored in {restore_s:.1f}s")
    elif sink.db is not None and not args.reset:
        log("nothing to resume: fresh replay")
    seen_ns = state["seen_ns"] if state else {}   # hub -> (ring id, last detection ns) inside the window
    win_ns = int(window.value)
    last_n = int(np.searchsorted(ts_np, np.datetime64(cursor), side="right")) if state else 0
    last_t, last_cursor = time.time(), cursor
    cycle_times = []

    def evaluate(cursor):
        """eval_rings doc (honest: only attempts that have fully happened by now) + raw precisions."""
        done = att_last_ts[att_last_ts <= cursor].index
        sub = at[at["attempt"].isin(done)]
        if len(sub):
            hit = sub["txn_row"].isin(np.fromiter(flagged_rows, dtype="int64", count=len(flagged_rows)))
            share = hit.groupby(sub["attempt"]).mean()
            recovered = int((share >= 0.5).sum())
            by_type = {}
            for typ, grp in share.groupby(att_type.reindex(share.index)):
                by_type[str(typ)] = [int((grp >= 0.5).sum()), int(len(grp))]
        else:
            recovered, by_type = 0, {}
        precision_all = flagged_lab[0] / flagged_lab[1] if flagged_lab[1] else None
        precision = escalated_lab[0] / escalated_lab[1] if escalated_lab[1] else None
        if len(sub):
            esc_arr = np.fromiter(escalated_rows, dtype="int64", count=len(escalated_rows))
            recovered_esc = int((sub["txn_row"].isin(esc_arr).groupby(sub["attempt"]).mean() >= 0.5).sum())
        else:
            recovered_esc = 0
        doc = {"rings_recovered": recovered, "rings_total": int(len(done)),
               "rings_total_all": len(attempts), "by_type": by_type,
               "flagged_precision": None if precision is None else round(precision, 3),
               "flagged_precision_all": None if precision_all is None else round(precision_all, 3),
               "rings_recovered_escalated": recovered_esc,
               "rings_found": len(rings),
               "rings_escalated": sum(1 for r in rings.values() if r.get("tier") == "escalate"),
               "sim_time": cursor.isoformat()}
        return doc, precision, precision_all

    ev = None
    while cursor <= end + pd.Timedelta(minutes=1):
        c0 = time.time()
        cur_ns = int(cursor.value)
        n = int(np.searchsorted(ts_np, np.datetime64(cursor), side="right"))
        processed = df.iloc[:n]
        lo = int(np.searchsorted(ts_np, np.datetime64(cursor - window), side="left"))
        win = df.iloc[lo:n]

        for hub, kind, g in detect(processed, win, args.k_in, args.k_out, args.hub_max,
                                   tuple(args.formats.split(",")), not args.same_bank_ok):
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
            seen_ns[hub] = (ring_id, cur_ns)
            if not is_new and not new_rows:
                continue
            for r_, lab_ in zip(rows, g["is_laundering"].tolist()):
                if r_ not in flagged_rows:
                    flagged_lab[0] += int(lab_); flagged_lab[1] += 1
            flagged_rows.update(rows)
            accounts = sorted(set(g["src"].tolist()) | set(g["dst"].tolist()))
            edges = [{"src": s, "dst": d, "amount": round(float(a), 2), "currency": c,
                      "usd": round(float(u), 2), "ts": pd.Timestamp(t).isoformat(), "txn_id": f"T{int(r)}"}
                     for s, d, a, c, u, t, r in zip(g["src"], g["dst"], g["amount"], g["currency"],
                                                     g["usd"], g["ts"], g["txn_row"])]
            span_h = (pd.Timestamp(g["ts"].max()) - pd.Timestamp(g["ts"].min())).total_seconds() / 3600
            amt_med = float(np.median(g["usd"]))
            # Escalation score (measured on HI-Small labels: keeps 92% of true rings, precision 4.5% -> 49%):
            # laundering rings spread over hours/days with larger amounts; benign bursts happen within one hour.
            tier = "escalate" if (span_h >= args.min_span_h and amt_med >= args.min_amt_usd) else "watch"
            if tier == "escalate":
                for r_, lab_ in zip(rows, g["is_laundering"].tolist()):
                    if r_ not in escalated_rows:
                        escalated_lab[0] += int(lab_); escalated_lab[1] += 1
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
            sink.ring(ring, txns, is_new, esc=tier == "escalate")
            if is_new and not args.quiet and tier == "escalate":
                log(f"{ring_id} {kind} hub={hub} accounts={len(accounts)} txns={len(edges)} "
                    f"labelled={ring['labelled_share']:.0%} sim={cursor:%Y-%m-%d %H:%M}")

        ev, precision, precision_all = evaluate(cursor)
        sink.meta("eval_rings", ev)
        if sink.db is not None:   # checkpoint before the tick, so it is never older than the resume cursor
            for h in [h for h, (_, ns) in seen_ns.items() if ns < cur_ns - win_ns]:
                del seen_ns[h]
            sink.checkpoint(cursor, [[h, r, ns] for h, (r, ns) in seen_ns.items()])

        cycle_times.append(time.time() - c0)
        now = time.time()
        sink.meta("tick", {"tx_total": n, "tx_per_sec": round((n - last_n) / max(now - last_t, 1e-6), 1),
                           "replay_time": cursor.isoformat(), "cycle_s": round(cycle_times[-1], 3),
                           "status": "replay"})
        sink.meta("worker", {"status": "running", "heartbeat": utcnow(), "sim_time": cursor.isoformat()})
        last_n, last_t, last_cursor = n, now, cursor
        if args.max_cycles and len(cycle_times) >= args.max_cycles:
            log(f"--max-cycles {args.max_cycles}: hard exit (resume test)")
            os._exit(3)

        if stepped:
            cursor += pd.Timedelta(hours=step_h)
        else:
            time.sleep(max(0.0, args.cycle_s - (time.time() - c0)))
            cursor += pd.Timedelta(seconds=args.speed * max(time.time() - c0, args.cycle_s))

    total = time.time() - t0
    if ev is None:   # resumed after the end of the data
        ev, precision, precision_all = evaluate(last_cursor)
    avg_cycle = float(np.mean(cycle_times)) if cycle_times else 0.0
    log(f"done: {ev['rings_found']} rings ({ev['rings_escalated']} escalated), "
        f"recovered {ev['rings_recovered']}/{ev['rings_total']} (escalated-only {ev['rings_recovered_escalated']}), "
        f"precision escalated {precision} all {precision_all}, "
        f"by_type {ev['by_type']}, avg cycle {avg_cycle:.2f}s, total {total:.1f}s")
    if args.loop and not args.dry_run:
        live_idle(sink, args.idle_s, last_n, last_cursor, total)
    sink.meta("worker", {"status": "finished", "total_s": round(total, 1)})
    return {"rings": ev["rings_found"], "recovered": ev["rings_recovered"], "total": ev["rings_total"],
            "precision": precision, "by_type": ev["by_type"], "load_s": load_s, "avg_cycle_s": avg_cycle,
            "total_s": total}


def live_idle(sink: Sink, idle_s: float, tx_total: int, cursor, total_s: float):
    """Data exhausted: stay alive and keep tick + heartbeat fresh for the UI and the supervisor."""
    log(f"end of data: live-idle (tick + heartbeat every {idle_s:.0f}s)")
    sink.meta("worker", {"status": "live-idle", "total_s": round(total_s, 1)})
    while True:
        try:
            sink.meta("tick", {"tx_total": int(tx_total), "tx_per_sec": 0.0, "replay_time": cursor.isoformat(),
                               "cycle_s": 0.0, "status": "live-idle"})
            sink.meta("worker", {"status": "live-idle", "heartbeat": utcnow()})
        except Exception as e:   # Mongo blip: keep idling, the supervisor watches the heartbeat
            log(f"idle write failed: {e}")
        time.sleep(idle_s)


def run_bench(args):
    """Same code, CPU vs GPU: load the full CSV + one detection pass over everything (trailing window at the
    end of the data, all-time degrees over all rows). Writes meta.bench {cpu_s|gpu_s, rows}."""
    mode = "gpu" if ON_GPU else "cpu"
    name = os.path.basename(args.data.rstrip("/\\")).replace("ibm-aml-", "")
    prefix = {"hi-medium": "HI-Medium", "hi-small": "HI-Small"}.get(name.lower(), name)
    t0 = time.time()
    df = load_transactions(os.path.join(args.data, f"{prefix}_Trans.csv"))
    t_load = time.time() - t0
    end = df["ts"].max()
    win = df[df["ts"] > end - pd.Timedelta(days=args.window_days)]
    t1 = time.time()
    rings = detect(df, win, args.k_in, args.k_out, args.hub_max, tuple(args.formats.split(",")),
                   not args.same_bank_ok)
    t_detect = time.time() - t1
    total = time.time() - t0
    log(f"BENCH {mode}: rows={len(df):,} load={t_load:.1f}s detect={t_detect:.1f}s total={total:.1f}s rings={len(rings)}")
    sink = Sink(None if args.dry_run else args.mongo, args.db)
    sink.meta("bench", {"rows": int(len(df)), f"{mode}_s": round(total, 1), f"{mode}_load_s": round(t_load, 1),
                        f"{mode}_detect_s": round(t_detect, 1)})


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
    ap.add_argument("--bench", action="store_true", help="time load + one full detection pass, write meta.bench")
    ap.add_argument("--reset", action="store_true", help="clear worker-owned Mongo state before replaying")
    ap.add_argument("--resume", action="store_true", help="continue from Mongo state (the default without --reset)")
    ap.add_argument("--loop", action="store_true", help="after the data ends stay alive (tick status live-idle)")
    ap.add_argument("--idle-s", type=float, default=5, help="live-idle tick/heartbeat period")
    ap.add_argument("--db", default=os.environ.get("TW_DB", "tripwire"), help="Mongo database (tests use another)")
    ap.add_argument("--step-hours", type=float, default=0, help="fixed sim step per cycle, no sleeping (tests)")
    ap.add_argument("--max-cycles", type=int, default=0, help="hard exit after N cycles (resume tests)")
    a = ap.parse_args()
    if a.reset and a.resume:
        ap.error("--reset and --resume are exclusive")
    run_bench(a) if a.bench else run(a)


if __name__ == "__main__":
    main()

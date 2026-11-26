"""Relative Strength vs Nifty 500, same formula as the TradingView 'Relative Strength' indicator (modhelius):
   RS(N) = (stock / stock[N bars ago]) / (benchmark / benchmark[N bars ago]) - 1      (shown here in %)
Daily bars; windows 1W = 5, 3M = 63, 6M = 126, 1Y = 252 trading days. Reads data/prices/SYM.csv, data/NIFTY500.csv,
data/universe.csv, data/industry.csv. Writes data/rs.json and data/rs_log.txt.
Per stock and window: v = RS now, p = RS 5 sessions ago, u = crossed above 0 within the last 5 sessions, d = crossed below 0 within the last 5."""
import csv, json, os, datetime
import numpy as np

PRICES, OUT = "data/prices", "data/rs.json"
BENCH_FILES = ["data/prices/NIFTY500.csv", "data/NIFTY500.csv"]
WINDOWS = {"1w": 5, "3m": 63, "6m": 126, "1y": 252}
LOOK = 5


def load(path):
    d = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            try:
                c = float(r["Close"])
                if c > 0:
                    d[r["Date"]] = c
            except Exception:
                pass
    return d


def main():
    bf = next((f for f in BENCH_FILES if os.path.exists(f)), None)
    if not bf:
        msg = "Nifty 500 history not found. Looked in: " + ", ".join(BENCH_FILES)
        open("data/rs_log.txt", "w").write(msg + "\n"); print(msg); raise SystemExit(1)
    bench = load(bf)
    syms = [r["symbol"] for r in csv.DictReader(open("data/universe.csv", newline="", encoding="utf-8-sig"))]
    ind = {}
    if os.path.exists("data/industry.csv"):
        for r in csv.DictReader(open("data/industry.csv", newline="", encoding="utf-8-sig")):
            ind[r["symbol"]] = r
    rows, skipped = [], []
    bd = sorted(bench)
    asof = bd[-1] if bd else ""
    cutoff = bd[-6] if len(bd) > 6 else ""        # a stock whose last price is older than ~5 sessions is stale
    for s in syms:
        p = f"{PRICES}/{s}.csv"
        if not os.path.exists(p):
            skipped.append(s); continue
        st = load(p)
        dates = sorted(set(st) & set(bench))
        if len(dates) < 70:
            skipped.append(s); continue
        a = np.array([st[d] for d in dates]); b = np.array([bench[d] for d in dates])
        if dates[-1] < cutoff:
            skipped.append(s); continue
        v, pv, up, dn = [], [], [], []
        for k, n in WINDOWS.items():
            if len(a) <= n + LOOK:
                v.append(None); pv.append(None); up.append(0); dn.append(0); continue
            res = (a[n:] / a[:-n]) / (b[n:] / b[:-n]) - 1
            cur, prev = float(res[-1]) * 100, float(res[-1 - LOOK]) * 100
            recent = res[-1 - LOOK:-1]
            v.append(round(cur, 2)); pv.append(round(prev, 2))
            up.append(int(cur > 0 and bool((recent <= 0).any()))); dn.append(int(cur < 0 and bool((recent >= 0).any())))
        i = ind.get(s, {})
        rows.append({"s": s, "m": i.get("macro", ""), "v": v, "p": pv, "u": up, "d": dn})
    json.dump({"asof": asof, "bench": "Nifty 500", "windows": WINDOWS, "look": LOOK,
               "gen": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M"), "stocks": rows},
              open(OUT, "w"), separators=(",", ":"))
    log = [f"Run (UTC): {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d %H:%M}", f"Benchmark last date: {asof}",
           f"Computed {len(rows)} of {len(syms)}; skipped {len(skipped)} {skipped[:20]}"]
    for j, k in enumerate(WINDOWS):
        vals = [r["v"][j] for r in rows if r["v"][j] is not None]
        if vals:
            log.append(f"{k}: above 0 = {sum(x > 0 for x in vals)}, below 0 = {sum(x < 0 for x in vals)}, crossed up (5d) = {sum(r['u'][j] for r in rows)}")
    open("data/rs_log.txt", "w").write("\n".join(log) + "\n")
    print("\n".join(log))


if __name__ == "__main__":
    main()

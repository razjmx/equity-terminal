"""Comparative relative strength, base 0:

   RS(N) = ((1 + R_stock) / (1 + R_benchmark) - 1) x 100        where R = return over the last N daily bars

   0 = moving exactly with the benchmark, above 0 = beating it, below 0 = lagging it.
   Windows: 1W = 5, 3M = 63, 6M = 126, 1Y = 252 trading days.

Benchmarks (each one is used only if its history file exists in data/prices/ or data/):
   NIFTY500 (default), NIFTY50, NIFTYMID150, NIFTYSML250, BANKNIFTY, SENSEX
Writes data/rs.json (Nifty 500, the default) and data/rs_<KEY>.json for the others, plus data/rs_log.txt.
Per stock and window: v = RS now, p = RS 5 sessions ago, u = crossed above 0 within the last 5 sessions,
d = crossed below 0 within the last 5."""
import csv, json, os, datetime
import numpy as np

PRICES = "data/prices"
BENCHES = [("NIFTY500", "Nifty 500"), ("NIFTY50", "Nifty 50"), ("NIFTYMID150", "Nifty Midcap 150"),
           ("NIFTYSML250", "Nifty Smallcap 250"), ("BANKNIFTY", "Nifty Bank"), ("SENSEX", "Sensex")]
WINDOWS = {"1w": 5, "3m": 63, "6m": 126, "1y": 252}
LOOK = 5


def load(path):
    d = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            try:
                c = float(r["Close"])
                if c > 0:
                    d[r["Date"][:10]] = c
            except Exception:
                pass
    return d


def find(key):
    for p in (f"{PRICES}/{key}.csv", f"data/{key}.csv"):
        if os.path.exists(p):
            return p
    return None


def crs(a, b, n):
    """((1 + R_stock) / (1 + R_bench) - 1) x 100 for every bar that has n bars of history."""
    ra = a[n:] / a[:-n] - 1
    rb = b[n:] / b[:-n] - 1
    return ((1 + ra) / (1 + rb) - 1) * 100


def main():
    log = [f"Run (UTC): {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d %H:%M}"]
    avail = [(k, n, find(k)) for k, n in BENCHES]
    avail = [(k, n, p) for k, n, p in avail if p]
    if not avail or avail[0][0] != "NIFTY500":
        msg = "Nifty 500 history not found (data/prices/NIFTY500.csv or data/NIFTY500.csv)."
        open("data/rs_log.txt", "w").write(msg + "\n"); print(msg); raise SystemExit(1)
    syms = [r["symbol"] for r in csv.DictReader(open("data/universe.csv", newline="", encoding="utf-8-sig"))]
    ind = {}
    if os.path.exists("data/industry.csv"):
        for r in csv.DictReader(open("data/industry.csv", newline="", encoding="utf-8-sig")):
            ind[r["symbol"]] = r
    stocks = {}
    for s in syms:
        p = f"{PRICES}/{s}.csv"
        if os.path.exists(p):
            stocks[s] = load(p)
    benches = [{"k": k, "n": n} for k, n, _ in avail]
    gen = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M")
    for key, name, path in avail:
        bench = load(path)
        bd = sorted(bench)
        asof = bd[-1] if bd else ""
        cutoff = bd[-6] if len(bd) > 6 else ""        # a stock whose last price is older than ~5 sessions is stale
        rows, skipped = [], []
        for s in syms:
            st = stocks.get(s)
            if not st:
                skipped.append(s); continue
            dates = sorted(set(st) & set(bench))
            if len(dates) < 70 or dates[-1] < cutoff:
                skipped.append(s); continue
            a = np.array([st[d] for d in dates]); b = np.array([bench[d] for d in dates])
            v, pv, up, dn = [], [], [], []
            for k, n in WINDOWS.items():
                if len(a) <= n + LOOK:
                    v.append(None); pv.append(None); up.append(0); dn.append(0); continue
                res = crs(a, b, n)
                cur, prev = float(res[-1]), float(res[-1 - LOOK])
                recent = res[-1 - LOOK:-1]
                v.append(round(cur, 2)); pv.append(round(prev, 2))
                up.append(int(cur > 0 and bool((recent <= 0).any())))
                dn.append(int(cur < 0 and bool((recent >= 0).any())))
            rows.append({"s": s, "m": ind.get(s, {}).get("macro", ""), "v": v, "p": pv, "u": up, "d": dn})
        out = "data/rs.json" if key == "NIFTY500" else f"data/rs_{key}.json"
        json.dump({"asof": asof, "bench": name, "key": key, "base": 0, "windows": WINDOWS, "look": LOOK, "gen": gen,
                   "benches": benches, "stocks": rows}, open(out, "w"), separators=(",", ":"))
        log.append(f"{name}: last date {asof}; computed {len(rows)} of {len(syms)}; skipped {len(skipped)} {skipped[:10]}")
        for j, k in enumerate(WINDOWS):
            vals = [r["v"][j] for r in rows if r["v"][j] is not None]
            if vals:
                log.append(f"   {k}: above 0 = {sum(x > 0 for x in vals)}, below 0 = {sum(x < 0 for x in vals)}, "
                           f"crossed up (5d) = {sum(r['u'][j] for r in rows)}")
    missing = [n for k, n in BENCHES if k not in [b['k'] for b in benches]]
    if missing:
        log.append("Benchmarks without a history file (not offered on the site): " + ", ".join(missing))
    open("data/rs_log.txt", "w").write("\n".join(log) + "\n")
    print("\n".join(log))


if __name__ == "__main__":
    main()

"""Does the order-flow score predict returns?  -> data/orderflow_backtest.json

The 5-minute score cannot be tested: only 5 sessions of 5-minute bars exist. This tests the same method run on DAILY bars
(same volume profile, close-position buy/sell estimate, VWAP and order-block logic) over 21, 63 and 126 trading-day windows.
Every month-end (21-day steps, about 4 years) and for each stock:
  1. the score is computed from data up to that day only;
  2. the return over the next 5 and 21 trading days is recorded.
Per date the stocks are ranked: rank IC (Spearman), five groups by score (average forward return of each), and the plain
trailing return over the same window as a baseline (is the score better than just "it went up"?).
If data/delivery/*.json exists, a delivery signal is tested too: average delivery % over the last 21 sessions against the
stock's own average over the previous 120 sessions.
Only stocks with median traded value of at least Rs 1 crore a day are used. Env: LIMIT. Writes data/orderflow_backtest.json"""
import csv, datetime, json, math, os, sys, time
import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_orderflow as FO

WIN = {"21": dict(w=21, k=3.0, tol=0.0025, mb=15), "63": dict(w=63, k=6.0, tol=0.004, mb=30), "126": dict(w=126, k=9.0, tol=0.005, mb=30)}
HORIZ = (5, 21)
STEP = 21
YEARS = 4
MIN_LIQ = 1.0


def nw(x, lags=3):
    x = np.asarray(x, float); x = x[np.isfinite(x)]; n = len(x)
    if n < 8:
        return float("nan"), float("nan")
    mu = x.mean(); d = x - mu; s = np.sum(d * d) / n
    for l in range(1, lags + 1):
        s += 2 * (1 - l / (lags + 1)) * np.sum(d[l:] * d[:-l]) / n
    return float(mu), float(mu / math.sqrt(max(s, 1e-18) / n))


def spear(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float); ok = np.isfinite(a) & np.isfinite(b)
    return float(stats.spearmanr(a[ok], b[ok])[0]) if ok.sum() >= 30 else float("nan")


def load(sym):
    try:
        df = pd.read_csv(f"data/prices/{sym}.csv")
    except Exception:
        return None
    df.columns = [c.strip().title() for c in df.columns]
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df = df.dropna(subset=["Date", "Close"]).drop_duplicates("Date").sort_values("Date").set_index("Date")
    df = df[df["Close"] > 0]
    for c in ["Open", "High", "Low"]:
        df[c] = df[c].fillna(df["Close"])
    df["Volume"] = df["Volume"].fillna(0)
    return df[["Open", "High", "Low", "Close", "Volume"]]


def main():
    t0 = time.time()
    LIMIT = int(os.environ.get("LIMIT", "0") or 0)
    syms = [r["symbol"] for r in csv.DictReader(open("data/universe.csv", newline="")) if not r["symbol"].startswith("DUMMY")]
    if LIMIT:
        syms = syms[:LIMIT]
    D = {}
    for s in syms:
        df = load(s)
        if df is not None and len(df) > 300:
            tv = (df["Close"] * df["Volume"]).tail(250).median() / 1e7
            if tv >= MIN_LIQ:
                D[s] = df
    if len(D) < 100:
        print("too few liquid stocks"); sys.exit(0)
    cal = sorted(set().union(*[set(d.index) for d in D.values()]))
    cal = pd.DatetimeIndex(cal)
    n = len(cal)
    first = max(130, n - YEARS * 252)
    ends = list(range(first, n - 1 - max(HORIZ), STEP))
    S = list(D)
    # price matrix aligned on the calendar (forward-filled a few days)
    PX = pd.DataFrame({s: D[s]["Close"] for s in S}).reindex(cal).ffill(limit=5)
    DEL = {}
    for s in S:
        try:
            j = json.load(open(f"data/delivery/{s}.json")); DEL[s] = pd.Series(j["dp"], index=pd.to_datetime(j["d"]))
        except Exception:
            pass
    res = {}
    for wk, cfg in WIN.items():
        sc = np.full((len(ends), len(S)), np.nan); ch = sc.copy()
        fwd = {h: np.full((len(ends), len(S)), np.nan) for h in HORIZ}
        for si, s in enumerate(S):
            df = D[s]; idx = df.index
            for ei, e in enumerate(ends):
                d_end = cal[e]
                pos = idx.searchsorted(d_end, side="right")           # bars up to and including d_end
                if pos < cfg["w"] + 2 or idx[pos - 1] < d_end - pd.Timedelta(days=7):
                    continue
                r = FO.analyse(df.iloc[pos - cfg["w"] - 1:pos], sessions=cfg["w"], agg=True, k=cfg["k"], tol=cfg["tol"], min_bars=cfg["mb"])
                if not r:
                    continue
                sc[ei, si] = r["score"] if r["bias"] == "bullish" or r["bias"] == "neutral" else r["score"]
                ch[ei, si] = r["chg"]
                p0 = PX[s].iloc[e]
                for h in HORIZ:
                    p1 = PX[s].iloc[e + h]
                    if np.isfinite(p0) and np.isfinite(p1) and p0 > 0:
                        fwd[h][ei, si] = p1 / p0 - 1
        out = {"window": int(wk), "dates": len(ends), "stocks": len(S), "h": {}}
        for h in HORIZ:
            ic, icb, q5, lsr, cnt, bias_r = [], [], [], [], 0, {"bullish": [], "neutral": [], "bearish": []}
            for ei in range(len(ends)):
                a, b, c = sc[ei], fwd[h][ei], ch[ei]
                ok = np.isfinite(a) & np.isfinite(b)
                if ok.sum() < 100:
                    continue
                cnt += 1
                ic.append(spear(a, b)); icb.append(spear(c, b))
                o = np.argsort(a[ok]); bb = b[ok][o]; g = np.array_split(bb, 5)
                q5.append([float(x.mean()) for x in g]); lsr.append(float(g[-1].mean() - g[0].mean()))
                for nm, f in (("bearish", lambda x: x < 40), ("neutral", lambda x: (x >= 40) & (x <= 60)), ("bullish", lambda x: x > 60)):
                    m = f(a[ok]); 
                    if m.sum() >= 5:
                        bias_r[nm].append(float(bb_all(b[ok], m)))
            if cnt < 8:
                continue
            q5 = np.array(q5); mu, t = nw(lsr); mi, ti = nw(ic); mb, tb = nw(icb)
            out["h"][str(h)] = {"periods": cnt, "ic": round(mi, 4), "ic_t": round(ti, 2), "ic_baseline": round(mb, 4), "ic_baseline_t": round(tb, 2),
                                "q": [round(float(x) * 100, 2) for x in q5.mean(axis=0)], "ls": round(mu * 100, 2), "ls_t": round(t, 2),
                                "ls_hit": round(float(np.mean(np.array(lsr) > 0) * 100), 0),
                                "bias": {k: (round(float(np.mean(v)) * 100, 2) if v else None) for k, v in bias_r.items()}}
        res[wk] = out
        print(wk, "done", round(time.time() - t0), "s", flush=True)
    # delivery signal
    dl = None
    if len(DEL) >= 100:
        sig = np.full((len(ends), len(S)), np.nan); f21 = sig.copy()
        for si, s in enumerate(S):
            ser = DEL.get(s)
            if ser is None:
                continue
            for ei, e in enumerate(ends):
                x = ser[ser.index <= cal[e]]
                if len(x) >= 141:
                    sig[ei, si] = x.iloc[-21:].mean() - x.iloc[-141:-21].mean()
                    p0, p1 = PX[s].iloc[e], PX[s].iloc[e + 21]
                    if np.isfinite(p0) and np.isfinite(p1):
                        f21[ei, si] = p1 / p0 - 1
        ic = [spear(sig[i], f21[i]) for i in range(len(ends))]; ic = [x for x in ic if np.isfinite(x)]
        if len(ic) >= 8:
            mu, t = nw(ic); dl = {"periods": len(ic), "ic": round(mu, 4), "ic_t": round(t, 2)}
    json.dump({"generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"), "from": str(cal[ends[0]].date()), "to": str(cal[ends[-1]].date()),
               "step": STEP, "stocks": len(S), "win": res, "delivery": dl,
               "note": "Score computed on daily bars, not the 5-minute version. Today's constituents, so survivorship bias. No costs."},
              open("data/orderflow_backtest.json", "w"), separators=(",", ":"))
    print(open("data/orderflow_backtest.json").read()[:600])


def bb_all(b, m):
    return b[m].mean()


if __name__ == "__main__":
    main()

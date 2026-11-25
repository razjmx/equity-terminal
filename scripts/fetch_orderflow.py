"""Order-flow style analysis from Yahoo 5-minute bars (last 5 trading sessions) for every stock in data/universe.csv.
Writes data/orderflow/SYM.json (bars + zones + levels + score) and data/orderflow.json (ranking table) and data/orderflow_log.txt.

IMPORTANT: this is NOT exchange order-book data. Everything is derived from price and volume bars:
  volume profile / POC / value area   volume spread over each bar's high-low range
  buy/sell delta (estimate)           each bar's volume split by where it closed inside its range
  order blocks                        last opposite candle before a strong displacement, not yet closed through
  liquidity                           unswept swing highs/lows and equal highs/lows (where stop orders tend to sit)
Env: LIMIT=N (first N symbols), CHUNK=40."""
import csv, json, os, sys, time, math, datetime
import numpy as np
import pandas as pd

OUT = "data/orderflow"
BINS = 40
SESSIONS = 5


def r2(x):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(float(x), 2)


def atr_series(h, l, c, n=14):
    pc = np.r_[c[0], c[:-1]]
    tr = np.maximum(h - l, np.maximum(abs(h - pc), abs(l - pc)))
    a = pd.Series(tr).rolling(n, min_periods=3).mean().bfill().to_numpy()
    return a


def profile(h, l, v, lo, hi, bins=BINS):
    """volume at price: each bar's volume spread evenly over the price bins its range covers"""
    step = (hi - lo) / bins if hi > lo else 1.0
    vol = np.zeros(bins)
    for hh, ll, vv in zip(h, l, v):
        a = int(max(0, min(bins - 1, (ll - lo) / step)))
        b = int(max(0, min(bins - 1, (hh - lo) / step)))
        vol[a:b + 1] += vv / (b - a + 1)
    return vol, step


def poc_value_area(vol, lo, step, share=0.70):
    p = int(vol.argmax())
    tot, acc = vol.sum(), vol[p]
    a = b = p
    while acc < share * tot and (a > 0 or b < len(vol) - 1):
        up = vol[b + 1] if b < len(vol) - 1 else -1
        dn = vol[a - 1] if a > 0 else -1
        if up >= dn:
            b += 1; acc += vol[b]
        else:
            a -= 1; acc += vol[a]
    return lo + (p + .5) * step, lo + (b + 1) * step, lo + a * step   # poc, vah, val


def order_blocks(o, h, l, c, v, a):
    n = len(o)
    medv = float(np.median(v)) or 1.0
    out = []
    for i in range(1, n - 3):
        nxt = slice(i + 1, i + 4)
        if c[i] < o[i]:   # bearish candle -> bullish block
            if c[nxt].max() > h[i] + .3 * a[i] and h[nxt].max() - l[i] >= 1.8 * a[i]:
                out.append(["b", i, float(l[i]), float(h[i]), float(v[i] / medv)])
        elif c[i] > o[i]:  # bullish candle -> bearish block
            if c[nxt].min() < l[i] - .3 * a[i] and h[i] - l[nxt].min() >= 1.8 * a[i]:
                out.append(["s", i, float(l[i]), float(h[i]), float(v[i] / medv)])
    keep = []
    for t, i, lo, hi, st in out:
        later_c = c[i + 4:] if i + 4 < n else np.array([])
        if t == "b" and later_c.size and later_c.min() < lo:
            continue            # closed through: mitigated
        if t == "s" and later_c.size and later_c.max() > hi:
            continue
        tested = int(((l[i + 4:] <= hi) & (h[i + 4:] >= lo)).sum()) if i + 4 < n else 0
        keep.append({"t": t, "i": int(i), "lo": r2(lo), "hi": r2(hi), "x": r2(st), "n": tested})
    # drop blocks that overlap a stronger or later one of the same type
    keep.sort(key=lambda z: -z["i"])
    res = []
    for z in keep:
        if not any(y["t"] == z["t"] and y["lo"] <= z["hi"] and z["lo"] <= y["hi"] for y in res):
            res.append(z)
    return res


def swings(h, l, k=3):
    sh, sl = [], []
    for i in range(k, len(h) - k):
        if h[i] == h[i - k:i + k + 1].max() and h[i] > h[i - 1]:
            sh.append(i)
        if l[i] == l[i - k:i + k + 1].min() and l[i] < l[i - 1]:
            sl.append(i)
    return sh, sl


def liquidity(h, l, sh, sl, tol=0.0015):
    n = len(h)
    hi = [(float(h[i]), i) for i in sh if (h[i + 1:].max() if i + 1 < n else -1) <= h[i]]
    lo = [(float(l[i]), i) for i in sl if (l[i + 1:].min() if i + 1 < n else 1e18) >= l[i]]
    def cluster(arr):
        arr = sorted(arr)
        res = []
        for p, i in arr:
            if res and abs(p - res[-1]["p"]) / p <= tol:
                res[-1]["n"] += 1; res[-1]["p"] = max(res[-1]["p"], p); res[-1]["i"] = max(res[-1]["i"], i)
            else:
                res.append({"p": p, "i": i, "n": 1})
        return [{"p": r2(x["p"]), "i": x["i"], "n": x["n"]} for x in res]
    return cluster(hi), cluster(lo)


def analyse(df, sessions=SESSIONS, agg=False, k=1.0, tol=0.0015):
    """df: index datetimes (exchange tz), columns Open High Low Close Volume. Returns dict or None.
    agg=False: session metrics (VWAP, POC, delta, change) are for the LAST session, as before.
    agg=True : every metric is computed over the whole window (1M / 3M / 6M views); k widens the score thresholds
               (a 6-month move of 10% is ordinary, a 1-day move of 10% is not)."""
    df = df.dropna(subset=["Open", "High", "Low", "Close"]).copy()
    df["Volume"] = df["Volume"].fillna(0)
    if df.empty:
        return None
    days = sorted(set(df.index.date))[-sessions:]
    df = df[[d in days for d in df.index.date]]
    if len(df) < 30:
        return None
    o, h, l, c, v = (df[k].to_numpy(float) for k in ["Open", "High", "Low", "Close", "Volume"])
    di = np.array([days.index(d) for d in df.index.date])
    hm = np.array([t.hour * 100 + t.minute for t in df.index])
    a = atr_series(h, l, c)
    last = np.ones(len(di), bool) if agg else di == di.max()
    px = float(c[-1])
    if agg:
        prev_close = float(o[0])
    else:
        prev_close = float(c[di == di.max() - 1][-1]) if di.max() > 0 else float(o[last][0])
    chg = (px / prev_close - 1) * 100
    ho, lo_, vv = h[last], l[last], v[last]
    tp = (h[last] + l[last] + c[last]) / 3
    vol_s = float(vv.sum())
    vwap = float((tp * vv).sum() / vol_s) if vol_s > 0 else px
    rng = np.maximum(ho - lo_, 1e-9)
    buy = vv * (c[last] - lo_) / rng
    delta = float((2 * buy - vv).sum())
    dr = delta / vol_s if vol_s > 0 else 0.0
    prof, step = profile(ho, lo_, vv, lo_.min(), ho.max())
    poc, vah, val = poc_value_area(prof, lo_.min(), step) if vol_s > 0 else (px, px, px)
    if agg:
        per = [float(v[di == q].sum()) for q in range(di.max() + 1)]
        rv = float(np.mean(per[-5:]) / np.mean(per)) if np.mean(per) > 0 else 1.0     # last 5 sessions vs window average
    else:
        prev_vols = [float(v[di == q].sum()) for q in range(di.max())]
        rv = vol_s / (np.mean(prev_vols)) if prev_vols and np.mean(prev_vols) > 0 else 1.0
    blocks = order_blocks(o, h, l, c, v, a)
    sh, sl = swings(h, l)
    lq_hi, lq_lo = liquidity(h, l, sh, sl, tol)
    # structure: last close vs first close of the window
    trend = px / float(c[0]) - 1
    comps = [
        (.20, math.tanh((px - vwap) / vwap / (.004 * k))),
        (.15, (px - lo_.min()) / max(ho.max() - lo_.min(), 1e-9) * 2 - 1),
        (.20, max(-1, min(1, dr * 2))),
        (.20, math.tanh(chg / (1.5 * k))),
        (.10, math.tanh((px - poc) / poc / (.005 * k))),
        (.15, math.tanh(trend / (.03 * k))),
    ]
    net = sum(w * x for w, x in comps) * min(1.15, .85 + .15 * rv)
    bias = "bullish" if net > .15 else "bearish" if net < -.15 else "neutral"
    score = int(min(99, abs(net) * 125))
    # support / resistance: nearest levels from swings, blocks and the value area
    sup = sorted({x["p"] for x in lq_lo if x["p"] < px} | {z["hi"] for z in blocks if z["t"] == "b" and z["hi"] < px} | ({r2(val)} if val < px else set()), reverse=True)
    res = sorted({x["p"] for x in lq_hi if x["p"] > px} | {z["lo"] for z in blocks if z["t"] == "s" and z["lo"] > px} | ({r2(vah)} if vah > px else set()))
    def pick(levels):
        out = []
        for p in levels:
            if not out or abs(p - out[-1]) / p > .0015:
                out.append(p)
        return out[:2]
    sup, res = pick(sup), pick(res)
    zone, rr, risk = None, None, None
    side = "b" if bias != "bearish" else "s"
    cand = [z for z in blocks if z["t"] == side and ((z["hi"] <= px * 1.002) if side == "b" else (z["lo"] >= px * .998))]
    if cand:
        z = max(cand, key=lambda z: z["hi"]) if side == "b" else min(cand, key=lambda z: z["lo"])
        zone = [z["lo"], z["hi"]]
        entry = (z["lo"] + z["hi"]) / 2
        atr_now = float(a[-1])
        if side == "b":
            stop = z["lo"] - max(.25 * atr_now, .0015 * px)
            tgt = next((p for p in res if p > entry), None)
            if tgt and entry > stop:
                rr, risk = (tgt - entry) / (entry - stop), (entry - stop) / entry * 100
        else:
            stop = z["hi"] + max(.25 * atr_now, .0015 * px)
            tgt = next((p for p in sorted(sup, reverse=True) if p < entry), None)
            if tgt and stop > entry:
                rr, risk = (entry - tgt) / (stop - entry), (stop - entry) / entry * 100
    bars = [[int(di[i]), int(hm[i]), r2(o[i]), r2(h[i]), r2(l[i]), r2(c[i]), int(v[i])] for i in range(len(df))]
    return {"d": str(days[-1]), "days": [str(d) for d in days], "px": r2(px), "chg": r2(chg), "o": r2(o[last][0]), "h": r2(ho.max()),
            "l": r2(lo_.min()), "vwap": r2(vwap), "poc": r2(poc), "vah": r2(vah), "val": r2(val), "delta": int(delta), "dr": r2(dr * 100),
            "rv": r2(rv), "score": score, "net": r2(net), "bias": bias, "zone": zone, "sup": sup, "res": res, "rr": r2(rr), "risk": r2(risk),
            "blocks": blocks, "lqh": lq_hi, "lql": lq_lo, "atr": r2(a[-1]), "bars": bars, "agg": bool(agg)}


def main():
    import yfinance as yf
    LIMIT = int(os.environ.get("LIMIT", "0") or 0)
    CH = int(os.environ.get("CHUNK", "40") or 40)
    os.makedirs(OUT, exist_ok=True)
    syms = [r["symbol"] for r in csv.DictReader(open("data/universe.csv", newline=""))]
    if LIMIT:
        syms = syms[:LIMIT]
    ind = {}
    if os.path.exists("data/industry.csv"):
        for r in csv.DictReader(open("data/industry.csv", newline="")):
            ind[r["symbol"]] = r
    log = [f"Run (UTC): {datetime.datetime.utcnow():%Y-%m-%d %H:%M}"]
    rank, ok, bad = [], 0, []
    for k in range(0, len(syms), CH):
        part = syms[k:k + CH]
        try:
            raw = yf.download([s + ".NS" for s in part], period="7d", interval="5m", group_by="ticker",
                              threads=True, progress=False, auto_adjust=False)
        except Exception as e:
            log.append(f"chunk {k}: {e!r}"[:200]); bad += part; continue
        for s in part:
            try:
                d = raw[s + ".NS"] if len(part) > 1 else raw
                d = d.dropna(how="all")
                if d.index.tz is not None:
                    d.index = d.index.tz_convert("Asia/Kolkata")
                res = analyse(d)
                if not res:
                    bad.append(s); continue
                res["s"] = s
                json.dump(res, open(f"{OUT}/{s}.json", "w"), separators=(",", ":"))
                i = ind.get(s, {})
                rank.append({"s": s, "px": res["px"], "chg": res["chg"], "score": res["score"], "bias": res["bias"], "net": res["net"],
                             "zone": res["zone"], "rr": res["rr"], "vwap": res["vwap"], "dr": res["dr"], "rv": res["rv"],
                             "m": i.get("macro", ""), "sec": i.get("sector", "")})
                ok += 1
            except Exception as e:
                bad.append(s)
        time.sleep(2)
    if rank:
        last = max(json.load(open(f"{OUT}/{r['s']}.json"))["d"] for r in rank[:5])
        json.dump({"generated": datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M"), "last_date": last, "stocks": rank},
                  open("data/orderflow.json", "w"), separators=(",", ":"))
    log.append(f"Analysed {ok} of {len(syms)}; no data / failed: {len(bad)} {bad[:25]}")
    open("data/orderflow_log.txt", "w").write("\n".join(log) + "\n")
    print("\n".join(log))


if __name__ == "__main__":
    main()

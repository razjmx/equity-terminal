import json
import math
import os
import traceback
from collections import Counter

import numpy as np
import pandas as pd

RF = 0.072            # annual risk-free rate for Sharpe, Sortino and alpha
TD = 252              # trading days per year
CR = 1e7
CHECK = ["TCS", "HINDUNILVR", "RELIANCE", "MARUTI", "TITAN", "HDFCBANK"]


def num(x, n=2):
    if x is None:
        return None
    try:
        x = float(x)
    except Exception:
        return None
    return round(x, n) if math.isfinite(x) else None


def pct(x, n=1):
    return None if x is None else num(x * 100, n)


def load(sym):
    p = f"data/prices/{sym}.csv"
    if not os.path.exists(p):
        return None
    d = pd.read_csv(p, parse_dates=["Date"]).dropna(subset=["Close"])
    d = d[d["Close"] > 0]
    if d.empty:
        return None
    return d.set_index("Date").sort_index()


def ret(c, n):
    return c.iloc[-1] / c.iloc[-1 - n] - 1 if len(c) > n else None


def weekly(c):
    return c.resample("W-FRI").last().dropna()


def mdd(s):
    return float((s / s.cummax() - 1).min())


def beta_stats(c, mw):
    if mw is None:
        return None
    r = pd.concat([weekly(c).pct_change(), mw.pct_change()], axis=1, join="inner").dropna().tail(156)
    if len(r) < 60:
        return None
    r.columns = ["s", "m"]
    var = r["m"].var()
    if not var:
        return None
    b = r["s"].cov(r["m"]) / var
    corr = r["s"].corr(r["m"])
    rfw = RF / 52
    alpha = ((r["s"] - rfw).mean() - b * (r["m"] - rfw).mean()) * 52
    return {"raw": num(b), "adjusted": num(0.67 * b + 0.33), "weeks": int(len(r)),
            "correlation": num(corr), "r_squared": num(corr ** 2), "alpha_pct": pct(alpha)}


def analyse(sym, d, mc, mw, mkt_last):
    c = d["Close"]
    n = len(c)
    last = c.iloc[-1]
    flags = []
    if n < 250:
        flags.append("short history: risk and trend figures use fewer than 250 days")
    if mkt_last is not None and (mkt_last - c.index[-1]).days > 7:
        flags.append("stale: last price is more than 7 days old")
    r = c.pct_change().dropna()
    r3 = r.tail(756)
    if len(r3) and r3.abs().max() > 0.35:
        flags.append(f"large one-day move ({r3.abs().max() * 100:.0f}% on {r3.abs().idxmax().date()}): "
                     f"check for split, bonus or demerger")

    # returns
    ytd = None
    prev = c[c.index < pd.Timestamp(year=c.index[-1].year, month=1, day=1)]
    if len(prev):
        ytd = last / prev.iloc[-1] - 1
    r756 = ret(c, 756)
    returns = {"1m": pct(ret(c, 21)), "3m": pct(ret(c, 63)), "6m": pct(ret(c, 126)),
               "1y": pct(ret(c, 252)),
               "3y_cagr": pct((1 + r756) ** (1 / 3) - 1) if r756 is not None and r756 > -1 else None,
               "ytd": pct(ytd)}
    rel = {}
    for k, nn in (("3m", 63), ("6m", 126), ("1y", 252)):
        a = ret(c, nn)
        b = ret(mc, nn) if mc is not None else None
        rel[k] = pct(a - b) if a is not None and b is not None else None

    # 52-week range
    w = c.tail(252)
    hi, lo = w.max(), w.min()
    rng = {"high_52w": num(hi), "low_52w": num(lo), "pct_from_high": pct(last / hi - 1),
           "pct_above_low": pct(last / lo - 1),
           "high_date": str(w.idxmax().date()), "low_date": str(w.idxmin().date())}

    # moving averages and trend
    ma = {}
    for k in (20, 50, 100, 200):
        ma[f"dma{k}"] = num(c.tail(k).mean()) if n >= k else None
        ma[f"pct_vs_dma{k}"] = pct(last / c.tail(k).mean() - 1) if n >= k else None
    s50, s200 = c.rolling(50).mean(), c.rolling(200).mean()
    cross = "none"
    if n >= 221:
        now, then = s50.iloc[-1] > s200.iloc[-1], s50.iloc[-21] > s200.iloc[-21]
        if now and not then:
            cross = "golden cross in last 20 days"
        elif then and not now:
            cross = "death cross in last 20 days"
    trend = {"above_dma200": bool(last > s200.iloc[-1]) if n >= 200 else None,
             "above_dma50": bool(last > s50.iloc[-1]) if n >= 50 else None,
             "dma50_above_dma200": bool(s50.iloc[-1] > s200.iloc[-1]) if n >= 200 else None,
             "cross": cross}

    # momentum
    dd_ = c.diff()
    au = dd_.clip(lower=0).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean().iloc[-1]
    ad = (-dd_.clip(upper=0)).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean().iloc[-1]
    if ad:
        rsi = 100 - 100 / (1 + au / ad)
    else:
        rsi = 100.0 if au > 0 else None
    macd = c.ewm(span=12, adjust=False).mean() - c.ewm(span=26, adjust=False).mean()
    sig = macd.ewm(span=9, adjust=False).mean()
    m20, s20 = c.rolling(20).mean(), c.rolling(20).std()
    pb = None
    if n >= 20 and s20.iloc[-1]:
        pb = (last - (m20.iloc[-1] - 2 * s20.iloc[-1])) / (4 * s20.iloc[-1])
    pc = c.shift()
    tr = pd.concat([d["High"] - d["Low"], (d["High"] - pc).abs(), (d["Low"] - pc).abs()],
                   axis=1).max(axis=1)
    atr = tr.ewm(alpha=1 / 14, adjust=False, min_periods=14).mean().iloc[-1]
    mom = {"rsi14": num(rsi, 1), "macd_pct": pct(macd.iloc[-1] / last, 2),
           "macd_signal_pct": pct(sig.iloc[-1] / last, 2),
           "macd_hist_pct": pct((macd.iloc[-1] - sig.iloc[-1]) / last, 2),
           "bollinger_pctb": num(pb), "atr_pct": pct(atr / last, 2)}

    # risk
    r1 = r.tail(252)
    risk = {"volatility_1y_pct": None, "downside_deviation_pct": None, "max_drawdown_1y_pct": None,
            "max_drawdown_all_pct": pct(mdd(c)), "var95_1d_pct": None, "cvar95_1d_pct": None,
            "sharpe_1y": None, "sortino_1y": None}
    if len(r1) >= 60:
        ann = r1.mean() * TD
        vol = r1.std() * math.sqrt(TD)
        dev = math.sqrt((np.minimum(r1 - RF / TD, 0) ** 2).mean()) * math.sqrt(TD)
        v5 = r1.quantile(0.05)
        risk.update({"volatility_1y_pct": pct(vol), "downside_deviation_pct": pct(dev),
                     "max_drawdown_1y_pct": pct(mdd(c.tail(252))),
                     "var95_1d_pct": pct(v5, 2), "cvar95_1d_pct": pct(r1[r1 <= v5].mean(), 2),
                     "sharpe_1y": num((ann - RF) / vol) if vol else None,
                     "sortino_1y": num((ann - RF) / dev) if dev else None})

    val = (d["Close"] * d["Volume"]).tail(63).mean() / CR
    if val < 1:
        flags.append(f"low liquidity: average daily traded value Rs {val:.2f} cr")

    return {"symbol": sym, "as_of": str(c.index[-1].date()), "rows": int(n), "price": num(last),
            "returns_pct": returns, "relative_strength_pp": rel, "range": rng,
            "moving_averages": ma, "trend": trend, "momentum": mom, "risk": risk,
            "beta": beta_stats(c, mw),
            "liquidity": {"avg_daily_value_3m_cr": num(val)}, "flags": flags}


def market_summary(d):
    if d is None:
        return None
    c = d["Close"]
    w = c.tail(252)
    r = c.pct_change().dropna().tail(252)
    return {"as_of": str(c.index[-1].date()), "level": num(c.iloc[-1]),
            "returns_pct": {"1m": pct(ret(c, 21)), "3m": pct(ret(c, 63)),
                            "6m": pct(ret(c, 126)), "1y": pct(ret(c, 252))},
            "volatility_1y_pct": pct(r.std() * math.sqrt(TD)),
            "max_drawdown_1y_pct": pct(mdd(w)),
            "pct_from_52w_high": pct(c.iloc[-1] / w.max() - 1)}


def main():
    uni = pd.read_csv("data/universe.csv")
    uni = uni[~uni["symbol"].str.startswith("DUMMY")]
    os.makedirs("data/risk", exist_ok=True)
    m500, m50 = load("NIFTY500"), load("NIFTY50")
    mc = m500["Close"] if m500 is not None else None
    mw = weekly(mc) if mc is not None else None
    mkt_last = mc.index[-1] if mc is not None else None

    data, results, errors = {}, [], []
    for r in uni.itertuples():
        d = load(r.symbol)
        if d is None:
            errors.append(f"{r.symbol}: no price file")
            continue
        data[r.symbol] = d
        try:
            res = analyse(r.symbol, d, mc, mw, mkt_last)
        except Exception as e:
            errors.append(f"{r.symbol}: {str(e)[:150]}")
            continue
        json.dump(res, open(f"data/risk/{r.symbol}.json", "w"), indent=1)
        results.append(res)

    rows = [{"symbol": x["symbol"], "price": x["price"], "as_of": x["as_of"], "rows": x["rows"],
             "ret_1m": x["returns_pct"]["1m"], "ret_3m": x["returns_pct"]["3m"],
             "ret_6m": x["returns_pct"]["6m"], "ret_1y": x["returns_pct"]["1y"],
             "ret_3y_cagr": x["returns_pct"]["3y_cagr"], "ret_ytd": x["returns_pct"]["ytd"],
             "rs_6m_pp": x["relative_strength_pp"]["6m"], "rs_1y_pp": x["relative_strength_pp"]["1y"],
             "pct_from_high": x["range"]["pct_from_high"], "rsi14": x["momentum"]["rsi14"],
             "above_dma200": x["trend"]["above_dma200"], "cross": x["trend"]["cross"],
             "beta_adj": (x["beta"] or {}).get("adjusted"), "alpha_pct": (x["beta"] or {}).get("alpha_pct"),
             "vol_1y": x["risk"]["volatility_1y_pct"], "maxdd_1y": x["risk"]["max_drawdown_1y_pct"],
             "sharpe_1y": x["risk"]["sharpe_1y"],
             "traded_cr": x["liquidity"]["avg_daily_value_3m_cr"],
             "flags": "; ".join(x["flags"])} for x in results]
    pd.DataFrame(rows).to_csv("data/risk_summary.csv", index=False)
    open("data/risk_errors.txt", "w").write("\n".join(errors) if errors else "none")

    # breadth history: share of stocks above their own moving averages, at 52-week highs and lows
    wide = pd.concat({s: d["Close"] for s, d in data.items() if len(d) >= 60}, axis=1)
    wide = wide.sort_index().ffill(limit=5)
    ma200, ma50 = wide.rolling(200).mean(), wide.rolling(50).mean()
    hi = wide.rolling(252, min_periods=200).max()
    lo = wide.rolling(252, min_periods=200).min()
    v200, v50, vh = ma200.notna(), ma50.notna(), hi.notna()
    b = pd.DataFrame({
        "pct_above_200dma": ((wide > ma200) & v200).sum(axis=1) / v200.sum(axis=1) * 100,
        "pct_above_50dma": ((wide > ma50) & v50).sum(axis=1) / v50.sum(axis=1) * 100,
        "pct_new_52w_high": ((wide >= hi) & vh).sum(axis=1) / vh.sum(axis=1) * 100,
        "pct_new_52w_low": ((wide <= lo) & vh).sum(axis=1) / vh.sum(axis=1) * 100,
        "stocks": wide.notna().sum(axis=1)})
    b = b.replace([np.inf, -np.inf], np.nan).dropna().tail(756).round(2)
    b.index.name = "Date"
    b.to_csv("data/breadth_history.csv")
    latest = b.iloc[-1].to_dict() if len(b) else {}
    peak200 = float(b["pct_above_200dma"].max()) if len(b) else None
    low200 = float(b["pct_above_200dma"].min()) if len(b) else None
    json.dump({"as_of": str(b.index[-1].date()) if len(b) else None,
               "nifty50": market_summary(m50), "nifty500": market_summary(m500),
               "breadth_latest": latest}, open("data/market.json", "w"), indent=1)

    # review file
    flagc = Counter(f.split(":")[0].split(" (")[0] for x in results for f in x["flags"])
    betas = pd.Series([x["beta"]["adjusted"] for x in results if x["beta"]], dtype=float)
    vols = pd.Series([x["risk"]["volatility_1y_pct"] for x in results
                      if x["risk"]["volatility_1y_pct"] is not None], dtype=float)
    full = [x for x in results if x["rows"] >= 250 and x["returns_pct"]["1y"] is not None]
    top = sorted(full, key=lambda x: -x["returns_pct"]["1y"])[:10]
    bot = sorted(full, key=lambda x: x["returns_pct"]["1y"])[:10]
    big = [x["symbol"] for x in results if any(f.startswith("large one-day move") for f in x["flags"])]
    stale = [x["symbol"] for x in results if any(f.startswith("stale") for f in x["flags"])]
    above = [x["trend"]["above_dma200"] for x in results if x["trend"]["above_dma200"] is not None]
    review = [
        f"Stocks analysed: {len(results)} | errors: {len(errors)} | benchmark Nifty 500: {mc is not None}",
        f"Flag counts: {dict(flagc)}",
        f"Beta (adjusted): median {num(betas.median()) if len(betas) else None} | "
        f"above 1.2: {int((betas > 1.2).sum())} | below 0.7: {int((betas < 0.7).sum())} | n = {len(betas)}",
        f"1Y volatility %: median {num(vols.median(), 1) if len(vols) else None} | "
        f"25th {num(vols.quantile(0.25), 1) if len(vols) else None} | 75th {num(vols.quantile(0.75), 1) if len(vols) else None}",
        f"Above own 200-DMA now: {sum(above)} of {len(above)}",
        f"Breadth latest: {latest} | 200-DMA share over the 3-year series: min {num(low200, 1)}, max {num(peak200, 1)}",
        f"Nifty 500: {market_summary(m500)}",
        f"Nifty 50: {market_summary(m50)}",
        f"Large one-day move flags ({len(big)}): {big}",
        f"Stale ({len(stale)}): {stale}",
        f"Top 10 by 1Y price return [symbol, %]: {[(x['symbol'], x['returns_pct']['1y']) for x in top]}",
        f"Bottom 10 by 1Y price return: {[(x['symbol'], x['returns_pct']['1y']) for x in bot]}",
        "Note: returns are price returns and exclude dividends.",
    ]
    open("data/risk_review.txt", "w").write("\n".join(review))

    by = {x["symbol"]: x for x in results}
    out = []
    for s in CHECK:
        x = by.get(s)
        if not x:
            out.append(f"=== {s}: not computed ===\n")
            continue
        out.append(f"=== {s} | as of {x['as_of']} | price {x['price']} | rows {x['rows']} ===")
        out.append(f"Flags: {x['flags']}")
        for k in ("returns_pct", "relative_strength_pp", "range", "moving_averages",
                  "trend", "momentum", "risk", "beta", "liquidity"):
            out.append(f"{k}: {x[k]}")
        out.append("")
    open("data/risk_check.txt", "w").write("\n".join(out))
    print("done:", len(results), "stocks")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        open("data/risk_errors.txt", "w").write("SCRIPT CRASHED\n" + traceback.format_exc())
        print("crashed")

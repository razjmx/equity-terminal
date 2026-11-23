"""Market health: breadth, moving averages, highs/lows, momentum, stages, industries, size and style.
Reads : data/universe.csv, data/prices/SYM.csv (Date, Close, optional Volume), data/metrics/SYM.json (market cap)
Writes: data/market_health.json, data/market_health_review.txt, data/market_health_errors.txt
Definitions (all from our own price files, not official index data):
  advance / decline      close up / down versus previous close
  above N EMA            close above the N-day exponential moving average
  new 52-week high / low close is the highest / lowest close of the last 252 trading days
  stage 1..4             Weinstein-style using the 150-day average and its 20-day slope
                         stage 2 = above rising average, stage 4 = below falling average,
                         stage 1 = below a flat or rising average, stage 3 = above a flat or falling average
  stock in play          above its 50-day average and up 10% or more over 21 trading days
  industry in play       at least 2 stocks and at least 15% of its stocks in play (industries with 3+ stocks)
  industry in uptrend    half or more of its stocks above the 200-day EMA
  size groups            by current market cap rank: large 1-100, mid 101-250, small 251+
"""
import os, json, glob, datetime, traceback
import numpy as np
import pandas as pd

D = "data"
MAXD = 1300          # trading days kept in the output
INPLAY_RET, INPLAY_SHARE = 0.10, 0.15
errors = []

def read_one(path):
    df = pd.read_csv(path)
    cols = {c.lower().strip(): c for c in df.columns}
    dc = cols.get("date") or cols.get("datetime") or df.columns[0]
    cc = cols.get("close") or cols.get("adj close")
    if cc is None:
        raise ValueError("no close column")
    idx = pd.to_datetime(df[dc], errors="coerce", utc=True).dt.tz_localize(None).dt.normalize()
    c = pd.Series(pd.to_numeric(df[cc], errors="coerce").values, index=idx).dropna()
    c = c[~c.index.duplicated(keep="last")]
    v = None
    if "volume" in cols:
        v = pd.Series(pd.to_numeric(df[cols["volume"]], errors="coerce").values, index=idx)
        v = v[~v.index.duplicated(keep="last")]
    return c, v

def jl(a, nd=2):
    out = []
    for x in a:
        if x is None or (isinstance(x, float) and not np.isfinite(x)) or pd.isna(x):
            out.append(None)
        else:
            out.append(int(x) if nd == 0 else round(float(x), nd))
    return out

def main():
    uni = pd.read_csv(f"{D}/universe.csv")
    uni["symbol"] = uni["symbol"].astype(str)
    industry = dict(zip(uni["symbol"], uni["industry"].fillna("") if "industry" in uni.columns else [""] * len(uni)))
    syms = [s for s in uni["symbol"] if os.path.exists(f"{D}/prices/{s}.csv")]
    close, vol = {}, {}
    for s in syms:
        try:
            c, v = read_one(f"{D}/prices/{s}.csv")
            if len(c) >= 60:
                close[s] = c
                if v is not None:
                    vol[s] = v
        except Exception as e:
            errors.append(f"{s}: {e!r}")
    if len(close) < 20:
        raise SystemExit("too few price files")
    C = pd.concat(close, axis=1).sort_index()
    C = C[C.notna().sum(axis=1) >= max(20, 0.4 * C.shape[1])]
    has_vol = len(vol) > 0.5 * len(close)
    V = pd.concat(vol, axis=1).reindex(index=C.index, columns=C.columns) if has_vol else None
    cols = list(C.columns)

    # index files (anything in data/prices that is not in the universe)
    extra = {}
    for p in glob.glob(f"{D}/prices/*.csv"):
        n = os.path.basename(p)[:-4]
        if n not in close and n not in set(uni["symbol"]):
            try:
                c, _ = read_one(p)
                if len(c) > 60:
                    extra[n] = c.reindex(C.index).ffill()
            except Exception as e:
                errors.append(f"index {n}: {e!r}")

    # market caps
    mcap = {}
    for s in cols:
        try:
            m = json.load(open(f"{D}/metrics/{s}.json"))
            v = (m.get("valuation") or {}).get("market_cap_cr")
            if v:
                mcap[s] = float(v)
        except Exception:
            pass
    rank = pd.Series(mcap).rank(ascending=False, method="first")
    size = {"large": [s for s in cols if s in rank.index and rank[s] <= 100],
            "mid": [s for s in cols if s in rank.index and 100 < rank[s] <= 250],
            "small": [s for s in cols if s in rank.index and rank[s] > 250]}

    R1 = C / C.shift(1) - 1
    S = {}   # series dict
    S["n"] = C.notna().sum(axis=1)
    S["adv"] = (R1 > 0).sum(axis=1)
    S["dec"] = (R1 < 0).sum(axis=1)
    if has_vol:
        tot = V.where(R1.notna()).sum(axis=1).replace(0, np.nan)
        S["upvol_pct"] = V.where(R1 > 0).sum(axis=1) / tot * 100

    ema = {}
    for sp in (20, 50, 100, 200):
        E = C.ewm(span=sp, adjust=False, min_periods=sp).mean()
        ok = E.notna() & C.notna()
        ema[sp] = (C > E) & ok
        S[f"ab{sp}"] = ema[sp].sum(axis=1)
        S[f"n{sp}"] = ok.sum(axis=1)
    for g, members in size.items():
        if members:
            ok = (C[members].ewm(span=200, adjust=False, min_periods=200).mean().notna()) & C[members].notna()
            S[f"ab200_{g}_pct"] = ema[200][members].sum(axis=1) / ok.sum(axis=1).replace(0, np.nan) * 100

    Hmax = C.rolling(252, min_periods=200).max()
    Hmin = C.rolling(252, min_periods=200).min()
    S["nh"] = ((C >= Hmax) & Hmax.notna()).sum(axis=1)
    S["nl"] = ((C <= Hmin) & Hmin.notna()).sum(axis=1)
    S["n52"] = Hmax.notna().sum(axis=1)
    S["netnh10"] = (S["nh"] - S["nl"]).rolling(10, min_periods=1).sum()

    S["up4"] = (R1 >= 0.04).sum(axis=1)
    S["dn4"] = (R1 <= -0.04).sum(axis=1)
    S["ratio4_10"] = S["up4"].rolling(10).sum() / S["dn4"].rolling(10).sum().replace(0, np.nan)
    for key, lag, thr in (("q25", 63, .25), ("m25", 21, .25), ("m50", 21, .50), ("d13", 34, .13)):
        Rk = C / C.shift(lag) - 1
        S[f"{key}_up"] = (Rk >= thr).sum(axis=1)
        S[f"{key}_dn"] = (Rk <= -thr).sum(axis=1)

    M150 = C.rolling(150, min_periods=150).mean()
    slope = M150 / M150.shift(20) - 1
    okm = M150.notna() & C.notna() & slope.notna()
    S["st1"] = ((C < M150) & (slope >= 0) & okm).sum(axis=1)
    S["st2"] = ((C > M150) & (slope > 0) & okm).sum(axis=1)
    S["st3"] = ((C > M150) & (slope <= 0) & okm).sum(axis=1)
    S["st4"] = ((C < M150) & (slope < 0) & okm).sum(axis=1)

    # industries
    ind = pd.Series({s: industry.get(s, "") for s in cols})
    ind = ind[ind != ""]
    icols = list(ind.index)
    R5, R21, R63, R252 = (C / C.shift(k) - 1 for k in (5, 21, 63, 252))
    sma50 = C.rolling(50, min_periods=50).mean()
    inplay = ((C > sma50) & (R21 >= INPLAY_RET)).astype(int)
    validp = (sma50.notna() & R21.notna()).astype(int)
    ipi = inplay[icols].T.groupby(ind).sum().T
    nin = validp[icols].T.groupby(ind).sum().T
    big = nin.iloc[-1] >= 3
    big_cols = [c for c in nin.columns if big.get(c, False)]
    play = ((ipi[big_cols] >= 2) & (ipi[big_cols] / nin[big_cols].replace(0, np.nan) >= INPLAY_SHARE))
    S["ind_play"] = play.sum(axis=1)
    a200 = ema[200][icols].astype(int).T.groupby(ind).sum().T
    n200 = (ema[200][icols].notna()).astype(int).T.groupby(ind).sum().T
    S["ind_up"] = ((a200[big_cols] / n200[big_cols].replace(0, np.nan)) >= 0.5).sum(axis=1)

    # industry table (latest)
    last = C.index[-1]
    rows = []
    tv = (C * V) if has_vol else None
    tv5 = tv.tail(5).sum() if has_vol else None
    tv20 = tv.tail(20).sum() if has_vol else None
    totv5 = tv5.sum() if has_vol else None
    totv20 = tv20.sum() if has_vol else None
    a200_prev = a200.shift(21) / n200.shift(21).replace(0, np.nan) * 100
    for name in big_cols:
        mem = list(ind[ind == name].index)
        def med(Rk):
            v = Rk.loc[last, mem].dropna() * 100
            return float(v.median()) if len(v) else None
        n = int(nin[name].iloc[-1])
        row = {"industry": name, "stocks": len(mem), "r1w": med(R5), "r1m": med(R21), "r3m": med(R63), "r1y": med(R252),
               "ab50": float(ema[50].loc[last, mem].sum() / max(1, (C.loc[last, mem].notna()).sum()) * 100),
               "ab200": float(a200[name].iloc[-1] / max(1, n200[name].iloc[-1]) * 100),
               "ab200_chg": None, "play": int(ipi[name].iloc[-1]), "play_share": float(ipi[name].iloc[-1] / max(1, n) * 100),
               "vshare_1w": None, "vshare_chg": None}
        pv = a200_prev[name].iloc[-1]
        if pd.notna(pv):
            row["ab200_chg"] = row["ab200"] - float(pv)
        if has_vol and totv5 and totv20:
            s5 = float(tv5[mem].sum() / totv5 * 100); s20 = float(tv20[mem].sum() / totv20 * 100)
            row["vshare_1w"] = s5; row["vshare_chg"] = s5 - s20
        rows.append(row)
    rows.sort(key=lambda r: -(r["r1m"] if r["r1m"] is not None else -1e9))

    # indices (real index files if present, else proxies)
    idx_cards = []
    for n, c in list(extra.items())[:8]:
        idx_cards.append({"name": n.replace("^", ""), "real": True, "y": c})
    def capw(members):
        w = pd.Series({s: mcap.get(s, np.nan) for s in members}).dropna()
        m = [s for s in members if s in w.index]
        if not m:
            return None
        Rm = R1[m]
        W = pd.DataFrame(np.tile(w[m].values, (len(Rm), 1)), index=Rm.index, columns=m).where(Rm.notna())
        r = (Rm.fillna(0) * W).sum(axis=1) / W.sum(axis=1).replace(0, np.nan)
        return (1 + r.fillna(0)).cumprod() * 100
    def eqw(members):
        if not members:
            return None
        return (1 + R1[members].mean(axis=1).fillna(0)).cumprod() * 100
    proxies = [("Large cap 100 (cap-weighted)", capw(size["large"])), ("Mid cap 150 (equal-weighted)", eqw(size["mid"])),
               ("Small cap 250 (equal-weighted)", eqw(size["small"])), ("All stocks (cap-weighted)", capw(cols)),
               ("All stocks (equal-weighted)", eqw(cols))]
    if not extra:
        for n, y in proxies:
            if y is not None:
                idx_cards.append({"name": n, "real": False, "y": y})
    # size and style ratios
    ratios = []
    L, Mi, Sm, All_c, All_e = (dict(proxies).get(k) for k in [p[0] for p in proxies])
    def ratio(name, a, b):
        if a is not None and b is not None:
            ratios.append({"name": name, "y": (a / b * 100)})
    ratio("Small cap 250 vs Large cap 100", Sm, L)
    ratio("Mid cap 150 vs Large cap 100", Mi, L)
    ratio("Equal-weight vs cap-weight (all)", All_e, All_c)

    keep = C.index[-MAXD:]
    out = {"generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M"), "last_date": str(last.date()),
           "n_stocks": int(C.shape[1]), "has_volume": bool(has_vol), "real_indices": bool(extra),
           "dates": [str(d.date()) for d in keep],
           "series": {k: jl(v.reindex(keep).values, 0 if k in ("n", "adv", "dec", "nh", "nl", "n52", "up4", "dn4") or k[:2] in ("ab", "st", "n2") or k.startswith(("q25", "m25", "m50", "d13", "n1", "n5", "n20")) else 2) for k, v in S.items()},
           "indices": [{"name": c["name"], "real": c["real"], "y": jl(c["y"].reindex(keep).values, 2)} for c in idx_cards],
           "ratios": [{"name": r["name"], "y": jl(r["y"].reindex(keep).values, 2)} for r in ratios],
           "industries": [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in r.items()} for r in rows],
           "size_counts": {k: len(v) for k, v in size.items()}}
    # fix integer-like series that fell through to 2 decimals
    for k in list(out["series"].keys()):
        if k in ("upvol_pct", "ratio4_10", "netnh10") or k.endswith("_pct"):
            out["series"][k] = jl(S[k].reindex(keep).values, 2)
    json.dump(out, open(f"{D}/market_health.json", "w"), separators=(",", ":"))
    rv = [f"Run (UTC): {out['generated']}", f"Last date: {out['last_date']} | stocks: {out['n_stocks']} | volume: {has_vol} | real index files: {list(extra) or 'none (proxies used)'}",
          f"Size groups: {out['size_counts']} (market caps found: {len(mcap)})", f"Days kept: {len(keep)}",
          f"Latest: adv {S['adv'].iloc[-1]} dec {S['dec'].iloc[-1]} | above 200 EMA {S['ab200'].iloc[-1]}/{S['n200'].iloc[-1]} | new highs {S['nh'].iloc[-1]} lows {S['nl'].iloc[-1]}",
          f"Stages: {[int(S[k].iloc[-1]) for k in ('st1','st2','st3','st4')]} | industries in play {int(S['ind_play'].iloc[-1])} in uptrend {int(S['ind_up'].iloc[-1])} of {len(big_cols)}",
          f"File size: {os.path.getsize(f'{D}/market_health.json')//1024} KB"]
    open(f"{D}/market_health_review.txt", "w").write("\n".join(rv))
    print("\n".join(rv))

if __name__ == "__main__":
    try:
        main()
    except SystemExit as e:
        errors.append(str(e))
    except Exception:
        errors.append(traceback.format_exc())
    open(f"{D}/market_health_errors.txt", "w").write("\n".join(errors) or "none")
    if errors and errors != ["none"]:
        print("errors:", errors[:3])

"""Quant models for every stock in data/universe.csv.

Reads   data/universe.csv, data/prices/SYM.csv (+ NIFTY500.csv), data/metrics/SYM.json
Writes  data/quant/SYM.json   volatility models, VaR / ES, trend, PCA loadings for one stock
        data/quant/factors.json  factor scores for all stocks + factor back-tests
        data/quant/pca.json      statistical risk factors for the whole universe
        data/quant/cal.json      the trading-day calendar the chart series are aligned to
        data/quant_log.txt       counts, skipped stocks, run time

All numerical work is in scripts/quantlib.py (tested in tests/test_quant.py).
Env: LIMIT=N (first N symbols) for a quick test.
"""
import csv
import datetime
import json
import math
import os
import sys
import time
import traceback

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import quantlib as Q  # noqa: E402

OUT = "data/quant"
LIMIT = int(os.environ.get("LIMIT", "0") or 0)
MAXN = 1250            # about five years of daily returns
CAL = 180              # days of chart history stored per stock
PCA_T = 750            # about three years for the PCA window
MIN_LIQ_CR = 1.0       # back-test and PCA use stocks trading at least this many crore per day (median, 1 year)


def r(x, n=2):
    return None if x is None or not np.isfinite(x) else round(float(x), n)


def load_prices(sym):
    try:
        df = pd.read_csv(f"data/prices/{sym}.csv")
    except Exception:
        return None
    df.columns = [c.strip().title() for c in df.columns]
    if "Date" not in df or "Close" not in df:
        return None
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df = df.dropna(subset=["Date", "Close"]).drop_duplicates("Date").sort_values("Date")
    for c in ["Open", "High", "Low", "Volume"]:
        if c not in df:
            df[c] = np.nan
    return df.set_index("Date")


def loss_pct(log_loss_pct):
    """Simple-return loss in percent from a positive log loss in percent."""
    return (1 - math.exp(-log_loss_pct / 100)) * 100


def aligned(series_by_date, cal_dates, nd=2):
    return [None if d not in series_by_date or not np.isfinite(series_by_date[d]) else round(float(series_by_date[d]), nd) for d in cal_dates]


# -------------------------------------------------------------------------------------------- volatility
def vol_block(df, cal_dates):
    close = df["Close"].to_numpy(float)
    dates = df.index
    ret, day, dropped = Q.clean_returns(close)
    if len(ret) < 120:
        return None, None
    ret, day = ret[-MAXN:], day[-MAXN:]
    rd = dates[day]
    rp = ret * 100
    n = len(rp)
    out = {"n": int(n), "dropped": int(dropped), "last": str(rd[-1].date())}

    ew = Q.ewma_var(rp, 0.94)
    ew_vol = np.sqrt(ew * Q.TD)                       # annualised %, element t is the vol for rp[t]
    real = lambda k: float(np.std(rp[-k:], ddof=1) * math.sqrt(Q.TD)) if n >= k else None
    now = {"ewma": r(ew_vol[n]), "real21": r(real(21)), "real63": r(real(63)), "real252": r(real(252))}
    hh = df["High"].to_numpy(float); ll = df["Low"].to_numpy(float)
    ok = np.isfinite(hh) & np.isfinite(ll) & (ll > 0) & (hh >= ll)
    if ok[-21:].all():
        now["parkinson21"] = r(math.sqrt(np.mean(np.log(hh[-21:] / ll[-21:]) ** 2) / (4 * math.log(2)) * Q.TD) * 100)
    out["now"] = now

    series = {"ewma": pd.Series(ew_vol[:n], index=rd)}
    s21 = pd.Series(rp, index=rd).rolling(21).std() * math.sqrt(Q.TD)
    series["real21"] = s21

    if n < 300:
        out["model"] = None
        out["note"] = "Fewer than 300 daily returns: GARCH is not fitted, EWMA and realised volatility only."
        return out, {k: v for k, v in series.items()}

    m, allm = Q.best_garch(rp)
    if m is None:
        out["model"] = None
        out["note"] = "GARCH did not converge."
        return out, series
    s2 = Q.garch_var(rp, m["omega"], m["alpha"], m["gamma"], m["beta"], m["v0"])
    g_vol = np.sqrt(s2 * Q.TD)
    series["garch"] = pd.Series(g_vol[:n], index=rd)
    now["garch"] = r(g_vol[n])
    now["pct_rank"] = r(float((g_vol[:n] <= g_vol[n]).mean() * 100), 0)

    fc = Q.garch_forecast(m, s2[n], horizons=(1, 5, 10, 21))
    out["model"] = {"name": m["name"], "omega": r(m["omega"], 5), "alpha": r(m["alpha"], 4), "beta": r(m["beta"], 4),
                    "gamma": r(m["gamma"], 4), "nu": r(m["nu"], 2), "persistence": r(m["persistence"], 4),
                    "half_life": r(fc["half_life_days"], 1), "long_run_vol": r(fc["long_run_vol_ann"], 1),
                    "converged": m["converged"],
                    "bic": {k: (None if v is None else r(v["bic"], 1)) for k, v in allm.items()}}
    out["fc"] = {"h": [1, 5, 10, 21],
                 "vol": [r(fc["cum_vol"][h] * math.sqrt(Q.TD / h), 1) for h in (1, 5, 10, 21)],
                 "path": [r(x, 1) for x in fc["daily_vol_ann"]]}

    # VaR and ES, 1-day and 10-day, two methods
    z = rp[50:] / np.sqrt(s2[50:n])
    z = (z - z.mean()) / z.std()                        # standardised residual pool
    sig1 = math.sqrt(s2[n])
    var = {}
    for al in (0.05, 0.01):
        key = str(int(round((1 - al) * 100)))
        v_t, e_t = Q.t_var_es(sig1, m["nu"], al)
        q = float(np.quantile(z, al))
        v_f = -q * sig1
        e_f = -float(z[z <= q].mean()) * sig1
        p_t = Q.simulate_paths(m, s2[n], None, 10, 20000, seed=11)
        p_f = Q.simulate_paths(m, s2[n], z, 10, 20000, seed=13)
        def tail(p):
            qq = float(np.quantile(p, al))
            return loss_pct(-qq), loss_pct(-float(p[p <= qq].mean()))
        v10t, e10t = tail(p_t); v10f, e10f = tail(p_f)
        var[key] = {"1d": {"t": r(loss_pct(v_t), 2), "fhs": r(loss_pct(v_f), 2),
                           "es_t": r(loss_pct(e_t), 2), "es_fhs": r(loss_pct(e_f), 2)},
                    "10d": {"t": r(v10t, 2), "fhs": r(v10f, 2), "es_t": r(e10t, 2), "es_fhs": r(e10f, 2)}}
    out["var"] = var
    out["bt"] = Q.var_backtest(rp, m["name"].startswith("GJR"), 500)
    return out, series


# -------------------------------------------------------------------------------------------- trend
def trend_block(df, cal_dates):
    close = df["Close"].to_numpy(float)
    close = close[np.isfinite(close) & (close > 0)][-1000:]
    idx = df["Close"].dropna()
    idx = idx[idx > 0].index[-1000:]
    if len(close) < 260:
        return None, None
    lp = np.log(close)
    k60, s60 = Q.kalman_trend(lp, 60)
    k120, s120 = Q.kalman_trend(lp, 120)
    ret = np.diff(lp)
    out = {"kal60": {"slope": r((math.exp(s60[-1] * Q.TD) - 1) * 100, 1), "gap": r((close[-1] / math.exp(k60[-1]) - 1) * 100, 2)},
           "kal120": {"slope": r((math.exp(s120[-1] * Q.TD) - 1) * 100, 1), "gap": r((close[-1] / math.exp(k120[-1]) - 1) * 100, 2)}}
    drift = {}
    for lab, k in (("3m", 63), ("6m", 126), ("12m", 252)):
        if len(ret) >= k:
            mu, t = Q.drift_tstat(ret[-k:])
            drift[lab] = {"mu": r(mu * 100, 1), "t": r(t, 2)}
    out["drift"] = drift
    rr = ret[-750:]
    vr = {}
    for q in (5, 10, 21):
        v = Q.variance_ratio(rr, q)
        if v:
            vr[str(q)] = {"vr": r(v[0], 3), "z": r(v[1], 2)}
    out["vr"] = vr
    zs = [x["z"] for x in vr.values() if x["z"] is not None]
    crit = 2.4                                        # three tests: family-wise 5%
    if zs and max(zs) > crit and min(zs) > -crit:
        out["vr_class"] = "trending"
    elif zs and min(zs) < -crit and max(zs) < crit:
        out["vr_class"] = "mean-reverting"
    else:
        out["vr_class"] = "random-walk"
    out["vr_n"] = int(len(rr))
    ser = {"px": pd.Series(close, index=idx), "k60": pd.Series(np.exp(k60), index=idx), "k120": pd.Series(np.exp(k120), index=idx)}
    return out, ser


# -------------------------------------------------------------------------------------------- main
def main():
    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)
    uni = [row for row in csv.DictReader(open("data/universe.csv", newline="")) if not row["symbol"].startswith("DUMMY")]
    if LIMIT:
        uni = uni[:LIMIT]
    mk = load_prices("NIFTY500")
    if mk is None:
        mk = load_prices("NIFTY50")
    log = []

    # calendar: last CAL+ trading days of the market index
    if mk is None:
        print("no NIFTY500 prices"); sys.exit(1)
    cal_full = mk.index
    cal = cal_full[-CAL:]
    cal_dates = list(cal)
    json.dump({"d": [d.strftime("%Y-%m-%d") for d in cal_dates]}, open(f"{OUT}/cal.json", "w"), separators=(",", ":"))
    full_cal = list(cal_full[-(MAXN + 5):])
    pos = {d: i for i, d in enumerate(full_cal)}
    PX = np.full((len(full_cal), len(uni)), np.nan)
    TV = np.full((len(full_cal), len(uni)), np.nan)          # traded value, crore
    mret = np.diff(np.log(mk["Close"].reindex(full_cal).ffill().to_numpy(float)))

    per = {}                                                 # per-stock results kept for later steps
    done = skipped = 0
    for j, row in enumerate(uni):
        s = row["symbol"]
        try:
            df = load_prices(s)
            if df is None or len(df) < 150:
                log.append(f"{s}: skipped, {0 if df is None else len(df)} price rows")
                skipped += 1
                continue
            ix = [pos[d] for d in df.index if d in pos]
            vals = df.loc[[d for d in df.index if d in pos]]
            PX[ix, j] = vals["Close"].to_numpy(float)
            TV[ix, j] = (vals["Close"] * vals["Volume"]).to_numpy(float) / 1e7
            vb, vser = vol_block(df, cal_dates)
            tb, tser = trend_block(df, cal_dates)
            rec = {"s": s, "asof": str(df.index[-1].date()), "px": r(df["Close"].iloc[-1], 2)}
            if vb is not None:
                rec["vol"] = vb
                if vser:
                    rec["vol"]["ser"] = {k: aligned(v.to_dict(), cal_dates, 1) for k, v in vser.items()}
            if tb is not None:
                rec["trend"] = tb
                rec["trend"]["ser"] = {k: aligned(v.to_dict(), cal_dates, 2) for k, v in tser.items()}
            per[s] = rec
            done += 1
        except Exception as e:
            skipped += 1
            log.append(f"{s}: error {e!r}")
            traceback.print_exc()
        if (j + 1) % 50 == 0:
            print(f"{j + 1}/{len(uni)} stocks, {time.time() - t0:.0f}s", flush=True)

    # ------------------------------------------------------------------ PCA (needs the whole universe)
    pca = pca_block(uni, PX, TV, mret)
    for s, rec in per.items():
        if pca and s in pca["stocks"]:
            rec["pca"] = pca["stocks"][s]
    # ------------------------------------------------------------------ factors
    fac = factor_block(uni, per, PX, TV, mret, full_cal)

    for s, rec in per.items():
        json.dump(rec, open(f"{OUT}/{s}.json", "w"), separators=(",", ":"))
    if pca:
        json.dump({k: v for k, v in pca.items()}, open(f"{OUT}/pca.json", "w"), separators=(",", ":"))
    if fac:
        json.dump(fac, open(f"{OUT}/factors.json", "w"), separators=(",", ":"))

    garch_n = sum(1 for v in per.values() if v.get("vol", {}).get("model"))
    nonconv = [s for s, v in per.items() if v.get("vol", {}).get("model") and not v["vol"]["model"]["converged"]]
    lines = [f"Run (UTC): {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d %H:%M}",
             f"stocks processed {done}, skipped {skipped}, GARCH fitted {garch_n}, not converged {len(nonconv)} {nonconv[:15]}",
             f"PCA: {pca['n_assets'] if pca else 0} stocks, {pca['n_signif'] if pca else 0} significant components" if pca else "PCA: not run",
             f"factors: {len(fac['stocks']) if fac else 0} stocks",
             f"time {time.time() - t0:.0f}s"] + log[:60]
    open("data/quant_log.txt", "w").write("\n".join(lines))
    print("\n".join(lines[:5]))


# -------------------------------------------------------------------------------------------- PCA
def pca_block(uni, PX, TV, mret):
    T = min(PCA_T, PX.shape[0] - 1)
    lp = np.log(PX[-(T + 1):])
    R = np.diff(lp, axis=0)
    cover = np.isfinite(R).mean(axis=0)
    liq = np.nanmedian(TV[-252:], axis=0)
    ok = np.where((cover >= 0.98) & (liq >= MIN_LIQ_CR))[0]
    if len(ok) < 60:
        return None
    Rm = np.nan_to_num(R[:, ok], nan=0.0)
    Rm[np.abs(Rm) > 0.25] = 0.0
    w, v, L, C = Q.pca_corr(Rm)
    N = len(ok)
    edge = Q.mp_upper(N, T)
    n_sig = int((w > edge).sum())
    K = max(1, min(n_sig, 10))
    syms = [uni[i]["symbol"] for i in ok]
    inds = [uni[i].get("industry", "") for i in ok]
    L5 = L[:, :5]
    r2 = (L[:, :K] ** 2).sum(axis=1)
    r2_mkt = L[:, 0] ** 2
    # clusters from the non-market loadings (PC2..PC6), Ward linkage, 10 groups
    from scipy.cluster.hierarchy import linkage, fcluster
    X = L[:, 1:6] / np.sqrt(np.maximum(w[1:6], 1e-9))           # unit-variance scores
    cl = fcluster(linkage(X, method="ward"), t=10, criterion="maxclust")
    clusters = []
    for c in sorted(set(cl)):
        ix = np.where(cl == c)[0]
        cnt = {}
        for i in ix:
            cnt[inds[i]] = cnt.get(inds[i], 0) + 1
        top = sorted(cnt.items(), key=lambda kv: -kv[1])
        lab = top[0][0] if top and top[0][1] / len(ix) >= 0.35 else "Mixed"
        if top and lab != "Mixed" and len(top) > 1 and top[1][1] / len(ix) >= 0.2:
            lab = f"{top[0][0]} / {top[1][0]}"
        clusters.append({"id": int(c), "label": lab or "Mixed", "n": int(len(ix)),
                         "mix": [[a, int(b)] for a, b in top[:4]]})
    pcs = []
    for k in range(min(8, N)):
        order = np.argsort(L[:, k])
        def ind_avg(ix_):
            d = {}
            for i in ix_:
                d.setdefault(inds[i], []).append(L[i, k])
            return sorted([(a, float(np.mean(b)), len(b)) for a, b in d.items() if len(b) >= 4], key=lambda t: t[1])
        ia = ind_avg(range(N))
        pcs.append({"k": k + 1, "var_pct": r(w[k] / N * 100, 2), "eig": r(w[k], 2),
                    "pos": [[syms[i], r(L[i, k] / math.sqrt(w[k]) if w[k] > 0 else 0, 3)] for i in order[::-1][:8]],
                    "neg": [[syms[i], r(L[i, k] / math.sqrt(w[k]) if w[k] > 0 else 0, 3)] for i in order[:8]],
                    "ind_pos": [[a, r(b, 3), n] for a, b, n in ia[::-1][:3]],
                    "ind_neg": [[a, r(b, 3), n] for a, b, n in ia[:3]]})
    stocks = {}
    for i, s in enumerate(syms):
        stocks[s] = {"load": [r(x, 3) for x in L5[i]], "r2": r(r2[i], 3), "r2_mkt": r(r2_mkt[i], 3),
                     "cl": int(cl[i]), "K": K}
    return {"asof": str(datetime.date.today()), "n_assets": int(N), "n_obs": int(T), "mp_edge": r(edge, 3),
            "n_signif": n_sig, "eig": [r(x, 3) for x in w[:20]], "pcs": pcs, "clusters": clusters,
            "explained_top": r(float(w[:K].sum() / N * 100), 1), "stocks": stocks,
            "note": "Correlation-matrix PCA of daily log returns; stocks need >=98% of days and median traded value of at least "
                    f"Rs {MIN_LIQ_CR:g} crore. Components above the Marchenko-Pastur edge are treated as signal."}


# -------------------------------------------------------------------------------------------- factors
def num(x):
    try:
        x = float(x)
        return x if math.isfinite(x) else np.nan
    except Exception:
        return np.nan


def factor_block(uni, per, PX, TV, mret, full_cal):
    syms = [u["symbol"] for u in uni]
    N = len(syms)
    ind = [u.get("industry", "") for u in uni]
    idx = [u.get("index", "nifty500") for u in uni]
    raw = {k: np.full(N, np.nan) for k in ["ep", "bp", "eve", "fcfy", "roe", "roce", "margin", "de", "pio", "mom12", "mom6",
                                           "vol1y", "beta", "revg", "nig", "mcap", "rev1m"]}
    for j, s in enumerate(syms):
        try:
            m = json.load(open(f"data/metrics/{s}.json"))
        except Exception:
            m = None
        if m:
            v, rt, g = m.get("valuation") or {}, m.get("ratios") or {}, m.get("growth") or {}
            pe, pb, ev = num(v.get("pe_used")), num(v.get("pb")), num(v.get("ev_ebitda"))
            raw["ep"][j] = 100 / pe if pe > 0 else np.nan
            raw["bp"][j] = 1 / pb if pb > 0 else np.nan
            raw["eve"][j] = 100 / ev if ev > 0 else np.nan
            raw["fcfy"][j] = num(v.get("fcf_yield_pct"))
            raw["roe"][j] = num(rt.get("roe_pct")); raw["roce"][j] = num(rt.get("roce_pct"))
            raw["margin"][j] = num(rt.get("net_margin_pct")); raw["de"][j] = num(rt.get("debt_equity"))
            pio = m.get("piotroski")
            if isinstance(pio, dict):
                pio = pio.get("score", pio.get("total"))
            raw["pio"][j] = num(pio)
            raw["revg"][j] = num(g.get("revenue_cagr_pct")); raw["nig"][j] = num(g.get("net_income_cagr_pct"))
            raw["mcap"][j] = num(v.get("market_cap_cr"))
        p = PX[:, j]
        okp = np.isfinite(p)
        if okp.sum() >= 260:
            pp = p[okp]
            if len(pp) > 253:
                raw["mom12"][j] = pp[-22] / pp[-253] - 1
                raw["rev1m"][j] = pp[-1] / pp[-22] - 1
            if len(pp) > 127:
                raw["mom6"][j] = pp[-22] / pp[-127] - 1
            lr = np.diff(np.log(pp[-253:]))
            lr = lr[np.abs(lr) < 0.25]
            if len(lr) > 200:
                raw["vol1y"][j] = lr.std(ddof=1) * math.sqrt(Q.TD)
            # beta to the market over two years (daily)
            pf = pd.Series(p[-505:]).ffill().to_numpy()
            rs_ = np.diff(np.log(pf)); rm_ = mret[-len(rs_):]
            okb = np.isfinite(rs_) & np.isfinite(rm_) & (np.abs(rs_) < 0.25)
            if okb.sum() > 300:
                raw["beta"][j] = np.cov(rs_[okb], rm_[okb])[0, 1] / np.var(rm_[okb], ddof=1)
    liq = np.nanmedian(TV[-252:], axis=0)

    z = lambda a: Q.zscore(a, ind)
    value = Q.combine([z(raw["ep"]), z(raw["bp"]), z(raw["eve"]), z(raw["fcfy"])], min_n=2)
    quality = Q.combine([z(raw["roe"]), z(raw["roce"]), z(raw["margin"]), z(-raw["de"]), z(raw["pio"])], min_n=2)
    momentum = Q.combine([z(raw["mom12"]), z(raw["mom6"])], min_n=1)
    lowvol = Q.combine([z(-raw["vol1y"]), z(-raw["beta"])], min_n=1)
    growth = Q.combine([z(raw["revg"]), z(raw["nig"])], min_n=1)
    size = Q.zscore(np.log(np.where(raw["mcap"] > 0, raw["mcap"], np.nan)))
    Z = {"value": value, "quality": quality, "momentum": momentum, "lowvol": lowvol, "growth": growth, "size": size}
    PR = {k: Q.pct_rank(v) for k, v in Z.items()}

    stocks = {}
    for j, s in enumerate(syms):
        if not any(np.isfinite(Z[k][j]) for k in Z):
            continue
        stocks[s] = {"i": ind[j], "x": idx[j],
                     "z": {k: r(Z[k][j], 2) for k in Z}, "p": {k: r(PR[k][j], 0) for k in Z},
                     "raw": {"ep": r(raw["ep"][j], 2), "bp": r(raw["bp"][j], 3), "eve": r(raw["eve"][j], 2), "fcfy": r(raw["fcfy"][j], 2),
                             "roe": r(raw["roe"][j], 1), "roce": r(raw["roce"][j], 1), "margin": r(raw["margin"][j], 1),
                             "de": r(raw["de"][j], 2), "pio": r(raw["pio"][j], 0), "mom12": r(raw["mom12"][j] * 100, 1),
                             "mom6": r(raw["mom6"][j] * 100, 1), "vol": r(raw["vol1y"][j] * 100, 1), "beta": r(raw["beta"][j], 2),
                             "revg": r(raw["revg"][j], 1), "nig": r(raw["nig"][j], 1), "mcap": r(raw["mcap"][j], 0)},
                     "liq": r(liq[j], 1)}

    # ---------------- back-test of the price-based factors on liquid stocks
    use = np.where((np.isfinite(PX).sum(axis=0) >= 1000) & (liq >= MIN_LIQ_CR))[0]
    bt = {}
    if len(use) >= 100:
        P = pd.DataFrame(PX[:, use]).ffill(limit=5).to_numpy()
        def f_mom(p):  return p[-22] / p[-253] - 1
        def f_lowvol(p): return -np.nanstd(np.diff(np.log(p[-253:]), axis=0), axis=0)
        def f_rev(p):  return -(p[-1] / p[-22] - 1)
        dates = [d.strftime("%Y-%m-%d") for d in full_cal]
        for key, fn, label in (("momentum", f_mom, "Momentum (12-1 month)"), ("lowvol", f_lowvol, "Low volatility (1-year)"),
                               ("reversal", f_rev, "Short-term reversal (1 month)")):
            res = Q.quantile_backtest(P, fn, rebal=21, lookback_min=253, q=5)
            if len(res["q_ret"]) < 12:
                continue
            qr = res["q_ret"]
            ls = qr[:, -1] - qr[:, 0]
            mu, t = Q.nw_tstat(ls, 3)
            icm, ict = Q.nw_tstat(res["ic"], 3)
            cum = lambda x: np.cumprod(1 + x)
            ann = lambda x: (np.prod(1 + x) ** (12 / len(x)) - 1) * 100
            bt[key] = {"label": label, "periods": int(len(qr)),
                       "q_ann": [r(ann(qr[:, k]), 1) for k in range(5)],
                       "ls_ann": r(ann(ls) if np.all(1 + ls > 0) else mu * 1200, 1), "ls_t": r(t, 2),
                       "ls_hit": r(float((ls > 0).mean() * 100), 0), "ic": r(icm, 3), "ic_t": r(ict, 2),
                       "ls_vol": r(float(ls.std(ddof=1) * math.sqrt(12) * 100), 1),
                       "from": dates[res["t"][0]], "to": dates[min(res["t"][-1] + 21, len(dates) - 1)],
                       "cum": {"d": [dates[min(int(t_) + 21, len(dates) - 1)] for t_ in res["t"]],
                               "q1": [r(x, 4) for x in cum(qr[:, 0])], "q5": [r(x, 4) for x in cum(qr[:, -1])],
                               "ls": [r(x, 4) for x in cum(ls)]}}
    return {"asof": str(full_cal[-1].date()), "n": len(stocks), "bt": bt, "stocks": stocks,
            "bt_universe": int(len(use)),
            "weights": {"value": 25, "quality": 25, "momentum": 25, "lowvol": 25, "growth": 0},
            "note": "Z-scores are winsorised at the 2.5th and 97.5th percentiles and standardised within the NSE industry group "
                    "(universe-wide when the group has fewer than 8 stocks). Fundamental factors use the latest statements, so they "
                    "are not back-tested; only the price-based factors are."}


if __name__ == "__main__":
    main()

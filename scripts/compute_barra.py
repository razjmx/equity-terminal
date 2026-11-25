"""Barra-style multi-factor risk model for the stock universe.

Each day, stock returns are regressed (cap-weighted least squares) on industry dummies plus four style exposures
that can be computed from prices without look-ahead:
    Momentum  = return from 12 months ago to 1 month ago
    Volatility = realised volatility over the previous 60 days
    Size       = log market cap (current, so it is a static exposure)
    Beta       = 252-day sensitivity to the cap-weighted market return, so defensive stocks are not treated like the rest of their industry
The daily regression gives factor returns and stock-specific (residual) returns. The factor covariance matrix is an
exponentially weighted estimate of the factor returns; specific variances come from the residuals, shrunk 20% to the
cross-sectional median. A portfolio's variance is then x'Fx + sum(w^2 * specific variance), with x its factor exposures.

Value, Quality and Growth are left out on purpose: only today's fundamentals are stored, so using them in a regression over
past days would look into the future. The model is checked out of sample: it is fitted on the first part of the window and
its predictions for random portfolios are compared with what those portfolios actually did afterwards.

Writes data/quant/barra.json and data/barra_log.txt. Runs from the repo root.
"""
import csv
import datetime
import json
import math
import os
import sys
import time

import numpy as np
import pandas as pd

OUT = "data/quant"
NS = 4                 # number of style factors
T_WIN = 750            # trading days of factor returns used
HL = 120               # half-life, days, of the exponential weights
MIN_IND = 8            # industries with fewer stocks are merged into "Other"
HOLD = 250             # out-of-sample test length, days
SEED = 7


def load_close(sym):
    try:
        df = pd.read_csv(f"data/prices/{sym}.csv")
    except Exception:
        return None
    df.columns = [c.strip().title() for c in df.columns]
    if "Date" not in df or "Close" not in df:
        return None
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df = df.dropna(subset=["Date", "Close"]).drop_duplicates("Date").sort_values("Date")
    return df.set_index("Date")["Close"]


def zscore(x, w):
    """Cap-weighted mean 0, equal-weighted standard deviation 1, clipped at +-3. NaNs stay NaN."""
    ok = np.isfinite(x)
    if ok.sum() < 20:
        return np.full_like(x, np.nan)
    ww = w[ok] / w[ok].sum()
    m = float((x[ok] * ww).sum())
    s = float(np.std(x[ok] - m))
    z = (x - m) / s if s > 0 else np.zeros_like(x)
    return np.clip(z, -3, 3)


def exposures(R, t, logmc, w, mkt):
    """Style exposures for day t using returns before t. R: (days x stocks) log returns, mkt: market return per day."""
    n = R.shape[1]
    mom = np.full(n, np.nan)
    vol = np.full(n, np.nan)
    beta = np.full(n, np.nan)
    if t >= 252:
        seg = R[t - 252:t - 21]
        cnt = np.isfinite(seg).sum(axis=0)
        mom = np.where(cnt >= 150, np.nansum(seg, axis=0), np.nan)
    if t >= 60:
        seg = R[t - 60:t]
        cnt = np.isfinite(seg).sum(axis=0)
        vol = np.where(cnt >= 40, np.nanstd(seg, axis=0) * math.sqrt(252), np.nan)
    if t >= 252:
        seg = R[t - 252:t]
        m = mkt[t - 252:t]
        m = m - m.mean()
        ok = np.isfinite(seg)
        sx = np.where(ok, seg, 0.0)
        mu = sx.sum(axis=0) / np.maximum(ok.sum(axis=0), 1)
        cov = ((sx - mu) * np.where(ok, m[:, None], 0.0)).sum(axis=0) / np.maximum(ok.sum(axis=0), 1)
        beta = np.where(ok.sum(axis=0) >= 150, cov / max(float(np.var(m)), 1e-12), np.nan)
    return np.vstack([zscore(mom, w), zscore(vol, w), zscore(logmc, w), zscore(beta, w)])


def fit_day(r, Xs, ind, w, nind):
    """Cap-weighted regression of one day's returns on industry dummies and style exposures. Returns (f, residual) or None."""
    ok = np.isfinite(r) & np.isfinite(Xs).all(axis=0) & (ind >= 0)
    if ok.sum() < nind + 20:
        return None
    X = np.zeros((ok.sum(), nind + NS))
    X[np.arange(ok.sum()), ind[ok]] = 1.0
    X[:, nind:] = Xs[:, ok].T
    sw = np.sqrt(w[ok])
    f, *_ = np.linalg.lstsq(X * sw[:, None], r[ok] * sw, rcond=None)
    res = np.full(r.shape, np.nan)
    res[ok] = r[ok] - X @ f
    ws = w[ok]
    ss_tot = float((ws * (r[ok] - np.average(r[ok], weights=ws)) ** 2).sum())
    ss_res = float((ws * res[ok] ** 2).sum())
    return f, res, (1 - ss_res / ss_tot) if ss_tot > 0 else 0.0


def ew_weights(n):
    lam = 0.5 ** (1.0 / HL)
    w = lam ** np.arange(n - 1, -1, -1)
    return w / w.sum()


def build(F_ret, U, ew=None):
    """Factor covariance (annualised) and specific variances (annualised, shrunk) from factor returns and residuals."""
    n = F_ret.shape[0]
    w = ew_weights(n) if ew is None else ew
    mu = (w[:, None] * F_ret).sum(axis=0)
    D = F_ret - mu
    F = (D * w[:, None]).T @ D * 252
    ok = np.isfinite(U)
    ww = np.where(ok, w[:, None], 0.0)
    den = ww.sum(axis=0)
    m = np.where(den > 0, (np.where(ok, U, 0) * ww).sum(axis=0) / np.where(den > 0, den, 1), 0)
    sv = (np.where(ok, (U - m) ** 2, 0) * ww).sum(axis=0) / np.where(den > 0, den, 1) * 252
    med = float(np.nanmedian(sv[den > 0]))
    sv = np.where(den > 0, 0.8 * sv + 0.2 * med, med)
    return F, sv


def pvar(Wt, Xl, F, sv):
    x = Wt @ Xl                                   # portfolios x factors
    return np.einsum("pk,kl,pl->p", x, F, x) + (Wt ** 2) @ sv


def main():
    t0 = time.time()
    uni = [r for r in csv.DictReader(open("data/universe.csv", newline="")) if not r["symbol"].startswith("DUMMY")]
    try:
        fac = json.load(open(f"{OUT}/factors.json"))["stocks"]
    except Exception:
        print("factors.json missing: run compute_quant.py first")
        sys.exit(1)
    try:
        members = set(json.load(open(f"{OUT}/pca.json"))["stocks"].keys())
    except Exception:
        members = set(fac.keys())
    mk = load_close("NIFTY500")
    if mk is None:
        mk = load_close("NIFTY50")
    if mk is None:
        print("no index prices")
        sys.exit(1)
    cal = mk.index[-(T_WIN + 300):]
    syms, inds, mcap = [], [], []
    cols = []
    for row in uni:
        s = row["symbol"]
        if s not in members or s not in fac:
            continue
        c = load_close(s)
        if c is None:
            continue
        c = c.reindex(cal)
        if c.notna().mean() < 0.9:
            continue
        mc = (fac[s].get("raw") or {}).get("mcap")
        syms.append(s)
        inds.append((row.get("industry") or "Other").strip() or "Other")
        mcap.append(mc if mc and mc > 0 else np.nan)
        cols.append(c.ffill().to_numpy(float))
    if len(syms) < 40:
        print("too few stocks")
        sys.exit(1)
    P = np.vstack(cols).T
    R = np.diff(np.log(P), axis=0)
    R = np.clip(R, -0.25, 0.25)
    mcap = np.array(mcap, float)
    mcap[~np.isfinite(mcap)] = np.nanmedian(mcap)
    w = np.sqrt(mcap)
    logmc = np.log(mcap)
    wn = w / w.sum()
    mkt = np.nansum(np.nan_to_num(R) * wn[None, :], axis=1)      # cap-weighted market return of the universe
    # industries
    cnt = {}
    for i in inds:
        cnt[i] = cnt.get(i, 0) + 1
    names = sorted(k for k, v in cnt.items() if v >= MIN_IND and k != "Other")
    if any(v < MIN_IND for v in cnt.values()) or "Other" in cnt:
        names.append("Other")
    idx = {n: i for i, n in enumerate(names)}
    ind = np.array([idx.get(i, idx.get("Other", -1)) for i in inds])
    nind = len(names)
    D = R.shape[0]
    t_start = max(260, D - T_WIN)
    days = list(range(t_start, D))
    f_list, u_list, r2 = [], [], []
    for t in days:
        Xs = exposures(R, t, logmc, w, mkt)
        out = fit_day(R[t], Xs, ind, w, nind)
        if out is None:
            f_list.append(np.full(nind + NS, np.nan))
            u_list.append(np.full(R.shape[1], np.nan))
            continue
        f_list.append(out[0])
        u_list.append(out[1])
        r2.append(out[2])
    Fr = np.array(f_list)
    U = np.array(u_list)
    good = np.isfinite(Fr).all(axis=1)
    Fr, U = Fr[good], U[good]
    n = Fr.shape[0]
    # ---- model on the full window, exposures as of today
    F, sv = build(Fr, U)
    Xnow = exposures(R, D, logmc, w, mkt)
    # ---- out-of-sample check: fit on the early part, test random portfolios on the last HOLD days
    diag = {"portfolios": 0}
    if n > HOLD + 250:
        n1 = n - HOLD
        F1, sv1 = build(Fr[:n1], U[:n1])
        t_split = days[np.where(good)[0][n1 - 1]] + 1
        X1 = exposures(R, t_split, logmc, w, mkt)
        ok = np.isfinite(X1).all(axis=0) & np.isfinite(Xnow).all(axis=0)
        okidx = np.where(ok)[0]
        rng = np.random.default_rng(SEED)
        npf = 300
        k = min(20, len(okidx))
        W = np.zeros((npf, R.shape[1]))
        for p in range(npf):
            pick = rng.choice(okidx, size=k, replace=False)
            W[p, pick] = 1.0 / k
        Xl = np.zeros((R.shape[1], nind + NS))
        Xl[np.arange(R.shape[1]), np.where(ind >= 0, ind, 0)] = 1.0
        Xl[:, nind:] = np.nan_to_num(X1.T)
        Rt = R[days[np.where(good)[0][n1]]:days[np.where(good)[0][-1]] + 1]

        def check(pool, k_, seed):
            rg = np.random.default_rng(seed)
            Wp = np.zeros((npf, R.shape[1]))
            for p in range(npf):
                Wp[p, rg.choice(pool, size=min(k_, len(pool)), replace=False)] = 1.0 / min(k_, len(pool))
            pr = np.sqrt(pvar(Wp, Xl, F1, sv1))
            rl = np.nanstd(np.nan_to_num(Rt) @ Wp.T, axis=0) * math.sqrt(252)
            return pr, rl

        pred, real = check(okidx, k, SEED)
        ratio = real / pred
        beta1 = X1[3]
        qs = np.nanpercentile(beta1[okidx], [25, 75])
        lo_pool, hi_pool = okidx[beta1[okidx] <= qs[0]], okidx[beta1[okidx] >= qs[1]]
        pl, rl_ = check(lo_pool, k, SEED + 1) if len(lo_pool) >= k else (pred, real)
        ph, rh_ = check(hi_pool, k, SEED + 2) if len(hi_pool) >= k else (pred, real)
        diag = {"portfolios": int(npf), "stocks_each": int(k), "test_days": int(Rt.shape[0]),
                "ratio_mean": round(float(np.mean(ratio)), 3), "ratio_median": round(float(np.median(ratio)), 3),
                "corr": round(float(np.corrcoef(pred, real)[0, 1]), 3),
                "ratio_lowbeta": round(float(np.mean(rl_ / pl)), 3), "ratio_highbeta": round(float(np.mean(rh_ / ph)), 3),
                "pred_mean": round(float(pred.mean()) * 100, 1), "real_mean": round(float(real.mean()) * 100, 1)}
    stocks = {}
    for j, s in enumerate(syms):
        x = Xnow[:, j]
        if not np.isfinite(x).all() or ind[j] < 0:
            continue
        stocks[s] = {"i": int(ind[j]), "x": [round(float(v), 3) for v in x], "sv": round(float(sv[j]), 5)}
    out = {"asof": str(mk.index[-1].date()), "n_stocks": len(stocks), "n_days": int(n), "halflife": HL,
           "inds": names, "styles": ["Momentum", "Volatility", "Size", "Beta"],
           "F": [[round(float(v), 6) for v in row] for row in F],
           "fvol": [round(float(math.sqrt(max(F[k, k], 0))) * 100, 2) for k in range(nind + NS)],
           "r2": round(float(np.mean(r2)) * 100, 1) if r2 else None, "diag": diag,
           "stocks": stocks,
           "note": "Cap-weighted daily regressions on industry dummies and three price-based style factors; EWMA factor covariance, "
                   "specific variance shrunk 20% to the median. Value, Quality and Growth are excluded because only current "
                   "fundamentals are stored."}
    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(f"{OUT}/barra.json", "w"), separators=(",", ":"))
    lines = [f"Run (UTC): {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d %H:%M}",
             f"stocks {len(stocks)}, industries {nind}, days {n}, mean daily R2 {out['r2']}%",
             f"out-of-sample check: {diag}", f"time {time.time() - t0:.0f}s"]
    open("data/barra_log.txt", "w").write("\n".join(lines))
    print("\n".join(lines))


if __name__ == "__main__":
    main()

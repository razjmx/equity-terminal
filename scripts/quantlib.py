"""Quant model library for the Equity Terminal.  Pure functions, no file or network access, so every
model can be tested on simulated data with known answers (see tests/test_quant.py).

Models
  volatility   EWMA (RiskMetrics), GARCH(1,1)/GJR-GARCH(1,1) with Student-t errors fitted by maximum likelihood,
               forecasts, VaR and Expected Shortfall (parametric-t and filtered historical simulation),
               out-of-sample VaR back-test with Kupiec and Christoffersen tests
  trend        smooth-trend Kalman filter with a fixed horizon, drift t-statistics, Lo-MacKinlay variance-ratio test
  factors      cross-sectional factor scores (winsorised z-scores, group-neutral), rank information coefficients,
               quantile back-test on price-based factors
  pca          principal components of the correlation matrix with the Marchenko-Pastur noise threshold
  intraday     volume-profile estimation and VWAP / TWAP schedule tracking error
"""
import math
import numpy as np
from scipy import optimize, stats, signal, special

TD = 252


# --------------------------------------------------------------------------------------------- returns
def clean_returns(close, max_abs=0.25):
    """Log returns from a price array. Non-positive prices and moves larger than max_abs (unadjusted splits,
    bad ticks) are removed. Returns (returns, keep_index_into_original_returns, n_dropped)."""
    p = np.asarray(close, float)
    ok = np.isfinite(p) & (p > 0)
    idx = np.where(ok)[0]
    p = p[idx]
    if len(p) < 3:
        return np.array([]), np.array([], int), 0
    r = np.diff(np.log(p))
    day = idx[1:]
    keep = np.abs(r) <= max_abs
    return r[keep], day[keep], int((~keep).sum())


# --------------------------------------------------------------------------------------------- volatility
def ewma_var(r, lam=0.94):
    """RiskMetrics EWMA variance. out[t] is the variance for r[t] (known at t-1); out[n] is the next-day forecast."""
    r = np.asarray(r, float)
    n = len(r)
    v0 = float(np.var(r[: min(n, 30)])) if n else 0.0
    x = (1 - lam) * r ** 2
    y = signal.lfilter([1.0], [1.0, -lam], x, zi=[lam * v0])[0]
    return np.concatenate([[v0], y])


def garch_var(r, omega, alpha, gamma, beta, v0):
    """GJR-GARCH(1,1) conditional variance, vectorised with a linear filter.
    sigma2[t] = omega + (alpha + gamma*1[r[t-1]<0]) r[t-1]^2 + beta sigma2[t-1]; sigma2[0] = v0.
    Returns an array of length n+1: element t is the variance of r[t]; element n is the next-day forecast."""
    r = np.asarray(r, float)
    x = omega + (alpha + gamma * (r < 0)) * r ** 2
    y = signal.lfilter([1.0], [1.0, -beta], x, zi=[beta * v0])[0]
    return np.concatenate([[v0], y])


def _t_loglik(r, s2, nu):
    z2 = r ** 2 / s2
    c = special.gammaln((nu + 1) / 2) - special.gammaln(nu / 2) - 0.5 * math.log(math.pi * (nu - 2))
    return float(np.sum(c - 0.5 * np.log(s2) - (nu + 1) / 2 * np.log1p(z2 / (nu - 2))))


def fit_garch(r_pct, gjr=False, starts=None):
    """Maximum-likelihood fit with Student-t errors. r_pct are returns in percent.
    Returns dict(omega, alpha, gamma, beta, nu, ll, k, persistence, converged) or None."""
    r = np.asarray(r_pct, float)
    n = len(r)
    if n < 300:
        return None
    v0 = float(np.var(r))
    k = 5 if gjr else 4

    def nll(th):
        om, a, b, nu = th[0], th[1], th[2], th[3]
        g = th[4] if gjr else 0.0
        s2 = garch_var(r, om, a, g, b, v0)[:n]
        if not np.all(np.isfinite(s2)) or s2.min() <= 0:
            return 1e12
        return -_t_loglik(r, s2, nu)

    cons = [{"type": "ineq", "fun": lambda th: 0.9998 - th[1] - th[2] - (0.5 * th[4] if gjr else 0.0)}]
    bnds = [(1e-6 * v0, 5 * v0), (0.0, 0.5), (0.0, 0.9998), (2.5, 80.0)] + ([(0.0, 0.5)] if gjr else [])
    starts = starts or [(0.05, 0.90, 8.0, 0.0), (0.10, 0.85, 6.0, 0.05), (0.03, 0.95, 10.0, 0.02), (0.15, 0.70, 5.0, 0.05)]
    best = None
    for a0, b0, nu0, g0 in starts:
        om0 = max(v0 * (1 - a0 - b0 - 0.5 * g0), 1e-5 * v0)
        x0 = [om0, a0, b0, nu0] + ([g0] if gjr else [])
        try:
            res = optimize.minimize(nll, x0, method="SLSQP", bounds=bnds, constraints=cons,
                                    options={"maxiter": 300, "ftol": 1e-10})
        except Exception:
            continue
        if res.fun < 1e11 and (best is None or res.fun < best.fun):
            best = res
    if best is None:
        return None
    th = best.x
    om, a, b, nu = th[0], th[1], th[2], th[3]
    g = th[4] if gjr else 0.0
    pers = a + b + 0.5 * g
    return {"omega": float(om), "alpha": float(a), "gamma": float(g), "beta": float(b), "nu": float(nu),
            "ll": float(-best.fun), "k": k, "persistence": float(pers), "v0": v0,
            "converged": bool(best.success), "bic": float(2 * best.fun + k * math.log(n)),
            "aic": float(2 * best.fun + 2 * k)}


def best_garch(r_pct):
    """Fit GARCH and GJR, keep the lower BIC."""
    a = fit_garch(r_pct, gjr=False)
    b = fit_garch(r_pct, gjr=True)
    cands = [("GARCH(1,1)-t", a), ("GJR-GARCH(1,1)-t", b)]
    cands = [(nm, m) for nm, m in cands if m]
    if not cands:
        return None, None
    nm, m = min(cands, key=lambda z: z[1]["bic"])
    m = dict(m)
    m["name"] = nm
    return m, {"GARCH(1,1)-t": a, "GJR-GARCH(1,1)-t": b}


def garch_forecast(m, s2_next, horizons=(1, 5, 10, 21)):
    """Variance forecast path. s2_next = variance for tomorrow (percent^2).
    Returns dict with per-day vol path (annualised %) and cumulative h-day vol (percent, not annualised)."""
    p = m["persistence"]
    vinf = m["omega"] / max(1 - p, 1e-6)
    hmax = max(horizons)
    path = np.array([vinf + p ** (h - 1) * (s2_next - vinf) for h in range(1, hmax + 1)])
    out = {"daily_vol_ann": np.sqrt(path * TD), "long_run_vol_ann": math.sqrt(vinf * TD)}
    out["cum_vol"] = {h: math.sqrt(path[:h].sum()) for h in horizons}
    out["half_life_days"] = (math.log(0.5) / math.log(p)) if 0 < p < 1 else None
    return out


def t_var_es(sigma, nu, alpha):
    """VaR and ES (as positive losses, same units as sigma) for a zero-mean standardised Student-t return."""
    sc = math.sqrt((nu - 2) / nu)
    ta = stats.t.ppf(alpha, nu)
    var = -ta * sc * sigma
    es = sigma * sc * stats.t.pdf(ta, nu) / alpha * (nu + ta ** 2) / (nu - 1)
    return float(var), float(es)


def simulate_paths(m, s2_next, z_pool, h, n_paths=20000, seed=7):
    """Monte-Carlo h-day cumulative log-return paths from the fitted GARCH. z_pool: standardised residuals to
    bootstrap (filtered historical simulation) or None to draw from the fitted standardised Student-t."""
    rng = np.random.default_rng(seed)
    om, a, g, b, nu = m["omega"], m["alpha"], m["gamma"], m["beta"], m["nu"]
    s2 = np.full(n_paths, s2_next)
    cum = np.zeros(n_paths)
    sc = math.sqrt((nu - 2) / nu)
    for _ in range(h):
        if z_pool is None:
            z = rng.standard_t(nu, n_paths) * sc
        else:
            z = rng.choice(z_pool, n_paths, replace=True)
        r = np.sqrt(s2) * z
        cum += r
        s2 = om + (a + g * (r < 0)) * r ** 2 + b * s2
    return cum   # percent


def kupiec(n_obs, n_exc, p):
    """Kupiec proportion-of-failures test. Returns (LR, p-value)."""
    if n_obs <= 0:
        return None, None
    x, N = n_exc, n_obs
    ph = x / N
    def ll(q):
        q = min(max(q, 1e-12), 1 - 1e-12)
        return (N - x) * math.log(1 - q) + x * math.log(q)
    lr = -2 * (ll(p) - ll(ph))
    return lr, float(1 - stats.chi2.cdf(lr, 1))


def christoffersen_ind(hits):
    """Christoffersen independence test on a 0/1 exception series. Returns (LR, p-value) or (None, None)."""
    h = np.asarray(hits, int)
    if len(h) < 20 or h.sum() < 2:
        return None, None
    a, b = h[:-1], h[1:]
    n00 = int(((a == 0) & (b == 0)).sum()); n01 = int(((a == 0) & (b == 1)).sum())
    n10 = int(((a == 1) & (b == 0)).sum()); n11 = int(((a == 1) & (b == 1)).sum())
    def lg(x):
        return math.log(min(max(x, 1e-12), 1 - 1e-12))
    p01 = n01 / max(n00 + n01, 1); p11 = n11 / max(n10 + n11, 1); p = (n01 + n11) / max(n00 + n01 + n10 + n11, 1)
    ll1 = n00 * lg(1 - p01) + n01 * lg(p01) + n10 * lg(1 - p11) + n11 * lg(p11)
    ll0 = (n00 + n10) * lg(1 - p) + (n01 + n11) * lg(p)
    lr = -2 * (ll0 - ll1)
    return lr, float(1 - stats.chi2.cdf(lr, 1))


def var_backtest(r_pct, model_name_gjr, test_days=500, alphas=(0.05, 0.01)):
    """Out-of-sample VaR back-test: parameters are fitted on everything BEFORE the last test_days returns and then
    held fixed while the conditional variance is updated with the actual returns (so no look-ahead)."""
    r = np.asarray(r_pct, float)
    n = len(r)
    if n < test_days + 400:
        return None
    train = r[: n - test_days]
    m = fit_garch(train, gjr=model_name_gjr)
    if not m:
        return None
    s2 = garch_var(r, m["omega"], m["alpha"], m["gamma"], m["beta"], m["v0"])[:n]
    sig = np.sqrt(s2[n - test_days:])
    act = r[n - test_days:]
    out = {"test_days": test_days}
    for al in alphas:
        sc = math.sqrt((m["nu"] - 2) / m["nu"])
        q = stats.t.ppf(al, m["nu"]) * sc            # negative number
        hits = (act < q * sig).astype(int)
        lr, pv = kupiec(test_days, int(hits.sum()), al)
        _, pi = christoffersen_ind(hits)
        out[f"{int(round((1 - al) * 100))}"] = {"expected": round(al * test_days, 1), "actual": int(hits.sum()),
                                                  "kupiec_p": None if pv is None else round(pv, 3),
                                                  "indep_p": None if pi is None else round(pi, 3)}
    return out


# --------------------------------------------------------------------------------------------- trend
def kalman_llt(y, q_eta, q_zeta, kappa=1e6):
    """Local linear trend Kalman filter on a series y.
        y_t = mu_t + e_t,  mu_{t+1} = mu_t + beta_t + eta_t,  beta_{t+1} = beta_t + zeta_t
    q_eta and q_zeta are variances relative to var(e). Returns filtered mu, beta, Var(beta | data), the concentrated
    log-likelihood and the estimated var(e)."""
    n = len(y)
    mu = np.zeros(n); be = np.zeros(n); pb = np.zeros(n)
    a1, a2 = float(y[0]), 0.0
    p11, p12, p22 = kappa, 0.0, kappa
    sv = 0.0; sl = 0.0; m = 0
    for t in range(n):
        # prediction already applied; update with y[t]
        f = p11 + 1.0
        v = y[t] - a1
        k1, k2 = p11 / f, p12 / f
        a1u, a2u = a1 + k1 * v, a2 + k2 * v
        p11u = p11 - k1 * p11
        p12u = p12 - k1 * p12
        p22u = p22 - k2 * p12
        mu[t], be[t], pb[t] = a1u, a2u, p22u
        if t >= 2:
            sv += v * v / f; sl += math.log(f); m += 1
        # predict t+1
        a1 = a1u + a2u
        a2 = a2u
        p11 = p11u + 2 * p12u + p22u + q_eta
        p12 = p12u + p22u
        p22 = p22u + q_zeta
    s2 = sv / m if m else 1.0
    ll = -0.5 * (m * math.log(max(s2, 1e-300)) + sl)
    return mu, be, pb, ll, s2


def hp_q(cutoff_days):
    """Signal-to-noise ratio of the smooth-trend Kalman filter that matches a Hodrick-Prescott filter whose 50% gain
    cut-off period is cutoff_days: lambda = (T / 2pi)^4, q_zeta = 1 / lambda."""
    return (2 * math.pi / cutoff_days) ** 4


def kalman_trend(y, cutoff_days=60):
    """Smooth-trend Kalman filter (integrated random walk) with the smoothing set by an effective trend horizon, not
    estimated: price is close to a random walk, so letting maximum likelihood choose the smoothing makes the filter
    chase every move and the slope loses meaning. Returns the filtered level and slope (per observation)."""
    y = np.asarray(y, float)
    sc = float(np.std(np.diff(y))) or 1.0
    ys = (y - y[0]) / sc
    mu, be, pb, ll, s2 = kalman_llt(ys, 0.0, hp_q(cutoff_days))
    return mu * sc + y[0], be * sc


def drift_tstat(r, lags=5):
    """Annualised mean log return and its Newey-West t-statistic over the supplied daily returns."""
    r = np.asarray(r, float)
    mu, t = nw_tstat(r, lags)
    return mu * TD, t


def variance_ratio(r, q):
    """Lo-MacKinlay (1988) variance ratio with the heteroskedasticity-robust statistic z* = (VR-1)/sqrt(theta/n),
    using overlapping q-period returns and the unbiased variance estimators. Returns (VR, z*)."""
    r = np.asarray(r, float)
    n = len(r)
    if n < 4 * q:
        return None
    mu = r.mean()
    d = r - mu
    d2 = d ** 2
    s1 = np.sum(d2) / (n - 1)
    rq = np.convolve(r, np.ones(q), mode="valid")
    m = q * (n - q + 1) * (1 - q / n)
    sq = np.sum((rq - q * mu) ** 2) / m
    vr = sq / s1
    theta = 0.0
    den = np.sum(d2) ** 2
    for j in range(1, q):
        delta = n * np.sum(d2[j:] * d2[:-j]) / den
        theta += (2 * (q - j) / q) ** 2 * delta
    z = (vr - 1) / math.sqrt(theta / n)
    return float(vr), float(z)


# --------------------------------------------------------------------------------------------- factors
def winsorize(x, lo=2.5, hi=97.5):
    x = np.asarray(x, float)
    ok = np.isfinite(x)
    if ok.sum() < 5:
        return x
    a, b = np.nanpercentile(x[ok], [lo, hi])
    return np.clip(x, a, b)


def zscore(x, groups=None, min_group=8):
    """Winsorised cross-sectional z-score. If groups is given, stocks in groups with at least min_group valid
    names are standardised within the group (group-neutral), others against the whole universe."""
    x = np.asarray(x, float)
    w = winsorize(x)
    out = np.full(len(x), np.nan)
    ok = np.isfinite(w)
    if ok.sum() < 5:
        return out
    mu, sd = w[ok].mean(), w[ok].std(ddof=0)
    if sd > 0:
        out[ok] = (w[ok] - mu) / sd
    if groups is not None:
        g = np.asarray(groups, object)
        for name in set(g):
            ix = np.where((g == name) & ok)[0]
            if len(ix) >= min_group:
                s = w[ix].std(ddof=0)
                if s > 0:
                    out[ix] = (w[ix] - w[ix].mean()) / s
    return out


def combine(zs, min_n=1):
    """Average of available z-score columns (list of arrays); needs at least min_n components. Re-standardised."""
    Z = np.vstack([np.asarray(z, float) for z in zs])
    cnt = np.isfinite(Z).sum(axis=0)
    with np.errstate(all="ignore"):
        m = np.nanmean(Z, axis=0)
    m[cnt < min_n] = np.nan
    ok = np.isfinite(m)
    if ok.sum() > 5 and m[ok].std() > 0:
        m = (m - m[ok].mean()) / m[ok].std()
    return m


def pct_rank(x):
    x = np.asarray(x, float)
    out = np.full(len(x), np.nan)
    ok = np.isfinite(x)
    if ok.sum():
        r = stats.rankdata(x[ok], method="average")
        out[ok] = (r - 0.5) / ok.sum() * 100
    return out


def rank_ic(factor, fwd):
    """Spearman rank correlation between a factor and forward returns."""
    f, r = np.asarray(factor, float), np.asarray(fwd, float)
    ok = np.isfinite(f) & np.isfinite(r)
    if ok.sum() < 30:
        return np.nan
    return float(stats.spearmanr(f[ok], r[ok])[0])


def nw_tstat(x, lags=3):
    """Mean and Newey-West t-statistic of a series."""
    x = np.asarray(x, float)
    x = x[np.isfinite(x)]
    n = len(x)
    if n < 8:
        return float("nan"), float("nan")
    mu = x.mean(); d = x - mu
    s = np.sum(d * d) / n
    for l in range(1, lags + 1):
        w = 1 - l / (lags + 1)
        s += 2 * w * np.sum(d[l:] * d[:-l]) / n
    se = math.sqrt(max(s, 1e-18) / n)
    return float(mu), float(mu / se)


def quantile_backtest(prices, factor_fn, rebal=21, lookback_min=253, q=5, cost_bps=0.0):
    """Monthly-rebalanced equal-weight quantile portfolios.
    prices: 2-D array (days x stocks) of closes (NaN allowed). factor_fn(prices_upto_t_inclusive) -> factor vector.
    Returns dict(quantile period returns (n_periods x q), long-short series, rank IC series, dates idx)."""
    T, N = prices.shape
    ret = np.full((T, N), np.nan)
    ret[1:] = prices[1:] / prices[:-1] - 1
    rows, ics, tix = [], [], []
    t = lookback_min
    prev_w = None
    while t + rebal < T:
        f = factor_fn(prices[: t + 1])
        fwd = np.nanprod(1 + ret[t + 1: t + 1 + rebal], axis=0) - 1
        # a stock with no return data in the window has product 1; mark it missing
        none = ~np.any(np.isfinite(ret[t + 1: t + 1 + rebal]), axis=0)
        fwd[none] = np.nan
        ok = np.isfinite(f) & np.isfinite(fwd)
        if ok.sum() >= q * 8:
            order = np.argsort(f[ok])
            fok, rok = f[ok][order], fwd[ok][order]
            groups = np.array_split(np.arange(len(order)), q)
            rows.append([float(np.mean(rok[g])) for g in groups])
            ics.append(rank_ic(f, fwd))
            tix.append(t)
        t += rebal
    return {"q_ret": np.array(rows), "ic": np.array(ics), "t": np.array(tix)}


# --------------------------------------------------------------------------------------------- PCA
def mp_upper(n_assets, n_obs):
    """Marchenko-Pastur upper edge for the eigenvalues of a correlation matrix of pure noise."""
    return (1 + math.sqrt(n_assets / n_obs)) ** 2


def pca_corr(R):
    """PCA of the correlation matrix of standardised returns R (T x N). Returns eigenvalues (desc), eigenvectors
    (N x N, columns), loadings (eigvec * sqrt(eigval)) with PC1 sign set so the market loading is positive."""
    R = np.asarray(R, float)
    Z = (R - R.mean(0)) / R.std(0, ddof=1)
    C = np.corrcoef(Z, rowvar=False)
    w, v = np.linalg.eigh(C)
    o = np.argsort(w)[::-1]
    w, v = w[o], v[:, o]
    for k in range(v.shape[1]):               # deterministic sign: largest-magnitude loading positive
        j = np.argmax(np.abs(v[:, k]))
        if v[j, k] < 0:
            v[:, k] = -v[:, k]
    if v[:, 0].sum() < 0:
        v[:, 0] = -v[:, 0]
    return w, v, v * np.sqrt(np.maximum(w, 0)), C


# --------------------------------------------------------------------------------------------- intraday
def day_profiles(vol_by_day):
    """vol_by_day: array (days x buckets) of volume. Keeps days where every bucket traded, returns share matrix."""
    V = np.asarray(vol_by_day, float)
    ok = np.all(V > 0, axis=1) & np.isfinite(V).all(axis=1)
    V = V[ok]
    return V / V.sum(axis=1, keepdims=True)


def estimate_profile(shares, prior, k=5):
    """Average intraday volume profile shrunk towards a universe prior. n days -> weight n/(n+k) on the stock."""
    S = np.asarray(shares, float)
    n = len(S)
    if n == 0:
        return np.asarray(prior, float), 0
    mean = S.mean(axis=0)
    w = n / (n + k)
    p = w * mean + (1 - w) * np.asarray(prior, float)
    return p / p.sum(), n


def schedule_tracking(shares_test, profile_fc, bucket_px, bucket_vol):
    """Tracking error in basis points of a schedule that trades `profile_fc` (VWAP) or uniformly (TWAP) over the
    day, against the day's actual volume-weighted price. bucket_px/bucket_vol: (days x buckets)."""
    n_b = bucket_px.shape[1]
    twap = np.full(n_b, 1.0 / n_b)
    out = {"vwap": [], "twap": []}
    for px, vol in zip(bucket_px, bucket_vol):
        act = (px * vol).sum() / vol.sum()
        out["vwap"].append(((px * profile_fc).sum() / profile_fc.sum() / act - 1) * 1e4)
        out["twap"].append(((px * twap).sum() / twap.sum() / act - 1) * 1e4)
    return {k: (float(np.mean(v)), float(np.std(v)), float(np.sqrt(np.mean(np.square(v))))) for k, v in out.items()}

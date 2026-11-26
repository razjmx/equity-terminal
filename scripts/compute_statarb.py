"""Statistical-arbitrage pair scanner (cointegration, Engle-Granger) for the stock universe.

For every pair of stocks in the same industry the script regresses log price A on log price B, tests whether the
residual (the "spread") is stationary with an augmented Dickey-Fuller test, and measures how fast it reverts (half-life).
Pairs that pass are listed with today's z-score of the spread.

The method is checked honestly. The window is split: pairs are chosen and their hedge ratios fitted on the first part,
then a simple rule (enter at |z| > 2, exit at 0, stop at |z| > 4, 30-day limit, trade on the next close, costs deducted)
is run on the later hold-out part. The same rule is run on random same-industry pairs that were NOT selected, so the
page can show whether choosing pairs by cointegration added anything. With thousands of pairs tested, some pass by
luck; the expected number of lucky passes is reported.

Writes data/quant/statarb.json and data/statarb_log.txt. Runs from the repo root, after compute_quant.py.
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
W = 500            # trading days of prices used
FORM = 350         # formation days (pair selection); the rest is the hold-out
CV5 = -3.34        # Engle-Granger 5% critical value, two series with intercept (MacKinnon)
HL_MIN, HL_MAX = 3.0, 40.0
BETA_MIN, BETA_MAX = 0.2, 5.0
Z_IN, Z_OUT, Z_STOP, MAXD = 2.0, 0.0, 4.0, 30
ZWIN = 60          # days for the rolling mean and sd of the spread
COST = 0.0010      # per leg per side (10 bps): round trip costs 2 * COST of gross exposure
MIN_IND = 4
SEED = 11
JUMP = 0.20       # a one-day move beyond this may be an unadjusted split, bonus or demerger: such stocks are left out
KEEP = 60          # pairs written to the page


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


def ols_pair(ya, yb):
    """log A = alpha + beta log B + e. Returns alpha, beta, residual."""
    xm, ym = yb.mean(), ya.mean()
    vx = ((yb - xm) ** 2).sum()
    if vx <= 0:
        return None
    beta = ((yb - xm) * (ya - ym)).sum() / vx
    alpha = ym - beta * xm
    return alpha, beta, ya - alpha - beta * yb


def adf(e):
    """Augmented Dickey-Fuller with one lag, no constant (residual of a regression with intercept). Returns (t-stat, rho)."""
    de = np.diff(e)
    y = de[1:]
    X = np.column_stack([e[1:-1], de[:-1]])
    XtX = X.T @ X
    try:
        inv = np.linalg.inv(XtX)
    except np.linalg.LinAlgError:
        return None, None
    b = inv @ (X.T @ y)
    res = y - X @ b
    s2 = (res @ res) / max(len(y) - 2, 1)
    se = math.sqrt(max(s2 * inv[0, 0], 1e-300))
    # AR(1) coefficient for the half-life
    e0, e1 = e[:-1], e[1:]
    d = (e0 @ e0)
    rho = (e0 @ e1) / d if d > 0 else 1.0
    return b[0] / se, rho


def halflife(rho):
    if 0 < rho < 1:
        return -math.log(2) / math.log(rho)
    return None


def rolling_z(s):
    """z-score of each day's spread against the mean and sd of the previous ZWIN days (no look-ahead)."""
    n = len(s)
    z = np.full(n, np.nan)
    cs = np.concatenate([[0.0], np.cumsum(s)])
    cs2 = np.concatenate([[0.0], np.cumsum(s * s)])
    for t in range(ZWIN, n):
        a, b = t - ZWIN, t
        m = (cs[b] - cs[a]) / ZWIN
        v = (cs2[b] - cs2[a]) / ZWIN - m * m
        if v > 1e-12:
            z[t] = (s[t] - m) / math.sqrt(v)
    return z


def trade(s, beta, t0):
    """Run the rule on the spread series s from day t0 to the end. Returns a list of net returns on gross exposure."""
    z = rolling_z(s)
    n = len(s)
    out = []
    t = max(t0, ZWIN)
    gross = 1.0 + beta
    while t < n - 2:
        if np.isfinite(z[t]) and abs(z[t]) > Z_IN:
            side = -1.0 if z[t] > 0 else 1.0           # rich spread -> short the spread
            ent = t + 1                                # enter on the next close
            k = ent
            exit_i = None
            while k < n - 1:
                k += 1
                zz = z[k - 1] if np.isfinite(z[k - 1]) else 0.0
                if (side < 0 and zz <= Z_OUT) or (side > 0 and zz >= -Z_OUT) or abs(zz) > Z_STOP or (k - ent) >= MAXD:
                    exit_i = k
                    break
            if exit_i is None:
                break
            pnl = side * (s[exit_i] - s[ent])
            out.append(pnl / gross - 2 * COST)
            t = exit_i + 1
        else:
            t += 1
    return out


def summarize(rets):
    r = np.array(rets, float)
    if len(r) < 5:
        return {"trades": int(len(r)), "mean_bps": None, "win": None, "t": None}
    t = r.mean() / (r.std(ddof=1) / math.sqrt(len(r))) if r.std(ddof=1) > 0 else None
    return {"trades": int(len(r)), "mean_bps": round(float(r.mean() * 1e4), 1), "win": round(float((r > 0).mean() * 100), 1),
            "t": None if t is None else round(float(t), 2)}


def main():
    t0 = time.time()
    uni = [r for r in csv.DictReader(open("data/universe.csv", newline="")) if not r["symbol"].startswith("DUMMY")]
    try:
        members = set(json.load(open(f"{OUT}/pca.json"))["stocks"].keys())
    except Exception:
        members = None
    mk = load_close("NIFTY500")
    if mk is None:
        mk = load_close("NIFTY50")
    if mk is None:
        print("no index prices")
        sys.exit(1)
    cal = mk.index[-W:]
    syms, inds, cols, jumpers = [], [], [], []
    names = {}
    for row in uni:
        s = row["symbol"]
        if members is not None and s not in members:
            continue
        c = load_close(s)
        if c is None:
            continue
        c = c.reindex(cal)
        if c.notna().mean() < 0.95:
            continue
        if (c.ffill().bfill().pct_change().abs() > JUMP).any():
            jumpers.append(s)
            continue
        syms.append(s)
        inds.append((row.get("industry") or "Other").strip() or "Other")
        names[s] = row.get("company") or s
        cols.append(np.log(c.ffill().bfill().to_numpy(float)))
    if len(syms) < 40:
        print("too few stocks")
        sys.exit(1)
    L = np.vstack(cols).T                  # days x stocks, log prices
    n = L.shape[0]
    groups = {}
    for i, g in enumerate(inds):
        groups.setdefault(g, []).append(i)
    groups = {g: v for g, v in groups.items() if len(v) >= MIN_IND and g != "Other"}

    rng = np.random.default_rng(SEED)
    tested = 0
    sel, pool = [], []                     # selected on formation window; the rest (control pool)
    for g, ix in groups.items():
        for a in range(len(ix)):
            for b in range(a + 1, len(ix)):
                i, j = ix[a], ix[b]
                tested += 1
                f = ols_pair(L[:FORM, i], L[:FORM, j])
                if f is None:
                    continue
                al, be, e = f
                if not (BETA_MIN <= be <= BETA_MAX):
                    pool.append((i, j, be))
                    continue
                st, rho = adf(e)
                hl = halflife(rho) if rho is not None else None
                if st is not None and st < CV5 and hl is not None and HL_MIN <= hl <= HL_MAX:
                    sel.append((i, j, be, st))
                else:
                    pool.append((i, j, be))
    expected_false = 0.05 * tested

    # hold-out: the same rule on selected pairs and on random unselected pairs of the same count
    sel_rets = []
    for i, j, be, st in sel:
        s = L[:, i] - be * L[:, j]
        sel_rets += trade(s, be, FORM)
    pool_ok = [p for p in pool if BETA_MIN <= p[2] <= BETA_MAX]
    k = min(len(pool_ok), max(len(sel) * 3, 1))
    pick = rng.choice(len(pool_ok), size=k, replace=False) if k > 0 else []
    ctl_rets = []
    for q in pick:
        i, j, be = pool_ok[q]
        s = L[:, i] - be * L[:, j]
        ctl_rets += trade(s, be, FORM)
    hold = {"selected": summarize(sel_rets), "random": summarize(ctl_rets), "n_selected": len(sel), "n_random": int(k)}

    # live list: refit on the whole window, keep pairs that still pass, today's z
    live = []
    for g, ix in groups.items():
        for a in range(len(ix)):
            for b in range(a + 1, len(ix)):
                i, j = ix[a], ix[b]
                f = ols_pair(L[:, i], L[:, j])
                if f is None:
                    continue
                al, be, e = f
                if not (BETA_MIN <= be <= BETA_MAX):
                    continue
                st, rho = adf(e)
                hl = halflife(rho) if rho is not None else None
                if st is None or st >= CV5 or hl is None or not (HL_MIN <= hl <= HL_MAX):
                    continue
                s = L[:, i] - be * L[:, j]
                z = rolling_z(s)
                if not np.isfinite(z[-1]):
                    continue
                corr = float(np.corrcoef(np.diff(L[:, i]), np.diff(L[:, j]))[0, 1])
                live.append({"a": syms[i], "b": syms[j], "ind": g, "beta": round(float(be), 2), "adf": round(float(st), 2),
                             "hl": round(float(hl), 1), "z": round(float(z[-1]), 2), "corr": round(corr, 2),
                             "na": names[syms[i]], "nb": names[syms[j]],
                             "zs": [None if not np.isfinite(v) else round(float(v), 2) for v in z[-120:]]})
    n_live = len(live)
    live.sort(key=lambda r: r["adf"])
    live = live[:KEEP]
    live.sort(key=lambda r: -abs(r["z"]))

    asof = str(cal[-1].date())
    out = {"asof": asof, "days": n, "form_days": FORM, "test_days": n - FORM, "z_in": Z_IN, "z_out": Z_OUT, "z_stop": Z_STOP,
           "max_days": MAXD, "cost_bps_leg": COST * 1e4, "cv5": CV5, "hl_range": [HL_MIN, HL_MAX],
           "n_stocks": len(syms), "n_industries": len(groups), "pairs_tested": tested, "passed_formation": len(sel),
           "expected_false": round(expected_false, 0), "live_passing": n_live, "holdout": hold, "pairs": live,
           "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}
    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(f"{OUT}/statarb.json", "w"), separators=(",", ":"))
    lines = [f"Run (UTC): {out['generated']}",
             f"stocks {len(syms)}, industries {len(groups)}, days {n} (formation {FORM}, hold-out {n - FORM}), pairs tested {tested}",
             f"passed on formation window: {len(sel)} (about {int(expected_false)} would pass by luck alone at 5%)",
             f"hold-out selected: {hold['selected']}", f"hold-out random:   {hold['random']}",
             f"live pairs passing now: {n_live}, written {len(live)}", f"left out for a one-day move over {int(JUMP*100)}% (possible split or demerger): {len(jumpers)}", f"time {time.time() - t0:.0f}s"]
    open("data/statarb_log.txt", "w").write("\n".join(lines))
    print("\n".join(lines))


if __name__ == "__main__":
    main()

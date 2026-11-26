"""Single-stock mean-reversion model for the stock universe -> data/quant/meanrev.json and data/meanrev_log.txt.

Idea: a stock that has fallen well below its own recent average (z-score of log price against its previous 60 days) may
snap back. The script
  1. measures, for every stock, how far it is from its 60-day average now (z), how far it is against the index (relative z),
     the half-life of reversion of its log price over the last 250 days with a Dickey-Fuller t-statistic, and a 5-day variance ratio;
  2. runs a simple rule on every stock over the whole window: buy when z < -2 (signal at the close, trade at the NEXT close),
     exit when z is back at 0, stop when z < -4, 30-day limit, 10 bps cost each side. The mirror rule (short when z > +2) is
     reported separately because cash equity cannot be shorted (only stocks with futures);
  3. checks the rule honestly: against random entry dates in the same stocks held for the same number of days (does being
     stretched add anything over simply owning the stock?), and against the index over the same days;
  4. splits the window: stocks that looked mean-reverting on the first 350 days (Dickey-Fuller t below -2.86 and half-life 3 to 60
     days) are compared with the others on the last 150 days, which were not used to choose them.
About 5% of stocks pass a 5% test by luck alone; the expected count is reported.

A one-day move of more than 20% can be a corporate action (split, bonus, demerger) that the price data did not adjust for, which would look like a huge fall.
Such a day is treated as suspect: the stock gets no signal for the next 60 days, no trade is allowed to run across it, and the stock is listed separately on the page.

Runs from the repo root, after compute_quant.py. Needs numpy and pandas (already in requirements.txt)."""
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
W = 500            # trading days used
FORM = 350         # formation days for choosing "mean-reverting" stocks; the rest is the hold-out
ZWIN = 60          # days for the rolling mean and sd
Z_IN, Z_OUT, Z_STOP, MAXD = 2.0, 0.0, 4.0, 30
COST = 0.0010      # per side (10 bps); a round trip costs 2 * COST
DFW = 250          # days for the half-life / Dickey-Fuller regression
DF5 = -2.86        # Dickey-Fuller 5% critical value with a constant
HL_MIN, HL_MAX = 3.0, 60.0
KEEP_LONG, KEEP_SHORT = 60, 40
SEED = 7
JUMP = 0.20       # a one-day move beyond this may be a split, bonus or demerger the prices were not adjusted for: such stocks are kept out


def load(sym):
    try:
        df = pd.read_csv(f"data/prices/{sym}.csv")
    except Exception:
        return None
    df.columns = [c.strip().title() for c in df.columns]
    if "Date" not in df or "Close" not in df:
        return None
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df = df.dropna(subset=["Date", "Close"]).drop_duplicates("Date").sort_values("Date").set_index("Date")
    return df


def rolling_z(s):
    """z-score of each day against the mean and sd of the previous ZWIN days (no look-ahead). Also returns the mean."""
    n = len(s)
    z = np.full(n, np.nan)
    mu = np.full(n, np.nan)
    cs = np.concatenate([[0.0], np.cumsum(s)])
    cs2 = np.concatenate([[0.0], np.cumsum(s * s)])
    for t in range(ZWIN, n):
        a, b = t - ZWIN, t
        m = (cs[b] - cs[a]) / ZWIN
        v = (cs2[b] - cs2[a]) / ZWIN - m * m
        mu[t] = m
        if v > 1e-12:
            z[t] = (s[t] - m) / math.sqrt(v)
    return z, mu


def df_test(L):
    """dL_t = a + b L_{t-1} + e. Returns (b, t-stat, half-life or None)."""
    y = np.diff(L)
    x = L[:-1]
    xm = x.mean()
    vx = ((x - xm) ** 2).sum()
    if vx <= 0 or len(y) < 60:
        return None, None, None
    b = ((x - xm) * (y - y.mean())).sum() / vx
    a = y.mean() - b * xm
    res = y - a - b * x
    s2 = (res @ res) / (len(y) - 2)
    se = math.sqrt(max(s2 / vx, 1e-300))
    hl = -math.log(2) / math.log(1 + b) if -1 < b < 0 else None
    return b, b / se, hl


def vr(L, q=5):
    r1 = np.diff(L)
    if len(r1) < 3 * q:
        return None
    rq = L[q:] - L[:-q]
    v1 = r1.var(ddof=1)
    return float(rq.var(ddof=1) / (q * v1)) if v1 > 0 else None


def trades(z, n, t0, side):
    """List of (entry_index, exit_index) for one side. side=+1 buys when z < -Z_IN, -1 sells short when z > +Z_IN."""
    out = []
    t = max(t0, ZWIN)
    while t < n - 2:
        zt = z[t]
        if np.isfinite(zt) and ((side > 0 and zt < -Z_IN) or (side < 0 and zt > Z_IN)):
            ent = t + 1
            k = ent
            ex = None
            while k < n - 1:
                k += 1
                zz = z[k - 1] if np.isfinite(z[k - 1]) else 0.0
                if (side > 0 and (zz >= -Z_OUT or zz < -Z_STOP)) or (side < 0 and (zz <= Z_OUT or zz > Z_STOP)) or (k - ent) >= MAXD:
                    ex = k
                    break
            if ex is None:
                break
            out.append((ent, ex))
            t = ex + 1
        else:
            t += 1
    return out


def summarize(r):
    r = np.asarray(r, float)
    if len(r) < 8:
        return {"trades": int(len(r)), "mean_bps": None, "win": None, "t": None}
    sd = r.std(ddof=1)
    t = r.mean() / (sd / math.sqrt(len(r))) if sd > 0 else None
    return {"trades": int(len(r)), "mean_bps": round(float(r.mean() * 1e4), 1), "win": round(float((r > 0).mean() * 100), 1),
            "t": None if t is None else round(float(t), 2)}


def welch(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    if len(a) < 8 or len(b) < 8:
        return None
    se = math.sqrt(a.var(ddof=1) / len(a) + b.var(ddof=1) / len(b))
    return None if se <= 0 else round(float((a.mean() - b.mean()) / se), 2)


def main():
    t0 = time.time()
    uni = [r for r in csv.DictReader(open("data/universe.csv", newline="")) if not r["symbol"].startswith("DUMMY")]
    try:
        members = set(json.load(open(f"{OUT}/pca.json"))["stocks"].keys())
    except Exception:
        members = None
    mk = load("NIFTY500")
    if mk is None:
        mk = load("NIFTY50")
    if mk is None:
        print("no index prices")
        sys.exit(1)
    cal = mk.index[-W:]
    Lm = np.log(mk["Close"].reindex(cal).ffill().bfill().to_numpy(float))
    n = len(cal)
    syms, names, inds, liq, cols = [], {}, {}, {}, []
    for row in uni:
        s = row["symbol"]
        if members is not None and s not in members:
            continue
        df = load(s)
        if df is None:
            continue
        c = df["Close"].reindex(cal)
        if c.notna().mean() < 0.95:
            continue
        syms.append(s)
        names[s] = row.get("company") or s
        inds[s] = (row.get("industry") or "Other").strip() or "Other"
        v = df["Volume"].reindex(cal) if "Volume" in df else None
        liq[s] = round(float((c * v).iloc[-60:].median() / 1e7), 1) if v is not None and v.notna().sum() > 20 else None
        cols.append(np.log(c.ffill().bfill().to_numpy(float)))
    if len(syms) < 40:
        print("too few stocks")
        sys.exit(1)
    L = np.vstack(cols).T
    zm, _ = rolling_z(Lm)
    R1 = np.expm1(np.diff(L, axis=0))                       # simple 1-day returns, row k = move into day k+1
    JD = np.abs(R1) > JUMP
    cumJ = np.vstack([np.zeros((1, L.shape[1]), int), np.cumsum(JD, axis=0)])   # cumJ[k] = suspect days up to and including day k
    jumps = []
    for j, s in enumerate(syms):
        idx = np.where(JD[:, j])[0]
        if len(idx) == 0:
            continue
        d = int(idx[-1]) + 1
        if d >= n - ZWIN - 1:                                # recent: it still distorts today's 60-day window
            jumps.append({"s": s, "na": names[s], "pct": round(float(R1[d - 1, j] * 100), 1), "date": str(cal[d].date())})

    rng = np.random.default_rng(SEED)
    Z, MU = {}, {}
    Zraw = {}
    for j, s in enumerate(syms):
        Z[s], MU[s] = rolling_z(L[:, j])
        Zraw[s] = Z[s].copy()
        for d in np.where(JD[:, j])[0] + 1:                  # no signal while a suspect day sits in the 60-day window
            Z[s][d:d + ZWIN + 1] = np.nan

    skipped = [0]

    def run(selector, t_start, sides=(1, -1)):
        """Trade every stock in selector from t_start. Returns {side: dict(raw, excess, ctl, per-stock)}."""
        res = {}
        for sd in sides:
            raw, exc, ctl, per = [], [], [], {}
            for j, s in enumerate(syms):
                if s not in selector:
                    continue
                for ent, ex in trades(Z[s], n, t_start, sd):
                    if cumJ[ex, j] - cumJ[ent, j] > 0:
                        skipped[0] += 1                      # the trade runs across a suspect day
                        continue
                    rs = math.exp(L[ex, j] - L[ent, j]) - 1
                    rm = math.exp(Lm[ex] - Lm[ent]) - 1
                    r = sd * rs - 2 * COST
                    raw.append(r)
                    exc.append(sd * (rs - rm) - 2 * COST)
                    per.setdefault(s, []).append(r)
                    h = ex - ent
                    lo, hi = ZWIN + 1, n - 1 - h
                    if hi > lo:
                        e2 = int(rng.integers(lo, hi))
                        ctl.append(sd * (math.exp(L[e2 + h, j] - L[e2, j]) - 1) - 2 * COST)
            res[sd] = {"raw": raw, "exc": exc, "ctl": ctl, "per": per}
        return res

    everyone = set(syms)
    full = run(everyone, ZWIN)
    out_full = {}
    for sd, nm in ((1, "long"), (-1, "short")):
        d = full[sd]
        s_, c_, e_ = summarize(d["raw"]), summarize(d["ctl"]), summarize(d["exc"])
        out_full[nm] = {"rule": s_, "random_entry": c_, "vs_index": e_, "gap_t": welch(d["raw"], d["ctl"]),
                        "gap_bps": None if s_["mean_bps"] is None or c_["mean_bps"] is None else round(s_["mean_bps"] - c_["mean_bps"], 1)}

    # formation / hold-out split on the stock's own regression
    chosen, dfs = set(), {}
    for j, s in enumerate(syms):
        b, t, hl = df_test(L[:FORM, j][-DFW:])
        dfs[s] = (b, t, hl)
        if t is not None and t < DF5 and hl is not None and HL_MIN <= hl <= HL_MAX:
            chosen.add(s)
    rest = everyone - chosen
    h_sel = run(chosen, FORM, sides=(1,))[1]
    h_rest = run(rest, FORM, sides=(1,))[1]
    hold = {"chosen": summarize(h_sel["raw"]), "others": summarize(h_rest["raw"]), "chosen_vs_index": summarize(h_sel["exc"]),
            "others_vs_index": summarize(h_rest["exc"]), "n_chosen": len(chosen), "n_others": len(rest),
            "expected_by_luck": round(0.05 * len(syms), 0)}

    # today's picture
    rows, n_reverting = [], 0
    for j, s in enumerate(syms):
        z = Z[s]
        if not np.isfinite(z[-1]):
            continue
        b, t, hl = df_test(L[-DFW:, j])
        reverting = bool(t is not None and t < DF5 and hl is not None and HL_MIN <= hl <= HL_MAX)
        n_reverting += reverting
        rel = L[:, j] - Lm
        zr, _ = rolling_z(rel)
        own = full[1]["per"].get(s, []) if z[-1] < 0 else full[-1]["per"].get(s, [])
        rows.append({"s": s, "na": names[s], "ind": inds[s], "z": round(float(z[-1]), 2),
                     "zr": None if not np.isfinite(zr[-1]) else round(float(zr[-1]), 2),
                     "dev": round(float(math.exp(L[-1, j] - MU[s][-1]) - 1) * 100, 1),
                     "d1": round(float(math.exp(L[-1, j] - L[-2, j]) - 1) * 100, 2),
                     "hl": None if hl is None else round(float(hl), 0), "df": None if t is None else round(float(t), 2),
                     "vr5": None if vr(L[-DFW:, j]) is None else round(vr(L[-DFW:, j]), 2), "rev": reverting,
                     "liq": liq.get(s), "tr": len(own), "tr_bps": None if len(own) < 3 else round(float(np.mean(own) * 1e4), 0),
                     "zs": [None if not np.isfinite(v) else round(float(v), 2) for v in z[-120:]]})
    over = sorted([r for r in rows if r["z"] <= -1.5], key=lambda r: r["z"])
    n_over = len([r for r in rows if r["z"] < -Z_IN])
    high = sorted([r for r in rows if r["z"] >= 1.5], key=lambda r: -r["z"])
    n_high = len([r for r in rows if r["z"] > Z_IN])
    asof = str(cal[-1].date())
    out = {"asof": asof, "days": n, "form_days": FORM, "test_days": n - FORM, "z_in": Z_IN, "z_out": Z_OUT, "z_stop": Z_STOP,
           "max_days": MAXD, "cost_bps_side": COST * 1e4, "zwin": ZWIN, "n_stocks": len(syms), "mkt_z": None if not np.isfinite(zm[-1]) else round(float(zm[-1]), 2),
           "jumps": jumps, "jump_cut": JUMP * 100, "trades_skipped": skipped[0], "n_oversold": n_over, "n_overbought": n_high, "n_reverting": n_reverting, "expected_by_luck": round(0.05 * len(rows), 0),
           "full": out_full, "holdout": hold, "oversold": over[:KEEP_LONG], "overbought": high[:KEEP_SHORT],
           "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}
    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(f"{OUT}/meanrev.json", "w"), separators=(",", ":"))
    lf, sf = out_full["long"], out_full["short"]
    lines = [f"Run (UTC): {out['generated']}",
             f"suspect one-day moves over {int(JUMP*100)}% still in the window: {len(jumps)} stock(s): " + "; ".join(f"{x['s']} {x['pct']}% on {x['date']}" for x in jumps[:15]),
             f"trades skipped for running across a suspect day: {skipped[0]}",
             f"stocks {len(syms)}, days {n}; stocks now below -{Z_IN}: {n_over}, above +{Z_IN}: {n_high}; index z {out['mkt_z']}",
             f"whole window, buy rule:   {lf['rule']} | random entries {lf['random_entry']} | vs index {lf['vs_index']} | gap {lf['gap_bps']} bps (t {lf['gap_t']})",
             f"whole window, short rule: {sf['rule']} | random entries {sf['random_entry']} | vs index {sf['vs_index']} | gap {sf['gap_bps']} bps (t {sf['gap_t']})",
             f"hold-out chosen ({hold['n_chosen']}): {hold['chosen']}", f"hold-out others ({hold['n_others']}): {hold['others']}",
             f"stocks passing the reversion test now: {n_reverting} (about {int(out['expected_by_luck'])} by luck)", f"time {time.time() - t0:.0f}s"]
    open("data/meanrev_log.txt", "w").write("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    import traceback
    try:
        main()
    except Exception:
        os.makedirs("data", exist_ok=True)
        open("data/meanrev_log.txt", "w").write("FAILED: " + traceback.format_exc()[-900:] + "\n")
        print(traceback.format_exc())
        sys.exit(1)

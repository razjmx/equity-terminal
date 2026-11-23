import json
import os
import sys
import traceback

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compute_dcf as c

CR = 1e7
CHECK = ["TCS", "HINDUNILVR", "TITAN", "RELIANCE", "JSWSTEEL", "MARUTI", "VOLTAS"]
LOOK = ["MARUTI", "RELIANCE", "TITAN", "HINDUNILVR", "TCS", "WIPRO"]
WORDS = ["invest", "securit", "financial asset", "mutual", "fund", "cash"]

# (name, module settings to change, per-stock inputs applied to every stock)
SCENARIOS = [
    ("base", {}, {}),
    ("ROIC cap 40%", {"ROIC_CAP": 0.40}, {}),
    ("ROIC cap 60%", {"ROIC_CAP": 0.60}, {}),
    ("WACC 10% flat", {}, {"wacc_pct": 10.0}),
    ("WACC 9% flat", {}, {"wacc_pct": 9.0}),
    ("terminal growth 5%", {}, {"terminal_growth_pct": 5.0}),
    ("growth held 5 years", {"HOLD_YEARS": 5}, {}),
    ("margin = 3-year average", {"MARGIN_BASIS": "avg3"}, {}),
    ("ROIC cap 40% + WACC 10% + growth held 5 years",
     {"ROIC_CAP": 0.40, "HOLD_YEARS": 5}, {"wacc_pct": 10.0}),
]


def implied_rate(res):
    """Discount rate at which the DCF equals today's price (base inputs)."""
    m = res["model"]
    p = {"rev": m["rev"], "margin": m["margin"], "tax": m["tax"], "s2c": m["s2c"],
         "debt": m["debt"], "cash": m["cash"], "invest": m["invest"],
         "minority": m["minority"], "shares": m["shares_cr"]}
    gT, g1, price = m["terminal_g"], m["g1"], res["price"]

    def fn(w):
        v = c.value(p, w, gT, g1)
        return None if v is None else price - v["per_share"]

    lo, hi = gT + 0.021, 0.25
    flo, fhi = fn(lo), fn(hi)
    if flo is None or fhi is None:
        return None, "n/a"
    if flo > 0:
        return None, "below"
    if fhi < 0:
        return None, "above"
    return c.solve(fn, lo, hi), "ok"


def main():
    uni = pd.read_csv("data/universe.csv")
    uni = uni[~uni["symbol"].str.startswith("DUMMY")]
    mkt = c.weekly("NIFTY500")

    cache = {}
    orig_beta = c.beta_for

    def cached(sym, m):
        if sym not in cache:
            cache[sym] = orig_beta(sym, m)
        return cache[sym]

    c.beta_for = cached

    metrics = {}
    for r in uni.itertuples():
        mp = f"data/metrics/{r.symbol}.json"
        if os.path.exists(mp):
            M = json.load(open(mp))
            if M.get("dcf_eligible"):
                metrics[r.symbol] = M

    defaults = {k: getattr(c, k) for k in ("ROIC_CAP", "HOLD_YEARS", "MARGIN_BASIS")}
    out = [f"Eligible stocks: {len(metrics)} | RF {c.RF * 100:.1f}% | ERP {c.ERP * 100:.1f}% | "
           f"terminal growth {c.TERMINAL_G * 100:.1f}% | ROIC cap {c.ROIC_CAP * 100:.0f}% | "
           f"forecast {c.N} years, growth held {c.HOLD_YEARS}", "",
           "PART A: what each assumption does (stocks with a meaningful value only)"]
    base_res, prices = {}, {}

    for name, glob, inp in SCENARIOS:
        for k, v in glob.items():
            setattr(c, k, v)
        ups, fv = [], {}
        for sym, M in metrics.items():
            try:
                res, why = c.run(sym, M, mkt, inp)
            except Exception:
                continue
            if res is None or res["status"] != "ok":
                continue
            ups.append(res["upside_pct"])
            if name == "base":
                base_res[sym] = res
                prices[sym] = res["price"]
            if sym in CHECK:
                fv[sym] = res["fair_value"]
        for k, v in defaults.items():
            setattr(c, k, v)
        s = pd.Series(ups, dtype=float)
        within = int(((s >= -25) & (s <= 25)).sum()) if len(s) else 0
        near = ", ".join(f"{k} {fv[k]:.0f}" if k in fv else f"{k} n/m" for k in CHECK)
        med = f"{s.median():.0f}%" if len(s) else "n/a"
        out.append(f"{name} | stocks {len(s)} | median upside {med} | "
                   f"within +/-25% of price: {within} | fair values: {near}")

    out.append("Market prices: " + ", ".join(f"{k} {prices.get(k)}" for k in CHECK))

    out += ["", "PART B: discount rate implied by today's price (base inputs)"]
    rates, n_below, n_above, detail = [], 0, 0, {}
    for sym, res in base_res.items():
        rate, label = implied_rate(res)
        detail[sym] = (rate, label)
        if label == "ok" and rate is not None:
            rates.append(rate * 100)
        elif label == "below":
            n_below += 1
        elif label == "above":
            n_above += 1
    r = pd.Series(rates, dtype=float)
    out.append(f"Solvable: {len(r)} | price needs a rate below about 8.6% "
               f"(cannot be solved at 6.5% terminal growth): {n_below} | above 25%: {n_above}")
    if len(r):
        out.append(f"Among solvable: median {r.median():.1f}% | 25th percentile "
                   f"{r.quantile(0.25):.1f}% | 75th percentile {r.quantile(0.75):.1f}%")
    for sym in CHECK:
        if sym in detail:
            rate, label = detail[sym]
            w = base_res[sym]["assumptions"]["wacc_pct"]
            if label == "ok" and rate is not None:
                txt = f"{rate * 100:.1f}%"
            else:
                txt = {"below": "below about 8.6%", "above": "above 25%"}.get(label, "n/a")
            out.append(f"{sym}: price implies a discount rate of {txt} vs model WACC {w}%")

    out += ["", "PART C: Yahoo balance sheet lines that look like investments or cash (Rs cr, latest FY)"]
    for sym in LOOK:
        fp = f"data/fundamentals/{sym}.json"
        if not os.path.exists(fp):
            continue
        bs = json.load(open(fp))["annual_balance"]
        fy = sorted(bs.keys(), reverse=True)[0]
        out.append(f"--- {sym} ({fy}) ---")
        for k, v in bs[fy].items():
            if v is not None and v == v and any(w in k.lower() for w in WORDS):
                out.append(f"{k}: {round(v / CR)}")

    open("data/dcf_scenarios.txt", "w").write("\n".join(out))
    print("done")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        open("data/dcf_scenarios.txt", "w").write("SCRIPT CRASHED\n" + traceback.format_exc())
        print("crashed")

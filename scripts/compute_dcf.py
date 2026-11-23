import json
import math
import os
import traceback
from collections import Counter

import pandas as pd

# ---------- ASSUMPTIONS: edit these lines, then re-run the workflow ----------
RF = 0.072            # risk-free rate: 10-year G-sec
ERP = 0.055           # equity risk premium (placeholder: replace with house number)
KD = 0.09             # pre-tax cost of debt
TAX = 0.25            # tax rate on EBIT
TERMINAL_G = 0.065    # default terminal growth (per-stock override in data/dcf_inputs.csv)
GROWTH_YEARS = 2      # first-year revenue growth = CAGR over this many latest years
N = 10                # explicit forecast years
HOLD_YEARS = 3        # growth stays at the first-year rate this long, then fades to terminal by year N
G1_MIN, G1_MAX, G1_DEFAULT = -0.05, 0.30, 0.08   # bounds on first-year growth
MARGIN_BASIS = "latest"   # "latest" or "avg3" (average core EBIT margin, last 3 FYs)
ROIC_CAP = 0.20       # return on new capital in the terminal year is capped here
WACC_MIN, WACC_MAX = 0.09, 0.18
BETA_MIN, BETA_MAX = 0.5, 1.8
MID_YEAR = True       # cash flows arrive through the year, not on the last day
ROLL_FORWARD = True   # value is as of the FY end; roll it to the latest price date at cost of equity
CR = 1e7
CHECK = ["TCS", "HINDUNILVR", "TITAN", "RELIANCE", "JSWSTEEL", "MARUTI", "VOLTAS", "ONGC", "IRB"]


def g(d, *keys):
    for k in keys:
        v = d.get(k)
        if v is not None and not (isinstance(v, float) and math.isnan(v)):
            return v
    return None


def num(x, n=2):
    if x is None:
        return None
    try:
        x = float(x)
    except Exception:
        return None
    if not math.isfinite(x):
        return None
    return round(x, n)


def med(vals):
    return num(float(pd.Series(vals, dtype=float).median()), 1) if len(vals) else None


def load_inputs():
    """Per-stock overrides from data/dcf_inputs.csv. Blank = default.
    Percent columns are in percent; investments_cr is in Rs crore (0 removes the automatic figure)."""
    out = {}
    p = "data/dcf_inputs.csv"
    if not os.path.exists(p):
        return out
    try:
        d = pd.read_csv(p)
    except Exception:
        return out
    cols = ["terminal_growth_pct", "first_year_growth_pct", "ebit_margin_pct",
            "wacc_pct", "investments_cr"]
    for _, r in d.iterrows():
        sym = str(r.get("symbol", "")).strip()
        if not sym or sym == "nan":
            continue
        vals = {k: float(r[k]) for k in cols if k in d.columns and not pd.isna(r[k])}
        if vals:
            out[sym] = vals
    return out


def weekly(sym):
    p = f"data/prices/{sym}.csv"
    if not os.path.exists(p):
        return None
    d = pd.read_csv(p, usecols=["Date", "Close"], parse_dates=["Date"]).dropna()
    if d.empty:
        return None
    return d.set_index("Date")["Close"].resample("W-FRI").last().dropna()


def beta_for(sym, mkt):
    s = weekly(sym)
    if s is None or mkt is None:
        return None, 0
    r = pd.concat([s.pct_change(), mkt.pct_change()], axis=1, join="inner").dropna().tail(156)
    if len(r) < 60:
        return None, len(r)
    r.columns = ["s", "m"]
    var = r["m"].var()
    if not var:
        return None, len(r)
    return r["s"].cov(r["m"]) / var, len(r)


def margins(f, years):
    out = []
    for y in years:
        I = f["annual_income"].get(y, {})
        rev, oi, ebit = g(I, "Total Revenue"), g(I, "Operating Income"), g(I, "EBIT")
        un = g(I, "Total Unusual Items") or 0.0
        if not rev or ebit is None:
            continue
        cands = [x for x in (oi, ebit - un) if x is not None]
        out.append(min(cands) / rev)
    return out


def rev_cagr(f, n):
    ys = sorted(f["annual_income"].keys(), reverse=True)
    if len(ys) < n + 1:
        return None
    a = g(f["annual_income"][ys[0]], "Total Revenue")
    b = g(f["annual_income"][ys[n]], "Total Revenue")
    if not a or not b or a <= 0 or b <= 0:
        return None
    return (a / b) ** (1 / n) - 1


def growth_path(g1, gT):
    out = []
    for t in range(1, N + 1):
        if t <= HOLD_YEARS:
            out.append(g1)
        else:
            out.append(g1 + (gT - g1) * (t - HOLD_YEARS) / (N - HOLD_YEARS))
    return out


def project(p, g1, gT):
    rev_prev, ic, rows = p["rev"], p["rev"] / p["s2c"], []
    for gr in growth_path(g1, gT):
        rev = rev_prev * (1 + gr)
        nopat = rev * p["margin"] * (1 - p["tax"])
        reinv = max((rev - rev_prev) / p["s2c"], 0.0)
        ic += reinv
        rows.append({"growth": gr, "rev": rev, "nopat": nopat, "reinv": reinv,
                     "fcff": nopat - reinv})
        rev_prev = rev
    return rows, ic


def value(p, wacc, gT, g1):
    if wacc - gT < 0.02:
        return None
    rows, icn = project(p, g1, gT)
    mid = (1 + wacc) ** 0.5 if MID_YEAR else 1.0
    pv = sum(r["fcff"] / (1 + wacc) ** (i + 1) for i, r in enumerate(rows)) * mid
    nopat_n = rows[-1]["nopat"]
    roic_n = nopat_n / icn if icn > 0 else wacc
    roic_t = min(max(roic_n, wacc), ROIC_CAP)
    tv_fcff = nopat_n * (1 + gT) * (1 - gT / roic_t)
    pv_tv = tv_fcff / (wacc - gT) / (1 + wacc) ** N * mid
    ev = pv + pv_tv
    eq = ev - p["debt"] + p["cash"] + p["invest"] - p["minority"]
    return {"per_share": eq / p["shares"] * p.get("roll", 1.0), "ev": ev, "pv_tv": pv_tv,
            "equity": eq, "rows": rows, "roic_t": roic_t, "tv_fcff": tv_fcff}


def solve(fn, lo, hi):
    """Bisection on an increasing function fn(x). Returns None if not bracketed."""
    flo, fhi = fn(lo), fn(hi)
    if flo is None or fhi is None or flo > 0 or fhi < 0:
        return None
    for _ in range(50):
        mid = (lo + hi) / 2
        fm = fn(mid)
        if fm is None:
            return None
        if fm < 0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def implied_growth(p, wacc, gT, price):
    def fn(x):
        v = value(p, wacc, gT, x)
        return None if v is None else v["per_share"] - price
    return solve(fn, -0.10, 0.60)


def implied_margin(p, wacc, gT, g1, price):
    def fn(m):
        q = dict(p)
        q["margin"] = m
        v = value(q, wacc, gT, g1)
        return None if v is None else v["per_share"] - price
    return solve(fn, 0.0, 0.60)


def implied_rate(p, gT, g1, price):
    """Discount rate at which the DCF equals today's price."""
    def fn(w):
        v = value(p, w, gT, g1)
        return None if v is None else price - v["per_share"]
    lo, hi = gT + 0.021, 0.25
    flo, fhi = fn(lo), fn(hi)
    if flo is None or fhi is None:
        return None, "n/a"
    if flo > 0:
        return None, f"below {lo * 100:.1f}%"
    if fhi < 0:
        return None, "above 25%"
    return solve(fn, lo, hi), ""


def reliability(status, ratio, tv_share, flags):
    if status != "ok":
        return "not meaningful"
    bad = ("growth gap", "growth clamped", "margin swing", "margin: very high",
           "far from price", "low return", "invested capital", "beta", "shares",
           "investments large")
    has_bad = any(f.startswith(b) for f in flags for b in bad)
    if 0.5 <= ratio <= 2.0 and not has_bad and (tv_share is None or tv_share <= 85):
        return "usable"
    if 0.25 <= ratio <= 4:
        return "indicative"
    return "low confidence"


def run(sym, M, mkt, inp):
    f = json.load(open(f"data/fundamentals/{sym}.json"))
    info = f.get("info", {})
    B = f["annual_balance"].get(M["latest_fy"], {})
    price, mcap_raw = info.get("currentPrice"), info.get("marketCap")
    if not price or not mcap_raw:
        return None, "no price or market cap"
    mcap = mcap_raw / CR
    rev = M["snapshot_cr"].get("rev")
    margin_latest = M.get("core_ebit_margin_pct")
    if not rev or margin_latest is None:
        return None, "no revenue or core margin"

    flags = []
    gT = inp.get("terminal_growth_pct", TERMINAL_G * 100) / 100
    if "terminal_growth_pct" in inp:
        flags.append("terminal growth: set by dcf_inputs.csv")
    if gT >= RF:
        flags.append("terminal growth: at or above the risk-free rate")

    years = sorted(f["annual_income"].keys(), reverse=True)[:3]
    ms = margins(f, years)
    margin = margin_latest / 100
    if len(ms) >= 2:
        avg3 = sum(ms) / len(ms)
        if avg3 > 0 and abs(margin - avg3) > 0.25 * avg3 and abs(margin - avg3) > 0.01:
            flags.append(f"margin swing: latest core EBIT margin {margin * 100:.1f}% vs "
                         f"{len(ms)}-year average {avg3 * 100:.1f}% (possible peak or trough)")
    if MARGIN_BASIS == "avg3" and len(ms) >= 2:
        margin = sum(ms) / len(ms)
    if "ebit_margin_pct" in inp:
        margin = inp["ebit_margin_pct"] / 100
        flags.append("margin: set by dcf_inputs.csv")
    if margin <= 0:
        return None, "margin not positive"
    if margin > 0.45:
        flags.append(f"margin: very high EBIT margin ({margin * 100:.0f}%)")

    debt = (g(B, "Total Debt") or 0.0) / CR
    cash = (g(B, "Cash Cash Equivalents And Short Term Investments",
              "Cash And Cash Equivalents") or 0.0) / CR
    # non-operating investments not already inside the cash line
    fa = g(B, "Investmentin Financial Assets") or 0.0
    osti = g(B, "Other Short Term Investments") or 0.0
    lt = g(B, "Long Term Equity Investment") or 0.0
    invest = (max(fa - osti, 0.0) + max(lt, 0.0)) / CR
    if "investments_cr" in inp:
        invest = max(inp["investments_cr"], 0.0)
        flags.append("investments: set by dcf_inputs.csv")
    minority = (g(B, "Minority Interest") or 0.0) / CR
    eq_raw = g(B, "Stockholders Equity", "Common Stock Equity")
    ic0 = (debt + eq_raw / CR + minority - cash - invest) if eq_raw else None
    if ic0 and ic0 > 0:
        s2c = min(max(rev / ic0, 0.5), 4.0)
    else:
        s2c = 1.5
        flags.append("invested capital: not positive, sales-to-capital set to 1.5")
    if invest > 0.25 * mcap:
        flags.append(f"investments large: Rs {invest:,.0f} cr is {invest / mcap * 100:.0f}% "
                     f"of market cap, verify")
    elif invest > 0.05 * mcap:
        flags.append(f"investments added: Rs {invest:,.0f} cr of non-operating investments "
                     f"({invest / mcap * 100:.0f}% of market cap)")

    shares = mcap / price
    so = info.get("sharesOutstanding")
    if so and not 0.9 <= shares / (so / CR) <= 1.1:
        flags.append("shares: count differs from Yahoo shares outstanding by more than 10%")

    # first-year revenue growth: the stock's own growth over the last GROWTH_YEARS years
    g_hist = rev_cagr(f, GROWTH_YEARS)
    cagr3 = (M.get("growth") or {}).get("revenue_cagr_pct")
    if "first_year_growth_pct" in inp:
        g1 = inp["first_year_growth_pct"] / 100
        flags.append("growth: set by dcf_inputs.csv")
    elif g_hist is not None:
        g1 = min(max(g_hist, G1_MIN), G1_MAX)
        if abs(g1 - g_hist) > 1e-9:
            flags.append(f"growth clamped: {GROWTH_YEARS}-year {g_hist * 100:.1f}% to {g1 * 100:.0f}%")
        if cagr3 is not None and abs(g_hist * 100 - cagr3) > 10:
            flags.append(f"growth gap: {GROWTH_YEARS}-year growth differs from 3-year CAGR "
                         f"({cagr3}%) by over 10 points")
    elif cagr3 is not None:
        g1 = min(max(cagr3 / 100, G1_MIN), G1_MAX)
        flags.append(f"growth source: {GROWTH_YEARS}-year unavailable, used 3-year CAGR")
    else:
        g1 = G1_DEFAULT
        flags.append("growth source: no history, default used")
    if g1 < gT - 0.005:
        flags.append("growth path: first-year growth below terminal growth (path rises)")

    beta_raw, nobs = beta_for(sym, mkt)
    if beta_raw is None:
        beta = 1.0
        flags.append("beta: defaulted to 1.0 (short price history)")
    else:
        beta = min(max(0.67 * beta_raw + 0.33, BETA_MIN), BETA_MAX)
    ke = RF + beta * ERP
    wd = debt / (debt + mcap)
    wacc_raw = (1 - wd) * ke + wd * KD * (1 - TAX)
    wacc = min(max(wacc_raw, WACC_MIN), WACC_MAX)
    if wacc != wacc_raw:
        flags.append(f"wacc clamped: {wacc_raw * 100:.1f}% to {wacc * 100:.1f}%")
    if "wacc_pct" in inp:
        wacc = inp["wacc_pct"] / 100
        flags.append("wacc: set by dcf_inputs.csv")

    # value is as of the FY end; roll it forward to the latest price date at the cost of equity
    elapsed, roll = 0.0, 1.0
    if ROLL_FORWARD:
        try:
            asof = mkt.index[-1] if mkt is not None else pd.Timestamp.today()
            elapsed = min(max((asof - pd.Timestamp(M["latest_fy"])).days / 365.0, 0.0), 1.5)
            roll = (1 + ke) ** elapsed
        except Exception:
            elapsed, roll = 0.0, 1.0

    roic_now = rev * margin * (1 - TAX) / ic0 if ic0 and ic0 > 0 else None
    if roic_now is not None and roic_now < wacc - 0.01:
        flags.append(f"low return: ROIC {roic_now * 100:.1f}% below WACC {wacc * 100:.1f}%")

    p = {"rev": rev, "margin": margin, "tax": TAX, "s2c": s2c, "debt": debt, "cash": cash,
         "invest": invest, "minority": minority, "shares": shares, "roll": roll}
    base = value(p, wacc, gT, g1)
    if base is None:
        return None, "WACC too close to terminal growth"
    fair = base["per_share"]
    status = "ok"
    if fair <= 0:
        status = "not meaningful"
        flags.append("not meaningful: negative equity value")
    ratio = fair / price
    if status == "ok" and (ratio < 0.25 or ratio > 4):
        flags.append(f"far from price: model value is {ratio * 100:.0f}% of the market price")
    upside = (fair / price - 1) if status == "ok" else None
    tv_share = base["pv_tv"] / base["ev"] * 100 if base["ev"] else None
    rel = reliability(status, ratio, tv_share, flags)

    dw, dg = [-0.02, -0.01, 0.0, 0.01, 0.02], [-0.01, -0.005, 0.0, 0.005, 0.01]
    grid = []
    for a in dw:
        row = []
        for b in dg:
            v = value(p, wacc + a, gT + b, g1)
            row.append(None if v is None else num(v["per_share"], 1))
        grid.append(row)
    fair_low, fair_high = grid[3][2], grid[1][2]   # WACC +1% and -1% at base terminal growth

    ig = implied_growth(p, wacc, gT, price)
    im = implied_margin(p, wacc, gT, g1, price)
    ir, ir_note = implied_rate(p, gT, g1, price) if status == "ok" else (None, "not meaningful")
    path = growth_path(g1, gT)

    return {
        "symbol": sym, "latest_fy": M["latest_fy"], "status": status, "reliability": rel,
        "price": num(price),
        "fair_value": num(fair, 1) if status == "ok" else None,
        "fair_low": fair_low if status == "ok" else None,
        "fair_high": fair_high if status == "ok" else None,
        "upside_pct": num(upside * 100, 1) if upside is not None else None,
        "flags": flags,
        "assumptions": {
            "rf_pct": num(RF * 100), "erp_pct": num(ERP * 100), "beta_raw": num(beta_raw),
            "beta_used": num(beta), "beta_weeks": nobs,
            "cost_of_equity_pct": num(ke * 100), "wacc_pct": num(wacc * 100),
            "terminal_growth_pct": num(gT * 100, 2), "tax_pct": num(TAX * 100),
            "forecast_years": N, "hold_years": HOLD_YEARS, "growth_years": GROWTH_YEARS,
            "historic_growth_pct": num(g_hist * 100, 1) if g_hist is not None else None,
            "first_year_growth_pct": num(g1 * 100, 1), "ebit_margin_pct": num(margin * 100, 1),
            "margin_basis": MARGIN_BASIS, "sales_to_capital": num(s2c),
            "roic_now_pct": num(roic_now * 100, 1) if roic_now is not None else None,
            "mid_year": MID_YEAR, "roll_forward_years": num(elapsed, 2),
            "roll_factor": num(roll, 3)},
        "projection_cr": [
            {"year": i + 1, "growth_pct": num(path[i] * 100, 1), "revenue": num(r["rev"], 0),
             "nopat": num(r["nopat"], 0), "reinvestment": num(r["reinv"], 0),
             "fcff": num(r["fcff"], 0)}
            for i, r in enumerate(base["rows"])],
        "terminal": {"roic_pct": num(base["roic_t"] * 100, 1),
                     "fcff_cr": num(base["tv_fcff"], 0),
                     "pv_share_of_ev_pct": num(tv_share, 1)},
        "bridge_cr": {"enterprise_value": num(base["ev"], 0), "debt": num(debt, 0),
                      "cash": num(cash, 0), "investments": num(invest, 0),
                      "minority": num(minority, 0), "equity_value": num(base["equity"], 0),
                      "shares_cr": num(shares, 3), "market_cap": num(mcap, 0)},
        "sensitivity": {"wacc_pct": [num((wacc + a) * 100) for a in dw],
                        "terminal_growth_pct": [num((gT + b) * 100, 2) for b in dg],
                        "fair_value": grid},
        "reverse_dcf": {
            "implied_first_year_growth_pct": num(ig * 100, 1) if ig is not None else None,
            "implied_ebit_margin_pct": num(im * 100, 1) if im is not None else None,
            "implied_discount_rate_pct": num(ir * 100, 1) if ir is not None else None,
            "implied_rate_note": ir_note,
            "note": ("growth outside -10% to 60%" if ig is None else "")
                    + ("; margin outside 0% to 60%" if im is None else "")},
        "model": {"rev": rev, "margin": margin, "tax": TAX, "s2c": s2c, "g1": g1,
                  "wacc": wacc, "terminal_g": gT, "n": N, "hold_years": HOLD_YEARS,
                  "roic_cap": ROIC_CAP, "debt": debt, "cash": cash, "invest": invest,
                  "minority": minority, "shares_cr": shares, "roll": roll,
                  "mid_year": MID_YEAR},
    }, None


def main():
    uni = pd.read_csv("data/universe.csv")
    uni = uni[~uni["symbol"].str.startswith("DUMMY")]
    os.makedirs("data/dcf", exist_ok=True)
    mkt = weekly("NIFTY500")
    inputs = load_inputs()
    results, skipped, errors, eligible = [], {}, [], 0

    for r in uni.itertuples():
        mp = f"data/metrics/{r.symbol}.json"
        if not os.path.exists(mp):
            continue
        M = json.load(open(mp))
        if not M.get("dcf_eligible"):
            continue
        eligible += 1
        try:
            res, why = run(r.symbol, M, mkt, inputs.get(r.symbol, {}))
        except Exception as e:
            errors.append(f"{r.symbol}: {str(e)[:150]}")
            continue
        if res is None:
            skipped[r.symbol] = why
            continue
        json.dump(res, open(f"data/dcf/{r.symbol}.json", "w"), indent=1)
        results.append(res)

    rows = [{"symbol": x["symbol"], "status": x["status"], "reliability": x["reliability"],
             "price": x["price"], "fair_value": x["fair_value"],
             "fair_low": x["fair_low"], "fair_high": x["fair_high"],
             "upside_pct": x["upside_pct"],
             "wacc_pct": x["assumptions"]["wacc_pct"], "beta": x["assumptions"]["beta_used"],
             "hist_growth_pct": x["assumptions"]["historic_growth_pct"],
             "g1_pct": x["assumptions"]["first_year_growth_pct"],
             "terminal_g_pct": x["assumptions"]["terminal_growth_pct"],
             "ebit_margin_pct": x["assumptions"]["ebit_margin_pct"],
             "tv_share_pct": x["terminal"]["pv_share_of_ev_pct"],
             "implied_g1_pct": x["reverse_dcf"]["implied_first_year_growth_pct"],
             "implied_margin_pct": x["reverse_dcf"]["implied_ebit_margin_pct"],
             "implied_rate_pct": x["reverse_dcf"]["implied_discount_rate_pct"],
             "flags": "; ".join(x["flags"])} for x in results]
    pd.DataFrame(rows).to_csv("data/dcf_summary.csv", index=False)
    open("data/dcf_errors.txt", "w").write("\n".join(errors) if errors else "none")

    ok = [x for x in results if x["status"] == "ok"]
    nm = [x["symbol"] for x in results if x["status"] != "ok"]
    ups = sorted([(x["upside_pct"], x) for x in ok], key=lambda t: t[0])
    usable = sorted([x for x in ok if x["reliability"] == "usable"], key=lambda x: x["upside_pct"])
    indic = [x for x in ok if x["reliability"] == "indicative"]
    rel = Counter(x["reliability"] for x in results)

    def line(x):
        a, rv = x["assumptions"], x["reverse_dcf"]
        return (x["symbol"], x["price"], x["fair_value"], x["upside_pct"], a["wacc_pct"],
                a["first_year_growth_pct"], a["ebit_margin_pct"],
                rv["implied_ebit_margin_pct"], rv["implied_discount_rate_pct"])

    def uline(x):
        rv = x["reverse_dcf"]
        return (x["symbol"], x["price"], x["fair_value"], x["upside_pct"],
                rv["implied_ebit_margin_pct"], rv["implied_discount_rate_pct"])

    bins = Counter()
    for u, _ in ups:
        k = (">100%" if u > 100 else "25 to 100%" if u > 25 else "-25 to 25%" if u >= -25
             else "-70 to -25%" if u >= -70 else "below -70%")
        bins[k] += 1
    tvs = pd.Series([x["terminal"]["pv_share_of_ev_pct"] for x in ok
                     if x["terminal"]["pv_share_of_ev_pct"] is not None], dtype=float)
    irs = pd.Series([x["reverse_dcf"]["implied_discount_rate_pct"] for x in ok
                     if x["reverse_dcf"]["implied_discount_rate_pct"] is not None], dtype=float)
    n_low = sum(1 for x in ok if x["reverse_dcf"]["implied_rate_note"].startswith("below"))
    flagc = Counter(f.split(":")[0] for x in results for f in x["flags"])
    inv = sorted([(x["symbol"], x["bridge_cr"]["investments"], x["bridge_cr"]["market_cap"])
                  for x in results if x["bridge_cr"]["investments"] and x["bridge_cr"]["market_cap"]],
                 key=lambda t: -(t[1] / t[2]))[:10]
    roll_ex = results[0]["assumptions"]["roll_forward_years"] if results else None
    review = [
        f"Eligible in metrics: {eligible} | DCF computed: {len(results)} | meaningful: {len(ok)} | "
        f"not meaningful: {len(nm)} | skipped: {len(skipped)} | errors: {len(errors)}",
        f"Settings: RF {RF * 100:.2f}% | ERP {ERP * 100:.1f}% | terminal growth {TERMINAL_G * 100:.1f}% | "
        f"forecast {N} years, growth held {HOLD_YEARS} years | growth years {GROWTH_YEARS} | "
        f"mid-year {MID_YEAR} | roll-forward {ROLL_FORWARD} ({roll_ex} years) | overrides loaded: {len(inputs)}",
        f"Skipped reasons: {dict(Counter(skipped.values()))}",
        f"Reliability: {dict(rel)}",
        f"Median upside, meaningful: {med([u for u, _ in ups])}% | usable: {med([x['upside_pct'] for x in usable])}% | "
        f"indicative: {med([x['upside_pct'] for x in indic])}%",
        f"Upside distribution (meaningful): {dict(bins)}",
        f"Usable ({len(usable)}), within +/-25% of price: "
        f"{sum(1 for x in usable if -25 <= x['upside_pct'] <= 25)}",
        f"Usable, sorted by upside [symbol, price, fair, upside%, implied margin%, implied rate%]: "
        f"{[uline(x) for x in usable]}",
        f"Market-implied discount rate: solvable {len(irs)} | needs a rate below the searchable minimum: {n_low} | "
        f"median among solvable {num(float(irs.median()), 1) if len(irs) else None}%",
        f"Terminal value share of EV: median {num(float(tvs.median()), 1) if len(tvs) else None}% | "
        f"over 85%: {int((tvs > 85).sum())} stocks",
        f"Flag counts: {dict(flagc)}",
        f"Not meaningful ({len(nm)}): {nm}",
        f"Largest investments added [symbol, Rs cr, market cap Rs cr]: {inv}",
        f"Top 10 upside overall [symbol, price, fair, upside%, wacc%, g1%, margin%, implied margin%, implied rate%]: {[line(x) for _, x in ups[::-1][:10]]}",
        f"Bottom 10 overall: {[line(x) for _, x in ups[:10]]}",
    ]
    open("data/dcf_review.txt", "w").write("\n".join(review))

    out = []
    by = {x["symbol"]: x for x in results}
    pick = [0, 4, 9]
    for s in CHECK:
        x = by.get(s)
        if not x:
            out.append(f"=== {s}: not computed ({skipped.get(s, 'not eligible')}) ===\n")
            continue
        out.append(f"=== {s} | FY {x['latest_fy']} | {x['status']} | {x['reliability']} | "
                   f"price {x['price']} | fair value {x['fair_value']} "
                   f"(range {x['fair_low']} to {x['fair_high']}) | upside {x['upside_pct']}% ===")
        out.append(f"Flags: {x['flags']}")
        out.append(f"Assumptions: {x['assumptions']}")
        out.append(f"Projection (Rs cr), years 1, 5, 10: "
                   f"{[x['projection_cr'][i] for i in pick if i < len(x['projection_cr'])]}")
        out.append(f"Terminal: {x['terminal']}")
        out.append(f"Bridge (Rs cr): {x['bridge_cr']}")
        out.append(f"Reverse DCF: {x['reverse_dcf']}")
        out.append("")
    open("data/dcf_check.txt", "w").write("\n".join(out))
    print("done:", len(results), "computed")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        open("data/dcf_errors.txt", "w").write("SCRIPT CRASHED\n" + traceback.format_exc())
        print("crashed")

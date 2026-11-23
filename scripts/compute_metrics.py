import json
import math
import os

import pandas as pd

CR = 1e7
uni = pd.read_csv("data/universe.csv")
uni = uni[~uni["symbol"].str.startswith("DUMMY")]
os.makedirs("data/metrics", exist_ok=True)


def g(d, *keys):
    for k in keys:
        v = d.get(k)
        if v is not None and not (isinstance(v, float) and math.isnan(v)):
            return v
    return None


def div(a, b):
    return None if a is None or b in (None, 0) else a / b


def rnd(x, n=2):
    return None if x is None else round(x, n)


def pct(x):
    return None if x is None else round(x * 100, 1)


def cr(x):
    return None if x is None else round(x / CR, 1)


def gt(a, b):
    return None if a is None or b is None else a > b


def year_block(inc, bs, cf, y):
    I, B, C = inc.get(y, {}), bs.get(y, {}), cf.get(y, {})
    return {
        "rev": g(I, "Total Revenue"), "ni": g(I, "Net Income"), "ebit": g(I, "EBIT"),
        "ebitda": g(I, "EBITDA"), "gp": g(I, "Gross Profit"),
        "intr": g(I, "Interest Expense"),
        "ta": g(B, "Total Assets"),
        "eq": g(B, "Stockholders Equity", "Common Stock Equity"),
        "debt": g(B, "Total Debt"), "ca": g(B, "Current Assets"),
        "cl": g(B, "Current Liabilities"),
        "tl": g(B, "Total Liabilities Net Minority Interest"),
        "re": g(B, "Retained Earnings"),
        "sh": g(B, "Ordinary Shares Number", "Share Issued"),
        "cash": g(B, "Cash Cash Equivalents And Short Term Investments",
                  "Cash And Cash Equivalents"),
        "cfo": g(C, "Operating Cash Flow"), "fcf": g(C, "Free Cash Flow"),
    }


def piotroski(L, P):
    roa, roa_p = div(L["ni"], L["ta"]), div(P["ni"], P["ta"])
    cr_, cr_p = div(L["ca"], L["cl"]), div(P["ca"], P["cl"])
    lev, lev_p = div(L["debt"], L["ta"]), div(P["debt"], P["ta"])
    gm, gm_p = div(L["gp"], L["rev"]), div(P["gp"], P["rev"])
    at, at_p = div(L["rev"], L["ta"]), div(P["rev"], P["ta"])
    tests = {
        "roa_positive": gt(roa, 0),
        "cfo_positive": gt(L["cfo"], 0),
        "roa_improved": gt(roa, roa_p),
        "cfo_above_net_income": gt(L["cfo"], L["ni"]),
        "leverage_fell": gt(lev_p, lev),
        "current_ratio_improved": gt(cr_, cr_p),
        "no_dilution": None if L["sh"] is None or P["sh"] is None
                       else L["sh"] <= P["sh"] * 1.005,
        "gross_margin_improved": gt(gm, gm_p),
        "asset_turnover_improved": gt(at, at_p),
    }
    done = [v for v in tests.values() if v is not None]
    return {"score": int(sum(done)), "tested": len(done), "tests": tests}


def altman(L):
    need = ["ta", "ebit", "tl", "re", "ca", "cl", "eq"]
    if any(L[k] is None for k in need) or not L["ta"] or not L["tl"]:
        return None
    z = (6.56 * (L["ca"] - L["cl"]) / L["ta"] + 3.26 * L["re"] / L["ta"]
         + 6.72 * L["ebit"] / L["ta"] + 1.05 * L["eq"] / L["tl"])
    zone = "safe" if z > 2.6 else "grey" if z > 1.1 else "distress"
    return {"z": round(z, 2), "zone": zone}


def build(sym):
    p = f"data/fundamentals/{sym}.json"
    if not os.path.exists(p):
        return None
    d = json.load(open(p))
    info = d.get("info", {})
    inc, bs, cf = d["annual_income"], d["annual_balance"], d["annual_cashflow"]
    ys = sorted(inc.keys(), reverse=True)[:4]   # newest 4 FYs (oldest column is sparse)
    Y = [year_block(inc, bs, cf, y) for y in ys]
    L, P = Y[0], (Y[1] if len(Y) > 1 else None)
    mcap = info.get("marketCap")
    standard = L["ebit"] is not None

    flags = []
    if len(ys) < 3:
        flags.append("short history")
    if L["cfo"] is None:
        flags.append("no cash flow data")
    if not standard:
        flags.append("financial or no EBIT")

    # equity sanity check: balance-sheet equity vs Yahoo book value x shares
    eq_check = {"balance_sheet_cr": cr(L["eq"]), "implied_cr": None,
                "ratio": None, "used": "balance_sheet"}
    bvps, shares = info.get("bookValue"), info.get("sharesOutstanding")
    if bvps and shares and L["eq"] and L["eq"] > 0:
        implied = bvps * shares
        ratio = L["eq"] / implied
        eq_check["implied_cr"] = cr(implied)
        eq_check["ratio"] = round(ratio, 2)
        if ratio > 1.10 or ratio < 0.70:
            L["eq"] = implied
            eq_check["used"] = "book_value"
            flags.append(f"equity replaced by Yahoo book value "
                         f"(balance sheet / book value = {ratio:.2f})")

    n = len(Y) - 1

    def cagr(k):
        a, b = L[k], Y[-1][k]
        if n < 1 or a is None or b is None or a <= 0 or b <= 0:
            return None
        return (a / b) ** (1 / n) - 1

    capital = L["ta"] - L["cl"] if L["ta"] is not None and L["cl"] is not None else None
    ev = (mcap + L["debt"] - L["cash"]
          if None not in (mcap, L["debt"], L["cash"]) else None)

    return {
        "symbol": sym,
        "latest_fy": ys[0],
        "type": "standard" if standard else "financial",
        "profit_basis": "reported",
        "flags": flags,
        "equity_check": eq_check,
        "snapshot_cr": {k: cr(L[k]) for k in ["rev", "ni", "ebit", "ta", "eq", "debt", "fcf"]},
        "ratios": {
            "roe_pct": pct(div(L["ni"], L["eq"])),
            "roa_pct": pct(div(L["ni"], L["ta"])),
            "net_margin_pct": pct(div(L["ni"], L["rev"])),
            "ebit_margin_pct": pct(div(L["ebit"], L["rev"])),
            "roce_pct": pct(div(L["ebit"], capital)),
            "fcf_margin_pct": pct(div(L["fcf"], L["rev"])),
            "debt_equity": rnd(div(L["debt"], L["eq"])),
            "interest_cover": rnd(div(L["ebit"], abs(L["intr"]) if L["intr"] else None)),
            "current_ratio": rnd(div(L["ca"], L["cl"])),
            "asset_turnover": rnd(div(L["rev"], L["ta"])),
        },
        "dupont": {
            "net_margin_pct": pct(div(L["ni"], L["rev"])),
            "asset_turnover": rnd(div(L["rev"], L["ta"])),
            "equity_multiplier": rnd(div(L["ta"], L["eq"])),
        },
        "growth": {
            "years_used": n,
            "revenue_cagr_pct": pct(cagr("rev")),
            "net_income_cagr_pct": pct(cagr("ni")),
        },
        "valuation": {
            "pe": rnd(div(mcap, L["ni"]) if L["ni"] and L["ni"] > 0 else None),
            "pe_normalized": None,
            "pe_used": None,
            "pb": rnd(div(mcap, L["eq"])),
            "ev_ebitda": rnd(div(ev, L["ebitda"])),
            "fcf_yield_pct": pct(div(L["fcf"], mcap)),
            "market_cap_cr": cr(mcap),
        },
        "piotroski": piotroski(L, P) if standard and P else None,
        "altman_z2": altman(L) if standard else None,
    }


FIN_NULL = ["net_margin_pct", "ebit_margin_pct", "roce_pct", "fcf_margin_pct",
            "debt_equity", "interest_cover", "current_ratio", "asset_turnover"]


def finalize(m):
    d = json.load(open(f"data/fundamentals/{m['symbol']}.json"))
    I = d["annual_income"].get(m["latest_fy"], {})
    mcap = d.get("info", {}).get("marketCap")
    cont = g(I, "Net Income Continuous Operations",
             "Net Income From Continuing Operation Net Minority Interest")
    norm = g(I, "Normalized Income")
    ni = g(I, "Net Income")
    m["snapshot_cr"]["ni_continuing_ops_pre_minority"] = cr(cont)
    m["snapshot_cr"]["ni_normalized"] = cr(norm)
    base = norm if norm is not None else cont
    m["valuation"]["pe_normalized"] = (
        rnd(mcap / base) if base and base > 0 and mcap else None)
    m["valuation"]["pe_used"] = m["valuation"]["pe"]

    if (m["type"] == "standard" and ni is not None and base
            and abs(ni - base) > 0.15 * abs(base)):
        m["flags"].append("reported profit differs from normalized (one-offs)")
        r, s = m["ratios"], m["snapshot_cr"]
        m["ratios_reported"] = {k: r[k] for k in ["roe_pct", "roa_pct", "net_margin_pct"]}
        b = base / CR
        r["roe_pct"] = pct(div(b, s["eq"]))
        r["roa_pct"] = pct(div(b, s["ta"]))
        r["net_margin_pct"] = pct(div(b, s["rev"]))
        m["dupont"]["net_margin_pct"] = r["net_margin_pct"]
        m["valuation"]["pe_used"] = m["valuation"]["pe_normalized"]
        m["profit_basis"] = "normalized"

    if m["type"] == "financial":
        for k in FIN_NULL:
            m["ratios"][k] = None
        m["dupont"] = {"roe_pct": m["ratios"]["roe_pct"],
                       "roa_pct": m["ratios"]["roa_pct"],
                       "equity_multiplier": m["dupont"]["equity_multiplier"]}
        m["valuation"]["ev_ebitda"] = None
        m["valuation"]["fcf_yield_pct"] = None
        m["snapshot_cr"]["debt"] = None
        m["snapshot_cr"]["fcf"] = None
    return m


rows, errors = [], []
for r in uni.itertuples():
    try:
        m = build(r.symbol)
        if m:
            m = finalize(m)
    except Exception as e:
        errors.append(f"{r.symbol}: {str(e)[:150]}")
        continue
    if m is None:
        errors.append(f"{r.symbol}: no fundamentals file")
        continue
    json.dump(m, open(f"data/metrics/{r.symbol}.json", "w"), indent=1)
    pio, alt = m["piotroski"], m["altman_z2"]
    rows.append({
        "symbol": r.symbol, "industry": r.industry, "type": m["type"],
        "latest_fy": m["latest_fy"], "profit_basis": m["profit_basis"],
        "roe_pct": m["ratios"]["roe_pct"], "roce_pct": m["ratios"]["roce_pct"],
        "net_margin_pct": m["ratios"]["net_margin_pct"],
        "debt_equity": m["ratios"]["debt_equity"],
        "rev_cagr_pct": m["growth"]["revenue_cagr_pct"],
        "pe": m["valuation"]["pe"], "pe_normalized": m["valuation"]["pe_normalized"],
        "pe_used": m["valuation"]["pe_used"], "pb": m["valuation"]["pb"],
        "equity_ratio": m["equity_check"]["ratio"],
        "piotroski": pio["score"] if pio else None,
        "piotroski_tested": pio["tested"] if pio else None,
        "altman_z2": alt["z"] if alt else None,
        "altman_zone": alt["zone"] if alt else None,
        "flags": "; ".join(m["flags"]),
    })

pd.DataFrame(rows).to_csv("data/metrics_summary.csv", index=False)
open("data/metrics_errors.txt", "w").write("\n".join(errors) if errors else "none")

# review file: counts and lists so results can be checked without Actions logs
std = sum(1 for x in rows if x["type"] == "standard")
eqf = [(x["symbol"], x["equity_ratio"]) for x in rows if "equity replaced" in x["flags"]]
one = [x["symbol"] for x in rows if "one-offs" in x["flags"]]
roe_out = [(x["symbol"], x["roe_pct"]) for x in rows
           if x["roe_pct"] is not None and (x["roe_pct"] > 60 or x["roe_pct"] < -20)]
review = [
    f"Stocks with metrics: {len(rows)} | skipped: {len(errors)}",
    f"Standard: {std} | financial or no EBIT: {len(rows) - std}",
    f"Equity replaced by book value ({len(eqf)}): {eqf}",
    f"Normalized-profit flag ({len(one)}): {one}",
    f"ROE outliers (>60 or <-20) ({len(roe_out)}): {roe_out}",
]
open("data/metrics_review.txt", "w").write("\n".join(review))

# readable spot-check file
CHECK = ["HINDUNILVR", "HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK", "BAJFINANCE"]
out = []
for s in CHECK:
    p = f"data/metrics/{s}.json"
    if os.path.exists(p):
        m = json.load(open(p))
        out.append(f"=== {s} | FY ending {m['latest_fy']} | {m['type']} | profit basis: {m['profit_basis']} ===")
        out.append(f"Flags: {m['flags']}")
        out.append(f"Equity check: {m['equity_check']}")
        out.append(f"Snapshot (Rs cr): {m['snapshot_cr']}")
        out.append(f"Ratios: {m['ratios']}")
        if "ratios_reported" in m:
            out.append(f"Ratios on reported profit: {m['ratios_reported']}")
        out.append(f"DuPont: {m['dupont']}")
        out.append(f"Growth: {m['growth']}")
        out.append(f"Valuation: {m['valuation']}")
        pio = m["piotroski"]
        out.append(f"Piotroski: {pio['score']}/{pio['tested']}" if pio else "Piotroski: n/a")
        out.append(f"Altman Z'': {m['altman_z2']}")
        out.append("")
open("data/metrics_check.txt", "w").write("\n".join(out))
print("done:", len(rows), "stocks;", len(errors), "skipped")

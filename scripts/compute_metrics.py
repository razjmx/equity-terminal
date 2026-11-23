import json
import math
import os
import traceback
from collections import Counter

import pandas as pd

CR = 1e7
MATERIAL = 0.15   # a one-off counts only if larger than this share of profit
RECUR = 0.40      # prior-year item at least this share of current = recurring
SWITCH = 0.05     # ratios use core profit only if it differs from reported by more than this
PE_MAX = 150      # P/E above this is treated as not meaningful
EQUITY_OVERRIDE = {"HDFCBANK"}   # verified against Screener: use book value x shares

FIN_NULL = ["net_margin_pct", "ebit_margin_pct", "roce_pct", "fcf_margin_pct",
            "debt_equity", "interest_cover", "current_ratio", "asset_turnover"]


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
        "oi": g(I, "Operating Income"),
        "unusual": g(I, "Total Unusual Items"),
        "cont": g(I, "Net Income From Continuing Operation Net Minority Interest"),
        "taxr": g(I, "Tax Rate For Calcs"),
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


def core_profit(L, P):
    """Profit from continuing operations, minus one-off unusual items (not recurring ones)."""
    ni = L["ni"]
    base = L["cont"] if L["cont"] is not None else ni
    if base is None:
        return None, []
    notes = []
    if ni is not None and abs(ni - base) > 0.02 * max(abs(ni), 1.0):
        notes.append("discontinued operations excluded from profit")
    unusual = L["unusual"] or 0.0
    prev = (P["unusual"] or 0.0) if P else 0.0
    rate = L["taxr"]
    if rate is None or not 0.10 <= rate <= 0.35:
        rate = 0.25
    recurring = unusual * prev > 0 and abs(prev) >= RECUR * abs(unusual)
    material = abs(unusual) > MATERIAL * max(abs(base), 1.0)
    core = base
    if material and recurring:
        notes.append("recurring unusual items kept in profit")
    elif material:
        core = base - unusual * (1 - rate)
        notes.append("one-off items removed from profit")
    return core, notes


def load_overrides():
    out = {}
    if os.path.exists("data/overrides.csv"):
        for _, o in pd.read_csv("data/overrides.csv").iterrows():
            note = o["note"] if "note" in o and not pd.isna(o["note"]) else ""
            out[str(o["symbol"]).strip()] = (str(o["type"]).strip(), str(note))
    return out


def build(sym, ovr):
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
    otype, onote = ovr.get(sym, (None, ""))

    standard = L["ebit"] is not None and otype != "financial"
    if otype in ("realty", "reit", "exclude"):
        mtype = otype
    else:
        mtype = "standard" if standard else "financial"

    flags = []
    if otype:
        flags.append(f"override: {otype} ({onote})")
    if len(ys) < 3:
        flags.append("short history")
    if L["cfo"] is None:
        flags.append("no cash flow data")
    if not standard and not otype:
        flags.append("financial or no EBIT")

    # equity sanity check: balance-sheet equity vs Yahoo book value x shares
    eq_check = {"balance_sheet_cr": cr(L["eq"]), "implied_cr": None,
                "ratio": None, "used": "balance_sheet"}
    currency_bad = False
    bvps, shares = info.get("bookValue"), info.get("sharesOutstanding")
    if bvps and shares and L["eq"] and L["eq"] > 0:
        implied = bvps * shares
        ratio = L["eq"] / implied
        eq_check["implied_cr"] = cr(implied)
        eq_check["ratio"] = round(ratio, 2)
        if ratio < 0.05 or ratio > 20:
            currency_bad = True
            flags.append(f"currency or units mismatch (equity ratio {ratio:.2f}); "
                         f"market-cap multiples blanked")
        elif sym in EQUITY_OVERRIDE:
            L["eq"] = implied
            eq_check["used"] = "book_value (manual override)"
            flags.append(f"equity overridden with book value x shares "
                         f"(ratio {ratio:.2f}; verified vs Screener)")
        elif ratio > 1.10 or ratio < 0.70:
            flags.append(f"equity check mismatch (ratio {ratio:.2f}); figures NOT changed")

    n = len(Y) - 1

    def cagr(k):
        a, b = L[k], Y[-1][k]
        if n < 1 or a is None or b is None or a <= 0 or b <= 0:
            return None
        return (a / b) ** (1 / n) - 1

    capital = L["ta"] - L["cl"] if L["ta"] is not None and L["cl"] is not None else None
    ev = (mcap + L["debt"] - L["cash"]
          if None not in (mcap, L["debt"], L["cash"]) else None)

    # core profit (for P/E and ROE) and core EBIT (for the DCF)
    core, notes = (None, [])
    if standard and L["ni"] is not None:
        core, notes = core_profit(L, P)
    flags += notes
    basis = "reported"
    if (core is not None and L["ni"] not in (None, 0)
            and abs(core - L["ni"]) > SWITCH * abs(L["ni"])):
        basis = "core"
    prof = core if basis == "core" else L["ni"]

    core_ebit = None
    if standard:
        eu = L["ebit"] - (L["unusual"] or 0.0)
        core_ebit = min(x for x in (L["oi"], eu) if x is not None)
        if L["ebit"] > 0 and core_ebit < 0.7 * L["ebit"]:
            flags.append(f"core EBIT {round((1 - core_ebit / L['ebit']) * 100)}% "
                         f"below reported EBIT")

    pe_rep = div(mcap, L["ni"]) if L["ni"] and L["ni"] > 0 else None
    pe_core = div(mcap, core) if core and core > 0 else None
    pe_used = pe_core if basis == "core" else pe_rep
    if pe_used is not None and pe_used > PE_MAX:
        flags.append(f"P/E {round(pe_used)} not meaningful, shown blank")
        pe_used = None
    pb = div(mcap, L["eq"])
    evx = div(ev, L["ebitda"])
    fy = div(L["fcf"], mcap)
    if currency_bad:
        pe_rep = pe_core = pe_used = pb = evx = fy = None

    ratios = {
        "roe_pct": pct(div(prof, L["eq"])),
        "roa_pct": pct(div(prof, L["ta"])),
        "net_margin_pct": pct(div(prof, L["rev"])),
        "ebit_margin_pct": pct(div(L["ebit"], L["rev"])),
        "roce_pct": pct(div(L["ebit"], capital)),
        "fcf_margin_pct": pct(div(L["fcf"], L["rev"])),
        "debt_equity": rnd(div(L["debt"], L["eq"])),
        "interest_cover": rnd(div(L["ebit"], abs(L["intr"]) if L["intr"] else None)),
        "current_ratio": rnd(div(L["ca"], L["cl"])),
        "asset_turnover": rnd(div(L["rev"], L["ta"])),
    }
    dupont = {
        "net_margin_pct": ratios["net_margin_pct"],
        "asset_turnover": ratios["asset_turnover"],
        "equity_multiplier": rnd(div(L["ta"], L["eq"])),
    }
    snap = {k: cr(L[k]) for k in ["rev", "ni", "ebit", "ta", "eq", "debt", "fcf"]}
    snap["ni_core"] = cr(core)
    snap["ebit_core"] = cr(core_ebit)
    snap["operating_income"] = cr(L["oi"])
    reported = None
    if basis == "core":
        reported = {"roe_pct": pct(div(L["ni"], L["eq"])),
                    "roa_pct": pct(div(L["ni"], L["ta"])),
                    "net_margin_pct": pct(div(L["ni"], L["rev"]))}
    if not standard:
        for k in FIN_NULL:
            ratios[k] = None
        dupont = {"roe_pct": ratios["roe_pct"], "roa_pct": ratios["roa_pct"],
                  "equity_multiplier": dupont["equity_multiplier"]}
        evx = None
        fy = None
        snap["ebit"] = None
        snap["debt"] = None
        snap["fcf"] = None

    reasons = []
    if mtype != "standard":
        reasons.append(f"type: {mtype}")
    if currency_bad:
        reasons.append("currency mismatch")
    if core_ebit is None or core_ebit <= 0:
        reasons.append("core EBIT missing or not positive")
    if L["cfo"] is None:
        reasons.append("no cash flow data")
    if len(ys) < 3:
        reasons.append("short history")
    if not mcap:
        reasons.append("no market cap")

    return {
        "symbol": sym, "latest_fy": ys[0], "type": mtype, "profit_basis": basis,
        "dcf_eligible": not reasons, "dcf_reasons": reasons,
        "flags": flags, "equity_check": eq_check,
        "core_ebit_margin_pct": pct(div(core_ebit, L["rev"])),
        "snapshot_cr": snap, "ratios": ratios, "ratios_reported": reported,
        "dupont": dupont,
        "growth": {"years_used": n,
                   "revenue_cagr_pct": pct(cagr("rev")),
                   "net_income_cagr_pct": pct(cagr("ni"))},
        "valuation": {"pe_reported": rnd(pe_rep), "pe_core": rnd(pe_core),
                      "pe_used": rnd(pe_used), "pb": rnd(pb), "ev_ebitda": rnd(evx),
                      "fcf_yield_pct": pct(fy), "market_cap_cr": cr(mcap)},
        "piotroski": piotroski(L, P) if standard and P else None,
        "altman_z2": altman(L) if standard else None,
    }


def main():
    uni = pd.read_csv("data/universe.csv")
    uni = uni[~uni["symbol"].str.startswith("DUMMY")]
    os.makedirs("data/metrics", exist_ok=True)
    ovr = load_overrides()
    rows, errors, store = [], [], []

    for r in uni.itertuples():
        try:
            m = build(r.symbol, ovr)
        except Exception as e:
            errors.append(f"{r.symbol}: {str(e)[:150]}")
            continue
        if m is None:
            errors.append(f"{r.symbol}: no fundamentals file")
            continue
        json.dump(m, open(f"data/metrics/{r.symbol}.json", "w"), indent=1)
        store.append(m)
        pio, alt = m["piotroski"], m["altman_z2"]
        rows.append({
            "symbol": r.symbol, "industry": r.industry, "type": m["type"],
            "latest_fy": m["latest_fy"], "profit_basis": m["profit_basis"],
            "roe_pct": m["ratios"]["roe_pct"], "roce_pct": m["ratios"]["roce_pct"],
            "net_margin_pct": m["ratios"]["net_margin_pct"],
            "ebit_margin_pct": m["ratios"]["ebit_margin_pct"],
            "core_ebit_margin_pct": m["core_ebit_margin_pct"],
            "debt_equity": m["ratios"]["debt_equity"],
            "rev_cagr_pct": m["growth"]["revenue_cagr_pct"],
            "pe_reported": m["valuation"]["pe_reported"],
            "pe_used": m["valuation"]["pe_used"], "pb": m["valuation"]["pb"],
            "equity_ratio": m["equity_check"]["ratio"],
            "piotroski": pio["score"] if pio else None,
            "piotroski_tested": pio["tested"] if pio else None,
            "altman_z2": alt["z"] if alt else None,
            "altman_zone": alt["zone"] if alt else None,
            "dcf_eligible": m["dcf_eligible"],
            "flags": "; ".join(m["flags"]),
        })

    pd.DataFrame(rows).to_csv("data/metrics_summary.csv", index=False)
    open("data/metrics_errors.txt", "w").write("\n".join(errors) if errors else "none")

    # review file: counts and lists so results can be checked without Actions logs
    M = {m["symbol"]: m for m in store}

    def has(m, text):
        return any(text in f for f in m["flags"])

    types = Counter(m["type"] for m in store)
    oneoff = [(s, M[s]["valuation"]["pe_reported"], M[s]["valuation"]["pe_core"])
              for s in M if has(M[s], "one-off items removed")]
    recur = [s for s in M if has(M[s], "recurring unusual items kept")]
    disc = [s for s in M if has(M[s], "discontinued operations excluded")]
    cur = [s for s in M if has(M[s], "currency")]
    nm = [s for s in M if has(M[s], "not meaningful")]
    mism = [(s, M[s]["equity_check"]["ratio"]) for s in M if has(M[s], "equity check mismatch")]
    gaps = sorted(
        [(s, M[s]["ratios"]["ebit_margin_pct"], M[s]["core_ebit_margin_pct"])
         for s in M if has(M[s], "below reported EBIT")],
        key=lambda x: -((x[1] or 0) - (x[2] or 0)))
    elig = sum(1 for m in store if m["dcf_eligible"])
    why = Counter(x for m in store if not m["dcf_eligible"] for x in m["dcf_reasons"])
    roe_out = [(x["symbol"], x["roe_pct"]) for x in rows
               if x["roe_pct"] is not None and (x["roe_pct"] > 60 or x["roe_pct"] < -20)]
    review = [
        f"Stocks with metrics: {len(rows)} | skipped: {len(errors)}",
        f"By type: {dict(types)}",
        f"DCF eligible: {elig} | not eligible reasons: {dict(why)}",
        f"Currency/units mismatch ({len(cur)}): {cur}",
        f"Equity mismatch, NOT changed ({len(mism)}): {mism}",
        f"One-off items removed from profit ({len(oneoff)}) [symbol, pe reported, pe core]: {oneoff}",
        f"Recurring unusual items kept ({len(recur)}): {recur}",
        f"Discontinued operations excluded ({len(disc)}): {disc}",
        f"P/E not meaningful, blank ({len(nm)}): {nm}",
        f"Core EBIT >30% below reported ({len(gaps)}), top 50 [symbol, reported margin, core margin]: {gaps[:50]}",
        f"ROE outliers (>60 or <-20) ({len(roe_out)}): {roe_out}",
    ]
    open("data/metrics_review.txt", "w").write("\n".join(review))

    # readable spot-check file
    CHECK = ["JSWSTEEL", "MARUTI", "HINDUNILVR", "ETERNAL", "INFY", "TMPV", "LICI", "GODREJPROP"]
    out = []
    for s in CHECK:
        m = M.get(s)
        if not m:
            continue
        out.append(f"=== {s} | FY ending {m['latest_fy']} | {m['type']} | profit basis: {m['profit_basis']} ===")
        out.append(f"Flags: {m['flags']}")
        out.append(f"DCF eligible: {m['dcf_eligible']} {m['dcf_reasons']}")
        out.append(f"Equity check: {m['equity_check']}")
        out.append(f"Snapshot (Rs cr): {m['snapshot_cr']}")
        out.append(f"Core EBIT margin %: {m['core_ebit_margin_pct']}")
        out.append(f"Ratios: {m['ratios']}")
        if m["ratios_reported"]:
            out.append(f"Ratios on reported profit: {m['ratios_reported']}")
        out.append(f"DuPont: {m['dupont']}")
        out.append(f"Valuation: {m['valuation']}")
        pio = m["piotroski"]
        out.append(f"Piotroski: {pio['score']}/{pio['tested']}" if pio else "Piotroski: n/a")
        out.append(f"Altman Z'': {m['altman_z2']}")
        out.append("")
    open("data/metrics_check.txt", "w").write("\n".join(out))
    print("done:", len(rows), "stocks;", len(errors), "skipped")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        open("data/metrics_errors.txt", "w").write("SCRIPT CRASHED\n" + traceback.format_exc())
        print("crashed")

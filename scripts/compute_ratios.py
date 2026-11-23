"""Categorised multi-year ratios per stock -> data/ratios/SYM.json (+ data/ratios_check.txt, ratios_errors.txt).
Reads data/fundamentals/SYM.json (Yahoo statements) and data/metrics/SYM.json (type, snapshot, valuation)."""
import json, os, glob, datetime, traceback

FUND, MET, OUT = "data/fundamentals", "data/metrics", "data/ratios"
MAXY = 4

REV = ["Total Revenue", "Operating Revenue"]
COGS = ["Cost Of Revenue", "Reconciled Cost Of Revenue"]
GP = ["Gross Profit"]
EBITDA = ["EBITDA", "Normalized EBITDA"]
EBIT = ["EBIT"]
OPINC = ["Operating Income", "Total Operating Income As Reported"]
NI = ["Net Income Common Stockholders", "Net Income", "Net Income From Continuing Operation Net Minority Interest"]
PBT = ["Pretax Income"]
TAX = ["Tax Provision"]
INTX = ["Interest Expense", "Interest Expense Non Operating"]
EPS = ["Diluted EPS", "Basic EPS"]
TA = ["Total Assets"]
CA = ["Current Assets", "Total Current Assets"]
CL = ["Current Liabilities", "Total Current Liabilities"]
INV = ["Inventory"]
REC = ["Accounts Receivable", "Receivables", "Net Receivables"]
PAY = ["Accounts Payable", "Payables", "Payables And Accrued Expenses"]
CASH = ["Cash And Cash Equivalents"]
CASHSTI = ["Cash Cash Equivalents And Short Term Investments", "Cash And Cash Equivalents"]
DEBT = ["Total Debt"]
EQ = ["Stockholders Equity", "Common Stock Equity", "Total Equity Gross Minority Interest"]
PPE = ["Net PPE", "Property Plant Equipment"]
IC = ["Invested Capital"]
CFO = ["Operating Cash Flow", "Cash Flow From Continuing Operating Activities"]
CAPEX = ["Capital Expenditure", "Purchase Of PPE"]
FCF = ["Free Cash Flow"]
DEP = ["Depreciation And Amortization", "Depreciation Amortization Depletion", "Reconciled Depreciation"]
DIV = ["Cash Dividends Paid", "Common Stock Dividend Paid"]


def g(d, names):
    if not isinstance(d, dict):
        return None
    for n in names:
        v = d.get(n)
        if isinstance(v, (int, float)) and v == v:
            return float(v)
    return None


def div(a, b, mult=1.0):
    if a is None or b is None or b == 0:
        return None
    return a / b * mult


def sub(a, b):
    return None if a is None or b is None else a - b


def years_of(stmt):
    return sorted(stmt.keys()) if isinstance(stmt, dict) else []


def per_year(f):
    inc, bal, cf = f.get("annual_income") or {}, f.get("annual_balance") or {}, f.get("annual_cashflow") or {}
    ys = sorted(set(inc.keys()) | set(bal.keys()))[-MAXY:]
    rows = []
    for y in ys:
        i, b = inc.get(y) or {}, bal.get(y) or {}
        c = cf.get(y)
        if c is None:  # match cashflow by year if dates differ
            c = next((cf[k] for k in cf if k[:4] == y[:4]), {})
        rows.append((y[:4] if len(y) >= 4 else y, i, b, c or {}))
    return rows


def calc(i, b, c):
    r = {}
    rev, ni = g(i, REV), g(i, NI)
    cogs = g(i, COGS)
    gp = g(i, GP)
    if gp is None and rev is not None and cogs is not None:
        gp = rev - cogs
    if cogs is None and rev is not None and gp is not None:
        cogs = rev - gp
    ebitda, ebit, opi = g(i, EBITDA), g(i, EBIT), g(i, OPINC)
    pbt, tax, intx = g(i, PBT), g(i, TAX), g(i, INTX)
    ta, ca, cl = g(b, TA), g(b, CA), g(b, CL)
    inv, rec, pay = g(b, INV), g(b, REC), g(b, PAY)
    cash, cashsti = g(b, CASH), g(b, CASHSTI)
    debt, eq, ppe, ic = g(b, DEBT), g(b, EQ), g(b, PPE), g(b, IC)
    cfo, capex, fcf, dep, dv = g(c, CFO), g(c, CAPEX), g(c, FCF), g(c, DEP), g(c, DIV)
    if fcf is None and cfo is not None and capex is not None:
        fcf = cfo - abs(capex)
    taxrate = div(tax, pbt)
    if taxrate is None or taxrate < 0 or taxrate > 0.45:
        taxrate = 0.25
    # profitability
    r["gross_margin"] = div(gp, rev, 100)
    r["ebitda_margin"] = div(ebitda, rev, 100)
    r["ebit_margin"] = div(ebit, rev, 100)
    r["operating_margin"] = div(opi, rev, 100)
    r["net_margin"] = div(ni, rev, 100)
    r["roe"] = div(ni, eq, 100)
    r["roa"] = div(ni, ta, 100)
    r["roce"] = div(ebit, sub(ta, cl), 100)
    r["roic"] = div(None if ebit is None else ebit * (1 - taxrate), ic, 100)
    # activity
    r["asset_turnover"] = div(rev, ta)
    r["fixed_asset_turnover"] = div(rev, ppe)
    r["inventory_turnover"] = div(cogs, inv)
    r["inventory_days"] = div(inv, cogs, 365)
    r["receivable_days"] = div(rec, rev, 365)
    r["payable_days"] = div(pay, cogs, 365)
    if None not in (r["inventory_days"], r["receivable_days"], r["payable_days"]):
        r["cash_cycle_days"] = r["inventory_days"] + r["receivable_days"] - r["payable_days"]
    r["working_capital_days"] = div(sub(ca, cl), rev, 365)
    # liquidity
    r["current_ratio"] = div(ca, cl)
    r["quick_ratio"] = div(sub(ca, inv if inv is not None else 0.0), cl) if ca is not None else None
    r["cash_ratio"] = div(cashsti if cashsti is not None else cash, cl)
    r["cfo_to_cl"] = div(cfo, cl)
    # solvency
    r["debt_equity"] = div(debt, eq)
    r["net_debt_equity"] = div(sub(debt, cashsti), eq)
    r["debt_ebitda"] = div(debt, ebitda)
    r["interest_cover"] = div(ebit, abs(intx) if intx else None)
    r["equity_multiplier"] = div(ta, eq)
    r["debt_assets"] = div(debt, ta)
    r["equity_ratio"] = div(eq, ta)
    # cash flow
    r["cfo_to_ni"] = div(cfo, ni)
    r["fcf_margin"] = div(fcf, rev, 100)
    r["fcf_to_ni"] = div(fcf, ni)
    r["capex_to_sales"] = div(abs(capex) if capex is not None else None, rev, 100)
    r["capex_to_dep"] = div(abs(capex) if capex is not None else None, dep)
    # quality / shareholder
    payout = div(abs(dv) if dv is not None else None, ni, 100)
    if payout is not None and ni is not None and ni > 0:
        r["payout"] = payout
        r["retention"] = 100 - payout
        if r["roe"] is not None:
            r["sustainable_growth"] = r["roe"] * (100 - payout) / 100
    r["effective_tax"] = div(tax, pbt, 100) if (pbt and pbt > 0) else None
    # dupont extras
    r["tax_burden"] = div(ni, pbt)
    r["interest_burden"] = div(pbt, ebit)
    raw = {"rev": rev, "ebitda": ebitda, "ebit": ebit, "ni": ni, "eps": g(i, EPS), "ta": ta}
    return r, raw


def yoy(new, old):
    if new is None or old is None or old <= 0 or new < 0 and old > 0 and False:
        return None
    return (new / old - 1) * 100


def cagr(first, last, n):
    if first is None or last is None or first <= 0 or last <= 0 or n < 1:
        return None
    return ((last / first) ** (1 / n) - 1) * 100


SECTIONS_FULL = [
    ("profitability", "Profitability", [
        ("gross_margin", "Gross margin %", "pct"), ("ebitda_margin", "EBITDA margin %", "pct"),
        ("operating_margin", "Operating margin %", "pct"), ("ebit_margin", "EBIT margin %", "pct"),
        ("net_margin", "Net margin %", "pct"), ("roe", "ROE %", "pct"), ("roa", "ROA %", "pct"),
        ("roce", "ROCE %", "pct"), ("roic", "ROIC %", "pct")]),
    ("activity", "Activity (efficiency)", [
        ("asset_turnover", "Asset turnover (x)", "x"), ("fixed_asset_turnover", "Fixed-asset turnover (x)", "x"),
        ("inventory_turnover", "Inventory turnover (x)", "x"), ("inventory_days", "Inventory days", "d"),
        ("receivable_days", "Receivable days", "d"), ("payable_days", "Payable days", "d"),
        ("cash_cycle_days", "Cash conversion cycle (days)", "d"), ("working_capital_days", "Working-capital days", "d")]),
    ("liquidity", "Liquidity", [
        ("current_ratio", "Current ratio (x)", "x"), ("quick_ratio", "Quick ratio (x)", "x"),
        ("cash_ratio", "Cash ratio (x)", "x"), ("cfo_to_cl", "Operating cash flow / current liabilities (x)", "x")]),
    ("solvency", "Solvency (leverage)", [
        ("debt_equity", "Debt / equity (x)", "x"), ("net_debt_equity", "Net debt / equity (x)", "x"),
        ("debt_ebitda", "Debt / EBITDA (x)", "x"), ("interest_cover", "Interest cover (x)", "x"),
        ("debt_assets", "Debt / assets (x)", "x"), ("equity_ratio", "Equity / assets (x)", "x"),
        ("equity_multiplier", "Equity multiplier (x)", "x")]),
    ("cashflow", "Cash flow", [
        ("cfo_to_ni", "Operating cash flow / net profit (x)", "x"), ("fcf_margin", "FCF margin %", "pct"),
        ("fcf_to_ni", "FCF / net profit (x)", "x"), ("capex_to_sales", "Capex / sales %", "pct"),
        ("capex_to_dep", "Capex / depreciation (x)", "x")]),
    ("dupont", "DuPont", [
        ("tax_burden", "Tax burden (NI / PBT)", "x"), ("interest_burden", "Interest burden (PBT / EBIT)", "x"),
        ("ebit_margin", "EBIT margin %", "pct"), ("asset_turnover", "Asset turnover (x)", "x"),
        ("equity_multiplier", "Equity multiplier (x)", "x"), ("roe", "ROE %", "pct")]),
    ("quality", "Quality and shareholder returns", [
        ("payout", "Dividend payout %", "pct"), ("retention", "Retention %", "pct"),
        ("sustainable_growth", "Sustainable growth (ROE x retention) %", "pct"), ("effective_tax", "Effective tax rate %", "pct")]),
]
SECTIONS_FIN = [
    ("profitability", "Profitability", [("net_margin", "Net margin %", "pct"), ("roe", "ROE %", "pct"), ("roa", "ROA %", "pct")]),
    ("solvency", "Leverage", [("equity_multiplier", "Equity multiplier (x)", "x"), ("equity_ratio", "Equity / assets (x)", "x")]),
    ("dupont", "DuPont", [("net_margin", "Net margin %", "pct"), ("asset_turnover", "Asset turnover (x)", "x"),
                          ("equity_multiplier", "Equity multiplier (x)", "x"), ("roe", "ROE %", "pct")]),
    ("quality", "Quality and shareholder returns", [("payout", "Dividend payout %", "pct"), ("retention", "Retention %", "pct"),
                                                    ("sustainable_growth", "Sustainable growth %", "pct")]),
]


def rnd(v, d=2):
    return None if v is None else round(v, d)


def build(sym, f, m):
    typ = (m or {}).get("type", "standard")
    yrs = per_year(f)
    if not yrs:
        return None
    years, per, raws = [], [], []
    for y, i, b, c in yrs:
        r, raw = calc(i, b, c)
        years.append(y); per.append(r); raws.append(raw)
    secs = SECTIONS_FIN if typ == "financial" else SECTIONS_FULL
    sections = []
    for sid, title, items in secs:
        rows = []
        for key, label, fmt in items:
            vals = [rnd(p.get(key)) for p in per]
            if any(v is not None for v in vals):
                rows.append({"key": key, "label": label, "fmt": fmt, "values": vals})
        if rows:
            sections.append({"id": sid, "title": title, "years": years, "rows": rows})
    # growth
    grow = []
    for key, label in (("rev", "Revenue"), ("ebitda", "EBITDA"), ("ebit", "EBIT"), ("ni", "Net profit"), ("eps", "EPS"), ("ta", "Total assets")):
        if typ == "financial" and key in ("ebitda", "ebit"):
            continue
        vals = [None] + [rnd(yoy(raws[k][key], raws[k - 1][key]), 1) for k in range(1, len(raws))]
        cg = cagr(raws[0][key], raws[-1][key], len(raws) - 1)
        if any(v is not None for v in vals) or cg is not None:
            grow.append({"key": "g_" + key, "label": label + " growth % (yoy)", "fmt": "pct", "values": vals, "cagr": rnd(cg, 1)})
    if grow:
        sections.insert(1, {"id": "growth", "title": "Growth", "years": years, "rows": grow})
    # valuation (latest, from metrics + snapshot)
    val = []
    v = (m or {}).get("valuation") or {}
    snap = (m or {}).get("snapshot_cr") or {}
    mcap = v.get("market_cap_cr")
    last = yrs[-1]
    rawrev = g(last[1], REV)
    k = (snap.get("rev") / rawrev) if (rawrev and snap.get("rev")) else None  # raw -> crore scale
    def add(key, label, fmt, value):
        if value is not None:
            val.append({"key": key, "label": label, "fmt": fmt, "value": rnd(value)})
    add("pe", "P/E (x)", "x", v.get("pe_used"))
    add("pb", "P/B (x)", "x", v.get("pb"))
    add("ev_ebitda", "EV / EBITDA (x)", "x", v.get("ev_ebitda"))
    if mcap and snap.get("rev"):
        add("ps", "Price / sales (x)", "x", mcap / snap["rev"])
        cash_raw = g(last[2], CASHSTI)
        debt_cr = snap.get("debt")
        if k and cash_raw is not None and debt_cr is not None and typ != "financial":
            add("ev_sales", "EV / sales (x)", "x", (mcap + debt_cr - cash_raw * k) / snap["rev"])
        dv = g(last[3], DIV)
        if k and dv is not None:
            add("div_yield", "Dividend yield %", "pct", abs(dv) * k / mcap * 100)
    if v.get("pe_used"):
        add("earnings_yield", "Earnings yield %", "pct", 100 / v["pe_used"])
        gr = [x for x in grow if x["key"] == "g_ni"]
        if gr and gr[0]["cagr"] and gr[0]["cagr"] > 0:
            add("peg", "PEG (P/E / profit CAGR)", "x", v["pe_used"] / gr[0]["cagr"])
    add("fcf_yield", "FCF yield %", "pct", v.get("fcf_yield_pct"))
    if val:
        sections.append({"id": "valuation", "title": "Valuation (latest price)", "latest": True, "rows": val})
    # scores
    sc = []
    p = (m or {}).get("piotroski") or {}
    if p.get("score") is not None:
        sc.append({"key": "piotroski", "label": f"Piotroski F-score (of {p.get('tested', 9)} tested)", "fmt": "num", "value": p["score"]})
    a = (m or {}).get("altman_z2") or {}
    if a.get("z") is not None:
        sc.append({"key": "altman", "label": "Altman Z'' (" + str(a.get("zone", "")) + ")", "fmt": "x", "value": a["z"]})
    if sc and typ != "financial":
        sections.append({"id": "scores", "title": "Scores", "latest": True, "rows": sc})
    return {"symbol": sym, "type": typ, "years": years, "sections": sections,
            "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")}


def main():
    os.makedirs(OUT, exist_ok=True)
    done = errs = skipped = 0
    cover = {}
    notes = []
    try:
        for fp in sorted(glob.glob(os.path.join(FUND, "*.json"))):
            sym = os.path.basename(fp)[:-5]
            try:
                with open(fp) as fh:
                    f = json.load(fh)
                mp = os.path.join(MET, sym + ".json")
                m = json.load(open(mp)) if os.path.exists(mp) else {}
                res = build(sym, f, m)
                if not res:
                    skipped += 1
                    continue
                with open(os.path.join(OUT, sym + ".json"), "w") as fh:
                    json.dump(res, fh, separators=(",", ":"))
                done += 1
                for s in res["sections"]:
                    for r in s["rows"]:
                        has = (r.get("value") is not None) if s.get("latest") else (r["values"][-1] is not None)
                        cover[r["key"]] = cover.get(r["key"], 0) + (1 if has else 0)
            except Exception as e:
                errs += 1
                notes.append(f"{sym}: {type(e).__name__} {e}")
    finally:
        with open("data/ratios_check.txt", "w") as fh:
            fh.write(f"Run (UTC): {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d %H:%M}\n")
            fh.write(f"Stocks done: {done} | skipped: {skipped} | errors: {errs}\n")
            fh.write("Coverage (stocks with a latest-year value):\n")
            for k_, n in sorted(cover.items(), key=lambda x: x[1]):
                fh.write(f"  {k_}: {n}\n")
        with open("data/ratios_errors.txt", "w") as fh:
            fh.write("\n".join(notes[:200]) if notes else "No errors")
    print("ratios done", done, skipped, errs)


if __name__ == "__main__":
    main()

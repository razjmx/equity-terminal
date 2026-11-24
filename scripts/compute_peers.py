"""Flatten per-stock metrics + risk + industry tags into one file for the Peers tab and Sector page.
Reads: data/universe.csv, data/industry.csv, data/metrics/SYM.json, data/risk/SYM.json
Writes: data/peers.json  {generated, stocks:[{s,n,mc,pe,pb,ev,roe,roce,nm,de,rg,ng,r1m,r1y,a200,macro,sec,ind}]}"""
import csv, json, os, datetime
D = "data"
def rd(p):
    try:
        return list(csv.DictReader(open(p, newline="", encoding="utf-8")))
    except Exception:
        return []
def js(p):
    try:
        return json.load(open(p))
    except Exception:
        return None
uni = rd(f"{D}/universe.csv")
tags = {r["symbol"]: r for r in rd(f"{D}/industry.csv")}
def last(tb, *names):
    """latest non-null value (rupees -> crore) of the first matching line in a statement table"""
    if not tb:
        return None
    for nm in names:
        for r in tb.get("rows", []):
            if r[0].lower() == nm.lower():
                for v in reversed(r[1]):
                    if v is not None:
                        return v / 1e7
    return None

out = []
for u in uni:
    s = u["symbol"]
    m = js(f"{D}/metrics/{s}.json") or {}
    k = js(f"{D}/risk/{s}.json") or {}
    V, R, G = m.get("valuation") or {}, m.get("ratios") or {}, m.get("growth") or {}
    t = tags.get(s, {})
    st = js(f"{D}/statements/{s}.json") or {}
    ebitda = last(st.get("annual_income"), "EBITDA", "Normalized EBITDA")
    debt = last(st.get("annual_balance"), "Total Debt")
    cash = last(st.get("annual_balance"), "Cash Cash Equivalents And Short Term Investments", "Cash And Cash Equivalents")
    mi = last(st.get("annual_balance"), "Minority Interest") or 0
    nd = None if debt is None and cash is None else (debt or 0) - (cash or 0) + mi
    rec = {"s": s, "n": u.get("company", s), "type": m.get("type"),
           "mc": V.get("market_cap_cr"), "pe": V.get("pe_used"), "pb": V.get("pb"), "ev": V.get("ev_ebitda"),
           "roe": R.get("roe_pct"), "roce": R.get("roce_pct"), "nm": R.get("net_margin_pct"), "de": R.get("debt_equity"),
           "rg": G.get("revenue_cagr_pct"), "ng": G.get("net_income_cagr_pct"),
           "r1m": (k.get("returns_pct") or {}).get("1m"), "r1y": (k.get("returns_pct") or {}).get("1y"),
           "px": k.get("price"), "ebitda": None if ebitda is None else round(ebitda, 1), "nd": None if nd is None else round(nd, 1),
           "a200": 1 if (k.get("trend") or {}).get("above_dma200") else (0 if k.get("trend") else None),
           "macro": t.get("macro") or u.get("industry", ""), "sec": t.get("sector") or u.get("industry", ""),
           "ind": t.get("industry") or t.get("sector") or u.get("industry", "")}
    out.append(rec)
json.dump({"generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M"), "stocks": out}, open(f"{D}/peers.json", "w"), separators=(",", ":"))
print(f"peers.json: {len(out)} stocks")

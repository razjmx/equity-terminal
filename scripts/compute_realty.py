"""Realty NAV and REIT distribution models.
Reads: data/overrides.csv, data/metrics/SYM.json, data/fundamentals/SYM.json (info), data/risk_summary.csv (beta), data/reit_inputs.csv (you fill),
       data/prices/SYM.csv (price fallback), data/realty_inputs.csv (you fill; created blank if missing)
Writes: data/realty/SYM.json, data/realty_summary.csv, data/realty_review.txt, data/realty_errors.txt
"""
import csv, json, os, datetime
RF, ERP, TAX = 0.072, 0.06, 0.25
REIT_G, G_CAP = 0.04, 0.06
D = "data"
IN_COLS = ["symbol", "gdv_cr", "margin_pct", "years", "rental_noi_cr", "cap_rate_pct", "other_assets_cr", "source_note"]

def jload(p):
    try:
        return json.load(open(p))
    except Exception:
        return None

def fnum(x):
    try:
        v = float(x)
        return v if v == v else None
    except Exception:
        return None

def read_csv(p):
    try:
        return list(csv.DictReader(open(p, encoding="utf-8")))
    except Exception:
        return []

def last_close(sym):
    try:
        rows = list(csv.reader(open(f"{D}/prices/{sym}.csv")))
        h = [c.lower() for c in rows[0]]
        i = h.index("close") if "close" in h else h.index("adj close")
        return float(rows[-1][i])
    except Exception:
        return None

def info_of(sym):
    f = jload(f"{D}/fundamentals/{sym}.json") or {}
    return f.get("info") or {}

def betas():
    out = {}
    rows = read_csv(f"{D}/risk_summary.csv")
    if not rows:
        return out
    cols = list(rows[0].keys())
    c = next((k for k in cols if k.lower() == "beta_adj"), None) or next((k for k in cols if "beta" in k.lower()), None)
    if not c:
        return out
    for r in rows:
        b = fnum(r.get(c))
        if b is not None:
            out[r.get("symbol")] = b
    return out

def ke_of(beta):
    b = 1.0 if beta is None else min(1.8, max(0.5, beta))
    return min(0.20, max(0.09, RF + b * ERP))

def main():
    os.makedirs(f"{D}/realty", exist_ok=True)
    ov = read_csv(f"{D}/overrides.csv")
    names = [(r["symbol"], r["type"]) for r in ov if r.get("type") in ("realty", "reit")]
    inp_path = f"{D}/realty_inputs.csv"
    if not os.path.exists(inp_path):
        with open(inp_path, "w", newline="") as fh:
            w = csv.writer(fh); w.writerow(IN_COLS)
            for s, t in names:
                if t == "realty":
                    w.writerow([s, "", "", "", "", "", "", ""])
    inputs = {r["symbol"]: r for r in read_csv(inp_path)}
    reit_path = f"{D}/reit_inputs.csv"
    if not os.path.exists(reit_path):
        with open(reit_path, "w", newline="") as fh:
            w = csv.writer(fh); w.writerow(["symbol", "dps_12m", "g_pct", "nav_per_unit", "source_note"])
            for s_, t_ in names:
                if t_ == "reit":
                    w.writerow([s_, "", "", "", ""])
    reit_in = {r["symbol"]: r for r in read_csv(reit_path)}
    bet = betas()
    errs, summ, review = [], [], []
    for sym, typ in names:
        try:
            m = jload(f"{D}/metrics/{sym}.json")
            if not m:
                errs.append(f"{sym}: no metrics file"); continue
            info = info_of(sym)
            snap, val = m.get("snapshot_cr") or {}, m.get("valuation") or {}
            price = fnum(info.get("currentPrice")) or fnum(info.get("regularMarketPrice")) or last_close(sym)
            mcap = fnum(val.get("market_cap_cr"))
            if not price or not mcap:
                errs.append(f"{sym}: price or market cap missing"); continue
            shares = mcap / price
            debt = fnum(snap.get("debt")) or 0.0
            cash = fnum(info.get("totalCash"))
            cash = cash / 1e7 if cash is not None else None
            netdebt = debt - (cash or 0.0)
            ke = ke_of(bet.get(sym))
            flags = list(m.get("flags") or [])
            if cash is None:
                flags.append("cash not found: net debt = gross debt")
            if sym not in bet:
                flags.append("beta not found: 1.0 used")
            out = {"symbol": sym, "type": typ, "price": price, "shares_cr": round(shares, 3), "ke_pct": round(ke * 100, 2),
                   "net_debt_cr": round(netdebt, 1), "pb": val.get("pb"), "pe_used": val.get("pe_used"),
                   "ev_ebitda": val.get("ev_ebitda"), "market_cap_cr": mcap, "flags": flags,
                   "settings": {"rf": RF, "erp": ERP, "tax": TAX, "reit_g": REIT_G}}
            fair = None
            if typ == "realty":
                r = inputs.get(sym) or {}
                gdv, mg, yrs = fnum(r.get("gdv_cr")), fnum(r.get("margin_pct")), fnum(r.get("years"))
                noi, cap = fnum(r.get("rental_noi_cr")) or 0.0, fnum(r.get("cap_rate_pct"))
                oth = fnum(r.get("other_assets_cr")) or 0.0
                if gdv is not None and mg is not None and yrs is not None:
                    surplus = gdv * mg / 100 * (1 - TAX)
                    pv = surplus / (1 + ke) ** yrs
                    rent = noi / (cap / 100) if noi and cap else 0.0
                    nav = pv + rent + oth - netdebt
                    fair = nav / shares
                    out["nav"] = {"gdv_cr": gdv, "margin_pct": mg, "years": yrs, "surplus_cr": round(surplus, 1),
                                  "pv_projects_cr": round(pv, 1), "rental_value_cr": round(rent, 1), "other_cr": oth,
                                  "net_debt_cr": round(netdebt, 1), "nav_cr": round(nav, 1), "nav_per_share": round(fair, 1),
                                  "note": r.get("source_note", "")}
                else:
                    flags.append("NAV inputs missing: fill data/realty_inputs.csv")
            else:
                ri = reit_in.get(sym) or {}
                dps = fnum(ri.get("dps_12m"))
                g = (fnum(ri.get("g_pct")) / 100) if fnum(ri.get("g_pct")) is not None else REIT_G
                g = min(g, G_CAP)
                navu = fnum(ri.get("nav_per_unit"))
                if fnum(snap.get("fcf")):
                    out["fcf_per_unit"] = round(fnum(snap.get("fcf")) / shares, 2)
                if dps:
                    fair = dps * (1 + g) / (ke - g) if ke > g + 0.01 else None
                    out["reit"] = {"dps": dps, "yield_pct": round(dps / price * 100, 2), "g_pct": round(g * 100, 2),
                                   "fair_value": round(fair, 1) if fair else None, "nav_per_unit": navu,
                                   "p_nav": round(price / navu, 2) if navu else None, "note": ri.get("source_note", "")}
                else:
                    flags.append("distribution missing: fill data/reit_inputs.csv (dps_12m)")
                out["info_dividend_keys"] = {k: info.get(k) for k in info if "ividend" in k or "ield" in k}
            out["fair_value"] = round(fair, 1) if fair else None
            out["upside_pct"] = round((fair / price - 1) * 100, 1) if fair else None
            json.dump(out, open(f"{D}/realty/{sym}.json", "w"), indent=1)
            summ.append([sym, typ, price, out["pb"], out["pe_used"], out["ev_ebitda"], out["ke_pct"], out["net_debt_cr"],
                         out["fair_value"], out["upside_pct"], "; ".join(flags)])
        except Exception as e:
            errs.append(f"{sym}: {e!r}")
    with open(f"{D}/realty_summary.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["symbol", "type", "price", "pb", "pe", "ev_ebitda", "ke_pct", "net_debt_cr", "fair_value", "upside_pct", "flags"])
        w.writerows(summ)
    filled = sum(1 for s in summ if s[8] is not None)
    review = [f"Run (UTC): {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d %H:%M}",
              f"Settings: RF {RF*100:.1f}% | ERP {ERP*100}% | tax {TAX*100}% | REIT g {REIT_G*100}%",
              f"Modelled: {len(summ)} | with fair value: {filled} | errors: {len(errs)}"]
    review += [str(s[:10]) for s in summ]
    for s in names:
        j = jload(f"{D}/realty/{s[0]}.json")
        if j and j.get("type") == "reit":
            review.append(f"{s[0]} dividend keys: {j.get('info_dividend_keys')}")
    open(f"{D}/realty_review.txt", "w").write("\n".join(review))
    open(f"{D}/realty_errors.txt", "w").write("\n".join(errs) or "none")
    print("\n".join(review[:3]), "errors:", errs)

if __name__ == "__main__":
    main()

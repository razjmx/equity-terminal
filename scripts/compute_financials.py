"""P/B-ROE model inputs for financials (banks, NBFCs, insurers, brokers, AMCs).
Reads data/fundamentals, data/metrics (type == financial), data/risk (beta), data/universe.csv, optional data/fin_inputs.csv.
Writes data/fin/SYM.json, data/financials_summary.csv, data/financials_review.txt, data/financials_errors.txt."""
import json, os, glob, csv, math, datetime

FUND, MET, RISK, OUT = "data/fundamentals", "data/metrics", "data/risk", "data/fin"
RF, ERP, G_DEFAULT, KE_MIN, KE_MAX = 0.072, 0.06, 0.065, 0.09, 0.20
NI = ["Net Income Common Stockholders", "Net Income", "Net Income From Continuing Operation Net Minority Interest"]
EQ = ["Stockholders Equity", "Common Stock Equity"]
TA = ["Total Assets"]
DIV = ["Cash Dividends Paid", "Common Stock Dividend Paid"]


def g(d, names):
    if not isinstance(d, dict):
        return None
    for n in names:
        v = d.get(n)
        if isinstance(v, (int, float)) and v == v:
            return float(v)
    return None


def subtype(industry, sym=""):
    s = (industry or "").lower()
    if s:
        if "insur" in s:
            return "Insurance"
        if "non banking" in s or "nbfc" in s:
            return "NBFC"
        if "bank" in s:
            return "Bank"
        if any(k in s for k in ("credit", "mortgage", "lending", "financ", "housing", "conglomerate")):
            return "NBFC"
        return "Other financial"
    u = (sym or "").upper()
    if u.endswith("BANK") or u.endswith("BNK") or u in ("SBIN", "CANBK", "PNB", "IDBI", "UNIONBANK", "CUB", "KARURVYSYA", "RBLBANK", "UCOBANK", "IOB", "MAHABANK", "PSB", "CENTRALBK", "BANKINDIA", "BANKBARODA", "AUBANK", "DCBBANK", "CSBBANK", "J&KBANK", "SOUTHBANK", "TMB", "EQUITASBNK", "UJJIVANSFB", "ESAFSFB", "CAPITALSFB"):
        return "Bank"
    if any(k in u for k in ("LIFE", "INSUR", "GICRE", "NIACL", "ICICIGI", "STARHEALTH", "NIVABUPA", "GODIGIT", "NIA")):
        return "Insurance"
    return "NBFC" if any(k in u for k in ("FIN", "HFL", "HOME", "CAPITAL", "CREDIT")) else "Other financial"


def read_csv(path):
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def pick_scale(ratio):
    best, bs = None, 1
    for s in (1, 1e3, 1e5, 1e6, 1e7, 1e9):
        d = abs(math.log(ratio / s))
        if best is None or d < best:
            best, bs = d, s
    return bs


def num(x):
    try:
        v = float(x)
        return v if v == v else None
    except Exception:
        return None


def ke_for(beta):
    b = min(1.8, max(0.5, beta if beta else 1.0))
    return min(KE_MAX, max(KE_MIN, RF + b * ERP)), b


def build(sym, f, m, rk, ind, ov):
    info = f.get("info") or {}
    inc, bal, cf = f.get("annual_income") or {}, f.get("annual_balance") or {}, f.get("annual_cashflow") or {}
    qi = f.get("quarterly_income") or {}
    flags = []
    price = num(info.get("currentPrice")) or num(info.get("regularMarketPrice"))
    bvps = num(info.get("bookValue"))
    shares = num(info.get("sharesOutstanding"))
    ys = sorted(set(inc.keys()) & set(bal.keys()))[-4:]
    fy = []
    for y in ys:
        ni, eq, ta = g(inc[y], NI), g(bal[y], EQ), g(bal[y], TA)
        fy.append({"year": y[:4], "ni": ni, "eq": eq, "ta": ta,
                   "roe": (ni / eq * 100) if (ni is not None and eq) else None,
                   "roa": (ni / ta * 100) if (ni is not None and ta) else None})
    if not fy or fy[-1]["eq"] is None:
        return None, "no statements"
    # equity cross-check and scale
    last_eq = fy[-1]["eq"]
    eq_ratio, scale = None, 1
    if bvps and shares:
        implied = bvps * shares
        scale = pick_scale(implied / last_eq) if last_eq > 0 else 1
        eq_ratio = implied / (last_eq * scale)
    stmt_over = eq_ratio is not None and eq_ratio < 0.85
    if stmt_over:
        flags.append(f"statement equity looks overstated vs Yahoo book value (info/statement = {eq_ratio:.2f})")
    elif eq_ratio is not None and eq_ratio > 1.25:
        flags.append(f"Yahoo book value well above last statement equity ({eq_ratio:.2f}x), later quarter or data gap")
    # TTM profit
    qs = sorted(qi.keys())[-4:] if qi else []
    ttm = None
    if len(qs) == 4:
        vals = [g(qi[q], NI) for q in qs]
        if all(v is not None for v in vals):
            ttm = sum(vals)
    roe_ttm = None
    if ttm is not None and bvps and shares:
        roe_ttm = ttm / (bvps * shares / scale) * 100
    roes = [x["roe"] for x in fy if x["roe"] is not None]
    roe_avg3 = sum(roes[-3:]) / len(roes[-3:]) if roes else None
    basis = "3-year average ROE"
    roe_used = roe_avg3
    if stmt_over and roe_ttm is not None:
        roe_used, basis = roe_ttm, "TTM profit / Yahoo book value (statement equity overstated)"
    elif roe_used is None and roe_ttm is not None:
        roe_used, basis = roe_ttm, "TTM profit / Yahoo book value"
    # payout and sustainable growth
    payout = None
    for y in reversed(ys):
        dv, ni = g(cf.get(y) if y in cf else next((cf[k] for k in cf if k[:4] == y[:4]), {}), DIV), g(inc[y], NI)
        if dv is not None and ni and ni > 0:
            payout = min(1.0, abs(dv) / ni)
            break
    beta = None
    if rk:
        beta = ((rk.get("beta") or {}).get("adjusted"))
    if ov.get("beta_pct") is not None:
        pass
    inputs_note = []
    if ov.get("roe_pct") is not None:
        roe_used, basis = ov["roe_pct"], "override (fin_inputs.csv)"
    if ov.get("bvps") is not None:
        bvps = ov["bvps"]; inputs_note.append("bvps override")
    yind = info.get("industry") or info.get("sector") or ind
    sub = subtype(yind, sym)
    if sub == "Insurance":
        flags.append("insurer: P/B-ROE is indicative only (embedded value / VNB not available)")
    if sub == "Other financial":
        flags.append("asset-light financial: P/B-ROE is indicative; consider P/E")
    if roe_used is not None and roe_used > 30:
        flags.append("very high ROE: Gordon P/B will look low vs market; check fade assumptions")
    if roe_used is not None and roe_used < 0:
        flags.append("negative ROE: model not meaningful")
    if len([x for x in fy if x["roe"] is not None]) < 3:
        flags.append("fewer than 3 years of ROE")
    ke, bu = ke_for(beta)
    g_used = G_DEFAULT
    sust = (roe_used / 100 * (1 - payout)) if (roe_used is not None and payout is not None) else None
    if sust is not None and sust > 0:
        g_used = min(G_DEFAULT, sust)
    fair_pb = fair = up = impl_roe = None
    pb = (price / bvps) if (price and bvps) else None
    if roe_used is not None and roe_used > 0 and bvps:
        r = roe_used / 100
        if ke > g_used:
            fair_pb = max(0.0, (r - g_used) / (ke - g_used))
            fair = fair_pb * bvps
            up = (fair / price - 1) * 100 if price else None
        if pb is not None:
            impl_roe = (g_used + pb * (ke - g_used)) * 100
    bv_growth = None
    if len(fy) >= 2 and fy[0]["eq"] and fy[-1]["eq"] and fy[0]["eq"] > 0 and fy[-1]["eq"] > 0:
        bv_growth = ((fy[-1]["eq"] / fy[0]["eq"]) ** (1 / (len(fy) - 1)) - 1) * 100
    out = {
        "symbol": sym, "subtype": sub, "industry": ind, "yahoo_industry": yind, "price": price, "bvps": bvps, "pb": pb,
        "roe_used_pct": roe_used, "roe_basis": basis, "roe_ttm_pct": roe_ttm, "roe_avg3_pct": roe_avg3,
        "fy": [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in x.items() if k in ("year", "roe", "roa")} for x in fy],
        "payout_pct": None if payout is None else payout * 100, "sustainable_growth_pct": None if sust is None else sust * 100,
        "bv_cagr_pct": bv_growth, "beta_adj": beta, "beta_used": bu, "equity_check_ratio": eq_ratio,
        "model": {"roe_pct": roe_used, "bvps": bvps, "beta": bu, "g_cap_pct": None if sust is None else sust * 100},
        "result": {"ke_pct": ke * 100, "g_pct": g_used * 100, "fair_pb": fair_pb, "fair_value": fair, "upside_pct": up, "implied_roe_pct": impl_roe},
        "flags": flags + inputs_note, "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")}
    return out, None


def rr(v, d=2):
    return "" if v is None else round(v, d)


def main():
    os.makedirs(OUT, exist_ok=True)
    uni = {r["symbol"]: r for r in read_csv("data/universe.csv")}
    ovr = {r["symbol"]: {"roe_pct": num(r.get("roe_pct")), "bvps": num(r.get("bvps"))} for r in read_csv("data/fin_inputs.csv")}
    rows, notes, done = [], [], 0
    try:
        for fp in sorted(glob.glob(os.path.join(MET, "*.json"))):
            sym = os.path.basename(fp)[:-5]
            try:
                m = json.load(open(fp))
                if m.get("type") != "financial":
                    continue
                f = json.load(open(os.path.join(FUND, sym + ".json")))
                rp = os.path.join(RISK, sym + ".json")
                rk = json.load(open(rp)) if os.path.exists(rp) else None
                res, why = build(sym, f, m, rk, (uni.get(sym) or {}).get("industry", ""), ovr.get(sym, {}))
                if res is None:
                    notes.append(f"{sym}: skipped ({why})")
                    continue
                json.dump(res, open(os.path.join(OUT, sym + ".json"), "w"), separators=(",", ":"))
                r = res["result"]
                rows.append({"symbol": sym, "subtype": res["subtype"], "yahoo_industry": res.get("yahoo_industry") or "", "price": rr(res["price"]), "bvps": rr(res["bvps"]), "pb": rr(res["pb"]),
                             "roe_pct": rr(res["roe_used_pct"], 1), "roe_basis": res["roe_basis"], "beta": rr(res["beta_used"]),
                             "ke_pct": rr(r["ke_pct"], 2), "g_pct": rr(r["g_pct"], 2), "fair_pb": rr(r["fair_pb"]), "fair_value": rr(r["fair_value"], 1),
                             "upside_pct": rr(r["upside_pct"], 1), "implied_roe_pct": rr(r["implied_roe_pct"], 1),
                             "bv_cagr_pct": rr(res["bv_cagr_pct"], 1), "g_cap_pct": rr(res["model"]["g_cap_pct"], 2), "flags": "; ".join(res["flags"])})
                done += 1
            except Exception as e:
                notes.append(f"{sym}: {type(e).__name__} {e}")
    finally:
        cols = ["symbol", "subtype", "yahoo_industry", "price", "bvps", "pb", "roe_pct", "roe_basis", "beta", "ke_pct", "g_pct", "fair_pb", "fair_value", "upside_pct", "implied_roe_pct", "bv_cagr_pct", "g_cap_pct", "flags"]
        with open("data/financials_summary.csv", "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=cols)
            w.writeheader()
            w.writerows(rows)
        ups = [float(r["upside_pct"]) for r in rows if r["upside_pct"] != ""]
        with open("data/financials_review.txt", "w") as fh:
            fh.write(f"Run (UTC): {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d %H:%M}\n")
            fh.write(f"Settings: RF {RF*100:.1f}% | ERP {ERP*100:.1f}% | g cap {G_DEFAULT*100:.1f}% | Ke clamp {KE_MIN*100:.0f}-{KE_MAX*100:.0f}%\n")
            fh.write(f"Financials modelled: {done} | with fair value: {len(ups)} | notes/errors: {len(notes)}\n")
            if ups:
                ups.sort()
                fh.write(f"Median upside: {ups[len(ups)//2]:.1f}%\n")
            fh.write("By subtype: " + str({s: sum(1 for r in rows if r['subtype'] == s) for s in set(r['subtype'] for r in rows)}) + "\n")
            fh.write("Yahoo industries seen: " + str({k: sum(1 for r in rows if r['yahoo_industry'] == k) for k in sorted(set(r['yahoo_industry'] for r in rows))}) + "\n")
            fh.write("Other financial list: " + str([(r['symbol'], r['yahoo_industry']) for r in rows if r['subtype'] == 'Other financial']) + "\n")
            fh.write("Flagged: " + str([(r['symbol'], r['flags'][:70]) for r in rows if r['flags']][:25]) + "\n")
            fh.write("Sample [symbol, price, bvps, pb, roe, ke, g, fair_pb, fair, upside, implied_roe]:\n")
            for r in rows[:40]:
                fh.write(str([r["symbol"], r["price"], r["bvps"], r["pb"], r["roe_pct"], r["ke_pct"], r["g_pct"], r["fair_pb"], r["fair_value"], r["upside_pct"], r["implied_roe_pct"]]) + "\n")
        with open("data/financials_errors.txt", "w") as fh:
            fh.write("\n".join(notes) if notes else "No errors")
    print("financials done", done, len(notes))


if __name__ == "__main__":
    main()

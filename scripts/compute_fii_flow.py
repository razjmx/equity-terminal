"""FII / FPI holding change by stock and by sector -> data/fii_flow.json

Source: the quarterly shareholding filings already stored in data/shareholding/SYM.json (FII/FPI % of shares).
For each stock: latest quarter vs the one before. Estimated value moved = change in holding (percentage points) x market cap.
This is QUARTERLY (filings arrive up to 3 weeks after quarter end), it is the change in the share of the company held, not the
rupees invested: price moves are not netted out, and market cap is today's. Sector figures add the estimates of the stocks in
each NSE group (data/industry.csv macro) and give the market-cap-weighted average change in holding.
Writes data/fii_flow.json and data/fii_flow_log.txt"""
import csv, datetime, json, os
from collections import Counter

syms = [r["symbol"] for r in csv.DictReader(open("data/universe.csv", newline="")) if not r["symbol"].startswith("DUMMY")]
ind = {}
if os.path.exists("data/industry.csv"):
    for r in csv.DictReader(open("data/industry.csv", newline="")):
        ind[r["symbol"]] = r
rows, lab = [], {}
for s in syms:
    try:
        q = [x for x in json.load(open(f"data/shareholding/{s}.json")).get("quarters", []) if x.get("fii") is not None]
    except Exception:
        continue
    if len(q) < 2:
        continue
    try:
        mc = (json.load(open(f"data/metrics/{s}.json")).get("valuation") or {}).get("market_cap_cr")
    except Exception:
        mc = None
    rows.append((s, q, mc))
# the latest quarter most stocks have reported
cnt = Counter(q[-1]["date"] for _, q, _ in rows)
if not cnt:
    open("data/fii_flow_log.txt", "w").write("no shareholding data with FII figures\n"); raise SystemExit
latest = cnt.most_common(1)[0][0]
out, skipped = [], 0
for s, q, mc in rows:
    ds = [x["date"] for x in q]
    if latest not in ds:
        skipped += 1; continue
    i = ds.index(latest)
    if i == 0:
        skipped += 1; continue
    a, b = q[i], q[i - 1]
    d = round(a["fii"] - b["fii"], 2)
    mcv = mc if isinstance(mc, (int, float)) and mc > 0 else None
    out.append({"s": s, "fii": round(a["fii"], 2), "prev": round(b["fii"], 2), "d": d, "cr": round(d / 100 * mcv, 0) if mcv else None,
                "mc": round(mcv, 0) if mcv else None, "m": ind.get(s, {}).get("macro", ""), "lab": a.get("label"), "plab": b.get("label")})
sec = {}
for x in out:
    k = x["m"] or "Other"
    o = sec.setdefault(k, {"k": k, "n": 0, "cr": 0.0, "w": 0.0, "dw": 0.0, "up": 0, "dn": 0, "fw": 0.0})
    o["n"] += 1
    if x["cr"] is not None:
        o["cr"] += x["cr"]; o["w"] += x["mc"]; o["dw"] += x["d"] * x["mc"]; o["fw"] += x["fii"] * x["mc"]
    if x["d"] > 0.05: o["up"] += 1
    if x["d"] < -0.05: o["dn"] += 1
secs = [{"k": o["k"], "n": o["n"], "cr": round(o["cr"], 0), "d": round(o["dw"] / o["w"], 2) if o["w"] else None,
         "fii": round(o["fw"] / o["w"], 1) if o["w"] else None, "up": o["up"], "dn": o["dn"]} for o in sec.values() if o["n"] >= 2]
secs.sort(key=lambda z: -(z["cr"] or 0))
lab_a = Counter(x["lab"] for x in out).most_common(1)[0][0]; lab_b = Counter(x["plab"] for x in out).most_common(1)[0][0]
json.dump({"quarter": latest, "label": lab_a, "prev_label": lab_b, "n": len(out), "stocks": out, "sectors": secs,
           "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")}, open("data/fii_flow.json", "w"), separators=(",", ":"))
open("data/fii_flow_log.txt", "w").write(f"quarter {lab_a} vs {lab_b}\nstocks with a comparison {len(out)}, skipped {skipped} (no filing for that quarter yet)\nsectors {len(secs)}\n")
print(open("data/fii_flow_log.txt").read())

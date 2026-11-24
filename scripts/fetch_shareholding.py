"""NSE shareholding pattern -> data/shareholding/SYM.json (last 6 quarters).
Step 1: NSE summary API gives promoter % and total public %.
Step 2: each quarter's detailed NSE filing (XBRL) gives foreign institutions (FII/FPI) and domestic institutions (DII).
        Public (retail and others) = total public - FII - DII.
Quarters already parsed in an earlier run are reused, so later runs only download new quarters.
Env: LIMIT=N for a test run. Writes data/shareholding_log.txt."""
import csv, json, os, time, datetime, requests
import xml.etree.ElementTree as ET

OUT = "data/shareholding"
os.makedirs(OUT, exist_ok=True)
LIMIT = int(os.environ.get("LIMIT", "0") or 0)
ONLY_NEW = os.environ.get("ONLY_NEW", "") in ("1", "true", "True")
NQ = 6
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
     "Accept": "application/json,text/plain,*/*", "Accept-Language": "en-US,en;q=0.9", "Referer": "https://www.nseindia.com/"}
HOME = "https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern"
API = "https://www.nseindia.com/api/corporate-share-holdings-master"
now = datetime.datetime.utcnow()
log = [f"Run (UTC): {now:%Y-%m-%d %H:%M}"]
PCT = "ShareholdingAsAPercentageOfTotalNumberOfShares"

def new_session():
    s = requests.Session(); s.headers.update(H)
    try:
        s.get(HOME, timeout=25)
    except Exception as e:
        log.append(f"session: {e!r}")
    return s

def num(x):
    try:
        return float(x)
    except Exception:
        return None

def iso(d):
    try:
        return datetime.datetime.strptime(d.title(), "%d-%b-%Y").strftime("%Y-%m-%d")
    except Exception:
        return None

def parse_xbrl(content):
    """-> {"promoter":%, "fii":%, "dii":%} from a detailed filing, or None"""
    root = ET.fromstring(content)
    ctx = {}
    for c in root.iter():
        if c.tag.endswith("}context"):
            dims = [m for m in c.iter() if m.tag.endswith("explicitMember")]
            if len(dims) == 1 and dims[0].get("dimension", "").endswith("CategoryOfShareholdersAxis"):
                ctx[c.get("id")] = (dims[0].text or "").strip().split(":")[-1]
    want = {"ShareholdingOfPromoterAndPromoterGroupMember": "promoter", "InstitutionsForeignMember": "fii", "InstitutionsDomesticMember": "dii"}
    got = {}
    for f in root.iter():
        if f.tag.split("}")[-1] == PCT:
            m = ctx.get(f.get("contextRef"))
            if m in want and want[m] not in got:
                v = num((f.text or "").strip())
                if v is not None:
                    got[want[m]] = v
    return got or None

syms = [r["symbol"] for r in csv.DictReader(open("data/universe.csv", newline=""))]
if LIMIT:
    syms = syms[:LIMIT]
s = new_session(); ok = bad = xb = xbad = 0
for i, sym in enumerate(syms):
    if ONLY_NEW and os.path.exists(f"{OUT}/{sym}.json"):
        continue
    if i and i % 60 == 0:
        s = new_session()
    data = None
    for attempt in range(3):
        try:
            r = s.get(API, params={"index": "equities", "symbol": sym}, timeout=25)
            if r.status_code == 200:
                data = r.json(); break
            if r.status_code in (401, 403):
                time.sleep(2); s = new_session()
        except Exception:
            time.sleep(1.5)
    if not isinstance(data, list) or not data:
        bad += 1; log.append(f"{sym}: no data"); time.sleep(0.5); continue
    old = {}
    try:
        for q in json.load(open(f"{OUT}/{sym}.json")).get("quarters", []):
            if q.get("fii") is not None:
                old[q["date"]] = q
    except Exception:
        pass
    qs = {}
    for q in data:
        d = iso(q.get("date") or "")
        if not d:
            continue
        pr, pu = num(q.get("pr_and_prgrp")), num(q.get("public_val"))
        if pr is None and pu is None:
            continue
        qs[d] = {"date": d, "label": datetime.datetime.strptime(d, "%Y-%m-%d").strftime("%b %y"), "promoter": pr, "public": pu,
                 "public_total": pu, "fii": None, "dii": None, "xbrl": q.get("xbrl")}
    arr = [qs[k] for k in sorted(qs)][-NQ:]
    for q in arr:
        if q["date"] in old:
            q.update({k: old[q["date"]].get(k) for k in ("promoter", "fii", "dii", "public")})
            continue
        if not q.get("xbrl"):
            continue
        try:
            r = s.get(q["xbrl"], timeout=40, headers={"Accept": "*/*"})
            if r.status_code == 403 or r.status_code == 401:
                s = new_session(); r = s.get(q["xbrl"], timeout=40, headers={"Accept": "*/*"})
            if r.status_code == 200:
                g = parse_xbrl(r.content)
                if g:
                    # filings differ: some give decimals (0.59), older ones give percent (59.2). Detect the scale.
                    rp, qp = g.get("promoter"), q["promoter"]
                    if rp is not None and qp is not None and (rp > 0 or qp > 0):
                        k = 100 if abs(rp * 100 - qp) <= abs(rp - qp) else 1
                    else:
                        k = 100 if (g.get("fii", 0) + g.get("dii", 0) + (rp or 0)) <= 1.05 else 1
                    g = {a: round(b * k, 2) for a, b in g.items()}
                if g and g.get("fii") is not None and g.get("dii") is not None:
                    pr = g.get("promoter", q["promoter"] if q["promoter"] is not None else 0)
                    tot = (pr or 0) + g["fii"] + g["dii"]
                    if tot <= 100.6:
                        q["promoter"] = pr; q["fii"] = g["fii"]; q["dii"] = g["dii"]
                        q["public"] = round(max(0, 100 - tot), 2)
                        xb += 1
                    else:
                        xbad += 1; log.append(f"{sym} {q['date']}: parts sum {tot:.1f}%, ignored")
                else:
                    xbad += 1; log.append(f"{sym} {q['date']}: no FII/DII in filing")
            else:
                xbad += 1; log.append(f"{sym} {q['date']}: filing HTTP {r.status_code}")
        except Exception as e:
            xbad += 1; log.append(f"{sym} {q['date']}: {e!r}")
        time.sleep(0.4)
    if arr:
        json.dump({"fetched": f"{now:%Y-%m-%d}", "quarters": arr}, open(f"{OUT}/{sym}.json", "w"), separators=(",", ":"))
        ok += 1
    else:
        bad += 1; log.append(f"{sym}: no quarters")
    time.sleep(0.4)
    if (i + 1) % 25 == 0:
        print(f"{i+1}/{len(syms)} stocks, {xb} filings parsed", flush=True)
log.append(f"Stocks saved {ok}, failed {bad}, of {len(syms)}. Filings parsed {xb}, problems {xbad}")
open("data/shareholding_log.txt", "w").write("\n".join(log[:400]) + "\n")
print("\n".join(log[-4:]))

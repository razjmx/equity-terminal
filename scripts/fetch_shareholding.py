"""NSE shareholding pattern -> data/shareholding/SYM.json (promoter % and public % per quarter, last 8).
Also saves one detailed NSE filing (XBRL) for two stocks to data/xbrl_probe.txt so the FII / DII split can be parsed next.
Env: LIMIT=N for a test run. Polite pauses; refreshes the NSE session cookie regularly."""
import csv, json, os, time, datetime, requests
import xml.etree.ElementTree as ET

OUT = "data/shareholding"
os.makedirs(OUT, exist_ok=True)
LIMIT = int(os.environ.get("LIMIT", "0") or 0)
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
     "Accept": "application/json,text/plain,*/*", "Accept-Language": "en-US,en;q=0.9", "Referer": "https://www.nseindia.com/"}
HOME = "https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern"
API = "https://www.nseindia.com/api/corporate-share-holdings-master"
now = datetime.datetime.utcnow()
log = [f"Run (UTC): {now:%Y-%m-%d %H:%M}"]

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

syms = [r["symbol"] for r in csv.DictReader(open("data/universe.csv", newline=""))]
if LIMIT:
    syms = syms[:LIMIT]
s = new_session(); ok = bad = 0; probe = []
for i, sym in enumerate(syms):
    if i and i % 80 == 0:
        s = new_session()
    data = None
    for attempt in range(3):
        try:
            r = s.get(API, params={"index": "equities", "symbol": sym}, timeout=25)
            if r.status_code == 200:
                data = r.json(); break
            if r.status_code in (401, 403):
                time.sleep(2); s = new_session()
        except Exception as e:
            time.sleep(1.5)
    if not isinstance(data, list) or not data:
        bad += 1; log.append(f"{sym}: no data"); time.sleep(0.5); continue
    qs = {}
    for q in data:
        d = iso(q.get("date") or "")
        if not d:
            continue
        pr, pu = num(q.get("pr_and_prgrp")), num(q.get("public_val"))
        if pr is None and pu is None:
            continue
        qs[d] = {"date": d, "label": datetime.datetime.strptime(d, "%Y-%m-%d").strftime("%b %y"), "promoter": pr, "public": pu,
                 "emp": num(q.get("employeeTrusts")), "fii": None, "dii": None, "xbrl": q.get("xbrl")}
    arr = [qs[k] for k in sorted(qs)][-8:]
    if arr:
        json.dump({"fetched": f"{now:%Y-%m-%d}", "quarters": arr}, open(f"{OUT}/{sym}.json", "w"), separators=(",", ":"))
        ok += 1
        if (sym in ("HDFCBANK", "RELIANCE") or len(probe) < 1) and arr[-1].get("xbrl"):
            probe.append((sym, arr[-1]["xbrl"]))
    else:
        bad += 1; log.append(f"{sym}: no quarters")
    time.sleep(0.5)
log.append(f"Saved {ok}, failed {bad}, of {len(syms)}")
open("data/shareholding_log.txt", "w").write("\n".join(log) + "\n")

# ---- XBRL probe: what does a detailed filing contain? ----
lines = []
for sym, url in probe:
    lines.append(f"=== {sym} {url}")
    try:
        r = s.get(url, timeout=40, headers={"Accept": "*/*"})
        lines.append(f"HTTP {r.status_code}, {len(r.content)} bytes")
        if r.status_code == 200:
            root = ET.fromstring(r.content)
            ctx = {}
            for c in root.iter():
                if c.tag.endswith("}context"):
                    mem = [(m.get("dimension", "").split(":")[-1], (m.text or "").strip()) for m in c.iter() if m.tag.endswith("explicitMember") or m.tag.endswith("typedMember")]
                    ctx[c.get("id")] = ";".join(f"{a}={b}" for a, b in mem) or "(no dimension)"
            lines.append(f"contexts: {len(ctx)}")
            n = 0
            for f in root.iter():
                t = f.tag.split("}")[-1]
                ref = f.get("contextRef")
                v = (f.text or "").strip()
                if ref and v and ("Percentage" in t or "ShareholdingAs" in t or "NumberOfShares" in t) and n < 140:
                    lines.append(f"{ctx.get(ref, ref)[:90]} | {t} | {v[:20]}"); n += 1
    except Exception as e:
        lines.append(f"failed {e!r}")
open("data/xbrl_probe.txt", "w").write("\n".join(lines)[:20000] + "\n")
print("\n".join(log[-3:]))

"""NSE industry classification (4 levels) for every stock in data/universe.csv -> data/industry.csv
Columns: symbol, macro, sector, industry, basic_industry.   Source: NSE quote data (industryInfo).
Env: LIMIT=N for a test. Existing rows are kept if NSE fails for a stock. Writes data/industry_log.txt."""
import csv, os, time, datetime, requests

LIMIT = int(os.environ.get("LIMIT", "0") or 0)
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
     "Accept": "application/json,text/plain,*/*", "Accept-Language": "en-US,en;q=0.9", "Referer": "https://www.nseindia.com/"}
HOME = "https://www.nseindia.com/get-quotes/equity?symbol=RELIANCE"
API = "https://www.nseindia.com/api/quote-equity"
log = [f"Run (UTC): {datetime.datetime.utcnow():%Y-%m-%d %H:%M}"]

def new_session():
    s = requests.Session(); s.headers.update(H)
    try:
        s.get(HOME, timeout=25)
    except Exception as e:
        log.append(f"session: {e!r}")
    return s

old = {}
if os.path.exists("data/industry.csv"):
    for r in csv.DictReader(open("data/industry.csv", newline="")):
        old[r["symbol"]] = r
syms = [r["symbol"] for r in csv.DictReader(open("data/universe.csv", newline=""))]
if LIMIT:
    syms = syms[:LIMIT]
s = new_session(); rows = {}; ok = bad = 0; shown = 0
for i, sym in enumerate(syms):
    if i and i % 60 == 0:
        s = new_session()
    info = None
    for attempt in range(3):
        try:
            s.headers["Referer"] = f"https://www.nseindia.com/get-quotes/equity?symbol={sym}"
            r = s.get(API, params={"symbol": sym}, timeout=25)
            if r.status_code == 200:
                j = r.json()
                info = j.get("industryInfo") or None
                if not info and shown < 2:
                    log.append(f"{sym}: 200 but no industryInfo. keys={list(j.keys())[:12]}"); shown += 1
                break
            if r.status_code in (401, 403):
                time.sleep(2); s = new_session()
        except Exception:
            time.sleep(1.5)
    if info and (info.get("sector") or info.get("industry")):
        rows[sym] = {"symbol": sym, "macro": info.get("macro") or "", "sector": info.get("sector") or "",
                     "industry": info.get("industry") or "", "basic_industry": info.get("basicIndustry") or ""}
        ok += 1
    else:
        bad += 1
        if sym in old:
            rows[sym] = old[sym]
        log.append(f"{sym}: no classification")
    time.sleep(0.5)
    if (i + 1) % 50 == 0:
        print(f"{i+1}/{len(syms)} done", flush=True)
# keep rows for symbols not in this (limited) run
for k, v in old.items():
    rows.setdefault(k, v)
with open("data/industry.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["symbol", "macro", "sector", "industry", "basic_industry"])
    w.writeheader()
    for k in sorted(rows):
        w.writerow({c: rows[k].get(c, "") for c in w.fieldnames})
log.append(f"Classified {ok}, failed {bad}, of {len(syms)}. Distinct sectors: {len({r['sector'] for r in rows.values() if r.get('sector')})}, industries: {len({r['industry'] for r in rows.values() if r.get('industry')})}")
open("data/industry_log.txt", "w").write("\n".join(log[:300]) + "\n")
print("\n".join(log[-4:]))

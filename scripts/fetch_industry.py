"""Industry classification for every stock in data/universe.csv -> data/industry.csv
Columns: symbol, macro, sector, industry, basic_industry
  macro    = NSE's own industry from the published Nifty 500 list (reliable, ~20 groups)
  sector   = Yahoo Finance sector   (~11 groups)
  industry = Yahoo Finance industry (~100+ finer groups, used for peers)
(NSE's quote API blocks GitHub Actions, so the 4-level NSE tags are not available; basic_industry stays empty.)
Env: LIMIT=N for a test. Existing rows are kept if a lookup fails. Writes data/industry_log.txt."""
import csv, io, os, time, datetime, requests
import yfinance as yf

LIMIT = int(os.environ.get("LIMIT", "0") or 0)
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"}
log = [f"Run (UTC): {datetime.datetime.utcnow():%Y-%m-%d %H:%M}"]

old = {}
if os.path.exists("data/industry.csv"):
    for r in csv.DictReader(open("data/industry.csv", newline="")):
        old[r["symbol"]] = r
syms = [r["symbol"] for r in csv.DictReader(open("data/universe.csv", newline=""))]
if LIMIT:
    syms = syms[:LIMIT]

lst = {}
for u in ("https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv",
          "https://archives.nseindia.com/content/indices/ind_nifty500list.csv"):
    try:
        r = requests.get(u, headers=H, timeout=30)
        if r.status_code == 200 and "Symbol" in r.text[:300]:
            for x in csv.DictReader(io.StringIO(r.text)):
                lst[x["Symbol"].strip()] = (x.get("Industry") or "").strip()
            log.append(f"Nifty 500 list: {len(lst)} rows")
            break
        log.append(f"Nifty 500 list {u}: HTTP {r.status_code}")
    except Exception as e:
        log.append(f"Nifty 500 list {u}: {e!r}"[:200])

rows = {}; ok = part = bad = 0
for i, sym in enumerate(syms):
    sec = ind = ""
    for attempt in range(2):
        try:
            info = yf.Ticker(sym + ".NS").info or {}
            sec = info.get("sector") or ""; ind = info.get("industry") or ""
            if sec or ind:
                break
        except Exception as e:
            if attempt:
                log.append(f"{sym}: yahoo {e!r}"[:160])
            time.sleep(1.5)
    prev = old.get(sym, {})
    macro = lst.get(sym) or prev.get("macro", "")
    sec = sec or prev.get("sector", ""); ind = ind or prev.get("industry", "")
    if macro or sec or ind:
        rows[sym] = {"symbol": sym, "macro": macro, "sector": sec or macro, "industry": ind or sec or macro, "basic_industry": ""}
        if sec and ind:
            ok += 1
        else:
            part += 1; log.append(f"{sym}: Yahoo had no sector/industry, used NSE group")
    else:
        bad += 1; log.append(f"{sym}: no classification")
    time.sleep(0.3)
    if (i + 1) % 50 == 0:
        print(f"{i+1}/{len(syms)} done", flush=True)
for k, v in old.items():
    rows.setdefault(k, v)
with open("data/industry.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["symbol", "macro", "sector", "industry", "basic_industry"])
    w.writeheader()
    for k in sorted(rows):
        w.writerow({c: rows[k].get(c, "") for c in w.fieldnames})
d = lambda c: len({r[c] for r in rows.values() if r.get(c)})
log.append(f"Full {ok}, partial {part}, none {bad}, of {len(syms)}. Distinct: NSE groups {d('macro')}, Yahoo sectors {d('sector')}, Yahoo industries {d('industry')}")
open("data/industry_log.txt", "w").write("\n".join(log[:300]) + "\n")
print("\n".join(log[-4:]))

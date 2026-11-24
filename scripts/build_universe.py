"""Build data/universe.csv = Nifty 500 + Nifty Microcap 250 (about 750 stocks), from NSE's official constituent lists.
Columns: symbol,company,industry,isin,yahoo,index   (index = nifty500 | microcap250)
Safety: if either list cannot be downloaded or looks wrong, the existing universe.csv is left untouched.
Writes data/universe_log.txt (what was added, what left)."""
import csv, io, os, datetime, requests

H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"}
HOSTS = ("https://nsearchives.nseindia.com/content/indices/", "https://archives.nseindia.com/content/indices/")
LISTS = {"nifty500": (["ind_nifty500list.csv"], 450, 550),
         "microcap250": (["ind_niftymicrocap250_list.csv", "ind_niftymicrocap250list.csv"], 200, 300)}
log = ["Run (UTC): " + datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M")]


def fetch(names):
    for fn in names:
        for h in HOSTS:
            try:
                r = requests.get(h + fn, headers=H, timeout=40)
                if r.status_code == 200 and "Symbol" in r.text[:500]:
                    return list(csv.DictReader(io.StringIO(r.text.lstrip("﻿"))))
                log.append(f"{fn} @ {h.split('/')[2]}: HTTP {r.status_code}")
            except Exception as e:
                log.append(f"{fn} @ {h.split('/')[2]}: {e!r}"[:160])
    return None


rows, seen, ok = [], set(), True
for idx, (names, lo, hi) in LISTS.items():
    data = fetch(names)
    if not data or not (lo <= len(data) <= hi):
        log.append(f"{idx}: list missing or wrong size ({0 if not data else len(data)}); universe NOT changed")
        ok = False
        break
    n = 0
    for x in data:
        sym = (x.get("Symbol") or "").strip()
        if not sym or sym in seen or (x.get("Series") or "EQ").strip() not in ("EQ", "BE", "SM", ""):
            continue
        seen.add(sym)
        rows.append({"symbol": sym, "company": (x.get("Company Name") or sym).strip(), "industry": (x.get("Industry") or "").strip(),
                     "isin": (x.get("ISIN Code") or "").strip(), "yahoo": sym + ".NS", "index": idx})
        n += 1
    log.append(f"{idx}: {len(data)} rows in NSE list, {n} added")

if ok:
    old = {}
    if os.path.exists("data/universe.csv"):
        old = {r["symbol"]: r for r in csv.DictReader(open("data/universe.csv", newline="", encoding="utf-8"))}
    new = {r["symbol"] for r in rows}
    added = sorted(new - set(old)); gone = sorted(set(old) - new)
    with open("data/universe.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["symbol", "company", "industry", "isin", "yahoo", "index"])
        w.writeheader(); w.writerows(rows)
    log.append(f"Universe now {len(rows)} stocks ({sum(r['index'] == 'nifty500' for r in rows)} Nifty 500, {sum(r['index'] == 'microcap250' for r in rows)} Microcap 250)")
    log.append(f"New vs before: {len(added)} {added[:40]}")
    log.append(f"Left the universe: {len(gone)} {gone[:40]}")
open("data/universe_log.txt", "w").write("\n".join(log) + "\n")
print("\n".join(log))

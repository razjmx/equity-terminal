"""Index membership for the home-page gainers/losers: data/index_members.json
{generated, source:{nifty50,midcap150,smallcap250}, nifty50:[SYM..], midcap150:[..], smallcap250:[..]}
Source 'NSE' = official constituent file from NSE archives. If a file cannot be downloaded, that index is
approximated from market-cap rank inside the Nifty 500 universe (1-50, 101-250, 251-500) and marked 'rank'.
Needs data/market_health.json (run after compute_market_health.py)."""
import csv, io, json, datetime, requests

H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"}
FILES = {"nifty50": "ind_nifty50list.csv", "midcap150": "ind_niftymidcap150list.csv", "smallcap250": "ind_niftysmallcap250list.csv"}
HOSTS = ("https://nsearchives.nseindia.com/content/indices/", "https://archives.nseindia.com/content/indices/")

mh = json.load(open("data/market_health.json"))
uni = {r["symbol"] for r in csv.DictReader(open("data/universe.csv", newline=""))}
ranked = [s["s"] for s in sorted(mh.get("stocks", []), key=lambda x: -x["mc"])]
fallback = {"nifty50": ranked[:50], "midcap150": ranked[100:250], "smallcap250": ranked[250:500]}

out = {"generated": datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M"), "source": {}}
log = []
for k, fn in FILES.items():
    syms = None
    for h in HOSTS:
        try:
            r = requests.get(h + fn, headers=H, timeout=30)
            if r.status_code == 200 and "Symbol" in r.text[:400]:
                syms = [x["Symbol"].strip() for x in csv.DictReader(io.StringIO(r.text)) if x.get("Symbol")]
                break
            log.append(f"{k}: HTTP {r.status_code}")
        except Exception as e:
            log.append(f"{k}: {e!r}"[:150])
    if syms:
        out[k] = [s for s in syms if s in uni]
        out["source"][k] = "NSE"
        log.append(f"{k}: NSE list {len(syms)} rows, {len(out[k])} in universe")
    else:
        out[k] = fallback[k]
        out["source"][k] = "rank"
        log.append(f"{k}: using market-cap rank ({len(out[k])})")
json.dump(out, open("data/index_members.json", "w"))
open("data/index_members_log.txt", "w").write("\n".join(log) + "\n")
print("\n".join(log))

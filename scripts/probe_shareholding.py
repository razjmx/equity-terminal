"""Test whether NSE's shareholding-pattern data can be reached from GitHub Actions.
Tries 3 symbols and writes what came back to data/shareholding_probe.txt (nothing else changes)."""
import requests, json, datetime
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
     "Accept": "application/json,text/plain,*/*", "Accept-Language": "en-US,en;q=0.9", "Referer": "https://www.nseindia.com/"}
out = [f"Run (UTC): {datetime.datetime.utcnow():%Y-%m-%d %H:%M}"]
s = requests.Session(); s.headers.update(H)
try:
    r = s.get("https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern", timeout=20)
    out.append(f"home: {r.status_code}, cookies: {list(s.cookies.keys())}")
except Exception as e:
    out.append(f"home failed: {e!r}")
for sym in ["RELIANCE", "TCS", "HDFCBANK"]:
    try:
        r = s.get(f"https://www.nseindia.com/api/corporate-share-holdings-master?index=equities&symbol={sym}", timeout=20)
        out.append(f"{sym}: HTTP {r.status_code}, {len(r.text)} bytes")
        out.append(r.text[:1500])
    except Exception as e:
        out.append(f"{sym}: failed {e!r}")
open("data/shareholding_probe.txt", "w").write("\n".join(out) + "\n")
print("\n".join(out)[:1200])

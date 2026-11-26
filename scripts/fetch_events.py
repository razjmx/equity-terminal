"""Company dates from Yahoo Finance: next results date and next ex-dividend date.
Writes data/events/stocks.json = {"updated":..., "stocks": {SYMBOL: {"e": ["2026-12-05", ...], "x": "2026-12-10"}}}.
Yahoo's Indian results dates are often estimates and some stocks have none; the site labels them that way."""
import csv, datetime, json, os, time
from concurrent.futures import ThreadPoolExecutor
import yfinance as yf

LIMIT = int(os.environ.get("LIMIT", "0") or 0)
today = datetime.date.today()
state = {"fail": 0, "stop": False}

def iso(d):
    try:
        d = d.date() if hasattr(d, "date") and callable(d.date) else d
        return d.isoformat() if isinstance(d, datetime.date) else None
    except Exception:
        return None

def one(r):
    sym = r["symbol"]
    if state["stop"]:
        return sym, None
    ysym = (r.get("yahoo") or "").strip() or sym + ".NS"
    try:
        cal = yf.Ticker(ysym).calendar or {}
        state["fail"] = 0
    except Exception:
        state["fail"] += 1
        if state["fail"] >= 25:
            state["stop"] = True
        return sym, None
    e = cal.get("Earnings Date") or []
    e = sorted({iso(x) for x in (e if isinstance(e, (list, tuple)) else [e]) if iso(x) and iso(x) >= today.isoformat()})
    x = iso(cal.get("Ex-Dividend Date"))
    out = {}
    if e: out["e"] = e[:2]
    if x and x >= today.isoformat(): out["x"] = x
    time.sleep(0.3)
    return sym, out

def main():
    uni = list(csv.DictReader(open("data/universe.csv", encoding="utf-8-sig")))
    if LIMIT: uni = uni[:LIMIT]
    os.makedirs("data/events", exist_ok=True)
    stocks, bad = {}, 0
    with ThreadPoolExecutor(4) as ex:
        for sym, out in ex.map(one, uni):
            if out is None: bad += 1
            elif out: stocks[sym] = out
    stamp = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    # a failed run must not wipe a good file
    if bad > len(uni) * 0.5:
        msg = f"Run (UTC): {stamp}\nToo many failures ({bad} of {len(uni)}); the previous file was kept.\n"
    else:
        json.dump({"updated": stamp, "stocks": stocks}, open("data/events/stocks.json", "w"), separators=(",", ":"))
        n_e = sum(1 for v in stocks.values() if "e" in v); n_x = sum(1 for v in stocks.values() if "x" in v)
        msg = f"Run (UTC): {stamp}\nstocks checked: {len(uni)}; with an upcoming results date: {n_e}; with an upcoming ex-dividend date: {n_x}; no data or error: {bad}\nDates come from Yahoo Finance; results dates are often estimates.\n"
    open("data/events_log.txt", "w").write(msg); print(msg)

if __name__ == "__main__":
    main()

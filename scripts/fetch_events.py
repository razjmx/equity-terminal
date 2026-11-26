"""Company dates from Yahoo Finance: next results date and next ex-dividend date.
Writes data/events/stocks.json = {"updated":..., "stocks": {SYMBOL: {"e": ["2026-12-05", ...], "x": "2026-12-10"}}}.
Yahoo's Indian results dates are often estimates and some stocks have none; the site labels them that way."""
import csv, datetime, json, os, re, time
import requests
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

NSE = "https://www.nseindia.com"
HDR = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
       "Accept": "application/json,text/plain,*/*", "Accept-Language": "en-US,en;q=0.9", "Referer": NSE + "/"}

def nse_date(v):
    for f in ("%d-%b-%Y", "%d-%m-%Y", "%Y-%m-%d", "%d %b %Y"):
        try: return datetime.datetime.strptime(str(v).strip()[:11 if "%b" in f and "-" in f else 20], f).date().isoformat()
        except Exception: pass
    m = re.search(r"(\d{1,2})-([A-Za-z]{3})-(\d{4})", str(v))
    if m:
        try: return datetime.datetime.strptime("-".join(m.groups()), "%d-%b-%Y").date().isoformat()
        except Exception: pass
    return None

def kind(text):
    t = (text or "").lower()
    if "buyback" in t or "buy back" in t or "buy-back" in t: return "Buyback"
    if "bonus" in t: return "Bonus"
    if "split" in t or "sub-division" in t or "subdivision" in t or "face value" in t: return "Split"
    if "dividend" in t: return "Dividend"
    if "rights" in t: return "Rights"
    if "result" in t: return "Results"
    return None

def nse_feed(log, known=()):
    """Corporate actions and board meetings for the next 90 days, one call each (NSE may refuse GitHub's servers)."""
    out = {}
    sess = requests.Session(); sess.headers.update(HDR)
    try:
        sess.get(NSE, timeout=20); time.sleep(1)
    except Exception as e:
        log.append("NSE: could not open the site (" + type(e).__name__ + ")"); return out
    wins = [((today + datetime.timedelta(days=i)).strftime("%d-%m-%Y"), (today + datetime.timedelta(days=min(i + 13, 90))).strftime("%d-%m-%Y")) for i in range(0, 91, 14)]
    for name, base, mode in (
        ("corporate actions", f"{NSE}/api/corporates-corporateActions?index=equities", "act"),
        ("board meetings", f"{NSE}/api/corporate-board-meetings?index=equities", "bm")):
        data, errs = [], 0   # asked in 14-day windows: a single 90-day request returned only a handful of rows
        for f, t in wins:
            try:
                r = sess.get(f"{base}&from_date={f}&to_date={t}", timeout=30)
                if r.status_code != 200:
                    errs += 1; continue
                d = r.json(); data += d if isinstance(d, list) else d.get("data", [])
            except Exception:
                errs += 1
            time.sleep(0.7)
        if errs: log.append(f"NSE {name}: {errs} of {len(wins)} requests failed")
        if not data: continue
        n = 0; sk = {"no type": 0, "no date": 0, "past": 0, "not in universe": 0}; kinds = {}
        if data: log.append(f"NSE {name} sample: " + json.dumps(data[0], default=str)[:420])
        for x in data:
            sym = (x.get("symbol") or x.get("bm_symbol") or "").strip().upper()
            if not sym: continue
            if mode == "act":
                subj = x.get("subject") or x.get("purpose") or ""; k = kind(subj); d = nse_date(x.get("exDate") or x.get("recDate"))
                if k == "Results": continue
                if not k: sk["no type"] += 1; continue
                if not d: sk["no date"] += 1; continue
                if d < today.isoformat(): sk["past"] += 1; continue
                item = {"t": k, "d": d, "s": re.sub(r"\s+", " ", subj)[:90], "k": "exdate"}
            else:
                purp = (x.get("bm_purpose") or x.get("purpose") or "") + " " + (x.get("bm_desc") or x.get("description") or "")
                k = "Results" if re.search(r"financial results|results", purp.lower()) else kind(purp); d = nse_date(x.get("bm_date") or x.get("meetingDate") or x.get("date"))
                if not k: sk["no type"] += 1; continue
                if not d: sk["no date"] += 1; continue
                if d < today.isoformat(): sk["past"] += 1; continue
                item = {"t": k, "d": d, "s": re.sub(r"\s+", " ", (x.get("bm_desc") or x.get("purpose") or ""))[:90], "k": "board"}
            if known and sym not in known: sk["not in universe"] += 1; continue
            lst = out.setdefault(sym, [])
            if not any(y["t"] == item["t"] and y["d"] == item["d"] and y["k"] == item["k"] for y in lst):
                lst.append(item); n += 1; kinds[item["t"]] = kinds.get(item["t"], 0) + 1
        log.append(f"NSE {name}: {len(data)} rows, {n} upcoming items kept {kinds}; skipped {sk}")
    return out

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
    nlog = []
    known = {r["symbol"] for r in uni}
    nf = nse_feed(nlog, known)
    for sym, items in nf.items():
        if sym in known: stocks.setdefault(sym, {})["n"] = sorted(items, key=lambda y: y["d"])
    # a failed run must not wipe a good file
    if bad > len(uni) * 0.5:
        msg = f"Run (UTC): {stamp}\nToo many failures ({bad} of {len(uni)}); the previous file was kept.\n"
    else:
        json.dump({"updated": stamp, "stocks": stocks}, open("data/events/stocks.json", "w"), separators=(",", ":"))
        n_e = sum(1 for v in stocks.values() if "e" in v); n_x = sum(1 for v in stocks.values() if "x" in v)
        n_n = sum(1 for v in stocks.values() if "n" in v)
        msg = f"Run (UTC): {stamp}\nstocks checked: {len(uni)}; with an upcoming results date (Yahoo): {n_e}; with an upcoming ex-dividend date (Yahoo): {n_x}; with NSE filings (buyback, split, bonus, dividend, results): {n_n}; no data or error: {bad}\n" + "\n".join(nlog) + "\nResults dates from Yahoo are often estimates; NSE items come from the exchange's corporate-action and board-meeting lists.\n"
    open("data/events_log.txt", "w").write(msg); print(msg)

if __name__ == "__main__":
    main()

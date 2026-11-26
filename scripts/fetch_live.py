"""Near-live prices from the Groww API, every 5 minutes in market hours.
Writes live.json (price, open, high, low, close per stock) and live_log.txt for the 'live' branch.
Log lines never contain prices, the token or the secret."""
import csv, datetime, json, os, sys, time, traceback

IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
OUT = os.environ.get("OUT", "/tmp/live_out")

def r2(v):
    try: return round(float(v), 2)
    except Exception: return None

def shape(v, d=0):
    if isinstance(v, dict): return "{" + ", ".join(f"{k}: {shape(x, d + 1)}" for k, x in list(v.items())[:25]) + "}" if d < 2 else "{...}"
    if isinstance(v, (list, tuple)): return f"list[{len(v)}]" + (" of " + shape(v[0], d + 1) if v and d < 2 else "")
    return type(v).__name__

def main():
    now = datetime.datetime.now(IST); os.makedirs(OUT, exist_ok=True)
    force = os.environ.get("LIVE_FORCE") == "1"
    log = [f"Run (UTC): {datetime.datetime.utcnow():%Y-%m-%d %H:%M}"]
    mins = now.hour * 60 + now.minute
    if not force and (now.weekday() > 4 or mins < 9 * 60 + 10 or mins > 15 * 60 + 40):
        print("outside market hours, nothing to do"); sys.exit(0)
    key, sec = os.environ.get("GROWW_TOTP_TOKEN", ""), os.environ.get("GROWW_TOTP_SECRET", "")
    if not key or not sec:
        log.append("secrets missing"); return done(log, None)
    try:
        from growwapi import GrowwAPI
        import pyotp
        g = GrowwAPI(GrowwAPI.get_access_token(api_key=key, totp=pyotp.TOTP(sec).now()))
    except Exception as e:
        log.append("login FAILED: " + type(e).__name__ + " " + str(e)[:160].replace(key, "***").replace(sec, "***")); return done(log, None)
    syms = [r["symbol"] for r in csv.DictReader(open("data/universe.csv", encoding="utf-8-sig"))]
    names = ["NIFTY"] + syms
    ltp, ohlc, errs = {}, {}, 0
    for i in range(0, len(names), 50):
        part = tuple("NSE_" + s for s in names[i:i + 50])
        for store, fn in ((ltp, g.get_ltp), (ohlc, g.get_ohlc)):
            try: store.update(fn(segment=g.SEGMENT_CASH, exchange_trading_symbols=part))
            except Exception as e:
                errs += 1
                if errs <= 3: log.append(f"call failed: {type(e).__name__}: {str(e)[:120]}")
            time.sleep(0.15)
    stocks, miss = {}, []
    for s in syms:
        p = ltp.get("NSE_" + s); o = ohlc.get("NSE_" + s) or {}
        if p is None: miss.append(s); continue
        stocks[s] = [r2(p), r2(o.get("open")), r2(o.get("high")), r2(o.get("low")), r2(o.get("close"))]
    nf = ltp.get("NSE_NIFTY"); no = ohlc.get("NSE_NIFTY") or {}
    out = {"t": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"), "n": [r2(nf), r2(no.get("open")), r2(no.get("high")), r2(no.get("low")), r2(no.get("close"))] if nf is not None else None, "s": stocks}
    log.append(f"stocks priced: {len(stocks)} of {len(syms)}; failed calls: {errs}")
    if miss: log.append("no price for: " + ", ".join(miss[:40]) + (" ..." if len(miss) > 40 else ""))
    # what does the OHLC 'close' mean? compare with our last end-of-day price (numbers only, no prices in the log)
    same = tot = 0
    for s in syms[:60]:
        try:
            eod = json.load(open(f"data/risk/{s}.json")).get("price"); c = stocks.get(s, [None] * 5)[4]
            if eod and c: tot += 1; same += abs(c / eod - 1) < 0.002
        except Exception: pass
    if tot: log.append(f"OHLC close equals our last end-of-day close for {same} of {tot} checked stocks")
    if os.environ.get("PROBE") == "1":
        for tag, call in (("quote", lambda: g.get_quote(exchange="NSE", segment=g.SEGMENT_CASH, trading_symbol="RELIANCE")),):
            try: log.append(f"{tag} reply fields: " + shape(call()))
            except Exception as e: log.append(f"{tag} FAILED: {type(e).__name__}: {str(e)[:160]}")
    done(log, out if stocks else None)

def done(log, out):
    if out is not None:
        json.dump(out, open(f"{OUT}/live.json", "w"), separators=(",", ":"))
    open(f"{OUT}/live_log.txt", "w").write("\n".join(log) + "\n"); print("\n".join(log))

if __name__ == "__main__":
    try: main()
    except SystemExit: raise
    except Exception: done(["unexpected error:", traceback.format_exc()[-500:]], None)

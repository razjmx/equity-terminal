"""Groww API connection test (run by hand). Checks login, last-price and OHLC calls for up to 50 stocks.
It writes data/live_test_log.txt with the shape of the replies and timings only: no prices, no token, no secret."""
import csv, datetime, os, sys, time, traceback

def shape(v, depth=0):
    if isinstance(v, dict):
        return "{" + ", ".join(f"{k}: {shape(x, depth + 1)}" for k, x in list(v.items())[:6]) + "}" if depth < 2 else "{...}"
    if isinstance(v, (list, tuple)):
        return f"list[{len(v)}]"
    return type(v).__name__

def main():
    log = ["Run (UTC): " + datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M")]
    key, sec = os.environ.get("GROWW_TOTP_TOKEN", ""), os.environ.get("GROWW_TOTP_SECRET", "")
    log.append(f"secrets present: token={'yes' if key else 'NO'}, secret={'yes' if sec else 'NO'}")
    if not key or not sec:
        log.append("Add the two secrets in Settings > Secrets and variables > Actions, then run again.")
        return finish(log)
    try:
        from growwapi import GrowwAPI
        import pyotp
        t0 = time.time()
        token = GrowwAPI.get_access_token(api_key=key, totp=pyotp.TOTP(sec).now())
        g = GrowwAPI(token)
        log.append(f"login: ok ({time.time() - t0:.1f}s)")
    except Exception as e:
        log.append("login: FAILED - " + type(e).__name__ + ": " + str(e)[:200].replace(key, "***").replace(sec, "***"))
        return finish(log)
    syms = [r["symbol"] for r in csv.DictReader(open("data/universe.csv", encoding="utf-8-sig"))][:50]
    pairs = tuple("NSE_" + s for s in syms) + ("NSE_NIFTY",)
    for name, fn in (("last price", g.get_ltp), ("ohlc", g.get_ohlc)):
        try:
            t0 = time.time()
            r = fn(segment=g.SEGMENT_CASH, exchange_trading_symbols=pairs[:50])
            dt = time.time() - t0
            k = next(iter(r), None)
            log.append(f"{name}: ok, {len(r)} of {len(pairs[:50])} symbols answered in {dt:.1f}s; one reply looks like: {shape(r[k]) if k else 'empty'}")
            miss = [s for s in pairs[:50] if s not in r]
            if miss: log.append(f"  no answer for: {', '.join(m[4:] for m in miss[:12])}")
        except Exception as e:
            log.append(f"{name}: FAILED - {type(e).__name__}: {str(e)[:200]}")
    try:
        r = g.get_ltp(segment=g.SEGMENT_CASH, exchange_trading_symbols="NSE_NIFTY")
        log.append("index NSE_NIFTY: ok")
    except Exception as e:
        log.append("index NSE_NIFTY: FAILED - " + str(e)[:120])
    finish(log)

def finish(log):
    open("data/live_test_log.txt", "w").write("\n".join(log) + "\n")
    print("\n".join(log))

if __name__ == "__main__":
    try: main()
    except Exception: finish(["unexpected error:", traceback.format_exc()[-600:]])

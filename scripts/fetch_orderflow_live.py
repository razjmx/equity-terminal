"""Live order flow: the same analysis as fetch_orderflow.py, re-run through the trading day for the most traded stocks.
Source: Yahoo 5-minute bars (not exchange order-book data). Writes of/SYM.json and of.json to OUT for the 'of-live' branch.
Env: TOP_N (default 100), LIVE_FORCE=1 (run outside market hours), OUT (default /tmp/of_out)."""
import csv, datetime, json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
from fetch_orderflow import analyse

IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
OUT = os.environ.get("OUT", "/tmp/of_out")


def main():
    import yfinance as yf
    now = datetime.datetime.now(IST)
    mins = now.hour * 60 + now.minute
    if os.environ.get("LIVE_FORCE") != "1" and (now.weekday() > 4 or mins < 9 * 60 + 25 or mins > 15 * 60 + 45):
        print("outside market hours, nothing to do"); sys.exit(0)
    os.makedirs(OUT + "/of", exist_ok=True)
    TOP = int(os.environ.get("TOP_N", "100") or 100)
    syms = [r["symbol"] for r in csv.DictReader(open("data/universe.csv", newline="", encoding="utf-8-sig"))]
    liq = []
    for s in syms:
        try: liq.append((json.load(open(f"data/risk/{s}.json"))["liquidity"]["avg_daily_value_3m_cr"] or 0, s))
        except Exception: pass
    liq.sort(reverse=True)
    top = [s for _, s in liq[:TOP]] or syms[:TOP]
    ind = {}
    if os.path.exists("data/industry.csv"):
        for r in csv.DictReader(open("data/industry.csv", newline="", encoding="utf-8-sig")):
            ind[r["symbol"]] = r
    log = [f"Run (UTC): {datetime.datetime.utcnow():%Y-%m-%d %H:%M}", f"Stocks asked: {len(top)}"]
    rank, bad, delays = [], [], []
    for k in range(0, len(top), 50):
        part = top[k:k + 50]
        try:
            raw = yf.download([s + ".NS" for s in part], period="7d", interval="5m", group_by="ticker",
                              threads=True, progress=False, auto_adjust=False)
        except Exception as e:
            log.append(f"chunk {k}: {e!r}"[:200]); bad += part; continue
        for s in part:
            try:
                d = raw[s + ".NS"] if len(part) > 1 else raw
                d = d.dropna(how="all")
                if d.index.tz is not None:
                    d.index = d.index.tz_convert("Asia/Kolkata")
                if len(d):
                    last = d.index[-1].to_pydatetime()
                    if last.date() == now.date():
                        delays.append((now - last).total_seconds() / 60 - 5)   # bar stamp = bar start
                res = analyse(d)
                if not res:
                    bad.append(s); continue
                res["s"] = s
                json.dump(res, open(f"{OUT}/of/{s}.json", "w"), separators=(",", ":"))
                i = ind.get(s, {})
                rank.append({"s": s, "px": res["px"], "chg": res["chg"], "score": res["score"], "bias": res["bias"], "net": res["net"],
                             "zone": res["zone"], "rr": res["rr"], "vwap": res["vwap"], "dr": res["dr"], "rv": res["rv"],
                             "m": i.get("macro", ""), "sec": i.get("sector", "")})
            except Exception:
                bad.append(s)
        time.sleep(1)
    if rank:
        last = max(r_["d"] for r_ in (json.load(open(f"{OUT}/of/{r['s']}.json")) for r in rank[:5]))
        json.dump({"gen": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M"), "last_date": last, "stocks": rank},
                  open(OUT + "/of.json", "w"), separators=(",", ":"))
    log.append(f"Analysed {len(rank)} of {len(top)}; failed {len(bad)} {bad[:15]}")
    if delays:
        delays.sort()
        log.append(f"Newest 5-minute bar is from today for {len(delays)} stocks; delay behind the clock (minutes): "
                   f"min {delays[0]:.0f}, median {delays[len(delays)//2]:.0f}, max {delays[-1]:.0f}")
    else:
        log.append("No stock has a bar from today (market closed, holiday, or Yahoo gives no intraday bars yet)")
    open(OUT + "/of_log.txt", "w").write("\n".join(log) + "\n")
    print("\n".join(log))


if __name__ == "__main__":
    main()

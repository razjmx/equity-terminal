"""Order flow for the longer time frames: 1 month, 3 months, 6 months.
Writes data/orderflow/SYM.tf.json = {"1m": {...}, "3m": {...}, "6m": {...}} in the same shape as data/orderflow/SYM.json.
The 1D and 1W views come from the 5-minute file (data/orderflow/SYM.json); Yahoo only keeps about 60 days of 5-minute bars.

  1M  Yahoo 1-hour bars, last 21 sessions   (7 bars a day)
  3M  daily bars from data/prices/SYM.csv, last 63 sessions
  6M  daily bars from data/prices/SYM.csv, last 126 sessions

Same method as the 5-minute view (volume profile, buy/sell delta estimate, order blocks, liquidity) but every figure is
computed over the whole window, and the score thresholds are widened so that a normal 6-month move is not read as extreme.
Env: LIMIT=N, CHUNK=40."""
import csv, datetime, json, os, sys, time
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_orderflow as FO

OUT = "data/orderflow"
CFG = {"1m": dict(sessions=21, k=3.0, tol=0.0025), "3m": dict(sessions=63, k=6.0, tol=0.004), "6m": dict(sessions=126, k=9.0, tol=0.005)}


def daily(sym):
    try:
        df = pd.read_csv(f"data/prices/{sym}.csv")
    except Exception:
        return None
    df.columns = [c.strip().title() for c in df.columns]
    if "Date" not in df:
        return None
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df = df.dropna(subset=["Date"]).drop_duplicates("Date").sort_values("Date").set_index("Date")
    for c in ["Open", "High", "Low", "Close", "Volume"]:
        if c not in df:
            return None
    return df[["Open", "High", "Low", "Close", "Volume"]]


def main():
    import yfinance as yf
    LIMIT = int(os.environ.get("LIMIT", "0") or 0)
    CH = int(os.environ.get("CHUNK", "40") or 40)
    os.makedirs(OUT, exist_ok=True)
    syms = [r["symbol"] for r in csv.DictReader(open("data/universe.csv", newline="")) if not r["symbol"].startswith("DUMMY")]
    if LIMIT:
        syms = syms[:LIMIT]
    hourly, bad = {}, []
    for k in range(0, len(syms), CH):
        part = syms[k:k + CH]
        try:
            raw = yf.download([s + ".NS" for s in part], period="1mo", interval="1h", group_by="ticker", threads=True, progress=False, auto_adjust=False)
        except Exception:
            continue
        for s in part:
            try:
                d = raw[s + ".NS"] if len(part) > 1 else raw
                d = d.dropna(how="all")
                if d.index.tz is not None:
                    d.index = d.index.tz_convert("Asia/Kolkata")
                if len(d) >= 30:
                    hourly[s] = d
            except Exception:
                pass
        time.sleep(2)
    n_ok = 0
    for s in syms:
        res = {}
        try:
            if s in hourly:
                r = FO.analyse(hourly[s], agg=True, **CFG["1m"])
                if r:
                    res["1m"] = r
            dd = daily(s)
            if dd is not None:
                dd = dd[dd["Close"].notna() & (dd["Close"] > 0)].copy()
                for c in ["Open", "High", "Low"]:
                    dd[c] = dd[c].fillna(dd["Close"])
                for key in ("3m", "6m"):
                    r = FO.analyse(dd.tail(CFG[key]["sessions"] + 1), agg=True, **CFG[key])
                    if r:
                        res[key] = r
        except Exception as e:
            bad.append(f"{s}: {e!r}"[:80])
        if res:
            json.dump(res, open(f"{OUT}/{s}.tf.json", "w"), separators=(",", ":"))
            n_ok += 1
        else:
            bad.append(s)
    open("data/orderflow_tf_log.txt", "w").write(
        f"Run (UTC): {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d %H:%M}\nstocks with long-timeframe data {n_ok} of {len(syms)}\n"
        f"1-hour data for {len(hourly)} stocks\nfailed {len(bad)} {bad[:20]}\n")
    print(open("data/orderflow_tf_log.txt").read())


if __name__ == "__main__":
    main()

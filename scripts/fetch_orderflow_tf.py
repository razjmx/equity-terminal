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
    ind = {}
    if os.path.exists("data/industry.csv"):
        for r in csv.DictReader(open("data/industry.csv", newline="")):
            ind[r["symbol"]] = r
    table = {"1w": [], "1m": [], "3m": [], "6m": []}
    last = {}

    WIN = {"1w": 5, "1m": 21, "3m": 63, "6m": 126}

    def avg_dp(s, key):
        """average NSE delivery % over the window's sessions, from data/delivery/SYM.json"""
        try:
            j = json.load(open(f"data/delivery/{s}.json"))
            x = [v for v in j["dp"][-WIN[key]:] if v is not None]
            return round(sum(x) / len(x), 1) if len(x) >= max(3, WIN[key] // 2) else None
        except Exception:
            return None

    def row(s, r, key=None):
        i = ind.get(s, {})
        return {"dp": avg_dp(s, key) if key else None, "s": s, "px": r["px"], "chg": r["chg"], "score": r["score"], "bias": r["bias"], "net": r["net"], "zone": r["zone"],
                "rr": r["rr"], "vwap": r["vwap"], "dr": r["dr"], "rv": r["rv"], "m": i.get("macro", ""), "sec": i.get("sector", "")}

    for s in syms:
        res = {}
        try:
            # 1 week: rebuild the 5-minute frame from the saved bars and analyse the whole 5 sessions as one window
            fp = f"{OUT}/{s}.json"
            if os.path.exists(fp):
                b5 = json.load(open(fp))
                idx = [pd.Timestamp(f"{b5['days'][b[0]]} {b[1] // 100:02d}:{b[1] % 100:02d}") for b in b5["bars"]]
                f5 = pd.DataFrame([[b[2], b[3], b[4], b[5], b[6]] for b in b5["bars"]], index=idx, columns=["Open", "High", "Low", "Close", "Volume"])
                r = FO.analyse(f5, sessions=5, agg=True, k=1.5, tol=0.002)
                if r:
                    table["1w"].append(row(s, r, "1w")); r["dp"] = avg_dp(s, "1w"); last["1w"] = max(last.get("1w", ""), r["d"])
            if s in hourly:
                r = FO.analyse(hourly[s], agg=True, **CFG["1m"])
                if r:
                    r["dp"] = avg_dp(s, "1m"); res["1m"] = r; table["1m"].append(row(s, r, "1m")); last["1m"] = max(last.get("1m", ""), r["d"])
            dd = daily(s)
            if dd is not None:
                dd = dd[dd["Close"].notna() & (dd["Close"] > 0)].copy()
                for c in ["Open", "High", "Low"]:
                    dd[c] = dd[c].fillna(dd["Close"])
                for key in ("3m", "6m"):
                    r = FO.analyse(dd.tail(CFG[key]["sessions"] + 1), agg=True, **CFG[key])
                    if r:
                        r["dp"] = avg_dp(s, key); res[key] = r; table[key].append(row(s, r, key)); last[key] = max(last.get(key, ""), r["d"])
        except Exception as e:
            bad.append(f"{s}: {e!r}"[:80])
        if res:
            json.dump(res, open(f"{OUT}/{s}.tf.json", "w"), separators=(",", ":"))
            n_ok += 1
        else:
            bad.append(s)
    json.dump({"generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M"), "last": last,
               **{k: v for k, v in table.items()}}, open("data/orderflow_tf.json", "w"), separators=(",", ":"))
    open("data/orderflow_tf_log.txt", "w").write(
        f"Run (UTC): {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d %H:%M}\nstocks with long-timeframe data {n_ok} of {len(syms)}\n"
        f"1-hour data for {len(hourly)} stocks\nfailed {len(bad)} {bad[:20]}\n")
    print(open("data/orderflow_tf_log.txt").read())


if __name__ == "__main__":
    main()

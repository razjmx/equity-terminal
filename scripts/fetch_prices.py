import os
import time
from datetime import datetime, timedelta

import pandas as pd
import yfinance as yf

MODE = os.environ.get("MODE", "update")  # "full" or "update"
PERIOD_FULL = "5y"
PERIOD_UPDATE = "3mo"
CHUNK = 25
COLS = ["Open", "High", "Low", "Close", "Volume"]
OVERLAP_DAYS = 7   # update mode re-writes this many days so a partial day gets its final close

uni = pd.read_csv("data/universe.csv")
uni = uni[~uni["symbol"].str.startswith("DUMMY")]
items = [(r.symbol, r.yahoo) for r in uni.itertuples()]
items += [("NIFTY50", "^NSEI"), ("NIFTY500", "^CRSLDX")]

os.makedirs("data/prices", exist_ok=True)
today = datetime.utcnow().date()


def path(sym):
    return f"data/prices/{sym}.csv"


def last_date(sym):
    p = path(sym)
    if not os.path.exists(p):
        return None
    d = pd.read_csv(p, usecols=["Date"])
    return pd.to_datetime(d["Date"].iloc[-1]).date() if len(d) else None


def clean(df):
    if df is None or df.empty:
        return None
    df = df[COLS].dropna(subset=["Close"]).copy()
    df.index = pd.DatetimeIndex(df.index).tz_localize(None).normalize()
    df.index.name = "Date"
    df[["Open", "High", "Low", "Close"]] = df[["Open", "High", "Low", "Close"]].round(2)
    df["Volume"] = df["Volume"].fillna(0).astype("int64")
    return df[~df.index.duplicated(keep="last")].sort_index()


def download(tickers, period):
    out = {}
    try:
        data = yf.download(tickers, period=period, auto_adjust=False,
                           group_by="ticker", threads=True, progress=False)
        for t in tickers:
            sub = data[t] if isinstance(data.columns, pd.MultiIndex) else data
            sub = clean(sub.dropna(how="all"))
            if sub is not None:
                out[t] = sub
    except Exception as e:
        print("batch error:", str(e)[:120])
    for t in tickers:                      # retry any missing one by one
        if t not in out:
            try:
                h = clean(yf.Ticker(t).history(period=period, auto_adjust=False))
                if h is not None:
                    out[t] = h
            except Exception:
                pass
            time.sleep(1)
    return out


def merge_update(sym, df):
    """Keep old rows before the cutoff, take fresh rows from the cutoff on."""
    old = pd.read_csv(path(sym), parse_dates=["Date"]).set_index("Date")
    cutoff = old.index[-1] - pd.Timedelta(days=OVERLAP_DAYS)
    merged = pd.concat([old[old.index < cutoff], df[df.index >= cutoff]])
    merged = merged[~merged.index.duplicated(keep="last")].sort_index()
    merged.index.name = "Date"
    merged.to_csv(path(sym))


# decide which stocks need a full reload
full, update = [], []
for sym, y in items:
    ld = last_date(sym)
    if MODE == "full" or ld is None or ld < today - timedelta(days=60):
        full.append((sym, y))
    else:
        update.append((sym, y))

print(f"Mode={MODE} | full reload: {len(full)} | update: {len(update)}", flush=True)

for group, period, is_full in ((full, PERIOD_FULL, True), (update, PERIOD_UPDATE, False)):
    for i in range(0, len(group), CHUNK):
        chunk = group[i:i + CHUNK]
        got = download([y for _, y in chunk], period)
        for sym, y in chunk:
            df = got.get(y)
            if df is None:
                continue
            if is_full:
                df.to_csv(path(sym))
            else:
                merge_update(sym, df)
        print(f"{min(i + CHUNK, len(group))}/{len(group)} done", flush=True)
        time.sleep(2)

# status + summary (written to files so they can be read on github.com)
rows = []
for sym, y in items:
    if not os.path.exists(path(sym)):
        rows.append({"symbol": sym, "rows": 0, "first": "", "last": "", "status": "MISSING"})
        continue
    d = pd.read_csv(path(sym), usecols=["Date"])
    rows.append({"symbol": sym, "rows": len(d), "first": d["Date"].iloc[0],
                 "last": d["Date"].iloc[-1], "status": "ok"})
st = pd.DataFrame(rows)
newest = pd.to_datetime(st.loc[st["last"] != "", "last"]).max()
st["stale"] = (pd.to_datetime(st["last"].replace("", None)) < newest - timedelta(days=7)).fillna(True)
st["short"] = st["rows"] < 250
st.to_csv("data/prices_status.csv", index=False)

lines = [
    f"Run date (UTC): {today} | mode: {MODE}",
    f"Latest price date across stocks: {newest.date()}",
    f"Total tickers: {len(st)} | with data: {int((st['status'] == 'ok').sum())}",
    f"Missing: {st.loc[st['status'] == 'MISSING', 'symbol'].tolist()}",
    f"Stale (last price over 7 days behind): {st.loc[st['stale'] & (st['status'] == 'ok'), 'symbol'].tolist()}",
    f"Short history (<250 rows): {st.loc[st['short'] & (st['status'] == 'ok'), 'symbol'].tolist()}",
    f"Median rows per stock: {int(st.loc[st['status'] == 'ok', 'rows'].median())}",
    f"Benchmarks: {st[st['symbol'].isin(['NIFTY50', 'NIFTY500'])][['symbol', 'rows', 'last']].to_dict('records')}",
]
open("data/prices_summary.txt", "w").write("\n".join(lines))
print("\n".join(lines))

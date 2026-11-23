"""Download extra index histories from Yahoo Finance into data/prices/<NAME>.csv.
Tries several Yahoo tickers per index and keeps the first that returns data.
Writes data/indices_fetch.txt saying which ticker worked. Nothing is overwritten if all fail."""
import os, datetime
import yfinance as yf

OUT = "data/prices"
WANT = {
    "SENSEX": ["^BSESN"],
    "BANKNIFTY": ["^NSEBANK"],
    "NIFTYMID150": ["NIFTYMIDCAP150.NS", "^NIFTYMIDCAP150", "NIFTY_MIDCAP_150.NS"],
    "NIFTYSML250": ["NIFTYSMLCAP250.NS", "^NIFTYSMLCAP250", "NIFTY_SMLCAP_250.NS"],
}
os.makedirs(OUT, exist_ok=True)
log = [f"Run (UTC): {datetime.datetime.utcnow():%Y-%m-%d %H:%M}"]
for name, tickers in WANT.items():
    done = False
    for t in tickers:
        try:
            df = yf.Ticker(t).history(period="6y", interval="1d", auto_adjust=False)
            df = df.dropna(subset=["Close"])
            if len(df) < 200:
                log.append(f"{name}: {t} too few rows ({len(df)})")
                continue
            df.index = df.index.tz_localize(None) if df.index.tz is not None else df.index
            df.index.name = "Date"
            df[["Open", "High", "Low", "Close", "Volume"]].round(2).to_csv(f"{OUT}/{name}.csv")
            log.append(f"{name}: OK via {t}, {len(df)} rows, last {df.index[-1]:%Y-%m-%d} close {df['Close'].iloc[-1]:.2f}")
            done = True
            break
        except Exception as e:
            log.append(f"{name}: {t} failed {e!r}")
    if not done:
        log.append(f"{name}: NOT AVAILABLE (site will show a proxy from our own stocks if one exists)")
open("data/indices_fetch.txt", "w").write("\n".join(log) + "\n")
print("\n".join(log))

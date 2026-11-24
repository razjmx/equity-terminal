"""Stock universe = Nifty 500 + Nifty Microcap 250 (about 750 stocks), from NSE's official constituent lists.
Writes data/universe.csv with columns: symbol,company,industry,isin,yahoo,index   (index = nifty500 | microcap250)
If either list cannot be downloaded or has an unexpected size, the existing universe.csv is NOT changed.
Also writes data/universe_log.txt."""
import io
import sys
from datetime import datetime, timezone

import pandas as pd
import requests

HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "text/csv,*/*"}
HOSTS = ["https://nsearchives.nseindia.com/content/indices/", "https://archives.nseindia.com/content/indices/"]
LISTS = [("nifty500", ["ind_nifty500list.csv"], 450, 550),
         ("microcap250", ["ind_niftymicrocap250_list.csv", "ind_niftymicrocap250list.csv"], 200, 300)]
log = [f"Run (UTC): {datetime.now(timezone.utc):%Y-%m-%d %H:%M}"]


def fetch(names):
    for fn in names:
        for h in HOSTS:
            try:
                r = requests.get(h + fn, headers=HEADERS, timeout=40)
                if r.status_code == 200 and "Symbol" in r.text[:500]:
                    return pd.read_csv(io.StringIO(r.text.lstrip("﻿")))
                log.append(f"{fn} @ {h.split('/')[2]}: HTTP {r.status_code}")
            except Exception as e:
                log.append(f"{fn} @ {h.split('/')[2]}: {str(e)[:120]}")
    return None


parts = []
for idx, names, lo, hi in LISTS:
    df = fetch(names)
    if df is None or not (lo <= len(df) <= hi):
        log.append(f"{idx}: list missing or unexpected size ({0 if df is None else len(df)}). Universe NOT changed.")
        open("data/universe_log.txt", "w").write("\n".join(log) + "\n")
        print("\n".join(log))
        sys.exit(1)
    df = df.rename(columns={"Company Name": "company", "Industry": "industry", "Symbol": "symbol", "ISIN Code": "isin"})
    df = df[["symbol", "company", "industry", "isin"]].copy()
    df["symbol"] = df["symbol"].astype(str).str.strip()
    df = df[~df["symbol"].str.startswith("DUMMY")]
    df["yahoo"] = df["symbol"] + ".NS"
    df["index"] = idx
    log.append(f"{idx}: {len(df)} stocks")
    parts.append(df)

uni = pd.concat(parts, ignore_index=True).drop_duplicates("symbol", keep="first")
try:
    old = set(pd.read_csv("data/universe.csv")["symbol"])
except Exception:
    old = set()
new = set(uni["symbol"])
uni.to_csv("data/universe.csv", index=False)
log.append(f"Saved {len(uni)} stocks ({(uni['index'] == 'nifty500').sum()} Nifty 500, {(uni['index'] == 'microcap250').sum()} Microcap 250)")
log.append(f"Added vs before: {len(new - old)} {sorted(new - old)[:40]}")
log.append(f"Left the universe: {len(old - new)} {sorted(old - new)[:40]}")
open("data/universe_log.txt", "w").write("\n".join(log) + "\n")
print("\n".join(log))

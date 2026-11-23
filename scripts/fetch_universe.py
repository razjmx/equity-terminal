import io
import pandas as pd
import requests

URL = "https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv"
HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "text/csv,*/*"}

r = requests.get(URL, headers=HEADERS, timeout=30)
r.raise_for_status()

df = pd.read_csv(io.StringIO(r.text))
df = df.rename(columns={
    "Company Name": "company",
    "Industry": "industry",
    "Symbol": "symbol",
    "ISIN Code": "isin",
})
df = df[["symbol", "company", "industry", "isin"]]
df["yahoo"] = df["symbol"] + ".NS"

df.to_csv("data/universe.csv", index=False)
print(f"Saved {len(df)} stocks")

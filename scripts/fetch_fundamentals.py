import json
import os
import time
from datetime import datetime, timezone

import pandas as pd
import yfinance as yf

# ONLY_NEW=1: fetch only stocks that have no file yet (use after adding stocks to the universe)
ONLY_NEW = os.environ.get("ONLY_NEW", "") in ("1", "true", "True")

uni = pd.read_csv("data/universe.csv")
os.makedirs("data/fundamentals", exist_ok=True)

INFO_KEYS = ["longName", "sector", "industry", "marketCap", "sharesOutstanding",
             "currentPrice", "beta", "trailingPE", "priceToBook", "bookValue",
             "dividendYield", "fiftyTwoWeekHigh", "fiftyTwoWeekLow"]


def to_dict(df):
    if df is None or df.empty:
        return {}
    out = {}
    for col in df.columns:
        out[str(col.date())] = {
            str(idx): (None if pd.isna(v) else float(v)) for idx, v in df[col].items()
        }
    return out


def fetch(ticker, tries=3):
    err = ""
    for i in range(tries):
        try:
            s = yf.Ticker(ticker)
            inc = s.financials
            if inc is None or inc.empty:
                raise ValueError("empty income statement")
            info = s.info or {}
            return {
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "info": {k: info.get(k) for k in INFO_KEYS},
                "annual_income": to_dict(inc),
                "annual_balance": to_dict(s.balance_sheet),
                "annual_cashflow": to_dict(s.cashflow),
                "quarterly_income": to_dict(s.quarterly_financials),
            }
        except Exception as e:
            err = str(e)[:150]
            time.sleep(3 * (i + 1))
    return {"error": err}


status = []
skipped = 0
for n, r in enumerate(uni.itertuples(), 1):
    if ONLY_NEW and os.path.exists(f"data/fundamentals/{r.symbol}.json"):
        skipped += 1
        continue
    data = fetch(r.yahoo)
    row = {"symbol": r.symbol, "industry": r.industry}
    if "error" in data:
        row.update({"ok": False, "annual_years": 0, "quarters": 0,
                    "has_ebit": False, "has_cfo": False, "error": data["error"]})
    else:
        with open(f"data/fundamentals/{r.symbol}.json", "w") as f:
            json.dump(data, f)
        inc = data["annual_income"]
        latest = next(iter(inc.values()), {})
        cf = next(iter(data["annual_cashflow"].values()), {})
        row.update({
            "ok": True,
            "annual_years": len(inc),
            "quarters": len(data["quarterly_income"]),
            "has_ebit": latest.get("EBIT") is not None,
            "has_cfo": cf.get("Operating Cash Flow") is not None,
            "error": "",
        })
    status.append(row)
    if n % 50 == 0:
        print(f"{n}/{len(uni)} done", flush=True)
    time.sleep(1.0)

st = pd.DataFrame(status)
if ONLY_NEW and os.path.exists("data/fundamentals_status.csv") and len(st):
    # keep earlier rows for stocks not fetched this time
    prev = pd.read_csv("data/fundamentals_status.csv")
    prev = prev[~prev["symbol"].isin(st["symbol"])]
    st = pd.concat([prev, st], ignore_index=True)
if len(st):
    st.to_csv("data/fundamentals_status.csv", index=False)
print()
print(f"ONLY_NEW={ONLY_NEW}; skipped (already had a file): {skipped}")
if len(st):
    print("Fetched OK:", int(st["ok"].sum()), "of", len(st))
    print("Failed:", st.loc[~st["ok"], "symbol"].tolist())
    print("Annual years distribution:\n", st["annual_years"].value_counts().to_string())
    print("Missing EBIT:", int((~st["has_ebit"] & st["ok"]).sum()))
    print("Missing operating cash flow:", int((~st["has_cfo"] & st["ok"]).sum()))

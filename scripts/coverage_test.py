import time
import pandas as pd
import yfinance as yf

uni = pd.read_csv("data/universe.csv")

TEST = ["RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "BAJFINANCE", "INFY",
        "ITC", "SBIN", "LT", "SUNPHARMA", "TITAN", "MARUTI", "TATASTEEL",
        "DIXON", "POLYCAB", "PERSISTENT", "CDSL", "ECLERX", "ZYDUSWELL",
        "VOLTAS", "AUBANK", "HAL", "CIPLA", "NESTLEIND"]
sample = uni[uni["symbol"].isin(TEST)]


def n_years(df, label):
    """Number of annual/quarterly columns that have a real value for a line item."""
    if df is None or df.empty or label not in df.index:
        return 0
    return int(df.loc[label].notna().sum())


rows = []
for _, r in sample.iterrows():
    row = {"symbol": r["symbol"], "industry": r["industry"]}
    try:
        s = yf.Ticker(r["yahoo"])
        inc, bs, cf = s.financials, s.balance_sheet, s.cashflow
        q = s.quarterly_financials
        hist = s.history(period="max")
        info = s.info

        row["revenue_yrs"] = n_years(inc, "Total Revenue")
        row["net_income_yrs"] = n_years(inc, "Net Income")
        row["ebit_yrs"] = n_years(inc, "EBIT")
        row["assets_yrs"] = n_years(bs, "Total Assets")
        row["debt_yrs"] = n_years(bs, "Total Debt")
        row["equity_yrs"] = n_years(bs, "Stockholders Equity")
        row["cfo_yrs"] = n_years(cf, "Operating Cash Flow")
        row["capex_yrs"] = n_years(cf, "Capital Expenditure")
        row["fcf_yrs"] = n_years(cf, "Free Cash Flow")
        row["qtr_revenue"] = n_years(q, "Total Revenue")
        row["price_years"] = round(len(hist) / 250, 1)
        row["has_marketcap"] = info.get("marketCap") is not None
        row["has_shares"] = info.get("sharesOutstanding") is not None
        row["latest_fy"] = str(inc.columns[0].date()) if inc is not None and not inc.empty else ""
        row["error"] = ""
    except Exception as e:
        row["error"] = str(e)[:120]
    rows.append(row)
    time.sleep(1.5)

out = pd.DataFrame(rows)
out.to_csv("data/coverage_test.csv", index=False)
print(out.to_string())
print()
print("Stocks tested:", len(out), "| errors:", int((out["error"] != "").sum()))
print("Median years of revenue data:", out["revenue_yrs"].median())

# equity-terminal

A Nifty 500 cash-equity research terminal that runs entirely on GitHub: Python scripts refresh the data on a schedule, results are committed to `data/`, and a static site (GitHub Pages) displays them.

Site: https://razjmx.github.io/equity-terminal/

## What it shows
- **Market**: Nifty 50 / Nifty 500, breadth, top and bottom movers, RSI lists
- **Screener**: all stocks with valuation, quality, momentum and DCF columns
- **Stock page**: price chart, DCF with live assumptions (risk-free, ERP, terminal growth), reverse DCF, categorised ratios (profitability, growth, activity, liquidity, solvency, cash flow, DuPont, quality, valuation), technicals and risk
- **Financials**: P/B vs ROE model for banks, NBFCs, insurers and other financials

## Daily refresh (Mon-Fri 6:30 pm IST, `.github/workflows/daily.yml`)
1. `fetch_prices.py` (update mode)
2. `sync_prices.py` (latest close into saved info)
3. `compute_metrics.py`
4. `compute_ratios.py`
5. `compute_dcf.py`
6. `compute_risk.py`
7. `compute_financials.py`
8. commit `data/`

Manual workflows (Actions tab): Fetch Nifty 500 universe, Fetch fundamentals (run monthly or after results), Fetch prices (full reload), plus diagnostics.

## Settings you can change
- `scripts/compute_dcf.py`: RF, ERP, KD, TAX, TERMINAL_G, horizon and growth settings
- `scripts/compute_financials.py`: RF, ERP, G_DEFAULT, Ke clamp
- `data/overrides.csv`: classify a stock as financial / realty / reit / exclude
- `data/dcf_inputs.csv`: per-stock DCF overrides
- `data/fin_inputs.csv` (optional, `symbol,roe_pct,bvps`): per-stock financials overrides
- The site's Assumptions menu changes values in the browser only

## Notes
- Data source is Yahoo Finance (unofficial), about 4 years of annual statements. Treat model values as estimates, not advice.
- Every script writes its summary and errors into `data/*_review.txt`, `*_check.txt`, `*_errors.txt`.

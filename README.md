# Equity Terminal

A research terminal for Nifty 500 cash equities. It runs entirely on GitHub: scripts refresh the data on a schedule, the results are saved in `data/`, and a static website (GitHub Pages) displays them.

**Site:** https://razjmx.github.io/equity-terminal/

## What you get

- **Market Overview**: index levels (Nifty 50, Bank Nifty, Sensex, Midcap 150, Smallcap 250, Nifty 500), a sector heatmap with 1D to 1Y returns, and size and style trends.
- **Company Research**: search any Nifty 500 stock and open its page.
  - **Overview**: price chart, key ratios, valuation summary, technicals and risk.
  - **Financials**: profit and loss, balance sheet, cash flow and shareholding, with ratios.
  - **Valuation**: DCF, P/B–ROE for financials, NAV for real estate, each with bear, base and bull cases.
  - **Peers**: comparison with companies in the same industry, plus industry and sector pages.

## Notes

- Data is end-of-day, with no live prices.
- Prices and statements come from Yahoo Finance. Shareholding and the stock list come from NSE.
- Valuations are estimates from a model, not investment advice.

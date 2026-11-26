# Equity Terminal

A research terminal for Nifty 500 cash equities. It runs entirely on GitHub: scheduled jobs refresh the data and a static website (GitHub Pages) displays it. No servers and no paid services.

**Site:** https://razjmx.github.io/equity-terminal/

## What you get

- **Market Overview**
  - Index levels and a top ticker bar showing the 1-day change.
  - **Top gainers and losers.**
  - **Index heatmap** in the style of NSE's page: menus for Broad Market, Sectoral, Thematic and Strategy indices, time frames from 1D to 1Y, and coloured tiles. Click an index to see its stocks.
  - **Stocks by industry** heatmap (NSE group, sector, industry or basic industry), with click-through to the stocks.
- **Company Research**: search any Nifty 500 stock.
  - **Overview**: price chart, key ratios, technicals, volatility, risk and a trending / mean-reverting check.
  - **Financials**: profit and loss, balance sheet, cash flow and shareholding, with ratios.
  - **Valuation**: DCF with editable inputs (terminal growth defaults to India GDP growth), P/B–ROE for financials, NAV for real estate and REITs, and a reverse DCF. Bear, base and bull cases.
  - **Peers**: comparison with companies in the same industry, plus industry and sector pages.
- **Order Flow**: delivery percentage and price-volume pressure for each stock, a score history, a back-test of the score, a check of our data against NSE's daily file, and intraday VWAP / TWAP volume profiles.
- **Quant Lab**
  - **Factor rankings** and **Factor back-test** (value, quality, momentum, low volatility, growth).
  - **Market structure**: PCA of stock returns and clusters of stocks that move together.
  - **Mean reversion**: single stocks stretched against their own 60-day average, with an honest test against random entries and against the index.
  - **Pairs (stat-arb)**: same-industry pairs tested for cointegration, with a hold-out test.
  - **Portfolio builder**: HRP, minimum variance and other methods, efficient frontier, Black-Litterman views, and a Barra-style factor risk model.
- **Tools**: option pricer (Black-Scholes and binomial) and an impact-cost / execution estimator.
- **Data health**: whether each data file is fresh, whether the automatic updates ran, and whether the models pass their own checks (for example predicted against realised risk, and whether pair selection beat random pairs).
- **Info buttons**: a small "i" next to each model explains what it is and how to read it.

## Notes

- Data is end-of-day. There are no live prices. Index and order-flow figures are refreshed after the market closes.
- Prices and statements come from Yahoo Finance. Shareholding, the stock list, index levels and the delivery data come from NSE.
- The models are research tools. Several are tested against data they were not fitted on, and the page says so when a model shows no edge (for example pairs selection and mean reversion). A model that fits the past can still fail in the future.
- Back-tests use today's index members, so stocks that were removed are missing (survivorship bias flatters results). Costs and market impact are only roughly included.
- Valuations and screens are estimates from a model, not investment advice.

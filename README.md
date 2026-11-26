# Equity Terminal

A research terminal for Nifty 500 cash equities. It runs entirely on GitHub: scheduled scripts (GitHub Actions) refresh the data, the results are saved in `data/`, and a static website (GitHub Pages) displays them. No servers, no paid services, no external scripts loaded by the site.

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

## How it works

1. **Workflows** in `.github/workflows/` run on a schedule or by hand (Actions → pick a workflow → Run workflow). Examples: Fetch prices, Fetch financial statements, Daily refresh, Compute DCF, Compute metrics, Compute risk and technicals, Compute realty and REIT, Order flow, Quant models, NSE index levels.
2. **Scripts** in `scripts/` do the work and write files to `data/` (JSON and CSV). Most also write a small `*_log.txt` next to their output that says what happened. Look at the log first when something looks wrong.
3. **The website** (`index.html`, `app.js`, `style.css` and a few helper scripts) only reads those files. Nothing is calculated on a server.
4. After changing a site file, the `?v=` tag in `index.html` is bumped so browsers load the new version.

### Folders

- `data/`: results the site reads (`prices/`, `quant/`, `orderflow/` and others), plus the log files.
- `scripts/`: Python scripts, including the quant models in `scripts/compute_*.py`.
- `.github/workflows/`: the scheduled jobs.

### Useful files in `data/`

- `last_updated.json`: when each part was last refreshed.
- `index_heat.json`, `index_constituents.json`: index heatmap and index stock lists. To fix an index in the wrong menu, add a row to `data/index_groups.csv` (index name, group). To fix a missing stock list, add a row to `data/index_files.csv` (index name, file name).
- `quant/*.json`: results of the quant models.
- `*_log.txt`: what each script did on its last run.

## Notes

- Data is end-of-day. There are no live prices. Index and order-flow figures are refreshed after the market closes.
- Prices and statements come from Yahoo Finance. Shareholding, the stock list, index levels and the delivery data come from NSE.
- The models are research tools. Several are tested against data they were not fitted on, and the page says so when a model shows no edge (for example pairs selection and mean reversion). A model that fits the past can still fail in the future.
- Back-tests use today's index members, so stocks that were removed are missing (survivorship bias flatters results). Costs and market impact are only roughly included.
- Valuations and screens are estimates from a model, not investment advice.
- Do not put passwords, API keys or tokens in the repository. Keep any credentials in GitHub Secrets.

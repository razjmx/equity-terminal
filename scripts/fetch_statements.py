"""Download full Yahoo Finance statements (annual + quarterly income, balance sheet, cash flow)
and a holders snapshot for every stock in data/universe.csv into data/statements/SYM.json.
Slow on purpose (polite pauses). Skips files fetched in the last 6 days unless FORCE=1.
Env: LIMIT=N (only first N symbols, for a test run). Writes data/statements_log.txt."""
import csv, json, os, time, datetime, math
import yfinance as yf

OUT = "data/statements"
os.makedirs(OUT, exist_ok=True)
LIMIT = int(os.environ.get("LIMIT", "0") or 0)
FORCE = os.environ.get("FORCE") == "1"
now = datetime.datetime.utcnow()

def tbl(df):
    """DataFrame (rows=line items, cols=dates) -> {"dates":[old..new], "rows":[[name,[values]]]}"""
    if df is None or getattr(df, "empty", True):
        return None
    cols = sorted(df.columns)
    dates = [c.strftime("%Y-%m-%d") for c in cols]
    rows = []
    for name in df.index:
        vals = []
        for c in cols:
            v = df.loc[name, c]
            try:
                v = float(v)
                vals.append(None if math.isnan(v) else round(v, 4))
            except Exception:
                vals.append(None)
        if any(v is not None for v in vals):
            rows.append([str(name), vals])
    return {"dates": dates, "rows": rows} if rows else None

def fresh(path):
    try:
        t = json.load(open(path)).get("fetched")
        return t and (now - datetime.datetime.strptime(t, "%Y-%m-%d")).days < 6
    except Exception:
        return False

syms = [r["symbol"] for r in csv.DictReader(open("data/universe.csv", newline=""))]
if LIMIT:
    syms = syms[:LIMIT]
log, ok, skipped, bad = [f"Run (UTC): {now:%Y-%m-%d %H:%M}"], 0, 0, 0
for i, s in enumerate(syms):
    p = f"{OUT}/{s}.json"
    if not FORCE and fresh(p):
        skipped += 1
        continue
    try:
        t = yf.Ticker(s + ".NS")
        d = {"fetched": f"{now:%Y-%m-%d}"}
        for key, attr in [("annual_income", "income_stmt"), ("quarterly_income", "quarterly_income_stmt"),
                          ("annual_balance", "balance_sheet"), ("quarterly_balance", "quarterly_balance_sheet"),
                          ("annual_cashflow", "cashflow"), ("quarterly_cashflow", "quarterly_cashflow")]:
            try:
                d[key] = tbl(getattr(t, attr))
            except Exception as e:
                d[key] = None
                log.append(f"{s}: {key} {e!r}")
            time.sleep(0.15)
        try:
            info = t.info or {}
            d["holders"] = {"insiders_pct": info.get("heldPercentInsiders"), "institutions_pct": info.get("heldPercentInstitutions")}
        except Exception as e:
            d["holders"] = None
            log.append(f"{s}: holders {e!r}")
        if any(d.get(k) for k in ("annual_income", "annual_balance", "annual_cashflow")):
            json.dump(d, open(p, "w"), separators=(",", ":"))
            ok += 1
        else:
            bad += 1
            log.append(f"{s}: no statements")
    except Exception as e:
        bad += 1
        log.append(f"{s}: {e!r}")
    time.sleep(0.4)
    if (i + 1) % 50 == 0:
        print(f"{i+1}/{len(syms)} done", flush=True)
log.append(f"Saved {ok}, skipped (fresh) {skipped}, failed {bad}, of {len(syms)}")
open("data/statements_log.txt", "w").write("\n".join(log) + "\n")
print("\n".join(log[-5:]))

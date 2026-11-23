import json
import os

SYMS = ["HDFCBANK", "ICICIBANK", "SBIN", "AXISBANK", "KOTAKBANK", "BAJFINANCE"]
KEYS = ["equity", "capital", "stock", "minority", "preferred", "retained",
        "reserve", "total assets", "total debt", "borrow", "deposit"]
CR = 1e7

out = []
for s in SYMS:
    p = f"data/fundamentals/{s}.json"
    if not os.path.exists(p):
        out.append(f"=== {s}: no file ===\n")
        continue
    d = json.load(open(p))
    bs = d["annual_balance"]
    ys = sorted(bs.keys(), reverse=True)
    info = d.get("info", {})
    out.append(f"=== {s} ===")
    out.append(f"info: marketCap(cr)={round((info.get('marketCap') or 0) / CR)}, "
               f"shares={info.get('sharesOutstanding')}, "
               f"bookValue/share={info.get('bookValue')}, "
               f"priceToBook={info.get('priceToBook')}, price={info.get('currentPrice')}")
    for y in ys[:2]:
        out.append(f"-- balance sheet {y} (Rs cr) --")
        for k, v in bs[y].items():
            if v is not None and any(w in k.lower() for w in KEYS):
                out.append(f"{k}: {round(v / CR, 1)}")
    out.append("")
open("data/financials_diag.txt", "w").write("\n".join(out))
print("done")

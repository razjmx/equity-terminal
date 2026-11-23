import csv
import json
import os

CR = 1e7
KEYS = ["unusual", "special", "gain", "write off", "restructuring", "impairment",
        "other non operating", "net non operating", "discontinu", "extraordinary",
        "pretax", "tax", "ebit", "normalized", "net income", "interest expense",
        "total revenue", "operating income"]
DETAIL = ["JSWSTEEL", "MARUTI", "HINDUNILVR", "ETERNAL", "TMPV", "GODREJPROP"]


def fmt(v):
    if v is None:
        return "None"
    return str(round(v, 3)) if abs(v) < 5 else str(round(v / CR))


def load(sym):
    p = f"data/fundamentals/{sym}.json"
    return json.load(open(p)) if os.path.exists(p) else None


out = ["PART A: income statement lines, latest two FYs (Rs cr)", ""]
for s in DETAIL:
    d = load(s)
    if not d:
        out.append(f"=== {s}: no file ===")
        continue
    inc = d["annual_income"]
    ys = sorted(inc.keys(), reverse=True)[:2]
    out.append(f"=== {s} ===")
    for y in ys:
        out.append(f"-- {y} --")
        for k, v in inc[y].items():
            if v is not None and any(w in k.lower() for w in KEYS):
                out.append(f"{k}: {fmt(v)}")
    out.append("")

out += ["PART B: stocks where Net Income and Normalized Income differ by over 30%",
        "symbol | net income | normalized | pretax | EBIT | unusual items | tax rate used", ""]
with open("data/universe.csv") as f:
    symbols = [row["symbol"] for row in csv.DictReader(f)]
for s in symbols:
    d = load(s)
    if not d or not d["annual_income"]:
        continue
    inc = d["annual_income"]
    I = inc[sorted(inc.keys(), reverse=True)[0]]
    ni, nm = I.get("Net Income"), I.get("Normalized Income")
    if ni is None or not nm or abs(ni - nm) / abs(nm) <= 0.30:
        continue
    out.append(" | ".join([
        s, fmt(ni), fmt(nm), fmt(I.get("Pretax Income")), fmt(I.get("EBIT")),
        fmt(I.get("Total Unusual Items")), fmt(I.get("Tax Rate For Calcs"))]))

open("data/unusual_diag.txt", "w").write("\n".join(out))
print("done")

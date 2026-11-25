"""NSE index closing levels for every index NSE publishes -> data/index_heat.json (small, read by the Market Overview heatmap)
and data/nse_indices_hist.json (history, kept between runs).

Source: NSE's daily file https://nsearchives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv (one row per index:
open, high, low, close, change %, ...). The script keeps about a year of daily closes, adding up to MAXNEW missing days per
run (so the first runs build the history and later runs add one day). From the closes it works out the return over
1 day, 1 week, 1 month, 3 months, 6 months and 1 year. A time frame shows n/a until enough history exists.

Indices are put into four menus like NSE's own page: Broad Market, Sectoral, Thematic, Strategy. NSE's file does not carry the
category, so it is decided here from the index name (explicit lists for broad and sectoral, keywords for strategy, the rest
thematic). data/index_groups.csv (index name, group) overrides this if you create it. The log compares the counts with the
21 / 23 / 39 / 36 seen on NSE's page, so a wrong bucket is easy to spot.

Env: DAYS=265 (trading days kept), MAXNEW=130. Writes data/index_heat_log.txt. Runs from the repo root."""
import csv
import datetime
import io
import json
import os
import re
import sys
import time

import requests

H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
     "Referer": "https://www.nseindia.com/"}
HOSTS = ("https://nsearchives.nseindia.com/content/indices/", "https://archives.nseindia.com/content/indices/")
KEEP = int(os.environ.get("DAYS", "265") or 265)
MAXNEW = int(os.environ.get("MAXNEW", "130") or 130)
HIST = "data/nse_indices_hist.json"
OUT = "data/index_heat.json"
EXPECT = {"broad": 21, "sectoral": 23, "thematic": 39, "strategy": 36}      # what NSE's page showed

BROAD_RE = [r"^nifty (50|next 50|100|200|500|total market|fpi 150|mid select|microcap 250|largemidcap 250|midsmallcap 400)$",
            r"^nifty (midcap|smallcap) (50|100|150|250)$", r"^nifty500 multicap 502525$", r"lms|largemidsmall"]
BROAD_ORDER = ["nifty 50", "nifty next 50", "nifty midcap 50", "nifty midcap 100", "nifty midcap 150", "nifty smallcap 50", "nifty smallcap 100",
               "nifty smallcap 250", "nifty midsmallcap 400", "nifty 100", "nifty 200", "nifty500 multicap 502525", "nifty largemidcap 250",
               "nifty mid select", "nifty total market", "nifty microcap 250", "nifty 500", "nifty fpi 150"]
SECTORAL = ["nifty auto", "nifty bank", "nifty financial services", "nifty financial services 2550", "nifty financial services 25 50", "nifty fmcg",
            "nifty it", "nifty media", "nifty metal", "nifty pharma", "nifty psu bank", "nifty realty", "nifty private bank", "nifty healthcare index",
            "nifty healthcare", "nifty consumer durables", "nifty oil and gas", "nifty midsmall healthcare", "nifty chemicals", "nifty500 healthcare",
            "nifty financial services exbank", "nifty midsmall financial services", "nifty midsmall it and telecom", "nifty cement", "nifty reits and invits"]
STRATEGY_RE = r"alpha|quality|qlty|low ?vol|momentum|\bvalue\b|equal ?weight|eql ?w|dividend|high ?beta|top (10|15|20)|multi ?factor|growth sectors|aql|tmmq|500 ew"
SKIP_RE = r"vix|usd|g ?sec|gsec|\btri\b|total return|\b(4|8|10|11|15) ?(to|yr|year)|composite|treasury|liquid fund|bond|duration|\bsdl\b|aaa|money market|corporate"


def norm(s):
    s = (s or "").lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9: /]", "", s).replace("/", "")
    return re.sub(r"\s+", " ", s).strip()


def classify(name, overrides):
    n = norm(name)
    if name in overrides:
        return overrides[name]
    if re.search(SKIP_RE, n):
        return "skip"
    if n in SECTORAL:
        return "sectoral"
    if any(re.search(p, n) for p in BROAD_RE):
        return "broad"
    if re.search(STRATEGY_RE, n):
        return "strategy"
    return "thematic"


def download(day, log):
    name = f"ind_close_all_{day:%d%m%Y}.csv"
    for h in HOSTS:
        try:
            r = requests.get(h + name, headers=H, timeout=40)
            if r.status_code == 200 and "index name" in r.text[:300].lower():
                return r.text
            log.append(f"{day}: HTTP {r.status_code} ({h.split('/')[2]})")
        except Exception as e:
            log.append(f"{day}: {e!r}"[:160])
    return None


def num(x):
    try:
        v = float(str(x).replace(",", "").strip())
        return v if v == v else None
    except Exception:
        return None


def parse(text):
    """-> (iso_date, {index name: close})"""
    rd = csv.DictReader(io.StringIO(text))
    out, date = {}, None
    for row in rd:
        r = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
        nm = r.get("index name")
        c = num(r.get("closing index value") or r.get("close"))
        if not nm or c is None:
            continue
        if date is None:
            d = r.get("index date", "")
            for fmt in ("%d-%m-%Y", "%d-%b-%Y", "%Y-%m-%d"):
                try:
                    date = datetime.datetime.strptime(d, fmt).strftime("%Y-%m-%d")
                    break
                except Exception:
                    pass
        out[nm] = c
    return date, out


def update_history(log):
    hist = json.load(open(HIST)) if os.path.exists(HIST) else {"dates": [], "idx": {}}
    have = set(hist["dates"])
    today = datetime.date.today()
    new, misses, refused = [], 0, 0
    for back in range(0, 420):
        day = today - datetime.timedelta(days=back)
        if day.weekday() >= 5 or day.isoformat() in have:
            continue
        if len(have) >= KEEP and back > 6:
            break
        if len(new) >= MAXNEW:
            break
        txt = download(day, log)
        time.sleep(1.2)
        if not txt:
            misses += 1
            refused += 1
            if refused >= 6:
                log.append("NSE gave no file for 6 weekdays in a row; stopping for this run (holidays or a block; it continues tomorrow)")
                break
            continue
        refused = 0
        date, rows = parse(txt)
        if not date:
            continue
        new.append((date, rows))
        have.add(date)
    dates = sorted(set(hist["dates"]) | {d for d, _ in new})
    pos = {d: i for i, d in enumerate(dates)}
    idx = {}
    for nm, arr in hist["idx"].items():                       # re-align old arrays to the new date list
        a = [None] * len(dates)
        for od, v in zip(hist["dates"], arr):
            a[pos[od]] = v
        idx[nm] = a
    for d, rows in new:
        for nm, c in rows.items():
            idx.setdefault(nm, [None] * len(dates))[pos[d]] = c
    dates_k = dates[-KEEP:]
    cut = len(dates) - len(dates_k)
    hist = {"dates": dates_k, "idx": {nm: a[cut:] for nm, a in idx.items() if any(v is not None for v in a[cut:])}}
    json.dump(hist, open(HIST, "w"), separators=(",", ":"))
    log.append(f"NSE index files: {len(new)} new day(s); history {len(dates_k)} days, {len(hist['idx'])} indices; weekdays without a file: {misses}")
    return hist


def ret_at(dates, arr, last_i, target):
    """return % from the last close at or before `target` date to the latest close; None if the history does not reach back that far"""
    if dates[0] > target:
        return None
    j = None
    for i in range(last_i, -1, -1):
        if dates[i] <= target and arr[i] is not None:
            j = i
            break
    if j is None or not arr[j]:
        return None
    return (arr[last_i] / arr[j] - 1) * 100


def build(hist, log):
    dates, idx = hist["dates"], hist["idx"]
    if not dates:
        log.append("no history")
        return
    last = datetime.date.fromisoformat(dates[-1])
    li = len(dates) - 1
    over = {}
    if os.path.exists("data/index_groups.csv"):
        for r in csv.reader(open("data/index_groups.csv", newline="")):
            if len(r) >= 2 and r[1].strip().lower() in ("broad", "sectoral", "thematic", "strategy", "skip"):
                over[r[0].strip()] = r[1].strip().lower()
    tf = {"r1w": 7, "r1m": 30, "r3m": 91, "r6m": 182, "r1y": 365}
    groups = {"broad": [], "sectoral": [], "thematic": [], "strategy": []}
    for nm, arr in idx.items():
        if arr[li] is None:                                    # not published on the latest day
            continue
        g = classify(nm, over)
        if g == "skip":
            continue
        prev = next((arr[i] for i in range(li - 1, -1, -1) if arr[i] is not None), None)
        rec = {"n": nm, "c": round(arr[li], 2), "r1d": round((arr[li] / prev - 1) * 100, 2) if prev else None}
        for k, d in tf.items():
            r = ret_at(dates, arr, li, (last - datetime.timedelta(days=d)).isoformat())
            rec[k] = None if r is None else round(r, 2)
        groups[g].append(rec)
    order = {"broad": BROAD_ORDER, "sectoral": SECTORAL}
    for g, lst in groups.items():
        o = order.get(g)
        lst.sort(key=lambda r: ((o.index(norm(r["n"])) if o and norm(r["n"]) in o else 999), r["n"]))
    out = {"asof": dates[-1], "history_days": len(dates), "groups": groups, "counts": {g: len(v) for g, v in groups.items()},
           "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    log.append("Menu counts here vs NSE's page: " + ", ".join(f"{g} {len(v)} (NSE {EXPECT[g]})" for g, v in groups.items()))
    have = {k: sum(1 for v in groups[g] if v.get(k) is not None) for g in groups for k in ["r1w"]}
    for k in ["r1w", "r1m", "r3m", "r6m", "r1y"]:
        n = sum(1 for g in groups.values() for v in g if v.get(k) is not None)
        log.append(f"  {k}: {n} of {sum(len(v) for v in groups.values())} indices have enough history")
    for g in ("broad", "sectoral"):
        log.append(f"  {g}: " + "; ".join(v["n"] for v in groups[g]))
    log.append("  thematic: " + "; ".join(v["n"] for v in groups["thematic"]))
    log.append("  strategy: " + "; ".join(v["n"] for v in groups["strategy"]))


if __name__ == "__main__":
    import traceback
    log = [f"Run (UTC): {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d %H:%M}"]
    failed = False
    try:
        h = update_history(log)
        build(h, log)
    except Exception:
        failed = True
        log.append("FAILED: " + traceback.format_exc()[-900:])
    os.makedirs("data", exist_ok=True)
    open("data/index_heat_log.txt", "w").write("\n".join(log) + "\n")
    print("\n".join(log))
    if failed:
        sys.exit(1)

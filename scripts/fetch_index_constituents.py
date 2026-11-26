"""Stock lists of the NSE indices shown on the heatmap -> data/index_constituents.json {asof, members:{index name:[SYMBOL..]}, files:{index name: file}}.

NSE publishes one list file per index in its archive (for example ind_nifty50list.csv). The file names are not perfectly regular,
so for each index in data/index_heat.json the script tries several likely names, remembers the one that works, and keeps trying
the ones that failed only once a week. Only symbols that are in our universe are kept. data/index_constituents_log.txt says which
indices were found and which were not, so a missing one can be fixed by adding its file name to data/index_files.csv
(index name, file name), which this script reads first.

Env: BUDGET=1200 (seconds of work per run). Runs from the repo root, after fetch_nse_indices.py."""
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
BUDGET = int(os.environ.get("BUDGET", "1200") or 1200)
OUT = "data/index_constituents.json"
RETRY_DAYS = 7

ALIASES = [("financialservices", "finance"), ("oilandgas", "oilgas"), ("healthcareindex", "healthcare"), ("reitsandinvits", "reitinvit"),
           ("itandtelecom", "ittelecom"), ("exbank", "exbank"), ("indiaconsumption", "consumption"), ("servicessector", "servicesector")]


def candidates(name):
    base = re.sub(r"[^a-z0-9]", "", name.lower().replace("&", "and"))
    rests = {base}
    b2 = base
    for a, b in ALIASES:
        if a in b2:
            rests.add(b2.replace(a, b))
    rests |= {r.replace("and", "") for r in list(rests)}
    out = []
    for r in sorted(rests, key=len, reverse=True):
        core = r[5:] if r.startswith("nifty") else r
        for pat in (f"ind_nifty{core}list.csv", f"ind_nifty{core}_list.csv", f"ind_nifty_{core}list.csv", f"ind_nifty_{core}_list.csv"):
            if pat not in out:
                out.append(pat)
    return out[:16]


def get_list(fn):
    for h in HOSTS:
        try:
            r = requests.get(h + fn, headers=H, timeout=25)
            if r.status_code == 200 and "symbol" in r.text[:500].lower():
                syms = [(x.get("Symbol") or x.get("symbol") or "").strip() for x in csv.DictReader(io.StringIO(r.text))]
                return [s for s in syms if s]
        except Exception:
            pass
    return None


def main():
    t0 = time.time()
    heat = json.load(open("data/index_heat.json"))
    names = [r["n"] for g in heat["groups"].values() for r in g]
    uni = {r["symbol"] for r in csv.DictReader(open("data/universe.csv", newline=""))}
    old = json.load(open(OUT)) if os.path.exists(OUT) else {}
    members, files, failed = old.get("members", {}), old.get("files", {}), old.get("failed", {})
    manual = {}
    if os.path.exists("data/index_files.csv"):
        for r in csv.reader(open("data/index_files.csv", newline="")):
            if len(r) >= 2 and r[1].strip():
                manual[r[0].strip()] = r[1].strip()
    today = datetime.date.today()
    log, found, missing, skipped = [f"Run (UTC): {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d %H:%M}"], 0, [], 0
    for nm in names:
        if time.time() - t0 > BUDGET:
            log.append("time budget used; the rest continues next run")
            break
        last_fail = failed.get(nm)
        if nm not in manual and nm in files and nm in members:       # known file: refresh it
            fns = [files[nm]]
        elif last_fail and (today - datetime.date.fromisoformat(last_fail)).days < RETRY_DAYS and nm not in manual:
            skipped += 1
            continue
        else:
            fns = [manual[nm]] if nm in manual else candidates(nm)
        syms = None
        for fn in fns:
            syms = get_list(fn)
            time.sleep(0.35)
            if syms:
                files[nm] = fn
                break
        if syms:
            members[nm] = [s for s in syms if s in uni]
            failed.pop(nm, None)
            found += 1
        else:
            failed[nm] = today.isoformat()
            missing.append(nm)
    out = {"asof": heat.get("asof"), "members": members, "files": files, "failed": failed}
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    log.append(f"indices: {len(names)}; lists found this run: {found}; with a list stored: {len([n for n in names if n in members])}; waiting for retry: {skipped}")
    if missing:
        log.append("no list file found for: " + "; ".join(missing))
    log.append("tip: add 'index name,file name' rows to data/index_files.csv for any that are missing")
    open("data/index_constituents_log.txt", "w").write("\n".join(log) + "\n")
    print("\n".join(log))


if __name__ == "__main__":
    import traceback
    try:
        main()
    except Exception:
        os.makedirs("data", exist_ok=True)
        open("data/index_constituents_log.txt", "w").write("FAILED: " + traceback.format_exc()[-900:] + "\n")
        print(traceback.format_exc())
        sys.exit(1)

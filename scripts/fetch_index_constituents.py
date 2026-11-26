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
HOSTS = ("https://nsearchives.nseindia.com/content/indices/", "https://www.niftyindices.com/IndexConstituent/",
         "https://archives.nseindia.com/content/indices/")
VER = 3                      # bump to retry every index that failed under an older version of the file-name guesses
NOLIST = r"reits and invits$|arbitrage|futures|inverse|leverage|1d rate|sme emerge|dividend points|\btr\b|\bpr\b"
BAD = {}                     # host -> consecutive errors this run (a host that keeps failing is dropped for the run)
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
    words = re.sub(r"[^a-z0-9 ]", " ", name.lower().replace("&", " and ")).split()
    if words and words[0] == "nifty":
        words = words[1:]
    if words:
        camel = "".join(w.capitalize() for w in words)
        under = "_".join(w.capitalize() for w in words)
        for pat in (f"ind_Nifty{camel}_list.csv", f"ind_Nifty{camel}list.csv", f"ind_Nifty_{under}_list.csv", f"ind_nifty_{'_'.join(words)}_list.csv"):
            if pat not in out:
                out.append(pat)
    # NSE often shortens words in file names (lowvol, eql weight, infra ...) and keeps symbols such as 25_50: try those spellings too
    SHORT = [("lowvolatility", "lowvol"), ("volatility", "vol"), ("equalweight", "eqlwt"), ("equalweight", "eql"), ("equalweight", "equalwt"),
             ("dividendopportunities", "dividendopp"), ("dividendopportunities", "divopp"), ("dividendopportunities", "divopps"), ("growthsectors", "growsect"), ("growthsectors", "growth"), ("infrastructure", "infra"),
             ("servicessector", "service"), ("servicessector", "servicesector"), ("midcapliquid", "midcapliq"), ("liquid", "liq"),
             ("noncyclicalconsumer", "noncyclicconsumer"), ("smallfinancebanksandmicrofinanceinstitutions", "sfbmfi"),
             ("smallfinancebanksandmicrofinanceinstitutions", "smallfinancebanks"), ("evandnewageautomotive", "evnewageautomotive"),
             ("evandnewageautomotive", "ev"), ("enhancedesg", "enhancedesg"), ("momentumquality", "momentumqual"), ("alphaquality", "alphaqual"),
             ("indiainfrastructureandlogistics", "indiainfralogistics"), ("financialservices", "finservices")]
    raw = re.sub(r"[^a-z0-9/\-:]", "", name.lower().replace("&", "and"))
    syms = {re.sub(r"[/\-:]", "_", raw), re.sub(r"[/\-:]", "", raw)}
    cores = {x[5:] if x.startswith("nifty") else x for x in syms | rests}
    for core in list(cores):
        for a, b in SHORT:
            if a in core:
                cores.add(core.replace(a, b))
    for core in sorted(cores, key=len):
        for pat in (f"ind_nifty{core}list.csv", f"ind_nifty{core}_list.csv"):
            if pat not in out:
                out.append(pat)
    return out[:48]


def get_list(fn):
    for h in HOSTS:
        if BAD.get(h, 0) >= 6:
            continue
        try:
            r = requests.get(h + fn, headers=H, timeout=12)
            BAD[h] = 0
            if r.status_code == 200 and "symbol" in r.text[:500].lower():
                syms = [(x.get("Symbol") or x.get("symbol") or "").strip() for x in csv.DictReader(io.StringIO(r.text))]
                return [s for s in syms if s]
        except Exception:
            BAD[h] = BAD.get(h, 0) + 1
    return None


def main():
    t0 = time.time()
    heat = json.load(open("data/index_heat.json"))
    names = [r["n"] for g in heat["groups"].values() for r in g]
    uni = {r["symbol"] for r in csv.DictReader(open("data/universe.csv", newline=""))}
    old = json.load(open(OUT)) if os.path.exists(OUT) else {}
    members, files, failed = old.get("members", {}), old.get("files", {}), old.get("failed", {})
    if old.get("ver") != VER:
        failed = {}
    manual = {}
    if os.path.exists("data/index_files.csv"):
        for r in csv.reader(open("data/index_files.csv", newline="")):
            if len(r) >= 2 and r[1].strip():
                manual[r[0].strip()] = r[1].strip()
    today = datetime.date.today()
    log, found, missing, skipped = [f"Run (UTC): {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d %H:%M}"], 0, [], 0
    bylaw = []
    for nm in names:
        if re.search(NOLIST, re.sub(r"[^a-z0-9 ]", "", nm.lower())) and nm not in manual:
            bylaw.append(nm)
            continue
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
            time.sleep(0.15)
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
    out = {"asof": heat.get("asof"), "ver": VER, "members": members, "files": files, "failed": failed}
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    log.append(f"indices: {len(names)}; lists found this run: {found}; with a list stored: {len([n for n in names if n in members])}; waiting for retry: {skipped}")
    dropped = [h.split("/")[2] for h, c in BAD.items() if c >= 6]
    if dropped:
        log.append("host(s) not reachable, skipped for this run: " + ", ".join(dropped))
    if bylaw:
        log.append("no stock list by design (derivative / leveraged / rate): " + "; ".join(bylaw))
    still = [n for n in names if n not in members and n not in bylaw]
    if still:
        log.append(f"still without a list ({len(still)}): " + "; ".join(still))
    log.append("hosts tried: " + ", ".join(h.split("/")[2] for h in HOSTS))
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

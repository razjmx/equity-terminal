"""Delivery % history from NSE's official daily file (sec_bhavdata_full) -> data/delivery/SYM.json

Per stock: {"d": [dates], "dp": [delivery %], "dq": [delivery qty], "v": [traded qty]} for up to ~400 sessions.
Incremental: dates already stored are skipped; weekdays NSE has no file for (holidays) are remembered in
data/delivery/_none.json so they are not retried. Env: DAYS=380 (calendar days back), MAXNEW=400 (new files per run)."""
import csv, datetime, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_nse_bhav as NB

OUT = "data/delivery"
DAYS = int(os.environ.get("DAYS", "380") or 380)
MAXNEW = int(os.environ.get("MAXNEW", "400") or 400)
KEEP = 400


def main():
    os.makedirs(OUT, exist_ok=True)
    syms = {r["symbol"] for r in csv.DictReader(open("data/universe.csv", newline="")) if not r["symbol"].startswith("DUMMY")}
    store = {}
    have = set()
    for s in syms:
        try:
            j = json.load(open(f"{OUT}/{s}.json"))
            store[s] = {d: (a, b, c) for d, a, b, c in zip(j["d"], j["dp"], j["dq"], j["v"])}
            have |= set(j["d"])
        except Exception:
            store[s] = {}
    none = set(json.load(open(f"{OUT}/_none.json"))) if os.path.exists(f"{OUT}/_none.json") else set()
    today = datetime.date.today()
    todo = []
    for k in range(0, DAYS):
        d = today - datetime.timedelta(days=k)
        iso = d.isoformat()
        if d.weekday() >= 5 or iso in have or iso in none:
            continue
        todo.append(d)
    log, got, miss = [], 0, 0
    for d in todo[:MAXNEW]:
        text = NB.download(d, log)
        if text is None:
            if (today - d).days > 4:
                none.add(d.isoformat())           # a holiday, or NSE never published it
            miss += 1
            time.sleep(0.3)
            continue
        date, rows = NB.parse_bhav(text)
        date = date or d.isoformat()
        for s in syms:
            r = rows.get(s)
            if r and r.get("dp") is not None:
                store[s][date] = (r["dp"], r.get("dq"), r.get("v"))
        got += 1
        time.sleep(0.5)
    for s, m in store.items():
        ds = sorted(m)[-KEEP:]
        if not ds:
            continue
        json.dump({"d": ds, "dp": [m[x][0] for x in ds], "dq": [m[x][1] for x in ds], "v": [m[x][2] for x in ds]},
                  open(f"{OUT}/{s}.json", "w"), separators=(",", ":"))
    json.dump(sorted(none), open(f"{OUT}/_none.json", "w"))
    cov = sum(1 for m in store.values() if len(m) >= 200)
    open("data/delivery_log.txt", "w").write(
        f"Run (UTC): {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d %H:%M}\nnew days fetched {got}, no file {miss}, still to fetch {max(0, len(todo) - MAXNEW)}\n"
        f"stocks with 200+ sessions of delivery data {cov} of {len(syms)}\n" + "\n".join(log[:15]))
    print(open("data/delivery_log.txt").read())


if __name__ == "__main__":
    main()

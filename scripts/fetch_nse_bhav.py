"""Official NSE end-of-day figures (bhavcopy with delivery) -> data/nse_bhav.json, and a check of our Yahoo 5-minute
bars against them.

1. Downloads sec_bhavdata_full_DDMMYYYY.csv from NSE archives for the latest trading days (keeps ~30 days of history).
   Per stock and day: open, high, low, close, traded quantity, number of trades, delivery quantity and delivery %.
2. For every stock in data/orderflow/SYM.json, compares the latest session's Yahoo 5-minute bars (day high, low, close and
   total volume) with NSE's official figures for the same date and writes a verdict into that file under "nse",
   plus "q" (verdict) and "dp" (delivery %) into data/orderflow.json.
Verdicts: ok (matches), warn (differs, reasons listed), pending (NSE file for that date not published yet).
Env: DAYS=30 (history length). Writes data/nse_bhav_log.txt."""
import csv, io, json, os, sys, time, datetime
import requests

H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
     "Referer": "https://www.nseindia.com/"}
HOSTS = ("https://nsearchives.nseindia.com/products/content/", "https://archives.nseindia.com/products/content/")
KEEP = int(os.environ.get("DAYS", "30") or 30)
SERIES = {"EQ", "BE", "BZ", "SM", "ST"}
HIST = "data/nse_bhav.json"


def f(x):
    try:
        v = float(str(x).strip().replace(",", ""))
        return v if v == v else None
    except Exception:
        return None


def parse_bhav(text):
    """-> (iso_date, {SYMBOL: {o,h,l,c,v,t,dq,dp}})"""
    rd = csv.DictReader(io.StringIO(text))
    out, date = {}, None
    for row in rd:
        r = {(k or "").strip().upper(): (v or "").strip() for k, v in row.items()}
        if r.get("SERIES") not in SERIES:
            continue
        sym = r.get("SYMBOL")
        if not sym:
            continue
        if date is None and r.get("DATE1"):
            try:
                date = datetime.datetime.strptime(r["DATE1"], "%d-%b-%Y").strftime("%Y-%m-%d")
            except Exception:
                pass
        rec = {"o": f(r.get("OPEN_PRICE")), "h": f(r.get("HIGH_PRICE")), "l": f(r.get("LOW_PRICE")),
               "c": f(r.get("CLOSE_PRICE")), "lp": f(r.get("LAST_PRICE")), "v": f(r.get("TTL_TRD_QNTY")), "t": f(r.get("NO_OF_TRADES")),
               "dq": f(r.get("DELIV_QTY")), "dp": f(r.get("DELIV_PER"))}
        if rec["c"] is None or rec["v"] is None:
            continue
        # EQ wins over other series for the same symbol
        if sym not in out or r.get("SERIES") == "EQ":
            out[sym] = rec
    return date, out


def download(day, log):
    name = f"sec_bhavdata_full_{day:%d%m%Y}.csv"
    for h in HOSTS:
        try:
            r = requests.get(h + name, headers=H, timeout=40)
            if r.status_code == 200 and "SYMBOL" in r.text[:400].upper():
                return r.text
            log.append(f"{day}: HTTP {r.status_code} ({h.split('/')[2]})")
        except Exception as e:
            log.append(f"{day}: {e!r}"[:160])
    return None


def verdict(y, n):
    """y: Yahoo latest-session aggregates, n: NSE record -> (status, reasons, diffs)
    ok = prices and volume match; vol = prices match but Yahoo's volume is off; warn = a price differs."""
    ref = n.get("lp") or n["c"]          # Yahoo's last bar is the last traded price; NSE's 'close' is a 30-minute average
    dc = abs(y["c"] / ref - 1) * 100 if ref else None
    dh = (y["h"] / n["h"] - 1) * 100 if n["h"] else None
    dl = (y["l"] / n["l"] - 1) * 100 if n["l"] else None
    vr = y["v"] / n["v"] if n["v"] else None
    price, vol = [], []
    if dc is not None and dc > 0.3:
        price.append(f"last price differs by {dc:.2f}%")
    if dh is not None and abs(dh) > 0.5:
        price.append(f"day high differs by {dh:+.2f}%")
    if dl is not None and abs(dl) > 0.5:
        price.append(f"day low differs by {dl:+.2f}%")
    if vr is not None and not (0.85 <= vr <= 1.15):
        vol.append(f"volume is {vr*100:.0f}% of NSE's")
    st = "warn" if price else ("vol" if vol else "ok")
    return st, price + vol, {"dc": dc, "dh": dh, "dl": dl, "vr": vr}


def reconcile(hist, log, odir="data/orderflow"):
    dates = hist["dates"]
    ok = warn = pend = volo = 0
    kinds = {'price': 0, 'high': 0, 'low': 0, 'volume': 0}
    worst = []
    errs = []
    rank_path = "data/orderflow.json"
    rank = json.load(open(rank_path)) if os.path.exists(rank_path) else None
    rmap = {r["s"]: r for r in rank["stocks"]} if rank else {}
    for fn in os.listdir(odir) if os.path.isdir(odir) else []:
        try:
            if not fn.endswith(".json") or fn.endswith(".tf.json"):      # the longer time-frame files are not daily sessions
                continue
            p = os.path.join(odir, fn)
            d = json.load(open(p))
            s = d.get("s") or fn[:-5]
            sd = hist["stocks"].get(s)
            last = d["d"]
            di = len(d["days"]) - 1
            day_bars = [b for b in d["bars"] if b[0] == di]
            y = {"h": max(b[3] for b in day_bars), "l": min(b[4] for b in day_bars), "c": day_bars[-1][5], "v": sum(b[6] for b in day_bars)}
            info = {"date": last}
            if sd and last in sd["d"]:
                k = sd["d"].index(last)
                n = {"o": sd["o"][k], "h": sd["h"][k], "l": sd["l"][k], "c": sd["c"][k], "lp": sd["lp"][k], "v": sd["v"][k], "t": sd["t"][k], "dq": sd["dq"][k], "dp": sd["dp"][k]}
                st, why, dif = verdict(y, n)
                dps = [x for x in sd["dp"][:k] if x is not None][-20:]
                avg = sum(dps) / len(dps) if len(dps) >= 5 else None
                info.update({"status": st, "why": why, "nse": n, "avgdp": avg,
                             "spike": (n["dp"] / avg) if (avg and n["dp"] is not None) else None,
                             "dc": dif["dc"], "vr": dif["vr"],
                             "dphist": [x for x in sd["dp"][max(0, k - 19):k + 1]]})
                ok += st == "ok"; warn += st == "warn"; volo += st == "vol"
                for w in why:
                    kinds['price' if w.startswith('last price') else 'high' if w.startswith('day high') else 'low' if w.startswith('day low') else 'volume'] += 1
                if st in ("warn", "vol"):
                    worst.append((max(abs(dif['dc'] or 0), abs(dif['dh'] or 0), abs(dif['dl'] or 0), abs(((dif['vr'] or 1) - 1) * 100)), s, "; ".join(why)))
            else:
                info.update({"status": "pending", "why": ["NSE's file for this date is not available yet"]})
                pend += 1
            d["nse"] = info
            json.dump(d, open(p, "w"), separators=(",", ":"))
            if s in rmap:
                rmap[s]["q"] = info["status"]
                rmap[s]["dp"] = (info.get("nse") or {}).get("dp")
        except Exception as e:      # one bad stock file must not stop the whole check
            errs.append(f"{fn}: {e!r}"[:140])
    if rank:
        json.dump(rank, open(rank_path, "w"), separators=(",", ":"))
    if errs:
        log.append(f"{len(errs)} stock file(s) skipped because of errors, e.g. {errs[:3]}")
    log.append(f"Reconciled with NSE: ok {ok}, prices match but volume off {volo}, price differs {warn}, pending {pend}")
    log.append(f"Why stocks differ (a stock can be counted more than once): {kinds}")
    for sc, s, w in sorted(worst, reverse=True)[:10]:
        log.append(f"  worst: {s}: {w}")


def update_history(log):
    hist = json.load(open(HIST)) if os.path.exists(HIST) else {"dates": [], "stocks": {}}
    for e in hist["stocks"].values():            # older files had no last-traded-price column
        e.setdefault("lp", [None] * len(e["d"]))
    have = set(hist["dates"])
    # the newest stored day must carry last-traded-price; if not, fetch it again once
    refetch = None
    if hist["dates"]:
        newest = max(hist["dates"])
        if all((e["lp"][e["d"].index(newest)] if newest in e["d"] else 1) is None for e in hist["stocks"].values()):
            refetch = newest
            have.discard(newest)
    uni = {r["symbol"] for r in csv.DictReader(open("data/universe.csv", newline=""))}
    today = datetime.date.today()
    new = []
    misses = refused = 0
    MAXNEW = 8
    for back in range(0, 45):
        day = today - datetime.timedelta(days=back)
        if day.weekday() >= 5 or day.isoformat() in have:
            continue
        if len(have) >= KEEP and back > 6:
            break
        if len(new) >= MAXNEW:
            break
        txt = download(day, log)
        time.sleep(2.5)
        if not txt:
            misses += 1
            refused += 1
            if refused >= 3:
                log.append("NSE refused 3 requests in a row; stopping for this run (it will continue tomorrow)")
                break
            continue
        refused = 0
        date, rows = parse_bhav(txt)
        if not date:
            continue
        new.append((date, rows))
        have.add(date)
    FIELDS = ("o", "h", "l", "c", "lp", "v", "t", "dq", "dp")
    for date, rows in sorted(new):
        if date not in hist["dates"]:
            hist["dates"].append(date)
        for s, r in rows.items():
            if s not in uni:
                continue
            e = hist["stocks"].setdefault(s, {"d": [], **{k: [] for k in FIELDS}})
            if date in e["d"]:                      # replace an existing day
                i = e["d"].index(date)
                for k in FIELDS:
                    e[k][i] = r[k]
            else:
                e["d"].append(date)
                for k in FIELDS:
                    e[k].append(r[k])
            order = sorted(range(len(e["d"])), key=lambda i: e["d"][i])
            for k in ["d", *FIELDS]:
                e[k] = [e[k][i] for i in order]
    hist["dates"] = sorted(set(hist["dates"]))[-KEEP:]
    keep = set(hist["dates"])
    for s, e in list(hist["stocks"].items()):
        idx = [i for i, d in enumerate(e["d"]) if d in keep]
        for k in e:
            e[k] = [e[k][i] for i in idx]
        if not e["d"]:
            del hist["stocks"][s]
    json.dump(hist, open(HIST, "w"), separators=(",", ":"))
    log.append(f"NSE bhavcopy: {len(new)} new day(s) {[d for d, _ in sorted(new)]}; history {len(hist['dates'])} days, {len(hist['stocks'])} stocks; days not available: {misses}")
    return hist


if __name__ == "__main__":
    import traceback
    log = [f"Run (UTC): {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d %H:%M}"]
    failed = False
    try:
        hist = update_history(log)
        reconcile(hist, log)
    except Exception:
        failed = True
        log.append("FAILED: " + traceback.format_exc()[-900:])
    open("data/nse_bhav_log.txt", "w").write("\n".join(log) + "\n")
    print("\n".join(log))
    if failed:
        sys.exit(1)

"""News headlines (links only, no article text).
Macro: India first, then world, from Google News RSS searches.   -> data/news/macro.json
Micro: one India-edition search per stock (company name).          -> data/news/s_<first letter>.json
Old headlines are kept for KEEP_DAYS so a failed run never empties the page."""
import csv, datetime, email.utils, html, json, os, re, sys, time, urllib.parse
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
import requests

KEEP_DAYS, PER_STOCK, PER_TOPIC = 7, 40, 80   # company news kept 7 days (40 items), macro news kept 4 days (80 items per topic)
MACRO_DAYS = 4
LIMIT = int(os.environ.get("LIMIT", "0") or 0)
UA = {"User-Agent": "Mozilla/5.0 (compatible; EquityTerminal/1.0)"}
IN = "hl=en-IN&gl=IN&ceid=IN:en"
US = "hl=en-US&gl=US&ceid=US:en"
now = datetime.datetime.now(datetime.timezone.utc)

MACRO = [  # (group, topic, query, edition)
    ("India", "Economy & GDP", "India economy GDP growth", IN),
    ("India", "RBI & rates", "RBI repo rate monetary policy", IN),
    ("India", "Inflation", "India CPI inflation", IN),
    ("India", "Budget & policy", "India government budget fiscal deficit policy", IN),
    ("India", "Markets", "Sensex Nifty market today", IN),
    ("India", "FPI & flows", "FPI FII flows India equities", IN),
    ("India", "Rupee & trade", "rupee dollar India trade deficit", IN),
    ("World", "US Fed & rates", "Federal Reserve interest rates", US),
    ("World", "Global markets", "global stock markets Wall Street", US),
    ("World", "Crude oil", "crude oil prices Brent OPEC", US),
    ("World", "China & Asia", "China economy Asia markets", US),
    ("World", "Gold & dollar", "gold price dollar index", US),
]

def clean_name(n):
    n = re.sub(r"\b(ltd|limited|inc|corp|corporation|pvt|private)\b\.?", "", n or "", flags=re.I)
    return re.sub(r"\s+", " ", n).strip(" .,&-")

def fetch(q, ed, tries=2):
    url = "https://news.google.com/rss/search?q=" + urllib.parse.quote(q + " when:7d") + "&" + ed
    for i in range(tries):
        try:
            r = requests.get(url, headers=UA, timeout=20)
            if r.status_code == 200:
                return parse(r.content)
            if r.status_code in (429, 503):
                time.sleep(5 * (i + 1))
        except Exception:
            time.sleep(2)
    return None

def parse(b):
    out = []
    root = ET.fromstring(b)
    for it in root.iter("item"):
        t = html.unescape(it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        src = html.unescape(it.findtext("source") or "").strip()
        if src and t.endswith(" - " + src):
            t = t[: -len(src) - 3].strip()
        try:
            d = email.utils.parsedate_to_datetime(it.findtext("pubDate"))
            if d.tzinfo is None:
                d = d.replace(tzinfo=datetime.timezone.utc)
        except Exception:
            continue
        if t and link:
            out.append({"t": t[:220], "u": link, "s": src[:40], "d": d.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")})
    return out

def merge(old, new, cap, days=None):
    seen, res = set(), []
    cut = (now - datetime.timedelta(days=days or KEEP_DAYS)).strftime("%Y-%m-%dT%H:%MZ")
    for x in sorted((new or []) + (old or []), key=lambda x: x["d"], reverse=True):
        k = re.sub(r"\W+", "", x["t"].lower())[:70]
        if k in seen or x["d"] < cut:
            continue
        seen.add(k)
        res.append(x)
    return res[:cap]

def load(p):
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return {}

def main():
    os.makedirs("data/news", exist_ok=True)
    log, stamp = [], now.strftime("%Y-%m-%d %H:%M")
    # ---- macro
    old = load("data/news/macro.json")
    oldt = {(t["g"], t["n"]): t["items"] for t in old.get("topics", [])}
    topics, ok = [], 0
    for g, n, q, ed in MACRO:
        new = fetch(q, ed)
        if new is not None:
            ok += 1
        topics.append({"g": g, "n": n, "items": merge(oldt.get((g, n)), new, PER_TOPIC, MACRO_DAYS)})
        time.sleep(0.5)
    json.dump({"updated": stamp, "topics": topics}, open("data/news/macro.json", "w", encoding="utf-8"), separators=(",", ":"))
    log.append(f"macro: {ok}/{len(MACRO)} topics fetched")
    # ---- micro
    uni = list(csv.DictReader(open("data/universe.csv", encoding="utf-8-sig")))
    if LIMIT:
        uni = uni[:LIMIT]
    shards = {}
    for r in uni:
        c = (r["symbol"][:1] or "_").upper()
        c = c if c.isalpha() else "_"
        shards.setdefault(c, load(f"data/news/s_{c}.json").get("stocks", {}))
    state = {"fail": 0, "stop": False}

    def one(r):
        if state["stop"]:
            return r["symbol"], None
        nm = clean_name(r.get("company") or r["symbol"])
        q = f'"{nm}" (shares OR stock OR results OR NSE OR BSE)'
        res = fetch(q, IN)
        if res is None:
            state["fail"] += 1
            if state["fail"] >= 25:
                state["stop"] = True
        else:
            state["fail"] = 0
        time.sleep(0.25)
        return r["symbol"], res
    got = fail = 0
    with ThreadPoolExecutor(4) as ex:
        for sym, res in ex.map(one, uni):
            c = (sym[:1] or "_").upper()
            c = c if c.isalpha() else "_"
            if res is None:
                fail += 1
            else:
                got += 1
                shards[c][sym] = merge(shards[c].get(sym), res, PER_STOCK)
    for c, d in shards.items():   # drop stocks whose stored headlines have all expired
        d = {k: v for k, v in d.items() if v}
        json.dump({"updated": stamp, "stocks": d}, open(f"data/news/s_{c}.json", "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
    log.append(f"stocks: {got} fetched, {fail} failed or skipped of {len(uni)}" + ("  (stopped early: too many errors in a row; older headlines kept)" if state["stop"] else ""))
    open("data/news_log.txt", "w").write("Run (UTC): " + stamp + "\n" + "\n".join(log) + "\nHeadlines and links only; each opens the publisher's own page.\n")
    print("\n".join(log))

if __name__ == "__main__":
    main()

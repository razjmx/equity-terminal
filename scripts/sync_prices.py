"""Copy the latest close from data/prices/SYM.csv into data/fundamentals/SYM.json (info block)
so metrics and DCF use today's price. Scales marketCap by the price ratio. Writes data/price_sync.txt."""
import csv, json, os, glob, datetime

FUND = "data/fundamentals"
PRICES = "data/prices"
KEYS = ("currentPrice", "regularMarketPrice", "previousClose")


def last_close(path):
    last = None
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            try:
                c = float(row["Close"])
            except Exception:
                continue
            if c > 0:
                last = (row["Date"], c)
    return last


def main():
    updated = skipped = errors = 0
    notes = []
    tcs = None
    for fp in sorted(glob.glob(os.path.join(FUND, "*.json"))):
        sym = os.path.basename(fp)[:-5]
        pp = os.path.join(PRICES, sym + ".csv")
        if not os.path.exists(pp):
            skipped += 1
            continue
        try:
            lc = last_close(pp)
            if not lc:
                skipped += 1
                continue
            date, px = lc
            with open(fp) as f:
                d = json.load(f)
            info = d.get("info")
            if not isinstance(info, dict):
                skipped += 1
                continue
            old = None
            for k in KEYS[:2]:
                v = info.get(k)
                if isinstance(v, (int, float)) and v > 0:
                    old = v
                    break
            changed = False
            for k in KEYS:
                if k in info and info[k] != px:
                    info[k] = px
                    changed = True
            if "currentPrice" not in info:
                info["currentPrice"] = px
                changed = True
            if old and isinstance(info.get("marketCap"), (int, float)) and old != px:
                # guard against bad data: ignore price jumps over 40 percent vs saved info price
                if abs(px / old - 1) > 0.40:
                    notes.append(f"{sym}: price moved {px/old-1:+.0%} vs saved info ({old} -> {px}), not synced")
                    skipped += 1
                    continue
                info["marketCap"] = info["marketCap"] * px / old
                changed = True
            info["price_synced_date"] = date
            if changed:
                with open(fp, "w") as f:
                    json.dump(d, f)
                updated += 1
            if sym == "TCS":
                tcs = (date, px)
        except Exception as e:
            errors += 1
            notes.append(f"{sym}: {type(e).__name__} {e}")
    now = datetime.datetime.now(datetime.timezone.utc)
    with open("data/price_sync.txt", "w") as f:
        f.write(f"Run (UTC): {now:%Y-%m-%d %H:%M}\n")
        f.write(f"Updated: {updated} | skipped: {skipped} | errors: {errors}\n")
        f.write(f"TCS synced to: {tcs}\n")
        for n in notes[:50]:
            f.write(n + "\n")
    print("price sync done", updated, skipped, errors)


if __name__ == "__main__":
    main()

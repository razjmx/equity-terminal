"""Intraday volume profile and VWAP/TWAP schedule tracking (execution model).

Reads   data/universe.csv
Writes  data/quant/intraday/SYM.json   per-stock profile, tracking errors, bucket volumes
        data/quant/profile.json        universe-average profile (the shrinkage prior) and summary
        data/quant_intraday_log.txt

Yahoo gives about 60 calendar days of 5-minute bars. They are summed to 15-minute buckets (25 per NSE session,
09:15-15:30). Only sessions where every bucket traded are used. Per stock the profile is the mean of its own daily
volume shares shrunk toward the universe profile with weight n/(n+5). Tracking error is walk-forward: for each day
from the 16th on, the profile is estimated only from earlier days, then a VWAP schedule built on it is compared with
a uniform (TWAP) schedule against that day's actual VWAP. Env: LIMIT, CHUNK."""
import csv, datetime, json, math, os, sys, time
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import quantlib as Q

OUT = "data/quant/intraday"
NB = 25
MIN_TRAIN = 15


def buckets(d):
    """d: 5-minute bars (index in IST). Returns dict date -> (vol[25], vwap_px[25]) for complete sessions."""
    d = d[(d["Volume"] > 0) & d["Close"].notna()].copy()
    if d.empty:
        return {}
    t = d.index.hour * 60 + d.index.minute
    d = d[(t >= 9 * 60 + 15) & (t < 15 * 60 + 30)]
    t = d.index.hour * 60 + d.index.minute
    d["b"] = ((t - (9 * 60 + 15)) // 15).astype(int)
    d["day"] = d.index.date
    d["tp"] = (d["High"] + d["Low"] + d["Close"]) / 3
    d["pv"] = d["tp"] * d["Volume"]
    g = d.groupby(["day", "b"]).agg(v=("Volume", "sum"), pv=("pv", "sum"))
    out = {}
    for day, sub in g.groupby(level=0):
        sub = sub.droplevel(0)
        if len(sub) != NB or sub["v"].min() <= 0:
            continue
        out[day] = (sub["v"].reindex(range(NB)).to_numpy(float), (sub["pv"] / sub["v"]).reindex(range(NB)).to_numpy(float))
    return out


def main():
    import yfinance as yf
    LIMIT = int(os.environ.get("LIMIT", "0") or 0)
    CH = int(os.environ.get("CHUNK", "25") or 25)
    os.makedirs(OUT, exist_ok=True)
    syms = [r["symbol"] for r in csv.DictReader(open("data/universe.csv", newline="")) if not r["symbol"].startswith("DUMMY")]
    if LIMIT:
        syms = syms[:LIMIT]
    data, bad = {}, []
    for k in range(0, len(syms), CH):
        part = syms[k:k + CH]
        try:
            raw = yf.download([s + ".NS" for s in part], period="60d", interval="5m", group_by="ticker",
                              threads=True, progress=False, auto_adjust=False)
        except Exception as e:
            bad += part
            continue
        for s in part:
            try:
                d = raw[s + ".NS"] if len(part) > 1 else raw
                d = d.dropna(how="all")
                if d.empty:
                    bad.append(s); continue
                if d.index.tz is not None:
                    d.index = d.index.tz_convert("Asia/Kolkata")
                b = buckets(d)
                if len(b) >= 20:
                    data[s] = b
                else:
                    bad.append(s)
            except Exception:
                bad.append(s)
        time.sleep(2)
    if len(data) < 20:
        print("too few stocks with intraday data"); sys.exit(0)

    # universe prior from liquid stocks: average of each stock's mean share profile
    means = []
    for s, b in data.items():
        S = Q.day_profiles(np.array([v for v, _ in b.values()]))
        if len(S) >= 20:
            means.append(S.mean(axis=0))
    prior = np.mean(means, axis=0); prior = prior / prior.sum()
    labels = [f"{9 + (15 + 15 * i) // 60}:{(15 + 15 * i) % 60:02d}" for i in range(NB)]

    summ = []
    for s, b in data.items():
        days = sorted(b)
        V = np.array([b[d][0] for d in days]); P = np.array([b[d][1] for d in days])
        S = V / V.sum(axis=1, keepdims=True)
        prof, n = Q.estimate_profile(S, prior, 5)
        res = {"s": s, "n": int(len(days)), "from": str(days[0]), "to": str(days[-1]), "labels": labels,
               "profile": [round(float(x), 5) for x in prof], "own": [round(float(x), 5) for x in S.mean(axis=0)],
               "adv": round(float(np.median(V.sum(axis=1))), 0),
               "ret_bps_sd": [round(float(x), 1) for x in np.std(np.diff(np.log(P), axis=1), axis=0) * 1e4]}
        if len(days) >= MIN_TRAIN + 5:
            vw, tw = [], []
            for i in range(MIN_TRAIN, len(days)):
                pf, _ = Q.estimate_profile(S[:i], prior, 5)
                t = Q.schedule_tracking(None, pf, P[i:i + 1], V[i:i + 1])
                vw.append(t["vwap"][0]); tw.append(t["twap"][0])
            res["trk"] = {"days": len(vw), "vwap_bias": round(float(vw[0] if False else np.mean(vw)), 2),
                          "vwap_rmse": round(float(np.sqrt(np.mean(np.square(vw)))), 2),
                          "twap_rmse": round(float(np.sqrt(np.mean(np.square(tw)))), 2)}
        json.dump(res, open(f"{OUT}/{s}.json", "w"), separators=(",", ":"))
        summ.append(res)
    better = sum(1 for r in summ if r.get("trk") and r["trk"]["vwap_rmse"] < r["trk"]["twap_rmse"])
    tested = sum(1 for r in summ if r.get("trk"))
    json.dump({"asof": max(r["to"] for r in summ), "labels": labels, "prior": [round(float(x), 5) for x in prior],
               "n_stocks": len(summ), "tested": tested, "vwap_beats_twap": better,
               "note": "Walk-forward: each day's profile uses only earlier days. Tracking error is the gap between the schedule's "
                       "average price and that day's actual volume-weighted price, in basis points, on 15-minute bucket prices."},
              open("data/quant/profile.json", "w"), separators=(",", ":"))
    open("data/quant_intraday_log.txt", "w").write(
        f"Run (UTC): {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d %H:%M}\nstocks with profile {len(summ)}\n"
        f"no/short intraday data {len(bad)} {bad[:20]}\nVWAP schedule beat TWAP in {better} of {tested} stocks\n")
    print(open("data/quant_intraday_log.txt").read())


if __name__ == "__main__":
    main()

// sim.js - Geometric Brownian Motion paths, Monte Carlo option pricing and the Kelly criterion. Pure functions, no data files.
// GBM: dS = mu S dt + sigma S dW, simulated with the exact step S(t+dt) = S(t) exp((mu - sigma^2/2) dt + sigma sqrt(dt) Z).
// Monte Carlo price: discounted average payoff over terminal prices simulated with the drift set to r - q (risk-neutral), using antithetic pairs.
// Kelly: g(f) = p ln(1 + f g) + (1 - p) ln(1 - f l), the long-run growth rate when a fraction f of capital is staked each time.
(function () {
  function rng(seed) {   // mulberry32: small, fast, repeatable
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function normal(rand) {   // Box-Muller
    let spare = null;
    return () => {
      if (spare !== null) { const v = spare; spare = null; return v; }
      let u = 0; while (u === 0) u = rand();
      const v = rand(), m = Math.sqrt(-2 * Math.log(u));
      spare = m * Math.sin(2 * Math.PI * v);
      return m * Math.cos(2 * Math.PI * v);
    };
  }
  const pct = (sorted, q) => { const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); };

  // p: {S, mu, vol, T (years), steps, n, seed}. Returns percentile bands per step, a few sample paths and the terminal prices.
  function gbm(p) {
    const { S, mu, vol } = p, T = p.T, steps = Math.max(2, Math.floor(p.steps || 60)), n = Math.max(100, Math.floor(p.n || 5000));
    const dt = T / steps, drift = (mu - vol * vol / 2) * dt, sd = vol * Math.sqrt(dt), Z = normal(rng(p.seed || 1));
    const cols = Array.from({ length: steps + 1 }, () => new Float64Array(n)), keep = [];
    for (let i = 0; i < n; i++) {
      let x = Math.log(S); cols[0][i] = S;
      const path = i < 6 ? [S] : null;
      for (let k = 1; k <= steps; k++) { x += drift + sd * Z(); const v = Math.exp(x); cols[k][i] = v; if (path) path.push(v); }
      if (path) keep.push(path);
    }
    const bands = { q05: [], q25: [], q50: [], q75: [], q95: [], mean: [] }, t = [];
    for (let k = 0; k <= steps; k++) {
      const s = Array.from(cols[k]).sort((a, b) => a - b);
      bands.q05.push(pct(s, .05)); bands.q25.push(pct(s, .25)); bands.q50.push(pct(s, .5)); bands.q75.push(pct(s, .75)); bands.q95.push(pct(s, .95));
      bands.mean.push(s.reduce((a, b) => a + b, 0) / n); t.push(T * k / steps);
    }
    const term = Array.from(cols[steps]);
    return { t, bands, paths: keep, terminal: term, mean: bands.mean[steps], q: { 5: bands.q05[steps], 25: bands.q25[steps], 50: bands.q50[steps], 75: bands.q75[steps], 95: bands.q95[steps] },
      pLoss: term.filter(v => v < S).length / n, pUp10: term.filter(v => v > S * 1.1).length / n, pDown10: term.filter(v => v < S * 0.9).length / n };
  }

  // p: {S, K, T, r, q, vol, type, n, seed}. n counts simulated terminal prices (half of them are antithetic mirrors).
  function mcPrice(p, checkpoints) {
    const { S, K, T, r, q, vol } = p, call = p.type !== 'put', n = Math.max(200, Math.floor(p.n || 20000)) & ~1;
    const Z = normal(rng(p.seed || 1)), drift = (r - q - vol * vol / 2) * T, sd = vol * Math.sqrt(T), df = Math.exp(-r * T);
    const pay = s => call ? Math.max(s - K, 0) : Math.max(K - s, 0);
    let sum = 0, sum2 = 0, pairs = 0;
    const term = [], conv = [], cp = (checkpoints || []).slice().sort((a, b) => a - b);
    let ci = 0;
    for (let i = 0; i < n / 2; i++) {
      const z = Z(), s1 = S * Math.exp(drift + sd * z), s2 = S * Math.exp(drift - sd * z), v = df * (pay(s1) + pay(s2)) / 2;
      sum += v; sum2 += v * v; pairs++;
      if (term.length < 20000) { term.push(s1, s2); }
      while (ci < cp.length && pairs * 2 >= cp[ci]) {
        const m = sum / pairs, se = Math.sqrt(Math.max(sum2 / pairs - m * m, 0) / pairs);
        conv.push({ n: pairs * 2, price: m, se }); ci++;
      }
    }
    const m = sum / pairs, se = Math.sqrt(Math.max(sum2 / pairs - m * m, 0) / pairs);
    return { price: m, se, lo: m - 1.96 * se, hi: m + 1.96 * se, terminal: term, conv, n };
  }

  // Kelly. p = chance of winning, g = gain per 1 staked when you win, l = fraction of the stake lost when you lose (1 = all of it).
  function growth(f, p, g, l) { const a = 1 + f * g, b = 1 - f * l; return a > 0 && b > 0 ? p * Math.log(a) + (1 - p) * Math.log(b) : -Infinity; }
  function kelly(p, g, l) {
    l = l == null ? 1 : l;
    const fs = Math.max(0, p / l - (1 - p) / g), fmax = Math.min(1 / l, 1) * 0.999;
    let breakeven = null;        // the stake above which growth turns negative
    if (fs > 0) { let lo = fs, hi = fmax; if (growth(hi, p, g, l) > 0) breakeven = null; else { for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (growth(mid, p, g, l) > 0) lo = mid; else hi = mid; } breakeven = (lo + hi) / 2; } }
    return { f: Math.min(fs, fmax), edge: p * g - (1 - p) * l, growth: f => growth(f, p, g, l), breakeven, fmax };
  }
  // Repeated bets at stake fraction f: median final wealth, chance of ending below the start, chance of a 50% drawdown on the way.
  function betRun(p, g, l, f, bets, runs, seed) {
    l = l == null ? 1 : l;
    const R = rng(seed || 3), fin = [];
    let loss = 0, dd50 = 0;
    for (let i = 0; i < runs; i++) {
      let w = 1, peak = 1, hit = false;
      for (let k = 0; k < bets; k++) { w *= R() < p ? 1 + f * g : 1 - f * l; if (w > peak) peak = w; if (w < peak * 0.5) hit = true; }
      fin.push(w); if (w < 1) loss++; if (hit) dd50++;
    }
    fin.sort((a, b) => a - b);
    return { median: pct(fin, .5), p10: pct(fin, .1), p90: pct(fin, .9), pLoss: loss / runs, pDD50: dd50 / runs };
  }
  const api = { rng, normal, gbm, mcPrice, kelly, growth, betRun };
  if (typeof window !== 'undefined') window.SIM = api;
  if (typeof module !== 'undefined') module.exports = api;
})();

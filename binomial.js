// binomial.js - Cox-Ross-Rubinstein binomial tree for options on a stock with a continuous dividend yield. Pure functions.
// u = exp(sigma sqrt(dt)), d = 1/u, risk-neutral p = (exp((r - q) dt) - d) / (u - d). American options test early exercise at every node.
(function () {
  const cnd = x => {   // standard normal CDF, Hart (1968) as given by West (2005), double precision
    const a = Math.abs(x); let c;
    if (a > 37) c = 0; else {
      const e = Math.exp(-a * a / 2);
      if (a < 7.07106781186547) {
        let b = 3.52624965998911e-02 * a + 0.700383064443688; b = b * a + 6.37396220353165; b = b * a + 33.912866078383; b = b * a + 112.079291497871; b = b * a + 221.213596169931; b = b * a + 220.206867912376; c = e * b;
        b = 8.83883476483184e-02 * a + 1.75566716318264; b = b * a + 16.064177579207; b = b * a + 86.7807322029461; b = b * a + 296.564248779674; b = b * a + 637.333633378831; b = b * a + 793.826512519948; b = b * a + 440.413735824752; c = c / b;
      } else { let b = a + 0.65; b = a + 4 / b; b = a + 3 / b; b = a + 2 / b; b = a + 1 / b; c = e / b / 2.506628274631; }
    }
    return x > 0 ? 1 - c : c;
  };
  function bs(p) {   // Black-Scholes-Merton with dividend yield, European. p: {S,K,T,r,q,vol,type}
    const { S, K, T, r, q, vol } = p, call = p.type !== 'put';
    if (T <= 0 || vol <= 0) { const df = Math.exp(-r * Math.max(T, 0)); const f = S * Math.exp(-q * Math.max(T, 0)); return call ? Math.max(f - K * df, 0) : Math.max(K * df - f, 0); }
    const sq = vol * Math.sqrt(T), d1 = (Math.log(S / K) + (r - q + vol * vol / 2) * T) / sq, d2 = d1 - sq;
    return call ? S * Math.exp(-q * T) * cnd(d1) - K * Math.exp(-r * T) * cnd(d2) : K * Math.exp(-r * T) * cnd(-d2) - S * Math.exp(-q * T) * cnd(-d1);
  }
  // Core tree. Returns the price and the node values needed for delta, gamma and theta.
  function tree(p) {
    const { S, K, T, r, q, vol } = p, N = Math.max(2, Math.floor(p.N || 200)), call = p.type !== 'put', am = p.style === 'american';
    const dt = T / N, u = Math.exp(vol * Math.sqrt(dt)), d = 1 / u, disc = Math.exp(-r * dt), pu = (Math.exp((r - q) * dt) - d) / (u - d);
    if (!(pu > 0 && pu < 1)) throw new Error('The tree is unstable for these inputs (risk-neutral probability outside 0..1). Increase the steps or the volatility.');
    const pay = s => call ? Math.max(s - K, 0) : Math.max(K - s, 0);
    let V = new Array(N + 1); for (let j = 0; j <= N; j++) V[j] = pay(S * Math.pow(u, 2 * j - N));   // j = number of up moves
    const keep = {};
    for (let i = N - 1; i >= 0; i--) {
      const W = new Array(i + 1);
      for (let j = 0; j <= i; j++) {
        let v = disc * (pu * V[j + 1] + (1 - pu) * V[j]);
        if (am) { const ex = pay(S * Math.pow(u, 2 * j - i)); if (ex > v) v = ex; }
        W[j] = v;
      }
      V = W; if (i <= 2) keep[i] = V.slice();
    }
    const s = (i, j) => S * Math.pow(u, 2 * j - i), k1 = keep[1], k2 = keep[2];
    const delta = (k1[1] - k1[0]) / (s(1, 1) - s(1, 0));
    const gamma = ((k2[2] - k2[1]) / (s(2, 2) - s(2, 1)) - (k2[1] - k2[0]) / (s(2, 1) - s(2, 0))) / (0.5 * (s(2, 2) - s(2, 0)));
    const theta = (k2[1] - V[0]) / (2 * dt);   // per year
    return { price: V[0], delta, gamma, theta, u, d, pu, dt, N };
  }
  // Full result with Greeks by bumping, early-exercise premium, probability of finishing in the money and the Black-Scholes check.
  function price(p) {
    const base = tree(p), up = x => ({ ...p, ...x });
    const vega = (tree(up({ vol: p.vol + 0.01 })).price - tree(up({ vol: Math.max(0.001, p.vol - 0.01) })).price) / 2;
    const rho = (tree(up({ r: p.r + 0.01 })).price - tree(up({ r: p.r - 0.01 })).price) / 2;
    const eu = p.style === 'american' ? tree(up({ style: 'european' })).price : base.price;
    // risk-neutral probability of finishing in the money: N(d2) for a call, N(-d2) for a put
    const sq = p.vol * Math.sqrt(p.T), d2 = (Math.log(p.S / p.K) + (p.r - p.q - p.vol * p.vol / 2) * p.T) / sq, prob = p.type !== 'put' ? cnd(d2) : cnd(-d2);
    return { ...base, vega, rho, thetaDay: base.theta / 365, european: eu, earlyPremium: base.price - eu, probITM: prob, bs: bs(p) };
  }
  function impliedVol(p, market) {   // bisection on the tree price; returns null if the market price is outside what any volatility can give
    let lo = 0.01, hi = 3; const f = v => tree({ ...p, vol: v }).price;
    if (market < f(lo) - 1e-9 || market > f(hi) + 1e-9) return null;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (f(m) < market) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
  // small tree for display: stock price and option value at each node, up to `steps` steps
  function small(p, steps) {
    const { S, K, T, r, q, vol } = p, call = p.type !== 'put', am = p.style === 'american', N = steps, dt = T / N, u = Math.exp(vol * Math.sqrt(dt)), d = 1 / u, disc = Math.exp(-r * dt), pu = (Math.exp((r - q) * dt) - d) / (u - d);
    const pay = s => call ? Math.max(s - K, 0) : Math.max(K - s, 0), rows = [];
    for (let i = 0; i <= N; i++) { rows.push([]); for (let j = 0; j <= i; j++) rows[i].push({ s: S * Math.pow(u, 2 * j - i), v: null, ex: false }); }
    for (let j = 0; j <= N; j++) rows[N][j].v = pay(rows[N][j].s);
    for (let i = N - 1; i >= 0; i--) for (let j = 0; j <= i; j++) { let v = disc * (pu * rows[i + 1][j + 1].v + (1 - pu) * rows[i + 1][j].v); const e = pay(rows[i][j].s); if (am && e > v) { v = e; rows[i][j].ex = true; } rows[i][j].v = v; }
    return { rows, pu, u, d };
  }
  const api = { cnd, bs, tree, price, impliedVol, small };
  if (typeof window !== 'undefined') window.BT = api;
  if (typeof module !== 'undefined') module.exports = api;
})();

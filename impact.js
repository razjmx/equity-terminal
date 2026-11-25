// impact.js - Almgren-Chriss optimal execution (linear impact), pure functions, no dependencies.
// Shortfall is measured against the arrival price. Units: price S, shares X, horizon T trading days, volatility in price per sqrt(day).
//   permanent impact  g(v) = gamma * v        gamma = G0 * sigma_d / V   (price per share traded)
//   temporary impact  h(v) = eps + eta * v    eta   = E0 * sigma_d / V   (price per share per share/day); eps = half-spread
//   expected cost  E = 1/2 gamma X^2 + eps X + eta * sum(n_k^2) / tau
//   variance       Var = sigma_d^2 * tau * sum(x_k^2)         (x_k = shares still held after interval k)
//   optimal path   x(t) = X sinh(kappa (T - t)) / sinh(kappa T),  urgency u = kappa T  (u = 0 is the straight-line TWAP)
// G0 = 0.314 and E0 = 0.142 are the calibration of Almgren, Thum, Hauptmann and Li (2005) on US stocks. Indian stocks can differ,
// so the page lets the user scale impact with a multiplier and set the half-spread.
(function () {
  const G0 = 0.314, E0 = 0.142;
  function traj(u, N) {                       // fraction of the order still held after each of N equal intervals (index 0 = start)
    const x = new Array(N + 1);
    for (let k = 0; k <= N; k++) {
      const f = k / N;
      x[k] = u < 1e-9 ? 1 - f : Math.sinh(u * (1 - f)) / Math.sinh(u);
    }
    x[N] = 0; return x;
  }
  // p: {X shares, S price, volAnn % (annualised), V shares/day, T days, N intervals, u urgency, spreadBps half-spread, mult impact multiplier}
  function run(p) {
    const N = p.N, tau = p.T / N, sd = p.S * (p.volAnn / 100) / Math.sqrt(252);
    const gam = p.mult * G0 * sd / p.V, eta = p.mult * E0 * sd / p.V, eps = p.S * p.spreadBps / 1e4;
    const x = traj(p.u, N); let sumn2 = 0, sumx2 = 0;
    for (let k = 1; k <= N; k++) { const n = (x[k - 1] - x[k]) * p.X; sumn2 += n * n; sumx2 += (x[k] * p.X) * (x[k] * p.X); }
    const perm = 0.5 * gam * p.X * p.X, spr = eps * p.X, temp = eta * sumn2 / tau;
    const notional = p.X * p.S, bp = v => v / notional * 1e4;
    const sd_cost = sd * Math.sqrt(tau * sumx2);
    const E = perm + spr + temp;
    return { x, perm: bp(perm), spr: bp(spr), temp: bp(temp), exp: bp(E), risk: bp(sd_cost), worst: bp(E + 1.645 * sd_cost),
      rs: { exp: E, risk: sd_cost }, first: (x[0] - x[1]) * 100, sd, gam, eta };
  }
  function frontier(p, umax, steps) {
    const out = []; for (let i = 0; i <= steps; i++) { const u = umax * i / steps; const r = run({ ...p, u }); out.push({ u, exp: r.exp, risk: r.risk }); } return out;
  }
  const api = { run, frontier, traj, G0, E0 };
  if (typeof window !== 'undefined') window.AC = api;
  if (typeof module !== 'undefined') module.exports = api;
})();

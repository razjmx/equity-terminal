// portfolio.js - portfolio construction on the client: covariance shrinkage, constrained mean-variance, risk parity,
// hierarchical risk parity and a walk-forward test. Matrices are arrays of rows. Inputs are daily simple returns.
(function (root) {
  const TD = 252;
  const zeros = n => new Array(n).fill(0);
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  const matVec = (M, v) => M.map(r => dot(r, v));
  const sum = a => a.reduce((x, y) => x + y, 0);

  // ---- covariance ----
  function mean(R) { const T = R.length, N = R[0].length, m = zeros(N); for (const r of R) for (let j = 0; j < N; j++) m[j] += r[j]; return m.map(x => x / T); }
  function sampleCov(R) {
    const T = R.length, N = R[0].length, m = mean(R), S = Array.from({ length: N }, () => zeros(N));
    for (const r of R) { const d = r.map((x, j) => x - m[j]); for (let i = 0; i < N; i++) for (let j = i; j < N; j++) S[i][j] += d[i] * d[j]; }
    for (let i = 0; i < N; i++) for (let j = i; j < N; j++) { S[i][j] /= T; S[j][i] = S[i][j]; }   // 1/T (MLE), as in Ledoit-Wolf
    return S;
  }
  // Ledoit & Wolf (2004) shrinkage toward mu*I, mu = trace/N. Same estimator as sklearn.covariance.LedoitWolf.
  function ledoitWolf(R) {
    const T = R.length, N = R[0].length, m = mean(R), X = R.map(r => r.map((x, j) => x - m[j]));
    const S = sampleCov(R);
    let mu = 0; for (let i = 0; i < N; i++) mu += S[i][i]; mu /= N;
    let d2 = 0; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) d2 += (S[i][j] - (i === j ? mu : 0)) ** 2;
    let b2 = 0;
    for (const x of X) { let t = 0; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const v = x[i] * x[j] - S[i][j]; t += v * v; } b2 += t; }
    b2 /= T * T;
    b2 = Math.min(b2, d2);
    const delta = d2 === 0 ? 0 : b2 / d2;
    const C = S.map((r, i) => r.map((v, j) => (1 - delta) * v + (i === j ? delta * mu : 0)));
    return { cov: C, shrink: delta };
  }
  const annualise = C => C.map(r => r.map(v => v * TD));

  // ---- projection onto {w >= 0, sum w = 1, w <= cap} ----
  function projectCapped(v, cap) {
    const n = v.length; cap = Math.max(cap, 1 / n);
    let lo = Math.min(...v) - cap, hi = Math.max(...v);
    for (let k = 0; k < 100; k++) {
      const t = (lo + hi) / 2; let s = 0;
      for (let i = 0; i < n; i++) s += Math.min(cap, Math.max(0, v[i] - t));
      if (s > 1) lo = t; else hi = t;
    }
    const t = (lo + hi) / 2, w = v.map(x => Math.min(cap, Math.max(0, x - t)));
    const s = sum(w); return w.map(x => x / s);
  }
  function lambdaMax(C) {   // power iteration for the largest eigenvalue (step size for projected gradient)
    const n = C.length; let v = new Array(n).fill(1 / Math.sqrt(n)), l = 1;
    for (let k = 0; k < 200; k++) { const u = matVec(C, v), nu = Math.sqrt(dot(u, u)); if (nu === 0) return 1; v = u.map(x => x / nu); l = nu; }
    return l;
  }
  // minimise 0.5 w'Cw - lam * mu'w over the capped simplex (accelerated projected gradient, FISTA)
  function qp(C, mu, lam, cap, w0, iters = 4000, tol = 1e-12) {
    const n = C.length, L = lambdaMax(C) * 1.05 + 1e-12;
    let w = (w0 || new Array(n).fill(1 / n)).slice(), y = w.slice(), t = 1;
    const grad = x => { const g = matVec(C, x); for (let i = 0; i < n; i++) g[i] -= lam * mu[i]; return g; };
    for (let k = 0; k < iters; k++) {
      const g = grad(y), wn = projectCapped(y.map((v, i) => v - g[i] / L), cap);
      const tn = (1 + Math.sqrt(1 + 4 * t * t)) / 2, f = (t - 1) / tn;
      const yn = wn.map((v, i) => v + f * (v - w[i]));
      let d = 0; for (let i = 0; i < n; i++) d = Math.max(d, Math.abs(wn[i] - w[i]));
      w = wn; y = yn; t = tn;
      if (d < tol) break;
    }
    return w;
  }
  const stats = (w, C, mu, rf = 0) => { const v = dot(w, matVec(C, w)), s = Math.sqrt(Math.max(v, 0)), r = dot(w, mu); return { ret: r, vol: s, sharpe: s > 0 ? (r - rf) / s : 0 }; };
  function minVariance(C, cap = 1) { return qp(C, zeros(C.length), 0, cap); }
  // efficient frontier: sweep the risk-aversion weight lam from 0 (min variance) up to pure return
  function frontier(C, mu, cap = 1, rf = 0, points = 40) {
    const wMin = minVariance(C, cap), sMin = stats(wMin, C, mu, rf);
    // largest useful lam: where the solution is the max-return corner
    let lamHi = 1; for (let k = 0; k < 40; k++) { const w = qp(C, mu, lamHi, cap, null, 800); const s = stats(w, C, mu, rf); const top = Math.max(...mu); if (s.ret >= 0.995 * bestRet(mu, cap)) break; lamHi *= 2; }
    const out = [{ lam: 0, w: wMin, ...sMin }]; let prev = wMin;
    for (let k = 1; k < points; k++) {
      const lam = lamHi * Math.pow(k / (points - 1), 2);
      const w = qp(C, mu, lam, cap, prev); prev = w; out.push({ lam, w, ...stats(w, C, mu, rf) });
    }
    return out;
  }
  function bestRet(mu, cap) {   // maximum of mu'w over the capped simplex: fill the best names to the cap
    const idx = mu.map((v, i) => i).sort((a, b) => mu[b] - mu[a]); let left = 1, r = 0;
    for (const i of idx) { const x = Math.min(cap, left); r += x * mu[i]; left -= x; if (left <= 1e-12) break; }
    return r;
  }
  // maximum Sharpe: Sharpe is quasi-concave along the frontier; coarse sweep then golden-section on lam
  function maxSharpe(C, mu, cap = 1, rf = 0) {
    const F = frontier(C, mu, cap, rf, 30);
    let bi = 0; for (let i = 1; i < F.length; i++) if (F[i].sharpe > F[bi].sharpe) bi = i;
    const a = F[Math.max(0, bi - 1)].lam, b = F[Math.min(F.length - 1, bi + 1)].lam;
    let lo = a, hi = b, w0 = F[bi].w;
    const f = lam => { const w = qp(C, mu, lam, cap, w0); return { w, s: stats(w, C, mu, rf).sharpe }; };
    const gr = (Math.sqrt(5) - 1) / 2; let x1 = hi - gr * (hi - lo), x2 = lo + gr * (hi - lo), f1 = f(x1), f2 = f(x2);
    for (let k = 0; k < 30; k++) {
      if (f1.s < f2.s) { lo = x1; x1 = x2; f1 = f2; x2 = lo + gr * (hi - lo); f2 = f(x2); }
      else { hi = x2; x2 = x1; f2 = f1; x1 = hi - gr * (hi - lo); f1 = f(x1); }
    }
    const best = f1.s > f2.s ? f1 : f2;
    return best.s >= F[bi].sharpe ? best.w : F[bi].w;
  }

  // ---- equal risk contribution (Spinu 2013 / Griveau-Billion et al.): minimise 0.5 w'Cw - sum b_i ln w_i ----
  function riskParity(C, budget) {
    const n = C.length, b = budget || new Array(n).fill(1 / n);
    let w = C.map((r, i) => 1 / Math.sqrt(r[i])); const s0 = sum(w); w = w.map(x => x / s0);
    for (let it = 0; it < 2000; it++) {
      let d = 0;
      for (let i = 0; i < n; i++) {
        let c = 0; for (let j = 0; j < n; j++) if (j !== i) c += C[i][j] * w[j];
        const wi = (-c + Math.sqrt(c * c + 4 * C[i][i] * b[i])) / (2 * C[i][i]);
        d = Math.max(d, Math.abs(wi - w[i])); w[i] = wi;
      }
      if (d < 1e-13) break;
    }
    const s = sum(w); return w.map(x => x / s);
  }
  function riskContrib(w, C) { const m = matVec(C, w), v = dot(w, m); return w.map((x, i) => v > 0 ? x * m[i] / v : 0); }

  // ---- hierarchical risk parity (Lopez de Prado 2016) ----
  function corrFromCov(C) { const n = C.length, s = C.map((r, i) => Math.sqrt(r[i])); return C.map((r, i) => r.map((v, j) => v / (s[i] * s[j]))); }
  function singleLinkage(D) {   // returns scipy-style merges [a, b] with a < b; new cluster ids are n, n+1, ...
    const n = D.length; let ids = [...Array(n).keys()], dist = D.map(r => r.slice()), next = n; const Z = [];
    let active = [...Array(n).keys()];
    while (active.length > 1) {
      let bi = -1, bj = -1, bd = Infinity;
      for (let x = 0; x < active.length; x++) for (let y = x + 1; y < active.length; y++) { const d = dist[active[x]][active[y]]; if (d < bd) { bd = d; bi = x; bj = y; } }
      const A = active[bi], B = active[bj];
      Z.push([Math.min(ids[A], ids[B]), Math.max(ids[A], ids[B]), bd]);
      // merge B into A (single linkage = min)
      for (const k of active) if (k !== A && k !== B) { const d = Math.min(dist[A][k], dist[B][k]); dist[A][k] = d; dist[k][A] = d; }
      ids[A] = next++; active = active.filter(k => k !== B);
    }
    return Z;
  }
  function leafOrder(Z, n) {
    const kids = {}; Z.forEach((z, i) => { kids[n + i] = [z[0], z[1]]; });
    const out = [], st = [n + Z.length - 1];
    while (st.length) { const x = st.pop(); if (x < n) out.push(x); else { const k = kids[x]; st.push(k[1], k[0]); } }
    return out;
  }
  function clusterVar(C, idx) {
    const iv = idx.map(i => 1 / C[i][i]), s = sum(iv), w = iv.map(x => x / s);
    let v = 0; for (let a = 0; a < idx.length; a++) for (let b = 0; b < idx.length; b++) v += w[a] * w[b] * C[idx[a]][idx[b]];
    return v;
  }
  function hrp(C) {
    const n = C.length; if (n === 1) return [1];
    const R = corrFromCov(C), D = R.map(r => r.map(v => Math.sqrt(Math.max(0, (1 - v) / 2))));
    const Z = singleLinkage(D), order = leafOrder(Z, n), w = zeros(n);
    let items = [order]; order.forEach(i => { w[i] = 1; });
    while (items.length) {
      const nxt = [];
      for (const it of items) {
        if (it.length < 2) continue;
        const h = Math.floor(it.length / 2), a = it.slice(0, h), b = it.slice(h);
        const va = clusterVar(C, a), vb = clusterVar(C, b), alpha = 1 - va / (va + vb);
        a.forEach(i => { w[i] *= alpha; }); b.forEach(i => { w[i] *= 1 - alpha; });
        nxt.push(a, b);
      }
      items = nxt;
    }
    return w;
  }

  // ---- strategies and walk-forward test ----
  function weights(method, R, opt) {
    opt = opt || {}; const cap = opt.cap || 1;
    const N = R[0].length;
    if (method === 'equal') return new Array(N).fill(1 / N);
    const C = annualise(ledoitWolf(R).cov);
    if (method === 'minvar') return minVariance(C, cap);
    if (method === 'hrp') return hrp(C);
    if (method === 'rp') return riskParity(C);
    if (method === 'maxsharpe') {
      // expected returns: shrunk historical mean (50% toward the cross-sectional mean), annualised
      const m = mean(R).map(x => x * TD), g = sum(m) / N, mu = m.map(x => 0.5 * x + 0.5 * g);
      return maxSharpe(C, mu, cap, opt.rf || 0);
    }
    throw new Error('unknown method ' + method);
  }
  // R: T x N daily simple returns. Re-estimate every `hold` days on the trailing `look` days, hold, charge costs.
  function* wfGen(R, methods, o) {
    o = Object.assign({ look: 252, hold: 21, cap: 1, costBps: 10, rf: 0.065 }, o || {});
    const T = R.length, N = R[0].length, res = {};
    methods.forEach(m => { res[m] = { w: new Array(N).fill(1 / N), r: [], turn: [], dates: [] }; });
    for (let t = o.look; t + 1 <= T; t += o.hold) {
      const train = R.slice(t - o.look, t), end = Math.min(T, t + o.hold);
      yield (t - o.look) / Math.max(1, T - o.look);
      for (const m of methods) {
        const S = res[m]; let w;
        try { w = weights(m, train, o); } catch (e) { w = S.w; }
        let turn = 0; for (let i = 0; i < N; i++) turn += Math.abs(w[i] - S.w[i]);
        const first = S.r.length === 0; if (first) turn = 1;
        S.turn.push(turn);
        let cur = w.slice();
        for (let d = t; d < end; d++) {
          let g = 0; for (let i = 0; i < N; i++) g += cur[i] * R[d][i];
          if (d === t) g -= turn * o.costBps / 1e4;
          S.r.push(g); S.dates.push(d);
          const gross = 1 + g; for (let i = 0; i < N; i++) cur[i] = cur[i] * (1 + R[d][i]) / gross;   // drift
        }
        S.w = cur;
      }
    }
    const out = {};
    for (const m of methods) {
      const r = res[m].r, n = r.length; if (n < 2) { out[m] = null; continue; }
      let eq = 1, peak = 1, dd = 0; for (const x of r) { eq *= 1 + x; peak = Math.max(peak, eq); dd = Math.min(dd, eq / peak - 1); }
      const mu = sum(r) / n, sd = Math.sqrt(r.reduce((a, x) => a + (x - mu) ** 2, 0) / (n - 1));
      const ann = Math.pow(eq, TD / n) - 1;
      out[m] = { ann, vol: sd * Math.sqrt(TD), sharpe: sd > 0 ? (mu * TD - o.rf) / (sd * Math.sqrt(TD)) : 0, maxdd: dd,
        turnover: sum(res[m].turn) / res[m].turn.length, n, curve: (() => { let e = 1; return r.map(x => (e *= 1 + x)); })() };
    }
    return out;
  }
  function walkForward(R, methods, o) { const g = wfGen(R, methods, o); let x; do { x = g.next(); } while (!x.done); return x.value; }
  async function walkForwardAsync(R, methods, o, onProgress) {
    const g = wfGen(R, methods, o); let x;
    for (;;) { x = g.next(); if (x.done) return x.value; if (onProgress) onProgress(x.value); await new Promise(r => setTimeout(r, 0)); }
  }
  root.PF = { sampleCov, ledoitWolf, annualise, projectCapped, qp, minVariance, frontier, maxSharpe, riskParity, riskContrib,
    hrp, singleLinkage, leafOrder, weights, walkForward, walkForwardAsync, stats, mean, TD };
  if (typeof module !== 'undefined') module.exports = root.PF;
})(typeof window !== 'undefined' ? window : globalThis);

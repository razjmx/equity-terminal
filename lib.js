// lib.js - helpers + browser-side DCF (rebuilt from saved model inputs in data/dcf/SYM.json)
(function (root) {
  function parseCSV(text) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (c !== '\r') f += c;
    }
    if (f.length || row.length) { row.push(f); rows.push(row); }
    if (!rows.length) return [];
    const h = rows[0];
    return rows.slice(1).filter(r => r.length > 1 || r[0] !== '').map(r => {
      const o = {}; h.forEach((k, i) => { const v = r[i]; o[k] = v === undefined ? '' : v; }); return o;
    });
  }
  const num = v => { if (v === '' || v == null) return null; const n = Number(v); return isFinite(n) ? n : null; };
  const fmt = (v, d = 1) => v == null || !isFinite(v) ? '–' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (v, d = 1) => v == null || !isFinite(v) ? '–' : fmt(v, d) + '%';

  // ---- DCF ----
  function growthPath(g1, gT, n, hold) {
    const g = [];
    for (let t = 1; t <= n; t++) {
      if (t <= hold) g.push(g1);
      else g.push(g1 + (gT - g1) * (t - hold) / (n - hold));
    }
    return g;
  }
  function value(m, wacc, gT, g1) {
    // m: model block from saved JSON. rates are decimals.
    const g = growthPath(g1, gT, m.n, m.hold_years);
    let rev = m.rev, pv = 0, lastNopat = 0;
    for (let t = 1; t <= m.n; t++) {
      const prev = rev; rev = prev * (1 + g[t - 1]);
      const nopat = rev * m.margin * (1 - m.tax);
      const reinv = (rev - prev) / m.s2c;
      const fcff = nopat - reinv;
      pv += fcff / Math.pow(1 + wacc, t - (m.mid_year ? 0.5 : 0));
      lastNopat = nopat;
    }
    const revT = rev * (1 + gT);
    const nopatT = revT * m.margin * (1 - m.tax);
    let roic = m.roic_cap;
    if (m.roic_now != null) roic = Math.min(m.roic_cap, Math.max(m.roic_now, wacc));
    if (wacc <= gT + 0.001) return null;
    const reinvRate = Math.min(0.95, Math.max(0, gT / roic));
    const fcffT = nopatT * (1 - reinvRate);
    const tv = fcffT / (wacc - gT);
    const pvTv = tv / Math.pow(1 + wacc, m.n - (m.mid_year ? 0.5 : 0) ) ;
    const ev = pv + pvTv;
    const eq = ev - m.debt + m.cash + m.invest - m.minority;
    return { ev, eq, perShare: eq / m.shares_cr * (m.roll || 1), tvShare: pvTv / ev };
  }
  function waccFrom(a, rf, erp, bridge) {
    // a: assumptions block (pct numbers), bridge: bridge_cr
    const ke = rf + a.beta_used * erp;
    const E = bridge.market_cap, D = bridge.debt;
    const kd = 0.09, tax = a.tax_pct / 100;
    let w = (E + D) > 0 ? (E / (E + D)) * ke + (D / (E + D)) * kd * (1 - tax) : ke;
    return { ke, wacc: Math.min(0.18, Math.max(0.09, w)) };
  }
  function recompute(d, inp) {
    // d: saved dcf json; inp: {rf, erp, gT, g1?, waccOverride?} decimals
    const a = d.assumptions, m = Object.assign({}, d.model);
    const w = inp.waccOverride != null ? { wacc: inp.waccOverride, ke: null } : waccFrom(a, inp.rf, inp.erp, d.bridge_cr);
    m.roic_now = a.roic_now_pct != null ? a.roic_now_pct / 100 : null;
    const g1 = inp.g1 != null ? inp.g1 : m.g1;
    const r = value(m, w.wacc, inp.gT, g1);
    return r && Object.assign(r, { wacc: w.wacc, ke: w.ke, g1, gT: inp.gT });
  }
  function sensitivity(d, inp) {
    const a = d.assumptions, m = Object.assign({}, d.model); m.roic_now = a.roic_now_pct != null ? a.roic_now_pct / 100 : null;
    const base = recompute(d, inp); if (!base) return null;
    const ws = [-0.02, -0.01, 0, 0.01, 0.02].map(x => base.wacc + x);
    const gs = [-0.01, -0.005, 0, 0.005, 0.01].map(x => inp.gT + x);
    return { ws, gs, grid: ws.map(w => gs.map(g => { const r = value(m, w, g, base.g1); return r ? r.perShare : null; })) };
  }
  root.TL = { parseCSV, num, fmt, pct, value, recompute, sensitivity, waccFrom, growthPath };
  if (typeof module !== 'undefined') module.exports = root.TL;
})(typeof window !== 'undefined' ? window : globalThis);

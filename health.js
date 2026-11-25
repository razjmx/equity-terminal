// health.js - Data health page: are the data files fresh, did the automatic jobs run, do the models pass their own checks.
// Files are judged by the date stored inside them. Jobs come live from the GitHub API (public repo, no key, 60 calls an hour).
(function () {
  const REPO = 'razjmx/equity-terminal';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const IST = { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' };
  // path, label, max age in days before amber (red at twice that), what the date means
  const FILES = [
    ['data/last_updated.json', 'Daily refresh stamp', 4],
    ['data/market.json', 'Market overview', 4],
    ['data/market_health.json', 'Market health (breadth, groups)', 4],
    ['data/orderflow.json', 'Order flow (daily)', 4],
    ['data/orderflow_tf.json', 'Order flow (longer windows)', 4],
    ['data/index_heat.json', 'Index heatmap (NSE index levels)', 4],
    ['data/orderflow_backtest.json', 'Order flow back-test', 40],
    ['data/fii_flow.json', 'FII / FPI flow', 7],
    ['data/quant/factors.json', 'Quant: factors and rankings', 5],
    ['data/quant/pca.json', 'Quant: market structure', 8],
    ['data/quant/barra.json', 'Quant: factor risk model', 8],
    ['data/quant/statarb.json', 'Quant: pairs scan', 8],
    ['data/index_members.json', 'Index constituents', 45],
    ['data/peers.json', 'Peer groups', 45]
  ];
  const CSVS = [['data/prices/NIFTY500.csv', 'Index prices (Nifty 500)', 4], ['data/prices/RELIANCE.csv', 'Stock prices (sample: RELIANCE)', 4], ['data/prices/HDFCBANK.csv', 'Stock prices (sample: HDFCBANK)', 4]];
  const DKEYS = ['asof', 'as_of', 'as_of_date', 'price_date', 'data_date', 'updated_at', 'updated', 'generated', 'last_date', 'date', 'run'];

  const bust = () => '?v=' + Math.floor(Date.now() / 600000);
  async function getJson(p) { try { const r = await fetch(p + bust()); if (!r.ok) return { miss: true }; const t = await r.text(); return { size: t.length, o: JSON.parse(t) }; } catch (e) { return { miss: true }; } }
  async function getText(p) { try { const r = await fetch(p + bust()); if (!r.ok) return null; return await r.text(); } catch (e) { return null; } }
  function parseDate(v) {
    if (typeof v !== 'string' || v.length < 8) return null;
    let s = v.trim().replace(' UTC', 'Z').replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2');
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
    const d = new Date(dateOnly ? s + 'T00:00:00+05:30' : s);
    return isNaN(d) ? null : { d, dateOnly };
  }
  function findDate(o) {
    if (!o || typeof o !== 'object') return null;
    const scan = obj => {
      for (const k of DKEYS) {
        for (const key of Object.keys(obj)) {
          if (key.toLowerCase() === k) { const r = parseDate(obj[key]); if (r) return { ...r, key }; }
        }
      }
      return null;
    };
    let r = scan(Array.isArray(o) ? {} : o);
    if (r) return r;
    if (!Array.isArray(o)) for (const key of Object.keys(o)) { const v = o[key]; if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length < 60) { r = scan(v); if (r) return { ...r, key: key + '.' + r.key }; } }
    return null;
  }
  function coverage(o) {
    if (!o || typeof o !== 'object') return null;
    if (o.stocks && typeof o.stocks === 'object') return Object.keys(o.stocks).length;
    for (const k of ['n_stocks', 'n', 'count']) if (typeof o[k] === 'number') return o[k];
    return null;
  }
  const dayStart = d => { const x = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })); x.setHours(0, 0, 0, 0); return x; };
  function age(dt) {   // age in days (calendar days for date-only values) and a label
    const now = new Date();
    if (dt.dateOnly) {
      const n = Math.round((dayStart(now) - dayStart(dt.d)) / 864e5);
      return { days: n, label: n <= 0 ? 'today' : n === 1 ? '1 day ago' : n + ' days ago' };
    }
    const h = (now - dt.d) / 36e5;
    if (h < 1) return { days: h / 24, label: 'under 1 hour ago' };
    if (h < 48) return { days: h / 24, label: Math.round(h) + ' h ago' };
    return { days: h / 24, label: Math.round(h / 24) + ' days ago' };
  }
  const grade = (days, max) => days <= max ? 'ok' : days <= 2 * max ? 'warn' : 'bad';
  const dot = g => `<span class="hdot ${g}" title="${g === 'ok' ? 'On time' : g === 'warn' ? 'Late' : g === 'bad' ? 'Overdue, failed or missing' : 'Not judged'}"></span>`;
  const fmtN = n => n == null ? '–' : Number(n).toLocaleString('en-IN');

  async function fileRows() {
    const out = [];
    const js = await Promise.all(FILES.map(f => getJson(f[0])));
    FILES.forEach((f, i) => {
      const r = js[i];
      if (r.miss) { out.push({ label: f[1], path: f[0], g: 'bad', when: 'file not found', date: '', key: '', cov: null, max: f[2] }); return; }
      const dt = findDate(r.o);
      if (!dt) { out.push({ label: f[1], path: f[0], g: 'na', when: 'no date inside', date: '', key: '', cov: coverage(r.o), max: f[2] }); return; }
      const a = age(dt);
      out.push({ label: f[1], path: f[0], g: grade(a.days, f[2]), when: a.label, date: dt.dateOnly ? dt.d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' }) : dt.d.toLocaleString('en-IN', IST), key: dt.key, cov: coverage(r.o), max: f[2] });
    });
    const cs = await Promise.all(CSVS.map(c => getText(c[0])));
    CSVS.forEach((c, i) => {
      const t = cs[i];
      if (!t) { out.push({ label: c[1], path: c[0], g: 'bad', when: 'file not found', date: '', key: '', cov: null, max: c[2] }); return; }
      const lines = t.trim().split(/\r?\n/), hd = lines[0].split(',').map(x => x.trim().toLowerCase()), di = hd.indexOf('date');
      const last = lines[lines.length - 1].split(',')[di >= 0 ? di : 0];
      const dt = parseDate((last || '').trim().slice(0, 10));
      if (!dt) { out.push({ label: c[1], path: c[0], g: 'na', when: 'no date found', date: '', key: '', cov: null, max: c[2] }); return; }
      const a = age(dt);
      out.push({ label: c[1], path: c[0], g: grade(a.days, c[2]), when: a.label, date: dt.d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' }), key: 'last row', cov: null, max: c[2] });
    });
    return out;
  }

  async function runs() {
    try {
      const ck = sessionStorage.getItem('hl_runs');
      if (ck) { const o = JSON.parse(ck); if (Date.now() - o.t < 600000) return o.v; }
    } catch (e) { }
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?per_page=100`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(r.status === 403 ? 'limit' : 'http ' + r.status);
    const j = await r.json(), by = {};
    (j.workflow_runs || []).forEach(x => {
      const k = x.name || x.path;
      if (!by[k]) by[k] = { name: k, last: x, ok: null };
      if (!by[k].ok && x.status === 'completed' && x.conclusion === 'success') by[k].ok = x;
    });
    const v = Object.values(by);
    try { sessionStorage.setItem('hl_runs', JSON.stringify({ t: Date.now(), v })); } catch (e) { }
    return v;
  }

  function modelChecks(J) {
    const rows = [];
    const B = J.barra && J.barra.o, S = J.statarb && J.statarb.o;
    if (B && B.diag) {
      const d = B.diag, ok = d.ratio_mean >= 0.85 && d.ratio_mean <= 1.15;
      rows.push(['Factor risk model: realised ÷ predicted risk', d.ratio_mean == null ? '–' : d.ratio_mean.toFixed(2), 'Healthy range 0.85 to 1.15', d.ratio_mean == null ? 'na' : ok ? 'ok' : 'warn']);
      rows.push(['Factor risk model: predicted vs realised correlation', d.corr == null ? '–' : d.corr.toFixed(2), 'Above 0.6 is good at ranking portfolios by risk', d.corr == null ? 'na' : d.corr >= 0.6 ? 'ok' : 'warn']);
      if (d.ratio_lowbeta != null) rows.push(['Factor risk model: low-beta baskets', d.ratio_lowbeta.toFixed(2), 'Near 1.0; above 1.15 means defensive baskets are under-predicted', d.ratio_lowbeta >= 0.85 && d.ratio_lowbeta <= 1.15 ? 'ok' : 'warn']);
      if (d.ratio_highbeta != null) rows.push(['Factor risk model: high-beta baskets', d.ratio_highbeta.toFixed(2), 'Near 1.0', d.ratio_highbeta >= 0.85 && d.ratio_highbeta <= 1.15 ? 'ok' : 'warn']);
    }
    if (S && S.holdout) {
      const a = S.holdout.selected, b = S.holdout.random;
      if (a && b && a.mean_bps != null && b.mean_bps != null) {
        const gap = a.mean_bps - b.mean_bps;
        rows.push(['Pairs scan: chosen pairs minus random pairs, per trade', (gap > 0 ? '+' : '') + gap.toFixed(0) + ' bps', 'Needs to be clearly positive (15 bps or more) with t of 2 or more for the selection to add value', gap >= 15 && a.t >= 2 ? 'ok' : 'warn']);
      }
    }
    return rows;
  }

  async function page(view) {
    view.innerHTML = `<h2 style="margin:4px 0 2px">Data health</h2><p class="mut" style="margin:0 0 14px">Is the data fresh, did the automatic updates run, and do the models pass their own checks. Checked live when you open this page.</p><div id="hl-sum"></div><div class="skel" style="height:300px"></div>`;
    const [rows, jb, js, rn] = await Promise.all([fileRows(), getJson('data/quant/barra.json'), getJson('data/quant/statarb.json'), runs().then(v => ({ v }), e => ({ e }))]);
    const checks = modelChecks({ barra: jb, statarb: js });
    const cnt = g => rows.filter(r => r.g === g).length;
    let wf = '', wfBad = 0, wfN = 0;
    if (rn.e) {
      wf = `<p class="mut">${rn.e.message === 'limit' ? 'GitHub allows only 60 live checks per hour from one network and that limit is used up. Try again in a while.' : 'Could not reach GitHub just now (' + esc(rn.e.message) + ').'} You can always look at the <a href="https://github.com/${REPO}/actions" target="_blank" rel="noopener">Actions page</a>.</p>`;
    } else {
      const v = rn.v.slice().sort((a, b) => new Date(b.last.updated_at) - new Date(a.last.updated_at));
      wfN = v.length;
      wf = `<div class="scroll"><table class="stmt"><tr><th class="l">Workflow</th><th class="l">Latest run</th><th>When (IST)</th><th>Age</th><th class="l">Last success</th></tr>${v.map(w => {
        const x = w.last, run = x.status === 'completed' ? x.conclusion : x.status, good = run === 'success', going = x.status !== 'completed';
        const g = going ? 'warn' : good ? 'ok' : (run === 'cancelled' || run === 'skipped') ? 'warn' : 'bad';
        if (g === 'bad') wfBad++;
        const a = age({ d: new Date(x.updated_at), dateOnly: false });
        const last = good ? 'this run' : w.ok ? `${age({ d: new Date(w.ok.updated_at), dateOnly: false }).label}` : 'none in the last 100 runs';
        return `<tr>${'<td class="l">' + dot(g) + ' <b>' + esc(w.name) + '</b></td>'}<td class="l"><a href="${esc(x.html_url)}" target="_blank" rel="noopener">${going ? 'running' : esc(run)}${x.run_number ? ' #' + x.run_number : ''}</a></td><td>${new Date(x.updated_at).toLocaleString('en-IN', IST)}</td><td>${a.label}</td><td class="l ${g === 'bad' ? 'neg' : ''}">${esc(last)}</td></tr>`;
      }).join('')}</table></div><p class="mut" style="font-size:12px;margin:8px 0 0">Covers the last 100 runs. A failed run can often be fixed with Re-run failed jobs on its page. Jobs started by hand, such as Order flow extras, can look old without being broken.</p>`;
    }
    const tile = (k, v, c) => `<div class="stat"><div class="k">${k}</div><div class="sv ${c || ''}">${v}</div></div>`;
    view.innerHTML = `<h2 style="margin:4px 0 2px">Data health</h2><p class="mut" style="margin:0 0 14px">Is the data fresh, did the automatic updates run, and do the models pass their own checks. Checked live when you open this page.</p>
    <div class="card"><div class="stats" style="margin:0">${tile('Files on time', cnt('ok') + ' of ' + rows.length, cnt('ok') === rows.length ? 'pos' : '')}${tile('Files late or missing', cnt('warn') + cnt('bad'), cnt('bad') ? 'neg' : cnt('warn') ? 'warnc' : 'pos')}${rn.e ? tile('Workflows', 'not checked') : tile('Workflows failing', wfBad + ' of ' + wfN, wfBad ? 'neg' : 'pos')}${tile('Checked', new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) + ' IST')}</div><p style="margin:12px 0 0"><button id="hl-re" class="btn">Check again</button></p></div>
    <div class="card"><h3>Workflows</h3>${wf}</div>
    <div class="card scroll"><h3>Data files</h3><table class="stmt"><tr><th class="l">File</th><th>Date inside</th><th>Age</th><th>Expected within</th><th>Stocks</th></tr>${rows.map(r => `<tr><td class="l">${dot(r.g)} <b>${esc(r.label)}</b><div class="mut" style="font-size:11px">${esc(r.path)}${r.key ? ' · ' + esc(r.key) : ''}</div></td><td>${esc(r.date) || '–'}</td><td class="${r.g === 'bad' ? 'neg' : r.g === 'warn' ? 'warnc' : ''}">${esc(r.when)}</td><td>${r.max} days</td><td>${fmtN(r.cov)}</td></tr>`).join('')}</table></div>
    <div class="card"><h3>Model checks</h3>${checks.length ? `<table class="stmt"><tr><th class="l">Check</th><th>Value</th><th class="l">Healthy range</th></tr>${checks.map(c => `<tr><td class="l">${dot(c[3])} ${esc(c[0])}</td><td><b>${esc(c[1])}</b></td><td class="l mut">${esc(c[2])}</td></tr>`).join('')}</table>` : '<p class="mut">No model results found yet.</p>'}</div>`;
    const b = document.getElementById('hl-re');
    if (b) b.onclick = () => { try { sessionStorage.removeItem('hl_runs'); } catch (e) { } page(view); };
    if (window.INFO) window.INFO.decorate();
  }
  window.HEALTH = { page };
})();

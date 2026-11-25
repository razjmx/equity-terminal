// account.js - personal login and settings sync using Supabase's REST API (plain fetch, no libraries, no CDN).
// Your saved settings (DCF assumptions, quant weights, screener filters, theme, last tabs) are stored per user and follow you across devices.
// Needs: a Supabase project with the table and policy in SETUP-LOGIN.md, public sign-ups switched off, and one user you created.
(function () {
  const C = window.ACCOUNT_CFG || {};
  const btn = document.getElementById('acct');
  if (!C.url || !C.key) { window.TL_AUTH = { gate: false, in: () => true }; if (btn) btn.style.display = 'none'; return; }
  // gate: while signed out, the quant / order-flow / valuation pages are locked (app.js reads this)
  window.TL_AUTH = { gate: true, in: () => !!sess };
  const URL_ = C.url.replace(/\/+$/, ''), SK = 'tl_session', MK = 'tl_sync_meta';
  const skip = k => !k || k.indexOf('tl_') !== 0 || k === SK || k === MK;
  const ls = { get: k => { try { return localStorage.getItem(k) } catch (e) { return null } }, set: (k, v) => { try { Storage.prototype._set.call(localStorage, k, v) } catch (e) { } }, del: k => { try { localStorage.removeItem(k) } catch (e) { } } };
  const J = s => { try { return JSON.parse(s) } catch (e) { return null } };
  let sess = J(ls.get(SK)), meta = J(ls.get(MK)) || {}, timer = null, busy = false, note = '';
  // stamp every settings write with a time so the newer side wins on sync
  if (!Storage.prototype._set) {
    Storage.prototype._set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      Storage.prototype._set.call(this, k, v);
      if (this === window.localStorage && !skip(k)) { meta[k] = Date.now(); Storage.prototype._set.call(localStorage, MK, JSON.stringify(meta)); schedule(); }
    };
  }
  const hdr = tok => {
    const h = { apikey: C.key, 'Content-Type': 'application/json' };
    // sb_publishable_ keys are not JWTs: send them only as apikey, never as a Bearer token
    if (tok) h.Authorization = 'Bearer ' + tok;
    else if (/^eyJ/.test(C.key)) h.Authorization = 'Bearer ' + C.key;
    return h;
  };
  async function auth(path, body) {
    const r = await fetch(URL_ + '/auth/v1/' + path, { method: 'POST', headers: hdr(), body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.msg || j.message || 'Sign-in failed (' + r.status + ')');
    return j;
  }
  function keep(j) {
    sess = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 - 60000, user: { id: j.user.id, email: j.user.email } };
    ls.set(SK, JSON.stringify(sess));
  }
  async function token() {
    if (!sess) return null;
    if (Date.now() < sess.expires_at) return sess.access_token;
    try { keep(await auth('token?grant_type=refresh_token', { refresh_token: sess.refresh_token })); return sess.access_token; }
    catch (e) { sess = null; ls.del(SK); paint(); return null; }
  }
  const mine = () => { const o = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!skip(k)) o[k] = { v: localStorage.getItem(k), t: meta[k] || 0 }; } } catch (e) { } return o; };
  async function sync(first) {
    if (busy || !sess) return false; busy = true; let reload = false;
    try {
      const tk = await token(); if (!tk) return false;
      const g = await fetch(URL_ + '/rest/v1/user_data?select=data&user_id=eq.' + sess.user.id, { headers: hdr(tk) });
      if (!g.ok) throw new Error('Could not read your data (' + g.status + '). Check the database setup.');
      const rows = await g.json(), remote = (rows[0] && rows[0].data) || {}, local = mine(), merged = {};
      for (const k of new Set([...Object.keys(remote), ...Object.keys(local)])) {
        const a = local[k], b = remote[k];
        if (b && (!a || b.t > a.t)) { merged[k] = b; if (!a || a.v !== b.v) { ls.set(k, b.v); meta[k] = b.t; reload = true; } }
        else merged[k] = a;
      }
      ls.set(MK, JSON.stringify(meta));
      const p = await fetch(URL_ + '/rest/v1/user_data?on_conflict=user_id', { method: 'POST', headers: { ...hdr(tk), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ user_id: sess.user.id, data: merged, updated_at: new Date().toISOString() }) });
      if (!p.ok) throw new Error('Could not save your data (' + p.status + ').');
      note = 'Synced ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) { note = e.message; }
    finally { busy = false; paint(); }
    if (reload && first) { location.reload(); }
    return true;
  }
  function schedule() { if (!sess) return; clearTimeout(timer); timer = setTimeout(() => sync(false), 2500); }
  // ---- UI ----
  let box = null;
  let wasIn = null;
  function paint() {
    const nowIn = !!sess;
    document.body.classList.toggle('tl-out', !nowIn);
    if (wasIn !== null && wasIn !== nowIn) { try { window.dispatchEvent(new Event('tl-auth')); } catch (e) { } }
    wasIn = nowIn;
    if (btn) { btn.classList.toggle('on', !!sess); btn.title = sess ? 'Signed in as ' + sess.user.email : 'Sign in'; }
    if (!box) return;
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    box.querySelector('.acbody').innerHTML = sess
      ? `<p class="acm">Signed in as</p><p class="acem">${esc(sess.user.email)}</p><p class="acm">${esc(note || 'Your settings sync automatically.')}</p><div class="acrow"><button id="acsync">Sync now</button><button id="acout">Sign out</button></div><p class="acm" style="margin-top:12px">Synced: DCF assumptions, quant weights, screener filters, theme and last-used tabs.</p>`
      : `<form id="acform"><label>Email<input id="acem" type="email" autocomplete="username" required></label><label>Password<input id="acpw" type="password" autocomplete="current-password" required></label><p class="acerr" id="acerr">${esc(note)}</p><button class="primary" type="submit">Sign in</button></form><p class="acm">Personal login: your settings are saved to your account and follow you between devices. Accounts are created by the site owner only.</p>`;
    const f = box.querySelector('#acform');
    if (f) f.onsubmit = async e => { e.preventDefault(); note = ''; const er = box.querySelector('#acerr'); er.textContent = 'Signing in…';
      try { keep(await auth('token?grant_type=password', { email: box.querySelector('#acem').value.trim(), password: box.querySelector('#acpw').value })); note = ''; await sync(true); paint(); box.hidden = true; }
      catch (x) { er.textContent = x.message; } };
    const s = box.querySelector('#acsync'); if (s) s.onclick = () => { note = 'Syncing…'; paint(); sync(true); };
    const o = box.querySelector('#acout'); if (o) o.onclick = () => { sess = null; ls.del(SK); note = ''; paint(); };
  }
  function open() {
    if (!box) { box = document.createElement('div'); box.id = 'acpanel'; box.innerHTML = '<div class="achead"><b>Account</b><button class="acx" aria-label="Close">×</button></div><div class="acbody"></div>'; document.body.appendChild(box); box.querySelector('.acx').onclick = () => { box.hidden = true; }; document.addEventListener('keydown', e => { if (e.key === 'Escape') box.hidden = true; }); }
    box.hidden = false; paint();
  }
  if (btn) btn.onclick = () => { if (box && !box.hidden) box.hidden = true; else open(); };
  paint();
  if (sess) sync(true);
})();

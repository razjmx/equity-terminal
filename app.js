(function(){
const T=window.TL,$=s=>document.querySelector(s),view=$('#view');
const D={};            // loaded tables
const cache={};
const DEF={rf:7.2,erp:6,g:6.5};
let A=Object.assign({},DEF);
try{const s=JSON.parse(localStorage.getItem('tl_assump')||'null');if(s&&s.rf!=null)A=s}catch(e){}
function saveA(){try{localStorage.setItem('tl_assump',JSON.stringify(A))}catch(e){}}
async function get(path,type){
  if(cache[path]!==undefined)return cache[path];
  try{const r=await fetch(path,{cache:'no-cache'});if(!r.ok)throw 0;
    cache[path]=type==='json'?await r.json():await r.text()}catch(e){cache[path]=null}
  return cache[path];
}
async function table(p){const t=await get(p);return t?T.parseCSV(t):[]}
const cls=v=>v==null?'':v>0?'pos':v<0?'neg':'';
const esc=s=>String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

// ---------- charts ----------
function lineChart(cv,series,opt={}){
  const dpr=window.devicePixelRatio||1,w=cv.clientWidth,h=cv.clientHeight;cv.width=w*dpr;cv.height=h*dpr;
  const ctx=cv.getContext('2d');ctx.scale(dpr,dpr);
  const css=getComputedStyle(document.documentElement);
  const col=['#f5a524','#4aa3ff','#2ecc71','#c78bff'];
  const L=48,R=8,Tp=8,B=20;
  const n=Math.max(...series.map(s=>s.y.length));
  let all=[].concat(...series.map(s=>s.y.filter(v=>v!=null)));
  let lo=Math.min(...all),hi=Math.max(...all);if(opt.zero){lo=Math.min(lo,0)}if(lo===hi){lo-=1;hi+=1}
  const pad=(hi-lo)*0.05;lo-=pad;hi+=pad;
  const X=i=>L+(w-L-R)*i/Math.max(1,n-1),Y=v=>Tp+(h-Tp-B)*(1-(v-lo)/(hi-lo));
  function draw(hov){
    ctx.clearRect(0,0,w,h);ctx.font='11px system-ui';ctx.fillStyle='#8b94a3';ctx.strokeStyle='rgba(139,148,163,.25)';
    for(let k=0;k<=4;k++){const v=lo+(hi-lo)*k/4,y=Y(v);ctx.beginPath();ctx.moveTo(L,y);ctx.lineTo(w-R,y);ctx.stroke();ctx.fillText(T.fmt(v,opt.dec??0),2,y+4)}
    const xs=series[0].x||[];[0,.5,1].forEach(f=>{const i=Math.round((n-1)*f);if(xs[i])ctx.fillText(xs[i],Math.min(X(i),w-66),h-5)});
    series.forEach((s,si)=>{ctx.strokeStyle=s.color||col[si%4];ctx.lineWidth=1.5;ctx.beginPath();let st=false;
      s.y.forEach((v,i)=>{if(v==null)return;const x=X(i),y=Y(v);st?ctx.lineTo(x,y):ctx.moveTo(x,y);st=true});ctx.stroke()});
    if(hov!=null){ctx.strokeStyle='#8b94a3';ctx.beginPath();ctx.moveTo(X(hov),Tp);ctx.lineTo(X(hov),h-B);ctx.stroke();
      let txt=(xs[hov]||'')+'  '+series.map(s=>(series.length>1?s.name+' ':'')+T.fmt(s.y[hov],opt.dec??0)).join('  ');
      ctx.fillStyle='#f5a524';ctx.fillText(txt,L+4,Tp+10)}
  }
  draw();
  cv.onmousemove=e=>{const r=cv.getBoundingClientRect();const i=Math.round((e.clientX-r.left-L)/(w-L-R)*(n-1));draw(Math.min(n-1,Math.max(0,i)))};
  cv.onmouseleave=()=>draw();
}

// ---------- boot ----------
async function boot(){
  const [uni,met,dcf,rsk,mkt]=await Promise.all([table('data/universe.csv'),table('data/metrics_summary.csv'),table('data/dcf_summary.csv'),table('data/risk_summary.csv'),get('data/market.json','json')]);
  D.uni=uni;D.mkt=mkt;
  try{const st=await get('data/last_updated.json','json');if(st&&st.utc){const d=new Date(st.utc.replace(' ','T')+':00Z');
    document.querySelector('footer').insertAdjacentHTML('afterbegin','Data updated '+d.toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'})+' IST · latest prices as of '+esc(st.price_date||'')+'<br>')}}catch(e){}
  const by=(rows)=>{const o={};rows.forEach(r=>o[r.symbol]=r);return o};
  D.met=by(met);D.dcf=by(dcf);D.rsk=by(rsk);
  D.syms=uni.map(u=>u.symbol);
  $('#symlist').innerHTML=uni.map(u=>`<option value="${esc(u.symbol)}">${esc(u.company)}</option>`).join('');
  $('#search').addEventListener('change',e=>{const v=e.target.value.trim().toUpperCase();
    const m=uni.find(u=>u.symbol===v)||uni.find(u=>u.company.toUpperCase().includes(v));
    if(m){location.hash='#/stock/'+m.symbol;e.target.value=''}});
  const sync=()=>{$('#a-rf').value=A.rf;$('#a-erp').value=A.erp;$('#a-g').value=A.g};sync();
  ['rf','erp','g'].forEach(k=>$('#a-'+k).addEventListener('change',e=>{const v=parseFloat(e.target.value);if(isFinite(v)){A[k]=v;saveA();route()}}));
  $('#a-reset').onclick=()=>{A=Object.assign({},DEF);saveA();sync();route()};
  window.addEventListener('hashchange',route);route();
}

function route(){
  const h=location.hash||'#/market';const p=h.split('/');
  document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('on',a.getAttribute('href')===h||(h.startsWith('#/stock')&&false)));
  if(p[1]==='stock'&&p[2])return stock(decodeURIComponent(p[2]));
  if(p[1]==='screener')return screener();
  if(p[1]==='financials')return financials();
  return market();
}

// ---------- market ----------
async function market(){
  const m=D.mkt,b=await table('data/breadth_history.csv');
  const rows=Object.values(D.rsk);
  const top=(k,asc)=>rows.filter(r=>T.num(r[k])!=null&&(T.num(r.traded_cr)||0)>5).sort((a,c)=>asc?T.num(a[k])-T.num(c[k]):T.num(c[k])-T.num(a[k])).slice(0,10);
  const idx=(n,o)=>o?`<div class="card"><div class="k">${n}</div><div class="v">${T.fmt(o.price??o.close,0)}</div>
     <div class="k">1M <span class="${cls(o.ret_1m??o.returns_pct?.['1m'])}">${T.pct(o.ret_1m??o.returns_pct?.['1m'])}</span> · 1Y <span class="${cls(o.ret_1y??o.returns_pct?.['1y'])}">${T.pct(o.ret_1y??o.returns_pct?.['1y'])}</span></div></div>`:'';
  const bl=m&&m.breadth_latest||{};
  const list=(t,a)=>`<div class="card"><h3>${t}</h3><table>${a.map(r=>`<tr class="row" onclick="location.hash='#/stock/${r.symbol}'"><td>${r.symbol}</td><td>${T.fmt(r.price,1)}</td><td class="${cls(T.num(r.ret_1m))}">${T.pct(T.num(r.ret_1m))}</td><td>RSI ${T.fmt(T.num(r.rsi14),0)}</td></tr>`).join('')}</table></div>`;
  view.innerHTML=`<div class="grid">${idx('Nifty 50',m&&m.nifty50)}${idx('Nifty 500',m&&m.nifty500)}
    <div class="card"><div class="k">Above 200-DMA</div><div class="v">${T.pct(bl.pct_above_200dma,0)}</div></div>
    <div class="card"><div class="k">Above 50-DMA</div><div class="v">${T.pct(bl.pct_above_50dma,0)}</div></div></div>
    <div class="two"><div class="card"><h3>Breadth: % of stocks above 200-DMA</h3><canvas id="c1"></canvas></div>
    <div class="card"><h3>Breadth: % at 52-week high vs low</h3><canvas id="c2"></canvas></div></div>
    <div class="two">${list('Top 1M returns (traded > Rs 5 cr/day)',top('ret_1m'))}${list('Bottom 1M returns',top('ret_1m',true))}${list('Most oversold (RSI)',top('rsi14',true))}${list('Most overbought (RSI)',top('rsi14'))}</div>
    <p class="mut">Click any stock for its full page. ${D.syms.length} stocks in universe.</p>`;
  if(b.length){const x=b.map(r=>r.Date);
    lineChart($('#c1'),[{name:'200d',x,y:b.map(r=>T.num(r.pct_above_200dma))},{name:'50d',x,y:b.map(r=>T.num(r.pct_above_50dma))}],{dec:0});
    lineChart($('#c2'),[{name:'high',x,y:b.map(r=>T.num(r.pct_new_52w_high))},{name:'low',x,y:b.map(r=>T.num(r.pct_new_52w_low))}],{dec:1})}
}

// ---------- screener ----------
const COLS=[['symbol','Symbol','l'],['industry','Industry','l'],['price','Price'],['pe_used','P/E'],['pb','P/B'],['roe_pct','ROE %'],['roce_pct','ROCE %'],['rev_cagr_pct','Rev CAGR %'],['ret_1y','1Y %'],['rsi14','RSI'],['fair','DCF fair'],['upside','Upside %'],['rel','DCF reliability','l']];
let SORT={k:'symbol',d:1},FILT={q:'',rel:'all',ind:'all'};
function rowFor(s){
  const m=D.met[s]||{},d=D.dcf[s]||{},r=D.rsk[s]||{};
  const price=T.num(r.price)??T.num(d.price);
  // shift saved DCF with chosen assumptions only via stock page; screener uses saved model values
  const fair=T.num(d.fair_value);
  return {symbol:s,industry:m.industry||(D.uni.find(u=>u.symbol===s)||{}).industry||'',price,mcap:null,pe_used:T.num(m.pe_used),pb:T.num(m.pb),roe_pct:T.num(m.roe_pct),roce_pct:T.num(m.roce_pct),rev_cagr_pct:T.num(m.rev_cagr_pct),ret_1y:T.num(r.ret_1y),rsi14:T.num(r.rsi14),fair,upside:fair!=null&&price?(fair/price-1)*100:null,rel:d.reliability||'',type:m.type}
}
function screener(){
  const all=D.syms.map(rowFor);
  const inds=[...new Set(all.map(r=>r.industry).filter(Boolean))].sort();
  view.innerHTML=`<div class="bar"><input id="f-q" placeholder="Filter symbol / industry" value="${esc(FILT.q)}">
   <select id="f-rel"><option value="all">All DCF reliability</option>${['usable','indicative','low confidence','not meaningful'].map(x=>`<option ${FILT.rel===x?'selected':''}>${x}</option>`).join('')}</select>
   <select id="f-ind"><option value="all">All industries</option>${inds.map(x=>`<option ${FILT.ind===x?'selected':''}>${esc(x)}</option>`).join('')}</select>
   <span class="mut" id="cnt"></span></div><div class="card scroll"><table id="tb"></table></div>
   <p class="mut">DCF values here are as saved by the nightly run (ERP in compute_dcf.py). Open a stock to recompute with your own assumptions.</p>`;
  const draw=()=>{
    let rows=all.filter(r=>(FILT.rel==='all'||r.rel===FILT.rel)&&(FILT.ind==='all'||r.industry===FILT.ind)&&(!FILT.q||(r.symbol+' '+r.industry).toUpperCase().includes(FILT.q.toUpperCase())));
    rows.sort((a,b)=>{const x=a[SORT.k],y=b[SORT.k];if(x==null&&y==null)return 0;if(x==null)return 1;if(y==null)return -1;return (x>y?1:x<y?-1:0)*SORT.d});
    $('#cnt').textContent=rows.length+' stocks';
    $('#tb').innerHTML='<tr>'+COLS.map(c=>`<th class="${c[2]||''}" data-k="${c[0]}">${c[1]}${SORT.k===c[0]?(SORT.d>0?' ▲':' ▼'):''}</th>`).join('')+'</tr>'+
      rows.slice(0,600).map(r=>`<tr class="row" onclick="location.hash='#/stock/${r.symbol}'"><td>${r.symbol}</td><td class="l mut">${esc(r.industry)}</td><td>${T.fmt(r.price,1)}</td><td>${T.fmt(r.pe_used,1)}</td><td>${T.fmt(r.pb,1)}</td><td>${T.fmt(r.roe_pct,1)}</td><td>${T.fmt(r.roce_pct,1)}</td><td>${T.fmt(r.rev_cagr_pct,1)}</td><td class="${cls(r.ret_1y)}">${T.fmt(r.ret_1y,1)}</td><td>${T.fmt(r.rsi14,0)}</td><td>${T.fmt(r.fair,0)}</td><td class="${cls(r.upside)}">${T.fmt(r.upside,0)}</td><td class="l mut">${esc(r.rel)}</td></tr>`).join('');
    document.querySelectorAll('#tb th').forEach(th=>th.onclick=()=>{const k=th.dataset.k;SORT=SORT.k===k?{k,d:-SORT.d}:{k,d:k==='symbol'||k==='industry'?1:-1};draw()});
  };
  $('#f-q').oninput=e=>{FILT.q=e.target.value;draw()};$('#f-rel').onchange=e=>{FILT.rel=e.target.value;draw()};$('#f-ind').onchange=e=>{FILT.ind=e.target.value;draw()};
  draw();
}

// ---------- stock ----------
async function stock(s){
  view.innerHTML='Loading '+esc(s)+'…';
  const [dcf,met,rsk,pcsv,rat,fin,rl]=await Promise.all([get(`data/dcf/${s}.json`,'json'),get(`data/metrics/${s}.json`,'json'),get(`data/risk/${s}.json`,'json'),get(`data/prices/${s}.csv`),get(`data/ratios/${s}.json`,'json'),get(`data/fin/${s}.json`,'json'),get(`data/realty/${s}.json`,'json')]);
  const u=D.uni.find(x=>x.symbol===s)||{};
  const prices=pcsv?T.parseCSV(pcsv):[];
  const price=rsk?.price??dcf?.price;
  const kv=(k,v,c='')=>`<div><div class="k">${k}</div><div class="v ${c}" style="font-size:16px">${v}</div></div>`;
  let h=`<div class="card"><div style="display:flex;gap:16px;flex-wrap:wrap;align-items:baseline"><span class="v">${esc(s)}</span><span>${esc(u.company||'')}</span><span class="tag">${esc(u.industry||'')}</span>${met?`<span class="tag">${esc(met.type)}</span>`:''}<span class="v" style="margin-left:auto">₹${T.fmt(price,2)}</span></div>
   ${rsk?`<div class="mut">As of ${esc(rsk.as_of)} · 1M <span class="${cls(rsk.returns_pct['1m'])}">${T.pct(rsk.returns_pct['1m'])}</span> · 1Y <span class="${cls(rsk.returns_pct['1y'])}">${T.pct(rsk.returns_pct['1y'])}</span> · 52w ${T.fmt(rsk.range.low_52w,0)}–${T.fmt(rsk.range.high_52w,0)}</div>`:''}</div>`;
  h+=`<div class="card"><h3>Price</h3><div class="bar" id="rng">${['3M','6M','1Y','3Y','All'].map(x=>`<button data-r="${x}">${x}</button>`).join('')}</div><canvas id="pc" style="height:300px"></canvas></div>`;
  if(dcf)h+=`<div id="dcfbox"></div>`;
  else if(fin)h+=`<div id="finbox"></div>`;
  else if(rl)h+=`<div id="rlbox"></div>`;
  else h+=`<div class="card"><h3>DCF</h3>Not available for this stock (financial, realty, REIT or excluded, or data missing).</div>`;
  if(met){const v=met.valuation||{},r=met.ratios||{},g=met.growth||{};
    h+=`<div class="two"><div class="card"><h3>Valuation & quality (FY ${esc(met.latest_fy)})</h3><div class="grid">${kv('P/E (used)',T.fmt(v.pe_used))}${kv('P/B',T.fmt(v.pb))}${kv('EV/EBITDA',T.fmt(v.ev_ebitda))}${kv('FCF yield %',T.fmt(v.fcf_yield_pct))}${kv('Market cap ₹cr',T.fmt(v.market_cap_cr,0))}${kv('ROE %',T.fmt(r.roe_pct))}${kv('ROCE %',T.fmt(r.roce_pct))}${kv('Debt/Equity',T.fmt(r.debt_equity,2))}${kv('Piotroski',met.piotroski&&met.piotroski.score!=null?met.piotroski.score:'–')}${kv('Altman Z″',met.altman_z2&&met.altman_z2.z!=null?T.fmt(met.altman_z2.z,2)+' ('+esc(met.altman_z2.zone||'')+')':'–')}</div>
     ${(met.flags||[]).length?`<p class="warn">${met.flags.map(esc).join(' · ')}</p>`:''}</div>
     <div class="card"><h3>Growth</h3><pre style="margin:0;white-space:pre-wrap;font-size:12px">${esc(JSON.stringify(g,null,1))}</pre></div></div>`}
  h+=ratiosHtml(rat);
  if(rsk){const k=rsk.risk,m=rsk.momentum,b=rsk.beta,t=rsk.trend;
    h+=`<div class="card"><h3>Technicals & risk</h3><div class="grid">${kv('RSI 14',T.fmt(m.rsi14,1))}${kv('MACD hist %',T.fmt(m.macd_hist_pct,2))}${kv('Bollinger %B',T.fmt(m.bollinger_pctb,2))}${kv('ATR %',T.fmt(m.atr_pct,2))}${kv('Above 200-DMA',t.above_dma200?'Yes':'No',t.above_dma200?'pos':'neg')}${kv('Above 50-DMA',t.above_dma50?'Yes':'No',t.above_dma50?'pos':'neg')}${kv('Volatility 1Y %',T.fmt(k.volatility_1y_pct))}${kv('Max DD 1Y %',T.fmt(k.max_drawdown_1y_pct))}${kv('VaR95 1d %',T.fmt(k.var95_1d_pct,2))}${kv('Sharpe 1Y',T.fmt(k.sharpe_1y,2))}${kv('Beta (adj)',T.fmt(b.adjusted,2))}${kv('Alpha % (ann.)',T.fmt(b.alpha_pct))}${kv('Avg traded ₹cr/day',T.fmt(rsk.liquidity.avg_daily_value_3m_cr,1))}</div></div>`}
  view.innerHTML=h;
  bindRatios();
  // price chart
  let range='1Y';
  const drawP=()=>{const days={'3M':63,'6M':126,'1Y':252,'3Y':756,'All':1e9}[range];const rows=prices.slice(-days);
    const x=rows.map(r=>r.Date),c=rows.map(r=>T.num(r.Close));const ma=(n)=>c.map((_,i)=>{if(i<n-1)return null;const full=prices.slice(-days-n+1);return null});
    const ser=[{name:'Close',x,y:c}];
    const sma=n=>{const all=prices.map(r=>T.num(r.Close));return rows.map((_,i)=>{const j=prices.length-rows.length+i;if(j<n-1)return null;let s=0;for(let q=j-n+1;q<=j;q++)s+=all[q];return s/n})};
    ser.push({name:'50d',x,y:sma(50),color:'#4aa3ff'},{name:'200d',x,y:sma(200),color:'#c78bff'});
    if(rows.length)lineChart($('#pc'),ser,{dec:0})};
  document.querySelectorAll('#rng button').forEach(b=>b.onclick=()=>{range=b.dataset.r;drawP()});
  if(prices.length)drawP();
  if(dcf)dcfPanel(dcf,price);
  if(!dcf&&fin)finPanel(fin);
  if(!dcf&&!fin&&rl)realtyPanel(rl);
}


function fmtR(v,f){if(v==null)return '–';if(f==='pct')return T.fmt(v,1)+'%';if(f==='d')return T.fmt(v,0);if(f==='num')return T.fmt(v,0);return T.fmt(v,2)}
function ratiosHtml(r){
  if(!r||!r.sections||!r.sections.length)return '<div class="card"><h3>Ratios</h3><span class="mut">Ratios not available for this stock yet.</span></div>';
  const tabs=r.sections.map((x,i)=>`<button data-sec="${x.id}" ${i===0?'class="on"':''}>${esc(x.title)}</button>`).join('');
  const body=r.sections.map((x,i)=>{
    let t;
    if(x.latest)t=`<table>${x.rows.map(q=>`<tr><td class="l">${esc(q.label)}</td><td>${fmtR(q.value,q.fmt)}</td></tr>`).join('')}</table>`;
    else t=`<table><tr><th class="l">FY</th>${x.years.map(y=>`<th>${esc(y)}</th>`).join('')}${x.rows.some(q=>q.cagr!=null)?'<th>CAGR</th>':''}</tr>${x.rows.map(q=>`<tr><td class="l">${esc(q.label)}</td>${q.values.map(v=>`<td class="${q.fmt==='pct'&&q.key.startsWith('g_')?cls(v):''}">${fmtR(v,q.fmt)}</td>`).join('')}${x.rows.some(z=>z.cagr!=null)?`<td>${q.cagr!=null?T.pct(q.cagr,1):'–'}</td>`:''}</tr>`).join('')}</table>`;
    return `<div class="rsec" data-sec="${x.id}" style="${i?'display:none':''}"><div class="scroll" style="max-height:none">${t}</div></div>`}).join('');
  return `<div class="card" id="ratios"><h3>Ratios (annual, FY ending March unless stated)</h3><div class="bar rtabs">${tabs}</div>${body}<p class="mut" style="font-size:12px">Computed from Yahoo Finance statements (about 4 years). Year-end balances are used for all ratios. Missing values mean the line item is not reported.</p></div>`;
}
function bindRatios(){
  document.querySelectorAll('.rtabs button').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('.rtabs button').forEach(x=>x.classList.toggle('on',x===b));
    document.querySelectorAll('.rsec').forEach(x=>x.style.display=x.dataset.sec===b.dataset.sec?'':'none')})}


// ---------- financials ----------
function finFromRow(r){return {price:T.num(r.price),model:{roe_pct:T.num(r.roe_pct),bvps:T.num(r.bvps),beta:T.num(r.beta)||1,g_cap_pct:T.num(r.g_cap_pct)}}}
function ols(pts){const n=pts.length;if(n<4)return null;const mx=pts.reduce((a,p)=>a+p[0],0)/n,my=pts.reduce((a,p)=>a+p[1],0)/n;let sxy=0,sxx=0;pts.forEach(p=>{sxy+=(p[0]-mx)*(p[1]-my);sxx+=(p[0]-mx)**2});if(!sxx)return null;const b=sxy/sxx;return {a:my-b*mx,b,n}}
let FSUB='Bank + NBFC';
async function financials(){
  const rows=await table('data/financials_summary.csv');
  if(!rows.length){view.innerHTML='<div class="card">No financials data yet. Run the Daily refresh once after adding compute_financials.py.</div>';return}
  const inp={rf:A.rf/100,erp:A.erp/100,g:A.g/100};
  const data=rows.map(r=>{const f=finFromRow(r),m=T.finModel(f,inp),pb=T.num(r.pb);return {sym:r.symbol,sub:r.subtype,price:T.num(r.price),pb,roe:T.num(r.roe_pct),fairPB:m&&m.fairPB,fair:m&&m.fair,up:m&&m.fair!=null&&f.price?(m.fair/f.price-1)*100:null,imp:m&&m.impliedROE!=null?m.impliedROE*100:null,flag:r.flags}});
  const inSub=d=>FSUB==='All'||(FSUB==='Bank + NBFC'?(d.sub==='Bank'||d.sub==='NBFC'):d.sub===FSUB);
  const reg=ols(data.filter(d=>inSub(d)&&d.roe>0&&d.pb>0&&!/overstated/.test(d.flag)).map(d=>[d.roe,d.pb]));
  data.forEach(d=>{d.peer=reg&&d.roe!=null?reg.a+reg.b*d.roe:null});
  view.innerHTML=`<div class="bar"><select id="f-sub">${['Bank + NBFC','Bank','NBFC','Insurance','Other financial','All'].map(x=>`<option ${x===FSUB?'selected':''}>${x}</option>`).join('')}</select>
   <span class="mut">${data.length} financials · assumptions: RF ${A.rf}% · ERP ${A.erp}% · g ${A.g}% (change in Assumptions)</span></div>
   <div class="card"><h3>P/B vs ROE ${reg?`· peer line: P/B = ${T.fmt(reg.a,2)} + ${T.fmt(reg.b,3)} × ROE (n=${reg.n})`:''}</h3><canvas id="sc" style="height:340px"></canvas></div>
   <div class="card scroll"><table id="ft"></table></div>
   <p class="mut">Fair P/B = (ROE − g) ÷ (Ke − g), Ke = RF + beta × ERP. Peer P/B = value from the line above at the stock's ROE. Insurers and asset-light financials are indicative only.</p>`;
  $('#f-sub').onchange=e=>{FSUB=e.target.value;financials()};
  const sel=data.filter(d=>inSub(d)&&d.roe!=null&&d.pb!=null);
  drawScatter($('#sc'),sel,reg);
  const COLS2=[['sym','Symbol','l'],['sub','Type','l'],['price','Price'],['pb','P/B'],['roe','ROE %'],['fairPB','Fair P/B'],['peer','Peer P/B'],['fair','Fair value'],['up','Upside %'],['imp','Implied ROE %']];
  let so={k:'pb',d:-1};
  const draw=()=>{const rs=data.filter(inSub).slice().sort((a,b)=>{const x=a[so.k],y=b[so.k];if(x==null&&y==null)return 0;if(x==null)return 1;if(y==null)return -1;return (x>y?1:x<y?-1:0)*so.d});
   $('#ft').innerHTML='<tr>'+COLS2.map(c=>`<th class="${c[2]||''}" data-k="${c[0]}">${c[1]}${so.k===c[0]?(so.d>0?' ▲':' ▼'):''}</th>`).join('')+'</tr>'+rs.map(d=>`<tr class="row" onclick="location.hash='#/stock/${d.sym}'"><td>${d.sym}${d.flag?' <span class="warn" title="'+esc(d.flag)+'">⚑</span>':''}</td><td class="l mut">${d.sub}</td><td>${T.fmt(d.price,1)}</td><td>${T.fmt(d.pb,2)}</td><td>${T.fmt(d.roe,1)}</td><td>${T.fmt(d.fairPB,2)}</td><td>${T.fmt(d.peer,2)}</td><td>${T.fmt(d.fair,0)}</td><td class="${cls(d.up)}">${T.fmt(d.up,0)}</td><td>${T.fmt(d.imp,1)}</td></tr>`).join('');
   document.querySelectorAll('#ft th').forEach(th=>th.onclick=()=>{const k=th.dataset.k;so=so.k===k?{k,d:-so.d}:{k,d:k==='sym'||k==='sub'?1:-1};draw()})};
  draw();
}
function drawScatter(cv,pts,reg){
  const dpr=window.devicePixelRatio||1,w=cv.clientWidth,h=cv.clientHeight;cv.width=w*dpr;cv.height=h*dpr;const ctx=cv.getContext('2d');ctx.scale(dpr,dpr);
  if(!pts.length)return;const L=44,R=12,Tp=10,B=26;
  const xs=pts.map(p=>p.roe),ys=pts.map(p=>p.pb);const x0=Math.min(0,...xs),x1=Math.max(...xs)*1.05,y0=0,y1=Math.max(...ys)*1.08;
  const X=v=>L+(w-L-R)*(v-x0)/(x1-x0),Y=v=>Tp+(h-Tp-B)*(1-(v-y0)/(y1-y0));
  let hov=-1;
  const draw=()=>{ctx.clearRect(0,0,w,h);ctx.font='11px system-ui';ctx.fillStyle='#8b94a3';ctx.strokeStyle='rgba(139,148,163,.25)';
   for(let k=0;k<=4;k++){const v=y0+(y1-y0)*k/4,y=Y(v);ctx.beginPath();ctx.moveTo(L,y);ctx.lineTo(w-R,y);ctx.stroke();ctx.fillText(T.fmt(v,1),4,y+4)}
   for(let k=0;k<=5;k++){const v=x0+(x1-x0)*k/5;ctx.fillText(T.fmt(v,0)+'%',X(v)-10,h-8)}
   if(reg){ctx.strokeStyle='#f5a524';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(X(x0),Y(reg.a+reg.b*x0));ctx.lineTo(X(x1),Y(reg.a+reg.b*x1));ctx.stroke()}
   pts.forEach((p,i)=>{ctx.fillStyle=i===hov?'#f5a524':(p.sub==='Bank'?'#4aa3ff':p.sub==='NBFC'?'#2ecc71':'#c78bff');ctx.beginPath();ctx.arc(X(p.roe),Y(p.pb),i===hov?6:4,0,7);ctx.fill()});
   if(hov>=0){const p=pts[hov];ctx.fillStyle='#e6e9ee';ctx.fillText(`${p.sym}  ROE ${T.fmt(p.roe,1)}%  P/B ${T.fmt(p.pb,2)}`,L+6,Tp+12)}};
  draw();
  cv.onmousemove=e=>{const r=cv.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;let b=-1,bd=225;pts.forEach((p,i)=>{const d=(X(p.roe)-mx)**2+(Y(p.pb)-my)**2;if(d<bd){bd=d;b=i}});if(b!==hov){hov=b;draw()}};
  cv.onclick=()=>{if(hov>=0)location.hash='#/stock/'+pts[hov].sym};
}
function finPanel(f){
  const box=$('#finbox'),m=f.model;const st={rf:A.rf,erp:A.erp,g:A.g,roe:null};
  const kv=(k,v,c='')=>`<div><div class="k">${k}</div><div class="v ${c}" style="font-size:16px">${v}</div></div>`;
  function render(){
    const inp={rf:st.rf/100,erp:st.erp/100,g:st.g/100,roe:st.roe!=null?st.roe/100:null};
    const r=T.finModel(f,inp),up=r&&r.fair!=null&&f.price?(r.fair/f.price-1)*100:null,sens=r?T.finSens(f,inp):null;
    box.innerHTML=`<div class="card"><h3>Financials model: justified P/B <span class="tag">${esc(f.subtype)}</span></h3>
     <div class="bar"><label>RF % <input id="x-rf" type="number" step="0.1" value="${st.rf}" style="width:70px"></label>
      <label>ERP % <input id="x-erp" type="number" step="0.1" value="${st.erp}" style="width:70px"></label>
      <label>Growth g % <input id="x-g" type="number" step="0.1" value="${st.g}" style="width:70px"></label>
      <label>ROE % <input id="x-roe" type="number" step="0.5" value="${st.roe!=null?st.roe:T.fmt(m.roe_pct,1).replace(',','')}" style="width:70px"></label><button id="x-reset">Reset</button></div>
     ${r&&r.fair!=null?`<div class="grid">${kv('Fair value ₹',T.fmt(r.fair,0))}${kv('Price ₹',T.fmt(f.price,1))}${kv('Upside',T.pct(up,0),cls(up))}${kv('Fair P/B',T.fmt(r.fairPB,2))}${kv('Current P/B',T.fmt(r.pb,2))}${kv('Implied ROE at price %',T.fmt(r.impliedROE!=null?r.impliedROE*100:null,1))}${kv('Cost of equity %',T.fmt(r.ke*100,2))}${kv('g used %',T.fmt(r.g*100,2))}${kv('Book value / share ₹',T.fmt(m.bvps,1))}${kv('Beta used',T.fmt(m.beta,2))}</div>`:'<p class="warn">Model not meaningful with these inputs (needs positive ROE and Ke above g).</p>'}
     <p class="mut" style="font-size:12px">ROE basis: ${esc(f.roe_basis)}. TTM ROE ${T.pct(f.roe_ttm_pct,1)} · 3-yr avg ROE ${T.pct(f.roe_avg3_pct,1)} · book value CAGR ${T.pct(f.bv_cagr_pct,1)} · payout ${T.pct(f.payout_pct,0)}${m.g_cap_pct!=null?' · g capped at sustainable growth '+T.pct(m.g_cap_pct,1):''}</p>
     ${(f.flags||[]).length?`<p class="warn">${f.flags.map(esc).join(' · ')}</p>`:''}</div>
     <div class="two"><div class="card"><h3>ROE history</h3><table><tr><th class="l">FY</th>${(f.fy||[]).map(x=>`<th>${esc(x.year)}</th>`).join('')}</tr><tr><td class="l">ROE %</td>${(f.fy||[]).map(x=>`<td>${T.fmt(x.roe,1)}</td>`).join('')}</tr><tr><td class="l">ROA %</td>${(f.fy||[]).map(x=>`<td>${T.fmt(x.roa,2)}</td>`).join('')}</tr></table></div>
     <div class="card"><h3>Sensitivity: fair value ₹ (ROE down, Ke across)</h3>${sens?`<table><tr><th></th>${sens.kes.map(k=>`<th>${T.fmt(k*100,1)}%</th>`).join('')}</tr>${sens.grid.map((row,i)=>`<tr><td>${T.fmt(sens.roes[i]*100,1)}%</td>${row.map((v,j)=>`<td class="${i===2&&j===2?'hl':''}">${T.fmt(v,0)}</td>`).join('')}</tr>`).join('')}</table>`:''}</div></div>`;
    const bind=(id,key)=>{$(id).onchange=e=>{const v=parseFloat(e.target.value);st[key]=isFinite(v)?v:null;render()}};
    bind('#x-rf','rf');bind('#x-erp','erp');bind('#x-g','g');bind('#x-roe','roe');
    $('#x-reset').onclick=()=>{st.rf=A.rf;st.erp=A.erp;st.g=A.g;st.roe=null;render()};
  }
  render();
}

function realtyPanel(r){
  const box=$('#rlbox');const reit=r.type==='reit';
  const kv=(k,v,c='')=>`<div><div class="k">${k}</div><div class="v ${c}" style="font-size:16px">${v}</div></div>`;
  const inp=(id,label,val,step)=>`<label>${label} <input id="${id}" type="number" step="${step||'any'}" value="${val==null?'':val}" style="width:90px"></label>`;
  const n=id=>{const v=parseFloat($(id).value);return isFinite(v)?v:null};
  let st;
  if(reit){const q=r.reit||{};st={dps:q.dps??null,g:q.g_pct??r.settings.reit_g*100,ke:r.ke_pct,navu:q.nav_per_unit??null}}
  else{const i=r.inputs||{};st={gdv:i.gdv_cr,mg:i.margin_pct,yrs:i.years,noi:i.rental_noi_cr,cap:i.cap_rate_pct,oth:i.other_assets_cr,rate:r.nav_rate_pct,tax:r.tax_pct}}
  function render(){
    let body='',fair=null;
    if(reit){
      const ke=st.ke/100,g=st.g/100;
      if(st.dps&&ke>g+0.01)fair=st.dps*(1+g)/(ke-g);
      const up=fair!=null?(fair/r.price-1)*100:null;
      body=`<div class="bar">${inp('y-dps','DPS (12m) ₹',st.dps)}${inp('y-g','Growth g %',st.g)}${inp('y-ke','Required return %',st.ke)}${inp('y-nav','NAV/unit ₹',st.navu)}<button id="y-reset">Reset</button></div>
       <div class="grid">${kv('Fair value ₹',T.fmt(fair,0))}${kv('Price ₹',T.fmt(r.price,1))}${kv('Upside',T.pct(up,0),cls(up))}${kv('Distribution yield %',st.dps?T.fmt(st.dps/r.price*100,2):'–')}${kv('P/NAV',st.navu?T.fmt(r.price/st.navu,2):'–')}${kv('Net debt ₹cr',T.fmt(r.net_debt_cr,0))}${kv('P/B',T.fmt(r.pb,2))}${kv('EV/EBITDA',T.fmt(r.ev_ebitda,1))}</div>
       <p class="mut" style="font-size:12px">Fair value = DPS × (1+g) ÷ (required return − g). DPS and NAV come from data/reit_inputs.csv; edits here are in your browser only.</p>`;
    }else{
      const have=st.gdv!=null&&st.mg!=null&&st.yrs!=null;
      let pv=null,rent=0,nav=null;
      if(have){pv=st.gdv*st.mg/100*(1-st.tax/100)/Math.pow(1+st.rate/100,st.yrs);rent=st.noi&&st.cap?st.noi/(st.cap/100):0;nav=pv+rent+(st.oth||0)-r.net_debt_cr;fair=nav/r.shares_cr}
      const up=fair!=null?(fair/r.price-1)*100:null;
      body=`<div class="bar">${inp('y-gdv','Project value ₹cr',st.gdv)}${inp('y-mg','Margin %',st.mg)}${inp('y-yrs','Years',st.yrs)}${inp('y-noi','Rental NOI ₹cr',st.noi)}${inp('y-cap','Cap rate %',st.cap)}${inp('y-oth','Other assets ₹cr',st.oth)}${inp('y-rate','NAV discount %',st.rate)}<button id="y-reset">Reset</button></div>
       ${have?`<div class="grid">${kv('NAV / share ₹',T.fmt(fair,0))}${kv('Price ₹',T.fmt(r.price,1))}${kv('Premium/discount to NAV',T.pct((r.price/fair-1)*100,0),'')}${kv('Upside to NAV',T.pct(up,0),cls(up))}${kv('PV of projects ₹cr',T.fmt(pv,0))}${kv('Rental value ₹cr',T.fmt(rent,0))}${kv('Other assets ₹cr',T.fmt(st.oth||0,0))}${kv('Net debt ₹cr',T.fmt(r.net_debt_cr,0))}${kv('NAV ₹cr',T.fmt(nav,0))}</div>`:`<p class="warn">NAV inputs not filled for this developer. Enter project value, margin and years above to try the model here, or fill data/realty_inputs.csv to save them.</p><div class="grid">${kv('P/B',T.fmt(r.pb,2))}${kv('P/E',T.fmt(r.pe_used,1))}${kv('EV/EBITDA',T.fmt(r.ev_ebitda,1))}${kv('Net debt ₹cr',T.fmt(r.net_debt_cr,0))}</div>`}
       <p class="mut" style="font-size:12px">NAV = PV of project surplus after tax (${T.fmt(st.tax,0)}%) at the NAV discount rate + rental NOI ÷ cap rate + other assets − net debt. Inputs come from data/realty_inputs.csv; edits here are in your browser only.</p>`;
    }
    box.innerHTML=`<div class="card"><h3>${reit?'REIT model: distribution value':'Realty NAV model'} <span class="tag">${esc(r.type)}</span></h3>${body}${(r.flags||[]).length?`<p class="warn">${r.flags.map(esc).join(' · ')}</p>`:''}</div>`;
    const map=reit?{'#y-dps':'dps','#y-g':'g','#y-ke':'ke','#y-nav':'navu'}:{'#y-gdv':'gdv','#y-mg':'mg','#y-yrs':'yrs','#y-noi':'noi','#y-cap':'cap','#y-oth':'oth','#y-rate':'rate'};
    Object.entries(map).forEach(([id,k])=>{$(id).onchange=()=>{st[k]=n(id);render()}});
    $('#y-reset').onclick=()=>{if(reit){const q=r.reit||{};st={dps:q.dps??null,g:q.g_pct??r.settings.reit_g*100,ke:r.ke_pct,navu:q.nav_per_unit??null}}else{const i=r.inputs||{};st={gdv:i.gdv_cr,mg:i.margin_pct,yrs:i.years,noi:i.rental_noi_cr,cap:i.cap_rate_pct,oth:i.other_assets_cr,rate:r.nav_rate_pct,tax:r.tax_pct}}render()};
  }
  render();
}

function dcfPanel(d,price){
  const box=$('#dcfbox'),a=d.assumptions;
  const st={rf:A.rf,erp:A.erp,g:A.g,g1:null,w:null};
  const kv=(k,v,c='')=>`<div><div class="k">${k}</div><div class="v ${c}" style="font-size:16px">${v}</div></div>`;
  function render(){
    const inp={rf:st.rf/100,erp:st.erp/100,gT:st.g/100,g1:st.g1!=null?st.g1/100:null,waccOverride:st.w!=null?st.w/100:null};
    // self-check at saved assumptions
    const chk=T.recompute(d,{rf:a.rf_pct/100,erp:a.erp_pct/100,gT:(a.terminal_growth_pct!=null?a.terminal_growth_pct/100:d.model.terminal_g)});
    const diff=chk&&d.fair_value?(chk.perShare/d.fair_value-1)*100:null;
    const ok=diff!=null&&Math.abs(diff)<1.5;
    const r=T.recompute(d,inp);
    const up=r&&price?(r.perShare/price-1)*100:null;
    const sens=r?T.sensitivity(d,inp):null;
    const rv=d.reverse_dcf||{};
    box.innerHTML=`<div class="card"><h3>DCF (FCFF, 10-yr) <span class="tag">${esc(d.reliability||'')}</span></h3>
     <div class="bar"><label>RF % <input id="d-rf" type="number" step="0.1" value="${st.rf}" style="width:70px"></label>
      <label>ERP % <input id="d-erp" type="number" step="0.1" value="${st.erp}" style="width:70px"></label>
      <label>Terminal g % <input id="d-g" type="number" step="0.1" value="${st.g}" style="width:70px"></label>
      <label>1st-yr growth % <input id="d-g1" type="number" step="0.5" value="${st.g1??T.fmt(d.model.g1*100,1).replace(',','')}" style="width:70px"></label>
      <label>WACC % <input id="d-w" type="number" step="0.25" value="${st.w??(r?(r.wacc*100).toFixed(2):'')}" style="width:70px"></label>
      <button id="d-reset">Reset</button></div>
     ${r?`<div class="grid">${kv('Fair value ₹',T.fmt(r.perShare,0))}${kv('Price ₹',T.fmt(price,1))}${kv('Upside',T.pct(up,0),cls(up))}${kv('Cost of equity %',T.fmt(r.ke!=null?r.ke*100:null,2))}${kv('WACC %',T.fmt(r.wacc*100,2))}${kv('Beta used',T.fmt(a.beta_used,2))}${kv('Terminal value share',T.pct(r.tvShare*100,0))}${kv('EBIT margin %',T.fmt(a.ebit_margin_pct))}</div>`:'<p class="warn">WACC must exceed terminal growth.</p>'}
     <p class="${ok?'mut':'warn'}">${ok?'Model check OK: browser recalculation matches the saved nightly value within '+T.fmt(Math.abs(diff),1)+'%.':'Warning: browser recalculation differs from the saved nightly value by '+T.fmt(diff,1)+'%. Treat the live numbers as approximate; saved nightly fair value is ₹'+T.fmt(d.fair_value,0)+' (range '+T.fmt(d.fair_low,0)+'–'+T.fmt(d.fair_high,0)+').'}</p>
     ${(d.flags||[]).length?`<p class="warn">${d.flags.map(esc).join(' · ')}</p>`:''}</div>
     <div class="two"><div class="card"><h3>What the price implies (reverse DCF)</h3><div class="grid">${kv('1st-yr growth %',T.fmt(rv.implied_first_year_growth_pct))}${kv('EBIT margin %',T.fmt(rv.implied_ebit_margin_pct))}${kv('Discount rate %',rv.implied_discount_rate_pct!=null?T.fmt(rv.implied_discount_rate_pct):'–')}</div><p class="mut">${esc(rv.note||'')} ${esc(rv.implied_rate_note||'')}</p></div>
     <div class="card"><h3>Sensitivity: fair value ₹ (WACC down, terminal g across)</h3>${sens?`<table><tr><th></th>${sens.gs.map(g=>`<th>${T.fmt(g*100,1)}%</th>`).join('')}</tr>${sens.grid.map((row,i)=>`<tr><td>${T.fmt(sens.ws[i]*100,2)}%</td>${row.map((v,j)=>`<td class="${i===2&&j===2?'hl':''}">${T.fmt(v,0)}</td>`).join('')}</tr>`).join('')}</table>`:''}</div></div>
     <div class="card"><h3>Projection (₹ cr)</h3><div class="scroll"><table><tr><th>Year</th>${(d.projection_cr||[]).map((p,i)=>`<th>${p.year||'Y'+(i+1)}</th>`).join('')}</tr>
      ${(()=>{const P=d.projection_cr||[];const ks=P.length?Object.keys(P[0]).filter(k=>k!=='year'):[];return ks.map(k=>`<tr><td>${esc(k)}</td>${P.map(p=>`<td>${T.fmt(p[k],/pct|rate|factor/.test(k)?2:0)}</td>`).join('')}</tr>`).join('')})()}</table></div></div>`;
    const bind=(id,key)=>{$(id).onchange=e=>{const v=parseFloat(e.target.value);st[key]=isFinite(v)?v:null;if(key==='rf'||key==='erp'||key==='g')st.w=null;render()}};
    bind('#d-rf','rf');bind('#d-erp','erp');bind('#d-g','g');bind('#d-g1','g1');bind('#d-w','w');
    $('#d-reset').onclick=()=>{st.rf=A.rf;st.erp=A.erp;st.g=A.g;st.g1=null;st.w=null;render()};
  }
  render();
}
boot();
})();

(function(){
const T=window.TL,$=s=>document.querySelector(s),view=$('#view');
const D={};            // loaded tables
const cache={};
const DEF={rf:7.2,erp:6,g:6.5};
let A=Object.assign({},DEF);
try{const s=JSON.parse(localStorage.getItem('tl_assump')||'null');if(s&&s.rf!=null)A=s}catch(e){}
// market-cap class, thresholds in ₹ crore
const CAP_LARGE=105000,CAP_MID=35000;
const capOf=mc=>mc==null||!isFinite(mc)?'':mc>=CAP_LARGE?'Large cap':mc>=CAP_MID?'Mid cap':'Small cap';
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
  const brand=(css.getPropertyValue('--brand')||'#0f6b4a').trim();const col=[brand,'#2f6fdb','#e08a00','#9b59d0'];
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
      ctx.fillStyle=brand;ctx.fillText(txt,L+4,Tp+10)}
  }
  draw();
  cv.onmousemove=e=>{const r=cv.getBoundingClientRect();const i=Math.round((e.clientX-r.left-L)/(w-L-R)*(n-1));draw(Math.min(n-1,Math.max(0,i)))};
  cv.onmouseleave=()=>draw();
}


// ---------- interactive price chart ----------
function priceChart(cv,rows,opt){
  const dpr=window.devicePixelRatio||1,w=cv.clientWidth,h=cv.clientHeight;cv.width=w*dpr;cv.height=h*dpr;
  const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  const css=getComputedStyle(document.documentElement),gv=n=>css.getPropertyValue(n).trim();
  const brand=gv('--brand')||'#0f6b4a',up=gv('--g')||'#127a45',dn=gv('--r')||'#c62828',mut=gv('--m')||'#667085',grid='rgba(139,148,163,.22)',panel=gv('--p')||'#fff',txt=gv('--t')||'#18202b';
  const n=rows.length;if(!n){ctx.clearRect(0,0,w,h);return}
  const L=54,R=12,Tp=12,B=22,VH=opt.volume?Math.min(64,h*.2):0,PH=h-Tp-B-VH-(VH?8:0);
  let lo=Infinity,hi=-Infinity;
  rows.forEach((r,i)=>{const a=opt.mode==='candle'?[r.l??r.c,r.h??r.c]:[r.c];a.forEach(v=>{if(v!=null){lo=Math.min(lo,v);hi=Math.max(hi,v)}});
    (opt.smas||[]).forEach(s=>{const v=s.y[i];if(v!=null){lo=Math.min(lo,v);hi=Math.max(hi,v)}})});
  if(lo===hi){lo-=1;hi+=1}const pad=(hi-lo)*.06;lo-=pad;hi+=pad;
  const X=i=>L+(w-L-R)*(i+.5)/n,Y=v=>Tp+PH*(1-(v-lo)/(hi-lo));
  const vmax=Math.max(...rows.map(r=>r.v||0),1);
  let iMax=0,iMin=0;rows.forEach((r,i)=>{if(r.c>rows[iMax].c)iMax=i;if(r.c<rows[iMin].c)iMin=i});
  function draw(hov,prog){
    ctx.clearRect(0,0,w,h);ctx.font='11px system-ui,sans-serif';
    ctx.strokeStyle=grid;ctx.fillStyle=mut;ctx.lineWidth=1;
    for(let k=0;k<=4;k++){const v=lo+(hi-lo)*k/4,y=Math.round(Y(v))+.5;ctx.beginPath();ctx.moveTo(L,y);ctx.lineTo(w-R,y);ctx.stroke();ctx.fillText(T.fmt(v,0),4,y+4)}
    [0,.5,1].forEach(f=>{const i=Math.round((n-1)*f);const t=rows[i].d;ctx.fillText(t,Math.max(L,Math.min(X(i)-28,w-R-62)),h-6)});
    // volume
    if(VH){const bw=Math.max(1,(w-L-R)/n*.7);rows.forEach((r,i)=>{if(!r.v)return;const bh=VH*r.v/vmax,prev=i?rows[i-1].c:r.c;ctx.globalAlpha=.35;ctx.fillStyle=r.c>=prev?up:dn;ctx.fillRect(X(i)-bw/2,h-B-bh,bw,bh)});ctx.globalAlpha=1}
    ctx.save();ctx.beginPath();ctx.rect(0,0,L+(w-L)*prog,h);ctx.clip();
    if(opt.mode==='candle'){const bw=Math.max(1,Math.min(14,(w-L-R)/n*.7));
      rows.forEach((r,i)=>{if(r.o==null||r.h==null||r.l==null)return;const col=r.c>=r.o?up:dn;ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(X(i),Y(r.h));ctx.lineTo(X(i),Y(r.l));ctx.stroke();
        const y1=Y(Math.max(r.o,r.c)),y2=Y(Math.min(r.o,r.c));ctx.fillRect(X(i)-bw/2,y1,bw,Math.max(1,y2-y1))})}
    else{
      if(opt.mode==='area'){const g=ctx.createLinearGradient(0,Tp,0,Tp+PH);g.addColorStop(0,brand+'55');g.addColorStop(1,brand+'00');
        ctx.beginPath();rows.forEach((r,i)=>i?ctx.lineTo(X(i),Y(r.c)):ctx.moveTo(X(i),Y(r.c)));ctx.lineTo(X(n-1),Tp+PH);ctx.lineTo(X(0),Tp+PH);ctx.closePath();ctx.fillStyle=g;ctx.fill()}
      ctx.strokeStyle=brand;ctx.lineWidth=2;ctx.lineJoin='round';ctx.beginPath();rows.forEach((r,i)=>i?ctx.lineTo(X(i),Y(r.c)):ctx.moveTo(X(i),Y(r.c)));ctx.stroke()}
    (opt.smas||[]).forEach(sm=>{ctx.strokeStyle=sm.color;ctx.lineWidth=1.3;ctx.beginPath();let st=false;sm.y.forEach((v,i)=>{if(v==null)return;st?ctx.lineTo(X(i),Y(v)):ctx.moveTo(X(i),Y(v));st=true});ctx.stroke()});
    ctx.restore();
    // high / low markers
    if(prog>=1){ctx.fillStyle=mut;ctx.font='11px system-ui,sans-serif';
      [[iMax,'High '],[iMin,'Low ']].forEach(([i,t])=>{const lbl=t+T.fmt(rows[i].c,0),tw=ctx.measureText(lbl).width;
        ctx.fillText(lbl,Math.max(L,Math.min(X(i)-tw/2,w-R-tw)),Y(rows[i].c)+(t==='High '?-7:15));
        ctx.beginPath();ctx.arc(X(i),Y(rows[i].c),3,0,7);ctx.fillStyle=t==='High '?up:dn;ctx.fill();ctx.fillStyle=mut})}
    if(hov!=null&&prog>=1){const r=rows[hov],x=X(hov);
      ctx.strokeStyle=mut;ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(x,Tp);ctx.lineTo(x,h-B);ctx.stroke();ctx.setLineDash([]);
      ctx.beginPath();ctx.arc(x,Y(r.c),4.5,0,7);ctx.fillStyle=panel;ctx.fill();ctx.lineWidth=2;ctx.strokeStyle=brand;ctx.stroke();
      const prev=hov?rows[hov-1].c:r.c,ch=(r.c/prev-1)*100;
      const lines=[r.d,(r.o!=null&&opt.mode==='candle'?`O ${T.fmt(r.o,1)}  H ${T.fmt(r.h,1)}  L ${T.fmt(r.l,1)}  `:'')+`C ${T.fmt(r.c,1)}`,`${ch>=0?'+':''}${T.fmt(ch,2)}% day`+(r.v?`  Vol ${T.fmt(r.v/1e5,1)}L`:'')];
      ctx.font='12px system-ui,sans-serif';const bw=Math.max(...lines.map(t=>ctx.measureText(t).width))+20,bh=60;
      let bx=x+14;if(bx+bw>w-R)bx=x-14-bw;const by=Tp+4;
      ctx.fillStyle=panel;ctx.strokeStyle=grid;ctx.lineWidth=1;ctx.beginPath();ctx.roundRect?ctx.roundRect(bx,by,bw,bh,8):ctx.rect(bx,by,bw,bh);ctx.fill();ctx.stroke();
      ctx.fillStyle=txt;ctx.font='bold 12px system-ui,sans-serif';ctx.fillText(lines[0],bx+10,by+18);
      ctx.font='12px system-ui,sans-serif';ctx.fillText(lines[1],bx+10,by+35);ctx.fillStyle=ch>=0?up:dn;ctx.fillText(lines[2],bx+10,by+51)}
  }
  let prog=opt.animate===false?1:0,hov=null;
  const reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce)prog=1;
  const t0=performance.now(),DUR=650;
  (function step(t){prog=Math.min(1,(t-t0)/DUR);const e=1-Math.pow(1-prog,3);draw(hov,prog>=1?1:e);if(prog<1&&cv.isConnected)requestAnimationFrame(step)})(t0);
  if(prog===1)draw(null,1);
  const at=e=>{const r=cv.getBoundingClientRect(),x=(e.touches?e.touches[0].clientX:e.clientX)-r.left;hov=Math.min(n-1,Math.max(0,Math.round((x-L)/(w-L-R)*n-.5)));if(prog>=1)draw(hov,1)};
  cv.onpointermove=at;cv.onpointerdown=at;cv.onpointerleave=()=>{hov=null;draw(null,1)};
}
function countUps(root){
  const reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;if(reduce)return;
  (root||document).querySelectorAll('[data-n]').forEach(el=>{
    const to=parseFloat(el.dataset.n),d=parseInt(el.dataset.d||'0',10),pre=el.dataset.pre||'',suf=el.dataset.suf||'';if(!isFinite(to))return;
    const t0=performance.now(),D=800;(function f(t){const p=Math.min(1,(t-t0)/D),e=1-Math.pow(1-p,3);el.textContent=pre+T.fmt(to*e,d)+suf;if(p<1&&el.isConnected)requestAnimationFrame(f)})(t0)});
}
const SKEL='<div class="skel" style="height:140px"></div><div class="skel" style="height:44px;margin-top:14px"></div><div class="skel" style="height:360px;margin-top:14px"></div>';
function decs(str){const m=String(str).replace(/,/g,'').match(/\.(\d+)/);return m?m[1].length:0}

// ---------- boot ----------
async function boot(){
  const [uni,met,dcf,rsk,mkt]=await Promise.all([table('data/universe.csv'),table('data/metrics_summary.csv'),table('data/dcf_summary.csv'),table('data/risk_summary.csv'),get('data/market.json','json')]);
  D.uni=uni;D.mkt=mkt;
  try{const st=await get('data/last_updated.json','json');if(st&&st.utc){const d=new Date(st.utc.replace(' ','T')+':00Z');
    $('#fupd').textContent='Data updated '+d.toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'})+' IST · prices as of '+(st.price_date||'')}}catch(e){}
  const by=(rows)=>{const o={};rows.forEach(r=>o[r.symbol]=r);return o};
  D.met=by(met);D.dcf=by(dcf);D.rsk=by(rsk);
  D.syms=uni.map(u=>u.symbol);
  window.attachSuggest=attachSuggest;D.uni=uni;attachSuggest($('#search'));
  const idx=$('#idx');if(idx&&D.mkt){const row=(n,o)=>o?`<div><span>${n}</span><b>${T.fmt(o.price??o.close,0)}</b><span class="${cls(o.ret_1m??o.returns_pct?.['1m'])}">${T.pct(o.ret_1m??o.returns_pct?.['1m'])}</span></div>`:'';idx.innerHTML='<div class="k">1-month</div>'+row('Nifty 50',D.mkt.nifty50)+row('Nifty 500',D.mkt.nifty500)}
  const th=$('#theme');const setTh=t=>{document.documentElement.dataset.theme=t;try{localStorage.setItem('tl_theme',t)}catch(e){}};
  let t0='light';try{t0=localStorage.getItem('tl_theme')||'light'}catch(e){}document.documentElement.dataset.theme=t0;
  th.onclick=()=>{setTh(document.documentElement.dataset.theme==='dark'?'light':'dark');route()};
  try{const tp=document.createElement('div');tp.className='tape';const rs=Object.values(D.rsk).filter(r=>T.num(r.ret_1m)!=null).sort((a,b)=>(T.num(b.traded_cr)||0)-(T.num(a.traded_cr)||0)).slice(0,30);
    let mhd=null;try{mhd=await get('data/market_health.json','json')}catch(e){}
    const ixs=((mhd&&mhd.indices)||[]).filter(x=>x.real).map(x=>{const y=x.y.filter(v=>v!=null),l=y[y.length-1],p=y[y.length-23];return [x.name,{price:l,ret:p?(l/p-1)*100:null}]});
    const items=ixs.map(([n,o])=>`<span class="ti"><b>${esc(n)}</b> ${T.fmt(o.price,0)} <em class="${cls(o.ret)}">${T.pct(o.ret,1)}</em></span>`).join('')+''
    ;const items2=items+rs.map(r=>`<a class="ti" href="#/stock/${esc(r.symbol)}"><b>${esc(r.symbol)}</b> ${T.fmt(T.num(r.price),1)} <em class="${cls(T.num(r.ret_1m))}">${T.pct(T.num(r.ret_1m),1)}</em></a>`).join('');
    tp.innerHTML=`<div class="tt"><div class="tr">${items2}${items2}</div></div><span class="tl">1M</span>`;document.querySelector('.top').after(tp)}catch(e){}
  window.addEventListener('hashchange',route);route();
}

const LOCKED_TABS=['valuation','orderflow','quant'];
const isLocked=()=>!!(window.TL_AUTH&&window.TL_AUTH.gate&&!window.TL_AUTH.in());
function lockPage(name){
  view.innerHTML=`<div class="card lockc"><div class="lockic">&#128274;</div><h2>${esc(name)}</h2><p>Quant models, Order Flow and the valuation models are for signed-in users.<br>Market overview, company search, the screener and basic stock pages are open to everyone.</p><button class="primary" id="lk-in">Sign in</button></div>`;
  const b=document.getElementById('lk-in');if(b)b.onclick=()=>{const a=document.getElementById('acct');if(a)a.click()};
}
window.addEventListener('tl-auth',()=>{route.last=null;route()});
function route(){
  const h=location.hash||'#/market';const p=h.split('/');
  const key=p[1]==='stock'?'research':(p[1]==='sector'?'market':(p[1]||'market'));
  document.querySelectorAll('#topnav a').forEach(a=>a.classList.toggle('on',a.dataset.k===key));
  try{const on=document.querySelector('#topnav a.on'),pl=document.getElementById('pill');if(on&&pl){pl.style.left=on.offsetLeft+'px';pl.style.width=on.offsetWidth+'px';pl.style.opacity=1}else if(pl)pl.style.opacity=0}catch(e){}
  if(route.last!==h){window.scrollTo(0,0);route.last=h}
  if(isLocked()){
    if(p[1]==='orderflow')return lockPage('Order Flow');
    if(p[1]==='quant')return lockPage('Quant Lab');
    if(p[1]==='financials')return lockPage('Financial models');
    if(p[1]==='stock'&&p[2]&&LOCKED_TABS.includes(p[3]))return lockPage({valuation:'Valuation models',orderflow:'Order Flow',quant:'Quant models'}[p[3]]+' · '+decodeURIComponent(p[2]));
  }
  if(p[1]==='stock'&&p[2])return stock(decodeURIComponent(p[2]),p[3]);
  if(p[1]==='sector'&&p[2]&&p[3])return sectorPage(p[2],decodeURIComponent(p[3]));
  if(p[1]==='screener')return screener();
  if(p[1]==='financials')return financials();
  if(p[1]==='research')return research();
  if(p[1]==='about')return aboutPage();
  if(p[1]==='orderflow')return orderFlowPage();
  if(p[1]==='quant')return quantLab();
  return market();
}
function research(){
  view.innerHTML=`<div class="rs"><h2>Company research</h2><p class="mut">Search any of the ~750 stocks (Nifty 500 and Microcap 250) by name or symbol</p><div class="rsbox"><input id="rs-q" placeholder="e.g. Reliance, TCS, HDFC Bank" autocomplete="off"></div></div>`;
  const q=$('#rs-q');attachSuggest(q);q.focus();
}


// ---------- Quant (stock tab + Quant Lab) ----------
const FN={value:'Value',quality:'Quality',momentum:'Momentum',lowvol:'Low volatility',growth:'Growth',size:'Size'};
const FCOMP=['value','quality','momentum','lowvol','growth'];
const FHELP={value:'Earnings, book value, EV/EBITDA and free-cash-flow yields. Higher = cheaper.',quality:'ROE, ROCE, net margin, low debt, Piotroski score.',momentum:'12-month and 6-month price change, skipping the latest month.',lowvol:'Low 1-year volatility and low beta.',growth:'Revenue and net-income CAGR.',size:'Log market cap (information only, not in the composite).'};
let QW={value:25,quality:25,momentum:25,lowvol:25,growth:0};
try{const s=JSON.parse(localStorage.getItem('tl_qw')||'null');if(s&&typeof s.value==='number')QW=s}catch(e){}
const saveQW=()=>{try{localStorage.setItem('tl_qw',JSON.stringify(QW))}catch(e){}};
const qnone=(m)=>`<div class="card"><p class="mut">${m}</p></div>`;
const NOQ='Quant data is not available yet. Run the <b>Quant models</b> workflow in GitHub Actions (Actions → Quant models → Run workflow).';
const qtile=(k,v,sub,c)=>`<div class="tile"><div class="k">${k}</div><div class="tv ${c||''}">${v}</div>${sub?`<div class="mut" style="font-size:11px">${sub}</div>`:''}</div>`;
const qleg=a=>`<div class="qleg">${a.map(x=>`<span><i style="background:${x[1]}"></i>${x[0]}</span>`).join('')}</div>`;
const pfx=v=>v==null?'–':(v>0?'+':'')+T.fmt(v,1)+'%';
function qComposite(F,w){
  const keys=FCOMP.filter(k=>(w[k]||0)>0),out={};
  for(const [s,x] of Object.entries(F.stocks)){let a=0,b=0;keys.forEach(k=>{const z=x.z[k];if(z!=null){a+=w[k]*z;b+=w[k]}});if(b>0&&keys.some(k=>x.z[k]!=null))out[s]=a/b}
  const v=Object.entries(out).sort((p,q)=>p[1]-q[1]),n=v.length,res={};
  v.forEach((e,i)=>{res[e[0]]={z:e[1],p:(i+.5)/n*100,rank:n-i,n}});
  return res;
}
function scatterChart(cv,pts,opt={}){   // pts: [{x,y,c,r,l}]
  const dpr=window.devicePixelRatio||1,w=cv.clientWidth,h=cv.clientHeight;cv.width=w*dpr;cv.height=h*dpr;
  const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const L=52,R=14,Tp=10,B=30,xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
  let x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);const px=(x1-x0)*.08||1,py=(y1-y0)*.1||1;x0-=px;x1+=px;y0-=py;y1+=py;
  const X=v=>L+(w-L-R)*(v-x0)/(x1-x0),Y=v=>Tp+(h-Tp-B)*(1-(v-y0)/(y1-y0));
  ctx.font='11px system-ui';ctx.fillStyle='#8b94a3';ctx.strokeStyle='rgba(139,148,163,.25)';
  for(let k=0;k<=4;k++){const v=y0+(y1-y0)*k/4,y=Y(v);ctx.beginPath();ctx.moveTo(L,y);ctx.lineTo(w-R,y);ctx.stroke();ctx.fillText(T.fmt(v,opt.dec??1)+(opt.unit??'%'),2,y+4)}
  for(let k=0;k<=4;k++){const v=x0+(x1-x0)*k/4;ctx.fillText(T.fmt(v,opt.dec??1)+(opt.unit??'%'),X(v)-14,h-14)}
  ctx.fillText(opt.xl||'',L,h-2);
  const line=pts.filter(p=>p.line);ctx.strokeStyle=opt.lc||'#2f6fdb';ctx.lineWidth=1.6;ctx.beginPath();line.forEach((p,i)=>i?ctx.lineTo(X(p.x),Y(p.y)):ctx.moveTo(X(p.x),Y(p.y)));ctx.stroke();
  pts.filter(p=>!p.line).forEach(p=>{ctx.fillStyle=p.c||'#0f6b4a';ctx.beginPath();ctx.arc(X(p.x),Y(p.y),p.r||4,0,7);ctx.fill();if(p.l){ctx.fillStyle='#8b94a3';ctx.fillText(p.l,X(p.x)+6,Y(p.y)-5)}});
}
// ----- stock page: Quant tab -----
async function quantTabs(s,tech){
  const box=$('#qbody');if(!box)return;
  const [Qd,F,Cal,PCA,IN]=await Promise.all([get(`data/quant/${s}.json`,'json'),get('data/quant/factors.json','json'),get('data/quant/cal.json','json'),get('data/quant/pca.json','json'),get(`data/quant/intraday/${s}.json`,'json')]);
  const tabs=[['vol','Volatility & VaR'],['trend','Trend'],['fac','Factors'],['pca','Market structure'],['exe','Execution'],['stat','Price statistics']];
  let cur='vol';try{cur=localStorage.getItem('tl_qtab')||'vol'}catch(e){}if(!tabs.some(t=>t[0]===cur))cur='vol';
  const sub=$('#qsub');
  const dates=Cal?Cal.d:[];
  const draw=()=>{
    sub.innerHTML=tabs.map(t=>`<button data-k="${t[0]}" class="${t[0]===cur?'on':''}">${t[1]}</button>`).join('');
    sub.querySelectorAll('button').forEach(b=>b.onclick=()=>{cur=b.dataset.k;try{localStorage.setItem('tl_qtab',cur)}catch(e){}draw()});
    const fns={vol:qVol,trend:qTrend,fac:qFac,pca:qPca,exe:qExe,stat:()=>tech||qnone('No risk data for this stock.')};
    box.innerHTML=(cur==='stat'||Qd||cur==='exe'||cur==='fac')?fns[cur]():qnone(NOQ);
    if(cur==='stat')countUps(box);
    after[cur]&&after[cur]();
  };
  const after={};
  function qVol(){
    const v=Qd&&Qd.vol;if(!v)return qnone('Not enough price history to fit volatility models for this stock (needs about 120 daily returns).');
    const n=v.now||{},m=v.model,ser=v.ser||{};
    let h=`<div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${m?qtile('GARCH volatility',T.fmt(n.garch,1)+'%','annualised, model estimate for today'):''}${qtile('EWMA volatility',T.fmt(n.ewma,1)+'%','RiskMetrics, decay 0.94')}${qtile('Realised 21 days',T.fmt(n.real21,1)+'%')}${qtile('Realised 1 year',T.fmt(n.real252,1)+'%')}${n.pct_rank!=null?qtile('Percentile vs own history',T.fmt(n.pct_rank,0),'of the last '+T.fmt(v.n/252,1)+' years of GARCH volatility'):''}${n.parkinson21!=null?qtile('Parkinson 21 days',T.fmt(n.parkinson21,1)+'%','from daily high-low range'):''}</div>`;
    h+=`<div class="card"><h3>Volatility over the last ${dates.length} sessions <span class="tag">annualised %</span></h3><canvas id="qvc" style="height:240px"></canvas>${qleg([['GARCH','#0f6b4a'],['EWMA','#2f6fdb'],['Realised 21d','#e08a00']])}</div>`;
    if(!m){h+=qnone(v.note||'GARCH was not fitted.');return h}
    h+=`<div class="card"><h3>Fitted model <span class="tag">${esc(m.name)}</span></h3><p class="mut" style="margin-top:0">Daily returns are modelled as volatility that reacts to yesterday's shock (α ${T.fmt(m.alpha,3)}${m.gamma?`, extra α for down days ${T.fmt(m.gamma,3)}`:''}) and decays slowly (β ${T.fmt(m.beta,3)}), with fat-tailed Student-t errors (${T.fmt(m.nu,1)} degrees of freedom; smaller = fatter tails). Persistence ${T.fmt(m.persistence,3)}: a volatility shock fades by half in about <b>${m.half_life!=null?T.fmt(m.half_life,0)+' days':'n/a'}</b>; the long-run level the model pulls toward is <b>${T.fmt(m.long_run_vol,1)}%</b>. ${m.converged?'':'<span class="warn">The optimiser did not report full convergence, treat with care.</span>'} The model picks plain or asymmetric (GJR) form by BIC: ${Object.entries(m.bic).map(([k,b])=>`${esc(k)} ${b==null?'–':T.fmt(b,0)}`).join(' vs ')} (lower is better).</p>
      <table class="stmt"><tr><th class="l">Forecast horizon</th>${v.fc.h.map(x=>`<th>${x} day${x>1?'s':''}</th>`).join('')}</tr><tr><td class="l">Expected volatility (annualised)</td>${v.fc.vol.map(x=>`<td>${T.fmt(x,1)}%</td>`).join('')}</tr></table></div>`;
    h+=`<div class="card"><h3>Value at Risk and Expected Shortfall <span class="tag">tomorrow and 10 days</span></h3>
      <div style="margin-bottom:8px">Position size ₹ <input id="qpos" type="number" value="10" min="0" step="1" style="width:90px"> lakh</div>
      <table class="stmt" id="qvar"></table>
      <p class="mut" style="font-size:12px">VaR 95% is the loss that should be exceeded on only 1 day in 20; Expected Shortfall is the average loss on those bad days. "Student-t" uses the fitted distribution; "Historical-shock" re-uses this stock's own past standardised shocks (filtered historical simulation), so it does not assume a distribution. 10-day figures come from 20,000 simulated paths of the fitted model. Losses are in simple-return terms.</p></div>`;
    const bt=v.bt;
    if(bt){const row=(k,lab)=>{const b=bt[k];if(!b)return '';const bad=(b.kupiec_p!=null&&b.kupiec_p<.05)||(b.indep_p!=null&&b.indep_p<.05);return `<tr><td class="l">${lab}</td><td>${T.fmt(b.expected,1)}</td><td>${b.actual}</td><td>${b.kupiec_p==null?'–':T.fmt(b.kupiec_p,3)}</td><td>${b.indep_p==null?'–':T.fmt(b.indep_p,3)}</td><td class="${bad?'neg':'pos'}">${bad?'Rejected':'Passed'}</td></tr>`};
      h+=`<div class="card"><h3>Out-of-sample VaR back-test <span class="tag">last ${bt.test_days} sessions</span></h3><table class="stmt"><tr><th class="l">Level</th><th>Expected breaches</th><th>Actual breaches</th><th>Kupiec p</th><th>Independence p</th><th>Verdict</th></tr>${row('95','VaR 95%')}${row('99','VaR 99%')}</table><p class="mut" style="font-size:12px">The model is fitted only on data before the test window, then used to set each day's VaR. Kupiec tests whether the number of breaches matches the target; the independence test checks that breaches are not clustered. A p-value under 0.05 means the model failed that test. Failing is information, not a bug: it says do not trust this VaR number blindly for this stock.</p></div>`}
    else h+=qnone('Back-test needs about 900 daily returns; this stock has fewer.');
    return h;
  }
  after.vol=()=>{
    const v=Qd&&Qd.vol;if(!v)return;const ser=v.ser||{},x=dates.map(d=>d.slice(2));
    const S=[];if(ser.garch)S.push({name:'GARCH',x,y:ser.garch,color:'#0f6b4a'});S.push({name:'EWMA',x,y:ser.ewma,color:'#2f6fdb'});S.push({name:'21d',x,y:ser.real21,color:'#e08a00'});
    const cv=$('#qvc');if(cv)lineChart(cv,S,{dec:0});
    const t=$('#qvar');if(!t||!v.var)return;
    const upd=()=>{const pos=parseFloat($('#qpos').value)||0;
      const c=(p)=>p==null?'–':`${T.fmt(p,2)}%<div class="mut" style="font-size:11px">₹${T.fmt(pos*1e5*p/100,0)}</div>`;
      let r=`<tr><th class="l"></th><th colspan="2">1 day</th><th colspan="2">10 days</th></tr><tr><th class="l">Measure</th><th>Student-t</th><th>Historical-shock</th><th>Student-t</th><th>Historical-shock</th></tr>`;
      for(const [k,lab] of [['95','95%'],['99','99%']]){const d=v.var[k];if(!d)continue;
        r+=`<tr><td class="l">VaR ${lab}</td><td>${c(d['1d'].t)}</td><td>${c(d['1d'].fhs)}</td><td>${c(d['10d'].t)}</td><td>${c(d['10d'].fhs)}</td></tr><tr><td class="l">Expected Shortfall ${lab}</td><td>${c(d['1d'].es_t)}</td><td>${c(d['1d'].es_fhs)}</td><td>${c(d['10d'].es_t)}</td><td>${c(d['10d'].es_fhs)}</td></tr>`}
      t.innerHTML=r};
    $('#qpos').oninput=upd;upd();
  };
  function qTrend(){
    const t=Qd&&Qd.trend;if(!t)return qnone('Not enough price history for trend models (needs about 260 sessions).');
    const k6=t.kal60,k12=t.kal120;
    const sig=x=>x!=null&&Math.abs(x)>=2;
    const dr=Object.entries(t.drift||{}).map(([k,d])=>`<tr><td class="l">${k==='3m'?'3 months':k==='6m'?'6 months':'12 months'}</td><td class="${cls(d.mu)}">${pfx(d.mu)}</td><td>${T.fmt(d.t,2)}</td><td class="${sig(d.t)?(d.t>0?'pos':'neg'):'mut'}">${sig(d.t)?'Statistically significant':'Not distinguishable from zero'}</td></tr>`).join('');
    const vr=Object.entries(t.vr||{}).map(([q,d])=>`<tr><td class="l">${q} days</td><td>${T.fmt(d.vr,3)}</td><td>${T.fmt(d.z,2)}</td></tr>`).join('');
    const vc={trending:['Trending','pos','Multi-day returns have been moving in the same direction more than chance would explain.'],'mean-reverting':['Mean-reverting','neg','Multi-day moves have tended to partly reverse.'],'random-walk':['Random walk','mut','No statistically reliable pattern: past direction does not help predict the next move.']}[t.vr_class]||['–','mut',''];
    return `<div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">${qtile('Trend slope (60-day filter)',pfx(k6.slope),'annualised, smoothed',cls(k6.slope))}${qtile('Trend slope (120-day filter)',pfx(k12.slope),'annualised, smoothed',cls(k12.slope))}${qtile('Price vs 60-day trend',pfx(k6.gap),'above (+) or below (−) the filtered level',cls(k6.gap))}${qtile('Price behaviour',vc[0],'variance-ratio test',vc[1])}</div>
    <div class="card"><h3>Price and filtered trend <span class="tag">last ${dates.length} sessions</span></h3><canvas id="qtc" style="height:260px"></canvas>${qleg([['Price','#8b94a3'],['Trend 60d','#0f6b4a'],['Trend 120d','#9b59d0']])}
      <p class="mut" style="font-size:12px">The trend line is a Kalman filter on log price with a fixed smoothness (equivalent to a Hodrick-Prescott filter with a 60-day or 120-day cut-off). It separates a slowly moving level and slope from day-to-day noise, using only data up to each day. The smoothness is fixed rather than fitted because stock prices are close to a random walk and a fitted filter just chases every move. The slope is a description of recent direction, not a forecast.</p></div>
    <div class="card"><h3>Is the drift real? <span class="tag">Newey-West t-statistic</span></h3><table class="stmt"><tr><th class="l">Window</th><th>Annualised log return</th><th>t-stat</th><th>Reading</th></tr>${dr}</table><p class="mut" style="font-size:12px">Daily returns are noisy, so even a +30% year can have a t-statistic below 2. |t| of 2 or more is the usual bar for "not just luck", and the test is adjusted for volatility clustering and autocorrelation.</p></div>
    <div class="card"><h3>Trending or mean-reverting? <span class="tag">Lo-MacKinlay variance ratio</span></h3><table class="stmt"><tr><th class="l">Holding period</th><th>Variance ratio</th><th>z*</th></tr>${vr}</table>
      <p style="margin:8px 0 2px"><b class="${vc[1]}">${vc[0]}</b> over the last ${T.fmt(t.vr_n/252,1)} years. <span class="mut">${vc[2]}</span></p>
      <p class="mut" style="font-size:12px">A ratio above 1 means multi-day moves are larger than daily volatility would imply (momentum); below 1 means they partly reverse. The label needs a z* beyond ±2.4 (a stricter bar because three horizons are tested together). Even so, about 1 stock in 20 is flagged by chance, so treat a single flag as a prompt to look, not a signal.</p></div>`;
  }
  after.trend=()=>{const t=Qd&&Qd.trend;if(!t||!$('#qtc'))return;const x=dates.map(d=>d.slice(2)),s=t.ser;
    lineChart($('#qtc'),[{name:'Price',x,y:s.px,color:'#8b94a3'},{name:'60d',x,y:s.k60,color:'#0f6b4a'},{name:'120d',x,y:s.k120,color:'#9b59d0'}],{dec:0})};
  function qFac(){
    if(!F)return qnone(NOQ);const f=F.stocks[s];if(!f)return qnone('No factor data for this stock (no fundamentals or too little price history).');
    const comp=qComposite(F,QW)[s],r=f.raw;
    const bar=k=>{const p=f.p[k];return `<tr><td class="l"><b>${FN[k]}</b><div class="mut" style="font-size:11px;white-space:normal">${FHELP[k]}</div></td><td style="width:46%"><div class="qpb"><i class="${p==null?'':p>=60?'g':p<=40?'r':'n'}" style="width:${p==null?0:p}%"></i><b style="left:50%"></b></div></td><td>${p==null?'–':T.fmt(p,0)}</td><td>${f.z[k]==null?'–':T.fmt(f.z[k],2)}</td></tr>`};
    const raw=[['Earnings yield',r.ep!=null?T.fmt(r.ep,1)+'%':'–'],['Book-to-price',r.bp!=null?T.fmt(r.bp,2):'–'],['EBITDA yield',r.eve!=null?T.fmt(r.eve,1)+'%':'–'],['FCF yield',r.fcfy!=null?T.fmt(r.fcfy,1)+'%':'–'],['ROE',r.roe!=null?T.fmt(r.roe,1)+'%':'–'],['ROCE',r.roce!=null?T.fmt(r.roce,1)+'%':'–'],['Net margin',r.margin!=null?T.fmt(r.margin,1)+'%':'–'],['Debt/equity',r.de!=null?T.fmt(r.de,2):'–'],['Piotroski',r.pio!=null?T.fmt(r.pio,0)+'/9':'–'],['12-1m return',pfx(r.mom12)],['6-1m return',pfx(r.mom6)],['1y volatility',r.vol!=null?T.fmt(r.vol,1)+'%':'–'],['Beta (2y)',r.beta!=null?T.fmt(r.beta,2):'–'],['Revenue CAGR',r.revg!=null?T.fmt(r.revg,1)+'%':'–'],['Net-income CAGR',r.nig!=null?T.fmt(r.nig,1)+'%':'–']];
    return `<div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">${comp?qtile('Composite rank',`#${comp.rank} <span class="mut" style="font-size:12px">of ${comp.n}</span>`,`percentile ${T.fmt(comp.p,0)} with weights: ${FCOMP.filter(k=>QW[k]>0).map(k=>FN[k]+' '+QW[k]).join(', ')}`):''}${qtile('Industry group',esc(f.i||'–'),'factors are compared within this group where it has 8+ stocks')}${qtile('Median daily traded value','₹'+T.fmt(f.liq,1)+' cr','1 year')}</div>
    <div class="card"><h3>Factor profile <span class="tag">percentile in the ${F.n}-stock universe</span></h3><table class="stmt"><tr><th class="l">Factor</th><th></th><th>Percentile</th><th>z-score</th></tr>${FCOMP.concat(['size']).map(bar).join('')}</table>
    <p class="mut" style="font-size:12px">Each raw measure is clipped at the 2.5th/97.5th percentile, then converted to a z-score <b>within the stock's industry group</b>, so a bank is judged against banks. Above the centre line = better on that factor. Change the composite weights in <a href="#/quant">Quant Lab</a>.</p></div>
    <div class="card"><h3>Underlying measures</h3><div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">${raw.map(x=>qtile(x[0],x[1])).join('')}</div></div>`;
  }
  function qPca(){
    const p=Qd&&Qd.pca;if(!p)return qnone('This stock is not in the market-structure model (it needs a full 3-year price history and at least ₹1 crore median daily traded value).');
    const cl=PCA&&PCA.clusters.find(c=>c.id===p.cl),mem=PCA?Object.entries(PCA.stocks).filter(e=>e[1].cl===p.cl&&e[0]!==s).map(e=>e[0]):[];
    return `<div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">${qtile('Explained by the market factor',T.fmt(p.r2_mkt*100,0)+'%','share of return variance')}${qtile('Explained by all '+p.K+' common factors',T.fmt(p.r2*100,0)+'%','market plus sector/style factors')}${qtile('Stock-specific',T.fmt((1-p.r2)*100,0)+'%','not shared with other stocks',(1-p.r2)>.6?'pos':'')}</div>
    <div class="card"><h3>Loadings on the main statistical factors</h3><table class="stmt"><tr><th class="l">Factor</th>${p.load.map((_,i)=>`<th>PC${i+1}</th>`).join('')}</tr><tr><td class="l">Loading (correlation with factor)</td>${p.load.map(x=>`<td class="${cls(x)}">${T.fmt(x,2)}</td>`).join('')}</tr></table>
      <p class="mut" style="font-size:12px">PC1 is the market-wide move. The next factors are found from the data and usually line up with sectors or styles; see what each one is in <a href="#/quant">Quant Lab → Market structure</a>. The "${p.K} common factors" are the ones that rise above what random data would produce (Marchenko-Pastur test).</p></div>
    <div class="card"><h3>Behaves like <span class="tag">${cl?esc(cl.label):'cluster '+p.cl}</span></h3>${mem.length?`<p class="mut" style="margin-top:0">${mem.length} other stocks move in a similar way (same cluster of the non-market factors). The first few:</p><p>${mem.slice(0,24).map(x=>`<a class="tag" href="#/stock/${esc(x)}/quant">${esc(x)}</a>`).join('')}</p>`:'<p class="mut">No cluster peers found.</p>'}</div>`;
  }
  function qExe(){
    if(!IN)return qnone('Intraday volume profile is not available for this stock yet. It is built by the Quant models workflow from Yahoo 5-minute bars (about 60 days).');
    const lab=IN.labels,mx=Math.max(...IN.profile,...IN.own);
    const bars=lab.map((l,i)=>`<div class="qcol" title="${l}  stock ${T.fmt(IN.own[i]*100,1)}%  estimate ${T.fmt(IN.profile[i]*100,1)}%"><i class="o" style="height:${IN.own[i]/mx*100}%"></i><i class="e" style="height:${IN.profile[i]/mx*100}%"></i><span>${i%3===0?l:''}</span></div>`).join('');
    const tk=IN.trk;
    return `<div class="card"><h3>Intraday volume profile <span class="tag">${IN.n} sessions, ${esc(IN.from)} to ${esc(IN.to)}</span></h3><div class="qprof">${bars}</div>${qleg([['This stock, raw average','#8b94a3'],['Estimate used (shrunk to the universe profile)','#0f6b4a']])}
      <p class="mut" style="font-size:12px">Share of each day's volume traded in each 15-minute window (09:15 to 15:30). The estimate blends the stock's own average with the universe average, giving the stock's own history weight n/(n+5), so a short or noisy history does not dominate.</p></div>
    <div class="card"><h3>VWAP / TWAP schedule calculator</h3>
      <div class="qform"><label>Order quantity (shares)<input id="qq" type="number" min="1" value="${Math.max(1,Math.round(IN.adv*0.01/100)*100)}"></label><label>Typical daily volume<input value="${T.fmt(IN.adv,0)}" disabled></label><span id="qpart"></span></div>
      <div id="qsch"></div>
      ${tk?`<h4 style="margin:16px 0 6px">How well did the schedule track? <span class="tag">walk-forward, ${tk.days} test days</span></h4><table class="stmt"><tr><th class="l">Schedule</th><th>Typical gap to day's actual VWAP</th><th>Average bias</th></tr><tr><td class="l">VWAP schedule (volume-weighted by the estimate above)</td><td class="${tk.vwap_rmse<tk.twap_rmse?'pos':''}">${T.fmt(tk.vwap_rmse,1)} bps</td><td>${T.fmt(tk.vwap_bias,1)} bps</td></tr><tr><td class="l">TWAP schedule (equal slices)</td><td class="${tk.twap_rmse<tk.vwap_rmse?'pos':''}">${T.fmt(tk.twap_rmse,1)} bps</td><td>–</td></tr></table><p class="mut" style="font-size:12px">For each test day the profile was estimated only from earlier days. The gap is root-mean-square, measured on 15-minute average prices, so it is a floor: it excludes your own market impact, spread and fees. This tool schedules slices; it does not estimate impact cost.</p>`:'<p class="mut">Not enough sessions for a walk-forward test of the schedule.</p>'}</div>
    <div class="card"><h3>Impact cost and optimal execution <span class="tag">Almgren-Chriss model</span></h3>
      <p class="mut" style="margin:0 0 10px;font-size:13px">What does it cost to trade this order, and how fast should you trade? Trading quickly pays more impact; trading slowly leaves you exposed to the price moving. Cost is measured against the price when you start (implementation shortfall).</p>
      <div class="qform"><label>Order quantity (shares)<input id="acq" type="number" min="1" value="${Math.max(1,Math.round(IN.adv*0.05/100)*100)}"></label>
        <label>Time to trade<select id="act"><option value="1">1 day</option><option value="2">2 days</option><option value="3">3 days</option><option value="5">5 days</option><option value="10">10 days</option></select></label>
        <label>Urgency <span id="acuv" class="mut"></span><input id="acu" type="range" min="0" max="8" step="0.1" value="1.5"></label>
        <label>Half-spread (bps)<input id="acs" type="number" min="0" step="0.5" value="${(()=>{const v=(Qd&&Qd.px||0)*IN.adv/1e7;return v>500?2:v>100?4:v>20?8:v>5?15:30})()}"></label>
        <label>Impact multiplier<input id="acm" type="number" min="0.1" step="0.1" value="1"></label></div>
      <div id="acout"></div></div>`;
  }
  after.exe=()=>{if(!IN||!$('#qq'))return;
    const upd=()=>{const q=Math.max(0,Math.floor(parseFloat($('#qq').value)||0)),part=q/IN.adv*100;
      $('#qpart').innerHTML=`<b>${T.fmt(part,1)}%</b> of a typical day's volume ${part>10?'<span class="warn">High. Orders above roughly 10% of daily volume usually move the price; consider spreading over several days.</span>':part>5?'<span class="warn">Meaningful. Expect some impact.</span>':'<span class="mut">Comfortably small.</span>'}`;
      let cumV=0,cumT=0;const eq=q/IN.labels.length;
      $('#qsch').innerHTML=`<table class="stmt"><tr><th class="l">Window</th><th>VWAP shares</th><th>VWAP cumulative</th><th>TWAP shares</th><th>TWAP cumulative</th></tr>${IN.labels.map((l,i)=>{const a=q*IN.profile[i];cumV+=a;cumT+=eq;return `<tr><td class="l">${l}</td><td>${T.fmt(a,0)}</td><td>${T.fmt(cumV/q*100||0,0)}%</td><td>${T.fmt(eq,0)}</td><td>${T.fmt(cumT/q*100||0,0)}%</td></tr>`}).join('')}</table><p class="mut" style="font-size:12px">Slices are fractional; round to your lot size. The window label is the start of each 15 minutes.</p>`};
    $('#qq').oninput=upd;upd();acInit()};
  function acInit(){
    if(!window.AC||!$('#acq'))return;
    const volA=Qd&&Qd.vol&&Qd.vol.now?(Qd.vol.now.garch||Qd.vol.now.ewma||Qd.vol.now.real63):null,S=Qd&&Qd.px;
    if(!volA||!S){$('#acout').innerHTML='<p class="mut">This needs the stock volatility and price from the Quant models run, which are not available for this stock.</p>';return}
    const per=IN.labels.length;
    const upd=()=>{
      const X=Math.max(1,Math.floor(parseFloat($('#acq').value)||0)),Td=parseInt($('#act').value)||1,u=parseFloat($('#acu').value)||0,sp=Math.max(0,parseFloat($('#acs').value)||0),mu=Math.max(.1,parseFloat($('#acm').value)||1);
      $('#acuv').textContent=u<.05?'0 (equal slices, TWAP)':u<2?T.fmt(u,1)+' (gentle front-load)':u<4?T.fmt(u,1)+' (moderate)':T.fmt(u,1)+' (aggressive)';
      const N=Td*per,base={X,S,volAnn:volA,V:IN.adv,T:Td,N,spreadBps:sp,mult:mu},R=AC.run({...base,u}),R0=AC.run({...base,u:0}),part=X/IN.adv*100;
      const rs=v=>'₹'+T.fmt(v/1e5,2)+' lakh',val=X*S;
      const fr=AC.frontier(base,8,32);
      const row=(nm,u2)=>{const r=AC.run({...base,u:u2});return `<tr><td class="l">${nm}</td><td>${T.fmt(r.exp,1)}</td><td>${T.fmt(r.risk,0)}</td><td>${T.fmt(r.worst,0)}</td><td>${T.fmt(r.first,1)}%</td></tr>`};
      const lab=[];for(let k=0;k<=N;k++){const d=Math.floor(k/per),i=k%per;lab.push(k===N?'end':(Td>1?'D'+(d+1)+' ':'')+IN.labels[i])}
      $('#acout').innerHTML=`<div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${qtile('Order size',T.fmt(part,1)+'% of daily volume','₹'+T.fmt(val/1e7,2)+' crore')}${qtile('Expected cost',T.fmt(R.exp,1)+' bps',rs(R.exp/1e4*val)+' on this order',R.exp>25?'neg':'')}${qtile('Price-move risk (1 sd)',T.fmt(R.risk,0)+' bps','how far the result can drift from the expected cost')}${qtile('Bad case (about 1 in 20)',T.fmt(R.worst,0)+' bps',rs(R.worst/1e4*val))}</div>
      <p class="mut" style="font-size:12.5px;margin:8px 0">Expected cost splits into spread <b>${T.fmt(R.spr,1)}</b> bps, temporary impact <b>${T.fmt(R.temp,1)}</b> bps and permanent impact <b>${T.fmt(R.perm,1)}</b> bps. ${part>10?'<span class="warn">The order is large against daily volume, so the linear model understates the real cost. Use the numbers as a floor.</span>':''}</p>
      <h4 style="margin:12px 0 4px">Shares still to trade <span class="tag">% of the order, over time</span></h4><canvas id="acsc" style="height:220px"></canvas>${qleg([['Equal slices (TWAP)','#8b94a3'],['Your urgency','#0f6b4a']])}
      <h4 style="margin:12px 0 4px">Cost against risk <span class="tag">efficient frontier</span></h4><canvas id="acfr" style="height:240px;margin-top:10px"></canvas>
      <table class="stmt" style="margin-top:10px"><tr><th class="l">Style</th><th>Expected cost (bps)</th><th>Risk, 1 sd (bps)</th><th>Bad case (bps)</th><th>First 15 min</th></tr>${row('Equal slices, urgency 0',0)}${row('Your urgency '+T.fmt(u,1),u)}${row('Moderate, urgency 3',3)}${row('Aggressive, urgency 6',6)}</table>
      <p class="mut" style="font-size:12px;margin-top:8px">The curve above is the efficient frontier: each point is the lowest expected cost for that level of risk, and urgency moves you along it. Urgency 0 is the cheapest but riskiest; a risk-averse trader (or one with a view that the price will move) front-loads. Method: Almgren and Chriss (2000) with linear impact, calibrated to Almgren, Thum, Hauptmann and Li (2005): permanent impact 0.314 σ per unit of daily volume, temporary 0.142 σ. Those constants come from US stocks and are an assumption here; use the multiplier to scale them. The half-spread is a rough default from the stock's traded value, not a measured number. Volatility is the model forecast (${T.fmt(volA,1)}% annual) and volume is the typical daily volume above. It ignores fees, taxes and the intraday volume pattern, and treats time in equal 15-minute steps.</p>`;
      const cv=$('#acsc'),cf=$('#acfr');
      if(cv)lineChart(cv,[{name:'TWAP',x:lab,y:R0.x.map(v=>v*100),color:'#8b94a3'},{name:'Urgency '+T.fmt(u,1),x:lab,y:R.x.map(v=>v*100),color:'#0f6b4a'}],{dec:0});
      if(cf)scatterChart(cf,fr.map(f=>({x:f.risk,y:f.exp,line:true})).concat([{x:R.risk,y:R.exp,c:'#0f6b4a',r:6,l:'you'},{x:R0.risk,y:R0.exp,c:'#8b94a3',r:4,l:'TWAP'}]),{unit:'',dec:0,xl:'Across: risk, 1 sd (bps)   Up: expected cost (bps)'});
    };
    ['acq','act','acu','acs','acm'].forEach(id=>{const e=$('#'+id);if(e)e.oninput=upd});upd();
  }
  draw();
}
// ----- Quant Lab -----
const QLS={tab:'rank',idx:'all',ind:'',liq:1,dir:'top',bt:'momentum',pf:{syms:'',method:'hrp',cap:25,look:252,res:null}};
async function quantLab(){
  view.innerHTML=`<h2 style="margin:4px 0 2px">Quant Lab</h2><p class="mut" style="margin:0 0 14px">Factor rankings, factor back-tests, statistical risk factors and a portfolio builder, all computed from end-of-day data in this repository.</p><div class="subtabs" id="qlsub"></div><div id="qlbody"><div class="skel" style="height:360px"></div></div>`;
  const [F,PCA]=await Promise.all([get('data/quant/factors.json','json'),get('data/quant/pca.json','json')]);
  const tabs=[['rank','Factor rankings'],['bt','Factor back-test'],['pca','Market structure'],['port','Portfolio builder']];
  const nm={};try{(await table('data/universe.csv')).forEach(r=>{nm[r.symbol]=r.company})}catch(e){}
  const draw=()=>{
    $('#qlsub').innerHTML=tabs.map(t=>`<button data-k="${t[0]}" class="${t[0]===QLS.tab?'on':''}">${t[1]}</button>`).join('');
    $('#qlsub').querySelectorAll('button').forEach(b=>b.onclick=()=>{QLS.tab=b.dataset.k;draw()});
    const b=$('#qlbody');
    if(!F&&QLS.tab!=='port'){b.innerHTML=qnone(NOQ);return}
    ({rank:()=>labRank(b,F,nm,draw),bt:()=>labBt(b,F),pca:()=>labPca(b,PCA,nm),port:()=>labPort(b,F,nm)})[QLS.tab]();
  };
  draw();
}
function labRank(b,F,nm,redraw){
  const comp=qComposite(F,QW),inds=[...new Set(Object.values(F.stocks).map(x=>x.i).filter(Boolean))].sort();
  let rows=Object.entries(comp).filter(([s])=>{const x=F.stocks[s];return(QLS.idx==='all'||x.x===QLS.idx)&&(!QLS.ind||x.i===QLS.ind)&&(x.liq||0)>=QLS.liq});
  rows.sort((p,q)=>QLS.dir==='top'?q[1].z-p[1].z:p[1].z-q[1].z);const total=rows.length;rows=rows.slice(0,30);
  const cell=(x,k)=>{const p=x.p[k];return `<td class="${p==null?'':p>=70?'pos':p<=30?'neg':''}">${p==null?'–':T.fmt(p,0)}</td>`};
  b.innerHTML=`<div class="card"><h3>Composite weights <span class="tag">saved in this browser</span></h3><div class="qform">${FCOMP.map(k=>`<label title="${FHELP[k]}">${FN[k]} %<input type="number" min="0" max="100" step="5" data-w="${k}" value="${QW[k]}"></label>`).join('')}<button id="qwreset">Reset</button></div>
    <div class="qform" style="margin-top:8px"><label>Show<select id="qdir"><option value="top"${QLS.dir==='top'?' selected':''}>Highest</option><option value="bot"${QLS.dir==='bot'?' selected':''}>Lowest</option></select></label><label>Index<select id="qidx"><option value="all">All</option><option value="nifty500"${QLS.idx==='nifty500'?' selected':''}>Nifty 500</option><option value="microcap250"${QLS.idx==='microcap250'?' selected':''}>Microcap 250</option></select></label><label>Industry<select id="qind"><option value="">All</option>${inds.map(i=>`<option${QLS.ind===i?' selected':''}>${esc(i)}</option>`).join('')}</select></label><label>Min traded value ₹ cr/day<input id="qliq" type="number" min="0" step="0.5" value="${QLS.liq}"></label></div></div>
    <div class="card scroll"><h3>${QLS.dir==='top'?'Highest':'Lowest'} composite scores <span class="tag">${total} stocks match</span></h3><table class="stmt"><tr><th class="l">Stock</th><th>Rank</th><th>Composite z</th>${FCOMP.map(k=>`<th>${FN[k]}</th>`).join('')}<th>Traded ₹cr/day</th></tr>${rows.map(([s,c])=>{const x=F.stocks[s];return `<tr class="row" onclick="location.hash='#/stock/${esc(s)}/quant'"><td class="l"><b>${esc(s)}</b><div class="mut" style="font-size:11px">${esc((nm[s]||'').slice(0,30))} · ${esc(x.i||'')}</div></td><td>${c.rank}</td><td>${T.fmt(c.z,2)}</td>${FCOMP.map(k=>cell(x,k)).join('')}<td>${T.fmt(x.liq,1)}</td></tr>`}).join('')}</table>
    <p class="mut" style="font-size:12px">Factor columns are percentiles (100 = best). The composite is the weighted average of group-neutral z-scores, re-ranked across the universe. Fundamentals are the latest annual statements, so this is a current snapshot, not something we can back-test; the next tab tests the price-based factors. This is a screening aid, not a recommendation.</p></div>`;
  b.querySelectorAll('[data-w]').forEach(i=>i.onchange=()=>{QW[i.dataset.w]=Math.max(0,parseFloat(i.value)||0);if(!FCOMP.some(k=>QW[k]>0))QW.value=25;saveQW();redraw()});
  $('#qwreset').onclick=()=>{QW={value:25,quality:25,momentum:25,lowvol:25,growth:0};saveQW();redraw()};
  $('#qdir').onchange=e=>{QLS.dir=e.target.value;redraw()};$('#qidx').onchange=e=>{QLS.idx=e.target.value;redraw()};$('#qind').onchange=e=>{QLS.ind=e.target.value;redraw()};$('#qliq').onchange=e=>{QLS.liq=parseFloat(e.target.value)||0;redraw()};
}
function labBt(b,F){
  const B=F.bt||{},keys=Object.keys(B);if(!keys.length){b.innerHTML=qnone('Back-test results are not available yet.');return}
  if(!B[QLS.bt])QLS.bt=keys[0];const x=B[QLS.bt];
  b.innerHTML=`<div class="subtabs">${keys.map(k=>`<button data-b="${k}" class="${k===QLS.bt?'on':''}">${esc(B[k].label)}</button>`).join('')}</div>
  <div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${qtile('Long-short, annualised',pfx(x.ls_ann),'top fifth minus bottom fifth',cls(x.ls_ann))}${qtile('t-statistic',T.fmt(x.ls_t,2),Math.abs(x.ls_t)>=2?'statistically significant':'not significant',Math.abs(x.ls_t)>=2?(x.ls_t>0?'pos':'neg'):'')}${qtile('Months with a gain',T.fmt(x.ls_hit,0)+'%',x.periods+' monthly periods')}${qtile('Average rank IC',T.fmt(x.ic,3),'t = '+T.fmt(x.ic_t,2))}${qtile('Long-short volatility',T.fmt(x.ls_vol,1)+'%','annualised')}</div>
  <div class="card"><h3>Growth of ₹1 <span class="tag">${esc(x.from)} to ${esc(x.to)} · ${F.bt_universe} liquid stocks · monthly rebalance</span></h3><canvas id="qbc" style="height:280px"></canvas>${qleg([['Top fifth (Q5)','#0f6b4a'],['Bottom fifth (Q1)','#c62828'],['Long-short','#2f6fdb']])}</div>
  <div class="card"><h3>Return by factor quintile <span class="tag">annualised, equal-weighted</span></h3><table class="stmt"><tr><th class="l"></th>${x.q_ann.map((_,i)=>`<th>Q${i+1}${i===0?' (lowest)':i===4?' (highest)':''}</th>`).join('')}</tr><tr><td class="l">Annualised return</td>${x.q_ann.map(v=>`<td class="${cls(v)}">${pfx(v)}</td>`).join('')}</tr></table>
  <p class="mut" style="font-size:12px"><b>Read this with care.</b> Stocks are sorted into fifths by the factor on each month-end using only data up to that day; the next month's equal-weighted returns are recorded. The universe is today's constituents with at least 3 years of history, so stocks that were delisted or fell out of the indices are missing (survivorship bias flatters long-only results). No transaction costs or impact are deducted, and microcaps are costly to trade. The t-statistic is Newey-West adjusted. A rank IC around 0.02 to 0.05 is typical for a real factor; a t-statistic below 2 means the result could be noise. Only price-based factors are tested; value, quality and growth need point-in-time fundamentals which this repository does not hold.</p></div>`;
  b.querySelectorAll('[data-b]').forEach(e=>e.onclick=()=>{QLS.bt=e.dataset.b;labBt(b,F)});
  const c=x.cum,xs=c.d.map(d=>d.slice(2));lineChart($('#qbc'),[{name:'Q5',x:xs,y:c.q5,color:'#0f6b4a'},{name:'Q1',x:xs,y:c.q1,color:'#c62828'},{name:'L-S',x:xs,y:c.ls,color:'#2f6fdb'}],{dec:2});
}
function labPca(b,P,nm){
  if(!P){b.innerHTML=qnone(NOQ);return}
  const mx=Math.max(...P.eig);
  b.innerHTML=`<div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">${qtile('Stocks in the model',P.n_assets,P.n_obs+' daily returns each')}${qtile('Real common factors',P.n_signif,'eigenvalues above the random-noise edge '+T.fmt(P.mp_edge,2))}${qtile('Variance they explain',T.fmt(P.explained_top,0)+'%','of total return variance')}</div>
  <div class="card"><h3>Eigenvalues <span class="tag">scree</span></h3><div class="qscree">${P.eig.map((e,i)=>`<div class="qcol" title="PC${i+1}: ${T.fmt(e,2)}"><i class="${e>P.mp_edge?'e':'o'}" style="height:${Math.min(100,e/mx*100)}%"></i><span>${i+1}</span></div>`).join('')}</div><p class="mut" style="font-size:12px">Green bars sit above what a market of unrelated stocks would produce by chance (Marchenko-Pastur edge ${T.fmt(P.mp_edge,2)}), so they are treated as real shared drivers. Grey bars are noise. ${esc(P.note)}</p></div>
  <div class="card scroll"><h3>What each factor is</h3><table class="stmt"><tr><th class="l">Factor</th><th>Variance</th><th class="l">Highest loadings</th><th class="l">Lowest loadings</th><th class="l">Industry tilt (up / down)</th></tr>${P.pcs.map(p=>`<tr><td class="l"><b>PC${p.k}</b>${p.k===1?' <span class="mut">market</span>':''}</td><td>${T.fmt(p.var_pct,1)}%</td><td class="l" style="white-space:normal">${p.pos.slice(0,5).map(x=>esc(x[0])).join(', ')}</td><td class="l" style="white-space:normal">${p.neg.slice(0,5).map(x=>esc(x[0])).join(', ')}</td><td class="l" style="white-space:normal">${p.ind_pos.map(x=>esc(x[0])).join(', ')||'–'} <span class="mut">/</span> ${p.ind_neg.map(x=>esc(x[0])).join(', ')||'–'}</td></tr>`).join('')}</table><p class="mut" style="font-size:12px">PC1 loads on nearly every stock with the same sign. For PC2 onward the sign is arbitrary: read the two ends as opposite sides of one theme (for example banks against IT).</p></div>
  <div class="card scroll"><h3>Clusters of stocks that move together</h3><table class="stmt"><tr><th class="l">Cluster</th><th>Stocks</th><th class="l">Industry mix</th></tr>${P.clusters.map(c=>`<tr><td class="l"><b>${esc(c.label)}</b></td><td>${c.n}</td><td class="l" style="white-space:normal">${c.mix.map(m=>esc(m[0])+' '+m[1]).join(' · ')}</td></tr>`).join('')}</table><p class="mut" style="font-size:12px">Ward clustering on each stock's loadings on factors 2 to 6, so the market factor does not swamp the grouping. Open a stock's Quant tab → Market structure to see its cluster mates.</p></div>`;
}
function labPort(b,F,nm){
  const p=QLS.pf;p.F=F;const M={equal:'Equal weight',minvar:'Minimum variance',maxsharpe:'Maximum Sharpe',rp:'Risk parity',hrp:'Hierarchical risk parity'};
  b.innerHTML=`<div class="card"><h3>Portfolio builder</h3><div class="qform" style="align-items:flex-start"><label style="flex:1;min-width:260px">Stocks (symbols, 2 to 40, separated by space or comma)<textarea id="pfs" rows="3" style="width:100%">${esc(p.syms)}</textarea></label>
    <div style="display:flex;flex-direction:column;gap:8px"><label>Method<select id="pfm">${Object.entries(M).map(([k,v])=>`<option value="${k}"${p.method===k?' selected':''}>${v}</option>`).join('')}</select></label><label>Max weight per stock %<input id="pfc" type="number" min="3" max="100" step="1" value="${p.cap}"></label><label>Estimation window (days)<input id="pfl" type="number" min="120" max="1000" step="21" value="${p.look}"></label></div></div>
    <div class="qform" style="margin-top:8px"><button id="pftop">Fill with top 15 by composite</button><button id="pfrun" class="primary">Build portfolio</button><span id="pfst" class="mut"></span></div></div><div id="pfout"></div>`;
  $('#pftop').onclick=()=>{if(!F)return;const c=Object.entries(qComposite(F,QW)).filter(([s])=>(F.stocks[s].liq||0)>=2).sort((a,b)=>b[1].z-a[1].z).slice(0,15).map(e=>e[0]);$('#pfs').value=c.join(', ')};
  $('#pfrun').onclick=()=>{p.syms=$('#pfs').value;p.method=$('#pfm').value;p.cap=parseFloat($('#pfc').value)||100;p.look=Math.max(120,parseInt($('#pfl').value)||252);runPort(p,M,nm)};
  if(p.res)showPort(p,M,nm,p.res);
}
async function runPort(p,M,nm){
  const st=$('#pfst'),out=$('#pfout');
  const syms=[...new Set(p.syms.toUpperCase().split(/[\s,;]+/).filter(Boolean))];
  if(syms.length<2||syms.length>40){st.textContent='Enter between 2 and 40 symbols.';return}
  if(p.cap/100*syms.length<1){st.innerHTML=`<span class="neg">With ${syms.length} stocks the maximum weight must be at least ${T.fmt(100/syms.length,1)}%.</span>`;return}
  st.textContent='Loading prices…';out.innerHTML='';
  const px=await Promise.all(syms.map(async s=>{const r=await table(`data/prices/${s}.csv`);const m=new Map();r.forEach(x=>{const c=T.num(x.Close??x.close);if(c!=null&&c>0)m.set(x.Date??x.date,c)});return m}));
  const bad=syms.filter((s,i)=>px[i].size<300);if(bad.length){st.innerHTML=`<span class="neg">No usable price history for: ${esc(bad.join(', '))}. Remove them and try again.</span>`;return}
  let dates=[...px[0].keys()].filter(d=>px.every(m=>m.has(d))).sort();
  if(dates.length<p.look+60){st.innerHTML=`<span class="neg">Only ${dates.length} common trading days across these stocks; need at least ${p.look+60}. Try a shorter window or drop the newest listing.</span>`;return}
  dates=dates.slice(-1260);
  const R=[];for(let t=1;t<dates.length;t++)R.push(px.map(m=>m.get(dates[t])/m.get(dates[t-1])-1));
  const bigjump=R.some(r=>r.some(x=>Math.abs(x)>.35));
  const PF=window.PF,cap=p.cap/100;
  const train=R.slice(-p.look);
  st.textContent='Optimising…';await new Promise(r=>setTimeout(r,20));
  const lw=PF.ledoitWolf(train),C=PF.annualise(lw.cov),m0=PF.mean(train).map(x=>x*PF.TD),g=m0.reduce((a,c)=>a+c,0)/m0.length,mu=m0.map(x=>.5*x+.5*g);
  const W={};for(const k of Object.keys(M))W[k]=PF.weights(k,train,{cap});
  const w=W[p.method],stt=k=>PF.stats(W[k],C,mu);
  let fr=null;if(syms.length>=3){const F0=PF.frontier(C,mu,cap,0,30);fr=F0}
  p.res={syms,w,W,C,mu,stt:Object.fromEntries(Object.keys(M).map(k=>[k,stt(k)])),fr,lwShrink:lw.shrink,n:dates.length,from:dates[0],to:dates[dates.length-1],bigjump,rc:PF.riskContrib(w,C),wf:null,wfN:Math.max(0,R.length-p.look)};
  showPort(p,M,nm,p.res);
  // walk-forward in the background
  const methods=['equal','minvar','hrp','rp','maxsharpe'];
  if(R.length<p.look+63){st.textContent='';$('#pfwf').innerHTML='<p class="mut">History is too short for a walk-forward test with this window.</p>';return}
  const wf=await PF.walkForwardAsync(R,methods,{look:p.look,hold:21,cap,costBps:10,rf:.065},f=>{st.textContent=`Walk-forward test ${Math.round(f*100)}%…`});
  p.res.wf=wf;st.textContent='';if(p.res===p.res&&$('#pfwf'))showWf(p,M,wf,dates);
}

// ----- Black-Litterman (inside the portfolio builder) -----
function blCard(p,nm,r){
  const el=$('#pfbl');if(!el||!window.PF)return;
  p.bl=p.bl||{txt:'',delta:2.5};
  const ex=r.syms.slice(0,2),eg=ex.length>1?`${ex[0]} 15\n${ex[1]} > ${ex[0]} 3 high`:'';
  el.innerHTML=`<h3>Black-Litterman: blend your views with the market <span class="tag">optional</span></h3>
   <p class="mut" style="margin:0 0 8px;font-size:13px">Starts from the returns the market is already pricing in (market-cap weights and the covariance above), then moves them toward your views in proportion to how confident you are. Stocks you have no view on stay close to the market.</p>
   <div class="qform" style="align-items:flex-start"><label style="flex:1;min-width:260px">Your views, one per line<textarea id="blv" rows="4" style="width:100%" placeholder="${esc(eg)}">${esc(p.bl.txt)}</textarea></label>
    <div style="display:flex;flex-direction:column;gap:8px"><label>Risk aversion<input id="bld" type="number" min="0.5" max="10" step="0.1" value="${p.bl.delta}"></label><button id="blgo" class="primary">Blend views</button></div></div>
   <p class="mut" style="font-size:12px;margin:6px 0">Write <b>SYMBOL return%</b> for a view on one stock (expected annual return), or <b>A &gt; B gap%</b> for "A beats B by this much a year". Add <b>low</b>, <b>medium</b> or <b>high</b> at the end for confidence (default medium).</p>
   <div id="blout"></div>`;
  $('#blgo').onclick=()=>{p.bl.txt=$('#blv').value;p.bl.delta=Math.max(.5,parseFloat($('#bld').value)||2.5);blRun(p,nm,r)};
  if(p.bl.res&&p.bl.res.key===r.from+r.to+r.syms.join())blShow(p,nm,r,p.bl.res);
}
function blRun(p,nm,r){
  const out=$('#blout'),syms=r.syms,n=syms.length,PF=window.PF,cap=p.cap/100,errs=[],views=[];
  const CF={low:.25,med:.5,medium:.5,high:.75},tau=.05;
  p.bl.txt.split(/\n/).map(l=>l.trim()).filter(Boolean).forEach(line=>{
    const m=line.match(/^([A-Za-z0-9&\-]+)\s*(?:>\s*([A-Za-z0-9&\-]+))?\s+(-?\d+(?:\.\d+)?)\s*%?\s*(low|medium|med|high|\d+\s*%?)?$/i);
    if(!m){errs.push(`Could not read: "${line}"`);return}
    const a=m[1].toUpperCase(),b=m[2]?m[2].toUpperCase():null,val=parseFloat(m[3])/100;let cf=.5;
    if(m[4]){const t=m[4].toLowerCase();cf=CF[t]!=null?CF[t]:Math.min(.95,Math.max(.05,parseFloat(t)/100))}
    const ia=syms.indexOf(a),ib=b?syms.indexOf(b):-1;
    if(ia<0||(b&&ib<0)){errs.push(`${esc(ia<0?a:b)} is not in the portfolio above: "${esc(line)}"`);return}
    if(b&&ia===ib){errs.push(`Same stock on both sides: "${esc(line)}"`);return}
    const row=new Array(n).fill(0);row[ia]=1;if(b)row[ib]=-1;
    views.push({p:row,q:val,conf:cf,label:b?`${a} beats ${b} by ${T.fmt(val*100,1)}% a year`:`${a} returns ${T.fmt(val*100,1)}% a year`,confTxt:cf<=.3?'low':cf<=.6?'medium':'high'});
  });
  if(errs.length){out.innerHTML=`<p class="neg" style="font-size:13px">${errs.join('<br>')}</p>`;return}
  const F=p.F,mc=r.syms.map(s=>F&&F.stocks[s]&&F.stocks[s].raw?F.stocks[s].raw.mcap:null),haveMc=mc.every(x=>x!=null&&x>0),tot=haveMc?mc.reduce((a,x)=>a+x,0):n,wref=mc.map(x=>haveMc?x/tot:1/n);
  let bl;try{bl=PF.blackLitterman(r.C,wref,p.bl.delta,tau,views)}catch(e){out.innerHTML='<p class="neg">These views conflict or repeat each other. Remove a duplicate and try again.</p>';return}
  const w0=PF.blWeights(r.C,bl.pi,p.bl.delta,cap),w1=PF.blWeights(r.C,bl.mu,p.bl.delta,cap);
  const res={key:r.from+r.to+r.syms.join(),views,wref,haveMc,pi:bl.pi,mu:bl.mu,w0,w1,delta:p.bl.delta,tau};p.bl.res=res;blShow(p,nm,r,res);
}
function blShow(p,nm,r,B){
  const out=$('#blout');if(!out)return;const PF=window.PF,n=r.syms.length;
  const s0=PF.stats(B.w0,r.C,B.mu),s1=PF.stats(B.w1,r.C,B.mu);
  const vIdx=new Set();B.views.forEach(v=>v.p.forEach((x,i)=>{if(x)vIdx.add(i)}));
  const rows=r.syms.map((s,i)=>({s,i,wref:B.wref[i],pi:B.pi[i],mu:B.mu[i],w0:B.w0[i],w1:B.w1[i]})).sort((a,b)=>b.w1-a.w1),mx=Math.max(...B.w1,...B.w0);
  const capHit=!B.haveMc?'':Math.max(...B.wref)>p.cap/100+1e-9?` The largest market-cap weight (${T.fmt(Math.max(...B.wref)*100,0)}%) is above your ${p.cap}% limit, so even the "no views" column is capped.`:'';
  out.innerHTML=`<div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${qtile('Views used',String(B.views.length),B.views.map(v=>v.confTxt).join(', '))}${qtile('Volatility, no views',T.fmt(s0.vol*100,1)+'%','capped market-implied weights')}${qtile('Volatility, with views',T.fmt(s1.vol*100,1)+'%','Black-Litterman weights')}${qtile('Biggest change',(()=>{const d=rows.map(x=>({s:x.s,d:x.w1-x.w0})).sort((a,b)=>Math.abs(b.d)-Math.abs(a.d))[0];return (d.d>=0?'+':'')+T.fmt(d.d*100,1)+' pts'})(),(()=>{const d=rows.map(x=>({s:x.s,d:x.w1-x.w0})).sort((a,b)=>Math.abs(b.d)-Math.abs(a.d))[0];return d.s})())}</div>
   <div class="card scroll" style="margin-top:8px"><table class="stmt"><tr><th class="l">Stock</th><th>Market weight %</th><th>Market-implied return %</th><th>Blended return %</th><th>Weight, no views %</th><th style="width:22%">Weight with views</th><th>Weight with views %</th><th>Change (pts)</th></tr>${rows.map(x=>`<tr class="${vIdx.has(x.i)?'sel':''}"><td class="l"><b>${esc(x.s)}</b><div class="mut" style="font-size:11px">${esc((nm[x.s]||'').slice(0,26))}</div></td><td>${T.fmt(x.wref*100,1)}</td><td>${T.fmt(x.pi*100,1)}</td><td class="${x.mu>x.pi+1e-6?'pos':x.mu<x.pi-1e-6?'neg':''}">${T.fmt(x.mu*100,1)}</td><td>${T.fmt(x.w0*100,1)}</td><td><div class="qpb"><i class="g" style="width:${mx>0?x.w1/mx*100:0}%"></i></div></td><td>${T.fmt(x.w1*100,1)}</td><td class="${x.w1-x.w0>.0005?'pos':x.w1-x.w0<-.0005?'neg':''}">${x.w1-x.w0>=0?'+':''}${T.fmt((x.w1-x.w0)*100,1)}</td></tr>`).join('')}</table>
   <p class="mut" style="font-size:12px;margin-top:8px">Highlighted rows have a view. Your views: ${B.views.map(v=>`${esc(v.label)} (${v.confTxt})`).join('; ')||'none'}. Weights maximise return minus ${T.fmt(B.delta,1)}/2 × variance, long-only, within your ${p.cap}% limit, fully invested.${B.haveMc?'':' Market-cap data was missing for some stocks, so equal weights stand in for the market.'}${capHit} The prior uncertainty is τ = ${B.tau}. A view moves a stock's return a lot only when you are confident and the stock has few close substitutes; stocks that move with it get pulled along. Treat the output as a way to see what your views imply, not a forecast.</p></div>`;
}
function showPort(p,M,nm,r){
  const o=$('#pfout');if(!o)return;
  const rows=r.syms.map((s,i)=>({s,w:r.w[i],rc:r.rc[i]})).sort((a,b)=>b.w-a.w),mxw=Math.max(...r.w);
  const st=r.stt[p.method];
  o.innerHTML=`${r.bigjump?'<div class="card"><p class="warn">Some daily moves above 35% were found in the price history (likely an unadjusted split or bonus). Results for those stocks can be distorted.</p></div>':''}
  <div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${qtile('Method',M[p.method])}${qtile('Expected volatility',T.fmt(st.vol*100,1)+'%','annualised, shrunk covariance')}${qtile('Historical return (shrunk)',pfx(st.ret*100),'past mean, 50% pulled to the group average')}${qtile('Covariance shrinkage',T.fmt(r.lwShrink*100,1)+'%','Ledoit-Wolf, '+p.look+' days')}${qtile('Effective number of stocks',T.fmt(1/r.w.reduce((a,x)=>a+x*x,0),1),'1 ÷ Σ weight²')}</div>
  <div class="card scroll"><h3>Weights and risk contribution <span class="tag">${r.syms.length} stocks · ${esc(r.from)} to ${esc(r.to)}</span></h3><table class="stmt"><tr><th class="l">Stock</th><th style="width:40%">Weight</th><th>Weight %</th><th>Share of risk %</th></tr>${rows.map(x=>`<tr class="row" onclick="location.hash='#/stock/${esc(x.s)}/quant'"><td class="l"><b>${esc(x.s)}</b><div class="mut" style="font-size:11px">${esc((nm[x.s]||'').slice(0,28))}</div></td><td><div class="qpb"><i class="g" style="width:${mxw>0?x.w/mxw*100:0}%"></i></div></td><td>${T.fmt(x.w*100,1)}</td><td>${T.fmt(x.rc*100,1)}</td></tr>`).join('')}</table>
  <p class="mut" style="font-size:12px">Share of risk shows how much of the portfolio's volatility each stock accounts for; equal-risk methods aim to even it out. Weights come from the last ${p.look} days only and the estimates are noisy, so treat the output as a starting point and look at the walk-forward test below before trusting a method.</p></div>
  <div class="card"><h3>All methods side by side</h3><table class="stmt"><tr><th class="l">Method</th><th>Expected volatility</th><th>Largest weight</th><th>Effective stocks</th><th>Sharpe (shrunk, rf 0)</th></tr>${Object.keys(M).map(k=>{const q=r.stt[k],w=r.W[k];return `<tr class="${k===p.method?'sel':''}"><td class="l">${M[k]}</td><td>${T.fmt(q.vol*100,1)}%</td><td>${T.fmt(Math.max(...w)*100,1)}%</td><td>${T.fmt(1/w.reduce((a,x)=>a+x*x,0),1)}</td><td>${T.fmt(q.sharpe,2)}</td></tr>`}).join('')}</table></div>
  ${r.fr?`<div class="card"><h3>Efficient frontier <span class="tag">position limit ${p.cap}%</span></h3><canvas id="pffc" style="height:280px"></canvas>${qleg([['Frontier','#2f6fdb'],['Chosen method (big dot)','#0f6b4a'],['Other methods','#8b94a3']])}<p class="mut" style="font-size:12px">Highest expected return for each level of risk, using the shrunk return estimates. Expected returns are the weakest input in portfolio theory, so a portfolio far up the frontier mostly reflects past winners.</p></div>`:''}
  <div class="card" id="pfbl"></div>
  <div class="card" id="pfwf"><h3>Walk-forward test <span class="tag">re-estimated every 21 days</span></h3><div class="skel" style="height:120px"></div></div>`;
  if(r.fr){const pts=r.fr.map(f=>({x:f.vol*100,y:f.ret*100,line:true}));Object.keys(M).forEach(k=>{const q=r.stt[k];pts.push({x:q.vol*100,y:q.ret*100,c:k===p.method?'#0f6b4a':'#8b94a3',r:k===p.method?6:4,l:k===p.method?'':({equal:'Equal',minvar:'Min var',maxsharpe:'Max Sharpe',rp:'Risk parity',hrp:'HRP'})[k]})});scatterChart($('#pffc'),pts,{xl:'volatility (annualised) →'})}
  blCard(p,nm,r);
  if(r.wf)showWf(p,M,r.wf,null);
}
function showWf(p,M,wf,dates){
  const el=$('#pfwf');if(!el)return;const ks=['equal','minvar','hrp','rp','maxsharpe'].filter(k=>wf[k]);
  const col={equal:'#8b94a3',minvar:'#2f6fdb',hrp:'#0f6b4a',rp:'#9b59d0',maxsharpe:'#e08a00'};
  const n=wf[ks[0]].n;
  el.innerHTML=`<h3>Walk-forward test <span class="tag">${T.fmt(n/252,1)} years out of sample · 10 bps cost per unit of turnover</span></h3><canvas id="pfwc" style="height:260px"></canvas>${qleg(ks.map(k=>[M[k],col[k]]))}
  <table class="stmt"><tr><th class="l">Method</th><th>Return p.a.</th><th>Volatility</th><th>Sharpe (rf 6.5%)</th><th>Max drawdown</th><th>Turnover / rebalance</th></tr>${ks.map(k=>{const q=wf[k];return `<tr class="${k===p.method?'sel':''}"><td class="l">${M[k]}</td><td class="${cls(q.ann)}">${pfx(q.ann*100)}</td><td>${T.fmt(q.vol*100,1)}%</td><td>${T.fmt(q.sharpe,2)}</td><td class="neg">${T.fmt(q.maxdd*100,1)}%</td><td>${T.fmt(q.turnover*100,0)}%</td></tr>`}).join('')}</table>
  <p class="mut" style="font-size:12px">At each rebalance the method sees only the previous ${p.look} days, then the weights are held for 21 days before being re-estimated. Equal weight is the benchmark to beat; model-based methods often win on risk and lose on return. The stocks are the ones you picked today, so winners are over-represented: absolute returns are flattered, but the comparison between methods is still fair. Results use today's price data and do not include taxes or impact.</p>`;
  const x=[...Array(n).keys()].map(i=>String(i+1));lineChart($('#pfwc'),ks.map(k=>({name:M[k],x,y:wf[k].curve,color:col[k]})),{dec:2});
}

// ---------- Order flow ----------
const OFS={tf:'1w'};const ofTf={};
const OF_TFS=[['1d','1D'],['1w','1W'],['1m','1M'],['3m','3M'],['6m','6M']],OF_LONG={'1m':['1-hour bars','last 21 sessions'],'3m':['daily bars','last 63 sessions'],'6m':['daily bars','last 126 sessions']};
async function loadTf(s){ofTf[s]=(await get(`data/orderflow/${s}.tf.json`,'json'))||'none'}
const ofCache={};
function ofProfileJS(bars){
  let lo=Infinity,hi=-Infinity;bars.forEach(b=>{lo=Math.min(lo,b[4]);hi=Math.max(hi,b[3])});
  const N=40,step=(hi-lo)/N||1,vol=new Array(N).fill(0);
  bars.forEach(b=>{const a=Math.max(0,Math.min(N-1,Math.floor((b[4]-lo)/step))),z=Math.max(0,Math.min(N-1,Math.floor((b[3]-lo)/step)));for(let q=a;q<=z;q++)vol[q]+=b[6]/(z-a+1)});
  const tot=vol.reduce((x,y)=>x+y,0);let p=0;vol.forEach((v,i)=>{if(v>vol[p])p=i});
  let a=p,z=p,acc=vol[p];
  while(acc<.7*tot&&(a>0||z<N-1)){const up=z<N-1?vol[z+1]:-1,dn=a>0?vol[a-1]:-1;if(up>=dn){z++;acc+=vol[z]}else{a--;acc+=vol[a]}}
  return {lo,hi,step,vol,N,poc:lo+(p+.5)*step,vah:lo+(z+1)*step,val:lo+a*step,pi:p,a,z};
}
async function ofStock(s){
  const box=$('#ofbody');if(!box)return;
  let d0=ofCache[s];
  if(!d0){d0=await get(`data/orderflow/${s}.json`,'json');if(d0)ofCache[s]=d0}
  if(!d0){box.innerHTML='<div class="card"><h3>Order flow</h3><p class="mut">No order-flow data for this stock yet. It is built by the <b>Order flow (5-minute bars)</b> workflow in Actions, which runs after the market close on weekdays.</p></div>';return}
  if(OF_LONG[OFS.tf]&&ofTf[s]===undefined)await loadTf(s);
  const draw=()=>{
    const long=!!OF_LONG[OFS.tf];let d=d0,first=0,bars;
    const seg=`<span class="seg" id="ofk" style="margin-left:auto">${OF_TFS.map(x=>`<button data-k="${x[0]}" class="${OFS.tf===x[0]?'on':''}">${x[1]}</button>`).join('')}</span>`;
    const wire=()=>document.querySelectorAll('#ofk button').forEach(b=>b.onclick=async()=>{OFS.tf=b.dataset.k;OFP.tf=b.dataset.k;if(OF_LONG[OFS.tf]&&ofTf[s]===undefined)await loadTf(s);draw()});
    if(long){const tt=ofTf[s]&&ofTf[s]!=='none'?ofTf[s][OFS.tf]:null;
      if(!tt){box.innerHTML=`<div class="card"><h3>Order flow ${seg}</h3><p class="mut">No ${OFS.tf.toUpperCase()} order-flow data for this stock yet. It is built by the <b>Order flow</b> workflow after the market close; stocks with a short price history or no 1-hour data are left out.</p></div>`;wire();return}
      d=tt;bars=d.bars}
    else{const maxd=d0.days.length-1,k=Math.min(OFS.tf==='1d'?1:5,d0.days.length),minDay=maxd-k+1;
      first=d0.bars.findIndex(b=>b[0]>=minDay);bars=d0.bars.slice(first)}
    const A=!!d.agg;
    const up=d.chg>=0;
    const tile=(a,b,c='')=>`<div class="tile"><div class="k">${a}</div><div class="tv ${c}" style="font-size:16px">${b}</div></div>`;
    const f=(v,x=2)=>v==null?'–':T.fmt(v,x);
    const near=(arr,above)=>{const a=arr.filter(x=>above?x.p>d.px:x.p<d.px).sort((p,q)=>above?p.p-q.p:q.p-p.p)[0];return a?`₹${f(a.p)}${a.n>1?' ('+a.n+' equal)':''}`:'–'};
    const bcls=d.bias==='bullish'?'pos':d.bias==='bearish'?'neg':'';
    box.innerHTML=`<div class="card"><h3>Order flow <span class="mut" style="font-weight:400;font-size:12px">${long?OF_LONG[OFS.tf][0]+' · '+OF_LONG[OFS.tf][1]+' to '+esc(d.d):'5-minute bars · session of '+esc(d.d)} · estimated from price and volume</span></h3>
      <div class="ofhead"><span class="ofbias ${bcls}">${d.bias.toUpperCase()}</span><span class="ofscore" title="Strength of the signal, 0 to 99">${d.score}</span><span class="bigp" style="font-size:22px">₹${f(d.px)}</span><span class="chg ${cls(d.chg)}">${d.chg>=0?'+':''}${f(d.chg)}%</span>${A?`<span class="mut" style="font-size:12px">over ${OFS.tf.toUpperCase()}</span>`:''}
       ${seg}</div>
      ${(()=>{const q=d.nse;if(!q)return '';const n=q.nse;
        if(q.status==='ok')return `<div class="ofq ok"><b>✓ Verified with NSE.</b> This session's high, low, close and volume match NSE's official end-of-day figures (our volume is ${f(q.vr*100,0)}% of NSE's).</div>`;
        if(q.status==='vol')return `<div class="ofq warn"><b>~ Prices match NSE, but volume is lower.</b> ${q.why.map(esc).join('; ')}. The price chart, zones and levels are reliable; the volume profile, VWAP and estimated delta are understated for this stock.</div>`;
        if(q.status==='warn')return `<div class="ofq warn"><b>! A price differs from NSE:</b> ${q.why.map(esc).join('; ')}. Treat this stock's chart and levels with care.</div>`;
        return `<div class="ofq pend">NSE's official file for ${esc(q.date)} is not available yet, so this session is not verified. It is checked automatically once NSE publishes it.</div>`})()}
      <div class="ofwrap"><canvas id="ofc"></canvas><div class="ofhov" id="ofhov"></div></div>
      <div class="oflg"><span><i style="background:#1f9d62"></i>Bullish order block</span><span><i style="background:#d64545"></i>Bearish order block</span><span><i class="ln" style="border-color:#8a63d2"></i>VWAP</span><span><i class="ln" style="border-color:#e09a1a"></i>POC</span><span><i class="dash"></i>Liquidity</span><span><i class="dot"></i>Support / resistance</span></div>
      <div class="mtiles" style="margin-top:12px">
       ${tile('Zone to watch',d.zone?`₹${f(d.zone[0])}–${f(d.zone[1])}`:'none nearby')}
       ${tile('Reward : risk',d.rr!=null?`1 : ${f(d.rr,1)}`:'–')}
       ${tile('Risk to zone stop',d.risk!=null?f(d.risk,2)+'%':'–')}
       ${tile(A?'Price vs window VWAP':'Price vs VWAP',`${(d.px/d.vwap-1)*100>=0?'+':''}${f((d.px/d.vwap-1)*100)}%`,cls(d.px-d.vwap))}
       ${tile('Buy/sell delta (est.)',`${d.dr>=0?'+':''}${f(d.dr,1)}%`,cls(d.dr))}
       ${tile(A?'Last 5 sessions volume vs window average':'Volume vs prior days',`${f(d.rv,1)}x`)}
       ${tile(A?'POC / value area (whole window)':'POC / value area',`₹${f(d.poc,1)} · ${f(d.val,1)}–${f(d.vah,1)}`)}
       ${tile('Support',d.sup.length?d.sup.map(x=>'₹'+f(x)).join(' · '):'–','pos')}
       ${tile('Resistance',d.res.length?d.res.map(x=>'₹'+f(x)).join(' · '):'–','neg')}
       ${tile('Liquidity above / below',`${near(d.lqh,true)} / ${near(d.lql,false)}`)}
      </div>
      ${(()=>{const q=d.nse;if(!q||!q.nse)return '';const n=q.nse,mx=Math.max(...(q.dphist||[1]).map(v=>v||0),1);
        return `<h4 style="margin:16px 0 6px;font-size:14px">Official NSE figures for ${esc(q.date)}</h4>
        <div class="mtiles">${tile('Open / High / Low',`${f(n.o)} / ${f(n.h)} / ${f(n.l)}`)}${tile('Last traded price',n.lp!=null?f(n.lp):'–')}${tile('NSE close (30-min average)',f(n.c))}${tile('Traded quantity',T.fmt(n.v,0))}${tile('Number of trades',n.t!=null?T.fmt(n.t,0):'–')}
        ${tile('Delivery %',n.dp!=null?`${f(n.dp,1)}%`:'–',n.dp!=null&&q.avgdp&&n.dp>q.avgdp*1.15?'pos':'')}${tile('Delivery quantity',n.dq!=null?T.fmt(n.dq,0):'–')}${tile('Delivery vs 20-day average',q.spike!=null?`${f(q.spike,2)}x (avg ${f(q.avgdp,1)}%)`:'–')}</div>
        ${q.dphist&&q.dphist.length>2?`<div class="mut" style="font-size:12px;margin:10px 0 4px">Delivery % over the last ${q.dphist.length} sessions (NSE)</div><div class="dpspark">${q.dphist.map(v=>`<i title="${v==null?'':f(v,1)+'%'}" style="height:${v==null?0:Math.max(3,v/mx*100)}%"></i>`).join('')}</div>`:''}
        <p class="mut" style="font-size:12px;margin-top:8px">NSE's official close is the average price of the last 30 minutes, so it can differ from the last traded price, which is what our chart ends on. Delivery % is the share of the day's traded quantity that was taken into delivery instead of being squared off the same day. A reading well above its 20-day average points to investors holding positions, not just day trading. These are official NSE figures, published after the close.</p>`})()}
      <p class="mut" style="font-size:12px;margin-top:12px">This is <b>not exchange order-book data</b>. It is derived from Yahoo Finance 5-minute price and volume bars. Volume profile spreads each bar's volume over its price range; buy/sell delta splits each bar's volume by where it closed in its range; an order block is the last opposite candle before a sharp move that price has not yet closed through; liquidity marks swing highs and lows (and equal highs or lows) that price has not yet traded through, where stop orders often sit. Zones are areas of interest, not guarantees. The score combines price vs VWAP, close position in the day's range, estimated delta, day change, price vs POC and the 5-day trend, scaled by relative volume. Educational use only, not investment advice.</p></div>`;
    wire();
    ofChart($('#ofc'),d,bars,first);
    ofExtra(s,box);
  };
  draw();
  if(!ofStock._r){ofStock._r=1;window.addEventListener('resize',()=>{clearTimeout(ofStock._t);ofStock._t=setTimeout(()=>{const c=$('#ofc');if(c&&c._redraw)c._redraw()},150)})}
}
function ofChart(cv,d,bars,off){
  if(!cv)return;
  const draw=(hov)=>{
    const dpr=window.devicePixelRatio||1,W=cv.parentElement.clientWidth,H=W<560?380:460;
    cv.style.width=W+'px';cv.style.height=H+'px';cv.width=W*dpr;cv.height=H*dpr;
    const x=cv.getContext('2d');x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,W,H);
    const cs=getComputedStyle(document.documentElement),col=n=>cs.getPropertyValue(n).trim();
    const mut=col('--m')||'#667085',txt=col('--t')||'#18202b',G='#1f9d62',R='#d64545';
    const L=6,Rr=54,Tp=10,B=22,pw=W-L-Rr,ph=H-Tp-B,profW=Math.min(120,pw*.2),cw=pw-profW;
    const n=bars.length;
    let lo=Math.min(...bars.map(b=>b[4])),hi=Math.max(...bars.map(b=>b[3]));
    const padv=(hi-lo)*.06;lo-=padv;hi+=padv;
    const Y=v=>Tp+ph*(1-(v-lo)/(hi-lo)),X=i=>L+cw*(i+.5)/n;
    x.font='11px system-ui,sans-serif';x.textBaseline='middle';
    // grid + axis
    x.strokeStyle='rgba(139,148,163,.18)';x.fillStyle=mut;x.lineWidth=1;
    for(let k=0;k<=5;k++){const v=lo+(hi-lo)*k/5,y=Math.round(Y(v))+.5;x.beginPath();x.moveTo(L,y);x.lineTo(W-Rr,y);x.stroke();x.textAlign='left';x.fillText(T.fmt(v,v>1000?0:1),W-Rr+4,y)}
    // session boundaries and time labels
    let prevDay=-1;x.textAlign='center';
    if(d.agg){x.fillStyle=mut;const nl=Math.min(6,n);for(let q=0;q<nl;q++){const i=Math.round((n-1)*q/Math.max(1,nl-1));x.fillText(d.days[bars[i][0]].slice(2),Math.min(W-Rr-26,Math.max(L+26,X(i))),H-8)}}
    else bars.forEach((b,i)=>{if(b[0]!==prevDay){if(prevDay!==-1){x.strokeStyle='rgba(139,148,163,.35)';x.setLineDash([3,3]);x.beginPath();x.moveTo(X(i)-cw/n/2,Tp);x.lineTo(X(i)-cw/n/2,Tp+ph);x.stroke();x.setLineDash([])}
      x.fillStyle=mut;x.fillText(d.days[b[0]].slice(5),Math.min(W-Rr-20,Math.max(L+16,X(i)+16)),H-8);prevDay=b[0]}});
    // volume profile (right)
    const P=ofProfileJS(bars),mx=Math.max(...P.vol);
    for(let q=0;q<P.N;q++){const y1=Y(P.lo+(q+1)*P.step),y0=Y(P.lo+q*P.step),w=P.vol[q]/mx*(profW-6);
      x.fillStyle=(q>=P.a&&q<=P.z)?'rgba(66,110,200,.38)':'rgba(139,148,163,.28)';if(q===P.pi)x.fillStyle='rgba(224,154,26,.75)';
      x.fillRect(W-Rr-w,y1+.5,w,Math.max(1,y0-y1-1))}
    // order blocks
    const near3=(arr,key)=>arr.slice().sort((p,q)=>Math.abs(key(p)-d.px)-Math.abs(key(q)-d.px)).slice(0,3);
    [...near3(d.blocks.filter(z=>z.t==='b'),z=>(z.lo+z.hi)/2),...near3(d.blocks.filter(z=>z.t==='s'),z=>(z.lo+z.hi)/2)].forEach(z=>{const xi=Math.max(0,z.i-off);if(z.i-off>=n||z.hi<lo||z.lo>hi)return;
      const y1=Y(Math.min(z.hi,hi)),y0=Y(Math.max(z.lo,lo)),x0=Math.max(L,X(xi)-cw/n/2);
      x.fillStyle=z.t==='b'?'rgba(31,157,98,.22)':'rgba(214,69,69,.22)';x.fillRect(x0,y1,L+cw-x0,Math.max(2,y0-y1));
      x.strokeStyle=z.t==='b'?'rgba(31,157,98,.7)':'rgba(214,69,69,.7)';x.strokeRect(x0+.5,y1+.5,L+cw-x0,Math.max(2,y0-y1));
      x.fillStyle=z.t==='b'?G:R;x.textAlign='left';x.fillText(z.t==='b'?'OB demand':'OB supply',x0+4,y1+8)});
    // liquidity
    x.setLineDash([2,4]);x.lineWidth=1;
    [[near3(d.lqh,q=>q.p),'BSL'],[near3(d.lql,q=>q.p),'SSL']].forEach(([arr,lab])=>arr.forEach(q=>{if(q.p<lo||q.p>hi||q.i<off)return;const y=Math.round(Y(q.p))+.5,x0=X(q.i-off);
      x.strokeStyle='rgba(138,99,210,.8)';x.beginPath();x.moveTo(x0,y);x.lineTo(L+cw,y);x.stroke();x.fillStyle='#8a63d2';x.textAlign='right';x.fillText(lab+(q.n>1?' ×'+q.n:''),L+cw-3,y-6)}));
    x.setLineDash([]);
    // support / resistance
    x.setLineDash([1,3]);x.lineWidth=1.3;
    [[d.sup,G],[d.res,R]].forEach(([arr,c])=>arr.forEach(p=>{if(p<lo||p>hi)return;const y=Math.round(Y(p))+.5;x.strokeStyle=c;x.beginPath();x.moveTo(L,y);x.lineTo(L+cw,y);x.stroke();x.fillStyle=c;x.textAlign='left';x.fillText(T.fmt(p,1),W-Rr+4,y)}));
    x.setLineDash([]);x.lineWidth=1;
    // POC line
    x.strokeStyle='rgba(224,154,26,.9)';x.beginPath();x.moveTo(L,Math.round(Y(P.poc))+.5);x.lineTo(L+cw,Math.round(Y(P.poc))+.5);x.stroke();
    // candles
    const bw=Math.max(1,cw/n*.7);
    bars.forEach((b,i)=>{const up=b[5]>=b[2],c=up?G:R,xx=X(i);x.strokeStyle=c;x.fillStyle=c;x.beginPath();x.moveTo(xx,Y(b[3]));x.lineTo(xx,Y(b[4]));x.stroke();
      const y1=Y(Math.max(b[2],b[5])),y0=Y(Math.min(b[2],b[5]));x.fillRect(xx-bw/2,y1,bw,Math.max(1,y0-y1))});
    // VWAP per session
    x.strokeStyle='#8a63d2';x.lineWidth=1.6;
    if(d.agg){let pv=0,vv=0,st=false;x.beginPath();bars.forEach((b,i)=>{pv+=(b[3]+b[4]+b[5])/3*b[6];vv+=b[6];if(!vv)return;const y=Y(pv/vv);st?x.lineTo(X(i),y):x.moveTo(X(i),y);st=true});x.stroke()}
    else for(let ds=Math.min(...bars.map(b=>b[0]));ds<=Math.max(...bars.map(b=>b[0]));ds++){let pv=0,vv=0,st=false;x.beginPath();bars.forEach((b,i)=>{if(b[0]!==ds)return;const tp=(b[3]+b[4]+b[5])/3;pv+=tp*b[6];vv+=b[6];if(!vv)return;const y=Y(pv/vv);st?x.lineTo(X(i),y):x.moveTo(X(i),y);st=true});x.stroke()}
    x.lineWidth=1;
    // last price tag
    const lp=bars[n-1][5],yl=Y(lp);x.fillStyle=lp>=bars[n-1][2]?G:R;x.fillRect(W-Rr,yl-9,Rr-2,18);x.fillStyle='#fff';x.textAlign='left';x.fillText(T.fmt(lp,1),W-Rr+4,yl);
    // hover
    const hv=$('#ofhov');
    if(hov!=null&&hov>=0&&hov<n){const b=bars[hov],xx=X(hov);x.strokeStyle=mut;x.setLineDash([3,3]);x.beginPath();x.moveTo(xx,Tp);x.lineTo(xx,Tp+ph);x.stroke();x.setLineDash([]);
      const t=String(b[1]).padStart(4,'0');if(hv)hv.textContent=`${d.days[b[0]]}${t==='0000'?'':' '+t.slice(0,2)+':'+t.slice(2)}  O ${b[2]}  H ${b[3]}  L ${b[4]}  C ${b[5]}  Vol ${T.fmt(b[6],0)}`}
    else if(hv)hv.textContent='Touch or hover over the chart for bar details';
    cv._geo={L,cw,n};
  };
  cv._redraw=()=>draw(cv._h);
  const mv=e=>{const r=cv.getBoundingClientRect(),t=e.touches?e.touches[0]:e,g=cv._geo;if(!g)return;const i=Math.floor((t.clientX-r.left-g.L)/g.cw*g.n);cv._h=i>=0&&i<g.n?i:null;draw(cv._h)};
  cv.onmousemove=mv;cv.ontouchmove=mv;cv.ontouchstart=mv;cv.onmouseleave=()=>{cv._h=null;draw(null)};
  draw(null);
}

// ---------- Order flow page ----------
const ofX={};
async function ofExtra(s,box){
  if(ofX.fii===undefined)ofX.fii=(await get('data/fii_flow.json','json'))||null;
  if(ofX['d'+s]===undefined)ofX['d'+s]=(await get(`data/delivery/${s}.json`,'json'))||null;
  if(!box.isConnected||!box.querySelector('#ofc'))return;
  const old=box.querySelector('#ofx');if(old)old.remove();
  const dl=ofX['d'+s],fi=ofX.fii&&ofX.fii.stocks.find(x=>x.s===s);let h='';
  if(fi)h+=`<div class="mtiles" style="margin-bottom:12px">${qtile('FII / FPI holding',T.fmt(fi.fii,2)+'%',esc(fi.lab||'latest quarter'))}${qtile('Change vs '+esc(fi.plab||'previous quarter'),(fi.d>0?'+':'')+T.fmt(fi.d,2)+' pp','percentage points of the company',fi.d>0.05?'pos':fi.d<-0.05?'neg':'')}${fi.cr!=null?qtile('Estimated value',(fi.cr>0?'+':'')+'₹'+T.fmt(Math.abs(fi.cr),0)+' cr',fi.cr>0?'added (approx.)':'removed (approx.)',fi.cr>0?'pos':'neg'):''}</div>`;
  if(dl&&dl.dp&&dl.dp.length>=30){
    const dp=dl.dp,n=dp.length,last=dp[n-1],a20=dp.slice(-20).reduce((a,b)=>a+(b||0),0)/Math.min(20,n),a1y=dp.slice(-250).reduce((a,b)=>a+(b||0),0)/Math.min(250,n);
    const pr=dp.filter(v=>v!=null&&v<=last).length/n*100;
    h+=`<div class="mtiles" style="margin-bottom:8px">${qtile('Delivery % latest',T.fmt(last,1)+'%',esc(dl.d[n-1]))}${qtile('20-session average',T.fmt(a20,1)+'%')}${qtile('1-year average',T.fmt(a1y,1)+'%')}${qtile('Latest vs own history','percentile '+T.fmt(pr,0),'of '+n+' sessions')}</div><canvas id="ofdc" style="height:190px"></canvas>${qleg([['Delivery %','#8b94a3'],['20-session average','#0f6b4a']])}`;
  }
  if(!h)return;
  box.insertAdjacentHTML('beforeend',`<div class="card" id="ofx"><h3>Delivery and foreign holding <span class="mut" style="font-weight:400;font-size:12px">NSE official figures</span></h3>${h}<p class="mut" style="font-size:12px;margin:8px 0 0">Delivery % is the share of traded shares actually taken into demat accounts rather than squared off in the day. A rise against the stock's own history means more investing and less day trading, but it does not say whether buyers or sellers were behind it. FII / FPI holding is quarterly, from the shareholding filings: it shows the change in the share of the company foreigners hold, not daily buying or selling.</p></div>`);
  const cv=box.querySelector('#ofdc');
  if(cv){const dp=dl.dp.slice(-250),x=dl.d.slice(-250).map(z=>z.slice(2)),ma=dp.map((_,i)=>{const w=dp.slice(Math.max(0,i-19),i+1).filter(v=>v!=null);return w.length>=10?w.reduce((a,b)=>a+b,0)/w.length:null});
    lineChart(cv,[{name:'Delivery %',x,y:dp,color:'#8b94a3'},{name:'20d',x,y:ma,color:'#0f6b4a'}],{dec:0})}
}
const OFP={u:'all',sec:null,tf:'1d'};
async function orderFlowPage(){
  view.innerHTML='<div class="skel" style="height:300px"></div>';
  const D0=await get('data/orderflow.json','json');
  if(!D0||!D0.stocks||!D0.stocks.length){view.innerHTML='<div class="card"><h3>Order flow</h3><p class="mut">Not built yet. Run the <b>Order flow (5-minute bars)</b> workflow in the Actions tab once; after that it updates on weekdays after the market close.</p></div>';return}
  const mem=await get('data/index_members.json','json');
  const P=await get('data/peers.json','json');const nm={};if(P&&P.stocks)P.stocks.forEach(x=>nm[x.s]=x.n);
  const U=[['all','All stocks'],['nifty50','Nifty 50'],['midcap150','Midcap 150'],['smallcap250','Smallcap 250'],['microcap250','Microcap 250']].filter(x=>x[0]==='all'||(mem&&mem[x[0]]));
  let TFD=null;if(OFP.tf!=='1d')TFD=await get('data/orderflow_tf.json','json');
  const FII=await get('data/fii_flow.json','json'),BT=await get('data/orderflow_backtest.json','json');
  const fmap={};if(FII)FII.stocks.forEach(x=>fmap[x.s]=x.d);
  const TFN={'1d':['1D','today','5-minute'],'1w':['1W','1 week','5-minute'],'1m':['1M','1 month','1-hour'],'3m':['3M','3 months','daily'],'6m':['6M','6 months','daily']};
  const draw=()=>{
    const set=OFP.u==='all'?null:new Set(mem[OFP.u]);
    const tf=OFP.tf,tn=TFN[tf],srcRows=tf==='1d'?D0.stocks:(TFD&&TFD[tf])||[];
    const lastD=tf==='1d'?D0.last_date:(TFD&&TFD.last&&TFD.last[tf])||'';
    const all=srcRows.filter(x=>!set||set.has(x.s));
    const sec={};all.forEach(x=>{const k=x.m||'Other';(sec[k]=sec[k]||{k,n:0,sum:0,b:0,r:0});const o=sec[k];o.n++;o.sum+=x.chg||0;if(x.bias==='bullish')o.b++;if(x.bias==='bearish')o.r++});
    const secs=Object.values(sec).filter(o=>o.n>=2).map(o=>({...o,avg:o.sum/o.n})).sort((a,b)=>b.avg-a.avg);
    const mx=Math.max(1,...secs.map(o=>Math.abs(o.avg)));
    const nb=all.filter(x=>x.bias==='bullish').length,nr=all.filter(x=>x.bias==='bearish').length;
    const qv=all.filter(x=>x.q==='ok').length,qw=all.filter(x=>x.q==='warn').length,qo=all.filter(x=>x.q==='vol').length,qp=all.length-qv-qw-qo;
    const pool=OFP.sec?all.filter(x=>(x.m||'Other')===OFP.sec):all;
    const top=b=>pool.filter(x=>x.bias===b).sort((p,q)=>q.score-p.score).slice(0,15);
    const row=x=>`<tr class="row" onclick="location.hash='#/stock/${esc(x.s)}/orderflow'"><td><b>${esc(x.s)}</b>${x.q==='ok'?' <span class="vq ok" title="Matches NSE official figures">✓</span>':x.q==='vol'?' <span class="vq vol" title="Prices match NSE; volume is lower than NSE\'s">~</span>':x.q==='warn'?' <span class="vq warn" title="A price differs from NSE official figures">!</span>':''}<div class="mut" style="font-size:11px">${esc((nm[x.s]||'').slice(0,26))}</div></td><td class="num ${cls(x.chg)}">${x.chg>=0?'+':''}${T.fmt(x.chg,2)}%</td><td class="num"><div class="scbar"><i class="${x.bias==='bullish'?'g':'r'}" style="width:${x.score}%"></i></div>${x.score}</td><td class="num">${x.rr!=null?'1:'+T.fmt(x.rr,1):'–'}</td><td class="num">${x.dp!=null?T.fmt(x.dp,0)+'%':'–'}</td>${FII?`<td class="num ${fmap[x.s]>0.05?'pos':fmap[x.s]<-0.05?'neg':''}">${fmap[x.s]!=null?(fmap[x.s]>0?'+':'')+T.fmt(fmap[x.s],2):'–'}</td>`:''}</tr>`;
    const tb=a=>`<table class="peer"><thead><tr><th>Stock</th><th class="num">${tf==='1d'?'Day':tn[0]+' chg'}</th><th class="num">Score</th><th class="num">R:R</th><th class="num" title="${tf==='1d'?'NSE delivery % for the session':'Average NSE delivery % over the window'}">Del %</th>${FII?'<th class="num" title="Change in FII/FPI holding, latest quarter vs previous, percentage points">FII Δ</th>':''}</tr></thead><tbody>${a.length?a.map(row).join(''):`<tr><td colspan="6" class="mut">${srcRows.length?'None in this selection':'No data for this timeframe yet. Run the Order flow workflow.'}</td></tr>`}</tbody></table>`;
    view.innerHTML=`<h1 style="margin:0 0 4px;font-size:24px">Order flow</h1>
     <p class="mut" style="margin:0 0 12px">${tf==='1d'?'Session of '+esc(lastD):tn[1]+' view, to '+esc(lastD)} · ${all.length} stocks · <span class="pos">${nb} bullish</span> · <span class="neg">${nr} bearish</span> · estimated from ${tn[2]} price and volume${tf==='1d'||tf==='1w'?' · <span title="The back-test covers the 3M and 6M scores only. See the bottom of this page.">intraday view, not back-tested</span>':''}</p>
     <div class="seg" id="oft" style="margin-bottom:12px">${Object.entries(TFN).map(([k,v])=>`<button data-k="${k}" class="${tf===k?'on':''}">${v[0]}</button>`).join('')}</div>
     ${tf==='1d'?`<p class="mut" style="margin:0 0 12px;font-size:12.5px">Data check against NSE's official end-of-day figures: <span class="pos">✓ ${qv} match</span> · <span class="warnc">~ ${qo} prices match, volume lower</span> · <span class="neg">! ${qw} price differs</span> · ${qp} pending or not checked. Delivery % is NSE's own figure.</p>`:`<p class="mut" style="margin:0 0 12px;font-size:12.5px">Longer views measure the whole window: change is the move over the period, VWAP, delta and value area cover all of it, and the score thresholds are widened. NSE verification applies to a single session, so it is shown on 1D only; Del % here is the average over the window.</p>`}
     <div class="seg" id="ofu" style="margin-bottom:12px">${U.map(([k,l])=>`<button data-k="${k}" class="${OFP.u===k?'on':''}">${l}</button>`).join('')}</div>
     <div class="card"><h3>Market X-ray <span class="mut" style="font-weight:400;font-size:12px">average ${tf==='1d'?'day':tn[1]} change by NSE group · click a group to filter the lists</span></h3>
      <div class="xray">${secs.map(o=>`<div class="xr${OFP.sec===o.k?' on':''}" data-k="${esc(o.k)}"><span class="xn">${esc(o.k)}</span><span class="xb"><i class="${o.avg>=0?'g':'r'}" style="width:${Math.abs(o.avg)/mx*50}%;${o.avg>=0?'left':'right'}:50%"></i></span><span class="xv ${cls(o.avg)}">${o.avg>=0?'+':''}${T.fmt(o.avg,2)}%</span><span class="xc mut">${o.b}↑ ${o.r}↓</span></div>`).join('')}</div>
      ${OFP.sec?`<p class="mut" style="font-size:12.5px;margin:8px 0 0">Showing ${esc(OFP.sec)} only · <a class="link" href="javascript:void(0)" id="xclr">clear filter</a></p>`:''}</div>
     ${fiiCard(FII,set)}
     <div class="two" style="margin-top:14px"><div class="card"><h3>Strongest bullish</h3>${tb(top('bullish'))}</div><div class="card"><h3>Weakest (bearish)</h3>${tb(top('bearish'))}</div></div>
     <p class="mut" style="font-size:12px;margin-top:12px">Not exchange order-book data: bias and score are derived from price and volume (price vs VWAP, close position in the day's range, estimated buy/sell delta, day change, price vs point of control and the 5-day trend, scaled by relative volume). ✓ means that stock's day high, low, last price and volume match NSE's official end-of-day file; ~ means prices match but our volume is lower than NSE's; ! means a price differs. R:R is the distance from the nearest order-block zone to the next support or resistance against a stop just beyond the zone. Click a stock for its chart. Educational use only, not investment advice.</p>${btCard(BT)}`;
    document.querySelectorAll('#oft button').forEach(b=>b.onclick=async()=>{OFP.tf=b.dataset.k;OFS.tf=b.dataset.k;OFP.sec=null;if(OFP.tf!=='1d'&&!TFD)TFD=await get('data/orderflow_tf.json','json');draw()});
    document.querySelectorAll('#ofu button').forEach(b=>b.onclick=()=>{OFP.u=b.dataset.k;OFP.sec=null;draw()});
    document.querySelectorAll('.xr').forEach(e=>e.onclick=()=>{OFP.sec=OFP.sec===e.dataset.k?null:e.dataset.k;draw()});
    const c=$('#xclr');if(c)c.onclick=()=>{OFP.sec=null;draw()};
  };
  draw();
}

function fiiCard(F,set){
  if(!F)return '';
  const st=F.stocks.filter(x=>!set||set.has(x.s)),g={};
  st.forEach(x=>{const k=x.m||'Other',o=g[k]=g[k]||{k,n:0,cr:0,w:0,dw:0,fw:0,up:0,dn:0};o.n++;if(x.cr!=null){o.cr+=x.cr;o.w+=x.mc;o.dw+=x.d*x.mc;o.fw+=x.fii*x.mc}if(x.d>0.05)o.up++;if(x.d<-0.05)o.dn++});
  const secs=Object.values(g).filter(o=>o.n>=2).sort((a,b)=>b.cr-a.cr);
  const withCr=st.filter(x=>x.cr!=null),adds=[...withCr].sort((a,b)=>b.cr-a.cr).slice(0,10),cuts=[...withCr].sort((a,b)=>a.cr-b.cr).slice(0,10);
  const money=v=>(v>0?'+':v<0?'−':'')+'₹'+T.fmt(Math.abs(v),0);
  const lst=a=>`<table class="peer"><thead><tr><th>Stock</th><th class="num">FII %</th><th class="num">Δ pp</th><th class="num">Est. ₹ cr</th></tr></thead><tbody>${a.map(x=>`<tr class="row" onclick="location.hash='#/stock/${esc(x.s)}/orderflow'"><td><b>${esc(x.s)}</b></td><td class="num">${T.fmt(x.fii,1)}</td><td class="num ${cls(x.d)}">${x.d>0?'+':''}${T.fmt(x.d,2)}</td><td class="num ${cls(x.cr)}">${money(x.cr)}</td></tr>`).join('')}</tbody></table>`;
  return `<div class="card" style="margin-top:14px"><h3>FII / FPI holding change <span class="mut" style="font-weight:400;font-size:12px">${esc(F.label)} vs ${esc(F.prev_label)} · ${st.length} stocks · quarterly</span></h3>
   <div class="scroll"><table class="peer"><thead><tr><th>NSE group</th><th class="num">FII holding</th><th class="num">Change (pp)</th><th class="num">Est. value ₹ cr</th><th class="num">Stocks ↑ / ↓</th></tr></thead><tbody>${secs.map(o=>{const d=o.w?o.dw/o.w:null;return `<tr><td>${esc(o.k)}</td><td class="num">${o.w?T.fmt(o.fw/o.w,1)+'%':'–'}</td><td class="num ${cls(d)}">${d==null?'–':(d>0?'+':'')+T.fmt(d,2)}</td><td class="num ${cls(o.cr)}"><b>${money(o.cr)}</b></td><td class="num">${o.up} ↑ ${o.dn} ↓</td></tr>`}).join('')}</tbody></table></div>
   <div class="two" style="margin-top:12px"><div><h4 style="margin:0 0 6px">Foreign holding added most</h4>${lst(adds)}</div><div><h4 style="margin:0 0 6px">Foreign holding cut most</h4>${lst(cuts)}</div></div>
   <p class="mut" style="font-size:12px;margin-top:10px"><b>How to read this.</b> Daily FII buying and selling by stock is not published. The only official stock-level view is the quarterly shareholding filing, so this compares the share of each company held by foreign investors in the latest quarter with the one before. The ₹ figure is that change × today's market cap: it is an estimate of value moved, and does not separate buying from price moves, new share issues or changes in other holders' stakes. The latest quarter can lag by up to 3 weeks after quarter end.</p></div>`;
}
function btCard(B){
  if(!B)return `<div class="card" style="margin-top:14px"><h3>How reliable is the score?</h3><p class="mut">The back-test has not been run yet. Run the <b>Order flow</b> workflow.</p></div>`;
  const rows=[];
  for(const w of ['21','63','126'])for(const h of ['21','5']){const x=B.win[w]&&B.win[w].h[h];if(x)rows.push([w,h,x])}
  const sig=x=>x.ic_t>=2?['pos','Predicts']:x.ic_t<=-2?['neg','Predicts the opposite']:['mut','No reliable edge'];
  const any=rows.some(r=>r[2].ic_t>=2);
  return `<div class="card" style="margin-top:14px"><h3>How reliable is the score? <span class="mut" style="font-weight:400;font-size:12px">back-test, ${esc(B.from)} to ${esc(B.to)} · ${B.stocks} liquid stocks · monthly</span></h3>
   <p style="margin:0 0 8px">${any?'<b class="pos">Some evidence</b> that the score ranks stocks by later returns; see the rows marked "Predicts".':'<b>No reliable edge found.</b> Stocks with a high score did not do reliably better than stocks with a low score.'} <span class="mut">The 5-minute version cannot be tested because only 5 sessions of 5-minute bars exist, so this tests the same method on daily bars.</span></p>
   <div class="scroll"><table class="peer"><thead><tr><th>Window</th><th>Looks ahead</th><th class="num">Rank IC</th><th class="num">t-stat</th><th class="num">Plain trailing return IC</th><th class="num">Lowest fifth</th><th class="num">Highest fifth</th><th>Verdict</th></tr></thead><tbody>${rows.map(([w,h,x])=>{const v=sig(x);return `<tr><td>${w} days</td><td>${h} days</td><td class="num">${T.fmt(x.ic,3)}</td><td class="num">${T.fmt(x.ic_t,2)}</td><td class="num">${T.fmt(x.ic_baseline,3)} <span class="mut">(t ${T.fmt(x.ic_baseline_t,1)})</span></td><td class="num ${cls(x.q[0])}">${T.fmt(x.q[0],2)}%</td><td class="num ${cls(x.q[4])}">${T.fmt(x.q[4],2)}%</td><td class="${v[0]}">${v[1]}</td></tr>`}).join('')}</tbody></table></div>
   ${(()=>{const l=B.win['126']&&B.win['126'].h['21'];if(!l||!l.bias)return '';const b=l.bias;return `<div class="card" style="margin:10px 0 0;background:var(--soft,transparent)"><b>Plain reading</b><ul class="mut" style="margin:6px 0 0 18px;line-height:1.6;font-size:13px"><li>Evidence is on the 3-month and 6-month windows, as a way to rank stocks for the <b>next month</b>. It is not a day or week timing tool: the 5-day tests show no reliable edge, and the 1D and 1W views here are not back-tested.</li><li>The score is close to plain momentum. Compare the Rank IC with the plain trailing-return column: when they are similar, the score adds little beyond "it went up".</li><li>Only the <b>bullish</b> label looked useful (later 21-day return ${T.fmt(b.bullish,2)}%, against ${T.fmt(b.neutral,2)}% neutral and ${T.fmt(b.bearish,2)}% bearish, 6-month window). A bearish label did not reliably do worse than neutral.</li><li>Results are flattered by survivorship bias, a strong 2022 to 2026 market for small caps and no trading costs, which matter a lot in microcaps.</li></ul></div>`})()}
   ${B.delivery?`<p style="margin:10px 0 0">Delivery % signal (last 21 sessions vs the stock's own earlier average): rank IC <b>${T.fmt(B.delivery.ic,3)}</b>, t-stat ${T.fmt(B.delivery.ic_t,2)} → ${B.delivery.ic_t>=2?'<b class="pos">predicts next-month return</b>':B.delivery.ic_t<=-2?'<b class="neg">predicts the opposite</b>':'no reliable edge'}.</p>`:''}
   <p class="mut" style="font-size:12px;margin-top:10px">Method: on each month-end the score is computed from data up to that day only, then compared with the return over the next 5 or 21 trading days across stocks. Rank IC is the correlation between score rank and later return rank (0.02 to 0.05 is typical for a real signal; t-stat of 2 or more means unlikely to be chance). "Lowest/highest fifth" are the average later returns of the fifth of stocks with the lowest and highest scores. The plain trailing-return column asks whether simply "it went up over the same window" does as well as the score. Today's index constituents are used, so survivorship bias flatters results, and no trading costs are deducted.</p></div>`;
}
// ---------- About & Support ----------
// Fill these in to show contact details on the About & Support page (empty ones are hidden)
const CONTACT={author:'',email:'the.analyst.cave@gmail.com',linkedin:''};
function aboutPage(){
  const c=CONTACT,lk=(u,t)=>`<a class="link" href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`;
  const faq=(q,a)=>`<details class="faq"><summary>${q}</summary><p>${a}</p></details>`;
  view.innerHTML=`<div class="rs" style="max-width:860px;margin:0 auto;text-align:left">
   <h2 style="text-align:left">About &amp; Support</h2>
   <div class="card"><h3>About</h3>
    <p>Equity Terminal is a research terminal for Indian cash equities: the Nifty 500 and the Nifty Microcap 250 (about 750 stocks). It shows the market at a glance and gives each company a page with financials, valuation models and peer comparison.${c.author?` Built by ${esc(c.author)}.`:''}</p>
    <ul class="mut" style="margin:6px 0 0 18px;line-height:1.7">
     <li><b>Market Overview:</b> indices, sector heatmap and top gainers and losers.</li>
     <li><b>Company Research:</b> overview, financials, valuation (DCF, P/B, multiples, DDM, residual income, asset based and a summary) and peers.</li>
    </ul>
    <p class="mut" style="font-size:13px;margin-top:10px">Data is end-of-day and refreshed automatically on weekdays. Prices and statements come from Yahoo Finance; the stock list, index lists and shareholding come from NSE. Size classes use market cap: large cap ₹${T.fmt(CAP_LARGE,0)} crore and above, mid cap ₹${T.fmt(CAP_MID,0)} to ₹${T.fmt(CAP_LARGE,0)} crore, small cap below ₹${T.fmt(CAP_MID,0)} crore.</p></div>
   <div class="card" style="margin-top:14px"><h3>Contact &amp; support</h3>
    <p>Found a wrong number, a bug, or have an idea? Write to us:</p>
    <ul style="margin:6px 0 0 18px;line-height:1.8">
     ${c.email?`<li>Email: ${lk('mailto:'+c.email+'?subject='+encodeURIComponent('Equity Terminal feedback'),c.email)}</li>`:''}
     ${c.linkedin?`<li>${lk(c.linkedin,'LinkedIn')}</li>`:''}
    </ul>
    <p class="mut" style="font-size:12.5px;margin-top:10px">When reporting a problem, please include the stock symbol, the tab you were on and a screenshot.</p></div>
   <div class="card" style="margin-top:14px"><h3>Common questions</h3>
    ${faq('A number looks wrong for one stock','Most figures come straight from Yahoo Finance, which can be incomplete or restated for some companies, especially banks, lenders and recently merged companies. Check the company\'s own results and report the symbol so we can look at it.')}
    ${faq('The data looks old','Open the footer at the bottom of any page: it shows when data was last updated. Prices refresh once a day after the market closes. If a page looks stale, hard refresh your browser.')}
    ${faq('Why does a model say "low reliability"?','Every model has limits. A dividend model, for example, undervalues companies that pay out little of their profit, so it is flagged for them. Use the Summary tab to compare all models and untick the ones that do not suit the stock.')}
    ${faq('Can I change the assumptions?','Yes. The default risk-free rate, equity risk premium and terminal growth are at the top of the Valuation tab, and every model has editable boxes for its own inputs. Edits inside a model last until you leave the page.')}
   </div>
   <p class="mut" style="font-size:12px;margin-top:14px">Model values are estimates from public data. This is not investment advice.</p></div>`;
}

// ---------- daily quote ----------
const QUOTES=[
["Price is what you pay. Value is what you get.","Warren Buffett"],
["Be fearful when others are greedy, and greedy when others are fearful.","Warren Buffett"],
["The stock market is a device for transferring money from the impatient to the patient.","Warren Buffett"],
["Risk comes from not knowing what you are doing.","Warren Buffett"],
["It is far better to buy a wonderful company at a fair price than a fair company at a wonderful price.","Warren Buffett"],
["Time is the friend of the wonderful business, the enemy of the mediocre.","Warren Buffett"],
["Rule No. 1: Never lose money. Rule No. 2: Never forget Rule No. 1.","Warren Buffett"],
["Opportunities come infrequently. When it rains gold, put out the bucket, not the thimble.","Warren Buffett"],
["The four most dangerous words in investing are: this time it is different.","Sir John Templeton"],
["Bull markets are born on pessimism, grow on skepticism, mature on optimism and die on euphoria.","Sir John Templeton"],
["The investor's chief problem, and even his worst enemy, is likely to be himself.","Benjamin Graham"],
["In the short run, the market is a voting machine. In the long run, it is a weighing machine.","Benjamin Graham"],
["The intelligent investor is a realist who sells to optimists and buys from pessimists.","Benjamin Graham"],
["Know what you own, and know why you own it.","Peter Lynch"],
["Behind every stock is a company. Find out what it is doing.","Peter Lynch"],
["The key to making money in stocks is not to get scared out of them.","Peter Lynch"],
["Far more money has been lost by investors preparing for corrections than has been lost in corrections themselves.","Peter Lynch"],
["Invert, always invert.","Charlie Munger"],
["The big money is not in the buying and selling, but in the waiting.","Charlie Munger"],
["The first rule of compounding: never interrupt it unnecessarily.","Charlie Munger"],
["Investing is the intersection of economics and psychology.","Seth Klarman"],
["You can't predict. You can prepare.","Howard Marks"],
["Being too far ahead of your time is indistinguishable from being wrong.","Howard Marks"],
["Don't look for the needle in the haystack. Just buy the haystack.","John Bogle"],
["The stock market is a giant distraction from the business of investing.","John Bogle"],
["He who lives by the crystal ball will eat shattered glass.","Ray Dalio"],
["An investment in knowledge pays the best interest.","Benjamin Franklin"],
["The stock market is filled with people who know the price of everything, but the value of nothing.","Philip Fisher"]];
function dailyQuote(){
  const el=document.getElementById('quote');if(!el)return;
  const d=new Date(),day=Math.floor((Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())-Date.UTC(d.getFullYear(),0,0))/864e5);
  const [t,a]=QUOTES[(day+d.getFullYear())%QUOTES.length];
  el.innerHTML=`<span class="qt">“${esc(t)}”</span><span class="qa">${esc(a)}</span>`;
}
dailyQuote();

// ---------- search suggestions ----------
function attachSuggest(inp){
  if(!inp)return;const wrap=inp.parentElement;wrap.classList.add('sgw');
  const box=document.createElement('div');box.className='sgl';box.hidden=true;wrap.appendChild(box);
  let items=[],cur=-1;
  const go=sym=>{box.hidden=true;inp.value='';inp.blur();location.hash='#/stock/'+sym};
  const paint=()=>{box.innerHTML=items.map((u,i)=>`<div class="sgi${i===cur?' on':''}" data-s="${esc(u.symbol)}"><b>${esc(u.symbol)}</b><span>${esc(u.company)}</span></div>`).join('');box.hidden=!items.length};
  const find=()=>{const q=inp.value.trim().toUpperCase();if(!q){items=[];cur=-1;paint();return}
    const U=(D.uni||[]);const sc=u=>{const s=u.symbol.toUpperCase(),c=(u.company||'').toUpperCase();return s===q?0:s.startsWith(q)?1:c.startsWith(q)?2:s.includes(q)?3:c.includes(q)?4:9};
    items=U.map(u=>[sc(u),u]).filter(x=>x[0]<9).sort((x,y)=>x[0]-y[0]||x[1].symbol.localeCompare(y[1].symbol)).slice(0,8).map(x=>x[1]);cur=items.length?0:-1;paint()};
  inp.addEventListener('input',find);
  inp.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){cur=Math.min(items.length-1,cur+1);paint();e.preventDefault()}else if(e.key==='ArrowUp'){cur=Math.max(0,cur-1);paint();e.preventDefault()}else if(e.key==='Enter'&&items[cur]){go(items[cur].symbol)}else if(e.key==='Escape'){box.hidden=true}});
  box.addEventListener('mousedown',e=>{const t=e.target.closest('.sgi');if(t){e.preventDefault();go(t.dataset.s)}});
  inp.addEventListener('blur',()=>setTimeout(()=>box.hidden=true,120));
  inp.addEventListener('focus',()=>{if(inp.value)find()});
}

// ---------- market ----------
function heat(){
  const g={};Object.values(D.rsk).forEach(r=>{const v=T.num(r.ret_1m);if(v==null||(T.num(r.traded_cr)||0)<1)return;const ind=(D.met[r.symbol]||{}).industry||(D.uni.find(u=>u.symbol===r.symbol)||{}).industry;if(!ind)return;(g[ind]=g[ind]||[]).push(v)});
  const med=a=>{a=a.slice().sort((x,y)=>x-y);const m=a.length>>1;return a.length%2?a[m]:(a[m-1]+a[m])/2};
  const rows=Object.entries(g).filter(([k,a])=>a.length>=3).map(([k,a])=>({k,v:med(a),n:a.length})).sort((a,b)=>b.v-a.v);
  if(!rows.length)return '';
  const mx=Math.max(8,...rows.map(r=>Math.abs(r.v)));
  const col=v=>{const a=Math.min(1,Math.abs(v)/mx)*.75+.1;return v>=0?`rgba(18,160,90,${a})`:`rgba(220,60,60,${a})`};
  return `<div class="card"><h3>Sector heatmap<span class="mut" style="font-weight:400;font-size:12px">median 1-month return by industry · click to open in screener</span></h3><div class="heat">${rows.map(r=>`<a class="ht" data-ind="${esc(r.k)}" style="background:${col(r.v)}"><b>${esc(r.k)}</b><span>${r.v>=0?'+':''}${T.fmt(r.v,1)}%</span><small>${r.n} stocks</small></a>`).join('')}</div></div>`;
}
document.addEventListener('click',e=>{const a=e.target.closest&&e.target.closest('.ht');if(a){FILT.ind=a.dataset.ind;FILT.q='';FILT.rel='all';location.hash='#/screener'}});

async function marketLegacy(){
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
    ${heat()}
    <div class="two">${list('Top 1M returns (traded > Rs 5 cr/day)',top('ret_1m'))}${list('Bottom 1M returns',top('ret_1m',true))}${list('Most oversold (RSI)',top('rsi14',true))}${list('Most overbought (RSI)',top('rsi14'))}</div>
    <p class="mut">Click any stock for its full page. ${D.syms.length} stocks in universe.</p>`;
  if(b.length){const x=b.map(r=>r.Date);
    lineChart($('#c1'),[{name:'200d',x,y:b.map(r=>T.num(r.pct_above_200dma))},{name:'50d',x,y:b.map(r=>T.num(r.pct_above_50dma))}],{dec:0});
    lineChart($('#c2'),[{name:'high',x,y:b.map(r=>T.num(r.pct_new_52w_high))},{name:'low',x,y:b.map(r=>T.num(r.pct_new_52w_low))}],{dec:1})}
}

// ---------- market health (home) ----------
const MH={data:null,range:'1Y',mode:'count',sort:{k:'r1m',d:-1},charts:[]};
const RANGES={'1M':22,'3M':64,'6M':127,'1Y':253,'5Y':1261,'MAX':1e9};
const fMon=d=>new Date(d+'T00:00:00').toLocaleDateString('en-GB',{month:'short',year:'2-digit'});
const fDay=d=>new Date(d+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
function mcol(){const c=getComputedStyle(document.documentElement),g=n=>c.getPropertyValue(n).trim();return {g:g('--g')||'#127a45',r:g('--r')||'#c62828',m:g('--m')||'#667085',p:g('--p')||'#fff',t:g('--t')||'#18202b',b:g('--brand')||'#0f6b4a'}}
function mchart(cv,spec,anim){
  const C=mcol(),dpr=window.devicePixelRatio||1,w=cv.clientWidth,h=cv.clientHeight;if(!w||!h)return;
  cv.width=w*dpr;cv.height=h*dpr;const ctx=cv.getContext('2d');
  const x=spec.x,n=x.length,L=4,R=10,Tp=10,B=20,lay=spec.layers;if(!n)return;
  const val=lay.map(l=>l.y.map(v=>v==null?null:(l.neg?-v:v)));
  let cum=null;
  if(spec.stack){let acc=new Array(n).fill(0);cum=val.map(a=>{const lo=acc,hi=acc.map((s,j)=>s+(a[j]||0));acc=hi;return {lo,hi}})}
  let lo=Infinity,hi=-Infinity;
  const upd=v=>{if(v!=null&&isFinite(v)){lo=Math.min(lo,v);hi=Math.max(hi,v)}};
  if(cum)cum.forEach(c=>{c.hi.forEach(upd);c.lo.forEach(upd)});else val.forEach(a=>a.forEach(upd));
  if(lay.some(l=>l.type==='bars')||spec.zero||spec.stack)upd(0);
  if(!isFinite(lo)){lo=0;hi=1}if(lo===hi){lo-=1;hi+=1}const pad=(hi-lo)*.08;if(!(spec.stack&&lo===0))lo-=pad;hi+=pad;
  const X=i=>L+(w-L-R)*(n<2?.5:i/(n-1)),Y=v=>Tp+(h-Tp-B)*(1-(v-lo)/(hi-lo));
  const first=(a)=>{for(const v of a)if(v!=null)return v;return 0},lastv=a=>{for(let i=a.length-1;i>=0;i--)if(a[i]!=null)return a[i];return 0};
  const base=spec.zero?0:first(val[0]);
  const up=lastv(val[0])>=first(val[0]);
  let hov=null;
  function draw(prog,hv){
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.font='11px system-ui,sans-serif';
    ctx.fillStyle=C.m;[0,.34,.67,1].forEach((f,k)=>{const i=Math.round((n-1)*f),t=fMon(x[i]);const tw=ctx.measureText(t).width;ctx.fillText(t,Math.max(2,Math.min(X(i)-tw/2,w-tw-2)),h-5)});
    ctx.save();ctx.beginPath();ctx.rect(0,0,L+(w-L)*prog+2,h);ctx.clip();
    if(!spec.stack){ctx.strokeStyle=C.m;ctx.globalAlpha=.5;ctx.setLineDash([3,3]);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(L,Math.round(Y(base))+.5);ctx.lineTo(w-R,Math.round(Y(base))+.5);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1}
    lay.forEach((l,li)=>{
      const col=l.color||(spec.auto?(up?C.g:C.r):C.b),a=val[li];
      if(spec.stack){const c=cum[li];ctx.beginPath();let s=false;for(let i=0;i<n;i++){const y=Y(c.hi[i]);s?ctx.lineTo(X(i),y):ctx.moveTo(X(i),y);s=true}for(let i=n-1;i>=0;i--)ctx.lineTo(X(i),Y(c.lo[i]));ctx.closePath();ctx.globalAlpha=.8;ctx.fillStyle=col;ctx.fill();ctx.globalAlpha=1;return}
      if(l.type==='bars'){const bw=Math.max(1,(w-L-R)/n*.78);for(let i=0;i<n;i++){const v=a[i];if(v==null)continue;ctx.fillStyle=l.color||(v>=0?C.g:C.r);const y0=Y(0),y1=Y(v);ctx.fillRect(X(i)-bw/2,Math.min(y0,y1),bw,Math.max(1,Math.abs(y1-y0)))}return}
      if(l.type==='area'){const g=ctx.createLinearGradient(0,Tp,0,h-B);g.addColorStop(0,col+'40');g.addColorStop(1,col+'05');ctx.beginPath();let st=false,fi=-1,la=-1;a.forEach((v,i)=>{if(v==null)return;if(!st){ctx.moveTo(X(i),Y(v));st=true;fi=i}else ctx.lineTo(X(i),Y(v));la=i});if(st){ctx.lineTo(X(la),Y(base));ctx.lineTo(X(fi),Y(base));ctx.closePath();ctx.fillStyle=g;ctx.fill()}}
      ctx.strokeStyle=col;ctx.lineWidth=1.6;ctx.lineJoin='round';ctx.beginPath();let s2=false;a.forEach((v,i)=>{if(v==null)return;s2?ctx.lineTo(X(i),Y(v)):ctx.moveTo(X(i),Y(v));s2=true});ctx.stroke();
    });
    ctx.restore();
    if(prog>=1){lay.forEach((l,li)=>{if(l.type==='bars'||spec.stack)return;const a=val[li];let i=n-1;while(i>0&&a[i]==null)i--;if(a[i]==null)return;ctx.beginPath();ctx.arc(X(i),Y(a[i]),3.2,0,7);ctx.fillStyle=l.color||(spec.auto?(up?C.g:C.r):C.b);ctx.fill()})}
    if(hv!=null&&prog>=1){const xx=X(hv);ctx.strokeStyle=C.m;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(xx,Tp);ctx.lineTo(xx,h-B);ctx.stroke();ctx.setLineDash([]);
      const rows=lay.map((l,li)=>({n:l.name||'',v:l.y[hv],c:l.color||(spec.auto?(up?C.g:C.r):C.b)})).filter(r=>r.v!=null);
      const f=spec.fmt||(v=>T.fmt(v,spec.dec??0));const lines=[fDay(x[hv])].concat(rows.map(r=>(r.n?r.n+'  ':'')+f(r.v)));
      ctx.font='12px system-ui,sans-serif';const bw=Math.max(...lines.map(t=>ctx.measureText(t).width))+18,bh=10+lines.length*16;let bx=xx+10;if(bx+bw>w-2)bx=xx-10-bw;bx=Math.max(2,bx);
      ctx.fillStyle=C.p;ctx.strokeStyle='rgba(139,148,163,.5)';ctx.beginPath();ctx.roundRect?ctx.roundRect(bx,Tp,bw,bh,7):ctx.rect(bx,Tp,bw,bh);ctx.fill();ctx.stroke();
      lines.forEach((t,k)=>{ctx.fillStyle=k?(rows[k-1].c):C.t;ctx.font=(k?'12px':'bold 12px')+' system-ui,sans-serif';ctx.fillText(t,bx+9,Tp+15+k*16)})}
  }
  const reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(anim&&!reduce){const t0=performance.now();(function st(t){const p=Math.min(1,(t-t0)/600);draw(1-Math.pow(1-p,3),null);if(p<1&&cv.isConnected)requestAnimationFrame(st)})(t0)}else draw(1,null);
  const at=e=>{const r=cv.getBoundingClientRect(),px=(e.touches?e.touches[0].clientX:e.clientX)-r.left;hov=Math.min(n-1,Math.max(0,Math.round((px-L)/(w-L-R)*(n-1))));draw(1,hov)};
  cv.onpointermove=at;cv.onpointerdown=at;cv.onpointerleave=()=>draw(1,null);
}
function mcard(id,title,o={}){
  const leg=o.legend?`<div class="ml">${o.legend.map(l=>`<span><i style="background:${l.c}"></i>${l.n} <b>${l.v}</b></span>`).join('')}</div>`:'';
  return `<div class="mc ${o.span?'s'+o.span:''}"><div class="mt">${title}</div>${o.big!=null?`<div class="mb"><span class="mv">${o.big}</span>${o.delta?`<span class="md ${o.dcls||''}">${o.delta}</span>`:''}</div>`:''}${leg}<canvas id="${id}" style="height:${o.h||150}px"></canvas></div>`}

async function market(){
  const data=await get('data/market_health.json','json');
  if(!data){const lg=await marketLegacy();view.insertAdjacentHTML('afterbegin','<div class="card"><h3>Market Health</h3><span class="mut">Run the Daily refresh once (it now includes compute_market_health.py) to unlock the grouped market dashboard.</span></div>');return lg}
  try{const ic=await get('data/industry.csv');D.ind={};if(ic)T.parseCSV(ic).forEach(r=>{if(r.symbol)D.ind[r.symbol]=r})}catch(e){D.ind={}}
  MH.data=data;renderMarket(true);
}
function renderMarket(anim){
  const d=MH.data,S=d.series,N=RANGES[MH.range],pm=false,C=mcol();
  const W=a=>a.slice(Math.max(0,a.length-N)),X=W(d.dates);
  const last=a=>{for(let i=a.length-1;i>=0;i--)if(a[i]!=null)return a[i];return null},first=a=>{for(const v of a)if(v!=null)return v;return null};
  const den=(k)=>typeof k==='string'?W(S[k]):W(k);
  const ser=(num,dn)=>{const a=W(S[num]);if(!pm||!dn)return a;const q=den(dn);return a.map((v,i)=>v==null||!q[i]?null:v/q[i]*100)};
  const sgn=(v,dd=0,suf='')=>v==null?'–':(v>=0?'+':'')+T.fmt(v,dd)+suf;
  const stTot=S.st1.map((v,i)=>(S.st1[i]||0)+(S.st2[i]||0)+(S.st3[i]||0)+(S.st4[i]||0));
  const specs=[];let h='';
  const sec=(id,title,sub)=>`<h2 class="sec" id="sec-${id}">${title}${sub?`<small>${sub}</small>`:''}</h2>`;
  const area=(id,title,arr,o={})=>{const l=last(arr),f=first(arr),dd=l!=null&&f!=null?l-f:null,pu=pm?'%':'';
    h+=mcard(id,title,{big:l==null?'–':T.fmt(l,o.dec??(pm?1:0))+pu,delta:o.noDelta?'':(dd==null?'':sgn(dd,o.dec??(pm?1:0),pm?' pts':'')),dcls:cls(dd),h:o.h});
    specs.push({id,x:X,layers:[{y:arr,type:'area',name:o.name||''}],auto:true,dec:o.dec??(pm?1:0),fmt:pm?(v=>T.fmt(v,1)+'%'):null})};
  const two=(id,title,upk,dnk,dn,upName='Up',dnName='Down',o={})=>{const a=ser(upk,dn),b=ser(dnk,dn),pu=pm?'%':'',dec=pm?1:0;
    h+=mcard(id,title,{legend:[{c:C.g,n:upName,v:T.fmt(last(a),dec)+pu},{c:C.r,n:dnName,v:T.fmt(last(b),dec)+pu}],h:o.h});
    specs.push({id,x:X,layers:[{y:a,type:o.bars?'bars':'line',color:C.g,name:upName},{y:b,type:o.bars?'bars':'line',color:C.r,name:dnName,neg:!!o.neg}],dec,fmt:pm?(v=>T.fmt(v,1)+'%'):null,zero:!!o.bars})};

  // 1 indices
  if(d.indices.length){h+=sec('idx','Indices',d.real_indices?'':'built from our own stock universe, not official Nifty indices')+'<div class="mh-grid">';
    const IXO=['Nifty 50','Bank Nifty','Sensex','Nifty Midcap 150','Nifty Smallcap 250','Nifty 500'],ixr=n=>{const k=IXO.findIndex(x=>n.startsWith(x.replace('Nifty ','').replace(' 150','').replace(' 250',''))||n===x);return k<0?99:k};
    d.indices.slice().sort((a,b)=>{const f=n=>{const i=IXO.indexOf(n);return i<0?(/mid cap/i.test(n)?3:/small cap/i.test(n)?4:99):i};return f(a.name)-f(b.name)}).forEach((ix,i)=>{const a=W(ix.y),l=last(a),f=first(a),ch=l!=null&&f?(l/f-1)*100:null;
      h+=mcard('ix'+i,ix.name,{big:l==null?'–':T.fmt(l,ix.real?0:1),delta:ch==null?'':sgn(ch,1,'%'),dcls:cls(ch)});
      specs.push({id:'ix'+i,x:X,layers:[{y:a,type:'area'}],auto:true,dec:ix.real?0:1})});h+='</div>'}

  // sector heatmap
  {h+=sec('ind','Sector heatmap','block size = market cap, colour = market-cap-weighted return over the chosen period');
   h+='<div id="hmwrap"></div>'}

  // top gainers and losers
  {h+=sec('gl','Top gainers and losers','by index and time frame · from daily closes')+'<div id="glbox"></div>'}

  const chips=[['idx','Indices'],['ind','Sector heatmap'],['gl','Gainers & losers']];
  const bar=`<div class="mh-bar"><div class="chips">${chips.map(c=>`<a data-s="sec-${c[0]}">${c[1]}</a>`).join('')}</div>
   <div class="seg" id="mh-range">${Object.keys(RANGES).map(k=>`<button data-r="${k}" class="${MH.range===k?'on':''}">${k}</button>`).join('')}</div></div>
   <div class="mut" style="font-size:12px;margin:-4px 0 6px">${d.n_stocks} stocks · data to ${esc(d.last_date)} · from daily closes</div>`;
  view.innerHTML=bar+h;
  // wire
  document.querySelectorAll('#mh-range button').forEach(b=>b.onclick=()=>{MH.range=b.dataset.r;renderMarket(true)});
  document.querySelectorAll('.mh-bar .chips a').forEach(a=>a.onclick=()=>{const el=document.getElementById(a.dataset.s);if(el)el.scrollIntoView({behavior:'smooth',block:'start'})});
  document.querySelectorAll('tr.ind').forEach(tr=>tr.onclick=()=>{FILT.ind=tr.dataset.ind;FILT.q='';FILT.rel='all';location.hash='#/screener'});
  MH.charts=specs;specs.forEach(sp=>{const cv=document.getElementById(sp.id);if(cv)mchart(cv,sp,anim)});
  try{glPanel()}catch(e){}
  try{heatmapPanel()}catch(e){const w=$('#hmwrap');if(w)w.innerHTML='<div class="card"><p class="mut">Heatmap needs the latest market data. Run the Daily refresh once.</p></div>'}
  countUps(view);
}
let _rz;window.addEventListener('resize',()=>{clearTimeout(_rz);_rz=setTimeout(()=>{if(document.getElementById('hmbox'))try{hmDraw()}catch(e){}
    if(MH.data&&(location.hash===''||location.hash==='#/market'))MH.charts.forEach(sp=>{const cv=document.getElementById(sp.id);if(cv)mchart(cv,sp,false)})},150)});

// ---------- top gainers and losers ----------
const GL={ix:'nifty50',tf:'r1d'};
const GL_IX=[['nifty50','Nifty 50'],['midcap150','Midcap 150'],['smallcap250','Smallcap 250'],['microcap250','Microcap 250']];
const GL_TF=[['r1d','1D'],['r1w','1W'],['r1m','1M'],['r3m','3M']];
async function glPanel(){
  const box=$('#glbox');if(!box)return;
  const mem=await get('data/index_members.json','json');
  if(!mem){box.innerHTML='<div class="card"><p class="mut">Index lists are not built yet. Run the Daily refresh once (step 5d).</p></div>';return}
  const IXS=GL_IX.filter(x=>mem[x[0]]&&mem[x[0]].length);if(!IXS.some(x=>x[0]===GL.ix))GL.ix=IXS.length?IXS[0][0]:GL.ix;
  const P=await get('data/peers.json','json');
  const nm={},px={};if(P&&P.stocks)P.stocks.forEach(x=>{nm[x.s]=x.n;px[x.s]=x.px});
  const by={};(MH.data.stocks||[]).forEach(x=>by[x.s]=x);
  const draw=()=>{
    const set=new Set(mem[GL.ix]||[]);
    const rows=[...set].map(s=>by[s]&&by[s].r&&by[s].r[GL.tf]!=null?{s,r:by[s].r[GL.tf],mc:by[s].mc}:null).filter(Boolean).sort((a,b)=>b.r-a.r);
    const top=rows.slice(0,10),bot=rows.slice(-10).reverse();
    const tb=a=>`<table class="peer"><thead><tr><th>Stock</th><th class="num">Price ₹</th><th class="num">Return</th></tr></thead><tbody>${a.map(r=>`<tr class="row" onclick="location.hash='#/stock/${esc(r.s)}'"><td><b>${esc(r.s)}</b><div class="mut" style="font-size:11px">${esc((nm[r.s]||'').slice(0,28))} · ${capOf(r.mc).split(' ')[0]}</div></td><td class="num">${px[r.s]!=null?T.fmt(px[r.s],1):'–'}</td><td class="num ${cls(r.r)}">${r.r>=0?'+':''}${T.fmt(r.r,2)}%</td></tr>`).join('')}</tbody></table>`;
    const src=(mem.source||{})[GL.ix]==='NSE'?'official NSE constituent list':'approximated by market-cap rank (NSE list not available)';
    box.innerHTML=`<div class="card"><div class="seg" id="gl-ix" style="margin:0 0 8px">${IXS.map(([k,l])=>`<button data-k="${k}" class="${GL.ix===k?'on':''}">${l}</button>`).join('')}</div>
      <div class="seg" id="gl-tf" style="margin:0 0 12px">${GL_TF.map(([k,l])=>`<button data-k="${k}" class="${GL.tf===k?'on':''}">${l}</button>`).join('')}</div>
      <div class="two"><div><h3 style="margin:0 0 6px">Top gainers</h3>${tb(top)}</div><div><h3 style="margin:0 0 6px">Top losers</h3>${tb(bot)}</div></div>
      <p class="mut" style="font-size:12px;margin:10px 0 0">${rows.length} stocks in ${esc(IXS.find(x=>x[0]===GL.ix)[1])} with data · ${src} · returns are price returns to the last close.</p></div>`;
    box.querySelectorAll('#gl-ix button').forEach(b=>b.onclick=()=>{GL.ix=b.dataset.k;draw()});
    box.querySelectorAll('#gl-tf button').forEach(b=>b.onclick=()=>{GL.tf=b.dataset.k;draw()});
  };
  draw();
}

// ---------- treemap heatmap ----------
const HM={tf:'r1m',level:'sector',drill:null};
const HM_TF=[['r1d','1D'],['r1w','1W'],['r1m','1M'],['r3m','3M'],['r6m','6M'],['r1y','1Y']];
const HM_SC={r1d:3,r1w:5,r1m:10,r3m:18,r6m:28,r1y:45};
const HM_LV=[['macro','NSE group'],['sector','Sector'],['industry','Industry'],['basic_industry','Basic industry']];
function squarify(items,x,y,w,h){
  const tot=items.reduce((a,b)=>a+b.v,0);if(!tot||w<=0||h<=0)return [];
  const sc=w*h/tot,it=items.map(i=>Object.assign({},i,{a:i.v*sc})),out=[];let rect={x,y,w,h},row=[],i=0;
  const worst=(r,s)=>{const t=r.reduce((a,b)=>a+b.a,0);let mx=0,mn=1e18;r.forEach(q=>{mx=Math.max(mx,q.a);mn=Math.min(mn,q.a)});return Math.max(s*s*mx/(t*t),t*t/(s*s*mn))};
  const lay=(r,rc)=>{const t=r.reduce((a,b)=>a+b.a,0);
    if(rc.w>=rc.h){const cw=t/rc.h;let yy=rc.y;r.forEach(q=>{const hh=q.a/cw;out.push(Object.assign({},q,{x:rc.x,y:yy,w:cw,h:hh}));yy+=hh});return {x:rc.x+cw,y:rc.y,w:rc.w-cw,h:rc.h}}
    const ch=t/rc.w;let xx=rc.x;r.forEach(q=>{const ww=q.a/ch;out.push(Object.assign({},q,{x:xx,y:rc.y,w:ww,h:ch}));xx+=ww});return {x:rc.x,y:rc.y+ch,w:rc.w,h:rc.h-ch}};
  while(i<it.length){const side=Math.min(rect.w,rect.h),n=row.concat([it[i]]);if(!row.length||worst(row,side)>=worst(n,side)){row=n;i++}else{rect=lay(row,rect);row=[]}}
  if(row.length)lay(row,rect);return out;
}
function hmColor(r,tf){if(r==null)return ['var(--bg)','var(--m)'];const a=Math.min(1,Math.abs(r)/HM_SC[tf]),al=.18+.72*a;
  return [r>=0?`rgba(31,157,98,${al})`:`rgba(214,69,65,${al})`,a>.55?'#fff':'var(--t)']}
function hmGroups(){
  const d=MH.data,lv=HM.level,ind=D.ind||{},have=Object.keys(ind).length>0;
  const g={};
  (d.stocks||[]).forEach(s=>{const r=s.r[HM.tf];if(r==null)return;
    let name;if(have&&ind[s.s]&&ind[s.s][lv])name=ind[s.s][lv];else if(!have||lv==='industry'||lv==='sector')name=((D.uni.find(u=>u.symbol===s.s)||{}).industry)||'Other';else return;
    if(!name)name='Other';(g[name]=g[name]||[]).push(Object.assign({},s,{ret:r}))});
  return Object.entries(g).map(([name,a])=>{const mc=a.reduce((x,y)=>x+y.mc,0),w=a.reduce((x,y)=>x+y.mc*y.ret,0)/mc,sr=a.map(x=>x.ret).sort((x,y)=>x-y),m=sr.length>>1;
    return {name,v:mc,ret:w,med:sr.length%2?sr[m]:(sr[m-1]+sr[m])/2,n:a.length,stocks:a}}).sort((a,b)=>b.v-a.v);
}
function heatmapPanel(){
  const w=$('#hmwrap');if(!w)return;
  const have=D.ind&&Object.keys(D.ind).length>0;
  const lvs=HM_LV.filter(([k])=>have&&Object.values(D.ind).some(r=>r[k]));
  if(!have&&['macro','basic_industry'].includes(HM.level))HM.level='sector';
  if(have&&lvs.length&&!lvs.some(([k])=>k===HM.level))HM.level=lvs[0][0];
  w.innerHTML=`<div class="hmbar"><div class="seg" id="hm-tf">${HM_TF.map(([k,l])=>`<button data-k="${k}" class="${HM.tf===k?'on':''}">${l}</button>`).join('')}</div>
   ${have?`<div class="seg" id="hm-lv">${lvs.map(([k,l])=>`<button data-k="${k}" class="${HM.level===k?'on':''}">${l}</button>`).join('')}</div>`:'<span class="mut" style="font-size:12px">Using the basic industry tag. Run <b>Fetch industry classification</b> in Actions for NSE sectors.</span>'}
   <span class="hmcrumb" id="hm-crumb"></span></div>
   <div id="hmbox" class="hmbox"></div>
   <div class="hmleg"><span>−${HM_SC[HM.tf]}%</span><i></i><span>0</span><i class="g"></i><span>+${HM_SC[HM.tf]}%</span><em class="mut">Returns use the latest close vs the close ${({r1d:'one trading day',r1w:'7 days',r1m:'one month',r3m:'three months',r6m:'six months',r1y:'one year'})[HM.tf]} earlier. Group return is weighted by market cap.</em></div>`;
  $('#hm-tf').querySelectorAll('button').forEach(b=>b.onclick=()=>{HM.tf=b.dataset.k;heatmapPanel()});
  const lv=$('#hm-lv');if(lv)lv.querySelectorAll('button').forEach(b=>b.onclick=()=>{HM.level=b.dataset.k;HM.drill=null;heatmapPanel()});
  hmDraw();
}
function hmDraw(){
  const box=$('#hmbox');if(!box)return;
  const W=box.clientWidth,Hh=W<600?460:600;box.style.height=Hh+'px';
  let items,drill=HM.drill,tf=HM.tf;
  const groups=hmGroups();
  if(drill){const g=groups.find(x=>x.name===drill);if(!g){HM.drill=null;drill=null}}
  const crumb=$('#hm-crumb');
  if(drill){const g=groups.find(x=>x.name===drill);
    items=g.stocks.map(s=>({name:s.s,v:s.mc,ret:s.ret,stock:s.s,mc:s.mc}));
    crumb.innerHTML=`<a id="hm-back">← All</a> <b>${esc(drill)}</b> <a href="#/sector/${HM.level}/${encodeURIComponent(drill)}" style="margin:0 6px">Open page →</a> <span class="mut">${g.n} stocks · ${T.pct(g.ret,1)} weighted · ${T.pct(g.med,1)} median</span>`;
    crumb.querySelector('#hm-back').onclick=()=>{HM.drill=null;hmDraw()}}
  else{items=groups.map(g=>({name:g.name,v:g.v,ret:g.ret,n:g.n,med:g.med}));crumb.innerHTML=`<span class="mut">Click a block to see its stocks</span>`}
  items=items.filter(i=>i.v>0).sort((a,b)=>b.v-a.v);
  // in a stock view, keep the biggest names readable and fold the long tail into one block
  const CAP=W<600?24:40;
  if(drill&&items.length>CAP+3){const rest=items.slice(CAP),tv=rest.reduce((x,y)=>x+y.v,0);
    items=items.slice(0,CAP).concat([{name:'Other '+rest.length+' stocks',v:tv,ret:rest.reduce((x,y)=>x+y.v*y.ret,0)/tv,other:true,n:rest.length}])}
  const rects=squarify(items,0,0,W,Hh);
  box.innerHTML=rects.map((r,i)=>{const [bg,fg]=hmColor(r.ret,tf),big=r.w>110&&r.h>64,mid=r.w>70&&r.h>46;
    return `<div class="hmt${r.other?' oth':''}" data-i="${i}" style="--s:${(1+Math.min(.09,18/Math.max(r.w,r.h))).toFixed(4)};left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;animation-delay:${Math.min(i*12,400)}ms"><div style="background:${bg};color:${fg}">${mid?`<b>${esc(r.name)}</b><span>${T.pct(r.ret,1)}</span>${big&&!r.stock&&!r.other?`<small>${r.n} stocks</small>`:''}`:''}</div></div>`}).join('')+'<div id="hmtip" class="hmtip"></div>';
  const tip=$('#hmtip');
  const tipTxt=r=>r.stock?`<b>${esc(r.name)}</b><br>${T.pct(r.ret,2)} · ₹${T.fmt(r.mc,0)} cr`:r.other?`<b>${esc(r.name)}</b><br>${T.pct(r.ret,2)} weighted`:`<b>${esc(r.name)}</b><br>${T.pct(r.ret,2)} weighted · ${T.pct(r.med,2)} median<br>${r.n} stocks`;
  const pop=document.createElement('div');pop.className='hmpop';box.appendChild(pop);
  if(!window.__hmScroll){window.__hmScroll=1;addEventListener('scroll',()=>{const t=document.getElementById('hmtip'),q=document.querySelector('.hmpop');if(t)t.style.opacity=0;if(q)q.classList.remove('on')},{passive:true})}
  box.querySelectorAll('.hmt').forEach(el=>{const r=rects[+el.dataset.i],tiny=!(r.w>70&&r.h>46);
    el.onmouseenter=()=>{
      if(tiny){const [bg,fg]=hmColor(r.ret,tf),pw=Math.max(172,r.w),ph=Math.max(86,r.h);
        let px=r.x+r.w/2-pw/2,py=r.y+r.h/2-ph/2;px=Math.max(0,Math.min(W-pw,px));py=Math.max(0,Math.min(Hh-ph,py));
        pop.style.cssText=`left:${px}px;top:${py}px;width:${pw}px;height:${ph}px;background:linear-gradient(${bg},${bg}),var(--p);color:${fg}`;
        pop.innerHTML=`<b>${esc(r.name)}</b><span>${T.pct(r.ret,1)}</span><small>${r.stock?'₹'+T.fmt(r.mc,0)+' cr':(r.n||'')+' stocks'}</small>`;
        pop.classList.add('on');tip.style.opacity=0}
      else{pop.classList.remove('on');tip.innerHTML=tipTxt(r);tip.style.opacity=1}};
    el.onmousemove=e=>{if(tiny)return;const b=box.getBoundingClientRect();let x=e.clientX-b.left+14,y=e.clientY-b.top+14;if(x>W-170)x=e.clientX-b.left-170;tip.style.left=x+'px';tip.style.top=y+'px'};
    el.onmouseleave=()=>{tip.style.opacity=0;pop.classList.remove('on')};
    el.onclick=()=>{if(r.other)return;if(r.stock)location.hash='#/stock/'+r.stock;else{HM.drill=r.name;hmDraw()}}});
}

// ---------- peers ----------
const PR={lvl:null,sort:'mc',dir:-1};
const PCOLS=[['mc','Mkt cap ₹cr',0,'x'],['pe','P/E',1,'x'],['pb','P/B',2,'x'],['ev','EV/EBITDA',1,'x'],['roe','ROE %',1,''],['roce','ROCE %',1,''],['nm','Net margin %',1,''],['rg','Rev CAGR %',1,''],['r1y','1Y return %',1,'']];
const PLV=[['ind','Industry'],['sec','Sector'],['macro','NSE group']];
const medOf=a=>{a=a.filter(v=>v!=null&&isFinite(v)).sort((x,y)=>x-y);if(!a.length)return null;const m=a.length>>1;return a.length%2?a[m]:(a[m-1]+a[m])/2};
async function peersTab(s){
  const box=$('#peerbody');if(!box)return;
  const P=await get('data/peers.json','json');
  if(!P||!P.stocks){box.innerHTML='<div class="card"><p class="mut">Peer data not built yet. Run the Daily refresh once.</p></div>';return}
  const me=P.stocks.find(x=>x.s===s);
  if(!me){box.innerHTML='<div class="card"><p class="mut">This stock is not in the peer table.</p></div>';return}
  const members=lv=>P.stocks.filter(x=>x[lv]&&x[lv]===me[lv]);
  if(!PR.lvl||!members(PR.lvl).length)PR.lvl='ind';
  if(members(PR.lvl).length<4){const alt=PLV.map(x=>x[0]).find(l=>members(l).length>=4);if(alt)PR.lvl=alt}
  const draw=()=>{
    const g=members(PR.lvl),name=me[PR.lvl];
    const num=v=>v!=null&&isFinite(v);
    const rows=g.slice().sort((a,b)=>{const x=a[PR.sort],y=b[PR.sort];if(!num(x)&&!num(y))return 0;if(!num(x))return 1;if(!num(y))return -1;return (x-y)*PR.dir});
    const cols=PCOLS.filter(c=>c[0]==='mc'||g.filter(x=>num(x[c[0]])).length>=Math.max(2,g.length*0.3));
    const has=k=>cols.some(c=>c[0]===k);
    const med={};PCOLS.forEach(c=>med[c[0]]=medOf(g.map(x=>x[c[0]])));
    // cap-weighted P/E and P/B (total cap / total earnings)
    const wv=(k)=>{let mc=0,e=0;g.forEach(x=>{if(num(x.mc)&&num(x[k])&&x[k]>0){mc+=x.mc;e+=x.mc/x[k]}});return e?mc/e:null};
    const rank=(k,hi)=>{const v=me[k];if(!num(v))return '–';const a=g.filter(x=>num(x[k])).map(x=>x[k]).sort((p,q)=>hi?q-p:p-q);return (a.indexOf(v)+1)+' of '+a.length};
    const prem=(k)=>{const v=me[k],m=med[k];if(!num(v)||!num(m)||!m)return '';const p=(v/m-1)*100;return `<span class="${p>0?'neg':'pos'}" style="font-size:12px">${p>=0?'+':''}${T.fmt(p,0)}% vs median</span>`};
    const tl=(k,l,d,hi)=>`<div class="tile"><div class="k">${l}</div><div class="tv">${num(me[k])?T.fmt(me[k],d):'–'}</div><div class="k" style="margin-top:2px">Median ${num(med[k])?T.fmt(med[k],d):'–'} · rank ${rank(k,hi)}</div></div>`;
    const cell=(r,c)=>{const v=r[c[0]];return `<td class="num ${PR.sort===c[0]?'sorted':''}">${num(v)?T.fmt(v,c[2]):'–'}${c[0]==='mc'&&num(v)?` <small class="mut">${capOf(v).split(' ')[0]}</small>`:''}</td>`};
    box.innerHTML=`<div class="card"><h3>Peers · ${esc(name)} <span class="mut" style="font-weight:400;font-size:12px">${g.length} stocks · <a href="#/sector/${PR.lvl}/${encodeURIComponent(name)}">Open ${esc(name)} page →</a></span>
       <span class="seg" id="plv" style="margin-left:auto">${PLV.filter(l=>members(l[0]).length>=2).map(l=>`<button data-k="${l[0]}" class="${PR.lvl===l[0]?'on':''}">${l[1]}</button>`).join('')}</span></h3>
      <div class="mtiles">${has('pe')?tl('pe','P/E',1,false):''}${has('pb')?tl('pb','P/B',2,false):''}${has('ev')?tl('ev','EV/EBITDA',1,false):''}${has('roe')?tl('roe','ROE %',1,true):''}${has('roce')?tl('roce','ROCE %',1,true):''}${has('rg')?tl('rg','Revenue CAGR %',1,true):''}</div>
      <p class="mut" style="font-size:12.5px;margin:10px 0 0">${esc(s)} P/E ${num(me.pe)?T.fmt(me.pe,1)+'x':'–'} ${prem('pe')} · P/B ${num(me.pb)?T.fmt(me.pb,2)+'x':'–'} ${prem('pb')} · group weighted P/E ${num(wv('pe'))?T.fmt(wv('pe'),1)+'x':'–'}, weighted P/B ${num(wv('pb'))?T.fmt(wv('pb'),2)+'x':'–'}.
      Rank 1 is the highest for ROE, ROCE and growth, and the cheapest for the multiples.</p></div>
     <div class="card" style="overflow-x:auto"><table class="peer"><thead><tr><th>Company</th>${cols.map(c=>`<th class="num sortable ${PR.sort===c[0]?'sorted':''}" data-k="${c[0]}">${c[1]}${PR.sort===c[0]?(PR.dir<0?' ▼':' ▲'):''}</th>`).join('')}</tr></thead><tbody>
      ${rows.map(r=>`<tr class="${r.s===s?'me':''}" data-s="${esc(r.s)}"><td><b>${esc(r.s)}</b><div class="k">${esc(r.n)}</div></td>${cols.map(c=>cell(r,c)).join('')}</tr>`).join('')}
      <tr class="medrow"><td><b>Median</b></td>${cols.map(c=>`<td class="num">${num(med[c[0]])?T.fmt(med[c[0]],c[2]):'–'}</td>`).join('')}</tr></tbody></table></div>
     <p class="mut" style="font-size:12px">Groups come from Yahoo Finance industry tags (the NSE group is shown as a wider fallback). Multiples are for the latest financial year. Negative or missing values are left out of medians. Columns that do not apply to most of the group (for example EV/EBITDA for banks) are hidden. Revenue CAGR can be distorted by mergers.</p>`;
    box.querySelectorAll('#plv button').forEach(b=>b.onclick=()=>{PR.lvl=b.dataset.k;draw()});
    box.querySelectorAll('th.sortable').forEach(th=>th.onclick=()=>{const k=th.dataset.k;if(PR.sort===k)PR.dir*=-1;else{PR.sort=k;PR.dir=-1}draw()});
    box.querySelectorAll('tbody tr[data-s]').forEach(tr=>tr.onclick=()=>{location.hash='#/stock/'+tr.dataset.s+'/peers'});
  };
  draw();
}

// ---------- sector / industry page ----------
const SR={sort:'mc',dir:-1};
async function sectorPage(lv,name){
  view.innerHTML=SKEL;
  const P=await get('data/peers.json','json');
  if(!P||!P.stocks){view.innerHTML='<div class="card"><p class="mut">Peer data not built yet. Run the Daily refresh once.</p></div>';return}
  const num=v=>v!=null&&isFinite(v);
  const g=P.stocks.filter(x=>x[lv]===name),all=P.stocks.filter(x=>num(x.mc));
  if(!g.length){view.innerHTML=`<div class="crumb"><a href="#/market">Market Overview</a></div><div class="card"><p class="mut">No stocks found for ${esc(name)}.</p></div>`;return}
  const tot=all.reduce((a,x)=>a+x.mc,0),gm=g.reduce((a,x)=>a+(num(x.mc)?x.mc:0),0);
  const wv=k=>{let mc=0,e=0;g.forEach(x=>{if(num(x.mc)&&num(x[k])&&x[k]>0){mc+=x.mc;e+=x.mc/x[k]}});return e?mc/e:null};
  const wr=k=>{let m=0,s=0;g.forEach(x=>{if(num(x.mc)&&num(x[k])){m+=x.mc;s+=x.mc*x[k]}});return m?s/m:null};
  const withT=g.filter(x=>x.a200!=null),a200=withT.length?withT.filter(x=>x.a200===1).length/withT.length*100:null;
  const lvName={ind:'Industry',sec:'Sector',macro:'NSE group'}[lv]||'Group';
  const tl=(k,v,sub)=>`<div class="tile"><div class="k">${k}</div><div class="tv">${v}</div>${sub?`<div class="k" style="margin-top:2px">${sub}</div>`:''}</div>`;
  const f=(v,d,s='')=>num(v)?T.fmt(v,d)+s:'–';
  const pc=v=>num(v)?`<span class="${cls(v)}">${v>=0?'+':''}${T.fmt(v,1)}%</span>`:'–';
  // parent groups for context
  const first=g[0],others=[['sec','Sector'],['macro','NSE group']].filter(([l])=>l!==lv&&first[l]);
  const cols=PCOLS.filter(c=>c[0]==='mc'||g.filter(x=>num(x[c[0]])).length>=Math.max(2,g.length*0.3));
  const draw=()=>{
    const rows=g.slice().sort((a,b)=>{const x=a[SR.sort],y=b[SR.sort];if(!num(x)&&!num(y))return 0;if(!num(x))return 1;if(!num(y))return -1;return (x-y)*SR.dir});
    const med={};cols.forEach(c=>med[c[0]]=medOf(g.map(x=>x[c[0]])));
    const top=g.filter(x=>num(x.mc)).sort((a,b)=>b.mc-a.mc),t5=top.slice(0,5).reduce((a,x)=>a+x.mc,0);
    $('#sbody').innerHTML=`<div class="card"><h3>${esc(lvName)} snapshot <span class="mut" style="font-weight:400;font-size:12px">${g.length} stocks${others.length?' · '+others.map(([l,n])=>`${n}: <a href="#/sector/${l}/${encodeURIComponent(first[l])}">${esc(first[l])}</a>`).join(' · '):''}</span></h3>
      <div class="mtiles">${tl('Market cap',num(gm)?'₹'+T.fmt(gm,0)+' cr':'–',num(tot)&&tot?T.fmt(gm/tot*100,1)+'% of all tracked stocks':'')}${tl('Weighted P/E',f(wv('pe'),1,'x'),'Median '+f(medOf(g.map(x=>x.pe)),1,'x'))}${tl('Weighted P/B',f(wv('pb'),2,'x'),'Median '+f(medOf(g.map(x=>x.pb)),2,'x'))}${tl('Median ROE',f(medOf(g.map(x=>x.roe)),1,'%'))}${tl('Median ROCE',f(medOf(g.map(x=>x.roce)),1,'%'))}${tl('Median revenue CAGR',f(medOf(g.map(x=>x.rg)),1,'%'))}${tl('1M return',pc(wr('r1m')),'cap-weighted')}${tl('1Y return',pc(wr('r1y')),'cap-weighted')}${tl('Above 200-DMA',a200==null?'–':T.fmt(a200,0)+'%','of stocks')}${tl('Top 5 share',gm?T.fmt(t5/gm*100,0)+'%':'–','of group market cap')}</div></div>
     <div class="card" style="overflow-x:auto"><h3>Constituents</h3><table class="peer"><thead><tr><th>Company</th>${cols.map(c=>`<th class="num sortable ${SR.sort===c[0]?'sorted':''}" data-k="${c[0]}">${c[1]}${SR.sort===c[0]?(SR.dir<0?' ▼':' ▲'):''}</th>`).join('')}</tr></thead><tbody>
      ${rows.map(r=>`<tr data-s="${esc(r.s)}"><td><b>${esc(r.s)}</b><div class="k">${esc(r.n)}</div></td>${cols.map(c=>`<td class="num ${SR.sort===c[0]?'sorted':''}">${num(r[c[0]])?T.fmt(r[c[0]],c[2]):'–'}</td>`).join('')}</tr>`).join('')}
      <tr class="medrow"><td><b>Median</b></td>${cols.map(c=>`<td class="num">${num(med[c[0]])?T.fmt(med[c[0]],c[2]):'–'}</td>`).join('')}</tr></tbody></table></div>
     <p class="mut" style="font-size:12px">Weighted P/E and P/B = total market cap divided by total earnings (or book value) of the stocks with positive values. Returns are weighted by market cap. Groups come from NSE's Nifty 500 list and Yahoo Finance tags.</p>`;
    document.querySelectorAll('#sbody th.sortable').forEach(th=>th.onclick=()=>{const k=th.dataset.k;if(SR.sort===k)SR.dir*=-1;else{SR.sort=k;SR.dir=-1}draw()});
    document.querySelectorAll('#sbody tbody tr[data-s]').forEach(tr=>tr.onclick=()=>{location.hash='#/stock/'+tr.dataset.s+'/peers'});
  };
  view.innerHTML=`<div class="crumb"><a href="#/market">Market Overview</a> › ${esc(lvName)}</div><h1 style="margin:0 0 12px;font-size:24px">${esc(name)}</h1><div id="sbody"></div>`;
  draw();
}

// ---------- screener ----------
let FILT={q:'',rel:'all',ind:'all'};
const SCM=[ // key, label, unit/decimals, group
 ['mc','Market cap ₹ cr',0,'Size'],['px','Price ₹',1,'Size'],
 ['pe','P/E',1,'Valuation'],['pb','P/B',2,'Valuation'],['ev','EV/EBITDA',1,'Valuation'],['up','Fair value upside %',0,'Valuation'],
 ['roe','ROE %',1,'Quality'],['roce','ROCE %',1,'Quality'],['nm','Net margin %',1,'Quality'],['de','Debt / equity',2,'Quality'],
 ['rg','Revenue CAGR %',1,'Growth'],['ng','Net income CAGR %',1,'Growth'],
 ['r1m','1-month return %',1,'Momentum'],['r1y','1-year return %',1,'Momentum'],['rsi','RSI (14)',0,'Momentum'],
 ['dp','Delivery % (last day)',0,'Order flow'],['score','Order flow score',0,'Order flow']];
const SC_PRESETS=[
 ['Quality compounders',{roe:[15,null],roce:[15,null],de:[null,0.6],rg:[10,null]}],
 ['Value',{pe:[null,18],pb:[null,2.5],roe:[12,null]}],
 ['Undervalued vs fair value',{up:[20,null]}],
 ['Momentum',{r1m:[5,null],r1y:[15,null],_a200:1}],
 ['Debt-free profitable',{de:[null,0.1],roe:[12,null],nm:[8,null]}],
 ['High delivery',{dp:[60,null]}],
 ['Bullish order flow',{_bias:'bullish'}]];
let SC=null;
async function screener(){
  view.innerHTML='<div class="skel" style="height:120px"></div><div class="skel" style="height:360px;margin-top:14px"></div>';
  if(!SC){SC={f:{},cap:[],type:'all',ind:'all',q:'',a200:0,bias:'all',sort:{k:'mc',d:-1},n:50,idx:'all'};
    try{const s=JSON.parse(localStorage.getItem('tl_screener')||'null');if(s&&s.f)Object.assign(SC,s,{n:50})}catch(e){}}
  if(FILT.ind&&FILT.ind!=='all'){SC.ind=FILT.ind;FILT.ind='all';SC.q=''}
  const [P,OF,FS_]=await Promise.all([get('data/peers.json','json'),get('data/orderflow.json','json'),table('data/financials_summary.csv')]);
  const ps={};((P&&P.stocks)||[]).forEach(x=>ps[x.s]=x);
  const ofm={};((OF&&OF.stocks)||[]).forEach(x=>ofm[x.s]=x);
  const fup={};FS_.forEach(r=>{const u=T.num(r.upside_pct);if(u!=null)fup[r.symbol]=u});
  const rows=D.syms.map(s=>{
    const x=ps[s]||{},m=D.met[s]||{},d=D.dcf[s]||{},r=D.rsk[s]||{},o=ofm[s]||{};
    const price=T.num(r.price)??T.num(d.price)??x.px??null;
    const dcfUp=T.num(d.fair_value)!=null&&price?(T.num(d.fair_value)/price-1)*100:null;
    const mc=x.mc!=null?x.mc:null;
    return {s,n:x.n||((D.uni.find(u=>u.symbol===s)||{}).company)||s,ind:m.industry||x.ind||'',type:x.type||m.type||'',
      mc,px:price,pe:x.pe,pb:x.pb,ev:x.ev,roe:x.roe,roce:x.roce,nm:x.nm,de:x.de,rg:x.rg,ng:x.ng,r1m:x.r1m,r1y:x.r1y,
      rsi:T.num(r.rsi14),a200:x.a200,idx:x.idx||((D.uni.find(u=>u.symbol===s)||{}).index)||'nifty500',up:fup[s]!=null?fup[s]:dcfUp,dp:o.dp!=null?o.dp:null,score:o.score!=null?o.score:null,bias:o.bias||'',cap:capOf(mc)}});
  const inds=[...new Set(rows.map(r=>r.ind).filter(Boolean))].sort();
  const save=()=>{try{localStorage.setItem('tl_screener',JSON.stringify(SC))}catch(e){}};
  const nn=v=>v!=null&&isFinite(v);
  const pass=r=>{
    for(const [k,[lo,hi]] of Object.entries(SC.f)){const v=r[k];if(lo==null&&hi==null)continue;if(!nn(v))return false;if(lo!=null&&v<lo)return false;if(hi!=null&&v>hi)return false}
    if(SC.cap.length&&!SC.cap.includes(r.cap))return false;
    if(SC.type==='fin'&&r.type!=='financial')return false;if(SC.type==='nonfin'&&r.type==='financial')return false;
    if(SC.ind!=='all'&&r.ind!==SC.ind)return false;
    if(SC.a200&&r.a200!==1)return false;
    if(SC.idx&&SC.idx!=='all'&&r.idx!==SC.idx)return false;
    if(SC.bias!=='all'&&r.bias!==SC.bias)return false;
    if(SC.q&&!(r.s+' '+r.n+' '+r.ind).toUpperCase().includes(SC.q.toUpperCase()))return false;
    return true};
  const groups=[...new Set(SCM.map(x=>x[3]))];
  const fv=(k,i)=>{const a=SC.f[k];return a&&a[i]!=null?a[i]:''};
  const shell=()=>{
    view.innerHTML=`<div class="scr"><h2 style="margin:0 0 4px">Stock screener</h2>
     <p class="mut" style="margin:0 0 12px">Filter all tracked stocks (Nifty 500 and Microcap 250) on valuation, quality, growth, momentum and order flow. Leave a box empty to ignore it. Stocks with no data for a filtered metric are left out. End-of-day data.</p>
     <div class="card"><div class="scpre"><span class="mut">Presets</span>${SC_PRESETS.map((p,i)=>`<button data-p="${i}">${esc(p[0])}</button>`).join('')}<button id="sc-clear" class="ed-reset">Clear all</button></div>
      <div class="scgrid">${groups.map(g=>`<div class="scg"><div class="k">${g}</div>${SCM.filter(x=>x[3]===g).map(([k,l])=>`<div class="scf"><span>${l}</span><input type="number" step="any" data-k="${k}" data-i="0" placeholder="min" value="${fv(k,0)}"><input type="number" step="any" data-k="${k}" data-i="1" placeholder="max" value="${fv(k,1)}"></div>`).join('')}</div>`).join('')}
       <div class="scg"><div class="k">Filters</div>
        <div class="scf"><span>Market cap class</span><span class="sccaps">${['Large cap','Mid cap','Small cap'].map(c=>`<label><input type="checkbox" data-cap="${c}" ${SC.cap.includes(c)?'checked':''}>${c.split(' ')[0]}</label>`).join('')}</span></div>
        <div class="scf"><span>Index group</span><select id="sc-idx"><option value="all">All</option><option value="nifty500"${SC.idx==='nifty500'?' selected':''}>Nifty 500</option><option value="microcap250"${SC.idx==='microcap250'?' selected':''}>Microcap 250</option></select></div>
        <div class="scf"><span>Type</span><select id="sc-type"><option value="all">All</option><option value="nonfin"${SC.type==='nonfin'?' selected':''}>Non-financial</option><option value="fin"${SC.type==='fin'?' selected':''}>Banks &amp; financials</option></select></div>
        <div class="scf"><span>Industry</span><select id="sc-ind"><option value="all">All industries</option>${inds.map(x=>`<option${SC.ind===x?' selected':''}>${esc(x)}</option>`).join('')}</select></div>
        <div class="scf"><span>Order flow bias</span><select id="sc-bias"><option value="all">Any</option>${['bullish','bearish','neutral'].map(x=>`<option value="${x}"${SC.bias===x?' selected':''}>${x[0].toUpperCase()+x.slice(1)}</option>`).join('')}</select></div>
        <div class="scf"><span>Above 200-day average</span><input type="checkbox" id="sc-a200" ${SC.a200?'checked':''}></div>
        <div class="scf"><span>Search</span><input id="sc-q" placeholder="symbol, name, industry" value="${esc(SC.q)}"></div></div></div></div>
     <div class="card" style="margin-top:14px"><div class="schd"><b id="sc-cnt"></b><span class="mut" style="flex:1;font-size:13px"> · click a column to sort · click a row to open</span></div><div class="scroll"><table id="sc-tb" class="sctb"></table></div><p style="text-align:center;margin:10px 0 0"><button id="sc-more" class="ed-reset" style="display:none">Show 50 more</button></p>
     <p class="mut" style="font-size:12px;margin-top:10px">Fair value upside uses the saved DCF (non-financials) or the P/B–ROE model (financials) from the nightly run, so open the stock to test it with your own assumptions. Delivery % and the order flow score come from the latest order-flow run. Returns are price returns. Ratios are from the latest annual data on Yahoo Finance, so check anything important against the company's filings.</p></div></div>`;
    bind()};
  const COLS=[['s','Symbol','l'],['n','Company','l'],['cap','Cap','l'],['mc','Mkt cap ₹cr'],['px','Price'],['pe','P/E'],['pb','P/B'],['roe','ROE %'],['roce','ROCE %'],['de','D/E'],['rg','Rev CAGR %'],['r1m','1M %'],['r1y','1Y %'],['up','Upside %'],['dp','Deliv %'],['score','OF score']];
  const dec={mc:0,px:1,pe:1,pb:2,roe:1,roce:1,de:2,rg:1,r1m:1,r1y:1,up:0,dp:0,score:0};
  const pct=new Set(['r1m','r1y','up']);
  const draw=()=>{
    const all=rows.filter(pass);
    const {k,d}=SC.sort;
    all.sort((a,b)=>{const x=a[k],y=b[k];if(!nn(x)&&!nn(y)&&typeof x!=='string'&&typeof y!=='string')return 0;if(x==null||x==='')return 1;if(y==null||y==='')return -1;return (x>y?1:x<y?-1:0)*d});
    $('#sc-cnt').textContent=all.length+' of '+rows.length+' stocks';
    const shown=all.slice(0,SC.n);
    $('#sc-tb').innerHTML='<tr>'+COLS.map(c=>`<th class="${c[2]||''}" data-k="${c[0]}">${c[1]}${k===c[0]?(d>0?' ▲':' ▼'):''}</th>`).join('')+'</tr>'+
     shown.map(r=>`<tr class="row" onclick="location.hash='#/stock/${encodeURIComponent(r.s)}'">${COLS.map(c=>{const v=r[c[0]];if(c[2]==='l')return `<td class="l${c[0]==='n'?' mut':''}">${esc(String(v==null?'':v))}</td>`;return `<td class="num ${pct.has(c[0])?cls(v):''}">${nn(v)?(pct.has(c[0])&&v>0?'+':'')+T.fmt(v,dec[c[0]]):'–'}</td>`}).join('')}</tr>`).join('')||'<tr><td colspan="16" class="mut" style="padding:20px">No stock matches all the filters. Loosen one of them.</td></tr>';
    document.querySelectorAll('#sc-tb th').forEach(th=>th.onclick=()=>{const kk=th.dataset.k;SC.sort=SC.sort.k===kk?{k:kk,d:-SC.sort.d}:{k:kk,d:['s','n','cap'].includes(kk)?1:-1};save();draw()});
    const mo=$('#sc-more');mo.style.display=all.length>SC.n?'':'none';mo.onclick=()=>{SC.n+=50;draw()};
  };
  const bind=()=>{
    view.querySelectorAll('input[data-k]').forEach(i=>i.onchange=()=>{const k=i.dataset.k,j=+i.dataset.i,v=parseFloat(i.value);const a=SC.f[k]||[null,null];a[j]=isFinite(v)?v:null;if(a[0]==null&&a[1]==null)delete SC.f[k];else SC.f[k]=a;SC.n=50;save();draw()});
    view.querySelectorAll('input[data-cap]').forEach(i=>i.onchange=()=>{SC.cap=[...view.querySelectorAll('input[data-cap]:checked')].map(x=>x.dataset.cap);SC.n=50;save();draw()});
    $('#sc-idx').onchange=e=>{SC.idx=e.target.value;SC.n=50;save();draw()};
    $('#sc-type').onchange=e=>{SC.type=e.target.value;SC.n=50;save();draw()};
    $('#sc-ind').onchange=e=>{SC.ind=e.target.value;SC.n=50;save();draw()};
    $('#sc-bias').onchange=e=>{SC.bias=e.target.value;SC.n=50;save();draw()};
    $('#sc-a200').onchange=e=>{SC.a200=e.target.checked?1:0;SC.n=50;save();draw()};
    $('#sc-q').oninput=e=>{SC.q=e.target.value;SC.n=50;save();draw()};
    $('#sc-clear').onclick=()=>{SC.f={};SC.cap=[];SC.type='all';SC.ind='all';SC.q='';SC.a200=0;SC.bias='all';SC.idx='all';SC.n=50;save();shell();draw()};
    view.querySelectorAll('.scpre button[data-p]').forEach(b=>b.onclick=()=>{const p=SC_PRESETS[+b.dataset.p][1];SC.f={};SC.cap=[];SC.type='all';SC.ind='all';SC.q='';SC.a200=0;SC.bias='all';SC.idx='all';SC.n=50;
      for(const [k,v] of Object.entries(p)){if(k==='_a200')SC.a200=v;else if(k==='_bias')SC.bias=v;else SC.f[k]=v.slice()}save();shell();draw()});
  };
  shell();draw();
}

// ---------- statements: P&L, balance sheet, cash flow, shareholding ----------
const STMT_KEY={pl:['Total Revenue','Operating Revenue','Gross Profit','EBITDA','Operating Income','Pretax Income','Net Income','Diluted EPS','Basic EPS','Net Interest Income','Total Expenses'],
 bs:['Total Assets','Total Liabilities Net Minority Interest','Stockholders Equity','Total Equity Gross Minority Interest','Total Debt','Net Debt','Cash And Cash Equivalents','Current Assets','Current Liabilities','Working Capital','Invested Capital','Tangible Book Value','Net Tangible Assets','Retained Earnings','Total Capitalization'],
 cf:['Operating Cash Flow','Investing Cash Flow','Financing Cash Flow','Capital Expenditure','Free Cash Flow','End Cash Position','Cash Dividends Paid','Repurchase Of Capital Stock','Issuance Of Debt','Repayment Of Debt']};
const STMT_GROW={pl:['Total Revenue','Operating Revenue','Net Interest Income','EBITDA','Operating Income','Pretax Income','Net Income','Diluted EPS'],bs:['Total Assets','Stockholders Equity','Total Debt'],cf:['Operating Cash Flow','Free Cash Flow']};
function stmtTable(tb,kind,per){
  if(!tb)return '<div class="card"><p class="mut">No '+(per==='q'?'quarterly ':'')+'data available for this statement.</p></div>';
  const raw=/EPS|Tax Rate|Per Share/i,key=new Set(STMT_KEY[kind]),gk=new Set(STMT_GROW[kind]);
  const mn=FS.unit==='mn';
  const cr=(n,v)=>{if(v==null)return '–';if(raw.test(n))return T.fmt(v,2);if(mn){const x=v/1e6;return x.toLocaleString('en-US',{maximumFractionDigits:Math.abs(x)<100?1:0,minimumFractionDigits:Math.abs(x)<100?1:0})}return T.fmt(v/1e7,Math.abs(v/1e7)<100?2:0)};
  const dl=d=>{const x=new Date(d);return per==='q'?x.toLocaleString('en-GB',{month:'short',year:'2-digit'}):'FY'+String(x.getFullYear()).slice(2)};
  const ko=STMT_KEY[kind],pos=n=>{const i=ko.indexOf(n);return i<0?999:i};
  const rows=tb.rows.filter(r=>!FS.keyonly||key.has(r[0])).map((r,i)=>[r,i]).sort((a,b)=>pos(a[0][0])-pos(b[0][0])||a[1]-b[1]).map(x=>x[0]);
  let t=`<table class="stmt"><tr><th class="l">${mn?'₹ million':'₹ crore'}</th>${tb.dates.map(d=>`<th>${dl(d)}</th>`).join('')}</tr>`;
  rows.forEach(([n,v])=>{
    t+=`<tr class="${key.has(n)?'kr':''}"><td class="l">${esc(n.replace(/([a-z])([A-Z])/g,'$1 $2'))}</td>${v.map(x=>`<td>${cr(n,x)}</td>`).join('')}</tr>`;
    if(gk.has(n)){
      const half=per==='q'&&kind!=='pl';
      const prior=i=>{if(!half)return i>=1?i-1:-1;const t=new Date(tb.dates[i]).getTime();for(let k=0;k<i;k++){const d=Math.abs(t-new Date(tb.dates[k]).getTime())/864e5;if(d>335&&d<395)return k}return -1};
      t+=`<tr class="gr"><td class="l">${half?'YoY':per==='q'?'QoQ':'YoY'} growth</td>${v.map((x,i)=>{const k=prior(i),p=k>=0?v[k]:null;if(x==null||p==null||p<=0)return '<td>–</td>';const g=(x/p-1)*100;return `<td class="${cls(g)}">${T.pct(g)}</td>`}).join('')}</tr>`}
  });
  return `<div class="card scroll" style="padding:0"><div class="stbox">${t}</table></div></div>`;
}
function shareholdingHtml(st,sh){
  let h='';
  if(sh&&sh.quarters&&sh.quarters.length){
    const q=sh.quarters,rows=[['promoter','Promoters','#2f6fdb'],['fii','FII / FPI','#2e9e6b'],['dii','DII','#e9a23b'],['public','Public (retail & others)','#9aa3b0']].filter(([k])=>q.some(x=>x[k]!=null));
    const lab=x=>esc(x.label||x.date);
    const bars=q.map(x=>`<div class="shc"><div class="shs">${rows.map(([k,n,c])=>x[k]!=null?`<div style="height:${Math.max(0,x[k])*1.6}px;background:${c}" title="${n} ${T.fmt(x[k],2)}%"><i>${x[k]>=6?T.fmt(x[k],1):''}</i></div>`:'').join('')}</div><span>${lab(x)}</span></div>`).join('');
    h+=`<div class="card shcard"><h3>Shareholding pattern<span class="mut" style="font-weight:400;font-size:12px">% of total shares · source: NSE filings</span></h3>
     <div class="shleg">${rows.map(([k,n,c])=>`<span><b style="background:${c}"></b>${n}</span>`).join('')}</div><div class="shbars">${bars}</div>
     <div class="scroll" style="max-height:none;margin-top:14px"><table class="stmt sht"><tr><th class="l">Holding, %</th>${q.map(x=>`<th>${lab(x)}</th>`).join('')}</tr>
      ${rows.map(([k,n])=>`<tr class="kr"><td class="l">${n}</td>${q.map(x=>`<td>${x[k]==null?'–':T.fmt(x[k],2)}</td>`).join('')}</tr>`).join('')}
      <tr><td class="l" colspan="${q.length+1}" style="font-weight:600;color:var(--m);padding-top:14px;position:static">Change vs previous quarter, percentage points</td></tr>
      ${rows.map(([k,n])=>`<tr><td class="l">${n}</td>${q.map((x,i)=>{const v=x[k],pv=i?q[i-1][k]:null;const d=v!=null&&pv!=null?v-pv:null;return `<td class="${d==null?'':d>0.004?'pos':d<-0.004?'neg':''}">${d==null?'–':(d>0?'+':'')+T.fmt(d,2)}</td>`}).join('')}</tr>`).join('')}</table></div></div>`;
    return h;
  }
  const hd=st&&st.holders;
  if(hd&&(hd.insiders_pct!=null||hd.institutions_pct!=null)){
    const ins=hd.insiders_pct!=null?hd.insiders_pct*100:null,inst=hd.institutions_pct!=null?hd.institutions_pct*100:null,oth=ins!=null&&inst!=null?Math.max(0,100-ins-inst):null;
    h+=`<div class="card"><h3>Ownership snapshot<span class="mut" style="font-weight:400;font-size:12px">source: Yahoo Finance, latest</span></h3>
     <div class="own">${[['Insiders / promoters',ins,'#2f6fdb'],['Institutions (FII + DII + MF)',inst,'#2e9e6b'],['Others / public',oth,'#e9a23b']].filter(x=>x[1]!=null).map(x=>`<div style="flex:${Math.max(x[1],2)};background:${x[2]}"><b>${T.fmt(x[1],1)}%</b><span>${x[0]}</span></div>`).join('')}</div>
     <p class="mut" style="margin:10px 0 0;font-size:12px">Quarterly NSE data is not available for this stock yet, so this Yahoo snapshot is shown instead. It does not split FII and DII.</p></div>`;
  }
  return h||'<div class="card"><p class="mut">Shareholding data is not available for this stock yet.</p></div>';
}
async function finTabs(s){
  const st=await get(`data/statements/${s}.json`,'json');
  let sh=null;try{sh=await get(`data/shareholding/${s}.json`,'json')}catch(e){}
  const subs=[['pl','Profit & Loss'],['bs','Balance Sheet'],['cf','Cash Flow'],['sh','Shareholding'],['ra','Ratios & quality']];
  const draw=()=>{
    const tabs=$('#fsub'),body=$('#fbody');if(!tabs||!body)return;
    tabs.innerHTML=subs.map(x=>`<button data-s="${x[0]}" class="${FS.sub===x[0]?'on':''}">${x[1]}</button>`).join('');
    tabs.querySelectorAll('button').forEach(b=>b.onclick=()=>{FS.sub=b.dataset.s;draw()});
    if(FS.sub==='ra'){body.innerHTML=FIN_RATIO;bindRatios();return}
    if(FS.sub==='sh'){body.innerHTML=shareholdingHtml(st,sh);return}
    if(!st){body.innerHTML='<div class="card"><p class="mut">Statements are not downloaded yet. Run the <b>Fetch financial statements</b> workflow in Actions, then refresh.</p></div>';return}
    const kind=FS.sub,pc=FS.per==='quarterly'?'q':'a';
    const map={pl:['annual_income','quarterly_income'],bs:['annual_balance','quarterly_balance'],cf:['annual_cashflow','quarterly_cashflow']}[kind];
    const tb=st[map[pc==='q'?1:0]];
    const title={pl:'Profit & Loss',bs:'Balance Sheet',cf:'Cash Flow'}[kind];
    body.innerHTML=`<div class="fbar"><div class="seg" id="fper"><button data-p="annual" class="${FS.per==='annual'?'on':''}">Annual</button><button data-p="quarterly" class="${FS.per==='quarterly'?'on':''}">${kind==='pl'?'Quarterly':'Half-yearly'}</button></div>
      <div class="seg" id="funit"><button data-u="cr" class="${FS.unit==='cr'?'on':''}">₹ Crore</button><button data-u="mn" class="${FS.unit==='mn'?'on':''}">₹ Million</button></div>
      <label class="chk"><input type="checkbox" id="fkey" ${FS.keyonly?'checked':''}> Key lines only</label><span class="mut" style="margin-left:auto;font-size:12px">${esc(title)} · ${FS.unit==='mn'?'₹ million':'₹ crore'} · Yahoo Finance · updated ${esc(st.fetched||'')}</span></div>${pc==='q'&&kind!=='pl'?'<p class="mut" style="max-width:1040px;margin:0 auto 10px;font-size:12px">Indian companies publish the balance sheet and cash flow twice a year (March and September), so this view is half-yearly. Only the Profit & Loss is reported every quarter. Cash flow in the September column normally covers the first six months only.</p>':''}${stmtTable(tb,kind,pc)}${kind==='pl'&&((D.met[s]||{}).type==='financial')?'<p class="mut" style="max-width:1040px;margin:10px auto 0;font-size:12px">For lenders, Yahoo Finance\'s <b>Total Revenue</b> can leave out part of fee and assignment income, so it may be lower than the total income in the company\'s own results or on other sites. Pre-tax income and net income are reported in full and are the better lines to compare.</p>':''}`;
    $('#fper').querySelectorAll('button').forEach(b=>b.onclick=()=>{FS.per=b.dataset.p;draw()});
    $('#funit').querySelectorAll('button').forEach(b=>b.onclick=()=>{FS.unit=b.dataset.u;draw()});
    $('#fkey').onchange=e=>{FS.keyonly=e.target.checked;draw()};
  };
  draw();
}

// ---------- valuation: model tabs + scenarios ----------
let VS={sub:null,pw:[25,50,25]};
function scenarioRows(dcf,fin,price){
  const out=[],rf=A.rf/100,erp=A.erp/100,g=A.g/100;
  if(dcf){
    const sc=[['Bear',{dm:.9,dg1:-.04,dw:.01,dgT:-.01}],['Base',{dm:1,dg1:0,dw:0,dgT:0}],['Bull',{dm:1.1,dg1:.04,dw:-.01,dgT:.005}]];
    const b0=T.recompute(dcf,{rf,erp,gT:g});
    if(b0){const res=sc.map(([n,s])=>{const d2=Object.assign({},dcf,{model:Object.assign({},dcf.model,{margin:dcf.model.margin*s.dm})});
      const r=T.recompute(d2,{rf,erp,gT:g+s.dgT,g1:b0.g1+s.dg1,waccOverride:b0.wacc+s.dw});return {n,fair:r?r.perShare:null,
      a:[['EBIT margin',(s.dm===1?'as modelled':(s.dm>1?'+10%':'−10%')+' (relative)')],['First-year growth',T.fmt((b0.g1+s.dg1)*100,1)+'%'],['WACC',T.fmt((b0.wacc+s.dw)*100,2)+'%'],['Terminal growth',T.fmt((g+s.dgT)*100,1)+'%']]}});
      out.push({title:'DCF (FCFF, 10-year)',res})}
  }
  if(fin){
    const sc=[['Bear',{droe:-.02,dg:-.01,derp:.01}],['Base',{droe:0,dg:0,derp:0}],['Bull',{droe:.02,dg:.005,derp:-.005}]];
    const base=T.finModel(fin,fx(fin,{rf,erp,g}));
    if(base){const res=sc.map(([n,s])=>{const r=T.finModel(fin,fx(fin,{rf,erp:erp+s.derp,g:g+s.dg,roe:base.roe+s.droe}));return {n,fair:r?r.fair:null,
      a:[['Sustainable ROE',T.fmt((base.roe+s.droe)*100,1)+'%'],['Cost of equity',r?T.fmt(r.ke*100,2)+'%':'–'],['Long-term growth',r?T.fmt(r.g*100,1)+'%':'–'],['Fair P/B',r&&r.fairPB!=null?T.fmt(r.fairPB,2)+'x':'–']]}});
      out.push({title:'Justified P/B (ROE model)',res})}
  }
  return out;
}
function scenarioPanel(sel,dcf,fin,price){
  const body=$(sel),models=scenarioRows(dcf,fin,price);
  if(!body)return;
  if(!models.length){body.innerHTML='';return}
  const draw=()=>{
    const pw=VS.pw,tot=pw.reduce((a,b)=>a+(+b||0),0)||1;
    body.innerHTML=models.map(m=>{
      const f=m.res.map(r=>r.fair),ok=f.every(v=>v!=null);
      const wv=ok?f.reduce((a,v,i)=>a+v*(pw[i]||0),0)/tot:null,up=v=>v!=null&&price?(v/price-1)*100:null;
      const lo=Math.min(...f.filter(v=>v!=null),price),hi=Math.max(...f.filter(v=>v!=null),price),pos=v=>hi>lo?((v-lo)/(hi-lo))*100:50;
      return `<div class="card" style="margin-top:14px"><h3>Scenarios: bear / base / bull<span class="mut" style="font-weight:400;font-size:12px">${esc(m.title)} · fair value per share, ₹</span></h3>
       <div class="scn">${m.res.map(r=>`<div class="sc sc-${r.n.toLowerCase()}"><div class="sn">${r.n}</div><div class="sv">${r.fair!=null?'₹'+T.fmt(r.fair,0):'–'}</div><div class="su ${cls(up(r.fair))}">${r.fair!=null?T.pct(up(r.fair),0)+' vs price':'–'}</div>
         <table>${r.a.map(x=>`<tr><td class="l">${x[0]}</td><td>${x[1]}</td></tr>`).join('')}</table></div>`).join('')}</div>
       ${ok?`<div class="rng"><div class="rl"></div>${m.res.map(r=>`<span class="rd rd-${r.n.toLowerCase()}" style="left:${pos(r.fair)}%" title="${r.n} ₹${T.fmt(r.fair,0)}"></span>`).join('')}<span class="rp" style="left:${pos(price)}%"><b>Price ₹${T.fmt(price,0)}</b></span></div>`:''}
       <div class="pw"><span class="mut">Probability weights %</span>${['Bear','Base','Bull'].map((n,i)=>`<label>${n} <input type="number" min="0" max="100" step="5" value="${pw[i]}" data-i="${i}"></label>`).join('')}
        <span class="pwv">Weighted value <b>${wv!=null?'₹'+T.fmt(wv,0):'–'}</b> <span class="${cls(up(wv))}">${wv!=null?T.pct(up(wv),0):''}</span></span></div>
       <p class="mut" style="font-size:12px;margin:8px 0 0">The base case uses your current Assumptions. Bear and bull move the main drivers together. Illustrative ranges, not forecasts.</p></div>`}).join('');
    body.querySelectorAll('.pw input').forEach(i=>i.onchange=e=>{VS.pw[+e.target.dataset.i]=parseFloat(e.target.value)||0;draw()});
  };
  draw();
}
const VAL_MODELS={
 mult:{label:'Price multiples',what:'Values the stock by applying a fair multiple to earnings, book value or sales, using the stock\'s own history and its peers.',best:'Almost every listed company; the quickest cross-check.',inputs:['P/E, P/B, P/S and EV/EBITDA now vs own 5-year range','Peer median multiples (same industry)','Target multiple x forward EPS / BVPS / sales per share','Implied price range: low, median, high']},
 ev:{label:'EV multiples',what:'Applies an enterprise-value multiple (EV/EBITDA, EV/Sales, EV/FCF), then bridges to equity by subtracting net debt.',best:'Non-financial companies with different debt levels, or where earnings are volatile.',inputs:['EV/EBITDA, EV/Sales and EV/FCF vs history and peers','Net debt, minority interest and investments bridge','Implied equity value per share']},
 ddm:{label:'DDM',what:'Dividend discount model: present value of expected dividends, usually Gordon growth or a two-stage version.',best:'Steady dividend payers such as banks, utilities, FMCG, REITs and PSUs. Not usable where dividends are zero or irregular.',inputs:['Dividend per share (last 4 years) and payout ratio','Growth stage 1 and long-term growth','Cost of equity from CAPM (uses your Assumptions)']},
 asset:{label:'Asset based',what:'Values the business at what its assets are worth: adjusted book value, tangible book, replacement cost or liquidation value, minus liabilities.',best:'Banks and NBFCs (tangible book), holding companies, real estate, asset-heavy and loss-making businesses.',inputs:['Book value and tangible book value per share','Adjustments for investments at market value, revalued land and intangibles','Net asset value per share, with a discount or premium to NAV']},
 ri:{label:'Residual income',what:'Book value today plus the present value of profits earned above the cost of equity (excess returns, also called EVA or economic profit).',best:'Financials and any business where book value is meaningful and dividends are not a clean signal.',inputs:['Book value per share and forecast ROE','Cost of equity (uses your Assumptions)','Fade of excess returns over time']},
 epv:{label:'Earnings power',what:'Earnings power value: normalised, no-growth after-tax earnings divided by the cost of capital. A conservative floor that shows what the business is worth without growth.',best:'Mature, steady non-financial companies; useful next to a growth DCF.',inputs:['Normalised EBIT margin over a full cycle','Tax rate and maintenance capex','WACC (uses your Assumptions)']},
 sotp:{label:'Sum of the parts',what:'Values each business segment separately with its own method, adds them up, then adjusts for holding-company discount and net debt.',best:'Conglomerates and groups with listed subsidiaries or very different divisions.',inputs:['Segment revenue and profit','Multiple or method for each segment','Market value of listed holdings, and holding-company discount']},
 graham:{label:'Graham value',what:'Benjamin Graham\'s quick formulas: the Graham number and the growth formula (EPS x (8.5 + 2g)) as a margin-of-safety screen.',best:'Profitable, stable companies; a sanity check, not a full valuation.',inputs:['EPS, book value per share','Expected growth rate','Margin of safety vs current price']},
 embv:{label:'Embedded value',what:'For life insurers: embedded value (net worth plus value of in-force business) and a multiple on value of new business.',best:'Life insurance companies.',inputs:['Embedded value and value of new business (VNB) from company disclosures','VNB margin and growth','Target P/EV multiple']},
 ff:{label:'Summary',what:'A football-field chart that lines up the fair-value range from every model above against the current price.',best:'The final view once the models are calculated.',inputs:['Low and high value from each model','Current price marker','Average and median of the models']}
};
async function valTabs(s,dcf,fin,rl,price,met,u){
  const fnc=(met&&met.type==='financial')||!!fin,ins=(/life/i.test((u&&u.industry)||(met&&met.industry)||'')||/\blife\b/i.test((u&&u.company)||''))&&!/health|general|reinsur/i.test((u&&u.company)||'');
  window.__ins=ins;let payer=null;
  try{const st=await get(`data/statements/${s}.json`,'json');const cf=st&&st.annual_cashflow;if(cf){const row=cf.rows.find(r=>/dividend/i.test(r[0])&&/paid/i.test(r[0]))||cf.rows.find(r=>/dividend/i.test(r[0]));payer=row?row[1].slice(-3).some(v=>v!=null&&Math.abs(v)>0):false}}catch(e){}
  const live=[];if(dcf)live.push(['dcf','DCF']);if(fin)live.push(['fin','Justified P/B']);if(rl)live.push(['rl','Realty NAV']);
  live.push(['mult','Price multiples']);if(!fnc)live.push(['ev','EV multiples']);const soon=[];if(payer)live.push(['ddm','DDM']);else soon.push('ddm');live.push(['ri','Residual income'],['asset','Asset based']);if(!fnc)live.push(['epv','Earnings power']);live.push(['graham','Graham value'],['sotp','Sum of the parts']);if(ins)live.push(['embv','Embedded value']);live.push(['ff','Summary']);
  const subs=live.concat(soon.map(k=>[k,VAL_MODELS[k].label,true]));
  if(!VS.sub||!subs.some(x=>x[0]===VS.sub))VS.sub=subs[0][0];
  const ph=k=>{const m=VAL_MODELS[k];
    const use=k==='ddm'?(payer==null?'':payer?'<span class="ok">Usable: this company has paid dividends recently.</span>':'<span class="no">Limited use: no dividends found in the latest statements.</span>'):'';
    return `<div class="card mph"><h3>${esc(m.label)}<span class="soonbadge">calculation coming</span></h3>
     <p>${esc(m.what)}</p>${use?`<p class="use">${use}</p>`:''}
     <div class="mphg"><div><div class="k">Best for</div><div>${esc(m.best)}</div></div><div><div class="k">Planned inputs</div><ul>${m.inputs.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div></div></div>`};
  const draw=()=>{
    const t=$('#vsub'),b=$('#vbody');if(!t||!b)return;
    t.innerHTML=subs.map(x=>`<button data-s="${x[0]}" class="${VS.sub===x[0]?'on':''}${x[2]?' soon':''}">${x[1]}${x[0]==='ddm'&&payer===false?' <small>n/a</small>':''}</button>`).join('');
    t.querySelectorAll('button').forEach(x=>x.onclick=()=>{VS.sub=x.dataset.s;draw()});
    if(VS.sub==='dcf'){b.innerHTML='<div id="dcfbox"></div><div id="scbox"></div>';dcfPanel(dcf,price);scenarioPanel('#scbox',dcf,null,price)}
    else if(VS.sub==='fin'){b.innerHTML='<div id="finbox"></div><div id="scbox"></div>';finPanel(fin);scenarioPanel('#scbox',null,fin,price)}
    else if(VS.sub==='rl'){b.innerHTML='<div id="rlbox"></div>';realtyPanel(rl)}
    else if(VS.sub==='ddm'){b.innerHTML='<div id="multbox"><div class="skel" style="height:260px"></div></div>';ddmPanel(s,price,dcf,fin)}
    else if(VS.sub==='ff'){b.innerHTML='<div id="ffbox"><div class="skel" style="height:300px"></div></div>';ffPanel(s,price,dcf,fin,rl,fnc,payer)}
    else if(VS.sub==='epv'){b.innerHTML='<div id="multbox"><div class="skel" style="height:260px"></div></div>';epvPanel(s,price,dcf,fin)}
    else if(VS.sub==='sotp'){b.innerHTML='<div id="multbox"></div>';sotpPanel(s,price)}
    else if(VS.sub==='embv'){b.innerHTML='<div id="multbox"></div>';embvPanel(s,price)}
    else if(VS.sub==='graham'){b.innerHTML='<div id="multbox"><div class="skel" style="height:260px"></div></div>';grahamPanel(s,price)}
    else if(VS.sub==='ri'){b.innerHTML='<div id="multbox"><div class="skel" style="height:260px"></div></div>';riPanel(s,price,dcf,fin)}
    else if(VS.sub==='asset'){b.innerHTML='<div id="multbox"><div class="skel" style="height:260px"></div></div>';assetPanel(s,price)}
    else if(VS.sub==='ev'){b.innerHTML='<div id="multbox"><div class="skel" style="height:260px"></div></div>';evPanel(s,price)}
    else if(VS.sub==='mult'){b.innerHTML='<div id="multbox"><div class="skel" style="height:260px"></div></div>';multPanel(s,price)}
    else b.innerHTML=ph(VS.sub);
  };
  const assbar=()=>{const d=$('#assbar');if(!d)return;const open=d.open;
    d.innerHTML=`<summary>Default assumptions: risk-free ${T.fmt(A.rf,1)}% · equity risk premium ${T.fmt(A.erp,1)}% · terminal growth (GDP) ${T.fmt(A.g,1)}% <span class="mut">· edit</span></summary>
     <div class="ab"><label>Risk-free % <input id="a-rf" type="number" step="0.1" value="${A.rf}"></label><label>Equity risk premium % <input id="a-erp" type="number" step="0.1" value="${A.erp}"></label><label>Terminal growth % <input id="a-g" type="number" step="0.1" value="${A.g}"></label><button id="a-reset">Reset (${DEF.rf} / ${DEF.erp} / ${DEF.g})</button>
     <p class="mut" style="font-size:12px;margin:8px 0 0;flex-basis:100%">These starting values apply to every stock and model and are saved in this browser. The boxes inside each model change only that model for the stock you are viewing.</p></div>`;
    d.open=open;
    ['rf','erp','g'].forEach(k=>$('#a-'+k).onchange=e=>{const v=parseFloat(e.target.value);if(isFinite(v)){A[k]=v;saveA();assbar();draw()}});
    $('#a-reset').onclick=()=>{A=Object.assign({},DEF);saveA();assbar();draw()};
  };
  assbar();
  draw();
}

// ---------- price multiples model ----------
function pctile(a,p){a=a.filter(v=>v!=null&&isFinite(v)).sort((x,y)=>x-y);if(!a.length)return null;const i=(a.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return a[lo]+(a[hi]-a[lo])*(i-lo)}
const MS={set:'all'};
// ---------- editable model inputs ----------
let SUMBOX=null,REGV={};
const OV={};
const ovs=(m,s)=>OV[m+':'+s]||(OV[m+':'+s]={});
const ed=(o,k,val,step,dp)=>`<input class="ed${o[k]!=null?' chg':''}" data-k="${k}" type="number" step="${step||'any'}" value="${val==null||!isFinite(val)?'':(+val).toFixed(dp==null?2:dp)}">`;
const edBar=o=>`<p class="mut" style="font-size:12px;margin:8px 0 0">Values in boxes are editable; the model updates as you change them. ${Object.keys(o).length?'<button class="ed-reset">Reset to model values</button>':'Edited values turn blue.'}</p>`;
const edBind=(box,o,redo)=>{box.querySelectorAll('input.ed').forEach(i=>i.onchange=e=>{const v=parseFloat(e.target.value);if(isFinite(v))o[i.dataset.k]=v;else delete o[i.dataset.k];redo()});const r=box.querySelector('.ed-reset');if(r)r.onclick=()=>{for(const k in o)delete o[k];redo()}};

async function multPanel(s,price){
  const box=SUMBOX||$('#multbox');if(!box)return;
  const P=await get('data/peers.json','json');
  const me=P&&P.stocks&&P.stocks.find(x=>x.s===s);
  if(!me){box.innerHTML='<div class="card"><p class="mut">Peer data not built yet. Run the Daily refresh once.</p></div>';return}
  const ok=v=>v!=null&&isFinite(v)&&v>0;
  const LV=[['ind','Industry'],['sec','Sector'],['macro','NSE group']];
  let lv=null,peers=[];
  for(const [k] of LV){const g=P.stocks.filter(x=>x[k]&&x[k]===me[k]&&x.s!==s&&(ok(x.pe)||ok(x.pb)));if(g.filter(x=>ok(x.pe)).length>=6||g.filter(x=>ok(x.pb)).length>=6){lv=k;peers=g;break}}
  if(!lv){box.innerHTML='<div class="card"><h3>Price multiples</h3><p class="mut">Too few comparable peers (need at least 6 with positive multiples) to value this stock on multiples.</p></div>';return}
  const allPeers=peers;
  if(MS.set==='size'&&ok(me.mc)){peers=allPeers.filter(x=>ok(x.mc)).sort((a,b)=>Math.abs(Math.log(a.mc/me.mc))-Math.abs(Math.log(b.mc/me.mc))).slice(0,10)}
  const lvName=LV.find(x=>x[0]===lv)[1],gname=me[lv];
  const M=[['pe','P/E',1],['pb','P/B',2]];
  const o=ovs('mult',s);
  const rows=M.map(([k,l,d])=>{const vals=peers.map(x=>x[k]).filter(ok);
    const qd=vals.length>=6?[pctile(vals,.25),pctile(vals,.5),pctile(vals,.75)]:null;
    const qa=[0,1,2].map(i=>o[`q${i}_${k}`]!=null?o[`q${i}_${k}`]:(qd?qd[i]:null));
    const q=qa.every(v=>v!=null&&v>0)?qa:null;
    const own=o['own_'+k]!=null?o['own_'+k]:(ok(me[k])?me[k]:null);
    const imp=q&&own>0?q.map(m=>price*m/own):null;
    return {k,l,d,n:vals.length,own,q,qa,imp}});
  const use=rows.filter(r=>r.imp);
  const avg=i=>use.length?use.reduce((a,r)=>a+r.imp[i],0)/use.length:null;
  const bl=[avg(0),avg(1),avg(2)];
  if(use.length)REGV.mult=bl;
  const up=v=>v!=null&&price?(v/price-1)*100:null;
  const fx=(v,d)=>v==null?'–':T.fmt(v,d);
  const card=(cl,name,v)=>`<div class="sc ${cl}"><div class="sn">${name}</div><div class="sv">${v!=null?'₹'+T.fmt(v,0):'–'}</div><div class="su ${cls(up(v))}">${up(v)!=null?(up(v)>=0?'+':'')+T.fmt(up(v),1)+'% vs price':''}</div></div>`;
  box.innerHTML=`<div class="card mph"><h3>Price multiples <span class="mut" style="font-weight:400;font-size:12px">peers: ${esc(gname)} (${esc(lvName)}) · ${peers.length} stocks</span></h3>
    <div class="seg" id="msset" style="margin:0 0 10px"><button data-k="all" class="${MS.set==='all'?'on':''}">All peers (${allPeers.length})</button><button data-k="size" class="${MS.set==='size'?'on':''}">Similar size (10 nearest)</button></div>
    <p class="mut" style="margin-top:0">Applies the peers' 25th percentile, median and 75th percentile multiple to this company's earnings and book value. Low = bear, median = base, high = bull.</p>
    ${use.length?`<div class="scn">${card('sc-bear','Bear (25th pct)',bl[0])}${card('sc-base','Base (median)',bl[1])}${card('sc-bull','Bull (75th pct)',bl[2])}</div>
    <p class="mut" style="font-size:12px;margin:8px 0 0">Average of ${use.map(r=>r.l).join(' and ')} values. Current price ₹${T.fmt(price,2)}.</p>`:'<p class="warn">This company has no positive P/E or P/B, so it cannot be valued on these multiples.</p>'}
    <div style="overflow-x:auto;margin-top:14px"><table class="peer"><thead><tr><th>Multiple</th><th class="num">${esc(s)}</th><th class="num">Peer 25th</th><th class="num">Peer median</th><th class="num">Peer 75th</th><th class="num">Value @ 25th</th><th class="num">@ median</th><th class="num">@ 75th</th><th class="num">Peers used</th></tr></thead><tbody>
    ${rows.map(r=>`<tr><td><b>${r.l}</b></td><td class="num">${ed(o,'own_'+r.k,r.own,0.1,r.d)}x</td>${[0,1,2].map(i=>`<td class="num">${ed(o,`q${i}_${r.k}`,r.qa[i],0.1,r.d)}x</td>`).join('')}${[0,1,2].map(i=>`<td class="num">${r.imp?'₹'+T.fmt(r.imp[i],0):'–'}</td>`).join('')}<td class="num">${r.n}</td></tr>`).join('')}</tbody></table></div>
    ${edBar(o)}
    <p class="mut" style="font-size:12px;margin-top:10px">This is a relative value: it says what the stock would be worth if it traded like its peers, not what it is worth in itself. If the whole group is expensive or cheap, the answer moves with it. Peers with negative or missing multiples are left out.</p></div>`;
  box.querySelectorAll('#msset button').forEach(b=>b.onclick=()=>{MS.set=b.dataset.k;multPanel(s,price)});
  edBind(box,o,()=>multPanel(s,price));
}

// ---------- EV multiples model ----------
async function evPanel(s,price){
  const box=SUMBOX||$('#multbox');if(!box)return;
  const P=await get('data/peers.json','json');
  const me=P&&P.stocks&&P.stocks.find(x=>x.s===s);
  if(!me){box.innerHTML='<div class="card"><p class="mut">Peer data not built yet. Run the Daily refresh once.</p></div>';return}
  const pos=v=>v!=null&&isFinite(v)&&v>0;
  const evm=x=>pos(x.mc)&&pos(x.ebitda)&&x.nd!=null?(x.mc+x.nd)/x.ebitda:null;
  const mine=evm(me);
  if(!pos(me.ebitda)||me.nd==null||!pos(me.mc)||!pos(price)){box.innerHTML='<div class="card"><h3>EV multiples</h3><p class="mut">This company has no positive EBITDA or no balance sheet data, so an EV/EBITDA value cannot be calculated.</p></div>';return}
  const LV=[['ind','Industry'],['sec','Sector'],['macro','NSE group']];
  let lv=null,peers=[];
  for(const [k] of LV){const g=P.stocks.filter(x=>x[k]&&x[k]===me[k]&&x.s!==s&&x.type!=='financial'&&pos(evm(x)));if(g.length>=6){lv=k;peers=g;break}}
  if(!lv){box.innerHTML='<div class="card"><h3>EV multiples</h3><p class="mut">Too few comparable peers (need at least 6 with positive EBITDA) to value this stock on EV/EBITDA.</p></div>';return}
  const allPeers=peers;
  if(MS.set==='size')peers=allPeers.slice().sort((a,b)=>Math.abs(Math.log(a.mc/me.mc))-Math.abs(Math.log(b.mc/me.mc))).slice(0,10);
  const vals=peers.map(evm).filter(pos);
  const o=ovs('ev',s);
  const qd=vals.length>=6?[pctile(vals,.25),pctile(vals,.5),pctile(vals,.75)]:null;
  const qa=[0,1,2].map(i=>o['q'+i]!=null?o['q'+i]:(qd?qd[i]:null));
  const q=qa.every(v=>v!=null&&v>0)?qa:null;
  const E=o.ebitda!=null?o.ebitda:me.ebitda,N=o.nd!=null?o.nd:me.nd,shares=o.sh!=null?o.sh:me.mc/price;
  const imp=q&&shares>0?q.map(m=>(E*m-N)/shares):null;
  if(imp&&imp[1]>0)REGV.ev=imp;
  const up=v=>v!=null&&price?(v/price-1)*100:null;
  const card=(cl,name,v)=>`<div class="sc ${cl}"><div class="sn">${name}</div><div class="sv">${v!=null&&v>0?'₹'+T.fmt(v,0):'–'}</div><div class="su ${cls(up(v))}">${v!=null&&v>0&&up(v)!=null?(up(v)>=0?'+':'')+T.fmt(up(v),1)+'% vs price':''}</div></div>`;
  const lvName=LV.find(x=>x[0]===lv)[1];
  box.innerHTML=`<div class="card mph"><h3>EV multiples <span class="mut" style="font-weight:400;font-size:12px">peers: ${esc(me[lv])} (${esc(lvName)}) · ${peers.length} stocks</span></h3>
    <div class="seg" id="msset" style="margin:0 0 10px"><button data-k="all" class="${MS.set==='all'?'on':''}">All peers (${allPeers.length})</button><button data-k="size" class="${MS.set==='size'?'on':''}">Similar size (10 nearest)</button></div>
    <p class="mut" style="margin-top:0">Applies the peers' EV/EBITDA (25th percentile, median, 75th percentile) to this company's EBITDA, subtracts net debt and minority interest, and divides by shares. Low = bear, median = base, high = bull.</p>
    ${imp?`<div class="scn">${card('sc-bear','Bear (25th pct)',imp[0])}${card('sc-base','Base (median)',imp[1])}${card('sc-bull','Bull (75th pct)',imp[2])}</div>`:'<p class="warn">Fewer than 6 peers in this set, so percentiles are not shown. Switch to All peers.</p>'}
    <div style="overflow-x:auto;margin-top:14px"><table class="peer kv"><thead><tr><th>Item</th><th class="num">Value</th></tr></thead><tbody>
     <tr><td>EBITDA (₹ cr; use a forward estimate if you prefer)</td><td class="num">${ed(o,'ebitda',E,1,0)}</td></tr>
     <tr><td>Net debt + minorities (₹ cr)</td><td class="num">${ed(o,'nd',N,1,0)}</td></tr>
     <tr><td>Shares (crore)</td><td class="num">${ed(o,'sh',shares,0.01,2)}</td></tr>
     <tr><td>Market cap (₹ cr)</td><td class="num">${T.fmt(me.mc,0)}</td></tr>
     <tr><td>${esc(s)} EV/EBITDA</td><td class="num">${mine!=null?T.fmt(mine,1)+'x':'–'}</td></tr>
     <tr><td>Target EV/EBITDA: bear (25th)</td><td class="num">${ed(o,'q0',qa[0],0.1,1)}x</td></tr>
     <tr><td>Target EV/EBITDA: base (median)</td><td class="num">${ed(o,'q1',qa[1],0.1,1)}x</td></tr>
     <tr><td>Target EV/EBITDA: bull (75th)</td><td class="num">${ed(o,'q2',qa[2],0.1,1)}x</td></tr>
     <tr><td>Peers used</td><td class="num">${vals.length}</td></tr></tbody></table></div>
    ${edBar(o)}
    <p class="mut" style="font-size:12px;margin-top:10px">EV = market cap + total debt − cash and short-term investments + minority interest, using the latest annual balance sheet. EBITDA is the latest financial year from Yahoo Finance. Banks and financial companies are excluded. This is a relative value, so it moves with how the peer group is priced.</p></div>`;
  box.querySelectorAll('#msset button').forEach(b=>b.onclick=()=>{MS.set=b.dataset.k;evPanel(s,price)});
  edBind(box,o,()=>evPanel(s,price));
}

// ---------- DDM (dividend discount model) ----------
async function ddmPanel(s,price,dcf,fin){
  const box=SUMBOX||$('#multbox');if(!box)return;
  const st=await get(`data/statements/${s}.json`,'json');
  const P=await get('data/peers.json','json');
  const me=P&&P.stocks&&P.stocks.find(x=>x.s===s);
  const cf=st&&st.annual_cashflow,inc=st&&st.annual_income;
  const row=cf&&(cf.rows.find(r=>/dividend/i.test(r[0])&&/paid/i.test(r[0]))||cf.rows.find(r=>/dividend/i.test(r[0])));
  if(!row||!me||!me.mc||!price){box.innerHTML='<div class="card"><h3>DDM</h3><p class="mut">No dividend history found, so a dividend model cannot be run.</p></div>';return}
  const dates=cf.dates,shares=me.mc/price;  // crore shares
  const hist=row[1].map((v,i)=>({d:dates[i],div:v==null?null:Math.abs(v)/1e7})).filter(x=>x.div!=null).slice(-5);
  const last=hist[hist.length-1];
  if(!last||!(last.div>0)){box.innerHTML='<div class="card"><h3>DDM</h3><p class="mut">No dividend was paid in the latest year, so a dividend model is not meaningful for this stock.</p></div>';return}
  const dps=last.div/shares,yld=dps/price*100;
  const pos=hist.filter(x=>x.div>0);
  let cagr=null;if(pos.length>=3){const n=pos.length-1;cagr=Math.pow(pos[n].div/pos[0].div,1/n)-1}
  const niRow=inc&&(inc.rows.find(r=>/^net income common stockholders$/i.test(r[0]))||inc.rows.find(r=>/^net income$/i.test(r[0])));
  let ni=null;if(niRow){for(let i=niRow[1].length-1;i>=0;i--){if(niRow[1][i]!=null){ni=niRow[1][i]/1e7;break}}}
  const payout=ni&&ni>0?last.div/ni*100:null;
  // cost of equity from the model already used on this stock, else CAPM with the adjusted beta
  let ke=null;
  try{if(dcf){const r=T.recompute(dcf,{rf:A.rf/100,erp:A.erp/100,gT:A.g/100});ke=r&&r.ke}else if(fin){const r=T.finModel(fin,{rf:A.rf/100,erp:A.erp/100,g:A.g/100});ke=r&&r.ke}}catch(e){}
  if(ke==null){const rk=await get(`data/risk/${s}.json`,'json');const beta=rk&&rk.beta&&rk.beta.adjusted!=null?rk.beta.adjusted:1;ke=A.rf/100+beta*A.erp/100}
  const o=ovs('ddm',s);
  const gT0=A.g/100,g10=cagr==null?gT0:Math.min(Math.max(cagr,0),0.12);
  const dpsU=o.dps!=null?o.dps:dps,g1U=o.g1!=null?o.g1/100:g10,gTU=o.gT!=null?o.gT/100:gT0,keU=o.ke!=null?o.ke/100:ke;
  const nU=Math.max(1,Math.min(15,Math.round(o.n!=null?o.n:5))),gsU=(o.gs!=null?o.gs:3)/100,ksU=(o.ks!=null?o.ks:1)/100;
  const run=(g1,k,gT)=>{gT=Math.min(gT,k-0.01);let pv=0,d=dpsU;for(let t=1;t<=nU;t++){d*=1+g1;pv+=d/Math.pow(1+k,t)}const tv=d*(1+gT)/(k-gT);return pv+tv/Math.pow(1+k,nU)};
  const sc=[['sc-bear','Bear',run(Math.max(g1U-gsU,0),keU+ksU,gTU-ksU)],['sc-base','Base',run(g1U,keU,gTU)],['sc-bull','Bull',run(g1U+gsU,keU-ksU,gTU+0.005)]];
  const low=(payout!=null&&payout<35)||yld<2;
  REGV.ddm=Object.assign(sc.map(x=>x[2]),{low});
  const up=v=>price?(v/price-1)*100:null;
  box.innerHTML=`<div class="card mph"><h3>DDM <span class="mut" style="font-weight:400;font-size:12px">two-stage dividend discount model</span></h3>
    <p class="mut" style="margin-top:0">Values the stock as the present value of its dividends: five years of growth, then a steady terminal growth rate. Cost of equity and terminal growth follow your Assumptions settings.</p>
    ${low?`<p class="warn" style="margin:8px 0"><b>Low reliability for this stock.</b> It pays out only ${payout!=null?T.fmt(payout,0)+'% of earnings':'a small part of earnings'} (yield ${T.fmt(yld,1)}%) and reinvests the rest. A dividend model counts only the cash paid out, so it undervalues companies that retain most profit to grow. Banks in particular are better valued on the Justified P/B or Residual income models.</p>`:''}
    <div class="scn">${sc.map(([c,n,v])=>`<div class="sc ${c}"><div class="sn">${n}</div><div class="sv">₹${T.fmt(v,0)}</div><div class="su ${cls(up(v))}">${up(v)>=0?'+':''}${T.fmt(up(v),1)}% vs price</div></div>`).join('')}</div>
    <div style="overflow-x:auto;margin-top:14px"><table class="peer kv"><thead><tr><th>Input</th><th class="num">Value</th></tr></thead><tbody>
     <tr><td>Dividends paid, ${esc(last.d.slice(0,4))} (₹ cr)</td><td class="num">${T.fmt(last.div,0)}</td></tr>
     <tr><td>Dividend per share, ₹ (approx.)</td><td class="num">${ed(o,'dps',dpsU,0.1,2)}</td></tr>
     <tr><td>Dividend yield</td><td class="num">${T.fmt(dpsU/price*100,2)}%</td></tr>
     <tr><td>Payout ratio (of net income)</td><td class="num">${payout!=null?T.fmt(payout,0)+'%':'–'}</td></tr>
     <tr><td>Dividend growth, ${pos.length>=3?(pos.length-1)+'-year CAGR':'not enough history'}</td><td class="num">${cagr!=null?T.fmt(cagr*100,1)+'%':'–'}</td></tr>
     <tr><td>Stage 1 growth, % (base)</td><td class="num">${ed(o,'g1',g1U*100,0.5,1)}</td></tr>
     <tr><td>Stage 1 length, years</td><td class="num">${ed(o,'n',nU,1,0)}</td></tr>
     <tr><td>Terminal growth, % (default: your GDP growth setting)</td><td class="num">${ed(o,'gT',gTU*100,0.1,1)}</td></tr>
     <tr><td>Cost of equity, %</td><td class="num">${ed(o,'ke',keU*100,0.25,2)}</td></tr>
     <tr><td>Bear / bull growth spread, points</td><td class="num">${ed(o,'gs',gsU*100,0.5,1)}</td></tr>
     <tr><td>Bear / bull cost of equity spread, points</td><td class="num">${ed(o,'ks',ksU*100,0.25,2)}</td></tr></tbody></table></div>
    ${edBar(o)}
    <p class="mut" style="font-size:12px;margin-top:10px">Dividend per share is total dividends paid divided by today's share count, so it is approximate. One-off or special dividends raise it and can overstate the value. Stage 1 growth is the past dividend growth, kept between 0% and 12%. Terminal growth is your long-run GDP growth assumption. Bear lowers growth by the growth spread, raises cost of equity by the spread and lowers terminal growth by the same spread; Bull does the reverse (terminal growth rises only 0.5 point).</p></div>`;
  edBind(box,o,()=>ddmPanel(s,price,dcf,fin));
}


// ---------- Residual income model ----------
async function riPanel(s,price,dcf,fin){
  const box=SUMBOX||$('#multbox');if(!box)return;
  const P=await get('data/peers.json','json');
  const me=P&&P.stocks&&P.stocks.find(x=>x.s===s);
  const st=await get(`data/statements/${s}.json`,'json');
  let bv=null,roe=null;
  if(fin&&fin.model&&fin.model.bvps){bv=fin.model.bvps;roe=fin.model.roe_pct}
  if(bv==null&&me&&me.pb>0&&price)bv=price/me.pb;
  if(roe==null&&me)roe=me.roe;
  if(!(bv>0)||roe==null||!isFinite(roe)){box.innerHTML='<div class="card"><h3>Residual income</h3><p class="mut">Book value or ROE is not available for this stock, so the model cannot be run.</p></div>';return}
  let ke=null;
  try{if(dcf){const r=T.recompute(dcf,{rf:A.rf/100,erp:A.erp/100,gT:A.g/100});ke=r&&r.ke}else if(fin){const r=T.finModel(fin,{rf:A.rf/100,erp:A.erp/100,g:A.g/100});ke=r&&r.ke}}catch(e){}
  if(ke==null){const rk=await get(`data/risk/${s}.json`,'json');const beta=rk&&rk.beta&&rk.beta.adjusted!=null?rk.beta.adjusted:1;ke=A.rf/100+beta*A.erp/100}
  // payout from the latest year's dividends and net income
  let po=null;
  try{const cf=st&&st.annual_cashflow,inc=st&&st.annual_income;
    const dr=cf&&(cf.rows.find(r=>/dividend/i.test(r[0])&&/paid/i.test(r[0]))||cf.rows.find(r=>/dividend/i.test(r[0])));
    const nr=inc&&(inc.rows.find(r=>/^net income common stockholders$/i.test(r[0]))||inc.rows.find(r=>/^net income$/i.test(r[0])));
    const lastv=r=>{for(let i=r[1].length-1;i>=0;i--)if(r[1][i]!=null)return r[1][i];return null};
    if(dr&&nr){const d=lastv(dr),n=lastv(nr);if(d!=null&&n>0)po=Math.min(0.9,Math.abs(d)/n)}}catch(e){}
  const poDef=po!=null?po*100:30;
  const o=ovs('ri',s);
  const bvU=o.bv!=null?o.bv:bv,roeU=(o.roe!=null?o.roe:roe)/100,keU=o.ke!=null?o.ke/100:ke,poU=Math.min(1,Math.max(0,(o.po!=null?o.po:poDef)/100));
  const nU=Math.max(1,Math.min(20,Math.round(o.n!=null?o.n:10))),gTU=(o.gT!=null?o.gT:A.g)/100,rsU=(o.rs!=null?o.rs:2)/100,ksU=(o.ks!=null?o.ks:1)/100;
  const run=(r0,k,rT)=>{let b=bvU,pv=0;for(let t=1;t<=nU;t++){const r=r0+(rT-r0)*t/nU;pv+=(r-k)*b/Math.pow(1+k,t);b*=1+r*(1-poU)}
    if(rT>k){const g=Math.min(gTU,k-0.01);pv+=((rT-k)*b/(k-g))/Math.pow(1+k,nU)}
    return Math.max(0,bvU+pv)};
  const rTb=o.roeT!=null?o.roeT/100:null;
  const sc=[['sc-bear','Bear',run(roeU-rsU,keU+ksU,rTb!=null?rTb:keU+ksU)],['sc-base','Base',run(roeU,keU,rTb!=null?rTb:keU)],['sc-bull','Bull',run(roeU+rsU,keU-ksU,rTb!=null?rTb:keU-ksU)]];
  REGV.ri=sc.map(x=>x[2]);
  const up=v=>price?(v/price-1)*100:null;
  box.innerHTML=`<div class="card mph"><h3>Residual income <span class="mut" style="font-weight:400;font-size:12px">book value plus the value of excess returns</span></h3>
    <p class="mut" style="margin-top:0">Value = book value per share + present value of profits earned above the cost of equity. ROE fades in a straight line from today's level to the long-term ROE over the forecast years, and book value grows by the profit that is retained.</p>
    <div class="scn">${sc.map(([c,n,v])=>`<div class="sc ${c}"><div class="sn">${n}</div><div class="sv">₹${T.fmt(v,0)}</div><div class="su ${cls(up(v))}">${up(v)>=0?'+':''}${T.fmt(up(v),1)}% vs price</div></div>`).join('')}</div>
    <div style="overflow-x:auto;margin-top:14px"><table class="peer kv"><thead><tr><th>Input</th><th class="num">Value</th></tr></thead><tbody>
     <tr><td>Book value per share, ₹</td><td class="num">${ed(o,'bv',bvU,1,1)}</td></tr>
     <tr><td>Current P/B</td><td class="num">${T.fmt(price/bvU,2)}x</td></tr>
     <tr><td>Return on equity today, %</td><td class="num">${ed(o,'roe',roeU*100,0.5,1)}</td></tr>
     <tr><td>Cost of equity, %</td><td class="num">${ed(o,'ke',keU*100,0.25,2)}</td></tr>
     <tr><td>Long-term ROE, % (default: equals cost of equity, so excess returns fade away)</td><td class="num">${ed(o,'roeT',rTb!=null?rTb*100:keU*100,0.5,1)}</td></tr>
     <tr><td>Fade period, years</td><td class="num">${ed(o,'n',nU,1,0)}</td></tr>
     <tr><td>Dividend payout, % of profit${po==null?' (assumed, no data)':''}</td><td class="num">${ed(o,'po',poU*100,5,0)}</td></tr>
     <tr><td>Terminal growth, % (used only if long-term ROE is above cost of equity)</td><td class="num">${ed(o,'gT',gTU*100,0.1,1)}</td></tr>
     <tr><td>Bear / bull ROE spread, points</td><td class="num">${ed(o,'rs',rsU*100,0.5,1)}</td></tr>
     <tr><td>Bear / bull cost of equity spread, points</td><td class="num">${ed(o,'ks',ksU*100,0.25,2)}</td></tr></tbody></table></div>
    ${edBar(o)}
    <p class="mut" style="font-size:12px;margin-top:10px">Best for banks, NBFCs and other companies where book value is meaningful. The default assumes excess returns fade to zero, which is conservative: a business that keeps earning above its cost of equity is worth more, so raise the long-term ROE if you believe in a lasting advantage. ROE and book value come from the latest annual data. Bear lowers ROE and raises cost of equity by the spreads; Bull does the reverse.</p></div>`;
  edBind(box,o,()=>riPanel(s,price,dcf,fin));
}

// ---------- Asset based (net asset value) ----------
async function assetPanel(s,price){
  const box=SUMBOX||$('#multbox');if(!box)return;
  const P=await get('data/peers.json','json');
  const me=P&&P.stocks&&P.stocks.find(x=>x.s===s);
  const st=await get(`data/statements/${s}.json`,'json');
  const bs=st&&st.annual_balance;
  const lastv=r=>{if(!r)return null;for(let i=r[1].length-1;i>=0;i--)if(r[1][i]!=null)return r[1][i];return null};
  const find=(...res)=>{if(!bs)return null;for(const re of res){const r=bs.rows.find(x=>re.test(x[0]));if(r&&lastv(r)!=null)return r}return null};
  const eqR=find(/^stockholders equity$/i,/^common stock equity$/i,/^total equity gross minority interest$/i);
  if(!eqR||!me||!me.mc||!price){box.innerHTML='<div class="card"><h3>Asset based</h3><p class="mut">No balance sheet found for this stock, so a net asset value cannot be calculated.</p></div>';return}
  const cr=v=>v==null?null:v/1e7;
  const eq=cr(lastv(eqR));
  const gwR=find(/^goodwill and other intangible assets$/i);
  let intang=gwR?cr(lastv(gwR)):null;
  if(intang==null){const g=find(/^goodwill$/i),i=find(/other intangible assets/i);intang=(g?cr(lastv(g)):0)+(i?cr(lastv(i)):0)}
  const shares=me.mc/price;
  const o=ovs('asset',s);
  const eqU=o.eq!=null?o.eq:eq,inU=o.int!=null?o.int:intang,rvU=o.rv!=null?o.rv:0,shU=o.sh!=null?o.sh:shares,spU=(o.sp!=null?o.sp:15)/100;
  const nav=(eqU-inU+rvU)/shU;
  const sc=[['sc-bear','Bear',nav*(1-spU)],['sc-base','Base',nav],['sc-bull','Bull',nav*(1+spU)]];
  if(nav>0)REGV.asset=sc.map(x=>x[2]);
  const up=v=>price?(v/price-1)*100:null;
  box.innerHTML=`<div class="card mph"><h3>Asset based <span class="mut" style="font-weight:400;font-size:12px">net asset value per share</span></h3>
    <p class="mut" style="margin-top:0">Value = shareholders' equity − goodwill and intangibles + your revaluation adjustment, divided by shares. It says what the balance sheet is worth, not what the earnings are worth.</p>
    <div class="scn">${sc.map(([c,n,v])=>`<div class="sc ${c}"><div class="sn">${n}</div><div class="sv">${v>0?'₹'+T.fmt(v,0):'–'}</div><div class="su ${cls(up(v))}">${v>0?(up(v)>=0?'+':'')+T.fmt(up(v),1)+'% vs price':''}</div></div>`).join('')}</div>
    <div style="overflow-x:auto;margin-top:14px"><table class="peer kv"><thead><tr><th>Input</th><th class="num">Value</th></tr></thead><tbody>
     <tr><td>Shareholders' equity (₹ cr, latest year)</td><td class="num">${ed(o,'eq',eqU,1,0)}</td></tr>
     <tr><td>Goodwill and intangibles (₹ cr)</td><td class="num">${ed(o,'int',inU,1,0)}</td></tr>
     <tr><td>Revaluation adjustment (₹ cr; + if assets such as land or investments are worth more than book, − if less)</td><td class="num">${ed(o,'rv',rvU,1,0)}</td></tr>
     <tr><td>Shares (crore)</td><td class="num">${ed(o,'sh',shU,0.01,2)}</td></tr>
     <tr><td>Net asset value per share, ₹</td><td class="num">${T.fmt(nav,1)}</td></tr>
     <tr><td>Price / net asset value</td><td class="num">${nav>0?T.fmt(price/nav,2)+'x':'–'}</td></tr>
     <tr><td>Bear / bull spread around NAV, %</td><td class="num">${ed(o,'sp',spU*100,1,0)}</td></tr></tbody></table></div>
    ${edBar(o)}
    <p class="mut" style="font-size:12px;margin-top:10px">Most useful for asset-heavy companies, holding companies and as a floor value. It undervalues asset-light businesses whose worth lies in earnings and brands. The bear and bull values simply move NAV down and up by the spread, as they are not forecasts. Book values are as reported, not market values.</p></div>`;
  edBind(box,o,()=>assetPanel(s,price));
}


// ---------- Earnings power value ----------
async function epvPanel(s,price,dcf,fin){
  const box=SUMBOX||$('#multbox');if(!box)return;
  const P=await get('data/peers.json','json');
  const me=P&&P.stocks&&P.stocks.find(x=>x.s===s);
  const st=await get(`data/statements/${s}.json`,'json');
  const inc=st&&st.annual_income;
  const find=(...res)=>{if(!inc)return null;for(const re of res){const r=inc.rows.find(x=>re.test(x[0]));if(r&&r[1].some(v=>v!=null))return r}return null};
  const rv=find(/^total revenue$/i,/^operating revenue$/i),eb=find(/^ebit$/i,/^operating income$/i,/^normalized ebit$/i);
  if(!rv||!eb||!me||!me.mc||!price){box.innerHTML='<div class="card"><h3>Earnings power</h3><p class="mut">Revenue or operating profit is not available for this stock, so the model cannot be run.</p></div>';return}
  const ms=[];rv[1].forEach((v,i)=>{const e=eb[1][i];if(v>0&&e!=null)ms.push(e/v*100)});
  const lastRev=(()=>{for(let i=rv[1].length-1;i>=0;i--)if(rv[1][i]!=null)return rv[1][i]/1e7;return null})();
  if(!ms.length||!(lastRev>0)){box.innerHTML='<div class="card"><h3>Earnings power</h3><p class="mut">Not enough history to estimate a normal margin.</p></div>';return}
  const mAvg=ms.reduce((a,b)=>a+b,0)/ms.length;
  let w=null;try{if(dcf){const r=T.recompute(dcf,{rf:A.rf/100,erp:A.erp/100,gT:A.g/100});w=r&&r.wacc}}catch(e){}
  if(w==null){const rk=await get(`data/risk/${s}.json`,'json');const beta=rk&&rk.beta&&rk.beta.adjusted!=null?rk.beta.adjusted:1;w=A.rf/100+beta*A.erp/100}
  const o=ovs('epv',s);
  const revU=o.rev!=null?o.rev:lastRev,mU=(o.m!=null?o.m:mAvg)/100,txU=(o.tx!=null?o.tx:25)/100,wU=(o.w!=null?o.w:w*100)/100,ndU=o.nd!=null?o.nd:(me.nd!=null?me.nd:0),shU=o.sh!=null?o.sh:me.mc/price;
  const msU=(o.ms!=null?o.ms:2)/100,wsU=(o.ws!=null?o.ws:1)/100;
  const val=(m,wc)=>wc>0.01?(revU*m*(1-txU)/wc-ndU)/shU:null;
  const sc=[['sc-bear','Bear',val(mU-msU,wU+wsU)],['sc-base','Base',val(mU,wU)],['sc-bull','Bull',val(mU+msU,wU-wsU)]];
  if(sc.every(x=>x[2]!=null&&x[2]>0))REGV.epv=sc.map(x=>x[2]);
  const up=v=>v!=null&&price?(v/price-1)*100:null;
  const nopat=revU*mU*(1-txU);
  box.innerHTML=`<div class="card mph"><h3>Earnings power <span class="mut" style="font-weight:400;font-size:12px">no-growth value of today's earning capacity</span></h3>
    <p class="mut" style="margin-top:0">Value = normalised after-tax operating profit ÷ cost of capital, minus net debt, divided by shares. It assumes zero growth, so it shows what the business is worth if it simply keeps earning what it normally earns.</p>
    <div class="scn">${sc.map(([c,n,v])=>`<div class="sc ${c}"><div class="sn">${n}</div><div class="sv">${v!=null&&v>0?'₹'+T.fmt(v,0):'–'}</div><div class="su ${cls(up(v))}">${v!=null&&v>0?(up(v)>=0?'+':'')+T.fmt(up(v),1)+'% vs price':''}</div></div>`).join('')}</div>
    <div style="overflow-x:auto;margin-top:14px"><table class="peer kv"><thead><tr><th>Input</th><th class="num">Value</th></tr></thead><tbody>
     <tr><td>Revenue, latest year (₹ cr)</td><td class="num">${ed(o,'rev',revU,1,0)}</td></tr>
     <tr><td>Normal operating (EBIT) margin, % (default: average of ${ms.length} years)</td><td class="num">${ed(o,'m',mU*100,0.5,1)}</td></tr>
     <tr><td>Tax rate, %</td><td class="num">${ed(o,'tx',txU*100,0.5,1)}</td></tr>
     <tr><td>Normalised after-tax operating profit (₹ cr)</td><td class="num">${T.fmt(nopat,0)}</td></tr>
     <tr><td>Cost of capital (WACC), %</td><td class="num">${ed(o,'w',wU*100,0.25,2)}</td></tr>
     <tr><td>Net debt + minorities (₹ cr)</td><td class="num">${ed(o,'nd',ndU,1,0)}</td></tr>
     <tr><td>Shares (crore)</td><td class="num">${ed(o,'sh',shU,0.01,2)}</td></tr>
     <tr><td>Bear / bull margin spread, points</td><td class="num">${ed(o,'ms',msU*100,0.5,1)}</td></tr>
     <tr><td>Bear / bull WACC spread, points</td><td class="num">${ed(o,'ws',wsU*100,0.25,2)}</td></tr></tbody></table></div>
    ${edBar(o)}
    <p class="mut" style="font-size:12px;margin-top:10px">Best for mature, steady businesses. It is conservative for growing companies because it gives no credit for growth, and it treats depreciation as a fair stand-in for maintenance spending. WACC comes from the DCF model when the stock has one. Use it next to the DCF: the gap between the two is the value the market or the DCF puts on growth.</p></div>`;
  edBind(box,o,()=>epvPanel(s,price,dcf,fin));
}

// ---------- Graham value ----------
async function grahamPanel(s,price){
  const box=SUMBOX||$('#multbox');if(!box)return;
  const P=await get('data/peers.json','json');
  const me=P&&P.stocks&&P.stocks.find(x=>x.s===s);
  if(!me||!(price>0)||!(me.pe>0)||!(me.pb>0)){box.innerHTML='<div class="card"><h3>Graham value</h3><p class="mut">Needs positive earnings and book value, which this stock does not have.</p></div>';return}
  const eps0=price/me.pe,bv0=price/me.pb,g0=me.ng!=null?Math.min(15,Math.max(0,me.ng)):5;
  const o=ovs('graham',s);
  const epsU=o.eps!=null?o.eps:eps0,bvU=o.bv!=null?o.bv:bv0,gU=o.g!=null?o.g:g0,yU=o.y!=null?o.y:A.rf+1,mU=o.mult!=null?o.mult:22.5;
  const gn=epsU>0&&bvU>0?Math.sqrt(mU*epsU*bvU):null;
  const gf=epsU>0&&yU>0?epsU*(8.5+2*gU)*4.4/yU:null;
  const vals=[gn,gf].filter(v=>v!=null&&v>0);
  const sc=vals.length?[Math.min(...vals),vals.reduce((a,b)=>a+b,0)/vals.length,Math.max(...vals)]:null;
  if(sc)REGV.graham=sc;
  const up=v=>v!=null&&price?(v/price-1)*100:null;
  box.innerHTML=`<div class="card mph"><h3>Graham value <span class="mut" style="font-weight:400;font-size:12px">two quick formulas from Benjamin Graham</span></h3>
    <p class="mut" style="margin-top:0">Graham number = √(22.5 × EPS × book value per share): the most a defensive investor should pay. Growth formula = EPS × (8.5 + 2 × growth) × 4.4 ÷ bond yield. The range below runs between the two values, with the average as base.</p>
    ${sc?`<div class="scn">${[['sc-bear','Lower of the two',sc[0]],['sc-base','Average',sc[1]],['sc-bull','Higher of the two',sc[2]]].map(([c,n,v])=>`<div class="sc ${c}"><div class="sn">${n}</div><div class="sv">₹${T.fmt(v,0)}</div><div class="su ${cls(up(v))}">${up(v)>=0?'+':''}${T.fmt(up(v),1)}% vs price</div></div>`).join('')}</div>`:'<p class="warn">Needs positive EPS and bond yield.</p>'}
    <div style="overflow-x:auto;margin-top:14px"><table class="peer kv"><thead><tr><th>Input</th><th class="num">Value</th></tr></thead><tbody>
     <tr><td>Earnings per share, ₹ (price ÷ P/E)</td><td class="num">${ed(o,'eps',epsU,0.5,2)}</td></tr>
     <tr><td>Book value per share, ₹ (price ÷ P/B)</td><td class="num">${ed(o,'bv',bvU,1,1)}</td></tr>
     <tr><td>Graham multiplier (P/E × P/B ceiling)</td><td class="num">${ed(o,'mult',mU,0.5,1)}</td></tr>
     <tr><td>Expected growth, % a year (default: net income CAGR, kept between 0 and 15)</td><td class="num">${ed(o,'g',gU,0.5,1)}</td></tr>
     <tr><td>Bond yield, % (default: risk-free rate + 1 point)</td><td class="num">${ed(o,'y',yU,0.1,2)}</td></tr>
     <tr><td>Graham number, ₹</td><td class="num">${gn!=null?T.fmt(gn,0):'–'}</td></tr>
     <tr><td>Growth formula value, ₹</td><td class="num">${gf!=null?T.fmt(gf,0):'–'}</td></tr></tbody></table></div>
    ${edBar(o)}
    <p class="mut" style="font-size:12px;margin-top:10px">These are screening rules of thumb from the 1930s to 1960s, not full valuations, and the constants (22.5, 8.5, 4.4) were set for US markets. They suit steady, profitable companies and are least reliable for fast growers and cyclicals. EPS and book value use the latest annual data.</p></div>`;
  edBind(box,o,()=>grahamPanel(s,price));
}

// ---------- saved manual inputs (SOTP, Embedded value) ----------
const LSK=k=>'tl_'+k;
const lsGet=k=>{try{return JSON.parse(localStorage.getItem(LSK(k))||'null')}catch(e){return null}};
const lsSet=(k,v)=>{try{if(v==null)localStorage.removeItem(LSK(k));else localStorage.setItem(LSK(k),JSON.stringify(v))}catch(e){}};
const numIn=(k,val,step,dp,extra)=>`<input class="ed${extra||''}" data-k="${k}" type="number" step="${step||'any'}" value="${val==null||!isFinite(val)?'':(+val).toFixed(dp==null?2:dp)}">`;

// ---------- Sum of the parts ----------
const SOTP_KINDS={ebitda:['EV / EBITDA','EBITDA, ₹ cr',true],pe:['P / E','Net profit, ₹ cr',false],sales:['EV / Sales','Revenue, ₹ cr',true],pb:['P / B','Book value, ₹ cr',false],listed:['Listed stake','Market value of stake, ₹ cr',false],other:['Fixed value','Value, ₹ cr',false]};
async function sotpPanel(s,price){
  const box=SUMBOX||$('#multbox');if(!box)return;
  const P=await get('data/peers.json','json');
  const me=P&&P.stocks&&P.stocks.find(x=>x.s===s);
  if(!me||!(price>0)||!(me.mc>0)){box.innerHTML='<div class="card"><h3>Sum of the parts</h3><p class="mut">Market data for this stock is not available.</p></div>';return}
  let D=lsGet('sotp_'+s);
  if(!D)D={rows:[],nd:me.nd!=null?+me.nd.toFixed(0):0,mi:0,hd:me.type==='financial'?20:15,sh:+(me.mc/price).toFixed(2),sp:20};
  const save=()=>lsSet('sotp_'+s,D);
  const rows=D.rows;
  const val=(r,m)=>{const k=SOTP_KINDS[r.kind]||SOTP_KINDS.ebitda,v=(+r.metric||0)*(r.kind==='listed'||r.kind==='other'?1:(+r.mult||0)*m);return v};
  const calc=m=>{let ev=0,eq=0;rows.forEach(r=>{const v=val(r,m);if(SOTP_KINDS[r.kind||'ebitda'][2])ev+=v;else eq+=v});
    const gross=ev-(+D.nd||0)-(+D.mi||0)+eq,net=gross*(1-(+D.hd||0)/100);return{ev,eq,gross,net,ps:D.sh>0?net/D.sh:null}};
  const spr=(+D.sp||0)/100;
  const res=rows.length?[calc(1-spr),calc(1),calc(1+spr)]:null;
  const sc=res?res.map(x=>x.ps):null;
  if(sc&&sc.every(v=>v!=null&&v>0))REGV.sotp=sc;
  const up=v=>v!=null&&price?(v/price-1)*100:null;
  box.innerHTML=`<div class="card mph"><h3>Sum of the parts <span class="mut" style="font-weight:400;font-size:12px">value each segment on its own, then add up</span></h3>
   <p class="mut" style="margin-top:0">Segment figures are not available from any free data feed, so you enter them from the company's annual report or investor presentation (segment note). Add one row per business, pick how it is valued, and type its profit measure and a fair multiple. Your entries are saved in this browser for ${esc(s)}.</p>
   ${res&&sc[1]>0?`<div class="scn">${[['sc-bear','Bear',sc[0]],['sc-base','Base',sc[1]],['sc-bull','Bull',sc[2]]].map(([c,n,v])=>`<div class="sc ${c}"><div class="sn">${n}</div><div class="sv">${v>0?'₹'+T.fmt(v,0):'–'}</div><div class="su ${cls(up(v))}">${v>0?(up(v)>=0?'+':'')+T.fmt(up(v),1)+'% vs price':''}</div></div>`).join('')}</div>`:`<p class="warn">${rows.length?'The parts add up to zero or less after debt, so no value per share can be shown.':'No segments yet. Press "Add segment" to start.'}</p>`}
   <div style="overflow-x:auto;margin-top:14px"><table class="peer kv sotp"><thead><tr><th>Segment</th><th>Method</th><th class="num">Profit measure, ₹ cr</th><th class="num">Multiple</th><th class="num">Value, ₹ cr</th><th></th></tr></thead><tbody>
   ${rows.map((r,i)=>{const kd=r.kind||'ebitda',fixed=kd==='listed'||kd==='other';return `<tr><td><input class="ed tx" data-r="${i}" data-f="name" type="text" value="${esc(r.name||'')}" placeholder="Segment name"></td>
     <td><select class="ed" data-r="${i}" data-f="kind">${Object.keys(SOTP_KINDS).map(k=>`<option value="${k}"${k===kd?' selected':''}>${SOTP_KINDS[k][0]}</option>`).join('')}</select></td>
     <td class="num"><input class="ed" data-r="${i}" data-f="metric" type="number" step="any" value="${r.metric!=null&&r.metric!==''?r.metric:''}" title="${esc(SOTP_KINDS[kd][1])}" placeholder="${esc(SOTP_KINDS[kd][1])}"></td>
     <td class="num">${fixed?'–':`<input class="ed" data-r="${i}" data-f="mult" type="number" step="0.5" value="${r.mult!=null&&r.mult!==''?r.mult:''}">x`}</td>
     <td class="num">₹${T.fmt(val(r,1),0)}</td><td><button class="rmrow" data-r="${i}" title="Remove">×</button></td></tr>`}).join('')}
   </tbody></table></div>
   <p style="margin:10px 0"><button id="sotp-add" class="ed-reset">+ Add segment</button> ${rows.length?'<button id="sotp-clear" class="ed-reset">Clear all</button>':''}</p>
   <table class="peer kv"><thead><tr><th>Adjustment</th><th class="num">Value</th></tr></thead><tbody>
    <tr><td>Sum of enterprise-value segments, ₹ cr</td><td class="num">${res?T.fmt(res[1].ev,0):'–'}</td></tr>
    <tr><td>Sum of equity-value segments (P/E, P/B, listed stakes, fixed), ₹ cr</td><td class="num">${res?T.fmt(res[1].eq,0):'–'}</td></tr>
    <tr><td>Net debt, ₹ cr (default: latest balance sheet)</td><td class="num">${numIn('nd',D.nd,10,0)}</td></tr>
    <tr><td>Minority interest and other claims, ₹ cr</td><td class="num">${numIn('mi',D.mi,10,0)}</td></tr>
    <tr><td>Holding-company discount, % (applied to the total)</td><td class="num">${numIn('hd',D.hd,5,0)}</td></tr>
    <tr><td>Shares outstanding, crore (price ÷ market cap)</td><td class="num">${numIn('sh',D.sh,0.1,2)}</td></tr>
    <tr><td>Bear / bull spread on multiples, %</td><td class="num">${numIn('sp',D.sp,5,0)}</td></tr></tbody></table>
   <p class="mut" style="font-size:12px;margin-top:10px">Use EV methods for operating businesses, which then bear the net debt. Use "Listed stake" for holdings you can price on the market (your share of the subsidiary's market cap), and apply the holding-company discount, usually 10% to 30%, because such holdings trade below their parts. Bear and bull scale the multiples (not stakes or fixed values) by the spread. Values for the whole company need to include every segment, or the answer will be too low.</p></div>`;
  box.querySelectorAll('[data-f]').forEach(i=>i.onchange=()=>{const r=rows[+i.dataset.r],f=i.dataset.f;r[f]=i.type==='number'?(i.value===''?'':parseFloat(i.value)):i.value;if(f==='kind'&&!r.mult)r.mult=r.kind==='pe'?20:r.kind==='pb'?3:r.kind==='sales'?2:12;save();sotpPanel(s,price)});
  box.querySelectorAll('[data-k]').forEach(i=>i.onchange=()=>{const v=parseFloat(i.value);D[i.dataset.k]=isFinite(v)?v:0;save();sotpPanel(s,price)});
  box.querySelectorAll('.rmrow').forEach(b=>b.onclick=()=>{rows.splice(+b.dataset.r,1);save();sotpPanel(s,price)});
  const ad=$('#sotp-add',box);if(ad)ad.onclick=()=>{rows.push({name:'',kind:'ebitda',metric:'',mult:12});save();sotpPanel(s,price)};
  const cl=$('#sotp-clear',box);if(cl)cl.onclick=()=>{D.rows=[];save();sotpPanel(s,price)};
}

// ---------- Embedded value (life insurers) ----------
async function embvPanel(s,price){
  const box=SUMBOX||$('#multbox');if(!box)return;
  const P=await get('data/peers.json','json');
  const me=P&&P.stocks&&P.stocks.find(x=>x.s===s);
  if(!me||!(price>0)||!(me.mc>0)){box.innerHTML='<div class="card"><h3>Embedded value</h3><p class="mut">Market data for this stock is not available.</p></div>';return}
  const sh0=me.mc/price;
  let D=lsGet('embv_'+s)||{ev:'',vnb:'',vg:15,x:18,pev:'',sh:+sh0.toFixed(2),sp:20,mg:''};
  const save=()=>lsSet('embv_'+s,D);
  const ok=+D.ev>0&&+D.sh>0;
  const spr=(+D.sp||0)/100;
  const apprais=m=>ok?((+D.ev)+(+D.vnb||0)*(+D.x||0)*m)/D.sh:null;
  const pevV=ok&&+D.pev>0?(+D.ev)*(+D.pev)/D.sh:null;
  // base = appraisal value (EV + VNB multiple). bear/bull scale the VNB multiple; if only P/EV is given, use that.
  let sc=null;
  if(ok&&+D.vnb>0)sc=[apprais(1-spr),apprais(1),apprais(1+spr)];
  else if(pevV)sc=[pevV*(1-spr),pevV,pevV*(1+spr)];
  if(sc&&sc.every(v=>v>0))REGV.embv=sc;
  const up=v=>v!=null&&price?(v/price-1)*100:null;
  const curPEV=ok?(me.mc/(+D.ev)):null,fwd=+D.vnb>0?(+D.vnb)*(1+(+D.vg||0)/100):null;
  box.innerHTML=`<div class="card mph"><h3>Embedded value <span class="mut" style="font-weight:400;font-size:12px">for life insurers</span></h3>
   <p class="mut" style="margin-top:0">Value per share = embedded value (EV, the net worth plus the value of the policies already sold) + value of future new business, taken as a multiple of this year's value of new business (VNB). Embedded value and VNB are published by the insurer each quarter or half-year, but are not in any free data feed, so enter the latest figures from the investor presentation. They are saved in this browser for ${esc(s)}.</p>
   ${sc&&sc.every(v=>v>0)?`<div class="scn">${[['sc-bear','Bear',sc[0]],['sc-base','Base',sc[1]],['sc-bull','Bull',sc[2]]].map(([c,n,v])=>`<div class="sc ${c}"><div class="sn">${n}</div><div class="sv">₹${T.fmt(v,0)}</div><div class="su ${cls(up(v))}">${up(v)>=0?'+':''}${T.fmt(up(v),1)}% vs price</div></div>`).join('')}</div>`:'<p class="warn">Enter the embedded value (and VNB, or a target P/EV) below to see a value.</p>'}
   <div style="overflow-x:auto;margin-top:14px"><table class="peer kv"><thead><tr><th>Input</th><th class="num">Value</th></tr></thead><tbody>
    <tr><td>Embedded value, ₹ crore (latest reported)</td><td class="num">${numIn('ev',D.ev,100,0)}</td></tr>
    <tr><td>Value of new business (VNB), ₹ crore (last full year)</td><td class="num">${numIn('vnb',D.vnb,10,0)}</td></tr>
    <tr><td>Multiple on VNB, times (typical range 12 to 25)</td><td class="num">${numIn('x',D.x,0.5,1)}</td></tr>
    <tr><td>Target P/EV, times (optional; used when VNB is blank)</td><td class="num">${numIn('pev',D.pev,0.1,2)}</td></tr>
    <tr><td>VNB growth, % a year (information only)</td><td class="num">${numIn('vg',D.vg,1,0)}</td></tr>
    <tr><td>Shares outstanding, crore (market cap ÷ price)</td><td class="num">${numIn('sh',D.sh,0.1,2)}</td></tr>
    <tr><td>Bear / bull spread on the VNB multiple, %</td><td class="num">${numIn('sp',D.sp,5,0)}</td></tr>
    <tr><td>Market cap, ₹ crore</td><td class="num">${T.fmt(me.mc,0)}</td></tr>
    <tr><td>Current P/EV</td><td class="num">${curPEV?T.fmt(curPEV,2)+'x':'–'}</td></tr>
    <tr><td>Embedded value per share, ₹</td><td class="num">${ok?T.fmt((+D.ev)/D.sh,0):'–'}</td></tr>
    ${fwd?`<tr><td>Next year VNB at this growth, ₹ crore</td><td class="num">${T.fmt(fwd,0)}</td></tr>`:''}</tbody></table></div>
   <p style="margin:10px 0"><button id="embv-clear" class="ed-reset">Clear saved figures</button></p>
   <p class="mut" style="font-size:12px;margin-top:6px">Use the same basis for embedded value and VNB (for example both "Indian Embedded Value" as reported). A higher multiple on VNB suits a faster-growing insurer with a high VNB margin. Insurers usually trade between 1.5 and 3.5 times embedded value. This is a valuation for life insurers only, not for general or health insurers.</p></div>`;
  box.querySelectorAll('[data-k]').forEach(i=>i.onchange=()=>{const v=parseFloat(i.value);D[i.dataset.k]=isFinite(v)?v:'';save();embvPanel(s,price)});
  const cl=$('#embv-clear',box);if(cl)cl.onclick=()=>{lsSet('embv_'+s,null);embvPanel(s,price)};
}

// ---------- Summary: football field ----------
const FFX={off:{}};
async function ffPanel(s,price,dcf,fin,rl,fnc,payer){
  const box=$('#ffbox');if(!box)return;
  const rows=[];const ffIns=!!(window.__ins);
  const sr=scenarioRows(dcf,fin,price);
  sr.forEach(m=>{const v=m.res.map(x=>x.fair);if(v.every(x=>x!=null&&x>0))rows.push({k:m.title.startsWith('DCF')?'dcf':'fin',n:m.title.startsWith('DCF')?'DCF':'Justified P/B',v})});
  if(rl&&rl.fair_value>0)rows.push({k:'rl',n:'Realty NAV',v:[rl.fair_value,rl.fair_value,rl.fair_value]});
  const list=[['mult','Price multiples'],['ev','EV multiples',fnc],['ddm','DDM',!payer],['ri','Residual income'],['asset','Asset based'],['epv','Earnings power',fnc],['graham','Graham value'],['sotp','Sum of the parts'],['embv','Embedded value',!ffIns]];
  for(const [k,n,skip] of list){
    if(skip)continue;
    REGV={};const tmp=document.createElement('div');SUMBOX=tmp;
    try{if(k==='mult')await multPanel(s,price);else if(k==='ev')await evPanel(s,price);else if(k==='ddm')await ddmPanel(s,price,dcf,fin);else if(k==='ri')await riPanel(s,price,dcf,fin);else if(k==='epv')await epvPanel(s,price,dcf,fin);else if(k==='graham')await grahamPanel(s,price);else if(k==='sotp')await sotpPanel(s,price);else if(k==='embv')await embvPanel(s,price);else await assetPanel(s,price)}catch(e){}
    SUMBOX=null;
    const v=REGV[k];if(v&&v.every(x=>x!=null&&isFinite(x)&&x>0))rows.push({k,n,v:Array.from(v),low:!!v.low});
  }
  REGV={};
  const el=$('#ffbox');if(!el)return;
  if(!rows.length||!(price>0)){el.innerHTML='<div class="card"><h3>Summary</h3><p class="mut">No model could be calculated for this stock yet.</p></div>';return}
  const draw=()=>{
    const mn=(r)=>Math.min(...r.v),mx=(r)=>Math.max(...r.v);
    const LO=Math.max(0,Math.min(price,...rows.map(mn))*0.9),HI=Math.min(Math.max(price,...rows.map(mx))*1.05,price*3.2);
    const P=v=>Math.max(0,Math.min(100,(v-LO)/(HI-LO)*100));
    const isOn=r=>FFX.off[s+r.k]===false||(!FFX.off[s+r.k]&&!r.low);
    const chosen=rows.filter(isOn),av=chosen.length?chosen.reduce((a,r)=>a+r.v[1],0)/chosen.length:null,au=av!=null?(av/price-1)*100:null;
    el.innerHTML=`<div class="card"><h3>Valuation summary <span class="mut" style="font-weight:400;font-size:12px">bear to bull range for each model · line = current price ₹${T.fmt(price,1)}</span></h3>
     <div class="ffr ffaxr"><span></span><div class="ffax"><span>₹${T.fmt(LO,0)}</span><span>₹${T.fmt(HI,0)}</span></div><span></span></div>
     ${rows.map(r=>`<div class="ffr${isOn(r)?'':' off'}"><label class="ffl"><input type="checkbox" data-k="${r.k}" ${isOn(r)?'checked':''}><span>${esc(r.n)}${r.low?'<small class="warnc">low reliability</small>':''}</span></label>
       <div class="fft"><div class="ffb" style="left:${P(mn(r))}%;width:${Math.max(.8,P(mx(r))-P(mn(r)))}%"></div><div class="ffm" style="left:${P(r.v[1])}%"></div><div class="ffp" style="left:${P(price)}%"></div></div>
       <div class="ffv">₹${T.fmt(r.v[1],0)}</div></div>`).join('')}
     ${av!=null?`<div class="vbig" style="margin-top:14px"><div class="tile"><div class="k">Average of ticked models (base)</div><div class="tv">₹${T.fmt(av,0)}</div></div><div class="tile"><div class="k">vs current price</div><div class="tv ${cls(au)}">${au>=0?'+':''}${T.fmt(au,1)}%</div></div></div>`:'<p class="mut">Tick at least one model.</p>'}
     <div style="overflow-x:auto;margin-top:14px"><table class="peer kv"><thead><tr><th>Model</th><th class="num">Bear</th><th class="num">Base</th><th class="num">Bull</th><th class="num">Base vs price</th></tr></thead><tbody>
      ${rows.map(r=>{const u=(r.v[1]/price-1)*100;return `<tr><td>${esc(r.n)}</td><td class="num">₹${T.fmt(r.v[0],0)}</td><td class="num"><b>₹${T.fmt(r.v[1],0)}</b></td><td class="num">₹${T.fmt(r.v[2],0)}</td><td class="num ${cls(u)}">${u>=0?'+':''}${T.fmt(u,1)}%</td></tr>`}).join('')}</tbody></table></div>
     <p class="mut" style="font-size:12px;margin-top:10px">Each bar runs from the bear to the bull value, the thick mark is the base value and the orange line is today's price. The values come from the other tabs, including any inputs you have edited there. Models marked low reliability start unticked. Relative models (price and EV multiples) show what the stock would be worth at peer valuations, while the others are intrinsic. Bars are cut off at about three times the price. The average treats the ticked models equally and is a rough guide, not a target price.</p></div>`;
    el.querySelectorAll('.ffl input').forEach(c=>c.onchange=()=>{FFX.off[s+c.dataset.k]=!c.checked?true:false;draw()});
  };
  draw();
}

// ---------- stock ----------
let FIN_RATIO='',FS={sub:'pl',per:'annual',keyonly:false,unit:'cr'};
async function stock(s,tab){
  tab=tab||'overview';
  view.innerHTML=SKEL;
  const [dcf,met,rsk,pcsv,rat,fin,rl]=await Promise.all([get(`data/dcf/${s}.json`,'json'),get(`data/metrics/${s}.json`,'json'),get(`data/risk/${s}.json`,'json'),get(`data/prices/${s}.csv`),get(`data/ratios/${s}.json`,'json'),get(`data/fin/${s}.json`,'json'),get(`data/realty/${s}.json`,'json')]);
  const u=D.uni.find(x=>x.symbol===s)||{};
  const prices=pcsv?T.parseCSV(pcsv):[];
  const price=rsk?.price??dcf?.price??fin?.price??rl?.price;
  const kv=(k,v,c='')=>`<div><div class="k">${k}</div><div class="v ${c}" style="font-size:16px">${v}</div></div>`;
  const V=(met&&met.valuation)||{},R=(met&&met.ratios)||{},G=(met&&met.growth)||{};
  const cl=prices.map(r=>T.num(r.Close)),n=cl.length;
  const chg=n>1&&cl[n-2]?(cl[n-1]/cl[n-2]-1)*100:null,chgAbs=n>1?cl[n-1]-cl[n-2]:null;
  const asof=n?prices[n-1].Date:(rsk&&rsk.as_of)||'';
  const words=(u.company||s).replace(/\b(ltd|limited|inc|corp)\b\.?/ig,'').trim().split(/\s+/);
  const ini=((words[0]||s)[0]+((words[1]||'')[0]||(words[0]||s)[1]||'')).toUpperCase();
  const stat=(k,val)=>`<div class="stat"><div class="k">${k}</div><div class="sv">${val}</div></div>`;
  const dl='';
  const TABS=[['overview','Overview'],['financials','Financials'],['valuation','Valuation'],['peers','Peers'],['orderflow','Order Flow'],['quant','Quant']];
  const tabsH=`<div class="tabs">${TABS.map(t=>`<a href="#/stock/${esc(s)}/${t[0]}" class="${tab===t[0]?'on':''}${LOCKED_TABS.includes(t[0])?' lk':''}">${t[1]}</a>`).join('')}${['Compare','Shareholding','News & Events','Research Notes'].map(x=>`<span title="Coming later">${x}</span>`).join('')}<b class="mini">${esc(s)} <em>₹${T.fmt(price,2)}</em>${chg!=null?` <i class="${cls(chg)}">${chg>=0?'+':''}${T.fmt(chg,2)}%</i>`:''}</b></div>`;
  let h=tabsH+`<div class="crumb"><a href="#/market">Research</a> › ${esc(s)}</div>
   <div class="card"><div class="sh"><div class="logo">${esc(ini)}</div>
    <div><h1>${esc(u.company||s)}</h1><div class="sub">${esc(s)}.NSE</div><span class="tag">${esc(u.industry||'')}</span>${V.market_cap_cr!=null?`<span class="tag">${capOf(V.market_cap_cr)}</span>`:''}${u.index==='microcap250'?'<span class="tag" title="In the Nifty Microcap 250, outside the Nifty 500. Data can be thinner and trading less liquid.">Microcap 250</span>':''}${met?`<span class="tag">${esc(met.type)}</span>`:''}</div>
    <div class="acts">${dl}</div></div>
    <div class="pricerow"><div><span class="bigp" data-n="${price}" data-d="2" data-pre="₹">₹${T.fmt(price,2)}</span>${chg!=null?`<span class="chg ${cls(chg)}">${chgAbs>=0?'+':''}${T.fmt(chgAbs,2)} (${chg>=0?'+':''}${T.fmt(chg,2)}%)</span>`:''}<div class="k" style="margin-top:6px">NSE · As of ${esc(asof)} (daily close)</div></div>
     <div class="stats">${stat('Market cap',V.market_cap_cr!=null?'₹'+T.fmt(V.market_cap_cr,0)+' Cr':'–')}${stat('P/E',V.pe_used!=null?T.fmt(V.pe_used,1)+'x':'–')}${stat('P/B',V.pb!=null?T.fmt(V.pb,2)+'x':'–')}${stat('EV/EBITDA',V.ev_ebitda!=null?T.fmt(V.ev_ebitda,1)+'x':'–')}${stat('ROE',R.roe_pct!=null?T.fmt(R.roe_pct,1)+'%':'–')}${stat('ROCE',R.roce_pct!=null?T.fmt(R.roce_pct,1)+'%':'–')}${stat('Debt/Equity',R.debt_equity!=null?T.fmt(R.debt_equity,2):'–')}</div></div></div>`;


  // valuation summary (overview side card)
  let vs='';
  const vrow=(k,v)=>`<div class="vrow"><span class="mut">${k}</span><b>${v}</b></div>`;
  const vbig=(fair,label)=>{const up=fair!=null&&price?(fair/price-1)*100:null;return `<div class="vbig"><div class="tile"><div class="k">${label}</div><div class="tv">${fair!=null?'₹'+T.fmt(fair,0):'–'}</div></div><div class="tile"><div class="k">Upside</div><div class="tv ${cls(up)}">${up!=null?(up>=0?'+':'')+T.fmt(up,1)+'%':'–'}</div></div></div>`};
  if(dcf){const r=T.recompute(dcf,{rf:A.rf/100,erp:A.erp/100,gT:A.g/100});
    vs=`<div class="card"><h3>DCF valuation <span class="tag">${esc(dcf.reliability||'')}</span></h3>${vbig(r?r.perShare:null,'DCF fair value')}${vrow('WACC',r?T.fmt(r.wacc*100,2)+'%':'–')}${vrow('Terminal growth',T.fmt(A.g,1)+'%')}${vrow('Cost of equity',r&&r.ke!=null?T.fmt(r.ke*100,2)+'%':'–')}${vrow('Beta used',T.fmt(dcf.assumptions.beta_used,2))}<div style="margin-top:8px"><a class="link" href="#/stock/${esc(s)}/valuation">View DCF model →</a></div></div>`}
  else if(fin){const r=T.finModel(fin,fx(fin,{rf:A.rf/100,erp:A.erp/100,g:A.g/100}));
    vs=`<div class="card"><h3>Financials model <span class="tag">${esc(fin.subtype||'')}</span></h3>${vbig(r?r.fair:null,'Fair value (P/B–ROE)')}${vrow('Fair P/B',r&&r.fairPB!=null?T.fmt(r.fairPB,2)+'x':'–')}${vrow('Current P/B',r&&r.pb!=null?T.fmt(r.pb,2)+'x':'–')}${vrow('Cost of equity',r?T.fmt(r.ke*100,2)+'%':'–')}${vrow('Implied ROE at price',r&&r.impliedROE!=null?T.fmt(r.impliedROE*100,1)+'%':'–')}<div style="margin-top:8px"><a class="link" href="#/stock/${esc(s)}/valuation">View model →</a></div></div>`}
  else if(rl){const rit=rl.type==='reit';
    vs=`<div class="card"><h3>${rit?'REIT model':'Realty NAV model'} <span class="tag">${esc(rl.type)}</span></h3>${vbig(rl.fair_value,rit?'Fair value':'NAV / share')}${vrow('P/B',T.fmt(rl.pb,2)+'x')}${vrow('Net debt',T.fmt(rl.net_debt_cr,0)+' Cr')}${rl.fair_value==null?'<p class="warn">Inputs not filled yet (data/realty_inputs.csv or reit_inputs.csv).</p>':''}<div style="margin-top:8px"><a class="link" href="#/stock/${esc(s)}/valuation">View model →</a></div></div>`}
  else vs=`<div class="card"><h3>Valuation model</h3><span class="mut">No model for this stock (excluded or data missing).</span></div>`;

  const tile=(k,v)=>{const nv=parseFloat(String(v).replace(/,/g,''));return `<div class="tile"><div class="k">${k}</div><div class="tv" ${isFinite(nv)?`data-n="${nv}" data-d="${decs(v)}"`:''}>${v}</div></div>`};
  const keyRatios=`<div class="card"><h3>Key ratios (latest FY)<a class="link" href="#/stock/${esc(s)}/financials">View all</a></h3><div class="tiles">${tile('P/E',T.fmt(V.pe_used,1))}${tile('P/B',T.fmt(V.pb,2))}${tile('EV/EBITDA',T.fmt(V.ev_ebitda,1))}${tile('ROE %',T.fmt(R.roe_pct,1))}${tile('ROCE %',T.fmt(R.roce_pct,1))}${tile('ROA %',T.fmt(R.roa_pct,1))}${tile('Net margin %',T.fmt(R.net_margin_pct,1))}${tile('EBIT margin %',T.fmt(R.ebit_margin_pct,1))}${tile('FCF yield %',T.fmt(V.fcf_yield_pct,1))}</div></div>`;

  const technicals=()=>{if(!rsk)return '';const k=rsk.risk,m=rsk.momentum,b=rsk.beta,t=rsk.trend;
    return `<div class="card"><h3>Technicals &amp; risk</h3><div class="grid">${kv('RSI 14',T.fmt(m.rsi14,1))}${kv('MACD hist %',T.fmt(m.macd_hist_pct,2))}${kv('Bollinger %B',T.fmt(m.bollinger_pctb,2))}${kv('ATR %',T.fmt(m.atr_pct,2))}${kv('Above 200-DMA',t.above_dma200?'Yes':'No',t.above_dma200?'pos':'neg')}${kv('Above 50-DMA',t.above_dma50?'Yes':'No',t.above_dma50?'pos':'neg')}${kv('Volatility 1Y %',T.fmt(k.volatility_1y_pct))}${kv('Max DD 1Y %',T.fmt(k.max_drawdown_1y_pct))}${kv('VaR95 1d %',T.fmt(k.var95_1d_pct,2))}${kv('Sharpe 1Y',T.fmt(k.sharpe_1y,2))}${kv('Beta (adj)',T.fmt(b.adjusted,2))}${kv('Alpha % (ann.)',T.fmt(b.alpha_pct))}${kv('Avg traded ₹cr/day',T.fmt(rsk.liquidity.avg_daily_value_3m_cr,1))}</div></div>`};

  if(tab==='overview'){
    h+=`<div class="ov"><div><div class="card"><h3 style="align-items:flex-start">Price<span class="pctl"><span class="ctr"><span class="range" id="mode">${[['area','Area'],['line','Line'],['candle','Candle']].map(x=>`<button data-m="${x[0]}">${x[1]}</button>`).join('')}</span><span class="range" id="rng">${['3M','6M','1Y','3Y','All'].map(x=>`<button data-r="${x}">${x}</button>`).join('')}</span></span><div class="retline" id="retline"></div></span></h3><canvas id="pc" style="height:380px;touch-action:pan-y"></canvas><div class="k" style="margin-top:4px"><span style="color:#2f6fdb">▬</span> 50-day &nbsp; <span style="color:#9b59d0">▬</span> 200-day &nbsp; · hover or tap the chart for details</div></div></div>
     <div>${keyRatios}${isLocked()?'<div class="card lockc mini"><div class="lockic">&#128274;</div><h3>Valuation models</h3><p class="mut">Fair value and model inputs are for signed-in users.</p></div>':vs}</div></div>`;
    h+=technicals();
  }else if(tab==='financials'){
    const tl=(k,v)=>`<div class="tile"><div class="k">${k}</div><div class="tv">${v}</div></div>`;
    FIN_RATIO=`<div class="fcard card"><h3>Key metrics<span class="mut" style="font-weight:400;font-size:12px">FY ${esc(met?met.latest_fy:'')}</span></h3><div class="mtiles">${tl('P/E (used)',T.fmt(V.pe_used))}${tl('P/B',T.fmt(V.pb))}${tl('EV/EBITDA',T.fmt(V.ev_ebitda))}${tl('FCF yield %',T.fmt(V.fcf_yield_pct))}${tl('Market cap ₹cr',T.fmt(V.market_cap_cr,0))}${tl('ROE %',T.fmt(R.roe_pct))}${tl('ROCE %',T.fmt(R.roce_pct))}${tl('Debt/Equity',T.fmt(R.debt_equity,2))}${tl('Piotroski',met&&met.piotroski&&met.piotroski.score!=null?met.piotroski.score:'–')}${tl('Altman Z″',met&&met.altman_z2&&met.altman_z2.z!=null?T.fmt(met.altman_z2.z,2)+' ('+esc(met.altman_z2.zone||'')+')':(met&&met.type==='financial'?'n/a for financials':'–'))}${tl('Revenue CAGR %',T.fmt(G.revenue_cagr_pct))}${tl('Net income CAGR %',T.fmt(G.net_income_cagr_pct))}${tl('Years used',G.years_used??'–')}</div>${met&&(met.flags||[]).length?`<p class="warn">${met.flags.map(esc).join(' · ')}</p>`:''}<div id="ratslot"></div></div>`;
    FIN_RATIO=FIN_RATIO.replace('<div id="ratslot"></div>',ratiosHtml(rat));
    h+='<div class="subtabs" id="fsub"></div><div id="fbody"></div>';
  }else if(tab==='valuation'){
    h+='<details class="assump2" id="assbar"></details><div class="subtabs" id="vsub"></div><div id="vbody"></div>';
  }else if(tab==='peers'){
    h+='<div id="peerbody"><div class="skel" style="height:320px"></div></div>';
  }else if(tab==='orderflow'){
    h+='<div id="ofbody"><div class="skel" style="height:440px"></div></div>';
  }else if(tab==='quant'){
    h+='<div class="subtabs" id="qsub"></div><div id="qbody"><div class="skel" style="height:300px"></div></div>';
  }
  view.innerHTML=h;
  if(tab==='overview'&&prices.length){
    let range='1Y',mode='area';
    const gk=(r,k)=>{const v=T.num(r[k]??r[k.toLowerCase()]);return v};
    const all=prices.map(r=>({d:r.Date,o:gk(r,'Open'),h:gk(r,'High'),l:gk(r,'Low'),c:T.num(r.Close),v:gk(r,'Volume')})).filter(r=>r.c!=null);
    const hasOHLC=all.some(r=>r.o!=null&&r.h!=null&&r.l!=null);
    const closes=all.map(r=>r.c);
    const smaFull=m=>closes.map((_,j)=>{if(j<m-1)return null;let t=0;for(let q=j-m+1;q<=j;q++)t+=closes[q];return t/m});
    const s50=smaFull(50),s200=smaFull(200);
    const drawP=()=>{const days={'3M':63,'6M':126,'1Y':252,'3Y':756,'All':1e9}[range];const rows=all.slice(-days),off=all.length-rows.length;
      priceChart($('#pc'),rows,{mode,volume:true,smas:[{y:s50.slice(off),color:'#2f6fdb'},{y:s200.slice(off),color:'#9b59d0'}]});
      try{const bi=Math.max(0,all.length-rows.length-1),a0=all[bi],a1=all[all.length-1],ch=a1.c/a0.c-1,yrs=(new Date(a1.d)-new Date(a0.d))/31557600000;
        const cg=(range==='All'||range==='3Y')&&yrs>1.05?` &nbsp;·&nbsp; CAGR <b class="${cls(ch)}">${T.pct(((a1.c/a0.c)**(1/yrs)-1)*100)}</b>`:'';
        const hi=Math.max(...rows.map(r=>r.h??r.c)),lo=Math.min(...rows.map(r=>r.l??r.c));
        $('#retline').innerHTML=`<div class="r1"><span class="rb ${cls(ch)}">${T.pct(ch*100)}</span><span class="mut">${range==='All'?'since '+esc(a0.d):range+' return'}</span>${cg}</div><div class="r2 mut">${esc(a0.d)} ₹${T.fmt(a0.c,1)} → ${esc(a1.d)} ₹${T.fmt(a1.c,1)} · High ₹${T.fmt(hi,1)} · Low ₹${T.fmt(lo,1)}</div>`}catch(e){}
      document.querySelectorAll('#rng button').forEach(b=>b.classList.toggle('on',b.dataset.r===range));
      document.querySelectorAll('#mode button').forEach(b=>{b.classList.toggle('on',b.dataset.m===mode);if(b.dataset.m==='candle'&&!hasOHLC){b.disabled=true;b.title='No open/high/low data'}})};
    document.querySelectorAll('#rng button').forEach(b=>b.onclick=()=>{range=b.dataset.r;drawP()});
    document.querySelectorAll('#mode button').forEach(b=>b.onclick=()=>{mode=b.dataset.m;drawP()});
    drawP();
  }
  countUps(view);
  if(tab==='financials')finTabs(s);
  if(tab==='peers')peersTab(s);
  if(tab==='orderflow')ofStock(s);
  if(tab==='quant')quantTabs(s,technicals());
  if(tab==='valuation')valTabs(s,dcf,fin,rl,price,met,u);
}


function fmtR(v,f){if(v==null)return '–';if(f==='pct')return T.fmt(v,1)+'%';if(f==='d')return T.fmt(v,0);if(f==='num')return T.fmt(v,0);return T.fmt(v,2)}
function ratiosHtml(r){
  if(!r||!r.sections||!r.sections.length)return '<p class="mut" style="margin:14px 0 0">Ratios not available for this stock yet.</p>';
  const tabs=r.sections.map((x,i)=>`<button data-sec="${x.id}" ${i===0?'class="on"':''}>${esc(x.title)}</button>`).join('');
  const body=r.sections.map((x,i)=>{
    let t;
    if(x.latest)t=`<table>${x.rows.map(q=>`<tr><td class="l">${esc(q.label)}</td><td>${fmtR(q.value,q.fmt)}</td></tr>`).join('')}</table>`;
    else t=`<table><tr><th class="l">FY</th>${x.years.map(y=>`<th>${esc(y)}</th>`).join('')}${x.rows.some(q=>q.cagr!=null)?'<th>CAGR</th>':''}</tr>${x.rows.map(q=>`<tr><td class="l">${esc(q.label)}</td>${q.values.map(v=>`<td class="${q.fmt==='pct'&&q.key.startsWith('g_')?cls(v):''}">${fmtR(v,q.fmt)}</td>`).join('')}${x.rows.some(z=>z.cagr!=null)?`<td>${q.cagr!=null?T.pct(q.cagr,1):'–'}</td>`:''}</tr>`).join('')}</table>`;
    return `<div class="rsec" data-sec="${x.id}" style="${i?'display:none':''}"><div class="scroll" style="max-height:none">${t}</div></div>`}).join('');
  return `<div id="ratios" class="rwrap"><h4>Ratios <span class="mut" style="font-weight:400">annual, FY ending March unless stated</span></h4><div class="bar rtabs">${tabs}</div>${body}<p class="mut" style="font-size:12px">Computed from Yahoo Finance statements (about 4 years). Year-end balances are used for all ratios. Missing values mean the line item is not reported.</p></div>`;
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
   <span class="mut">${data.length} financials · assumptions: RF ${A.rf}% · ERP ${A.erp}% · g ${A.g}% (change in the Valuation tab of any stock)</span></div>
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
const FINTW={};
const fx=(f,inp)=>Object.assign(inp,FINTW[f&&f.symbol]||{});
function finPanel(f){
  const box=$('#finbox'),m=f.model;const tw=FINTW[f.symbol]||{};const st={rf:A.rf,erp:A.erp,g:A.g,roe:null,n:tw.nHi||0,gh:tw.gHi!=null?tw.gHi*100:null};
  const kv=(k,v,c='')=>`<div><div class="k">${k}</div><div class="v ${c}" style="font-size:16px">${v}</div></div>`;
  function render(){
    const inp={rf:st.rf/100,erp:st.erp/100,g:st.g/100,roe:st.roe!=null?st.roe/100:null,nHi:st.n,gHi:st.gh!=null?st.gh/100:null};
    if(st.n>0)FINTW[f.symbol]={nHi:st.n,gHi:inp.gHi};else delete FINTW[f.symbol];
    const r=T.finModel(f,inp),up=r&&r.fair!=null&&f.price?(r.fair/f.price-1)*100:null,sens=r?T.finSens(f,inp):null;
    box.innerHTML=`<div class="card"><h3>Financials model: justified P/B <span class="tag">${esc(f.subtype)}</span></h3>
     <div class="bar"><label>RF % <input id="x-rf" type="number" step="0.1" value="${st.rf}" style="width:70px"></label>
      <label>ERP % <input id="x-erp" type="number" step="0.1" value="${st.erp}" style="width:70px"></label>
      <label>Growth g % <input id="x-g" type="number" step="0.1" value="${st.g}" style="width:70px"></label>
      <label>ROE % <input id="x-roe" type="number" step="0.5" value="${st.roe!=null?st.roe:T.fmt(m.roe_pct,1).replace(',','')}" style="width:70px"></label><button id="x-reset">Reset</button></div>
     <div class="bar"><label>Years of faster growth <input id="x-n" type="number" step="1" min="0" max="20" value="${st.n}" style="width:70px"></label>
      <label>Growth in those years % <input id="x-gh" type="number" step="0.5" value="${r&&r.gHi!=null?T.fmt(r.gHi*100,1).replace(',',''):(st.gh!=null?st.gh:'')}" style="width:70px" ${st.n>0?'':'disabled'}></label>
      <span class="mut" style="font-size:12px">0 years = classic steady-state P/B. After the faster years, growth falls to g (GDP).</span></div>
     ${r&&r.fair!=null?`<div class="grid">${kv('Fair value ₹',T.fmt(r.fair,0))}${kv('Price ₹',T.fmt(f.price,1))}${kv('Upside',T.pct(up,0),cls(up))}${kv('Fair P/B',T.fmt(r.fairPB,2))}${kv('Current P/B',T.fmt(r.pb,2))}${kv('Implied ROE at price %',T.fmt(r.impliedROE!=null?r.impliedROE*100:null,1))}${kv('Cost of equity %',T.fmt(r.ke*100,2))}${kv('g used %',T.fmt(r.g*100,2))}${kv('Book value / share ₹',T.fmt(m.bvps,1))}${kv('Beta used',T.fmt(m.beta,2))}</div>`:'<p class="warn">Model not meaningful with these inputs (needs positive ROE and Ke above g).</p>'}
     <p class="mut" style="font-size:12px">ROE basis: ${esc(f.roe_basis)}. TTM ROE ${T.pct(f.roe_ttm_pct,1)} · 3-yr avg ROE ${T.pct(f.roe_avg3_pct,1)} · book value CAGR ${T.pct(f.bv_cagr_pct,1)} · payout ${T.pct(f.payout_pct,0)}${m.g_cap_pct!=null?' · g capped at sustainable growth '+T.pct(m.g_cap_pct,1):''}</p>
     ${(f.flags||[]).length?`<p class="warn">${f.flags.map(esc).join(' · ')}</p>`:''}</div>
     <div class="two"><div class="card"><h3>ROE history</h3><table><tr><th class="l">FY</th>${(f.fy||[]).map(x=>`<th>${esc(x.year)}</th>`).join('')}</tr><tr><td class="l">ROE %</td>${(f.fy||[]).map(x=>`<td>${T.fmt(x.roe,1)}</td>`).join('')}</tr><tr><td class="l">ROA %</td>${(f.fy||[]).map(x=>`<td>${T.fmt(x.roa,2)}</td>`).join('')}</tr></table></div>
     <div class="card"><h3>Sensitivity: fair value ₹ (ROE down, Ke across)</h3>${sens?`<table><tr><th></th>${sens.kes.map(k=>`<th>${T.fmt(k*100,1)}%</th>`).join('')}</tr>${sens.grid.map((row,i)=>`<tr><td>${T.fmt(sens.roes[i]*100,1)}%</td>${row.map((v,j)=>`<td class="${i===2&&j===2?'hl':''}">${T.fmt(v,0)}</td>`).join('')}</tr>`).join('')}</table>`:''}</div></div>`;
    const bind=(id,key)=>{$(id).onchange=e=>{const v=parseFloat(e.target.value);st[key]=isFinite(v)?v:(key==="n"?0:null);render()}};
    bind('#x-rf','rf');bind('#x-erp','erp');bind('#x-g','g');bind('#x-roe','roe');bind('#x-n','n');bind('#x-gh','gh');
    $('#x-reset').onclick=()=>{st.rf=A.rf;st.erp=A.erp;st.g=A.g;st.roe=null;st.n=0;st.gh=null;render()};
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

window.addEventListener('resize',()=>{try{const on=document.querySelector('#topnav a.on'),pl=document.getElementById('pill');if(on&&pl){pl.style.left=on.offsetLeft+'px';pl.style.width=on.offsetWidth+'px'}}catch(e){}});

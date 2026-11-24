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
    document.querySelector('footer').insertAdjacentHTML('afterbegin','Data updated '+d.toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'})+' IST · latest prices as of '+esc(st.price_date||'')+'<br>')}}catch(e){}
  const by=(rows)=>{const o={};rows.forEach(r=>o[r.symbol]=r);return o};
  D.met=by(met);D.dcf=by(dcf);D.rsk=by(rsk);
  D.syms=uni.map(u=>u.symbol);
  window.attachSuggest=attachSuggest;D.uni=uni;attachSuggest($('#search'));
  const sync=()=>{$('#a-rf').value=A.rf;$('#a-erp').value=A.erp;$('#a-g').value=A.g};sync();
  ['rf','erp','g'].forEach(k=>$('#a-'+k).addEventListener('change',e=>{const v=parseFloat(e.target.value);if(isFinite(v)){A[k]=v;saveA();route()}}));
  $('#a-reset').onclick=()=>{A=Object.assign({},DEF);saveA();sync();route()};
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

function route(){
  const h=location.hash||'#/market';const p=h.split('/');
  const key=p[1]==='stock'?'research':(p[1]==='sector'?'market':(p[1]||'market'));
  document.querySelectorAll('#topnav a').forEach(a=>a.classList.toggle('on',a.dataset.k===key));
  try{const on=document.querySelector('#topnav a.on'),pl=document.getElementById('pill');if(on&&pl){pl.style.left=on.offsetLeft+'px';pl.style.width=on.offsetWidth+'px';pl.style.opacity=1}else if(pl)pl.style.opacity=0}catch(e){}
  if(route.last!==h){window.scrollTo(0,0);route.last=h}
  if(p[1]==='stock'&&p[2])return stock(decodeURIComponent(p[2]),p[3]);
  if(p[1]==='sector'&&p[2]&&p[3])return sectorPage(p[2],decodeURIComponent(p[3]));
  if(p[1]==='screener')return screener();
  if(p[1]==='financials')return financials();
  if(p[1]==='research')return research();
  return market();
}
function research(){
  view.innerHTML=`<div class="rs"><h2>Company research</h2><p class="mut">Search any Nifty 500 company by name or symbol</p><div class="rsbox"><input id="rs-q" placeholder="e.g. Reliance, TCS, HDFC Bank" autocomplete="off"></div></div>`;
  const q=$('#rs-q');attachSuggest(q);q.focus();
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

  // 8 size and style
  if(d.ratios&&d.ratios.length){h+=sec('sz','Size and style','ratio of two groups, rebased to 100 at the start of the data; rising = first group outperforming')+'<div class="mh-grid">';
   d.ratios.forEach((r,i)=>{const a=W(r.y),l=last(a),f=first(a),ch=l!=null&&f?(l/f-1)*100:null;h+=mcard('rt'+i,r.name,{big:T.fmt(l,1),delta:ch==null?'':sgn(ch,1,'%'),dcls:cls(ch)});specs.push({id:'rt'+i,x:X,layers:[{y:a,type:'area'}],auto:true,dec:1})});h+='</div>'}

  const chips=[['idx','Indices'],['ind','Sector heatmap'],['sz','Size & style']];
  const bar=`<div class="mh-bar"><div class="chips">${chips.map(c=>`<a data-s="sec-${c[0]}">${c[1]}</a>`).join('')}</div>
   <div class="seg" id="mh-range">${Object.keys(RANGES).map(k=>`<button data-r="${k}" class="${MH.range===k?'on':''}">${k}</button>`).join('')}</div></div>
   <div class="mut" style="font-size:12px;margin:-4px 0 6px">${d.n_stocks} stocks · data to ${esc(d.last_date)} · from daily closes</div>`;
  view.innerHTML=bar+h;
  // wire
  document.querySelectorAll('#mh-range button').forEach(b=>b.onclick=()=>{MH.range=b.dataset.r;renderMarket(true)});
  document.querySelectorAll('.mh-bar .chips a').forEach(a=>a.onclick=()=>{const el=document.getElementById(a.dataset.s);if(el)el.scrollIntoView({behavior:'smooth',block:'start'})});
  document.querySelectorAll('tr.ind').forEach(tr=>tr.onclick=()=>{FILT.ind=tr.dataset.ind;FILT.q='';FILT.rel='all';location.hash='#/screener'});
  MH.charts=specs;specs.forEach(sp=>{const cv=document.getElementById(sp.id);if(cv)mchart(cv,sp,anim)});
  try{heatmapPanel()}catch(e){const w=$('#hmwrap');if(w)w.innerHTML='<div class="card"><p class="mut">Heatmap needs the latest market data. Run the Daily refresh once.</p></div>'}
  countUps(view);
}
let _rz;window.addEventListener('resize',()=>{clearTimeout(_rz);_rz=setTimeout(()=>{if(document.getElementById('hmbox'))try{hmDraw()}catch(e){}
    if(MH.data&&(location.hash===''||location.hash==='#/market'))MH.charts.forEach(sp=>{const cv=document.getElementById(sp.id);if(cv)mchart(cv,sp,false)})},150)});

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
  const W=box.clientWidth,Hh=W<600?420:520;box.style.height=Hh+'px';
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
  const rects=squarify(items,0,0,W,Hh);
  box.innerHTML=rects.map((r,i)=>{const [bg,fg]=hmColor(r.ret,tf),big=r.w>96&&r.h>54,mid=r.w>62&&r.h>46;
    const tip=r.stock?`${r.name}: ${T.pct(r.ret,2)} · ₹${T.fmt(r.mc,0)} cr`:`${r.name}: ${T.pct(r.ret,2)} weighted, ${T.pct(r.med,2)} median · ${r.n} stocks`;
    return `<div class="hmt" data-i="${i}" title="${esc(tip)}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;animation-delay:${Math.min(i*12,400)}ms"><div style="background:${bg};color:${fg}">${mid?`<b>${esc(r.name)}</b><span>${T.pct(r.ret,1)}</span>${big&&!r.stock?`<small>${r.n} stocks</small>`:''}`:''}</div></div>`}).join('');
  box.querySelectorAll('.hmt').forEach(el=>el.onclick=()=>{const r=rects[+el.dataset.i];if(r.stock)location.hash='#/stock/'+r.stock;else{HM.drill=r.name;hmDraw()}});
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
    const cell=(r,c)=>{const v=r[c[0]];return `<td class="num ${PR.sort===c[0]?'sorted':''}">${num(v)?T.fmt(v,c[2]):'–'}</td>`};
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
      <div class="mtiles">${tl('Market cap',num(gm)?'₹'+T.fmt(gm,0)+' cr':'–',num(tot)&&tot?T.fmt(gm/tot*100,1)+'% of Nifty 500':'')}${tl('Weighted P/E',f(wv('pe'),1,'x'),'Median '+f(medOf(g.map(x=>x.pe)),1,'x'))}${tl('Weighted P/B',f(wv('pb'),2,'x'),'Median '+f(medOf(g.map(x=>x.pb)),2,'x'))}${tl('Median ROE',f(medOf(g.map(x=>x.roe)),1,'%'))}${tl('Median ROCE',f(medOf(g.map(x=>x.roce)),1,'%'))}${tl('Median revenue CAGR',f(medOf(g.map(x=>x.rg)),1,'%'))}${tl('1M return',pc(wr('r1m')),'cap-weighted')}${tl('1Y return',pc(wr('r1y')),'cap-weighted')}${tl('Above 200-DMA',a200==null?'–':T.fmt(a200,0)+'%','of stocks')}${tl('Top 5 share',gm?T.fmt(t5/gm*100,0)+'%':'–','of group market cap')}</div></div>
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
    const base=T.finModel(fin,{rf,erp,g});
    if(base){const res=sc.map(([n,s])=>{const r=T.finModel(fin,{rf,erp:erp+s.derp,g:g+s.dg,roe:base.roe+s.droe});return {n,fair:r?r.fair:null,
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
  const fnc=(met&&met.type==='financial')||!!fin,ins=/insur/i.test((u&&u.industry)||'')||/insur/i.test((u&&u.company)||'');
  let payer=null;
  try{const st=await get(`data/statements/${s}.json`,'json');const cf=st&&st.annual_cashflow;if(cf){const row=cf.rows.find(r=>/dividend/i.test(r[0])&&/paid/i.test(r[0]))||cf.rows.find(r=>/dividend/i.test(r[0]));payer=row?row[1].slice(-3).some(v=>v!=null&&Math.abs(v)>0):false}}catch(e){}
  const live=[];if(dcf)live.push(['dcf','DCF']);if(fin)live.push(['fin','Justified P/B']);if(rl)live.push(['rl','Realty NAV']);
  live.push(['mult','Price multiples']);if(!fnc)live.push(['ev','EV multiples']);const soon=[];soon.push('ddm','asset','ri');if(!fnc)soon.push('epv','sotp','graham');if(ins)soon.push('embv');soon.push('ff');
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
    else if(VS.sub==='ev'){b.innerHTML='<div id="multbox"><div class="skel" style="height:260px"></div></div>';evPanel(s,price)}
    else if(VS.sub==='mult'){b.innerHTML='<div id="multbox"><div class="skel" style="height:260px"></div></div>';multPanel(s,price)}
    else b.innerHTML=ph(VS.sub);
  };
  draw();
}

// ---------- price multiples model ----------
function pctile(a,p){a=a.filter(v=>v!=null&&isFinite(v)).sort((x,y)=>x-y);if(!a.length)return null;const i=(a.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return a[lo]+(a[hi]-a[lo])*(i-lo)}
const MS={set:'all'};
async function multPanel(s,price){
  const box=$('#multbox');if(!box)return;
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
  const rows=M.map(([k,l,d])=>{const vals=peers.map(x=>x[k]).filter(ok);
    const q=vals.length>=6?[pctile(vals,.25),pctile(vals,.5),pctile(vals,.75)]:null;
    const own=ok(me[k])?me[k]:null;
    const imp=q&&own?q.map(m=>price*m/own):null;
    return {k,l,d,n:vals.length,own,q,imp}});
  const use=rows.filter(r=>r.imp);
  const avg=i=>use.length?use.reduce((a,r)=>a+r.imp[i],0)/use.length:null;
  const bl=[avg(0),avg(1),avg(2)];
  const up=v=>v!=null&&price?(v/price-1)*100:null;
  const fx=(v,d)=>v==null?'–':T.fmt(v,d);
  const card=(cl,name,v)=>`<div class="sc ${cl}"><div class="sn">${name}</div><div class="sv">${v!=null?'₹'+T.fmt(v,0):'–'}</div><div class="su ${cls(up(v))}">${up(v)!=null?(up(v)>=0?'+':'')+T.fmt(up(v),1)+'% vs price':''}</div></div>`;
  box.innerHTML=`<div class="card mph"><h3>Price multiples <span class="mut" style="font-weight:400;font-size:12px">peers: ${esc(gname)} (${esc(lvName)}) · ${peers.length} stocks</span></h3>
    <div class="seg" id="msset" style="margin:0 0 10px"><button data-k="all" class="${MS.set==='all'?'on':''}">All peers (${allPeers.length})</button><button data-k="size" class="${MS.set==='size'?'on':''}">Similar size (10 nearest)</button></div>
    <p class="mut" style="margin-top:0">Applies the peers' 25th percentile, median and 75th percentile multiple to this company's earnings and book value. Low = bear, median = base, high = bull.</p>
    ${use.length?`<div class="scn">${card('sc-bear','Bear (25th pct)',bl[0])}${card('sc-base','Base (median)',bl[1])}${card('sc-bull','Bull (75th pct)',bl[2])}</div>
    <p class="mut" style="font-size:12px;margin:8px 0 0">Average of ${use.map(r=>r.l).join(' and ')} values. Current price ₹${T.fmt(price,2)}.</p>`:'<p class="warn">This company has no positive P/E or P/B, so it cannot be valued on these multiples.</p>'}
    <div style="overflow-x:auto;margin-top:14px"><table class="peer"><thead><tr><th>Multiple</th><th class="num">${esc(s)}</th><th class="num">Peer 25th</th><th class="num">Peer median</th><th class="num">Peer 75th</th><th class="num">Value @ 25th</th><th class="num">@ median</th><th class="num">@ 75th</th><th class="num">Peers used</th></tr></thead><tbody>
    ${rows.map(r=>`<tr><td><b>${r.l}</b></td><td class="num">${r.own?fx(r.own,r.d)+'x':'–'}</td>${[0,1,2].map(i=>`<td class="num">${r.q?fx(r.q[i],r.d)+'x':'–'}</td>`).join('')}${[0,1,2].map(i=>`<td class="num">${r.imp?'₹'+T.fmt(r.imp[i],0):'–'}</td>`).join('')}<td class="num">${r.n}</td></tr>`).join('')}</tbody></table></div>
    <p class="mut" style="font-size:12px;margin-top:10px">This is a relative value: it says what the stock would be worth if it traded like its peers, not what it is worth in itself. If the whole group is expensive or cheap, the answer moves with it. Peers with negative or missing multiples are left out.</p></div>`;
  box.querySelectorAll('#msset button').forEach(b=>b.onclick=()=>{MS.set=b.dataset.k;multPanel(s,price)});
}

// ---------- EV multiples model ----------
async function evPanel(s,price){
  const box=$('#multbox');if(!box)return;
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
  const q=vals.length>=6?[pctile(vals,.25),pctile(vals,.5),pctile(vals,.75)]:null;
  const shares=me.mc/price;
  const imp=q?q.map(m=>(me.ebitda*m-me.nd)/shares):null;
  const up=v=>v!=null&&price?(v/price-1)*100:null;
  const card=(cl,name,v)=>`<div class="sc ${cl}"><div class="sn">${name}</div><div class="sv">${v!=null&&v>0?'₹'+T.fmt(v,0):'–'}</div><div class="su ${cls(up(v))}">${v!=null&&v>0&&up(v)!=null?(up(v)>=0?'+':'')+T.fmt(up(v),1)+'% vs price':''}</div></div>`;
  const lvName=LV.find(x=>x[0]===lv)[1];
  box.innerHTML=`<div class="card mph"><h3>EV multiples <span class="mut" style="font-weight:400;font-size:12px">peers: ${esc(me[lv])} (${esc(lvName)}) · ${peers.length} stocks</span></h3>
    <div class="seg" id="msset" style="margin:0 0 10px"><button data-k="all" class="${MS.set==='all'?'on':''}">All peers (${allPeers.length})</button><button data-k="size" class="${MS.set==='size'?'on':''}">Similar size (10 nearest)</button></div>
    <p class="mut" style="margin-top:0">Applies the peers' EV/EBITDA (25th percentile, median, 75th percentile) to this company's EBITDA, subtracts net debt and minority interest, and divides by shares. Low = bear, median = base, high = bull.</p>
    ${imp?`<div class="scn">${card('sc-bear','Bear (25th pct)',imp[0])}${card('sc-base','Base (median)',imp[1])}${card('sc-bull','Bull (75th pct)',imp[2])}</div>`:'<p class="warn">Fewer than 6 peers in this set, so percentiles are not shown. Switch to All peers.</p>'}
    <div style="overflow-x:auto;margin-top:14px"><table class="peer"><thead><tr><th>Item</th><th class="num">Value</th></tr></thead><tbody>
     <tr><td>EBITDA (latest year, ₹ cr)</td><td class="num">${T.fmt(me.ebitda,0)}</td></tr>
     <tr><td>Net debt + minorities (₹ cr)</td><td class="num">${T.fmt(me.nd,0)}</td></tr>
     <tr><td>Market cap (₹ cr)</td><td class="num">${T.fmt(me.mc,0)}</td></tr>
     <tr><td>${esc(s)} EV/EBITDA</td><td class="num">${mine!=null?T.fmt(mine,1)+'x':'–'}</td></tr>
     <tr><td>Peer EV/EBITDA 25th / median / 75th</td><td class="num">${q?q.map(v=>T.fmt(v,1)+'x').join(' / '):'–'}</td></tr>
     <tr><td>Peers used</td><td class="num">${vals.length}</td></tr></tbody></table></div>
    <p class="mut" style="font-size:12px;margin-top:10px">EV = market cap + total debt − cash and short-term investments + minority interest, using the latest annual balance sheet. EBITDA is the latest financial year from Yahoo Finance. Banks and financial companies are excluded. This is a relative value, so it moves with how the peer group is priced.</p></div>`;
  box.querySelectorAll('#msset button').forEach(b=>b.onclick=()=>{MS.set=b.dataset.k;evPanel(s,price)});
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
  const dl=pcsv?`<a class="btn" href="data/prices/${esc(s)}.csv" download>Download prices (CSV)</a>`:'';
  let h=`<div class="crumb"><a href="#/market">Research</a> › ${esc(s)}</div>
   <div class="card"><div class="sh"><div class="logo">${esc(ini)}</div>
    <div><h1>${esc(u.company||s)}</h1><div class="sub">${esc(s)}.NSE</div><span class="tag">${esc(u.industry||'')}</span>${met?`<span class="tag">${esc(met.type)}</span>`:''}</div>
    <div class="acts">${dl}</div></div>
    <div class="pricerow"><div><span class="bigp" data-n="${price}" data-d="2" data-pre="₹">₹${T.fmt(price,2)}</span>${chg!=null?`<span class="chg ${cls(chg)}">${chgAbs>=0?'+':''}${T.fmt(chgAbs,2)} (${chg>=0?'+':''}${T.fmt(chg,2)}%)</span>`:''}<div class="k" style="margin-top:6px">NSE · As of ${esc(asof)} (daily close)</div></div>
     <div class="stats">${stat('Market cap',V.market_cap_cr!=null?'₹'+T.fmt(V.market_cap_cr,0)+' Cr':'–')}${stat('P/E',V.pe_used!=null?T.fmt(V.pe_used,1)+'x':'–')}${stat('P/B',V.pb!=null?T.fmt(V.pb,2)+'x':'–')}${stat('EV/EBITDA',V.ev_ebitda!=null?T.fmt(V.ev_ebitda,1)+'x':'–')}${stat('ROE',R.roe_pct!=null?T.fmt(R.roe_pct,1)+'%':'–')}${stat('ROCE',R.roce_pct!=null?T.fmt(R.roce_pct,1)+'%':'–')}${stat('Debt/Equity',R.debt_equity!=null?T.fmt(R.debt_equity,2):'–')}</div></div></div>`;
  const TABS=[['overview','Overview'],['financials','Financials'],['valuation','Valuation'],['peers','Peers'],['quant','Quant Analytics']];
  h+=`<div class="tabs">${TABS.map(t=>`<a href="#/stock/${esc(s)}/${t[0]}" class="${tab===t[0]?'on':''}">${t[1]}</a>`).join('')}${['Compare','Shareholding','News & Events','Research Notes'].map(x=>`<span title="Coming later">${x}</span>`).join('')}<b class="mini">${esc(s)} <em>₹${T.fmt(price,2)}</em>${chg!=null?` <i class="${cls(chg)}">${chg>=0?'+':''}${T.fmt(chg,2)}%</i>`:''}</b></div>`;

  // valuation summary (overview side card)
  let vs='';
  const vrow=(k,v)=>`<div class="vrow"><span class="mut">${k}</span><b>${v}</b></div>`;
  const vbig=(fair,label)=>{const up=fair!=null&&price?(fair/price-1)*100:null;return `<div class="vbig"><div class="tile"><div class="k">${label}</div><div class="tv">${fair!=null?'₹'+T.fmt(fair,0):'–'}</div></div><div class="tile"><div class="k">Upside</div><div class="tv ${cls(up)}">${up!=null?(up>=0?'+':'')+T.fmt(up,1)+'%':'–'}</div></div></div>`};
  if(dcf){const r=T.recompute(dcf,{rf:A.rf/100,erp:A.erp/100,gT:A.g/100});
    vs=`<div class="card"><h3>DCF valuation <span class="tag">${esc(dcf.reliability||'')}</span></h3>${vbig(r?r.perShare:null,'DCF fair value')}${vrow('WACC',r?T.fmt(r.wacc*100,2)+'%':'–')}${vrow('Terminal growth',T.fmt(A.g,1)+'%')}${vrow('Cost of equity',r&&r.ke!=null?T.fmt(r.ke*100,2)+'%':'–')}${vrow('Beta used',T.fmt(dcf.assumptions.beta_used,2))}<div style="margin-top:8px"><a class="link" href="#/stock/${esc(s)}/valuation">View DCF model →</a></div></div>`}
  else if(fin){const r=T.finModel(fin,{rf:A.rf/100,erp:A.erp/100,g:A.g/100});
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
     <div>${keyRatios}${vs}</div></div>`;
    h+=technicals();
  }else if(tab==='financials'){
    const tl=(k,v)=>`<div class="tile"><div class="k">${k}</div><div class="tv">${v}</div></div>`;
    FIN_RATIO=`<div class="fcard card"><h3>Key metrics<span class="mut" style="font-weight:400;font-size:12px">FY ${esc(met?met.latest_fy:'')}</span></h3><div class="mtiles">${tl('P/E (used)',T.fmt(V.pe_used))}${tl('P/B',T.fmt(V.pb))}${tl('EV/EBITDA',T.fmt(V.ev_ebitda))}${tl('FCF yield %',T.fmt(V.fcf_yield_pct))}${tl('Market cap ₹cr',T.fmt(V.market_cap_cr,0))}${tl('ROE %',T.fmt(R.roe_pct))}${tl('ROCE %',T.fmt(R.roce_pct))}${tl('Debt/Equity',T.fmt(R.debt_equity,2))}${tl('Piotroski',met&&met.piotroski&&met.piotroski.score!=null?met.piotroski.score:'–')}${tl('Altman Z″',met&&met.altman_z2&&met.altman_z2.z!=null?T.fmt(met.altman_z2.z,2)+' ('+esc(met.altman_z2.zone||'')+')':(met&&met.type==='financial'?'n/a for financials':'–'))}${tl('Revenue CAGR %',T.fmt(G.revenue_cagr_pct))}${tl('Net income CAGR %',T.fmt(G.net_income_cagr_pct))}${tl('Years used',G.years_used??'–')}</div>${met&&(met.flags||[]).length?`<p class="warn">${met.flags.map(esc).join(' · ')}</p>`:''}<div id="ratslot"></div></div>`;
    FIN_RATIO=FIN_RATIO.replace('<div id="ratslot"></div>',ratiosHtml(rat));
    h+='<div class="subtabs" id="fsub"></div><div id="fbody"></div>';
  }else if(tab==='valuation'){
    h+='<div class="subtabs" id="vsub"></div><div id="vbody"></div>';
  }else if(tab==='peers'){
    h+='<div id="peerbody"><div class="skel" style="height:320px"></div></div>';
  }else if(tab==='quant'){
    h+=technicals()||'<div class="card">No risk data for this stock.</div>';
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

window.addEventListener('resize',()=>{try{const on=document.querySelector('#topnav a.on'),pl=document.getElementById('pill');if(on&&pl){pl.style.left=on.offsetLeft+'px';pl.style.width=on.offsetWidth+'px'}}catch(e){}});

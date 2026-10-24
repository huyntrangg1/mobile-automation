// Dashboard, bộ lọc chung, biểu đồ, bảng High-Priority, CSV, sáng / tối — đọc dữ liệu từ DOM của report.
// ===== IK Fitness QA — dashboard, bộ lọc chung, biểu đồ, bảng ưu tiên =====
(function(){
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const FLOW='Luồng chung';
const ST=[['passed','Passed','var(--pass)'],['failed','Failed','var(--fail)'],['blocked','Blocked','var(--blocked)'],['skipped','Skipped','var(--skipped)'],['notrun','Not Run','var(--border-strong)']];
const PR=[['Very High','P0','var(--sev-critical)'],['High','P1','var(--sev-major)'],['Normal','P2','var(--sev-minor)'],['Low','P3','var(--sev-trivial)']];
const SV=[['Critical','var(--sev-critical)'],['Major','var(--sev-major)'],['Minor','var(--sev-minor)'],['Trivial','var(--sev-trivial)']];
const TY=[['Function','var(--chart-1)'],['UI','var(--chart-4)']];
const RANKP={'Very High':0,High:1,Normal:2,Low:3},RANKS={Critical:0,Major:1,Minor:2,Trivial:3};

// ---- Data model đọc từ DOM (giữ nguyên file report gốc) ----
const tests=$$('.table>details.row').map(el=>({el,id:el.dataset.t,tc:el.dataset.tc,suite:el.dataset.suite,status:el.dataset.status,sec:+el.dataset.sec||0,
  name:(el.querySelector('.c-name')||{}).textContent||'',bugs:[]}));
const byT=Object.fromEntries(tests.map(t=>[t.id,t]));
const bugs=$$('.bugcards>details.bug').map(el=>{const d=JSON.parse(el.dataset.bug);return{el,id:d.id,title:d.title,short:d.short||d.title,
  type:el.dataset.type,priority:el.dataset.priority,severity:el.dataset.severity,module:el.dataset.screen||FLOW,tests:(el.dataset.tests||'').split(' ').filter(Boolean),
  text:(d.id+' '+d.title+' '+(d.actual||'')+' '+(d.expected||'')).toLowerCase()}});
bugs.forEach(b=>b.tests.forEach(t=>byT[t]&&byT[t].bugs.push(b)));
tests.forEach(t=>t.text=(t.tc+' '+t.name+' '+t.bugs.map(b=>b.id).join(' ')).toLowerCase());
const K='test-report-asana:'+document.body.dataset.app+':'+document.body.dataset.run+':';
const ls=k=>{try{return localStorage.getItem(k)}catch{return null}};
const logged=b=>ls(K+b.id),owner=b=>ls(K+b.id+':owner');

// ---- Header: tổng thời gian chạy (file gốc ghi 0.0s) ----
const fmt=s=>{s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return(h?h+'h ':'')+(h||m?m+'m ':'')+x+'s'};
$('#m-dur').textContent=fmt(tests.reduce((a,t)=>a+t.sec,0));

// ---- Bộ lọc chung ----
const F={q:'',suite:'',status:'',type:'',priority:'',severity:''};
const IDS={q:'#flt-q',suite:'#flt-suite',status:'#flt-status',type:'#flt-type',priority:'#flt-priority',severity:'#flt-severity'};
const TEST_KEYS=['suite','status'],BUG_KEYS=['type','priority','severity'];
function testOk(t,skip){return TEST_KEYS.every(k=>k===skip||!F[k]||t[k]===F[k])}
function bugOwn(b,skip){return BUG_KEYS.every(k=>k===skip||!F[k]||b[k]===F[k])}
// skip: bỏ qua 1 chiều lọc để biểu đồ của chiều đó vẫn hiện đủ (cross-filter)
function compute(skip){
  const q=F.q.toLowerCase().trim(),bugActive=BUG_KEYS.some(k=>k!==skip&&F[k]),testActive=TEST_KEYS.some(k=>k!==skip&&F[k]);
  const T0=tests.filter(t=>testOk(t,skip));const t0=new Set(T0.map(t=>t.id));
  const B=bugs.filter(b=>bugOwn(b,skip)&&(!testActive||b.tests.some(id=>t0.has(id)))&&(!q||b.text.includes(q)));
  const bset=new Set(B);
  const T=T0.filter(t=>(!bugActive||t.bugs.some(b=>bset.has(b)))&&(!q||t.text.includes(q)));
  return{T,B};
}
function setF(k,v,toggle){F[k]=toggle&&F[k]===v?'':v;$(IDS[k]).value=F[k];render()}
Object.entries(IDS).forEach(([k,s])=>$(s).addEventListener(k==='q'?'input':'change',e=>{F[k]=e.target.value;render()}));
window.resetFilters=function(){Object.keys(F).forEach(k=>{F[k]='';$(IDS[k]).value=''});render()};
$('#flt-reset').onclick=resetFilters;
document.addEventListener('keydown',e=>{
  if(e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){e.preventDefault();$('#flt-q').focus()}
  if(e.key==='Escape'){const z=$('.zoom');if(z)z.remove();else{const m=$('#asana-modal');if(m)m.classList.remove('on')}}
});

// ---- Vẽ ----
const SVG=(w,h,inner,label)=>`<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${inner}</svg>`;
function donut(segs,center,sub,key){
  const size=148,sw=18,r=(size-sw)/2,c=2*Math.PI*r,tot=segs.reduce((a,s)=>a+s.v,0),nz=segs.filter(s=>s.v>0).length;let acc=0;
  const arcs=segs.map(s=>{if(!s.v)return'';const len=s.v/(tot||1)*c,g=nz>1?2:0;
    const el=`<circle class="arc${F[key]&&F[key]!==s.val?' dim':''}" data-k="${key}" data-v="${esc(s.val)}" data-tip="${esc(s.l)}: ${s.v}/${tot} (${Math.round(s.v/tot*100)}%)" cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${s.c}" stroke-width="${sw}" stroke-dasharray="${Math.max(0,len-g)} ${c}" stroke-dashoffset="${-acc}" transform="rotate(-90 ${size/2} ${size/2})"/>`;acc+=len;return el}).join('');
  const svg=SVG(size,size,`<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--chart-grid)" stroke-width="${sw}"/>${arcs}<text class="d-center" x="${size/2}" y="${size/2+4}" text-anchor="middle">${esc(center)}</text><text class="d-sub" x="${size/2}" y="${size/2+20}" text-anchor="middle">${esc(sub)}</text>`,segs.map(s=>s.l+' '+s.v).join(', '));
  const lg=segs.map(s=>`<li><button type="button" class="lg${F[key]===s.val?' on':F[key]?' dim':''}" data-k="${key}" data-v="${esc(s.val)}"><span class="sw" style="background:${s.c}"></span>${esc(s.l)}</button><span class="lv">${s.v}</span><span class="lp">${tot?Math.round(s.v/tot*1000)/10:0}%</span></li>`).join('');
  return `<div class="donut">${svg}<ul class="legend">${lg}</ul></div>`;
}
// key null → biểu đồ chỉ hiển thị, bấm không lọc
function barlist(items,key,max){
  if(!items.length)return'<p class="empty">Không có bug nào khớp bộ lọc.</p>';
  max=max||Math.max(1,...items.map(i=>i.v));
  return '<ul class="bars">'+items.map(i=>{const dim=F[key]&&F[key]!==i.val?' dim':'',on=F[key]===i.val?' on':'';
    const parts=(i.parts||[{v:i.v,c:i.c}]).filter(p=>p.v).map(p=>`<i style="width:${p.v/max*100}%;background:${p.c}"></i>`).join('');
    const kv=key?` data-k="${key}" data-v="${esc(i.val)}"`:'';
    return `<li>${key?`<button type="button" class="bar-l${dim}${on}"${kv} title="${esc(i.l)}">${esc(i.l)}</button>`:`<span class="bar-l" title="${esc(i.l)}">${esc(i.l)}</span>`}<span class="bar-t${dim}"${kv} data-tip="${esc(i.tip||i.l+': '+i.v)}">${parts}</span><span class="bar-v">${i.v}</span></li>`}).join('')+'</ul>';
}
const cnt=(arr,f)=>arr.reduce((m,x)=>(m[f(x)]=(m[f(x)]||0)+1,m),{});

function render(){
  const {T,B}=compute();
  // Hiện / ẩn
  const tv=new Set(T),bv=new Set(B);
  tests.forEach(t=>t.el.style.display=tv.has(t)?'':'none');
  bugs.forEach(b=>b.el.style.display=bv.has(b)?'':'none');
  const any=Object.values(F).some(Boolean);
  $('#flt-count').textContent=any?`${T.length}/${tests.length} test · ${B.length}/${bugs.length} bug`:'';
  $('#tc-n').textContent=T.length===tests.length?tests.length+' test case':T.length+'/'+tests.length+' test case';
  $('#bf-n').textContent=B.length===bugs.length?bugs.length+' bug':B.length+'/'+bugs.length+' bug đang hiện';
  $$('.fbar .sel,.fbar .inp').forEach(s=>s.classList.toggle('on',!!s.value));

  // KPI + biểu đồ trạng thái: bỏ qua bộ lọc Kết quả để thấy đủ phân bố
  const TS=compute('status').T,sc=cnt(TS,t=>t.status),tot=TS.length,exec=tot-(sc.notrun||0)-(sc.skipped||0);
  const rate=exec?Math.round((sc.passed||0)/exec*1000)/10:0,nLogged=B.filter(logged).length;
  const kpi=(k,v,label,color,extra='')=>`<button type="button" class="card kpi${F.status===k&&k?' on':''}" ${k?`data-k="status" data-v="${k}"`:'data-reset="1"'}><span class="kpi-top">${color?`<span class="dot" style="background:${color}"></span>`:''}<span class="overline">${label}</span></span><span class="kpi-v">${v}</span>${extra}</button>`;
  $('#kpis').innerHTML=kpi('',tot,'Total cases','var(--ink)',`<span class="kpi-hint">${fmt(TS.reduce((a,t)=>a+t.sec,0))}</span>`)
    +kpi('passed',sc.passed||0,'Passed','var(--pass)')+kpi('failed',sc.failed||0,'Failed','var(--fail)')+kpi('blocked',sc.blocked||0,'Blocked','var(--blocked)')
    +`<div class="card kpi" style="cursor:default"><span class="kpi-top"><span class="overline">Pass rate</span></span><span class="kpi-v">${rate}<small>%</small></span><span class="meter"><span style="width:${rate}%"></span></span><span class="kpi-hint">${sc.passed||0}/${exec} đã chạy</span></div>`
    +`<a class="card kpi" href="#bugs" style="text-decoration:none;color:inherit"><span class="kpi-top"><span class="dot" style="background:var(--fail)"></span><span class="overline">Bugs</span></span><span class="kpi-v">${B.length}</span><span class="kpi-hint">${nLogged} đã log Asana</span></a>`;
  $('#c-exec-sub').textContent=tot+' test case · '+(document.body.dataset.run||'');
  $('#c-exec').innerHTML=donut(ST.map(([v,l,c])=>({val:v,l,c,v:sc[v]||0})),rate+'%','PASS RATE','status');

  const BP=compute('priority').B,pc=cnt(BP,b=>b.priority);
  $('#c-prio').innerHTML=barlist(PR.map(([v,code,c])=>({val:v,l:code+' · '+v,v:pc[v]||0,c})),'priority');
  const BM=B,mods={};
  BM.forEach(b=>{(mods[b.module]=mods[b.module]||{Function:0,UI:0})[b.type]=(mods[b.module][b.type]||0)+1});
  const mi=Object.entries(mods).map(([m,o])=>({val:m,l:m,v:o.Function+o.UI,parts:TY.map(([t,c])=>({v:o[t]||0,c})),tip:`${m}: Function ${o.Function||0} · UI ${o.UI||0}`})).sort((a,b)=>b.v-a.v);
  const tyc=cnt(BM,b=>b.type);
  $('#c-module').innerHTML=barlist(mi,null)+`<div class="chart-legend">${TY.map(([t,c])=>`<span><span class="sw" style="background:${c}"></span>${t} <b class="mono">${tyc[t]||0}</b></span>`).join('')}</div>`;
  const BS=compute('severity').B,svc=cnt(BS,b=>b.severity);
  $('#c-sev').innerHTML=donut(SV.map(([v,c])=>({val:v,l:v,c,v:svc[v]||0})),BS.length,'BUGS','severity');

  // Bảng High-Priority Issues
  const only=$('#hp-only').checked,HP=B.filter(b=>!only||RANKP[b.priority]<=1).sort((a,b)=>RANKP[a.priority]-RANKP[b.priority]||RANKS[a.severity]-RANKS[b.severity]||a.id.localeCompare(b.id));
  $('#hp-n').textContent=HP.length+' bug';
  $('#hp-body').innerHTML=HP.length?HP.map(b=>{const u=logged(b);return `<tr data-goto-bug="${esc(b.id)}" tabindex="0"><td class="mono">${esc(b.id)}</td><td class="ttl" title="${esc(b.title)}">${esc(b.short)}</td><td>${esc(b.module)}</td><td><span class="type type-${esc(b.type)}">${esc(b.type)}</span></td><td><span class="sev sev-${esc(b.severity)}"><span class="sev-bars"><i></i><i></i><i></i><i></i></span>${esc(b.severity)}</span></td><td><span class="prio prio-${b.priority.replace(' ','')}"><b>${PR.find(p=>p[0]===b.priority)?.[1]||''}</b>${esc(b.priority)}</span></td><td>${u?`<a class="logged" href="${esc(u)}" target="_blank" rel="noopener">✓ Đã log ↗</a>`:'<span class="badge st-fail">Open</span>'}</td><td>${esc(owner(b)||'—')}</td></tr>`}).join(''):`<tr><td colspan="8" class="muted" style="text-align:center;padding:24px;cursor:default">Không có bug ${only?'High / Very High ':''}nào khớp bộ lọc.</td></tr>`;
}
window.onBugLogged=()=>render();
$('#hp-only').onchange=render;

// Bấm biểu đồ / KPI / legend → lọc (bấm lại để bỏ lọc)
document.addEventListener('click',e=>{
  const r=e.target.closest('[data-reset]');if(r){setF('status','');return}
  const x=e.target.closest('[data-k][data-v]');if(x&&!x.closest('.modal')){setF(x.dataset.k,x.dataset.v,true);return}
  const g=e.target.closest('tr[data-goto-bug]');if(g&&!e.target.closest('a'))openBug(g.dataset.gotoBug);
});
document.addEventListener('keydown',e=>{const g=e.target.closest&&e.target.closest('tr[data-goto-bug]');if(g&&e.key==='Enter')openBug(g.dataset.gotoBug)});
function openBug(id){const c=document.getElementById('bug-'+id);if(!c)return;if(c.style.display==='none')resetFilters();c.open=true;
  c.scrollIntoView({behavior:'smooth',block:'start'});c.classList.add('flash');setTimeout(()=>c.classList.remove('flash'),1600)}

// Mở / thu gọn
$('#tc-expand').onclick=()=>tests.forEach(t=>{if(t.el.style.display!=='none')t.el.open=true});
$('#tc-collapse').onclick=()=>tests.forEach(t=>t.el.open=false);
$('#bug-expand').onclick=e=>{const open=e.currentTarget.dataset.o!=='1';bugs.forEach(b=>{if(b.el.style.display!=='none')b.el.open=open});e.currentTarget.dataset.o=open?'1':'0';e.currentTarget.textContent=open?'Thu gọn':'Mở tất cả'};

// Xuất CSV bug đang hiện (mở được bằng Excel, giữ dấu tiếng Việt)
$('#bug-csv').onclick=()=>{
  const B=bugs.filter(b=>b.el.style.display!=='none'),q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const rows=[['Bug ID','Title','Module','Type','Severity','Priority','Test cases','Actual','Expected','Asana','Owner']].concat(B.map(b=>{const d=JSON.parse(b.el.dataset.bug);
    return[b.id,b.title,b.module,b.type,b.severity,b.priority,b.tests.map(t=>byT[t]?.tc).join(' '),d.actual,d.expected,logged(b)||'',owner(b)||'']}));
  const blob=new Blob(['﻿'+rows.map(r=>r.map(q).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(document.body.dataset.app||'report')+'-bugs.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};

// Giao diện sáng / tối (nhớ theo trình duyệt); in luôn dùng nền sáng
const root=document.documentElement,TK='ikqa-theme';
const sysDark=()=>matchMedia('(prefers-color-scheme: dark)').matches;
const applyTheme=t=>{if(t)root.dataset.theme=t;else delete root.dataset.theme};
applyTheme(ls(TK));
$('#theme').onclick=()=>{const cur=root.dataset.theme||(sysDark()?'dark':'light'),nx=cur==='dark'?'light':'dark';applyTheme(nx);try{localStorage.setItem(TK,nx)}catch{}};
let prevTheme;addEventListener('beforeprint',()=>{prevTheme=root.dataset.theme;root.dataset.theme='light'});
addEventListener('afterprint',()=>applyTheme(prevTheme));

render();
})();

// Log bug lên Asana (chỉ có ở bản đầy đủ, bản share bỏ file này). Nhúng nguyên văn vào <script> của report.
// ===== Log bug lên Asana: mỗi bug = 1 subtask dưới task cha + ảnh evidence; chọn 1 hoặc nhiều bug =====
// Token chỉ nằm trong localStorage của người dùng, không ghi vào file → gửi report cho người khác không lộ token.
const API='https://app.asana.com/api/1.0';
const store={get:k=>{try{return localStorage.getItem(k)}catch{return null}},set:(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch{}}};
const K_TOKEN='test-report-asana-token',K_PARENT='test-report-asana-parent';
const doneKey=id=>'test-report-asana:'+document.body.dataset.app+':'+document.body.dataset.run+':'+id;
// Link task Asana: /0/<project>/<task>[/f], /1/<ws>/project/<p>/task/<task>, hoặc GID
const parseTask=s=>{s=String(s).trim();const m=s.match(/\/task\/(\d+)/)||s.match(/\/0\/\d+\/(\d+)/)||s.match(/^(\d{6,})$/);return m&&m[1]};
async function asana(path,token,{method='GET',json,form}={}){
  const headers={Authorization:'Bearer '+token};if(json)headers['Content-Type']='application/json';
  const r=await fetch(API+path,{method,headers,body:json?JSON.stringify({data:json}):form});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){const e=new Error((j.errors&&j.errors[0]&&j.errors[0].message)||('HTTP '+r.status));e.status=r.status;throw e}
  return j.data;
}
const $m=id=>document.getElementById(id);
// imgs: ảnh evidence của bug (mỗi màn 1 ảnh — data-occ), đặt tên file theo data-name khi đính kèm
const bugOf=card=>({card,...JSON.parse(card.dataset.bug),imgs:[...card.querySelectorAll('.evidence img[data-occ]')]});
const markDone=(card,url)=>{
  const btn=card.querySelector('button.asana');if(btn){const a=document.createElement('a');a.className='asana btn btn-sm';a.href=url;a.target='_blank';a.rel='noopener';a.textContent='Đã log ↗';a.dataset.id=btn.dataset.id;btn.replaceWith(a)}
  const p=card.querySelector('.pick');p.checked=false;p.disabled=true;p.title='Đã log lên Asana';window.onBugLogged&&window.onBugLogged();
};
document.querySelectorAll('.bug').forEach(c=>{const u=store.get(doneKey(bugOf(c).id));if(u)markDone(c,u)});

// Chọn nhiều bug
const picks=()=>[...document.querySelectorAll('.pick:checked')].map(p=>bugOf(p.closest('.bug')));
const refreshSel=()=>{const n=picks().length;$m('selbar').classList.toggle('on',n>0);$m('sel-n').textContent='Đã chọn '+n+' bug'};
document.addEventListener('change',e=>{if(e.target.classList.contains('pick'))refreshSel()});
$m('sel-clear').onclick=()=>{document.querySelectorAll('.pick').forEach(p=>p.checked=false);refreshSel()};
// Chọn tất cả bug đang hiện theo bộ lọc (chưa log)
if($m('pick-all'))$m('pick-all').onclick=()=>{document.querySelectorAll('.bugcards>.bug').forEach(c=>{const p=c.querySelector('.pick');if(p&&!p.disabled&&c.style.display!=='none')p.checked=true});refreshSel()};

// ----- Nội dung bug gửi Asana -----
// html_notes chỉ dùng thẻ Asana cho phép (h2, ol, ul, li, strong…), KHÔNG dùng <p>; đoạn văn viết thẳng, xuống dòng bằng \n.
// Priority không ghi trong nội dung — set bằng custom field.
const H=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const uniq=a=>[...new Set(a)];
const RANK=['Low','Normal','High','Very High'];
function noteHtml(bs,withImg){
  const b=bs[0],li=a=>a.map(x=>'<li>'+H(x)+'</li>').join('');
  let h='<body>';
  // Affected Area chỉ khi lỗi xuất hiện trên nhiều màn (không liệt kê test / bộ data — log 1 bản đại diện)
  const screens=uniq(bs.flatMap(x=>x.screens));if(screens.length>1)h+='<h2>Affected Area</h2><ul>'+li(screens)+'</ul>';
  if(b.pre.length)h+='<h2>Precondition</h2><ol>'+li(b.pre)+'</ol>';
  h+='<h2>Steps to Reproduce</h2><ol>'+li(b.steps)+'</ol>';
  h+='<h2>Actual</h2>'+H(uniq(bs.map(x=>x.actual)).join('\n'));
  h+='<h2>Expected</h2>'+H(uniq(bs.map(x=>x.expected)).join('\n'));
  const nImg=bs.reduce((n,x)=>n+x.imgs.length,0);
  if(withImg&&nImg)h+='<h2>Attachment</h2>Ảnh evidence đính kèm (phần lỗi khoanh đỏ)'+(nImg>1?' — '+nImg+' ảnh':'');
  return h+'</body>';
}
// 1 subtask = 1 item: 1 bug, hoặc nhiều bug UI cùng màn gộp lại; Priority item = cao nhất trong nhóm
const one=b=>({bugs:[b],title:b.title,priority:b.priority,imgs:b.imgs});
function mergedUi(bs){
  if(bs.length===1)return one(bs[0]);
  const shorts=uniq(bs.map(b=>b.short));
  const title='[BUG]['+bs[0].feature+' - '+bs[0].screen+'] '+(shorts.length===1?shorts[0]:shorts.length+' lỗi UI: '+shorts.join('; '));
  const imgs=[],seen=new Set();for(const b of bs)for(const img of b.imgs)if(!seen.has(img.src)){seen.add(img.src);imgs.push(img)}
  const priority=RANK[Math.max(...bs.map(b=>RANK.indexOf(b.priority)))];
  return {bugs:bs,title,priority,imgs};
}
function itemsOf(bugs,merge){
  const slots=[],ui=new Map();
  for(const b of bugs){
    if(merge&&b.type==='UI'&&b.screen){if(!ui.has(b.screen)){ui.set(b.screen,[]);slots.push({screen:b.screen})}ui.get(b.screen).push(b)}
    else slots.push({bug:b});
  }
  return slots.map(x=>x.bug?one(x.bug):mergedUi(ui.get(x.screen)));
}

// ----- Form (Bước review của skill: xem đủ nội dung, sửa Title / Priority rồi mới tạo) -----
const modal=$m('asana-modal');let picked=[],queue=[];
const setStatus=(t,cls='')=>{$m('f-status').textContent=t;$m('f-status').className='status '+cls};
const showToken=()=>{const saved=!!store.get(K_TOKEN);$m('f-token-box').style.display=saved?'none':'';$m('f-token-saved').style.display=saved?'':'none'};
$m('f-forget').onclick=()=>{store.set(K_TOKEN,null);showToken()};
$m('f-cancel').onclick=()=>modal.classList.remove('on');
modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.remove('on')});
const attachOn=()=>$m('f-attach').checked;
const prioSelect=it=>{const s=document.createElement('select');RANK.slice().reverse().forEach(p=>{const o=document.createElement('option');o.textContent=p;o.selected=p===it.priority;s.append(o)});s.onchange=()=>it.priority=s.value;return s};
function renderList(){
  queue=itemsOf(picked,$m('f-merge').checked);
  $m('f-bulk-n').textContent='— '+picked.length+' bug → '+queue.length+' subtask';
  $m('f-list').innerHTML='';
  for(const it of queue){
    const li=document.createElement('li');li.append(it.title);li.append(prioSelect(it));
    if(it.bugs.length>1){const sm=document.createElement('small');sm.textContent=' — gộp '+it.bugs.length+' bug, '+it.imgs.length+' ảnh';li.append(sm)}
    const d=document.createElement('details');d.innerHTML='<summary>Xem nội dung</summary><div class="preview">'+noteHtml(it.bugs,attachOn()&&it.imgs.length)+'</div>';li.append(d);
    it.li=li;$m('f-list').append(li);
  }
  $m('f-submit').textContent='Tạo '+queue.length+' subtask';
}
$m('f-merge').onchange=renderList;
$m('f-attach').onchange=()=>{if(picked.length>1)renderList();else $m('f-preview').innerHTML=noteHtml(queue[0].bugs,attachOn()&&queue[0].imgs.length)};
function openForm(list){
  picked=list;const single=list.length===1;
  $m('f-single').style.display=single?'':'none';$m('f-bulk').style.display=single?'none':'';
  const anyImg=list.some(b=>b.imgs.length);$m('f-attach').checked=anyImg;$m('f-attach').disabled=!anyImg;
  if(single){queue=[one(list[0])];$m('f-title').value=queue[0].title;$m('f-priority').value=queue[0].priority;
    $m('f-preview').innerHTML=noteHtml(queue[0].bugs,anyImg);$m('f-submit').textContent='Tạo subtask'}
  else{
    // Chỉ hiện tuỳ chọn gộp khi có ≥ 2 bug UI cùng màn
    const cnt={};list.filter(b=>b.type==='UI').forEach(b=>cnt[b.screen]=(cnt[b.screen]||0)+1);
    $m('f-merge-row').style.display=Object.values(cnt).some(n=>n>1)?'':'none';
    renderList();
  }
  $m('f-parent').value=store.get(K_PARENT)||'';
  $m('f-submit').disabled=false;$m('f-merge').disabled=false;
  setStatus('');showToken();modal.classList.add('on');
}
document.addEventListener('click',e=>{const b=e.target.closest('button.asana[data-id]');if(b)openForm([bugOf(b.closest('.bug'))])});
$m('sel-log').onclick=()=>{const l=picks();if(l.length)openForm(l)};

// Custom field Priority của project chứa task cha (skill Bước 5): tên field chứa "Priority", map theo tên option gần nhất
const SYN={'Very High':['very high','urgent','critical','highest'],High:['high'],Normal:['normal','medium'],Low:['low','lowest']};
async function priorityField(token,task){
  for(const m of task.memberships||[]){
    if(!m.project)continue;
    const pr=await asana('/projects/'+m.project.gid+'?opt_fields=custom_field_settings.custom_field.gid,custom_field_settings.custom_field.name,custom_field_settings.custom_field.enum_options.gid,custom_field_settings.custom_field.enum_options.name,custom_field_settings.custom_field.enum_options.enabled',token);
    const f=(pr.custom_field_settings||[]).map(x=>x.custom_field).find(cf=>/priority/i.test(cf.name)&&cf.enum_options);
    if(f)return{gid:f.gid,name:f.name,option:p=>{const o=f.enum_options.filter(x=>x.enabled!==false);for(const w of SYN[p]||[]){const hit=o.find(x=>x.name.trim().toLowerCase()===w);if(hit)return hit.gid}return null}};
  }
  return null;
}
async function logItem(it,{token,parent,assignee,attach,single,field}){
  const withImg=attach&&it.imgs.length>0;
  const prio=single?$m('f-priority').value:it.priority;
  const data={name:single?$m('f-title').value.trim():it.title,html_notes:noteHtml(it.bugs,withImg)};
  if(assignee)data.assignee=assignee;
  const opt=field&&field.option(prio);
  let sub,prioSet=false;
  if(opt){
    try{sub=await asana('/tasks/'+parent+'/subtasks?opt_fields=permalink_url',token,{method:'POST',json:{...data,custom_fields:{[field.gid]:opt}}});prioSet=true}
    catch(err){if(err.status!==400)throw err} // field không gán được cho subtask → tạo không có Priority, báo set tay
  }
  if(!sub)sub=await asana('/tasks/'+parent+'/subtasks?opt_fields=permalink_url',token,{method:'POST',json:data});
  if(withImg)for(const img of it.imgs){
    const fd=new FormData();fd.append('parent',sub.gid);
    fd.append('file',await (await fetch(img.src)).blob(),(img.dataset.name||it.bugs[0].id)+'.jpg');
    await asana('/attachments',token,{method:'POST',form:fd});
  }
  for(const b of it.bugs){store.set(doneKey(b.id),sub.permalink_url);if(assignee)store.set(doneKey(b.id)+':owner',assignee);markDone(b.card,sub.permalink_url)}
  return {prioSet,prio};
}
modal.querySelector('form').addEventListener('submit',async e=>{
  e.preventDefault();
  const token=store.get(K_TOKEN)||$m('f-token').value.trim();
  const parent=parseTask($m('f-parent').value);
  if(!token)return setStatus('Nhập Asana token','err');
  if(!parent)return setStatus('Không đọc được ID task cha từ link','err');
  $m('f-submit').disabled=true;$m('f-merge').disabled=true;
  const opts={token,parent,assignee:$m('f-assignee').value.trim(),attach:attachOn(),single:picked.length===1};
  let p;
  try{
    setStatus('Đang kiểm tra task cha…');
    p=await asana('/tasks/'+parent+'?opt_fields=name,memberships.project.gid,memberships.project.name',token);
    opts.field=await priorityField(token,p).catch(()=>null);
  }catch(err){
    if(err.status===401){store.set(K_TOKEN,null);showToken();setStatus('Token không hợp lệ hoặc hết hạn — nhập lại','err')}
    else if(err.status===404)setStatus('Không tìm thấy task cha (hoặc token không có quyền xem task đó)','err');
    else setStatus('Lỗi Asana: '+err.message,'err');
    $m('f-submit').disabled=false;$m('f-merge').disabled=false;return;
  }
  if(!store.get(K_TOKEN)&&$m('f-remember').checked)store.set(K_TOKEN,token);
  store.set(K_PARENT,$m('f-parent').value.trim());
  // Tạo lần lượt; 1 subtask lỗi không chặn các subtask còn lại, cuối cùng báo cái nào lỗi
  let ok=0;const failed=[],noPrio=[];
  for(const [i,it] of queue.entries()){
    setStatus('Đang tạo '+(i+1)+'/'+queue.length+' dưới "'+p.name+'"…');
    try{const r=await logItem(it,opts);ok++;if(!r.prioSet)noPrio.push(it.bugs.map(b=>b.id).join('+')+' ('+r.prio+')');if(it.li){it.li.className='ok';it.li.prepend('✓ ')}}
    catch(err){failed.push(it.bugs.map(b=>b.id).join('+')+': '+err.message);if(it.li){it.li.className='err';it.li.prepend('✗ ');it.li.append(' — '+err.message)}}
  }
  refreshSel();
  // Skill Bước 8: Priority không set được → nhắc set tay
  const prioNote=noPrio.length?' · Chưa set được Priority trên Asana'+(opts.field?'':' (project không có field Priority)')+', cần set tay: '+noPrio.join(', '):'';
  if(!failed.length){setStatus('Đã tạo '+ok+' subtask dưới "'+p.name+'"'+prioNote,noPrio.length?'err':'ok');if(!noPrio.length)setTimeout(()=>modal.classList.remove('on'),1400)}
  else{setStatus('Tạo được '+ok+'/'+queue.length+'. Lỗi: '+failed.join(' · ')+prioNote,'err');
    queue=queue.filter(it=>!it.bugs.every(b=>store.get(doneKey(b.id))));
    $m('f-submit').disabled=!queue.length;$m('f-submit').textContent='Thử lại '+queue.length+' subtask lỗi'}
});

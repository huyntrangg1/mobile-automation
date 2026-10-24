// Script chung của report: copy bug, phóng ảnh, nhảy tới bug, in PDF. Nhúng nguyên văn vào <script>.
document.querySelectorAll('.copy').forEach(b=>b.addEventListener('click',async()=>{
  const t=b.dataset.text;try{await navigator.clipboard.writeText(t)}catch{const a=document.createElement('textarea');a.value=t;document.body.append(a);a.select();document.execCommand('copy');a.remove()}
  const html=b.innerHTML;b.textContent='Đã copy';b.classList.add('ok');setTimeout(()=>{b.innerHTML=html;b.classList.remove('ok')},1500)}));
document.querySelectorAll('.evidence img.main').forEach(i=>i.addEventListener('click',()=>{const z=document.createElement('div');z.className='zoom';z.innerHTML='<img src="'+i.src+'">';z.onclick=()=>z.remove();document.body.append(z)}));
// Mở 1 test case → cuộn trong khung để thấy danh sách bước ngay
document.querySelectorAll('.table>details.row').forEach(d=>d.addEventListener('toggle',()=>{if(d.open)d.scrollIntoView({block:'nearest',behavior:'smooth'})}));
// Bug gặp nhiều lần: bấm ảnh nhỏ để xem ảnh của lần gặp đó
document.querySelectorAll('.thumbs img').forEach(t=>t.addEventListener('click',()=>{const f=t.closest('.evidence');
  f.querySelector('img.main').src=t.src;f.querySelector('figcaption').textContent=t.dataset.cap;f.querySelectorAll('.thumbs img').forEach(x=>x.classList.toggle('on',x===t))}));
// Mã bug ở dòng test → mở card bug trong danh sách Bug và cuộn tới
document.addEventListener('click',e=>{const a=e.target.closest('a[data-goto]');if(!a)return;e.preventDefault();
  const c=document.getElementById('bug-'+a.dataset.goto);if(!c)return;if(c.style.display==='none')resetFilters();c.open=true;
  c.scrollIntoView({behavior:'smooth',block:'start'});c.classList.add('flash');setTimeout(()=>c.classList.remove('flash'),1600)});
// Tooltip cho thanh dashboard
const tip=document.getElementById('tip');
document.addEventListener('mousemove',e=>{const t=e.target.closest('[data-tip]');if(!t){tip.style.display='none';return}
  tip.textContent=t.dataset.tip;tip.style.display='block';tip.style.left=Math.min(e.clientX+12,innerWidth-tip.offsetWidth-8)+'px';tip.style.top=(e.clientY+14)+'px'});

// PDF = in ra "Save as PDF": mở hết case fail khi in, xong trả lại như cũ
// wasOpen: trạng thái đóng/mở trước khi in (null = chưa ghi) — nút Export và Cmd+P đều đi qua đây
let wasOpen=null;
const expandForPrint=()=>{
  if(!wasOpen)wasOpen=[...document.querySelectorAll('details')].map(d=>d.open);
  resetFilters();
  document.querySelectorAll('details').forEach(d=>d.open=true);
};
addEventListener('beforeprint',expandForPrint);
addEventListener('afterprint',()=>{if(wasOpen)document.querySelectorAll('details').forEach((d,i)=>d.open=wasOpen[i]);wasOpen=null});
// Ảnh trong case đang đóng chưa được vẽ → mở hết, chờ mọi ảnh decode xong rồi mới mở hộp thoại in
document.querySelector('button.pdf').addEventListener('click',async()=>{
  expandForPrint();
  await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  print();
});

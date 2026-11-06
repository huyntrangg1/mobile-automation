// Report ngắn của AI Smoke Test: số liệu đầu trang, các điểm lệch (kèm ảnh + đoạn PRD), luồng chưa kết luận được.
// Bộ vẽ riêng của tool — không dùng / không sửa skill test-report.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KIND = { prd: 'Lệch PRD', figma: 'Lệch Figma', conflict: 'PRD và Figma mâu thuẫn', unclear: 'PRD chưa rõ', robust: 'Độ bền' };
const OPEN = { unverifiable: 'không kiểm được', unreachable: 'không tới được' };
const STATUS = { running: 'Đang chạy', done: 'Xong', stopped: 'Đã dừng', error: 'Lỗi', interrupted: 'Bị ngắt (server khởi động lại)' };
const num = (n) => Number(n || 0).toLocaleString('vi-VN');
const usageLine = (u) => (u && u.calls ? `${num(u.calls)} lần gọi AI · ${num(u.input + u.cacheCreate + u.cacheRead)} token vào (${num(u.cacheRead)} đọc từ cache) · ${num(u.output)} token ra · ≈ ${Number(u.costUsd || 0).toFixed(2)} USD` : '');
const when = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN') : '—');

const CSS = `:root{--s0:#f5f6f4;--s1:#fff;--s2:#eef0ed;--bd:#e1e4e0;--bds:#8c929a;--ink:#15181c;--mut:#545b64;--brand:#c6f432;--pass:#0072b2;--pass-s:#e2eff8;--pass-i:#00598c;--fail:#d55e00;--fail-s:#fbe8da;--fail-i:#9c4300;--blk:#e69f00;--blk-s:#fdf2d8;--blk-i:#7a4f00;--skp-s:#eceef0;--skp-i:#4a5059}
@media (prefers-color-scheme:dark){:root{--s0:#0f1114;--s1:#181b20;--s2:#20242b;--bd:#2c313a;--bds:#6b727c;--ink:#eef0f2;--mut:#a3aab4;--pass:#56b4e9;--pass-s:#12283a;--pass-i:#9fd2f3;--fail:#f0803a;--fail-s:#3a2214;--fail-i:#ffb184;--blk:#f0b429;--blk-s:#372c10;--blk-i:#ffd57a;--skp-s:#262a31;--skp-i:#c3c8cf}}
*{box-sizing:border-box}body{margin:0;background:var(--s0);color:var(--ink);font:14px/20px "IBM Plex Sans","Segoe UI",system-ui,sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px 48px;display:flex;flex-direction:column;gap:20px}
.hd{position:relative;background:var(--s1);border:1px solid var(--bd);border-radius:12px;padding:16px 20px 16px 24px;overflow:hidden}.hd::before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:var(--brand)}
.ov{font-size:11px;line-height:14px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--mut)}
h1{margin:2px 0 4px;font-size:22px;line-height:28px;font-weight:600;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.sub{color:var(--mut);font-size:13px;line-height:18px;margin:2px 0}.mono{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace}
.src{display:flex;flex-wrap:wrap;gap:4px 20px;margin-top:8px}
.st{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:600;background:var(--pass-s);color:var(--pass-i);white-space:nowrap}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.kpi{background:var(--s1);border:1px solid var(--bd);border-radius:12px;padding:12px 16px;display:flex;flex-direction:column;gap:4px}
.kpi b{font-size:28px;line-height:32px;font-weight:600;font-variant-numeric:tabular-nums}.kpi span{font-size:12px;color:var(--mut)}
.kpi.fail b{color:var(--fail-i)}.kpi.blk b{color:var(--blk-i)}.kpi.pass b{color:var(--pass-i)}
.note{background:var(--fail-s);color:var(--fail-i);border-radius:8px;padding:10px 14px}
h2{margin:0 0 10px;font-size:15px;line-height:22px;font-weight:600;display:flex;gap:8px;align-items:baseline}h2 small{font-weight:500;color:var(--mut);font-size:13px}
.f{background:var(--s1);border:1px solid var(--bd);border-radius:12px;padding:16px;margin:0 0 12px;display:grid;gap:10px}
.tag{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:4px;font-size:12px;font-weight:600;white-space:nowrap;margin-right:6px;vertical-align:1px}
.k-prd,.k-figma,.k-robust{background:var(--fail-s);color:var(--fail-i)}.k-conflict{background:var(--blk-s);color:var(--blk-i)}.k-unclear{background:var(--skp-s);color:var(--skp-i)}
blockquote{margin:0;padding:2px 12px;border-left:3px solid var(--bd);color:var(--mut);font-size:13px}
.shots{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}.shots figure{margin:0;display:grid;gap:6px;justify-items:center}
.shots img{display:block;max-height:360px;max-width:100%;object-fit:contain;border-radius:8px;border:1px solid var(--bd)}
figcaption{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--mut)}
details.card{background:var(--s1);border:1px solid var(--bd);border-radius:12px;padding:0}details.card>summary{cursor:pointer;padding:12px 16px;font-weight:600;list-style:none}
details.card>summary::-webkit-details-marker{display:none}details.card>summary::before{content:"▸";color:var(--mut);margin-right:8px;display:inline-block;transition:transform .15s}details.card[open]>summary::before{transform:rotate(90deg)}
details.card>summary small{font-weight:500;color:var(--mut);margin-left:6px}details.card>.in{padding:0 16px 4px}
table{width:100%;border-collapse:collapse;background:var(--s1);border:1px solid var(--bd);border-radius:12px;overflow:hidden}
th{background:var(--s2);text-align:left;padding:8px 12px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);font-weight:600}
td{padding:10px 12px;border-top:1px solid var(--bd);vertical-align:top}td.n{white-space:nowrap;color:var(--mut)}
.b{margin-left:6px;display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:4px;font-size:12px;font-weight:600;white-space:nowrap}
.s-ok{background:var(--pass-s);color:var(--pass-i)}.s-deviation{background:var(--fail-s);color:var(--fail-i)}.s-unreachable{background:var(--blk-s);color:var(--blk-i)}.s-unverifiable{background:var(--skp-s);color:var(--skp-i)}
.foot{color:var(--mut);font-size:12px;margin:0}
@media (max-width:720px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}td.n,th:nth-child(2){display:none}}
@media print{body{background:#fff}details.card:not([open])>*:not(summary){display:none}}`;

export function renderReport(run, appName) {
  const flows = run.flows || [];
  const findings = run.findings || [];
  const done = flows.filter((f) => f.status === 'ok' || f.status === 'deviation').length;
  const open = flows.filter((f) => OPEN[f.status]);
  const okNames = flows.filter((f) => f.status === 'ok').map((f) => f.name);
  const flowName = (id) => flows.find((f) => f.id === id)?.name || id;
  const shot = (src, cap) => (src ? `<figure><img src="${esc(src)}" alt="${esc(cap)}" loading="lazy"><figcaption>${esc(cap)}</figcaption></figure>` : '');
  const item = (x) => `<article class="f"><div><span class="tag k-${esc(x.kind)}">${esc(KIND[x.kind] || x.kind)}</span><b>${esc(x.summary)}</b></div>
<div class="sub">Luồng: ${esc(flowName(x.flowId))}${x.frameName ? ` · Frame Figma: ${esc(x.frameName)}` : ''}</div>
${x.prdQuote ? `<blockquote>${esc(x.prdQuote)}</blockquote>` : ''}<div class="shots">${shot(x.appShot, x.evidence ? 'So sánh: Figma (trái) · App (phải)' : 'App')}${shot(x.figmaShot, 'Figma')}</div></article>`;
  const REAL = findings.filter((x) => x.kind !== 'unclear');
  const UNCLEAR = findings.filter((x) => x.kind === 'unclear');
  const FL = { ok: 'Khớp', deviation: 'Có lệch', unreachable: 'không tới được', unverifiable: 'không kiểm được', pending: 'chờ', running: 'đang chạy' };
  const fRow = (f) => `<tr><td><b>${esc(f.name)}</b> <span class="b s-${esc(f.status)}">${esc(FL[f.status] || f.status)}</span><div class="sub">${esc(f.summary || '')}</div></td><td class="n">${f.steps > 0 ? `${f.steps} bước` : ''}</td></tr>`;
  const u = usageLine(run.usage);
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Smoke Test — ${esc(appName)}</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&family=IBM+Plex+Sans:wght@400;500;600&display=swap"><style>${CSS}</style></head><body><main>
<header class="hd"><div class="ov">AI Smoke Test · ${esc(appName)}</div>
<h1><span class="mono">${esc(run.id)}</span> <span class="st">${esc(STATUS[run.status] || run.status)}</span></h1>
<div class="sub">${esc(when(run.startedAt))}${run.finishedAt ? ` → ${esc(when(run.finishedAt))}` : ''}</div>
<div class="src">${[run.prdUrl && `<span class="sub">PRD: ${esc(run.prdUrl)}</span>`, run.figmaSource === 'json' ? `<span class="sub">Figma: file ${esc(run.figmaFileName || '.json')}</span>` : run.figmaUrl && `<span class="sub">Figma: ${esc(run.figmaUrl)}</span>`].filter(Boolean).join('')}</div>
${u ? `<div class="sub">Chi phí: ${esc(u)}</div>` : ''}</header>
${run.error ? `<div class="note">${esc(run.error)}</div>` : ''}
<div class="kpis"><div class="kpi fail"><b data-k="findings">${REAL.length}</b><span>Lệch PRD / Figma · lỗi thật, cần xem</span></div><div class="kpi blk"><b data-k="unclear">${UNCLEAR.length}</b><span>PRD chưa rõ · AI không kết luận được</span></div><div class="kpi pass"><b data-k="done">${done}</b><span>Đi hết luồng · trên <span data-k="flows">${flows.length}</span> luồng</span></div><div class="kpi"><b data-k="open">${open.length}</b><span>Chưa kết luận được · không tới được màn</span></div></div>
<section><h2>Lệch PRD / Figma <small>${REAL.length}</small></h2>${REAL.length ? REAL.map(item).join('') : '<p class="sub">Không thấy điểm lệch.</p>'}</section>
${UNCLEAR.length ? `<details class="card"><summary>PRD chưa rõ <small>${UNCLEAR.length} · AI không kết luận được là lỗi</small></summary><div class="in">${UNCLEAR.map(item).join('')}</div></details>` : ''}
${flows.length ? `<section><h2>Các luồng <small>${flows.length}</small></h2><table><thead><tr><th>Luồng</th><th>Bước</th></tr></thead><tbody>${flows.map(fRow).join('')}</tbody></table></section>` : ''}
<p class="foot">Chưa kiểm trong lần chạy này: mạng yếu hoặc mất mạng, push notification, deep link (tool chưa hỗ trợ trên iOS Simulator qua Appium).</p>
</main></body></html>`;
}

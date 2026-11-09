// "Áp dụng vào test case" cho một lần AI hỗ trợ khi chạy (lệch so với script):
//   - AI dùng phần tử khác cho đúng bước (use) / nhận màn bằng phần tử khác (arrived) → đổi Target của dòng đó
//   - AI làm thêm thao tác để tới được bước (tap / type / swipe / back / wait) → chèn các dòng Action trước dòng đó
// Dòng nằm trong luồng dùng chung (sheet Flows) → sửa trong Flows (mọi case gọi luồng đó đổi theo — preview nói rõ).
// Không bao giờ thêm / sửa / xoá dòng Check.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

const text = (v) => (v == null ? '' : v.richText ? v.richText.map((t) => t.text).join('') : v.text ? v.text : v.result != null ? String(v.result) : String(v)).trim();
const COLS = ['Step', 'Screen', 'Kind', 'Keyword', 'Target', 'Value'];
const ROW_OF = {
  tap: (a) => ({ keyword: 'Tap', target: a.name || a.locator, value: '' }),
  // Chạm theo toạ độ (nút không có tên trong cây phần tử): ghi thành Tap theo tên AI thấy trên màn — cần lấy locator cho nút đó
  tapPoint: (a) => ({ keyword: 'Tap', target: a.name || `point:${Number(a.x) / 100},${Number(a.y) / 100}`, value: '' }),
  type: (a) => ({ keyword: 'Enter', target: a.name || a.locator, value: a.text || '' }),
  swipe: (a) => ({ keyword: 'Swipe', target: '', value: a.text || 'up' }),
  back: () => ({ keyword: 'Back', target: '', value: '' }),
  wait: () => ({ keyword: 'Wait', target: '', value: '4' }),
};
const KEYWORD_OF = { tap: /^tap$/i, enter: /^enter$/i, back: /^back$/i, gone: /^wait until not displayed$/i };

function sheetInfo(ws) {
  const head = ws.getRow(1).values.slice(1).map(text);
  return Object.fromEntries(head.map((h, i) => [h, i + 1]).filter(([h]) => h));
}
const rowObj = (ws, C, n) => {
  const r = ws.getRow(n);
  const get = (k) => (C[k] ? text(r.getCell(C[k]).value) : '');
  return { n, step: Number(get('Step')) || 0, screen: get('Screen'), kind: get('Kind'), keyword: get('Keyword'), target: get('Target'), value: get('Value') };
};

// Các dòng của 1 case (TestCases) / 1 luồng (Flows)
function caseBlock(ws, C, tcId) {
  const out = [];
  let inside = false;
  for (let n = 2; n <= ws.rowCount; n++) {
    const o = rowObj(ws, C, n);
    if (o.kind === 'Case') { inside = text(ws.getRow(n).getCell(C['TC ID']).value) === tcId; continue; }
    if (inside && o.keyword) out.push(o);
  }
  return out;
}
function flowBlocks(ws, C) {
  const out = {};
  for (let n = 2; n <= ws.rowCount; n++) {
    const name = text(ws.getRow(n).getCell(C.Flow).value);
    const o = rowObj(ws, C, n);
    if (name && o.keyword) (out[name] ||= []).push(o);
  }
  return out;
}

// Dòng của bước bị kẹt trong 1 khối dòng. Phải khớp ít nhất Step hoặc Screen — không khớp gì thì null
// (không đoán dòng đầu tiên: sửa nhầm dòng của bước khác còn tệ hơn không sửa)
export function findStuckRow(rows, e) {
  const pick = (list) => list.find((r) => r.step === e.step && r.screen === e.screen) || list.find((r) => r.step === e.step) || list.find((r) => r.screen === e.screen) || null;
  if (e.kind === 'nav' && (!e.target || e.target === '(screen)')) return pick(rows.filter((r) => r.kind === 'Nav' && r.screen === e.screen));
  // Popup ngoài test case che bước kiểm → dòng Check đó
  if (e.kind === 'overlay') return pick(rows.filter((r) => r.kind === 'Check' && r.target === e.target));
  const kw = KEYWORD_OF[e.kind];
  return pick(rows.filter((r) => r.kind !== 'Check' && r.target === e.target && (!kw || kw.test(r.keyword))));
}

const sameRow = (a, b) => a && b && a.kind === b.kind && a.keyword === b.keyword && (a.target || '') === (b.target || '') && (a.value || '') === (b.value || '') && (a.screen || '') === (b.screen || '');

// AI nhận màn bằng phần tử khác ("arrived"): dòng Nav giữ nguyên Target (là dấu hiệu nhận màn, sửa ở Locator map);
// chỉ chèn các thao tác AI làm thêm trước đó. Không có gì để chèn → không áp dụng tự động được
export const ARRIVED_ONLY = 'Không áp dụng tự động được — AI chỉ nhận ra màn bằng phần tử khác: cập nhật Locator map của màn này (Lấy lại locator) thay vì sửa test case';
const preActions = (e) => (['use', 'arrived'].includes(e.how) ? (e.actions || []).slice(0, -1) : e.actions || []).filter((a) => ROW_OF[a.action]);
export const arrivedOnly = (e) => e.how === 'arrived' && !preActions(e).length;

// entry (1 dòng ai-assist.jsonl) → kế hoạch sửa trên các dòng (chưa ghi file)
export function planRows(rows, e) {
  const at = findStuckRow(rows, e);
  if (!at) return null;
  const final = e.actions.at(-1);
  // Popup có lúc hiện có lúc không → thêm "Close popup" (hiện thì đóng, không hiện thì bỏ qua) thay vì Tap bắt buộc
  const rowOf = (a) => (e.kind === 'overlay' && a.action === 'tap' ? { keyword: 'Close popup', target: a.name || a.locator, value: '' } : ROW_OF[a.action](a));
  // Không chèn dòng giống hệt dòng ngay trước nó (đã áp dụng trước đó / AI lặp lại thao tác của script)
  let prev = rows[rows.indexOf(at) - 1];
  let dup = 0;
  const inserts = [];
  for (const a of preActions(e)) {
    const x = { step: at.step, screen: at.screen, kind: 'Action', ...rowOf(a), reason: a.reason };
    if (sameRow(prev, x)) { dup++; continue; }
    inserts.push(x);
    prev = x;
  }
  // Chỉ "use" (AI dùng phần tử khác cho đúng bước) mới đổi Target; "arrived" không đụng dòng Nav
  const replace = e.how === 'use' && final?.name && final.name !== at.target ? { n: at.n, from: at.target, to: final.name, reason: final.reason } : null;
  if (!inserts.length && !replace) return dup ? { at, inserts: [], replace: null, before: rows, after: rows, changes: [], already: true } : null;
  const after = [];
  for (const r of rows) {
    if (r.n === at.n) after.push(...inserts.map((x) => ({ ...x, added: true })));
    after.push(replace && r.n === at.n ? { ...r, target: replace.to, changed: true } : r);
  }
  const changes = [
    ...inserts.map((x) => `Thêm dòng trước bước ${at.step} (${at.keyword} "${at.target}"): ${x.keyword}${x.target ? ` "${x.target}"` : ''}${x.value ? ` = ${x.value}` : ''}`),
    ...(replace ? [`Đổi Target của bước ${at.step} (${at.keyword}): "${replace.from}" → "${replace.to}"`] : []),
  ];
  return { at, inserts, replace, before: rows, after, changes };
}

// Luồng dùng chung mà case gọi (dòng của case trong store có field flow; dữ liệu cũ: dòng "Run flow" có Value = tên luồng)
export function flowsOf(c) {
  const out = new Set();
  for (const r of c?.rows || []) {
    if (r.flow) out.add(r.flow);
    if (/^run flow$/i.test(r.keyword || '') && r.value) out.add(r.value);
  }
  return out;
}

// Đọc file Excel của case, tìm chỗ sửa → { sheet, flow, plan, wb, ws, C }
//   Chỉ xét các luồng case thực sự gọi. Dòng của case khớp đúng Step → sửa ở case; không thì ưu tiên dòng trong luồng
//   khớp Step + Screen; cuối cùng mới tới dòng của case chỉ khớp Screen
async function locate(file, c, entry) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('TestCases');
  const C = sheetInfo(ws);
  const plan = planRows(caseBlock(ws, C, c.tcId), entry);
  const inCase = plan && { sheet: 'TestCases', flow: null, plan, wb, ws, C };
  if (inCase && plan.at.step === entry.step) return inCase;
  const fws = wb.getWorksheet('Flows');
  const called = flowsOf(c);
  let loose = null;
  if (fws && called.size) {
    const FC = sheetInfo(fws);
    for (const [name, rows] of Object.entries(flowBlocks(fws, FC))) {
      if (!called.has(name)) continue;
      const p = planRows(rows, entry);
      if (!p) continue;
      const hit = { sheet: 'Flows', flow: name, plan: p, wb, ws: fws, C: FC };
      if (p.at.step === entry.step && p.at.screen === entry.screen) return hit;
      loose ||= hit;
    }
  }
  return inCase || loose;
}

const strip = ({ n, ...r }) => r;

export async function previewAssist({ store, run, tcId, index }) {
  const { app, c, entry } = context({ store, run, tcId, index });
  const file = path.join(app.workspace, 'data/testcases', `${c.file}.xlsx`);
  if (arrivedOnly(entry)) return { ok: false, error: ARRIVED_ONLY };
  const found = await locate(file, c, entry);
  if (!found) return { ok: false, error: 'Không tìm được dòng tương ứng trong test case để sửa — sửa tay trong Excel' };
  if (found.plan.already) return { ok: false, error: 'Test case đã có các thao tác này (đã áp dụng trước đó) — không cần sửa' };
  const users = found.flow ? store.list('cases').filter((x) => x.appId === app.id && x.file === c.file && flowsOf(x).has(found.flow)).map((x) => x.tcId) : [tcId];
  return { ok: true, sheet: found.sheet, flow: found.flow, cases: users, changes: found.plan.changes, before: found.plan.before.map(strip), after: found.plan.after.map(strip) };
}

export async function applyAssist({ store, run, tcId, index, importer, generator }) {
  const { app, c, entry } = context({ store, run, tcId, index });
  const file = path.join(app.workspace, 'data/testcases', `${c.file}.xlsx`);
  if (arrivedOnly(entry)) throw Object.assign(new Error(ARRIVED_ONLY), { status: 409 });
  const found = await locate(file, c, entry);
  if (!found) throw Object.assign(new Error('Không tìm được dòng tương ứng trong test case để sửa'), { status: 409 });
  if (found.plan.already) throw Object.assign(new Error('Test case đã có các thao tác này (đã áp dụng trước đó)'), { status: 409 });
  const { ws, C, plan } = found;
  if (plan.replace) ws.getRow(plan.replace.n).getCell(C.Target).value = plan.replace.to;
  if (plan.inserts.length) {
    const tmpl = ws.getRow(plan.at.n);
    const vals = plan.inserts.map((x) => {
      const v = [];
      if (found.flow) v[C.Flow] = found.flow;
      const map = { Step: x.step, Screen: x.screen, Kind: 'Action', Keyword: x.keyword, Target: x.target, Value: x.value };
      for (const k of COLS) if (C[k]) v[C[k]] = map[k] ?? '';
      if (C.Platform) v[C.Platform] = text(tmpl.getCell(C.Platform).value) || 'All';
      return v;
    });
    ws.spliceRows(plan.at.n, 0, ...vals);
  }
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qapd-assist-')), `${c.file}.xlsx`);
  await found.wb.xlsx.writeFile(tmp);
  // Chỉ gen lại case có dòng đổi vì lần áp dụng này (so rowsHash trước / sau import) — case stale từ trước giữ nguyên
  const sameFile = (x) => x.appId === app.id && x.file === c.file;
  const hashBefore = new Map(store.list('cases').filter(sameFile).map((x) => [x.id, x.rowsHash]));
  const out = await importer({ store, appId: app.id, srcPath: tmp, fileName: `${c.file}.xlsx`, into: c.file });
  const stale = store.list('cases').filter((x) => sameFile(x) && x.script?.status === 'stale' && hashBefore.has(x.id) && hashBefore.get(x.id) !== x.rowsHash).map((x) => x.id);
  if (generator && stale.length) generator.generate(app.id, stale).catch((e) => console.error('generate (assist):', e));
  return { ok: true, changes: plan.changes, regenerating: stale.length, imported: out };
}

function context({ store, run, tcId, index }) {
  const app = store.get('apps', run.appId);
  if (!app) throw Object.assign(new Error('Không có app này'), { status: 404 });
  const entry = (run.results?.[tcId]?.assist || []).find((x) => x.i === Number(index));
  if (!entry) throw Object.assign(new Error('Không có lần AI hỗ trợ này'), { status: 404 });
  const c = store.list('cases').find((x) => x.appId === app.id && x.tcId === tcId && run.files?.includes(x.file)) || store.list('cases').find((x) => x.appId === app.id && x.tcId === tcId);
  if (!c) throw Object.assign(new Error(`Không còn case ${tcId}`), { status: 404 });
  return { app, c, entry };
}

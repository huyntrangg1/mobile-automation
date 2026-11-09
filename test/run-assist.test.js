import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { vetAction, goalText, rowsText, createAssist } from '../server/ai/assist.js';
import { planRows, findStuckRow, previewAssist, applyAssist, arrivedOnly } from '../server/runs/applyAssist.js';

const els = [
  { type: 'Button', name: 'Continue', locator: '~Continue' },
  { type: 'Button', name: 'Skip', locator: '~Skip' },
  { type: 'Button', name: 'Start free trial', locator: '~Start free trial' },
  { type: 'StaticText', name: 'Good news 🎉', locator: '~Good news 🎉' },
];

test('vetAction: locator phải có trên màn; chặn nút mua; giveUp đi thẳng', () => {
  assert.equal(vetAction({ action: 'tap', locator: '~Nope', reason: '' }, els).ok, false);
  assert.match(vetAction({ action: 'tap', locator: '~Start free trial', reason: '' }, els).why, /nút mua/);
  const ok = vetAction({ action: 'tap', locator: '~Skip', reason: 'màn trung gian' }, els);
  assert.deepEqual(ok, { ok: true, step: { action: 'tap', locator: '~Skip', name: 'Skip', text: '', reason: 'màn trung gian' } });
  assert.equal(vetAction({ action: 'giveUp', reason: 'lỗi app' }, els).step.action, 'giveUp');
  assert.equal(vetAction({ action: 'swipe', text: 'sideways', reason: '' }, els).ok, false);
  // "Continue" ngoài paywall là nút đi tiếp bình thường
  assert.equal(vetAction({ action: 'tap', locator: '~Continue', reason: '' }, els).ok, true);
});

test('vetAction: "Continue" trên màn paywall bị chặn', () => {
  const pay = [...els, { type: 'StaticText', name: '$9.99 per year', locator: '~p' }, { type: 'StaticText', name: 'Subscription', locator: '~s' }];
  assert.equal(vetAction({ action: 'tap', locator: '~Continue', reason: '' }, pay).ok, false);
});

test('goalText / rowsText: mô tả bước kẹt và đánh dấu ► đúng dòng', () => {
  assert.match(goalText({ kind: 'tap', screen: 'Goals', target: 'Continue' }), /bấm "Continue" trên màn "Goals"/);
  assert.match(goalText({ kind: 'nav', screen: 'Good news', target: '(screen)' }), /tới màn "Good news"/);
  const t = rowsText([{ step: 1, screen: 'Goals', kind: 'Action', keyword: 'Tap', target: 'Eat healthier' }, { step: 1, screen: 'Goals', kind: 'Action', keyword: 'Tap', target: 'Continue' }], { step: 1, screen: 'Goals', target: 'Continue' });
  assert.match(t.split('\n')[1], /^► 1\. \[Goals\] Action Tap "Continue"/);
  assert.match(t.split('\n')[0], /^ {2}1\./);
});

test('createAssist: AI trả locator lạ → refused; AI lỗi → giveUp', async () => {
  const store = { get: () => ({ name: 'A', platform: 'iOS' }), list: () => [] };
  const bad = createAssist({ store, runClaude: async () => ({ ok: true, data: { action: 'tap', locator: '~X', reason: 'r' } }) });
  assert.equal((await bad('a', { elements: els, kind: 'tap', screen: 'S', target: 'T' })).action, 'refused');
  const err = createAssist({ store, runClaude: async () => ({ ok: false, error: 'timeout' }) });
  assert.equal((await err('a', { elements: els })).action, 'giveUp');
});

const rows = [
  { n: 2, step: 1, screen: 'Goals', kind: 'Action', keyword: 'Tap', target: 'Eat healthier', value: '' },
  { n: 3, step: 1, screen: 'Goals', kind: 'Action', keyword: 'Tap', target: 'Continue', value: '' },
  { n: 4, step: 1, screen: 'Encouragement', kind: 'Nav', keyword: 'Verify screen', target: "You're in the right place", value: '' },
  { n: 5, step: 1, screen: 'Encouragement', kind: 'Check', keyword: 'Verify text', target: "You're in the right place", value: "You're in the right place" },
];

test('planRows: thêm thao tác AI làm thêm trước dòng kẹt (không đụng Check)', () => {
  const e = { kind: 'nav', step: 1, screen: 'Encouragement', target: '(screen)', how: 'retry', actions: [{ action: 'tap', name: 'Skip', locator: '~Skip', reason: 'popup' }] };
  assert.equal(findStuckRow(rows, e).n, 4);
  const p = planRows(rows, e);
  assert.equal(p.after.length, 5);
  assert.deepEqual(p.after[2], { step: 1, screen: 'Encouragement', kind: 'Action', keyword: 'Tap', target: 'Skip', value: '', reason: 'popup', added: true });
  assert.equal(p.after.filter((r) => r.kind === 'Check').length, 1);
  assert.match(p.changes[0], /Thêm dòng trước bước 1/);
});

test('planRows: AI dùng phần tử khác cho đúng bước → đổi Target', () => {
  const e = { kind: 'tap', step: 1, screen: 'Goals', target: 'Continue', how: 'use', actions: [{ action: 'use', name: 'Next', locator: '~Next', reason: 'nút đổi tên' }] };
  const p = planRows(rows, e);
  assert.equal(p.replace.to, 'Next');
  assert.equal(p.after[1].target, 'Next');
  assert.match(p.changes[0], /"Continue" → "Next"/);
  assert.equal(planRows(rows, { ...e, target: 'Không có' }), null);
});

async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assist-'));
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(path.join(ws, 'data/testcases'), { recursive: true });
  const wb = new ExcelJS.Workbook();
  const t = wb.addWorksheet('TestCases');
  t.addRow(['TC ID', 'Title', 'Priority', 'Pre-condition', 'Data Set', 'Step', 'Screen', 'Kind', 'Keyword', 'Target', 'Value', 'Compare', 'Platform', 'Check label']);
  t.addRow(['TC_1', 'Case 1', 'High', 'Cài lại app', '', '', '', 'Case', '', '', '', '', 'All', '']);
  t.addRow(['', '', '', '', '', 1, 'Goals', 'Action', 'Run flow', '', 'Start', '', 'All', '']);
  t.addRow(['', '', '', '', '', 1, 'Goals', 'Action', 'Tap', 'Continue', '', '', 'All', '']);
  t.addRow(['', '', '', '', '', 1, 'Goals', 'Check', 'Verify text', 'Title', 'Title', 'equals', 'All', 'Tiêu đề']);
  const f = wb.addWorksheet('Flows');
  f.addRow(['Flow', 'Step', 'Screen', 'Kind', 'Keyword', 'Target', 'Value', 'Compare', 'Platform', 'Check label']);
  f.addRow(['Start', 1, 'Welcome', 'Action', 'Tap', 'Get Started', '', '', 'All', '']);
  await wb.xlsx.writeFile(path.join(ws, 'data/testcases/f.xlsx'));
  const data = { apps: { a: { id: 'a', workspace: ws } }, cases: { c1: { id: 'c1', appId: 'a', file: 'f', tcId: 'TC_1', rows: [{ flow: 'Start' }] } } };
  const store = { get: (k, id) => data[k][id], list: (k) => Object.values(data[k]) };
  return { ws, store };
}

test('preview + apply: sửa đúng dòng trong Excel (case), import lại, gen lại case', async () => {
  const { ws, store } = await fixture();
  const entry = { i: 0, tc: 'TC_1', kind: 'tap', step: 1, screen: 'Goals', target: 'Continue', how: 'retry', actions: [{ action: 'swipe', text: 'up', reason: 'nút nằm dưới' }] };
  const run = { appId: 'a', files: ['f'], results: { TC_1: { assist: [entry] } } };
  const p = await previewAssist({ store, run, tcId: 'TC_1', index: 0 });
  assert.equal(p.ok, true);
  assert.equal(p.sheet, 'TestCases');
  let imported = null;
  const gen = [];
  const out = await applyAssist({ store, run, tcId: 'TC_1', index: 0, importer: async (o) => { imported = o; return { changed: 1 }; }, generator: { generate: async (app, ids) => gen.push(ids) } });
  assert.equal(out.ok, true);
  assert.equal(imported.into, 'f');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(imported.srcPath);
  const vals = [];
  wb.getWorksheet('TestCases').eachRow((r) => vals.push([r.getCell(9).value, r.getCell(10).value, r.getCell(11).value]));
  assert.deepEqual(vals.slice(3, 5), [['Swipe', '', 'up'], ['Tap', 'Continue', '']]);
  assert.ok(fs.existsSync(path.join(ws, 'data/testcases/f.xlsx')));
});

test('preview: dòng kẹt nằm trong luồng dùng chung → sửa ở sheet Flows, báo các case dùng luồng', async () => {
  const { store } = await fixture();
  const entry = { i: 3, tc: 'TC_1', kind: 'tap', step: 1, screen: 'Welcome', target: 'Get Started', how: 'use', actions: [{ action: 'use', name: 'Start now', locator: '~Start now', reason: 'nút đổi chữ' }] };
  const run = { appId: 'a', files: ['f'], results: { TC_1: { assist: [entry] } } };
  const p = await previewAssist({ store, run, tcId: 'TC_1', index: 3 });
  assert.equal(p.sheet, 'Flows');
  assert.equal(p.flow, 'Start');
  assert.deepEqual(p.cases, ['TC_1']);
  assert.match(p.changes[0], /"Get Started" → "Start now"/);
});

test('planRows: popup ngoài test case → thêm "Close popup" trước đúng dòng Check (popup không hiện thì bước tự bỏ qua)', () => {
  const e = { kind: 'overlay', step: 1, screen: 'Encouragement', target: "You're in the right place", how: 'retry', actions: [{ action: 'tap', name: 'Close', locator: '~Close', reason: 'popup đăng nhập' }] };
  const p = planRows(rows, e);
  assert.equal(p.at.n, 5);
  assert.deepEqual([p.after[3].keyword, p.after[3].target, p.after[3].added], ['Close popup', 'Close', true]);
  assert.equal(p.after[4].kind, 'Check');
});

// ---- Sửa lỗi: chỉ luồng case gọi, không đoán dòng, "arrived", áp dụng 2 lần, chỉ gen lại case đổi dòng
test('findStuckRow: không khớp Step lẫn Screen → null (không lấy dòng đầu)', () => {
  const e = { kind: 'tap', step: 9, screen: 'Other', target: 'Continue', how: 'retry', actions: [{ action: 'swipe', text: 'up' }] };
  assert.equal(findStuckRow(rows, e), null);
  assert.equal(planRows(rows, e), null);
  assert.equal(findStuckRow(rows, { ...e, step: 1 }).n, 3);
});

test('planRows "arrived": không đổi Target của dòng Nav, chỉ chèn thao tác làm thêm; không có gì chèn → arrivedOnly', () => {
  const e = { kind: 'nav', step: 1, screen: 'Encouragement', target: '(screen)', how: 'arrived', actions: [{ action: 'tap', name: 'Skip', locator: '~Skip' }, { action: 'arrived', name: 'Other title', locator: '~o' }] };
  const p = planRows(rows, e);
  assert.equal(p.replace, null);
  assert.equal(p.after.find((r) => r.n === 4).target, "You're in the right place");
  assert.equal(p.inserts.length, 1);
  const only = { ...e, actions: [{ action: 'arrived', name: 'Other title', locator: '~o' }] };
  assert.equal(arrivedOnly(only), true);
  assert.equal(planRows(rows, only), null);
});

test('planRows: thao tác giống hệt dòng ngay trước → không chèn lại (đã áp dụng trước đó)', () => {
  const withSkip = [rows[0], rows[1], { n: 9, step: 1, screen: 'Encouragement', kind: 'Action', keyword: 'Tap', target: 'Skip', value: '' }, rows[2], rows[3]];
  const e = { kind: 'nav', step: 1, screen: 'Encouragement', target: '(screen)', how: 'retry', actions: [{ action: 'tap', name: 'Skip', locator: '~Skip' }] };
  const p = planRows(withSkip, e);
  assert.equal(p.already, true);
  assert.equal(p.inserts.length, 0);
});

test('preview: luồng case không gọi thì không sửa; case gọi luồng (Run flow) mới tìm trong luồng', async () => {
  const { store } = await fixture();
  store.list('cases')[0].rows = [{ keyword: 'Tap', target: 'Continue' }]; // case không gọi luồng Start
  const entry = { i: 3, tc: 'TC_1', kind: 'tap', step: 1, screen: 'Welcome', target: 'Get Started', how: 'use', actions: [{ action: 'use', name: 'Start now', locator: '~Start now' }] };
  const run = { appId: 'a', files: ['f'], results: { TC_1: { assist: [entry] } } };
  assert.equal((await previewAssist({ store, run, tcId: 'TC_1', index: 3 })).ok, false);
  store.list('cases')[0].rows = [{ keyword: 'Run flow', value: 'Start' }]; // dữ liệu cũ: dòng Run flow
  const p = await previewAssist({ store, run, tcId: 'TC_1', index: 3 });
  assert.equal(p.flow, 'Start');
});

test('apply "arrived" không có thao tác chèn → 409 kèm hướng dẫn cập nhật Locator map', async () => {
  const { store } = await fixture();
  const entry = { i: 0, tc: 'TC_1', kind: 'nav', step: 1, screen: 'Goals', target: '(screen)', how: 'arrived', actions: [{ action: 'arrived', name: 'X', locator: '~X' }] };
  const run = { appId: 'a', files: ['f'], results: { TC_1: { assist: [entry] } } };
  assert.match((await previewAssist({ store, run, tcId: 'TC_1', index: 0 })).error, /Locator map/);
  await assert.rejects(applyAssist({ store, run, tcId: 'TC_1', index: 0, importer: async () => ({}) }), (e) => e.status === 409 && /Locator map/.test(e.message));
});

test('apply: chỉ gen lại case có dòng đổi vì lần áp dụng này (case stale từ trước không bị gen theo)', async () => {
  const { store } = await fixture();
  const data = store.list('cases');
  data[0].rowsHash = 'h1';
  data[0].script = { status: 'generated' };
  const other = { id: 'c2', appId: 'a', file: 'f', tcId: 'TC_2', rows: [], rowsHash: 'h2', script: { status: 'stale' } };
  const cases = { c1: data[0], c2: other };
  const st = { get: (k, id) => (k === 'cases' ? cases[id] : store.get(k, id)), list: (k) => (k === 'cases' ? Object.values(cases) : store.list(k)) };
  const entry = { i: 0, tc: 'TC_1', kind: 'tap', step: 1, screen: 'Goals', target: 'Continue', how: 'retry', actions: [{ action: 'swipe', text: 'up' }] };
  const run = { appId: 'a', files: ['f'], results: { TC_1: { assist: [entry] } } };
  const gen = [];
  const importer = async () => { cases.c1 = { ...cases.c1, rowsHash: 'h1b', script: { status: 'stale' } }; return { changed: 1 }; };
  const out = await applyAssist({ store: st, run, tcId: 'TC_1', index: 0, importer, generator: { generate: async (app, ids) => gen.push(ids) } });
  assert.equal(out.regenerating, 1);
  assert.deepEqual(gen, [['c1']]);
});

// ---- Route áp dụng: 409 khi đang chạy / đã quyết định; quyết định ghi trên bản run mới nhất + emit
async function routeSetup({ running = false } = {}) {
  const { default: express } = await import('express');
  const { default: runRoutes } = await import('../server/routes/runs.js');
  const { createStore } = await import('../server/store.js');
  const { ws } = await fixture();
  const store = createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'assist-store-')));
  store.put('apps', { id: 'a', workspace: ws });
  store.put('cases', { id: 'c1', appId: 'a', file: 'f', tcId: 'TC_1', rows: [{ flow: 'Start' }] });
  const entry = { i: 0, tc: 'TC_1', kind: 'tap', step: 1, screen: 'Goals', target: 'Continue', how: 'retry', actions: [{ action: 'swipe', text: 'up' }] };
  store.put('runs', { id: 'RUN-0001', appId: 'a', files: ['f'], status: running ? 'running' : 'done', results: { TC_1: { status: 'passed', assist: [entry] }, TC_2: { status: 'failed' } }, log: [] });
  const events = [];
  let imports = 0;
  const app = express();
  app.use(express.json());
  app.use('/api', runRoutes({ store, runner: { isRunning: () => running }, emit: (t, x) => events.push([t, x]), importer: async () => { imports++; store.patch('runs', 'RUN-0001', { log: ['runner ghi trong lúc áp dụng'] }); return {}; } }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = async (url) => { const r = await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); return { status: r.status, body: await r.json() }; };
  return { store, events, post, imports: () => imports, close: () => server.close() };
}

test('POST apply: lần 2 → 409 (không chèn dòng trùng); quyết định giữ thay đổi runner ghi trong lúc áp dụng + emit run', async () => {
  const s = await routeSetup();
  const a = await s.post('/runs/RUN-0001/assist/TC_1/0/apply');
  assert.equal(a.status, 200);
  const b = await s.post('/runs/RUN-0001/assist/TC_1/0/apply');
  s.close();
  assert.equal(b.status, 409);
  assert.equal(s.imports(), 1);
  const run = s.store.get('runs', 'RUN-0001');
  assert.equal(run.assistDecisions[0], 'applied');
  assert.equal(run.results.TC_1.assist[0].decision, 'applied');
  assert.equal(run.results.TC_2.status, 'failed');
  assert.deepEqual(run.log, ['runner ghi trong lúc áp dụng']);
  assert.equal(s.events.at(-1)[0], 'run');
});

test('POST apply khi run đang chạy → 409', async () => {
  const s = await routeSetup({ running: true });
  const a = await s.post('/runs/RUN-0001/assist/TC_1/0/apply');
  s.close();
  assert.equal(a.status, 409);
  assert.equal(s.imports(), 0);
});

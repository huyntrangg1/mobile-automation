// Server — chế độ sửa tay khi lỗi: cờ chạy, phát hiện help.json, trả lời, bảng sửa locator
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createLock } from '../server/lock.js';
import { createRunner } from '../server/runs/runner.js';
import { listOverrides, removeOverride, saveOverride, readOverrides } from '../server/runs/overrides.js';
import { suggest } from '../server/runs/help.js';
import { tmpDir } from './helpers.js';

const XML = fs.readFileSync(new URL('./fixtures/tastory-welcome.xml', import.meta.url), 'utf8');

// wdio giả chạy mãi (tới khi kill) để run còn "đang chạy"
function setup() {
  const dataDir = tmpDir();
  const ws = tmpDir();
  fs.mkdirSync(path.join(ws, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'tests/f.e2e.js'), '// script');
  const store = createStore(dataDir);
  store.put('apps', { id: 'app', name: 'A', workspace: ws, status: 'ready', appPath: '/x.app', bundleId: 'b', env: {} });
  store.put('cases', { id: 'app:f:TC_1', appId: 'app', file: 'f', tcId: 'TC_1', title: 'T', order: 0, fresh: true, prev: null, rows: [], script: { status: 'generated' } });
  const calls = [];
  const spawnImpl = (cmd, args, opts) => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    p.kill = (sig) => { p.killedWith = sig; p.answerAtKill = fs.existsSync(path.join(opts.env.HELP_DIR, 'answer.json')) ? JSON.parse(fs.readFileSync(path.join(opts.env.HELP_DIR, 'answer.json'), 'utf8')) : null; setTimeout(() => p.emit('close', null, sig), 5); };
    calls.push({ opts, p });
    return p;
  };
  const runner = createRunner({ store, lock: createLock(), emit: () => {}, dataDir, spawnImpl, scriptPath: (app, f) => path.join(app.workspace, 'tests', `${f}.e2e.js`), pollMs: 5, screenshotImpl: async () => { throw new Error('no device'); } });
  return { store, runner, calls, ws };
}
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); }
};
// Worker giả hỏi tester
const askHelp = (dir, help) => {
  fs.writeFileSync(path.join(dir, 'help.xml'), XML);
  fs.writeFileSync(path.join(dir, 'help.png'), 'png');
  fs.writeFileSync(path.join(dir, 'help.json'), JSON.stringify({ tc: 'TC_1', step: 2, screen: 'Welcome', target: 'Get started', kind: 'tap', error: 'không thấy', choices: ['block', 'skip', 'retry', 'use', 'fix'], shot: path.join(dir, 'help.png'), source: path.join(dir, 'help.xml'), ...help }));
};

test('manualFix: env MANUAL_FIX=1 + HELP_DIR; tắt → MANUAL_FIX rỗng', async () => {
  const { runner, calls, store } = setup();
  const run = await runner.startRun({ appId: 'app', udid: 'U', caseIds: ['app:f:TC_1'], manualFix: true });
  assert.equal(calls[0].opts.env.MANUAL_FIX, '1');
  assert.ok(fs.existsSync(calls[0].opts.env.HELP_DIR));
  assert.equal(store.get('runs', run.id).manualFix, true);
  await runner.stop(run.id);
  await until(() => store.get('runs', run.id).status !== 'running');
  const off = setup();
  const r2 = await off.runner.startRun({ appId: 'app', udid: 'U', caseIds: ['app:f:TC_1'] });
  assert.equal(off.calls[0].opts.env.MANUAL_FIX, '');
  await off.runner.stop(r2.id);
});

test('help.json → run.help có phần tử, gợi ý, ảnh; trả lời fix → answer.json', async () => {
  const { runner, calls, store, ws } = setup();
  const run = await runner.startRun({ appId: 'app', udid: 'U', caseIds: ['app:f:TC_1'], manualFix: true });
  const dir = calls[0].opts.env.HELP_DIR;
  askHelp(dir, { id: 'h1' });
  await until(() => store.get('runs', run.id).help);
  const h = store.get('runs', run.id).help;
  assert.equal(h.id, 'h1');
  assert.ok(h.elements.length > 0);
  assert.equal(h.suggestions[0].name, 'Get Started');
  assert.deepEqual(h.win, { width: 402, height: 874 });
  assert.match(h.shotUrl, new RegExp(`/files/data/runs/${run.id}/help.png`));
  await runner.answer(run.id, { helpId: 'h1', action: 'fix', locator: '~Get Started' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'answer.json'), 'utf8')), { id: 'h1', action: 'fix', locator: '~Get Started' });
  void ws;
  await until(() => !store.get('runs', run.id).help);
  await runner.stop(run.id);
});

test('answer: helpId lệch → 409; action ngoài choices → 400; use thiếu locator → 400', async () => {
  const { runner, calls, store } = setup();
  const run = await runner.startRun({ appId: 'app', udid: 'U', caseIds: ['app:f:TC_1'], manualFix: true });
  const dir = calls[0].opts.env.HELP_DIR;
  askHelp(dir, { id: 'h2', kind: 'alert', choices: ['block', 'skip', 'retry'] });
  await until(() => store.get('runs', run.id).help);
  await assert.rejects(runner.answer(run.id, { helpId: 'old', action: 'skip' }), (e) => e.status === 409);
  await assert.rejects(runner.answer(run.id, { helpId: 'h2', action: 'use', locator: '~x' }), (e) => e.status === 400);
  fs.writeFileSync(path.join(dir, 'help.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(dir, 'help.json'), 'utf8')), choices: ['block', 'skip', 'retry', 'use', 'fix'] }));
  await assert.rejects(runner.answer(run.id, { helpId: 'h2', action: 'use' }), (e) => e.status === 400);
  assert.ok(!fs.existsSync(path.join(dir, 'answer.json')));
  await runner.stop(run.id);
});

test('stop khi đang hỏi → ghi answer block trước khi kill', async () => {
  const { runner, calls, store } = setup();
  const run = await runner.startRun({ appId: 'app', udid: 'U', caseIds: ['app:f:TC_1'], manualFix: true });
  askHelp(calls[0].opts.env.HELP_DIR, { id: 'h3' });
  await until(() => store.get('runs', run.id).help);
  await runner.stop(run.id);
  assert.deepEqual(calls[0].p.answerAtKill, { id: 'h3', action: 'block' });
});

test('overrides: lưu / liệt kê / xoá', () => {
  const ws = tmpDir();
  saveOverride(ws, 'Home|Go', { locator: '~Go', element: 'Go' });
  const l = listOverrides(ws);
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].key, l[0].screen, l[0].target, l[0].locator, l[0].element], ['Home|Go', 'Home', 'Go', '~Go', 'Go']);
  assert.ok(l[0].at);
  removeOverride(ws, 'Home|Go');
  assert.deepEqual(listOverrides(ws), []);
});

test('suggest: phần tử chữ gần giống target nhất, tối đa 3, bỏ chữ quá khác', () => {
  const els = [{ name: 'Get Started' }, { name: 'Log in' }, { name: 'Get started now' }, { name: 'Welcome to' }, { label: 'Started' }];
  const s = suggest('Get started', els).map((e) => e.name || e.label);
  assert.deepEqual(s.slice(0, 2), ['Get Started', 'Get started now']);
  assert.ok(s.length <= 3 && !s.includes('Log in'));
});

test('review #1: đã trả lời → câu hỏi biến mất ngay (tick không đưa lại), trả lời lần 2 bị từ chối', async () => {
  const { runner, calls, store } = setup();
  const run = await runner.startRun({ appId: 'app', udid: 'U', caseIds: ['app:f:TC_1'], manualFix: true });
  const dir = calls[0].opts.env.HELP_DIR;
  askHelp(dir, { id: 'h9' });
  await until(() => store.get('runs', run.id).help);
  await runner.answer(run.id, { helpId: 'h9', action: 'skip' });
  await new Promise((r) => setTimeout(r, 30)); // vài tick, worker chưa kịp đọc answer
  assert.equal(store.get('runs', run.id).help, null);
  await assert.rejects(runner.answer(run.id, { helpId: 'h9', action: 'block' }), (e) => e.status === 409);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'answer.json'), 'utf8')).action, 'skip');
  await runner.stop(run.id);
});

test('review #2: server không tự lưu override khi trả lời fix (worker lưu sau khi locator chạy được)', async () => {
  const { runner, calls, store, ws } = setup();
  const run = await runner.startRun({ appId: 'app', udid: 'U', caseIds: ['app:f:TC_1'], manualFix: true });
  askHelp(calls[0].opts.env.HELP_DIR, { id: 'h10' });
  await until(() => store.get('runs', run.id).help);
  await runner.answer(run.id, { helpId: 'h10', action: 'fix', locator: '~Get Started', element: 'Get Started' });
  assert.deepEqual(readOverrides(ws), {});
  assert.equal(JSON.parse(fs.readFileSync(path.join(calls[0].opts.env.HELP_DIR, 'answer.json'), 'utf8')).element, 'Get Started');
  await runner.stop(run.id);
});

test('điểm trên ảnh chỉ dùng cho bước Tap: nav + point → 400; tap + point → ok', async () => {
  const { runner, calls, store } = setup();
  const run = await runner.startRun({ appId: 'app', udid: 'U', caseIds: ['app:f:TC_1'], manualFix: true });
  const dir = calls[0].opts.env.HELP_DIR;
  askHelp(dir, { id: 'p1', kind: 'nav', target: '(screen)' });
  await until(() => store.get('runs', run.id).help?.id === 'p1');
  await assert.rejects(runner.answer(run.id, { helpId: 'p1', action: 'use', locator: 'point:0.1,0.05' }), (e) => e.status === 400);
  fs.rmSync(path.join(dir, 'help.json'));
  askHelp(dir, { id: 'p2' });
  await until(() => store.get('runs', run.id).help?.id === 'p2');
  await runner.answer(run.id, { helpId: 'p2', action: 'use', locator: 'point:0.1,0.05' });
  await runner.stop(run.id);
});

test('overrides: sửa locator giữ nguyên phần tử đã chọn', async () => {
  const { updateOverride } = await import('../server/runs/overrides.js');
  const ws = tmpDir();
  saveOverride(ws, 'Paywall|Close', { locator: 'point:0.1,0.1', element: 'điểm' });
  updateOverride(ws, 'Paywall|Close', '~xmark.circle.fill');
  const o = listOverrides(ws)[0];
  assert.deepEqual([o.locator, o.element], ['~xmark.circle.fill', 'điểm']);
  assert.throws(() => updateOverride(ws, 'Nope|x', '~a'), (e) => e.status === 404);
});

test('hộp thoại có phần tử thêm / sửa tay trong Locator map của màn giống màn đang hiện nhất (vd point: cho nút không nhãn)', async () => {
  const { parseElements } = await import('../server/locators/pageSource.js');
  const { runner, calls, store } = setup();
  const els = parseElements(XML);
  store.put('screens', { id: 's1', appId: 'app', name: 'Welcome to Tastory', elements: [...els, { type: 'Button', name: 'Old A', label: '', rect: null, locator: '~OldA' }, { type: 'Button', name: 'Old B', label: '', rect: null, locator: '~OldB' }, { type: 'Button', name: 'Close', label: '', rect: null, locator: 'point:0.075,0.067', key: 'Close', manual: true }] });
  store.put('screens', { id: 's3', appId: 'app', name: 'Welcome to Tastory 2', elements: [...els, { type: 'Image', name: 'Logo', label: '', rect: null, locator: '~Logo', key: 'Logo', manual: true }] });
  store.put('screens', { id: 's2', appId: 'app', name: 'Khác', elements: [{ type: 'Button', name: 'Zzz', label: '', rect: null, locator: '~Zzz', key: 'Zzz', manual: true }] });
  const run = await runner.startRun({ appId: 'app', udid: 'U', caseIds: ['app:f:TC_1'], manualFix: true });
  askHelp(calls[0].opts.env.HELP_DIR, { id: 'm1' });
  await until(() => store.get('runs', run.id).help?.id === 'm1');
  const h = store.get('runs', run.id).help;
  // Mọi màn đủ giống (Locator map có thể có 2 bản của cùng màn) — bỏ trùng theo locator, ghi màn của phần tử
  assert.deepEqual(h.mapElements.map((e) => [e.key, e.locator]).sort(), [['Close', 'point:0.075,0.067'], ['Logo', '~Logo']]);
  assert.ok(h.mapElements.every((e) => e.screen.startsWith('Welcome to Tastory')));
  await runner.stop(run.id);
});

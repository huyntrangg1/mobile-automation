// Test tái hiện các lỗi từ review cuối (mỗi test fail trước khi sửa)
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createLock } from '../server/lock.js';
import { createScreenMap } from '../server/locators/screenMap.js';
import { createGenerator } from '../server/scripts/generate.js';
import { buildScript } from '../server/scripts/scriptFile.js';
import { runClaude } from '../server/ai/claude.js';
import { sameScreen } from '../server/locators/pageSource.js';
import { createRunner } from '../server/runs/runner.js';
import { prepareApp } from '../server/routes/apps.js';
import { ROOT } from '../server/paths.js';
import { tmpDir } from './helpers.js';

const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}.xml`, import.meta.url), 'utf8');
const GOOD = "async ({ tc, data, sa, fill }) => {\n  await ui.tap(L['Welcome']['OR']);\n}";
const row = (screen, kind, keyword, target) => ({ step: 1, screen, kind, keyword, target, value: '', compare: '', platform: 'All', label: '' });

function genSetup(answer) {
  const dataDir = tmpDir();
  const ws = tmpDir();
  fs.cpSync(path.join(ROOT, 'server/apps/template/src/utils'), path.join(ws, 'src/utils'), { recursive: true });
  const store = createStore(dataDir);
  store.put('apps', { id: 'a', name: 'A', workspace: ws, helperPack: null });
  const map = createScreenMap({ store, dataDir });
  map.addSnapshot('a', { xml: fx('welcome'), png: null });
  store.put('cases', { id: 'a:f:TC_A', appId: 'a', file: 'f', tcId: 'TC_A', order: 0, title: 'A', fresh: true, prev: null, pre: [], rowsHash: 'h1', rows: [row('Welcome', 'Action', 'Tap', 'OR')], script: { status: 'none', warnings: [] } });
  const gen = createGenerator({ store, map, emit: () => {}, runClaude: typeof answer === 'function' ? answer : async () => answer });
  return { store, gen, ws };
}

// C1
test('C1: generate() với case đã bị xoá không reject (không làm sập server)', async () => {
  const { gen } = genSetup({ ok: true, data: { body: GOOD, warnings: [] } });
  await gen.generate('a', ['a:f:KHONG_CO', 'a:f:TC_A']);
});

// I1
test('I1: scriptPath từ chối tên file có ../ hoặc ký tự lạ', () => {
  const { gen } = genSetup({ ok: true, data: { body: GOOD, warnings: [] } });
  assert.throws(() => gen.scriptPath({ workspace: '/w' }, '../../tmp/evil'), /Tên file không hợp lệ/);
  assert.throws(() => gen.scriptPath({ workspace: '/w' }, "a'b"), /Tên file không hợp lệ/);
  assert.equal(gen.scriptPath({ workspace: '/w' }, 'auth-1_x'), '/w/tests/auth-1_x.e2e.js');
});

// I2
test('I2: lưu file từ bản cũ (hash khác file hiện tại) → conflict, file không đổi', async () => {
  const { gen, store } = genSetup({ ok: true, data: { body: GOOD, warnings: [] } });
  await gen.generateCase('a:f:TC_A');
  const app = store.get('apps', 'a');
  const p = gen.scriptPath(app, 'f');
  const now = fs.readFileSync(p, 'utf8');
  const r = await gen.saveFile(app, 'f', now.replace("['OR']", "['Welcome']"), 'hash-cu');
  assert.equal(r.conflict, true);
  assert.equal(fs.readFileSync(p, 'utf8'), now);
  const ok = await gen.saveFile(app, 'f', now.replace("['OR']", "['Welcome']"), gen.hashOf(now));
  assert.ok(!ok.conflict && !ok.error);
  assert.match(fs.readFileSync(p, 'utf8'), /\['Welcome'\]\['Welcome'\]/);
});

// I3
for (const [name, body] of [['rỗng', ''], ['không phải hàm', "await ui.tap(L['Welcome']['OR']);"]]) {
  test(`I3: body ${name} → Gen lỗi`, async () => {
    const { gen } = genSetup({ ok: true, data: { body, warnings: [] } });
    const s = await gen.generateCase('a:f:TC_A');
    assert.equal(s.status, 'failed');
    assert.match(s.error, /không phải hàm/);
  });
}

// I4
test('I4: case trong RUN_CASES nhưng không có region → it() Blocked "Chưa có script", chặn chuỗi', () => {
  const code = buildScript({ file: 'f', order: ['TC_A', 'TC_B'], regions: { TC_B: GOOD }, helpers: [], pack: null });
  assert.match(code, /Chưa có script cho \$\{tc\.id\}/);
  assert.ok(!code.includes('if (!CASES[tc.id] || (RUN.length && !RUN.includes(tc.id))) continue;'));
});

// I5
test('I5: import đổi bước trong lúc đang gen → gen xong thành stale', async () => {
  let release;
  const { gen, store } = genSetup(() => new Promise((r) => { release = () => r({ ok: true, data: { body: GOOD, warnings: [] } }); }));
  const p = gen.generateCase('a:f:TC_A');
  while (!release) await new Promise((r) => setTimeout(r, 5));
  store.patch('cases', 'a:f:TC_A', { rowsHash: 'h2' }); // import mới đổi bước
  release();
  assert.equal((await p).status, 'stale');
});

// I6
test('I6: recover đổi case generating → failed, app preparing → error', () => {
  const s = createStore(tmpDir());
  s.put('cases', { id: 'c', script: { status: 'generating' } });
  s.put('apps', { id: 'a', status: 'preparing' });
  createLock().recover(s);
  assert.equal(s.get('cases', 'c').script.status, 'failed');
  assert.match(s.get('cases', 'c').script.error, /khởi động lại/);
  assert.equal(s.get('apps', 'a').status, 'error');
});

// I7
test('I7: chuẩn bị lại workspace xuất lại locator map; từ chối khi simulator đang chạy job', async () => {
  const dataDir = tmpDir();
  const ws = tmpDir();
  const store = createStore(dataDir);
  store.put('apps', { id: 'a', workspace: ws, status: 'ready' });
  const map = createScreenMap({ store, dataDir });
  map.addSnapshot('a', { xml: fx('welcome'), png: null });
  const lock = createLock();
  const create = async () => { fs.mkdirSync(path.join(ws, 'locators'), { recursive: true }); fs.writeFileSync(path.join(ws, 'locators/map.js'), 'export const L = {};'); };
  await prepareApp({ store, map, emit: () => {}, lock, create }, store.get('apps', 'a'));
  assert.match(fs.readFileSync(path.join(ws, 'locators/map.js'), 'utf8'), /Welcome/);
  lock.acquire({ kind: 'run', id: 'R', label: 'Đang chạy R' });
  await assert.rejects(prepareApp({ store, map, emit: () => {}, lock, create }, store.get('apps', 'a')), /Đang chạy R/);
});

// I8
const screen = (texts, buttons) => [...texts.map((t) => ({ type: 'StaticText', name: t })), ...buttons.map((b) => ({ type: 'Button', name: b }))];
test('I8: cùng màn, chữ dữ liệu khác (Hi, Anna / Hi, Ben) → vẫn là 1 màn', () => {
  assert.equal(sameScreen(screen(['Hi, Anna'], ['Edit', 'Save', 'Back']), screen(['Hi, Ben'], ['Edit', 'Save', 'Back'])), true);
});
test('I8: màn có nút khác hẳn vẫn là màn khác', () => {
  assert.equal(sameScreen(screen(['Profile'], ['Edit', 'Save', 'Back']), screen(['Settings'], ['Logout', 'Language', 'Back'])), false);
});
test('I8: addSnapshot chọn màn khớp nhất, không phải màn khớp đầu tiên', () => {
  const dataDir = tmpDir();
  const store = createStore(dataDir);
  store.put('apps', { id: 'a', workspace: tmpDir() });
  const map = createScreenMap({ store, dataDir });
  const mk = (title, extra) => `<?xml version="1.0"?><AppiumAUT><XCUIElementTypeApplication name="X" width="440" height="956">${['A', 'B', 'C', 'D', ...extra].map((b) => `<XCUIElementTypeButton name="${b}" x="0" y="0" width="10" height="10"/>`).join('')}<XCUIElementTypeStaticText name="${title}" x="0" y="0" width="10" height="10"/></XCUIElementTypeApplication></AppiumAUT>`;
  const s1 = map.addSnapshot('a', { xml: mk('One', ['E']), png: null, nameHint: 'One' }).screen;
  const s2 = map.addSnapshot('a', { xml: mk('Two', ['F', 'G']), png: null, nameHint: 'Two' }).screen;
  assert.notEqual(s1.id, s2.id);
  assert.equal(map.addSnapshot('a', { xml: mk('Two', ['F', 'G']), png: null }).screen.id, s2.id);
});

// I9
test('I9: đổi tên màn / key → tên cũ vẫn có trong map.js (alias), script cũ không vỡ', async () => {
  const dataDir = tmpDir();
  const ws = tmpDir();
  const store = createStore(dataDir);
  store.put('apps', { id: 'a', workspace: ws });
  const map = createScreenMap({ store, dataDir });
  const s = map.addSnapshot('a', { xml: fx('login-empty'), png: null }).screen;
  const idx = s.elements.findIndex((e) => e.type === 'TextField');
  map.setElementKey(s.id, idx, 'Email field');
  map.setElementKey(s.id, idx, 'Email');
  map.renameScreen(s.id, 'Login');
  const { L } = await import(`${map.exportLocators('a')}?t=${Date.now()}`);
  assert.equal(L.Login.Email, '-ios class chain:**/XCUIElementTypeTextField');
  assert.equal(L['Log In'].Email, L.Login.Email);
  assert.equal(L.Login['Email field'], L.Login.Email);
});

// I10
test('I10: stdin của claude lỗi EPIPE không làm sập tiến trình', async () => {
  const spawnImpl = () => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    p.stdin = new EventEmitter();
    p.stdin.write = () => { setImmediate(() => p.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))); };
    p.stdin.end = () => {};
    p.kill = () => {};
    setTimeout(() => { p.stderr.emit('data', Buffer.from('Please run /login')); p.emit('close', 1); }, 10);
    return p;
  };
  const r = await runClaude({ prompt: 'x'.repeat(100000), spawnImpl });
  assert.equal(r.ok, false);
  assert.match(r.error, /login/);
});

// I11
test('I11: Stop mà wdio không thoát với SIGINT → SIGTERM rồi SIGKILL, lock được nhả', async () => {
  const dataDir = tmpDir();
  const ws = tmpDir();
  fs.mkdirSync(path.join(ws, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'tests/f.e2e.js'), '//');
  const store = createStore(dataDir);
  store.put('apps', { id: 'a', name: 'A', workspace: ws, status: 'ready', env: {} });
  store.put('cases', { id: 'a:f:TC_A', appId: 'a', file: 'f', tcId: 'TC_A', order: 0, fresh: true, prev: null, script: { status: 'generated' } });
  const lock = createLock();
  const sigs = [];
  const spawnImpl = () => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    p.kill = (sig) => { sigs.push(sig); if (sig === 'SIGKILL') setTimeout(() => p.emit('close', null, sig), 1); };
    return p;
  };
  const runner = createRunner({ store, lock, emit: () => {}, dataDir, spawnImpl, scriptPath: (app, f) => path.join(app.workspace, 'tests', `${f}.e2e.js`), pollMs: 5, killGraceMs: 20 });
  await runner.startRun({ appId: 'a', udid: 'U', caseIds: ['a:f:TC_A'] });
  await runner.stop('RUN-0001');
  const end = Date.now() + 2000;
  while (store.get('runs', 'RUN-0001').status === 'running' && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(sigs, ['SIGINT', 'SIGTERM', 'SIGKILL']);
  assert.equal(store.get('runs', 'RUN-0001').status, 'stopped');
  assert.equal(lock.current(), null);
});

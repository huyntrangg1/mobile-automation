import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createScreenMap } from '../server/locators/screenMap.js';
import { createGenerator } from '../server/scripts/generate.js';
import { readRegions } from '../server/scripts/scriptFile.js';
import { ROOT } from '../server/paths.js';
import { tmpDir } from './helpers.js';

const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}.xml`, import.meta.url), 'utf8');
const GOOD = "async ({ tc, data, sa, fill }) => {\n  await ui.tap(L['Welcome']['Continue with email']);\n}";
const row = (step, screen, kind, keyword, target, value = '') => ({ step, screen, kind, keyword, target, value, compare: '', platform: 'All', label: kind === 'Check' ? `${target} hiển thị` : '' });

function setup(answers) {
  const dataDir = tmpDir();
  const ws = tmpDir();
  fs.cpSync(path.join(ROOT, 'server/apps/template/src/utils'), path.join(ws, 'src/utils'), { recursive: true });
  const store = createStore(dataDir);
  store.put('apps', { id: 'ikf', name: 'IK', workspace: ws, helperPack: null });
  const map = createScreenMap({ store, dataDir });
  map.addSnapshot('ikf', { xml: fx('welcome'), png: null });
  map.addSnapshot('ikf', { xml: fx('login-empty'), png: null });
  const mk = (tcId, order, rows) => store.put('cases', { id: `ikf:auth:${tcId}`, appId: 'ikf', file: 'auth', tcId, order, title: tcId, fresh: order === 0, prev: null, pre: ['Cài lại app'], rows, script: { status: 'none', warnings: [] } });
  mk('TC_A', 0, [row(1, 'Welcome', 'Action', 'Tap', 'Continue with email'), row(1, 'Log In', 'Check', 'Verify displayed', 'Log In')]);
  mk('TC_B', 1, [row(1, 'Log In', 'Check', 'Verify displayed', 'Nút không có')]);
  mk('TC_C', 2, [row(1, 'Welcome', 'Check', 'Verify displayed', 'OR')]);
  let i = 0;
  const prompts = [];
  const runClaude = async ({ prompt }) => { prompts.push(prompt); const a = answers[Math.min(i++, answers.length - 1)]; return typeof a === 'function' ? a(prompt) : a; };
  const events = [];
  const gen = createGenerator({ store, map, emit: (t, p) => events.push([t, p]), runClaude });
  const file = path.join(ws, 'tests/auth.e2e.js');
  return { store, gen, file, prompts, events };
}
const ok = (body, warnings = []) => ({ ok: true, data: { body, warnings } });

test('body gọi runTestcase → failed, không ghi file', async () => {
  const { store, gen, file } = setup([ok("async () => { await runTestcase(tc); }")]);
  const s = await gen.generateCase('ikf:auth:TC_A');
  assert.equal(s.status, 'failed');
  assert.match(s.error, /runTestcase/);
  assert.equal(store.get('cases', 'ikf:auth:TC_A').script.status, 'failed');
  assert.ok(!fs.existsSync(file));
});

test('body lỗi cú pháp 2 lần → failed có SyntaxError, file trên đĩa giữ nguyên', async () => {
  const { gen, file, prompts } = setup([ok(GOOD), ok('async () => { if ( }')]);
  await gen.generateCase('ikf:auth:TC_A');
  const before = fs.readFileSync(file, 'utf8');
  const s = await gen.generateCase('ikf:auth:TC_C');
  assert.equal(s.status, 'failed');
  assert.match(s.error, /SyntaxError/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.match(prompts[2], /SyntaxError/); // lần thử lại có kèm lỗi
});

test('lỗi cú pháp lần 1, đúng lần 2 → generated', async () => {
  const { gen } = setup([ok('async () => { if ( }'), ok(GOOD)]);
  assert.equal((await gen.generateCase('ikf:auth:TC_A')).status, 'generated');
});

test('target không có trong locator map → generated + cảnh báo đúng câu', async () => {
  const { gen } = setup([ok(GOOD)]);
  const s = await gen.generateCase('ikf:auth:TC_B');
  assert.equal(s.status, 'generated');
  assert.ok(s.warnings.includes('Màn Log In: không tìm thấy "Nút không có" trong locator map'));
});

test('màn trong Excel không có trong map → cảnh báo tên màn', async () => {
  const { store, gen } = setup([ok(GOOD)]);
  store.patch('cases', 'ikf:auth:TC_C', { rows: [row(1, 'Sex', 'Action', 'Tap', 'Female')] });
  const s = await gen.generateCase('ikf:auth:TC_C');
  assert.ok(s.warnings.some((w) => /Màn "Sex" chưa có trong locator map/.test(w)));
});

test('gen 3 case song song → file có đủ 3 region đúng thứ tự', async () => {
  const { gen, file, store } = setup([(p) => ok(GOOD.replace('Continue with email', (p.match(/Case (TC_\w)/) || [])[1] || 'x'))]);
  await gen.generate('ikf', ['ikf:auth:TC_C', 'ikf:auth:TC_A', 'ikf:auth:TC_B']);
  const regions = readRegions(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(regions), ['TC_A', 'TC_B', 'TC_C']);
  assert.match(regions.TC_B, /TC_B/);
  assert.ok(store.list('cases').every((c) => c.script.status === 'generated'));
});

test('AI lỗi → failed với lý do; status đi qua generating và phát sự kiện script', async () => {
  const { gen, events } = setup([{ ok: false, error: 'Claude quá thời gian (300s)' }]);
  const s = await gen.generateCase('ikf:auth:TC_A');
  assert.equal(s.status, 'failed');
  assert.match(s.error, /quá thời gian/);
  assert.deepEqual(events.filter(([t]) => t === 'script').map(([, p]) => p.script.status), ['generating', 'failed']);
});

test('prompt có các dòng của case, locator map và helper', async () => {
  const { gen, prompts } = setup([ok(GOOD)]);
  await gen.generateCase('ikf:auth:TC_A');
  assert.match(prompts[0], /Tap \| Continue with email/);
  assert.match(prompts[0], /## Màn "Log In"/);
  assert.match(prompts[0], /ui: .*tap/);
  assert.match(prompts[0], /softAssert|sa\.eq/);
});

test('generate bỏ qua case đang gen dở (bấm nhiều lần không chạy trùng)', async () => {
  let calls = 0;
  let release;
  const { gen, store } = setup([() => { calls++; return new Promise((r) => { release = () => r(ok(GOOD)); }); }]);
  const first = gen.generate('ikf', ['ikf:auth:TC_A']);
  while (!release) await new Promise((r) => setTimeout(r, 5));
  await gen.generate('ikf', ['ikf:auth:TC_A']);
  release();
  await first;
  assert.equal(calls, 1);
  assert.equal(store.get('cases', 'ikf:auth:TC_A').script.status, 'generated');
});

test('refreshScript sinh lại khung (giữ nguyên region) cho file script cũ', async () => {
  const { gen, store, file } = setup([ok(GOOD)]);
  await gen.generateCase('ikf:auth:TC_A');
  const old = fs.readFileSync(file, 'utf8').replace(/const LIVE = [^\n]*\n/, ''); // giả lập file sinh bởi khung cũ
  fs.writeFileSync(file, old);
  await gen.refreshScript(store.get('apps', 'ikf'), 'auth');
  const now = fs.readFileSync(file, 'utf8');
  assert.match(now, /const LIVE = process\.env\.LIVE_STEPS/);
  assert.equal(readRegions(now).TC_A, readRegions(old).TC_A);
});

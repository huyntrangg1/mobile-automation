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
  const runClaude = async (args) => { prompts.push(`${args.system || ''}\n${args.prompt}`); const a = answers[Math.min(i++, answers.length - 1)]; return typeof a === 'function' ? a(args.prompt, args) : a; };
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
  assert.match(prompts[0], /## "Log In"/);
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

test('body tự gọi snapshot / sa.eq / logStep → hỏi AI sửa 1 lần kèm lý do; lần sau đúng thì lưu', async () => {
  const BAD = "async ({ tc, data, sa, fill, k }) => {\n  const ev = await snapshot('Goals', 'x');\n  sa.eq(true, true, 'x', ev);\n}";
  const { gen, prompts, store } = setup([ok(BAD), ok(GOOD)]);
  const s = await gen.generateCase('ikf:auth:TC_A');
  assert.equal(s.status, 'generated');
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /Không gọi trực tiếp: snapshot\(, sa\.eq\(/);
  assert.match(prompts[1], /k\.check/);
  void store;
});

test('vẫn tự gọi snapshot sau lần sửa → failed, không ghi file, báo lý do', async () => {
  const BAD = "async ({ tc, data, sa, fill, k }) => {\n  logStep({ kind: 'Action' });\n}";
  const { gen, file } = setup([ok(BAD), ok(BAD)]);
  const s = await gen.generateCase('ikf:auth:TC_A');
  assert.equal(s.status, 'failed');
  assert.match(s.error, /logStep\(/);
  assert.ok(!fs.existsSync(file));
});

// AI "treo" tới khi bị dừng (như claude đang chạy), hoặc trả GOOD nếu không ai dừng
const hang = (_p, { signal }) => new Promise((res) => signal.addEventListener('abort', () => res({ ok: false, cancelled: true, error: 'Đã dừng gen' })));

test('dừng gen case đang gọi AI → trả lại script cũ (vẫn "Đã gen" bản trước), không ghi file mới', async () => {
  const { store, gen, events } = setup([hang]);
  const prev = { status: 'generated', warnings: [], path: 'x', generatedAt: '2026-10-01' };
  store.patch('cases', 'ikf:auth:TC_A', { script: prev });
  const p = gen.generate('ikf', ['ikf:auth:TC_A']);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(store.get('cases', 'ikf:auth:TC_A').script.status, 'generating');
  assert.deepEqual(gen.generatingIds('ikf'), ['ikf:auth:TC_A']);
  assert.equal(gen.cancel(['ikf:auth:TC_A']), 1);
  await p;
  assert.deepEqual(store.get('cases', 'ikf:auth:TC_A').script, prev);
  assert.deepEqual(gen.generatingIds('ikf'), []);
  assert.equal(events.at(-1)[1].script.status, 'generated');
});

test('dừng case còn chờ trong hàng → không gọi AI cho case đó; case khác vẫn gen', async () => {
  const { store, gen, prompts } = setup([hang]);
  for (let k = 0; k < 2; k++) store.put('cases', { ...store.get('cases', 'ikf:auth:TC_C'), id: `ikf:auth:TC_Q${k}`, tcId: `TC_Q${k}`, order: 3 + k });
  const ids = ['ikf:auth:TC_A', 'ikf:auth:TC_B', 'ikf:auth:TC_C', 'ikf:auth:TC_Q0', 'ikf:auth:TC_Q1'];
  const p = gen.generate('ikf', ids);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(prompts.length, 3); // 3 case chạy song song, 2 case chờ
  gen.cancel(['ikf:auth:TC_Q1']);
  assert.equal(store.get('cases', 'ikf:auth:TC_Q1').script.status, 'none');
  gen.cancel(ids.slice(0, 3)); // dừng 3 case đang chạy → TC_Q0 được chạy
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(prompts.length, 4);
  assert.match(prompts[3], /TC_Q0/);
  gen.cancel(['ikf:auth:TC_Q0']);
  await p;
  for (const id of ids) assert.equal(store.get('cases', id).script.status, 'none');
});

test('prompt tách 2 phần: phần cố định (system, cache được) không chứa gì riêng của case; tin nhắn bắt đầu bằng "# Case"', async () => {
  const calls = [];
  const { gen: g } = setup([(_p, a) => { calls.push(a); return ok(GOOD); }]);
  await g.generateCase('ikf:auth:TC_A');
  await g.generateCase('ikf:auth:TC_B');
  assert.equal(calls[0].system, calls[1].system); // giống nhau giữa các case → cache
  assert.match(calls[0].prompt, /^# Case TC_A/);
  assert.doesNotMatch(calls[0].system, /TC_A|TC_B|Cài lại app"/);
  assert.match(calls[0].prompt, /Bắt đầu: Case này "Cài lại app"/);
});

test('dừng case còn chờ rồi bấm gen lại ngay → case đó được gen (không bị coi là đang gen trùng)', async () => {
  const { store, gen, prompts } = setup([hang]);
  for (let k = 0; k < 2; k++) store.put('cases', { ...store.get('cases', 'ikf:auth:TC_C'), id: `ikf:auth:TC_Q${k}`, tcId: `TC_Q${k}`, order: 3 + k });
  const ids = ['ikf:auth:TC_A', 'ikf:auth:TC_B', 'ikf:auth:TC_C', 'ikf:auth:TC_Q0'];
  const p1 = gen.generate('ikf', ids);
  await new Promise((r) => setTimeout(r, 20));
  gen.cancel(['ikf:auth:TC_Q0']);
  assert.deepEqual(gen.generatingIds('ikf').sort(), ids.slice(0, 3).sort());
  const p2 = gen.generate('ikf', ['ikf:auth:TC_Q0']);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(prompts.some((p) => /# Case TC_Q0/.test(p)));
  gen.cancel(gen.generatingIds('ikf'));
  await Promise.all([p1, p2]);
});

test('bấm dừng khi AI đã trả kết quả (đang ghi file) → giữ kết quả mới, không trả trạng thái cũ', async () => {
  let gen;
  // AI trả xong; lệnh dừng tới khi tool đang kiểm cú pháp / ghi file (node --check mất vài chục ms)
  const r = setup([async () => { setTimeout(() => gen.cancel(['ikf:auth:TC_A']), 5); return ok(GOOD); }]);
  gen = r.gen;
  await gen.generate('ikf', ['ikf:auth:TC_A']);
  assert.equal(r.store.get('cases', 'ikf:auth:TC_A').script.status, 'generated');
  assert.match(fs.readFileSync(r.file, 'utf8'), /#region TC_A/);
});

test('Ghi chú cho AI của app nằm trong phần cố định (system, cache được); không có ghi chú thì không thêm mục', async () => {
  const calls = [];
  const { store, gen } = setup([(_p, a) => { calls.push(a); return ok(GOOD); }]);
  store.patch('apps', 'ikf', { aiNotes: 'Tutorial tự chuyển slide; tap ảnh chuyển ngay.' });
  await gen.generateCase('ikf:auth:TC_A');
  assert.match(calls[0].system, /# Ghi chú về app[\s\S]*Tutorial tự chuyển slide/);
  store.patch('apps', 'ikf', { aiNotes: '' });
  await gen.generateCase('ikf:auth:TC_B');
  assert.doesNotMatch(calls[1].system, /Ghi chú về app/);
});

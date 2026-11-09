import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createStore } from '../server/store.js';
import { createScreenMap } from '../server/locators/screenMap.js';
import { createGenerator, kTableFor, stepsMethods, BAD_TC_ID } from '../server/scripts/generate.js';
import { readRegions } from '../server/scripts/scriptFile.js';
import scriptRoutes from '../server/routes/scripts.js';
import { ROOT } from '../server/paths.js';
import { tmpDir } from './helpers.js';

const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}.xml`, import.meta.url), 'utf8');
const GOOD = "async ({ tc, data, sa, fill }) => {\n  await ui.tap(L['Welcome']['Continue with email']);\n}";
const row = (step, screen, kind, keyword, target, value = '') => ({ step, screen, kind, keyword, target, value, compare: '', platform: 'All', label: '' });
const ok = (body, warnings = []) => ({ ok: true, data: { body, warnings } });

function setup(answers, { ids = ['TC_A', 'TC_B'], steps } = {}) {
  const dataDir = tmpDir();
  const ws = tmpDir();
  fs.cpSync(path.join(ROOT, 'server/apps/template/src/utils'), path.join(ws, 'src/utils'), { recursive: true });
  if (steps) { fs.mkdirSync(path.join(ws, 'src/runner'), { recursive: true }); fs.writeFileSync(path.join(ws, 'src/runner/steps.js'), steps); }
  const store = createStore(dataDir);
  store.put('apps', { id: 'ikf', name: 'IK', workspace: ws, helperPack: null, status: 'ready' });
  const map = createScreenMap({ store, dataDir });
  map.addSnapshot('ikf', { xml: fx('welcome'), png: null });
  ids.forEach((tcId, order) => store.put('cases', { id: `ikf:auth:${tcId}`, appId: 'ikf', file: 'auth', tcId, order, title: tcId, fresh: order === 0, prev: null, pre: [], rows: [row(1, 'Welcome', 'Action', 'Close popup', 'Close')], script: { status: 'none', warnings: [] } }));
  let i = 0;
  const prompts = [];
  const runClaude = async (args) => { prompts.push(`${args.system || ''}\n${args.prompt}`); return answers[Math.min(i++, answers.length - 1)]; };
  const gen = createGenerator({ store, map, emit: () => {}, runClaude });
  return { store, gen, ws, prompts, file: path.join(ws, 'tests/auth.e2e.js'), app: store.get('apps', 'ikf') };
}

const OLD_STEPS = 'export function createSteps() {\n  return {\n    async tap(step) {},\n    async count(step) {},\n    async nav(screen) {},\n  };\n}\n';

test('bảng k: chỉ giữ dòng gọi hàm k mà steps.js của workspace có; báo hàm thiếu', () => {
  const { ws } = setup([], { steps: OLD_STEPS });
  assert.deepEqual([...stepsMethods(ws)].filter((n) => ['tap', 'count', 'nav'].includes(n)).sort(), ['count', 'nav', 'tap']);
  const kt = kTableFor(ws);
  assert.match(kt.text, /k\.tap\(/);
  assert.doesNotMatch(kt.text, /k\.closePopup\(/);
  assert.doesNotMatch(kt.text, /k\.tapOutside\(/);
  assert.ok(kt.missing.includes('closePopup'));
  assert.ok(kt.dropped.some((d) => /Close popup/.test(d)));
  // Dòng không gọi hàm k (Run flow) và dòng chỉ dùng k.check / k.log vẫn giữ
  assert.match(kt.text, /Run flow/);
});

test('bảng k: workspace steps.js của template hiện tại → không bỏ dòng nào; không có steps.js → không lọc', () => {
  const ws = tmpDir();
  fs.mkdirSync(path.join(ws, 'src/runner'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'server/apps/template/src/runner/steps.js'), path.join(ws, 'src/runner/steps.js'));
  const kt = kTableFor(ws);
  assert.deepEqual(kt.missing, [], `thiếu: ${kt.missing}`);
  assert.equal(kTableFor(tmpDir()).missing.length, 0);
});

test('gen: case dùng keyword mà workspace thiếu hàm k → prompt không có hàm đó + cảnh báo chuẩn bị lại', async () => {
  const { gen, prompts } = setup([ok(GOOD)], { steps: OLD_STEPS });
  const s = await gen.generateCase('ikf:auth:TC_A');
  assert.equal(s.status, 'generated');
  assert.doesNotMatch(prompts[0], /k\.closePopup\(/);
  assert.ok(s.warnings.some((w) => /k\.closePopup.*Chuẩn bị lại/.test(w)), s.warnings.join('\n'));
});

test('TC ID có dấu cách / dấu tiếng Việt → failed ngay (không gọi AI), thông báo đổi TC ID', async () => {
  const { gen, prompts, store } = setup([ok(GOOD)], { ids: ['TC_A', 'TC đăng nhập'] });
  const s = await gen.generateCase('ikf:auth:TC đăng nhập');
  assert.equal(s.status, 'failed');
  assert.match(s.error, new RegExp(BAD_TC_ID.slice(0, 30)));
  assert.equal(prompts.length, 0);
  assert.equal(store.get('cases', 'ikf:auth:TC đăng nhập').script.status, 'failed');
});

test('sau khi ghi, region của case không có trong file (case bị xoá khỏi Excel lúc gen) → failed, không báo "generated"', async () => {
  const h = setup([ok(GOOD)]);
  // Giả lập: lúc ghi file, case đã không còn trong danh sách case của file (import lại xoá case)
  const list = h.store.list.bind(h.store);
  h.store.list = (k) => (k === 'cases' ? list(k).filter((c) => c.tcId !== 'TC_A') : list(k));
  const s = await h.gen.generateCase('ikf:auth:TC_A');
  assert.equal(s.status, 'failed');
  assert.match(s.error, /Không ghi được code/);
});

test('saveFile: code CRLF vẫn đọc được region (không mất thay đổi); có #region mà không đọc được → lỗi, không ghi', async () => {
  const { gen, app, file } = setup([ok(GOOD)]);
  await gen.generateCase('ikf:auth:TC_A');
  const now = fs.readFileSync(file, 'utf8');
  const edited = now.replace("['Continue with email']", "['Log In']").replace(/\n/g, '\r\n');
  const r = await gen.saveFile(app, 'auth', edited, gen.hashOf(now));
  assert.ok(!r.error, r.error);
  assert.deepEqual(r.changed, ['TC_A']);
  assert.match(readRegions(fs.readFileSync(file, 'utf8')).TC_A, /Log In/);
  const cur = fs.readFileSync(file, 'utf8');
  const broken = cur.replace('// #endregion TC_A', '// #endregion');
  const r2 = await gen.saveFile(app, 'auth', broken, gen.hashOf(cur));
  assert.match(r2.error, /Không đọc được region/);
  assert.equal(fs.readFileSync(file, 'utf8'), cur);
});

test('sinh lại khung bỏ region của case đã xoá / đổi TC ID → chép file cũ ra .bak và báo region bị bỏ', async () => {
  const { gen, app, file, store, ws } = setup([ok(GOOD)]);
  await gen.generateCase('ikf:auth:TC_A');
  await gen.generateCase('ikf:auth:TC_B');
  const before = fs.readFileSync(file, 'utf8');
  store.remove('cases', 'ikf:auth:TC_B');
  const r = await gen.refreshScript(app, 'auth');
  assert.deepEqual(r.dropped, ['TC_B']);
  assert.ok(r.backup && fs.existsSync(r.backup));
  assert.equal(fs.readFileSync(r.backup, 'utf8'), before);
  assert.ok(!readRegions(fs.readFileSync(file, 'utf8')).TC_B);
  assert.ok(fs.readdirSync(path.join(ws, 'tests')).every((f) => !f.endsWith('.bak') || !/\.e2e\.js$/.test(f)));
  // Không bỏ gì → không có .bak mới
  const r2 = await gen.refreshScript(app, 'auth');
  assert.equal(r2.dropped, undefined);
});

test('route generate: case đã sửa tay → 409 (không ghi đè im lặng); force: true thì gen', async () => {
  const { store, app } = setup([ok(GOOD)]);
  store.patch('cases', 'ikf:auth:TC_A', { script: { status: 'generated', editedByHand: true } });
  const calls = [];
  const generator = { generate: async (appId, ids) => { calls.push(ids); } };
  const ex = express();
  ex.use(express.json());
  ex.use('/api', scriptRoutes({ store, emit: () => {}, generator }));
  const server = ex.listen(0);
  try {
    const post = (body) => fetch(`http://127.0.0.1:${server.address().port}/api/apps/${app.id}/scripts/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const r1 = await post({ caseIds: ['ikf:auth:TC_A', 'ikf:auth:TC_B'] });
    assert.equal(r1.status, 409);
    assert.match((await r1.json()).error, /TC_A/);
    assert.equal(calls.length, 0);
    const r2 = await post({ caseIds: ['ikf:auth:TC_A'], force: true });
    assert.equal(r2.status, 202);
    const r3 = await post({ caseIds: ['ikf:auth:TC_B'] });
    assert.equal(r3.status, 202);
    assert.equal(calls.length, 2);
  } finally { server.close(); }
});

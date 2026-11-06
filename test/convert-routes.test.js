import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpDir } from './helpers.js';
import { makeManual } from './fixtures/manualWorkbook.js';
import { fakeConvertAi } from './fixtures/convertAi.js';
import { createStore } from '../server/store.js';
import { createApp } from '../server/app.js';
import { importTestcases } from '../server/testcases/importXlsx.js';
import { createConverter } from '../server/testcases/convert/converter.js';
import manualRoutes from '../server/routes/manual.js';
import testcaseRoutes from '../server/routes/testcases.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOADER = path.join(ROOT, 'server/apps/template/data/loaders/testcase-v2.js');
const AUTOMATION = path.join(ROOT, 'samples/apidemos-automation.xlsx');

async function boot({ delay = 0 } = {}) {
  const dir = tmpDir();
  const store = createStore(path.join(dir, 'store'));
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  store.put('apps', { id: 'app1', name: 'App', workspace: ws, status: 'ready', platform: 'iOS' });
  const base = fakeConvertAi();
  const ai = async (req) => { if (delay) await new Promise((r) => setTimeout(r, delay)); return base(req); };
  const gen = [];
  const converter = createConverter({ store, map: { locatorTable: () => ({}) }, emit: () => {}, dataDir: path.join(dir, 'data'), runClaude: ai,
    generator: { generate: async (appId, ids) => { gen.push(ids); } }, importer: (a) => importTestcases({ ...a, loaderPath: LOADER }) });
  const ctx = { store, emit: () => {}, converter, generator: { generate: async () => {} }, lock: { current: () => null } };
  const server = createApp(ctx, [manualRoutes, testcaseRoutes]).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}/api`;
  return { dir, store, url, gen, close: () => server.close() };
}
const upload = (url, file, field = 'file') => {
  const fd = new FormData();
  fd.append(field, new Blob([fs.readFileSync(file)]), path.basename(file));
  return fetch(url, { method: 'POST', body: fd });
};
const json = (url, method, body) => fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('analyze: file automation → 400 chỉ cách chọn lại; file manual → 200 ready; route import cũ từ chối file manual', async (t) => {
  const b = await boot();
  t.after(b.close);
  const bad = await upload(`${b.url}/apps/app1/manual/analyze`, AUTOMATION);
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /File automation/);
  const f = await makeManual(b.dir, { sheets: [{ name: 'Welcome', cases: [{ id: 'TC_W_001', priority: 'High' }] }] });
  const ok = await upload(`${b.url}/apps/app1/manual/analyze`, f);
  assert.equal(ok.status, 200);
  const mi = await ok.json();
  assert.equal(mi.status, 'ready');
  assert.ok(!('src' in mi.cases[0]), 'không trả nội dung manual gốc về client');
  const old = await upload(`${b.url}/apps/app1/testcases`, f);
  assert.equal(old.status, 400);
  assert.match((await old.json()).error, /File manual/);
  const list = await (await fetch(`${b.url}/apps/app1/manual`)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, mi.id);
});

test('choices: mode lạ → 400; hợp lệ → 200 và lưu', async (t) => {
  const b = await boot();
  t.after(b.close);
  const f = await makeManual(b.dir, { sheets: [{ name: 'Welcome', cases: [{ id: 'TC_W_001', priority: 'High' }] }] });
  const mi = await (await upload(`${b.url}/apps/app1/manual/analyze`, f)).json();
  assert.equal((await json(`${b.url}/manual/${mi.id}/choices`, 'PUT', { sheet: 'Welcome', tcId: 'TC_W_001', mode: 'khác' })).status, 400);
  const ok = await json(`${b.url}/manual/${mi.id}/choices`, 'PUT', { sheet: 'Welcome', tcId: 'TC_W_001', mode: 'manual' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).cases[0].mode, 'manual');
});

test('convert: 202 chạy nền; gọi lần hai khi đang converting → 409; xong thì done', async (t) => {
  const b = await boot({ delay: 150 });
  t.after(b.close);
  const f = await makeManual(b.dir, { sheets: [{ name: 'Welcome', cases: [{ id: 'TC_W_001', priority: 'High' }] }] });
  const mi = await (await upload(`${b.url}/apps/app1/manual/analyze`, f)).json();
  assert.equal((await fetch(`${b.url}/manual/${mi.id}/convert`, { method: 'POST' })).status, 202);
  assert.equal((await fetch(`${b.url}/manual/${mi.id}/convert`, { method: 'POST' })).status, 409);
  let status;
  for (let i = 0; i < 100 && status !== 'done'; i++) { await new Promise((r) => setTimeout(r, 100)); status = (await (await fetch(`${b.url}/manual/${mi.id}`)).json()).status; }
  assert.equal(status, 'done');
  assert.equal(b.store.list('cases').length, 1);
  assert.equal((await fetch(`${b.url}/manual/khong-co`)).status, 404);
});

test('convert với body { gen: false } → không gen script', async (t) => {
  const b = await boot();
  t.after(b.close);
  const f = await makeManual(b.dir, { sheets: [{ name: 'Welcome', cases: [{ id: 'TC_W_001', priority: 'High' }] }] });
  const mi = await (await upload(`${b.url}/apps/app1/manual/analyze`, f)).json();
  assert.equal((await json(`${b.url}/manual/${mi.id}/convert`, 'POST', { gen: false })).status, 202);
  let status;
  for (let i = 0; i < 100 && status !== 'done'; i++) { await new Promise((r) => setTimeout(r, 100)); status = (await (await fetch(`${b.url}/manual/${mi.id}`)).json()).status; }
  assert.equal(status, 'done');
  assert.equal(b.store.list('cases').length, 1);
  assert.equal(b.gen.length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createStore } from '../server/store.js';
import smokeRoutes from '../server/routes/smoke.js';
import fs from 'node:fs';
import { tmpDir, figmaExportJson } from './helpers.js';

async function setup(smokeOver = {}) {
  const store = createStore(tmpDir());
  store.put('apps', { id: 'a', name: 'StressWatch', platform: 'iOS' });
  const calls = { start: [], stop: [] };
  const smoke = {
    start: async (o) => { calls.onStart?.(o); calls.start.push(o); return { id: 'SM-0001', status: 'running', ...o }; },
    stop: async (id) => { calls.stop.push(id); },
    running: (id) => id === 'SM-0002',
    ...smokeOver,
  };
  const app = express();
  app.use(express.json());
  app.use('/api', smokeRoutes({ store, smoke }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, url, body) => { const r = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); const ct = r.headers.get('content-type') || ''; return { status: r.status, ct, body: ct.includes('json') ? await r.json() : await r.text() }; };
  return { store, calls, call, base, close: () => server.close() };
}

test('POST /apps/:appId/smoke → 201 và chuyển đúng tham số cho start (appId lấy từ đường dẫn)', async () => {
  const { calls, call, close } = await setup();
  const r = await call('POST', '/apps/a/smoke', { udid: 'U', prdUrl: 'p', figmaUrl: 'f', notes: 'n', account: 'x / y' });
  close();
  assert.equal(r.status, 201);
  assert.deepEqual(calls.start[0], { appId: 'a', udid: 'U', prdUrl: 'p', figmaUrl: 'f', notes: 'n', account: 'x / y', robust: true, clean: false, depth: 'smoke', figmaFile: undefined, figmaName: undefined });
});

test('POST: robust mặc định bật; false / "false" / "0" tắt (JSON và multipart)', async () => {
  const { calls, call, close, base } = await setup();
  await call('POST', '/apps/a/smoke', { udid: 'U' });
  await call('POST', '/apps/a/smoke', { udid: 'U', robust: false });
  const f1 = new FormData(); f1.append('udid', 'U'); f1.append('robust', 'false');
  await fetch(`${base}/apps/a/smoke`, { method: 'POST', body: f1 });
  const f2 = new FormData(); f2.append('udid', 'U'); f2.append('robust', 'true');
  await fetch(`${base}/apps/a/smoke`, { method: 'POST', body: f2 });
  close();
  assert.deepEqual(calls.start.map((s) => s.robust), [true, false, false, true]);
});

test('POST: lỗi từ start giữ nguyên status và lời lỗi (409 bận, 400 đầu vào)', async () => {
  for (const [status, message] of [[409, 'Thiết bị đang bận: Run khác'], [400, 'Nhập link PRD']]) {
    const { call, close } = await setup({ start: async () => { throw Object.assign(new Error(message), { status }); } });
    const r = await call('POST', '/apps/a/smoke', {});
    close();
    assert.equal(r.status, status);
    assert.equal(r.body.error, message);
  }
});

test('GET /apps/:appId/smoke → chỉ lần chạy của app đó, mới nhất trước, không có log', async () => {
  const { store, call, close } = await setup();
  store.put('smoke', { id: 'SM-0001', appId: 'a', status: 'done', log: ['x'], flows: [], findings: [] });
  store.put('smoke', { id: 'SM-0002', appId: 'b', status: 'done', log: [], flows: [], findings: [] });
  store.put('smoke', { id: 'SM-0003', appId: 'a', status: 'done', log: ['y'], flows: [], findings: [] });
  const r = await call('GET', '/apps/a/smoke');
  close();
  assert.deepEqual(r.body.map((x) => x.id), ['SM-0003', 'SM-0001']);
  assert.ok(r.body.every((x) => !('log' in x)));
});

test('GET /smoke/:id → 404 khi không có; có thì kèm live + appName', async () => {
  const { store, call, close } = await setup();
  store.put('smoke', { id: 'SM-0002', appId: 'a', status: 'running', log: [], flows: [], findings: [] });
  const none = await call('GET', '/smoke/SM-9999');
  const got = await call('GET', '/smoke/SM-0002');
  close();
  assert.equal(none.status, 404);
  assert.equal(got.body.live, true);
  assert.equal(got.body.appName, 'StressWatch');
});

test('POST /smoke/:id/stop gọi stop', async () => {
  const { calls, call, close } = await setup();
  const r = await call('POST', '/smoke/SM-0002/stop', {});
  close();
  assert.equal(r.status, 200);
  assert.deepEqual(calls.stop, ['SM-0002']);
});

test('GET /smoke/:id/report → HTML; 404 khi không có lần chạy', async () => {
  const { store, call, close } = await setup();
  store.put('smoke', { id: 'SM-0001', appId: 'a', status: 'done', startedAt: '2026-11-05T10:00:00.000Z', log: [], flows: [], findings: [] });
  const ok = await call('GET', '/smoke/SM-0001/report');
  const none = await call('GET', '/smoke/SM-9999/report');
  close();
  assert.equal(ok.status, 200);
  assert.match(ok.ct, /text\/html/);
  assert.match(ok.body, /StressWatch/);
  assert.equal(none.status, 404);
});

test('POST có file Figma .json (multipart) → start nhận figmaFile + figmaName, file tạm bị xoá sau đó', async () => {
  const { calls, call, close, base } = await setup();
  const form = new FormData();
  form.append('udid', 'U'); form.append('prdUrl', ''); form.append('notes', 'n');
  form.append('figmaJson', new Blob([figmaExportJson()], { type: 'application/json' }), 'Moss.json');
  let seen;
  calls.onStart = (o) => { seen = { ...o, existed: o.figmaFile && fs.existsSync(o.figmaFile) }; };
  const r = await fetch(`${base}/apps/a/smoke`, { method: 'POST', body: form });
  close();
  assert.equal(r.status, 201);
  assert.equal(seen.figmaName, 'Moss.json');
  assert.equal(seen.existed, true);
  assert.equal(fs.existsSync(seen.figmaFile), false);
  assert.equal(seen.udid, 'U');
  assert.equal(seen.notes, 'n');
});

test('POST: clean mặc định tắt; true / "true" / "1" bật (JSON và multipart)', async () => {
  const { calls, call, close, base } = await setup();
  await call('POST', '/apps/a/smoke', { udid: 'U' });
  await call('POST', '/apps/a/smoke', { udid: 'U', clean: true });
  const f1 = new FormData(); f1.append('udid', 'U'); f1.append('clean', 'true');
  await fetch(`${base}/apps/a/smoke`, { method: 'POST', body: f1 });
  const f2 = new FormData(); f2.append('udid', 'U'); f2.append('clean', 'false');
  await fetch(`${base}/apps/a/smoke`, { method: 'POST', body: f2 });
  close();
  assert.deepEqual(calls.start.map((s) => s.clean), [false, true, true, false]);
});

test('POST: depth "full" được chuyển cho smoke.start; giá trị lạ → smoke', async () => {
  const { calls, call, close } = await setup();
  await call('POST', '/apps/a/smoke', { udid: 'U', depth: 'full' });
  assert.equal(calls.start.at(-1).depth, 'full');
  await call('POST', '/apps/a/smoke', { udid: 'U', depth: 'abc' });
  assert.equal(calls.start.at(-1).depth, 'smoke');
  close();
});

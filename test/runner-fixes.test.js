// Runner: lỗi trước khi wdio chạy, wdio chết giữa chừng, run bị ngắt, kết quả hook lỗi, report khi run dừng, máy thật không chụp được
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createLock } from '../server/lock.js';
import { createRunner, rerunCaseIds, resultTcId } from '../server/runs/runner.js';
import { ensureSimulatorReady, deviceScreenshot } from '../server/device/platforms.js';
import { tmpDir } from './helpers.js';

const mk = (tcId, order) => ({ id: `a:f:${tcId}`, appId: 'a', file: 'f', tcId, title: tcId, order, fresh: true, prev: null, rows: [], script: { status: 'generated' } });
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); }
};

function setup({ results = [], code = 0, html = true, platform = 'Android', hooks = null, ...over } = {}) {
  const dataDir = tmpDir();
  const ws = tmpDir();
  fs.mkdirSync(path.join(ws, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'tests/f.e2e.js'), '// script');
  if (hooks) { fs.mkdirSync(path.join(ws, 'src/report'), { recursive: true }); fs.writeFileSync(path.join(ws, 'src/report/hooks.js'), hooks); }
  const store = createStore(dataDir);
  store.put('apps', { id: 'a', name: 'A', workspace: ws, status: 'ready', appPath: '/x.app', bundleId: 'b', platform });
  for (const c of [mk('TC_1', 0), mk('TC_2', 1), mk('TC_3', 2)]) store.put('cases', c);
  const lock = createLock();
  const spawnImpl = (cmd, args, opts) => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    p.kill = () => setTimeout(() => p.emit('close', null), 5);
    setTimeout(() => {
      const dir = path.join(opts.env.REPORTS_DIR, 'results');
      fs.mkdirSync(dir, { recursive: true });
      results.forEach((r, i) => fs.writeFileSync(path.join(dir, `${i}-1.json`), JSON.stringify(r)));
      if (html) fs.writeFileSync(path.join(opts.env.REPORTS_DIR, 'bug-report.html'), '<html></html>');
      p.emit('close', code);
    }, 10);
    return p;
  };
  const runner = createRunner({ store, lock, emit: () => {}, dataDir, spawnImpl, screenshotImpl: async () => { throw new Error('no device'); }, wdaCheck: async () => false, scriptPath: (app, f) => path.join(app.workspace, 'tests', `${f}.e2e.js`), pollMs: 5, ...over });
  return { store, lock, runner, ws };
}
const ids = ['a:f:TC_1', 'a:f:TC_2', 'a:f:TC_3'];
const res = (id, status) => ({ title: `${id} t`, status, duration: 1, case: { id }, bugs: [], error: status === 'passed' ? null : 'x' });

test('lỗi trước khi wdio chạy (bật simulator lỗi) → run error, nhả thiết bị, không kẹt running', async () => {
  const { store, lock, runner } = setup({ platform: 'iOS', prepareSim: async () => { throw new Error('bootstatus treo'); } });
  await assert.rejects(runner.startRun({ appId: 'a', udid: 'U', caseIds: ids }), /bootstatus treo/);
  const r = store.get('runs', 'RUN-0001');
  assert.equal(r.status, 'error');
  assert.match(r.error, /bootstatus treo/);
  assert.equal(lock.current(), null);
  assert.equal(runner.isRunning('RUN-0001'), false);
});

test('ensureSimulatorReady: bootstatus quá thời gian → false (không treo)', async () => {
  const t0 = Date.now();
  const ok = await ensureSimulatorReady('AEB04EEE-C04D-4DC5-856B-D6784E7B0FCB', { exec: () => new Promise(() => {}), timeoutMs: 30 });
  assert.equal(ok, false);
  assert.ok(Date.now() - t0 < 1000);
});

test('wdio chết giữa chừng (exit ≠ 0, còn case chưa chạy) → done + warning + dòng log', async () => {
  const { store, runner } = setup({ results: [res('TC_1', 'passed')], code: 1 });
  await runner.startRun({ appId: 'a', udid: 'U', caseIds: ids });
  assert.equal(runner.isRunning('RUN-0001'), true);
  await until(() => store.get('runs', 'RUN-0001').status !== 'running');
  const r = store.get('runs', 'RUN-0001');
  assert.equal(r.status, 'done');
  assert.match(r.warning, /wdio dừng giữa chừng.*2 case chưa chạy/);
  assert.ok(r.log.some((l) => /wdio dừng giữa chừng.* — 2 case chưa chạy/.test(l)));
  assert.equal(runner.isRunning('RUN-0001'), false);
});

test('chạy hết bình thường → không có warning', async () => {
  const { store, runner } = setup({ results: [res('TC_1', 'passed'), res('TC_2', 'passed'), res('TC_3', 'failed')], code: 1 });
  await runner.startRun({ appId: 'a', udid: 'U', caseIds: ids });
  await until(() => store.get('runs', 'RUN-0001').status !== 'running');
  assert.equal(store.get('runs', 'RUN-0001').warning, null);
});

test('kết quả hook lỗi (case: null) → nhận TC theo tiêu đề, không thành Not Run', async () => {
  const hook = { title: '"before each" hook for "TC_2 login"', status: 'blocked', duration: 0, case: null, bugs: [], error: 'boom' };
  const { store, runner } = setup({ results: [res('TC_1', 'passed'), hook, res('TC_3', 'passed')] });
  await runner.startRun({ appId: 'a', udid: 'U', caseIds: ids });
  await until(() => store.get('runs', 'RUN-0001').status !== 'running');
  assert.equal(store.get('runs', 'RUN-0001').results.TC_2.status, 'blocked');
  assert.equal(resultTcId({ title: 'TC_3 abc', case: null }, { TC_3: {} }), 'TC_3');
});

test('run bị ngắt: case kẹt Queued / Running được "Run lại case chưa đạt" chọn', () => {
  const run = { caseIds: ['c1', 'c2', 'c3', 'c4'], order: ['T1', 'T2', 'T3', 'T4'], results: { T1: { status: 'passed' }, T2: { status: 'running' }, T3: { status: 'queued' }, T4: { status: 'failed' } } };
  assert.deepEqual(rerunCaseIds(run, true), ['c2', 'c3', 'c4']);
});

test('run dừng trước onComplete (chưa có bug-report.html) → dựng report bằng hooks.js của workspace', async () => {
  const hooks = "import fs from 'node:fs'; import path from 'node:path';\nexport async function buildHtml(reports, startedAt, o) { fs.writeFileSync(path.join(reports, 'bug-report.html'), `<html>${o.appName} ${o.sync}</html>`); }";
  const { store, runner } = setup({ results: [res('TC_1', 'passed')], html: false, hooks });
  await runner.startRun({ appId: 'a', udid: 'U', caseIds: ids });
  await until(() => store.get('runs', 'RUN-0001').status !== 'running');
  const r = store.get('runs', 'RUN-0001');
  assert.equal(r.reportUrl, '/files/data/runs/RUN-0001/reports/bug-report.html');
  assert.match(fs.readFileSync(path.join(r.reportsDir, 'bug-report.html'), 'utf8'), /A false/);
});

test('report lỗi khi dựng lại → bỏ qua, run vẫn kết thúc, nhả thiết bị', async () => {
  const { store, lock, runner } = setup({ results: [res('TC_1', 'passed')], html: false, hooks: 'export async function buildHtml() { throw new Error("x"); }' });
  await runner.startRun({ appId: 'a', udid: 'U', caseIds: ids });
  await until(() => store.get('runs', 'RUN-0001').status !== 'running');
  assert.equal(store.get('runs', 'RUN-0001').reportUrl, null);
  assert.equal(lock.current(), null);
});

test('deviceScreenshot: iPhone thật không gọi simctl — idevicescreenshot hoặc lỗi rõ (unsupported)', async () => {
  const f = path.join(tmpDir(), 's.jpg');
  try {
    await deviceScreenshot('00008120-001055C03C44A01E', f, 'iOS');
  } catch (e) {
    assert.doesNotMatch(String(e.message), /simctl/);
  }
});

test('POST rerun: máy đã nhớ không còn trong danh sách thiết bị → dùng máy của run cũ', async () => {
  const { default: express } = await import('express');
  const { default: runRoutes } = await import('../server/routes/runs.js');
  const store = createStore(tmpDir());
  store.put('runs', { id: 'RUN-0001', appId: 'x', udid: 'OLD', caseIds: ['c1'], order: ['T1'], results: { T1: { status: 'failed' } } });
  const got = [];
  const runner = { startRun: async (o) => { got.push(o.udid); store.put('runs', { id: `RUN-000${got.length + 1}`, appId: 'x' }); return { id: `RUN-000${got.length + 1}` }; } };
  const app = express();
  app.use(express.json());
  app.use('/api', runRoutes({ store, runner, devices: async () => [{ udid: 'OLD' }, { udid: 'NEW' }] }));
  const server = app.listen(0);
  const post = (body) => fetch(`http://127.0.0.1:${server.address().port}/api/runs/RUN-0001/rerun`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await post({ onlyFailed: true, udid: 'GONE' });
  await post({ onlyFailed: true, udid: 'NEW' });
  server.close();
  assert.deepEqual(got, ['OLD', 'NEW']);
});

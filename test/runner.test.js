import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createLock } from '../server/lock.js';
import { createRunner } from '../server/runs/runner.js';
import { tmpDir } from './helpers.js';

const mk = (tcId, order, fresh, prev, status = 'generated') => ({ id: `ikf:auth:${tcId}`, appId: 'ikf', file: 'auth', tcId, title: tcId, order, fresh, prev, rows: [], script: { status } });

function setup({ results = [], code = 0, hang = false } = {}) {
  const dataDir = tmpDir();
  const ws = tmpDir();
  fs.mkdirSync(path.join(ws, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'tests/auth.e2e.js'), '// script');
  const store = createStore(dataDir);
  store.put('apps', { id: 'ikf', name: 'IK', workspace: ws, status: 'ready', appPath: '/x.app', bundleId: 'b', env: { ALLOW_ACCOUNT_CREATE: '1' } });
  for (const c of [mk('TC_A', 0, true, null), mk('TC_B', 1, false, 'TC_A'), mk('TC_C', 2, false, 'TC_B'), mk('TC_D', 3, true, null, 'none')]) store.put('cases', c);
  const lock = createLock();
  const calls = [];
  const spawnImpl = (cmd, args, opts) => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    p.kill = (sig) => { p.killedWith = sig; setTimeout(() => p.emit('close', null, sig), 5); };
    calls.push({ cmd, args, opts, p });
    if (!hang) {
      setTimeout(() => {
        const dir = path.join(opts.env.REPORTS_DIR, 'results');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'env.json'), '{}');
        results.forEach((r, i) => fs.writeFileSync(path.join(dir, `${i}-1.json`), JSON.stringify(r)));
        fs.writeFileSync(path.join(opts.env.REPORTS_DIR, 'bug-report.html'), '<html></html>');
        p.stdout.emit('data', Buffer.from('[0-0] RUNNING in iOS\n'));
        p.emit('close', code);
      }, 10);
    }
    return p;
  };
  const events = [];
  const runner = createRunner({ store, lock, emit: (t, x) => events.push([t, x]), dataDir, spawnImpl, scriptPath: (app, f) => path.join(app.workspace, 'tests', `${f}.e2e.js`), pollMs: 5 });
  return { store, lock, runner, calls, events };
}
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); }
};
const res = (id, status, bugs = 0) => ({ title: `${id} t`, status, duration: 1200, case: { id }, bugs: Array.from({ length: bugs }, () => ({})), error: status === 'passed' ? null : 'x' });

test('3 kết quả passed / failed 2 bug / blocked → counts đúng, report, done, lock nhả', async () => {
  const { store, lock, runner, calls } = setup({ results: [res('TC_A', 'passed'), res('TC_B', 'failed', 2), res('TC_C', 'blocked')], code: 1 });
  const run = await runner.startRun({ appId: 'ikf', udid: 'U1', caseIds: ['ikf:auth:TC_C'] });
  assert.equal(run.id, 'RUN-0001');
  assert.deepEqual(run.added, ['TC_A', 'TC_B']);
  const env = calls[0].opts.env;
  assert.equal(env.RUN_CASES, 'TC_A,TC_B,TC_C');
  assert.equal(env.DEVICE_UDID, 'U1');
  assert.equal(env.ALLOW_ACCOUNT_CREATE, '1');
  assert.equal(env.REPORT_OPEN, '0');
  assert.match(env.SPECS, /tests\/auth\.e2e\.js$/);
  await until(() => store.get('runs', 'RUN-0001').status !== 'running');
  const r = store.get('runs', 'RUN-0001');
  assert.equal(r.status, 'done');
  assert.deepEqual(r.counts, { passed: 1, failed: 1, blocked: 1, skipped: 0, notrun: 0 });
  assert.equal(r.results.TC_B.bugs, 2);
  assert.equal(r.reportUrl, '/files/data/runs/RUN-0001/reports/bug-report.html');
  assert.equal(lock.current(), null);
});

test('case không có kết quả khi wdio thoát → Not Run', async () => {
  const { store, runner } = setup({ results: [res('TC_A', 'passed')] });
  await runner.startRun({ appId: 'ikf', udid: 'U', caseIds: ['ikf:auth:TC_B'] });
  await until(() => store.get('runs', 'RUN-0001').status !== 'running');
  assert.equal(store.get('runs', 'RUN-0001').results.TC_B.status, 'notrun');
  assert.equal(store.get('runs', 'RUN-0001').counts.notrun, 1);
});

test('lock đang giữ → từ chối kèm holder', async () => {
  const { runner, lock } = setup();
  lock.acquire({ kind: 'capture', id: 'c', label: 'Ghi locator · IK' });
  await assert.rejects(runner.startRun({ appId: 'ikf', udid: 'U', caseIds: ['ikf:auth:TC_A'] }), /Ghi locator · IK/);
});

test('case chưa gen → từ chối, liệt kê case', async () => {
  const { runner, lock } = setup();
  await assert.rejects(runner.startRun({ appId: 'ikf', udid: 'U', caseIds: ['ikf:auth:TC_D'] }), /TC_D: Chưa có script/);
  assert.equal(lock.current(), null);
});

test('Stop → SIGINT, status stopped', async () => {
  const { store, runner, calls } = setup({ hang: true });
  await runner.startRun({ appId: 'ikf', udid: 'U', caseIds: ['ikf:auth:TC_A'] });
  await runner.stop('RUN-0001');
  await until(() => store.get('runs', 'RUN-0001').status !== 'running');
  assert.equal(calls[0].p.killedWith, 'SIGINT');
  assert.equal(store.get('runs', 'RUN-0001').status, 'stopped');
});

test('id run tăng dần', async () => {
  const { store, runner } = setup({ results: [res('TC_A', 'passed')] });
  await runner.startRun({ appId: 'ikf', udid: 'U', caseIds: ['ikf:auth:TC_A'] });
  await until(() => store.get('runs', 'RUN-0001').status !== 'running');
  assert.equal((await runner.startRun({ appId: 'ikf', udid: 'U', caseIds: ['ikf:auth:TC_A'] })).id, 'RUN-0002');
});

test('đọc file live: bước của case đang chạy + kế hoạch bước từ Excel', async () => {
  const dataDir = tmpDir();
  const ws = tmpDir();
  fs.mkdirSync(path.join(ws, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'tests/auth.e2e.js'), '//');
  const store = createStore(dataDir);
  store.put('apps', { id: 'ikf', name: 'IK', workspace: ws, status: 'ready', env: {} });
  const rows = [{ step: 1, screen: 'Welcome', kind: 'Action', keyword: 'Tap', target: 'Continues as guest', value: '', label: '' },
    { step: 1, screen: 'Sex', kind: 'Check', keyword: 'Verify displayed', target: 'What is your sex?', value: '', label: 'Màn Sex hiện' }];
  store.put('cases', { ...mk('TC_A', 0, true, null), rows });
  let proc;
  const spawnImpl = (cmd, args, opts) => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    p.kill = () => {};
    p.env = opts.env;
    proc = p;
    return p;
  };
  const runner = createRunner({ store, lock: createLock(), emit: () => {}, dataDir, spawnImpl, scriptPath: (app, f) => path.join(app.workspace, 'tests', `${f}.e2e.js`), pollMs: 5 });
  await runner.startRun({ appId: 'ikf', udid: 'U', caseIds: ['ikf:auth:TC_A'] });
  const livePath = proc.env.LIVE_STEPS;
  assert.ok(livePath);
  fs.writeFileSync(livePath, [
    { type: 'start', tc: 'TC_A', at: 1 },
    { type: 'step', tc: 'TC_A', kind: 'Action', step: 1, keyword: 'Tap', target: 'Continues as guest', ok: true, at: 2 },
    { type: 'step', tc: 'TC_A', kind: 'Check', step: 1, keyword: 'Verify displayed', target: 'What is your sex?', label: 'Màn Sex hiện', ok: false, actual: false, expected: true, at: 3 },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n');
  await until(() => store.get('runs', 'RUN-0001').current === 'TC_A' && store.get('runs', 'RUN-0001').results.TC_A.live?.length === 2);
  const r = store.get('runs', 'RUN-0001');
  assert.deepEqual(r.results.TC_A.rows.map((x) => x.keyword), ['Tap', 'Verify displayed']);
  assert.equal(r.results.TC_A.live[1].ok, false);
  assert.equal(r.results.TC_A.live[1].actual, false);
  proc.emit('close', 0);
});

test('rerunCaseIds: chạy lại tất cả / chỉ case lỗi (Failed, Blocked, Not Run)', async () => {
  const { rerunCaseIds } = await import('../server/runs/runner.js');
  const run = { caseIds: ['a:f:TC_A', 'a:f:TC_B', 'a:f:TC_C', 'a:f:TC_D'], order: ['TC_A', 'TC_B', 'TC_C', 'TC_D'],
    results: { TC_A: { status: 'passed' }, TC_B: { status: 'failed' }, TC_C: { status: 'blocked' }, TC_D: { status: 'notrun' } } };
  assert.deepEqual(rerunCaseIds(run, false), ['a:f:TC_A', 'a:f:TC_B', 'a:f:TC_C', 'a:f:TC_D']);
  assert.deepEqual(rerunCaseIds(run, true), ['a:f:TC_B', 'a:f:TC_C', 'a:f:TC_D']);
  assert.deepEqual(rerunCaseIds({ ...run, results: { TC_A: { status: 'passed' } }, caseIds: ['a:f:TC_A'], order: ['TC_A'] }, true), []);
});

test('đang chạy: chụp màn hình simulator định kỳ → run.liveShot; dừng chụp khi run xong', async () => {
  const dataDir = tmpDir();
  const ws = tmpDir();
  fs.mkdirSync(path.join(ws, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'tests/auth.e2e.js'), '//');
  const store = createStore(dataDir);
  store.put('apps', { id: 'ikf', name: 'IK', workspace: ws, status: 'ready', env: {} });
  store.put('cases', mk('TC_A', 0, true, null));
  let proc;
  const spawnImpl = () => { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = () => {}; proc = p; return p; };
  const shots = [];
  const screenshotImpl = async (udid, file) => { shots.push(udid); fs.writeFileSync(file, 'jpg'); };
  const runner = createRunner({ store, lock: createLock(), emit: () => {}, dataDir, spawnImpl, screenshotImpl, shotMs: 5,
    scriptPath: (app, f) => path.join(app.workspace, 'tests', `${f}.e2e.js`), pollMs: 5 });
  await runner.startRun({ appId: 'ikf', udid: 'U9', caseIds: ['ikf:auth:TC_A'] });
  await until(() => shots.length >= 2 && store.get('runs', 'RUN-0001').liveShot);
  assert.equal(shots[0], 'U9');
  assert.match(store.get('runs', 'RUN-0001').liveShot, /^\/files\/data\/runs\/RUN-0001\/screen\.jpg\?t=\d+$/);
  assert.ok(fs.existsSync(path.join(dataDir, 'runs/RUN-0001/screen.jpg')));
  proc.emit('close', 0);
  await until(() => store.get('runs', 'RUN-0001').status !== 'running');
  const n = shots.length;
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(shots.length <= n + 1);
});

test('rerunCaseIds: chỉ các TC ID được chọn (bỏ qua TC không thuộc run)', async () => {
  const { rerunCaseIds } = await import('../server/runs/runner.js');
  const run = { caseIds: ['a:f:TC_A', 'a:f:TC_B', 'a:f:TC_C'], order: ['TC_A', 'TC_B', 'TC_C'],
    results: { TC_A: { status: 'passed' }, TC_B: { status: 'failed' }, TC_C: { status: 'blocked' } } };
  assert.deepEqual(rerunCaseIds(run, false, ['TC_C', 'TC_X']), ['a:f:TC_C']);
  assert.deepEqual(rerunCaseIds(run, false, ['TC_A', 'TC_C']), ['a:f:TC_A', 'a:f:TC_C']);
});

test('Tạm dừng → tạo file PAUSE_FILE, pauseRequested; khung báo paused → run.paused; Tiếp tục → xoá file; Stop cũng xoá', async () => {
  const dataDir = tmpDir();
  const ws = tmpDir();
  fs.mkdirSync(path.join(ws, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'tests/auth.e2e.js'), '//');
  const store = createStore(dataDir);
  store.put('apps', { id: 'ikf', name: 'IK', workspace: ws, status: 'ready', env: {} });
  store.put('cases', mk('TC_A', 0, true, null));
  let proc;
  const spawnImpl = (cmd, args, opts) => { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.env = opts.env; p.kill = () => setTimeout(() => p.emit('close', null), 1); proc = p; return p; };
  const runner = createRunner({ store, lock: createLock(), emit: () => {}, dataDir, spawnImpl, screenshotImpl: async () => {},
    scriptPath: (app, f) => path.join(app.workspace, 'tests', `${f}.e2e.js`), pollMs: 5 });
  await runner.startRun({ appId: 'ikf', udid: 'U', caseIds: ['ikf:auth:TC_A'] });
  const pf = proc.env.PAUSE_FILE;
  assert.ok(pf && !fs.existsSync(pf));
  await runner.pause('RUN-0001');
  assert.ok(fs.existsSync(pf));
  assert.equal(store.get('runs', 'RUN-0001').pauseRequested, true);
  fs.writeFileSync(proc.env.LIVE_STEPS, JSON.stringify({ type: 'paused', tc: null }) + '\n');
  await until(() => store.get('runs', 'RUN-0001').paused === true);
  await runner.resume('RUN-0001');
  assert.ok(!fs.existsSync(pf));
  assert.equal(store.get('runs', 'RUN-0001').pauseRequested, false);
  fs.appendFileSync(proc.env.LIVE_STEPS, JSON.stringify({ type: 'resumed', tc: null }) + '\n');
  await until(() => store.get('runs', 'RUN-0001').paused === false);
  await runner.pause('RUN-0001');
  await runner.stop('RUN-0001');
  assert.ok(!fs.existsSync(pf));
  await until(() => store.get('runs', 'RUN-0001').status === 'stopped');
});

test('đang tạm dừng: case kế tiếp hiện Queued (không phải Running), current = null', async () => {
  const dataDir = tmpDir();
  const ws = tmpDir();
  fs.mkdirSync(path.join(ws, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'tests/auth.e2e.js'), '//');
  const store = createStore(dataDir);
  store.put('apps', { id: 'ikf', name: 'IK', workspace: ws, status: 'ready', env: {} });
  store.put('cases', mk('TC_A', 0, true, null));
  store.put('cases', mk('TC_B', 1, true, null));
  let proc;
  const spawnImpl = (cmd, args, opts) => { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.env = opts.env; p.kill = () => {}; proc = p; return p; };
  const runner = createRunner({ store, lock: createLock(), emit: () => {}, dataDir, spawnImpl, screenshotImpl: async () => {},
    scriptPath: (app, f) => path.join(app.workspace, 'tests', `${f}.e2e.js`), pollMs: 5 });
  await runner.startRun({ appId: 'ikf', udid: 'U', caseIds: ['ikf:auth:TC_A', 'ikf:auth:TC_B'] });
  fs.mkdirSync(path.join(proc.env.REPORTS_DIR, 'results'), { recursive: true });
  fs.writeFileSync(path.join(proc.env.REPORTS_DIR, 'results', '1.json'), JSON.stringify({ title: 'TC_A x', status: 'passed', case: { id: 'TC_A' }, bugs: [] }));
  fs.writeFileSync(proc.env.LIVE_STEPS, [{ type: 'start', tc: 'TC_A' }, { type: 'end', tc: 'TC_A', ok: true }, { type: 'paused' }].map((x) => JSON.stringify(x)).join('\n') + '\n');
  await until(() => store.get('runs', 'RUN-0001').paused === true);
  const r = store.get('runs', 'RUN-0001');
  assert.equal(r.results.TC_B.status, 'queued');
  assert.equal(r.current, null);
  proc.emit('close', 0);
});

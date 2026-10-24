import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createLock } from '../server/lock.js';
import { createScreenMap } from '../server/locators/screenMap.js';
import { createGenerator } from '../server/scripts/generate.js';
import { planRemoval, removeCases } from '../server/testcases/remove.js';
import { createRunner } from '../server/runs/runner.js';
import { readRegions } from '../server/scripts/scriptFile.js';
import { ROOT } from '../server/paths.js';
import { tmpDir } from './helpers.js';

const BODY = (n) => `async ({ tc, data, sa, fill }) => {\n  // ${n}\n}`;
const mk = (file, tcId, order, fresh, prev, status = 'generated') => ({ id: `a:${file}:${tcId}`, appId: 'a', file, tcId, order, title: tcId, fresh, prev, pre: [], rows: [], script: { status, warnings: [] } });

async function setup() {
  const dataDir = tmpDir();
  const ws = tmpDir();
  fs.cpSync(path.join(ROOT, 'server/apps/template/src/utils'), path.join(ws, 'src/utils'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'data/testcases'), { recursive: true });
  for (const f of ['auth', 'onb']) fs.writeFileSync(path.join(ws, `data/testcases/${f}.xlsx`), 'x');
  const store = createStore(dataDir);
  store.put('apps', { id: 'a', name: 'A', workspace: ws, helperPack: null });
  for (const c of [mk('auth', 'TC_A', 0, true, null), mk('auth', 'TC_B', 1, false, 'TC_A'), mk('auth', 'TC_C', 2, true, null), mk('onb', 'TC_X', 0, true, null)]) store.put('cases', c);
  const gen = createGenerator({ store, map: createScreenMap({ store, dataDir }), emit: () => {}, runClaude: async () => ({ ok: false, error: 'x' }) });
  const app = store.get('apps', 'a');
  await gen.saveRegions(app, 'auth', { TC_A: BODY('A'), TC_B: BODY('B'), TC_C: BODY('C') });
  await gen.saveRegions(app, 'onb', { TC_X: BODY('X') });
  return { store, gen, ws, app, lock: createLock() };
}

test('planRemoval: đếm case, cảnh báo case "Tiếp nối" bị mồ côi', async () => {
  const { store } = await setup();
  const p = planRemoval(store, 'a', { caseIds: ['a:auth:TC_A'] });
  assert.equal(p.ids.length, 1);
  assert.deepEqual(p.orphans, [{ id: 'a:auth:TC_B', tcId: 'TC_B', prev: 'TC_A' }]);
  assert.equal(planRemoval(store, 'a', { file: 'auth' }).ids.length, 3);
  assert.deepEqual(planRemoval(store, 'a', { file: 'auth' }).orphans, []);
  assert.equal(planRemoval(store, 'a', { all: true }).ids.length, 4);
});

test('xoá 1 case: gỡ khỏi store và khỏi file script, region khác giữ nguyên', async () => {
  const { store, gen, ws, app, lock } = await setup();
  const r = await removeCases({ store, generator: gen, lock }, app, { caseIds: ['a:auth:TC_C'] });
  assert.equal(r.removed, 1);
  assert.equal(store.get('cases', 'a:auth:TC_C'), undefined);
  const regions = readRegions(fs.readFileSync(path.join(ws, 'tests/auth.e2e.js'), 'utf8'));
  assert.deepEqual(Object.keys(regions), ['TC_A', 'TC_B']);
  assert.match(regions.TC_A, /\/\/ A/);
});

test('xoá cả file: xoá case, bản copy Excel và file script; file khác giữ nguyên', async () => {
  const { store, gen, ws, app, lock } = await setup();
  await removeCases({ store, generator: gen, lock }, app, { file: 'auth' });
  assert.ok(!fs.existsSync(path.join(ws, 'tests/auth.e2e.js')));
  assert.ok(!fs.existsSync(path.join(ws, 'data/testcases/auth.xlsx')));
  assert.ok(fs.existsSync(path.join(ws, 'tests/onb.e2e.js')));
  assert.deepEqual(store.list('cases').map((c) => c.tcId), ['TC_X']);
});

test('xoá hết: mọi case + file của app; app khác không bị đụng', async () => {
  const { store, gen, ws, app, lock } = await setup();
  store.put('cases', { ...mk('auth', 'TC_Z', 0, true, null), id: 'b:auth:TC_Z', appId: 'b' });
  const r = await removeCases({ store, generator: gen, lock }, app, { all: true });
  assert.equal(r.removed, 4);
  assert.deepEqual(store.list('cases').map((c) => c.id), ['b:auth:TC_Z']);
  assert.deepEqual(fs.readdirSync(path.join(ws, 'tests')), []);
});

test('không xoá case đang gen hoặc khi app đang chạy run', async () => {
  const { store, gen, app, lock } = await setup();
  store.patch('cases', 'a:auth:TC_A', { script: { status: 'generating' } });
  await assert.rejects(removeCases({ store, generator: gen, lock }, app, { caseIds: ['a:auth:TC_A'] }), /đang gen/);
  store.patch('cases', 'a:auth:TC_A', { script: { status: 'generated' } });
  store.put('runs', { id: 'RUN-0001', appId: 'a', status: 'running' });
  lock.acquire({ kind: 'run', id: 'RUN-0001', label: 'Đang chạy RUN-0001' });
  await assert.rejects(removeCases({ store, generator: gen, lock }, app, { caseIds: ['a:auth:TC_C'] }), /Đang chạy RUN-0001/);
});

function runnerSetup() {
  const dataDir = tmpDir();
  const store = createStore(dataDir);
  const lock = createLock();
  const runner = createRunner({ store, lock, emit: () => {}, dataDir, spawnImpl: () => { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = () => {}; return p; }, scriptPath: () => '/x' });
  const put = (id, status, startedAt = new Date().toISOString()) => {
    store.put('runs', { id, appId: 'a', status, startedAt, caseIds: [], order: [], results: {} });
    fs.mkdirSync(path.join(dataDir, 'runs', id, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'runs', id, 'reports/bug-report.html'), 'x');
  };
  return { store, runner, dataDir, put };
}

test('xoá run: xoá dữ liệu + report; không xoá run đang chạy', async () => {
  const { store, runner, dataDir, put } = runnerSetup();
  put('RUN-0001', 'done');
  put('RUN-0002', 'running');
  const r = await runner.deleteRuns(['RUN-0001', 'RUN-0002']);
  assert.deepEqual(r, { deleted: ['RUN-0001'], skipped: [{ id: 'RUN-0002', reason: 'Đang chạy — Stop trước khi xoá' }] });
  assert.equal(store.get('runs', 'RUN-0001'), undefined);
  assert.ok(!fs.existsSync(path.join(dataDir, 'runs/RUN-0001')));
  assert.ok(store.get('runs', 'RUN-0002'));
});

test('xoá run cũ hơn N ngày', async () => {
  const { store, runner, put } = runnerSetup();
  put('RUN-0001', 'done', new Date(Date.now() - 10 * 864e5).toISOString());
  put('RUN-0002', 'done');
  const r = await runner.deleteRuns(null, { olderThanDays: 7 });
  assert.deepEqual(r.deleted, ['RUN-0001']);
  assert.ok(store.get('runs', 'RUN-0002'));
});

test('mã run không dùng lại sau khi xoá run mới nhất', async () => {
  const { store, runner, put } = runnerSetup();
  put('RUN-0024', 'done');
  await runner.deleteRuns(['RUN-0024']);
  assert.equal(runner.nextRunId(), 'RUN-0025');
  assert.equal(store.list('runs').length, 0);
});

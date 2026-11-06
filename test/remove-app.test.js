import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { removeApp } from '../server/routes/apps.js';
import { tmpDir } from './helpers.js';

function setup({ workspaceInside = true } = {}) {
  const dataDir = tmpDir();
  const workspaces = tmpDir();
  const ws = workspaceInside ? path.join(workspaces, 'a') : tmpDir();
  fs.mkdirSync(path.join(ws, 'build/Fit.app'), { recursive: true });
  const store = createStore(dataDir);
  store.put('apps', { id: 'a', name: 'A', workspace: ws, status: 'ready' });
  store.put('apps', { id: 'b', name: 'B', workspace: path.join(workspaces, 'b'), status: 'ready' });
  store.put('runs', { id: 'R1', appId: 'a' });
  store.put('runs', { id: 'R2', appId: 'b' });
  store.put('captures', { id: 'cap-1', appId: 'a' });
  store.put('screens', { id: 's1', appId: 'a' });
  store.put('screens', { id: 's2', appId: 'b' });
  store.put('cases', { id: 'a:f:TC1', appId: 'a' });
  store.put('cases', { id: 'b:f:TC1', appId: 'b' });
  for (const f of ['captures/cap-1.png', 'screens/a/s1.png', 'screens/b/s2.png']) {
    fs.mkdirSync(path.dirname(path.join(dataDir, f)), { recursive: true });
    fs.writeFileSync(path.join(dataDir, f), 'x');
  }
  const deletedRuns = [];
  const runner = { deleteRuns: async (ids) => { for (const id of ids) store.remove('runs', id); deletedRuns.push(...ids); return { deleted: ids, skipped: [] }; } };
  const events = [];
  const ctx = { store, emit: (...e) => events.push(e), lock: { current: () => null }, runner, tryLive: { closeAll: async () => {} }, map: { dataDir } };
  return { ctx, store, dataDir, workspaces, ws, deletedRuns, events };
}

test('removeApp: xoá app + run, capture, màn, case, workspace — app khác giữ nguyên', async () => {
  const t = setup();
  const r = await removeApp(t.ctx, t.store.get('apps', 'a'), { workspaces: t.workspaces });
  assert.deepEqual(r, { runs: 1, screens: 1, cases: 1 });
  assert.deepEqual(t.deletedRuns, ['R1']);
  assert.deepEqual(t.store.list('apps').map((a) => a.id), ['b']);
  assert.deepEqual(t.store.list('runs').map((x) => x.id), ['R2']);
  assert.deepEqual(t.store.list('screens').map((x) => x.id), ['s2']);
  assert.deepEqual(t.store.list('cases').map((x) => x.id), ['b:f:TC1']);
  assert.deepEqual(t.store.list('captures'), []);
  assert.equal(fs.existsSync(t.ws), false);
  assert.equal(fs.existsSync(path.join(t.dataDir, 'screens/a')), false);
  assert.equal(fs.existsSync(path.join(t.dataDir, 'captures/cap-1.png')), false);
  assert.equal(fs.existsSync(path.join(t.dataDir, 'screens/b/s2.png')), true);
  assert.deepEqual(t.events, [['app', { id: 'a' }]]);
});

test('removeApp: workspace nằm ngoài thư mục workspaces thì không đụng tới', async () => {
  const t = setup({ workspaceInside: false });
  await removeApp(t.ctx, t.store.get('apps', 'a'), { workspaces: t.workspaces });
  assert.equal(fs.existsSync(t.ws), true);
  assert.equal(t.store.get('apps', 'a'), undefined);
});

test('removeApp: thiết bị đang bận hoặc app đang chuẩn bị → 409, không xoá gì', async () => {
  const t = setup();
  t.ctx.lock.current = () => ({ label: 'Run R9' });
  await assert.rejects(removeApp(t.ctx, t.store.get('apps', 'a'), { workspaces: t.workspaces }), (e) => e.status === 409 && /Run R9/.test(e.message));
  t.ctx.lock.current = () => null;
  t.store.patch('apps', 'a', { status: 'preparing' });
  await assert.rejects(removeApp(t.ctx, t.store.get('apps', 'a'), { workspaces: t.workspaces }), (e) => e.status === 409);
  assert.ok(t.store.get('apps', 'a'));
  assert.equal(t.store.list('runs').length, 2);
  assert.equal(fs.existsSync(t.ws), true);
});

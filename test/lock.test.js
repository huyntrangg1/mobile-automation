import test from 'node:test';
import assert from 'node:assert/strict';
import { createLock } from '../server/lock.js';
import { createStore } from '../server/store.js';
import { tmpDir } from './helpers.js';

test('acquire lần 2 khi đang giữ bị từ chối kèm holder', () => {
  const lock = createLock();
  assert.deepEqual(lock.acquire({ kind: 'run', id: 'RUN-0001', label: 'Run RUN-0001' }), { ok: true });
  const r = lock.acquire({ kind: 'capture', id: 'c1', label: 'Lấy locator' });
  assert.equal(r.ok, false);
  assert.equal(r.holder.label, 'Run RUN-0001');
});

test('release rồi acquire lại được', () => {
  const lock = createLock();
  lock.acquire({ kind: 'run', id: 'r1', label: 'x' });
  lock.release('r1');
  assert.equal(lock.acquire({ kind: 'run', id: 'r2', label: 'y' }).ok, true);
});

test('release id khác không nhả lock', () => {
  const lock = createLock();
  lock.acquire({ kind: 'run', id: 'r1', label: 'x' });
  lock.release('other');
  assert.equal(lock.current().id, 'r1');
});

test('recover đổi job running thành interrupted và lock trống', () => {
  const s = createStore(tmpDir());
  s.put('runs', { id: 'RUN-0001', status: 'running' });
  s.put('runs', { id: 'RUN-0002', status: 'done' });
  s.put('captures', { id: 'c1', status: 'running' });
  const lock = createLock();
  lock.recover(s);
  assert.equal(s.get('runs', 'RUN-0001').status, 'interrupted');
  assert.equal(s.get('runs', 'RUN-0002').status, 'done');
  assert.equal(s.get('captures', 'c1').status, 'interrupted');
  assert.equal(lock.current(), null);
});

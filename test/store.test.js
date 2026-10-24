import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.js';
import { tmpDir } from './helpers.js';

test('put rồi get trả đúng object', () => {
  const s = createStore(tmpDir());
  s.put('apps', { id: 'a1', name: 'IK' });
  assert.deepEqual(s.get('apps', 'a1'), { id: 'a1', name: 'IK' });
});

test('patch gộp field', () => {
  const s = createStore(tmpDir());
  s.put('apps', { id: 'a1', name: 'IK', env: {} });
  s.patch('apps', 'a1', { status: 'ready' });
  assert.deepEqual(s.get('apps', 'a1'), { id: 'a1', name: 'IK', env: {}, status: 'ready' });
});

test('store mới trên cùng thư mục đọc lại dữ liệu', () => {
  const dir = tmpDir();
  createStore(dir).put('runs', { id: 'RUN-0001' });
  assert.equal(createStore(dir).get('runs', 'RUN-0001').id, 'RUN-0001');
});

test('list collection chưa có trả []', () => {
  assert.deepEqual(createStore(tmpDir()).list('nothing'), []);
});

test('remove xoá phần tử', () => {
  const s = createStore(tmpDir());
  s.put('apps', { id: 'a1' });
  s.remove('apps', 'a1');
  assert.equal(s.get('apps', 'a1'), undefined);
});

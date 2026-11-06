import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir } from './helpers.js';

// navgraph.js import ui.js (cần driver của wdio) → chỉ import lúc test, driver không dùng tới trong recordEdge / findPath
const load = async () => import('../server/apps/template/src/runner/navgraph.js');
const edge = (from, to, extra = {}) => ({ from, to, sel: `~${from}-${to}`, target: `Go ${to}`, arrive: { sel: `~${to}`, what: `tiêu đề "${to}"` }, ...extra });

test('ghi cạnh rồi tìm đường ngắn nhất; cùng màn → []; không có đường → null', async () => {
  const { recordEdge, findPath } = await load();
  const cwd = tmpDir();
  process.env.BUILD_STAMP = 'b1';
  recordEdge(edge('Welcome', 'Goals'), { cwd });
  recordEdge(edge('Goals', 'Cooking time'), { cwd });
  recordEdge(edge('Welcome', 'Cooking time'), { cwd }); // đường tắt
  assert.deepEqual(findPath('Welcome', 'Cooking time', { cwd }).map((e) => e.to), ['Cooking time']);
  assert.deepEqual(findPath('Welcome', 'Welcome', { cwd }), []);
  assert.equal(findPath('Cooking time', 'Welcome', { cwd }), null);
});

test('đổi build → cạnh cũ không dùng; cạnh có nhập chữ / toạ độ không dùng', async () => {
  const { recordEdge, findPath } = await load();
  const cwd = tmpDir();
  process.env.BUILD_STAMP = 'b1';
  recordEdge(edge('A', 'B'), { cwd });
  recordEdge(edge('B', 'C', { needsInput: true }), { cwd });
  recordEdge({ ...edge('C', 'D'), sel: 'point:0.5,0.5' }, { cwd });
  assert.equal(findPath('A', 'C', { cwd }), null); // B→C cần dữ liệu nhập
  assert.equal(findPath('C', 'D', { cwd }), null); // toạ độ không ghi
  process.env.BUILD_STAMP = 'b2';
  assert.equal(findPath('A', 'B', { cwd }), null); // build mới
  recordEdge(edge('A', 'B'), { cwd });
  assert.equal(findPath('A', 'B', { cwd }).length, 1);
  delete process.env.BUILD_STAMP;
});

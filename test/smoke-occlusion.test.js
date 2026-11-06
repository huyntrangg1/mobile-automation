import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readExport } from '../server/locators/figmaFrames.js';
import { pruneOccluded } from '../server/smoke/occlusion.js';
import { loadFigmaExport, summarizeFrames } from '../server/smoke/figmaExport.js';
import { tmpDir } from './helpers.js';

const box = (x, y, width, height) => ({ x, y, width, height });
const N = (type, name, b, extra = {}, children) => ({ id: `${name}`, type, name, visible: true, opacity: 1, absoluteBoundingBox: b, ...extra, ...(children ? { children } : {}) });
const solid = (r = 1, g = 1, b = 1, opacity = 1) => ({ type: 'SOLID', visible: true, opacity, color: { r, g, b, a: 1 } });
const text = (chars, b) => N('TEXT', chars, b, { characters: chars, fills: [solid(0, 0, 0)] });
const names = (n, out = []) => { if (n.type === 'TEXT') out.push(n.characters); (n.children || []).forEach((c) => names(c, out)); return out; };

// Giống frame "Blood Sugar - Log": màn nền cao hơn frame, lớp phủ tối nửa trong suốt, modal nền trắng đặc che phần dưới
const screen = () => N('FRAME', 'Blood Sugar - Log', box(0, 0, 375, 812), { fills: [solid()] }, [
  N('FRAME', 'Background screen', box(0, 0, 375, 1715), { fills: [solid()] }, [
    text('Action', box(16, 50, 100, 24)),
    text('Sleep', box(24, 410, 54, 28)), // nằm dưới modal
    text('TooFar', box(24, 1000, 80, 20)), // ngoài khung 812
  ]),
  N('RECTANGLE', 'Overlay', box(0, 0, 375, 812), { opacity: 0.5, fills: [solid(0.1, 0.1, 0.1)] }),
  N('FRAME', 'Modal', box(0, 120, 375, 692), { fills: [solid()] }, [text('Blood Sugar', box(20, 140, 200, 24)), text('Save', box(20, 700, 80, 24))]),
]);

test('pruneOccluded: bỏ chữ nằm dưới layer đặc phía trên (modal) và chữ ngoài khung; giữ chữ còn nhìn thấy', () => {
  const { node, removed } = pruneOccluded(screen());
  assert.deepEqual(names(node), ['Action', 'Blood Sugar', 'Save']);
  assert.ok(removed.occluded >= 1);
  assert.ok(removed.clipped >= 1);
});

test('pruneOccluded: lớp phủ nửa trong suốt (opacity < 1) KHÔNG che; layer ẩn hoặc fill trong suốt cũng không che', () => {
  const mk = (cover) => N('FRAME', 'Root', box(0, 0, 375, 812), {}, [text('Hello', box(10, 10, 60, 20)), cover]);
  for (const cover of [
    N('RECTANGLE', 'Dim', box(0, 0, 375, 812), { opacity: 0.5, fills: [solid()] }),
    N('RECTANGLE', 'HiddenCover', box(0, 0, 375, 812), { visible: false, fills: [solid()] }),
    N('RECTANGLE', 'Faint', box(0, 0, 375, 812), { fills: [solid(1, 1, 1, 0.4)] }),
    N('RECTANGLE', 'NoFill', box(0, 0, 375, 812), { fills: [] }),
  ]) assert.deepEqual(names(pruneOccluded(mk(cover)).node), ['Hello'], cover.name);
});

test('pruneOccluded: nền của chính container không che con của nó; layer đặc nằm DƯỚI (vẽ trước) không che', () => {
  const card = N('FRAME', 'Card', box(0, 0, 200, 100), { fills: [solid()] }, [text('Inside', box(10, 10, 60, 20))]);
  assert.deepEqual(names(pruneOccluded(N('FRAME', 'Root', box(0, 0, 375, 812), {}, [card])).node), ['Inside']);
  const below = N('FRAME', 'Root', box(0, 0, 375, 812), {}, [N('RECTANGLE', 'Bg', box(0, 0, 375, 812), { fills: [solid()] }), text('Above', box(10, 10, 60, 20))]);
  assert.deepEqual(names(pruneOccluded(below).node), ['Above']);
});

test('pruneOccluded: chỉ bỏ khi layer đặc BAO TRỌN hộp chữ (che một phần thì giữ); cha mờ thì con không phải là lớp che', () => {
  const partial = N('FRAME', 'Root', box(0, 0, 375, 812), {}, [text('Half', box(100, 100, 100, 20)), N('RECTANGLE', 'Cover', box(150, 90, 200, 50), { fills: [solid()] })]);
  assert.deepEqual(names(pruneOccluded(partial).node), ['Half']);
  const fadedParent = N('FRAME', 'Root', box(0, 0, 375, 812), {}, [text('Hi', box(10, 10, 60, 20)), N('FRAME', 'Faded', box(0, 0, 375, 812), { opacity: 0.5 }, [N('RECTANGLE', 'Cover', box(0, 0, 375, 812), { fills: [solid()] })])]);
  assert.deepEqual(names(pruneOccluded(fadedParent).node), ['Hi']);
});

test('pruneOccluded: layer ẩn (visible:false) và con của layer ẩn (hiddenByAncestor) bị bỏ; không sửa cây gốc; root luôn còn', () => {
  const root = N('FRAME', 'Root', box(0, 0, 375, 812), {}, [
    N('FRAME', 'Hidden', box(0, 0, 100, 100), { visible: false }, [N('TEXT', 'Ghost', box(5, 5, 40, 20), { characters: 'Ghost', hiddenByAncestor: true })]),
    text('Shown', box(10, 200, 60, 20)),
  ]);
  const before = JSON.stringify(root);
  const { node, removed } = pruneOccluded(root);
  assert.deepEqual(names(node), ['Shown']);
  assert.ok(removed.hidden >= 1);
  assert.equal(JSON.stringify(root), before);
  assert.equal(node.name, 'Root');
});

test('pruneOccluded: node không có hộp (absoluteBoundingBox null) hoặc cây rỗng không gây lỗi', () => {
  const root = N('FRAME', 'Root', box(0, 0, 100, 100), {}, [N('FRAME', 'NoBox', null, {}, [text('x', box(1, 1, 5, 5))]), { id: 'z', type: 'TEXT', name: 'z', characters: 'z', visible: true }]);
  assert.doesNotThrow(() => pruneOccluded(root));
  assert.doesNotThrow(() => pruneOccluded(N('FRAME', 'Empty', box(0, 0, 10, 10))));
});

test('loadFigmaExport: chữ bị che không còn trong tóm tắt cho AI và trong file json dùng để so; có đếm số layer đã bỏ', () => {
  const s = screen();
  const exp = readExport(JSON.stringify({ tool: 'qa-pipeline-figma-export', version: 3, file: 'F', page: 'P', frames: [{ id: '1:1', name: 'Blood Sugar - Log', width: 375, height: 812, scale: 1, png: Buffer.from('x').toString('base64'), node: s }] }));
  const { frames } = loadFigmaExport({ data: exp, dir: tmpDir() });
  assert.deepEqual(frames[0].texts, ['Action', 'Blood Sugar', 'Save']);
  assert.ok(frames[0].hidden >= 2);
  assert.doesNotMatch(summarizeFrames(frames), /Sleep|TooFar/);
  const saved = JSON.parse(fs.readFileSync(frames[0].json, 'utf8'));
  assert.deepEqual(names(saved.node), ['Action', 'Blood Sugar', 'Save']);
});

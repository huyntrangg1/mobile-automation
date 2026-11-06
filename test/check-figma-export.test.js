import test from 'node:test';
import assert from 'node:assert/strict';
import { checkExport } from '../scripts/check-figma-export.js';

const frame = (node) => ({ id: '1:1', name: 'F', node: { id: '1:1', name: 'F', type: 'FRAME', visible: true, absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 }, ...node } });
const data = (nodes, version = 3) => ({ tool: 'qa-pipeline-figma-export', version, frames: nodes.map((n) => frame(n)) });
const row = (rows, key) => rows.find((r) => r.key === key);

test('checkExport: gradient / shadow nằm trong fill / effect (không phải node) → tìm đúng chỗ, báo ok', () => {
  const rows = checkExport(data([{ fills: [{ type: 'GRADIENT_LINEAR', gradientStops: [{ position: 0, color: { r: 1, g: 1, b: 1, a: 1 } }, { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } }], gradientTransform: [[1, 0, 0], [0, 1, 0]] }], effects: [{ type: 'DROP_SHADOW', radius: 4, offset: { x: 0, y: 2 }, color: { r: 0, g: 0, b: 0, a: 0.2 }, spread: -1 }] }]));
  assert.equal(row(rows, 'gradient').status, 'ok');
  assert.equal(row(rows, 'spread').status, 'ok');
});

test('checkExport: không có trong design → "none" (bình thường), không phải lỗi', () => {
  const rows = checkExport(data([{}]));
  for (const k of ['gradient', 'spread', 'styleSegments', 'variables', 'styles', 'components', 'reactions']) assert.equal(row(rows, k).status, 'none', k);
});

test('checkExport: có trong design nhưng thiếu trong file → "bad" (lỗi thật)', () => {
  const rows = checkExport(data([{ fills: [{ type: 'GRADIENT_LINEAR' }], effects: [{ type: 'INNER_SHADOW', radius: 2, offset: { x: 0, y: 0 }, color: null }], layoutMode: 'VERTICAL',
    children: [{ id: '2:1', name: 'T', type: 'TEXT', characters: 'x', visible: true, style: { fontSize: 12 } }] }]));
  assert.equal(row(rows, 'gradient').status, 'bad');
  assert.equal(row(rows, 'spread').status, 'bad');
  assert.equal(row(rows, 'autolayout').status, 'bad'); // có layoutMode nhưng không có itemSpacing / padding
  assert.equal(row(rows, 'lineheight').status, 'bad'); // có chữ nhưng không có line-height
});

test('checkExport: styleSegments, biến, style, component, ẩn, prototype đều nhận ra khi có', () => {
  const rows = checkExport(data([{
    layoutMode: 'VERTICAL', itemSpacing: 8, paddingLeft: 4, boundVariables: { fills: ['V:1'] }, fillStyleId: 'S:1', reactions: [{ destinationId: '9:9', transition: null }],
    refs: { variables: { 'V:1': { name: 'c', collection: 'C', type: 'COLOR', valuesByMode: {} } }, styles: { 'S:1': { name: 's', type: 'PAINT' } }, components: { 'C:1': { name: 'B' } } },
    children: [
      { id: '2:1', name: 'T', type: 'TEXT', characters: 'ab', visible: true, style: { fontSize: 12, lineHeightUnit: 'PIXELS', lineHeightPx: 16, letterSpacing: 0 }, styleSegments: [{ start: 0, end: 1 }, { start: 1, end: 2 }] },
      { id: '2:2', name: 'I', type: 'INSTANCE', visible: true, componentId: 'C:1', overrides: [{ id: '3:1', overriddenFields: ['fills'] }], children: [] },
      { id: '2:3', name: 'H', type: 'FRAME', visible: false, children: [{ id: '2:4', name: 'K', type: 'FRAME', visible: true, hiddenByAncestor: true }] },
    ],
  }]));
  for (const k of ['autolayout', 'lineheight', 'styleSegments', 'variables', 'styles', 'components', 'hidden', 'reactions']) assert.equal(row(rows, k).status, 'ok', k);
});

test('checkExport: tham chiếu refs bị null (tra cứu lỗi) → bad; file chỉ có 1 frame và version cũ được báo', () => {
  const rows = checkExport(data([{ boundVariables: { fills: ['V:1'] }, refs: { variables: { 'V:1': null } } }], 2));
  assert.equal(row(rows, 'variables').status, 'bad');
  assert.equal(row(rows, 'version').status, 'bad');
  assert.equal(row(rows, 'frames').status, 'warn'); // 1 frame
  assert.equal(row(checkExport(data([{}, {}])), 'frames').status, 'ok');
});

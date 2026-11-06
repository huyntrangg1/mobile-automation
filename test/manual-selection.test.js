import test from 'node:test';
import assert from 'node:assert/strict';
import { splitByMode, moveCase, summary } from '../web/src/manualSelection.js';

const c = (sheet, id, mode, extra = {}) => ({ sheet, id, mode, by: 'rule', reason: '', state: 'converted', ambiguity: [], ...extra });

test('splitByMode tách hai danh sách, giữ thứ tự', () => {
  const r = splitByMode([c('S', 'A', 'automate'), c('S', 'B', 'manual'), c('S', 'C', 'automate')]);
  assert.deepEqual(r.automate.map((x) => x.id), ['A', 'C']);
  assert.deepEqual(r.manual.map((x) => x.id), ['B']);
});

test('moveCase đổi đúng (sheet, id), đánh by=user và pending, không đổi mảng gốc; cùng id ở sheet khác không bị đụng', () => {
  const src = [c('Sex', 'TC_1', 'automate'), c('Age', 'TC_1', 'automate')];
  const out = moveCase(src, { sheet: 'Age', id: 'TC_1' }, 'manual');
  assert.equal(out[1].mode, 'manual');
  assert.equal(out[1].by, 'user');
  assert.equal(out[1].state, 'pending');
  assert.equal(out[0].mode, 'automate');
  assert.equal(src[1].mode, 'automate');
});

test('moveCase sang cùng mode → không đổi state; case đang xung đột giữ conflict', () => {
  assert.equal(moveCase([c('S', 'A', 'automate')], { sheet: 'S', id: 'A' }, 'automate')[0].state, 'converted');
  assert.equal(moveCase([c('S', 'A', 'automate', { state: 'conflict' })], { sheet: 'S', id: 'A' }, 'manual')[0].state, 'conflict');
});

test('summary đếm automate / manual / có điểm mờ / review / xung đột (chỉ tính case automate cho điểm mờ)', () => {
  const mi = { cases: [c('S', 'A', 'automate', { ambiguity: [{ code: 'EMPTY_PRE' }] }), c('S', 'B', 'manual', { ambiguity: [{ code: 'EMPTY_PRE' }] }), c('S', 'C', 'automate', { state: 'conflict' })], review: ['x', 'y'] };
  assert.deepEqual(summary(mi), { automate: 2, manual: 1, ambiguous: 1, review: 2, conflicts: 1 });
});

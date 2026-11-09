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

import { groupReview, cleanProblems } from '../web/src/manualSelection.js';

test('groupReview: gom theo nhãn đầu dòng, bỏ nhãn khỏi nội dung, dòng không nhãn vào "Khác"', () => {
  const g = groupReview(['[Manual] A: x', '[Quy tắc] y', '[Manual] B: z', 'lạ']);
  assert.deepEqual(g.map((x) => [x.label, x.items.length]), [['Manual', 2], ['Quy tắc', 1], ['Khác', 1]]);
  assert.equal(g[0].items[0], 'A: x');
  assert.deepEqual(groupReview([]), []);
});

test('cleanProblems: bỏ tiền tố "Sheet X:", tách ý lặp "Khung:", bỏ trùng', () => {
  const out = cleanProblems(['Sheet Onboarding v1.0.4: Khung: Luồng "A" step 1: sai; Khung: Luồng "A" step 2: thiếu; Khung: Luồng "A" step 1: sai']);
  assert.deepEqual(out, ['Khung: Luồng "A" step 1: sai', 'Khung: Luồng "A" step 2: thiếu']);
});

test('groupReview: dòng "[Chạy thử]" gom dưới nhóm "Chạy thử trên thiết bị"', () => {
  const g = groupReview(['[Chạy thử] Luồng "A → B": bỏ bước 2 "Tap Continue" (app tự chuyển sang màn "B")', '[App] x']);
  assert.deepEqual(g.map((x) => x.label), ['Chạy thử trên thiết bị', 'App']);
  assert.match(g[0].items[0], /^Luồng "A → B"/);
});

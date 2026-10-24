import test from 'node:test';
import assert from 'node:assert/strict';
import { stepStates } from '../web/src/components/stepStates.js';

const rows = [
  { step: 1, kind: 'Action', keyword: 'Tap', target: 'Continues as guest' },
  { step: 1, kind: 'Nav', keyword: 'Verify screen', target: 'What is your sex?' },
  { step: 1, kind: 'Check', keyword: 'Verify displayed', target: 'What is your sex?' },
  { step: 1, kind: 'Check', keyword: 'Verify not displayed', target: 'Log In' },
];

test('đang chạy: bước đã log ✓, bước kế tiếp ●, còn lại ○', () => {
  const s = stepStates(rows, [{ kind: 'Action', keyword: 'Tap', target: 'Continues as guest', ok: true }], { running: true });
  assert.deepEqual(s.map((x) => x.state), ['done', 'run', 'todo', 'todo']);
});

test('Nav không được log nhưng bước sau đã chạy → Nav coi như đã qua', () => {
  const s = stepStates(rows, [
    { kind: 'Action', keyword: 'Tap', target: 'Continues as guest', ok: true },
    { kind: 'Check', keyword: 'Verify displayed', target: 'What is your sex?', ok: true },
  ], { running: true });
  assert.deepEqual(s.map((x) => x.state), ['done', 'done', 'done', 'run']);
  assert.equal(s[1].implicit, true);
});

test('điểm kiểm lệch → fail kèm sự kiện (actual / expected)', () => {
  const s = stepStates(rows, [{ kind: 'Check', keyword: 'Verify not displayed', target: 'Log In', ok: false, actual: true, expected: false }], { running: false });
  assert.equal(s[3].state, 'fail');
  assert.equal(s[3].ev.actual, true);
});

test('case Blocked đã dừng → bước kế tiếp là chỗ dừng (⊘)', () => {
  const s = stepStates(rows, [{ kind: 'Action', keyword: 'Tap', target: 'Continues as guest', ok: true }], { running: false, failed: true });
  assert.deepEqual(s.map((x) => x.state), ['done', 'stop', 'todo', 'todo']);
});

test('target trong log đã điền giá trị (${gen.email(...)} → email thật) vẫn khớp nhờ so khớp chứa', () => {
  const r = [{ kind: 'Action', keyword: 'Enter', target: 'Email' }];
  assert.equal(stepStates(r, [{ kind: 'Action', keyword: 'Enter', target: 'Email', ok: true }], { running: true })[0].state, 'done');
});

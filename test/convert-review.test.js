import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTargets, buildReview } from '../server/testcases/convert/review.js';

const table = { Welcome: [{ key: 'Get Started', type: 'XCUIElementTypeButton', locator: '~Get Started' }, { key: 'Terms of Service', type: 'XCUIElementTypeLink', locator: '~Terms' }] };
const tcOf = (rows) => [{ id: 'TC_A', fresh: true, pre: [], rows }];
const row = (screen, target, extra = {}) => ({ step: 1, screen, kind: 'Action', keyword: 'Tap', target, ...extra });

test('target có trong Locator map → không cảnh báo; không có → 1 cảnh báo nêu TC, step, target, màn', () => {
  assert.deepEqual(checkTargets(tcOf([row('Welcome', 'Get Started')]), table), []);
  const w = checkTargets(tcOf([row('Welcome', 'Continue', { step: 3 })]), table);
  assert.deepEqual(w, ['TC_A step 3: "Continue" chưa có trong Locator map màn Welcome']);
});

test('so khớp không phân biệt hoa thường và khoảng trắng thừa; tên màn khớp lỏng ("Welcome Screen" ~ Welcome)', () => {
  assert.deepEqual(checkTargets(tcOf([row('Welcome Screen', '  get   started ')]), table), []);
});

test('màn chưa có trong map → cảnh báo một lần cho màn đó (không lặp theo từng target); map rỗng → không cảnh báo', () => {
  const rows = [row('Login', 'Email'), row('Login', 'Password', { step: 2 })];
  assert.deepEqual(checkTargets(tcOf(rows), table), ['Màn "Login" chưa có trong Locator map (TC_A step 1: "Email")']);
  assert.deepEqual(checkTargets(tcOf(rows), {}), []);
});

test('bỏ qua dòng không có Target và Run flow', () => {
  const rows = [{ step: 0, screen: '', kind: 'Action', keyword: 'Run flow', value: 'Welcome → Login' }, { step: 1, screen: 'Welcome', kind: 'Action', keyword: 'Launch fresh' }];
  assert.deepEqual(checkTargets(tcOf(rows), table), []);
});

test('buildReview: gộp ba nguồn, gắn nhãn nguồn, bỏ trùng, thứ tự Manual → Quy tắc → Locator map', () => {
  const r = buildReview({
    writeReview: ['TC_A: contains "Hi"', 'TC_A: contains "Hi"'],
    targets: ['TC_A step 3: "Continue" chưa có trong Locator map màn Welcome'],
    ambiguity: { TC_B: [{ code: 'EMPTY_PRE', text: 'Pre-condition trống' }] },
  });
  assert.deepEqual(r, ['[Manual] TC_B: Pre-condition trống', '[Quy tắc] TC_A: contains "Hi"', '[Locator map] TC_A step 3: "Continue" chưa có trong Locator map màn Welcome']);
});

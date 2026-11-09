import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSpec, appContext } from '../server/testcases/convert/appCheck.js';
const ctx = appContext({ locatorTable: { S: [{ key: 'Which age group are you in?' }, { key: 'Weekly' }, { key: 'Yearly' }, { key: 'Allow' }] } });

// Lần chuyển đổi có locator map: AI thay chữ của tài liệu bằng chữ đang có trên app (vd "How old are you?" → "Which age group are you in?")
// → app sai tài liệu vẫn Passed. Check phải theo tài liệu; lệch thì báo cho người dùng chọn.
const src = { steps: '1. Tap Allow\n2. Chờ', expected: '1. Hiển thị dialog xin quyền\n2. Dialog đóng, chuyển sang màn "How old are you?"\n3. Gói "[giá] — 7 Days Trial" được chọn, "FREE — 3 Days Trial" bỏ chọn' };
const chk = (step, keyword, target, value = '') => ({ step, screen: 'S', kind: 'Check', keyword, target, value, label: 'x' });

test('checkSpec: chữ app khác hẳn chữ tài liệu → KHÔNG tự đổi (có thể là Check khác), báo AI + ghi lệch; người dùng chọn "theo tài liệu" → đổi', () => {
  const rows = [chk(2, 'Verify text', 'Which age group are you in?', 'Which age group are you in?')];
  const r = checkSpec({ tc: 'TC_NOTI_002', rows, src, ctx });
  assert.equal(r.rows[0].value, 'Which age group are you in?');
  assert.deepEqual(r.diffs, [{ step: 2, manual: 'How old are you?', app: 'Which age group are you in?', fixed: false }]);
  assert.equal(r.problems.length, 1);
  const u = checkSpec({ tc: 'TC_NOTI_002', rows, src, ctx, enforce: [{ step: 2, manual: 'How old are you?', app: 'Which age group are you in?' }] });
  assert.equal(u.rows[0].value, 'How old are you?');
  assert.equal(u.rows[0].target, 'How old are you?');
  assert.equal(u.diffs[0].byUser, true);
});

test('checkSpec: biến thể gần giống (Cookbooks, cards & … ↔ Cookbooks & …) → tự đổi về chữ tài liệu', () => {
  const s2 = { expected: '1. "Cookbooks & handwritten notes" được chọn' };
  const c2 = appContext({ locatorTable: { S: [{ key: 'Cookbooks, cards & handwritten notes' }] } });
  const r = checkSpec({ tc: 'TC_SRC_003', rows: [chk(1, 'Verify selected', 'Cookbooks, cards & handwritten notes')], src: s2, ctx: c2 });
  assert.equal(r.rows[0].target, 'Cookbooks & handwritten notes');
  assert.equal(r.diffs[0].fixed, true);
});

test('checkSpec: bước có nhiều chuỗi / chuỗi có chỗ trống [giá] → không tự đổi được, báo lại AI (problems) và ghi lệch chưa sửa', () => {
  const r = checkSpec({ tc: 'TC_PAY_003', rows: [chk(3, 'Verify selected', 'Weekly')], src, ctx });
  assert.equal(r.rows[0].target, 'Weekly');
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /TC_PAY_003 step 3: .*"Weekly"/);
  assert.equal(r.diffs[0].fixed, false);
});

test('checkSpec: khớp tài liệu (kể cả cắt bớt / bỏ chỗ trống) hoặc chữ có ở chỗ khác của case → không báo; người dùng đã chọn "theo app" → giữ chữ app', () => {
  const ok = checkSpec({ tc: 'T', rows: [chk(2, 'Verify text', 'How old are you?', 'How old are you?'), chk(3, 'Verify selected', '7 Days Trial'), chk(3, 'Verify not selected', 'FREE — 3 Days Trial'), chk(1, 'Verify displayed', 'Allow')], src, ctx });
  assert.deepEqual(ok.diffs, []);
  const keep = checkSpec({ tc: 'T', rows: [chk(2, 'Verify text', 'Which age group are you in?', 'Which age group are you in?')], src, ctx, allow: [{ step: 2, manual: 'How old are you?' }] });
  assert.equal(keep.rows[0].value, 'Which age group are you in?');
  assert.deepEqual(keep.diffs, []);
});

import { checkCoverage } from '../server/testcases/convert/appCheck.js';
// Độ bám: mỗi dòng Expected (trừ phần thiết kế hình ảnh) phải có Check bám vào; chữ trong ngoặc kép phải được kiểm
test('checkCoverage: bước Expected có chữ trong ngoặc kép mà không Check nào kiểm chữ đó → báo; bước không có Check nào → báo; "Đúng design" bỏ qua', () => {
  const s = { expected: '1. Hiển thị "Good news 🎉"\n2. Hiển thị tutorial "Snap & save any recipe" — "Step 1 of 3"\n3. Đúng design: icon minh hoạ\n4. Không chuyển màn' };
  const rows = [chk(1, 'Verify text', 'Good news 🎉', 'Good news 🎉'), chk(2, 'Verify text', 'Snap & save any recipe', 'Snap & save any recipe')];
  const p = checkCoverage({ tc: 'TC_S', rows, src: s });
  assert.equal(p.length, 2);
  assert.match(p[0], /TC_S step 2: .*"Step 1 of 3"/);
  assert.match(p[1], /TC_S step 4: .*không có Check/);
});

test('checkCoverage: contains → equals khi Value trùng nguyên chuỗi trong tài liệu (chặt hơn); chữ giả định không có trong tài liệu giữ contains', async () => {
  const { tighten } = await import('../server/testcases/convert/appCheck.js');
  const s = { expected: '1. Hiển thị "Tastory works seamlessly with website"' };
  const out = tighten({ rows: [{ ...chk(1, 'Verify text', 'T', 'Tastory works seamlessly with website'), compare: 'contains' }, { ...chk(1, 'Verify text', 'X', 'Step 2'), compare: 'contains' }], src: s });
  assert.equal(out[0].compare, 'equals');
  assert.equal(out[1].compare, 'contains');
});

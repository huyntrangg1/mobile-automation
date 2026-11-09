import test from 'node:test';
import assert from 'node:assert/strict';
import { findAmbiguity } from '../server/testcases/convert/ambiguity.js';

const ok = { id: 'TC_1', pre: 'Đã cài app', steps: '1. Mở app', expected: 'Hiển thị tiêu đề "What is your sex?"' };
const codes = (c) => findAmbiguity({ ...ok, ...c }).map((a) => a.code);

test('case rõ ràng → không có điểm mờ', () => assert.deepEqual(codes({}), []));
test('Expected không có chữ trong ngoặc kép → NO_QUOTED_EXPECTED', () => assert.deepEqual(codes({ expected: 'Hiển thị màn giới tính' }), ['NO_QUOTED_EXPECTED']));
test('ngoặc kép cong “…” cũng tính là có chữ', () => assert.deepEqual(codes({ expected: 'Hiển thị “Welcome back”' }), []));
test('Pre-condition trống → EMPTY_PRE', () => assert.deepEqual(codes({ pre: '  ' }), ['EMPTY_PRE']));
test('bước nhập "hợp lệ" → VAGUE_STEP, kèm chữ gây mờ trong text', () => {
  const r = findAmbiguity({ ...ok, steps: '1. Nhập email hợp lệ' });
  assert.deepEqual(r.map((a) => a.code), ['VAGUE_STEP']);
  assert.match(r[0].text, /hợp lệ/);
});
test('nhiều điểm mờ cùng lúc → báo đủ, đúng thứ tự', () => {
  assert.deepEqual(codes({ pre: '', expected: 'Hiển thị đúng', steps: 'Nhập giá trị phù hợp' }), ['NO_QUOTED_EXPECTED', 'EMPTY_PRE', 'VAGUE_STEP']);
});
test('Expected có số kèm đơn vị → đủ cụ thể, không hỏi', () => {
  assert.deepEqual(codes({ expected: 'Danh sách có đủ 8 dòng 90 → 125 mg/dL, không thiếu / trùng dòng' }), []);
  assert.deepEqual(codes({ expected: 'Hiển thị 72 bpm' }), []);
  assert.deepEqual(codes({ expected: 'Cân nặng 60,5 kg' }), []);
  assert.deepEqual(codes({ expected: 'Tiến độ 50%' }), []);
  assert.deepEqual(codes({ expected: 'Hiển thị giờ 08:00' }), []);
});
test('số không kèm đơn vị (đếm số lượng) vẫn là điểm mờ', () => {
  assert.deepEqual(codes({ expected: 'Hiển thị 8 dòng' }), ['NO_QUOTED_EXPECTED']);
  assert.deepEqual(codes({ expected: 'Tap 2 lần chỉ lưu 1 bản ghi' }), ['NO_QUOTED_EXPECTED']);
  assert.deepEqual(codes({ expected: 'Shows 3 items' }), ['NO_QUOTED_EXPECTED']);
  assert.deepEqual(codes({ expected: 'Hiện 2 in danh sách' }), ['NO_QUOTED_EXPECTED']);
  assert.deepEqual(codes({ expected: 'Sau 3 giây popup biến mất' }), ['NO_QUOTED_EXPECTED']);
});

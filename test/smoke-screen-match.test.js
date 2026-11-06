import test from 'node:test';
import assert from 'node:assert/strict';
import { screenOverlap } from '../server/smoke/screenMatch.js';

const el = (name, label = name) => ({ type: 'StaticText', name, label });

test('screenOverlap: màn có các nhãn của frame → tỉ lệ cao', () => {
  const r = screenOverlap([el('Log Blood Sugar'), el('Save'), el('mg/dL'), el('96')], ['Log Blood Sugar', 'Save', 'mg/dL', '96', 'Date']);
  assert.equal(r.checked, true);
  assert.ok(r.ratio >= 0.5); // 2/3 nhãn thật (mg/dL, 96 là dữ liệu, bỏ qua; "Date" thiếu)
});

test('screenOverlap: màn khác hẳn → tỉ lệ thấp', () => {
  const r = screenOverlap([el('Action'), el('Select time'), el('Sleep')], ['Log Blood Sugar', 'Save', 'Within Range']);
  assert.equal(r.checked, true);
  assert.equal(r.ratio, 0);
});

test('screenOverlap: so không phân biệt hoa thường, khớp theo name hoặc label, chứa chuỗi (nhãn dài ≥ 4 ký tự)', () => {
  assert.equal(screenOverlap([el('x', 'LOG BLOOD SUGAR'), el('save')], ['Log Blood Sugar', 'Save']).ratio, 1);
  assert.equal(screenOverlap([el('Blood Sugar - Latest reading'), el('Save')], ['Blood Sugar', 'Save']).ratio, 1);
});

test('screenOverlap: frame có < 2 nhãn so sánh được (toàn số / dữ liệu) → checked:false (không đủ căn cứ để chặn)', () => {
  assert.deepEqual(screenOverlap([el('Anything')], ['96', '9:41', 'mg/dL']), { checked: false, ratio: 1 });
  assert.deepEqual(screenOverlap([el('Anything')], []), { checked: false, ratio: 1 });
});

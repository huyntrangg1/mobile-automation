import test from 'node:test';
import assert from 'node:assert/strict';
import { isDataLike, similar, keepFinding } from '../server/smoke/noise.js';

const f = (kind, target, actual = '', expected = '') => ({ kind, cat: 'x', target, actual, expected, severity: 'Minor', reason: kind });

test('isDataLike: số, ngày giờ, thứ / tháng, đơn vị và chữ quá ngắn là dữ liệu minh họa; nhãn thật thì không', () => {
  for (const t of ['96', '9:41', '11/11/2024', 'Mon', 'Tue', 'Wed', 'Jan', 'mg/dL', 'mmol/L', 'ml/kg/min', 'bpm', '42.8', 'Improved 1.4 (30D)', '-1x', '%', 'ab']) assert.equal(isDataLike(t), true, t);
  for (const t of ['Log Now', 'Save', 'Blood Sugar', 'Select time', 'Heart Health', 'Within Range']) assert.equal(isDataLike(t), false, t);
});

test('similar: gần giống (hoa thường, sai chính tả nhỏ) cao; khác hẳn thấp', () => {
  assert.ok(similar('Log now', 'Log Now') >= 0.8);
  assert.ok(similar('Save', 'Savee') >= 0.5);
  assert.ok(similar('Moss', 'Heart Health') < 0.3);
});

test('keepFinding: bỏ hẳn các loại nhiễu theo vị trí (lệch vị trí, cỡ chữ, xuống dòng, vùng khác, icon khác)', () => {
  for (const kind of ['position', 'font', 'lines', 'region', 'icon']) assert.equal(keepFinding(f(kind, 'Log Now')), false, kind);
});

test('keepFinding: khác chữ chỉ giữ khi hai chữ GẦN GIỐNG và không phải dữ liệu (lỗi chính tả / hoa thường), còn lại là lệch căn chỉnh hoặc số liệu mẫu', () => {
  assert.equal(keepFinding(f('text', 'Log Now', 'Màn A hiển thị "Log now".', 'Màn A hiển thị "Log Now" (theo Figma).')), true);
  assert.equal(keepFinding(f('text', 'x', 'Màn A hiển thị "Moss".', 'Màn A hiển thị "9" (theo Figma).')), false); // số
  assert.equal(keepFinding(f('text', 'x', 'Màn A hiển thị "Moss".', 'Màn A hiển thị "Heart Health" (theo Figma).')), false); // khác hẳn → căn chỉnh nhầm phần tử
});

test('keepFinding: thiếu chữ chỉ giữ khi là NHÃN (không số / đơn vị / thứ, dài ≥ 3 ký tự)', () => {
  assert.equal(keepFinding(f('missing', 'Log Now', 'Màn A không có "Log Now".', 'Màn A có "Log Now" (theo Figma).')), true);
  for (const t of ['10', 'ml/kg/min', 'Improved 1.4 (30D)', 'Ok', 'Mon']) assert.equal(keepFinding(f('missing', t, `Màn A không có "${t}".`, `Màn A có "${t}" (theo Figma).`)), false, t);
});

test('keepFinding: màu nền / màu chữ / kích thước / thiếu icon, ảnh chỉ giữ khi mục tiêu không phải dữ liệu (vd ngày "Tue" đổi màu vì đang chọn)', () => {
  for (const kind of ['fill', 'text-color', 'size', 'icon-missing', 'image-missing']) {
    assert.equal(keepFinding(f(kind, 'Log Now', 'Nút "Log Now" nền #34C759.', 'Nút "Log Now" nền #0A84FF (theo Figma).')), true, kind);
    assert.equal(keepFinding(f(kind, 'Tue', 'Chữ "Tue" màu #828282.', 'Chữ "Tue" màu #191919 (theo Figma).')), false, `${kind} Tue`);
    assert.equal(keepFinding(f(kind, '96', 'Chữ "96".', 'Chữ "96".')), false, `${kind} số`);
  }
});

test('keepFinding: kind lạ hoặc dữ liệu thiếu không làm ném lỗi', () => {
  assert.equal(keepFinding({}), false);
  assert.equal(keepFinding({ kind: 'fill' }), true);
  assert.equal(keepFinding(null), false);
});

test('keepFinding: màu giống hệt, nền trắng lấy mẫu trượt, mục tiêu không có trên màn app → bỏ', () => {
  const fill = (o) => ({ kind: 'fill', target: 'Save', actual: '#FFFFFF', expected: '#FFFFFF', ...o });
  assert.equal(keepFinding(fill({}), { appTexts: ['save'] }), false);
  assert.equal(keepFinding(fill({ target: 'Within Range', expected: '#3BB868' }), { appTexts: ['within range'] }), false);
  assert.equal(keepFinding(fill({ target: 'Elevated Range', actual: '#112233', expected: '#FFD644' }), { appTexts: ['within range'] }), false);
  assert.equal(keepFinding(fill({ target: 'Save', actual: '#112233', expected: '#FFD644' }), { appTexts: ['save'] }), true);
  assert.equal(keepFinding({ kind: 'text-color', target: 'Critical Range', actual: '#FC8080', expected: '#FC8080' }, { appTexts: ['critical range'] }), false);
});

test('keepFinding: "thiếu chữ" bỏ khi là chữ trạng thái dữ liệu hoặc màn trùng ít', () => {
  const miss = (t) => ({ kind: 'missing', target: t, actual: `không có "${t}"`, expected: `có "${t}"` });
  assert.equal(keepFinding(miss('Elevated Range'), { overlap: 1 }), false);
  assert.equal(keepFinding(miss('Select time'), { overlap: 0.6 }), false);
  assert.equal(keepFinding(miss('Select time'), { overlap: 0.95 }), true);
});

// OCR (Apple Vision): đọc chữ app không đưa vào page source — chữ vẽ trong hình / biểu đồ, badge không tên
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findText, norm, available, ocrPng } from '../server/apps/template/src/runner/ocr.js';

const L = (text, y, x = 0.1, conf = 1) => ({ text, conf, x, y, w: 0.3, h: 0.02 });

test('norm: bỏ hoa thường, dấu câu, emoji; chữ Kirin OCR hay nhầm về Latin', () => {
  assert.equal(norm('In the share menu, pick Tastory.'), 'inthesharemenupicktastory');
  assert.equal(norm('Copу'), 'copy'); // "у" Kirin
  assert.equal(norm('Good news 🎉'), 'goodnews');
});

test('findText: khớp cả câu, câu xuống 2 dòng, lệch 1 ký tự với câu dài; chữ ngắn phải khớp nguyên dòng', () => {
  const lines = [L('Organized recipes', 0.24), L('The more you cook with Tastory, the more it learns - and the smoother', 0.64), L('your kitchen runs.', 0.66, 0.38), L('Now', 0.59), L('Feedback', 0.8)];
  assert.ok(findText(lines, 'Organized recipes'));
  const two = findText(lines, 'The more you cook with Tastory, the more it learns - and the smoother your kitchen runs.');
  assert.ok(two && two.h > 0.02); // khung bao 2 dòng
  assert.ok(findText(lines, 'Organised recipes')); // OCR / chính tả lệch 1 ký tự
  assert.ok(findText(lines, 'Now'));
  assert.equal(findText(lines, 'Your Goal'), null);
  assert.equal(findText(lines, 'back'), null); // không khớp nhầm trong "Feedback"
  assert.equal(findText([L('Your Goal', 0.6, 0.7, 0.2)], 'Your Goal'), null); // độ tin cậy thấp → bỏ
});

// Chạy thật Apple Vision trên ảnh evidence có sẵn (máy macOS có swiftc); không có thì bỏ qua
const SHOT = new URL('../data/runs/RUN-0114/reports/evidence/1793609631402-85941-fail.jpg', import.meta.url);
test('ocrPng: đọc được chữ vẽ trên biểu đồ (Become a better cook, app v1 thiếu "Your Goal")', { skip: !fs.existsSync(SHOT) || !available() }, async () => {
  const lines = await ocrPng(fs.readFileSync(SHOT));
  assert.ok(findText(lines, 'Organized recipes'));
  assert.ok(findText(lines, 'Scattered recipes'));
  assert.ok(findText(lines, 'Now'));
  assert.equal(findText(lines, 'Your Goal'), null);
});

test('k.shown / k.text: phần tử không có trong page source → đọc chữ trên ảnh; khoanh đúng vùng chữ; OCR=off giữ cách cũ', async () => {
  globalThis.driver = {
    isAndroid: false, waitUntil: async () => true, execute: async () => [],
    getWindowSize: async () => ({ width: 400, height: 800 }),
    takeScreenshot: async () => fs.readFileSync(SHOT).toString('base64'),
  };
  globalThis.$ = () => ({ waitForExist: async () => { throw new Error('không có'); } });
  const { createSteps } = await import('../server/apps/template/src/runner/steps.js');
  const eqs = [];
  const shots = [];
  const mk = (env) => createSteps({ sa: { eq: (...a) => eqs.push(a) }, logStep() {}, snapshot: async (...a) => { shots.push(a); return { k: 'ev' }; }, env });
  const k = mk({ SYSTEM_ALERT: 'off' });
  if (available() && fs.existsSync(SHOT)) {
    await k.shown(1, 'Become a better cook', 'Organized recipes', 'Nhãn Organized recipes', '~none');
    assert.equal(eqs.at(-1)[2], true);
    const box = shots.at(-1)[1].k;
    assert.ok(box.width > 0 && box.y > 100 && box.y < 300); // vùng chữ (pt), không phải selector
    await k.shown(1, 'Become a better cook', 'Your Goal', 'Nhãn Your Goal', '~none');
    assert.equal(eqs.at(-1)[2], false);
    await k.text(1, 'Become a better cook', 'Nhãn trục X', 'Nhãn Now', '~none', 'Now');
    assert.equal(eqs.at(-1)[2], 'Now');
  }
  await mk({ SYSTEM_ALERT: 'off', OCR: 'off' }).shown(1, 'S', 'Organized recipes', 'x', '~none');
  assert.equal(eqs.at(-1)[2], false);
  delete globalThis.driver; delete globalThis.$;
});

test('findText: không khớp một đoạn nằm trong câu khác (NOTI_001: minh hoạ "Red Thai curry tonight?" ≠ tiêu đề "Cook your Red thai curry tonight?")', () => {
  const lines = [L('Cook your Red thai curry tonight?', 0.15), L("It's cooking time!", 0.42)];
  assert.equal(findText(lines, 'Red Thai curry tonight?'), null);
  assert.ok(findText(lines, 'Cook your Red thai curry tonight?'));
  assert.ok(findText([L('🍛 Red Thai curry tonight?', 0.42)], 'Red Thai curry tonight?')); // emoji trang trí vẫn khớp
});

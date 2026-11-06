// Verify layout: luật trong Value, đo theo toạ độ (pt) và dò ảnh chụp (số dòng chữ, khoảng trống tới hình không có tên)
import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { parseRules, evaluate, countLines, space, describeResults } from '../server/apps/template/src/runner/layout.js';

// Ảnh giả @2x: nền kem, các khối "mực" đen theo toạ độ pt
function fakePng(win, blocks, scale = 2) {
  const png = new PNG({ width: win.width * scale, height: win.height * scale });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([248, 245, 238, 255], i);
  for (const b of blocks) {
    for (let y = b.y * scale; y < (b.y + b.h) * scale; y++) {
      for (let x = b.x * scale; x < (b.x + b.w) * scale; x++) png.data.set([20, 20, 30, 255], (png.width * y + x) << 2);
    }
  }
  return png;
}
const WIN = { width: 402, height: 874 };

test('parseRules: đọc luật, chấp nhận ≤ ≥; luật sai báo rõ', () => {
  assert.deepEqual(parseRules('width <= 260; lines = 2\nspaceBelow ≥ 36'), [
    { metric: 'width', op: '<=', num: 260 }, { metric: 'lines', op: '=', num: 2 }, { metric: 'spaceBelow', op: '>=', num: 36 },
  ]);
  assert.throws(() => parseRules('rộng <= 260'), /Verify layout: luật "rộng <= 260" sai/);
  assert.throws(() => parseRules(''), /Value trống/);
});

test('đo theo toạ độ: subtitle tràn gần mép (bug #2) sai; bó 252pt căn giữa thì đúng', () => {
  const rules = parseRules('width <= 260; centerOffset <= 4; left >= 60');
  const wide = evaluate(rules, { rect: { x: 33, y: 166, width: 336, height: 39 }, win: WIN });
  assert.equal(wide.ok, false);
  assert.equal(describeResults(wide.results), 'độ rộng width = 336 (cần <= 260); lề trái left = 33 (cần >= 60)');
  assert.equal(evaluate(rules, { rect: { x: 75, y: 166, width: 252, height: 39 }, win: WIN }).ok, true);
});

test('số dòng chữ: title 1 dòng sát mép (bug #5) → 1; title 2 dòng → 2', () => {
  const one = fakePng(WIN, [{ x: 20, y: 130, w: 362, h: 22 }]);
  assert.equal(countLines(one, { x: 18, y: 128, width: 366, height: 28 }, 2), 1);
  const two = fakePng(WIN, [{ x: 82, y: 130, w: 238, h: 22 }, { x: 140, y: 160, w: 122, h: 22 }]);
  assert.equal(countLines(two, { x: 80, y: 128, width: 242, height: 59 }, 2), 2);
  const r = evaluate(parseRules('lines = 2; left >= 24; right >= 24'), { rect: { x: 18, y: 128, width: 366, height: 28 }, win: WIN, png: one, scale: 2 });
  assert.equal(describeResults(r.results), 'số dòng chữ lines = 1 (cần = 2); lề trái left = 18 (cần >= 24); lề phải right = 18 (cần >= 24)');
});

test('khoảng trống dưới subtitle tới hình minh hoạ không có tên: sát 20pt sai, 40pt đúng', () => {
  const rect = { x: 75, y: 166, width: 252, height: 39 };
  const near = fakePng(WIN, [{ x: 75, y: 168, w: 252, h: 30 }, { x: 120, y: 225, w: 160, h: 200 }]);
  assert.equal(space(near, rect, 2, 'below'), 20);
  const far = fakePng(WIN, [{ x: 75, y: 168, w: 252, h: 30 }, { x: 120, y: 245, w: 160, h: 200 }]);
  assert.equal(evaluate(parseRules('spaceBelow >= 36'), { rect, win: WIN, png: far, scale: 2 }).ok, true);
  assert.equal(space(far, rect, 2, 'above'), 166); // không gặp gì phía trên → tới mép màn
});

test('k.layout: ghi điểm kiểm Verify layout, actual là số đo sai; không thấy phần tử → null; toạ độ → bỏ qua', async () => {
  const one = fakePng(WIN, [{ x: 20, y: 130, w: 362, h: 22 }]);
  globalThis.driver = {
    isAndroid: false,
    waitUntil: async () => true,
    execute: async () => [],
    getWindowSize: async () => WIN,
    takeScreenshot: async () => PNG.sync.write(one).toString('base64'),
  };
  globalThis.$ = (sel) => ({
    waitForExist: async () => { if (sel !== '~title') throw new Error('x'); },
    getLocation: async () => ({ x: 18, y: 128 }),
    getSize: async () => ({ width: 366, height: 28 }),
  });
  const { createSteps } = await import('../server/apps/template/src/runner/steps.js');
  const eqs = [];
  const steps = [];
  const k = createSteps({ sa: { eq: (...a) => eqs.push(a) }, logStep: (e) => steps.push(e), snapshot: async () => ({ k: 'ev' }), env: { SYSTEM_ALERT: 'off' } });
  await k.layout(1, 'Become a better cook', 'Title', 'Title 2 dòng căn giữa', '~title', 'lines = 2; left >= 24');
  assert.deepEqual(eqs[0].slice(1, 4), ['Title 2 dòng căn giữa', 'số dòng chữ lines = 1 (cần = 2); lề trái left = 18 (cần >= 24)', 'lines = 2; left >= 24']);
  assert.deepEqual(eqs[0][5], { keyword: 'Verify layout', target: 'Title', value: 'lines = 2; left >= 24', screen: 'Become a better cook' });
  await k.layout(1, 'Become a better cook', 'Title', 'Title', '~missing', 'lines = 2');
  assert.equal(eqs[1][2], null);
  await k.layout(1, 'Paywall', 'Nút ✕', 'Nút ✕ góc trái', 'point:0.07,0.06', 'left <= 30');
  assert.equal(eqs.length, 2);
  assert.match(steps.at(-1).note, /Bỏ qua: phần tử chỉ có toạ độ/);
  delete globalThis.driver; delete globalThis.$;
});

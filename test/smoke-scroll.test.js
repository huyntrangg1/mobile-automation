import test from 'node:test';
import assert from 'node:assert/strict';
import { scrollToText, fingerprint } from '../server/smoke/scroll.js';

const el = (name, y = 0) => ({ type: 'StaticText', name, label: name, rect: { x: 0, y, width: 10, height: 10 } });
// Trang theo số lần vuốt: pages[i] là danh sách phần tử sau i lần vuốt (quá cuối thì giữ trang cuối)
function rig(pages) {
  let n = 0;
  return { swipes: () => n, read: async () => pages[Math.min(n, pages.length - 1)], swipeUp: async () => { n++; } };
}

test('scrollToText: đã thấy sẵn → không vuốt', async () => {
  const r = rig([[el('Health'), el('Blood Sugar')]]);
  assert.deepEqual(await scrollToText({ label: 'blood sugar', read: r.read, swipeUp: r.swipeUp }), { found: true, swipes: 0, bottom: false });
  assert.equal(r.swipes(), 0);
});

test('scrollToText: vuốt từng lần tới khi thấy (không phân biệt hoa thường, chứa chuỗi)', async () => {
  const r = rig([[el('A', 1)], [el('B', 2)], [el('C', 3)], [el('Blood Sugar - Latest', 4)]]);
  assert.deepEqual(await scrollToText({ label: 'Blood Sugar', read: r.read, swipeUp: r.swipeUp }), { found: true, swipes: 3, bottom: false });
});

test('scrollToText: màn không đổi sau khi vuốt = hết màn → found:false, bottom:true (dừng ngay, không vuốt thêm)', async () => {
  const r = rig([[el('A', 1)], [el('B', 2)], [el('B', 2)]]);
  assert.deepEqual(await scrollToText({ label: 'Nope', read: r.read, swipeUp: r.swipeUp }), { found: false, swipes: 2, bottom: true });
  assert.equal(r.swipes(), 2);
});

test('scrollToText: giới hạn số lần vuốt (max) khi màn cứ đổi mãi', async () => {
  let i = 0;
  const read = async () => [el(`P${i}`, i)];
  const swipeUp = async () => { i++; };
  const out = await scrollToText({ label: 'Nope', read, swipeUp, max: 4 });
  assert.deepEqual(out, { found: false, swipes: 4, bottom: false });
});

test('scrollToText: elements ban đầu có thể truyền sẵn để khỏi đọc lại', async () => {
  let reads = 0;
  const out = await scrollToText({ label: 'Hi', elements: [el('Hi')], read: async () => { reads++; return []; }, swipeUp: async () => {} });
  assert.equal(out.found, true);
  assert.equal(reads, 0);
});

test('fingerprint: đổi khi tên hoặc vị trí dọc đổi; giống nhau khi cùng nội dung', () => {
  assert.equal(fingerprint([el('A', 1)]), fingerprint([el('A', 1)]));
  assert.notEqual(fingerprint([el('A', 1)]), fingerprint([el('A', 2)]));
  assert.notEqual(fingerprint([el('A', 1)]), fingerprint([el('B', 1)]));
});

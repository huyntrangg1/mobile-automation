import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStart } from '../server/apps/template/src/utils/app.js';

// freshStart chạy trên driver toàn cục của wdio. Lần chạy RUN-0136: "Mở app, chờ màn ổn định (936.0s)" — một lệnh WebDriverAgent treo gần 16 phút
// rồi phiên chết, mọi case sau Blocked. Mỗi lệnh phải có giới hạn thời gian.
test('freshStart: lệnh activateApp treo → báo lỗi rõ sau giới hạn thay vì chờ vô hạn', async () => {
  globalThis.driver = { isAndroid: false, execute: async (cmd) => { if (cmd === 'mobile: activateApp') return new Promise(() => {}); return undefined; }, getPageSource: async () => '<x/>', pause: async () => {} };
  const t0 = Date.now();
  await assert.rejects(freshStart({ stepMs: 60 }), /activateApp.*quá/i);
  assert.ok(Date.now() - t0 < 2000);
  delete globalThis.driver;
});

test('freshStart: getPageSource treo trong lúc chờ màn ổn định → bỏ lượt đọc đó (không treo cả case), vẫn xong', async () => {
  let reads = 0;
  globalThis.driver = { isAndroid: false, execute: async () => 4, getPageSource: async () => { reads++; return reads === 1 ? new Promise(() => {}) : '<x/>'; }, pause: async () => {} };
  await freshStart({ stepMs: 60, readyMs: 2000 });
  assert.ok(reads >= 2);
  delete globalThis.driver;
});

test('freshStart: chạy bình thường vẫn ghi đủ các giai đoạn vào log', async () => {
  const logs = [];
  globalThis.driver = { isAndroid: false, execute: async () => 4, getPageSource: async () => '<x/>', pause: async () => {} };
  await freshStart({ log: (t) => logs.push(t), stepMs: 500 });
  assert.deepEqual(logs.map((l) => l.replace(/ \(.*/, '')), ['Gỡ app', 'Cài app', 'Mở app, chờ màn ổn định']);
  delete globalThis.driver;
});

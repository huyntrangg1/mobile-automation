import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// freshStart cần file app (APP_PATH) có thật — tạo file giả trước khi nạp module (ios.caps.js đọc biến môi trường lúc nạp)
const appFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'app-')), 'Fake.app');
fs.writeFileSync(appFile, 'x');
process.env.APP_PATH = appFile;
const { freshStart } = await import('../server/apps/template/src/utils/app.js');

test('freshStart: file app không còn → dừng TRƯỚC khi gỡ app (không để máy mất app mà không cài lại được)', async () => {
  const cmds = [];
  globalThis.driver = { isAndroid: false, execute: async (cmd) => { cmds.push(cmd); return 4; }, getPageSource: async () => '<x/>', pause: async () => {} };
  fs.renameSync(appFile, appFile + '.bak');
  try {
    await assert.rejects(freshStart({ stepMs: 60 }), /Không có file app để cài lại/);
    assert.ok(!cmds.includes('mobile: removeApp'));
  } finally { fs.renameSync(appFile + '.bak', appFile); delete globalThis.driver; }
});

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

// Thử locator trên máy (app đang mở sẵn, không cài / mở lại): tìm phần tử, ảnh màn hiện tại, tuỳ chọn bấm thử
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.js';
import { createLock } from '../server/lock.js';
import { createTryLive } from '../server/locators/tryLive.js';
import { tmpDir } from './helpers.js';

function fakeDriver(found = {}) {
  const calls = { clicks: [], execs: [], deleted: 0 };
  const el = (name) => ({
    elementId: name,
    getLocation: async () => ({ x: 10, y: 20 }), getSize: async () => ({ width: 30, height: 40 }),
    isDisplayed: async () => true, isEnabled: async () => true, getTagName: async () => 'XCUIElementTypeButton',
    getAttribute: async (k) => (k === 'name' || k === 'label' ? name : null),
    click: async () => { calls.clicks.push(name); },
  });
  const driver = {
    isAndroid: false,
    $$: async (loc) => (found[loc] || []).map(el),
    getWindowRect: async () => ({ x: 0, y: 0, width: 400, height: 800 }),
    takeScreenshot: async () => Buffer.from('png').toString('base64'),
    execute: async (cmd, o) => { calls.execs.push([cmd, o]); },
    deleteSession: async () => { calls.deleted++; },
    pause: async () => {},
  };
  return { driver, calls };
}

function setup(found) {
  const dataDir = tmpDir();
  const store = createStore(dataDir);
  store.put('apps', { id: 'app', name: 'A', platform: 'iOS', bundleId: 'com.x', workspace: tmpDir(), status: 'ready' });
  const lock = createLock();
  const fake = fakeDriver(found);
  let attached = 0;
  const tryLive = createTryLive({ store, lock, dataDir, attachImpl: async () => { attached++; return { driver: fake.driver, close: () => fake.driver.deleteSession() }; } });
  return { store, lock, tryLive, fake, attached: () => attached };
}

test('tìm thấy → số phần tử, loại / tên / vị trí / hiển thị, ảnh màn hiện tại, kích thước màn; đưa app ra trước không mở lại; nhả khoá', async () => {
  const { tryLive, fake, lock } = setup({ '~Close': ['Close'] });
  const r = await tryLive.run({ appId: 'app', udid: 'U', locator: '~Close' });
  assert.equal(r.count, 1);
  assert.deepEqual(r.elements[0], { type: 'Button', name: 'Close', label: 'Close', rect: { x: 10, y: 20, width: 30, height: 40 }, visible: true, enabled: true });
  assert.match(r.shotUrl, /^\/files\/data\/screens\/app\/_try\.png\?t=\d+$/);
  assert.deepEqual(r.win, { width: 400, height: 800 });
  assert.deepEqual(fake.calls.execs[0], ['mobile: activateApp', { bundleId: 'com.x' }]);
  assert.equal(lock.current(), null);
});

test('bấm thử: bấm phần tử đầu tiên; point → bấm theo toạ độ tỉ lệ màn hình', async () => {
  const { tryLive, fake } = setup({ '~Close': ['Close', 'Close 2'] });
  const r = await tryLive.run({ appId: 'app', udid: 'U', locator: '~Close', tap: true });
  assert.equal(r.tapped, true);
  assert.deepEqual(fake.calls.clicks, ['Close']);
  const p = await tryLive.run({ appId: 'app', udid: 'U', locator: 'point:0.1,0.05', tap: true });
  assert.deepEqual(p.point, { fx: 0.1, fy: 0.05 });
  assert.deepEqual(fake.calls.execs.at(-1), ['mobile: tap', { x: 40, y: 40 }]);
});

test('giữ phiên giữa các lần thử; thiết bị bị Run / Lấy locator chiếm → đóng phiên thử', async () => {
  const { tryLive, fake, lock, attached } = setup({});
  await tryLive.run({ appId: 'app', udid: 'U', locator: '~a' });
  await tryLive.run({ appId: 'app', udid: 'U', locator: '~b' });
  assert.equal(attached(), 1);
  lock.acquire({ kind: 'run', id: 'RUN-1', label: 'run' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(fake.calls.deleted, 1);
});

test('thiết bị đang bận → 409; locator sai dạng → 400', async () => {
  const { tryLive, lock } = setup({});
  await assert.rejects(tryLive.run({ appId: 'app', udid: 'U', locator: 'abc' }), (e) => e.status === 400);
  lock.acquire({ kind: 'run', id: 'RUN-1', label: 'Đang chạy RUN-1' });
  await assert.rejects(tryLive.run({ appId: 'app', udid: 'U', locator: '~a' }), (e) => e.status === 409);
});

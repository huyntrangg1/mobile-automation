import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { backgroundApp, rotateDevice, openDeepLink, sendPush, appDeepLinks } from '../server/smoke/lifecycle.js';

const drv = (over = {}) => {
  const calls = [];
  return { calls, pause: async (ms) => calls.push(['pause', ms]), execute: async (c, a) => { calls.push(['execute', c, a]); }, pressKeyCode: async (k) => calls.push(['key', k]), setOrientation: async (o) => calls.push(['orient', o]), ...over };
};

test('backgroundApp iOS: kích hoạt SpringBoard (app xuống nền) → chờ → kích hoạt lại app', async () => {
  const d = drv();
  const s = await backgroundApp(d, { platform: 'iOS', bundleId: 'com.x.sw' }, 5);
  assert.equal(s, 5);
  assert.deepEqual(d.calls, [['execute', 'mobile: activateApp', { bundleId: 'com.apple.springboard' }], ['pause', 5000], ['execute', 'mobile: activateApp', { bundleId: 'com.x.sw' }]]);
});

test('backgroundApp Android: nút Home → chờ → activateApp bằng appId', async () => {
  const d = drv();
  await backgroundApp(d, { platform: 'Android', bundleId: 'com.x.sw' }, 3);
  assert.deepEqual(d.calls, [['key', 3], ['pause', 3000], ['execute', 'mobile: activateApp', { appId: 'com.x.sw' }]]);
});

test('backgroundApp: kẹp thời gian 1–30 giây, mặc định 5', async () => {
  for (const [input, want] of [[100, 30], [0, 5], [undefined, 5], ['abc', 5], [-4, 1], ['7', 7]]) {
    const d = drv();
    assert.equal(await backgroundApp(d, { platform: 'iOS', bundleId: 'b' }, input), want, String(input));
  }
});

test('rotateDevice: landscape → LANDSCAPE, còn lại → PORTRAIT; lỗi của thiết bị được ném ra để tool xử lý', async () => {
  const d = drv();
  assert.equal(await rotateDevice(d, 'landscape'), 'LANDSCAPE');
  assert.equal(await rotateDevice(d, 'whatever'), 'PORTRAIT');
  assert.deepEqual(d.calls, [['orient', 'LANDSCAPE'], ['orient', 'PORTRAIT']]);
  await assert.rejects(rotateDevice(drv({ setOrientation: async () => { throw new Error('Unable To Rotate Device'); } }), 'landscape'), /Unable To Rotate/);
});

test('openDeepLink: dùng mobile: deepLink — iOS truyền bundleId, Android truyền package; link rỗng bị từ chối', async () => {
  const ios = drv();
  await openDeepLink(ios, { platform: 'iOS', bundleId: 'com.x.sw' }, 'moss://bloodsugar');
  assert.deepEqual(ios.calls, [['execute', 'mobile: deepLink', { url: 'moss://bloodsugar', bundleId: 'com.x.sw' }]]);
  const and = drv();
  await openDeepLink(and, { platform: 'Android', bundleId: 'com.x.sw' }, 'moss://a');
  assert.deepEqual(and.calls, [['execute', 'mobile: deepLink', { url: 'moss://a', package: 'com.x.sw' }]]);
  await assert.rejects(openDeepLink(drv(), { platform: 'iOS', bundleId: 'b' }, '  '), /link/i);
});

test('sendPush: iOS Simulator gửi qua xcrun simctl push (payload apns); Android và máy thật iOS báo chưa hỗ trợ', async () => {
  const calls = [];
  const exec = async (cmd, args) => { calls.push([cmd, args.slice(0, 4), args[4] && JSON.parse(require_fs(args[4]))]); return ''; };
  const require_fs = (f) => fs.readFileSync(f, 'utf8');
  await sendPush({ udid: 'AAAAAAAA-1111-2222-3333-444444444444', app: { platform: 'iOS', bundleId: 'com.x.sw' }, title: 'Chương mới', body: 'Đọc ngay', exec });
  assert.deepEqual(calls[0][0], 'xcrun');
  assert.deepEqual(calls[0][1], ['simctl', 'push', 'AAAAAAAA-1111-2222-3333-444444444444', 'com.x.sw']);
  assert.deepEqual(calls[0][2], { aps: { alert: { title: 'Chương mới', body: 'Đọc ngay' } } });
  await assert.rejects(sendPush({ udid: 'x', app: { platform: 'Android', bundleId: 'b' }, body: 'x', exec }), /Simulator/);
});

test('appDeepLinks: nhận mảng hoặc chuỗi nhiều dòng trong hồ sơ app, bỏ dòng trống', () => {
  assert.deepEqual(appDeepLinks({ deepLinks: 'moss://a\n\n moss://b ' }), ['moss://a', 'moss://b']);
  assert.deepEqual(appDeepLinks({ deepLinks: ['moss://c', ''] }), ['moss://c']);
  assert.deepEqual(appDeepLinks({}), []);
});

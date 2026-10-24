import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readAppInfo, listDevices, sessionCaps, systemDialog } from '../server/device/platforms.js';
import { IK_FITNESS } from '../server/paths.js';

const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

test('readAppInfo .app (iOS): bundle id + version từ Info.plist', async (t) => {
  if (!fs.existsSync(path.join(IK_FITNESS, 'apps/ikFitnessHeathyApp.app'))) return t.skip('không có file .app mẫu');
  const i = await readAppInfo(path.join(IK_FITNESS, 'apps/ikFitnessHeathyApp.app'));
  assert.equal(i.platform, 'iOS');
  assert.equal(i.bundleId, 'com.begamob.fitness');
  assert.match(i.version, /^\d/);
});

test('readAppInfo .apk (Android): package, version, activity từ aapt2', async () => {
  const i = await readAppInfo('/x/ApiDemos-debug.apk', { exists: () => true, exec: async () => fx('aapt2-apidemos.txt') });
  assert.deepEqual(i, { platform: 'Android', bundleId: 'io.appium.android.apis', version: '6.0.2 (28)', activity: 'io.appium.android.apis.ApiDemos', label: 'API Demos' });
});

test('readAppInfo file lạ → lỗi rõ', async () => {
  await assert.rejects(readAppInfo('/x/app.zip', { exists: () => true }), /\.app.*\.apk/);
});

test('listDevices: gộp simulator iOS + thiết bị Android (adb), lọc theo nền tảng', async () => {
  const exec = async (cmd, args) => {
    if (cmd === 'xcrun') return JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [{ udid: 'C8F5', name: 'iPhone 17 Pro Max', state: 'Booted', isAvailable: true }] } });
    if (cmd === 'adb' && args[0] === 'devices') return 'List of devices attached\nemulator-5554          device product:sdk_gphone16k_arm64 model:sdk_gphone16k_arm64 device:emu64a16k transport_id:1\nZY22 offline\n';
    if (cmd === 'adb' && args.includes('emu')) return 'Pixel_10\nOK\n';
    if (cmd === 'adb' && args.includes('getprop')) return '17\n';
    throw new Error(cmd);
  };
  const all = await listDevices(undefined, exec);
  assert.deepEqual(all, [
    { udid: 'C8F5', name: 'iPhone 17 Pro Max', os: 'iOS 26.5', booted: true, platform: 'iOS' },
    { udid: 'emulator-5554', name: 'Pixel_10', os: 'Android 17', booted: true, platform: 'Android' },
  ]);
  assert.deepEqual((await listDevices('Android', exec)).map((d) => d.udid), ['emulator-5554']);
});

test('listDevices: không có adb vẫn trả simulator iOS', async () => {
  const exec = async (cmd) => {
    if (cmd === 'xcrun') return JSON.stringify({ devices: {} });
    throw new Error('spawn adb ENOENT');
  };
  assert.deepEqual(await listDevices(undefined, exec), []);
});

test('sessionCaps theo nền tảng', () => {
  const ios = sessionCaps({ platform: 'iOS', appPath: '/a.app', bundleId: 'b' }, 'U');
  assert.equal(ios['appium:automationName'], 'XCUITest');
  const and = sessionCaps({ platform: 'Android', appPath: '/a.apk', bundleId: 'io.x', activity: 'io.x.Main' }, 'emulator-5554');
  assert.equal(and.platformName, 'Android');
  assert.equal(and['appium:automationName'], 'UiAutomator2');
  assert.equal(and['appium:udid'], 'emulator-5554');
  assert.equal(and['appium:appPackage'], 'io.x');
  assert.equal(and['appium:appActivity'], 'io.x.Main');
  assert.equal(and['appium:app'], '/a.apk');
});

const PERM = '<?xml version="1.0"?><hierarchy rotation="0" width="1080" height="2424"><android.widget.FrameLayout package="com.google.android.permissioncontroller" class="android.widget.FrameLayout" bounds="[0,0][1080,2424]" displayed="true"><android.widget.TextView package="com.google.android.permissioncontroller" class="android.widget.TextView" text="Allow API Demos to send you notifications?" resource-id="com.android.permissioncontroller:id/permission_message" bounds="[0,0][1,1]" displayed="true"/><android.widget.Button package="com.google.android.permissioncontroller" class="android.widget.Button" text="Allow" resource-id="com.android.permissioncontroller:id/permission_allow_button" clickable="true" bounds="[0,0][1,1]" displayed="true"/><android.widget.Button package="com.google.android.permissioncontroller" class="android.widget.Button" text="Don’t allow" resource-id="com.android.permissioncontroller:id/permission_deny_button" clickable="true" bounds="[0,0][1,1]" displayed="true"/></android.widget.FrameLayout></hierarchy>';

test('systemDialog nhận hộp xin quyền Android: nút + nút từ chối', () => {
  const d = systemDialog(PERM);
  assert.deepEqual(d.buttons, ['Allow', 'Don’t allow']);
  assert.equal(d.deny, 'android=new UiSelector().resourceId("com.android.permissioncontroller:id/permission_deny_button")');
  assert.equal(systemDialog(fx('android-main.xml')), null);
});

test('deviceScreenshot(udid, file, platform) — cùng thứ tự tham số runner gọi (chụp thật nếu có emulator đang bật)', async (t) => {
  const { deviceScreenshot } = await import('../server/device/platforms.js');
  const devs = await listDevices('Android');
  if (!devs.length) return t.skip('không có thiết bị Android đang bật');
  const f = path.join(fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'shot-')), 's.png');
  await deviceScreenshot(devs[0].udid, f, 'Android');
  assert.ok(fs.statSync(f).size > 1000);
});

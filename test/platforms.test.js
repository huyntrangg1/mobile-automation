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

test('wdaInstalled: chỉ true khi WDA trên simulator trùng bản build sẵn (so mã băm thư viện)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { wdaInstalled } = await import('../server/device/platforms.js');
  const { tmpDir } = await import('./helpers.js');
  const lib = 'PlugIns/WebDriverAgentRunner.xctest/Frameworks/WebDriverAgentLib.framework/WebDriverAgentLib';
  const mk = (root, content) => { const f = path.join(root, lib); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); return root; };
  const wdaDir = tmpDir();
  mk(path.join(wdaDir, 'Build/Products/Debug-iphonesimulator/WebDriverAgentRunner-Runner.app'), 'v9');
  const same = mk(tmpDir(), 'v9');
  const old = mk(tmpDir(), 'v7');
  assert.equal(await wdaInstalled('U', { wdaDir, exec: async () => `${same}\n` }), true);
  assert.equal(await wdaInstalled('U', { wdaDir, exec: async () => `${old}\n` }), false);
  assert.equal(await wdaInstalled('U', { wdaDir, exec: async () => { throw new Error('No such app'); } }), false);
});

test('readAppInfo: build cho iPhone thật (iPhoneOS) → lỗi rõ ràng; build Simulator → nhận', async () => {
  const fs = await import('node:fs');
  const { tmpDir } = await import('./helpers.js');
  const mk = (platforms) => {
    const dir = path.join(tmpDir(), 'Recime.app');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'Info.plist'), '');
    const exec = async (_cmd, args) => (args.includes('CFBundleSupportedPlatforms') ? JSON.stringify(platforms) : args.includes('CFBundleIdentifier') ? 'com.x' : '1.0');
    return { dir, exec };
  };
  const dev = mk(['iPhoneOS']);
  await assert.rejects(readAppInfo(dev.dir, { exec: dev.exec }), /build cho iPhone thật \(iPhoneOS\) — cần build cho Simulator/);
  const sim = mk(['iPhoneSimulator']);
  assert.equal((await readAppInfo(sim.dir, { exec: sim.exec })).bundleId, 'com.x');
});

test('readAppInfo: nền tảng lấy từ file chạy (vtool) — build chuyển sang Simulator (plist iPhoneOS, file chạy IOSSIMULATOR) → nhận + đánh dấu cần sửa plist', async () => {
  const fs = await import('node:fs');
  const { tmpDir } = await import('./helpers.js');
  const dir = path.join(tmpDir(), 'Recime.app');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Info.plist'), '');
  const exec = (bin) => async (cmd, args) => {
    if (cmd === 'vtool') return ` platform ${bin}\n    minos 14.0`;
    if (args.includes('CFBundleSupportedPlatforms')) return '["iPhoneOS"]';
    if (args.includes('CFBundleExecutable')) return 'Recime';
    return args.includes('CFBundleIdentifier') ? 'com.x' : '1.0';
  };
  const i = await readAppInfo(dir, { exec: exec('IOSSIMULATOR') });
  assert.equal(i.simPlistFix, true);
  await assert.rejects(readAppInfo(dir, { exec: exec('IOS') }), /build cho iPhone thật \(IOS\)/);
});

test('sessionCaps (lấy locator): popup xin quyền tự xử lý theo SYSTEM_ALERT — mặc định từ chối, allow → cho phép, off → để nguyên', () => {
  const ios = (env) => sessionCaps({ platform: 'iOS', appPath: '/a.app', bundleId: 'b', env }, 'U');
  assert.equal(ios({})['appium:autoDismissAlerts'], true);
  assert.equal(ios({ SYSTEM_ALERT: 'allow' })['appium:autoAcceptAlerts'], true);
  assert.equal(ios({ SYSTEM_ALERT: 'off' })['appium:autoDismissAlerts'], undefined);
  assert.equal(sessionCaps({ platform: 'Android', appPath: '/a.apk', bundleId: 'io.x', env: {} }, 'E')['appium:autoGrantPermissions'], true);
});

// ---- Cấu hình iOS theo framework của skill (Ctx.java / GUIDE §8): không chờ app "yên", WDA thử lại, timeout dài ----
import { attachCaps, realIosCaps } from '../server/device/platforms.js';
test('caps iOS: waitForQuiescence=false, reduceMotion, WDA thử lại 3 lần + timeout 180s (Simulator và attach); iPhone thật cũng không chờ quiescence', () => {
  const sim = sessionCaps({ platform: 'iOS', appPath: '/a.app', bundleId: 'b' }, 'U');
  const att = attachCaps({ platform: 'iOS', bundleId: 'b' }, 'U');
  for (const c of [sim, att]) {
    assert.equal(c['appium:waitForQuiescence'], false);
    assert.equal(c['appium:wdaStartupRetries'], 3);
    assert.equal(c['appium:wdaStartupRetryInterval'], 5000);
    assert.equal(c['appium:wdaLaunchTimeout'], 180000);
    assert.equal(c['appium:wdaConnectionTimeout'], 180000);
  }
  assert.equal(sim['appium:reduceMotion'], true);
  assert.equal(realIosCaps({ bundleId: 'b' }, '00008120-001055C03C44A01E', 'TEAM123456')['appium:waitForQuiescence'], false);
  // Android không bị ảnh hưởng
  assert.equal(sessionCaps({ platform: 'Android', appPath: '/a.apk', bundleId: 'io.x' }, 'E')['appium:waitForQuiescence'], undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isSimContainerPath, listBuilds, listSimulators } from '../server/device/simulators.js';

const SIMCTL = JSON.stringify({ devices: {
  'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
    { udid: 'C8F5', name: 'iPhone 17 Pro Max', state: 'Booted', isAvailable: true },
    { udid: 'A111', name: 'iPhone 16e', state: 'Shutdown', isAvailable: true },
  ],
  'com.apple.CoreSimulator.SimRuntime.watchOS-26-0': [{ udid: 'W1', name: 'Apple Watch', state: 'Shutdown', isAvailable: true }],
} });

test('chỉ iOS, có os, booted lên đầu', async () => {
  const list = await listSimulators(async () => SIMCTL);
  assert.deepEqual(list, [
    { udid: 'C8F5', name: 'iPhone 17 Pro Max', os: 'iOS 26.5', booted: true },
    { udid: 'A111', name: 'iPhone 16e', os: 'iOS 26.5', booted: false },
  ]);
});

// Cây thư mục giả: 2 simulator + DerivedData; Info.plist trả qua stub theo tên .app
function fakeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builds-'));
  const devices = path.join(root, 'Devices');
  const derived = path.join(root, 'DerivedData');
  const mk = (p, t) => { fs.mkdirSync(p, { recursive: true }); fs.utimesSync(p, t, t); return p; };
  const app = (udid, uuid, name) => path.join(devices, udid, 'data/Containers/Bundle/Application', uuid, name);
  return {
    devices, derived,
    old: mk(app('C8F5', 'U1', 'Fit.app'), 1000),
    fresh: mk(app('A111', 'U2', 'Fit.app'), 2000),
    wda: mk(app('A111', 'U3', 'WebDriverAgentRunner-Runner.app'), 3000),
    recipe: mk(app('A111', 'U4', 'Recipe.app'), 1500),
    xcode: mk(path.join(derived, 'Fit-abc/Build/Products/Debug-iphonesimulator/Fit.app'), 4000),
    device: mk(path.join(derived, 'Fit-abc/Build/Products/Debug-iphoneos/Fit.app'), 5000),
  };
}
const PLISTS = {
  'Fit.app': { CFBundleIdentifier: 'com.x.fit', CFBundleShortVersionString: '1.0', CFBundleVersion: '5', CFBundleDisplayName: 'FitAgain' },
  'Recipe.app': { CFBundleIdentifier: 'com.x.recipe', CFBundleName: 'Recipe' },
  'WebDriverAgentRunner-Runner.app': { CFBundleIdentifier: 'com.facebook.WebDriverAgentRunner.xctrunner' },
};

test('listBuilds: gộp simulator + DerivedData, bỏ WDA và build cho máy thật, trùng version giữ bản mới', async () => {
  const t = fakeTree();
  const list = await listBuilds({
    devices: t.devices, derived: t.derived,
    plist: async (f) => PLISTS[path.basename(path.dirname(f))],
    sims: async () => [{ udid: 'A111', name: 'iPhone 16e', os: 'iOS 26.5' }],
  });
  // DerivedData và simulator cùng com.x.fit@1.0 (5) → giữ bản mới nhất (Xcode); Debug-iphoneos bị bỏ
  assert.deepEqual(list.map((b) => [b.path, b.name, b.bundleId, b.version, b.source]), [
    [t.xcode, 'FitAgain', 'com.x.fit', '1.0 (5)', 'Xcode · Debug'],
    [t.recipe, 'Recipe', 'com.x.recipe', '?', 'iPhone 16e (iOS 26.5)'],
  ]);});

test('listBuilds: thiếu thư mục / Info.plist hỏng không làm lỗi cả danh sách', async () => {
  const t = fakeTree();
  const list = await listBuilds({
    devices: t.devices, derived: path.join(t.derived, 'khong-co'),
    plist: async (f) => { if (f.includes('Recipe')) throw new Error('hỏng'); return PLISTS[path.basename(path.dirname(f))]; },
    sims: async () => { throw new Error('không có xcrun'); },
  });
  assert.deepEqual(list.map((b) => [b.path, b.source]), [[t.fresh, 'Simulator A111']]);
});

test('isSimContainerPath: chỉ đường dẫn trong container simulator', () => {
  const t = fakeTree();
  assert.equal(isSimContainerPath(t.fresh, t.devices), true);
  assert.equal(isSimContainerPath(t.xcode, t.devices), false);
  assert.equal(isSimContainerPath('/Users/a/Fit.app', t.devices), false);
});

test('listBuilds: icon chính theo Info.plist được chuyển vào iconDir, có kind + size', async () => {
  const t = fakeTree();
  fs.writeFileSync(path.join(t.xcode, 'AppIcon60x60@2x.png'), 'png');
  fs.writeFileSync(path.join(t.xcode, 'AppIcon76x76@2x~ipad.png'), 'ipad');
  const iconDir = path.join(t.devices, '..', 'icons');
  const converted = [];
  const plists = { ...PLISTS, 'Fit.app': { ...PLISTS['Fit.app'], CFBundleIcons: { CFBundlePrimaryIcon: { CFBundleIconFiles: ['AppIcon60x60'] } } } };
  const list = await listBuilds({
    devices: t.devices, derived: t.derived, iconDir, sims: async () => [],
    plist: async (f) => plists[path.basename(path.dirname(f))],
    toPng: async (src, dest) => { converted.push(path.basename(src)); fs.writeFileSync(dest, 'x'); },
  });
  const fit = list.find((b) => b.bundleId === 'com.x.fit');
  assert.equal(fit.kind, 'xcode');
  assert.equal(fit.size, 7);
  assert.match(fit.icon, /^[0-9a-f]{16}\.png$/);
  assert.ok(fs.existsSync(path.join(iconDir, fit.icon)));
  assert.deepEqual(converted, ['AppIcon60x60@2x.png']);
  assert.equal(list.find((b) => b.bundleId === 'com.x.recipe').icon, null);
});

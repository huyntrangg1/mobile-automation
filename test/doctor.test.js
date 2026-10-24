import test from 'node:test';
import assert from 'node:assert/strict';
import { runChecks } from '../scripts/doctor-checks.js';

// Máy đủ hết
const ALL_OK = {
  node: async () => '26.3.0', os: async () => 'darwin', deps: async () => true,
  appium: async () => '2.19.0', drivers: async () => ['xcuitest', 'uiautomator2'],
  claude: async () => ({ version: '2.1.283', loggedIn: true }), testReport: async () => true, ikFitness: async () => true,
  xcode: async () => 'Xcode 26.1', simulators: async () => 3,
  androidSdk: async () => '/Users/x/Library/Android/sdk', adb: async () => true, aapt2: async () => true, androidDevices: async () => 1,
};

test('máy đủ hết → ok, cả iOS và Android sẵn sàng', async () => {
  const r = await runChecks(ALL_OK);
  assert.equal(r.ok, true);
  assert.deepEqual(r.platforms, { iOS: true, Android: true });
  assert.ok(r.items.every((i) => i.status !== 'fail'));
});

test('Node cũ → fail kèm cách sửa', async () => {
  const r = await runChecks({ ...ALL_OK, node: async () => '18.19.0' });
  assert.equal(r.ok, false);
  const i = r.items.find((x) => x.id === 'node');
  assert.equal(i.status, 'fail');
  assert.match(i.fix, /Node 20/);
});

test('chưa đăng nhập Claude Code → fail (gen script, tự khám phá cần)', async () => {
  const r = await runChecks({ ...ALL_OK, claude: async () => ({ version: '2.1.283', loggedIn: false, error: 'Please run /login' }) });
  assert.equal(r.ok, false);
  assert.match(r.items.find((x) => x.id === 'claude').fix, /claude/);
});

test('không có Android SDK nhưng iOS đủ → vẫn ok; Android ghi chưa sẵn sàng, chỉ cảnh báo', async () => {
  const r = await runChecks({ ...ALL_OK, androidSdk: async () => null, adb: async () => false, aapt2: async () => false, drivers: async () => ['xcuitest'], androidDevices: async () => 0 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.platforms, { iOS: true, Android: false });
  assert.ok(r.items.filter((i) => i.group === 'Android').every((i) => i.status !== 'fail'));
  assert.match(r.items.find((x) => x.id === 'driver-uiautomator2').fix, /appium driver install uiautomator2/);
});

test('cả iOS lẫn Android đều chưa đủ → fail', async () => {
  const r = await runChecks({ ...ALL_OK, xcode: async () => null, simulators: async () => 0, androidSdk: async () => null, adb: async () => false, aapt2: async () => false, drivers: async () => [] });
  assert.equal(r.ok, false);
  assert.ok(r.items.some((i) => i.id === 'platform' && i.status === 'fail'));
});

test('thiết bị chưa bật chỉ là cảnh báo', async () => {
  const r = await runChecks({ ...ALL_OK, androidDevices: async () => 0 });
  assert.equal(r.items.find((x) => x.id === 'android-devices').status, 'warn');
  assert.equal(r.ok, true);
});

test('một kiểm tra ném lỗi → coi như thiếu, không làm sập doctor', async () => {
  const r = await runChecks({ ...ALL_OK, appium: async () => { throw new Error('spawn appium ENOENT'); } });
  assert.equal(r.items.find((x) => x.id === 'appium').status, 'fail');
  assert.equal(r.ok, false);
});

test('không có ik-fitness → chỉ cảnh báo (helper pack IK Fitness là tuỳ chọn), vẫn ok', async () => {
  const r = await runChecks({ ...ALL_OK, ikFitness: async () => false });
  assert.equal(r.items.find((x) => x.id === 'ik-fitness').status, 'warn');
  assert.equal(r.ok, true);
});

test('bản report trong tool khác skill gốc → cảnh báo kèm lệnh sync-report; không có skill gốc thì bỏ qua', async () => {
  const lech = await runChecks({ ...ALL_OK, reportSync: async () => 'diff' });
  const i = lech.items.find((x) => x.id === 'report-sync');
  assert.equal(i.status, 'warn');
  assert.match(i.fix, /npm run sync-report/);
  const khong = await runChecks({ ...ALL_OK, reportSync: async () => 'no-source' });
  assert.equal(khong.items.find((x) => x.id === 'report-sync'), undefined);
});

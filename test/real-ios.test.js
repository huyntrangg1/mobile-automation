import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isRealIos, listRealIos, listDevices, realIosCaps, detectTeamId, explainSessionError } from '../server/device/platforms.js';

test('isRealIos: UDID iPhone thật khác UDID simulator', () => {
  assert.equal(isRealIos('00008120-001055C03C44A01E'), true);
  assert.equal(isRealIos('63EC063A-C362-4420-BF8E-F564384EFF3E'), false);
  assert.equal(isRealIos('emulator-5554'), false);
});

const DEVICECTL = { result: { devices: [
  { hardwareProperties: { udid: '00008120-001055C03C44A01E', marketingName: 'iPhone 15' }, deviceProperties: { name: 'Trang test iphone', osVersionNumber: '26.6.1' }, connectionProperties: { pairingState: 'paired', tunnelState: 'disconnected' } },
  { hardwareProperties: { udid: '00008110-000968AA1408401E', marketingName: 'iPhone 13 Pro Max' }, deviceProperties: { name: 'mam', osVersionNumber: '18.6' }, connectionProperties: { pairingState: 'paired', tunnelState: 'unavailable' } },
] } };
const fakeExec = async (cmd, args) => {
  if (cmd === 'xcrun' && args[1] === 'list') { fs.writeFileSync(args[args.indexOf('--json-output') + 1], JSON.stringify(DEVICECTL)); return ''; }
  if (cmd === 'xcrun' && args[0] === 'simctl') return JSON.stringify({ devices: {} });
  throw new Error('no');
};

test('listRealIos: máy ghép đôi, đang liên lạc được = booted; unavailable = tắt', async () => {
  const d = await listRealIos(fakeExec);
  assert.deepEqual(d.map((x) => [x.name, x.os, x.booted, x.real]), [['Trang test iphone', 'iOS 26.6.1', true, true], ['mam', 'iOS 18.6', false, true]]);
});

test('listDevices gộp iPhone thật + simulator, thật lên đầu; Android không kéo theo devicectl', async () => {
  const all = await listDevices('iOS', fakeExec);
  assert.equal(all[0].real, true);
  assert.equal((await listDevices('Android', async () => { throw new Error('no'); })).length, 0);
});

test('realIosCaps: không có `app` (không cài lại), noReset, ký bằng team; thiếu team → lỗi nói cách sửa', () => {
  const c = realIosCaps({ bundleId: 'com.x.moss' }, '00008120-001055C03C44A01E', 'ABCDE12345');
  assert.equal(c['appium:app'], undefined);
  assert.equal(c['appium:noReset'], true);
  assert.equal(c['appium:xcodeOrgId'], 'ABCDE12345');
  assert.equal(c['appium:usePrebuiltWDA'], false);
  assert.throws(() => realIosCaps({ bundleId: 'b' }, 'u', null), /TEAM_ID/);
});

test('detectTeamId: biến TEAM_ID của app thắng; Xcode có đúng 1 team thì tự dùng; nhiều team → null (phải chọn)', async () => {
  assert.equal(await detectTeamId({ env: { TEAM_ID: ' AAA ' } }, async () => ''), 'AAA');
  const one = async () => '{ x = ( { teamID = 7K6YM4Y7SX; teamName = "A"; } ); }';
  const two = async () => '{ x = ( { teamID = 7K6YM4Y7SX; } ); y = ( { teamID = SQ2P82SKK3; } ); }';
  assert.equal(await detectTeamId({}, one), '7K6YM4Y7SX');
  assert.equal(await detectTeamId({}, two), null);
});

// ---- iPhone mà devicectl báo "available" nhưng Xcode (xctrace) báo Offline → Appium không thấy ("Unknown device or simulator UDID") ----
const XCTRACE_OFFLINE = `== Devices ==
MacBook Pro (80BB64CD-5906-5135-9380-BAEC37DB1AC6)

== Devices Offline ==
Trang test iphone (26.6.1) (00008120-001055C03C44A01E)
mam (18.6) (00008110-000968AA1408401E)

== Simulators ==
iPhone 17 Pro Simulator (26.5) (AEB04EEE-C04D-4DC5-856B-D6784E7B0FCB)
`;
const withXctrace = (text) => async (cmd, args) => (cmd === 'xcrun' && args[0] === 'xctrace' ? text : fakeExec(cmd, args));

test('listRealIos: máy nằm trong "Devices Offline" của xctrace → booted:false + offline + gợi ý, dù devicectl báo available', async () => {
  const d = await listRealIos(withXctrace(XCTRACE_OFFLINE));
  const trang = d.find((x) => x.name === 'Trang test iphone');
  assert.equal(trang.booted, false);
  assert.equal(trang.offline, true);
  assert.match(trang.note, /USB|offline/i);
});

test('listRealIos: máy ở mục "Devices" (online) của xctrace → giữ booted:true; xctrace lỗi / không có → không đổi kết quả cũ', async () => {
  const online = XCTRACE_OFFLINE.replace('== Devices Offline ==', '== Devices ==');
  const d = await listRealIos(withXctrace(online));
  assert.equal(d.find((x) => x.name === 'Trang test iphone').booted, true);
  assert.ok(!d.find((x) => x.name === 'Trang test iphone').offline);
  const none = await listRealIos(fakeExec); // fakeExec ném lỗi với xctrace
  assert.equal(none.find((x) => x.name === 'Trang test iphone').booted, true);
});

test('explainSessionError: "Unknown device or simulator UDID" → câu tiếng Việt nêu UDID, USB, xctrace, Simulator; lỗi khác giữ nguyên', () => {
  const raw = new Error('WebDriverError: Unknown device or simulator UDID: \'00008120-001055C03C44A01E\' when running "http://127.0.0.1:4724/session" with method "POST"');
  const e = explainSessionError(raw, '00008120-001055C03C44A01E');
  assert.notEqual(e, raw);
  for (const re of [/00008120-001055C03C44A01E/, /USB/, /xctrace/, /Simulator/, /Tin cậy|tin cậy/]) assert.match(e.message, re);
  const other = new Error('timeout');
  assert.equal(explainSessionError(other, 'x'), other);
});

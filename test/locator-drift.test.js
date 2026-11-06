// Build mới đổi chữ / cách xuống dòng không làm Blocked giả (RUN-0124: title "Become a better cook\nwith Tastory"):
// 1) locator theo chữ khớp lỏng khoảng trắng  2) chờ màn hết giờ → tự tìm chữ gần giống (không AI)  3) ghi lệch + cảnh báo build
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createSteps, readOverrides } from '../server/apps/template/src/runner/steps.js';
import { loose, looseRegex, selText } from '../server/apps/template/src/utils/ui.js';
import { buildNotes, buildStamp, driftLog, readDrift } from '../server/runs/runner.js';
import { tmpDir } from './helpers.js';

const TITLE = 'Become a better cook with Tastory';
const TWO_LINES = 'Become a better cook\nwith Tastory';
const LOOSE_TITLE = `-ios predicate string:name MATCHES ${JSON.stringify(looseRegex(TITLE))}`;

// App giả: các selector "có trên màn" → phần tử; name = chữ thật trong app
function device(present, { xml = '<XCUIElementTypeApplication/>' } = {}) {
  globalThis.driver = { isAndroid: false, getPageSource: async () => xml, execute: async () => [] };
  globalThis.browser = { saveScreenshot: async () => {}, getPageSource: async () => xml };
  globalThis.$ = (sel) => ({
    waitForExist: async () => { if (!(sel in present)) throw new Error(`element ("${sel}") still not existing after 10ms`); },
    getAttribute: async () => present[sel],
    click: async () => {},
  });
}
const steps = (reports, extra = {}) => createSteps({ sa: { eq() {} }, logStep() {}, snapshot: async () => ({}), env: { LIVE_STEPS: path.join(reports, 'live.jsonl'), ...extra }, cwd: reports });

test('loose: chữ có khoảng trắng → khớp mọi khoảng trắng / xuống dòng; chữ khác vẫn không khớp; ký tự đặc biệt được escape', () => {
  globalThis.driver = { isAndroid: false };
  assert.equal(loose(`~${TITLE}`), LOOSE_TITLE);
  assert.equal(loose('~Continue'), '~Continue'); // không khoảng trắng → giữ nguyên
  assert.equal(loose('point:0.5,0.5'), 'point:0.5,0.5');
  const re = new RegExp(looseRegex(TITLE));
  assert.ok(re.test(TWO_LINES) && re.test(` ${TITLE}  `) && re.test('Become a better cook with Tastory'));
  assert.ok(!re.test('Become a good cook with Tastory'));
  assert.ok(new RegExp(looseRegex('Already have an account? Log in')).test('Already have an account?\nLog in'));
  assert.ok(!new RegExp(looseRegex('Step 1 of 3')).test('Step 1xof 3'));
  // predicate do byText sinh: chỉ đổi name/label == "…" có khoảng trắng
  assert.equal(
    loose('-ios predicate string:type == "XCUIElementTypeButton" AND name == "Get Started"'),
    `-ios predicate string:type == "XCUIElementTypeButton" AND name MATCHES ${JSON.stringify(looseRegex('Get Started'))}`,
  );
  assert.equal(loose('-ios predicate string:name == "Continue" OR label == "Continue"'), '-ios predicate string:name == "Continue" OR label == "Continue"');
  globalThis.driver = { isAndroid: true };
  assert.equal(loose('android=new UiSelector().text("Log in now")'), `android=new UiSelector().textMatches(${JSON.stringify(looseRegex('Log in now'))})`);
  assert.equal(loose('~Log in now'), `android=new UiSelector().descriptionMatches(${JSON.stringify(looseRegex('Log in now'))})`);
  assert.equal(selText('-ios predicate string:name == "A b" OR label == "A b"'), 'A b');
  assert.equal(selText('-ios class chain:**/XCUIElementTypeButton'), null);
});

test('waitDisplayed: title tách 2 dòng bằng \\n vẫn tới được màn, ghi lệch locator 1 lần', async () => {
  const reports = tmpDir();
  device({ [LOOSE_TITLE]: TWO_LINES });
  const k = steps(reports);
  await k.waitDisplayed(1, 'Become a better cook', TITLE, `~${TITLE}`, 1);
  await k.waitDisplayed(1, 'Become a better cook', TITLE, `~${TITLE}`, 1);
  assert.ok(!fs.existsSync(path.join(reports, 'locator-drift.jsonl'))); // không có REPORTS_DIR → không ghi file
});

test('lệch khoảng trắng ghi vào REPORTS_DIR/locator-drift.jsonl; runner gộp + in danh sách', async () => {
  const reports = tmpDir();
  process.env.REPORTS_DIR = reports;
  try {
    device({ [LOOSE_TITLE]: TWO_LINES });
    const k = steps(reports);
    await k.waitDisplayed(1, 'Become a better cook', TITLE, `~${TITLE}`, 1);
    await k.waitDisplayed(1, 'Become a better cook', TITLE, `~${TITLE}`, 1);
  } finally {
    delete process.env.REPORTS_DIR;
  }
  const drift = readDrift(reports);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].locator, `~${TITLE}`);
  assert.equal(drift[0].actual, TWO_LINES);
  assert.match(driftLog(drift).join('\n'), /1 locator lệch[\s\S]*~Become a better cook with Tastory → app: "Become a better cook\\nwith Tastory"/);
});

const XML = `<XCUIElementTypeApplication name="Tastory"><XCUIElementTypeStaticText name="Become a better cook with Tastory!" label="Become a better cook with Tastory!" visible="true" x="20" y="100" width="300" height="60"/><XCUIElementTypeButton name="Continue" label="Continue" visible="true" x="20" y="700" width="300" height="50"/></XCUIElementTypeApplication>`;
const FOUND = '~Become a better cook with Tastory!';
const FOUND_LOOSE = `-ios predicate string:name MATCHES ${JSON.stringify(looseRegex('Become a better cook with Tastory!'))}`;

test('chờ màn hết giờ, chữ đổi nhẹ → tự tìm theo chữ trên màn, đi tiếp; không lưu override, không gọi AI, ghi lệch', async () => {
  const reports = tmpDir();
  device({ [FOUND_LOOSE]: 'Become a better cook with Tastory!' }, { xml: XML });
  let ai = 0;
  globalThis.fetch = async () => { ai++; return { ok: true, json: async () => ({ locator: FOUND }) }; };
  process.env.REPORTS_DIR = reports;
  try {
    const k = steps(reports, { QAPD_API: 'http://x/api', APP_ID: 'a' });
    await k.waitDisplayed(1, 'Become a better cook', TITLE, `~${TITLE}`, 0.01);
    await k.nav('Become a better cook', `~${TITLE}`, `tiêu đề "${TITLE}"`, 10);
  } finally {
    delete process.env.REPORTS_DIR;
  }
  assert.equal(ai, 0);
  assert.deepEqual(readOverrides(reports), {});
  assert.match(fs.readFileSync(path.join(reports, 'live.jsonl'), 'utf8'), /tìm thấy chữ gần giống → ~Become a better cook with Tastory! — đi tiếp, chỉ dùng lần này/);
  const drift = readDrift(reports);
  assert.equal(drift.length, 1); // cùng màn + locator → 1 dòng
  assert.equal(drift[0].found, FOUND);
});

test('chờ màn: màn đang hiện không có chữ gần giống → vẫn Blocked như cũ (không AI chọn bừa)', async () => {
  const reports = tmpDir();
  device({}, { xml: XML });
  let ai = 0;
  globalThis.fetch = async () => { ai++; return { ok: true, json: async () => ({ locator: '~Continue' }) }; };
  const k = steps(reports, { QAPD_API: 'http://x/api', APP_ID: 'a' });
  await assert.rejects(k.waitDisplayed(1, 'Paywall', 'Start my free week', '~Start my free week', 0.01), /Không tới được màn Paywall: "Start my free week" không hiện/);
  assert.equal(ai, 0);
});

test('buildStamp đổi khi build đổi dù version giữ nguyên; buildNotes cảnh báo build khác run trước + map cũ hơn build', () => {
  const app = path.join(tmpDir(), 'Recime.app');
  fs.mkdirSync(path.join(app, '_CodeSignature'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Info.plist'), 'v1.0.4 (2)');
  fs.writeFileSync(path.join(app, '_CodeSignature/CodeResources'), 'hash-a');
  const a = buildStamp(app);
  fs.writeFileSync(path.join(app, '_CodeSignature/CodeResources'), 'hash-b');
  const b = buildStamp(app);
  assert.notEqual(a.stamp, b.stamp);
  assert.equal(buildStamp('/khong/co'), null);

  const mapFile = path.join(tmpDir(), 'map.js');
  fs.writeFileSync(mapFile, '');
  fs.utimesSync(mapFile, new Date('2026-11-03T06:14:00Z'), new Date('2026-11-03T06:14:00Z'));
  const notes = buildNotes({ build: { ...b, at: '2026-11-03T07:23:00Z' }, prev: { id: 'RUN-0123', build: a }, mapFile });
  assert.equal(notes.length, 2);
  assert.match(notes[0], /Build khác lần chạy trước \(RUN-0123\)/);
  assert.match(notes[1], /Locator map lấy lúc .* trước khi có build này/);
  assert.deepEqual(buildNotes({ build: { ...b, at: '2026-11-03T06:00:00Z' }, prev: { id: 'R', build: b }, mapFile }), []);
});

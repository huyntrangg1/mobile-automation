// Các lỗi an toàn / kết quả sai tìm được khi review phần chạy test (tool dùng cho nhiều dự án → quy tắc chung, không theo app)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './helpers.js';

const { createSteps, smartPick } = await import('../server/apps/template/src/runner/steps.js');
const { recordEdge, findPath, walkPath } = await import('../server/apps/template/src/runner/navgraph.js');

function device(present, { source = '<x/>', alert = [] } = {}) {
  const taps = [];
  globalThis.driver = {
    isAndroid: false,
    getPageSource: async () => (typeof source === 'function' ? source() : source),
    execute: async (cmd) => (cmd === 'mobile: alert' ? alert : null),
    waitUntil: async (fn) => fn(),
    getWindowRect: async () => ({ width: 400, height: 800 }),
  };
  globalThis.browser = { saveScreenshot: async () => {} };
  globalThis.$ = (sel) => ({
    waitForExist: async () => { if (!present.has(sel)) throw new Error(`element ("${sel}") still not existing after 10ms`); },
    waitForDisplayed: async () => { if (!present.has(sel)) throw new Error('not displayed'); },
    click: async () => { taps.push(sel); },
    getText: async () => sel,
    getAttribute: async () => null,
    isDisplayed: async () => present.has(sel),
  });
  return { taps };
}
const steps = (env = {}, extra = {}) => createSteps({ sa: { eq() {} }, logStep: extra.logStep || (() => {}), snapshot: async () => ({ k: null }), env: { SYSTEM_ALERT: 'smart', ...env }, cwd: tmpDir(), tc: 'TC_S', ...extra });

test('smartPick: alert của app (Cancel / OK, Delete / Cancel) → KHÔNG tự bấm; hộp xin quyền hệ thống → cho phép / từ chối theo dõi', () => {
  assert.equal(smartPick(['Cancel', 'OK']), null);
  assert.equal(smartPick(['Delete', 'Cancel']), null);
  assert.equal(smartPick(['OK']), null);
  assert.equal(smartPick(['Don’t Allow', 'OK']), 'OK');
  assert.equal(smartPick(['Don’t Allow', 'Allow']), 'Allow');
  assert.equal(smartPick(['Ask App Not to Track', 'Allow']), 'Ask App Not to Track');
  assert.equal(smartPick(['Allow Once', 'Allow While Using App', 'Don’t Allow']), 'Allow While Using App');
  assert.equal(smartPick(['Allow Full Access', 'Limit Access…', 'Don’t Allow']), 'Allow Full Access');
  assert.equal(smartPick(['Keep Only While Using', 'Change to Always Allow']), 'Keep Only While Using');
});

test('đóng popup: màn có "Skip" + link "Log in" (onboarding) → KHÔNG bấm Skip khi bước kiểm sai', async () => {
  const { taps } = device(new Set(['~Skip']), { source: '<XCUIElementTypeButton name="Skip" visible="true"/><XCUIElementTypeButton name="Already have an account? Log in" visible="true"/>' });
  const k = steps({ SYSTEM_ALERT: 'off' });
  await k.shown(1, 'Welcome', 'Get Started', 'Nút Get Started', 'sel-missing', { timeout: 10 });
  assert.deepEqual(taps, []);
});

test('chữ thoáng qua: thấy sau lần bấm A, nhưng sau đó có lần bấm B → bước kiểm sau B không được tính là đã thấy', async () => {
  let src = '<XCUIElementTypeStaticText name="Loading…"/>';
  const present = new Set(['~A', '~B']);
  device(present, { source: () => src });
  const eqs = [];
  const notes = [];
  const k = createSteps({ sa: { eq: (...a) => eqs.push(a) }, logStep: (s) => notes.push(s), snapshot: async () => ({ k: null }), env: { SYSTEM_ALERT: 'off', AUTO_RESOLVE: '0' }, cwd: tmpDir(), tc: 'TC_T', watch: ['Loading…'] });
  await k.tap(1, 'S', 'A', '~A');
  src = '<x/>';
  await new Promise((r) => setTimeout(r, 5));
  await k.tap(2, 'S', 'B', '~B');
  await k.text(3, 'S', 'Loading…', 'Đang tải', '~missing', 'Loading…', { timeout: 10 });
  assert.equal(eqs.length, 0); // không kiểm được → không ghi Pass giả
  assert.ok(notes.some((n) => /Không kiểm được: chữ thoáng qua/.test(n.note || '')));
});

test('Run check: hook chưa khai báo → "không kiểm được" (ghi chú), không Blocked cả chuỗi', async () => {
  device(new Set());
  const notes = [];
  const k = steps({}, { logStep: (s) => notes.push(s) });
  await k.runCheck(1, 'Home', 'some_backend_flag_is_on', 'Cờ backend bật');
  assert.ok(notes.some((n) => /Không kiểm tự động được \(chưa khai báo hook check "some_backend_flag_is_on"/.test(n.note || '')));
});

test('AI hỗ trợ: AI_ASSIST_MAX=0 thật sự tắt (không bị đổi thành mặc định); có ngân sách gọi AI mỗi case', async () => {
  device(new Set());
  let calls = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ action: 'wait', reason: 'chờ' }) }; };
  try {
    const k = steps({ AI_ASSIST: '1', QAPD_API: 'http://x', APP_ID: 'a', AI_ASSIST_MAX: '0', AUTO_RESOLVE: '0', EARLY_STUCK: '0' });
    await assert.rejects(k.tap(1, 'S', 'Go', 'sel-go'), /still not existing/);
    assert.equal(calls, 0);
    const k2 = steps({ AI_ASSIST: '1', QAPD_API: 'http://x', APP_ID: 'a', AI_ASSIST_BUDGET: '2', AUTO_RESOLVE: '0', EARLY_STUCK: '0' });
    await assert.rejects(k2.tap(1, 'S', 'Go', 'sel-go'), /still not existing/);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = real; }
});

test('sơ đồ màn: không ghi / không đi theo nút mua; thiếu BUILD_STAMP → không ghi, không tìm đường', async () => {
  const cwd = tmpDir();
  const prev = process.env.BUILD_STAMP;
  try {
    delete process.env.BUILD_STAMP;
    recordEdge({ from: 'A', to: 'B', sel: '~Go', target: 'Go', arrive: { sel: '~B' } }, { cwd });
    assert.ok(!fs.existsSync(path.join(cwd, 'data/nav-graph.json')));
    process.env.BUILD_STAMP = 'b1';
    recordEdge({ from: 'Paywall', to: 'Home', sel: '~Start free trial', target: 'Start free trial', arrive: { sel: '~Home' } }, { cwd });
    recordEdge({ from: 'A', to: 'B', sel: '~Go', target: 'Go', arrive: { sel: '~B' } }, { cwd });
    assert.equal(findPath('Paywall', 'Home', { cwd }), null);
    assert.equal(findPath('A', 'B', { cwd }).length, 1);
    await assert.rejects(walkPath([{ from: 'P', to: 'H', sel: '~Subscribe', target: 'Subscribe', arrive: { sel: '~H' } }]), /nút mua/);
  } finally { if (prev === undefined) delete process.env.BUILD_STAMP; else process.env.BUILD_STAMP = prev; }
});

test('hộp xin quyền bật lên ở bước khác → vẫn tự đóng, kể cả case có bước "Tap Allow" ở chỗ khác (autoDismiss=false); bước nhắm đúng nút đó → không tự đóng', async () => {
  let alertUp = true;
  const accepted = [];
  const present = new Set();
  device(present);
  globalThis.driver.execute = async (cmd, o) => {
    if (cmd === 'mobile: alert' && o?.action === 'getButtons') return alertUp ? ['Don’t Allow', 'Allow'] : [];
    if (cmd === 'mobile: alert' && o?.action === 'accept') { accepted.push(o.buttonLabel); alertUp = false; present.add('sel-title'); }
    return null;
  };
  const k = createSteps({ sa: { eq() {} }, logStep() {}, snapshot: async () => ({ k: null }), env: { SYSTEM_ALERT: 'smart', AUTO_RESOLVE: '0', EARLY_STUCK: '0' }, cwd: tmpDir(), tc: 'TC_A', autoDismiss: false });
  await k.nav('How old are you?', 'sel-title', 'tiêu đề', 3000);
  assert.deepEqual(accepted, ['Allow']);
  // bước chờ chính nút "Allow" của hộp thoại → không tự bấm nó
  alertUp = true;
  accepted.length = 0;
  present.add('-ios predicate string:name == "Allow" OR label == "Allow"');
  await k.waitDisplayed(2, 'Health', 'Allow', undefined, 2);
  assert.deepEqual(accepted, []);
});

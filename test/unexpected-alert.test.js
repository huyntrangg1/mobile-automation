// Hộp thoại hệ thống ngoài test case (ATT bật lên lúc mở app / chuyển màn): step lỗi → tự đóng theo SYSTEM_ALERT rồi làm lại 1 lần
import test from 'node:test';
import assert from 'node:assert/strict';

const { createSteps } = await import('../server/apps/template/src/runner/steps.js');

// Alert che màn: phần tử app không tìm thấy cho tới khi alert được đóng
function setup({ buttons = ['Ask App Not to Track', 'Allow'], env = {}, present = ['sel-go'] } = {}) {
  let alert = [...buttons];
  const accepted = [];
  const taps = [];
  globalThis.driver = {
    isAndroid: false,
    waitUntil: async (fn, { timeout = 50 } = {}) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timeout'); },
    execute: async (cmd, o) => {
      if (o.action === 'getButtons') { if (!alert.length) throw new Error('no alert open'); return alert; }
      if (o.action === 'accept') { accepted.push(o.buttonLabel); alert = []; }
      return null;
    },
    getAlertText: async () => (alert.length ? '“Tastory” would like permission to track you' : null),
  };
  globalThis.$ = (sel) => ({
    waitForExist: async () => { if (alert.length || !present.includes(sel)) throw new Error(`element ("${sel}") still not existing after 10ms`); },
    click: async () => { taps.push(sel); },
    getAttribute: async () => 'Hello',
  });
  const steps = [];
  const eqs = [];
  const k = createSteps({ sa: { eq: (...a) => eqs.push(a) }, logStep: (e) => steps.push(e), snapshot: async () => ({ k: null }), env });
  return { k, accepted, taps, steps, eqs };
}

test('tap bị ATT che → tự "Ask App Not to Track" (mặc định deny), bấm lại được, ghi bước đóng hộp thoại, không bug', async () => {
  const s = setup();
  await s.k.tap(2, 'Welcome', 'Get started', 'sel-go');
  assert.deepEqual(s.accepted, ['Ask App Not to Track']);
  assert.deepEqual(s.taps, ['sel-go']);
  assert.deepEqual(s.steps.map((x) => [x.keyword, x.target]), [['Tap', 'Ask App Not to Track'], ['Tap', 'Get started']]);
});

test('SYSTEM_ALERT=allow → bấm "Allow"; off → không đụng hộp thoại, lỗi như cũ', async () => {
  const a = setup({ env: { SYSTEM_ALERT: 'allow' } });
  await a.k.tap(2, 'Welcome', 'Get started', 'sel-go');
  assert.deepEqual(a.accepted, ['Allow']);
  const b = setup({ env: { SYSTEM_ALERT: 'off' } });
  await assert.rejects(b.k.tap(2, 'Welcome', 'Get started', 'sel-go'), /Không thấy "Get started"/);
  assert.deepEqual(b.accepted, []);
});

test('điểm kiểm sai vì hộp thoại che → đóng rồi kiểm lại (pass)', async () => {
  const s = setup({ present: ['sel-title'] });
  await s.k.shown(1, 'Welcome', 'Title', 'Tiêu đề hiện', 'sel-title');
  assert.deepEqual(s.accepted, ['Ask App Not to Track']);
  assert.equal(s.eqs[0][2], true);
});

test('không có hộp thoại → lỗi thật giữ nguyên, không bấm gì thêm', async () => {
  const s = setup({ buttons: [], present: [] });
  await assert.rejects(s.k.tap(2, 'Welcome', 'Get started', 'sel-go'), /Không thấy "Get started"/);
  assert.deepEqual(s.accepted, []);
});

test('k.alert (case chủ động kiểm hộp thoại) không bị tự đóng trước', async () => {
  const s = setup();
  await s.k.alert(3, 'Tracking', 'allow', { timeout: 30 });
  assert.deepEqual(s.accepted, ['Allow']);
});

test('bước "Ask App Not to Track" (tap / permission) mà ATT đã được tự đóng trước đó → ghi bước, đi tiếp, không chặn', async () => {
  const s = setup({ buttons: [] });
  await s.k.tap(0, 'Welcome', 'Ask App Not to Track');
  await s.k.permission(0, 'Welcome', 'Ask App Not to Track', "Don't allow", { timeout: 30 });
  assert.deepEqual(s.accepted, []);
  assert.deepEqual(s.steps.map((x) => [x.keyword, x.target, x.value]), [
    ['Handle permission', 'Ask App Not to Track', 'không hiện — đã tự đóng trước đó hoặc iOS không hỏi'],
    ['Handle permission', 'Ask App Not to Track', 'không hiện — đã tự đóng trước đó hoặc iOS không hỏi'],
  ]);
});

test('bước "Ask App Not to Track" khi ATT đang hiện → bấm đúng nút; hộp thoại thông báo vắng vẫn chặn như cũ', async () => {
  const s = setup();
  await s.k.tap(0, 'Welcome', 'Ask App Not to Track');
  assert.deepEqual(s.accepted, ['Ask App Not to Track']);
  const n = setup({ buttons: [] });
  await assert.rejects(n.k.permission(1, 'Notification', 'Notifications', 'Allow', { timeout: 30 }), /không thấy hộp thoại hệ thống/);
});

test('Verify displayed / not displayed với phần tử chỉ có toạ độ (point:…) → ghi bước bỏ qua, không gọi Appium, không điểm kiểm', async () => {
  const s = setup({ buttons: [] });
  await s.k.shown(1, 'Paywall', 'Nút ✕ Paywall', 'Nút ✕ góc trên trái', 'point:0.075,0.067');
  await s.k.notShown(1, 'Paywall', 'Nút ✕ Paywall', 'Không có nút ✕', 'point:0.075,0.067');
  assert.equal(s.eqs.length, 0);
  assert.deepEqual(s.steps.map((x) => [x.keyword, x.target, /Bỏ qua/.test(x.note)]), [
    ['Verify displayed', 'Nút ✕ Paywall', true],
    ['Verify not displayed', 'Nút ✕ Paywall', true],
  ]);
});

test('k.nav với dấu hiệu chỉ có toạ độ (point:…) → không gọi Appium tìm phần tử, chờ màn đứng yên, ghi chú, không lỗi', async () => {
  const s = setup({ buttons: [] });
  let reads = 0;
  globalThis.driver.getPageSource = async () => { reads++; return '<same/>'; };
  await s.k.nav('Paywall', 'point:0.075,0.067', 'nút "Close"', 2000);
  assert.ok(reads >= 2);
  assert.equal(s.steps.at(-1).keyword, 'Verify screen');
  assert.match(s.steps.at(-1).note, /chỉ có toạ độ/);
});

test('chờ biến mất: phần tử còn trong cây nhưng không hiển thị (màn đã chuyển) → coi như đã biến mất', async () => {
  globalThis.driver = { isAndroid: false, waitUntil: async (fn, { timeout = 50 } = {}) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timeout'); }, execute: async () => [] };
  globalThis.$ = () => ({ waitForExist: async () => {}, isDisplayed: async () => false });
  const { createSteps } = await import('../server/apps/template/src/runner/steps.js');
  const steps = [];
  const k = createSteps({ sa: { eq() {} }, logStep: (e) => steps.push(e), snapshot: async () => ({}), env: { SYSTEM_ALERT: 'off', OCR: 'off' } });
  await k.waitNotDisplayed(3, 'Tutorial Social', 'Step 3 of 3', '~Step 3 of 3', 1);
  assert.equal(steps.at(-1).keyword, 'Wait until not displayed');
  globalThis.$ = () => ({ waitForExist: async () => {}, isDisplayed: async () => true });
  await assert.rejects(k.waitNotDisplayed(3, 'Tutorial Social', 'Step 3 of 3', '~Step 3 of 3', 0.05), /vẫn còn/);
  delete globalThis.driver; delete globalThis.$;
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { doAction, buyGuard, clampExplore, exploreLoop, MAX_OVERLAY_CLOSES } from '../server/locators/explore.js';
import { navigateTo } from '../server/locators/navigate.js';
import { looksLikeStoreSheet, purchaseCheck, pointCheck, elementsAtPoint, isBuyTarget } from '../server/smoke/guard.js';
import { resolveBuyCheck } from '../server/ai/resolve.js';

const el = (name, locator = `~${name}`, rect = { x: 0, y: 0, width: 100, height: 40 }, type = 'Button') => ({ type, name, label: name, locator, alts: [locator], rect, enabled: true });
const drv = ({ foreign = null, android = false } = {}) => {
  const clicks = [];
  return {
    clicks,
    getCurrentPackage: async () => foreign || 'com.my.app',
    execute: async (cmd) => (cmd === 'mobile: activeAppInfo' ? { bundleId: foreign || 'com.my.app' } : undefined),
    $: async (sel) => ({ click: async () => { clicks.push(sel); }, setValue: async () => { clicks.push(`type:${sel}`); } }),
    android,
  };
};
const IOS = { platform: 'iOS', bundleId: 'com.my.app' };
const AND = { platform: 'Android', bundleId: 'com.my.app' };

test('doAction có guard: Google Play đang ở trên (com.android.vending) → không bấm "Subscribe", vẫn bấm "Cancel"', async () => {
  const d = drv({ foreign: 'com.android.vending' });
  const logs = [];
  const els = [el('Subscribe'), el('Cancel')];
  assert.equal(await doAction(d, { action: 'tap', locator: '~Subscribe' }, (t) => logs.push(t), '', { app: AND, elements: els }), false);
  assert.match(logs.join('\n'), /Chặn: Đang ở tờ thanh toán/);
  assert.equal(await doAction(d, { action: 'tap', locator: '~Cancel' }, () => {}, '', { app: AND, elements: els }), true);
  assert.deepEqual(d.clicks, ['~Cancel']);
});

test('doAction có guard: tờ StoreKit hiện trong cây phần tử của app (Sandbox) → chặn nút xác nhận, chặn nhập (mật khẩu)', async () => {
  const d = drv();
  const els = [el('[Environment: Sandbox]', '~env', undefined, 'StaticText'), el('Subscribe'), el('Password', '~pw', undefined, 'SecureTextField')];
  assert.equal(await doAction(d, { action: 'tap', locator: '~Subscribe' }, () => {}, '', { app: IOS, elements: els }), false);
  assert.equal(await doAction(d, { action: 'type', locator: '~pw', text: 'x' }, () => {}, '', { app: IOS, elements: els }), false);
  assert.deepEqual(d.clicks, []);
});

test('doAction có guard: nút mua TRONG app (paywall) vẫn bấm được — mở tờ thanh toán là được', async () => {
  const d = drv();
  const els = [el('$9.99 / year', '~p', undefined, 'StaticText'), el('Subscribe'), el('Restore Purchases')];
  assert.equal(await doAction(d, { action: 'tap', locator: '~Subscribe' }, () => {}, '', { app: IOS, elements: els }), true);
  assert.deepEqual(d.clicks, ['~Subscribe']);
  // Không truyền guard (gọi cũ) → như trước
  assert.equal(await doAction(drv({ foreign: 'com.android.vending' }), { action: 'tap', locator: '~X' }, () => {}), true);
});

test('looksLikeStoreSheet: chữ riêng của tờ thanh toán; chú thích pháp lý trên paywall của app thì không', () => {
  assert.equal(looksLikeStoreSheet([el('Double Click to Subscribe', '~a', undefined, 'StaticText')]), true);
  assert.equal(looksLikeStoreSheet([el('Google Play', '~g', undefined, 'StaticText')]), true);
  assert.equal(looksLikeStoreSheet([el('1-tap buy')]), true);
  assert.equal(looksLikeStoreSheet([el('Payment will be charged to your App Store account at confirmation', '~l', undefined, 'StaticText')]), false);
  assert.equal(looksLikeStoreSheet([el('Subscribe'), el('$4.99', '~p', undefined, 'StaticText')]), false);
});

test('pointCheck: mọi phần tử chứa điểm (cả khung cha); không biết cỡ màn trên paywall → từ chối; tờ thanh toán chỉ chạm Cancel', () => {
  const win = { width: 400, height: 800 };
  const card = el('Start free trial', '~card', { x: 0, y: 500, width: 400, height: 200 });
  const price = el('$9.99', '~price', { x: 20, y: 520, width: 100, height: 30 }, 'StaticText');
  assert.deepEqual(elementsAtPoint([card, price], win, 10, 66.25).map((e) => e.name), ['$9.99', 'Start free trial']);
  // Phần tử nhỏ nhất là chữ giá, khung cha là nút mua → vẫn bắt được
  assert.equal(pointCheck([card, price], win, 10, 66.25, { buyCheck: (h) => isBuyTarget(h, true) }).ok, false);
  assert.equal(pointCheck([card], null, 10, 10, { paywall: true }).ok, false);
  assert.equal(pointCheck([card], null, 10, 10, {}).ok, true);
  const cancel = el('Cancel', '~c', { x: 300, y: 10, width: 80, height: 40 });
  assert.equal(pointCheck([card, cancel], win, 85, 3, { store: true }).ok, true);
  assert.equal(pointCheck([card, cancel], win, 50, 75, { store: true }).ok, false);
  assert.equal(purchaseCheck(null, { store: true }).ok, false);
});

test('clampExplore: ≤150 bước, ≤60 phút; số sai → mặc định', () => {
  assert.deepEqual(clampExplore({ maxSteps: 9999, maxMinutes: 600 }), { maxSteps: 150, maxMinutes: 60 });
  assert.deepEqual(clampExplore({ maxSteps: 'abc', maxMinutes: -5 }), { maxSteps: 60, maxMinutes: 20 });
  assert.deepEqual(clampExplore({ maxSteps: '30', maxMinutes: 10 }), { maxSteps: 30, maxMinutes: 10 });
});

test('buyGuard: app khác (không phải store, vd trình duyệt / quảng cáo) cũng chỉ cho đóng', async () => {
  const r = await buyGuard(drv({ foreign: 'com.android.chrome' }), { locator: '~Install' }, { app: AND, elements: [el('Install')] });
  assert.equal(r.ok, false);
});

test('navigateTo: bấm theo AI qua doAction luôn kèm guard { app, elements }; truyền signal cho runClaude', async () => {
  const seen = [];
  const signals = [];
  const ctl = new AbortController();
  const elements = [el('Go')];
  const ok = await navigateTo({
    target: { id: 'T', name: 'Target', elements: [] }, edges: { list: () => [], add: () => {} }, driver: { pause: async () => {} }, app: IOS,
    snap: async () => ({ screen: { id: 'S' }, elements }), log: () => {}, settle: async () => {},
    doAction: async (d, a, log, prefix, guard) => { seen.push(guard); return true; }, dismissAlert: async () => null, relaunch: async () => {},
    runClaude: async (o) => { signals.push(o.signal); return seen.length ? { ok: true, data: { action: 'giveup', screenName: 's', reason: 'r' } } : { ok: true, data: { action: 'tap', locator: '~Go', screenName: 's', reason: 'r' } }; },
    screens: () => [], signal: ctl.signal, maxSteps: 3,
  });
  assert.equal(ok, false);
  assert.deepEqual(seen[0], { app: IOS, elements });
  assert.equal(signals[0], ctl.signal);
});

test('exploreLoop: truyền AbortSignal của job cho runClaude; thao tác theo AI đi qua guard (store đang ở trên → không bấm)', async () => {
  const ctl = new AbortController();
  const job = { stop: false, ctl };
  const signals = [];
  const clicks = [];
  const elements = [el('Subscribe'), el('Other')];
  const driver = {
    pause: async () => {}, getWindowSize: async () => ({ width: 400, height: 800 }),
    execute: async (cmd) => { if (cmd === 'mobile: activeAppInfo') return { bundleId: 'com.apple.ios.StoreKitUIService' }; if (cmd === 'mobile: alert') throw new Error('no alert'); return '<x/>'; },
    getPageSource: async () => '<x/>',
    $: async (sel) => ({ click: async () => { clicks.push(sel); } }),
    back: async () => {},
  };
  let n = 0;
  await exploreLoop('c', 'a', driver, job, {
    app: IOS, maxSteps: 2, snap: async () => ({ screen: { id: 'S', name: 'S' }, isNew: false, elements }), log: () => {}, update: () => {}, renameScreen: () => {}, screens: () => [],
  }, { runClaude: async (o) => { signals.push(o.signal); return ++n === 1 ? { ok: true, data: { action: 'tap', locator: '~Subscribe', screenName: 'S', reason: 'r' } } : { ok: true, data: { action: 'done', screenName: 'S', reason: 'r' } }; }, settleOpts: { pollMs: 1, quietMs: 1, maxMs: 5 } });
  assert.ok(signals.length >= 1 && signals.every((s) => s === ctl.signal));
  assert.ok(!clicks.includes('~Subscribe'));
  assert.ok(MAX_OVERLAY_CLOSES >= 1);
});

test('/resolve: không trả locator của nút mua / nút trên tờ thanh toán (trình chạy lưu thành override)', () => {
  const els = [el('Subscribe'), el('Close'), el('Log In')];
  assert.equal(resolveBuyCheck('~Subscribe', els, 'Nút Back').ok, false);
  assert.equal(resolveBuyCheck('~Log In', els, 'Log In').ok, true);
  assert.equal(resolveBuyCheck('~Close', els, 'X').ok, true);
  // Test case cố ý bấm nút mua trong app (mở tờ thanh toán) → cho phép
  assert.equal(resolveBuyCheck('~Subscribe', els, 'Subscribe button').ok, true);
  // Trên tờ thanh toán: chỉ đóng / huỷ
  const sheet = [el('[Environment: Sandbox]', '~e', undefined, 'StaticText'), el('Subscribe'), el('Cancel')];
  assert.equal(resolveBuyCheck('~Subscribe', sheet, 'Subscribe').ok, false);
  assert.equal(resolveBuyCheck('~Cancel', sheet, 'Cancel').ok, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStore } from '../server/store.js';
import { createLock } from '../server/lock.js';
import { createScreenMap } from '../server/locators/screenMap.js';
import { createCaptures } from '../server/locators/record.js';
import { exploreLoop } from '../server/locators/explore.js';
import { tmpDir } from './helpers.js';

const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}.xml`, import.meta.url), 'utf8');
const EMAIL_BTN = '-ios predicate string:type == "XCUIElementTypeButton" AND name == "Continue with email"';

// App giả 2 màn: Welcome --tap "Continue with email"--> Log In --tap ~Back--> Welcome
const EMPTY = '<?xml version="1.0"?><AppiumAUT><XCUIElementTypeApplication name="FitAgain" width="440" height="956"/></AppiumAUT>';

function fakeApp({ emptyFirst = false } = {}) {
  const st = { cur: 'welcome', taps: [], typed: [], reads: 0 };
  const driver = {
    getPageSource: async () => (emptyFirst && st.reads++ === 0 ? EMPTY : fx(st.cur === 'welcome' ? 'welcome' : 'login-empty')),
    takeScreenshot: async () => Buffer.from('png').toString('base64'),
    pause: async () => {},
    execute: async () => { throw new Error('no alert open'); },
    $: async (sel) => ({
      click: async () => { st.taps.push(sel); if (sel === EMAIL_BTN) st.cur = 'login'; if (sel === '~Back') st.cur = 'welcome'; },
      setValue: async (v) => { st.typed.push([sel, v]); },
      waitForExist: async () => true,
    }),
  };
  return { st, open: async () => ({ driver, close: async () => {} }) };
}

function setup(answers, appOpts) {
  const dataDir = tmpDir();
  const store = createStore(dataDir);
  store.put('apps', { id: 'ikf', workspace: tmpDir(), status: 'ready', bundleId: 'b', appPath: '/x.app' });
  const lock = createLock();
  const app = fakeApp(appOpts);
  const prompts = [];
  let i = 0;
  const runClaude = async ({ prompt }) => { prompts.push(prompt); const a = answers[Math.min(i++, answers.length - 1)]; return typeof a === 'function' ? a() : a; };
  const caps = createCaptures({ store, lock, emit: () => {}, map: createScreenMap({ store, dataDir }), openSession: app.open,
    loops: { explore: (...args) => exploreLoop(...args, { runClaude, settleOpts: { pollMs: 1, quietMs: 5, maxMs: 30 } }) }, pollMs: 1 });
  return { store, lock, caps, app, prompts };
}

const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); }
};
const ok = (data) => ({ ok: true, data });

test('AI bấm sang Log In rồi done → 2 màn, status done, tên màn theo AI', async () => {
  const { store, caps, app } = setup([
    ok({ action: 'tap', locator: EMAIL_BTN, screenName: 'Welcome', reason: 'mở form email' }),
    ok({ action: 'done', screenName: 'Log In', reason: 'đủ' }),
  ]);
  const id = await caps.start('ikf', { mode: 'explore', udid: 'U', maxSteps: 10 });
  await until(() => store.get('captures', id).status !== 'running');
  const c = store.get('captures', id);
  assert.equal(c.status, 'done');
  assert.equal(c.screensFound, 2);
  assert.deepEqual(app.st.taps, [EMAIL_BTN]);
  assert.deepEqual(store.list('screens').map((s) => s.name).sort(), ['Log In', 'Welcome']);
});

test('locator AI bịa không có trên màn → không bấm, log "bỏ qua"', async () => {
  const { store, caps, app } = setup([
    ok({ action: 'tap', locator: '~Không có nút này', screenName: 'Welcome', reason: 'x' }),
    ok({ action: 'done', screenName: 'Welcome', reason: 'x' }),
  ]);
  const id = await caps.start('ikf', { mode: 'explore', udid: 'U' });
  await until(() => store.get('captures', id).status !== 'running');
  assert.deepEqual(app.st.taps, []);
  assert.ok(store.get('captures', id).log.some((l) => /bỏ qua/i.test(l.text)));
});

test('3 lỗi AI liên tiếp → error, lock nhả', async () => {
  const { store, caps, lock } = setup([{ ok: false, error: 'Claude quá thời gian' }]);
  const id = await caps.start('ikf', { mode: 'explore', udid: 'U' });
  await until(() => store.get('captures', id).status !== 'running');
  const c = store.get('captures', id);
  assert.equal(c.status, 'error');
  assert.match(c.error, /quá thời gian/);
  assert.equal(lock.current(), null);
});

test('hết maxSteps → done, số bước đúng', async () => {
  const { store, caps } = setup([ok({ action: 'tap', locator: '~Back', screenName: 'X', reason: 'x' })]);
  const id = await caps.start('ikf', { mode: 'explore', udid: 'U', maxSteps: 3 });
  await until(() => store.get('captures', id).status !== 'running');
  assert.equal(store.get('captures', id).status, 'done');
  assert.equal(store.get('captures', id).steps, 3);
});

test('prompt có gợi ý dữ liệu và thao tác đã thử ở màn này', async () => {
  const { store, caps, prompts } = setup([
    ok({ action: 'type', locator: '~Welcome', text: 'a@b.c', screenName: 'Welcome', reason: 'x' }),
    ok({ action: 'done', screenName: 'Welcome', reason: 'x' }),
  ]);
  const id = await caps.start('ikf', { mode: 'explore', udid: 'U', hints: { email: 'qa@ik.com' } });
  await until(() => store.get('captures', id).status !== 'running');
  assert.match(prompts[0], /qa@ik\.com/);
  assert.match(prompts[1], /type ~Welcome/);
});

test('màn rỗng lúc app đang tải không được lưu thành màn', async () => {
  const { store, caps } = setup([ok({ action: 'done', screenName: 'X', reason: 'x' })], { emptyFirst: true });
  const id = await caps.start('ikf', { mode: 'explore', udid: 'U' });
  await until(() => store.get('captures', id).status !== 'running');
  assert.equal(store.list('screens').filter((s) => s.elements.length === 0).length, 0);
});

test('kế hoạch theo màn: AI đề xuất thêm thao tác (next) → quay lại màn thì làm tiếp theo kế hoạch, không hỏi AI lại', async () => {
  const GUEST = '-ios predicate string:type == "XCUIElementTypeButton" AND name == "Continues as guest"';
  const { store, caps, app, prompts } = setup([
    // Welcome: bấm email, đề xuất thêm "guest" (+ một mục trùng thao tác vừa làm → bị bỏ)
    ok({ action: 'tap', locator: EMAIL_BTN, screenName: 'Welcome', reason: 'mở form email', next: [{ action: 'tap', locator: EMAIL_BTN }, { action: 'tap', locator: GUEST, reason: 'thử guest' }] }),
    ok({ action: 'back', screenName: 'Log In', reason: 'về' }), // Log In → Back về Welcome
    ok({ action: 'done', screenName: 'Welcome', reason: 'đủ' }),
  ]);
  const id = await caps.start('ikf', { mode: 'explore', udid: 'U', maxSteps: 4 });
  await until(() => store.get('captures', id).status !== 'running');
  // Về Welcome lần 2: bấm "guest" theo kế hoạch, không gọi AI → 2 lần hỏi AI cho 3 thao tác
  assert.deepEqual(app.st.taps.filter((t) => t !== '~Back'), [EMAIL_BTN, GUEST]);
  assert.ok(store.get('captures', id).log.some((l) => /\(theo kế hoạch\) Bấm/.test(l.text)));
  assert.equal(prompts.length, 3); // bước 4 (Welcome, hết kế hoạch) mới hỏi lại → done
});

test('settle: ghi màn trung gian đứng yên ≥ 1 vòng (vd Importing), bỏ khung hình chỉ thoáng qua', async () => {
  const { settle } = await import('../server/locators/explore.js');
  // welcome thoáng qua 1 lần → bỏ; login đứng yên vài vòng (màn trung gian) → ghi; welcome cuối đứng yên → ghi
  const seq = ['welcome', 'login-empty', 'login-empty', 'login-empty', 'welcome'];
  let i = 0;
  const driver = { execute: async () => fx(seq[Math.min(i++, seq.length - 1)]), getPageSource: async () => fx('welcome') };
  const snaps = [];
  await settle(driver, async () => { snaps.push(seq[Math.min(i - 1, seq.length - 1)]); }, { pollMs: 1, quietMs: 40, maxMs: 500 });
  assert.deepEqual(snaps, ['login-empty', 'welcome']);
});

// ---- Paywall / IAP: tool không mua, tự đóng
import { looksLikePaywall, closeCandidates, closeOverlay } from '../server/locators/overlay.js';

const el = (type, name, x = 0, y = 0, w = 100, h = 40, extra = {}) => ({ type, name, label: '', value: '', rect: { x, y, width: w, height: h }, visible: true, enabled: true, locator: `~${name || 'nameless'}${x}`, alts: [], ...extra });

test('nhận ra paywall: có giá + từ khoá đăng ký; màn thường thì không', () => {
  assert.equal(looksLikePaywall([el('StaticText', 'Go Premium'), el('StaticText', '$9.99 / month'), el('Button', 'Continue')]), true);
  assert.equal(looksLikePaywall([el('Button', 'Restore Purchases')]), true);
  assert.equal(looksLikePaywall([el('StaticText', 'Welcome'), el('Button', 'Continue')]), false);
});

test('ứng viên đóng: nút có tên trước, X không tên ở mép trên; không bao giờ chọn nút Subscribe', () => {
  const els = [el('Button', 'Subscribe', 20, 800, 360, 50), el('Button', '', 350, 40, 40, 40, { locator: 'X-corner' }), el('Button', 'Not now', 100, 700)];
  const c = closeCandidates(els, { width: 400, height: 900 }).map((e) => e.name || e.locator);
  assert.deepEqual(c, ['Not now', 'X-corner']);
});

test('closeOverlay: bấm X không tên; lần sau không bấm lặp; Android hết nút thì Back', async () => {
  const clicks = []; let backs = 0;
  const driver = { execute: async () => { throw new Error('x'); }, getCurrentPackage: async () => 'b', back: async () => { backs++; }, $: async (s) => ({ click: async () => { clicks.push(s); } }) };
  const els = [el('Button', '', 350, 40, 40, 40, { locator: 'X-corner' })];
  const tried = new Set();
  const app = { platform: 'Android', bundleId: 'b' };
  assert.match(await closeOverlay(driver, els, { app, win: { width: 400, height: 900 }, tried }), /không tên/);
  assert.equal(await closeOverlay(driver, els, { app, win: { width: 400, height: 900 }, tried }), 'Back hệ thống');
  assert.equal(await closeOverlay(driver, els, { app, win: { width: 400, height: 900 }, tried }), null);
  assert.deepEqual(clicks, ['X-corner']);
  assert.equal(backs, 1);
});

test('Android: app khác (Play sheet) đang ở trên → Back', async () => {
  let backs = 0;
  const driver = { getCurrentPackage: async () => 'com.android.vending', back: async () => { backs++; }, execute: async () => null, $: async () => ({ click: async () => {} }) };
  assert.match(await closeOverlay(driver, [], { app: { platform: 'Android', bundleId: 'b' } }), /Back khỏi com\.android\.vending/);
  assert.equal(backs, 1);
});

test('fromCurrent: gắn vào app đang mở (attachSession), không mở phiên mới cài lại app', async () => {
  const dataDir = tmpDir();
  const store = createStore(dataDir);
  store.put('apps', { id: 'ikf', workspace: tmpDir(), status: 'ready', bundleId: 'b', appPath: '/x.app' });
  const app = fakeApp();
  const used = [];
  const caps = createCaptures({ store, lock: createLock(), emit: () => {}, map: createScreenMap({ store, dataDir }),
    openSession: async (o) => { used.push('open'); return app.open(o); }, attachSession: async (o) => { used.push('attach'); return app.open(o); },
    loops: { explore: async () => {} }, pollMs: 1 });
  const id = await caps.start('ikf', { mode: 'explore', udid: 'U', fromCurrent: true });
  await until(() => store.get('captures', id).status !== 'running');
  assert.deepEqual(used, ['attach']);
});

import { nextEdge } from '../server/locators/navigate.js';

test('nextEdge: đường ngắn nhất, bỏ cạnh hỏng, không có đường thì null', () => {
  const E = [{ id: 1, from: 'A', to: 'B', locator: 'a' }, { id: 2, from: 'B', to: 'C', locator: 'b' }, { id: 3, from: 'A', to: 'C', locator: 'c' }, { id: 4, from: 'C', to: 'D', locator: 'd' }];
  assert.equal(nextEdge(E, 'A', 'D').id, 3);
  assert.equal(nextEdge(E, 'A', 'D', new Set([3])).id, 1);
  assert.equal(nextEdge(E, 'D', 'A'), null);
});

test('startScreenId: đi tới màn đã có theo đường đã ghi (không hỏi AI dẫn đường) rồi mới khám phá', async () => {
  const { store, caps, app, prompts } = setup([
    ok({ action: 'tap', locator: EMAIL_BTN, screenName: 'Welcome', reason: 'mở form email' }),
    ok({ action: 'done', screenName: 'Log In', reason: 'đủ' }),
  ]);
  const first = await caps.start('ikf', { mode: 'explore', udid: 'U', maxSteps: 10 });
  await until(() => store.get('captures', first).status !== 'running');
  assert.equal(store.list('edges').length, 1);
  const login = store.list('screens').find((s) => s.name === 'Log In');
  app.st.cur = 'welcome';
  app.st.taps.length = 0;
  const askedBefore = prompts.length;
  const second = await caps.start('ikf', { mode: 'explore', udid: 'U', maxSteps: 10, startScreenId: login.id });
  await until(() => store.get('captures', second).status !== 'running');
  assert.equal(store.get('captures', second).status, 'done');
  assert.deepEqual(app.st.taps, [EMAIL_BTN]);
  assert.equal(prompts.length - askedBefore, 1); // chỉ 1 lần hỏi: khám phá ở màn Log In
});

test('startScreenId không có trong map → 400', async () => {
  const { caps } = setup([ok({ action: 'done', screenName: 'x', reason: 'x' })]);
  await assert.rejects(caps.start('ikf', { mode: 'explore', udid: 'U', startScreenId: 'nope' }), /không có trong locator map/);
});

test('paywall không có nút nào trong cây phần tử (như Moss Pro: chỉ StaticText + Cell) → nhận ra, chạm mù góc trên phải rồi trái, không bao giờ chạm Start Free Trial', async () => {
  const els = [el('Cell', '', 0, 0, 402, 325), el('StaticText', 'Moss Pro:', 16, 348), el('StaticText', '$49.99', 154, 460), el('StaticText', 'Best value', 178, 434), el('StaticText', 'Restore Purchase', 181, 652), el('StaticText', 'Start Free Trial', 32, 801, 338, 25)];
  assert.equal(looksLikePaywall(els), true);
  const taps = [];
  const driver = { execute: async (c, o) => { if (c === 'mobile: tap') taps.push([o.x, o.y]); else throw new Error('x'); }, $: async () => ({ click: async () => { throw new Error('no'); } }) };
  const tried = new Set();
  const args = { app: { platform: 'iOS', bundleId: 'b' }, win: { width: 402, height: 874 }, tried };
  assert.match(await closeOverlay(driver, els, args), /góc phải trên/);
  assert.match(await closeOverlay(driver, els, args), /góc trái trên/);
  assert.equal(await closeOverlay(driver, els, args), null);
  assert.deepEqual(taps, [[370, 66], [32, 66]]);
});

import { tapAway } from '../server/locators/overlay.js';
test('tapAway: popup chỉ có chữ → chạm trên rồi dưới, hết thì null; Android dùng clickGesture', async () => {
  const calls = [];
  const driver = { execute: async (c, o) => { calls.push([c, o.x, o.y]); } };
  const tried = new Set();
  const a = { app: { platform: 'Android' }, tried };
  assert.match(await tapAway(driver, { width: 1080, height: 2400 }, a), /phía trên/);
  assert.match(await tapAway(driver, { width: 1080, height: 2400 }, a), /phía dưới/);
  assert.equal(await tapAway(driver, { width: 1080, height: 2400 }, a), null);
  assert.deepEqual(calls.map((c) => c[0]), ['mobile: clickGesture', 'mobile: clickGesture']);
});

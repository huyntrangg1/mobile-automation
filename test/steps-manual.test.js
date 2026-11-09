// k ở chế độ sửa tay khi lỗi (MANUAL_FIX=1): hỏi tester qua help.json / answer.json rồi làm theo
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './helpers.js';
import { loose } from '../server/apps/template/src/utils/ui.js';

const { createSteps, readOverrides } = await import('../server/apps/template/src/runner/steps.js');

// Thiết bị giả: chỉ các selector trong `present` tồn tại; tap ghi lại selector
function device(present) {
  const taps = [];
  const execs = [];
  const swipes = []; // nét kéo (W3C actions): [điểm đầu, điểm cuối]
  let rect = 0;
  globalThis.driver = {
    isAndroid: false,
    waitUntil: async (fn, { timeout = 50 } = {}) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timeout'); },
    execute: async (cmd, o) => { execs.push([cmd, o]); return []; },
    getWindowRect: async () => { rect++; return { x: 0, y: 0, width: 400, height: 800 }; },
  };
  const chain = (pts = []) => ({ move: (p) => chain([...pts, p]), down: () => chain(pts), pause: () => chain(pts), up: () => chain(pts), perform: async () => { swipes.push([pts[0], pts.at(-1)]); } });
  globalThis.browser = { saveScreenshot: async (f) => fs.writeFileSync(f, 'png'), getPageSource: async () => '<xml/>', action: () => chain() };
  // runner gửi locator theo chữ ở dạng khớp lỏng (ui.loose) → quy về locator gốc trong present
  const orig = (sel) => [...present].find((p) => p === sel || loose(p) === sel) || sel;
  globalThis.$ = (sel) => ({
    waitForExist: async () => { if (!present.has(orig(sel))) throw new Error(`element ("${orig(sel)}") still not existing after 10ms`); },
    click: async () => { taps.push(orig(sel)); },
  });
  return { taps, execs, swipes, present, rects: () => rect };
}

// Tester giả: thấy help.json thì trả lần lượt các câu trả lời
function tester(dir, answers) {
  const asked = [];
  const t = setInterval(() => {
    const f = path.join(dir, 'help.json');
    if (!fs.existsSync(f) || fs.existsSync(path.join(dir, 'answer.json'))) return;
    const h = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (asked.some((x) => x.id === h.id)) return;
    asked.push(h);
    const { before, ...a } = answers.shift() || { action: 'block' };
    before?.();
    fs.writeFileSync(path.join(dir, 'answer.json'), JSON.stringify({ id: h.id, ...a }));
  }, 5);
  t.unref();
  return { asked, stop: () => clearInterval(t) };
}

function setup(present, answers, { manual = true, summarize } = {}) {
  const dir = tmpDir();
  const dev = device(new Set(present));
  const bugs = [];
  const notes = [];
  const env = manual ? { MANUAL_FIX: '1', HELP_DIR: dir, HELP_POLL_MS: '5', HELP_KEEPALIVE_MS: '20', LIVE_STEPS: path.join(dir, 'live.jsonl') } : {};
  const k = createSteps({ sa: { eq() {} }, logStep() {}, snapshot: async () => ({ k: null }), flowBug: (b) => bugs.push(b), noteScreen: (n) => notes.push(n), summarize: summarize || (async () => ({ title: 'T' })), env, cwd: dir, tc: 'TC_1' });
  const t = tester(dir, answers);
  return { dir, dev, bugs, notes, k, t };
}

test('chế độ tắt: tap thiếu phần tử ném lỗi như cũ, không hỏi', async () => {
  const { k, dir, t } = setup([], [], { manual: false });
  await assert.rejects(k.tap(1, 'Welcome', 'Go', 'sel-go'), /still not existing/);
  assert.ok(!fs.existsSync(path.join(dir, 'help.json')));
  t.stop();
});

test('block → ném lỗi gốc; help.json có đủ thông tin + dòng live', async () => {
  const { k, dir, t } = setup([], [{ action: 'block' }]);
  await assert.rejects(k.tap(2, 'Welcome', 'Go', 'sel-go'), /still not existing/);
  const h = t.asked[0];
  assert.deepEqual([h.tc, h.step, h.screen, h.target, h.kind], ['TC_1', 2, 'Welcome', 'Go', 'tap']);
  assert.deepEqual(h.choices, ['block', 'skip', 'retry', 'use', 'fix']);
  assert.ok(fs.existsSync(h.shot) && fs.existsSync(h.source));
  assert.match(fs.readFileSync(path.join(dir, 'live.jsonl'), 'utf8'), /"type":"help"/);
  assert.ok(!fs.existsSync(path.join(dir, 'help.json')) && !fs.existsSync(path.join(dir, 'answer.json')));
  t.stop();
});

test('skip → không ném, ghi 1 flow bug', async () => {
  const { k, bugs, t } = setup([], [{ action: 'skip' }]);
  await k.tap(3, 'Welcome', 'Go', 'sel-go');
  assert.equal(bugs.length, 1);
  assert.deepEqual([bugs[0].step, bugs[0].screen, bugs[0].target], [3, 'Welcome', 'Go']);
  assert.equal(bugs[0].error, 'Không thấy "Go" trên màn Welcome');
  t.stop();
});

test('retry thành công → không bug', async () => {
  const answers = [{ action: 'retry' }];
  const { k, dev, bugs, t } = setup([], answers);
  answers[0].before = () => dev.present.add('sel-go'); // app load xong trước khi tester bấm Retry
  await k.tap(1, 'Welcome', 'Go', 'sel-go');
  assert.equal(bugs.length, 0);
  assert.deepEqual(dev.taps, ['sel-go']);
  t.stop();
});

test('use → bấm phần tử chọn + bug; lần sau cùng màn|target tự dùng, không hỏi, vẫn bug', async () => {
  const { k, dev, bugs, t } = setup(['~Start'], [{ action: 'use', locator: '~Start' }]);
  await k.tap(1, 'Welcome', 'Go', 'sel-go');
  await k.tap(1, 'Welcome', 'Go', 'sel-go');
  assert.deepEqual(dev.taps, ['~Start', '~Start']);
  assert.equal(t.asked.length, 1);
  assert.equal(bugs.length, 2);
  t.stop();
});

test('use với phần tử cũng không dùng được → hỏi lại', async () => {
  const { k, bugs, t } = setup([], [{ action: 'use', locator: '~Nope' }, { action: 'skip' }]);
  await k.tap(1, 'Home', 'Go', 'sel-go');
  assert.equal(t.asked.length, 2);
  assert.equal(bugs.length, 1);
  t.stop();
});

test('fix → bấm phần tử chọn, không bug; override đã lưu thì lần sau dùng luôn, không hỏi', async () => {
  const { k, dir, dev, bugs, t } = setup(['~Start'], [{ action: 'fix', locator: '~Start' }]);
  await k.tap(1, 'Cart', 'Go', 'sel-go');
  assert.equal(bugs.length, 0);
  assert.deepEqual(readOverrides(dir), { 'Cart|Go': '~Start' }); // worker lưu sau khi chạy được
  fs.mkdirSync(path.join(dir, 'locators'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'locators/overrides.json'), JSON.stringify({ 'Cart|Pay': { locator: '~Start', element: 'Start', at: 'x' } }));
  await k.tap(2, 'Cart', 'Pay', 'sel-pay');
  assert.deepEqual(dev.taps, ['~Start', '~Start']);
  assert.equal(t.asked.length, 1);
  t.stop();
});

test('nav: use = coi phần tử chọn là dấu hiệu màn, key màn|(screen); gone / alert chỉ block-skip-retry', async () => {
  const { k, t } = setup(['~Title'], [{ action: 'use', locator: '~Title' }, { action: 'skip' }, { action: 'skip' }]);
  await k.nav('Awesome', 'sel-show', 'nút "Show me how"', 10);
  assert.equal(t.asked[0].target, '(screen)');
  assert.equal(t.asked[0].kind, 'nav');
  await k.gone('Tutorial', '~Title', 'chữ "Step 1"', 10);
  await k.alert(8, 'Permission dialog', 'Allow', { timeout: 10 });
  assert.deepEqual(t.asked[1].choices, ['block', 'skip', 'retry']);
  assert.deepEqual(t.asked[2].choices, ['block', 'skip', 'retry']);
  t.stop();
});

test('readOverrides: không có file / JSON hỏng → {}; có → key → locator', () => {
  const dir = tmpDir();
  assert.deepEqual(readOverrides(dir), {});
  fs.mkdirSync(path.join(dir, 'locators'));
  fs.writeFileSync(path.join(dir, 'locators/overrides.json'), '{ hỏng');
  assert.deepEqual(readOverrides(dir), {});
  fs.writeFileSync(path.join(dir, 'locators/overrides.json'), JSON.stringify({ 'A|b': { locator: '~b' } }));
  assert.deepEqual(readOverrides(dir), { 'A|b': '~b' });
});

test('chờ tester lâu → keep-alive phiên Appium (getWindowRect)', async () => {
  const { k, dev, dir, t } = setup([], []);
  t.stop();
  const p = k.tap(1, 'Welcome', 'Go', 'sel-go');
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(dev.rects() >= 2);
  const h = JSON.parse(fs.readFileSync(path.join(dir, 'help.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'answer.json'), JSON.stringify({ id: h.id, action: 'skip' }));
  await p;
});

test('màn hình chụp ngay lúc lỗi (không phải lúc tester trả lời): skip ghi seen lúc lỗi; block → noteScreen', async () => {
  let n = 0;
  const summarize = async () => ({ title: n++ === 0 ? 'Welcome' : 'Goals' }); // app chậm: lúc tester trả lời đã sang màn khác
  const s1 = setup([], [{ action: 'skip' }], { summarize });
  await s1.k.nav('Goals', 'sel-title', 'tiêu đề "Goals"', 10);
  assert.equal(s1.bugs[0].seen.title, 'Welcome');
  assert.ok(s1.bugs[0].shot);
  s1.t.stop();
  n = 0;
  const s2 = setup([], [{ action: 'block' }], { summarize });
  await assert.rejects(s2.k.nav('Awesome', 'sel-show', 'nút "Show me how"', 10));
  assert.equal(s2.notes.length, 1);
  assert.equal(s2.notes[0].seen.title, 'Welcome');
  s2.t.stop();
});

test('tap / enter không thấy phần tử → câu lỗi nêu target và màn (report đặt đúng màn cho bug)', async () => {
  const { k, t } = setup([], [], { manual: false });
  await assert.rejects(k.tap(11, 'Paywall', 'Close', 'sel-close'), /^Error: Không thấy "Close" trên màn Paywall\n.*still not existing/);
  t.stop();
});

test('review #2: fix → worker lưu override sau khi locator chạy được; locator hỏng → không lưu, hỏi lại', async () => {
  const s1 = setup(['~Start'], [{ action: 'fix', locator: '~Nope', element: 'Nope' }, { action: 'fix', locator: '~Start', element: 'Start' }]);
  await s1.k.tap(1, 'Shop', 'Buy', 'sel-buy');
  assert.equal(s1.t.asked.length, 2);
  assert.deepEqual(readOverrides(s1.dir), { 'Shop|Buy': '~Start' });
  const saved = JSON.parse(fs.readFileSync(path.join(s1.dir, 'locators/overrides.json'), 'utf8'))['Shop|Buy'];
  assert.equal(saved.element, 'Start');
  assert.ok(saved.at);
  s1.t.stop();
});

test('review #3: click lỗi (tìm thấy phần tử nhưng không bấm được) → giữ nguyên câu lỗi gốc, không ghi "Không thấy"', async () => {
  const { k, t } = setup(['sel-go'], [], { manual: false });
  const $orig = globalThis.$;
  globalThis.$ = (sel) => ({ ...$orig(sel), click: async () => { throw new Error('element not interactable'); } });
  await assert.rejects(k.tap(1, 'Home', 'Go', 'sel-go'), /^Error: element not interactable$/);
  t.stop();
});

test('điểm trên ảnh (phần tử không có tên): use point → bấm theo toạ độ tỉ lệ màn hình + bug; fix point → lần sau tự bấm, không hỏi', async () => {
  const { k, dev, bugs, dir, t } = setup([], [{ action: 'use', locator: 'point:0.1,0.05' }, { action: 'fix', locator: 'point:0.1,0.05' }]);
  await k.tap(11, 'Paywall', 'Close');
  assert.deepEqual(dev.execs.at(-1), ['mobile: tap', { x: 40, y: 40 }]);
  assert.equal(bugs.length, 1);
  await k.tap(12, 'Paywall2', 'Close');
  assert.deepEqual(readOverrides(dir), { 'Paywall2|Close': 'point:0.1,0.05' });
  const n = t.asked.length;
  await k.tap(12, 'Paywall2', 'Close');
  assert.equal(t.asked.length, n);
  assert.deepEqual(dev.execs.at(-1), ['mobile: tap', { x: 40, y: 40 }]);
  t.stop();
});

// Bấm được nhưng app không chuyển màn: hỏi về chính bước bấm (Tap "Back"), không phải "Verify screen"
test('tap rồi nav lỗi → hỏi về bước Tap (target Back, màn Goals); Retry = bấm lại Back rồi chờ màn', async () => {
  const answers = [{ action: 'retry' }];
  const { k, dev, bugs, t } = setup(['sel-back'], answers);
  answers[0].before = () => dev.present.add('sel-welcome'); // lần bấm lại thì sang được
  await k.tap(4, 'Goals', 'Back', 'sel-back');
  await k.nav('Welcome', 'sel-welcome', 'nút "Get Started"', 10);
  const h = t.asked[0];
  assert.deepEqual([h.kind, h.step, h.screen, h.target], ['tap', 4, 'Goals', 'Back']);
  assert.match(h.error, /^Nhấn "Back" không chuyển sang màn Welcome — Không tới được màn Welcome: không thấy nút "Get Started"/);
  assert.deepEqual(dev.taps, ['sel-back', 'sel-back']);
  assert.equal(bugs.length, 0);
  t.stop();
});

test('tap rồi nav lỗi → Use element = bấm nút được chọn thay Back rồi chờ màn (+ bug); Fix lưu cho bước Back', async () => {
  const answers = [{ action: 'use', locator: '~Back2' }];
  const s1 = setup(['sel-back', '~Back2'], answers);
  answers[0].before = () => s1.dev.present.add('sel-welcome');
  await s1.k.tap(4, 'Goals', 'Back', 'sel-back');
  await s1.k.nav('Welcome', 'sel-welcome', 'nút "Get Started"', 10);
  assert.deepEqual(s1.dev.taps, ['sel-back', '~Back2']);
  assert.equal(s1.bugs.length, 1);
  s1.t.stop();
  const a2 = [{ action: 'fix', locator: '~Back3', element: 'Back3' }];
  const s2 = setup(['sel-back', '~Back3'], a2);
  a2[0].before = () => s2.dev.present.add('sel-welcome');
  await s2.k.tap(4, 'Goals2', 'Back', 'sel-back');
  await s2.k.nav('Welcome', 'sel-welcome', 'nút "Get Started"', 10);
  assert.deepEqual(readOverrides(s2.dir), { 'Goals2|Back': '~Back3' });
  assert.equal(s2.bugs.length, 0);
  s2.t.stop();
});

test('nav lỗi mà trước đó không phải bấm (vd nhập chữ) → vẫn hỏi kiểu Verify screen như cũ', async () => {
  const { k, t } = setup(['sel-email'], [{ action: 'skip' }]);
  globalThis.$ = ((orig) => (sel) => ({ ...orig(sel), clearValue: async () => {}, setValue: async () => {} }))(globalThis.$);
  await k.enter(2, 'Login', 'Email', 'a@b.c', 'sel-email');
  await k.nav('Home', 'sel-home', 'tab "Home"', 10);
  assert.equal(t.asked[0].kind, 'nav');
  t.stop();
});

test('k.back: iOS bấm nút Back / ← của màn (không vuốt — app có thể tắt vuốt mép); không về màn → hỏi về bước Back; Retry = bấm lại', async () => {
  const BACK = '-ios predicate string:type == "XCUIElementTypeButton" AND (name == "Back" OR label == "Back" OR name BEGINSWITH "chevron.left" OR name == "arrow.left")';
  const answers = [{ action: 'retry' }];
  const { k, dev, t } = setup([BACK], answers);
  answers[0].before = () => dev.present.add('sel-welcome');
  await k.back(4, 'Goals4'); // màn riêng: bộ nhớ Use element dùng chung trong worker
  await k.nav('Welcome', 'sel-welcome', 'nút "Get Started"', 10);
  assert.deepEqual(dev.taps, [BACK, BACK]);
  assert.equal(dev.swipes.length, 0);
  const h = t.asked[0];
  assert.deepEqual([h.kind, h.step, h.screen, h.target], ['back', 4, 'Goals4', 'Back']);
  assert.match(h.error, /^Nhấn Back không chuyển sang màn Welcome — /);
  t.stop();
});

test('k.back: Fix = bấm phần tử chọn thay cho nút Back mặc định, lưu cho bước Back; lần sau k.back bấm luôn phần tử đó', async () => {
  const a2 = [{ action: 'fix', locator: '~Back2', element: 'Back2' }];
  const s2 = setup(['~Back2'], a2);
  a2[0].before = () => s2.dev.present.add('sel-welcome');
  await s2.k.back(4, 'Goals3');
  await s2.k.nav('Welcome', 'sel-welcome', 'nút "Get Started"', 10);
  assert.deepEqual(readOverrides(s2.dir), { 'Goals3|Back': '~Back2' });
  await s2.k.back(4, 'Goals3');
  assert.equal(s2.dev.taps.at(-1), '~Back2');
  s2.t.stop();
});

test('sai màn: help.json có locator của bước + thao tác trước; Block kèm wrongScreen → lỗi ghi màn thật và bước gốc', async () => {
  const answers = [{ action: 'block', wrongScreen: 'Welcome to, Tastory' }];
  const { k, t } = setup(['~Get Started'], answers);
  await k.tap(1, 'Welcome', 'Get Started', '~Get Started');
  await assert.rejects(k.tap(2, 'Goals', 'Continue', '~Continue'),
    /^Error: Không tới được màn Goals: app đang ở màn "Welcome to, Tastory" sau step 1 \(Tap "Get Started" trên màn Welcome\)/);
  const h = t.asked[0];
  assert.equal(h.sel, '~Continue');
  assert.deepEqual(h.prev, { step: 1, screen: 'Welcome', keyword: 'Tap', target: 'Get Started' });
  t.stop();
});

// AI hỗ trợ khi chạy (AI_ASSIST=1): kẹt ở bước bấm → hỏi /assist, làm thao tác AI chọn, thử lại đúng bước, ghi lệch so với script
test('AI hỗ trợ: AI bấm thêm "Skip" → bước Tap của script chạy được, ghi ai-assist.jsonl', async () => {
  const dir = tmpDir();
  const dev = device(new Set(['~Skip']));
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, o) => {
    calls.push([url, JSON.parse(o.body)]);
    dev.present.add('sel-go'); // sau khi AI bấm Skip thì nút của script hiện ra
    return { ok: true, json: async () => ({ action: 'tap', locator: '~Skip', name: 'Skip', text: '', reason: 'màn trung gian' }) };
  };
  const steps = [];
  const env = { AI_ASSIST: '1', QAPD_API: 'http://x/api', APP_ID: 'app1', REPORTS_DIR: dir, LIVE_STEPS: path.join(dir, 'live.jsonl'), AUTO_RESOLVE: '0' };
  const k = createSteps({ sa: { eq() {} }, logStep: (s) => steps.push(s), snapshot: async () => ({ k: null }), env, cwd: dir, tc: 'TC_9' });
  try {
    await k.tap(3, 'Welcome', 'Go', 'sel-go');
  } finally { globalThis.fetch = realFetch; }
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /\/apps\/app1\/assist$/);
  assert.deepEqual([calls[0][1].tc, calls[0][1].step, calls[0][1].kind, calls[0][1].target], ['TC_9', 3, 'tap', 'Go']);
  assert.deepEqual(dev.taps, ['~Skip', 'sel-go']);
  const e = JSON.parse(fs.readFileSync(path.join(dir, 'ai-assist.jsonl'), 'utf8').trim());
  assert.deepEqual([e.tc, e.step, e.how, e.actions[0].action, e.actions[0].name], ['TC_9', 3, 'retry', 'tap', 'Skip']);
  assert.ok(steps.some((s) => s.keyword === 'AI hỗ trợ'));
});

test('AI hỗ trợ: AI bó tay (giveUp) → giữ lỗi gốc của script, không ghi lệch', async () => {
  const dir = tmpDir();
  device(new Set());
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ action: 'giveUp', reason: 'lỗi app' }) });
  const env = { AI_ASSIST: '1', QAPD_API: 'http://x/api', APP_ID: 'app1', REPORTS_DIR: dir, AUTO_RESOLVE: '0' };
  const k = createSteps({ sa: { eq() {} }, logStep() {}, snapshot: async () => ({ k: null }), env, cwd: dir, tc: 'TC_9' });
  try {
    await assert.rejects(k.tap(1, 'Welcome', 'Go', 'sel-go'), /still not existing/);
  } finally { globalThis.fetch = realFetch; }
  assert.ok(!fs.existsSync(path.join(dir, 'ai-assist.jsonl')));
});

// A: phát hiện kẹt sớm — màn đứng yên, không đang tải → kết luận trước khi hết giờ chờ
test('kẹt sớm: màn đứng yên ≥5s → báo lỗi trước khi hết 15s; màn đang tải → chờ đủ', async () => {
  const dir = tmpDir();
  device(new Set());
  let polls = 0;
  globalThis.driver.getPageSource = async () => { polls++; return '<XCUIElementTypeStaticText name="Other screen"/>'; };
  const k = createSteps({ sa: { eq() {} }, logStep() {}, snapshot: async () => ({ k: null }), env: { AUTO_RESOLVE: '0' }, cwd: dir, tc: 'TC_S' });
  await assert.rejects(k.nav('Goals', 'sel-title', 'tiêu đề', 15000), /Không tới được màn Goals/);
  assert.ok(polls >= 4 && polls < 9, `polls ${polls}`); // kết luận sau ~6–7,5s (5 lượt 1,5s), không chờ đủ 10 lượt
  polls = 0;
  globalThis.driver.getPageSource = async () => { polls++; return '<XCUIElementTypeStaticText name="Warming up the import tool..."/>'; };
  await assert.rejects(k.nav('Goals', 'sel-title', 'tiêu đề', 15000), /Không tới được màn Goals/);
  assert.ok(polls >= 9, `đang tải phải chờ đủ, polls ${polls}`);
  // Wait until displayed do tester đặt số giây → chờ đủ, không kết luận sớm
  polls = 0;
  globalThis.driver.getPageSource = async () => { polls++; return '<x/>'; };
  await assert.rejects(k.waitDisplayed(1, 'Goals', 'Title', 'sel-title', 15), /Không tới được màn Goals/);
  assert.equal(polls, 0);
});

test('hook có sẵn: kill_app / app_not_running chạy được khi src/hooks.js không khai báo', async () => {
  const dir = tmpDir();
  const dev = device(new Set());
  globalThis.driver.execute = async (cmd, o) => { dev.execs.push([cmd, o]); return cmd === 'mobile: queryAppState' ? 1 : null; };
  const eqs = [];
  const k = createSteps({ sa: { eq: (...a) => eqs.push(a) }, logStep() {}, snapshot: async () => ({ k: null }), env: { BUNDLE_ID: 'com.x' }, cwd: dir, tc: 'TC_H' });
  await k.runSetup(1, 'Home', 'kill_app');
  await k.runCheck(1, 'Home', 'app_not_running', 'App đã tắt');
  assert.deepEqual(dev.execs.map((x) => x[0]), ['mobile: terminateApp', 'mobile: queryAppState']);
  assert.equal(eqs[0][2], eqs[0][3]); // actual = expected → pass
  await assert.rejects(k.runSetup(1, 'Home', 'store_account_plus_active'), /Chưa khai báo hook setup/);
});

test('Set network trên iOS → lỗi SkipCase (case thành Skipped, không Blocked)', async () => {
  device(new Set());
  const k = createSteps({ sa: { eq() {} }, logStep() {}, snapshot: async () => ({ k: null }), env: {}, cwd: tmpDir(), tc: 'TC_N' });
  await assert.rejects(k.setNetwork(1, 'S', 'off'), (e) => e.name === 'SkipCase' && /iOS Simulator không giả lập mất mạng/.test(e.message));
});

test('B: AI đã bó tay ở một chỗ kẹt → case sau kẹt y chỗ đó không hỏi AI lại', async () => {
  const dir = tmpDir();
  device(new Set());
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ action: 'giveUp', reason: 'app nhảy bước' }) }; };
  const env = { AI_ASSIST: '1', QAPD_API: 'http://x/api', APP_ID: 'a', REPORTS_DIR: dir, AUTO_RESOLVE: '0', EARLY_STUCK: '0' };
  try {
    for (const tc of ['TC_M1', 'TC_M2']) {
      const k = createSteps({ sa: { eq() {} }, logStep() {}, snapshot: async () => ({ k: null }), env, cwd: dir, tc });
      await assert.rejects(k.tap(2, 'Tutorial Memo', 'Tap here memo', 'sel-memo'), /still not existing/);
    }
  } finally { globalThis.fetch = realFetch; }
  assert.equal(calls, 1);
});

test('guardApi: phần tử hết hạn → làm lại bước 1 lần; lỗi khác ném luôn', async () => {
  const { guardApi } = await import('../server/apps/template/src/runner/limit.js');
  let n = 0;
  const api = guardApi({ async read() { n++; if (n === 1) throw new Error('The element identified by "01" is either not present or it has expired from the internal cache'); return 'ok'; }, sync: () => 5, async bad() { throw new Error('khác'); } });
  assert.equal(await api.read(), 'ok');
  assert.equal(n, 2);
  assert.equal(api.sync(), 5);
  await assert.rejects(api.bad(), /khác/);
});

test('tự bấm lại: bấm xong app chưa chuyển màn, nút vẫn hiện → bấm lại 1 lần rồi tới màn', async () => {
  const dir = tmpDir();
  const dev = device(new Set(['sel-next']));
  // nút đang hiện; lần bấm thứ 2 mới chuyển màn
  const base = globalThis.$;
  globalThis.$ = (sel) => ({ ...base(sel), waitForDisplayed: async () => { if (!dev.present.has(sel)) throw new Error('not displayed'); }, click: async () => { dev.taps.push(sel); if (dev.taps.length === 2) dev.present.add('sel-title'); } });
  const k = createSteps({ sa: { eq() {} }, logStep() {}, snapshot: async () => ({ k: null }), env: { AUTO_RESOLVE: '0', EARLY_STUCK: '0', LIVE_STEPS: path.join(dir, 'live.jsonl') }, cwd: dir, tc: 'TC_R' });
  await k.tap(1, 'Good news', 'Continue', 'sel-next');
  await k.nav('Tutorial', 'sel-title', 'tiêu đề', 3000);
  assert.deepEqual(dev.taps, ['sel-next', 'sel-next']);
  assert.match(fs.readFileSync(path.join(dir, 'live.jsonl'), 'utf8'), /Bấm lại \\"Continue\\"/);
});

test('double tap: hộp thoại hệ thống bật lên ngay sau → ghi cảnh báo lần bấm 2 có thể bị nuốt', async () => {
  const dev = device(new Set(['sel-go']));
  globalThis.$ = (sel) => ({ waitForExist: async () => { if (!dev.present.has(sel)) throw new Error('still not existing'); }, elementId: 'e1' });
  globalThis.driver.execute = async (cmd) => (cmd === 'mobile: alert' ? ['Ask App Not to Track', 'Allow'] : null);
  const steps = [];
  const k = createSteps({ sa: { eq() {} }, logStep: (s) => steps.push(s), snapshot: async () => ({ k: null }), env: { SYSTEM_ALERT: 'off' }, cwd: tmpDir(), tc: 'TC_D' });
  await k.doubleTap(1, 'Welcome', 'Get Started', 'sel-go');
  assert.ok(steps.some((s) => /lần bấm thứ 2 có thể đã bị nuốt/.test(s.note || '')));
});

test('bước kiểm bị popup trong app che: đóng popup (Not now / Close) rồi kiểm lại; ghi note popup ngoài test case', async () => {
  const dir = tmpDir();
  const dev = device(new Set(['sel-empty']));
  let sheet = true;
  globalThis.driver.getPageSource = async () => (sheet ? '<XCUIElementTypeStaticText name="Save your kitchen to your account" visible="true"/><XCUIElementTypeButton name="Continue with Apple" visible="true"/><XCUIElementTypeButton name="Close" visible="true"/>' : '<x/>');
  const base = globalThis.$;
  globalThis.$ = (sel) => ({
    ...base(sel),
    waitForExist: async () => { if (sel === '~Close' && sheet) return; if (sel === 'sel-empty' && !sheet) return; throw new Error('still not existing'); },
    click: async () => { dev.taps.push(sel); if (sel === '~Close') sheet = false; },
  });
  const eqs = [];
  const steps = [];
  const k = createSteps({ sa: { eq: (...a) => eqs.push(a) }, logStep: (s) => steps.push(s), snapshot: async () => ({ k: null }), env: { SYSTEM_ALERT: 'off' }, cwd: dir, tc: 'TC_P' });
  await k.shown(13, 'Tastory', 'No recipe added', 'Trạng thái trống', 'sel-empty', { timeout: 10 });
  assert.deepEqual(dev.taps, ['~Close']);
  assert.equal(eqs[0][2], true); // đọc lại sau khi đóng → thấy
  assert.ok(steps.some((s) => /Popup ngoài test case: "Save your kitchen to your account"/.test(s.note || '')));
});

test('đóng popup ngoài test case → ghi "lệch so với script" (ai-assist.jsonl) gắn với đúng bước kiểm', async () => {
  const dir = tmpDir();
  const dev = device(new Set(['sel-empty']));
  let sheet = true;
  globalThis.driver.getPageSource = async () => (sheet ? '<XCUIElementTypeStaticText name="Save your kitchen to your account" visible="true"/><XCUIElementTypeButton name="Close" visible="true"/>' : '<x/>');
  const base = globalThis.$;
  globalThis.$ = (sel) => ({ ...base(sel), waitForExist: async () => { if ((sel === '~Close' && sheet) || (sel === 'sel-empty' && !sheet)) return; throw new Error('still not existing'); }, click: async () => { if (sel === '~Close') sheet = false; } });
  const k = createSteps({ sa: { eq() {} }, logStep() {}, snapshot: async () => ({ k: null }), env: { SYSTEM_ALERT: 'off', REPORTS_DIR: dir }, cwd: dir, tc: 'TC_O' });
  await k.shown(13, 'Tastory', 'No recipe added', 'Trạng thái trống', 'sel-empty', { timeout: 10 });
  const e = JSON.parse(fs.readFileSync(path.join(dir, 'ai-assist.jsonl'), 'utf8').trim());
  assert.deepEqual([e.tc, e.step, e.screen, e.target, e.kind, e.source, e.actions[0].name], ['TC_O', 13, 'Tastory', 'No recipe added', 'overlay', 'tool', 'Close']);
  assert.match(e.error, /Popup ngoài test case "Save your kitchen to your account" che màn khi kiểm "No recipe added"/);
});

test('bước kiểm "không hiển thị" sai thì KHÔNG đóng popup (tránh pass giả)', async () => {
  const dev = device(new Set(['sel-pay']));
  globalThis.driver.getPageSource = async () => '<XCUIElementTypeStaticText name="Sign in to Tastory" visible="true"/><XCUIElementTypeButton name="Close" visible="true"/>';
  const k = createSteps({ sa: { eq() {} }, logStep() {}, snapshot: async () => ({ k: null }), env: { SYSTEM_ALERT: 'off' }, cwd: tmpDir(), tc: 'TC_Q' });
  await k.notShown(1, 'Home', 'Paywall', 'Không hiện paywall', 'sel-pay');
  assert.deepEqual(dev.taps, []);
});

test('AI hỗ trợ: câu trả lời bị từ chối → hỏi lại (không dừng ngay); lần sau dùng được → đi tiếp', async () => {
  const dir = tmpDir();
  const dev = device(new Set(['~Skip']));
  globalThis.driver.getWindowRect = async () => ({ x: 0, y: 0, width: 400, height: 800 });
  let n = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { n++; if (n === 2) dev.present.add('sel-go'); return { ok: true, json: async () => (n === 1 ? { action: 'refused', reason: 'phần tử không có' } : { action: 'tap', locator: '~Skip', name: 'Skip', reason: 'màn trung gian' }) }; };
  const env = { AI_ASSIST: '1', QAPD_API: 'http://x/api', APP_ID: 'app1', REPORTS_DIR: dir, AUTO_RESOLVE: '0', EARLY_STUCK: '0' };
  const k = createSteps({ sa: { eq() {} }, logStep() {}, snapshot: async () => ({ k: null }), env, cwd: dir, tc: 'TC_R2' });
  try { await k.tap(1, 'S', 'Go', 'sel-go'); } finally { globalThis.fetch = realFetch; }
  assert.equal(n, 2);
  assert.deepEqual(dev.taps, ['~Skip', 'sel-go']);
});

// Chạy thử luồng chung trên thiết bị (flowCheck.js) với driver giả — không đụng simulator / Appium thật.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseElements } from '../server/locators/pageSource.js';
import { dryRunFlows, createFlowCheck, chainOrder, flowEnds } from '../server/testcases/convert/flowCheck.js';
import { createLock } from '../server/lock.js';
import { convertSheet } from '../server/testcases/convert/writeXlsx.js';
import { tmpDir } from './helpers.js';

const T = { pollMs: 1, quietMs: 3, settleMaxMs: 40, navTimeoutMs: 30, startTimeoutMs: 30, checkTimeoutMs: 10 };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const xmlOf = (els) => `<?xml version="1.0"?><AppiumAUT><XCUIElementTypeApplication name="Demo" width="400" height="800">${els.map((e, i) => `<XCUIElementType${e.type} name="${esc(e.name)}" label="${esc(e.name)}" x="10" y="${40 + i * 50}" width="300" height="40" enabled="true" visible="true"/>`).join('')}</XCUIElementTypeApplication></AppiumAUT>`;

// App giả: screens = { tên: [{ type, name }] }, go = { "màn|nút": màn kế } (bấm nút không có trong go → ở lại màn)
function fakeApp(screens, go, start) {
  const st = { cur: start, taps: [], typed: [], opens: 0 };
  const els = () => parseElements(xmlOf(screens[st.cur]));
  const driver = {
    getPageSource: async () => xmlOf(screens[st.cur]),
    execute: async () => { throw new Error('no alert'); },
    getWindowSize: async () => ({ width: 400, height: 800 }),
    pause: async () => {},
    $: async (sel) => ({
      click: async () => {
        const el = els().find((e) => e.locator === sel || e.alts.includes(sel));
        if (!el) throw new Error(`no such element ${sel}`);
        st.taps.push(el.name);
        const next = go[`${st.cur}|${el.name}`];
        if (next) st.cur = next;
      },
      setValue: async (v) => { st.typed.push([sel, v]); },
    }),
  };
  const open = async () => { st.opens++; st.cur = start; return { driver, close: async () => {} }; };
  return { st, driver, open };
}

const B = (name) => ({ type: 'Button', name });
const TX = (name) => ({ type: 'StaticText', name });
// Onboarding kiểu "moss": chọn "None of above" là app tự sang màn sau; màn sau cũng có Continue
const SCREENS = {
  Goal: [TX('What is your goal?'), B('Lose weight'), B('None of above'), B('Continue')],
  Activity: [TX('How active are you?'), B('Very active'), B('None of above'), B('Continue')],
  Done: [TX('All set'), B('Start')],
};
const GO = { 'Goal|None of above': 'Activity', 'Goal|Continue': 'Activity', 'Activity|Continue': 'Done', 'Activity|None of above': 'Done' };
const TABLE = { Goal: [{ key: 'What is your goal?', type: 'StaticText' }, { key: 'None of above', type: 'Button' }, { key: 'Continue', type: 'Button' }], Activity: [{ key: 'How active are you?', type: 'StaticText' }, { key: 'Very active', type: 'Button' }], Done: [{ key: 'All set', type: 'StaticText' }] };
const row = (step, screen, kind, keyword, target, extra = {}) => ({ step, screen, kind, keyword, target, ...extra });

test('flowEnds / chainOrder: đi theo chuỗi "A → B", "B → C"', () => {
  assert.deepEqual(flowEnds('Goal → Activity'), { from: 'Goal', to: 'Activity' });
  const order = chainOrder({ 'Activity → Done': [], 'Goal → Activity': [] }).map((f) => f.name);
  assert.deepEqual(order, ['Goal → Activity', 'Activity → Done']);
});

test('(1) tự chuyển màn sau khi chọn: bỏ "Tap Continue" thừa, ghi cạnh Goal --None of above--> Activity', async () => {
  const app = fakeApp(SCREENS, GO, 'Goal');
  const flows = {
    'Goal → Activity': [
      row(1, 'Goal', 'Action', 'Tap', 'None of above'),
      row(2, 'Goal', 'Action', 'Tap', 'Continue'),
      row(3, 'Activity', 'Nav', 'Verify screen', 'How active are you?'),
      row(4, 'Activity', 'Check', 'Verify text', 'How active are you?', { value: 'How active are you?', label: 'Tiêu đề' }),
    ],
    'Activity → Done': [row(1, 'Activity', 'Action', 'Tap', 'Very active'), row(2, 'Activity', 'Action', 'Tap', 'Continue'), row(3, 'Done', 'Nav', 'Verify screen', 'All set')],
  };
  const recorded = [];
  const r = await dryRunFlows({ skeleton: { order: [], groups: [], flows }, driver: app.driver, restart: async () => (await app.open()).driver, app: { platform: 'iOS', bundleId: 'b' }, locatorTable: TABLE, runClaude: async () => { throw new Error('AI không được gọi'); }, record: (e) => recorded.push(e), timing: T });
  const goal = r.skeleton.flows['Goal → Activity'];
  assert.deepEqual(goal.map((x) => `${x.keyword} ${x.target}`), ['Tap None of above', 'Verify screen How active are you?', 'Verify text How active are you?']);
  assert.deepEqual(goal.map((x) => x.step), [1, 2, 3]); // đánh lại số bước
  assert.ok(r.review.some((l) => l.startsWith('[Chạy thử] Luồng "Goal → Activity"') && /bỏ bước 2 "Tap Continue"/.test(l) && /tự chuyển sang màn "Activity"/.test(l)), r.review.join('\n'));
  const e = recorded.find((x) => x.from === 'Goal' && x.to === 'Activity');
  assert.equal(e.target, 'None of above');
  assert.equal(e.sel, '~None of above');
  assert.ok(e.arrive.sel && /How active/.test(e.arrive.what));
  // Luồng sau chạy tiếp từ màn Activity (không cài lại app), Continue chỉ bấm 1 lần ở Activity
  assert.deepEqual(app.st.taps, ['None of above', 'Very active', 'Continue']);
  assert.ok(recorded.some((x) => x.from === 'Activity' && x.to === 'Done' && x.target === 'Continue'));
  assert.equal(r.skeleton.flows['Activity → Done'].length, 3);
});

test('(2) target không có trên màn: khớp gần đúng theo chữ, rồi nhờ AI chọn (resolveTarget) → đổi target', async () => {
  const screens = { Goal: [TX('What is your goal?'), B('Lose weight now'), B('Next step')], Done: [TX('All set')] };
  const app = fakeApp(screens, { 'Goal|Next step': 'Done' }, 'Goal');
  const asked = [];
  const runClaude = async ({ prompt }) => { asked.push(prompt); return { ok: true, data: { locator: '~Next step', reason: 'nút đi tiếp' } }; };
  const flows = { 'Goal → Done': [row(1, 'Goal', 'Action', 'Tap', 'Lose weight'), row(2, 'Goal', 'Action', 'Tap', 'Continue'), row(3, 'Done', 'Nav', 'Verify screen', 'All set')] };
  const r = await dryRunFlows({ skeleton: { flows }, driver: app.driver, restart: async () => (await app.open()).driver, app: { platform: 'iOS' }, locatorTable: { Goal: [{ key: 'What is your goal?', type: 'StaticText' }] }, runClaude, timing: T });
  const rows = r.skeleton.flows['Goal → Done'];
  assert.equal(rows[0].target, 'Lose weight now'); // gần đúng theo chữ
  assert.equal(rows[1].target, 'Next step'); // AI chọn
  assert.equal(asked.length, 1);
  assert.ok(r.review.some((l) => /đổi target bước 1 "Lose weight" → "Lose weight now"/.test(l)));
  assert.ok(r.review.some((l) => /đổi target bước 2 "Continue" → "Next step" \(AI chọn/.test(l)));
  assert.deepEqual(app.st.taps, ['Lose weight now', 'Next step']);
});

test('(2b) AI không chọn được → giữ nguyên dòng, cảnh báo', async () => {
  const app = fakeApp({ Goal: [TX('What is your goal?'), B('Other')] }, {}, 'Goal');
  const flows = { 'Goal → Done': [row(1, 'Goal', 'Action', 'Tap', 'Continue'), row(2, 'Done', 'Nav', 'Verify screen', 'All set')] };
  const r = await dryRunFlows({ skeleton: { flows }, driver: app.driver, restart: async () => (await app.open()).driver, app: { platform: 'iOS' }, locatorTable: TABLE, runClaude: async () => ({ ok: true, data: { locator: '', reason: 'không có' } }), timing: T });
  assert.deepEqual(r.skeleton.flows['Goal → Done'], flows['Goal → Done']);
  assert.ok(r.review.some((l) => /không thấy "Continue" trên màn "Goal"/.test(l)));
});

test('(4) chặn mua: "Tap Subscribe" trên tờ thanh toán của store không được bấm', async () => {
  const screens = { Paywall: [TX('Environment: Sandbox'), TX('Confirm subscription'), B('Subscribe'), B('Cancel')] };
  const app = fakeApp(screens, {}, 'Paywall');
  const flows = { 'Paywall → Home': [row(1, 'Paywall', 'Action', 'Tap', 'Subscribe'), row(2, 'Home', 'Nav', 'Verify screen', 'Home')] };
  const r = await dryRunFlows({ skeleton: { flows }, driver: app.driver, restart: async () => (await app.open()).driver, app: { platform: 'iOS', bundleId: 'b' }, locatorTable: { Paywall: [{ key: 'Confirm subscription', type: 'StaticText' }] }, runClaude: async () => { throw new Error('no AI'); }, timing: T });
  assert.deepEqual(app.st.taps, []);
  assert.ok(r.review.some((l) => /chặn bước 1 "Tap Subscribe"/.test(l)), r.review.join('\n'));
  assert.deepEqual(r.skeleton.flows['Paywall → Home'], flows['Paywall → Home']);
});

test('màn bắt đầu không hiện: cài lại app rồi đi theo chuỗi luồng trước tới màn đó', async () => {
  const app = fakeApp(SCREENS, GO, 'Goal');
  const flows = {
    'Goal → Activity': [row(1, 'Goal', 'Action', 'Tap', 'None of above'), row(2, 'Activity', 'Nav', 'Verify screen', 'How active are you?')],
    'Activity → Done': [row(1, 'Activity', 'Action', 'Tap', 'None of above'), row(2, 'Done', 'Nav', 'Verify screen', 'All set')],
    'Activity → Done 2': [row(1, 'Activity', 'Action', 'Tap', 'Continue'), row(2, 'Done', 'Nav', 'Verify screen', 'All set')],
  };
  const r = await dryRunFlows({ skeleton: { flows }, driver: app.driver, restart: async () => (await app.open()).driver, app: { platform: 'iOS' }, locatorTable: TABLE, runClaude: async () => ({ ok: false }), timing: T });
  assert.equal(app.st.opens, 1); // nhánh thứ 2 từ Activity: cài lại 1 lần, đi lại "Goal → Activity"
  assert.deepEqual(app.st.taps, ['None of above', 'None of above', 'None of above', 'Continue']);
  assert.ok(r.review.some((l) => /Đã chạy thử 3\/3 luồng/.test(l)), r.review.join('\n'));
});

test('(3) thiết bị bận / mở phiên lỗi → bỏ qua, có ghi chú, khung giữ nguyên', async () => {
  const lock = createLock();
  lock.acquire({ id: 'run-1', kind: 'run', label: 'Run RUN-0001' });
  const skeleton = { order: [], groups: [], flows: { 'A → B': [row(1, 'A', 'Action', 'Tap', 'Go')] } };
  const busy = await createFlowCheck({ lock, openSession: async () => { throw new Error('không được mở'); } })({ app: { id: 'a', name: 'A' }, udid: 'U', skeleton });
  assert.equal(busy.ran, false);
  assert.equal(busy.skeleton, skeleton);
  assert.match(busy.review[0], /^\[Chạy thử\] Bỏ qua chạy thử luồng chung: thiết bị đang bận \(Run RUN-0001\)/);
  lock.release('run-1');
  const bad = await createFlowCheck({ lock, openSession: async () => { throw new Error('WebDriverAgent failed\nchi tiết'); } })({ app: { id: 'a', name: 'A' }, udid: 'U', skeleton });
  assert.equal(bad.ran, false);
  assert.match(bad.review[0], /không mở được phiên trên thiết bị \(WebDriverAgent failed\)/);
  assert.equal(lock.current(), null); // nhả khoá
});

test('createFlowCheck: giữ khoá trong lúc chạy, ghi cạnh vào nav-graph.json của workspace (build hiện tại), đánh dấu flowsChecked', async () => {
  const lock = createLock();
  const ws = tmpDir();
  const app = fakeApp(SCREENS, GO, 'Goal');
  let held = null;
  const open = async (o) => { held = lock.current(); return app.open(o); };
  const fc = createFlowCheck({ lock, openSession: open, buildStampOf: () => ({ stamp: 'B1' }), timing: T, runClaude: async () => ({ ok: false }) });
  const skeleton = { order: [], groups: [], flows: { 'Goal → Activity': [row(1, 'Goal', 'Action', 'Tap', 'None of above'), row(2, 'Goal', 'Action', 'Tap', 'Continue'), row(3, 'Activity', 'Nav', 'Verify screen', 'How active are you?')] } };
  const progress = [];
  const r = await fc({ app: { id: 'moss', name: 'Moss', platform: 'iOS', workspace: ws, appPath: '/x.app' }, udid: 'U1', skeleton, locatorTable: TABLE, onProgress: (p) => progress.push(p.label) });
  assert.equal(held?.kind, 'flowcheck');
  assert.equal(lock.current(), null);
  assert.equal(r.ran, true);
  assert.equal(r.skeleton.flowsChecked.build, 'B1');
  assert.equal(r.skeleton.flowsChecked.udid, 'U1');
  assert.equal(r.skeleton.flows['Goal → Activity'].length, 2);
  assert.ok(progress.includes('Chạy thử luồng chung trên thiết bị: Goal → Activity (1/1)'));
  const g = JSON.parse(fs.readFileSync(path.join(ws, 'data', 'nav-graph.json'), 'utf8'));
  const e = g.edges.find((x) => x.from === 'Goal' && x.to === 'Activity');
  assert.equal(e.target, 'None of above');
  assert.equal(e.build, 'B1');
});

test('dừng chuyển đổi (signal) → dừng chạy thử, không đánh dấu flowsChecked', async () => {
  const lock = createLock();
  const app = fakeApp(SCREENS, GO, 'Goal');
  const ctl = new AbortController();
  ctl.abort();
  const fc = createFlowCheck({ lock, openSession: app.open, buildStampOf: () => null, timing: T });
  const skeleton = { flows: { 'Goal → Activity': [row(1, 'Goal', 'Action', 'Tap', 'None of above')] } };
  const r = await fc({ app: { id: 'x', platform: 'iOS' }, udid: 'U', skeleton, signal: ctl.signal });
  assert.equal(r.skeleton.flowsChecked, undefined);
  assert.deepEqual(app.st.taps, []);
});

test('convertSheet + dryRun: khung đã sửa được lưu (onSkeleton) trước khi viết nhóm; review "[Chạy thử]" trả về; khung đã chạy thử không chạy lại', async () => {
  const cases = [{ id: 'TC_1', scenario: 's', pre: '', steps: '1. Tap Start', expected: '1. Màn Done hiện' }];
  const flows = { 'Goal → Activity': [row(1, 'Goal', 'Action', 'Tap', 'None of above'), row(2, 'Goal', 'Action', 'Tap', 'Continue'), row(3, 'Activity', 'Nav', 'Verify screen', 'How active are you?'), row(4, 'Activity', 'Check', 'Verify text', 'How active are you?', { value: 'How active are you?', compare: 'equals', label: 'Tiêu đề màn' })] };
  const saved = [];
  let groupsSawFlows = null;
  const runClaude = async (req) => {
    if (req.schema.properties.order) return { ok: true, data: { order: [{ id: 'TC_1', fresh: true }], groups: [['TC_1']], flows } };
    groupsSawFlows = req.prompt;
    return { ok: true, data: { testcases: [{ id: 'TC_1', fresh: true, pre: [], rows: [
      { step: 0, screen: '', kind: 'Action', keyword: 'Run flow', value: 'Goal → Activity' },
      { step: 1, screen: 'Activity', kind: 'Action', keyword: 'Tap', target: 'Continue' },
      { step: 1, screen: 'Done', kind: 'Nav', keyword: 'Verify screen', target: 'All set' },
      { step: 1, screen: 'Done', kind: 'Check', keyword: 'Verify text', target: 'All set', value: 'All set', compare: 'equals', label: 'Màn Done hiện' },
    ] }] } };
  };
  let dryCalls = 0;
  const dryRun = async (sk) => {
    dryCalls++;
    const f = sk.flows['Goal → Activity'].filter((x) => !(x.keyword === 'Tap' && x.target === 'Continue'));
    return { skeleton: { ...sk, flows: { ...sk.flows, 'Goal → Activity': f }, flowsChecked: { at: 'x', build: 'B', udid: 'U' } }, review: ['[Chạy thử] Luồng "Goal → Activity": bỏ bước 2 "Tap Continue"'], edges: [{ from: 'Goal', to: 'Activity', target: 'None of above' }] };
  };
  const r = await convertSheet({ sheet: { sheet: 'Onb', cases }, decisions: [{ id: 'TC_1', mode: 'automate' }], runClaude, outDir: tmpDir(), onSkeleton: (s) => saved.push(s), dryRun, maxFix: 0 });
  assert.equal(dryCalls, 1);
  assert.ok(saved.at(-1).flowsChecked);
  assert.equal(saved.at(-1).flows['Goal → Activity'].some((x) => x.target === 'Continue'), false);
  assert.deepEqual(r.flowReview, ['[Chạy thử] Luồng "Goal → Activity": bỏ bước 2 "Tap Continue"']);
  assert.ok(groupsSawFlows !== null);
  // Lần sau dùng lại khung đã chạy thử → không chạy lại
  await convertSheet({ sheet: { sheet: 'Onb', cases }, decisions: [{ id: 'TC_1', mode: 'automate' }], runClaude, outDir: tmpDir(), skeleton: saved.at(-1), dryRun, maxFix: 0 });
  assert.equal(dryCalls, 1);
});

// ---- Converter: tuỳ chọn udid
import { fileURLToPath } from 'node:url';
import { makeManual } from './fixtures/manualWorkbook.js';
import { fakeConvertAi } from './fixtures/convertAi.js';
import { createStore } from '../server/store.js';
import { importTestcases } from '../server/testcases/importXlsx.js';
import { createConverter } from '../server/testcases/convert/converter.js';

const LOADER = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/apps/template/data/loaders/testcase-v2.js');
function convEnv({ flowCheck }) {
  const dir = tmpDir();
  const store = createStore(path.join(dir, 'store'));
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  store.put('apps', { id: 'app1', name: 'App', workspace: ws, status: 'ready', platform: 'iOS' });
  const base = fakeConvertAi();
  const FLOWS = { 'Welcome → Next': [{ step: 0, screen: 'Welcome', kind: 'Action', keyword: 'Tap', target: 'Go' }, { step: 0, screen: 'Next', kind: 'Nav', keyword: 'Verify screen', target: 'Next' }] };
  const ai = async (req) => { const r = await base(req); if (req.schema.properties.order && r.ok) r.data.flows = FLOWS; return r; };
  const conv = createConverter({ store, map: { locatorTable: () => ({}) }, emit: () => {}, dataDir: path.join(dir, 'data'), runClaude: ai, generator: { generate: async () => {} }, importer: (a) => importTestcases({ ...a, loaderPath: LOADER }), flowCheck });
  return { dir, store, conv };
}

test('(3) converter + udid: thiết bị bận → bỏ chạy thử (ghi chú "[Chạy thử]"), chuyển đổi vẫn xong', async () => {
  const lock = createLock();
  lock.acquire({ id: 'cap-1', kind: 'capture', label: 'AI khám phá · App' });
  let opened = 0;
  const e = convEnv({ flowCheck: createFlowCheck({ lock, openSession: async () => { opened++; throw new Error('x'); } }) });
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [{ id: 'TC_W_001', priority: 'High', steps: 'Bước 1' }] }] });
  const mi = await e.conv.analyze({ appId: 'app1', srcPath: f, fileName: 'onb.xlsx' });
  await e.conv.convert(mi.id, { udid: 'U1' });
  const done = e.conv.get(mi.id);
  assert.equal(done.status, 'done', done.problems.join('; '));
  assert.equal(opened, 0);
  assert.ok(done.review.some((l) => /^\[Chạy thử\] Bỏ qua chạy thử luồng chung: thiết bị đang bận \(AI khám phá · App\)/.test(l)), done.review.join('\n'));
  assert.equal(done.skeletons.Welcome.skeleton.flowsChecked, undefined); // lần sau còn chạy thử lại
});

test('converter không udid → không gọi flowCheck (như cũ); có udid → chạy thử và lưu flowsChecked vào khung', async () => {
  const calls = [];
  const flowCheck = async ({ udid, skeleton }) => { calls.push(udid); return { skeleton: { ...skeleton, flowsChecked: { at: 't', build: 'B', udid } }, review: ['[Chạy thử] Đã chạy thử 1/1 luồng chung trên thiết bị'], edges: [] }; };
  const e = convEnv({ flowCheck });
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [{ id: 'TC_W_001', priority: 'High', steps: 'Bước 1' }] }] });
  const mi = await e.conv.analyze({ appId: 'app1', srcPath: f, fileName: 'onb.xlsx' });
  await e.conv.convert(mi.id);
  assert.deepEqual(calls, []);
  await e.conv.convert(mi.id, { fresh: true, udid: 'U9' });
  const done = e.conv.get(mi.id);
  assert.deepEqual(calls, ['U9']);
  assert.equal(done.skeletons.Welcome.skeleton.flowsChecked.udid, 'U9');
  assert.ok(done.review.includes('[Chạy thử] Đã chạy thử 1/1 luồng chung trên thiết bị'));
});

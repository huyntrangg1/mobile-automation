// Kiến thức hành vi app (sơ đồ màn) cho chuyển đổi + ghi cạnh sơ đồ màn khi lấy locator.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { appContext, checkApp, contextText, withEdges } from '../server/testcases/convert/appCheck.js';
import { recordNavEdge, readNavEdges } from '../server/apps/navGraph.js';
import { buildStamp } from '../server/apps/buildStamp.js';
import { buildStamp as runnerBuildStamp } from '../server/runs/runner.js';
import { createStore } from '../server/store.js';
import { createLock } from '../server/lock.js';
import { createScreenMap } from '../server/locators/screenMap.js';
import { createCaptures } from '../server/locators/record.js';
import { exploreLoop } from '../server/locators/explore.js';
import { tmpDir } from './helpers.js';

const ctx = () => appContext({
  locatorTable: { Goal: [{ key: 'None of above' }, { key: 'Continue' }, { key: 'Lose weight' }], Activity: [{ key: 'Continue' }] },
  edges: [{ from: 'Goal', to: 'Activity', target: 'None of above' }, { from: 'Activity', to: 'Done', target: 'Continue' }, { from: 'Done', to: 'Activity', target: 'Back' }],
});
const r = (step, screen, kind, keyword, target) => ({ step, screen, kind, keyword, target });

test('checkApp: "Tap Y" rồi "Tap Z" cùng màn mà sơ đồ có Goal --Y--> Activity → báo bấm thừa sau khi app tự chuyển màn', () => {
  const rows = [r(1, 'Goal', 'Action', 'Tap', 'None of above'), r(2, 'Goal', 'Action', 'Tap', 'Continue'), r(3, 'Activity', 'Nav', 'Verify screen', 'Activity')];
  const out = checkApp({ owner: 'Luồng "Goal → Activity"', rows, ctx: ctx() });
  assert.deepEqual(out, ['Luồng "Goal → Activity" step 2: sau khi bấm "None of above" app tự sang màn "Activity" (đã thấy trên app thật) — bỏ "Tap Continue" hoặc thêm Nav tới Activity']);
  // Có Nav xen giữa / lựa chọn không tự chuyển màn → không báo
  assert.deepEqual(checkApp({ owner: 'TC_1', rows: [r(1, 'Goal', 'Action', 'Tap', 'None of above'), r(1, 'Activity', 'Nav', 'Verify screen', 'Activity'), r(2, 'Activity', 'Action', 'Tap', 'Continue')], ctx: ctx() }), []);
  assert.deepEqual(checkApp({ owner: 'TC_1', rows: [r(1, 'Goal', 'Action', 'Tap', 'Lose weight'), r(2, 'Goal', 'Action', 'Tap', 'Continue'), r(3, 'Activity', 'Nav', 'Verify screen', 'Activity')], ctx: ctx() }), []);
});

test('contextText: có dòng "Hành vi đã thấy trên app thật" cho cạnh tự chuyển màn (không gồm nút đi tiếp / Back)', () => {
  const t = contextText(ctx());
  assert.match(t, /Hành vi đã thấy trên app thật/);
  assert.ok(t.includes('- Màn "Goal": bấm "None of above" → tự sang "Activity"'));
  assert.ok(!t.includes('bấm "Continue" → tự sang'));
  assert.ok(!t.includes('bấm "Back" → tự sang'));
  assert.ok(t.indexOf('Hành vi đã thấy') < t.indexOf('Màn → phần tử:')); // đứng trước danh sách dài (không bị cắt)
  assert.ok(!contextText(appContext({ locatorTable: { A: [{ key: 'x' }] } })).includes('Hành vi đã thấy'));
});

test('withEdges: thêm cạnh mới thấy vào ngữ cảnh (bỏ trùng) → lint dùng được ngay', () => {
  const c = withEdges(appContext({ locatorTable: { Goal: [{ key: 'None of above' }, { key: 'Continue' }] } }), [{ from: 'Goal', to: 'Activity', target: 'None of above', sel: '~x' }, { from: 'Goal', to: 'Activity', target: 'None of above' }]);
  assert.equal(c.edges.length, 1);
  assert.equal(checkApp({ owner: 'TC_1', rows: [r(1, 'Goal', 'Action', 'Tap', 'None of above'), r(2, 'Goal', 'Action', 'Tap', 'Continue')], ctx: c }).length, 1);
});

test('recordNavEdge: cùng định dạng runner/navgraph.js — build hiện tại, mỗi cặp màn 1 cạnh, bỏ nút mua / không build', () => {
  const ws = tmpDir();
  fs.mkdirSync(path.join(ws, 'data'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'data', 'nav-graph.json'), JSON.stringify({ edges: [{ from: 'X', to: 'Y', sel: '~a', target: 'a', arrive: { sel: '~Y' }, build: 'OLD' }] }));
  const e = { from: 'Goal', to: 'Activity', sel: '~None of above', target: 'None of above', arrive: { sel: '~How active?', what: 'tiêu đề "How active?"' } };
  assert.equal(recordNavEdge(ws, 'B1', e), true);
  assert.equal(recordNavEdge(ws, 'B1', { ...e, sel: '~Continue', target: 'Continue' }), true);
  assert.equal(recordNavEdge(ws, 'B1', { ...e, to: 'Paywall', target: 'Subscribe', sel: '~Subscribe' }), false);
  assert.equal(recordNavEdge(ws, '', e), false);
  const edges = readNavEdges(ws);
  assert.equal(edges.length, 1); // cạnh build cũ bị bỏ, cặp Goal→Activity giữ cạnh mới nhất
  assert.equal(edges[0].target, 'Continue');
  assert.equal(edges[0].build, 'B1');
  assert.deepEqual(Object.keys(edges[0]).sort(), ['arrive', 'at', 'build', 'from', 'needsInput', 'sel', 'target', 'to']);
});

test('buildStamp chuyển sang util dùng chung, runner vẫn export như cũ', () => {
  assert.equal(runnerBuildStamp, buildStamp);
  const f = path.join(tmpDir(), 'a.apk');
  fs.writeFileSync(f, 'apk');
  assert.match(buildStamp(f).stamp, /^3-\d+$/);
  assert.equal(buildStamp('/khong/co'), null);
});

// ---- AI khám phá ghi cạnh vào nav-graph.json của workspace (driver giả như explore.test.js)
const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}.xml`, import.meta.url), 'utf8');
const EMAIL_BTN = '-ios predicate string:type == "XCUIElementTypeButton" AND name == "Continue with email"';
function fakeApp() {
  const st = { cur: 'welcome', taps: [] };
  const driver = {
    getPageSource: async () => fx(st.cur === 'welcome' ? 'welcome' : 'login-empty'),
    takeScreenshot: async () => Buffer.from('png').toString('base64'),
    pause: async () => {},
    execute: async () => { throw new Error('no alert open'); },
    $: async (sel) => ({ click: async () => { st.taps.push(sel); if (sel === EMAIL_BTN) st.cur = 'login'; }, setValue: async () => {} }),
  };
  return { st, open: async () => ({ driver, close: async () => {} }) };
}
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await new Promise((res) => setTimeout(res, 5)); } };

test('AI khám phá: bấm sang màn khác → ghi cạnh (tên màn cuối cùng, build hiện tại) vào data/nav-graph.json của workspace', async () => {
  const dataDir = tmpDir();
  const ws = tmpDir();
  const store = createStore(dataDir);
  store.put('apps', { id: 'ikf', workspace: ws, status: 'ready', bundleId: 'b', appPath: '/x.app' });
  const answers = [
    { ok: true, data: { action: 'tap', locator: EMAIL_BTN, screenName: 'Welcome', reason: 'mở form email' } },
    { ok: true, data: { action: 'done', screenName: 'Log In', reason: 'đủ' } },
  ];
  let i = 0;
  const runClaude = async () => answers[Math.min(i++, answers.length - 1)];
  const app = fakeApp();
  const caps = createCaptures({ store, lock: createLock(), emit: () => {}, map: createScreenMap({ store, dataDir }), openSession: app.open, buildStampOf: () => ({ stamp: 'B7' }),
    loops: { explore: (...a) => exploreLoop(...a, { runClaude, settleOpts: { pollMs: 1, quietMs: 5, maxMs: 30 } }) }, pollMs: 1 });
  const id = await caps.start('ikf', { mode: 'explore', udid: 'U', maxSteps: 10 });
  await until(() => store.get('captures', id).finishedAt);
  const edges = readNavEdges(ws);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].from, 'Welcome');
  assert.equal(edges[0].to, 'Log In');
  assert.equal(edges[0].target, 'Continue with email');
  assert.equal(edges[0].sel, EMAIL_BTN);
  assert.equal(edges[0].build, 'B7');
  assert.ok(edges[0].arrive.sel);
  assert.ok(store.get('captures', id).log.some((l) => /nav-graph/.test(l.text)));
});

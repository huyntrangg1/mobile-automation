import test from 'node:test';
import assert from 'node:assert/strict';
import { appContext, checkApp, contextText } from '../server/testcases/convert/appCheck.js';

// Dữ liệu thật của Tastory: luồng do AI lập "mù" bấm "first option" rồi chờ Recipe source (thiếu Continue) → 11 case Blocked ở RUN-0142
const ctx = appContext({
  locatorTable: {
    'When do you usually start cooking?': [{ key: 'Back' }, { key: 'Around lunchtime' }, { key: 'Honestly, it depends' }, { key: 'Continue' }, { key: 'icCookingSunrise', type: 'Image' }],
    'What brings you to Tastory?': [{ key: 'Cook faster' }, { key: 'Continue' }],
  },
  edges: [{ from: 'Cooking time', to: 'Recipe source', target: 'Continue' }, { from: 'Goals', to: 'Encouragement', target: 'Continue' }],
});
const row = (step, screen, kind, keyword, target = '') => ({ step, screen, kind, keyword, target });

test('checkApp: target không có trong locator map (vd "first option") → lỗi kèm gợi ý tên thật; "Nút Back" khớp "Back"; point: bỏ qua', () => {
  const p = checkApp({ owner: 'Luồng "Cooking time → Recipe source"', ctx, rows: [row(1, 'Cooking time', 'Action', 'Tap', 'first option'), row(2, 'Cooking time', 'Action', 'Tap', 'Nút Back'), row(3, 'Cooking time', 'Action', 'Tap', 'point:0.5,0.5')] });
  assert.equal(p.length, 1);
  assert.match(p[0], /"first option" không có trong locator map/);
  assert.match(p[0], /step 1/);
});

test('checkApp: sang màn khác mà không bấm đúng nút như sơ đồ màn đã ghi → lỗi nêu nút cần bấm; có bấm thì không lỗi', () => {
  const bad = checkApp({ owner: 'TC_X', ctx, rows: [row(1, 'Cooking time', 'Action', 'Tap', 'Honestly, it depends'), row(2, 'Recipe source', 'Nav', 'Verify screen', 'Recipe source')] });
  assert.equal(bad.length, 1);
  assert.match(bad[0], /từ màn "Cooking time" sang "Recipe source".*"Continue"/);
  const ok = checkApp({ owner: 'TC_X', ctx, rows: [row(1, 'Cooking time', 'Action', 'Tap', 'Honestly, it depends'), row(1, 'Cooking time', 'Action', 'Tap', 'Continue'), row(2, 'Recipe source', 'Nav', 'Verify screen', 'Recipe source')] });
  assert.deepEqual(ok, []);
});

test('checkApp: không có locator map / sơ đồ màn → không kiểm gì (không chặn chuyển đổi của app chưa lấy locator)', () => {
  assert.deepEqual(checkApp({ owner: 'TC', ctx: appContext({ locatorTable: {}, edges: [] }), rows: [row(1, 'A', 'Action', 'Tap', 'bất kỳ')] }), []);
});

test('contextText: liệt kê màn → tên phần tử (bỏ icon không tên) và sơ đồ màn, để đưa vào prompt', () => {
  const t = contextText(ctx);
  assert.match(t, /Around lunchtime/);
  assert.doesNotMatch(t, /icCookingSunrise/);
  assert.match(t, /Cooking time —bấm "Continue"→ Recipe source/);
});

import { convertSheet } from '../server/testcases/convert/writeXlsx.js';
import { tmpDir } from './helpers.js';

const mc = (id) => ({ id, module: 'W', type: 'Positive', platform: 'All', scenario: 's', description: '', pre: '1. Cài lại app', steps: '1. Chọn thời điểm', expected: '1. Hiển thị "Where"', priority: 'High', selected: true });
const flowRows = (opt, withContinue) => [
  { step: 1, screen: 'Cooking time', kind: 'Action', keyword: 'Tap', target: opt },
  ...(withContinue ? [{ step: 1, screen: 'Cooking time', kind: 'Action', keyword: 'Tap', target: 'Continue' }] : []),
  { step: 2, screen: 'Recipe source', kind: 'Nav', keyword: 'Verify screen', target: 'Recipe source' },
  { step: 2, screen: 'Recipe source', kind: 'Check', keyword: 'Verify displayed', target: 'Recipe source', label: 'Màn Recipe source' },
];
const tcRows = (id, target, flow) => ({ id, fresh: true, pre: [], rows: [
  { step: 0, screen: '', kind: 'Action', keyword: 'Launch fresh' },
  ...(flow ? [{ step: 0, screen: '', kind: 'Action', keyword: 'Run flow', value: flow }] : []),
  { step: 1, screen: 'Cooking time', kind: 'Action', keyword: 'Tap', target },
  { step: 1, screen: 'Cooking time', kind: 'Check', keyword: 'Verify displayed', target: 'Continue', label: 'Nút Continue' },
] });

test('convertSheet + app: luồng bấm "first option" thiếu Continue → AI lập lại khung kèm lỗi theo app; system prompt có locator map', async () => {
  const calls = { sk: [], rows: [] };
  const runClaude = async (req) => {
    if (req.schema.properties.order) {
      calls.sk.push(req);
      const ok = calls.sk.length > 1;
      return { ok: true, data: { order: [{ id: 'TC_1', fresh: true }], groups: [['TC_1']], flows: { 'Cooking time → Recipe source': flowRows(ok ? 'Honestly, it depends' : 'first option', ok) } } };
    }
    calls.rows.push(req);
    return { ok: true, data: { testcases: [tcRows('TC_1', 'Around lunchtime', 'Cooking time → Recipe source')] } };
  };
  const r = await convertSheet({ sheet: { sheet: 'W', cases: [mc('TC_1')] }, decisions: [{ id: 'TC_1', mode: 'automate' }], runClaude, outDir: tmpDir(), appCtx: ctx });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(calls.sk.length, 2);
  assert.match(calls.sk[1].prompt, /"first option" không có trong locator map/);
  assert.match(calls.sk[1].prompt, /phải bấm "Continue"/);
  assert.match(calls.sk[0].system, /Around lunchtime/);
  assert.match(calls.rows[0].system, /Sơ đồ màn/);
});

test('convertSheet + app: dòng của case vẫn dùng target không có thật sau 2 lần sửa → vẫn ghi file, đưa vào "Cần review" [App]', async () => {
  let rowsCalls = 0;
  const runClaude = async (req) => {
    if (req.schema.properties.order) return { ok: true, data: { order: [{ id: 'TC_1', fresh: true }], groups: [['TC_1']], flows: {} } };
    rowsCalls++;
    return { ok: true, data: { testcases: [tcRows('TC_1', 'Goal thứ 1')] } };
  };
  const r = await convertSheet({ sheet: { sheet: 'W', cases: [mc('TC_1')] }, decisions: [{ id: 'TC_1', mode: 'automate' }], runClaude, outDir: tmpDir(), appCtx: ctx });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(rowsCalls, 2); // lần đầu + 1 lần sửa theo app (cảnh báo chỉ 1 vòng AI — QAPD_WARN_FIX_ROUNDS)
  assert.ok(r.review.some((x) => /\[App\] TC_1 step 1: "Goal thứ 1" không có trong locator map/.test(x)));
});

test('checkApp: đã bấm một nút đi tiếp khác (vd "Continue") thì không báo dù sơ đồ ghi nút khác; nhiều nút cho cùng cặp màn đều được', () => {
  const c = appContext({ locatorTable: { S: [{ key: 'Continue' }, { key: 'Start my free trial' }, { key: 'Skip' }] }, edges: [{ from: 'Free vs Plus', to: 'Paywall', target: 'Start my free trial' }, { from: 'Free vs Plus', to: 'Paywall', target: 'Skip' }] });
  const r = (t) => checkApp({ owner: 'F', ctx: c, rows: [{ step: 1, screen: 'Free vs Plus', kind: 'Action', keyword: 'Tap', target: t }, { step: 2, screen: 'Paywall', kind: 'Nav', keyword: 'Verify screen', target: 'Paywall' }] });
  assert.deepEqual(r('Continue'), []);
  assert.deepEqual(r('Skip'), []);
});

test('convertSheet + app: phần tử không có trong locator map và không có tên gần giống (màn chưa lấy locator) → chỉ cảnh báo, không bắt AI viết lại', async () => {
  let rowsCalls = 0;
  const runClaude = async (req) => {
    if (req.schema.properties.order) return { ok: true, data: { order: [{ id: 'TC_1', fresh: true }], groups: [['TC_1']], flows: {} } };
    rowsCalls++;
    return { ok: true, data: { testcases: [tcRows('TC_1', 'Zzqx hoàn toàn khác')] } };
  };
  const r = await convertSheet({ sheet: { sheet: 'W', cases: [{ ...mc('TC_1'), expected: '1. Hiển thị "Continue"' }] }, decisions: [{ id: 'TC_1', mode: 'automate' }], runClaude, outDir: tmpDir(), appCtx: ctx });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(rowsCalls, 1);
  assert.ok(r.review.some((x) => /\[App\] TC_1 step 1: "Zzqx hoàn toàn khác" không có trong locator map/.test(x)), r.review.join('|'));
});

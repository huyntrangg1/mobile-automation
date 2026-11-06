import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStore } from '../server/store.js';
import { createLock } from '../server/lock.js';
import { createSmoke } from '../server/smoke/run.js';
import os from 'node:os';
import path from 'node:path';
import { tmpDir, figmaExportJson } from './helpers.js';

const PRD = 'https://developers.begamob.com/workspace/stress-watch/prd1/blood-sugar';
const FIG = 'https://www.figma.com/design/SrFaXD304rwjPXcNRqXzh0/Moss--Copy-?node-id=5433-75649';
const XML = `<XCUIElementTypeApplication type="XCUIElementTypeApplication" name="App" x="0" y="0" width="375" height="812">
  <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Blood Sugar" label="Blood Sugar" x="10" y="50" width="200" height="30" visible="true"/>
  <XCUIElementTypeButton type="XCUIElementTypeButton" name="Log Now" label="Log Now" x="10" y="100" width="100" height="40" visible="true"/>
</XCUIElementTypeApplication>`;
const flow = (id, frames = [{ nodeId: '1:2', name: 'Log Blood Sugar' }]) => ({ id, name: `Luồng ${id}`, goal: 'g', prdQuote: 'Tap Log Now mở màn Log', expected: ['mở màn Log'], frames, unclear: ['EC-10 chưa rõ'] });
const step = (o) => ({ ok: true, data: o });

const PAYWALL = `<XCUIElementTypeApplication type="XCUIElementTypeApplication" name="App" x="0" y="0" width="375" height="812">
  <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Moss Pro" label="Moss Pro" x="10" y="50" width="200" height="30" visible="true"/>
  <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Restore Purchases" label="Restore Purchases" x="10" y="90" width="200" height="30" visible="true"/>
  <XCUIElementTypeButton type="XCUIElementTypeButton" name="Continue" label="Continue" x="10" y="700" width="300" height="50" visible="true"/>
</XCUIElementTypeApplication>`;
const btn = (n, y) => `<XCUIElementTypeButton type="XCUIElementTypeButton" name="${n}" label="${n}" x="10" y="${y}" width="60" height="40" visible="true"/>`;
const MAIN = `<XCUIElementTypeApplication type="XCUIElementTypeApplication" name="App" x="0" y="0" width="375" height="812">
  <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Daily" label="Daily" x="10" y="50" width="200" height="30" visible="true"/>
  ${['Daily', 'Actions', 'Stats', 'Health', 'Settings'].map((n, i) => btn(`tab-${n}`, 700 + i)).join('\n  ')}
</XCUIElementTypeApplication>`;
const PREP = 'Chuẩn bị: đưa app tới màn chính';
const prepOk = step({ action: 'done', flowStatus: 'ok', summary: 'Đã ở màn chính' });

function setup({ app = true, claude, flows = [flow('f1')], loadFlows, openImpl, limits, prepare = prepOk, xml = XML, onLoad, onFrame, usageEach, frameImageImpl, analyzeImpl, rotateFails = false, attachImpl, pushImpl, appExtra = {}, state } = {}) {
  const dataDir = tmpDir();
  const store = createStore(dataDir);
  if (app) store.put('apps', { id: 'a', name: 'StressWatch', platform: 'iOS', bundleId: 'com.x.sw', ...appExtra });
  if (state) store.put('smokeState', state);
  const sessions = [];
  const hides = [];
  const lock = createLock();
  const events = [];
  const prompts = [];
  const prepCalls = [];
  const taps = [];
  const clicks = [];
  const execs = [];
  // Vuốt = chuỗi có ≥ 2 điểm move rồi perform; chạm = 1 điểm. Số lần vuốt quyết định trang nào đang hiện (xml có thể là hàm của số lần vuốt)
  let swipes = 0;
  let moves = 0;
  const chain = { move: (p) => { moves++; taps.push(p); return chain; }, down: () => chain, pause: () => chain, up: () => chain, perform: async () => { if (moves >= 2) swipes++; moves = 0; } };
  const src = () => (typeof xml === 'function' ? xml(swipes) : xml);
  const log = { dismissed: 0 };
  const driver = {
    action: () => chain,
    getPageSource: async () => src(),
    takeScreenshot: async () => Buffer.from('png').toString('base64'),
    getWindowSize: async () => ({ width: 375, height: 812 }),
    getWindowRect: async () => ({ width: 375, height: 812 }),
    setOrientation: async (o) => { if (rotateFails) throw new Error('Unable To Rotate Device'); execs.push(['orient', o]); },
    execute: async (cmd, a) => { execs.push(['execute', cmd, a]); return cmd === 'mobile: source' ? src() : cmd === 'mobile: activeAppInfo' ? { bundleId: 'com.x.sw' } : undefined; },
    $: async (sel) => ({ click: async () => { clicks.push(sel); }, setValue: async () => {} }),
    pause: async () => {}, back: async () => {},
    hideKeyboard: async () => { hides.push(1); },
  };
  const smoke = createSmoke({
    store, lock, emit: (k, v) => events.push(k), dataDir,
    openImpl: async (a) => { sessions.push('open'); return openImpl ? openImpl(a) : { driver, close: async () => {} }; },
    attachImpl: async (a) => { sessions.push('attach'); return attachImpl ? attachImpl(a) : { driver, close: async () => {} }; },
    runClaude: async (o) => {
      if (usageEach) o.onUsage?.(usageEach);
      if (o.prompt.includes(PREP)) { prepCalls.push(o); return typeof prepare === 'function' ? prepare(o, prepCalls.length) : prepare; }
      prompts.push(o);
      return typeof claude === 'function' ? claude(o, prompts.length) : claude;
    },
    loadFlows: loadFlows || (async (a) => { onLoad?.(a); return { ok: true, flows }; }),
    frameImage: frameImageImpl || (async ({ outFile }) => { onFrame?.(); fs.mkdirSync(outFile.replace(/[^/]+$/, ''), { recursive: true }); fs.writeFileSync(outFile, 'png'); return { ok: true, file: outFile }; }),
    ...(analyzeImpl ? { analyze: analyzeImpl } : {}),
    ...(pushImpl ? { pushImpl } : {}),
    settleOpts: { pollMs: 1, quietMs: 1, maxMs: 30 },
    limits: { maxSteps: 25, flowMs: 60000, totalMs: 120000, ...limits },
  });
  // Mặc định các test tắt kiểm bền vững (thêm một luồng + lần gọi AI); test riêng bật bằng robust: true
  return { smoke: { ...smoke, start: (o) => smoke.start({ robust: false, ...o }) }, store, lock, prompts, prepCalls, taps, clicks, execs, events, dataDir, log, sessions, swipeCount: () => swipes, keyboardHides: () => hides.length };
}
const until = async (fn) => { const end = Date.now() + 5000; while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); } };
const finished = (store, id) => until(() => store.get('smoke', id).status !== 'running');
const args = { appId: 'a', udid: 'U', prdUrl: PRD, figmaUrl: FIG };

test('start: lỗi đầu vào → 404 / 400 đúng status, chưa chiếm thiết bị', async () => {
  const { smoke, lock } = setup({ claude: step({ action: 'done', flowStatus: 'ok', summary: '' }) });
  await assert.rejects(smoke.start({ ...args, appId: 'zzz' }), (e) => e.status === 404);
  await assert.rejects(smoke.start({ ...args, udid: '' }), (e) => e.status === 400);
  await assert.rejects(smoke.start({ ...args, figmaUrl: 'https://www.figma.com/design/SrFaXD304rwjPXcNRqXzh0/Moss' }), (e) => e.status === 400 && /node-id/.test(e.message));
  assert.equal(lock.current(), null);
});

test('start: thiết bị đang bận → 409 và KHÔNG gọi loadFlows', async () => {
  let called = 0;
  const { smoke, lock } = setup({ loadFlows: async () => { called++; return { ok: true, flows: [] }; } });
  lock.acquire({ id: 'RUN-1', kind: 'run', label: 'Run khác' });
  await assert.rejects(smoke.start(args), (e) => e.status === 409 && /Run khác/.test(e.message));
  assert.equal(called, 0);
});

test('chạy trọn một luồng: tap → AI ghi điểm lệch + done → deviation, có ảnh app + Figma, nhả khóa', async () => {
  const { smoke, store, lock, prompts } = setup({
    claude: (o, n) => (n === 1
      ? step({ action: 'tap', locator: '~Log Now' })
      : step({ action: 'done', flowStatus: 'deviation', summary: 'Nút lệch Figma', finding: { kind: 'figma', summary: 'Nút Log Now vuông, Figma bo tròn', frameName: 'Log Blood Sugar', prdQuote: 'Tap Log Now mở màn Log' } })),
  });
  const rec = await smoke.start(args);
  assert.equal(rec.id, 'SM-0001');
  await finished(store, rec.id);
  const r = store.get('smoke', rec.id);
  assert.equal(r.status, 'done');
  assert.equal(r.flows[0].status, 'deviation');
  assert.equal(r.flows[0].summary, 'Nút lệch Figma');
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].kind, 'figma');
  assert.equal(r.findings[0].flowId, 'f1');
  assert.match(r.findings[0].appShot, /^\/files\/data\/smoke\/SM-0001\/.+\.png$/);
  assert.match(r.findings[0].figmaShot, /^\/files\/data\/smoke\/SM-0001\/.+\.png$/);
  assert.deepEqual(prompts[0].allowedTools, ['Read']);
  assert.match(prompts[0].prompt, /Tap Log Now mở màn Log/);
  assert.match(prompts[0].prompt, /Log Blood Sugar/);
  assert.match(prompts[0].prompt, /EC-10 chưa rõ/);
  assert.equal(lock.current(), null);
  assert.ok(typeof r.finishedAt === 'string');
});

test('loadFlows lỗi → status error giữ nguyên lời lỗi, khóa nhả', async () => {
  const { smoke, store, lock } = setup({ loadFlows: async () => ({ ok: false, error: 'Không đọc được PRD hoặc Figma: hết phiên' }) });
  const rec = await smoke.start(args);
  await finished(store, rec.id);
  const r = store.get('smoke', rec.id);
  assert.equal(r.status, 'error');
  assert.equal(r.error, 'Không đọc được PRD hoặc Figma: hết phiên');
  assert.equal(lock.current(), null);
});

test('mở phiên Appium lỗi → status error, khóa nhả', async () => {
  const { smoke, store, lock } = setup({ openImpl: async () => { throw new Error('Không mở được WebDriverAgent'); }, claude: step({ action: 'done', flowStatus: 'ok', summary: '' }) });
  const rec = await smoke.start(args);
  await finished(store, rec.id);
  assert.equal(store.get('smoke', rec.id).status, 'error');
  assert.match(store.get('smoke', rec.id).error, /WebDriverAgent/);
  assert.equal(lock.current(), null);
});

test('AI lặp đúng một thao tác 3 lần liên tiếp → luồng unverifiable, sang luồng kế', async () => {
  const { smoke, store } = setup({ flows: [flow('f1'), flow('f2')], claude: step({ action: 'tap', locator: '~Log Now' }) });
  const rec = await smoke.start(args);
  await finished(store, rec.id);
  const r = store.get('smoke', rec.id);
  assert.equal(r.status, 'done');
  assert.deepEqual(r.flows.map((f) => f.status), ['unverifiable', 'unverifiable']);
  assert.match(r.flows[0].summary, /lặp/);
});

test('vượt maxSteps → luồng unverifiable', async () => {
  let n = 0;
  const { smoke, store } = setup({ limits: { maxSteps: 4 }, claude: () => step(++n % 2 ? { action: 'swipe', text: 'up' } : { action: 'swipe', text: 'down' }) });
  const rec = await smoke.start(args);
  await finished(store, rec.id);
  const r = store.get('smoke', rec.id);
  assert.equal(r.flows[0].status, 'unverifiable');
  assert.ok(r.flows[0].steps <= 4);
  assert.match(r.flows[0].summary, /giới hạn/);
});

test('AI lỗi 3 lần liên tiếp → luồng unverifiable (không làm hỏng cả lần chạy)', async () => {
  const { smoke, store } = setup({ flows: [flow('f1'), flow('f2')], claude: { ok: false, error: 'hết phiên' } });
  const rec = await smoke.start(args);
  await finished(store, rec.id);
  const r = store.get('smoke', rec.id);
  assert.equal(r.status, 'done');
  assert.deepEqual(r.flows.map((f) => f.status), ['unverifiable', 'unverifiable']);
  assert.match(r.flows[0].summary, /AI lỗi/);
});

test('stop giữa chừng → status stopped, khóa nhả', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { smoke, store, lock, prompts } = setup({ claude: async () => { await gate; return step({ action: 'wait' }); } });
  const rec = await smoke.start(args);
  await until(() => prompts.length >= 1);
  const stopping = smoke.stop(rec.id);
  release();
  await stopping;
  assert.equal(store.get('smoke', rec.id).status, 'stopped');
  assert.equal(smoke.running(rec.id), false);
  assert.equal(lock.current(), null);
});

test('recover: lần chạy running không còn job → interrupted, luồng đang chạy về pending', () => {
  const { smoke, store } = setup();
  store.put('smoke', { id: 'SM-0009', appId: 'a', status: 'running', log: [], findings: [], flows: [{ id: 'f1', name: 'x', status: 'running', steps: 3, summary: '' }, { id: 'f2', name: 'y', status: 'ok', steps: 5, summary: '' }] });
  smoke.recover();
  const r = store.get('smoke', 'SM-0009');
  assert.equal(r.status, 'interrupted');
  assert.deepEqual(r.flows.map((f) => f.status), ['pending', 'ok']);
  assert.ok(r.finishedAt);
});

test('lock.recover khi server khởi động: lần chạy smoke đang running → interrupted', () => {
  const { store, lock } = setup();
  store.put('smoke', { id: 'SM-0007', appId: 'a', status: 'running', log: [], flows: [], findings: [] });
  lock.recover(store);
  assert.equal(store.get('smoke', 'SM-0007').status, 'interrupted');
});

test('PRD tuỳ chọn: start không có prdUrl vẫn chạy, loadFlows nhận prdUrl rỗng', async () => {
  const seen = [];
  const { smoke, store } = setup({ onLoad: (a) => seen.push(a), claude: step({ action: 'done', flowStatus: 'ok', summary: 'Khớp' }) });
  const rec = await smoke.start({ appId: 'a', udid: 'U', figmaUrl: FIG });
  await finished(store, rec.id);
  assert.equal(store.get('smoke', rec.id).status, 'done');
  assert.equal(seen[0].prdUrl || '', '');
});

test('chuẩn bị: AI tự đưa app tới màn chính trước các luồng; bước chuẩn bị KHÔNG tính vào bước của luồng', async () => {
  const { smoke, store, prepCalls } = setup({
    prepare: (o, n) => (n === 1 ? step({ action: 'tap', locator: '~Log Now' }) : step({ action: 'done', flowStatus: 'ok', summary: 'Đã qua onboarding' })),
    claude: step({ action: 'done', flowStatus: 'ok', summary: 'Khớp' }),
  });
  const rec = await smoke.start(args);
  await finished(store, rec.id);
  const r = store.get('smoke', rec.id);
  assert.equal(prepCalls.length, 2);
  assert.deepEqual(r.prepare && { status: r.prepare.status, steps: r.prepare.steps }, { status: 'ok', steps: 2 });
  assert.equal(r.flows[0].steps, 1);
  assert.equal(r.status, 'done');
});

test('chuẩn bị thất bại → lần chạy error có lý do, KHÔNG chạy luồng nào, nhả khóa', async () => {
  const { smoke, store, lock, prompts } = setup({ prepare: step({ action: 'done', flowStatus: 'unreachable', summary: 'Paywall chặn, không có nút đóng' }) });
  const rec = await smoke.start(args);
  await finished(store, rec.id);
  const r = store.get('smoke', rec.id);
  assert.equal(r.status, 'error');
  assert.match(r.error, /màn chính/);
  assert.match(r.error, /Paywall chặn/);
  assert.deepEqual(r.flows.map((f) => f.status), ['pending']);
  assert.equal(prompts.length, 0);
  assert.equal(lock.current(), null);
});

test('tapPoint: AI bấm theo toạ độ % trên ảnh → chạm đúng điểm (nút X không có trong cây phần tử)', async () => {
  const { smoke, store, taps } = setup({ claude: (o, n) => (n === 1 ? step({ action: 'tapPoint', x: 50, y: 10 }) : step({ action: 'done', flowStatus: 'ok', summary: 'ok' })) });
  const rec = await smoke.start(args);
  await finished(store, rec.id);
  assert.deepEqual(taps, [{ x: 188, y: 81 }]); // 375×50% và 812×10%
});

test('paywall: tự đóng tối đa 2 lần, còn kẹt thì giao cho AI (kèm nhắc paywall), không mở lại app vòng vo', async () => {
  const { smoke, store, prompts } = setup({ xml: PAYWALL, claude: step({ action: 'done', flowStatus: 'ok', summary: 'ok' }) });
  const rec = await smoke.start(args);
  await finished(store, rec.id);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0].prompt, /Màn này trông như paywall/);
});

test('chỉ cần một trong hai link: không có cả PRD lẫn Figma → 400; chỉ PRD → chạy bình thường, không tải ảnh Figma', async () => {
  const none = setup({ claude: step({ action: 'done', flowStatus: 'ok', summary: '' }) });
  await assert.rejects(none.smoke.start({ appId: 'a', udid: 'U' }), (e) => e.status === 400 && /PRD.*Figma/.test(e.message));
  assert.equal(none.lock.current(), null);
  let imgs = 0;
  const seen = [];
  const { smoke, store } = setup({ onFrame: () => imgs++, onLoad: (a) => seen.push(a), claude: step({ action: 'done', flowStatus: 'ok', summary: 'Khớp PRD' }) });
  const rec = await smoke.start({ appId: 'a', udid: 'U', prdUrl: PRD });
  await finished(store, rec.id);
  assert.equal(store.get('smoke', rec.id).status, 'done');
  assert.equal(imgs, 0);
  assert.ok(!seen[0].figmaUrl);
});

test('token: bước thao tác dùng chế độ gọn (lean + chỉ Read); bước chuẩn bị ở màn thường KHÔNG dùng ảnh (noTools)', async () => {
  const { smoke, store, prompts, prepCalls } = setup({ xml: MAIN, claude: step({ action: 'done', flowStatus: 'ok', summary: 'ok' }) });
  const rec = await smoke.start(args);
  await finished(store, rec.id);
  assert.equal(prompts[0].lean, true);
  assert.deepEqual(prompts[0].allowedTools, ['Read']);
  assert.equal(prepCalls[0].noTools, true);
  assert.match(prepCalls[0].prompt, /không dùng ảnh/);
});

test('token: bước chuẩn bị gặp paywall hoặc màn ít phần tử → vẫn dùng ảnh (Read, lean)', async () => {
  for (const xml of [PAYWALL, XML]) {
    const { smoke, store, prepCalls } = setup({ xml, claude: step({ action: 'done', flowStatus: 'ok', summary: 'ok' }) });
    const rec = await smoke.start(args);
    await finished(store, rec.id);
    assert.ok(!prepCalls[0].noTools);
    assert.equal(prepCalls[0].lean, true);
    assert.deepEqual(prepCalls[0].allowedTools, ['Read']);
  }
});

test('gộp điểm lệch: prompt của luồng sau có danh sách điểm lệch đã ghi ở luồng trước', async () => {
  const { smoke, store, prompts } = setup({
    flows: [flow('f1'), flow('f2')],
    claude: (o) => (/Luồng f1/.test(o.prompt)
      ? step({ action: 'done', flowStatus: 'deviation', summary: 'Lệch', finding: { kind: 'figma', summary: 'Sau Save dữ liệu không hiện', frameName: 'Log Blood Sugar' } })
      : step({ action: 'done', flowStatus: 'ok', summary: 'ok' })),
  });
  const rec = await smoke.start(args);
  await finished(store, rec.id);
  const second = prompts.find((p) => /Luồng f2/.test(p.prompt));
  assert.match(second.prompt, /Sau Save dữ liệu không hiện/);
  const first = prompts.find((p) => /Luồng f1/.test(p.prompt));
  assert.doesNotMatch(first.prompt, /Sau Save dữ liệu không hiện/);
});

test('token: cộng dồn usage + chi phí mọi lần gọi AI của lần chạy vào bản ghi (calls, token, USD)', async () => {
  const usageEach = { usage: { input_tokens: 1, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 5 }, cost: 0.01 };
  const { smoke, store, prepCalls, prompts } = setup({ usageEach, claude: step({ action: 'done', flowStatus: 'ok', summary: 'ok' }) });
  const rec = await smoke.start(args);
  await finished(store, rec.id);
  const u = store.get('smoke', rec.id).usage;
  const n = prepCalls.length + prompts.length;
  assert.equal(n, 2);
  assert.deepEqual({ calls: u.calls, input: u.input, cacheCreate: u.cacheCreate, cacheRead: u.cacheRead, output: u.output }, { calls: 2, input: 2, cacheCreate: 20, cacheRead: 200, output: 10 });
  assert.ok(Math.abs(u.costUsd - 0.02) < 1e-9);
});

test('token: loadFlows nhận onUsage để tính cả lần rút luồng', async () => {
  const seen = [];
  const { smoke, store } = setup({ onLoad: (a) => seen.push(a), claude: step({ action: 'done', flowStatus: 'ok', summary: 'ok' }) });
  const rec = await smoke.start(args);
  await finished(store, rec.id);
  assert.equal(typeof seen[0].onUsage, 'function');
});

const TRIAL = `<XCUIElementTypeApplication type="XCUIElementTypeApplication" name="App" x="0" y="0" width="375" height="812">
  <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Welcome" label="Welcome" x="10" y="50" width="200" height="30" visible="true"/>
  <XCUIElementTypeButton type="XCUIElementTypeButton" name="Log Now" label="Log Now" x="10" y="100" width="100" height="40" visible="true"/>
  <XCUIElementTypeButton type="XCUIElementTypeButton name="Start free trial" label="Start free trial" x="10" y="300" width="300" height="50" visible="true"/>
</XCUIElementTypeApplication>`.replace('type="XCUIElementTypeButton name=', 'type="XCUIElementTypeButton" name=');
const CONT = `<XCUIElementTypeApplication type="XCUIElementTypeApplication" name="App" x="0" y="0" width="375" height="812">
  <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Welcome" label="Welcome" x="10" y="50" width="200" height="30" visible="true"/>
  <XCUIElementTypeButton type="XCUIElementTypeButton" name="Continue" label="Continue" x="10" y="700" width="300" height="50" visible="true"/>
</XCUIElementTypeApplication>`;
const doneOk = step({ action: 'done', flowStatus: 'ok', summary: 'Khớp' });

// ---- Important 1: không có "đạt" khi AI chưa thao tác gì ----
test('done + ok ở bước đầu khi chưa thao tác gì → hạ xuống unverifiable (không báo Khớp)', async () => {
  const { smoke, store } = setup({ claude: doneOk });
  const rec = await smoke.start(args);
  await finished(store, rec.id);
  const f = store.get('smoke', rec.id).flows[0];
  assert.equal(f.status, 'unverifiable');
  assert.match(f.summary, /chưa thao tác/);
});

test('done + ok sau khi đã thao tác thành công → vẫn là ok', async () => {
  const { smoke, store } = setup({ claude: (o, n) => (n === 1 ? step({ action: 'tap', locator: '~Log Now' }) : doneOk) });
  const rec = await smoke.start(args);
  await finished(store, rec.id);
  assert.equal(store.get('smoke', rec.id).flows[0].status, 'ok');
});

// ---- Important 2: Dừng phản hồi ngay, huỷ cả lần rút luồng và lần tải ảnh ----
const abortable = (signal, value) => new Promise((resolve) => { if (signal?.aborted) return resolve(value); signal?.addEventListener('abort', () => resolve(value), { once: true }); });

test('Dừng khi đang rút luồng → huỷ ngay (signal), status stopped, nhả khóa, không treo', async () => {
  let started = false;
  const { smoke, store, lock } = setup({ loadFlows: async ({ signal }) => { started = true; return abortable(signal, { ok: false, cancelled: true, error: 'Đã dừng' }); } });
  const rec = await smoke.start(args);
  await until(() => started);
  const t = Date.now();
  await smoke.stop(rec.id);
  assert.ok(Date.now() - t < 1000, 'stop phải trả về nhanh');
  assert.equal(store.get('smoke', rec.id).status, 'stopped');
  assert.equal(lock.current(), null);
});

test('Dừng khi đang tải ảnh frame Figma → huỷ ngay, status stopped', async () => {
  let started = 0;
  const { smoke, store, lock } = setup({ frameImageImpl: async ({ signal }) => { started++; return abortable(signal, { ok: false, cancelled: true, error: 'Đã dừng' }); } });
  const rec = await smoke.start(args);
  await until(() => started > 0);
  await smoke.stop(rec.id);
  assert.equal(store.get('smoke', rec.id).status, 'stopped');
  assert.equal(lock.current(), null);
});

test('mọi lần gọi AI của vòng chạy đều nhận signal để huỷ được', async () => {
  const { smoke, store, prompts, prepCalls } = setup({ claude: doneOk });
  const rec = await smoke.start(args);
  await finished(store, rec.id);
  assert.ok(prompts[0].signal instanceof AbortSignal);
  assert.ok(prepCalls[0].signal instanceof AbortSignal);
});

// ---- Important 3: mất Figma giữa chừng không được kết thúc "Xong" mà không đối chiếu ----
test('có link Figma mà KHÔNG tải được frame nào → error kèm hướng dẫn /mcp, không chạy luồng, nhả khóa', async () => {
  const { smoke, store, lock, prompts } = setup({ frameImageImpl: async () => ({ ok: false, error: 'Figma chưa đăng nhập' }) });
  const rec = await smoke.start(args);
  await finished(store, rec.id);
  const r = store.get('smoke', rec.id);
  assert.equal(r.status, 'error');
  assert.match(r.error, /Figma/);
  assert.match(r.error, /\/mcp/);
  assert.equal(prompts.length, 0);
  assert.equal(lock.current(), null);
});

test('tải được một số frame (không phải tất cả) → vẫn chạy tiếp', async () => {
  let n = 0;
  const { smoke, store } = setup({
    flows: [flow('f1', [{ nodeId: '1:2', name: 'A' }, { nodeId: '1:3', name: 'B' }])],
    frameImageImpl: async ({ outFile }) => (++n === 1 ? { ok: false, error: 'lỗi' } : (fs.mkdirSync(outFile.replace(/[^/]+$/, ''), { recursive: true }), fs.writeFileSync(outFile, 'png'), { ok: true, file: outFile })),
    claude: doneOk,
  });
  const rec = await smoke.start(args);
  await finished(store, rec.id);
  assert.equal(store.get('smoke', rec.id).status, 'done');
});

// ---- Important 5: lớp chặn mua trong code ----
test('chặn mua: tap vào nút "Start free trial" bị từ chối (không click), ghi log', async () => {
  const { smoke, store, clicks } = setup({ xml: TRIAL, claude: (o, n) => (n === 1 ? step({ action: 'tap', locator: '~Start free trial' }) : doneOk) });
  const rec = await smoke.start(args);
  await finished(store, rec.id);
  assert.ok(!clicks.includes('~Start free trial'));
  assert.match(store.get('smoke', rec.id).log.join('\n'), /mua|đăng ký|dùng thử/i);
});

test('chặn mua: tapPoint rơi vào nút mua bị từ chối; ngoài nút thì vẫn chạm', async () => {
  const inside = setup({ xml: TRIAL, claude: (o, n) => (n === 1 ? step({ action: 'tapPoint', x: 50, y: 40 }) : doneOk) });
  const r1 = await inside.smoke.start(args);
  await finished(inside.store, r1.id);
  assert.deepEqual(inside.taps, []);
  const outside = setup({ xml: TRIAL, claude: (o, n) => (n === 1 ? step({ action: 'tapPoint', x: 50, y: 10 }) : doneOk) });
  const r2 = await outside.smoke.start(args);
  await finished(outside.store, r2.id);
  assert.equal(outside.taps.length, 1);
});

test('chặn mua: "Continue" bị chặn ở màn paywall nhưng được bấm ở màn thường (onboarding)', async () => {
  const pay = setup({ xml: PAYWALL, claude: (o, n) => (n === 1 ? step({ action: 'tap', locator: '~Continue' }) : doneOk) });
  const r1 = await pay.smoke.start(args);
  await finished(pay.store, r1.id);
  assert.ok(!pay.clicks.includes('~Continue'));
  const plain = setup({ xml: CONT, claude: (o, n) => (n === 1 ? step({ action: 'tap', locator: '~Continue' }) : doneOk) });
  const r2 = await plain.smoke.start(args);
  await finished(plain.store, r2.id);
  assert.ok(plain.clicks.includes('~Continue'));
});

// ---- Important 6: tài khoản test không được lưu vào transcript ----
test('có tài khoản test → mọi lần gọi AI dùng noPersist; không có thì không', async () => {
  const withAcc = setup({ claude: doneOk });
  const r1 = await withAcc.smoke.start({ ...args, account: 'qa@x.com / hunter2' });
  await finished(withAcc.store, r1.id);
  assert.ok([...withAcc.prompts, ...withAcc.prepCalls].every((o) => o.noPersist === true));
  assert.match(withAcc.prompts[0].prompt, /hunter2/);
  const noAcc = setup({ claude: doneOk });
  const r2 = await noAcc.smoke.start(args);
  await finished(noAcc.store, r2.id);
  assert.ok([...noAcc.prompts, ...noAcc.prepCalls].every((o) => !o.noPersist));
});

// ---- Figma từ file .json (không gọi Figma MCP) ----
const writeExport = (text = figmaExportJson()) => { const f = path.join(tmpDir(), 'Moss.json'); fs.writeFileSync(f, text); return f; };

test('Figma .json: loadFlows nhận figmaSummary (không có figmaUrl); KHÔNG gọi frameImage (Figma MCP); ảnh Figma lấy từ file', async () => {
  const seen = [];
  let imgs = 0;
  const { smoke, store, dataDir } = setup({
    onLoad: (a) => seen.push(a), onFrame: () => imgs++,
    flows: [flow('f1', [{ nodeId: '1:3', name: 'Blood Sugar - Log' }])],
    claude: (o, n) => (n === 1 ? step({ action: 'tap', locator: '~Log Now' }) : step({ action: 'done', flowStatus: 'deviation', summary: 'Lệch', finding: { kind: 'figma', summary: 'Nút Save sai màu so với Figma', frameName: 'Blood Sugar - Log' } })),
  });
  const rec = await smoke.start({ appId: 'a', udid: 'U', figmaFile: writeExport(), figmaName: 'Moss.json' });
  await finished(store, rec.id);
  const r = store.get('smoke', rec.id);
  assert.equal(r.status, 'done');
  assert.equal(r.figmaSource, 'json');
  assert.equal(r.figmaFileName, 'Moss.json');
  assert.match(seen[0].figmaSummary, /\[1:3\] Blood Sugar - Log/);
  assert.ok(!seen[0].figmaUrl);
  assert.equal(imgs, 0);
  assert.match(r.findings[0].figmaShot, /^\/files\/data\/smoke\/SM-0001\/.+\.png$/);
  // ảnh frame từ file nằm trong thư mục của lần chạy và là ảnh gốc trong file
  assert.equal(fs.readFileSync(path.join(dataDir, 'smoke', rec.id, 'figma-1_3.png'), 'utf8'), 'PNG-LOG');
});

test('Figma .json không hợp lệ → 400 trước khi chiếm thiết bị', async () => {
  const { smoke, lock } = setup({ claude: step({ action: 'done', flowStatus: 'ok', summary: '' }) });
  await assert.rejects(smoke.start({ appId: 'a', udid: 'U', figmaFile: writeExport('không phải json') }), (e) => e.status === 400 && /JSON|plugin/.test(e.message));
  assert.equal(lock.current(), null);
});

test('không có PRD, link Figma lẫn file .json → 400 nhắc cả file .json', async () => {
  const { smoke } = setup({ claude: step({ action: 'done', flowStatus: 'ok', summary: '' }) });
  await assert.rejects(smoke.start({ appId: 'a', udid: 'U' }), (e) => e.status === 400 && /\.json/.test(e.message));
});

test('có cả file .json và link Figma → dùng file, bỏ qua link (kể cả link sai)', async () => {
  const { smoke, store } = setup({ claude: step({ action: 'done', flowStatus: 'ok', summary: 'ok' }) });
  const rec = await smoke.start({ appId: 'a', udid: 'U', figmaFile: writeExport(), figmaUrl: 'https://example.com/khong-hop-le' });
  await finished(store, rec.id);
  assert.equal(store.get('smoke', rec.id).status, 'done');
  assert.equal(store.get('smoke', rec.id).figmaSource, 'json');
});

// ---- So màu / kích thước / vị trí bằng code (bộ so ảnh với Figma) khi có file Figma .json ----
const finding = (o = {}) => ({ kind: 'fill', cat: 'color', target: 'Log Now', severity: 'Minor', reason: 'Màu nền khác Figma', actual: 'Nút "Log Now" nền #34C759.', expected: 'Nút "Log Now" nền #0A84FF (theo Figma).', image: '/x/ev-1.png', ...o });
const exportFlow = flow('f1', [{ nodeId: '1:2', name: 'Action - Blood Sugar No data' }, { nodeId: '1:3', name: 'Blood Sugar - Log' }]);
function setupCompare({ claude, analyze, extra = {} } = {}) {
  const calls = [];
  const h = setup({ flows: [exportFlow], claude, ...extra, analyzeImpl: async (o) => { calls.push(o); return typeof analyze === 'function' ? analyze(o) : analyze; } });
  return { ...h, calls };
}

test('so bằng code: AI báo atFrame → tool chạy bộ so với frame đó; điểm lệch (bỏ Trivial) thành finding kind figma kèm ảnh so; luồng thành deviation', async () => {
  const { smoke, store, calls } = setupCompare({
    claude: (o, n) => (n === 1 ? step({ action: 'tap', locator: '~Log Now', atFrame: 'Action - Blood Sugar No data' }) : step({ action: 'done', flowStatus: 'ok', summary: 'ok' })),
    analyze: { status: 'failed', findings: [finding(), finding({ severity: 'Trivial', target: 'x', actual: 'a', expected: 'b' })], error: null },
  });
  const rec = await smoke.start({ appId: 'a', udid: 'U', figmaFile: writeExport() });
  await finished(store, rec.id);
  const r = store.get('smoke', rec.id);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].frame.name, 'Action - Blood Sugar No data');
  assert.ok(Buffer.isBuffer(calls[0].capture.png));
  assert.equal(typeof calls[0].capture.xml, 'string');
  assert.equal(calls[0].capture.platform, 'iOS');
  assert.ok(fs.existsSync(calls[0].frame.json) && fs.existsSync(calls[0].frame.png));
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].kind, 'figma');
  assert.match(r.findings[0].summary, /Màu nền khác Figma/);
  assert.match(r.findings[0].summary, /#0A84FF/);
  assert.equal(r.findings[0].evidence, true);
  assert.match(r.findings[0].appShot, /^\/files\/data\/smoke\/SM-0001\/ev-1\.png$/);
  assert.equal(r.flows[0].status, 'deviation');
});

test('so bằng code: cùng frame chỉ so một lần mỗi luồng; tên frame lạ hoặc không có file .json thì không so', async () => {
  const twice = setupCompare({
    claude: (o, n) => (n <= 2 ? step({ action: 'swipe', text: 'up', atFrame: 'Action - Blood Sugar No data' }) : step({ action: 'done', flowStatus: 'ok', summary: 'ok' })),
    analyze: { status: 'passed', findings: [], error: null },
  });
  const r1 = await twice.smoke.start({ appId: 'a', udid: 'U', figmaFile: writeExport() });
  await finished(twice.store, r1.id);
  assert.equal(twice.calls.length, 1);

  const unknown = setupCompare({ claude: (o, n) => (n === 1 ? step({ action: 'wait', atFrame: 'Không có frame này' }) : step({ action: 'done', flowStatus: 'unverifiable', summary: 'x' })), analyze: { status: 'passed', findings: [], error: null } });
  const r2 = await unknown.smoke.start({ appId: 'a', udid: 'U', figmaFile: writeExport() });
  await finished(unknown.store, r2.id);
  assert.equal(unknown.calls.length, 0);

  const link = setupCompare({ claude: (o, n) => (n === 1 ? step({ action: 'wait', atFrame: 'Action - Blood Sugar No data' }) : step({ action: 'done', flowStatus: 'unverifiable', summary: 'x' })), analyze: { status: 'passed', findings: [], error: null } });
  const r3 = await link.smoke.start(args); // chế độ link: không có cây node để so
  await finished(link.store, r3.id);
  assert.equal(link.calls.length, 0);
});

test('so bằng code: bộ so báo lỗi (blocked) → không có finding, ghi log, lần chạy vẫn tiếp tục', async () => {
  const { smoke, store } = setupCompare({
    claude: (o, n) => (n === 1 ? step({ action: 'wait', atFrame: 'Action - Blood Sugar No data' }) : step({ action: 'done', flowStatus: 'unverifiable', summary: 'x' })),
    analyze: { status: 'blocked', findings: [], error: 'So với Figma không được: thiếu file' },
  });
  const rec = await smoke.start({ appId: 'a', udid: 'U', figmaFile: writeExport() });
  await finished(store, rec.id);
  const r = store.get('smoke', rec.id);
  assert.equal(r.status, 'done');
  assert.equal(r.findings.length, 0);
  assert.match(r.log.join('\n'), /So với Figma không được/);
});

test('so bằng code: mỗi frame tối đa 6 điểm lệch', async () => {
  const words = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet']; // nhãn thật (không số) để không bị lọc là dữ liệu
  const many = words.map((w, i) => finding({ target: 'Log Now', kind: `fill${i}`, reason: `Màu nền khác Figma ${w}`, actual: `Nút "${w}" nền #A${i}.`, expected: `Nút "${w}" nền #B${i} (theo Figma).` }));
  const { smoke, store } = setupCompare({
    claude: (o, n) => (n === 1 ? step({ action: 'wait', atFrame: 'Action - Blood Sugar No data' }) : step({ action: 'done', flowStatus: 'ok', summary: 'ok' })),
    analyze: { status: 'failed', findings: many, error: null },
  });
  const rec = await smoke.start({ appId: 'a', udid: 'U', figmaFile: writeExport() });
  await finished(store, rec.id);
  assert.equal(store.get('smoke', rec.id).findings.length, 6);
});

// ---- Kiểm bền vững: nền / mở lại / xoay màn hình ----
const ROBUST = /LUỒNG ĐANG KIỂM: Kiểm bền vững/; // chỉ prompt của luồng giả (phần mô tả hành động cũng nhắc cụm này)
const robustClaude = (flowPlan, robustPlan) => (o, n) => (ROBUST.test(o.prompt) ? robustPlan(o, n) : flowPlan(o, n));
const flowDone = () => step({ action: 'done', flowStatus: 'ok', summary: 'ok' });

test('kiểm bền vững bật (robust: true): chạy SAU các luồng như một luồng giả "robust", dùng kiến thức bền vững', async () => {
  let k = 0;
  const { smoke, store, prompts } = setup({ claude: robustClaude(flowDone, () => (++k === 1 ? step({ action: 'tap', locator: '~Log Now' }) : step({ action: 'done', flowStatus: 'ok', summary: 'Giữ nguyên' }))) });
  const rec = await smoke.start({ ...args, robust: true });
  await finished(store, rec.id);
  const r = store.get('smoke', rec.id);
  assert.deepEqual(r.flows.map((f) => f.id), ['f1', 'robust']);
  assert.equal(r.flows[1].status, 'ok');
  assert.equal(r.robust, true);
  assert.match(prompts.find((p) => ROBUST.test(p.prompt)).prompt, /KIỂM BỀN VỮNG \(chưng cất/);
  assert.doesNotMatch(prompts.find((p) => /Luồng f1/.test(p.prompt)).prompt, /KIỂM BỀN VỮNG \(chưng cất/);
});

test('robust: false → không có luồng robust, không gọi AI cho nó', async () => {
  const { smoke, store, prompts } = setup({ claude: flowDone });
  const rec = await smoke.start({ ...args, robust: false });
  await finished(store, rec.id);
  const r = store.get('smoke', rec.id);
  assert.deepEqual(r.flows.map((f) => f.id), ['f1']);
  assert.equal(r.robust, false);
  assert.ok(!prompts.some((p) => ROBUST.test(p.prompt)));
});

test('hành động background: app xuống nền (SpringBoard) rồi mở lại; tính là đã thao tác', async () => {
  const { smoke, store, execs } = setup({ claude: (o, n) => (n === 1 ? step({ action: 'background', text: '3' }) : flowDone()) });
  const rec = await smoke.start({ ...args, robust: false });
  await finished(store, rec.id);
  const acts = execs.filter((e) => e[1] === 'mobile: activateApp').map((e) => e[2].bundleId);
  assert.deepEqual(acts.slice(0, 2), ['com.apple.springboard', 'com.x.sw']);
  assert.equal(store.get('smoke', rec.id).flows[0].status, 'ok'); // đã thao tác → "ok" được chấp nhận
  assert.match(store.get('smoke', rec.id).log.join('\n'), /nền/);
});

test('hành động rotate: xoay được → gọi setOrientation; không xoay được (app khóa dọc) → ghi log, KHÔNG phải lỗi, không tính là đã thao tác', async () => {
  const ok = setup({ claude: (o, n) => (n === 1 ? step({ action: 'rotate', text: 'landscape' }) : flowDone()) });
  const r1 = await ok.smoke.start({ ...args, robust: false });
  await finished(ok.store, r1.id);
  assert.deepEqual(ok.execs.filter((e) => e[0] === 'orient'), [['orient', 'LANDSCAPE']]);
  assert.equal(ok.store.get('smoke', r1.id).flows[0].status, 'ok');

  const locked = setup({ rotateFails: true, claude: (o, n) => (n === 1 ? step({ action: 'rotate', text: 'landscape' }) : flowDone()) });
  const r2 = await locked.smoke.start({ ...args, robust: false });
  await finished(locked.store, r2.id);
  const rec = locked.store.get('smoke', r2.id);
  assert.match(rec.log.join('\n'), /Không xoay được/);
  assert.equal(rec.status, 'done');
  assert.equal(rec.flows[0].status, 'unverifiable'); // chưa thao tác thành công nào
});

test('điểm lệch kind robust được ghi và tính là lệch', async () => {
  let k = 0;
  const { smoke, store } = setup({ claude: robustClaude(flowDone, () => (++k === 1 ? step({ action: 'background', text: '2' }) : step({ action: 'done', flowStatus: 'deviation', summary: 'Mất dữ liệu', finding: { kind: 'robust', summary: 'Sau khi xuống nền rồi mở lại, giá trị đã nhập mất' } }))) });
  const rec = await smoke.start({ ...args, robust: true });
  await finished(store, rec.id);
  const r = store.get('smoke', rec.id);
  assert.equal(r.findings[0].kind, 'robust');
  assert.equal(r.flows.at(-1).status, 'deviation');
});

test('Link PRD không phải đường link (chữ ghi chú dán nhầm) → 400 ngay, không chiếm máy, KHÔNG gọi AI', async () => {
  let called = 0;
  const { smoke, lock } = setup({ loadFlows: async () => { called++; return { ok: true, flows: [] }; } });
  for (const prdUrl of ['- Không còn trang nào để nhập frame Figma', 'https://example.com/x']) {
    await assert.rejects(smoke.start({ appId: 'a', udid: 'U', prdUrl, figmaFile: writeExport() }), (e) => e.status === 400 && /Link PRD/.test(e.message));
  }
  assert.equal(called, 0);
  assert.equal(lock.current(), null);
});

// ---- Chưa cuộn hết màn thì chưa được kết luận "không có" (màn Health dài: khối Blood Sugar nằm dưới) ----
const LONG_BASE = (extra) => `<XCUIElementTypeApplication type="XCUIElementTypeApplication" name="App" x="0" y="0" width="375" height="812">
  <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Health" label="Health" x="10" y="50" width="200" height="30" visible="true"/>
  <XCUIElementTypeButton type="XCUIElementTypeButton" name="Log Now" label="Log Now" x="10" y="100" width="100" height="40" visible="true"/>
  ${extra}
</XCUIElementTypeApplication>`;
// 0..2 lần vuốt: mỗi lần thấy thêm một khối khác; từ lần vuốt thứ 3 thấy "Blood Sugar" và hết màn (vuốt nữa không đổi)
const longPage = (n) => LONG_BASE(`<XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="${['Bio Age', 'Heart Health', 'Blood Pressure', 'Blood Sugar'][Math.min(n, 3)]}" label="x" x="10" y="${300 + Math.min(n, 3)}" width="200" height="30" visible="true"/>`);
const claimMissing = step({ action: 'done', flowStatus: 'unreachable', summary: 'Màn Health không có khối Blood Sugar' });
const swipeUp = step({ action: 'swipe', text: 'up' });
const swipeDown = step({ action: 'swipe', text: 'down' });
const NOTICE = /CHƯA kiểm hết cả màn/;

test('cuộn: AI kết luận "không có" ngay khi chưa vuốt → bị từ chối, nhắc cuộn; sau khi kiểm cả đáy (vuốt lên) lẫn đầu màn (vuốt xuống) mới được chấp nhận', async () => {
  const h = setup({ xml: longPage, claude: (o, n) => (n === 1 ? claimMissing : n <= 5 ? swipeUp : n === 6 ? swipeDown : claimMissing) });
  const rec = await h.smoke.start(args);
  await finished(h.store, rec.id);
  assert.equal(h.prompts.length, 7);
  assert.match(h.prompts[1].prompt, NOTICE);
  assert.doesNotMatch(h.prompts[0].prompt, NOTICE);
  assert.equal(h.swipeCount(), 5);
  assert.equal(h.store.get('smoke', rec.id).flows[0].status, 'unreachable');
  assert.match(h.store.get('smoke', rec.id).log.join('\n'), /Chưa kiểm hết màn/);
});

test('cuộn: màn ngắn (vuốt lên và xuống đều không làm màn đổi) thì chấp nhận kết luận ngay sau đó', async () => {
  const h = setup({ xml: LONG_BASE(''), claude: (o, n) => (n === 1 ? swipeUp : n === 2 ? swipeDown : claimMissing) });
  const rec = await h.smoke.start(args);
  await finished(h.store, rec.id);
  assert.equal(h.prompts.length, 3);
  assert.equal(h.store.get('smoke', rec.id).flows[0].status, 'unreachable');
});

test('cuộn: AI cứ khăng khăng không vuốt → tối đa 2 lần từ chối rồi chấp nhận (không lặp vô hạn)', async () => {
  const h = setup({ xml: longPage, claude: claimMissing });
  const rec = await h.smoke.start(args);
  await finished(h.store, rec.id);
  assert.equal(h.prompts.length, 3);
  assert.equal(h.store.get('smoke', rec.id).flows[0].status, 'unreachable');
});

test('cuộn: điểm lệch kiểu "thiếu / không có" bị bỏ khi chưa cuộn hết màn, được ghi khi đã cuộn', async () => {
  const miss = { kind: 'prd', summary: 'Màn Health không có khối Blood Sugar' };
  const h = setup({ xml: longPage, claude: (o, n) => (n === 1 ? step({ action: 'wait', finding: miss }) : n <= 5 ? swipeUp : n === 6 ? swipeDown : step({ action: 'done', flowStatus: 'deviation', summary: 'Thiếu khối', finding: miss })) });
  const rec = await h.smoke.start(args);
  await finished(h.store, rec.id);
  const r = h.store.get('smoke', rec.id);
  assert.equal(r.findings.length, 1); // lần đầu bị bỏ, lần sau (đã vuốt 3 lần) được ghi
  assert.match(h.prompts[1].prompt, NOTICE);
});

test('cuộn: điểm lệch không phải kiểu "thiếu" (vd sai chữ) không bị chặn; sau khi chuyển màn (bấm) thì đếm lại từ đầu', async () => {
  const wrongText = { kind: 'prd', summary: 'Nút Save ghi "Luu" thay vì "Lưu"' };
  const a = setup({ xml: longPage, claude: (o, n) => (n === 1 ? step({ action: 'wait', finding: wrongText }) : step({ action: 'done', flowStatus: 'deviation', summary: 'x' })) });
  const r1 = await a.smoke.start(args);
  await finished(a.store, r1.id);
  assert.equal(a.store.get('smoke', r1.id).findings.length, 1);
  assert.equal(a.prompts.length, 2);

  // vuốt đủ 3 lần rồi bấm sang màn khác: kết luận "không có" ở màn mới lại phải cuộn
  const b = setup({ xml: longPage, claude: (o, n) => (n <= 3 ? swipeUp : n === 4 ? step({ action: 'tap', locator: '~Log Now' }) : n === 5 ? claimMissing : step({ action: 'done', flowStatus: 'unverifiable', summary: 'xong' })) });
  const r2 = await b.smoke.start(args);
  await finished(b.store, r2.id);
  assert.match(b.prompts[5].prompt, NOTICE); // lần gọi thứ 6 nhận lời nhắc vì kết luận ở bước 5 bị từ chối
});

test('cuộn: luồng chuẩn bị và kiểm bền vững không áp dụng chặn này', async () => {
  const h = setup({ xml: longPage, prepare: claimMissing, claude: claimMissing });
  const rec = await h.smoke.start(args);
  await finished(h.store, rec.id);
  assert.equal(h.prepCalls.length, 1); // chuẩn bị chỉ gọi 1 lần, không bị nhắc cuộn
  assert.equal(h.store.get('smoke', rec.id).status, 'error');
});

// ---- Điểm tốt của skill: giữ trạng thái app đã onboard (noReset), không mở lại app mỗi luồng ----
const seedState = (over = {}) => ({ id: 'a|U', appId: 'a', udid: 'U', build: '', preparedAt: '2026-11-06T00:00:00.000Z', ...over });
const terminated = (h) => h.execs.filter((e) => e[1] === 'mobile: terminateApp').length;

test('lần đầu: cài sạch, chuẩn bị xong thì ghi lại "đã onboard" (theo app + thiết bị + bản build)', async () => {
  const h = setup({ claude: doneOk });
  const rec = await h.smoke.start(args);
  await finished(h.store, rec.id);
  assert.deepEqual(h.sessions, ['open']);
  const st = h.store.get('smokeState', 'a|U');
  assert.equal(st.appId, 'a');
  assert.equal(st.udid, 'U');
  assert.equal(st.build, '');
  assert.ok(st.preparedAt);
});

test('đã onboard cùng bản build → dùng lại app (attach, KHÔNG cài lại), mở lại app một lần cho về màn gốc rồi chuẩn bị ngắn', async () => {
  const h = setup({ claude: doneOk, state: seedState() });
  const rec = await h.smoke.start(args);
  await finished(h.store, rec.id);
  assert.deepEqual(h.sessions, ['attach']);
  assert.equal(terminated(h), 1); // mở lại app để về màn gốc
  assert.ok(h.prepCalls.length >= 1);
  assert.equal(h.store.get('smoke', rec.id).status, 'done');
  assert.match(h.store.get('smoke', rec.id).log.join('\n'), /dùng lại app/i);
});

test('clean: true (hoặc bản build đổi) → cài sạch dù đã có trạng thái; chuẩn bị xong ghi trạng thái mới', async () => {
  const a = setup({ claude: doneOk, state: seedState() });
  const r1 = await a.smoke.start({ ...args, clean: true });
  await finished(a.store, r1.id);
  assert.deepEqual(a.sessions, ['open']);

  const b = setup({ claude: doneOk, state: seedState(), appExtra: { buildAt: '2026-11-06T09:00:00.000Z' } });
  const r2 = await b.smoke.start(args);
  await finished(b.store, r2.id);
  assert.deepEqual(b.sessions, ['open']);
  assert.equal(b.store.get('smokeState', 'a|U').build, '2026-11-06T09:00:00.000Z');
});

test('dùng lại app mà chuẩn bị không tới được màn chính → tự cài sạch và chuẩn bị lại MỘT lần (không bắt người dùng làm tay)', async () => {
  const h = setup({ claude: doneOk, state: seedState(), prepare: (o, n) => (n === 1 ? step({ action: 'done', flowStatus: 'unreachable', summary: 'Kẹt ở màn lạ' }) : prepOk) });
  const rec = await h.smoke.start(args);
  await finished(h.store, rec.id);
  assert.deepEqual(h.sessions, ['attach', 'open']);
  assert.equal(h.store.get('smoke', rec.id).status, 'done');
  assert.notEqual(h.store.get('smokeState', 'a|U').preparedAt, '2026-11-06T00:00:00.000Z'); // trạng thái được làm mới
});

test('cài sạch mà chuẩn bị thất bại → lần chạy error và XÓA trạng thái "đã onboard" (không dùng lại bản hỏng)', async () => {
  const h = setup({ state: seedState(), prepare: step({ action: 'done', flowStatus: 'unreachable', summary: 'Paywall chặn' }) });
  const rec = await h.smoke.start({ ...args, clean: true });
  await finished(h.store, rec.id);
  assert.equal(h.store.get('smoke', rec.id).status, 'error');
  assert.equal(h.store.get('smokeState', 'a|U'), undefined);
});

test('KHÔNG mở lại app ở đầu các luồng (mở lại làm paywall hiện lại, tốn bước): chạy 2 luồng không có terminateApp', async () => {
  const h = setup({ flows: [flow('f1'), flow('f2')], claude: (o, n) => (n % 2 === 1 ? step({ action: 'tap', locator: '~Log Now' }) : doneOk) });
  const rec = await h.smoke.start(args);
  await finished(h.store, rec.id);
  assert.equal(h.store.get('smoke', rec.id).flows.length, 2);
  assert.equal(terminated(h), 0);
});

// ---- Kiểm chứng màn bằng code trước khi so với Figma (AI nhận nhầm frame → không so, thay vì tạo điểm lệch rác) ----
test('so Figma: màn hiện tại KHÔNG khớp frame mà AI nêu (ít trùng chữ) → không gọi bộ so, ghi log "không khớp"', async () => {
  const { smoke, store, calls } = setupCompare({
    claude: (o, n) => (n === 1 ? step({ action: 'wait', atFrame: 'Blood Sugar - Log' }) : step({ action: 'done', flowStatus: 'unverifiable', summary: 'xong' })), // màn mặc định chỉ có "Blood Sugar" + "Log Now"
    analyze: { status: 'failed', findings: [finding()], error: null },
  });
  const rec = await smoke.start({ appId: 'a', udid: 'U', figmaFile: writeExport() });
  await finished(store, rec.id);
  assert.equal(calls.length, 0);
  assert.equal(store.get('smoke', rec.id).findings.length, 0);
  assert.match(store.get('smoke', rec.id).log.join('\n'), /không khớp/);
});

// ---- Cuộn tới phần tử bằng code (không để AI tự vuốt từng lần) ----
test('scrollTo: tool tự vuốt tới khi thấy phần tử có chữ đó rồi dừng; lần hỏi sau thấy phần tử mới', async () => {
  const h = setup({ xml: longPage, claude: (o, n) => (n === 1 ? step({ action: 'scrollTo', text: 'Blood Sugar' }) : doneOk) });
  const rec = await h.smoke.start(args);
  await finished(h.store, rec.id);
  assert.equal(h.swipeCount(), 3);
  assert.doesNotMatch(h.prompts[0].prompt, /StaticText "Blood Sugar"/); // dòng phần tử (ví dụ trong phần mô tả hành động không tính)
  assert.match(h.prompts[1].prompt, /StaticText "Blood Sugar"/);
  assert.equal(h.store.get('smoke', rec.id).flows[0].status, 'ok'); // scrollTo là thao tác thật
});

test('scrollTo: cuộn hết màn mà không thấy → báo cho AI, kết luận "không có" được chấp nhận ngay (đã hết màn)', async () => {
  const h = setup({ xml: longPage, claude: (o, n) => (n === 1 ? step({ action: 'scrollTo', text: 'Không có thật' }) : n === 2 ? swipeDown : step({ action: 'done', flowStatus: 'unreachable', summary: 'Màn không có "Không có thật"' })) });
  const rec = await h.smoke.start(args);
  await finished(h.store, rec.id);
  assert.equal(h.prompts.length, 3);
  assert.match(h.prompts[1].prompt, /KHÔNG thấy "Không có thật"/);
  assert.equal(h.store.get('smoke', rec.id).flows[0].status, 'unreachable');
  assert.match(h.store.get('smoke', rec.id).log.join('\n'), /hết màn/);
});

// ---- Ẩn bàn phím sau khi nhập (skill: hideKeyboard trước khi bấm tiếp, bàn phím che phần tử) ----
test('type: sau khi nhập chữ tool ẩn bàn phím', async () => {
  const FORM = `<XCUIElementTypeApplication type="XCUIElementTypeApplication" name="App" x="0" y="0" width="375" height="812">
  <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Sign in" label="Sign in" x="10" y="50" width="200" height="30" visible="true"/>
  <XCUIElementTypeTextField type="XCUIElementTypeTextField" name="Email" label="Email" x="10" y="100" width="300" height="40" visible="true"/>
</XCUIElementTypeApplication>`;
  const h = setup({ xml: FORM, claude: (o, n) => (n === 1 ? step({ action: 'type', locator: '~Email', text: 'qa@x.com' }) : doneOk) });
  const rec = await h.smoke.start(args);
  await finished(h.store, rec.id);
  assert.equal(h.keyboardHides(), 1);
});

test('hành động openLink: mở deep link bằng mobile: deepLink, tính là đã thao tác; hồ sơ app có deepLinks thì báo cho AI trong prompt', async () => {
  const h = setup({ appExtra: { deepLinks: ['moss://bloodsugar'] }, claude: (o, n) => (n === 1 ? step({ action: 'openLink', text: 'moss://bloodsugar' }) : flowDone()) });
  const rec = await h.smoke.start({ ...args, robust: false });
  await finished(h.store, rec.id);
  const dl = h.execs.filter((e) => e[1] === 'mobile: deepLink');
  assert.deepEqual(dl[0][2], { url: 'moss://bloodsugar', bundleId: 'com.x.sw' });
  assert.match(h.prompts[0].prompt, /moss:\/\/bloodsugar/);
  assert.equal(h.store.get('smoke', rec.id).flows[0].status, 'ok');
});

test('hành động push: gọi pushImpl với udid + bundleId + nội dung; lỗi (máy thật) ghi log, không phải lỗi app', async () => {
  const pushes = [];
  const h = setup({ pushImpl: async (o) => { pushes.push(o); }, claude: (o, n) => (n === 1 ? step({ action: 'push', text: 'Chương mới|Đọc ngay' }) : flowDone()) });
  const rec = await h.smoke.start({ ...args, robust: false });
  await finished(h.store, rec.id);
  assert.equal(pushes[0].udid, 'U');
  assert.equal(pushes[0].title, 'Chương mới');
  assert.equal(pushes[0].body, 'Đọc ngay');
  const bad = setup({ pushImpl: async () => { throw new Error('Chỉ hỗ trợ Simulator'); }, claude: (o, n) => (n === 1 ? step({ action: 'push', text: 'x' }) : flowDone()) });
  const r2 = await bad.smoke.start({ ...args, robust: false });
  await finished(bad.store, r2.id);
  assert.match(bad.store.get('smoke', r2.id).log.join('\n'), /Chỉ hỗ trợ Simulator/);
});

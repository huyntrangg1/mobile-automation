// Tìm phần tử lúc chạy theo mô tả (cách SimUtil): locator không thấy → khớp chữ / hỏi AI → bấm → lưu như Fix script
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createSteps, pickByText, readOverrides, screenElements } from '../server/apps/template/src/runner/steps.js';
import { resolvePrompt, resolveTarget } from '../server/ai/resolve.js';
import { tmpDir } from './helpers.js';
import { loose } from '../server/apps/template/src/utils/ui.js';

const WELCOME = fs.readFileSync(new URL('./fixtures/welcome.xml', import.meta.url), 'utf8');
const EMAIL = '-ios predicate string:type == "XCUIElementTypeButton" AND name == "Continue with email"';

test('screenElements: phần tử đang hiển thị có tên / nhãn kèm locator; pickByText khớp chữ rõ, mô tả mơ hồ → null', () => {
  const els = screenElements(WELCOME);
  assert.ok(els.some((e) => e.locator === EMAIL));
  assert.equal(pickByText('Nút "Continue with email"', els), EMAIL);
  assert.equal(pickByText('Continue with email (giữa màn)', els), EMAIL);
  assert.equal(pickByText('Nút đóng trình duyệt có coach mark', els), null);
});

test('resolveTarget: AI chỉ được chọn locator có trong danh sách; chọn bừa ngoài danh sách / rỗng → null', async () => {
  const elements = screenElements(WELCOME);
  const ok = await resolveTarget({ target: 'Nút mail', screen: 'Welcome', elements }, { runClaude: async () => ({ ok: true, data: { locator: EMAIL, reason: 'nút email' } }) });
  assert.equal(ok.locator, EMAIL);
  assert.equal(await resolveTarget({ target: 'x', screen: 'W', elements }, { runClaude: async () => ({ ok: true, data: { locator: '~Không có', reason: '' } }) }), null);
  assert.equal(await resolveTarget({ target: 'x', screen: 'W', elements }, { runClaude: async () => ({ ok: true, data: { locator: '', reason: 'không thấy' } }) }), null);
  assert.match(resolvePrompt({ target: 'Ảnh tutorial', screen: 'Tutorial', elements }), /KHÔNG đoán bừa/);
});

function device(present) {
  const taps = [];
  globalThis.driver = { isAndroid: false, getPageSource: async () => WELCOME, execute: async () => [] };
  globalThis.browser = { saveScreenshot: async () => {}, getPageSource: async () => WELCOME };
  // runner gửi locator theo chữ ở dạng khớp lỏng (ui.loose) → quy về locator gốc trong present
  const orig = (sel) => [...present].find((p) => p === sel || loose(p) === sel) || sel;
  globalThis.$ = (sel) => ({ waitForExist: async () => { if (!present.has(orig(sel))) throw new Error(`element ("${orig(sel)}") still not existing after 10ms`); }, click: async () => taps.push(orig(sel)) });
  return taps;
}

test('k.tap: locator không thấy → khớp chữ trên màn → bấm, lưu override; lần sau bấm thẳng locator đã lưu', async () => {
  const taps = device(new Set([EMAIL]));
  const cwd = tmpDir();
  const live = path.join(tmpDir(), 'live.jsonl');
  const k = createSteps({ sa: { eq() {} }, logStep() {}, snapshot: async () => ({}), env: { LIVE_STEPS: live }, cwd });
  await k.tap(1, 'Welcome', 'Nút "Continue with email"', '~sai-locator');
  assert.deepEqual(taps, [EMAIL]);
  assert.equal(readOverrides(cwd)['Welcome|Nút "Continue with email"'], EMAIL);
  assert.match(JSON.parse(fs.readFileSync(live, 'utf8')).text, /^Tự tìm "Nút "Continue with email"" trên màn Welcome \(khớp chữ\) → .*đã lưu cho lần sau$/);
  await k.tap(1, 'Welcome', 'Nút "Continue with email"', '~sai-locator');
  assert.deepEqual(taps, [EMAIL, EMAIL]);
});

test('k.tap: không bật AI hỗ trợ → không hỏi AI chọn phần tử (chỉ khớp chữ)', async () => {
  device(new Set([EMAIL]));
  let called = 0;
  globalThis.fetch = async () => { called++; return { ok: true, json: async () => ({ locator: EMAIL }) }; };
  const k = createSteps({ sa: { eq() {} }, logStep() {}, snapshot: async () => ({}), env: { QAPD_API: 'http://x/api', APP_ID: 'tastory' }, cwd: tmpDir() });
  await assert.rejects(k.tap(1, 'Welcome', 'Nút gửi mail để đăng nhập', '~sai'), /Không thấy/);
  assert.equal(called, 0);
  delete globalThis.fetch;
});

test('k.tap (bật AI hỗ trợ): mô tả mơ hồ → hỏi AI qua server; AI không chọn → lỗi như cũ (Blocked)', async () => {
  device(new Set([EMAIL]));
  const calls = [];
  globalThis.fetch = async (url, o) => { calls.push([url, JSON.parse(o.body)]); return { ok: true, json: async () => (url.endsWith('/resolve') ? { locator: calls.length === 1 ? EMAIL : null } : { action: 'giveUp', reason: 'không có' }) }; };
  const env = { QAPD_API: 'http://x/api', APP_ID: 'tastory', AI_ASSIST: '1', EARLY_STUCK: '0' };
  const k = createSteps({ sa: { eq() {} }, logStep() {}, snapshot: async () => ({}), env, cwd: tmpDir() });
  await k.tap(1, 'Welcome', 'Nút gửi mail để đăng nhập', '~sai');
  assert.equal(calls[0][0], 'http://x/api/apps/tastory/resolve');
  assert.equal(calls[0][1].target, 'Nút gửi mail để đăng nhập');
  await assert.rejects(k.tap(2, 'Welcome', 'Nút không tồn tại', '~sai2'), /Không thấy "Nút không tồn tại" trên màn Welcome/);
  delete globalThis.fetch;
});

test('đã có locator lưu cho bước → tự tìm lần sau chỉ dùng cho lần chạy đó, không ghi đè', async () => {
  device(new Set([EMAIL]));
  const cwd = tmpDir();
  fs.mkdirSync(path.join(cwd, 'locators'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'locators/overrides.json'), JSON.stringify({ 'Welcome|Nút "Continue with email"': { locator: '~cũ-đã-lưu' } }));
  const k = createSteps({ sa: { eq() {} }, logStep() {}, snapshot: async () => ({}), env: {}, cwd });
  await k.tap(1, 'Welcome', 'Nút "Continue with email"', '~sai');
  assert.equal(readOverrides(cwd)['Welcome|Nút "Continue with email"'], '~cũ-đã-lưu');
});

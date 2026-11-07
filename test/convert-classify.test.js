import test from 'node:test';
import assert from 'node:assert/strict';
import { prefilter, classifyCases } from '../server/testcases/convert/classify.js';

const c = (id, extra = {}) => ({ id, selected: true, platform: 'All', scenario: `Kịch bản ${id}`, description: '', pre: 'Đã cài app', steps: '1. Bấm "Continue"', expected: 'Hiển thị "Next"', ...extra });
const fakeAi = (decide) => {
  const calls = [];
  const fn = async (req) => { calls.push(req); return decide ? { ok: true, data: { decisions: decide(req) } } : { ok: false, error: 'lỗi' }; };
  fn.calls = calls;
  return fn;
};

test('prefilter: đăng nhập Google / Apple, IAP, tắt mạng iOS, Settings hệ thống, chưa chốt → có lý do; case thường → null', () => {
  assert.match(prefilter(c('A', { steps: 'Bấm Continue with Google' })).reason, /bên thứ 3|OAuth/i);
  assert.match(prefilter(c('B', { steps: 'Đăng nhập bằng Apple' })).reason, /OAuth|bên thứ 3/i);
  assert.match(prefilter(c('C', { steps: 'Mua gói Premium qua App Store' })).reason, /mua|IAP/i);
  assert.match(prefilter(c('D', { platform: 'iOS', steps: 'Tắt mạng rồi bấm Retry' })).reason, /mạng/i);
  assert.match(prefilter(c('E', { expected: 'Quyền được bật trong Settings của iPhone' })).reason, /Settings|ngoài app/i);
  assert.match(prefilter(c('F', { description: 'Copy chưa chốt (Q&A #12)' })).reason, /chưa chốt/i);
  assert.equal(prefilter(c('G')), null);
});

test('chỉ nhắc "Q&A #3" thì chưa phải chặn → không bị lọc; Android tắt mạng không bị lọc', () => {
  assert.equal(prefilter(c('H', { scenario: 'Verify màn Welcome (Q&A #3)' })), null);
  assert.equal(prefilter(c('I', { platform: 'Android', steps: 'Tắt mạng' })), null);
});

test('classifyCases: luật code xử lý hết → 0 lần gọi AI; case không selected bị bỏ', async () => {
  const ai = fakeAi(() => []);
  const r = await classifyCases({ cases: [c('A', { steps: 'Continue with Google' }), c('B'), c('C', { selected: false })], runClaude: ai });
  assert.deepEqual(r.map((d) => [d.id, d.mode, d.by]), [['A', 'manual', 'rule'], ['B', 'automate', 'rule']]);
  assert.equal(ai.calls.length, 0);
});

test('classifyCases: 3 case mơ hồ → đúng 1 lần gọi AI, kết quả theo AI', async () => {
  const ai = fakeAi((req) => [{ id: 'M1', mode: 'manual', reason: 'Popup hệ thống' }, { id: 'M2', mode: 'automate', reason: 'Đọc được' }, { id: 'M3', mode: 'automate', reason: 'ok' }]);
  const cases = ['M1', 'M2', 'M3'].map((id) => c(id, { steps: 'Chờ popup quảng cáo hiện ra' }));
  const r = await classifyCases({ cases, runClaude: ai });
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].noTools, true);
  assert.deepEqual(r.map((d) => [d.id, d.mode, d.by]), [['M1', 'manual', 'ai'], ['M2', 'automate', 'ai'], ['M3', 'automate', 'ai']]);
  assert.equal(r[0].reason, 'Popup hệ thống');
});

test('classifyCases: AI thiếu một id hoặc lỗi → case đó giữ automate kèm lý do', async () => {
  const cases = ['M1', 'M2'].map((id) => c(id, { steps: 'Hiện popup' }));
  const missing = await classifyCases({ cases, runClaude: fakeAi(() => [{ id: 'M1', mode: 'manual', reason: 'x' }]) });
  assert.deepEqual(missing.map((d) => [d.id, d.mode]), [['M1', 'manual'], ['M2', 'automate']]);
  assert.match(missing[1].reason, /AI không trả lời/);
  const failed = await classifyCases({ cases, runClaude: fakeAi(null) });
  assert.deepEqual(failed.map((d) => d.mode), ['automate', 'automate']);
});

test('classifyCases dùng model nhẹ (QAPD_CONVERT_LIGHT_MODEL, mặc định claude-sonnet-5-5)', async () => {
  const ai = fakeAi(() => [{ id: 'M1', mode: 'automate', reason: 'ok' }]);
  await classifyCases({ cases: [c('M1', { steps: 'Hiện popup' })], runClaude: ai });
  assert.equal(ai.calls[0].model, 'claude-sonnet-5-5');
  process.env.QAPD_CONVERT_LIGHT_MODEL = 'model-thu';
  try {
    await classifyCases({ cases: [c('M2', { steps: 'Hiện popup' })], runClaude: ai });
    assert.equal(ai.calls[1].model, 'model-thu');
  } finally { delete process.env.QAPD_CONVERT_LIGHT_MODEL; }
});

test('classify: chữ "mạng" đứng riêng (vd "mạng xã hội", "kết nối mạng" ở Pre-condition) không làm case thành mơ hồ; "mất mạng" thì có', async () => {
  const base = { selected: true, platform: 'All', scenario: 's', description: '', pre: 'Có kết nối mạng', steps: 'Chọn Mạng xã hội', expected: 'Hiện "OK"' };
  let calls = 0;
  const runClaude = async () => { calls++; return { ok: true, data: { decisions: [{ id: 'B', mode: 'automate', reason: 'x' }] } }; };
  const out = await classifyCases({ cases: [{ ...base, id: 'A' }, { ...base, id: 'B', steps: 'Mất mạng rồi bấm Retry' }], runClaude });
  assert.equal(calls, 1);
  assert.equal(out.find((d) => d.id === 'A').by, 'rule');
  assert.equal(out.find((d) => d.id === 'B').by, 'ai');
});

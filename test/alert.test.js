// k.alert: chọn nút theo ý định (allow / deny) trên alert hệ thống — chữ nút khác nhau theo iOS / ngôn ngữ (ATT, thông báo…)
import test from 'node:test';
import assert from 'node:assert/strict';

const { createSteps } = await import('../server/apps/template/src/runner/steps.js');

// Alert giả: getButtons trả buttons; accept ghi lại nút được bấm
function setup(buttons) {
  const accepted = [];
  globalThis.driver = {
    isAndroid: false,
    waitUntil: async (fn, { timeout = 50 } = {}) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timeout'); },
    execute: async (cmd, o) => { if (o.action === 'getButtons') return buttons; accepted.push(o.buttonLabel); return null; },
  };
  const steps = [];
  const k = createSteps({ sa: { eq() {} }, logStep: (e) => steps.push(e), snapshot: async () => ({ k: null }), env: {} });
  return { k, accepted, steps };
}

test('ATT: deny → "Ask App Not to Track"; allow → "Allow"', async () => {
  let s = setup(['Ask App Not to Track', 'Allow']);
  await s.k.alert(3, 'Tracking', 'deny', { timeout: 30 });
  assert.deepEqual(s.accepted, ['Ask App Not to Track']);
  assert.equal(s.steps.at(-1).target, 'Ask App Not to Track');
  s = setup(['Ask App Not to Track', 'Allow']);
  await s.k.alert(3, 'Tracking', 'allow', { timeout: 30 });
  assert.deepEqual(s.accepted, ['Allow']);
});

test('thông báo: deny khớp "Don’t Allow" (nháy cong của iOS); tiếng Việt: allow → "Cho phép", deny → "Yêu cầu ứng dụng không theo dõi"', async () => {
  let s = setup(['Don’t Allow', 'Allow']);
  await s.k.alert(8, 'Notification', 'deny', { timeout: 30 });
  assert.deepEqual(s.accepted, ['Don’t Allow']);
  s = setup(['Yêu cầu ứng dụng không theo dõi', 'Cho phép']);
  await s.k.alert(3, 'Tracking', 'allow', { timeout: 30 });
  assert.deepEqual(s.accepted, ['Cho phép']);
  s = setup(['Yêu cầu ứng dụng không theo dõi', 'Cho phép']);
  await s.k.alert(3, 'Tracking', 'deny', { timeout: 30 });
  assert.deepEqual(s.accepted, ['Yêu cầu ứng dụng không theo dõi']);
});

test('vẫn nhận chữ nút cụ thể như cũ ("Allow"), không phân biệt hoa thường', async () => {
  const s = setup(['Don’t Allow', 'Allow']);
  await s.k.alert(8, 'Notification', 'allow', { timeout: 30 });
  const t = setup(['Don’t Allow', 'Allow']);
  await t.k.alert(8, 'Notification', 'ALLOW', { timeout: 30 });
  assert.deepEqual([s.accepted, t.accepted], [['Allow'], ['Allow']]);
});

test('có alert nhưng không nút nào khớp → lỗi nêu các nút đang hiện', async () => {
  const s = setup(['Allow Once', 'Allow While Using App', 'Don’t Allow']);
  await assert.rejects(s.k.alert(5, 'Location', 'Cancel', { timeout: 30 }), /^Error: Hộp thoại hệ thống không có nút "Cancel" — đang hiện: "Allow Once", "Allow While Using App", "Don’t Allow"$/);
});

test('không có alert nào → câu lỗi như cũ (report đọc "Không tới được màn …")', async () => {
  const s = setup([]);
  await assert.rejects(s.k.alert(3, 'Tracking', 'deny', { timeout: 30 }), /^Error: Không tới được màn Tracking: không thấy hộp thoại hệ thống "Từ chối" sau 0.03s$/);
});

test('ý định không khớp nút nào → câu lỗi dùng chữ tiếng Việt của ý định', async () => {
  const s = setup(['Allow Once', 'OK']);
  await assert.rejects(s.k.alert(5, 'Location', 'deny', { timeout: 30 }), /^Error: Hộp thoại hệ thống không có nút "Từ chối" — đang hiện: "Allow Once", "OK"$/);
});

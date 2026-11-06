import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAlert } from '../server/smoke/alerts.js';

const ios = (buttons) => {
  const calls = [];
  return { calls, execute: async (cmd, a) => { calls.push(a); return a.action === 'getButtons' ? buttons : undefined; } };
};
const accepted = (d) => d.calls.filter((c) => c.action === 'accept').map((c) => c.buttonLabel);

test('iOS: hộp xin theo dõi quảng cáo → từ chối ("Ask App Not to Track")', async () => {
  const d = ios(['Ask App Not to Track', 'Allow']);
  assert.equal(await handleAlert(d, 'iOS'), 'Ask App Not to Track');
  assert.deepEqual(accepted(d), ['Ask App Not to Track']);
});

test('iOS: hộp xin quyền (thông báo, vị trí…) → cho phép, không từ chối', async () => {
  const d = ios(['Don’t Allow', 'Allow']);
  assert.equal(await handleAlert(d, 'iOS'), 'Allow');
  assert.deepEqual(accepted(d), ['Allow']);
});

test('iOS: có nhiều mức cho phép → ưu tiên "Allow While Using App" hơn "Allow Once"', async () => {
  const d = ios(['Don’t Allow', 'Allow Once', 'Allow While Using App']);
  assert.equal(await handleAlert(d, 'iOS'), 'Allow While Using App');
});

test('iOS: không có hộp thoại → null, không bấm gì', async () => {
  const d = ios([]);
  assert.equal(await handleAlert(d, 'iOS'), null);
  assert.deepEqual(accepted(d), []);
});

test('iOS: nút lạ (không nhận ra) → bấm nút đầu tiên để app không bị chặn', async () => {
  const d = ios(['Maybe', 'Later']);
  assert.equal(await handleAlert(d, 'iOS'), 'Maybe');
});

test('iOS: lỗi khi hỏi hộp thoại → null (không ném)', async () => {
  assert.equal(await handleAlert({ execute: async () => { throw new Error('no alert'); } }, 'iOS'), null);
});

test('Android: hộp xin quyền → bấm nút cho phép, không bấm từ chối', async () => {
  const xml = `<hierarchy><android.widget.FrameLayout package="com.google.android.permissioncontroller">
<android.widget.Button class="android.widget.Button" text="Don't allow" resource-id="com.android.permissioncontroller:id/permission_deny_button"/>
<android.widget.Button class="android.widget.Button" text="Allow" resource-id="com.android.permissioncontroller:id/permission_allow_button"/></android.widget.FrameLayout></hierarchy>`;
  const clicked = [];
  const d = { getPageSource: async () => xml, $: async (sel) => ({ click: async () => clicked.push(sel) }) };
  assert.equal(await handleAlert(d, 'Android'), 'Allow');
  assert.equal(clicked.length, 1);
  assert.match(clicked[0], /Allow/);
  assert.ok(!/deny/i.test(clicked[0]));
});

test('Android: không phải hộp xin quyền → null', async () => {
  const d = { getPageSource: async () => '<hierarchy><android.widget.FrameLayout package="com.x.app"/></hierarchy>', $: async () => { throw new Error('không được gọi'); } };
  assert.equal(await handleAlert(d, 'Android'), null);
});

test('chặn mua: hộp xác nhận mua (Cancel / Buy) → Cancel, KHÔNG bao giờ bấm Buy', async () => {
  for (const buttons of [['Cancel', 'Buy'], ['Confirm', 'Cancel'], ['Subscribe', 'Not Now'], ['Buy Now', 'Close']]) {
    const d = ios(buttons);
    const pick = await handleAlert(d, 'iOS');
    assert.ok(['Cancel', 'Not Now', 'Close'].includes(pick), `${buttons} → ${pick}`);
    assert.ok(!/buy|confirm|subscribe/i.test(accepted(d)[0]));
  }
});

test('chặn mua: chỉ có nút mua → không bấm gì (null)', async () => {
  const d = ios(['Buy']);
  assert.equal(await handleAlert(d, 'iOS'), null);
  assert.deepEqual(accepted(d), []);
});

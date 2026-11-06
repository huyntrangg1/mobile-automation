import test from 'node:test';
import assert from 'node:assert/strict';
import { isBuyTarget, elementAtPoint } from '../server/smoke/guard.js';

const el = (name, rect = { x: 0, y: 0, width: 100, height: 50 }, type = 'Button') => ({ type, name, label: name, rect });

test('isBuyTarget: luôn chặn nút mua / đăng ký / dùng thử, ở mọi màn', () => {
  for (const n of ['Subscribe', 'Buy now', 'Start free trial', 'Try it free', 'Get Premium', 'Upgrade', 'Purchase', 'Đăng ký ngay', 'Dùng thử miễn phí']) assert.equal(isBuyTarget(el(n), false), true, n);
});

test('isBuyTarget: "Continue" chỉ bị chặn khi đang ở màn paywall (onboarding cần Continue)', () => {
  assert.equal(isBuyTarget(el('Continue'), false), false);
  assert.equal(isBuyTarget(el('Continue'), true), true);
  assert.equal(isBuyTarget(el('Confirm'), true), true);
  assert.equal(isBuyTarget(el('Next'), false), false);
});

test('elementAtPoint: lấy phần tử chứa điểm % (đổi sang point theo cỡ cửa sổ); phần tử nhỏ nhất thắng', () => {
  const big = el('Card', { x: 0, y: 0, width: 375, height: 812 }, 'Other');
  const btn = el('Start free trial', { x: 10, y: 300, width: 300, height: 50 });
  assert.equal(elementAtPoint([big, btn], { width: 375, height: 812 }, 50, 40)?.name, 'Start free trial');
  assert.equal(elementAtPoint([big, btn], { width: 375, height: 812 }, 50, 10)?.name, 'Card');
  assert.equal(elementAtPoint([btn], { width: 375, height: 812 }, 50, 10), null);
  assert.equal(elementAtPoint([btn], null, 50, 40), null);
});

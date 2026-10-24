import test from 'node:test';
import assert from 'node:assert/strict';
import { closure } from '../server/testcases/closure.js';

// Chuỗi giống file auth: SPL_001 (cài lại) → WEL_001 → WEL_003 → LOGIN_001 → LOGIN_002; CRE_004 cài lại riêng
const mk = (tcId, order, fresh, prev, status = 'generated') => ({ id: `a:f:${tcId}`, appId: 'a', file: 'f', tcId, order, fresh, prev, script: { status } });
const CASES = [
  mk('TC_SPL_001', 0, true, null), mk('TC_WEL_001', 1, false, 'TC_SPL_001'), mk('TC_WEL_003', 2, false, 'TC_WEL_001'),
  mk('TC_LOGIN_001', 3, false, 'TC_WEL_003'), mk('TC_LOGIN_002', 4, false, 'TC_LOGIN_001'), mk('TC_CRE_004', 5, true, null),
];

test('chọn LOGIN_002 → thêm 4 case phía trước, đúng thứ tự file', () => {
  const r = closure(CASES, ['a:f:TC_LOGIN_002']);
  assert.deepEqual(r.run.map((id) => id.split(':')[2]), ['TC_SPL_001', 'TC_WEL_001', 'TC_WEL_003', 'TC_LOGIN_001', 'TC_LOGIN_002']);
  assert.equal(r.added.length, 4);
  assert.deepEqual(r.missing, []);
});

test('case cài lại app chạy một mình', () => {
  const r = closure(CASES, ['a:f:TC_CRE_004']);
  assert.deepEqual(r.run, ['a:f:TC_CRE_004']);
  assert.deepEqual(r.added, []);
});

test('case phía trước chưa gen → missing kèm lý do', () => {
  const cases = CASES.map((c) => (c.tcId === 'TC_WEL_001' ? { ...c, script: { status: 'none' } } : c));
  const r = closure(cases, ['a:f:TC_LOGIN_001']);
  assert.deepEqual(r.missing, [{ id: 'a:f:TC_WEL_001', tcId: 'TC_WEL_001', reason: 'Chưa có script' }]);
});

test('case được chọn gen lỗi / stale cũng vào missing', () => {
  const cases = CASES.map((c) => (c.tcId === 'TC_CRE_004' ? { ...c, script: { status: 'stale' } } : c));
  assert.equal(closure(cases, ['a:f:TC_CRE_004']).missing[0].reason, 'Bước đã đổi, cần gen lại');
});

test('prev trỏ tới case không có trong file → missing', () => {
  const cases = [mk('TC_X', 0, false, 'TC_KHONG_CO')];
  assert.match(closure(cases, ['a:f:TC_X']).missing[0].reason, /TC_KHONG_CO/);
});

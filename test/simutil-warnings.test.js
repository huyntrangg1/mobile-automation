import test from 'node:test';
import assert from 'node:assert/strict';
import { exportToSimutil } from '../server/scripts/simutil.js';
import { tmpDir } from './helpers.js';

test('export SimUtil: keyword không hỗ trợ (Close popup, Verify layout) và dòng Nav Verify screen → cảnh báo ngay lúc export', () => {
  const rows = [
    { step: 1, screen: 'Home', kind: 'Action', keyword: 'Close popup', target: 'X', value: '' },
    { step: 2, screen: 'Home', kind: 'Nav', keyword: 'Verify screen', target: 'Title', value: '' },
    { step: 3, screen: 'Home', kind: 'Check', keyword: 'Verify layout', target: 'Title', value: 'width <= 200' },
    { step: 4, screen: 'Home', kind: 'Action', keyword: 'Tap', target: 'OK', value: '' },
  ];
  const r = exportToSimutil({ id: 'a', name: 'App' }, 'f', [{ tcId: 'TC_1', order: 0, rows }, { tcId: 'TC_2', order: 1, rows: [rows[3]] }], { home: tmpDir() });
  assert.deepEqual(r.unsupported, { TC_1: ['Close popup', 'Verify layout'] });
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings[0], /^TC_1: SimUtil không có keyword "Close popup", "Verify layout"/);
  assert.match(r.warnings[1], /^TC_1: "Nav Verify screen" chạy như điểm kiểm thường/);
});

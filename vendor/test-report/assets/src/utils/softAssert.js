// Gom mọi điểm lệch của 1 test, báo cùng lúc kèm số step trong test case.
// Lỗi điều hướng (không sang được màn sau) vẫn dừng ngay vì page object chờ phần tử và ném lỗi.
// evidence (từ utils/evidence.js) → điểm lệch thành 1 bug trong bug-report.html, ảnh khoanh đỏ đúng phần tử.
import assert from 'node:assert/strict';
import { addBug, logStep } from '../report/collector.js';

export function softAssert() {
  const bad = [];
  let total = 0;
  return {
    // info: { keyword, target, value, screen } của điểm kiểm → report viết câu bug tự nhiên (vd "Nút "X" vẫn enable")
    eq(step, label, actual, expected, evidence = null, info = {}) {
      total++;
      logStep({ ...info, kind: 'Check', step, label, ok: actual === expected, actual, expected });
      if (actual !== expected) {
        bad.push(`  - Step ${step} ${label}: app = ${JSON.stringify(actual)}, mong đợi = ${JSON.stringify(expected)}`);
        addBug({ ...info, step, label, actual, expected, evidence });
      }
    },
    assertAll() {
      assert.ok(bad.length === 0, `Lệch ${bad.length}/${total} điểm kiểm:\n${bad.join('\n')}`);
    },
  };
}

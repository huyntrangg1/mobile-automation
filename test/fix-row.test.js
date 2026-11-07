import test from 'node:test';
import assert from 'node:assert/strict';
import { fixRow, fixFlowRow, fixFlowRows } from '../server/testcases/convert/writeXlsx.js';

test('fixRow: kind "verify" + keyword "Nav" → Nav / Verify screen', () => {
  assert.deepEqual(fixRow({ step: 1, screen: 'Welcome', kind: 'verify', keyword: 'Nav' }), { step: 1, screen: 'Welcome', kind: 'Nav', keyword: 'Verify screen', target: 'Welcome' });
});
test('fixRow: chuẩn hoá chữ hoa/thường của kind, dòng đúng giữ nguyên', () => {
  assert.equal(fixRow({ kind: 'action', keyword: 'Tap' }).kind, 'Action');
  assert.deepEqual(fixRow({ kind: 'Check', keyword: 'Verify displayed' }), { kind: 'Check', keyword: 'Verify displayed' });
});

import { convertSheet } from '../server/testcases/convert/writeXlsx.js';
import { tmpDir } from './helpers.js';

test('convertSheet: luồng chung sai không sửa được → báo lỗi ngay, không gọi AI viết nhóm', async () => {
  const cases = [{ id: 'TC_W_001', module: 'W', type: 'Positive', platform: 'All', scenario: 's', description: '', pre: '', steps: 'b', expected: 'e', priority: 'High', selected: true }];
  let skeletons = 0; let rows = 0;
  const bad = { 'A → B': [{ step: 1, screen: 'A', kind: 'Action', keyword: 'Không có keyword này' }] };
  const runClaude = async (req) => {
    if (req.schema.properties.order) { skeletons++; return { ok: true, data: { order: [{ id: 'TC_W_001', fresh: true }], groups: [['TC_W_001']], flows: bad } }; }
    rows++; return { ok: true, data: { testcases: [] } };
  };
  const r = await convertSheet({ sheet: { sheet: 'W', cases }, decisions: [{ id: 'TC_W_001', mode: 'automate' }], runClaude, outDir: tmpDir() });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /Khung: Luồng "A → B"/);
  assert.equal(skeletons, 3); // lần đầu + 2 lần lập lại khung kèm feedback
  assert.equal(rows, 0);
});

test('fixRow: Kind "Verify" suy ra từ keyword; Nav thiếu Target lấy tên màn', () => {
  assert.deepEqual(fixRow({ step: 1, screen: 'Welcome', kind: 'Verify', keyword: 'Verify screen' }), { step: 1, screen: 'Welcome', kind: 'Nav', keyword: 'Verify screen', target: 'Welcome' });
  assert.equal(fixRow({ kind: 'Verify', keyword: 'Verify text', target: 't' }).kind, 'Check');
  assert.equal(fixRow({ kind: 'Verify', keyword: 'Tap', target: 't' }).kind, 'Action');
});

test('fixRow: keyword gần đúng của AI ("Verify element visible"…) → keyword chuẩn của Check', () => {
  const k = (keyword) => fixRow({ kind: 'Check', keyword, label: 'x' }).keyword;
  assert.equal(k('Verify element visible'), 'Verify displayed');
  assert.equal(k('Verify visible'), 'Verify displayed');
  assert.equal(k('Verify element displayed'), 'Verify displayed');
  assert.equal(k('Verify element not visible'), 'Verify not displayed');
  assert.equal(k('Verify text'), 'Verify text');
});
test('fixFlowRow: dòng Check của luồng chung thiếu label → lấy từ target (rồi tới screen); đã có label thì giữ', () => {
  assert.equal(fixFlowRow({ kind: 'Check', keyword: 'Verify displayed', target: 'Nút Continue', screen: 'Goals' }).label, 'Nút Continue');
  assert.equal(fixFlowRow({ kind: 'Check', keyword: 'Verify displayed', screen: 'Goals' }).label, 'Goals');
  assert.equal(fixFlowRow({ kind: 'Check', keyword: 'Verify displayed', target: 'T', label: 'Đã có' }).label, 'Đã có');
  assert.equal(fixFlowRow({ kind: 'Action', keyword: 'Tap', target: 'T' }).label, undefined);
});

test('fixFlowRow: Handle permission thiếu Value → Allow', () => {
  assert.equal(fixFlowRow({ kind: 'Action', keyword: 'Handle permission', screen: 'N' }).value, 'Allow');
  assert.equal(fixFlowRow({ kind: 'Action', keyword: 'Handle permission', value: "Don't allow" }).value, "Don't allow");
});
test('fixFlowRows: sau Verify screen chưa có check dương của màn → thêm Verify displayed theo tên màn, đánh lại số step; đã có thì giữ nguyên', () => {
  const rows = [
    { step: 1, screen: 'A', kind: 'Action', keyword: 'Tap', target: 'Go' },
    { step: 2, screen: 'B', kind: 'Nav', keyword: 'Verify screen', target: 'B' },
    { step: 3, screen: 'B', kind: 'Action', keyword: 'Tap', target: 'Next' },
    { step: 4, screen: 'C', kind: 'Nav', keyword: 'Verify screen', target: 'C' },
    { step: 5, screen: 'C', kind: 'Check', keyword: 'Verify text', target: 'Title', label: 'T', value: 'C', compare: 'equals' },
    { step: 6, screen: 'D', kind: 'Nav', keyword: 'Verify screen', target: 'D' },
    { step: 7, screen: 'D', kind: 'Check', keyword: 'Verify not displayed', target: 'X', label: 'X' },
  ];
  const out = fixFlowRows(rows);
  assert.deepEqual(out.map((r) => [r.step, r.kind, r.keyword, r.screen]), [
    [1, 'Action', 'Tap', 'A'], [2, 'Nav', 'Verify screen', 'B'], [3, 'Check', 'Verify displayed', 'B'], [4, 'Action', 'Tap', 'B'],
    [5, 'Nav', 'Verify screen', 'C'], [6, 'Check', 'Verify text', 'C'],
    [7, 'Nav', 'Verify screen', 'D'], [8, 'Check', 'Verify displayed', 'D'], [9, 'Check', 'Verify not displayed', 'D']]);
  assert.equal(out[2].target, 'B');
  assert.ok(out[2].label);
  assert.equal(fixFlowRows('không phải mảng'), 'không phải mảng');
});

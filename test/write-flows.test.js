import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writePlan } from '../server/testcases/convert/writeXlsx.js';

// TC gọi luồng chưa khai báo: write.mjs báo lỗi rõ cho đúng TC (không crash lúc ghi sheet Flows → converter mới viết lại được đúng TC đó)
test('writePlan: Run flow tới luồng chưa khai báo → lỗi rõ theo TC, không crash', async () => {
  const plan = { manual: [], flows: { 'A → B': [{ step: 0, screen: 'A', kind: 'Action', keyword: 'Tap', target: 'Go' }] }, testcases: [
    { id: 'TC_1', fresh: true, rows: [{ step: 0, screen: '', kind: 'Action', keyword: 'Run flow', value: 'A → B' }, { step: 1, screen: 'B', kind: 'Check', keyword: 'Verify displayed', target: 'X', label: 'x' }] },
    { id: 'TC_2', fresh: true, rows: [{ step: 0, screen: '', kind: 'Action', keyword: 'Run flow', value: 'Không có' }, { step: 1, screen: 'B', kind: 'Check', keyword: 'Verify displayed', target: 'X', label: 'x' }] }] };
  const sheet = { sheet: 'S', cases: [{ id: 'TC_1', selected: true, description: 'a' }, { id: 'TC_2', selected: true, description: 'b' }] };
  const r = await writePlan({ plan, sheet, outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wf-')) });
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems, ['TC_2 step 0: luồng "Không có" chưa khai báo trong plan.flows']);
});

// Luồng khai báo mà không TC nào dùng (vd case dùng nó chuyển manual) → chỉ cần review, không chặn ghi cả sheet
test('writePlan: luồng không TC nào dùng → ghi file được, đưa vào review (không phải lỗi)', async () => {
  const plan = { manual: [], flows: { 'A → B': [{ step: 0, screen: 'A', kind: 'Action', keyword: 'Tap', target: 'Go' }] }, testcases: [
    { id: 'TC_1', fresh: true, rows: [{ step: 1, screen: 'B', kind: 'Check', keyword: 'Verify displayed', target: 'X', label: 'x' }] }] };
  const sheet = { sheet: 'S', cases: [{ id: 'TC_1', selected: true, description: 'a' }] };
  const r = await writePlan({ plan, sheet, outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wf-')) });
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.ok(r.review.some((l) => /khai báo nhưng không TC nào dùng/.test(l)));
});

// Không cắt danh sách lỗi ở 40: vòng sửa cần đủ lỗi của mọi case
test('writePlan: hơn 40 lỗi → trả đủ, không cắt', async () => {
  const testcases = Array.from({ length: 45 }, (_, i) => ({ id: `TC_${i + 1}`, fresh: true, rows: [{ step: 1, screen: 'B', kind: 'Check', keyword: 'Verify displayed', target: 'X' }] }));
  const sheet = { sheet: 'S', cases: testcases.map((t) => ({ id: t.id, selected: true, description: 'a' })) };
  const r = await writePlan({ plan: { manual: [], flows: {}, testcases }, sheet, outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wf-')) });
  assert.equal(r.ok, false);
  assert.ok(r.problems.length >= 45, String(r.problems.length));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpDir } from './helpers.js';
import { makeManual } from './fixtures/manualWorkbook.js';
import { detectKind, extractManual } from '../server/testcases/convert/detect.js';

const AUTOMATION = path.join(path.dirname(fileURLToPath(import.meta.url)), '../samples/apidemos-automation.xlsx');
const cases = [
  { id: 'TC_A_001', priority: 'High', type: 'Positive' },
  { id: 'TC_A_002', priority: 'Low', type: 'Positive' },
  { id: 'TC_A_003', priority: 'Low', type: 'Negative' },
];

test('extractManual: mặc định chọn TẤT CẢ case; { all: false } dùng quy tắc của skill (High + Medium + Low Positive); sheet RTM bị bỏ qua', async () => {
  const f = await makeManual(tmpDir(), { sheets: [{ name: 'Welcome', cases }, { name: 'RTM Welcome', cases: [{ id: 'TC_X_001' }] }] });
  assert.equal(await detectKind(f), 'manual');
  const all = await extractManual(f);
  assert.deepEqual(all.sheets.map((s) => s.sheet), ['Welcome']);
  assert.deepEqual(all.sheets[0].cases.map((c) => [c.id, c.selected]), [['TC_A_001', true], ['TC_A_002', true], ['TC_A_003', true]]);
  assert.deepEqual([all.sheets[0].total, all.sheets[0].selected], [3, 3]);
  const rule = await extractManual(f, { all: false });
  assert.deepEqual(rule.sheets[0].cases.map((c) => c.selected), [true, true, false]);
  assert.equal(rule.sheets[0].selected, 2);
});

test('file không có cột "Test Case #" → unknown, extractManual báo lỗi nêu cột cần có', async () => {
  const f = await makeManual(tmpDir(), { sheets: [{ name: 'Sheet1', cases }], noHeader: true });
  assert.equal(await detectKind(f), 'unknown');
  await assert.rejects(() => extractManual(f), (e) => e.status === 400 && /Test Case #/.test(e.message));
});

test('file automation (sheet TestCases có cột Keyword) → automation', async () => {
  assert.equal(await detectKind(AUTOMATION), 'automation');
});

test('cùng TC ID ở hai sheet → cả hai đều có trong kết quả, phân biệt bằng sheet', async () => {
  const f = await makeManual(tmpDir(), { sheets: [{ name: 'Sex', cases: [{ id: 'TC_DUP_001' }] }, { name: 'Age', cases: [{ id: 'TC_DUP_001' }] }] });
  const r = await extractManual(f);
  assert.deepEqual(r.sheets.map((s) => `${s.sheet}:${s.cases[0].id}`), ['Sex:TC_DUP_001', 'Age:TC_DUP_001']);
});

test('file hỏng (không phải xlsx) → detectKind unknown, không ném', async () => {
  const fs = await import('node:fs');
  const f = path.join(tmpDir(), 'x.xlsx');
  fs.writeFileSync(f, 'không phải excel');
  assert.equal(await detectKind(f), 'unknown');
});

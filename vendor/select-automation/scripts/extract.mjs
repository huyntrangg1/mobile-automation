// Đọc file test case đầy đủ (kit v2) → JSON các case theo từng sheet chức năng, đánh dấu case được chọn để automation.
//   node scripts/extract.mjs <file.xlsx> [--out cases.json]
// Quy tắc chọn: High + Medium lấy hết; Low chỉ lấy Test Type = Positive. Sheet RTM / sheet không có cột "Test Case #" bị bỏ qua.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const file = args[0];
if (!file || !fs.existsSync(file)) { console.error('Cần đường dẫn file xlsx'); process.exit(1); }
const ExcelJS = createRequire(import.meta.url)('exceljs'); // exceljs cài trong thư mục skill (npm install)

const text = (v) => (v == null ? '' : v.richText ? v.richText.map((t) => t.text).join('') : v.text ? v.text : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim();
// Tên cột trong kit v2 → khoá JSON
const COLS = {
  'Test Case #': 'id', 'Module/Group test': 'module', 'Test Type': 'type', Platform: 'platform', 'Test Scenario': 'scenario',
  'Test Cases Description': 'description', 'Pre-condition': 'pre', Steps: 'steps', 'Expected Result': 'expected', Priority: 'priority',
};
const selected = (c) => c.priority === 'High' || c.priority === 'Medium' || (c.priority === 'Low' && c.type === 'Positive');

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const sheets = [];
for (const ws of wb.worksheets) {
  let headRow = 0;
  ws.eachRow((row, i) => { if (!headRow && row.values.slice(1).map(text).includes('Test Case #')) headRow = i; });
  if (!headRow || /^RTM/i.test(ws.name)) continue;
  const head = ws.getRow(headRow).values.slice(1).map(text);
  const cases = [];
  ws.eachRow((row, i) => {
    if (i <= headRow) return;
    const c = {};
    head.forEach((h, j) => { if (COLS[h]) c[COLS[h]] = text(row.getCell(j + 1).value); });
    if (!/^TC_/i.test(c.id || '')) return;
    cases.push({ ...c, selected: selected(c) });
  });
  sheets.push({ sheet: ws.name, total: cases.length, selected: cases.filter((c) => c.selected).length, cases });
}
const out = { source: path.resolve(file), sheets };
const dest = opt('--out');
if (dest) fs.writeFileSync(dest, JSON.stringify(out, null, 2));
for (const s of sheets) console.error(`${s.sheet}: ${s.total} TC, chọn ${s.selected} (High + Medium + Low Positive)`);
if (!dest) process.stdout.write(JSON.stringify(out, null, 2));

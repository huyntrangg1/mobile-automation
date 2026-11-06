// Tạo file test case manual (kit v2) mini để test: header ở dòng 3 (như file thật ở dòng 9), dòng 1–2 là phần mở đầu.
import path from 'node:path';
import ExcelJS from 'exceljs';

const HEAD = ['Test Case #', 'Module/Group test', 'Test Type', 'Platform', 'Test Scenario', 'Test Cases Description', 'Pre-condition', 'Steps', 'Expected Result', 'Priority'];

// sheets: [{ name, cases: [{ id, priority, type, scenario, description, pre, steps, expected, module, platform }] }]
export async function makeManual(dir, { sheets, file = 'manual.xlsx', noHeader = false } = {}) {
  const wb = new ExcelJS.Workbook();
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name);
    ws.addRow(['Dự án thử']);
    ws.addRow([]);
    ws.addRow(noHeader ? ['ID', 'Tên'] : HEAD);
    for (const c of sh.cases || []) {
      ws.addRow([c.id, c.module || 'Nhóm', c.type || 'Positive', c.platform || 'All', c.scenario || `Kịch bản ${c.id}`, c.description || '',
        c.pre ?? 'Đã cài app', c.steps ?? '1. Mở app', c.expected ?? 'Hiển thị tiêu đề "Welcome"', c.priority || 'High']);
    }
  }
  const out = path.join(dir, file);
  await wb.xlsx.writeFile(out);
  return out;
}

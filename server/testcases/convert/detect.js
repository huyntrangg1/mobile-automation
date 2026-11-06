// Nhận diện kiểu file test case (manual kit v2 / automation v2) và trích xuất case manual bằng extract.mjs của skill (vendor).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ExcelJS from 'exceljs';
import { SELECT_AUTOMATION_VENDOR } from '../../paths.js';

const text = (v) => (v == null ? '' : v.richText ? v.richText.map((t) => t.text).join('') : v.text ? v.text : String(v)).trim();
const bad = (message) => Object.assign(new Error(message), { status: 400 });

// manual: có sheet (không phải RTM) với một dòng chứa ô "Test Case #" · automation: sheet TestCases có cột Keyword · còn lại unknown
export async function detectKind(filePath) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.readFile(filePath); } catch { return 'unknown'; }
  const auto = wb.getWorksheet('TestCases');
  if (auto) {
    let head = [];
    auto.eachRow((row, i) => { if (i === 1) head = row.values.slice(1).map(text); });
    if (head.includes('Keyword')) return 'automation';
  }
  for (const ws of wb.worksheets) {
    if (/^RTM/i.test(ws.name)) continue;
    let found = false;
    ws.eachRow((row) => { if (!found && row.values.slice(1).map(text).includes('Test Case #')) found = true; });
    if (found) return 'manual';
  }
  return 'unknown';
}

// → { source, sheets: [{ sheet, total, selected, cases: [{ id, module, type, platform, scenario, description, pre, steps, expected, priority, selected }] }] }
// Mặc định chọn TẤT CẢ case (người dùng quyết định, kể cả Low Edge / Negative); all: false = quy tắc của skill (High + Medium + Low Positive)
export async function extractManual(filePath, { all = true } = {}) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qapd-ext-')), 'cases.json');
  try {
    await promisify(execFile)(process.execPath, [path.join(SELECT_AUTOMATION_VENDOR, 'scripts/extract.mjs'), filePath, '--out', out], { maxBuffer: 10 * 1024 * 1024 });
  } catch (e) {
    throw bad(`Không đọc được file manual: ${String(e.stderr || e.message).split('\n')[0]}`);
  }
  const data = JSON.parse(fs.readFileSync(out, 'utf8'));
  if (!data.sheets.length || !data.sheets.some((s) => s.cases.length)) {
    throw bad('File không có case manual nào: cần sheet có cột "Test Case #" và dòng TC ID bắt đầu bằng TC_ (kit v2).');
  }
  if (all) for (const sh of data.sheets) { for (const c of sh.cases) c.selected = true; sh.selected = sh.cases.length; }
  return data;
}

// Tên các sheet của file (để báo lỗi chỉ ra đã thấy sheet nào); file không đọc được → []
export async function sheetNames(filePath) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.readFile(filePath); } catch { return []; }
  return wb.worksheets.map((w) => w.name);
}

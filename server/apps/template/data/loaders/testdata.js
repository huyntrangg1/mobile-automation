// Đọc test case format action-based + step-based (sheet TestCases + TestData) từ file XLSX.
// Quy ước ${...} theo assets/templates/automation-actions.md — data không hard-code trong code test.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { birthdayForAge } from '../../src/utils/plan.js';

// File test case dùng cho automation nằm trong data/testcases/
const TESTCASES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../testcases');
export const testcaseFile = (name) => path.join(TESTCASES_DIR, name);

const GENERATORS = {
  birthdayForAge: (age) => birthdayForAge(Number(age)),
};

// "${env.X}" → biến môi trường, "${gen.fn(arg)}" → giá trị sinh lúc chạy, còn lại giữ nguyên
export function resolve(value) {
  if (typeof value !== 'string') return value;
  const m = value.match(/^\$\{(env|gen)\.([A-Za-z_]\w*)(?:\(([^)]*)\))?\}$/);
  if (!m) return value;
  const [, kind, key, arg] = m;
  if (kind === 'env') {
    if (process.env[key] === undefined) throw new Error(`Thiếu biến môi trường ${key}`);
    return process.env[key];
  }
  if (!GENERATORS[key]) throw new Error(`Chưa có generator gen.${key}`);
  return GENERATORS[key](arg);
}

const cellValue = (c) => {
  const v = c.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'result' in v) return v.result; // ô công thức
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((t) => t.text).join('');
  return v;
};

function readSheet(wb, name) {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`File test case không có sheet "${name}"`);
  const head = ws.getRow(1).values.slice(1).map(String);
  const rows = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const obj = {};
    head.forEach((h, j) => { obj[h] = cellValue(row.getCell(j + 1)); });
    if (Object.values(obj).some((v) => v !== '')) rows.push(obj);
  });
  return rows;
}

// Trả về { cases: { [TC ID]: {...dòng TestCases} }, dataSet(name) → các dòng TestData đã resolve }
export async function loadTestcases(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const cases = Object.fromEntries(readSheet(wb, 'TestCases').map((c) => [c['TC ID'], c]));
  const data = readSheet(wb, 'TestData');
  const dataSet = (name) => {
    const rows = data.filter((r) => r['Data Set'] === name)
      .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, resolve(v)])));
    if (!rows.length) throw new Error(`Sheet TestData không có Data Set "${name}"`);
    return rows;
  };
  return { cases, dataSet };
}

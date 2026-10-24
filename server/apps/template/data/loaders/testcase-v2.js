// Đọc test case automation format v2 (mỗi thao tác / điểm kiểm = 1 dòng; dòng Kind = Case mở đầu 1 TC).
// Pre-condition dòng 1 = "Cài lại app" hoặc "Tiếp nối <TC trước>"; thứ tự TC trong sheet = thứ tự chạy.
import ExcelJS from 'exceljs';
import { birthdayForAge } from '../../src/utils/plan.js';

const text = (v) => (v == null ? '' : v.richText ? v.richText.map((t) => t.text).join('') : v.text ? v.text : String(v)).trim();

// Mã lần chạy: email sinh ra giống nhau trong cùng 1 lần chạy (TC sau dùng lại tài khoản TC trước tạo)
const RUN_ID = process.env.RUN_ID || Date.now().toString(36).slice(-6);
const withRun = (email) => {
  const [local, domain] = String(email).split('@');
  return `${local}.${RUN_ID}@${domain}`;
};
const GENERATORS = {
  // ${gen.email(yolina.c01@ikameglobal.com)} → yolina.c01.<lần chạy>@ikameglobal.com (chưa đăng ký)
  email: (arg) => withRun(arg),
  // ${gen.emailName(...)} → phần trước @ của email đã sinh (app dùng làm tên chào)
  emailName: (arg) => withRun(arg).split('@')[0],
  birthdayForAge: (age) => birthdayForAge(Number(age)),
};

// Thay ${cột TestData}, ${env.X}, ${gen.fn(arg)} trong chuỗi. Thiếu biến môi trường → lỗi rõ tên biến.
export function fill(value, row = {}) {
  if (typeof value !== 'string' || !value.includes('${')) return value;
  const whole = value.match(/^\$\{([^}]+)\}$/);
  const one = (expr) => {
    const m = expr.match(/^(env|gen)\.([A-Za-z_]\w*)(?:\(([^)]*)\))?$/);
    if (!m) {
      if (!(expr in row)) throw new Error(`Thiếu cột TestData "${expr}"`);
      return row[expr];
    }
    const [, kind, key, arg] = m;
    if (kind === 'env') {
      if (!process.env[key]) throw new Error(`Thiếu biến môi trường ${key} (khai báo trong .env)`);
      return process.env[key];
    }
    if (!GENERATORS[key]) throw new Error(`Chưa có generator gen.${key}`);
    return GENERATORS[key](arg);
  };
  // Cả ô là 1 biến → giữ kiểu gốc (vd Date từ birthdayForAge)
  if (whole) return one(whole[1]);
  return value.replace(/\$\{([^}]+)\}/g, (_, expr) => String(one(expr)));
}

// → { testcases: [{ id, title, priority, pre: [], fresh, prev, dataSet, rows: [...] }], testdata: [{...}] }
export async function loadV2(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('TestCases');
  if (!ws) throw new Error(`File test case không có sheet "TestCases"`);
  const head = ws.getRow(1).values.slice(1).map(text);
  const col = (name) => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`Sheet TestCases thiếu cột "${name}"`);
    return i + 1;
  };
  const C = Object.fromEntries(['TC ID', 'Title', 'Priority', 'Pre-condition', 'Data Set', 'Step', 'Screen', 'Kind', 'Keyword', 'Target', 'Value', 'Compare', 'Platform', 'Check label']
    .map((n) => [n, col(n)]));
  const testcases = [];
  ws.eachRow((r, i) => {
    if (i === 1) return;
    const get = (n) => text(r.getCell(C[n]).value);
    if (get('Kind') === 'Case') {
      const pre = get('Pre-condition').split('\n').map((l) => l.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);
      const first = pre[0] || '';
      testcases.push({
        id: get('TC ID'), title: get('Title'), priority: get('Priority'), dataSet: get('Data Set'), pre,
        fresh: /^Cài lại app/i.test(first), prev: (first.match(/^Tiếp nối\s+(\S+)/i) || [])[1] || null, rows: [],
      });
      return;
    }
    if (!get('Keyword')) return;
    testcases.at(-1)?.rows.push({
      step: Number(get('Step')) || 0, screen: get('Screen'), kind: get('Kind'), keyword: get('Keyword'), target: get('Target'),
      value: get('Value'), compare: get('Compare'), platform: get('Platform') || 'All', label: get('Check label'),
    });
  });

  const testdata = [];
  const td = wb.getWorksheet('TestData');
  if (td) {
    const th = td.getRow(1).values.slice(1).map(text);
    td.eachRow((r, i) => {
      if (i === 1) return;
      const o = Object.fromEntries(th.map((h, j) => [h, text(r.getCell(j + 1).value)]));
      if (o['Data Set']) testdata.push(o);
    });
  }
  return { testcases, testdata };
}

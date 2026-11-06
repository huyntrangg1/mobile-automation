// So sánh theo cột Compare (bộ keyword v2) và biến {{tên}} trong cùng TC. Không dùng driver → test được độc lập.
import crypto from 'node:crypto';

const norm = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
// Số đầu tiên trong chữ: "80,5 kg" → 80.5, "1,498" → 1498, "-3" → -3
export function numberIn(v) {
  const m = norm(v).match(/-?\d{1,3}(?:[.,]\d{3})+(?![\d])|-?\d+(?:[.,]\d+)?/);
  if (!m) return NaN;
  const s = m[0];
  return /^-?\d{1,3}([.,]\d{3})+$/.test(s) ? Number(s.replace(/[.,]/g, '')) : Number(s.replace(',', '.'));
}
// "5 m" / "5m" / "5,0 M" → { n: 5, unit: 'm' }
const withUnit = (v) => ({ n: numberIn(v), unit: norm(v).replace(/-?[\d.,]+/, '').replace(/\s+/g, '').toLowerCase() });

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
// Đọc ngày theo định dạng DD / D / MM / M / MMM / MMMM / YYYY / YY (vd "DD/MM/YYYY", "MMM D, YYYY") → "YYYY-MM-DD" hoặc null
export function parseDate(v, format) {
  const order = [];
  const re = format.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D/g, (t) => {
    order.push(t);
    return { YYYY: '(\\d{4})', YY: '(\\d{2})', MMMM: '([A-Za-z]+)', MMM: '([A-Za-z]{3,})', MM: '(\\d{1,2})', M: '(\\d{1,2})', DD: '(\\d{1,2})', D: '(\\d{1,2})' }[t];
  });
  const m = norm(v).match(new RegExp(`^${re}$`, 'i'));
  if (!m) return null;
  let y; let mo; let d;
  order.forEach((t, i) => {
    const x = m[i + 1];
    if (t === 'YYYY') y = Number(x);
    else if (t === 'YY') y = 2000 + Number(x);
    else if (t.startsWith('MMM')) mo = MONTHS.findIndex((n) => n.startsWith(x.toLowerCase().slice(0, 3))) + 1;
    else if (t.startsWith('M')) mo = Number(x);
    else d = Number(x);
  });
  if (!y || !mo || !d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Chữ mô tả điều mong đợi trong report: equals → chính giá trị, còn lại → "<compare> <giá trị>"
export const expectLabel = (expected, compare) => {
  const c = norm(compare).toLowerCase();
  if (!c || c === 'equals') return norm(expected);
  if (c === 'empty' || c === 'not empty') return c;
  return `${c} "${norm(expected)}"`;
};

// actual (đọc từ app) so với expected (Value) theo compare. Compare lạ → lỗi (không pass âm thầm)
export function compareValues(actual, expected, compare = '') {
  const c = norm(compare).toLowerCase();
  const a = norm(actual);
  const e = norm(expected);
  const num = () => [numberIn(a), numberIn(e)];
  if (!c || c === 'equals') return actual != null && a === e;
  if (c === 'not equals') return a !== e;
  if (c === 'contains') return actual != null && a.includes(e);
  if (c === 'not contains') return !a.includes(e);
  if (c === 'regex') return actual != null && new RegExp(String(expected)).test(a);
  if (c === 'empty') return a === '';
  if (c === 'not empty') return a !== '';
  if (c === 'number') { const [x, y] = num(); return !Number.isNaN(x) && x === y; }
  if (c === 'greater than') { const [x, y] = num(); return x > y; }
  if (c === 'greater or equal') { const [x, y] = num(); return x >= y; }
  if (c === 'less than') { const [x, y] = num(); return x < y; }
  if (c === 'less or equal') { const [x, y] = num(); return x <= y; }
  if (c === 'unit') { const x = withUnit(a); const y = withUnit(e); return !Number.isNaN(x.n) && x.n === y.n && x.unit === y.unit; }
  if (c.startsWith('date:')) { const f = String(compare).trim().slice(5); const x = parseDate(a, f); return !!x && x === parseDate(e, f); }
  throw new Error(`Compare "${compare}" không hỗ trợ — dùng: equals, not equals, contains, not contains, regex, greater than, greater or equal, less than, less or equal, empty, not empty, number, unit, date:<định dạng>, all-on`);
}

// {{tên}} trong Value → giá trị biến của TC (Save value / Set variable / Generate data). Thiếu biến → lỗi rõ tên
export function fillVars(value, vars) {
  if (typeof value !== 'string' || !value.includes('{{')) return value;
  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, name) => {
    if (!(name in vars)) throw new Error(`Chưa có biến {{${name}}} — tạo bằng Save value / Set variable / Generate data ở dòng trước`);
    return String(vars[name]);
  });
}

// Generate data: email / phone / text / number / uuid
export function generateValue(kind) {
  const r = crypto.randomBytes(4).toString('hex');
  switch (String(kind).trim().toLowerCase()) {
    case 'email': return `qa.${r}@example.com`;
    case 'phone': return `09${String(crypto.randomInt(0, 1e8)).padStart(8, '0')}`;
    case 'text': return `Auto ${r}`;
    case 'number': return String(crypto.randomInt(1, 10000));
    case 'uuid': return crypto.randomUUID();
    default: throw new Error(`Generate data "${kind}" không hỗ trợ — dùng: email, phone, text, number, uuid`);
  }
}

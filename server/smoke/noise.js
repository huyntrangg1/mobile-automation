// Lọc điểm lệch so với Figma bằng code (analyzeCapture) để chỉ giữ những lỗi đáng tin.
// Thực tế (lần chạy Blood Sugar): phần lớn điểm lệch là rác — số liệu / ngày / đơn vị trong Figma chỉ là MINH HỌA, còn lệch vị trí,
// cỡ chữ, xuống dòng đo bằng vị trí nhiễu vì màn app và frame Figma khác cuộn / khác nội dung.
const WEEKDAYS = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|sday|nesday|rsday|urday)?$/i;
const MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(uary|ruary|ch|il|e|y|ust|tember|ober|ember)?$/i;
const UNITS = /^(mg\/dl|mmol\/l|kg|lbs?|bpm|ml|ml\/kg\/min|kcal|cal|mmhg|ms|cm|km|min|mins|hr|hrs)$/i;

// Chữ trông như DỮ LIỆU (số, giờ, ngày, thứ, tháng, đơn vị, chữ quá ngắn / không có chữ cái), không phải nhãn giao diện
export function isDataLike(text) {
  const t = String(text ?? '').trim();
  if (t.length <= 2) return true;
  if (/\d/.test(t)) return true;
  if (!/\p{L}/u.test(t)) return true;
  return WEEKDAYS.test(t) || MONTHS.test(t) || UNITS.test(t);
}

const bigrams = (s) => { const t = String(s).toLowerCase().trim().replace(/\s+/g, ' '); const out = []; for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2)); return out; };
// Hệ số Dice trên cặp ký tự, 0..1
export function similar(a, b) {
  const x = bigrams(a);
  const y = bigrams(b);
  if (!x.length || !y.length) return String(a).toLowerCase().trim() === String(b).toLowerCase().trim() ? 1 : 0;
  const pool = new Map();
  for (const g of y) pool.set(g, (pool.get(g) || 0) + 1);
  let hit = 0;
  for (const g of x) if (pool.get(g) > 0) { hit++; pool.set(g, pool.get(g) - 1); }
  return (2 * hit) / (x.length + y.length);
}

// Loại đo bằng vị trí / hình dạng: quá nhiễu cho smoke test
const DROP = new Set(['position', 'font', 'lines', 'region', 'icon']);
const uniq = (a) => [...new Set(a)];

const STATE_WORD = /\b(range|status|level|normal|elevated|critical|high|low|below|within|above|good|bad|warning|healthy)\b/i;
const HEX = /#[0-9a-f]{6}/gi;
const hexes = (t) => (String(t || '').match(HEX) || []).map((h) => h.toUpperCase());

export function keepFinding(f, opts = {}) {
  if (!f || !f.kind || DROP.has(f.kind)) return false;
  const quoted = uniq([...`${f.actual || ''} ${f.expected || ''}`.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  if (f.kind === 'text') {
    // Khác chữ: chỉ tin khi hai chữ GẦN GIỐNG (sai chính tả / hoa thường) và không phải dữ liệu; khác hẳn nghĩa là app đang so nhầm phần tử
    const [a, b] = quoted;
    return !!a && !!b && !isDataLike(a) && !isDataLike(b) && similar(a, b) >= 0.5;
  }
  const target = f.target != null && String(f.target).trim() ? String(f.target).trim() : null;
  if (f.kind === 'missing') {
    const t = target || quoted[0];
    if (!t || t.length < 3 || isDataLike(t)) return false;
    // Chữ trạng thái của dữ liệu (Elevated / Within / Critical Range, Normal, High…) đổi theo số liệu: không phải thiếu nhãn giao diện
    if (STATE_WORD.test(t)) return false;
    // Màn app chỉ trùng một phần chữ với frame (modal chồng lên màn nền, tab khác…): "thiếu" dễ là do khác màn, chỉ tin khi màn gần như trùng hẳn
    if (typeof opts.overlap === 'number' && opts.overlap < 0.85) return false;
    return true;
  }
  // fill, text-color, size, icon-missing, image-missing…: bỏ khi mục tiêu là dữ liệu (vd ngày "Tue" đổi màu vì đang được chọn)
  if (target && isDataLike(target)) return false;
  // Mục tiêu không có chữ đó trên màn app (frame Figma đang ở trạng thái khác, vd Elevated, còn app ở Within) → so nhầm phần tử
  if (target && Array.isArray(opts.appTexts) && opts.appTexts.length) {
    const t = target.toLowerCase();
    if (!opts.appTexts.some((x) => x === t || x.includes(t) || (x.length >= 3 && t.includes(x)))) return false;
  }
  if (f.kind === 'fill' || f.kind === 'text-color') {
    const a = hexes(f.actual);
    const e = hexes(f.expected);
    // Hai màu giống hệt nhau: không phải lệch
    if (a.length && e.length && a.every((h) => e.includes(h))) return false;
    // Màu lấy mẫu trên app là nền trắng còn Figma là màu đậm: điểm lấy mẫu trượt khỏi phần tử, không đáng tin
    if (f.kind === 'fill' && a.length && a.every((h) => h === '#FFFFFF')) return false;
  }
  return true;
}

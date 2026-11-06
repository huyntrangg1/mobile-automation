// Verify layout: đo vị trí / kích thước phần tử (đơn vị điểm — pt, như toạ độ Appium trả về) và dò ảnh chụp màn hình
// cho phần locator không đọc được (số dòng chữ, khoảng trống tới hình minh hoạ không có tên).
// Value: các luật cách nhau ";" — "<đo> <so sánh> <số>", vd "width <= 260; centerOffset <= 4; spaceBelow >= 36; lines = 2"
import { PNG } from 'pngjs';

export const METRICS = {
  width: 'độ rộng',
  height: 'chiều cao',
  left: 'lề trái',
  right: 'lề phải',
  top: 'cách mép trên',
  bottom: 'cách mép dưới',
  centerOffset: 'lệch tâm ngang',
  lines: 'số dòng chữ',
  spaceAbove: 'khoảng trống phía trên',
  spaceBelow: 'khoảng trống phía dưới',
};
const FROM_IMAGE = new Set(['lines', 'spaceAbove', 'spaceBelow']);
// "=" với số đo theo pt cho lệch 1pt (làm tròn toạ độ); số dòng phải bằng đúng
const OPS = {
  '<=': (a, b) => a <= b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '>': (a, b) => a > b,
  '=': (a, b, metric) => Math.abs(a - b) <= (metric === 'lines' ? 0 : 1),
};
// Màu khác nền quá ngưỡng này (0..255 trên kênh lệch nhiều nhất) = có "mực" (chữ, hình)
const INK = 40;

export function parseRules(value) {
  const rules = String(value ?? '').split(/[;\n]/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.replace(/≤/g, '<=').replace(/≥/g, '>=').match(/^(\w+)\s*(<=|>=|=|<|>)\s*(-?\d+(?:\.\d+)?)$/);
    if (!m || !METRICS[m[1]]) throw new Error(`Verify layout: luật "${s}" sai — dạng "<đo> <so sánh> <số>", đo là ${Object.keys(METRICS).join(', ')}`);
    return { metric: m[1], op: m[2], num: Number(m[3]) };
  });
  if (!rules.length) throw new Error('Verify layout: Value trống — vd "width <= 260; lines = 2"');
  return rules;
}

export const needsImage = (rules) => rules.some((r) => FROM_IMAGE.has(r.metric));
export const formatRules = (rules) => rules.map((r) => `${r.metric} ${r.op} ${r.num}`).join('; ');
export const readPng = (base64) => PNG.sync.read(Buffer.from(base64, 'base64'));

const px = (png, x, y) => {
  const i = (png.width * y + x) << 2;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
};
const differs = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) > INK;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Khung phần tử trên ảnh (px). scale = px / pt (ảnh Retina @2x, @3x)
function box(png, rect, scale) {
  return {
    x0: clamp(Math.round(rect.x * scale), 0, png.width - 1),
    x1: clamp(Math.round((rect.x + rect.width) * scale) - 1, 0, png.width - 1),
    y0: clamp(Math.round(rect.y * scale), 0, png.height - 1),
    y1: clamp(Math.round((rect.y + rect.height) * scale) - 1, 0, png.height - 1),
  };
}
const rowHasInk = (png, y, x0, x1, bg) => {
  for (let x = x0; x <= x1; x++) if (differs(px(png, x, y), bg)) return true;
  return false;
};

// Số dòng chữ: các dải hàng có mực trong khung, cách nhau bởi ≥ 2pt hàng trống
export function countLines(png, rect, scale) {
  const { x0, x1, y0, y1 } = box(png, rect, scale);
  const bg = px(png, x0, y0);
  const minGap = Math.max(2, Math.round(2 * scale));
  let lines = 0;
  let inBand = false;
  let gap = 0;
  for (let y = y0; y <= y1; y++) {
    if (rowHasInk(png, y, x0, x1, bg)) {
      if (!inBand) lines++;
      inBand = true;
      gap = 0;
    } else if (inBand && ++gap >= minGap) {
      inBand = false;
    }
  }
  return lines;
}

// Khoảng trống (pt) từ mép dưới / trên của khung tới hàng có mực đầu tiên trong cột của khung (hình không có tên vẫn đo được).
// Không gặp gì → tới mép màn hình
export function space(png, rect, scale, dir) {
  const { x0, x1, y0, y1 } = box(png, rect, scale);
  const bg = px(png, x0, y0);
  const step = dir === 'below' ? 1 : -1;
  const from = dir === 'below' ? y1 + 1 : y0 - 1;
  let y = from;
  while (y >= 0 && y < png.height && !rowHasInk(png, y, x0, x1, bg)) y += step;
  return Math.abs(y - from) / scale;
}

export function measure(metric, { rect, win, png, scale = 1 }) {
  switch (metric) {
    case 'width': return rect.width;
    case 'height': return rect.height;
    case 'left': return rect.x;
    case 'right': return win.width - (rect.x + rect.width);
    case 'top': return rect.y;
    case 'bottom': return win.height - (rect.y + rect.height);
    case 'centerOffset': return Math.abs(rect.x + rect.width / 2 - win.width / 2);
    case 'lines': return countLines(png, rect, scale);
    case 'spaceAbove': return space(png, rect, scale, 'above');
    case 'spaceBelow': return space(png, rect, scale, 'below');
    default: throw new Error(`Verify layout: không đo được "${metric}"`);
  }
}

// → { ok, results: [{ metric, op, num, got, ok }] }; got làm tròn 1 chữ số
export function evaluate(rules, ctx) {
  const results = rules.map((r) => {
    const got = Math.round(measure(r.metric, ctx) * 10) / 10;
    return { ...r, got, ok: OPS[r.op](got, r.num, r.metric) };
  });
  return { ok: results.every((r) => r.ok), results };
}

// Actual cho report: luật sai ghi số đo thật, vd "width = 336 (cần <= 260)"
export const describeResults = (results) => results.filter((r) => !r.ok)
  .map((r) => `${METRICS[r.metric]} ${r.metric} = ${r.got} (cần ${r.op} ${r.num})`).join('; ');

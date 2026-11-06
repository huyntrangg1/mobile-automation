// Gom thông tin của test đang chạy để hook afterTest ghi ra report: test case (từ xlsx) + các điểm kiểm bị lệch.
// Cùng 1 worker nên spec và hook trong config dùng chung module này.

let current = { case: null, bugs: [], steps: [], flows: [], screen: null };
const planned = [];

export function resetCurrent() {
  current = { case: null, bugs: [], steps: [], flows: [], screen: null };
}

// meta: { id, title, priority, feature, file, dataSet, run, precondition, steps, expected } — steps / expected là mảng dòng đã điền data
export function setCase(meta) {
  current.case = meta;
}

// bug: { step, label, actual, expected, evidence, keyword?, target?, value? } — at: vị trí điểm kiểm trong nhật ký bước
//   seen: màn ngay lúc điểm kiểm lệch (soft assert → test chạy tiếp, màn lúc kết thúc là màn khác) → Actual nói đúng cái đang hiện.
//   Đọc page source không chờ (Appium chạy lệnh theo thứ tự nên vẫn là màn lúc lệch); screenSummary chờ đọc xong (settleSeen).
const pending = [];
export function addBug(bug) {
  const b = { at: current.steps.length - 1, seen: null, ...bug };
  current.bugs.push(b);
  if (!b.seen && typeof globalThis.browser?.getPageSource === 'function') {
    // Gọi ngay (không lùi sang microtask) để lệnh này tới Appium trước lệnh kế tiếp của test
    let p;
    try { p = globalThis.browser.getPageSource(); } catch { p = null; }
    if (p) pending.push(Promise.resolve(p).then((x) => { b.seen = summarizeSource(x); }, () => {}));
  }
}
export async function settleSeen() {
  await Promise.allSettled(pending.splice(0));
}

// Bước chặn luồng mà tester cho chạy tiếp (chế độ sửa tay: Skip / Use element) → 1 bug chặn luồng, case vẫn chạy tiếp
// flow: { step, screen, target, error, seen?, shot? } — at: số bước đã chạy trước lỗi (Steps to Reproduce dừng ở đó)
export function addFlowBug(flow) {
  current.flows.push({ seen: null, shot: null, ...flow, at: current.steps.length });
}

// Màn lúc bước chặn luồng lỗi { seen, shot } — writeResult dùng khi afterTest không đọc được màn (vd WebDriverAgent đã sập)
export function noteScreen(screen) {
  current.screen = screen;
}

// Nhật ký từng bước đã chạy (report mở test case → danh sách bước + kết quả):
// { kind: Action|Nav|Check, step, screen?, keyword?, target?, value?, label?, ok, actual?, expected?, error? }
export function logStep(entry) {
  current.steps.push(entry);
}

export function takeCurrent() {
  return current;
}

// Test case dự kiến chạy (đăng ký lúc khai báo describe / it): cái nào không chạy trong lần này → "Not Run"
// entry: { suite, title, case: { id, title, file, dataSet, run } }
export function planTest(entry) {
  planned.push(entry);
}

export const takePlanned = () => planned;

// "${height_cm}" → giá trị cột tương ứng của dòng TestData; Date → DD/MM/YYYY
export function fillTemplate(text, row, formatDate) {
  return String(text ?? '').replace(/\$\{(\w+)\}/g, (m, k) => {
    if (!(k in row)) return m;
    const v = row[k];
    return v instanceof Date ? formatDate(v) : String(v);
  });
}

// Màn đang hiện (page source iOS / Android) → { title, text, buttons } — Actual của bug "không tới được màn"
//   title: chữ đầu tiên từ trên xuống · text: chữ kế tiếp · buttons: nút có tên (bỏ Back, bỏ tên icon kiểu icGenApple24 / xmark.circle.fill)
export function summarizeSource(xml) {
  const attr = (tag, k) => (tag.match(new RegExp(`\\s${k}="([^"]*)"`)) || [])[1];
  const unesc = (s) => String(s ?? '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const icon = (n) => /^[a-z]+[A-Z]\w*$|^\w+(\.\w+)+$/.test(n);
  const texts = [];
  const buttons = [];
  let winH = 0;
  let top = Infinity;
  let bottom = 0;
  let alert = false;
  for (const tag of String(xml).match(/<[A-Za-z][\w.]*\s[^>]*>/g) || []) {
    const type = tag.match(/^<([\w.]+)/)[1];
    const box = attr(tag, 'bounds')?.match(/\d+/g)?.map(Number);
    const y = Number(attr(tag, 'y') ?? box?.[1] ?? 0);
    const h = box ? box[3] - box[1] : Number(attr(tag, 'height') ?? 0);
    if (!winH && h > 0) winH = y + h; // phần tử gốc (Application / hierarchy) = cả màn
    if (attr(tag, 'visible') === 'false' || attr(tag, 'displayed') === 'false') continue;
    if (/Alert$/.test(type)) alert = true;
    const name = unesc(attr(tag, 'label') || attr(tag, 'name') || attr(tag, 'text') || attr(tag, 'content-desc'));
    if (!name || y < 0) continue;
    if (!/Application$|Window$/.test(type)) { top = Math.min(top, y); bottom = Math.max(bottom, y + h); }
    const x = Number(attr(tag, 'x') ?? box?.[0] ?? 0);
    if (/StaticText$|TextView$/.test(type)) texts.push({ name, x, y });
    else if (/Button$/.test(type)) buttons.push(name);
  }
  texts.sort((a, b) => a.y - b.y || a.x - b.x);
  const words = [...new Set(texts.map((t) => t.name))];
  // Loại khung đang hiện: hộp thoại hệ thống → popup; mọi phần tử có tên đều nằm dưới 15% chiều cao (phía trên là nền mờ của
  // màn phía sau, không có trong page source) → chạm đáy: bottom sheet, không chạm đáy: popup; còn lại là màn thường (null)
  const kind = alert ? 'popup' : winH && top > winH * 0.15 ? (bottom > winH * 0.85 ? 'bottom sheet' : 'popup') : null;
  return {
    title: words[0] || null,
    text: words[1] ? words[1].slice(0, 160) : null,
    buttons: [...new Set(buttons)].filter((n) => !icon(n) && n !== 'Back').slice(0, 6),
    kind,
  };
}

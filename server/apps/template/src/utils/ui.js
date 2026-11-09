// Thao tác dùng chung: chờ phần tử bằng explicit wait, không sleep cố định.
import fs from 'node:fs';
import path from 'node:path';

// ===== Tìm phần tử theo chữ: khớp lỏng khoảng trắng =====
// Locator theo chữ (~text, name == "…", text("…")) chỉ đổi cách xuống dòng / thừa dấu cách (vd dev tách title 2 dòng bằng \n)
// vẫn tìm thấy: mỗi khoảng trắng trong chữ khớp 1+ khoảng trắng bất kỳ (dấu cách, \n, tab, NBSP). Chữ khác → vẫn không khớp.
// Chỉ nới lỏng việc TÌM; Verify text vẫn so chữ như cũ (compare.js). Chữ không có khoảng trắng → giữ nguyên locator.
const hasSpace = (t) => /\s/.test(String(t).trim());
export const looseRegex = (t) => `^\\s*${String(t).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(/\s+/).join('\\s+')}\\s*$`;
const STR = '("(?:[^"\\\\]|\\\\.)*")'; // chuỗi JSON trong locator
const parse = (lit) => { try { return JSON.parse(lit); } catch { return null; } };

export function loose(sel) {
  if (typeof sel !== 'string') return sel;
  if (sel.startsWith('~')) {
    const t = sel.slice(1);
    if (!hasSpace(t)) return sel;
    const r = JSON.stringify(looseRegex(t));
    return driver.isAndroid ? `android=new UiSelector().descriptionMatches(${r})` : `-ios predicate string:name MATCHES ${r}`;
  }
  if (sel.startsWith('-ios predicate string:')) {
    return sel.replace(new RegExp(`\\b(name|label)\\s*==\\s*${STR}`, 'g'), (m, attr, lit) => {
      const t = parse(lit);
      return t != null && hasSpace(t) ? `${attr} MATCHES ${JSON.stringify(looseRegex(t))}` : m;
    });
  }
  if (sel.startsWith('android=')) {
    return sel.replace(new RegExp(`\\.(text|description)\\(${STR}\\)`, 'g'), (m, fn, lit) => {
      const t = parse(lit);
      return t != null && hasSpace(t) ? `.${fn}Matches(${JSON.stringify(looseRegex(t))})` : m;
    });
  }
  return sel;
}

// Chữ mà locator đang tìm (~text, name/label == "…", text/description("…")); locator khác → null
export function selText(sel) {
  if (typeof sel !== 'string') return null;
  if (sel.startsWith('~')) return sel.slice(1);
  const m = sel.match(new RegExp(`\\b(?:name|label)\\s*==\\s*${STR}`)) || sel.match(new RegExp(`\\.(?:text|description)\\(${STR}\\)`));
  return m ? parse(m[1]) : null;
}

// ===== Locator lệch so với app (build mới đổi chữ / cách xuống dòng) =====
// Ghi vào REPORTS_DIR/locator-drift.jsonl, mỗi locator 1 lần / worker; runner gom lại cuối run để tester cập nhật Locator map
const drifted = new Set();
export function noteDrift(entry) {
  const key = `${entry.screen || ''}|${entry.locator}`;
  if (!process.env.REPORTS_DIR || drifted.has(key)) return;
  drifted.add(key);
  try {
    fs.mkdirSync(process.env.REPORTS_DIR, { recursive: true });
    fs.appendFileSync(path.join(process.env.REPORTS_DIR, 'locator-drift.jsonl'), `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
  } catch {}
}
// Tìm thấy nhờ khớp lỏng: chữ thật trong app khác chữ trong locator (chỉ khác khoảng trắng) → ghi lệch
async function checkDrift(sel, e) {
  if (drifted.has(`|${sel}`)) return;
  const want = selText(sel);
  try {
    const got = driver.isAndroid ? (await e.getAttribute('content-desc')) || (await e.getText()) : await e.getAttribute('name');
    if (got != null && got !== want) noteDrift({ locator: sel, actual: got, how: 'khác khoảng trắng / xuống dòng' });
    else drifted.add(`|${sel}`);
  } catch {}
}

// $ / $$ của module này: selector đã khớp lỏng
const $ = (sel) => globalThis.$(loose(sel));

export async function el(sel, timeout = 15000) {
  const e = await $(sel);
  await e.waitForExist({ timeout });
  if (loose(sel) !== sel) await checkDrift(sel, e);
  return e;
}

export async function tap(sel, timeout) {
  await (await el(sel, timeout)).click();
}

export async function typeInto(sel, text) {
  const e = await el(sel);
  await e.click();
  await e.clearValue();
  await e.setValue(text);
}

export async function exists(sel, timeout = 2000) {
  try {
    await $(sel).waitForExist({ timeout });
    return true;
  } catch {
    return false;
  }
}

// Đang HIỆN trên màn (không chỉ có trong cây phần tử: màn cũ nằm ẩn phía sau màn mới vẫn có trong cây)
export async function visible(sel, timeout = 2000) {
  try {
    await $(sel).waitForDisplayed({ timeout });
    return true;
  } catch {
    return false;
  }
}

export async function isEnabled(sel) {
  return (await el(sel)).isEnabled();
}

export async function nameOf(sel) {
  return (await el(sel)).getAttribute('name');
}

// Chạm vào toạ độ (dùng để đóng popup lịch / chạm ra ngoài)
export async function tapAt(x, y) {
  await driver.execute('mobile: tap', { x, y });
}

// Kéo 1 nét, giữ tay ở cuối để không có quán tính (fling = true: thả tay ngay để thước trôi xa)
export async function drag(sx, sy, ex, ey, { fling = false } = {}) {
  const dist = Math.hypot(ex - sx, ey - sy);
  let chain = browser
    .action('pointer', { parameters: { pointerType: 'touch' } })
    .move({ x: Math.round(sx), y: Math.round(sy) })
    .down()
    .pause(fling ? 0 : 100)
    .move({ x: Math.round(ex), y: Math.round(ey), duration: fling ? 120 : Math.max(250, Math.round(dist * 1.5)) });
  if (!fling) chain = chain.pause(300);
  await chain.up().perform();
}

// Số hiển thị theo locale: "80,5" / "80.5" / "1,498" / "170%"
export function toNumber(text) {
  const s = String(text).replace('%', '').trim();
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''));
  return Number(s.replace(',', '.'));
}

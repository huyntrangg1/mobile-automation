// Thao tác dùng chung: chờ phần tử bằng explicit wait, không sleep cố định.

export async function el(sel, timeout = 15000) {
  const e = await $(sel);
  await e.waitForExist({ timeout });
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

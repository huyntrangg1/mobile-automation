// Chụp màn hình + vị trí các phần tử cần kiểm ngay lúc đọc giá trị, để report khoanh đỏ đúng chỗ khi lệch.
// snapshot('Height', { heightValue: '~Height' }) → { heightValue: { screen, image, win, rect } }
// selector null / không tìm thấy → rect null (report ghi "không tìm thấy phần tử").
// near: { key: selector của phần tử mốc } — phần tử cần kiểm không có trên màn (lỗi "không hiển thị") →
//   khoanh nét đứt ngay dưới mốc, chỗ lẽ ra phải hiện (vd dòng lỗi dưới ô Password, link dưới nút gửi); missing = true,
//   instead = chữ đang hiện ở chỗ đó (vd lỗi khác).
// selector có thể là hàm async trả về phần tử (vd ô nhập lấy qua page object).

export const textSel = (t) => `-ios predicate string:type == "XCUIElementTypeStaticText" AND name == "${t}"`;

// Khung bao tất cả phần tử khớp selector (vd danh sách công tắc), đơn vị point
async function rectOf(sel) {
  const rects = [];
  const els = typeof sel === 'function' ? [await sel().catch(() => null)].filter(Boolean) : await $$(sel);
  for (const e of els) {
    const r = await driver.getElementRect(e.elementId).catch(() => null);
    if (r && r.width > 0 && r.height > 0) rects.push(r);
  }
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x, y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y,
  };
}

// Chữ đang hiện trong vùng box (để report ghi "chỗ đó hiện …" khi phần tử cần kiểm không có)
async function textsIn(box) {
  const out = [];
  for (const e of await $$('-ios predicate string:type == "XCUIElementTypeStaticText"')) {
    const r = await driver.getElementRect(e.elementId).catch(() => null);
    if (!r) continue;
    const [cx, cy] = [r.x + r.width / 2, r.y + r.height / 2];
    if (cx >= box.x && cx <= box.x + box.width && cy >= box.y - 6 && cy <= box.y + box.height + 6) {
      const t = await e.getAttribute('label').catch(() => null);
      if (t) out.push(t);
    }
  }
  return out;
}

export async function snapshot(screen, selectors = {}, near = {}) {
  const image = await driver.takeScreenshot(); // base64 PNG, đơn vị pixel
  const { width, height } = await driver.getWindowRect(); // đơn vị point → report tự quy đổi tỉ lệ
  const out = {};
  for (const [key, sel] of Object.entries(selectors)) {
    const rect = sel ? await rectOf(sel) : null;
    const mark = !rect && near[key] ? await rectOf(near[key]) : null;
    if (mark) {
      const box = { x: mark.x, y: mark.y + mark.height + 4, width: mark.width, height: 26 };
      out[key] = { screen, image, win: { width, height }, rect: box, missing: true, instead: await textsIn(box) };
    } else out[key] = { screen, image, win: { width, height }, rect };
  }
  return out;
}

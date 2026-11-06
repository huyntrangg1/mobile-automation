// Màn chặn trong lúc tự khám phá: paywall / IAP, tờ thanh toán của store, quảng cáo toàn màn.
// Popup xin quyền đã có dismissAlert; những cái này nằm trong app (hoặc app khác che lên) nên AI hay bấm nhầm "Subscribe" rồi kẹt.
// Không mua gì: chỉ tìm cách ĐÓNG, theo thứ tự rẻ → đắt, và trả về cách đã dùng để ghi log.

const PRICE = /[$€£₫¥]\s?\d|\d\s?[$€£₫¥]|\d+[.,]\d{2}\s?(usd|eur|vnd)|\bper (week|month|year)\b|\/\s?(wk|week|mo|month|yr|year)\b/i;
const OFFER = /\b(free trial|subscribe|subscription|premium|upgrade|unlock all|restore purchases?|best value|billed|cancel anytime)\b/i;
// Chữ trên nút đóng của paywall / quảng cáo — KHÔNG gồm Done / Continue / Restore (có thể là mua hoặc đi tiếp luồng thật)
const CLOSE_NAME = /^(close|x|✕|✖|×|dismiss|not now|maybe later|no,? thanks?|skip|skip ad|close ad|cancel|later|đóng|bỏ qua|để sau|không,? cảm ơn)$/i;
// Nút của tờ thanh toán store — chỉ bấm được Cancel
const STORE_CANCEL = /^(cancel|hủy|huỷ|not now)$/i;
// Nút trông như mua: tuyệt đối không bấm khi đang đóng overlay
export const BUY = /\b(subscribe|buy|purchase|pay|confirm|continue|start (free )?trial|try (it )?free|get premium|upgrade)\b/i;

const texts = (els) => els.filter((e) => e.type === 'StaticText' && e.name).map((e) => e.name);

// Màn có dấu hiệu paywall: có giá + từ khoá ưu đãi/đăng ký (hoặc có nút Restore Purchases)
export function looksLikePaywall(els) {
  const t = texts(els);
  const btn = els.filter((e) => e.type === 'Button' && e.name).map((e) => e.name);
  const all = [...t, ...btn];
  if (all.some((n) => /restore purchases?/i.test(n))) return true; // paywall hay vẽ "Restore Purchase" bằng StaticText, không phải Button
  return all.some((n) => PRICE.test(n)) && all.some((n) => OFFER.test(n));
}

// Ứng viên nút đóng, ưu tiên: nút có tên khớp CLOSE_NAME → nút không tên ở mép trên màn (X vẽ bằng icon), góc phải trước rồi góc trái
export function closeCandidates(els, win = { width: 400, height: 900 }) {
  const named = els.filter((e) => e.type === 'Button' && e.enabled && CLOSE_NAME.test((e.name || e.label || '').trim()));
  const top = win.height * 0.18;
  const small = (e) => e.rect.width > 0 && e.rect.width <= 90 && e.rect.height <= 90;
  const corner = els
    .filter((e) => (e.type === 'Button' || e.type === 'Image') && e.enabled && !BUY.test(e.name || '') && small(e) && e.rect.y < top && !named.includes(e))
    .sort((a, b) => b.rect.x - a.rect.x || a.rect.y - b.rect.y);
  return [...named, ...corner.filter((e) => e.type === 'Button' || !e.name || CLOSE_NAME.test(e.name))];
}

async function foregroundId(driver, platform) {
  try {
    if (platform === 'Android') return (await driver.getCurrentPackage?.()) || null;
    const r = await driver.execute('mobile: activeAppInfo');
    return r?.bundleId || null;
  } catch {
    return null;
  }
}

// App khác (store / trình duyệt / nhà quảng cáo) đang ở trên cùng
export async function foreignForeground(driver, app) {
  const id = await foregroundId(driver, app?.platform);
  return !!id && !!app?.bundleId && id !== app.bundleId && !/springboard|launcher|systemui/i.test(id) ? id : null;
}

async function tapPoint(driver, android, x, y) {
  await driver.execute(android ? 'mobile: clickGesture' : 'mobile: tap', { x, y });
}

// Popup chỉ có chữ (tooltip / giải thích, không có nút) mà Back không đóng → chạm ra vùng nền bên ngoài (trên rồi dưới)
export async function tapAway(driver, win, { app, tried = new Set() } = {}) {
  if (!win?.width) return null;
  const android = app?.platform === 'Android';
  for (const [k, label, x, y] of [['<away-top>', 'phía trên', win.width / 2, win.height * 0.07], ['<away-bottom>', 'phía dưới', win.width / 2, win.height * 0.93]]) {
    if (tried.has(k)) continue;
    tried.add(k);
    try { await tapPoint(driver, android, Math.round(x), Math.round(y)); return `Chạm ra ngoài ${label}`; } catch {}
  }
  return null;
}

// Thử đóng. Trả về chuỗi mô tả cách đã đóng, hoặc null nếu không làm được gì.
//   els = phần tử màn hiện tại; tried = Set locator đã bấm ở lần trước (tránh bấm lặp cùng một nút không hiệu quả)
export async function closeOverlay(driver, els, { app, win, tried = new Set() } = {}) {
  const android = app?.platform === 'Android';
  const foreign = await foreignForeground(driver, app);

  // 1. Tờ thanh toán / app khác che lên
  if (foreign) {
    if (!android) {
      // iOS: tờ StoreKit sandbox là alert → Cancel; không có thì kéo app về lại
      try {
        const buttons = await driver.execute('mobile: alert', { action: 'getButtons' });
        const cancel = Array.isArray(buttons) && buttons.find((b) => STORE_CANCEL.test(b));
        if (cancel) { await driver.execute('mobile: alert', { action: 'dismiss', buttonLabel: cancel }); return `Hủy tờ thanh toán "${cancel}"`; }
      } catch {}
      try { await driver.execute('mobile: activateApp', { bundleId: app.bundleId }); return `Kéo app về lại (đang ở ${foreign})`; } catch {}
    } else {
      try { await driver.back(); return `Back khỏi ${foreign}`; } catch {}
      try { await driver.execute('mobile: activateApp', { appId: app.bundleId }); return `Kéo app về lại (đang ở ${foreign})`; } catch {}
    }
  }

  // 2. Nút đóng trong app (có tên, rồi X không tên ở mép trên)
  for (const c of closeCandidates(els, win)) {
    if (tried.has(c.locator)) continue;
    tried.add(c.locator);
    try {
      await (await driver.$(c.locator)).click();
      return c.name ? `Bấm "${c.name}"` : `Bấm nút không tên ở mép trên (${Math.round(c.rect.x)},${Math.round(c.rect.y)})`;
    } catch {}
  }

  // 2b. Nút X không có trong cây phần tử (vẽ bằng ảnh / SDK paywall không gắn accessibility) → chạm mù ở góc trên (phải rồi trái)
  if (win?.width) {
    const x = Math.round(win.width * 0.08);
    const y = Math.round(Math.max(60, win.height * 0.075));
    for (const [k, label, px] of [['<tap-tr>', 'góc phải trên', win.width - x], ['<tap-tl>', 'góc trái trên', x]]) {
      if (tried.has(k)) continue;
      tried.add(k);
      try { await tapPoint(driver, android, px, y); return `Chạm ${label} (${px},${y}) — nút X không có trong cây phần tử`; } catch {}
    }
  }

  // 3. Android: nút Back hệ thống đóng được hầu hết paywall / quảng cáo / bottom sheet
  if (android && !tried.has('<back>')) {
    tried.add('<back>');
    try { await driver.back(); return 'Back hệ thống'; } catch {}
  }
  return null;
}

// Lớp chặn mua / đăng ký trong code (không chỉ dựa vào prompt) — dùng chung cho AI Smoke Test, Tự khám phá, đi tới màn, /resolve.
// Quy tắc an toàn: được bấm mọi nút TRONG APP (kể cả nút mua trên paywall — mở tờ thanh toán là được), nhưng
// KHÔNG BAO GIỜ xác nhận mua: trên tờ thanh toán của store (Google Play, StoreKit / App Store, sandbox) hoặc khi app khác
// đang ở trên cùng thì chỉ được bấm nút đóng / huỷ.
const BUY_ALWAYS = /\b(subscribe|buy|purchase|start (my |your )?(free )?trial|free trial|try (it )?free|get premium|upgrade|unlock premium)\b|(?:^|\s)(?:mua|đăng ký|dùng thử)/i;
const BUY_ON_PAYWALL = /\b(continue|confirm|pay|start|get|claim|unlock|go pro|try)\b/i;

// Nút trông như mua (giữ cho tương thích: smoke cũ / tryLive / explore chặn khi đóng paywall)
export function isBuyTarget(el, onPaywall = false) {
  const name = `${el?.name || ''} ${el?.label || ''}`;
  return BUY_ALWAYS.test(name) || (onPaywall && BUY_ON_PAYWALL.test(name));
}

// Ứng dụng của store / tờ thanh toán hệ thống (bundle id / package đang ở trên cùng)
export const STORE_APP = /com\.android\.vending|com\.google\.android\.finsky|storekit|com\.apple\.appstore|com\.apple\.ios\.storekituiservice|itunesstored|com\.apple\.passkit|com\.apple\.paymentui|com\.google\.android\.gms\.wallet/i;
// Chữ chỉ có trên tờ thanh toán của store (không phải paywall của app)
const STORE_TEXT = /environment:\s*sandbox|\[sandbox\]|double.?click to (pay|subscribe|install|confirm|buy)|confirm with (side|home) button|side button to (pay|subscribe)|(touch|face) id to (pay|subscribe|buy)|1-tap buy|one-tap buy|buy with 1-tap|^(google play|app store)$/i;
// Nút xác nhận trên tờ thanh toán: tuyệt đối không bấm
export const STORE_CONFIRM = /\b(buy|subscribe|purchase|confirm|pay|1-tap|one-tap|install|continue|ok|start|get|agree|accept|trial|done|redeem|verify|approve)\b|mua|đăng ký|thanh toán|xác nhận|tiếp tục|đồng ý|[$€£₫¥]\s?\d|\d\s?[$€£₫¥]/i;
// Nút đóng được phép trên tờ thanh toán / app khác
const SAFE_ON_STORE = /^(cancel|close|x|✕|✖|×|not now|dismiss|back|navigate up|hủy|huỷ|đóng|không phải bây giờ|để sau|quay lại)$/i;

const nameOf = (el) => String(el?.name || el?.label || el?.text || '').trim();
export const isSafeOnStore = (el) => SAFE_ON_STORE.test(nameOf(el)) || SAFE_ON_STORE.test(String(el?.label || '').trim());

// Màn có dấu hiệu đang là tờ thanh toán của store (dù cây phần tử vẫn thuộc app — iOS hiện tờ StoreKit bên trong app)
export function looksLikeStoreSheet(elements = []) {
  return elements.some((e) => [e?.name, e?.label, e?.text].some((t) => t && STORE_TEXT.test(String(t).trim())) || STORE_APP.test(String(e?.package || '')));
}

// Kiểm một thao tác bấm / nhập lên phần tử el. store = đang ở tờ thanh toán / app khác.
//   → { ok: true } | { ok: false, why }
export function purchaseCheck(el, { store = false } = {}) {
  if (!store) return { ok: true };
  if (el && isSafeOnStore(el)) return { ok: true };
  const n = nameOf(el);
  if (!el) return { ok: false, why: 'Đang ở tờ thanh toán / app khác: chỉ được bấm nút đóng / huỷ (không xác định được phần tử)' };
  return { ok: false, why: `Đang ở tờ thanh toán / app khác: không bấm "${n || 'phần tử không tên'}" (chỉ được bấm đóng / huỷ)${STORE_CONFIRM.test(n) ? ' — trông như nút xác nhận mua' : ''}` };
}

// Tình trạng màn để quyết định chặn: tờ thanh toán (theo chữ trên màn) hoặc app khác đang ở trên cùng (foreign = id của app đó)
export function storeContext(elements, foreign) {
  return { store: !!foreign || looksLikeStoreSheet(elements), foreign: foreign || null };
}

// Mọi phần tử chứa điểm (xPct, yPct là % cửa sổ), nhỏ nhất trước (phần tử được bấm, rồi các khung cha). [] nếu không biết cỡ cửa sổ.
export function elementsAtPoint(elements, win, xPct, yPct) {
  if (!win?.width || !win?.height) return [];
  const x = (win.width * xPct) / 100;
  const y = (win.height * yPct) / 100;
  return elements.filter((e) => {
    const r = e.rect;
    return r && r.width > 0 && r.height > 0 && x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
  }).sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
}

// Phần tử nhỏ nhất chứa điểm. null nếu không biết cỡ cửa sổ hoặc không trúng gì.
export function elementAtPoint(elements, win, xPct, yPct) {
  return elementsAtPoint(elements, win, xPct, yPct)[0] || null;
}

// Kiểm chạm theo toạ độ. Không biết cỡ cửa sổ mà màn là paywall / tờ thanh toán → từ chối (không biết chạm vào đâu).
// Tờ thanh toán: phần tử trúng nhỏ nhất phải là nút đóng / huỷ. buyCheck (tuỳ chọn): kiểm thêm trên MỌI phần tử chứa điểm
// (nút mua thường là khung lớn bọc chữ / giá bên trong — chỉ xem phần tử nhỏ nhất là bỏ sót).
export function pointCheck(elements, win, xPct, yPct, { paywall = false, store = false, buyCheck = null } = {}) {
  if ((!win?.width || !win?.height) && (paywall || store)) return { ok: false, why: 'Không biết cỡ màn hình nên không chạm theo toạ độ trên paywall / tờ thanh toán' };
  const hits = elementsAtPoint(elements, win, xPct, yPct);
  if (store) {
    if (hits[0] && isSafeOnStore(hits[0])) return { ok: true, hit: hits[0] };
    return { ok: false, why: `Đang ở tờ thanh toán / app khác: điểm chạm ${hits[0] ? `rơi vào "${nameOf(hits[0]) || 'phần tử không tên'}"` : 'không trúng nút đóng'} — chỉ được bấm đóng / huỷ`, hit: hits[0] || null };
  }
  if (buyCheck) {
    const bad = hits.find((h) => buyCheck(h));
    if (bad && !(hits[0] && isSafeOnStore(hits[0]))) return { ok: false, why: `Điểm chạm rơi vào nút mua "${nameOf(bad)}"`, hit: bad };
  }
  return { ok: true, hit: hits[0] || null };
}

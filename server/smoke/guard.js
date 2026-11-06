// Lớp chặn mua / đăng ký trong code (không chỉ dựa vào prompt): từ chối thao tác lên nút trông như mua hàng.
// "Continue / Confirm / Pay…" chỉ bị chặn ở màn paywall — onboarding cần "Continue".
const BUY_ALWAYS = /\b(subscribe|buy|purchase|start (my |your )?(free )?trial|free trial|try (it )?free|get premium|upgrade|unlock premium)\b|(?:^|\s)(?:mua|đăng ký|dùng thử)/i;
const BUY_ON_PAYWALL = /\b(continue|confirm|pay|start|get|claim|unlock|go pro|try)\b/i;

export function isBuyTarget(el, onPaywall = false) {
  const name = `${el?.name || ''} ${el?.label || ''}`;
  return BUY_ALWAYS.test(name) || (onPaywall && BUY_ON_PAYWALL.test(name));
}

// Phần tử nhỏ nhất chứa điểm (xPct, yPct là % cửa sổ; rect cùng đơn vị với win). null nếu không biết cỡ cửa sổ hoặc không trúng gì.
export function elementAtPoint(elements, win, xPct, yPct) {
  if (!win?.width || !win?.height) return null;
  const x = (win.width * xPct) / 100;
  const y = (win.height * yPct) / 100;
  let best = null;
  for (const e of elements) {
    const r = e.rect;
    if (!r || !(r.width > 0) || !(r.height > 0)) continue;
    if (x < r.x || x > r.x + r.width || y < r.y || y > r.y + r.height) continue;
    if (!best || r.width * r.height < best.rect.width * best.rect.height) best = e;
  }
  return best;
}

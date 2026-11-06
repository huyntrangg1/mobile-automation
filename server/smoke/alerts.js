// Popup hệ thống khi smoke test: CHO PHÉP các quyền tính năng cần (thông báo, vị trí, ảnh, camera…), chỉ TỪ CHỐI theo dõi quảng cáo.
// (Từ chối mọi quyền làm tính năng hỏng — vd Blood Sugar ghi vào Apple Health bị chặn → báo lệch giả.)
import { systemDialog } from '../device/platforms.js';

const TRACK = /not to track|to not track|do not track|không theo dõi/i;
// Thứ tự ưu tiên khi chọn nút cho phép
const ALLOW = [/^allow while using app$/i, /^allow$/i, /^while using the app$/i, /^allow once$/i, /^only this time$/i, /^turn on all$/i, /^ok$/i, /^continue$/i, /^cho phép/i];
// Nút mua / xác nhận mua: KHÔNG BAO GIỜ bấm (vd StoreKit "Confirm Your In-App Purchase": Cancel / Buy)
const BUY = /\b(buy|purchase|subscribe|trial|confirm|pay)\b|mua|đăng ký|dùng thử/i;
const CANCEL = [/^cancel$/i, /^not now$/i, /^close$/i, /^dismiss$/i, /^skip$/i, /^don.t allow$/i, /^hủy$/i, /^huỷ$/i, /^để sau$/i];
const pickCancel = (buttons) => { for (const re of CANCEL) { const b = buttons.find((x) => re.test(String(x).trim())); if (b) return b; } return null; };
const pickAllow = (buttons) => { for (const re of ALLOW) { const b = buttons.find((x) => re.test(String(x).trim())); if (b) return b; } return null; };

// Trả về nhãn nút đã bấm, hoặc null nếu không có hộp thoại / không xử lý được. Không ném lỗi.
export async function handleAlert(driver, platform) {
  if (platform === 'Android') {
    try {
      const dlg = systemDialog(await driver.getPageSource());
      if (!dlg) return null;
      const allow = pickAllow(dlg.buttons.filter((b) => !BUY.test(b)));
      const sel = allow ? `android=new UiSelector().text("${allow.replace(/"/g, '\\"')}")` : dlg.deny;
      if (!sel) return null;
      await (await driver.$(sel)).click();
      return allow || 'từ chối';
    } catch { return null; }
  }
  try {
    const buttons = await driver.execute('mobile: alert', { action: 'getButtons' });
    if (!Array.isArray(buttons) || !buttons.length) return null;
    const safe = buttons.filter((b) => !BUY.test(b));
    const pick = safe.find((b) => TRACK.test(b)) || pickAllow(safe) || pickCancel(safe) || safe[0];
    if (!pick) return null;
    await driver.execute('mobile: alert', { action: 'accept', buttonLabel: pick });
    return pick;
  } catch { return null; }
}

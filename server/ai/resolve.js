// Tìm phần tử lúc chạy theo mô tả trong test case (cách SimUtil làm: không cần lấy locator trước).
// Trình chạy gửi danh sách phần tử của màn đang hiện + mô tả target → AI chọn đúng 1 phần tử trong danh sách, hoặc không chọn.
import { runClaude as defaultRunClaude } from './claude.js';
import { BUY, looksLikePaywall, isCloseName } from '../locators/overlay.js';
import { looksLikeStoreSheet, isSafeOnStore } from '../smoke/guard.js';

// Nút mua chắc chắn (giống HARD_BUY của assist.js) — kể cả ngoài paywall; "Continue / Confirm" chỉ coi là mua trên paywall
const HARD_BUY = /\b(subscribe|buy|purchase|start (free )?trial|try (it )?free|get premium|upgrade)\b|[$€£₫¥]\s?\d/i;
// Kết quả /resolve được trình chạy lưu thành override (dùng lại mọi lần chạy sau) → từ chối phần tử trông như nút mua / xác nhận mua.
// Ngoại lệ: chính mô tả target là nút mua (test case cố ý kiểm paywall mở tờ thanh toán) và màn KHÔNG phải tờ thanh toán.
export function resolveBuyCheck(locator, elements = [], target = '') {
  const el = elements.find((e) => e && e.locator === locator);
  if (!el) return { ok: true };
  const n = String(el.name || el.label || '');
  if (looksLikeStoreSheet(elements)) return isSafeOnStore(el) ? { ok: true } : { ok: false, why: `Chặn: "${n}" nằm trên tờ thanh toán của store — chỉ được bấm đóng / huỷ` };
  if (isCloseName(n)) return { ok: true };
  const buy = HARD_BUY.test(n) || (looksLikePaywall(elements) && BUY.test(n));
  if (!buy) return { ok: true };
  if (HARD_BUY.test(String(target)) || (looksLikePaywall(elements) && BUY.test(String(target)))) return { ok: true };
  return { ok: false, why: `Chặn: "${n}" trông như nút mua — không tự chọn thay cho "${target}"` };
}

const SCHEMA = { type: 'object', properties: { locator: { type: 'string' }, reason: { type: 'string' } }, required: ['locator', 'reason'] };
// Chọn 1 phần tử từ danh sách ngắn → model nhanh (giống khám phá)
const MODEL = process.env.QAPD_RESOLVE_MODEL || process.env.QAPD_EXPLORE_MODEL || 'claude-sonnet-5-5';

export function resolvePrompt({ target, screen, kind, platform, elements }) {
  const box = (r) => (Array.isArray(r) && r[2] ? ` [x ${r[0]}, y ${r[1]}, ${r[2]}×${r[3]}]` : '');
  const list = elements.slice(0, 150).map((e) => `- ${e.type} "${e.name || e.label || ''}"${e.label && e.label !== e.name ? ` (label "${e.label}")` : ''}${box(e.rect)} → ${e.locator}`).join('\n');
  return `App ${platform || 'iOS'}. Test case muốn ${kind === 'enter' ? 'nhập chữ vào' : 'bấm'} phần tử được mô tả là: "${target}" (màn "${screen}").
Phần tử trên màn đang hiện (loại "tên" → locator):
${list}

Chọn đúng MỘT phần tử khớp mô tả, trả "locator" chép NGUYÊN VĂN từ danh sách (sau dấu →).
Mô tả có thể là chữ trên nút, hoặc tả nút bằng lời (vd "Nút Back ← (header)", "Nút Share có coach mark", "Ảnh tutorial").
Dùng cả vị trí / kích thước [x, y, rộng×cao]: "ảnh …" / "vùng …" thường là một nút trong suốt lớn phủ lên ảnh (tên kiểu "Tap here"), ảnh trang trí không có tên nên không nằm trong danh sách; "header" = phần tử sát mép trên; nút ← / Back thường ở góc trên trái.
Không có phần tử nào khớp chắc chắn (vd app đang ở màn khác, phần tử không có) → "locator" = "" — KHÔNG đoán bừa.`;
}

export async function resolveTarget(input, { runClaude = defaultRunClaude, model = MODEL } = {}) {
  const elements = Array.isArray(input.elements) ? input.elements.filter((e) => e && e.locator) : [];
  if (!input.target || !elements.length) return null;
  const r = await runClaude({ prompt: resolvePrompt({ ...input, elements }), schema: SCHEMA, timeoutMs: 60000, noTools: true, model });
  if (!r.ok) return null;
  const loc = String(r.data.locator || '').trim();
  return elements.some((e) => e.locator === loc) ? { locator: loc, reason: r.data.reason || '' } : null;
}

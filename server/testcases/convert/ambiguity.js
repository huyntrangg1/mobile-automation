// Dò "điểm mờ" trong case manual trước khi chuyển đổi: chỗ AI sẽ phải đoán (chữ chính xác, trạng thái bắt đầu, giá trị cụ thể).
const VAGUE = ['không hợp lệ', 'hợp lệ', 'phù hợp', 'bất kỳ', 'đúng']; // cụm dài đặt trước để báo đúng cụm
const QUOTED = /["“”„«»][^"“”„«»]+["“”„«»]/;

// → [{ code: 'NO_QUOTED_EXPECTED' | 'EMPTY_PRE' | 'VAGUE_STEP', text }]
export function findAmbiguity(c) {
  const out = [];
  if (!QUOTED.test(String(c.expected || ''))) {
    out.push({ code: 'NO_QUOTED_EXPECTED', text: 'Expected không có chữ chính xác trong dấu ngoặc kép — chỉ so được bằng "contains" hoặc phải đoán chữ' });
  }
  if (!String(c.pre || '').trim()) {
    out.push({ code: 'EMPTY_PRE', text: 'Pre-condition trống — không biết case bắt đầu từ trạng thái nào (cài lại app hay tiếp nối)' });
  }
  const steps = String(c.steps || '').toLowerCase();
  const hit = VAGUE.find((w) => steps.includes(w));
  if (hit) out.push({ code: 'VAGUE_STEP', text: `Bước chứa "${hit}" — chưa có giá trị cụ thể để nhập / kiểm` });
  return out;
}

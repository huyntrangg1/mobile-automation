// Dò "điểm mờ" trong case manual trước khi chuyển đổi: chỗ AI sẽ phải đoán (chữ chính xác, trạng thái bắt đầu, giá trị cụ thể).
const VAGUE = ['không hợp lệ', 'hợp lệ', 'phù hợp', 'bất kỳ', 'đúng']; // cụm dài đặt trước để báo đúng cụm
const QUOTED = /["“”„«»][^"“”„«»]+["“”„«»]/;
// Số kèm đơn vị đo (125 mg/dL, 72 bpm, 50%) hoặc giờ (08:00) cũng là giá trị cụ thể để kiểm, dù không có ngoặc kép.
// Số đếm trơn ("8 dòng", "2 lần", "3 items") không tính: chưa biết chữ nào trên màn.
const UNIT = '%|°[CF]|mg\\/dL|mmol\\/L|mmHg|bpm|kcal|cal|kg|lbs?|g|cm|mm|km|m|ft|ml|L|oz|bước|steps|đ|₫|\\$|USD|VND';
const MEASURE = new RegExp(`\\d+(?:[.,]\\d+)?\\s?(?:${UNIT})(?![\\p{L}\\d])|\\b\\d{1,2}:\\d{2}\\b|[$₫]\\s?\\d`, 'u');
const concrete = (s) => QUOTED.test(s) || MEASURE.test(s);

// → [{ code: 'NO_QUOTED_EXPECTED' | 'EMPTY_PRE' | 'VAGUE_STEP', text }]
export function findAmbiguity(c) {
  const out = [];
  if (!concrete(String(c.expected || ''))) {
    out.push({ code: 'NO_QUOTED_EXPECTED', text: 'Expected chưa ghi chữ cụ thể trong dấu ngoặc kép, nên chưa rõ màn hình phải hiện chữ gì thì coi là đạt' });
  }
  if (!String(c.pre || '').trim()) {
    out.push({ code: 'EMPTY_PRE', text: 'Pre-condition trống, chưa rõ case bắt đầu từ đâu (cài lại app hay chạy tiếp case trước)' });
  }
  const steps = String(c.steps || '').toLowerCase();
  const hit = VAGUE.find((w) => steps.includes(w));
  if (hit) out.push({ code: 'VAGUE_STEP', text: `Bước ghi "${hit}" nhưng chưa có giá trị cụ thể để nhập hoặc kiểm` });
  return out;
}

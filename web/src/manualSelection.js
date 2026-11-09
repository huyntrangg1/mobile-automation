// Hàm thuần cho màn "Import manual": chia hai danh sách, chuyển case qua lại, đếm tóm tắt. Khoá case = (sheet, id) vì cùng TC ID có thể nằm ở hai sheet.
export const keyOf = (c) => `${c.sheet}:${c.id}`;

export function splitByMode(cases) {
  return { automate: cases.filter((c) => c.mode === 'automate'), manual: cases.filter((c) => c.mode === 'manual') };
}

// Không đổi mảng gốc. Đổi sang mode khác → by 'user' và chờ chuyển đổi lại (trừ case đang xung đột)
export function moveCase(cases, { sheet, id }, mode) {
  return cases.map((c) => {
    if (c.sheet !== sheet || c.id !== id) return c;
    const changed = c.mode !== mode;
    return { ...c, mode, by: 'user', reason: 'Bạn chọn', state: changed && c.state !== 'conflict' ? 'pending' : c.state };
  });
}

export function summary(mi) {
  const { automate, manual } = splitByMode(mi.cases);
  return {
    automate: automate.length,
    manual: manual.length,
    ambiguous: automate.filter((c) => c.ambiguity?.length).length,
    review: mi.review?.length || 0,
    conflicts: mi.cases.filter((c) => c.state === 'conflict').length,
  };
}

// Gom dòng "Cần review" theo nhãn đầu dòng ([Manual], [Quy tắc], [Locator map], [Gen]); dòng không nhãn vào "Khác". Giữ thứ tự nhãn xuất hiện đầu tiên
// Nhãn đầu dòng → tên nhóm hiển thị (nhãn khác giữ nguyên)
const REVIEW_LABELS = { 'Chạy thử': 'Chạy thử trên thiết bị' };
export function groupReview(lines = []) {
  const groups = new Map();
  for (const l of lines) {
    const m = /^\[([^\]]+)\]\s*(.*)$/.exec(String(l));
    const label = m ? REVIEW_LABELS[m[1]] || m[1] : 'Khác';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(m ? m[2] : String(l));
  }
  return [...groups].map(([label, items]) => ({ label, items }));
}

// Lỗi chặn của server hay lặp tiền tố ("Sheet X: Khung: …; Khung: …"): tách ra từng ý, bỏ tiền tố "Sheet …:" và bỏ trùng
export function cleanProblems(problems = []) {
  const out = [];
  for (const p of problems) for (const part of String(p).replace(/^Sheet [^:]+:\s*/, '').split(/;\s+(?=Khung:|Luồng|[A-Z]{2,}_)/)) {
    const t = part.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

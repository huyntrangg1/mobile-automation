// Gom thông tin của test đang chạy để hook afterTest ghi ra report: test case (từ xlsx) + các điểm kiểm bị lệch.
// Cùng 1 worker nên spec và hook trong config dùng chung module này.

let current = { case: null, bugs: [], steps: [] };
const planned = [];

export function resetCurrent() {
  current = { case: null, bugs: [], steps: [] };
}

// meta: { id, title, priority, feature, file, dataSet, run, precondition, steps, expected } — steps / expected là mảng dòng đã điền data
export function setCase(meta) {
  current.case = meta;
}

// bug: { step, label, actual, expected, evidence, keyword?, target?, value? } — at: vị trí điểm kiểm trong nhật ký bước
export function addBug(bug) {
  current.bugs.push({ at: current.steps.length - 1, ...bug });
}

// Nhật ký từng bước đã chạy (report mở test case → danh sách bước + kết quả):
// { kind: Action|Nav|Check, step, screen?, keyword?, target?, value?, label?, ok, actual?, expected?, error? }
export function logStep(entry) {
  current.steps.push(entry);
}

export function takeCurrent() {
  return current;
}

// Test case dự kiến chạy (đăng ký lúc khai báo describe / it): cái nào không chạy trong lần này → "Not Run"
// entry: { suite, title, case: { id, title, file, dataSet, run } }
export function planTest(entry) {
  planned.push(entry);
}

export const takePlanned = () => planned;

// "${height_cm}" → giá trị cột tương ứng của dòng TestData; Date → DD/MM/YYYY
export function fillTemplate(text, row, formatDate) {
  return String(text ?? '').replace(/\$\{(\w+)\}/g, (m, k) => {
    if (!(k in row)) return m;
    const v = row[k];
    return v instanceof Date ? formatDate(v) : String(v);
  });
}

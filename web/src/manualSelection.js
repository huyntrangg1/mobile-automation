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

// Cuộn tới một phần tử bằng code (không để AI tự vuốt từng lần, vốn hay dừng sớm rồi kết luận "không có").
// Danh sách phần tử chỉ gồm phần ĐANG HIỆN: vuốt lên từng lần, đọc lại, dừng khi thấy nhãn hoặc khi màn không đổi nữa (hết màn).
export const fingerprint = (els) => els.map((e) => `${e.type}:${e.name}:${Math.round(e.rect?.y ?? 0)}`).join('|');
const norm = (t) => String(t ?? '').trim().toLowerCase();

export async function scrollToText({ label, read, swipeUp, elements, max = 8 }) {
  const want = norm(label);
  const has = (els) => els.some((e) => [e.name, e.label].some((t) => t && norm(t).includes(want)));
  let els = elements || await read();
  if (has(els)) return { found: true, swipes: 0, bottom: false };
  let fp = fingerprint(els);
  for (let i = 1; i <= max; i++) {
    await swipeUp();
    els = await read();
    if (has(els)) return { found: true, swipes: i, bottom: false };
    const next = fingerprint(els);
    if (next === fp) return { found: false, swipes: i, bottom: true };
    fp = next;
  }
  return { found: false, swipes: max, bottom: false };
}

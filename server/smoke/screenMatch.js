// Kiểm chứng bằng code rằng màn đang hiện đúng là màn của một frame Figma (AI nêu tên frame có thể nhầm).
// So các NHÃN của frame (bỏ số / ngày / đơn vị là dữ liệu minh họa) với chữ đang có trên màn app.
import { isDataLike } from './noise.js';

const low = (t) => String(t ?? '').trim().toLowerCase();

// → { checked, ratio }. checked:false khi frame có < 2 nhãn so sánh được (không đủ căn cứ để kết luận lệch màn)
export function screenOverlap(elements, frameTexts) {
  const labels = [...new Set((frameTexts || []).filter((t) => !isDataLike(t)).map(low))];
  if (labels.length < 2) return { checked: false, ratio: 1 };
  const cur = [...new Set(elements.flatMap((e) => [low(e.name), low(e.label)]).filter(Boolean))];
  const hit = labels.filter((t) => cur.includes(t) || (t.length >= 4 && cur.some((c) => c.includes(t)))).length;
  return { checked: true, ratio: hit / labels.length };
}

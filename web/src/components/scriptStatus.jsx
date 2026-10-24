// Trạng thái script của case (badge "</>" theo canvas)
export const SCRIPT = {
  none: ['ss ss-none', 'Chưa gen'],
  generating: ['ss ss-gen', 'Đang gen…'],
  generated: ['ss ss-valid', 'Đã gen'],
  failed: ['ss ss-err', 'Gen lỗi'],
  stale: ['ss ss-review', 'Cần gen lại'],
};

export function ScriptBadge({ script }) {
  const [cls, label] = SCRIPT[script?.status] || SCRIPT.none;
  return <span className={cls}>{label}{script?.reviewed ? ' · đã review' : ''}</span>;
}

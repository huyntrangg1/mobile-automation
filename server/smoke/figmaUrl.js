// Tách fileKey + nodeId từ link Figma. Chỉ nhận link /design/ (file thiết kế); nhánh /branch/ dùng branchKey làm fileKey.
export function parseFigmaUrl(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { return null; }
  if (!/(^|\.)figma\.com$/.test(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'design' || !parts[1]) return null;
  const fileKey = parts[2] === 'branch' && parts[3] ? parts[3] : parts[1];
  const raw = u.searchParams.get('node-id');
  const nodeId = raw && /^\d+[-:]\d+$/.test(raw) ? raw.replace('-', ':') : null;
  return { fileKey, nodeId };
}

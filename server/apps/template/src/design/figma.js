// Đọc frame Figma qua REST API (token: biến môi trường FIGMA_TOKEN — Personal access token, quyền "File content: read").
//   frameOf(url) → { node (cây node của frame), png (Buffer ảnh render), scale (px ảnh / đơn vị Figma) }
//   flatten(node) → { frame, texts, shapes, ignored } — phần tử cần so, toạ độ tính từ góc trên-trái của frame
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const API = 'https://api.figma.com/v1';

// https://www.figma.com/design/<key>/<tên>?node-id=12-34  ·  /file/<key>/…  ·  /proto/<key>/…  (node-id "12-34" hoặc "12:34")
export function parseFigmaUrl(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { throw new Error(`Link Figma không hợp lệ: "${url}"`); }
  const m = u.pathname.match(/^\/(?:design|file|proto|board)\/([A-Za-z0-9]+)(?:\/branch\/([A-Za-z0-9]+))?/);
  if (!/figma\.com$/.test(u.hostname) || !m) throw new Error(`Không phải link file Figma: "${url}"`);
  const node = u.searchParams.get('node-id');
  if (!node) throw new Error(`Link Figma chưa trỏ tới frame (thiếu node-id) — trong Figma chọn frame → Copy link to selection: "${url}"`);
  return { fileKey: m[2] || m[1], nodeId: decodeURIComponent(node).replace(/-/g, ':') };
}

async function get(url, token, fetchImpl) {
  const res = await fetchImpl(url, { headers: { 'X-Figma-Token': token } });
  if (res.status === 403) throw new Error('Figma từ chối (403): FIGMA_TOKEN sai / hết hạn hoặc không có quyền xem file');
  if (res.status === 404) throw new Error('Figma: không thấy file / frame (404) — kiểm tra link');
  if (res.status === 429) throw new Error('Figma: gọi API quá nhiều (429) — thử lại sau ít phút');
  if (!res.ok) throw new Error(`Figma lỗi ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

// Ảnh render ở tỉ lệ đủ nét so với ảnh chụp máy (≤ 4 — giới hạn của Figma). Cache theo link + version file → chạy lại không gọi lại API
export async function frameOf(url, { token = process.env.FIGMA_TOKEN, scale = 3, cacheDir = null, fetchImpl = fetch } = {}) {
  if (!token) throw new Error('Thiếu FIGMA_TOKEN — tạo Personal access token trong Figma (Settings → Security) rồi thêm vào Cài đặt app → Biến môi trường');
  const { fileKey, nodeId } = parseFigmaUrl(url);
  const s = Math.max(1, Math.min(4, Math.round(scale)));
  const res = await get(`${API}/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`, token, fetchImpl);
  const json = await res.json();
  const node = json.nodes?.[nodeId]?.document;
  if (!node) throw new Error(`Figma: file không có node ${nodeId}`);
  const key = crypto.createHash('sha1').update(`${fileKey}|${nodeId}|${json.version || json.lastModified || ''}|${s}`).digest('hex').slice(0, 16);
  const cached = cacheDir && path.join(cacheDir, `${key}.png`);
  if (cached && fs.existsSync(cached)) return { node, png: fs.readFileSync(cached), scale: s };
  const img = await (await get(`${API}/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=${s}`, token, fetchImpl)).json();
  const link = img.images?.[nodeId];
  if (!link) throw new Error(`Figma không render được frame ${nodeId}${img.err ? `: ${img.err}` : ''}`);
  const png = Buffer.from(await (await fetchImpl(link)).arrayBuffer());
  if (cached) { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cached, png); }
  return { node, png, scale: s };
}

const visible = (n) => n.visible !== false && (n.opacity ?? 1) > 0.01;
const solid = (paints = []) => paints.find((p) => p.visible !== false && p.type === 'SOLID' && (p.opacity ?? 1) > 0.05);
const hasImage = (paints = []) => paints.some((p) => p.visible !== false && p.type === 'IMAGE');
// Thanh trạng thái / thanh home của iOS, bàn phím: không phải nội dung app → không so
const SYSTEM = /status\s*bar|statusbar|home\s*indicator|homeindicator|notch|dynamic island|keyboard|bàn phím/i;
const hasText = (n) => n.type === 'TEXT' || (n.children || []).some(hasText);

function applyCase(text, style = {}) {
  switch (style.textCase) {
    case 'UPPER': return text.toUpperCase();
    case 'LOWER': return text.toLowerCase();
    case 'TITLE': return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    default: return text;
  }
}

// Ràng buộc dọc của nhánh con trực tiếp của frame: máy cao hơn frame thì phần neo đáy (nút dưới cùng) dời xuống theo đáy
const anchorOf = (n) => n.constraints?.vertical || (n.layoutPositioning === 'ABSOLUTE' ? 'TOP' : 'TOP');

export function flatten(frame) {
  const fb = frame.absoluteBoundingBox;
  const rel = (b) => ({ x: b.x - fb.x, y: b.y - fb.y, width: b.width, height: b.height });
  const texts = [];
  const shapes = [];
  const ignored = [];
  const walk = (n, anchor, clip) => {
    if (!visible(n) || !n.absoluteBoundingBox) return;
    const box = rel(n.absoluteBoundingBox);
    if (box.width < 1 || box.height < 1) return;
    // Nằm ngoài frame (phần bị cắt) → không thấy trên màn
    if (box.x >= fb.width || box.y >= fb.height || box.x + box.width <= 0 || box.y + box.height <= 0) return;
    if (SYSTEM.test(n.name || '')) { ignored.push({ name: n.name, box }); return; }
    const base = { id: n.id, name: n.name, box, anchor };
    if (n.type === 'TEXT') {
      const text = applyCase(String(n.characters || ''), n.style).trim();
      if (!text) return;
      const fill = solid(n.fills);
      texts.push({
        ...base, text, fontSize: n.style?.fontSize || null, fontWeight: n.style?.fontWeight || null, fontFamily: n.style?.fontFamily || null,
        align: n.style?.textAlignHorizontal || 'LEFT', color: fill ? fill.color : null, lines: text.split('\n').length,
      });
      return;
    }
    const big = box.width * box.height > fb.width * fb.height * 0.6;
    const fill = solid(n.fills);
    // Ảnh / icon (không chứa chữ): so như 1 khối hình, không đi vào trong
    if (!hasText(n) && (hasImage(n.fills) || ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'LINE'].includes(n.type)
      || (['INSTANCE', 'COMPONENT', 'GROUP', 'FRAME'].includes(n.type) && Math.max(box.width, box.height) <= 64 && (n.children || []).length))) {
      if (!big) shapes.push({ ...base, kind: hasImage(n.fills) ? 'image' : 'icon' });
      return;
    }
    // Khối có nền màu (nút, thẻ, ô nhập): so màu nền + kích thước, rồi đi tiếp vào trong
    if (fill && !big && n.type !== 'GROUP') {
      shapes.push({ ...base, kind: 'block', color: fill.color, radius: n.cornerRadius || 0 });
    }
    if (hasImage(n.fills) && !big) shapes.push({ ...base, kind: 'image' });
    for (const c of n.children || []) walk(c, n === frame ? anchorOf(c) : anchor, clip);
  };
  for (const c of frame.children || []) walk(c, anchorOf(c), null);
  return { frame: { width: fb.width, height: fb.height, color: solid(frame.fills)?.color || null }, texts, shapes, ignored };
}

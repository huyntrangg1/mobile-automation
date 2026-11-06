// Frame Figma từ file .json do plugin "QA Pipeline – Export frame" xuất (figma-plugin/): đã có sẵn ảnh PNG + cây node,
// nên AI Smoke Test dùng được mà KHÔNG gọi Figma MCP (gói Starter của Figma giới hạn số lần gọi).
import fs from 'node:fs';
import path from 'node:path';
import { frameKind, collectReactions } from '../locators/figmaFrames.js';
import { pruneOccluded } from './occlusion.js';

const safe = (id) => String(id).replace(/[^A-Za-z0-9_-]+/g, '_');

// Chữ TEXT đang hiện trong frame (bỏ node ẩn)
export function figmaTexts(node, out = []) {
  if (!node || node.visible === false) return out;
  if (node.type === 'TEXT' && node.characters && String(node.characters).trim()) out.push(String(node.characters).trim());
  for (const c of node.children || []) figmaTexts(c, out);
  return out;
}

// data = kết quả readExport(text) (đã kiểm định dạng). Ghi ảnh từng frame vào dir; bỏ mũi tên chú thích và mảnh component nhỏ.
export function loadFigmaExport({ data, dir }) {
  fs.mkdirSync(dir, { recursive: true });
  const screens = data.frames.filter((f) => ['screen', 'state'].includes(frameKind(f)));
  // Tên trùng (vd hai frame cùng "Record detail - Elevated Range") → thêm node-id để AI và bộ so chọn đúng frame
  const count = new Map();
  for (const f of screens) count.set(f.name, (count.get(f.name) || 0) + 1);
  const label = (f) => (count.get(f.name) > 1 ? `${f.name} [${f.id}]` : f.name);
  const names = new Map(screens.map((f) => [f.id, label(f)]));
  const frames = screens.map((f) => {
    // Bỏ layer ẩn / ngoài khung / bị che kín (vd màn nền dưới modal): chữ của chúng không ai nhìn thấy nên không được coi là "phải có"
    const { node, removed } = pruneOccluded(f.node);
    const png = path.join(dir, `figma-${safe(f.id)}.png`);
    fs.writeFileSync(png, Buffer.from(f.png, 'base64'));
    // node + scale: bộ so bằng code (analyzeCapture) đọc vị trí, kích thước, màu, cỡ chữ từ đây
    const json = path.join(dir, `figma-${safe(f.id)}.json`);
    fs.writeFileSync(json, JSON.stringify({ id: f.id, name: label(f), scale: f.scale || 1, node }));
    return {
      id: f.id, name: label(f), kind: frameKind(f), png, json, scale: f.scale || 1, hidden: removed.hidden + removed.clipped + removed.occluded, texts: figmaTexts(node),
      reactions: collectReactions(node).filter((r) => names.has(r.destinationId)).map((r) => ({ text: r.text || r.nodeName, toId: r.destinationId, to: names.get(r.destinationId) })),
    };
  });
  return { file: data.file || '', page: data.page || '', frames };
}

// Tóm tắt cho prompt rút luồng: mỗi frame một dòng (id, tên, loại, chữ riêng, chuyển cảnh prototype).
// - Chữ có ở quá nửa số màn (thanh trạng thái, tab…, cần ≥ 4 màn) nêu MỘT lần ở dòng đầu, không nhắc lại.
// - Mỗi frame lấy tối đa maxTexts chữ, ưu tiên chữ HIẾM (ít màn khác có) để chữ riêng của màn không bị dải chữ lặp chiếm chỗ; giữ thứ tự gốc.
// - Chữ quá dài bị cắt (đoạn disclaimer, điều khoản…).
const uniq = (a) => [...new Set(a)];
const clip = (t, n) => (t.length > n ? `${t.slice(0, n)}…` : t);
export function summarizeFrames(frames, { maxTexts = 14, maxLen = 50 } = {}) {
  const freq = new Map();
  for (const f of frames) for (const t of uniq(f.texts)) freq.set(t, (freq.get(t) || 0) + 1);
  const common = new Set(frames.length >= 4 ? [...freq].filter(([, c]) => c > frames.length / 2).map(([t]) => t) : []);
  const lines = frames.map((f) => {
    const own = uniq(f.texts).filter((t) => !common.has(t)).map((t, i) => ({ t, i, c: freq.get(t) }));
    const picked = [...own].sort((a, b) => a.c - b.c || a.i - b.i).slice(0, maxTexts).sort((a, b) => a.i - b.i);
    const texts = picked.map((x) => clip(x.t, maxLen)).join(' | ');
    const rx = f.reactions.length ? ` · chuyển cảnh: ${f.reactions.map((r) => `${r.text} → ${r.to}`).join('; ')}` : '';
    return `- [${f.id}] ${f.name} (${f.kind})${texts ? `: ${texts}` : ''}${rx}`;
  });
  if (!common.size) return lines.join('\n');
  const shown = [...common].slice(0, 12).map((t) => clip(t, 30)).join(' | ');
  return [`(Chữ chung của hầu hết các màn, không nhắc lại ở từng dòng: ${shown})`, ...lines].join('\n');
}

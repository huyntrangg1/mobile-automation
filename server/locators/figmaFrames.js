// Frame Figma xuất bằng plugin (figma-plugin/) → lưu theo app, dùng cho AI Smoke Test. Không cần token / API.
//   File plugin: { tool: 'qa-pipeline-figma-export', frames: [{ id, name, scale, width, height, node, png (base64) }] }
//   Lưu: <dir>/<appId>/<id>.json (node + thông tin) và <id>.png; danh sách ở app.figmaFrames
//   Mỗi frame kèm tóm tắt: kind (screen / state), variant, reactions (chuyển cảnh prototype), hash (đổi nội dung → hash đổi)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const safe = (id) => String(id).replace(/[^A-Za-z0-9_-]+/g, '_');
// Tên so khớp màn ↔ frame: bỏ dấu, hoa / thường, ký tự lạ ("Sign Up / 01" ~ "sign up 01")
export const nameKey = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Chữ đầu tiên trong node (nhãn nút "Get started") → gợi ý bước tap theo chữ
function firstText(n) {
  if (!n) return '';
  if (n.type === 'TEXT' && n.characters) return String(n.characters).trim();
  for (const c of n.children || []) { const t = firstText(c); if (t) return t; }
  return '';
}

// Cây node → các chuyển cảnh prototype: { nodeId, nodeName, text, trigger, destinationId, transition }
export function collectReactions(node) {
  const out = [];
  const walk = (n) => {
    if (!n || n.visible === false) return;
    for (const r of n.reactions || []) {
      if (!r.destinationId || r.navigation === 'BACK') continue;
      out.push({ nodeId: n.id, nodeName: n.name, text: firstText(n), trigger: r.trigger || null, destinationId: r.destinationId, transition: r.transition || null });
    }
    for (const c of n.children || []) walk(c);
  };
  walk(node);
  return out;
}

// Trạng thái: tên frame có "/" ("Home / Empty") hoặc frame là variant của component; còn lại là màn
// Đếm loại node trong cây (chỉ node đang hiện)
function nodeTypes(n, acc = {}) {
  if (!n || n.visible === false) return acc;
  acc[n.type] = (acc[n.type] || 0) + 1;
  for (const c of n.children || []) nodeTypes(c, acc);
  return acc;
}
// Frame KHÔNG phải màn app:
//   arrow = mũi tên chú thích luồng ("Snake · Tap Scan now": chấm tròn + đường vector + 1 nhãn "Tap …", không có nút / ảnh / chữ nội dung)
//   part  = mảnh component nhỏ (vd "Text button" 76×20)
export function nonScreenKind(f) {
  const t = nodeTypes(f.node);
  const texts = t.TEXT || 0;
  if (/^[^\p{L}\p{N}]*(flows?\s*\/\s*)?snake\b/iu.test(f.name || '')) return 'arrow';
  if (t.ELLIPSE && (t.VECTOR || 0) >= 3 && texts <= 1 && !t.RECTANGLE && !t.IMAGE) return 'arrow';
  const w = Number(f.width ?? f.node?.absoluteBoundingBox?.width) || 0;
  const h = Number(f.height ?? f.node?.absoluteBoundingBox?.height) || 0;
  if (w && h && w < 150 && h < 60) return 'part';
  return null;
}
// Trạng thái: tên frame có "/" ("Home / Empty") hoặc frame là variant của component; còn lại là màn
export const frameKind = (f) => nonScreenKind(f) || (/\s\/\s|\//.test(f.name) || (f.node?.variant && Object.keys(f.node.variant).length) ? 'state' : 'screen');

// Frame đã nhập từ trước phân loại bằng luật cũ → đọc lại node, đổi kind nếu khác (không đụng frame không đọc được)
export function reclassifyFrames({ store, appId }) {
  const app = store.get('apps', appId);
  if (!app?.figmaFrames?.length || app.figmaFrames.every((f) => f.kindV === 2)) return false;
  const frames = app.figmaFrames.map((f) => {
    try {
      const d = JSON.parse(fs.readFileSync(f.json, 'utf8'));
      return { ...f, kind: frameKind({ name: f.name, width: f.width, height: f.height, node: d.node }), kindV: 2 };
    } catch { return f; }
  });
  store.patch('apps', appId, { figmaFrames: frames });
  return true;
}

export function readExport(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw Object.assign(new Error('File không phải JSON — dùng file do plugin "QA Pipeline – Export frame" xuất'), { status: 400 }); }
  if (data?.tool !== 'qa-pipeline-figma-export' || !Array.isArray(data.frames)) {
    throw Object.assign(new Error('File không phải file xuất từ plugin "QA Pipeline – Export frame"'), { status: 400 });
  }
  if (!data.frames.length) throw Object.assign(new Error('File không có frame nào'), { status: 400 });
  for (const f of data.frames) {
    if (!f.id || !f.node?.absoluteBoundingBox || !f.png) throw Object.assign(new Error(`Frame "${f.name || f.id}" thiếu dữ liệu — xuất lại bằng plugin`), { status: 400 });
  }
  return data;
}

// → { frames (cả danh sách của app), added, changed: [tên frame nhập lại có nội dung khác] }
export function importFigmaExport({ store, appId, text, dir }) {
  const app = store.get('apps', appId);
  if (!app) throw Object.assign(new Error('Không có app này'), { status: 404 });
  const data = readExport(text);
  const out = path.join(dir, appId);
  fs.mkdirSync(out, { recursive: true });
  const now = new Date().toISOString();
  const byId = new Map((app.figmaFrames || []).map((f) => [f.id, f]));
  const added = [];
  const changed = [];
  for (const f of data.frames) {
    const base = path.join(out, safe(f.id));
    fs.writeFileSync(`${base}.png`, Buffer.from(f.png, 'base64'));
    fs.writeFileSync(`${base}.json`, JSON.stringify({ id: f.id, name: f.name, scale: f.scale || 1, node: f.node }));
    const hash = crypto.createHash('sha1').update(JSON.stringify(f.node)).update(f.png).digest('hex').slice(0, 12);
    const old = byId.get(f.id);
    const entry = {
      id: f.id, name: f.name, width: f.width, height: f.height, scale: f.scale || 1, file: data.file || '', page: data.page || '', json: `${base}.json`, png: `${base}.png`,
      exportedAt: data.exportedAt || now, importedAt: now, hash, kind: frameKind(f), kindV: 2, variant: f.node.variant || null, reactions: collectReactions(f.node),
    };
    if (old && old.hash && old.hash !== hash) changed.push(f.name);
    byId.set(f.id, entry);
    added.push(entry);
  }
  const frames = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  store.patch('apps', appId, { figmaFrames: frames });
  return { frames, added: added.map((f) => f.name), changed };
}

// Xoá 1 frame đã nhập (frame không còn trong app)
export function removeFigmaFrame({ store, appId, frameId }) {
  const app = store.get('apps', appId);
  const f = (app?.figmaFrames || []).find((x) => x.id === frameId);
  if (!f) throw Object.assign(new Error('Không có frame này'), { status: 404 });
  for (const p of [f.json, f.png]) fs.rmSync(p, { force: true });
  store.patch('apps', appId, { figmaFrames: app.figmaFrames.filter((x) => x.id !== frameId) });
}

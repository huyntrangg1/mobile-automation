// Bản đồ locator của app: mỗi màn = ảnh + page source + phần tử. Hai chế độ lấy locator đều đổ vào đây.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseElements, screenSignature, screenSimilarity, windowOf } from './pageSource.js';

const elKey = (e) => `${e.type}|${e.name}|${e.label}`;

// Tên màn đoán từ chữ tĩnh trên cùng (tiêu đề), bỏ chữ của nút điều hướng
function guessName(els) {
  const t = els.filter((e) => e.type === 'StaticText' && e.name && !/^(Back|Close)$/i.test(e.name) && e.name.length <= 40)
    .sort((a, b) => a.rect.y - b.rect.y)[0];
  return t?.name || 'Màn chưa đặt tên';
}

export function createScreenMap({ store, dataDir }) {
  const shotDir = (appId) => path.join(dataDir, 'screens', appId);
  const screenshotPath = (s) => path.join(shotDir(s.appId), `${s.id}.png`);
  const uniqueName = (appId, name, exceptId) => {
    const taken = new Set(store.list('screens').filter((s) => s.appId === appId && s.id !== exceptId).map((s) => s.name));
    let n = name;
    for (let i = 2; taken.has(n); i++) n = `${name} ${i}`;
    return n;
  };

  function addSnapshot(appId, { xml, png, nameHint, seenBy = 'record' }) {
    const elements = parseElements(xml);
    const now = new Date().toISOString();
    // Màn khớp nhất (không phải màn khớp đầu tiên)
    let existing = null;
    let best = 0.8;
    for (const s of store.list('screens').filter((x) => x.appId === appId)) {
      const score = screenSimilarity(s.elements, elements);
      if (score >= best) { best = score; existing = s; }
    }
    if (existing) {
      const have = new Set(existing.elements.map(elKey));
      const added = elements.filter((e) => !have.has(elKey(e)));
      const screen = store.patch('screens', existing.id, { elements: [...existing.elements, ...added], updatedAt: now });
      return { screen, isNew: false, added: added.length };
    }
    const id = crypto.randomUUID().slice(0, 8);
    const screen = {
      id, appId, name: uniqueName(appId, nameHint || guessName(elements)), signature: screenSignature(elements),
      elements, win: windowOf(xml), screenshot: `/files/data/screens/${appId}/${id}.png`, source: xml, seenBy, createdAt: now, updatedAt: now,
    };
    fs.mkdirSync(shotDir(appId), { recursive: true });
    if (png) fs.writeFileSync(screenshotPath(screen), png);
    store.put('screens', screen);
    return { screen, isNew: true, added: elements.length };
  }

  function renameScreen(id, name) {
    const s = store.get('screens', id);
    if (!s) throw Object.assign(new Error('Không có màn này'), { status: 404 });
    const next = uniqueName(s.appId, name.trim(), id);
    // Tên cũ giữ làm alias trong locators/map.js để script đã gen không vỡ
    const aliases = [...new Set([...(s.aliases || []), s.name])].filter((n) => n !== next);
    return store.patch('screens', id, { name: next, aliases });
  }

  function mergeScreens(keepId, dropId) {
    const keep = store.get('screens', keepId);
    const drop = store.get('screens', dropId);
    if (!keep || !drop) throw Object.assign(new Error('Không có màn này'), { status: 404 });
    const have = new Set(keep.elements.map(elKey));
    store.patch('screens', keepId, { elements: [...keep.elements, ...drop.elements.filter((e) => !have.has(elKey(e)))], updatedAt: new Date().toISOString() });
    deleteScreen(dropId);
    return store.get('screens', keepId);
  }

  function deleteScreen(id) {
    const s = store.get('screens', id);
    if (!s) return;
    fs.rmSync(screenshotPath(s), { force: true });
    store.remove('screens', id);
  }

  function setElementKey(screenId, idx, key) {
    const s = store.get('screens', screenId);
    if (!s?.elements[idx]) throw Object.assign(new Error('Không có phần tử này'), { status: 404 });
    const old = s.elements[idx].key;
    const oldKeys = [...new Set([...(s.elements[idx].oldKeys || []), ...(old ? [old] : [])])].filter((k) => k !== key?.trim());
    s.elements[idx] = { ...s.elements[idx], key: key?.trim() || undefined, oldKeys };
    return store.patch('screens', screenId, { elements: s.elements });
  }

  // Bảng target → locator theo màn (key tester đặt thắng key tự sinh, vd ô nhập "Email" trùng chữ nhãn "Email")
  function locatorTable(appId) {
    const out = {};
    for (const s of store.list('screens').filter((x) => x.appId === appId)) {
      const m = new Map();
      for (const e of s.elements) if (e.key) m.set(e.key, { key: e.key, type: e.type, locator: e.locator });
      for (const e of s.elements) {
        const k = e.name || e.label;
        if (!e.key && k && !m.has(k)) m.set(k, { key: k, type: e.type, locator: e.locator });
      }
      // key cũ (đã đổi) vẫn trỏ tới phần tử, nếu chưa bị key khác chiếm
      for (const e of s.elements) for (const k of e.oldKeys || []) if (!m.has(k)) m.set(k, { key: k, type: e.type, locator: e.locator, alias: true });
      out[s.name] = [...m.values()];
    }
    return out;
  }

  // locators/map.js trong workspace: L[màn][tên target] = locator
  function exportLocators(appId) {
    const app = store.get('apps', appId);
    const L = Object.fromEntries(Object.entries(locatorTable(appId)).map(([n, rows]) => [n, Object.fromEntries(rows.map((r) => [r.key, r.locator]))]));
    for (const s of store.list('screens').filter((x) => x.appId === appId)) {
      for (const a of s.aliases || []) if (!L[a]) L[a] = L[s.name];
    }
    const file = path.join(app.workspace, 'locators/map.js');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `// Sinh tự động từ Locator map của tool — không sửa tay.\nexport const L = ${JSON.stringify(L, null, 2)};\n`);
    return file;
  }

  return { addSnapshot, renameScreen, mergeScreens, deleteScreen, setElementKey, exportLocators, locatorTable, screenshotPath, dataDir };
}

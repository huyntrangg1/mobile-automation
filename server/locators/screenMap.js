// Bản đồ locator của app: mỗi màn = ảnh + page source + phần tử. Hai chế độ lấy locator đều đổ vào đây.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseElements, screenSignature, screenSimilarity, sameTitled, partOf, isTransient, windowOf } from './pageSource.js';
import { checkLocator } from './locatorFormat.js';

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

  // Màn của app theo thứ tự hiển thị (thứ tự tester bấm qua khi ghi). Màn cũ chưa có order: theo thứ tự tạo
  const list = (appId) => store.list('screens').map((s, i) => ({ s, k: s.order ?? i })).filter((x) => x.s.appId === appId)
    .sort((a, b) => a.k - b.k).map((x) => x.s);
  const renumber = (ordered) => ordered.forEach((s, i) => { if (s.order !== i) store.patch('screens', s.id, { order: i }); });
  // Tester bấm từ màn prevId sang màn id → id phải đứng sau prevId. Màn mới: đặt ngay sau prevId.
  //   Màn đã có: chỉ dời khi đang đứng trước prevId (sai thứ tự) — lần ghi bỏ qua vài màn không làm xáo các màn đó
  function placeAfter(id, prevId, { force = false } = {}) {
    const s = store.get('screens', id);
    if (!s || !prevId || id === prevId) return;
    const all = list(s.appId);
    if (!force && all.findIndex((x) => x.id === id) > all.findIndex((x) => x.id === prevId)) return;
    const rest = all.filter((x) => x.id !== id);
    const at = rest.findIndex((x) => x.id === prevId);
    if (at < 0) return;
    rest.splice(at + 1, 0, s);
    renumber(rest);
  }
  const sameAs = (a, b) => screenSimilarity(a, b) >= 0.8 || sameTitled(a, b) || partOf(a, b);

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
    // Không giống ≥ 80% nhưng cùng tiêu đề + gần như cùng nút → cùng màn (bước tutorial, màn bớt / thêm nút);
    //   hoặc 1 màn là bản đang tải dở của màn kia
    if (!existing) existing = list(appId).find((s) => sameTitled(s.elements, elements) || partOf(s.elements, elements)) || null;
    if (existing) {
      // Phần tử tester đã xoá tay không quay lại
      const have = new Set([...existing.elements.map(elKey), ...(existing.removed || [])]);
      const added = elements.filter((e) => !have.has(elKey(e)));
      const screen = store.patch('screens', existing.id, { elements: [...existing.elements, ...added], updatedAt: now });
      return { screen, isNew: false, added: added.length };
    }
    const id = crypto.randomUUID().slice(0, 8);
    const screen = {
      id, appId, name: uniqueName(appId, nameHint || guessName(elements)), signature: screenSignature(elements),
      elements, win: windowOf(xml), screenshot: `/files/data/screens/${appId}/${id}.png`, source: xml, seenBy, createdAt: now, updatedAt: now,
      order: list(appId).reduce((m, x, i) => Math.max(m, (x.order ?? i) + 1), 0),
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
    // Phần tử màn giữ lại đã xoá tay không mang sang; danh sách đã xoá của 2 màn gộp lại (lấy locator sau không thêm lại)
    const removed = [...new Set([...(keep.removed || []), ...(drop.removed || [])])];
    const have = new Set([...keep.elements.map(elKey), ...(keep.removed || [])]);
    // Tên màn bị gộp giữ làm alias: script / test case đang dùng tên cũ vẫn chạy
    const aliases = [...new Set([...(keep.aliases || []), drop.name, ...(drop.aliases || [])])].filter((n) => n !== keep.name);
    store.patch('screens', keepId, {
      elements: [...keep.elements, ...drop.elements.filter((e) => !have.has(elKey(e)))], removed, aliases,
      ...(!keep.figma && drop.figma ? { figma: drop.figma } : {}), updatedAt: new Date().toISOString(),
    });
    // Đường đi trỏ tới màn bị gộp → trỏ sang màn giữ lại
    for (const e of store.list('edges')) {
      if (e.from === dropId || e.to === dropId) {
        const n = { ...e, from: e.from === dropId ? keepId : e.from, to: e.to === dropId ? keepId : e.to };
        if (n.from === n.to) store.remove('edges', e.id); else store.put('edges', n);
      }
    }
    deleteScreen(dropId);
    return store.get('screens', keepId);
  }

  // Dọn map: gộp màn trùng (giữ màn đứng trước), xoá khung hình hiệu ứng ("y" của chữ T-a-s-t-o-r-y hiện dần),
  //   rồi xếp lại theo lần ghi gần nhất (thứ tự tester bấm). → { merged: [{keep, drop}], removed: [tên], ordered: bool }
  function tidy(appId, visits = []) {
    const merged = [];
    const removed = [];
    const into = new Map(); // id màn đã gộp → id màn giữ lại
    for (const s of list(appId)) {
      if (isTransient(s.elements) && !s.figma && !s.elements.some((e) => e.manual || e.key)) {
        deleteScreen(s.id);
        removed.push(s.name);
      }
    }
    for (let i = 0; ; i++) {
      const all = list(appId);
      if (i >= all.length) break;
      const keep = all[i];
      for (const drop of all.slice(i + 1)) {
        if (!sameAs(store.get('screens', keep.id).elements, drop.elements)) continue;
        mergeScreens(keep.id, drop.id);
        into.set(drop.id, keep.id);
        merged.push({ keep: keep.name, drop: drop.name });
      }
    }
    // visits: các lần lấy locator, mỗi lần = danh sách màn theo thứ tự đi tới ({ seen, mode } hoặc mảng id).
    //   Danh sách này chỉ có thứ tự gặp lần đầu (không có Back) → lấy lần đi qua nhiều màn nhất làm khung (hoà: ghi tay hơn AI),
    //   màn chỉ có ở lần khác chèn ngay sau màn đứng trước nó ở lần đó; màn không lần nào đi qua giữ thứ tự cũ, ở cuối
    const final = (id) => { while (into.has(id)) id = into.get(id); return id; };
    const runs = (visits.length && !Array.isArray(visits[0]) && typeof visits[0] !== 'object' ? [visits] : visits)
      .map((v) => (Array.isArray(v) ? { seen: v } : v))
      .map((v) => ({ mode: v.mode, seen: [...new Set((v.seen || []).map(final))].filter((id) => store.get('screens', id)) }))
      .filter((v) => v.seen.length);
    const ordered = runs.length > 0;
    if (ordered) {
      const main = [...runs].sort((a, b) => b.seen.length - a.seen.length || (b.mode === 'record') - (a.mode === 'record'))[0];
      const seq = [...main.seen];
      for (const run of runs) {
        run.seen.forEach((id, k) => {
          if (seq.includes(id)) return;
          const at = k > 0 ? seq.indexOf(run.seen[k - 1]) : -1;
          if (at >= 0) seq.splice(at + 1, 0, id); else seq.push(id);
        });
      }
      const rest = list(appId).filter((x) => !seq.includes(x.id));
      renumber([...seq.map((id) => store.get('screens', id)), ...rest]);
    } else renumber(list(appId));
    return { merged, removed, ordered };
  }

  // Đường đi giữa các màn: bấm / nhập `locator` ở màn from thì sang màn to. Ghi lúc AI khám phá / đi tới màn → dùng lại để điều hướng
  const edges = (appId) => store.list('edges').filter((e) => e.appId === appId);
  function addEdge(appId, from, to, { action, locator, text }) {
    if (!from || !to || from === to || !locator) return null;
    const dup = edges(appId).find((e) => e.from === from && e.to === to && e.locator === locator);
    if (dup) return dup;
    const e = { id: crypto.randomUUID().slice(0, 8), appId, from, to, action, locator, ...(text ? { text } : {}) };
    store.put('edges', e);
    return e;
  }

  function deleteScreen(id) {
    const s = store.get('screens', id);
    if (!s) return;
    for (const e of store.list('edges')) if (e.from === id || e.to === id) store.remove('edges', e.id);
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

  const elementAt = (screenId, idx) => {
    const s = store.get('screens', screenId);
    if (!s?.elements[idx]) throw Object.assign(new Error('Không có phần tử này'), { status: 404 });
    return s;
  };
  // Sửa tay: locator / loại (manual = tester sửa, lấy locator lại không ghi đè vì chỉ thêm phần tử mới)
  function updateElement(screenId, idx, { locator, type } = {}) {
    const s = elementAt(screenId, idx);
    const before = s.elements[idx];
    const e = { ...before, manual: true };
    if (locator !== undefined) e.locator = checkLocator(locator);
    if (type) e.type = type;
    s.elements[idx] = e;
    // Đổi loại → khoá (type|name|label) đổi: nhớ khoá cũ như đã xoá, lấy locator sau không thêm lại bản gốc thành phần tử trùng
    const removed = elKey(before) !== elKey(e) ? [...new Set([...(s.removed || []), elKey(before)])] : s.removed;
    return store.patch('screens', screenId, { elements: s.elements, ...(removed ? { removed } : {}), updatedAt: new Date().toISOString() });
  }
  // Thêm tay: cần Target (key) + locator; point:x,y cho phần tử không có tên (chỉ dùng để Tap)
  function addElement(screenId, { type = 'Other', key, locator, rect = null } = {}) {
    const s = store.get('screens', screenId);
    if (!s) throw Object.assign(new Error('Không có màn này'), { status: 404 });
    if (!String(key ?? '').trim()) throw Object.assign(new Error('Cần tên Target'), { status: 400 });
    const loc = checkLocator(locator);
    const e = { type, name: key.trim(), label: '', value: '', rect, visible: true, enabled: true, locator: loc, alts: [loc], key: key.trim(), manual: true };
    return store.patch('screens', screenId, { elements: [...s.elements, e], updatedAt: new Date().toISOString() });
  }
  // Xoá tay: nhớ phần tử đã xoá để lần lấy locator sau không thêm lại
  function removeElement(screenId, idx) {
    const s = elementAt(screenId, idx);
    const [gone] = s.elements.splice(idx, 1);
    return store.patch('screens', screenId, { elements: s.elements, removed: [...new Set([...(s.removed || []), elKey(gone)])], updatedAt: new Date().toISOString() });
  }

  // Đọc lại page source đã lưu của các màn (vd sau khi bộ đọc giữ thêm loại phần tử) → thêm phần tử còn thiếu.
  // Không thêm lại phần tử tester đã xoá, không đụng phần tử đã có (kể cả sửa tay). Trả số phần tử đã thêm
  function refreshElements(appId) {
    let added = 0;
    for (const sc of store.list('screens').filter((x) => !appId || x.appId === appId)) {
      if (!sc.source) continue;
      const have = new Set([...sc.elements.map(elKey), ...(sc.removed || [])]);
      const extra = parseElements(sc.source).filter((e) => !have.has(elKey(e)));
      if (!extra.length) continue;
      store.patch('screens', sc.id, { elements: [...sc.elements, ...extra] });
      added += extra.length;
    }
    return added;
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

  return { list, edges, addEdge, placeAfter, tidy, addSnapshot, renameScreen, mergeScreens, deleteScreen, setElementKey, updateElement, addElement, removeElement, refreshElements, exportLocators, locatorTable, screenshotPath, dataDir };
}

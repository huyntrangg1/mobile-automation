// QA Pipeline – Export frame: các frame đang chọn → 1 file JSON (cây node cùng dạng REST API của Figma + ảnh PNG)
// để tool so UI với Figma không cần token / API. Không gửi gì ra mạng: file tải về máy qua cửa sổ plugin (ui.html).
//
// Dạng file: { tool: 'qa-pipeline-figma-export', version: 3, file, page, exportedAt, frames: [{ id, name, scale, width, height, node, png (base64) }] }
//   version 2: reactions / variant / strokes / effects
//   version 3 (ngang bộ figma-reader-kit): auto layout (gap, padding, căn trục, co giãn), line-height / letter-spacing, chữ nhiều style
//   (styleSegments), gradient (điểm màu), bóng đủ (spread), layer ẩn do cha ẩn (hiddenByAncestor), biến / style / component / overrides
//   và bảng refs ở gốc mỗi frame (tên biến + collection + giá trị từng mode, tên style, tên component).
// Quy ước: trường mới CHỈ được ghi khi nguồn có dữ liệu, nên file cũ và phần tool đang đọc không đổi.
const FORMAT_VERSION = 3;

// Plugin API → tên của REST API (tool đọc theo REST)
const H = { MIN: 'LEFT', MAX: 'RIGHT', CENTER: 'CENTER', STRETCH: 'LEFT_RIGHT', SCALE: 'SCALE' };
const V = { MIN: 'TOP', MAX: 'BOTTOM', CENTER: 'CENTER', STRETCH: 'TOP_BOTTOM', SCALE: 'SCALE' };
const isMixed = (v) => typeof figma !== 'undefined' && v === figma.mixed;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round4 = (v) => Math.round(v * 10000) / 10000;
// Đọc thuộc tính có thể ném lỗi / mixed / null → undefined
const safe = (fn) => { try { const v = fn(); return v === null || isMixed(v) ? undefined : v; } catch (e) { return undefined; } };

// Bối cảnh một lần xuất 1 frame: gom id biến / style / component để tra tên ở cuối (bất đồng bộ)
const newCtx = () => ({ variables: new Set(), styles: new Set(), components: new Map(), main: new Map() });

const aliasId = (a) => (a && typeof a.id === 'string' ? a.id : null);

// boundVariables: { field: alias | [alias] } → { field: id | [id] }
function boundVars(bv, ctx) {
  if (!bv || typeof bv !== 'object') return null;
  const out = {};
  for (const k of Object.keys(bv)) {
    const v = bv[k];
    const ids = (Array.isArray(v) ? v : [v]).map(aliasId).filter(Boolean);
    if (!ids.length) continue;
    if (ctx) ids.forEach((id) => ctx.variables.add(id));
    out[k] = Array.isArray(v) ? ids : ids[0];
  }
  return Object.keys(out).length ? out : null;
}

function paints(list, ctx) {
  if (!Array.isArray(list)) return [];
  return list.map((p) => {
    const out = { type: p.type, visible: p.visible !== false, opacity: p.opacity == null ? 1 : p.opacity };
    if (p.blendMode && p.blendMode !== 'NORMAL' && p.blendMode !== 'PASS_THROUGH') out.blendMode = p.blendMode;
    if (p.type === 'SOLID') out.color = { r: p.color.r, g: p.color.g, b: p.color.b, a: 1 };
    else if (typeof p.type === 'string' && p.type.indexOf('GRADIENT_') === 0) {
      out.gradientStops = (p.gradientStops || []).map((s) => ({ position: s.position, color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a == null ? 1 : s.color.a } }));
      if (Array.isArray(p.gradientTransform)) out.gradientTransform = p.gradientTransform.map((row) => Array.prototype.slice.call(row));
    } else if (p.type === 'IMAGE') {
      if (p.imageHash) out.imageHash = p.imageHash;
      if (p.scaleMode) out.scaleMode = p.scaleMode;
    }
    const bv = boundVars(p.boundVariables, ctx);
    if (bv) out.boundVariables = bv;
    return out;
  });
}

// line-height của Plugin API ({ unit, value }) → tên REST (lineHeightPx / lineHeightPercentFontSize / lineHeightUnit)
function lineHeightFields(lh, fontSize) {
  if (!lh || typeof lh !== 'object') return {};
  if (lh.unit === 'PIXELS' && isNum(lh.value)) return { lineHeightPx: lh.value, lineHeightUnit: 'PIXELS' };
  if (lh.unit === 'PERCENT' && isNum(lh.value)) {
    const out = { lineHeightPercentFontSize: lh.value, lineHeightUnit: 'FONT_SIZE_%' };
    if (isNum(fontSize)) out.lineHeightPx = round4((fontSize * lh.value) / 100);
    return out;
  }
  if (lh.unit === 'AUTO') return { lineHeightUnit: 'INTRINSIC_%' };
  return {};
}
// letter-spacing ({ unit, value }) → px
function letterSpacingPx(ls, fontSize) {
  if (!ls || typeof ls !== 'object' || !isNum(ls.value)) return undefined;
  if (ls.unit === 'PIXELS') return ls.value;
  if (ls.unit === 'PERCENT' && isNum(fontSize)) return round4((fontSize * ls.value) / 100);
  return undefined;
}

// Chữ nhiều kiểu (mixed): style gốc lấy theo ký tự đầu (như bản cũ) + styleSegments liệt kê từng đoạn
function textProps(n, ctx) {
  const first = (key, getter) => {
    const v = n[key];
    if (!isMixed(v)) return v;
    try { return n[getter](0, 1); } catch (e) { return null; }
  };
  const font = first('fontName', 'getRangeFontName');
  const fills = first('fills', 'getRangeFills');
  const weight = first('fontWeight', 'getRangeFontWeight');
  const fontSize = first('fontSize', 'getRangeFontSize');
  const style = {
    fontSize,
    fontFamily: font ? font.family : null,
    fontStyle: font ? font.style : null,
    fontWeight: weight == null ? null : weight,
    textAlignHorizontal: n.textAlignHorizontal,
    textCase: first('textCase', 'getRangeTextCase') || 'ORIGINAL',
  };
  Object.assign(style, lineHeightFields(safe(() => first('lineHeight', 'getRangeLineHeight')), fontSize));
  const ls = letterSpacingPx(safe(() => first('letterSpacing', 'getRangeLetterSpacing')), fontSize);
  if (ls !== undefined) style.letterSpacing = ls;
  const deco = safe(() => first('textDecoration', 'getRangeTextDecoration'));
  if (deco) style.textDecoration = deco;
  for (const k of ['paragraphSpacing', 'paragraphIndent', 'maxLines']) { const v = safe(() => n[k]); if (isNum(v)) style[k] = v; }
  for (const k of ['textAlignVertical', 'textAutoResize', 'textTruncation']) { const v = safe(() => n[k]); if (v) style[k] = v; }
  const out = { characters: n.characters, fills: paints(fills, ctx), style };
  const segs = textSegments(n, ctx);
  if (segs) out.styleSegments = segs;
  return out;
}

// Từng đoạn có style riêng (chỉ khi > 1 đoạn)
function textSegments(n, ctx) {
  if (typeof n.getStyledTextSegments !== 'function') return null;
  let segs;
  try {
    segs = n.getStyledTextSegments(['fontSize', 'fontName', 'fontWeight', 'fills', 'lineHeight', 'letterSpacing', 'textDecoration', 'textCase', 'fillStyleId', 'textStyleId']);
  } catch (e) { return null; }
  if (!Array.isArray(segs) || segs.length < 2) return null;
  return segs.map((s) => {
    const o = { start: s.start, end: s.end, characters: s.characters, fontSize: s.fontSize };
    if (s.fontName) { o.fontFamily = s.fontName.family; o.fontStyle = s.fontName.style; }
    if (s.fontWeight != null) o.fontWeight = s.fontWeight;
    o.fills = paints(Array.isArray(s.fills) ? s.fills : [], ctx);
    if (s.textCase) o.textCase = s.textCase;
    if (s.textDecoration) o.textDecoration = s.textDecoration;
    Object.assign(o, lineHeightFields(s.lineHeight, s.fontSize));
    const ls = letterSpacingPx(s.letterSpacing, s.fontSize);
    if (ls !== undefined) o.letterSpacing = ls;
    for (const k of ['fillStyleId', 'textStyleId']) if (typeof s[k] === 'string' && s[k]) { o[k] = s[k]; ctx.styles.add(s[k]); }
    return o;
  });
}

// Prototype: bấm / chạm → sang frame nào, kiểu chuyển, thời gian (ms), easing. API mới: reactions[].actions[], cũ: reactions[].action
const EASING = (e) => (e && e.type) || null;
function reactions(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list) {
    const acts = Array.isArray(r.actions) ? r.actions : r.action ? [r.action] : [];
    for (const a of acts) {
      if (!a || a.type !== 'NODE' || !a.destinationId) continue;
      const t = a.transition || null;
      out.push({
        trigger: (r.trigger && r.trigger.type) || null,
        destinationId: a.destinationId,
        navigation: a.navigation || 'NAVIGATE',
        transition: t ? { type: t.type, direction: t.direction || null, duration: Math.round((t.duration || 0) * 1000), easing: EASING(t.easing) } : null,
      });
    }
  }
  return out;
}

function effects(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((e) => e.visible !== false).map((e) => {
    const out = {
      type: e.type, radius: e.radius || 0, offset: e.offset ? { x: e.offset.x, y: e.offset.y } : null,
      color: e.color ? { r: e.color.r, g: e.color.g, b: e.color.b, a: e.color.a } : null,
    };
    if (isNum(e.spread)) out.spread = e.spread;
    if (e.blendMode) out.blendMode = e.blendMode;
    if (typeof e.showShadowBehindNode === 'boolean') out.showShadowBehindNode = e.showShadowBehindNode;
    return out;
  });
}

// Variant: frame là 1 variant của component set ("State=Error") hoặc instance đang dùng variant nào
function variants(n) {
  try {
    if (n.variantProperties) return Object.assign({}, n.variantProperties);
  } catch (e) { /* node không phải variant */ }
  try {
    if (n.componentProperties) {
      const out = {};
      for (const k of Object.keys(n.componentProperties)) {
        const p = n.componentProperties[k];
        if (p && p.type === 'VARIANT') out[k.split('#')[0]] = p.value;
      }
      return Object.keys(out).length ? out : null;
    }
  } catch (e) { /* bỏ qua */ }
  return null;
}

// Auto layout: gap, padding, căn trục, co giãn; trường chỉ có nghĩa khi là auto layout thì chỉ ghi khi layoutMode ≠ NONE
const LAYOUT_ONLY = ['layoutWrap', 'itemSpacing', 'counterAxisSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
  'primaryAxisAlignItems', 'counterAxisAlignItems', 'counterAxisAlignContent', 'primaryAxisSizingMode', 'counterAxisSizingMode'];
function layoutProps(n, out) {
  const auto = n.layoutMode && n.layoutMode !== 'NONE';
  if (auto) for (const k of LAYOUT_ONLY) { const v = safe(() => n[k]); if (v !== undefined) out[k] = v; }
  for (const k of ['layoutSizingHorizontal', 'layoutSizingVertical']) { const v = safe(() => n[k]); if (v) out[k] = v; }
  const grow = safe(() => n.layoutGrow);
  if (isNum(grow) && grow !== 0) out.layoutGrow = grow;
  const clip = safe(() => n.clipsContent);
  if (typeof clip === 'boolean') out.clipsContent = clip;
  for (const k of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight']) { const v = safe(() => n[k]); if (isNum(v)) out[k] = v; }
}

const STYLE_KEYS = ['fillStyleId', 'strokeStyleId', 'textStyleId', 'effectStyleId', 'gridStyleId'];

function serialize(n, ctx, hiddenAbove) {
  ctx = ctx || newCtx();
  const b = n.absoluteBoundingBox;
  const out = {
    id: n.id,
    name: n.name,
    type: n.type,
    visible: n.visible !== false,
    opacity: n.opacity == null ? 1 : n.opacity,
    absoluteBoundingBox: b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null,
  };
  if (hiddenAbove) out.hiddenByAncestor = true; // layer này tự hiện nhưng cha / tổ tiên bị ẩn → không thấy trên màn hình
  if (n.constraints) out.constraints = { horizontal: H[n.constraints.horizontal] || 'LEFT', vertical: V[n.constraints.vertical] || 'TOP' };
  if (n.layoutMode && n.layoutMode !== 'NONE') out.layoutMode = n.layoutMode;
  if (n.layoutAlign) out.layoutAlign = n.layoutAlign;
  if (n.layoutPositioning) out.layoutPositioning = n.layoutPositioning;
  layoutProps(n, out);
  if (typeof n.cornerRadius === 'number') out.cornerRadius = n.cornerRadius;
  else if (typeof n.topLeftRadius === 'number') out.cornerRadius = n.topLeftRadius;
  const radii = ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'].map((k) => n[k]);
  if (radii.every(isNum) && !radii.every((r) => r === radii[0])) out.rectangleCornerRadii = radii;
  const rx = reactions(n.reactions);
  if (rx.length) out.reactions = rx;
  const v = variants(n);
  if (v) out.variant = v;
  if (Array.isArray(n.strokes) && n.strokes.length) { out.strokes = paints(n.strokes, ctx); if (typeof n.strokeWeight === 'number') out.strokeWeight = n.strokeWeight; }
  const fx = effects(n.effects);
  if (fx.length) out.effects = fx;
  if (n.type === 'TEXT') Object.assign(out, textProps(n, ctx));
  else if ('fills' in n) out.fills = paints(isMixed(n.fills) ? [] : n.fills, ctx);
  // Biến / style / component
  const bv = boundVars(safe(() => n.boundVariables), ctx);
  if (bv) out.boundVariables = bv;
  for (const k of STYLE_KEYS) { const s = safe(() => n[k]); if (typeof s === 'string' && s) { out[k] = s; ctx.styles.add(s); } }
  if (n.type === 'INSTANCE') {
    const main = ctx.main.get(n.id) || safe(() => n.mainComponent);
    if (main && main.id) { out.componentId = main.id; ctx.components.set(main.id, main); }
    const ov = safe(() => n.overrides);
    if (Array.isArray(ov) && ov.length) out.overrides = ov.map((o) => ({ id: o.id, overriddenFields: Array.prototype.slice.call(o.overriddenFields || []) }));
    const cp = safe(() => n.componentProperties);
    if (cp && typeof cp === 'object') {
      const props = {};
      for (const k of Object.keys(cp)) if (cp[k]) props[k] = { type: cp[k].type, value: cp[k].value };
      if (Object.keys(props).length) out.componentProperties = props;
    }
  }
  if ('children' in n && n.children) {
    const hidden = hiddenAbove || n.visible === false;
    out.children = n.children.map((c) => serialize(c, ctx, hidden));
  }
  return out;
}

// Instance → component gốc (Plugin API mới chỉ cho lấy bất đồng bộ khi documentAccess = dynamic-page)
async function prefetchMain(root, ctx) {
  const instances = [];
  const walk = (n) => { if (n.type === 'INSTANCE') instances.push(n); for (const c of n.children || []) walk(c); };
  walk(root);
  for (let i = 0; i < instances.length; i += 20) {
    await Promise.all(instances.slice(i, i + 20).map(async (n) => {
      try {
        const m = typeof n.getMainComponentAsync === 'function' ? await n.getMainComponentAsync() : n.mainComponent;
        if (m) ctx.main.set(n.id, m);
      } catch (e) { /* component ngoài thư viện không truy cập được → bỏ */ }
    }));
  }
}

async function resolveVariable(id, cache) {
  try {
    const v = await figma.variables.getVariableByIdAsync(id);
    if (!v) return null;
    if (!cache.has(v.variableCollectionId)) cache.set(v.variableCollectionId, await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId));
    const coll = cache.get(v.variableCollectionId);
    const modeName = {};
    for (const m of (coll && coll.modes) || []) modeName[m.modeId] = m.name;
    const valuesByMode = {};
    for (const mid of Object.keys(v.valuesByMode || {})) valuesByMode[modeName[mid] || mid] = v.valuesByMode[mid];
    return { name: v.name, collection: coll ? coll.name : null, type: v.resolvedType, valuesByMode };
  } catch (e) { return null; }
}

// Bảng refs ở gốc frame: tên biến (+ collection + giá trị từng mode), tên style, tên component. Tra lỗi → null, không làm hỏng cả lần xuất.
async function buildRefs(ctx) {
  if (typeof figma === 'undefined') return null;
  const refs = {};
  if (ctx.variables.size && figma.variables) {
    refs.variables = {};
    const cache = new Map();
    for (const id of ctx.variables) refs.variables[id] = await resolveVariable(id, cache);
  }
  if (ctx.styles.size) {
    refs.styles = {};
    for (const id of ctx.styles) {
      try {
        const s = typeof figma.getStyleByIdAsync === 'function' ? await figma.getStyleByIdAsync(id) : figma.getStyleById(id);
        refs.styles[id] = s ? { name: s.name, type: s.type } : null;
      } catch (e) { refs.styles[id] = null; }
    }
  }
  if (ctx.components.size) {
    refs.components = {};
    for (const [id, c] of ctx.components) {
      const e = { name: c.name, key: c.key, description: c.description };
      if (c.parent && c.parent.type === 'COMPONENT_SET') e.componentSetName = c.parent.name;
      refs.components[id] = e;
    }
  }
  return Object.keys(refs).length ? refs : null;
}

const b64 = (bytes) => (typeof figma !== 'undefined' && figma.base64Encode ? figma.base64Encode(bytes) : Buffer.from(bytes).toString('base64'));

async function exportFrames(nodes, scale) {
  const frames = [];
  for (const n of nodes) {
    const bytes = await n.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
    const ctx = newCtx();
    await prefetchMain(n, ctx);
    const node = serialize(n, ctx);
    const refs = await buildRefs(ctx);
    if (refs) node.refs = refs;
    frames.push({ id: n.id, name: n.name, scale, width: n.width, height: n.height, node, png: b64(bytes) });
  }
  return frames;
}

const pickable = (n) => ['FRAME', 'COMPONENT', 'INSTANCE', 'SECTION'].includes(n.type);
// Section → các frame bên trong, kể cả trong Section con (chọn cả section 1 lần). Giữ đúng thứ tự trong file.
const expand = (sel) => sel.flatMap((n) => (n.type === 'SECTION' ? expand(n.children || []) : pickable(n) ? [n] : []));

// Tên file: chọn đúng 1 Section / frame → "<tên>-<node-id>.json" (node-id khớp link Figma ?node-id=5433-75649); nhiều node → "<tên file>-<số frame>-frame.json"
const ILLEGAL = /[\\/:*?"<>|]+/g;
function exportFileName(selection, fileName, count) {
  const one = selection.length === 1 ? selection[0] : null;
  const id = one ? String(one.id).replace(/:/g, '-') : '';
  const title = one && String(one.name).trim() ? String(one.name).trim() : fileName;
  const base = one ? `${title}-${id}` : `${fileName}-${count}-frame`;
  return `${base.replace(ILLEGAL, '-')}.json`;
}

// Chạy trong Node (test) dùng được hàm chuyển đổi; trong Figma không có `module` nên dòng này bị bỏ qua
if (typeof module !== 'undefined') module.exports = { serialize, exportFrames, expand, reactions, exportFileName, FORMAT_VERSION };

if (typeof figma !== 'undefined') {
  figma.showUI(__html__, { width: 320, height: 300 });
  const report = () => {
    const frames = expand(figma.currentPage.selection);
    figma.ui.postMessage({ type: 'selection', names: frames.map((f) => f.name) });
  };
  report();
  figma.on('selectionchange', report);
  figma.ui.onmessage = async (msg) => {
    if (msg.type !== 'export') return;
    const nodes = expand(figma.currentPage.selection);
    if (!nodes.length) { figma.ui.postMessage({ type: 'error', text: 'Chọn ít nhất 1 frame (màn) trước.' }); return; }
    try {
      figma.ui.postMessage({ type: 'busy', text: `Đang xuất ${nodes.length} frame…` });
      const frames = await exportFrames(nodes, msg.scale || 3);
      const data = { tool: 'qa-pipeline-figma-export', version: FORMAT_VERSION, file: figma.root.name, page: figma.currentPage.name, exportedAt: new Date().toISOString(), frames };
      figma.ui.postMessage({ type: 'done', name: exportFileName(figma.currentPage.selection, figma.root.name, frames.length), json: JSON.stringify(data) });
    } catch (e) {
      figma.ui.postMessage({ type: 'error', text: `Xuất lỗi: ${e.message || e}` });
    }
  };
}

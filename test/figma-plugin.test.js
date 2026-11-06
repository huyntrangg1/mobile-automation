// Plugin xuất frame (figma-plugin/code.js) → nhập vào tool (Locator map) → Run so với file đã nhập, không gọi API Figma
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createStore } from '../server/store.js';
import { importFigmaExport, removeFigmaFrame, nameKey } from '../server/locators/figmaFrames.js';
import { analyzeCapture } from '../server/ui/analyze.js';
import { flatten } from '../server/apps/template/src/design/figma.js';
import { layoutMap } from '../server/apps/template/src/design/compare.js';
import { blank, writePng } from '../server/apps/template/src/design/image.js';

// code.js là script của Figma (không phải module) → chạy trong vm, lấy hàm chuyển đổi
function loadPlugin(figma) {
  const module = { exports: {} };
  // figma (giả) tuỳ chọn: có thì plugin chạy phần khởi tạo giao diện với bản giả, hàm chuyển đổi vẫn được export
  vm.runInNewContext(fs.readFileSync(new URL('../figma-plugin/code.js', import.meta.url), 'utf8'), { module, Buffer, ...(figma ? { figma, __html__: '' } : {}) });
  // Object tạo trong vm thuộc realm khác → đưa qua JSON (giống file plugin lưu ra) trước khi so
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const { serialize, exportFrames, expand, exportFileName, FORMAT_VERSION } = module.exports;
  return { serialize: (n) => plain(serialize(n)), exportFrames: async (...a) => plain(await exportFrames(...a)), expand, exportFileName, FORMAT_VERSION };
}
// Plugin API giả đủ cho phần chạy khởi tạo + tra cứu variable / style (bất đồng bộ)
function fakeFigma(over = {}) {
  return { mixed: Symbol('mixed'), showUI() {}, ui: { postMessage() {}, onmessage: null }, on() {}, currentPage: { selection: [] }, base64Encode: (b) => Buffer.from(b).toString('base64'), ...over };
}

// Node giả theo dạng Plugin API (constraints MIN / MAX / STRETCH, fontName, exportAsync)
const pnode = (o) => ({ visible: true, opacity: 1, ...o });
function pluginFrame() {
  const text = pnode({ id: '2:1', name: 'Title', type: 'TEXT', characters: 'Welcome', absoluteBoundingBox: { x: 120, y: 260, width: 160, height: 20 },
    constraints: { horizontal: 'MIN', vertical: 'MIN' }, fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }],
    fontSize: 16, fontName: { family: 'Inter', style: 'Bold' }, fontWeight: 700, textAlignHorizontal: 'LEFT', textCase: 'UPPER' });
  const button = pnode({ id: '3:1', name: 'CTA', type: 'FRAME', absoluteBoundingBox: { x: 120, y: 530, width: 160, height: 44 }, layoutMode: 'HORIZONTAL',
    constraints: { horizontal: 'STRETCH', vertical: 'MAX' }, fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0.5, b: 1 } }], cornerRadius: 8, children: [],
    reactions: [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: '9:9', navigation: 'NAVIGATE', transition: { type: 'MOVE_IN', direction: 'LEFT', duration: 0.3, easing: { type: 'EASE_OUT' } } }] },
      { trigger: { type: 'ON_CLICK' }, action: { type: 'BACK' } }],
    strokes: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }], strokeWeight: 1,
    effects: [{ type: 'DROP_SHADOW', visible: true, radius: 4, offset: { x: 0, y: 2 }, color: { r: 0, g: 0, b: 0, a: 0.2 } }] });
  return pnode({ id: '1:1', name: 'Welcome', type: 'FRAME', width: 200, height: 400, absoluteBoundingBox: { x: 100, y: 200, width: 200, height: 400 },
    fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 1, b: 1 } }], children: [text, button],
    exportAsync: async () => new Uint8Array(writePng(blank(600, 1200))) });
}

test('plugin: node Plugin API → dạng REST (constraints LEFT / LEFT_RIGHT / BOTTOM, style chữ) → tool đọc được như từ API', async () => {
  const { serialize, exportFrames, expand } = loadPlugin();
  const n = serialize(pluginFrame());
  const [t, b] = n.children;
  assert.deepEqual(t.constraints, { horizontal: 'LEFT', vertical: 'TOP' });
  assert.deepEqual(t.style, { fontSize: 16, fontFamily: 'Inter', fontStyle: 'Bold', fontWeight: 700, textAlignHorizontal: 'LEFT', textCase: 'UPPER' });
  assert.deepEqual(b.constraints, { horizontal: 'LEFT_RIGHT', vertical: 'BOTTOM' });
  assert.equal(b.layoutMode, 'HORIZONTAL');
  // Prototype → reactions (thời gian ms; hành động BACK không có đích → bỏ), viền, bóng
  assert.deepEqual(b.reactions, [{ trigger: 'ON_CLICK', destinationId: '9:9', navigation: 'NAVIGATE', transition: { type: 'MOVE_IN', direction: 'LEFT', duration: 300, easing: 'EASE_OUT' } }]);
  assert.equal(b.strokeWeight, 1);
  assert.equal(b.effects[0].type, 'DROP_SHADOW');
  assert.equal(t.reactions, undefined);
  // Tool trải cây + quy đổi toạ độ y như dữ liệu từ API
  const flat = flatten(n);
  assert.deepEqual(flat.texts.map((x) => [x.text, x.fontSize]), [['WELCOME', 16]]);
  assert.deepEqual(layoutMap(n, { width: 240, height: 440 }).get('3:1'), { x: 20, y: 370, width: 200, height: 44 });
  const frames = await exportFrames([pluginFrame()], 3);
  assert.equal(frames[0].scale, 3);
  assert.ok(Buffer.from(frames[0].png, 'base64').length > 100);
  // Chọn cả section → các frame bên trong; layer lẻ (TEXT) bỏ qua
  const sec = { type: 'SECTION', children: [{ type: 'FRAME', id: 'a' }, { type: 'TEXT', id: 'b' }] };
  assert.deepEqual(expand([sec, { type: 'TEXT' }, { type: 'FRAME', id: 'c' }]).map((x) => x.id), ['a', 'c']);
});

async function exportFile() {
  const { exportFrames } = loadPlugin();
  const frames = await exportFrames([pluginFrame()], 3);
  frames.push({ ...frames[0], id: '9:9', name: 'Đăng nhập', node: { ...frames[0].node, id: '9:9' } });
  return JSON.stringify({ tool: 'qa-pipeline-figma-export', version: 1, file: 'Tastory', page: 'App', exportedAt: '2026-11-03T00:00:00Z', frames });
}

test('importFigmaExport: lưu frame theo app (kèm kind / reactions / hash); nhập lại thay frame cũ, báo frame đổi nội dung; xoá frame', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fig-'));
  const store = createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'st-')));
  store.put('apps', { id: 'app1', name: 'Tastory' });
  const text = await exportFile();
  const out = importFigmaExport({ store, appId: 'app1', text, dir });
  assert.deepEqual(out.added, ['Welcome', 'Đăng nhập']);
  assert.deepEqual(out.changed, []);
  const f = store.get('apps', 'app1').figmaFrames.find((x) => x.id === '1:1');
  assert.ok(fs.existsSync(f.png) && fs.existsSync(f.json));
  assert.equal(JSON.parse(fs.readFileSync(f.json, 'utf8')).scale, 3);
  assert.equal(f.kind, 'screen');
  assert.match(f.hash, /^[0-9a-f]{12}$/);
  assert.deepEqual(f.reactions.map((r) => [r.nodeName, r.destinationId, r.transition.type, r.transition.duration, r.transition.easing]), [['CTA', '9:9', 'MOVE_IN', 300, 'EASE_OUT']]);
  // Nhập lại cùng frame → không nhân đôi; nội dung đổi → báo
  const data = JSON.parse(text);
  data.frames[1].node = { ...data.frames[1].node, name: 'Đăng nhập v2' };
  const again = importFigmaExport({ store, appId: 'app1', text: JSON.stringify(data), dir });
  assert.equal(store.get('apps', 'app1').figmaFrames.length, 2);
  assert.deepEqual(again.changed, ['Đăng nhập']);
  assert.throws(() => importFigmaExport({ store, appId: 'app1', text: '{"a":1}', dir }), /plugin/);
  assert.throws(() => importFigmaExport({ store, appId: 'app1', text: 'xx', dir }), /JSON/);
  removeFigmaFrame({ store, appId: 'app1', frameId: '1:1' });
  assert.equal(store.get('apps', 'app1').figmaFrames.length, 1);
  assert.ok(!fs.existsSync(f.png));
  assert.equal(nameKey('Sign Up / 01'), 'sign up 01');
});

test('analyzeCapture: so ảnh chụp với frame đã nhập (file trên máy, không gọi API); thiếu file frame → blocked', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fig-'));
  const store = createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'st-')));
  store.put('apps', { id: 'app1', name: 'Tastory' });
  importFigmaExport({ store, appId: 'app1', text: await exportFile(), dir });
  const frame = store.get('apps', 'app1').figmaFrames.find((f) => f.id === '1:1');
  // Ảnh app = trắng (giống render trắng của frame giả) → chữ "WELCOME" và nút thiếu
  const capture = { png: writePng(blank(400, 800)), xml: '', win: { width: 200, height: 400 }, density: 1, platform: 'iOS' };
  const ev = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ev-')), 'step-1-ev');
  const r = await analyzeCapture({ capture, frame, evidenceBase: ev, ocr: async () => [] });
  assert.equal(r.status, 'failed');
  assert.ok(r.findings.some((f) => f.kind === 'missing' && f.target === 'WELCOME'));
  assert.ok(r.findings.every((f) => fs.existsSync(f.image)));
  assert.ok(fs.existsSync(r.overview));
  fs.rmSync(frame.png);
  const r2 = await analyzeCapture({ capture, frame, ocr: async () => [] });
  assert.equal(r2.status, 'blocked');
  assert.match(r2.error, /nhập lại file từ plugin/);
});


// ---- Bổ sung cho bằng bộ figma-reader-kit: auto layout, line-height, nhiều style trong một chữ, gradient, bóng đủ, biến / style / component ----
const solid = (r, g, b, extra = {}) => ({ type: 'SOLID', visible: true, opacity: 1, color: { r, g, b }, ...extra });
const box = (w = 100, h = 40) => ({ x: 0, y: 0, width: w, height: h });

test('plugin: auto layout — gap, padding, căn trục, kiểu co giãn, wrap; node con có layoutGrow / min-max', () => {
  const { serialize } = loadPlugin();
  const child = pnode({ id: '2:2', name: 'Item', type: 'FRAME', absoluteBoundingBox: box(), layoutGrow: 1, layoutSizingHorizontal: 'FILL', minWidth: 100, maxWidth: null, children: [] });
  const n = serialize(pnode({ id: '2:1', name: 'List', type: 'FRAME', absoluteBoundingBox: box(300, 200), layoutMode: 'VERTICAL', layoutWrap: 'NO_WRAP', itemSpacing: 12, counterAxisSpacing: 4,
    paddingLeft: 16, paddingRight: 20, paddingTop: 8, paddingBottom: 10, primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'MIN', primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'FIXED',
    layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG', clipsContent: true, children: [child] }));
  assert.equal(n.layoutMode, 'VERTICAL');
  assert.equal(n.itemSpacing, 12);
  assert.equal(n.counterAxisSpacing, 4);
  assert.deepEqual([n.paddingLeft, n.paddingRight, n.paddingTop, n.paddingBottom], [16, 20, 8, 10]);
  assert.deepEqual([n.primaryAxisAlignItems, n.counterAxisAlignItems, n.primaryAxisSizingMode, n.counterAxisSizingMode], ['CENTER', 'MIN', 'AUTO', 'FIXED']);
  assert.deepEqual([n.layoutSizingHorizontal, n.layoutSizingVertical, n.layoutWrap, n.clipsContent], ['FILL', 'HUG', 'NO_WRAP', true]);
  const c = n.children[0];
  assert.equal(c.layoutGrow, 1);
  assert.equal(c.layoutSizingHorizontal, 'FILL');
  assert.equal(c.minWidth, 100);
  assert.ok(!('maxWidth' in c)); // null → không ghi
});

test('plugin: góc bo từng góc khi không đều (cornerRadius mixed) → rectangleCornerRadii [tl, tr, br, bl]', () => {
  const fg = fakeFigma();
  const { serialize } = loadPlugin(fg);
  const n = serialize(pnode({ id: '3:1', name: 'Card', type: 'FRAME', absoluteBoundingBox: box(), cornerRadius: fg.mixed, topLeftRadius: 8, topRightRadius: 8, bottomRightRadius: 0, bottomLeftRadius: 0, children: [] }));
  assert.deepEqual(n.rectangleCornerRadii, [8, 8, 0, 0]);
  const even = serialize(pnode({ id: '3:2', name: 'Even', type: 'FRAME', absoluteBoundingBox: box(), cornerRadius: 6, children: [] }));
  assert.equal(even.cornerRadius, 6);
  assert.ok(!('rectangleCornerRadii' in even));
});

test('plugin: chữ — line-height (px / % / auto), letter-spacing ra px, paragraph spacing, gạch chân, căn dọc, auto-resize', () => {
  const { serialize } = loadPlugin();
  const t = (extra) => serialize(pnode({ id: '4:1', name: 'T', type: 'TEXT', characters: 'Hi', absoluteBoundingBox: box(), fills: [solid(0, 0, 0)], fontSize: 16, fontName: { family: 'Inter', style: 'Regular' }, fontWeight: 400, textAlignHorizontal: 'LEFT', textCase: 'ORIGINAL', ...extra })).style;
  assert.deepEqual([t({ lineHeight: { unit: 'PIXELS', value: 24 } }).lineHeightPx, t({ lineHeight: { unit: 'PIXELS', value: 24 } }).lineHeightUnit], [24, 'PIXELS']);
  const pct = t({ lineHeight: { unit: 'PERCENT', value: 150 } });
  assert.deepEqual([pct.lineHeightPx, pct.lineHeightPercentFontSize, pct.lineHeightUnit], [24, 150, 'FONT_SIZE_%']);
  const auto = t({ lineHeight: { unit: 'AUTO' } });
  assert.equal(auto.lineHeightUnit, 'INTRINSIC_%');
  assert.ok(!('lineHeightPx' in auto));
  assert.equal(t({ letterSpacing: { unit: 'PERCENT', value: 5 }, fontSize: 20 }).letterSpacing, 1);
  assert.equal(t({ letterSpacing: { unit: 'PIXELS', value: 2 } }).letterSpacing, 2);
  const more = t({ paragraphSpacing: 8, paragraphIndent: 4, textDecoration: 'UNDERLINE', textAlignVertical: 'CENTER', textAutoResize: 'HEIGHT' });
  assert.deepEqual([more.paragraphSpacing, more.paragraphIndent, more.textDecoration, more.textAlignVertical, more.textAutoResize], [8, 4, 'UNDERLINE', 'CENTER', 'HEIGHT']);
  assert.ok(!('lineHeightPx' in t({}))); // không có dữ liệu thì không thêm → kết quả cũ giữ nguyên
});

test('plugin: chữ nhiều style trong một layer → styleSegments theo đoạn; một style thì không thêm', () => {
  const fg = fakeFigma();
  const { serialize } = loadPlugin(fg);
  const seg = (start, end, characters, extra) => ({ start, end, characters, fontSize: 16, fontName: { family: 'Inter', style: 'Regular' }, fontWeight: 400, fills: [solid(0, 0, 0)], lineHeight: { unit: 'PIXELS', value: 20 }, letterSpacing: { unit: 'PIXELS', value: 0 }, textDecoration: 'NONE', textCase: 'ORIGINAL', ...extra });
  const base = { id: '5:1', name: 'Mixed', type: 'TEXT', characters: 'Hello world', absoluteBoundingBox: box(), fills: fg.mixed, fontSize: fg.mixed, fontName: fg.mixed, fontWeight: fg.mixed, textAlignHorizontal: 'LEFT', textCase: 'ORIGINAL',
    getRangeFontSize: () => 16, getRangeFontName: () => ({ family: 'Inter', style: 'Regular' }), getRangeFontWeight: () => 400, getRangeFills: () => [solid(0, 0, 0)], getRangeTextCase: () => 'ORIGINAL' };
  const n = serialize(pnode({ ...base, getStyledTextSegments: () => [seg(0, 6, 'Hello '), seg(6, 11, 'world', { fontSize: 20, fontName: { family: 'Inter', style: 'Bold' }, fontWeight: 700, fills: [solid(1, 0, 0)], textDecoration: 'UNDERLINE' })] }));
  assert.equal(n.styleSegments.length, 2);
  assert.deepEqual([n.styleSegments[1].start, n.styleSegments[1].end, n.styleSegments[1].characters], [6, 11, 'world']);
  assert.deepEqual([n.styleSegments[1].fontSize, n.styleSegments[1].fontFamily, n.styleSegments[1].fontStyle, n.styleSegments[1].fontWeight, n.styleSegments[1].textDecoration], [20, 'Inter', 'Bold', 700, 'UNDERLINE']);
  assert.deepEqual(n.styleSegments[1].fills[0].color, { r: 1, g: 0, b: 0, a: 1 });
  assert.equal(n.styleSegments[0].lineHeightPx, 20);
  const single = serialize(pnode({ ...base, getStyledTextSegments: () => [seg(0, 11, 'Hello world')] }));
  assert.ok(!('styleSegments' in single));
  const noApi = serialize(pnode({ ...base })); // không có getStyledTextSegments (bản Figma cũ) → không lỗi
  assert.ok(!('styleSegments' in noApi));
});

test('plugin: bóng / blur đủ — spread, blendMode, showShadowBehindNode; blur không có offset / màu', () => {
  const { serialize } = loadPlugin();
  const n = serialize(pnode({ id: '6:1', name: 'Fx', type: 'FRAME', absoluteBoundingBox: box(), children: [], effects: [
    { type: 'DROP_SHADOW', visible: true, radius: 4, spread: 2, offset: { x: 1, y: 3 }, color: { r: 0, g: 0, b: 0, a: 0.25 }, blendMode: 'NORMAL', showShadowBehindNode: false },
    { type: 'INNER_SHADOW', visible: true, radius: 6, spread: 0, offset: { x: 0, y: 0 }, color: { r: 1, g: 1, b: 1, a: 0.5 } },
    { type: 'LAYER_BLUR', visible: true, radius: 8 },
    { type: 'DROP_SHADOW', visible: false, radius: 99, offset: { x: 0, y: 0 }, color: { r: 0, g: 0, b: 0, a: 1 } },
  ] }));
  assert.equal(n.effects.length, 3); // bóng ẩn bị bỏ
  assert.deepEqual([n.effects[0].spread, n.effects[0].blendMode, n.effects[0].showShadowBehindNode], [2, 'NORMAL', false]);
  assert.equal(n.effects[1].spread, 0);
  assert.deepEqual([n.effects[2].type, n.effects[2].radius, n.effects[2].offset, n.effects[2].color], ['LAYER_BLUR', 8, null, null]);
  assert.ok(!('spread' in n.effects[2]));
});

test('plugin: gradient giữ điểm màu + vị trí + ma trận; ảnh giữ imageHash + scaleMode; blendMode khi khác NORMAL', () => {
  const { serialize } = loadPlugin();
  const n = serialize(pnode({ id: '7:1', name: 'G', type: 'FRAME', absoluteBoundingBox: box(), children: [], fills: [
    { type: 'GRADIENT_LINEAR', visible: true, opacity: 0.8, gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 0, g: 0, b: 1, a: 0.5 } }], gradientTransform: [[1, 0, 0], [0, 1, 0]] },
    { type: 'IMAGE', visible: true, opacity: 1, imageHash: 'abc123', scaleMode: 'FILL' },
    solid(0, 1, 0, { blendMode: 'MULTIPLY' }),
    solid(1, 1, 1),
  ] }));
  const [g, img, multi, plain] = n.fills;
  assert.deepEqual(g.gradientStops, [{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 0, g: 0, b: 1, a: 0.5 } }]);
  assert.deepEqual(g.gradientTransform, [[1, 0, 0], [0, 1, 0]]);
  assert.equal(g.opacity, 0.8);
  assert.deepEqual([img.imageHash, img.scaleMode], ['abc123', 'FILL']);
  assert.equal(multi.blendMode, 'MULTIPLY');
  assert.deepEqual(plain, { type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 1, b: 1, a: 1 } }); // dạng cũ giữ nguyên
});

test('plugin: layer ẩn giữ nguyên visible và thêm hiddenByAncestor cho con của layer ẩn', () => {
  const { serialize } = loadPlugin();
  const grand = pnode({ id: '8:3', name: 'Grand', type: 'FRAME', absoluteBoundingBox: box(), children: [] });
  const kid = pnode({ id: '8:2', name: 'Kid', type: 'FRAME', absoluteBoundingBox: box(), children: [grand] });
  const hidden = pnode({ id: '8:1', name: 'Hidden', type: 'FRAME', visible: false, absoluteBoundingBox: box(), children: [kid] });
  const root = pnode({ id: '8:0', name: 'Root', type: 'FRAME', absoluteBoundingBox: box(), children: [hidden, pnode({ id: '8:9', name: 'Shown', type: 'FRAME', absoluteBoundingBox: box(), children: [] })] });
  const n = serialize(root);
  const [h, shown] = n.children;
  assert.equal(h.visible, false);
  assert.ok(!('hiddenByAncestor' in h));
  assert.equal(h.children[0].visible, true);
  assert.equal(h.children[0].hiddenByAncestor, true);
  assert.equal(h.children[0].children[0].hiddenByAncestor, true);
  assert.ok(!('hiddenByAncestor' in shown));
});

test('plugin: biến / style / component — boundVariables, styleId, componentId, overrides, componentProperties và bảng refs (tên, collection, giá trị từng mode)', async () => {
  const comp = { id: 'C:1', name: 'Button/Primary', key: 'k1', description: 'Nút chính', parent: { type: 'COMPONENT_SET', name: 'Button' } };
  const fg = fakeFigma({
    variables: {
      getVariableByIdAsync: async (id) => ({ 'VariableID:1:2': { id, name: 'color/primary', variableCollectionId: 'VC:1', resolvedType: 'COLOR', valuesByMode: { m1: { r: 0, g: 0.5, b: 1, a: 1 }, m2: { r: 1, g: 1, b: 1, a: 1 } } }, 'VariableID:1:3': { id, name: 'space/m', variableCollectionId: 'VC:1', resolvedType: 'FLOAT', valuesByMode: { m1: 12, m2: 16 } } }[id] || null),
      getVariableCollectionByIdAsync: async () => ({ name: 'Brand', modes: [{ modeId: 'm1', name: 'Light' }, { modeId: 'm2', name: 'Dark' }] }),
    },
    getStyleByIdAsync: async (id) => ({ 'S:fill': { id, name: 'Primary/Fill', type: 'PAINT' }, 'S:text': { id, name: 'Body/16', type: 'TEXT' } }[id] || null),
  });
  const { exportFrames } = loadPlugin(fg);
  const inst = pnode({ id: '9:3', name: 'CTA', type: 'INSTANCE', absoluteBoundingBox: box(), children: [], getMainComponentAsync: async () => comp,
    overrides: [{ id: '9:4', overriddenFields: ['fills'] }], componentProperties: { 'Label#1:0': { type: 'TEXT', value: 'Go' }, State: { type: 'VARIANT', value: 'Default' } } });
  const text = pnode({ id: '9:2', name: 'T', type: 'TEXT', characters: 'x', absoluteBoundingBox: box(), fills: [solid(0, 0, 0)], fontSize: 16, fontName: { family: 'Inter', style: 'Regular' }, textAlignHorizontal: 'LEFT', textStyleId: 'S:text' });
  const frame = pnode({ id: '9:1', name: 'F', type: 'FRAME', width: 100, height: 100, absoluteBoundingBox: box(), children: [text, inst], fillStyleId: 'S:fill', itemSpacing: 12,
    boundVariables: { fills: [{ type: 'VARIABLE_ALIAS', id: 'VariableID:1:2' }], itemSpacing: { type: 'VARIABLE_ALIAS', id: 'VariableID:1:3' } },
    exportAsync: async () => new Uint8Array(1) });
  const [f] = await exportFrames([frame], 1);
  const n = f.node;
  assert.deepEqual(n.boundVariables, { fills: ['VariableID:1:2'], itemSpacing: 'VariableID:1:3' });
  assert.equal(n.fillStyleId, 'S:fill');
  assert.equal(n.children[0].textStyleId, 'S:text');
  const i = n.children[1];
  assert.equal(i.componentId, 'C:1');
  assert.deepEqual(i.overrides, [{ id: '9:4', overriddenFields: ['fills'] }]);
  assert.deepEqual(i.componentProperties, { 'Label#1:0': { type: 'TEXT', value: 'Go' }, State: { type: 'VARIANT', value: 'Default' } });
  assert.deepEqual(n.refs.variables['VariableID:1:2'], { name: 'color/primary', collection: 'Brand', type: 'COLOR', valuesByMode: { Light: { r: 0, g: 0.5, b: 1, a: 1 }, Dark: { r: 1, g: 1, b: 1, a: 1 } } });
  assert.deepEqual(n.refs.variables['VariableID:1:3'].valuesByMode, { Light: 12, Dark: 16 });
  assert.deepEqual(n.refs.styles['S:fill'], { name: 'Primary/Fill', type: 'PAINT' });
  assert.deepEqual(n.refs.styles['S:text'], { name: 'Body/16', type: 'TEXT' });
  assert.deepEqual(n.refs.components['C:1'], { name: 'Button/Primary', key: 'k1', description: 'Nút chính', componentSetName: 'Button' });
});

test('plugin: tra cứu biến / style / component lỗi hoặc không có → ref null, KHÔNG làm hỏng cả lần xuất; không có gì để tra thì không thêm refs', async () => {
  const fg = fakeFigma({ variables: { getVariableByIdAsync: async () => { throw new Error('không có quyền'); }, getVariableCollectionByIdAsync: async () => null }, getStyleByIdAsync: async () => null });
  const { exportFrames } = loadPlugin(fg);
  const frame = pnode({ id: '10:1', name: 'F', type: 'FRAME', width: 10, height: 10, absoluteBoundingBox: box(), children: [], fillStyleId: 'S:gone', boundVariables: { itemSpacing: { type: 'VARIABLE_ALIAS', id: 'VariableID:9:9' } }, exportAsync: async () => new Uint8Array(1) });
  const [f] = await exportFrames([frame], 1);
  assert.equal(f.node.refs.variables['VariableID:9:9'], null);
  assert.equal(f.node.refs.styles['S:gone'], null);
  const plain = pnode({ id: '10:2', name: 'P', type: 'FRAME', width: 10, height: 10, absoluteBoundingBox: box(), children: [], exportAsync: async () => new Uint8Array(1) });
  const [g] = await loadPlugin(fg).exportFrames([plain], 1);
  assert.ok(!('refs' in g.node));
});

test('plugin: định dạng file là version 3 (thêm auto layout, line-height, styleSegments, gradient, refs…)', () => {
  assert.equal(loadPlugin().FORMAT_VERSION, 3);
  assert.match(fs.readFileSync(new URL('../figma-plugin/code.js', import.meta.url), 'utf8'), /version: FORMAT_VERSION/);
});

test('plugin v3: file xuất có trường mới vẫn đi qua đường đọc của tool (readExport, flatten, loadFigmaExport, summarizeFrames) không lỗi', async () => {
  const fg = fakeFigma({ variables: { getVariableByIdAsync: async (id) => ({ id, name: 'color/primary', variableCollectionId: 'VC:1', resolvedType: 'COLOR', valuesByMode: { m1: { r: 0, g: 0, b: 1, a: 1 } } }), getVariableCollectionByIdAsync: async () => ({ name: 'Brand', modes: [{ modeId: 'm1', name: 'Light' }] }) }, getStyleByIdAsync: async () => null });
  const { exportFrames } = loadPlugin(fg);
  const rich = pnode({ id: '1:1', name: 'Home', type: 'FRAME', width: 375, height: 812, absoluteBoundingBox: { x: 0, y: 0, width: 375, height: 812 }, layoutMode: 'VERTICAL', itemSpacing: 12, paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8,
    primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'CENTER', primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED', layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED', clipsContent: true,
    boundVariables: { fills: [{ type: 'VARIABLE_ALIAS', id: 'VariableID:1:2' }] },
    fills: [{ type: 'GRADIENT_LINEAR', visible: true, opacity: 1, gradientStops: [{ position: 0, color: { r: 1, g: 1, b: 1, a: 1 } }, { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } }], gradientTransform: [[1, 0, 0], [0, 1, 0]] }],
    effects: [{ type: 'DROP_SHADOW', visible: true, radius: 4, spread: 1, offset: { x: 0, y: 2 }, color: { r: 0, g: 0, b: 0, a: 0.2 } }],
    children: [pnode({ id: '2:1', name: 'Title', type: 'TEXT', characters: 'Welcome', absoluteBoundingBox: { x: 16, y: 40, width: 160, height: 24 }, fills: [solid(0, 0, 0)], fontSize: 16, fontName: { family: 'Inter', style: 'Bold' }, fontWeight: 700, textAlignHorizontal: 'LEFT', textCase: 'ORIGINAL', lineHeight: { unit: 'PIXELS', value: 24 }, letterSpacing: { unit: 'PERCENT', value: 2 } })],
    exportAsync: async () => new Uint8Array(writePng(blank(750, 1624))) });
  const frames = await exportFrames([rich], 2);
  const text = JSON.stringify({ tool: 'qa-pipeline-figma-export', version: 3, file: 'Moss', page: 'P', exportedAt: new Date().toISOString(), frames });
  const { readExport } = await import('../server/locators/figmaFrames.js');
  const data = readExport(text); // định dạng hợp lệ
  const flat = flatten(data.frames[0].node); // bộ so của UI Testing đọc được
  assert.ok(flat && typeof flat === 'object');
  const { loadFigmaExport, summarizeFrames } = await import('../server/smoke/figmaExport.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qapd-'));
  const out = loadFigmaExport({ data, dir }); // AI Smoke Test nạp được
  assert.equal(out.frames[0].texts[0], 'Welcome');
  assert.match(summarizeFrames(out.frames), /Home/);
  const j = JSON.parse(fs.readFileSync(out.frames[0].json, 'utf8'));
  assert.equal(j.node.itemSpacing, 12);
  assert.equal(j.node.children[0].style.lineHeightPx, 24);
  assert.equal(j.node.children[0].style.letterSpacing, 0.32); // 2% × 16px
  assert.equal(j.node.fills[0].gradientStops.length, 2);
  assert.equal(j.node.refs.variables['VariableID:1:2'].collection, 'Brand');
});

// ---- Section lồng nhau + tên file theo Section ----
const sec = (id, name, children) => ({ id, name, type: 'SECTION', visible: true, children });
const frm = (id, name) => ({ id, name, type: 'FRAME', visible: true, children: [] });

test('plugin: chọn Section chứa Section con → lấy frame của CẢ các Section con (trước đây chỉ lấy frame nằm trực tiếp)', () => {
  const { expand } = loadPlugin();
  const blood = sec('5433:75649', 'Blood Sugar', [
    sec('5457:78813', 'Log Blood Sugar', [frm('1:1', 'Log'), frm('1:2', 'Log State')]),
    sec('5457:78814', 'Blood Sugar - Detail', [frm('2:1', 'Detail Current'), sec('2:9', 'Tabs', [frm('2:2', '7 days')])]),
    sec('5457:78815', 'History', [frm('3:1', 'History')]),
    frm('5457:78816', 'Health'),
  ]);
  assert.deepEqual(expand([blood]).map((n) => n.name), ['Log', 'Log State', 'Detail Current', '7 days', 'History', 'Health']);
  // chọn frame thường và Section lẫn nhau vẫn đúng; node không phải frame / section bị bỏ
  const text = { id: '9:9', name: 'T', type: 'TEXT', visible: true };
  assert.deepEqual(expand([frm('4:1', 'Solo'), sec('4:2', 'S', [frm('4:3', 'In'), text]), text]).map((n) => n.name), ['Solo', 'In']);
});

test('plugin: tên file theo Section / node đang chọn (khớp node-id trong link Figma); nhiều node thì theo tên file + số frame', () => {
  const { exportFileName } = loadPlugin();
  assert.equal(exportFileName([{ id: '5433:75649', name: 'Blood Sugar' }], 'Moss (Copy)', 6), 'Blood Sugar-5433-75649.json');
  assert.equal(exportFileName([{ id: '1:2', name: 'Login / Error' }], 'Moss', 1), 'Login - Error-1-2.json');
  assert.equal(exportFileName([{ id: '1:1', name: 'A' }, { id: '1:2', name: 'B' }, { id: '1:3', name: 'C' }], 'Moss (Copy)', 3), 'Moss (Copy)-3-frame.json');
  const bad = exportFileName([{ id: '7:8', name: 'a/b\\c:d*e?f"g<h>i|j' }], 'x', 1);
  assert.ok(!/[\\/:*?"<>|]/.test(bad.replace('.json', '')), bad);
  assert.ok(bad.endsWith('-7-8.json'));
  assert.equal(exportFileName([{ id: '1:1', name: '   ' }], 'Moss', 1), 'Moss-1-1.json'); // tên rỗng → dùng tên file + id
});

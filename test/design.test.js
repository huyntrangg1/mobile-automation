// So UI với Figma: đọc link, trải cây node, quy đổi toạ độ theo constraints, dò điểm lệch trên ảnh tự tạo, ghi kết quả cho report
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseFigmaUrl, flatten, frameOf } from '../server/apps/template/src/design/figma.js';
import { compareScreen, layoutMap, parseSource } from '../server/apps/template/src/design/compare.js';
import { blank, writePng, readPng, deltaE, colorExtent, findTemplate, crop } from '../server/apps/template/src/design/image.js';
import { designCheck } from '../server/apps/template/src/design/check.js';

// ---- dựng frame Figma + ảnh giả ----
const FRAME = { width: 200, height: 400 };
const fill = (r, g, b) => [{ type: 'SOLID', color: { r: r / 255, g: g / 255, b: b / 255, a: 1 } }];
const box = (x, y, width, height) => ({ x: 1000 + x, y: 2000 + y, width, height }); // frame không nằm ở gốc canvas
const text = (id, characters, [x, y, w, h], { size = 16, color = [17, 17, 17], align = 'LEFT', c = {} } = {}) => ({
  id, name: characters, type: 'TEXT', characters, absoluteBoundingBox: box(x, y, w, h), fills: fill(...color),
  style: { fontSize: size, fontWeight: 400, fontFamily: 'Inter', textAlignHorizontal: align }, constraints: { horizontal: 'LEFT', vertical: 'TOP', ...c },
});
function frameNode(children) {
  return { id: '1:1', name: 'Welcome', type: 'FRAME', absoluteBoundingBox: box(0, 0, FRAME.width, FRAME.height), fills: fill(255, 255, 255), children };
}
// Vẽ khối (đơn vị pt) lên ảnh tỉ lệ k
function draw(img, k, blocks) {
  for (const { x, y, w, h, rgb } of blocks) {
    for (let yy = Math.round(y * k); yy < Math.round((y + h) * k); yy++) {
      for (let xx = Math.round(x * k); xx < Math.round((x + w) * k); xx++) {
        if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) continue;
        img.data.set([...rgb, 255], (img.width * yy + xx) << 2);
      }
    }
  }
  return img;
}
const INK = [17, 17, 17];
const BLUE = [0, 122, 255];
const WHITE = [255, 255, 255];

function scene() {
  const node = frameNode([
    text('2:1', 'Welcome', [20, 60, 160, 20]),
    text('2:2', 'Cook better', [20, 100, 160, 20]),
    text('2:3', 'Sign in', [20, 140, 160, 20]),
    text('2:4', 'Terms', [20, 180, 160, 20]),
    text('2:5', 'Price', [20, 220, 160, 20], { color: [120, 120, 120] }),
    text('2:6', 'Big', [20, 260, 160, 20], { size: 20 }),
    {
      id: '3:1', name: 'Button', type: 'FRAME', absoluteBoundingBox: box(20, 330, 160, 44), fills: fill(...BLUE), cornerRadius: 8,
      constraints: { horizontal: 'LEFT_RIGHT', vertical: 'BOTTOM' },
      children: [text('3:2', 'Get started', [40, 342, 120, 20], { color: WHITE, align: 'CENTER', c: { horizontal: 'CENTER' } })],
    },
  ]);
  // Figma render @2x: mực chữ khít 60% chiều rộng text box, cao 12pt
  const k = 2;
  const fig = draw(blank(FRAME.width * k, FRAME.height * k), k, [
    { x: 20, y: 64, w: 90, h: 12, rgb: INK }, // Welcome
    { x: 20, y: 104, w: 100, h: 12, rgb: INK }, // Cook better
    { x: 20, y: 144, w: 60, h: 12, rgb: INK }, // Sign in
    { x: 20, y: 184, w: 50, h: 12, rgb: INK }, // Terms
    { x: 20, y: 224, w: 50, h: 12, rgb: [120, 120, 120] }, // Price (xám)
    { x: 20, y: 264, w: 40, h: 12, rgb: INK }, // Big
    { x: 20, y: 330, w: 160, h: 44, rgb: BLUE },
    { x: 60, y: 346, w: 80, h: 12, rgb: WHITE }, // Get started (giữa nút)
  ]);
  return { node, fig, k };
}

function appShot(win, k = 2) {
  const dy = win.height - FRAME.height; // nút neo đáy dời theo
  const app = draw(blank(win.width * k, win.height * k), k, [
    { x: 20, y: 64, w: 90, h: 12, rgb: INK }, // Welcome: đúng
    { x: 30, y: 104, w: 100, h: 12, rgb: INK }, // Cook better: lệch 10pt sang phải
    { x: 20, y: 144, w: 55, h: 12, rgb: INK }, // "Log in" ở chỗ "Sign in"
    // Terms: thiếu
    { x: 20, y: 224, w: 50, h: 12, rgb: [220, 30, 30] }, // Price: đỏ thay vì xám
    { x: 20, y: 262, w: 48, h: 18, rgb: INK }, // Big: chữ to hơn (cao 18 thay vì 12)
    { x: 20, y: 330 + dy, w: win.width - 40 - 30, h: 44, rgb: BLUE }, // nút hẹp hơn 30pt
    { x: (win.width - 30) / 2 - 40, y: 346 + dy, w: 80, h: 12, rgb: WHITE },
    { x: 150, y: 150, w: 30, h: 30, rgb: [0, 200, 0] }, // khối xanh lá thừa
  ]);
  const elements = [
    { type: 'StaticText', text: 'Welcome', rect: { x: 20, y: 60, width: 100, height: 20 } },
    { type: 'StaticText', text: 'Cook better', rect: { x: 30, y: 100, width: 110, height: 20 } },
    { type: 'StaticText', text: 'Log in', rect: { x: 20, y: 140, width: 70, height: 20 } },
    { type: 'StaticText', text: 'Price', rect: { x: 20, y: 220, width: 60, height: 20 } },
    { type: 'StaticText', text: 'Big', rect: { x: 20, y: 260, width: 60, height: 22 } },
    { type: 'Button', text: 'Get started', rect: { x: 20, y: 330 + dy, width: win.width - 70, height: 44 } },
  ];
  return { app, elements };
}

test('parseFigmaUrl: design / file / proto, node-id dạng 12-34 → 12:34; thiếu node-id báo rõ', () => {
  assert.deepEqual(parseFigmaUrl('https://www.figma.com/design/AbC123/Tastory?node-id=12-34&t=x'), { fileKey: 'AbC123', nodeId: '12:34' });
  assert.deepEqual(parseFigmaUrl('https://www.figma.com/file/Key9/App?node-id=5%3A7'), { fileKey: 'Key9', nodeId: '5:7' });
  assert.deepEqual(parseFigmaUrl('https://figma.com/design/Main1/branch/Br2/App?node-id=1-2'), { fileKey: 'Br2', nodeId: '1:2' });
  assert.throws(() => parseFigmaUrl('https://www.figma.com/design/AbC123/Tastory'), /node-id/);
  assert.throws(() => parseFigmaUrl('https://example.com/x'), /Figma/);
});

test('flatten: chữ (textCase), khối nền, icon; bỏ status bar, layer ẩn, phần ngoài frame', () => {
  const node = frameNode([
    { id: 's', name: 'Status Bar', type: 'INSTANCE', absoluteBoundingBox: box(0, 0, 200, 44), children: [text('s1', '9:41', [10, 10, 30, 14])] },
    { ...text('t', 'continue', [10, 60, 80, 20]), style: { fontSize: 14, textCase: 'UPPER' } },
    { ...text('h', 'Hidden', [10, 90, 80, 20]), visible: false },
    text('o', 'Outside', [10, 500, 80, 20]),
    { id: 'i', name: 'ic_back', type: 'INSTANCE', absoluteBoundingBox: box(10, 120, 24, 24), children: [{ id: 'v', type: 'VECTOR', absoluteBoundingBox: box(14, 124, 16, 16) }] },
    { id: 'b', name: 'Card', type: 'RECTANGLE', absoluteBoundingBox: box(10, 160, 180, 60), fills: fill(240, 240, 240) },
  ]);
  const f = flatten(node);
  assert.deepEqual(f.texts.map((t) => t.text), ['CONTINUE']);
  assert.deepEqual(f.texts[0].box, { x: 10, y: 60, width: 80, height: 20 });
  assert.deepEqual(f.shapes.map((s) => [s.id, s.kind]), [['i', 'icon'], ['b', 'block']]);
  assert.equal(f.ignored[0].name, 'Status Bar');
});

test('layoutMap: máy rộng / cao hơn frame → giữ lề trái, kéo giãn LEFT_RIGHT, neo đáy BOTTOM, CENTER theo giữa cha', () => {
  const { node } = scene();
  const m = layoutMap(node, { width: 240, height: 440 });
  assert.deepEqual(m.get('2:1'), { x: 20, y: 60, width: 160, height: 20 });
  assert.deepEqual(m.get('3:1'), { x: 20, y: 370, width: 200, height: 44 }); // rộng thêm 40, dời xuống 40
  const t = m.get('3:2');
  assert.equal(t.x + t.width / 2, 120); // giữa nút mới
  assert.equal(t.y, 382);
});

test('compareScreen: bắt đúng lệch vị trí, sai chữ, thiếu chữ, sai màu, sai cỡ chữ, nút hẹp, vùng thừa; phần đúng không báo', () => {
  const { node, fig, k } = scene();
  const win = { width: 200, height: 400 };
  const { app, elements } = appShot(win);
  const { findings } = compareScreen({ ...flatten(node), node }, fig, k, { png: app, win, elements, ocr: [], unit: 'pt' }, { screen: 'Welcome' });
  const by = (kind, target) => findings.find((f) => f.kind === kind && (!target || f.target === target));
  assert.ok(!findings.some((f) => f.target === 'Welcome'), JSON.stringify(findings.filter((f) => f.target === 'Welcome')));
  const pos = by('position', 'Cook better');
  assert.ok(pos, 'lệch vị trí');
  assert.match(pos.short, /10pt sang phải/);
  assert.equal(by('text', 'Sign in').actualRaw, 'Log in');
  assert.ok(by('missing', 'Terms')?.missing);
  const col = by('text-color', 'Price');
  assert.ok(col);
  assert.equal(col.expectedRaw, '#787878');
  const font = by('font', 'Big');
  assert.ok(font, 'cỡ chữ');
  assert.equal(font.actualRaw, 30); // 20 × 18/12
  const size = by('size');
  assert.ok(size, JSON.stringify(findings.map((f) => f.short)));
  assert.match(size.short, /130×44pt, Figma 160×44pt/);
  assert.match(size.target, /Button/);
  const region = by('region');
  assert.ok(region);
  assert.ok(region.appBox.x >= 146 && region.appBox.x <= 152);
  // Nút hẹp 30pt → chữ ở giữa nút dời 15pt sang trái (lệch thật); không báo nhầm màu / cỡ chữ / thiếu cho chữ trên nút
  assert.deepEqual(findings.filter((f) => f.target === 'Get started').map((f) => f.short), ['"Get started" lệch 15pt sang trái so với Figma']);
  assert.equal(findings.length, 8, findings.map((f) => f.short).join('\n'));
});

test('compareScreen: máy cao hơn frame → nút neo đáy dời xuống không bị coi là lệch; app giống hệt → không có điểm lệch', () => {
  const { node, fig, k } = scene();
  const win = { width: 200, height: 440 };
  const dy = 40;
  const app = draw(blank(win.width * k, win.height * k), k, [
    { x: 20, y: 64, w: 90, h: 12, rgb: INK }, { x: 20, y: 104, w: 100, h: 12, rgb: INK }, { x: 20, y: 144, w: 60, h: 12, rgb: INK },
    { x: 20, y: 184, w: 50, h: 12, rgb: INK }, { x: 20, y: 224, w: 50, h: 12, rgb: [120, 120, 120] }, { x: 20, y: 264, w: 40, h: 12, rgb: INK },
    { x: 20, y: 330 + dy, w: 160, h: 44, rgb: BLUE }, { x: 60, y: 346 + dy, w: 80, h: 12, rgb: WHITE },
  ]);
  const elements = ['Welcome', 'Cook better', 'Sign in', 'Terms', 'Price', 'Big'].map((t, i) => ({ type: 'StaticText', text: t, rect: { x: 20, y: 60 + 40 * i, width: 120, height: 20 } }))
    .concat({ type: 'Button', text: 'Get started', rect: { x: 20, y: 370, width: 160, height: 44 } });
  const { findings } = compareScreen({ ...flatten(node), node }, fig, k, { png: app, win, elements, ocr: [], unit: 'pt' }, {});
  assert.deepEqual(findings.map((f) => f.short), []);
});

test('compareScreen: chữ động khai báo ignore → không báo', () => {
  const { node, fig, k } = scene();
  const win = { width: 200, height: 400 };
  const { app, elements } = appShot(win);
  const { findings } = compareScreen({ ...flatten(node), node }, fig, k, { png: app, win, elements, ocr: [], unit: 'pt' }, { ignore: ['^Terms$', 'Sign in'] });
  assert.ok(!findings.some((f) => ['Terms', 'Sign in'].includes(f.target)));
});

test('compareScreen: chữ không có trong page source → tìm bằng OCR', () => {
  const { node, fig, k } = scene();
  const win = { width: 200, height: 400 };
  const { app, elements } = appShot(win);
  const ocr = [{ text: 'Terms', conf: 0.9, x: 20 / 200, y: 184 / 400, w: 50 / 200, h: 12 / 400 }];
  draw(app, k, [{ x: 20, y: 184, w: 50, h: 12, rgb: INK }]);
  const { findings } = compareScreen({ ...flatten(node), node }, fig, k, { png: app, win, elements, ocr, unit: 'pt' }, {});
  assert.ok(!findings.some((f) => f.target === 'Terms'));
});

test('parseSource: iOS (x y width height, label) và Android (bounds, text), bỏ phần tử ẩn', () => {
  const ios = '<XCUIElementTypeStaticText type="XCUIElementTypeStaticText" label="Hi &amp; bye" x="10" y="20" width="30" height="40" visible="true"/><XCUIElementTypeButton label="X" x="0" y="0" width="5" height="5" visible="false"/>';
  assert.deepEqual(parseSource(ios), [{ type: 'StaticText', text: 'Hi & bye', rect: { x: 10, y: 20, width: 30, height: 40 } }]);
  const android = '<android.widget.TextView text="Go" bounds="[10,20][110,70]" displayed="true"/>';
  assert.deepEqual(parseSource(android), [{ type: 'TextView', text: 'Go', rect: { x: 10, y: 20, width: 100, height: 50 } }]);
});

test('image: deltaE, colorExtent đo đúng khối, findTemplate tìm lại mẫu đã dời', () => {
  assert.ok(deltaE([255, 0, 0], [255, 0, 0]) < 0.01);
  assert.ok(deltaE([255, 255, 255], [0, 0, 0]) > 90);
  const img = draw(blank(100, 100), 1, [{ x: 20, y: 30, w: 40, h: 20, rgb: BLUE }, { x: 30, y: 37, w: 10, h: 6, rgb: WHITE }]);
  assert.deepEqual(colorExtent(img, 25, 40, BLUE), { x: 20, y: 30, width: 40, height: 20 });
  const tpl = crop(img, { x: 18, y: 28, width: 44, height: 24 });
  const moved = blank(100, 100);
  draw(moved, 1, [{ x: 26, y: 33, w: 40, h: 20, rgb: BLUE }, { x: 36, y: 40, w: 10, h: 6, rgb: WHITE }]);
  const hit = findTemplate(moved, tpl, 18, 28, 12);
  assert.deepEqual([hit.x, hit.y], [24, 31]);
  assert.ok(hit.score < 0.01);
});

test('frameOf: gọi API nodes + images với token, cache ảnh; thiếu token / 403 báo rõ', async () => {
  const calls = [];
  const png = writePng(blank(4, 4));
  const fetchImpl = async (url, opts) => {
    calls.push([url, opts?.headers?.['X-Figma-Token']]);
    if (url.includes('/nodes')) return { ok: true, status: 200, json: async () => ({ version: '7', nodes: { '1:2': { document: { id: '1:2' } } } }) };
    if (url.includes('/images/')) return { ok: true, status: 200, json: async () => ({ images: { '1:2': 'https://s3/x.png' } }) };
    return { ok: true, status: 200, arrayBuffer: async () => png };
  };
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-'));
  const url = 'https://www.figma.com/design/K/App?node-id=1-2';
  const a = await frameOf(url, { token: 'tk', scale: 2, cacheDir, fetchImpl });
  assert.equal(a.scale, 2);
  assert.ok(calls[1][0].includes('scale=2'));
  assert.ok(calls.every((c) => c[0].startsWith('https://s3') || c[1] === 'tk'));
  await frameOf(url, { token: 'tk', scale: 2, cacheDir, fetchImpl });
  assert.equal(calls.length, 4, 'lần 2 chỉ gọi nodes, ảnh lấy từ cache');
  await assert.rejects(frameOf(url, { token: '', fetchImpl }), /FIGMA_TOKEN/);
  await assert.rejects(frameOf(url, { token: 'x', fetchImpl: async () => ({ ok: false, status: 403 }) }), /403/);
});

test('designCheck: màn đã chụp → dòng Failed + bug "Verify design …" có ảnh; màn chưa đi qua → Not Run; lỗi Figma → Blocked (môi trường)', async () => {
  const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'design-'));
  const { node, fig } = scene();
  const win = { width: 200, height: 400 };
  const { app } = appShot(win);
  fs.mkdirSync(path.join(reports, 'design'), { recursive: true });
  fs.writeFileSync(path.join(reports, 'design', 'Welcome.png'), writePng(app));
  fs.writeFileSync(path.join(reports, 'design', 'Welcome.xml'), '<XCUIElementTypeStaticText label="Welcome" x="20" y="60" width="100" height="20" visible="true"/>');
  fs.writeFileSync(path.join(reports, 'design', 'Welcome.json'), JSON.stringify({ screen: 'Welcome', platform: 'iOS', win, density: 1,
    case: { id: 'TC_1', title: 'Mở app', priority: 'High', feature: 'Onboarding', precondition: ['Cài app mới'] },
    steps: [{ kind: 'Action', step: 1, screen: 'Splash', keyword: 'Launch fresh', target: '', ok: true }] }));
  fs.writeFileSync(path.join(reports, 'design', 'Login.json'), JSON.stringify({ screen: 'Login', platform: 'iOS', win, density: 1, steps: [] }));
  fs.writeFileSync(path.join(reports, 'design', 'Login.png'), writePng(app));
  fs.writeFileSync(path.join(reports, 'design', 'Login.xml'), '');
  const mapFile = path.join(reports, 'map.json');
  fs.writeFileSync(mapFile, JSON.stringify({ token: 'tk', screens: {
    Welcome: { url: 'https://www.figma.com/design/K/App?node-id=1-1' },
    Login: { url: 'https://www.figma.com/design/K/App?node-id=9-9' },
    Paywall: { url: 'https://www.figma.com/design/K/App?node-id=5-5' },
  } }));
  const figPng = writePng(fig);
  const fetchImpl = async (url) => {
    if (url.includes('9%3A9')) return { ok: false, status: 404 };
    if (url.includes('/nodes')) return { ok: true, status: 200, json: async () => ({ version: '1', nodes: { '1:1': { document: node } } }) };
    if (url.includes('/images/')) return { ok: true, status: 200, json: async () => ({ images: { '1:1': 'https://s3/f.png' } }) };
    return { ok: true, status: 200, arrayBuffer: async () => figPng };
  };
  const n = await designCheck(reports, { mapFile, fetchImpl, ocr: async () => [], log: () => {} });
  assert.equal(n, 1);
  const read = (s) => JSON.parse(fs.readFileSync(path.join(reports, 'results', `design-${s}.json`), 'utf8'));
  const w = read('Welcome');
  assert.equal(w.status, 'failed');
  assert.equal(w.suite, 'UI theo Figma');
  assert.equal(w.case.priority, 'High');
  assert.ok(w.bugs.length >= 5);
  for (const b of w.bugs) {
    assert.match(b.keyword, /^Verify design (text|layout|font|color|image)$/);
    assert.ok(fs.existsSync(b.image), b.image);
    assert.ok(b.design.short && b.design.actual && b.design.expected && b.design.severity);
    assert.equal(w.steps[b.at].kind, 'Check');
  }
  assert.equal(w.steps[0].keyword, 'Launch fresh');
  assert.equal(read('Paywall').status, 'notrun');
  const login = read('Login');
  assert.equal(login.status, 'blocked');
  assert.equal(login.blockKind, 'env');
  assert.match(login.error, /404/);
  // Ảnh evidence: Figma | app cạnh nhau → rộng gần gấp đôi 1 màn
  const shot = w.bugs[0].image;
  const width = shot.endsWith('.png') ? readPng(fs.readFileSync(shot)).width
    : Number(execFileSync('sips', ['-g', 'pixelWidth', shot]).toString().match(/pixelWidth: (\d+)/)[1]);
  assert.ok(width >= 2 * win.width * 2 * 0.95, `ảnh rộng ${width}`);
});


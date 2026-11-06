// So 1 màn app với frame Figma → danh sách điểm lệch (thuần, không gọi driver / API → test được bằng ảnh tự tạo).
//
// Toạ độ: "đơn vị app" = pt (iOS) hoặc px (Android). 1 đơn vị Figma = u đơn vị app (iOS 1, Android = mật độ màn hình).
// Máy rộng / cao hơn frame: vị trí từng phần tử theo constraints của Figma (trái / phải / giữa / kéo giãn / tỉ lệ) so với
// khung cha — giống cách app tự dàn khi màn to hơn; cỡ chữ và phần tử không kéo giãn giữ nguyên.
//
// Điểm lệch: { cat, kind, target, severity, short, actual, expected, figBox, appBox, missing }
//   cat (nhóm bug trên report): text · layout · font · color · image
//   figBox: khung trên ảnh Figma (đơn vị app, ảnh Figma đặt từ góc trên-trái) · appBox: khung trên ảnh app (null = không thấy)
import { norm } from '../runner/ocr.js';
import { resize, crop, dominant, edgeColor, inkColor, inkBox, colorExtent, findTemplate, diffRegions, deltaE, hex, fromFigma } from './image.js';

export const DEFAULT_TOLERANCE = { position: 4, size: 0.08, color: 10, font: 0.12 };
// Số px ảnh trên 1 đơn vị app khi so (ảnh 2 bên đưa về cùng tỉ lệ)
const W = 2;

// ---- Page source → phần tử có chữ / có khung (iOS: x y width height; Android: bounds) ----
export function parseSource(xml) {
  const attr = (tag, k) => (tag.match(new RegExp(`\\s${k}="([^"]*)"`)) || [])[1];
  const unesc = (s) => String(s ?? '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
  const out = [];
  for (const tag of String(xml || '').match(/<[A-Za-z][\w.]*\s[^>]*>/g) || []) {
    if (attr(tag, 'visible') === 'false' || attr(tag, 'displayed') === 'false') continue;
    const type = tag.match(/^<([\w.]+)/)[1].replace(/^XCUIElementType/, '').replace(/^android\.widget\./, '');
    let rect;
    const b = attr(tag, 'bounds')?.match(/-?\d+/g)?.map(Number);
    if (b?.length === 4) rect = { x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1] };
    else if (attr(tag, 'width') != null) rect = { x: Number(attr(tag, 'x')), y: Number(attr(tag, 'y')), width: Number(attr(tag, 'width')), height: Number(attr(tag, 'height')) };
    if (!rect || !(rect.width > 0 && rect.height > 0)) continue;
    const text = unesc(attr(tag, 'label') || attr(tag, 'value') || attr(tag, 'text') || attr(tag, 'name') || attr(tag, 'content-desc'));
    out.push({ type, text, rect });
  }
  return out;
}

// ---- Toạ độ Figma → app theo constraints ----
function place(axisFig, parentFig, parentApp, mode, u) {
  const [x, w] = axisFig;
  const [px, pw] = parentFig;
  const [ax, aw] = parentApp;
  const before = x - px;
  const after = px + pw - (x + w);
  switch (mode) {
    case 'RIGHT': case 'BOTTOM': return [ax + aw - after * u - w * u, w * u];
    case 'CENTER': return [ax + aw / 2 + (x + w / 2 - (px + pw / 2)) * u - (w * u) / 2, w * u];
    case 'LEFT_RIGHT': case 'TOP_BOTTOM': return [ax + before * u, Math.max(1, aw - (before + after) * u)];
    case 'SCALE': return [ax + (before / pw) * aw, (w / pw) * aw];
    default: return [ax + before * u, w * u];
  }
}

// Cây Figma (đã có absoluteBoundingBox) → map id → khung trên app. root: node frame
export function layoutMap(root, win, u = 1) {
  const fb = root.absoluteBoundingBox;
  const map = new Map();
  const rel = (b) => ({ x: b.x - fb.x, y: b.y - fb.y, width: b.width, height: b.height });
  const walk = (n, pFig, pApp) => {
    if (!n.absoluteBoundingBox) return;
    const f = rel(n.absoluteBoundingBox);
    const c = n.constraints || {};
    // Trong auto layout: phần tử kéo giãn theo trục phụ (layoutAlign STRETCH) / lấp đầy (layoutGrow) = kéo giãn
    let hz = c.horizontal;
    let vt = c.vertical;
    if (n.layoutAlign === 'STRETCH') { if (pFig.mode === 'VERTICAL') hz = 'LEFT_RIGHT'; else vt = 'TOP_BOTTOM'; }
    const [x, width] = place([f.x, f.width], [pFig.x, pFig.width], [pApp.x, pApp.width], hz, u);
    const [y, height] = place([f.y, f.height], [pFig.y, pFig.height], [pApp.y, pApp.height], vt, u);
    const a = { x, y, width, height };
    map.set(n.id, a);
    for (const ch of n.children || []) walk(ch, { ...f, mode: n.layoutMode }, a);
  };
  const rootApp = { x: 0, y: 0, width: win.width, height: win.height };
  map.set(root.id, rootApp);
  for (const ch of root.children || []) walk(ch, { x: 0, y: 0, width: fb.width, height: fb.height, mode: root.layoutMode }, rootApp);
  return map;
}

// ---- Tiện ích khung ----
const area = (b) => Math.max(0, b.width) * Math.max(0, b.height);
const inter = (a, b) => area({ x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) });
const center = (b) => [b.x + b.width / 2, b.y + b.height / 2];
const dist = (a, b) => { const [p, q] = [center(a), center(b)]; return Math.hypot(p[0] - q[0], p[1] - q[1]); };
const pad = (b, p) => ({ x: b.x - p, y: b.y - p, width: b.width + 2 * p, height: b.height + 2 * p });
const scaleBox = (b, k) => ({ x: b.x * k, y: b.y * k, width: b.width * k, height: b.height * k });
const r1 = (v) => Math.round(v * 10) / 10;
const q = (s) => `"${s}"`;
const oneLine = (s, n = 60) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// Dòng OCR (khung tỉ lệ 0..1) khớp chữ cần tìm: 1–3 dòng liền nhau, cho lệch vài ký tự → mọi chỗ khớp
function ocrMatches(lines, text) {
  const t = norm(text);
  if (t.length < 2) return [];
  const tol = t.length >= 8 ? Math.max(1, Math.floor(t.length / 10)) : 0;
  const lev = (a, b) => {
    const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= b.length; j++) { const cur = dp[j]; dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    }
    return dp[b.length];
  };
  const out = [];
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= lines.length; i++) {
      const part = lines.slice(i, i + n);
      const s = norm(part.map((l) => l.text).join(' '));
      if (!(s === t || (tol > 0 && Math.abs(s.length - t.length) <= tol && lev(s, t) <= tol))) continue;
      const x = Math.min(...part.map((l) => l.x));
      const y = Math.min(...part.map((l) => l.y));
      out.push({ x, y, width: Math.max(...part.map((l) => l.x + l.w)) - x, height: Math.max(...part.map((l) => l.y + l.h)) - y });
    }
  }
  return out;
}

// Số dòng chữ trong khung (dải hàng có mực cách nhau bởi hàng trống)
function lineCount(img, box, bg) {
  const x0 = Math.max(0, Math.round(box.x));
  const x1 = Math.min(img.width - 1, Math.round(box.x + box.width));
  let lines = 0;
  let inBand = false;
  let gap = 0;
  for (let y = Math.max(0, Math.round(box.y)); y <= Math.min(img.height - 1, Math.round(box.y + box.height)); y++) {
    let ink = false;
    for (let x = x0; x <= x1 && !ink; x++) {
      const i = (img.width * y + x) << 2;
      ink = Math.max(Math.abs(img.data[i] - bg[0]), Math.abs(img.data[i + 1] - bg[1]), Math.abs(img.data[i + 2] - bg[2])) > 60;
    }
    if (ink) { if (!inBand) lines++; inBand = true; gap = 0; } else if (inBand && ++gap >= 2 * W) inBand = false;
  }
  return lines;
}

// Hướng lệch dễ đọc: "6pt sang phải, 10pt xuống dưới"
function shiftText(dx, dy, unit) {
  const parts = [];
  if (Math.abs(dx) >= 0.5) parts.push(`${r1(Math.abs(dx))}${unit} sang ${dx > 0 ? 'phải' : 'trái'}`);
  if (Math.abs(dy) >= 0.5) parts.push(`${r1(Math.abs(dy))}${unit} ${dy > 0 ? 'xuống dưới' : 'lên trên'}`);
  return parts.join(', ');
}

// Tên dễ hiểu cho khối / icon: tên layer nếu designer đặt tên thật, không thì theo chữ bên trong / vị trí
const GENERIC = /^(frame|group|rectangle|rect|vector|ellipse|instance|component|union|subtract|line|polygon|image|img|mask|bg|background|layer|shape)\s*[\d.-]*$/i;

/**
 * fig: kết quả flatten() + node (cây frame) · figPng: ảnh render đã đọc · figScale: px ảnh / đơn vị Figma
 * app: { png (ảnh chụp đã đọc), win { width, height } (đơn vị app), elements (parseSource), ocr (dòng OCR, tỉ lệ 0..1), unit ('pt' | 'dp') }
 * opts: { u (đơn vị app / đơn vị Figma), tolerance, ignore: [chuỗi / regex chữ động, vd giờ, tên người dùng], screen }
 */
export function compareScreen(fig, figPng, figScale, app, opts = {}) {
  const tol = { ...DEFAULT_TOLERANCE, ...(opts.tolerance || {}) };
  const u = opts.u || 1;
  const unit = app.unit || 'pt';
  const S = opts.screen || 'này';
  const toUnit = (v) => v / u; // đơn vị app → pt / dp (đơn vị Figma) để ghi vào bug
  const win = app.win;
  const ignore = (opts.ignore || []).map((x) => (x instanceof RegExp ? x : new RegExp(String(x), 'i')));
  const ignored = (t) => ignore.some((re) => re.test(t));
  const map = layoutMap(fig.node, win, u);
  // Ảnh 2 bên về cùng tỉ lệ W px / đơn vị app. Ảnh Figma: đặt từ góc trên-trái theo đơn vị app (không kéo giãn)
  const A = resize(app.png, win.width * W, win.height * W);
  const F = resize(figPng, (figPng.width / figScale) * u * W, (figPng.height / figScale) * u * W);
  const figBoxOf = (n) => ({ x: n.box.x * u, y: n.box.y * u, width: n.box.width * u, height: n.box.height * u });
  const toW = (b) => scaleBox(b, W);
  const fromW = (b) => scaleBox(b, 1 / W);
  const onScreen = (b) => b.y < win.height - 2 && b.y + b.height > 2;
  const findings = [];
  const usedApp = new Set();
  const matched = []; // khung đã giải thích (2 bên) → loại khỏi so pixel
  const skipped = []; // phần tử Figma ngoài màn hình (frame dài hơn máy, phải cuộn)
  const elements = (app.elements || []).filter((e) => e.text);
  const ocr = (app.ocr || []).map((l) => ({ ...l, box: { x: l.x * win.width, y: l.y * win.height, width: l.w * win.width, height: l.h * win.height } }));
  const add = (f) => findings.push({ severity: 'Trivial', missing: false, ...f });

  // ---------- Chữ ----------
  for (const t of fig.texts) {
    const exp = map.get(t.id);
    if (!exp) continue;
    if (!onScreen(exp)) { skipped.push(t.text); continue; }
    if (ignored(t.text)) { matched.push(exp, figBoxOf(t)); continue; }
    const want = norm(t.text);
    const label = oneLine(t.text);
    // Chữ thật trên app ở gần chỗ Figma đặt: page source (khớp nguyên văn) rồi tới OCR
    const near = (b) => dist(b, exp) <= Math.max(120, exp.height * 4) * u;
    // Phần tử chữ (StaticText / TextView) trước nút / ô chứa cùng chữ, rồi theo khoảng cách
    const isText = (e) => /Text|Label/i.test(e.type) && !/Field|Input|Edit/i.test(e.type);
    const fromSource = elements.filter((e) => norm(e.text) === want && near(e.rect))
      .sort((a, b) => Number(isText(b)) - Number(isText(a)) || dist(a.rect, exp) - dist(b.rect, exp));
    const fromOcr = ocrMatches(app.ocr || [], t.text).map((b) => ({ x: b.x * win.width, y: b.y * win.height, width: b.width * win.width, height: b.height * win.height }))
      .filter(near).sort((a, b) => dist(a, exp) - dist(b, exp));
    const srcEl = fromSource.find((e) => !usedApp.has(e));
    let found = srcEl?.rect || fromOcr[0] || null;
    let tight = !srcEl || isText(srcEl); // khung sát chữ (label / OCR) hay khung cả nút / ô chứa chữ
    if (srcEl && fromOcr[0] && inter(srcEl.rect, fromOcr[0]) > 0) { found = fromOcr[0]; tight = true; } // OCR khít chữ hơn khung label
    const fBox = figBoxOf(t);
    if (!found) {
      // Cùng chỗ có chữ khác → sai nội dung; không có gì → thiếu
      const other = [...elements.filter((e) => !usedApp.has(e)).map((e) => ({ text: e.text, box: e.rect, src: e })), ...ocr.map((l) => ({ text: l.text, box: l.box }))]
        .filter((x) => norm(x.text) && norm(x.text) !== want && inter(x.box, exp) > 0.3 * Math.min(area(x.box), area(exp)))
        .sort((a, b) => inter(b.box, exp) - inter(a.box, exp))[0];
      if (other) {
        if (other.src) usedApp.add(other.src);
        matched.push(exp, other.box, fBox);
        add({ cat: 'text', kind: 'text', target: label, severity: 'Minor', figBox: fBox, appBox: other.box,
          short: `Hiển thị ${q(oneLine(other.text))} thay vì ${q(label)} (theo Figma)`,
          actual: `Màn ${S} hiển thị ${q(oneLine(other.text))}.`, expected: `Màn ${S} hiển thị ${q(label)} (theo Figma).`,
          actualRaw: other.text, expectedRaw: t.text });
      } else {
        matched.push(fBox);
        add({ cat: 'text', kind: 'missing', target: label, severity: 'Minor', figBox: fBox, appBox: exp, missing: true,
          short: `Thiếu chữ ${q(label)} so với Figma`,
          actual: `Màn ${S} không có ${q(label)}.`, expected: `Màn ${S} có ${q(label)} (theo Figma).`,
          actualRaw: null, expectedRaw: t.text });
      }
      continue;
    }
    if (srcEl) usedApp.add(srcEl);
    // Khung khít chữ (bỏ khoảng trống của text box) 2 bên, cùng cách đo → so được vị trí / cỡ chữ / màu
    const fBg = edgeColor(F, toW(fBox));
    const fInk = inkBox(F, toW(fBox), fBg);
    matched.push(pad(exp, 2), pad(found, 2), pad(fBox, 2));
    if (!fInk) continue;
    const fg = fromW(fInk);
    // Vùng dò chữ trên app: label / OCR → nới 2 đơn vị; nút / ô (khung to hơn chữ, góc bo lộ nền ngoài) → dải giữa, bỏ 2 đầu bo góc
    let region = pad(found, 2);
    if (!tight) {
      const bandH = Math.min(found.height, fg.height * 1.8 + 4);
      const inset = Math.min(found.height / 2, Math.max(0, (found.width - fg.width) / 2 - 2));
      region = { x: found.x + inset, y: found.y + (found.height - bandH) / 2, width: Math.max(1, found.width - 2 * inset), height: bandH };
    }
    const aBg = edgeColor(A, toW(region));
    const aInk = inkBox(A, toW(region), aBg);
    if (!aInk) continue;
    const ag = fromW(aInk);
    // Vị trí mong đợi của khung chữ trên app = khung Figma dời theo constraints
    const eg = { x: fg.x - fBox.x + exp.x, y: fg.y - fBox.y + exp.y, width: fg.width, height: fg.height };
    const fl = lineCount(F, fInk, fBg);
    const al = lineCount(A, aInk, aBg);
    if (fl && al && fl !== al) {
      add({ cat: 'text', kind: 'lines', target: label, severity: 'Trivial', figBox: fBox, appBox: found,
        short: `${q(label)} hiển thị ${al} dòng, Figma ${fl} dòng`,
        actual: `${q(label)} xuống thành ${al} dòng trên màn ${S}.`, expected: `${q(label)} hiển thị ${fl} dòng (theo Figma).`,
        actualRaw: al, expectedRaw: fl });
    }
    // Vị trí theo kiểu căn lề của chữ
    const ax = t.align === 'CENTER' ? ag.x + ag.width / 2 : t.align === 'RIGHT' ? ag.x + ag.width : ag.x;
    const ex = t.align === 'CENTER' ? eg.x + eg.width / 2 : t.align === 'RIGHT' ? eg.x + eg.width : eg.x;
    const dx = ax - ex;
    const dy = ag.y - eg.y;
    const lim = tol.position * u;
    if (Math.abs(dx) > lim || Math.abs(dy) > lim) {
      const big = Math.max(Math.abs(dx), Math.abs(dy)) > 3 * lim;
      add({ cat: 'layout', kind: 'position', target: label, severity: big ? 'Minor' : 'Trivial', figBox: fBox, appBox: found,
        short: `${q(label)} lệch ${shiftText(toUnit(dx), toUnit(dy), unit)} so với Figma`,
        actual: `${q(label)} nằm ở x=${r1(toUnit(ag.x))}, y=${r1(toUnit(ag.y))}${unit}, lệch ${shiftText(toUnit(dx), toUnit(dy), unit)}.`,
        expected: `${q(label)} ở x=${r1(toUnit(eg.x))}, y=${r1(toUnit(eg.y))}${unit} (theo Figma).`,
        actualRaw: [r1(toUnit(ag.x)), r1(toUnit(ag.y))], expectedRaw: [r1(toUnit(eg.x)), r1(toUnit(eg.y))] });
    }
    // Cỡ chữ: cùng nội dung, cùng số dòng → tỉ lệ chiều cao khung chữ = tỉ lệ cỡ chữ
    if (t.fontSize && fl === 1 && al === 1) {
      const ratio = ag.height / fg.height;
      const est = r1(t.fontSize * ratio);
      if (Math.abs(ratio - 1) > tol.font && Math.abs(est - t.fontSize) >= 1.5) {
        add({ cat: 'font', kind: 'font', target: label, severity: Math.abs(ratio - 1) > 0.25 ? 'Minor' : 'Trivial', figBox: fBox, appBox: found,
          short: `Cỡ chữ ${q(label)} ≈ ${est}${unit}, Figma ${t.fontSize}${unit}`,
          actual: `${q(label)} có cỡ chữ khoảng ${est}${unit} (chữ ${ratio > 1 ? 'to' : 'nhỏ'} hơn ${Math.round(Math.abs(ratio - 1) * 100)}%).`,
          expected: `${q(label)} cỡ ${t.fontSize}${unit}${t.fontWeight ? `, weight ${t.fontWeight}` : ''}${t.fontFamily ? ` (${t.fontFamily})` : ''} (theo Figma).`,
          actualRaw: est, expectedRaw: t.fontSize });
      }
    }
    // Màu chữ: so mực 2 bên (cùng khử răng cưa) — ghi màu Figma theo màu tô của layer
    const fc = inkColor(F, fInk, fBg);
    const ac = inkColor(A, aInk, aBg);
    if (fc && ac) {
      const d = deltaE(fc.rgb, ac.rgb);
      if (d > tol.color) {
        const want_ = t.color ? hex(fromFigma(t.color)) : hex(fc.rgb);
        add({ cat: 'color', kind: 'text-color', target: label, severity: d > 25 ? 'Minor' : 'Trivial', figBox: fBox, appBox: found,
          short: `Màu chữ ${q(label)} là ${hex(ac.rgb)}, Figma ${want_}`,
          actual: `${q(label)} có màu ${hex(ac.rgb)} (lệch ΔE ${Math.round(d)}).`, expected: `${q(label)} màu ${want_} (theo Figma).`,
          actualRaw: hex(ac.rgb), expectedRaw: want_ });
      }
    }
  }

  // ---------- Khối màu, icon, ảnh ----------
  const nameOf = (s) => {
    if (s.name && !GENERIC.test(s.name.trim())) return s.name.trim();
    const inside = fig.texts.find((t) => inter(t.box, s.box) > 0.8 * area(t.box));
    if (inside) return `${s.kind === 'block' ? 'nút / khối' : s.kind} ${q(oneLine(inside.text, 30))}`;
    return `${s.kind === 'icon' ? 'icon' : s.kind === 'image' ? 'ảnh' : 'khối'} ở x=${Math.round(s.box.x)}, y=${Math.round(s.box.y)}`;
  };
  for (const s of fig.shapes) {
    const exp = map.get(s.id);
    if (!exp || !onScreen(exp)) continue;
    const fBox = figBoxOf(s);
    const name = nameOf(s);
    if (s.kind === 'block') {
      // Màu nền: màu chiếm nhiều nhất trong khối (bỏ viền) 2 bên
      const inner = (b) => ({ x: b.x + b.width * 0.1, y: b.y + b.height * 0.1, width: b.width * 0.8, height: b.height * 0.8 });
      const fd = dominant(F, toW(inner(fBox)));
      const ad = dominant(A, toW(inner(exp)));
      if (!fd || !ad || fd.share < 0.35) continue;
      // Khối cùng màu với nền xung quanh (vd thẻ trắng trên nền trắng) → không đo được kích thước, chỉ so màu.
      // Màu quanh khối: 4 dải sát bên ngoài (dải nằm ngoài ảnh → bỏ)
      const ring = [{ x: fBox.x, y: fBox.y - 4, width: fBox.width, height: 3 }, { x: fBox.x, y: fBox.y + fBox.height + 1, width: fBox.width, height: 3 },
        { x: fBox.x - 4, y: fBox.y, width: 3, height: fBox.height }, { x: fBox.x + fBox.width + 1, y: fBox.y, width: 3, height: fBox.height }]
        .filter((b) => b.x >= 0 && b.y >= 0 && b.x + b.width <= F.width / W && b.y + b.height <= F.height / W)
        .map((b) => dominant(F, toW(b))?.rgb).filter(Boolean);
      const distinct = ring.length > 0 && ring.every((c) => deltaE(c, fd.rgb) > 6);
      const d = deltaE(fd.rgb, ad.rgb);
      if (d > tol.color && ad.share > 0.3) {
        const want_ = s.color ? hex(fromFigma(s.color)) : hex(fd.rgb);
        matched.push(exp, fBox);
        add({ cat: 'color', kind: 'fill', target: name, severity: d > 25 ? 'Minor' : 'Trivial', figBox: fBox, appBox: exp,
          short: `Màu nền ${name} là ${hex(ad.rgb)}, Figma ${want_}`,
          actual: `${name} có màu nền ${hex(ad.rgb)} (lệch ΔE ${Math.round(d)}).`, expected: `${name} màu nền ${want_} (theo Figma).`,
          actualRaw: hex(ad.rgb), expectedRaw: want_ });
        continue;
      }
      if (!distinct) { matched.push(exp, fBox); continue; }
      // Kích thước / vị trí thật: vùng cùng màu quanh tâm khối trên app
      const [cx, cy] = center(toW(exp));
      const ext = colorExtent(A, cx, cy, ad.rgb, { max: Math.max(exp.width, exp.height) * W * 1.6 });
      if (!ext) continue;
      const got = fromW(ext);
      if (got.width > exp.width * 1.5 + 8 || got.height > exp.height * 1.5 + 8) { matched.push(exp, fBox); continue; } // tràn ra nền → không tin được
      matched.push(pad(exp, 2), pad(got, 2), pad(fBox, 2));
      const dw = got.width - exp.width;
      const dh = got.height - exp.height;
      const lim = Math.max(tol.position * u, 0);
      if ((Math.abs(dw) > lim && Math.abs(dw) / exp.width > tol.size) || (Math.abs(dh) > lim && Math.abs(dh) / exp.height > tol.size)) {
        const rel = Math.max(Math.abs(dw) / exp.width, Math.abs(dh) / exp.height);
        add({ cat: 'layout', kind: 'size', target: name, severity: rel > 0.2 ? 'Minor' : 'Trivial', figBox: fBox, appBox: got,
          short: `${name} kích thước ${r1(toUnit(got.width))}×${r1(toUnit(got.height))}${unit}, Figma ${r1(toUnit(exp.width))}×${r1(toUnit(exp.height))}${unit}`,
          actual: `${name} rộng ${r1(toUnit(got.width))}${unit}, cao ${r1(toUnit(got.height))}${unit}.`,
          expected: `${name} rộng ${r1(toUnit(exp.width))}${unit}, cao ${r1(toUnit(exp.height))}${unit} (theo Figma).`,
          actualRaw: [r1(toUnit(got.width)), r1(toUnit(got.height))], expectedRaw: [r1(toUnit(exp.width)), r1(toUnit(exp.height))] });
        continue;
      }
      const dx = got.x - exp.x;
      const dy = got.y - exp.y;
      if (Math.abs(dx) > lim || Math.abs(dy) > lim) {
        add({ cat: 'layout', kind: 'position', target: name, severity: Math.max(Math.abs(dx), Math.abs(dy)) > 3 * lim ? 'Minor' : 'Trivial', figBox: fBox, appBox: got,
          short: `${name} lệch ${shiftText(toUnit(dx), toUnit(dy), unit)} so với Figma`,
          actual: `${name} nằm ở x=${r1(toUnit(got.x))}, y=${r1(toUnit(got.y))}${unit}.`, expected: `${name} ở x=${r1(toUnit(exp.x))}, y=${r1(toUnit(exp.y))}${unit} (theo Figma).`,
          actualRaw: [r1(toUnit(got.x)), r1(toUnit(got.y))], expectedRaw: [r1(toUnit(exp.x)), r1(toUnit(exp.y))] });
      }
      continue;
    }
    if (s.kind === 'image') {
      // Ảnh nội dung (thường là ảnh thật từ server khác ảnh mẫu trong Figma) → chỉ kiểm có ảnh ở đúng chỗ, không so từng pixel
      const ad = dominant(A, toW(exp));
      if (ad && ad.share > 0.9) {
        matched.push(fBox);
        add({ cat: 'image', kind: 'image-missing', target: name, severity: 'Minor', figBox: fBox, appBox: exp, missing: true,
          short: `Không thấy ${name} so với Figma`, actual: `Chỗ của ${name} trên màn ${S} chỉ có nền trơn ${hex(ad.rgb)}.`,
          expected: `Màn ${S} có ${name} (theo Figma).`, actualRaw: null, expectedRaw: name });
      } else matched.push(exp, fBox);
      continue;
    }
    // Icon: dò mẫu Figma trên ảnh app quanh chỗ mong đợi
    const tpl = crop(F, toW(fBox));
    const r = Math.round(Math.min(60, Math.max(16, Math.max(exp.width, exp.height) * 0.6)) * u * W);
    const hit = findTemplate(A, tpl, Math.round(exp.x * W), Math.round(exp.y * W), r);
    if (!hit) continue;
    if (hit.score <= 0.1) {
      const got = { x: hit.x / W, y: hit.y / W, width: fBox.width, height: fBox.height };
      matched.push(pad(got, 2), pad(fBox, 2), pad(exp, 2));
      const dx = got.x - exp.x;
      const dy = got.y - exp.y;
      const lim = tol.position * u;
      if (Math.abs(dx) > lim || Math.abs(dy) > lim) {
        add({ cat: 'layout', kind: 'position', target: name, severity: Math.max(Math.abs(dx), Math.abs(dy)) > 3 * lim ? 'Minor' : 'Trivial', figBox: fBox, appBox: got,
          short: `${name} lệch ${shiftText(toUnit(dx), toUnit(dy), unit)} so với Figma`,
          actual: `${name} nằm ở x=${r1(toUnit(got.x))}, y=${r1(toUnit(got.y))}${unit}.`, expected: `${name} ở x=${r1(toUnit(exp.x))}, y=${r1(toUnit(exp.y))}${unit} (theo Figma).`,
          actualRaw: [r1(toUnit(got.x)), r1(toUnit(got.y))], expectedRaw: [r1(toUnit(exp.x)), r1(toUnit(exp.y))] });
      }
    } else if (hit.score >= 0.22) {
      matched.push(pad(fBox, 2), pad(exp, 2));
      const blankSpot = (dominant(A, toW(exp))?.share || 0) > 0.92;
      add({ cat: 'image', kind: blankSpot ? 'icon-missing' : 'icon', target: name, severity: 'Minor', figBox: fBox, appBox: exp, missing: blankSpot,
        short: blankSpot ? `Không thấy ${name} so với Figma` : `${name} khác Figma`,
        actual: blankSpot ? `Chỗ của ${name} trên màn ${S} để trống.` : `${name} trên màn ${S} trông khác Figma (khác ${Math.round(hit.score * 100)}%).`,
        expected: `${name} giống Figma.`, actualRaw: Math.round(hit.score * 100), expectedRaw: 0 });
    } else matched.push(pad(fBox, 2), pad(exp, 2));
  }

  // ---------- Vùng khác còn lại (so pixel): phần không thuộc phần tử nào đã so ----------
  // Bỏ: thanh trạng thái / home (layer hệ thống của Figma hoặc 54 / 34 đơn vị trên-dưới), chữ động người dùng khai báo
  const sys = [{ x: 0, y: 0, width: win.width, height: 54 * u }, { x: 0, y: win.height - 34 * u, width: win.width, height: 34 * u },
    ...fig.ignored.map((x) => ({ x: x.box.x * u, y: x.box.y * u, width: x.box.width * u, height: x.box.height * u }))];
  const ignoredText = [...elements.filter((e) => ignored(e.text)).map((e) => e.rect), ...ocr.filter((l) => ignored(l.text)).map((l) => l.box)];
  const h = Math.min(A.height, F.height);
  const a1 = resize(crop(A, { x: 0, y: 0, width: A.width, height: h }), A.width / W, h / W);
  const f1 = resize(crop(F, { x: 0, y: 0, width: Math.min(A.width, F.width), height: h }), A.width / W, h / W);
  const regions = diffRegions(a1, f1, { thr: 60, minArea: 400, mask: [...sys, ...matched, ...ignoredText].map((b) => pad(b, 3)) }).slice(0, 5);
  for (const g of regions) {
    add({ cat: 'image', kind: 'region', target: `vùng x=${Math.round(toUnit(g.x))}, y=${Math.round(toUnit(g.y))}`, severity: 'Trivial', figBox: g, appBox: g,
      short: `Vùng ${Math.round(toUnit(g.width))}×${Math.round(toUnit(g.height))}${unit} ở x=${Math.round(toUnit(g.x))}, y=${Math.round(toUnit(g.y))} khác Figma`,
      actual: `Vùng ${Math.round(toUnit(g.width))}×${Math.round(toUnit(g.height))}${unit} ở x=${Math.round(toUnit(g.x))}, y=${Math.round(toUnit(g.y))} trên màn ${S} khác Figma (thừa / thiếu / khác nội dung).`,
      expected: 'Vùng này giống Figma.', actualRaw: [g.x, g.y, g.width, g.height], expectedRaw: null });
  }
  return { findings, skipped, checked: { texts: fig.texts.length, shapes: fig.shapes.length } };
}

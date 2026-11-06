// Xử lý ảnh cho so UI với Figma (thuần JS trên PNG của pngjs → test được không cần thiết bị).
// Ảnh: { width, height, data (RGBA) }. Khung: { x, y, width, height } theo pixel của ảnh đó.
import { PNG } from 'pngjs';

export const readPng = (buf) => PNG.sync.read(Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'base64'));
export const writePng = (img) => PNG.sync.write(Object.assign(new PNG({ width: img.width, height: img.height }), { data: img.data }));
export const blank = (width, height, rgb = [255, 255, 255]) => {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) [data[i], data[i + 1], data[i + 2], data[i + 3]] = [...rgb, 255];
  return { width, height, data };
};

export const px = (img, x, y) => {
  const i = (img.width * y + x) << 2;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Phóng / thu ảnh về đúng kích thước (song tuyến; thu nhỏ nhiều lần → lấy trung bình vùng để không răng cưa)
export function resize(img, width, height) {
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  const out = Buffer.alloc(width * height * 4);
  const sx = img.width / width;
  const sy = img.height / height;
  if (sx >= 2 || sy >= 2) {
    for (let y = 0; y < height; y++) {
      const y0 = Math.floor(y * sy);
      const y1 = Math.max(y0 + 1, Math.min(img.height, Math.floor((y + 1) * sy)));
      for (let x = 0; x < width; x++) {
        const x0 = Math.floor(x * sx);
        const x1 = Math.max(x0 + 1, Math.min(img.width, Math.floor((x + 1) * sx)));
        const acc = [0, 0, 0, 0];
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = x0; xx < x1; xx++) {
            const i = (img.width * yy + xx) << 2;
            acc[0] += img.data[i]; acc[1] += img.data[i + 1]; acc[2] += img.data[i + 2]; acc[3] += img.data[i + 3];
          }
        }
        const n = (y1 - y0) * (x1 - x0);
        const o = (width * y + x) << 2;
        for (let c = 0; c < 4; c++) out[o + c] = Math.round(acc[c] / n);
      }
    }
    return { width, height, data: out };
  }
  for (let y = 0; y < height; y++) {
    const fy = clamp((y + 0.5) * sy - 0.5, 0, img.height - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(img.height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = clamp((x + 0.5) * sx - 0.5, 0, img.width - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(img.width - 1, x0 + 1);
      const wx = fx - x0;
      const o = (width * y + x) << 2;
      for (let c = 0; c < 4; c++) {
        const a = img.data[((img.width * y0 + x0) << 2) + c];
        const b = img.data[((img.width * y0 + x1) << 2) + c];
        const d = img.data[((img.width * y1 + x0) << 2) + c];
        const e = img.data[((img.width * y1 + x1) << 2) + c];
        out[o + c] = Math.round((a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy);
      }
    }
  }
  return { width, height, data: out };
}

// Cắt vùng (khung vượt mép ảnh → cắt phần nằm trong ảnh)
export function crop(img, box) {
  const x0 = clamp(Math.round(box.x), 0, img.width);
  const y0 = clamp(Math.round(box.y), 0, img.height);
  const x1 = clamp(Math.round(box.x + box.width), 0, img.width);
  const y1 = clamp(Math.round(box.y + box.height), 0, img.height);
  const width = Math.max(0, x1 - x0);
  const height = Math.max(0, y1 - y0);
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) img.data.copy(data, width * y * 4, ((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x1) * 4);
  return { width, height, data };
}

// Dán ảnh src lên dst tại (x, y)
export function paste(dst, src, x, y) {
  for (let yy = 0; yy < src.height; yy++) {
    const ty = y + yy;
    if (ty < 0 || ty >= dst.height) continue;
    for (let xx = 0; xx < src.width; xx++) {
      const tx = x + xx;
      if (tx < 0 || tx >= dst.width) continue;
      src.data.copy(dst.data, (ty * dst.width + tx) * 4, (yy * src.width + xx) * 4, (yy * src.width + xx) * 4 + 4);
    }
  }
}

// ---- Màu ----
export const hex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
// Figma: { r, g, b } 0..1 → [0..255]
export const fromFigma = (c) => [c.r * 255, c.g * 255, c.b * 255].map(Math.round);

function toLab([r, g, b]) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
// Độ lệch màu cảm nhận (CIE76): < 3 khó thấy, > 10 thấy rõ
export function deltaE(a, b) {
  const [x, y] = [toLab(a), toLab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
const maxDiff = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

// Màu xuất hiện nhiều nhất trong vùng (gom màu gần nhau theo bậc 8) → màu nền / màu khối
export function dominant(img, box = { x: 0, y: 0, width: img.width, height: img.height }) {
  const c = crop(img, box);
  const bins = new Map();
  for (let i = 0; i < c.data.length; i += 4) {
    const k = ((c.data[i] >> 3) << 10) | ((c.data[i + 1] >> 3) << 5) | (c.data[i + 2] >> 3);
    const b = bins.get(k) || [0, 0, 0, 0];
    b[0] += c.data[i]; b[1] += c.data[i + 1]; b[2] += c.data[i + 2]; b[3]++;
    bins.set(k, b);
  }
  let best = null;
  for (const b of bins.values()) if (!best || b[3] > best[3]) best = b;
  if (!best) return null;
  return { rgb: [best[0] / best[3], best[1] / best[3], best[2] / best[3]].map(Math.round), share: best[3] / (c.width * c.height) };
}

// Màu nền quanh nội dung = màu nhiều nhất trên viền (2 px) của vùng — không lấy cả vùng: chữ to / đậm có thể chiếm quá nửa vùng
export function edgeColor(img, box) {
  const x0 = clamp(Math.round(box.x), 0, img.width - 1);
  const y0 = clamp(Math.round(box.y), 0, img.height - 1);
  const x1 = clamp(Math.round(box.x + box.width) - 1, 0, img.width - 1);
  const y1 = clamp(Math.round(box.y + box.height) - 1, 0, img.height - 1);
  const bins = new Map();
  const put = (x, y) => {
    const p = px(img, x, y);
    const k = ((p[0] >> 3) << 10) | ((p[1] >> 3) << 5) | (p[2] >> 3);
    const b = bins.get(k) || [0, 0, 0, 0];
    b[0] += p[0]; b[1] += p[1]; b[2] += p[2]; b[3]++;
    bins.set(k, b);
  };
  for (let t = 0; t < 2; t++) {
    for (let x = x0; x <= x1; x++) { put(x, Math.min(y1, y0 + t)); put(x, Math.max(y0, y1 - t)); }
    for (let y = y0; y <= y1; y++) { put(Math.min(x1, x0 + t), y); put(Math.max(x0, x1 - t), y); }
  }
  let best = null;
  for (const b of bins.values()) if (!best || b[3] > best[3]) best = b;
  return best ? [best[0] / best[3], best[1] / best[3], best[2] / best[3]].map(Math.round) : null;
}

// Màu "mực" (chữ / nét vẽ) trong vùng: các pixel khác nền nhiều nhất → trung bình nửa đậm nhất (bỏ viền khử răng cưa).
// bg: màu nền đã biết (vd edgeColor của vùng rộng hơn) — vùng khít chữ thì viền chính là chữ, phải truyền vào
export function inkColor(img, box, bg = edgeColor(img, box)) {
  if (!bg) return null;
  const c = crop(img, box);
  const ink = [];
  for (let i = 0; i < c.data.length; i += 4) {
    const p = [c.data[i], c.data[i + 1], c.data[i + 2]];
    const d = maxDiff(p, bg);
    if (d > 40) ink.push([d, p]);
  }
  if (ink.length < 4) return null;
  ink.sort((a, b) => b[0] - a[0]);
  const top = ink.slice(0, Math.max(4, Math.ceil(ink.length / 2)));
  const avg = [0, 1, 2].map((k) => Math.round(top.reduce((s, [, p]) => s + p[k], 0) / top.length));
  return { rgb: avg, bg };
}

// Khung bao phần "mực" trong vùng (bỏ nền) → khít chữ / icon; không có mực → null
export function inkBox(img, box, bg = edgeColor(img, box)) {
  if (!bg) return null;
  const x0 = clamp(Math.round(box.x), 0, img.width - 1);
  const y0 = clamp(Math.round(box.y), 0, img.height - 1);
  const x1 = clamp(Math.round(box.x + box.width) - 1, 0, img.width - 1);
  const y1 = clamp(Math.round(box.y + box.height) - 1, 0, img.height - 1);
  let [l, t, r, b] = [Infinity, Infinity, -1, -1];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (maxDiff(px(img, x, y), bg) > 40) {
        if (x < l) l = x;
        if (x > r) r = x;
        if (y < t) t = y;
        if (y > b) b = y;
      }
    }
  }
  return r < 0 ? null : { x: l, y: t, width: r - l + 1, height: b - t + 1 };
}

// Vùng cùng màu quanh điểm (cx, cy): đi ra 4 hướng tới khi gặp màu khác → khung khối màu (nút, thẻ). Dùng hàng / cột qua tâm
// và vài hàng / cột lệch tâm, lấy trung vị (chữ trên nút không cắt ngang khung)
export function colorExtent(img, cx, cy, rgb, { tol = 18, max = Infinity } = {}) {
  const same = (x, y) => x >= 0 && y >= 0 && x < img.width && y < img.height && maxDiff(px(img, x, y), rgb) <= tol;
  const walk = (x, y, dx, dy) => {
    let n = 0;
    while (n < max && same(x + dx * (n + 1), y + dy * (n + 1))) n++;
    return n;
  };
  const med = (a) => (a.length ? a.sort((p, q) => p - q)[Math.floor(a.length / 2)] : null);
  const offs = [-0.35, -0.2, 0, 0.2, 0.35];
  cx = Math.round(cx);
  cy = Math.round(cy);
  // Tâm khối có thể rơi vào chữ / icon trên khối → dò điểm cùng màu gần tâm (lệch dọc trước: chữ thường nằm ngang)
  if (!same(cx, cy)) {
    const seed = [2, 4, 6, 9, 12, 16, 20, 26, 32].flatMap((d) => [[0, -d], [0, d], [-d, 0], [d, 0]]).find(([dx, dy]) => same(cx + dx, cy + dy));
    if (!seed) return null;
    cx += seed[0];
    cy += seed[1];
  }
  // Lượt 1: khung thô quanh điểm bắt đầu → tâm khối
  const h0 = walk(cx, cy, 0, -1) + walk(cx, cy, 0, 1) + 1;
  const w0 = walk(cx, cy, -1, 0) + walk(cx, cy, 1, 0) + 1;
  const mx = cx - walk(cx, cy, -1, 0) + Math.floor(w0 / 2);
  const my = cy - walk(cx, cy, 0, -1) + Math.floor(h0 / 2);
  // Lượt 2: đo mép trên nhiều hàng / cột qua điểm bắt đầu; hàng / cột bị chữ, icon trên khối chặn sẽ ngắn hơn → lấy mép xa nhất
  // (khối chữ nhật: mép thật là mép xa nhất; tràn ra nền thì nơi gọi tự loại khi khung to bất thường)
  const xs = offs.map((f) => Math.round(cx + f * w0)).concat(offs.map((f) => Math.round(mx + f * w0)));
  const ys = offs.map((f) => Math.round(cy + f * h0)).concat(offs.map((f) => Math.round(my + f * h0)));
  const far = (vals, pick) => (vals.length ? pick(...vals) : null);
  const left = far(ys.filter((y) => same(cx, y)).map((y) => cx - walk(cx, y, -1, 0)), Math.min);
  const right = far(ys.filter((y) => same(cx, y)).map((y) => cx + walk(cx, y, 1, 0)), Math.max);
  // Cột đi qua điểm bắt đầu theo hàng cy (điểm chắc chắn cùng màu) → lên / xuống
  const cols = xs.filter((x) => same(x, cy));
  const top = far(cols.map((x) => cy - walk(x, cy, 0, -1)), Math.min);
  const bottom = far(cols.map((x) => cy + walk(x, cy, 0, 1)), Math.max);
  if ([left, right, top, bottom].includes(null)) return { x: cx - walk(cx, cy, -1, 0), y: cy - walk(cx, cy, 0, -1), width: w0, height: h0 };
  void med;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

// Độ khác trung bình (0..1) giữa 2 ảnh cùng kích thước
export function meanDiff(a, b) {
  let s = 0;
  const n = Math.min(a.data.length, b.data.length);
  for (let i = 0; i < n; i += 4) s += (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])) / 3;
  return n ? s / (n / 4) / 255 : 1;
}

// Tìm mẫu (tpl) trong ảnh quanh vị trí (x, y), lệch tối đa ±r pixel. → { x, y, score } (score: độ khác 0..1, nhỏ = giống)
export function findTemplate(img, tpl, x, y, r) {
  if (!tpl.width || !tpl.height) return null;
  // Thu nhỏ mẫu lớn để dò nhanh (mỗi chiều ≤ 48 px), rồi dò lại quanh điểm tốt nhất ở kích thước thật
  const k = Math.min(1, 48 / Math.max(tpl.width, tpl.height));
  const diffAt = (im, tp, ox, oy, step) => {
    let s = 0;
    let n = 0;
    for (let yy = 0; yy < tp.height; yy += step) {
      const iy = oy + yy;
      if (iy < 0 || iy >= im.height) { s += tp.width / step; n += tp.width / step; continue; }
      for (let xx = 0; xx < tp.width; xx += step) {
        const ix = ox + xx;
        n++;
        if (ix < 0 || ix >= im.width) { s += 1; continue; }
        const i = (iy * im.width + ix) << 2;
        const j = (yy * tp.width + xx) << 2;
        s += (Math.abs(im.data[i] - tp.data[j]) + Math.abs(im.data[i + 1] - tp.data[j + 1]) + Math.abs(im.data[i + 2] - tp.data[j + 2])) / 765;
      }
    }
    return n ? s / n : 1;
  };
  let best = { x, y, score: Infinity };
  const coarse = Math.max(1, Math.round(1 / k));
  const step = Math.max(1, Math.round(r / 12));
  for (let dy = -r; dy <= r; dy += step) {
    for (let dx = -r; dx <= r; dx += step) {
      const sc = diffAt(img, tpl, x + dx, y + dy, coarse);
      if (sc < best.score) best = { x: x + dx, y: y + dy, score: sc };
    }
  }
  const fine = { ...best };
  for (let dy = -step; dy <= step; dy++) {
    for (let dx = -step; dx <= step; dx++) {
      const sc = diffAt(img, tpl, best.x + dx, best.y + dy, 1);
      if (sc < fine.score || (dx === 0 && dy === 0 && sc <= fine.score)) Object.assign(fine, { x: best.x + dx, y: best.y + dy, score: sc });
    }
  }
  return fine;
}

// Vùng khác nhau giữa 2 ảnh cùng kích thước: pixel lệch > thr trên kênh lệch nhiều nhất, bỏ pixel nằm trong mask
// → các khung (thành phần liên thông, nối các điểm gần nhau trong bán kính join) có diện tích ≥ minArea
export function diffRegions(a, b, { thr = 48, mask = [], minArea = 200, join = 3 } = {}) {
  const { width: w, height: h } = a;
  const masked = new Uint8Array(w * h);
  for (const m of mask) {
    for (let y = Math.max(0, Math.floor(m.y)); y < Math.min(h, Math.ceil(m.y + m.height)); y++) {
      for (let x = Math.max(0, Math.floor(m.x)); x < Math.min(w, Math.ceil(m.x + m.width)); x++) masked[y * w + x] = 1;
    }
  }
  const on = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (masked[i]) continue;
    const j = i << 2;
    if (Math.max(Math.abs(a.data[j] - b.data[j]), Math.abs(a.data[j + 1] - b.data[j + 1]), Math.abs(a.data[j + 2] - b.data[j + 2])) > thr) on[i] = 1;
  }
  const seen = new Uint8Array(w * h);
  const out = [];
  for (let i = 0; i < w * h; i++) {
    if (!on[i] || seen[i]) continue;
    let [l, t, r, btm, count] = [w, h, 0, 0, 0];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      const y = (p - x) / w;
      count++;
      if (x < l) l = x;
      if (x > r) r = x;
      if (y < t) t = y;
      if (y > btm) btm = y;
      for (let dy = -join; dy <= join; dy++) {
        for (let dx = -join; dx <= join; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (on[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
    }
    const box = { x: l, y: t, width: r - l + 1, height: btm - t + 1 };
    if (box.width * box.height >= minArea && count >= minArea / 8) out.push({ ...box, count });
  }
  return out.sort((p, q) => q.count - p.count);
}

// Vẽ khung (đỏ) lên ảnh; dash > 0 → nét đứt
export function strokeBox(img, box, { rgb = [229, 20, 20], thick = 3, dash = 0 } = {}) {
  const [l, t] = [Math.round(box.x), Math.round(box.y)];
  const [r, b] = [Math.round(box.x + box.width), Math.round(box.y + box.height)];
  const paint = (x, y) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    if (dash && Math.floor((x + y) / dash) % 2) return;
    const i = (img.width * y + x) << 2;
    [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]] = [...rgb, 255];
  };
  for (let k = 0; k < thick; k++) {
    for (let x = l - k; x <= r + k; x++) { paint(x, t - k); paint(x, b + k); }
    for (let y = t - k; y <= b + k; y++) { paint(l - k, y); paint(r + k, y); }
  }
}

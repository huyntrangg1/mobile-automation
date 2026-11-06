// So 1 lần chụp với frame Figma (đã nhập từ plugin): chữ, vị trí, kích thước, cỡ chữ, màu, icon / ảnh.
// Dùng lại bộ so của template (compare.js / figma.js / image.js). Chạy trên server, không dùng AI.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { flatten } from '../apps/template/src/design/figma.js';
import { compareScreen, parseSource } from '../apps/template/src/design/compare.js';
import { readPng, writePng, resize, blank, paste, strokeBox } from '../apps/template/src/design/image.js';
import { ocrPng } from '../apps/template/src/runner/ocr.js';

export const REASON = {
  missing: 'Thiếu chữ có trong Figma',
  text: 'Nội dung chữ khác Figma',
  lines: 'Chữ xuống dòng khác Figma',
  position: 'Lệch vị trí so với Figma',
  size: 'Kích thước khác Figma',
  font: 'Cỡ chữ khác Figma',
  'text-color': 'Màu chữ khác Figma',
  fill: 'Màu nền khác Figma',
  icon: 'Icon khác Figma',
  'icon-missing': 'Thiếu icon có trong Figma',
  'image-missing': 'Thiếu ảnh có trong Figma',
  region: 'Vùng màn hình khác Figma (thừa / thiếu / khác nội dung)',
};

// Ảnh evidence: trái Figma, phải app (cùng tỉ lệ), khoanh đỏ chỗ lệch 2 bên; app không có → khung nét đứt chỗ lẽ ra phải hiện
export function writeEvidence({ app, fig, figScale, u, win }, f, outBase) {
  const k = app.width / win.width; // px ảnh app / đơn vị app
  const left = resize(fig, (fig.width / figScale) * u * k, (fig.height / figScale) * u * k);
  const gap = Math.round(16 * k);
  const canvas = blank(left.width + gap + app.width, Math.max(left.height, app.height), [128, 128, 128]);
  paste(canvas, left, 0, 0);
  paste(canvas, app, left.width + gap, 0);
  const box = (b, dx) => ({ x: b.x * k - 6 * k + dx, y: b.y * k - 6 * k, width: b.width * k + 12 * k, height: b.height * k + 12 * k });
  const thick = Math.max(4, Math.round(2.5 * k));
  if (f?.figBox) strokeBox(canvas, box(f.figBox, 0), { thick });
  if (f?.appBox) strokeBox(canvas, box(f.appBox, left.width + gap), { thick, dash: f.missing ? Math.round(10 * k) : 0 });
  const tmp = `${outBase}.png`;
  fs.writeFileSync(tmp, writePng(canvas));
  try {
    execFileSync('sips', ['-Z', '1400', '-s', 'format', 'jpeg', '-s', 'formatOptions', '75', tmp, '--out', `${outBase}.jpg`], { stdio: 'ignore' });
    fs.rmSync(tmp);
    return `${outBase}.jpg`;
  } catch {
    return tmp; // không có sips (không phải macOS) → giữ PNG
  }
}

// Frame đã nhập: { json, png } trên máy → { node, png, scale }; thiếu file → lỗi nói rõ cách sửa
export function loadFrame(frame) {
  if (!frame || !fs.existsSync(frame.json) || !fs.existsSync(frame.png)) throw new Error(`Không thấy file frame Figma "${frame?.name || '?'}" — nhập lại file từ plugin ở AI Smoke Test`);
  const f = JSON.parse(fs.readFileSync(frame.json, 'utf8'));
  return { node: f.node, png: fs.readFileSync(frame.png), scale: f.scale || 1 };
}

// capture: { png (Buffer), xml, win, density, platform } · frame: mục trong app.figmaFrames
// → { status: passed | failed | blocked, findings: [{ kind, cat, target, short, actual, expected, severity, reason, image }], checked, skipped, error }
export async function analyzeCapture({ capture, frame, ignore = [], tolerance = {}, evidenceBase, ocr = ocrPng, maxFindings = 30 }) {
  try {
    const app = readPng(capture.png);
    const u = capture.density || 1;
    const { node, png, scale } = loadFrame(frame);
    const fig = readPng(png);
    const flat = { ...flatten(node), node };
    const lines = await ocr(capture.png).catch(() => []);
    const { findings, skipped, checked } = compareScreen(flat, fig, scale, {
      png: app, win: capture.win, elements: parseSource(capture.xml || ''), ocr: lines, unit: capture.platform === 'Android' ? 'dp' : 'pt',
    }, { u, screen: frame.name, tolerance, ignore });
    const out = findings.slice(0, maxFindings).map((f, i) => ({
      kind: f.kind, cat: f.cat, target: f.target, short: f.short, actual: f.actual, expected: f.expected, severity: f.severity,
      reason: REASON[f.kind] || 'Khác Figma', missing: !!f.missing,
      image: evidenceBase ? writeEvidence({ app, fig, figScale: scale, u, win: capture.win }, f, `${evidenceBase}-${i + 1}`) : null,
    }));
    // Ảnh đặt cạnh nhau không khoanh (thẻ bước khớp vẫn có ảnh để xem)
    const overview = evidenceBase ? writeEvidence({ app, fig, figScale: scale, u, win: capture.win }, null, `${evidenceBase}-0`) : null;
    return { status: out.length ? 'failed' : 'passed', findings: out, overview, checked, skipped: skipped.length, total: findings.length, error: null };
  } catch (e) {
    return { status: 'blocked', findings: [], overview: null, checked: null, skipped: 0, total: 0, error: `So với Figma không được: ${e.message}` };
  }
}

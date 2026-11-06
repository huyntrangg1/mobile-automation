// So các màn đã chụp với Figma, ghi kết quả vào reports/results như 1 test → report chung (skill test-report) dựng bug như điểm kiểm thường.
// Gọi ở onComplete, trước buildHtml. Mỗi màn có link Figma = 1 dòng "UI theo Figma":
//   Passed (khớp) · Failed (có điểm lệch → bug loại UI, gom theo nhóm: chữ / vị trí-kích thước / cỡ chữ / màu / icon-ảnh)
//   Not Run (lần chạy này không đi qua màn đó) · Blocked (không lấy được Figma: thiếu token, link sai…) — không tạo bug
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { designMap, slug } from './map.js';
import { frameOf, flatten } from './figma.js';
import { compareScreen, parseSource } from './compare.js';
import { readPng, writePng, resize, blank, paste, strokeBox } from './image.js';
import { ocrPng } from '../runner/ocr.js';

export const SUITE = 'UI theo Figma';
const KEYWORD = { text: 'Verify design text', layout: 'Verify design layout', font: 'Verify design font', color: 'Verify design color', image: 'Verify design image' };
const REASON = {
  missing: 'Thiếu chữ có trong Figma; chưa thấy ảnh hưởng chức năng',
  text: 'Nội dung chữ khác Figma',
  lines: 'Chữ xuống dòng khác Figma',
  position: 'Lệch vị trí so với Figma, không ảnh hưởng chức năng',
  size: 'Kích thước khác Figma, không ảnh hưởng chức năng',
  font: 'Cỡ chữ khác Figma',
  'text-color': 'Màu chữ khác Figma',
  fill: 'Màu nền khác Figma',
  icon: 'Icon khác Figma',
  'icon-missing': 'Thiếu icon có trong Figma',
  'image-missing': 'Thiếu ảnh có trong Figma',
  region: 'Vùng màn hình khác Figma (thừa / thiếu / khác nội dung)',
};

// Ảnh evidence: trái Figma, phải app (cùng tỉ lệ), khoanh đỏ chỗ lệch 2 bên; app không có → khung nét đứt chỗ lẽ ra phải hiện
function writeEvidence({ app, fig, figScale, u, win }, f, outBase) {
  const k = app.width / win.width; // px ảnh app / đơn vị app
  const left = resize(fig, (fig.width / figScale) * u * k, (fig.height / figScale) * u * k);
  const gap = Math.round(16 * k);
  const canvas = blank(left.width + gap + app.width, Math.max(left.height, app.height), [128, 128, 128]);
  paste(canvas, left, 0, 0);
  paste(canvas, app, left.width + gap, 0);
  const box = (b, dx) => ({ x: b.x * k - 6 * k + dx, y: b.y * k - 6 * k, width: b.width * k + 12 * k, height: b.height * k + 12 * k });
  const thick = Math.max(4, Math.round(2.5 * k));
  if (f.figBox) strokeBox(canvas, box(f.figBox, 0), { thick });
  if (f.appBox) strokeBox(canvas, box(f.appBox, left.width + gap), { thick, dash: f.missing ? Math.round(10 * k) : 0 });
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

// Frame xuất từ plugin: { json: { node, scale }, png } — thiếu file → báo rõ (Blocked môi trường)
function localFrame({ json, png, name }) {
  if (!fs.existsSync(json) || !fs.existsSync(png)) throw new Error(`Không thấy file frame Figma "${name || path.basename(json)}" — nhập lại file từ plugin ở Locator map`);
  const f = JSON.parse(fs.readFileSync(json, 'utf8'));
  return { node: f.node, png: fs.readFileSync(png), scale: f.scale || 1 };
}

const result = (screen, meta, extra) => ({
  suite: SUITE, title: `UI-${screen} Màn ${screen} theo Figma`, duration: 0, error: null, failShot: null, flows: [], bugs: [], steps: [],
  case: {
    id: `UI-${screen}`, title: `Màn ${screen} theo Figma`, priority: meta?.case?.priority || 'Medium', feature: meta?.case?.feature || SUITE,
    precondition: meta?.case?.precondition || [], start: meta?.case?.start, steps: [], expected: [`Màn ${screen} giống Figma: chữ, vị trí, kích thước, cỡ chữ, màu, icon / ảnh`],
  },
  ...extra,
});

// → số màn đã so. opts.fetchImpl / opts.ocr: thay khi test
export async function designCheck(reports, { mapFile = process.env.DESIGN_MAP, fetchImpl = fetch, ocr = ocrPng, log = console.log } = {}) {
  let cfg;
  try { cfg = mapFile ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : null; } catch { cfg = null; }
  const screens = cfg?.screens || designMap(mapFile);
  if (!Object.keys(screens).length) return 0;
  const dir = path.join(reports, 'design');
  const resultsDir = path.join(reports, 'results');
  const evDir = path.join(reports, 'evidence');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.mkdirSync(evDir, { recursive: true });
  const write = (name, r) => fs.writeFileSync(path.join(resultsDir, `design-${slug(name)}.json`), JSON.stringify(r));
  let n = 0;
  for (const [screen, conf] of Object.entries(screens)) {
    const base = path.join(dir, slug(screen));
    if (!fs.existsSync(`${base}.json`)) {
      write(screen, result(screen, null, { passed: false, status: 'notrun' }));
      continue;
    }
    const meta = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
    const started = Date.now();
    try {
      const app = readPng(fs.readFileSync(`${base}.png`));
      const u = meta.density || 1;
      const target = Math.min(4, Math.max(1, Math.ceil((app.width / meta.win.width) * u)));
      // Frame xuất bằng plugin (file trên máy) hoặc link Figma (REST API, cần FIGMA_TOKEN)
      const { node, png, scale } = conf.frame ? localFrame(conf.frame)
        : await frameOf(conf.url, { token: cfg?.token || process.env.FIGMA_TOKEN, scale: target, cacheDir: path.join(dir, 'figma-cache'), fetchImpl });
      const fig = readPng(png);
      const flat = { ...flatten(node), node };
      const lines = await ocr(fs.readFileSync(`${base}.png`)).catch(() => []);
      const { findings, skipped, checked } = compareScreen(flat, fig, scale, {
        png: app, win: meta.win, elements: parseSource(fs.readFileSync(`${base}.xml`, 'utf8')), ocr: lines, unit: meta.platform === 'Android' ? 'dp' : 'pt',
      }, { u, screen, tolerance: { ...(cfg?.tolerance || {}), ...(conf.tolerance || {}) }, ignore: conf.ignore || [] });
      // Nhật ký bước: thao tác tới màn → 1 dòng kiểm mỗi điểm lệch (+ 1 dòng tổng kết)
      const steps = [...meta.steps];
      const bugs = findings.slice(0, 40).map((f, i) => {
        const at = steps.length;
        const label = `Figma ${f.cat}: ${f.target}`;
        steps.push({ kind: 'Check', step: i + 1, screen, keyword: KEYWORD[f.cat], target: f.target, label, ok: false, actual: f.actualRaw, expected: f.expectedRaw });
        return {
          step: i + 1, label, actual: f.actualRaw, expected: f.expectedRaw, at, keyword: KEYWORD[f.cat], target: f.target, value: '', screen,
          image: writeEvidence({ app, fig, figScale: scale, u, win: meta.win }, f, path.join(evDir, `design-${slug(screen)}-${i + 1}`)),
          found: Boolean(f.appBox) && !f.missing, missing: f.missing, instead: [],
          design: { short: f.short, actual: f.actual, expected: f.expected, severity: f.severity, reason: REASON[f.kind] || 'Khác Figma', kind: f.kind },
        };
      });
      steps.push({ kind: 'Check', step: bugs.length + 1, screen, keyword: 'Verify design', target: screen, ok: !findings.length,
        label: `So với Figma: ${checked.texts} chữ, ${checked.shapes} khối / icon / ảnh — ${findings.length ? `${findings.length} điểm lệch` : 'khớp'}${skipped.length ? `; ${skipped.length} chữ nằm ngoài màn hình (cần cuộn), chưa so` : ''}`,
        actual: findings.length, expected: 0 });
      write(screen, result(screen, meta, {
        passed: !findings.length, status: findings.length ? 'failed' : 'passed', duration: Date.now() - started, bugs, steps,
        error: findings.length ? `Lệch ${findings.length} điểm so với Figma` : null,
      }));
      log(`[Figma] ${screen}: ${findings.length ? `${findings.length} điểm lệch` : 'khớp'}`);
      n++;
    } catch (e) {
      // Không lấy được Figma / ảnh hỏng → Blocked do môi trường (không phải bug của app)
      write(screen, result(screen, meta, { passed: false, status: 'blocked', blockKind: 'env', error: `So với Figma không được: ${e.message}`, steps: meta.steps }));
      log(`[Figma] ${screen}: ${e.message}`);
    }
  }
  // Trả thanh trạng thái Simulator về bình thường
  if (process.env.DEVICE_UDID) execFile('xcrun', ['simctl', 'status_bar', process.env.DEVICE_UDID, 'clear'], () => {});
  return n;
}

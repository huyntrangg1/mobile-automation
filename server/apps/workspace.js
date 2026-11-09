// Tạo workspace WebdriverIO cho 1 app: template của tool + file dùng chung từ ik-fitness + helper pack + report chung.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { IK_FITNESS, TEST_REPORT_SKILL, WORKSPACES } from '../paths.js';

// Template đã có sẵn loader Excel format v2 + tiện ích chung (không cần project nào bên cạnh)
const TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'template');
// Code viết tay riêng cho app (copy, không sửa bản gốc) — chỉ dùng được khi thư mục nguồn có trên máy
export const HELPER_PACKS = {
  'ik-fitness': { platform: 'iOS', source: IK_FITNESS, paths: ['src/utils', 'src/pages', 'src/components', 'src/flows', 'src/locators', 'src/runner', 'data/loaders', 'data/fixtures'] },
};

export function defaultInstall(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} lỗi: ${err.slice(-500)}`))));
  });
}

const copy = (from, to) => fs.cpSync(from, to, { recursive: true, force: true });

export const availablePacks = () => Object.keys(HELPER_PACKS).filter((k) => fs.existsSync(HELPER_PACKS[k].source));

// Khung script (scriptFile.js) import các export này. Workspace tạo trước khi template / report có chúng → Run lỗi
// ERR_MODULE_NOT_FOUND / "does not provide an export". File của template: copy nếu chưa có (không ghi đè, helper pack có
// thể đã thay). File report (src/report): cài lại từ skill (install.sh không động tới src/utils đã có).
const NEEDS = [
  { file: 'src/runner/steps.js', name: 'createSteps', from: 'template' },
  { file: 'src/runner/describe.js', name: 'describeCase', from: 'template' },
  { file: 'src/runner/navgraph.js', name: 'findPath', from: 'template' },
  { file: 'src/runner/compare.js', name: 'fillVars', from: 'template' },
  { file: 'src/runner/limit.js', name: 'runWithLimit', from: 'template' },
  { file: 'src/runner/layout.js', name: 'evaluate', from: 'template' },
  { file: 'src/runner/ocr.js', name: 'findText', from: 'template', also: ['src/runner/ocr.swift'] },
  // Chạy case rồi giữ app mở: caps cũ tắt app khi xong case → thay bằng template (giữ .bak)
  { file: 'config/capabilities/ios.caps.js', name: 'KEEP_APP_OPEN', from: 'template', replace: true, uses: true },
  { file: 'src/report/collector.js', name: 'addFlowBug', from: 'report' },
  { file: 'src/report/collector.js', name: 'noteScreen', from: 'report' },
  { file: 'src/report/collector.js', name: 'resetCurrent', from: 'report' },
  { file: 'src/report/hooks.js', name: 'screenSummary', from: 'report' },
];
const exportsName = (file, name) => {
  try { return new RegExp(`export\\s+(async\\s+)?(function\\*?|const|let|class)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`).test(fs.readFileSync(file, 'utf8')); } catch { return false; }
};
// uses: file chỉ cần có dùng tên đó (import / gọi), không cần export
const has = (file, n) => (n.uses ? (() => { try { return new RegExp(`\\b${n.name}\\b`).test(fs.readFileSync(file, 'utf8')); } catch { return false; } })() : exportsName(file, n.name));
// Thư mục do helper pack ghi đè → không tự thay file trong đó
const packOwns = (app, file) => {
  const pack = app.helperPack && HELPER_PACKS[app.helperPack];
  return Boolean(pack?.paths.some((p) => file.startsWith(`${p}/`)));
};

// ---- Nhận biết file template chưa bị sửa tay (để tự cập nhật theo template mới)
// Ghi hash (sha1) của từng file template lúc copy vào workspace: hash file hiện tại = hash đã ghi → chưa ai sửa → thay được.
export const MANIFEST = '.qapd-template.json';
const STEPS = 'src/runner/steps.js';
// File do template quản lý (cập nhật được khi chưa sửa tay)
// Toàn bộ code chạy test của template (bước k, khung tiện ích, chụp so Figma) — theo dõi để cập nhật workspace cũ cho mọi dự án
const RUNTIME_DIRS = ['src/runner', 'src/utils', 'src/design'];
const runtimeFiles = (template = TEMPLATE) => RUNTIME_DIRS.flatMap((d) => (fs.existsSync(path.join(template, d)) ? fs.readdirSync(path.join(template, d)).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`) : []));
export const MANAGED = [...new Set([...NEEDS.filter((n) => n.from === 'template').flatMap((n) => [n.file, ...(n.also || [])]), ...runtimeFiles()])];
// Tên export của 1 file JS (function / const / class / export { a, b })
export function exportsOf(file) {
  let src = '';
  try { src = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = new Set([...src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) for (const n of m[1].split(',')) { const x = n.trim().split(/\s+as\s+/).pop(); if (x) out.add(x); }
  return [...out];
}
// Bản template cũ đã phát hành (sha1) — workspace tạo trước khi có MANIFEST, file trùng byte một bản này = chưa sửa tay
export const KNOWN_TEMPLATE = {
  'src/runner/steps.js': [
    '708e8d8e904ba8d864ac661bdc7eb0a28b23a0e7', // 2026-11-08 (có closePopup / tapOutside / layout)
    'b87c483a72ad3c890dad4560701076ec6b56e28b', // bản còn chụp so Figma lúc nav (captureScreen)
    '284e8005e84a949411c48b62e56e4a6edea6a413', // bản trước guardApi / layout
  ],
};
const sha1 = (file) => { try { return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex'); } catch { return null; } };
export function readManifest(dir) {
  try { const m = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8')); return m && typeof m.files === 'object' ? m : { files: {} }; } catch { return { files: {} }; }
}
function writeManifest(dir, m) {
  try { fs.writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify(m, null, 2)}\n`); } catch { /* workspace chỉ đọc → bỏ qua */ }
}
// Ghi hash của các file template đang trùng byte với template (gọi sau khi tạo / cập nhật workspace)
export function recordTemplate(dir, files = MANAGED, { template = TEMPLATE } = {}) {
  const m = readManifest(dir);
  for (const rel of files) {
    const h = sha1(path.join(dir, rel));
    if (h && h === sha1(path.join(template, rel))) m.files[rel] = h;
  }
  writeManifest(dir, m);
  return m;
}
// Hàm k ("async tên(") của steps.js
export const kMethods = (file) => { try { return [...new Set([...fs.readFileSync(file, 'utf8').matchAll(/^[ \t]+async\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map((x) => x[1]))]; } catch { return []; } };
// Trạng thái một file template trong workspace: same | pristine (bản template cũ, chưa sửa tay) | edited | missing
export function templateState(dir, rel, { manifest = readManifest(dir), template = TEMPLATE } = {}) {
  const cur = sha1(path.join(dir, rel));
  if (!cur) return 'missing';
  if (cur === sha1(path.join(template, rel))) return 'same';
  return manifest.files?.[rel] === cur || KNOWN_TEMPLATE[rel]?.includes(cur) ? 'pristine' : 'edited';
}

// File mà `rel` import (./x.js, ../y.js) — kể cả gián tiếp: chưa có → copy; bản template cũ chưa sửa tay → cập nhật (giữ .bak);
// đã sửa tay mà thiếu export bản mới cần → ghi chú "cần chuẩn bị lại" (không ghi đè code sửa tay). Trả { extra, notes }
function syncDeps(dir, rel, template, manifest, out = { extra: [], notes: [] }, seen = new Set([rel])) {
  let src = '';
  try { src = fs.readFileSync(path.join(template, rel), 'utf8'); } catch { return out; }
  for (const m of src.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const dep = path.normalize(path.join(path.dirname(rel), m[1]));
    if (seen.has(dep) || !fs.existsSync(path.join(template, dep))) continue;
    seen.add(dep);
    const st = templateState(dir, dep, { manifest, template });
    if (st === 'missing') {
      fs.mkdirSync(path.dirname(path.join(dir, dep)), { recursive: true });
      fs.copyFileSync(path.join(template, dep), path.join(dir, dep));
      out.extra.push(dep);
      // File đi kèm (vd ocr.swift của ocr.js)
      for (const f of NEEDS.find((n) => n.file === dep)?.also || []) if (!fs.existsSync(path.join(dir, f)) && fs.existsSync(path.join(template, f))) fs.copyFileSync(path.join(template, f), path.join(dir, f));
    } else if (st === 'pristine') {
      fs.copyFileSync(path.join(dir, dep), `${path.join(dir, dep)}.bak`);
      fs.copyFileSync(path.join(template, dep), path.join(dir, dep));
      out.extra.push(dep);
    } else if (st === 'edited') {
      const have = new Set(exportsOf(path.join(dir, dep)));
      const lack = exportsOf(path.join(template, dep)).filter((n) => !have.has(n));
      if (lack.length) out.notes.push(`${dep} đã sửa tay, thiếu ${lack.join(', ')} mà ${rel} bản mới cần — cần chuẩn bị lại (Cài đặt app → Chuẩn bị lại) hoặc thêm vào file`);
      continue;
    }
    syncDeps(dir, dep, template, manifest, out, seen);
  }
  return out;
}

// Thay file template của workspace bằng bản mới (giữ .bak) + đồng bộ các file nó cần
function updateFromTemplate(dir, rel, template = TEMPLATE, manifest = readManifest(dir)) {
  const dest = path.join(dir, rel);
  fs.copyFileSync(dest, `${dest}.bak`);
  fs.copyFileSync(path.join(template, rel), dest);
  return syncDeps(dir, rel, template, manifest);
}

// Trước mỗi Run: bổ sung phần workspace cũ còn thiếu. Trả danh sách đã sửa / cần làm (rỗng = workspace đủ)
//   - file template chưa sửa tay (trùng hash đã ghi / trùng một bản template cũ) mà khác template hiện tại → cập nhật (giữ .bak)
//   - steps.js đã sửa tay mà thiếu hàm k của template → báo "cần chuẩn bị lại" (không ghi đè code sửa tay)
export async function upgradeWorkspace(app, { installImpl = defaultInstall, template = TEMPLATE } = {}) {
  const dir = app.workspace;
  const fixed = [];
  const manifest = readManifest(dir);
  const touched = [];
  for (const rel of MANAGED) {
    if (packOwns(app, rel) || !fs.existsSync(path.join(template, rel))) continue;
    const st = templateState(dir, rel, { manifest, template });
    if (st === 'pristine') {
      const { extra, notes } = updateFromTemplate(dir, rel, template, manifest);
      touched.push(rel, ...extra);
      fixed.push(`${rel} (cập nhật theo template mới, bản cũ: ${rel}.bak)`, ...extra, ...notes);
    } else if (st === 'edited' && rel === STEPS) {
      const want = kMethods(path.join(template, rel));
      const have = new Set(kMethods(path.join(dir, rel)));
      const lack = want.filter((n) => !have.has(n));
      if (lack.length) {
        const note = `${rel} đã sửa tay, thiếu k.${lack.join(', k.')} — cần chuẩn bị lại (Cài đặt app → Chuẩn bị lại) để dùng các keyword này`;
        console.warn(`[workspace ${app.id || dir}] ${note}`);
        fixed.push(note);
      }
    } else if (st === 'same' && manifest.files[rel] !== sha1(path.join(dir, rel))) touched.push(rel);
  }
  const missing = NEEDS.filter((n) => !has(path.join(dir, n.file), n));
  for (const n of missing.filter((x) => x.from === 'template')) {
    const dest = path.join(dir, n.file);
    if (has(dest, n)) continue; // file vừa copy ở mục trước (vd steps.js) đã đủ
    // File của helper pack: không thay (pack tự viết) — chỉ thiếu bước chụp so Figma, Run vẫn chạy
    if (fs.existsSync(dest) && n.replace && packOwns(app, n.file)) continue;
    if (fs.existsSync(dest) && n.replace) {
      // Báo rõ khi file bị thay là bản đã sửa tay (không phải bản template cũ) — thay đổi riêng nằm trong .bak
      const edited = templateState(dir, n.file, { manifest, template }) === 'edited';
      fs.copyFileSync(dest, `${dest}.bak`);
      fs.copyFileSync(path.join(template, n.file), dest);
      fixed.push(edited ? `${n.file} đã sửa tay → thay bằng template (thiếu ${n.name}); thay đổi riêng nằm ở ${n.file}.bak — chép lại nếu cần` : `${n.file} (bản cũ: ${n.file}.bak)`);
      touched.push(n.file);
      const dd = syncDeps(dir, n.file, template, manifest);
      touched.push(...dd.extra);
      fixed.push(...dd.extra, ...dd.notes);
      continue;
    }
    if (fs.existsSync(dest)) throw new Error(`${n.file} của workspace thiếu ${n.name} (file đã sửa / của helper pack) — vào Cài đặt app → Chuẩn bị lại`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(template, n.file), dest);
    fixed.push(n.file);
    touched.push(n.file);
    const dd = syncDeps(dir, n.file, template, manifest);
    touched.push(...dd.extra);
    fixed.push(...dd.extra, ...dd.notes);
    // File đi kèm (vd ocr.swift của ocr.js) — chỉ copy khi chưa có
    for (const f of n.also || []) if (!fs.existsSync(path.join(dir, f))) { fs.copyFileSync(path.join(template, f), path.join(dir, f)); touched.push(f); }
  }
  if (touched.length) recordTemplate(dir, MANAGED.filter((f) => touched.includes(f)), { template });
  if (missing.some((x) => x.from === 'report')) {
    await installImpl('bash', [path.join(TEST_REPORT_SKILL, 'scripts/install.sh'), dir], dir);
    fixed.push('src/report/*');
  }
  return fixed;
}

export async function createWorkspace(app, { root = WORKSPACES, installImpl = defaultInstall } = {}) {
  const dir = path.join(root, app.id);
  fs.mkdirSync(dir, { recursive: true });
  copy(TEMPLATE, dir);
  const pack = app.helperPack && HELPER_PACKS[app.helperPack];
  if (app.helperPack && !pack) throw new Error(`Không có helper pack "${app.helperPack}"`);
  if (pack && !fs.existsSync(pack.source)) throw new Error(`Helper pack "${app.helperPack}" cần thư mục ${pack.source} (đặt project cạnh tool)`);
  if (pack) for (const p of pack.paths) copy(path.join(pack.source, p), path.join(dir, p));
  // Report chung: luôn lấy bản của skill (--force ghi đè cả evidence/softAssert copy từ helper pack)
  await installImpl('bash', [path.join(TEST_REPORT_SKILL, 'scripts/install.sh'), dir, '--force'], dir);
  recordTemplate(dir); // ghi hash file template → lần nâng cấp sau biết file nào chưa sửa tay
  await installImpl('npm', ['install', '--no-audit', '--no-fund', '--prefer-offline'], dir);
  return dir;
}

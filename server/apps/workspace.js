// Tạo workspace WebdriverIO cho 1 app: template của tool + file dùng chung từ ik-fitness + helper pack + report chung.
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

// Trước mỗi Run: bổ sung phần workspace cũ còn thiếu. Trả danh sách đã sửa (rỗng = workspace đủ)
export async function upgradeWorkspace(app, { installImpl = defaultInstall } = {}) {
  const dir = app.workspace;
  const missing = NEEDS.filter((n) => !has(path.join(dir, n.file), n));
  const fixed = [];
  for (const n of missing.filter((x) => x.from === 'template')) {
    const dest = path.join(dir, n.file);
    if (has(dest, n)) continue; // file vừa copy ở mục trước (vd steps.js) đã đủ
    // File của helper pack: không thay (pack tự viết) — chỉ thiếu bước chụp so Figma, Run vẫn chạy
    if (fs.existsSync(dest) && n.replace && packOwns(app, n.file)) continue;
    if (fs.existsSync(dest) && n.replace) {
      fs.copyFileSync(dest, `${dest}.bak`);
      fs.copyFileSync(path.join(TEMPLATE, n.file), dest);
      fixed.push(`${n.file} (bản cũ: ${n.file}.bak)`);
      continue;
    }
    if (fs.existsSync(dest)) throw new Error(`${n.file} của workspace thiếu ${n.name} (file đã sửa / của helper pack) — vào Cài đặt app → Chuẩn bị lại`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(TEMPLATE, n.file), dest);
    fixed.push(n.file);
    // File đi kèm (vd ocr.swift của ocr.js) — chỉ copy khi chưa có
    for (const f of n.also || []) if (!fs.existsSync(path.join(dir, f))) fs.copyFileSync(path.join(TEMPLATE, f), path.join(dir, f));
  }
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
  await installImpl('npm', ['install', '--no-audit', '--no-fund', '--prefer-offline'], dir);
  return dir;
}

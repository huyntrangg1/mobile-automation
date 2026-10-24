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

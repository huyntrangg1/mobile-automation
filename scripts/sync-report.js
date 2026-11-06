// npm run sync-report — copy skill report chung (bản gốc: ../.claude/skills/test-report) vào vendor/test-report,
// rồi cài lại report cho mọi workspace app. Theo CLAUDE.md: sửa report ở skill, sau đó đồng bộ vào nơi dùng.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TEST_REPORT_SKILL_SRC, TEST_REPORT_VENDOR, WORKSPACES } from '../server/paths.js';

const files = (dir, base = dir, ignore = []) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (ignore.includes(e.name)) return [];
  const p = path.join(dir, e.name);
  return e.isDirectory() ? files(p, base, ignore) : [path.relative(base, p)];
}).filter((f) => !f.endsWith('.DS_Store')).sort();

// Hai thư mục giống hệt nhau (cùng danh sách file, cùng nội dung)
// ignore: tên file / thư mục bỏ qua ở mọi cấp (vd node_modules)
export function sameTree(a, b, { ignore = [] } = {}) {
  if (!fs.existsSync(a) || !fs.existsSync(b)) return false;
  const fa = files(a, a, ignore);
  const fb = files(b, b, ignore);
  return fa.length === fb.length && fa.every((f, i) => f === fb[i] && fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(TEST_REPORT_SKILL_SRC)) {
    console.error(`Không thấy skill gốc ở ${TEST_REPORT_SKILL_SRC} — không có gì để đồng bộ.`);
    process.exit(1);
  }
  if (sameTree(TEST_REPORT_SKILL_SRC, TEST_REPORT_VENDOR)) console.log('vendor/test-report đã khớp skill gốc.');
  else {
    fs.rmSync(TEST_REPORT_VENDOR, { recursive: true, force: true });
    fs.cpSync(TEST_REPORT_SKILL_SRC, TEST_REPORT_VENDOR, { recursive: true });
    console.log('Đã copy skill gốc vào vendor/test-report.');
  }
  const install = path.join(TEST_REPORT_VENDOR, 'scripts/install.sh');
  const wss = fs.existsSync(WORKSPACES) ? fs.readdirSync(WORKSPACES).map((d) => path.join(WORKSPACES, d)).filter((d) => fs.existsSync(path.join(d, 'package.json'))) : [];
  for (const ws of wss) {
    execFileSync('bash', [install, ws, '--force'], { stdio: 'ignore' });
    console.log(`Cài lại report: ${path.basename(ws)}`);
  }
}

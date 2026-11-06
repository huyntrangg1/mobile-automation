// npm run sync-select-skill — copy skill gốc select-automation-testcases (SKILL.md + scripts/) vào vendor/select-automation.
// Bản gốc: ../.claude/skills/select-automation-testcases (hoặc QAPD_SELECT_SKILL). Không copy node_modules: exceljs lấy từ node_modules của tool.
import fs from 'node:fs';
import path from 'node:path';
import { SELECT_AUTOMATION_SRC, SELECT_AUTOMATION_VENDOR } from '../server/paths.js';
import { sameTree } from './sync-report.js';

const IGNORE = ['node_modules', 'package.json', 'package-lock.json', 'VERSION'];

if (!fs.existsSync(SELECT_AUTOMATION_SRC)) {
  console.error(`Không thấy skill gốc ở ${SELECT_AUTOMATION_SRC} — không có gì để đồng bộ.`);
  process.exit(1);
}
if (sameTree(SELECT_AUTOMATION_SRC, SELECT_AUTOMATION_VENDOR, { ignore: IGNORE })) console.log('vendor/select-automation đã khớp skill gốc.');
else {
  const keepVersion = path.join(SELECT_AUTOMATION_VENDOR, 'VERSION');
  fs.mkdirSync(path.join(SELECT_AUTOMATION_VENDOR, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(SELECT_AUTOMATION_SRC, 'SKILL.md'), path.join(SELECT_AUTOMATION_VENDOR, 'SKILL.md'));
  for (const f of fs.readdirSync(path.join(SELECT_AUTOMATION_SRC, 'scripts'))) {
    fs.copyFileSync(path.join(SELECT_AUTOMATION_SRC, 'scripts', f), path.join(SELECT_AUTOMATION_VENDOR, 'scripts', f));
  }
  const day = fs.statSync(path.join(SELECT_AUTOMATION_SRC, 'SKILL.md')).mtime.toISOString().slice(0, 10);
  fs.writeFileSync(keepVersion, `${day} — SKILL.md gốc sửa lần cuối; nguồn: ${SELECT_AUTOMATION_SRC}\nĐồng bộ lại: npm run sync-select-skill\n`);
  console.log('Đã copy skill gốc vào vendor/select-automation.');
}

// npm run doctor — kiểm tra máy đủ điều kiện chạy QA Pipeline, thiếu gì in kèm lệnh cài.
// --skip-ai: bỏ bước gọi thử Claude (kiểm tra đăng nhập tốn một lượt gọi nhỏ)
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runChecks } from './doctor-checks.js';
import { ROOT, IK_FITNESS, TEST_REPORT_VENDOR, TEST_REPORT_SKILL_SRC } from '../server/paths.js';
import { sameTree } from './sync-report.js';
import { ANDROID_HOME, listDevices } from '../server/device/platforms.js';
import { listSimulators } from '../server/device/simulators.js';
import { runClaude } from '../server/ai/claude.js';

const sh = async (cmd, args, timeout = 30000) => String((await promisify(execFile)(cmd, args, { timeout, maxBuffer: 10 * 1024 * 1024 })).stdout).trim();
const skipAi = process.argv.includes('--skip-ai');

const probes = {
  node: async () => process.versions.node,
  os: async () => process.platform,
  deps: async () => ['express', 'webdriverio', 'exceljs', 'vite'].every((m) => fs.existsSync(path.join(ROOT, 'node_modules', m))),
  appium: async () => (await sh('appium', ['-v'])).split('\n').pop(),
  drivers: async () => Object.keys(JSON.parse(await sh('appium', ['driver', 'list', '--installed', '--json'], 60000))),
  claude: async () => {
    const version = (await sh('claude', ['--version'])).split(' ')[0];
    if (skipAi) return { version, loggedIn: true };
    const r = await runClaude({ prompt: 'Trả về {"ok":true}', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }, timeoutMs: 90000, allowedTools: [] });
    return { version, loggedIn: r.ok, error: r.ok ? undefined : r.error.slice(0, 160) };
  },
  testReport: async () => fs.existsSync(path.join(TEST_REPORT_VENDOR, 'scripts/install.sh')),
  reportSync: async () => (fs.existsSync(TEST_REPORT_SKILL_SRC) ? (sameTree(TEST_REPORT_SKILL_SRC, TEST_REPORT_VENDOR) ? 'same' : 'diff') : 'no-source'),
  ikFitness: async () => fs.existsSync(path.join(IK_FITNESS, 'src/pages/index.js')),
  xcode: async () => (await sh('xcodebuild', ['-version'])).split('\n')[0],
  simulators: async () => (await listSimulators()).length,
  androidSdk: async () => (fs.existsSync(ANDROID_HOME) ? ANDROID_HOME : null),
  adb: async () => fs.existsSync(path.join(ANDROID_HOME, 'platform-tools/adb')),
  aapt2: async () => {
    const dir = path.join(ANDROID_HOME, 'build-tools');
    return fs.existsSync(dir) && fs.readdirSync(dir).some((v) => fs.existsSync(path.join(dir, v, 'aapt2')));
  },
  androidDevices: async () => (await listDevices('Android')).length,
};

const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const MARK = { ok: c('32', '✓'), warn: c('33', '!'), fail: c('31', '✗') };

console.log(c('1', '\nQA Pipeline — kiểm tra máy\n'));
const r = await runChecks(probes);
for (const group of ['Chung', 'iOS', 'Android']) {
  const its = r.items.filter((i) => i.group === group);
  if (!its.length) continue;
  const tag = group === 'Chung' ? '' : r.platforms[group] ? c('32', ' — sẵn sàng') : c('33', ' — chưa sẵn sàng (không bắt buộc nếu chỉ dùng nền tảng kia)');
  console.log(c('1', `${group}${tag}`));
  for (const i of its) {
    console.log(`  ${MARK[i.status]} ${i.label}${i.detail ? c('2', `  (${i.detail})`) : ''}`);
    if (i.status !== 'ok' && i.fix) console.log(`      → ${i.fix}`);
  }
  console.log('');
}
if (r.ok) console.log(c('32', `Đủ điều kiện chạy. Nền tảng sẵn sàng: ${Object.keys(r.platforms).filter((k) => r.platforms[k]).join(', ')}. Chạy: npm start → http://localhost:5178\n`));
else console.log(c('31', 'Chưa đủ điều kiện — sửa các mục ✗ ở trên rồi chạy lại: npm run doctor\n'));
process.exit(r.ok ? 0 : 1);

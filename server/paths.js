import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = process.env.QAPD_DATA || path.join(ROOT, 'data');
export const WORKSPACES = process.env.QAPD_WORKSPACES || path.join(ROOT, 'workspaces');
// Tuỳ chọn: project ik-fitness đặt cạnh tool → helper pack IK Fitness + WDA build sẵn
export const IK_FITNESS = process.env.QAPD_IK_FITNESS || path.resolve(ROOT, '../ik-fitness');
// Bản gốc skill report chung (nếu có cạnh tool) — npm run sync-report copy vào vendor
export const TEST_REPORT_SKILL_SRC = process.env.QAPD_SKILL || path.resolve(ROOT, '../.claude/skills/test-report');
// Bản tool dùng: luôn là bản vendor trong repo, để repo chạy được một mình
export const TEST_REPORT_VENDOR = path.join(ROOT, 'vendor/test-report');
export const TEST_REPORT_SKILL = TEST_REPORT_VENDOR;
// WebDriverAgent: dùng bản build sẵn của ik-fitness nếu có, không thì build lần đầu vào .wda-build của tool
const IK_WDA = path.join(IK_FITNESS, '.wda-build');
export const WDA_DIR = fs.existsSync(path.join(IK_WDA, 'Build/Products')) ? IK_WDA : path.join(ROOT, '.wda-build');

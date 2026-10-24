// Workspace do QA Pipeline tạo. Report: skill test-report (hook theo mục "Config" của skill).
// Biến môi trường từ tool: REPORTS_DIR, SPECS (đường dẫn spec, cách nhau bởi dấu phẩy), APP_NAME, DEVICE_UDID, APP_PATH, BUNDLE_ID.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEachTest, buildHtml, writeEnv, writeHookFailure, writePlanned, writeResult } from './src/report/hooks.js';
import SkipReporter from './src/report/skipReporter.js';
import { iosCaps } from './config/capabilities/ios.caps.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPORTS = process.env.REPORTS_DIR || path.join(ROOT, 'reports');
const startedAt = new Date();
const specs = (process.env.SPECS || path.join(ROOT, 'tests/*.e2e.js')).split(',');

export const config = {
  runner: 'local',
  specs,
  maxInstances: 1,
  logLevel: 'error',
  strictSelectors: false,
  waitforTimeout: 15000,
  connectionRetryTimeout: 180000,
  connectionRetryCount: 1,
  services: [['appium', { command: 'appium', args: { relaxedSecurity: true } }]],
  capabilities: [iosCaps],
  framework: 'mocha',
  reporters: [['spec', { realtimeReporting: true }], [SkipReporter, { resultsDir: path.join(REPORTS, 'results') }]],
  mochaOpts: { ui: 'bdd', timeout: 300000 },
  onPrepare() {
    for (const d of ['screenshots', 'results', 'evidence', 'bug-report.html', 'test-results.xlsx']) fs.rmSync(path.join(REPORTS, d), { recursive: true, force: true });
  },
  before() { writeEnv(REPORTS); },
  beforeTest() { beforeEachTest(); },
  async afterTest(test, ctx, result) {
    let shot = null;
    if (!result.passed) {
      shot = path.join(REPORTS, 'screenshots', `${Date.now()}.png`);
      fs.mkdirSync(path.dirname(shot), { recursive: true });
      await browser.saveScreenshot(shot).catch(() => { shot = null; });
    }
    writeResult(REPORTS, test, result, shot);
  },
  afterHook(test, ctx, result) { writeHookFailure(REPORTS, test, result); },
  after() { writePlanned(REPORTS); },
  async onComplete() { await buildHtml(REPORTS, startedAt, { appName: process.env.APP_NAME || 'App', open: false }); },
};

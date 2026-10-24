// Nối bug-report.html vào vòng đời WebdriverIO (gọi từ config/wdio.shared.conf.js):
//   worker: before → ghi môi trường; afterTest → ghi kết quả 1 test + ảnh evidence đã khoanh đỏ
//   launcher: onComplete → gom tất cả thành reports/bug-report.html
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { resetCurrent, takeCurrent, takePlanned } from './collector.js';
import { writeEvidence } from './annotate.js';
import { buildModel, renderReport } from './html.js';
import { resultsWorkbook, syncTestcaseFiles } from './excel.js';

export const reportDirs = (reports) => ({
  results: path.join(reports, 'results'),
  evidence: path.join(reports, 'evidence'),
  html: path.join(reports, 'bug-report.html'),
  share: path.join(reports, 'bug-report-share.html'),
});

export function writeEnv(reports) {
  const caps = driver.capabilities;
  const appPath = caps.app || caps['appium:app'] || '';
  const plist = (key) => {
    try {
      return execFileSync('plutil', ['-extract', key, 'raw', path.join(appPath, 'Info.plist')]).toString().trim();
    } catch {
      return '?';
    }
  };
  // Simulator: Appium không trả deviceName → tra tên theo UDID
  const udid = caps.udid || caps['appium:udid'];
  const simName = () => {
    try {
      const { devices } = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', '-j']).toString());
      return Object.values(devices).flat().find((d) => d.udid === udid)?.name;
    } catch {
      return undefined;
    }
  };
  const env = {
    device: caps.deviceName || caps['appium:deviceName'] || simName() || '?',
    platformVersion: caps.platformVersion || caps['appium:platformVersion'] || '?',
    udid: udid || '?',
    locale: caps.locale || caps['appium:locale'] || '?',
    platform: caps.platformName || caps['appium:platformName'] || '',
    // iOS .app: đọc Info.plist; nền tảng khác: biến môi trường APP_VERSION
    appVersion: /\.app$/.test(appPath)
      ? `${plist('CFBundleShortVersionString')} (${plist('CFBundleVersion')})`
      : process.env.APP_VERSION || '?',
  };
  const { results } = reportDirs(reports);
  fs.mkdirSync(results, { recursive: true });
  fs.writeFileSync(path.join(results, 'env.json'), JSON.stringify(env));
}

export const beforeEachTest = () => resetCurrent();

// Trạng thái test case:
//   passed · failed (kết quả khác mong đợi — AssertionError) · blocked (dừng vì lỗi khác: môi trường / bug chặn luồng)
//   skipped (it.skip / describe.skip — ghi bởi SkipReporter) · notrun (đã đăng ký planTest nhưng không chạy lần này)
// Blocked do môi trường (session Appium / WebDriver, thiếu data, thiếu biến môi trường) → không tạo bug
const ENV_ERROR = /ECONN|socket hang up|session|WebDriverError: (?!.*no such element)|Appium|xcodebuild|WDA|WebDriverAgent|Thiếu biến môi trường|TC trước bị chặn|Chuẩn bị tài khoản|Sheet TestData|Sheet TestCases|không có sheet|ENOENT/i;
export function statusOf(passed, error) {
  if (passed) return { status: 'passed' };
  const msg = String(error?.message || error || '');
  if (error?.name === 'AssertionError' || /^AssertionError/.test(msg) || error?.matcherResult) return { status: 'failed' };
  return { status: 'blocked', blockKind: ENV_ERROR.test(msg) ? 'env' : 'defect' };
}

const writeJson = (reports, name, data) => {
  const { results } = reportDirs(reports);
  fs.mkdirSync(results, { recursive: true });
  fs.writeFileSync(path.join(results, name), JSON.stringify(data));
};

// Gọi ở hook after của worker: danh sách test dự kiến của các spec trong worker này
export function writePlanned(reports) {
  const list = takePlanned();
  if (list.length) writeJson(reports, `planned-${process.pid}.json`, list);
}

// Hook before / beforeEach lỗi → các test trong suite không chạy được: ghi 1 dòng Blocked cho hook
export function writeHookFailure(reports, test, { error }) {
  if (!error) return;
  writeJson(reports, `${Date.now()}-${process.pid}-hook.json`, {
    suite: test.parent, title: test.title, passed: false, duration: 0, ...statusOf(false, error),
    error: String(error.message || error), case: null, bugs: [], failShot: null,
  });
}

export function writeResult(reports, test, { passed, error, duration }, failShot) {
  const { results, evidence } = reportDirs(reports);
  fs.mkdirSync(results, { recursive: true });
  fs.mkdirSync(evidence, { recursive: true });
  const id = `${Date.now()}-${process.pid}`;
  const cur = takeCurrent();
  const bugs = passed ? [] : cur.bugs.map((b, i) => {
    const ev = b.evidence;
    return {
      step: b.step, label: b.label, actual: b.actual, expected: b.expected, at: b.at,
      keyword: b.keyword, target: b.target, value: b.value,
      screen: ev?.screen ?? b.screen ?? null,
      image: ev?.image ? writeEvidence(ev, path.join(evidence, `${id}-${i + 1}`)) : null,
      found: Boolean(ev?.rect) && !ev?.missing, missing: Boolean(ev?.missing), instead: ev?.instead || [],
    };
  });
  // Fail không qua điểm kiểm → dùng ảnh lúc fail, thu nhỏ cho nhẹ report
  let shot = null;
  if (!passed && !bugs.length && failShot && fs.existsSync(failShot)) {
    shot = path.join(evidence, `${id}-fail.jpg`);
    execFileSync('sips', ['-Z', '1100', '-s', 'format', 'jpeg', '-s', 'formatOptions', '75', failShot, '--out', shot], { stdio: 'ignore' });
  }
  const result = {
    suite: test.parent, title: test.title, passed, duration, ...statusOf(passed, error),
    error: error ? String(error.message || error) : null,
    case: cur.case, bugs, failShot: shot, steps: cur.steps,
  };
  fs.writeFileSync(path.join(results, `${id}.json`), JSON.stringify(result));
}

const dataUrl = (file) => (file && fs.existsSync(file)
  ? `data:image/${file.endsWith('.png') ? 'png' : 'jpeg'};base64,${fs.readFileSync(file).toString('base64')}`
  : null);

// Trả về { html, xlsx, synced } — xlsx: file kết quả tổng hợp; synced: các file test case đã ghi kết quả (nút Export Excel tải các file này)
// appName: tên app hiện trên tiêu đề report và tên file Excel
// open: mở report trên trình duyệt sau khi tạo (bỏ qua khi chạy CI hoặc REPORT_OPEN=0)
export async function buildHtml(reports, startedAt, { sync = true, appName = 'App', open = false } = {}) {
  const { results, html, share } = reportDirs(reports);
  if (!fs.existsSync(results)) return null;
  const files = fs.readdirSync(results).filter((f) => f.endsWith('.json') && f !== 'env.json' && !f.startsWith('planned-')).sort();
  const planned = fs.readdirSync(results).filter((f) => f.startsWith('planned-')).flatMap((f) => JSON.parse(fs.readFileSync(path.join(results, f))));
  const envFile = path.join(results, 'env.json');
  const env = fs.existsSync(envFile) ? JSON.parse(fs.readFileSync(envFile)) : {};
  const list = files.map((f) => {
    const r = JSON.parse(fs.readFileSync(path.join(results, f)));
    return {
      ...r, status: r.status || (r.passed ? 'passed' : 'failed'),
      failShot: dataUrl(r.failShot), bugs: r.bugs.map((b) => ({ ...b, image: dataUrl(b.image) })),
    };
  });
  // Đã đăng ký nhưng không chạy (lọc --grep / --spec, run bị dừng) → Not Run
  const ran = new Set(list.map((r) => `${r.suite}\u0000${r.title}`));
  const seen = new Set();
  for (const p of planned) {
    const key = `${p.suite}\u0000${p.title}`;
    if (ran.has(key) || seen.has(key)) continue;
    seen.add(key);
    list.push({ suite: p.suite, title: p.title, passed: false, status: 'notrun', duration: 0, error: null, case: p.case || null, bugs: [], failShot: null });
  }
  const data = { appName, results: list, env, startedAt: startedAt.toLocaleString('vi-VN'), duration: Date.now() - startedAt.getTime() };
  const model = buildModel(data);
  const buf = await resultsWorkbook(model, data);
  const xlsx = path.join(reports, 'test-results.xlsx');
  fs.writeFileSync(xlsx, buf);
  const synced = sync
    ? await syncTestcaseFiles(model, { startedAt: data.startedAt, backupDir: path.join(reports, 'xlsx-backup') })
      .catch((e) => { console.warn(`Không ghi được kết quả vào file test case: ${e.message}`); return []; })
    : [];
  // Nút Export Excel tải file test case đã ghi kết quả; không có file nào được đồng bộ thì tải file kết quả tổng hợp
  // Không đồng bộ lần này (tạo lại report) → dùng file test case hiện có của các test trong report
  const caseFiles = synced.length ? synced : [...new Set(list.map((r) => r.case?.file).filter((f) => f && fs.existsSync(f)))];
  const xlsxFiles = caseFiles.length
    ? caseFiles.map((f) => ({ name: path.basename(f), b64: fs.readFileSync(f).toString('base64') }))
    : [{ name: `${appName}-test-results.xlsx`, b64: buf.toString('base64') }];
  fs.writeFileSync(html, renderReport({ ...data, xlsxFiles }));
  // Bản để đăng lên trang Artifact claude.ai (share link): không có Export PDF / Excel / Log Asana
  fs.writeFileSync(share, renderReport({ ...data, share: true }));
  if (open && process.platform === 'darwin' && !process.env.CI && process.env.REPORT_OPEN !== '0') {
    spawn('open', [html], { detached: true, stdio: 'ignore' }).unref();
  }
  return { html, xlsx, synced };
}

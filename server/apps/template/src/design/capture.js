// Chụp màn để so với Figma (chạy trong worker, lúc case vừa tới màn — gọi từ k.nav).
// Chỉ màn có link Figma (DESIGN_MAP: { "<tên màn>": { url, ignore? } }), mỗi màn 1 lần / run (lần đầu tới màn, chưa thao tác gì).
// Không bao giờ làm case lỗi: chụp hỏng → bỏ qua, check.js báo "chưa chụp được".
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { designMap, slug } from './map.js';

export { designMap, slug };

const done = new Set();
let barSet = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args) => new Promise((resolve) => { execFile(cmd, args, { timeout: 15000 }, (err) => resolve(!err)); });

// iOS Simulator: thanh trạng thái giống mockup (9:41, pin đầy) → không thành vùng khác khi so
async function statusBar() {
  if (barSet || !driver.isIOS || !process.env.DEVICE_UDID) return;
  barSet = true;
  await run('xcrun', ['simctl', 'status_bar', process.env.DEVICE_UDID, 'override', '--time', '9:41', '--batteryState', 'charged', '--batteryLevel', '100', '--cellularBars', '4', '--wifiBars', '3']);
  await sleep(300);
}

export async function captureScreen(screen, { reports = process.env.REPORTS_DIR } = {}) {
  try {
    if (!reports || !designMap()[screen] || done.has(screen)) return false;
    done.add(screen);
    await statusBar();
    // Chờ màn đứng yên (hết hiệu ứng chuyển màn / hiện dần): page source không đổi giữa 2 lần đọc, tối đa 4 giây
    let prev = null;
    let source = null;
    for (const end = Date.now() + 4000; Date.now() < end; await sleep(400)) {
      source = await driver.getPageSource();
      if (source === prev) break;
      prev = source;
    }
    await sleep(250);
    const image = await driver.takeScreenshot();
    const win = await driver.getWindowRect();
    const caps = driver.capabilities || {};
    // Android: đơn vị app = px → mật độ (px / dp) để quy đổi dp của Figma
    const density = driver.isAndroid ? (Number(caps.pixelRatio || caps['appium:pixelRatio']) || (Number(caps.deviceScreenDensity) || 0) / 160 || null) : 1;
    // collector của report chung (cài vào workspace, template không có) → nạp lúc cần
    const cur = await import('../report/collector.js').then((m) => m.takeCurrent()).catch(() => ({}));
    const dir = path.join(reports, 'design');
    fs.mkdirSync(dir, { recursive: true });
    const base = path.join(dir, slug(screen));
    fs.writeFileSync(`${base}.png`, Buffer.from(image, 'base64'));
    fs.writeFileSync(`${base}.xml`, source || '');
    fs.writeFileSync(`${base}.json`, JSON.stringify({
      screen, at: new Date().toISOString(), platform: driver.isAndroid ? 'Android' : 'iOS', win: { width: win.width, height: win.height }, density,
      case: cur.case ? { id: cur.case.id, title: cur.case.title, priority: cur.case.priority, feature: cur.case.feature, precondition: cur.case.precondition, start: cur.case.start } : null,
      // Thao tác đã làm tới lúc chụp → Steps to Reproduce của bug
      steps: (cur.steps || []).filter((s) => s.kind === 'Action'),
    }));
    return true;
  } catch {
    return false;
  }
}

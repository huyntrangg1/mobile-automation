// Phiên Appium dùng khi lấy locator (cổng 4724, tách khỏi cổng 4723 của wdio lúc Run). iOS và Android.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from '../paths.js';
import { remote } from 'webdriverio';
import { androidEnv, attachCaps, sessionCaps, isRealIos, realIosCaps, detectTeamId, explainSessionError, ensureSimulatorReady } from './platforms.js';

const PORT = 4724;
const LOG_FILE = path.join(DATA, 'appium.log');
const up = async () => {
  try { return (await fetch(`http://127.0.0.1:${PORT}/status`)).ok; } catch { return false; }
};

async function ensureAppium() {
  if (await up()) return null;
  // Log Appium ghi ra data/appium.log để xem lỗi (vd build WebDriverAgent trên iPhone thật)
  const out = fs.openSync(LOG_FILE, 'a');
  const proc = spawn('appium', ['--port', String(PORT), '--relaxed-security'], { stdio: ['ignore', out, out], env: { ...process.env, ...androidEnv() } });
  for (let i = 0; i < 60; i++) {
    if (await up()) return proc;
    await new Promise((r) => setTimeout(r, 500));
  }
  proc.kill();
  throw new Error('Không khởi động được Appium (cổng 4724)');
}

export async function openSession({ app, udid, caps }) {
  // iPhone thật: dùng app đã cài sẵn trên máy (không cài lại, giữ dữ liệu), WDA ký bằng Apple Team
  if (app.platform !== 'Android' && isRealIos(udid)) caps = realIosCaps(app, udid, await detectTeamId(app));
  caps = caps || sessionCaps(app, udid);
  if (app.platform !== 'Android') await ensureSimulatorReady(udid);
  const appium = await ensureAppium();
  let driver;
  try {
    driver = await remote({ hostname: '127.0.0.1', port: PORT, logLevel: 'error', connectionRetryTimeout: 240000, capabilities: caps });
  } catch (e) {
    appium?.kill();
    // iPhone thật: lỗi build / mở WebDriverAgent thường do chứng chỉ chưa được tin cậy hoặc máy đang khoá
    if (isRealIos(udid) && /xcodebuild failed|WebDriverAgent/i.test(String(e.message))) {
      throw new Error('Không mở được WebDriverAgent trên iPhone. Thường do: (1) chưa tin cậy chứng chỉ — iPhone → Cài đặt → Cài đặt chung → VPN & Quản lý thiết bị → chọn chứng chỉ Apple Development của bạn → Tin cậy; (2) iPhone đang khoá màn hình; (3) chưa bật Developer Mode. Chi tiết xem data/appium.log');
    }
    throw explainSessionError(e, udid);
  }
  return {
    driver,
    async close() {
      await driver.deleteSession().catch(() => {});
      appium?.kill();
    },
  };
}

// Gắn vào app đang mở (thử locator) — không cài / mở lại app
export const attachSession = ({ app, udid }) => openSession({ app, udid, caps: isRealIos(udid) && app.platform !== 'Android' ? undefined : attachCaps(app, udid) });

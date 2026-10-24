// Phiên Appium dùng khi lấy locator (cổng 4724, tách khỏi cổng 4723 của wdio lúc Run). iOS và Android.
import { spawn } from 'node:child_process';
import { remote } from 'webdriverio';
import { androidEnv, sessionCaps } from './platforms.js';

const PORT = 4724;
const up = async () => {
  try { return (await fetch(`http://127.0.0.1:${PORT}/status`)).ok; } catch { return false; }
};

async function ensureAppium() {
  if (await up()) return null;
  const proc = spawn('appium', ['--port', String(PORT), '--relaxed-security'], { stdio: 'ignore', env: { ...process.env, ...androidEnv() } });
  for (let i = 0; i < 60; i++) {
    if (await up()) return proc;
    await new Promise((r) => setTimeout(r, 500));
  }
  proc.kill();
  throw new Error('Không khởi động được Appium (cổng 4724)');
}

export async function openSession({ app, udid }) {
  const appium = await ensureAppium();
  let driver;
  try {
    driver = await remote({ hostname: '127.0.0.1', port: PORT, logLevel: 'error', connectionRetryTimeout: 240000, capabilities: sessionCaps(app, udid) });
  } catch (e) {
    appium?.kill();
    throw e;
  }
  return {
    driver,
    async close() {
      await driver.deleteSession().catch(() => {});
      appium?.kill();
    },
  };
}

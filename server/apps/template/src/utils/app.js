import fs from 'node:fs';
// Vòng đời app chung (không helper pack), iOS và Android. Helper pack của app ghi đè file này.
import { APP_PATH, BUNDLE_ID } from '../../config/capabilities/ios.caps.js';

// iOS: alert hệ thống qua "mobile: alert". Android: hộp xin quyền là phần tử thường → bấm nút từ chối
export async function handleSystemAlert(timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (driver.isAndroid) {
        const deny = await $('android=new UiSelector().resourceIdMatches(".*permission_deny.*")');
        if (await deny.isExisting()) { await deny.click(); return true; }
        await driver.pause(300);
        continue;
      }
      const buttons = await driver.execute('mobile: alert', { action: 'getButtons' });
      const pick = buttons.find((b) => /don.t allow|not to track|từ chối/i.test(b)) || buttons[0];
      await driver.execute('mobile: alert', { action: 'accept', buttonLabel: pick });
      return true;
    } catch {
      await driver.pause(300);
    }
  }
  return false;
}

// Một lệnh WebDriverAgent có thể treo hàng chục phút (app / hộp thoại hệ thống chặn snapshot) rồi phiên Appium chết → mọi case sau Blocked.
// Bọc mỗi lệnh quan trọng bằng giới hạn thời gian để case báo lỗi sớm và tự phục hồi được.
const within = (p, ms, what) => {
  let timer;
  return Promise.race([p, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${what} quá ${Math.round(ms / 1000)}s không phản hồi`)), ms); })]).finally(() => clearTimeout(timer));
};

// Chờ app lên trước màn hình (queryAppState 4 = đang chạy foreground), rồi chờ màn ổn định (2 lần đọc page source giống nhau)
// — thay cho chờ cứng: app mở nhanh thì đi tiếp ngay, splash dài thì vẫn đợi (tối đa maxMs)
async function waitAppReady(id, maxMs = 8000, stepMs = 20000) {
  const end = Date.now() + maxMs;
  while (Date.now() < end && (await within(driver.execute('mobile: queryAppState', id), stepMs, 'queryAppState').catch(() => 4)) !== 4) await driver.pause(200);
  let prev = null;
  while (Date.now() < end) {
    const src = await within(driver.getPageSource(), stepMs, 'getPageSource').catch(() => null);
    if (src && src === prev) return;
    prev = src;
    await driver.pause(400);
  }
}

// Gỡ + cài lại app để bắt đầu như user mới. log(text): ghi thời gian từng giai đoạn vào log của run
// Hộp thoại hệ thống bật lên sau đó (ATT, thông báo…) → k tự đóng khi nó che màn, không chờ sẵn ở đây
// settle = false: chỉ chờ app lên foreground, KHÔNG chờ màn đứng yên — case kiểm animation lúc mở app cần nhìn từ khung đầu
export async function freshStart({ log = () => {}, stepMs = 120000, readyMs = 8000, settle = true } = {}) {
  const id = driver.isAndroid ? { appId: BUNDLE_ID } : { bundleId: BUNDLE_ID };
  let t = Date.now();
  const lap = (what) => { log(`${what} (${((Date.now() - t) / 1000).toFixed(1)}s)`); t = Date.now(); };
  // Không có file app để cài lại → dừng TRƯỚC khi gỡ (gỡ rồi không cài được thì mọi case sau đều hỏng)
  if (!APP_PATH || !fs.existsSync(APP_PATH)) throw new Error(`Không có file app để cài lại (APP_PATH="${APP_PATH || ''}") — kiểm đường dẫn file app trong Cài đặt app`);
  await driver.execute('mobile: terminateApp', id).catch(() => {});
  await driver.execute('mobile: removeApp', id).catch(() => {});
  lap('Gỡ app');
  await within(driver.execute('mobile: installApp', driver.isAndroid ? { appPath: APP_PATH } : { app: APP_PATH }), stepMs, 'installApp');
  lap('Cài app');
  await within(driver.execute('mobile: activateApp', id), stepMs, 'activateApp');
  if (settle) {
    await waitAppReady(id, readyMs, Math.min(stepMs, 20000));
    lap('Mở app, chờ màn ổn định');
  } else {
    const end = Date.now() + readyMs;
    while (Date.now() < end && (await within(driver.execute('mobile: queryAppState', id), 20000, 'queryAppState').catch(() => 4)) !== 4) await driver.pause(100);
    lap('Mở app (không chờ màn đứng yên — case kiểm animation)');
  }
}

export async function restartApp() {
  const id = driver.isAndroid ? { appId: BUNDLE_ID } : { bundleId: BUNDLE_ID };
  await driver.execute('mobile: terminateApp', id);
  await driver.execute('mobile: activateApp', id);
}

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

// Chờ app lên trước màn hình (queryAppState 4 = đang chạy foreground), rồi chờ màn ổn định (2 lần đọc page source giống nhau)
// — thay cho chờ cứng: app mở nhanh thì đi tiếp ngay, splash dài thì vẫn đợi (tối đa maxMs)
async function waitAppReady(id, maxMs = 8000) {
  const end = Date.now() + maxMs;
  while (Date.now() < end && (await driver.execute('mobile: queryAppState', id).catch(() => 4)) !== 4) await driver.pause(200);
  let prev = null;
  while (Date.now() < end) {
    const src = await driver.getPageSource().catch(() => null);
    if (src && src === prev) return;
    prev = src;
    await driver.pause(400);
  }
}

// Gỡ + cài lại app để bắt đầu như user mới. log(text): ghi thời gian từng giai đoạn vào log của run
// Hộp thoại hệ thống bật lên sau đó (ATT, thông báo…) → k tự đóng khi nó che màn, không chờ sẵn ở đây
export async function freshStart({ log = () => {} } = {}) {
  const id = driver.isAndroid ? { appId: BUNDLE_ID } : { bundleId: BUNDLE_ID };
  let t = Date.now();
  const lap = (what) => { log(`${what} (${((Date.now() - t) / 1000).toFixed(1)}s)`); t = Date.now(); };
  await driver.execute('mobile: terminateApp', id).catch(() => {});
  await driver.execute('mobile: removeApp', id).catch(() => {});
  lap('Gỡ app');
  await driver.execute('mobile: installApp', driver.isAndroid ? { appPath: APP_PATH } : { app: APP_PATH });
  lap('Cài app');
  await driver.execute('mobile: activateApp', id);
  await waitAppReady(id);
  lap('Mở app, chờ màn ổn định');
}

export async function restartApp() {
  const id = driver.isAndroid ? { appId: BUNDLE_ID } : { bundleId: BUNDLE_ID };
  await driver.execute('mobile: terminateApp', id);
  await driver.execute('mobile: activateApp', id);
}

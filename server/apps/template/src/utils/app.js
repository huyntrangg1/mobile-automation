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

// Gỡ + cài lại app để bắt đầu như user mới
export async function freshStart() {
  const id = driver.isAndroid ? { appId: BUNDLE_ID } : { bundleId: BUNDLE_ID };
  await driver.execute('mobile: terminateApp', id).catch(() => {});
  await driver.execute('mobile: removeApp', id).catch(() => {});
  await driver.execute('mobile: installApp', driver.isAndroid ? { appPath: APP_PATH } : { app: APP_PATH });
  await driver.execute('mobile: activateApp', id);
  await driver.pause(2000);
  await handleSystemAlert(5000);
}

export async function restartApp() {
  const id = driver.isAndroid ? { appId: BUNDLE_ID } : { bundleId: BUNDLE_ID };
  await driver.execute('mobile: terminateApp', id);
  await driver.execute('mobile: activateApp', id);
}

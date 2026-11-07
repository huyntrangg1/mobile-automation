// Tool QA Pipeline truyền app / thiết bị qua biến môi trường khi Run. PLATFORM = iOS | Android.
// (Tên file giữ "ios.caps.js" vì helper pack ik-fitness import APP_PATH / BUNDLE_ID từ đây.)
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLATFORM = process.env.PLATFORM || 'iOS';
export const BUNDLE_ID = process.env.BUNDLE_ID;
export const APP_PATH = process.env.APP_PATH;
const WDA_DIR = process.env.WDA_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.wda-build');

const ios = {
  platformName: 'iOS',
  'appium:automationName': 'XCUITest',
  'appium:udid': process.env.DEVICE_UDID,
  'appium:app': APP_PATH,
  'appium:bundleId': BUNDLE_ID,
  'appium:noReset': true,
  // Simulator đã cài WebDriverAgent → mở thẳng (nhanh hơn ~3s mỗi run); chưa có thì xcodebuild từ bản build sẵn
  ...(process.env.WDA_PREINSTALLED === '1'
    ? { 'appium:usePreinstalledWDA': true }
    : { 'appium:derivedDataPath': WDA_DIR, 'appium:usePrebuiltWDA': process.env.WDA_PREBUILT === '1' }),
  // Chạy case để đưa app tới một màn rồi dùng tiếp: giữ hiệu ứng (REDUCE_MOTION=0), không tắt app khi xong (KEEP_APP_OPEN=1)
  'appium:reduceMotion': process.env.REDUCE_MOTION !== '0',
  ...(process.env.KEEP_APP_OPEN === '1' ? { 'appium:shouldTerminateApp': false } : {}),
  // KHÔNG đặt appium:language / appium:locale cho Simulator: Appium sẽ ghi lại ngôn ngữ rồi khởi động lại SpringBoard / tccd / akd,
  // trên Simulator iOS 26 chưa có .GlobalPreferences.plist thì lệnh đó lỗi "'/bin/launchctl' failed with exit code 3" và session không mở được.
  'appium:wdaLaunchTimeout': 120000,
  'appium:newCommandTimeout': 240,
  'appium:settings[waitForIdleTimeout]': 1,
  // k.url đọc URL đầy đủ của trang web app mở ra (Safari / SFSafariViewController) qua Web Inspector
  'appium:includeSafariInWebviews': true,
  'appium:additionalWebviewBundleIds': ['com.apple.SafariViewService'],
  'appium:webviewConnectTimeout': 5000,
};

const android = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:udid': process.env.DEVICE_UDID,
  'appium:app': APP_PATH,
  'appium:appPackage': BUNDLE_ID,
  ...(process.env.APP_ACTIVITY ? { 'appium:appActivity': process.env.APP_ACTIVITY } : {}),
  'appium:noReset': true,
  ...(process.env.KEEP_APP_OPEN === '1' ? { 'appium:shouldTerminateApp': false, 'appium:dontStopAppOnReset': true } : {}),
  'appium:autoGrantPermissions': false,
  'appium:language': 'en',
  'appium:locale': 'US',
  'appium:newCommandTimeout': 240,
  'appium:uiautomator2ServerInstallTimeout': 120000,
};

export const iosCaps = PLATFORM === 'Android' ? android : ios;
export const caps = iosCaps;

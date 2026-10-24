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
  'appium:derivedDataPath': WDA_DIR,
  'appium:usePrebuiltWDA': process.env.WDA_PREBUILT === '1',
  'appium:reduceMotion': true,
  'appium:language': 'en',
  'appium:locale': 'en_US',
  'appium:wdaLaunchTimeout': 120000,
  'appium:newCommandTimeout': 240,
  'appium:settings[waitForIdleTimeout]': 1,
};

const android = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:udid': process.env.DEVICE_UDID,
  'appium:app': APP_PATH,
  'appium:appPackage': BUNDLE_ID,
  ...(process.env.APP_ACTIVITY ? { 'appium:appActivity': process.env.APP_ACTIVITY } : {}),
  'appium:noReset': true,
  'appium:autoGrantPermissions': false,
  'appium:language': 'en',
  'appium:locale': 'US',
  'appium:newCommandTimeout': 240,
  'appium:uiautomator2ServerInstallTimeout': 120000,
};

export const iosCaps = PLATFORM === 'Android' ? android : ios;
export const caps = iosCaps;

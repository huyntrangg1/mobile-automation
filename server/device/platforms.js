// Khác biệt iOS / Android gom một chỗ: thông tin app, danh sách thiết bị, capabilities Appium, chụp màn, popup hệ thống.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WDA_DIR } from '../paths.js';
import { listSimulators } from './simulators.js';

export const ANDROID_HOME = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), 'Library/Android/sdk');
// Appium / wdio cần biến này để tìm adb
export const androidEnv = () => ({ ANDROID_HOME, ANDROID_SDK_ROOT: ANDROID_HOME });
const ADB = fs.existsSync(path.join(ANDROID_HOME, 'platform-tools/adb')) ? path.join(ANDROID_HOME, 'platform-tools/adb') : 'adb';

const run = async (cmd, args) => (await promisify(execFile)(cmd === 'adb' ? ADB : cmd, args, { maxBuffer: 20 * 1024 * 1024 })).stdout;

function aapt2() {
  const dir = path.join(ANDROID_HOME, 'build-tools');
  const v = fs.existsSync(dir) ? fs.readdirSync(dir).sort().reverse().find((x) => fs.existsSync(path.join(dir, x, 'aapt2'))) : null;
  if (!v) throw new Error(`Không tìm thấy aapt2 trong ${dir} — cài Android SDK build-tools`);
  return path.join(dir, v, 'aapt2');
}

// File build → { platform, bundleId, version, activity?, label? }
export async function readAppInfo(appPath, { exists = fs.existsSync, exec = run } = {}) {
  if (/\.app\/?$/i.test(appPath)) {
    if (!exists(path.join(appPath, 'Info.plist'))) throw new Error(`Không thấy Info.plist trong "${appPath}"`);
    const plist = async (k) => String(await exec('plutil', ['-extract', k, 'raw', path.join(appPath, 'Info.plist')])).trim();
    const bundleId = await plist('CFBundleIdentifier');
    let version = '?';
    try { version = `${await plist('CFBundleShortVersionString')} (${await plist('CFBundleVersion')})`; } catch {}
    return { platform: 'iOS', bundleId, version };
  }
  if (/\.apk$/i.test(appPath)) {
    if (!exists(appPath)) throw new Error(`Không thấy file "${appPath}"`);
    const out = String(await exec(aapt2(), ['dump', 'badging', appPath]));
    const pkg = out.match(/^package: name='([^']+)' versionCode='([^']*)' versionName='([^']*)'/m);
    if (!pkg) throw new Error('Không đọc được package name trong APK');
    return {
      platform: 'Android', bundleId: pkg[1], version: `${pkg[3]} (${pkg[2]})`,
      activity: (out.match(/^launchable-activity: name='([^']+)'/m) || [])[1],
      label: (out.match(/^application-label:'([^']*)'/m) || [])[1],
    };
  }
  throw new Error('Cần file .app (iOS Simulator) hoặc .apk (Android)');
}

async function androidDevices(exec) {
  let out;
  try { out = String(await exec('adb', ['devices', '-l'])); } catch { return []; }
  const list = [];
  for (const line of out.split('\n').slice(1)) {
    const m = line.trim().match(/^(\S+)\s+device\b(.*)$/);
    if (!m) continue;
    const udid = m[1];
    let name = (m[2].match(/model:(\S+)/) || [])[1] || udid;
    if (udid.startsWith('emulator-')) {
      try { name = String(await exec('adb', ['-s', udid, 'emu', 'avd', 'name'])).split('\n')[0].trim() || name; } catch {}
    }
    let ver = '?';
    try { ver = String(await exec('adb', ['-s', udid, 'shell', 'getprop', 'ro.build.version.release'])).trim(); } catch {}
    list.push({ udid, name, os: `Android ${ver}`, booted: true, platform: 'Android' });
  }
  return list;
}

// Thiết bị đang dùng được; platform = 'iOS' | 'Android' | undefined (tất cả)
export async function listDevices(platform, exec = run) {
  const ios = platform === 'Android' ? [] : (await listSimulators(() => exec('xcrun', ['simctl', 'list', 'devices', 'available', '-j'])).catch(() => [])).map((d) => ({ ...d, platform: 'iOS' }));
  const android = platform === 'iOS' ? [] : await androidDevices(exec);
  return [...ios, ...android];
}

export function sessionCaps(app, udid) {
  if (app.platform === 'Android') {
    return {
      platformName: 'Android', 'appium:automationName': 'UiAutomator2', 'appium:udid': udid,
      'appium:app': app.appPath, 'appium:appPackage': app.bundleId, ...(app.activity ? { 'appium:appActivity': app.activity } : {}),
      'appium:noReset': false, 'appium:newCommandTimeout': 600, 'appium:autoGrantPermissions': false,
      'appium:language': 'en', 'appium:locale': 'US', 'appium:uiautomator2ServerInstallTimeout': 120000,
    };
  }
  return {
    platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': udid,
    'appium:app': app.appPath, 'appium:bundleId': app.bundleId, 'appium:noReset': false,
    'appium:derivedDataPath': WDA_DIR, 'appium:usePrebuiltWDA': fs.existsSync(path.join(WDA_DIR, 'Build/Products')),
    'appium:language': 'en', 'appium:locale': 'en_US', 'appium:reduceMotion': true,
    'appium:wdaLaunchTimeout': 120000, 'appium:newCommandTimeout': 600, 'appium:settings[waitForIdleTimeout]': 1,
  };
}

// Ảnh màn hình thiết bị (không qua Appium) — cùng thứ tự tham số với screenshotImpl của runner
export function deviceScreenshot(udid, file, platform = 'iOS') {
  if (platform === 'Android') {
    return new Promise((resolve, reject) => {
      execFile(ADB, ['-s', udid, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 }, (e, out) => {
        if (e) return reject(e);
        fs.writeFileSync(file, out);
        resolve();
      });
    });
  }
  return new Promise((resolve, reject) => {
    execFile('xcrun', ['simctl', 'io', udid, 'screenshot', '--type=jpeg', file], (e) => (e ? reject(e) : resolve()));
  });
}

// Hộp xin quyền Android (nằm trong page source, khác iOS) → { buttons, deny } hoặc null
export function systemDialog(xml) {
  if (!/package="com\.(google\.)?android\.permissioncontroller"/.test(xml)) return null;
  const buttons = [...xml.matchAll(/<[^>]*class="android\.widget\.Button"[^>]*>/g)].map((m) => (m[0].match(/\btext="([^"]*)"/) || [])[1]).filter(Boolean);
  const deny = (xml.match(/resource-id="([^"]*permission_deny[^"]*)"/) || [])[1];
  return { buttons, deny: deny ? `android=new UiSelector().resourceId("${deny}")` : null };
}

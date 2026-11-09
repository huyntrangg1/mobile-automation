// Khác biệt iOS / Android gom một chỗ: thông tin app, danh sách thiết bị, capabilities Appium, chụp màn, popup hệ thống.
import crypto from 'node:crypto';
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
export const ADB = fs.existsSync(path.join(ANDROID_HOME, 'platform-tools/adb')) ? path.join(ANDROID_HOME, 'platform-tools/adb') : 'adb';

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
    // Nền tảng thật lấy từ file chạy (vtool), không tin Info.plist: build app-store được chuyển sang Simulator (vd qua SimUtil)
    // có file chạy IOSSIMULATOR nhưng plist vẫn ghi iPhoneOS → Appium từ chối ("Simulator architecture is not supported")
    let platforms = '';
    try { platforms = String(await exec('plutil', ['-extract', 'CFBundleSupportedPlatforms', 'json', '-o', '-', path.join(appPath, 'Info.plist')])); } catch {}
    let binary = null;
    try {
      const exe = await plist('CFBundleExecutable');
      binary = (String(await exec('vtool', ['-show-build', path.join(appPath, exe)])).match(/platform\s+(\w+)/) || [])[1] || null;
    } catch {}
    const plistSim = !platforms || /iPhoneSimulator/.test(platforms);
    if (binary ? binary !== 'IOSSIMULATOR' : !plistSim) {
      throw new Error(`"${path.basename(appPath)}" là build cho iPhone thật (${binary || platforms.replace(/[[\]"\s]/g, '')}) — cần build cho Simulator (Xcode: chọn đích là một Simulator, hoặc lấy .app trong Debug-iphonesimulator)`);
    }
    const simPlistFix = binary === 'IOSSIMULATOR' && !plistSim; // tool sửa plist trên bản copy trong workspace
    let version = '?';
    try { version = `${await plist('CFBundleShortVersionString')} (${await plist('CFBundleVersion')})`; } catch {}
    return { platform: 'iOS', bundleId, version, ...(simPlistFix ? { simPlistFix: true } : {}) };
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

// ---- iPhone thật ----
// udid simulator = UUID (8-4-4-4-12); iPhone thật = 8-16 hex (00008120-001055C03C44A01E) hoặc 40 hex (máy đời cũ)
export const isRealIos = (udid) => /^[0-9A-F]{8}-[0-9A-F]{16}$/i.test(String(udid)) || /^[0-9a-f]{40}$/.test(String(udid));

// iPhone đã ghép đôi với Mac (xcrun devicectl, cần Xcode 15+). Máy "unavailable" = chưa cắm / chưa mở khoá / tắt nguồn
// Xcode (xctrace) báo máy nằm trong "Devices Offline" dù devicectl báo available/paired → Appium không thấy máy ("Unknown device or simulator UDID")
async function offlineRealIos(exec) {
  try {
    const out = String((await exec('xcrun', ['xctrace', 'list', 'devices'])) || '');
    const sec = out.match(/== Devices Offline ==([\s\S]*?)(?:\n== |$)/);
    return new Set(sec ? [...sec[1].matchAll(/\(([0-9A-Fa-f]{8}-[0-9A-Fa-f]{16})\)/g)].map((m) => m[1]) : []);
  } catch { return new Set(); }
}

export function explainSessionError(err, udid) {
  if (/Unknown device or simulator UDID/i.test(String(err?.message))) {
    return new Error(`Appium / Xcode không thấy thiết bị ${udid} (đang offline hoặc đã rút). Cắm cáp USB, mở khóa iPhone, bấm "Tin cậy" và bật Developer Mode, rồi kiểm tra lệnh \`xcrun xctrace list devices\` thấy máy ở mục "Devices" (không phải "Devices Offline"). Hoặc chọn một Simulator.`);
  }
  return err;
}

export async function listRealIos(exec = run) {
  const tmp = path.join(os.tmpdir(), `qapd-devicectl-${process.pid}-${Date.now()}.json`);
  try {
    await exec('xcrun', ['devicectl', 'list', 'devices', '--json-output', tmp]);
    const devs = JSON.parse(fs.readFileSync(tmp, 'utf8'))?.result?.devices || [];
    const offline = await offlineRealIos(exec);
    const list = devs
      .filter((d) => /iPhone|iPad/i.test(d.hardwareProperties?.marketingName || d.hardwareProperties?.productType || d.deviceProperties?.name || 'iPhone') && d.hardwareProperties?.udid)
      .map((d) => ({
        udid: d.hardwareProperties.udid, name: d.deviceProperties?.name || d.hardwareProperties.marketingName || 'iPhone',
        os: `iOS ${d.deviceProperties?.osVersionNumber || '?'}`, platform: 'iOS', real: true,
        booted: d.connectionProperties?.pairingState === 'paired' && d.connectionProperties?.tunnelState !== 'unavailable',
      }));
    return list.map((d) => (offline.has(d.udid) ? { ...d, booted: false, offline: true, note: 'Xcode báo máy offline: cắm cáp USB, mở khóa iPhone, bấm Tin cậy' } : d));
  } catch { return []; } finally { fs.rmSync(tmp, { force: true }); }
}

// Apple Team ID để ký WebDriverAgent: biến TEAM_ID của app → QAPD_TEAM_ID → team duy nhất Xcode đang đăng nhập
export async function detectTeamId(app, exec = run) {
  const set = app?.env?.TEAM_ID || process.env.QAPD_TEAM_ID;
  if (set) return set.trim();
  try {
    const ids = [...new Set([...String(await exec('defaults', ['read', 'com.apple.dt.Xcode', 'IDEProvisioningTeamByIdentifier'])).matchAll(/teamID = (\w+)/g)].map((m) => m[1]))];
    return ids.length === 1 ? ids[0] : null;
  } catch { return null; }
}

// Capabilities iPhone thật: KHÔNG cài app (dùng bản đã cài trên máy, giữ nguyên dữ liệu), WDA ký bằng team của bạn
export function realIosCaps(app, udid, teamId) {
  if (!teamId) throw new Error('iPhone thật cần Apple Team ID để ký WebDriverAgent — vào Cài đặt app thêm biến TEAM_ID (xem ở Xcode → Settings → Accounts → Team ID), hoặc đặt QAPD_TEAM_ID');
  return {
    platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': udid, 'appium:bundleId': app.bundleId,
    'appium:noReset': true, 'appium:newCommandTimeout': 600, 'appium:waitForQuiescence': false, 'appium:wdaLaunchTimeout': 240000, 'appium:wdaConnectionTimeout': 240000,
    'appium:xcodeOrgId': teamId, 'appium:xcodeSigningId': 'Apple Development',
    // Team miễn phí: bundle id WDA phải duy nhất cho team → gắn team id vào
    'appium:updatedWDABundleId': `com.qapd.wda.${String(teamId).toLowerCase()}`, 'appium:allowProvisioningDeviceRegistration': true,
    'appium:derivedDataPath': `${WDA_DIR}-device`, 'appium:usePrebuiltWDA': false, 'appium:showXcodeLog': true, 'appium:language': 'en', 'appium:locale': 'en_US',
  };
}

// Thiết bị đang dùng được; platform = 'iOS' | 'Android' | undefined (tất cả)
export async function listDevices(platform, exec = run) {
  const sims = platform === 'Android' ? [] : (await listSimulators(() => exec('xcrun', ['simctl', 'list', 'devices', 'available', '-j'])).catch(() => [])).map((d) => ({ ...d, platform: 'iOS' }));
  const real = platform === 'Android' ? [] : await listRealIos(exec);
  const android = platform === 'iOS' ? [] : await androidDevices(exec);
  return [...real, ...sims, ...android];
}

// Phiên lấy locator: popup xin quyền / ATT tự xử lý ngay khi hiện (không đứng chờ tester, AI không bị chặn)
//   theo biến SYSTEM_ALERT của app: allow → cho phép, off → để nguyên, còn lại (mặc định) → từ chối
const alertCaps = (app) => {
  const policy = String(app.env?.SYSTEM_ALERT || 'deny').toLowerCase();
  if (policy === 'off') return {};
  return policy === 'allow' ? { 'appium:autoAcceptAlerts': true } : { 'appium:autoDismissAlerts': true };
};

export function sessionCaps(app, udid) {
  if (app.platform === 'Android') {
    return {
      platformName: 'Android', 'appium:automationName': 'UiAutomator2', 'appium:udid': udid,
      'appium:app': app.appPath, 'appium:appPackage': app.bundleId, ...(app.activity ? { 'appium:appActivity': app.activity } : {}),
      // Cấp sẵn mọi quyền lúc cài → hộp xin quyền không chặn việc lấy locator (SYSTEM_ALERT=off thì để app tự hỏi)
      'appium:noReset': false, 'appium:newCommandTimeout': 600, 'appium:autoGrantPermissions': String(app.env?.SYSTEM_ALERT || '').toLowerCase() !== 'off',
      'appium:language': 'en', 'appium:locale': 'US', 'appium:uiautomator2ServerInstallTimeout': 120000,
    };
  }
  return {
    platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': udid,
    'appium:app': app.appPath, 'appium:bundleId': app.bundleId, 'appium:noReset': false,
    'appium:derivedDataPath': WDA_DIR, 'appium:usePrebuiltWDA': fs.existsSync(path.join(WDA_DIR, 'Build/Products')),
    'appium:reduceMotion': true, // không đặt language / locale: xem ghi chú ở ios.caps.js (launchctl exit code 3 trên Simulator iOS 26)
    // Như framework của skill (Ctx.java, GUIDE §8): không chờ app "yên" (app có animation làm lệnh chậm / chụp giữa lúc chuyển động), WDA thử lại, timeout dài
    'appium:waitForQuiescence': false, 'appium:wdaStartupRetries': 3, 'appium:wdaStartupRetryInterval': 5000,
    'appium:wdaLaunchTimeout': 180000, 'appium:wdaConnectionTimeout': 180000, 'appium:newCommandTimeout': 600, 'appium:settings[waitForIdleTimeout]': 1,
    ...alertCaps(app),
  };
}

// Phiên gắn vào app đang mở sẵn (thử locator): không cài lại, không tự mở / tắt app — giữ nguyên màn tester đang đứng
export function attachCaps(app, udid) {
  if (app.platform === 'Android') {
    return {
      platformName: 'Android', 'appium:automationName': 'UiAutomator2', 'appium:udid': udid, 'appium:appPackage': app.bundleId,
      'appium:noReset': true, 'appium:dontStopAppOnReset': true, 'appium:autoLaunch': false, 'appium:newCommandTimeout': 600,
    };
  }
  return {
    platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': udid, 'appium:bundleId': app.bundleId,
    'appium:noReset': true, 'appium:autoLaunch': false, 'appium:shouldTerminateApp': false, 'appium:forceAppLaunch': false,
    'appium:derivedDataPath': WDA_DIR, 'appium:usePrebuiltWDA': fs.existsSync(path.join(WDA_DIR, 'Build/Products')),
    'appium:waitForQuiescence': false, 'appium:wdaStartupRetries': 3, 'appium:wdaStartupRetryInterval': 5000,
    'appium:wdaLaunchTimeout': 180000, 'appium:wdaConnectionTimeout': 180000, 'appium:newCommandTimeout': 600,
  };
}

// Info.plist ghi iPhoneOS nhưng file chạy là Simulator → sửa plist thành iPhoneSimulator rồi ký lại ad-hoc (chỉ bản copy trong workspace)
export async function fixSimPlist(appPath, { exec = run } = {}) {
  await exec('plutil', ['-replace', 'CFBundleSupportedPlatforms', '-json', '["iPhoneSimulator"]', path.join(appPath, 'Info.plist')]);
  await exec('codesign', ['--force', '--sign', '-', '--timestamp=none', appPath]);
}

// Simulator đã cài đúng bản WebDriverAgent của WDA_DIR (lần Run / lấy locator trước cài vào) → Run mở thẳng WDA, không cần xcodebuild.
// So mã băm thư viện WDA (Info.plist luôn "1.0 (1)"): WDA cũ do Appium / tool khác cài → false → xcodebuild cài lại bản đúng
const WDA_LIB = 'PlugIns/WebDriverAgentRunner.xctest/Frameworks/WebDriverAgentLib.framework/WebDriverAgentLib';
const sha1 = async (f) => crypto.createHash('sha1').update(await fs.promises.readFile(f)).digest('hex');
// Simulator vừa bật còn dở dang thì Appium khởi động lại dịch vụ SpringBoard / tccd và gặp "'/bin/launchctl' failed with exit code 3".
// bootstatus -b: bật nếu đang tắt và CHỜ tới khi hệ thống sẵn sàng (đã bật xong thì trả về ngay).
// Có giới hạn thời gian (mặc định 120s): simulator treo lúc bật thì không giữ run 'running' + khoá thiết bị mãi
export async function ensureSimulatorReady(udid, { exec, timeoutMs = 120000 } = {}) {
  if (!/^[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}$/i.test(String(udid))) return false;
  const call = exec ? exec('xcrun', ['simctl', 'bootstatus', udid, '-b'])
    : promisify(execFile)('xcrun', ['simctl', 'bootstatus', udid, '-b'], { timeout: timeoutMs, killSignal: 'SIGKILL' });
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`simctl bootstatus quá ${Math.round(timeoutMs / 1000)}s`)), timeoutMs); });
  try { await Promise.race([call, limit]); return true; } catch { return false; } finally { clearTimeout(timer); call.catch?.(() => {}); }
}

export async function wdaInstalled(udid, { exec = run, wdaDir = WDA_DIR } = {}) {
  try {
    const installed = String(await exec('xcrun', ['simctl', 'get_app_container', udid, 'com.facebook.WebDriverAgentRunner.xctrunner', 'app'])).trim();
    const built = path.join(wdaDir, 'Build/Products/Debug-iphonesimulator/WebDriverAgentRunner-Runner.app');
    return (await sha1(path.join(installed, WDA_LIB))) === (await sha1(path.join(built, WDA_LIB)));
  } catch {
    return false;
  }
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
  // iPhone thật: simctl không chụp được → idevicescreenshot (libimobiledevice) nếu có; không có thì báo rõ, unsupported = đừng thử lại
  if (isRealIos(udid)) {
    return new Promise((resolve, reject) => {
      execFile('idevicescreenshot', ['-u', udid, file], { timeout: 15000 }, (e) => {
        if (!e) return resolve();
        if (e.code === 'ENOENT') return reject(Object.assign(new Error('iPhone thật cần idevicescreenshot (brew install libimobiledevice) để chụp màn — test vẫn chạy bình thường'), { unsupported: true }));
        reject(e);
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

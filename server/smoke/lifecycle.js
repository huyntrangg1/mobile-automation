// Thao tác vòng đời app cho phần "kiểm bền vững": đưa app xuống nền rồi mở lại, xoay màn hình.
// Đã thử trên iOS Simulator: kích hoạt SpringBoard làm app xuống nền (nút Home qua Appium không có tác dụng);
// xoay màn hình báo "Unable To Rotate Device" khi app khóa hướng dọc → để tool ghi log chứ không coi là lỗi app.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const clamp = (s) => { const n = Number(s); return Number.isFinite(n) && n !== 0 ? Math.min(30, Math.max(1, Math.round(n))) : 5; };

export async function backgroundApp(driver, app, seconds = 5) {
  const s = clamp(seconds);
  if (app.platform === 'Android') await driver.pressKeyCode(3); // KEYCODE_HOME (chưa kiểm chứng trên máy thật)
  else await driver.execute('mobile: activateApp', { bundleId: 'com.apple.springboard' });
  await driver.pause(s * 1000);
  await driver.execute('mobile: activateApp', app.platform === 'Android' ? { appId: app.bundleId } : { bundleId: app.bundleId });
  return s;
}

export async function rotateDevice(driver, orientation) {
  const o = /land/i.test(String(orientation)) ? 'LANDSCAPE' : 'PORTRAIT';
  await driver.setOrientation(o);
  return o;
}

// Mở màn bằng deep link (skill mục 6): vào thẳng màn con, khỏi đi qua nhiều bước
export async function openDeepLink(driver, app, url) {
  const u = String(url || '').trim();
  if (!u) throw new Error('Thiếu link để mở');
  await driver.execute('mobile: deepLink', app.platform === 'Android' ? { url: u, package: app.bundleId } : { url: u, bundleId: app.bundleId });
  return u;
}

// Hồ sơ app (skill: app-profiles): danh sách deep link đã thống nhất với dev, lưu trong bản ghi app (mảng hoặc chuỗi nhiều dòng)
export function appDeepLinks(app) {
  const d = app?.deepLinks;
  const arr = Array.isArray(d) ? d : String(d || '').split('\n');
  return arr.map((x) => String(x).trim()).filter(Boolean);
}

// Push giả lập (skill mục 5): iOS Simulator nhận payload APNs qua simctl, không cần backend
export async function sendPush({ udid, app, title = '', body = '', exec = defaultExec }) {
  if (app.platform === 'Android' || !/^[0-9A-F-]{36}$/i.test(String(udid || ''))) throw new Error('Push giả lập chỉ hỗ trợ iOS Simulator');
  const file = path.join(os.tmpdir(), `qapd-push-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ aps: { alert: { title: String(title || ''), body: String(body || '') } } }));
  try { await exec('xcrun', ['simctl', 'push', udid, app.bundleId, file]); } finally { try { fs.unlinkSync(file); } catch { /* đã xoá */ } }
}
const defaultExec = async (cmd, args) => (await promisify(execFile)(cmd, args)).stdout;

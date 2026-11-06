// Thao tác thiết bị cho AI Smoke Test (qua phiên Appium của webdriverio): tìm theo chữ / locator, tap điểm %, vuốt,
// chờ màn đứng yên, chụp, quay video (simctl / screenrecord) và cắt dải khung hình (ffmpeg). Không dùng AI.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { ADB } from '../device/platforms.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => new Promise((resolve) => execFile(cmd, args, { timeout: 30000, ...opts }, (err, stdout) => resolve(err ? null : stdout)));
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Selector theo chữ: exact trước, sau đó gần đúng (không phân biệt hoa thường / dấu, chứa chuỗi)
export function textSelectors(text, isAndroid) {
  if (isAndroid) {
    return [
      `android=new UiSelector().text("${q(text)}")`,
      `android=new UiSelector().description("${q(text)}")`,
      `android=new UiSelector().textMatches("(?is).*${q(reEsc(text))}.*")`,
      `android=new UiSelector().descriptionMatches("(?is).*${q(reEsc(text))}.*")`,
    ];
  }
  const t = q(text);
  return [
    `-ios predicate string:(label == "${t}" OR name == "${t}" OR value == "${t}") AND visible == 1`,
    `-ios predicate string:(label CONTAINS[cd] "${t}" OR name CONTAINS[cd] "${t}") AND visible == 1`,
  ];
}

async function firstDisplayed(driver, sels, timeout) {
  const end = Date.now() + timeout;
  do {
    for (const s of sels) {
      try {
        const els = await driver.$$(s);
        for (const el of els) if (await el.isDisplayed().catch(() => false)) return el;
      } catch {}
    }
    await sleep(300);
  } while (Date.now() < end);
  return null;
}

// → { ok, tried: [mô tả các cách đã thử], how? }
export async function tapTarget(driver, target, { timeout = 6000 } = {}) {
  const tried = [];
  if (target.by === 'point') {
    await tapPoint(driver, target.x, target.y);
    return { ok: true, tried, how: `điểm ${target.x}% · ${target.y}%` };
  }
  if (target.by === 'locator') {
    const el = await firstDisplayed(driver, [target.value], timeout);
    if (el) { await el.click(); return { ok: true, tried }; }
    tried.push(`Tìm locator ${target.value} trong ${timeout / 1000}s — không thấy`);
    return { ok: false, tried };
  }
  const sels = textSelectors(target.value, driver.isAndroid);
  const exact = await firstDisplayed(driver, sels.slice(0, driver.isAndroid ? 2 : 1), timeout);
  if (exact) { await exact.click(); return { ok: true, tried }; }
  tried.push(`Tìm chữ "${target.value}" trong ${timeout / 1000}s — không thấy`);
  const fuzzy = await firstDisplayed(driver, sels.slice(driver.isAndroid ? 2 : 1), 1500);
  if (fuzzy) { await fuzzy.click(); return { ok: true, tried, how: 'chữ gần đúng' }; }
  tried.push(`Tìm chữ gần đúng (hoa thường, chứa chuỗi) — không thấy`);
  return { ok: false, tried };
}

const touch = (driver) => driver.action('pointer', { parameters: { pointerType: 'touch' } });

export async function tapPoint(driver, xPct, yPct) {
  const { width, height } = await driver.getWindowRect();
  const x = Math.round((width * xPct) / 100);
  const y = Math.round((height * yPct) / 100);
  await touch(driver).move({ x, y }).down().pause(80).up().perform();
}

// Vuốt trong vùng 20–80% (không chạm mép → không mở thanh hệ thống)
export async function swipe(driver, direction, count = 1) {
  const { width: w, height: h } = await driver.getWindowRect();
  const p = { left: [0.8, 0.5, 0.2, 0.5], right: [0.2, 0.5, 0.8, 0.5], up: [0.5, 0.75, 0.5, 0.25], down: [0.5, 0.25, 0.5, 0.75] }[direction] || [0.8, 0.5, 0.2, 0.5];
  for (let i = 0; i < count; i++) {
    await touch(driver).move({ x: Math.round(w * p[0]), y: Math.round(h * p[1]) }).down().pause(60)
      .move({ duration: 250, x: Math.round(w * p[2]), y: Math.round(h * p[3]) }).up().perform();
    await sleep(350);
  }
}

// Màn đứng yên: page source giống nhau `same` lần liên tiếp (tối đa maxMs). before: source trước thao tác →
// chờ màn ĐỔI trước (tối đa changeMs), vì lúc chuyển cảnh page source có thể chưa đổi ngay sau khi tap
export async function waitStable(driver, { maxMs = 6000, everyMs = 350, same = 3, before = null, changeMs = 3000 } = {}) {
  const read = () => driver.getPageSource().catch(() => null);
  let changed = before == null;
  if (!changed) {
    const until = Date.now() + changeMs;
    while (Date.now() < until) {
      const s = await read();
      if (s && s !== before) { changed = true; break; }
      await sleep(250);
    }
  }
  let prev = null;
  let n = 0;
  let src = null;
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    src = await read();
    n = src && src === prev ? n + 1 : 1;
    if (n >= same) return { stable: true, changed, source: src };
    prev = src;
    await sleep(everyMs);
  }
  return { stable: false, changed, source: src };
}

// Hộp hệ thống (quyền theo dõi, thông báo…) đang che màn → xử lý theo SYSTEM_ALERT của app (deny | allow | off)
export async function clearAlert(driver, policy = 'deny') {
  const text = await systemAlert(driver);
  if (!text || policy === 'off') return text ? { text, handled: false } : null;
  await (policy === 'allow' ? driver.acceptAlert() : driver.dismissAlert()).catch(() => {});
  await sleep(600);
  return { text, handled: true };
}

// iOS Simulator: thanh trạng thái giống mockup (9:41, pin đầy) → không thành vùng khác khi so
export const statusBar = (udid, on = true) => run('xcrun', on
  ? ['simctl', 'status_bar', udid, 'override', '--time', '9:41', '--batteryState', 'charged', '--batteryLevel', '100', '--cellularBars', '4', '--wifiBars', '3']
  : ['simctl', 'status_bar', udid, 'clear']);

export async function systemAlert(driver) {
  if (driver.isAndroid) return null;
  try { return await driver.getAlertText(); } catch { return null; }
}

// Chụp: ảnh + page source + kích thước cửa sổ + mật độ (Android: px / dp)
export async function capture(driver, base, { before = null } = {}) {
  const { source } = await waitStable(driver, { before });
  await sleep(200);
  const png = Buffer.from(await driver.takeScreenshot(), 'base64');
  const win = await driver.getWindowRect();
  const caps = driver.capabilities || {};
  const density = driver.isAndroid ? (Number(caps.pixelRatio || caps['appium:pixelRatio']) || (Number(caps.deviceScreenDensity) || 0) / 160 || null) : 1;
  const meta = { win: { width: win.width, height: win.height }, density, platform: driver.isAndroid ? 'Android' : 'iOS', at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(base), { recursive: true });
  fs.writeFileSync(`${base}.png`, png);
  fs.writeFileSync(`${base}.xml`, source || '');
  fs.writeFileSync(`${base}.json`, JSON.stringify(meta));
  return { png, xml: source || '', ...meta };
}

// ---- Quay video cho bước Animation ----

export async function startRecording({ udid, platform, file }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (platform === 'Android') {
    const remote = '/sdcard/qa-ui-anim.mp4';
    const proc = spawn(ADB, ['-s', udid, 'shell', 'screenrecord', '--bit-rate', '8000000', remote], { stdio: 'ignore' });
    await sleep(800);
    return {
      async stop() {
        await run(ADB, ['-s', udid, 'shell', 'pkill', '-INT', 'screenrecord']);
        await new Promise((r) => { if (proc.exitCode != null) r(); else { proc.once('close', r); setTimeout(r, 3000); } });
        await sleep(500);
        await run(ADB, ['-s', udid, 'pull', remote, file]);
        return fs.existsSync(file) ? file : null;
      },
    };
  }
  const proc = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--force', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  // simctl in "Recording started" khi đã quay thật
  await new Promise((r) => {
    const t = setTimeout(r, 2000);
    proc.stderr.on('data', (d) => { if (/Recording started/i.test(String(d))) { clearTimeout(t); r(); } });
    proc.once('close', () => { clearTimeout(t); r(); });
  });
  return {
    async stop() {
      if (proc.exitCode == null) proc.kill('SIGINT');
      await new Promise((r) => { if (proc.exitCode != null) r(); else { proc.once('close', r); setTimeout(r, 5000); } });
      return fs.existsSync(file) && fs.statSync(file).size > 0 ? file : null;
    },
  };
}

// Video → dải khung hình đều nhau (mặc định 8 khung, rộng 220px) — không có ffmpeg thì bỏ qua
export async function frameStrip(video, outDir, { frames = 8, width = 220 } = {}) {
  const dur = Number(String(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]) || '').trim());
  if (!dur) return [];
  fs.mkdirSync(outDir, { recursive: true });
  const fps = Math.max(0.5, (frames - 1) / dur);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', `fps=${fps.toFixed(3)},scale=${width}:-2`, '-frames:v', String(frames), path.join(outDir, 'f-%02d.jpg')]);
  return fs.readdirSync(outDir).filter((f) => /^f-\d+\.jpg$/.test(f)).sort().map((f, i) => ({ file: path.join(outDir, f), t: Math.round((i / fps) * 1000) }));
}

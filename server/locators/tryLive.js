// Thử locator trên máy: gắn vào app đang mở sẵn (không cài / mở lại), tìm phần tử, chụp màn hiện tại, tuỳ chọn bấm thử.
// Giữ phiên tới khi rảnh idleMs (lần thử sau nhanh); Run / Lấy locator chiếm thiết bị → đóng phiên trước.
import fs from 'node:fs';
import path from 'node:path';
import { checkLocator } from './locatorFormat.js';
import { attachSession } from '../device/session.js';

const err = (message, status) => Object.assign(new Error(message), { status });

export function createTryLive({ store, lock, dataDir, attachImpl = attachSession, idleMs = 300000 }) {
  const sessions = new Map(); // udid → { s, appId, timer }

  const close = async (udid) => {
    const x = sessions.get(udid);
    if (!x) return;
    sessions.delete(udid);
    clearTimeout(x.timer);
    await Promise.resolve(x.s.close()).catch(() => {});
  };
  const closeAll = () => Promise.all([...sessions.keys()].map(close));
  // Trả promise: Lấy locator / Run chờ phiên thử đóng hẳn (kể cả Appium cổng 4724 phiên này mở) rồi mới mở phiên mới
  lock.onAcquire?.((job) => (job.kind !== 'try' ? closeAll() : undefined));

  async function sessionFor(app, udid) {
    let x = sessions.get(udid);
    if (x && x.appId !== app.id) { await close(udid); x = null; }
    if (!x) {
      x = { s: await attachImpl({ app, udid }), appId: app.id };
      sessions.set(udid, x);
    }
    clearTimeout(x.timer);
    x.timer = setTimeout(() => close(udid), idleMs);
    x.timer.unref?.();
    return x.s.driver;
  }

  // Ảnh màn hiện tại → data/screens/<app>/_try.png (đã phục vụ qua /files/data/screens)
  async function shot(driver, appId) {
    const file = path.join(dataDir, 'screens', appId, '_try.png');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await driver.takeScreenshot(), 'base64'));
    return `/files/data/screens/${appId}/_try.png?t=${Date.now()}`;
  }

  async function describe(driver, el) {
    const [loc, size, visible, enabled, tag] = await Promise.all([el.getLocation(), el.getSize(), el.isDisplayed().catch(() => false), el.isEnabled().catch(() => false), el.getTagName().catch(() => '')]);
    const attr = (k) => el.getAttribute(k).catch(() => null);
    const name = driver.isAndroid ? (await attr('content-desc')) || (await attr('resource-id')) : await attr('name');
    const label = driver.isAndroid ? await attr('text') : await attr('label');
    return { type: String(tag).replace('XCUIElementType', '').split('.').pop(), name: name || '', label: label || '', rect: { x: loc.x, y: loc.y, width: size.width, height: size.height }, visible, enabled };
  }

  // { appId, udid, locator, tap? } → { count, elements (tối đa 10), point?, tapped, shotUrl, win }
  async function run({ appId, udid, locator, tap = false }) {
    const app = store.get('apps', appId);
    if (!app) throw err('Không có app này', 404);
    if (!udid) throw err('Chọn thiết bị để thử', 400);
    let loc;
    try { loc = checkLocator(locator); } catch (e) { throw err(e.message, 400); }
    const id = `try-${Date.now()}`;
    const got = lock.acquire({ kind: 'try', id, label: `Đang thử locator · ${app.name}` });
    if (!got.ok) throw err(`Thiết bị đang bận: ${got.holder.label}`, 409);
    try {
      const driver = await sessionFor(app, udid);
      // Đưa app ra trước nếu đang ở nền — không khởi động lại, giữ màn đang đứng
      await driver.execute('mobile: activateApp', driver.isAndroid ? { appId: app.bundleId } : { bundleId: app.bundleId }).catch(() => {});
      const { width, height } = await driver.getWindowRect();
      const win = { width, height };
      const p = loc.match(/^point:(\d*\.?\d+),(\d*\.?\d+)$/);
      let elements = [];
      let count = 0;
      let tapped = false;
      if (p) {
        if (tap) {
          await driver.execute(driver.isAndroid ? 'mobile: clickGesture' : 'mobile: tap', { x: Math.round(Number(p[1]) * width), y: Math.round(Number(p[2]) * height) });
          tapped = true;
        }
      } else {
        const found = await driver.$$(loc);
        count = found.length;
        elements = await Promise.all(found.slice(0, 10).map((el) => describe(driver, el)));
        if (tap && found[0]) { await found[0].click(); tapped = true; }
      }
      if (tapped) await driver.pause(800); // chờ app phản ứng rồi mới chụp
      return { count, elements, ...(p ? { point: { fx: Number(p[1]), fy: Number(p[2]) } } : {}), tapped, shotUrl: await shot(driver, appId), win };
    } catch (e) {
      if (!e.status) await close(udid); // phiên hỏng → lần sau mở lại
      throw e.status ? e : err(`Không thử được trên máy: ${String(e.message || e).split('\n')[0]}`, 502);
    } finally {
      lock.release(id);
    }
  }

  return { run, closeAll };
}

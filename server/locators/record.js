// Job lấy locator (giữ simulator qua lock). 2 chế độ:
//   record  — tester tự bấm qua app trên Simulator, tool đọc page source liên tục và lưu màn mới
//   explore — AI tự bấm khám phá (server/locators/explore.js)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseElements, screenSignature } from './pageSource.js';
import { systemDialog } from '../device/platforms.js';

const MAX_LOG = 300;

export function createCaptures({ store, lock, emit, map, openSession, loops = {}, pollMs = 700 }) {
  const running = new Map(); // id → { stop: bool }
  const liveFile = (id) => path.join(map.dataDir, 'captures', `${id}.png`);

  const update = (id, patch) => {
    const c = store.patch('captures', id, patch);
    emit('capture', c);
    return c;
  };
  const log = (id, text) => {
    const c = store.get('captures', id);
    update(id, { log: [...c.log, { at: new Date().toISOString(), text }].slice(-MAX_LOG) });
  };

  // Chụp màn hiện tại: cập nhật ảnh live, màn mới → thêm vào map
  async function snap(id, appId, driver, { nameHint, seenBy }) {
    const xml = await driver.getPageSource();
    const png = Buffer.from(await driver.takeScreenshot(), 'base64');
    fs.mkdirSync(path.dirname(liveFile(id)), { recursive: true });
    fs.writeFileSync(liveFile(id), png);
    const elements = parseElements(xml);
    // < 2 phần tử: app đang mở / chuyển màn → chưa ghi
    if (elements.length < 2) return { xml, screen: null, isNew: false, elements };
    const { screen, isNew, added } = map.addSnapshot(appId, { xml, png, nameHint, seenBy });
    const c = store.get('captures', id);
    const seen = new Set([...(c.seen || []), screen.id]);
    update(id, {
      polls: (c.polls || 0) + 1, seen: [...seen], screensFound: seen.size,
      current: { screenName: screen.name, screenId: screen.id, screenshot: `/files/data/captures/${id}.png?t=${Date.now()}` },
    });
    if (isNew) log(id, `Màn mới: ${screen.name} (${screen.elements.length} phần tử)`);
    else if (added) log(id, `${screen.name}: thêm ${added} phần tử`);
    return { xml, screen, isNew, elements };
  }

  // Popup hệ thống (quyền theo dõi, thông báo…) không nằm trong page source của app → hỏi riêng
  const alertButtons = async (driver) => {
    try {
      const b = await driver.execute('mobile: alert', { action: 'getButtons' });
      return Array.isArray(b) && b.length ? b : null;
    } catch {
      return null;
    }
  };

  async function recordLoop(id, appId, driver, job, opts = {}) {
    const android = opts.app?.platform === 'Android';
    let last = null;
    let alertShown = null;
    for (let n = 0; !job.stop; n++) {
      const xml = await driver.getPageSource();
      const els = parseElements(xml);
      const sig = screenSignature(els);
      // Android: hộp xin quyền nằm ngay trong page source → nhắc tester, không ghi thành màn
      const dlg = android ? systemDialog(xml) : null;
      if (android) {
        const key = dlg ? dlg.buttons.join('|') : null;
        if (key && key !== alertShown) log(id, `Popup hệ thống đang che màn hình (${dlg.buttons.join(' / ')}) — bấm một nút trên thiết bị để đóng.`);
        alertShown = key;
        if (dlg) {
          const c = store.get('captures', id);
          store.patch('captures', id, { polls: (c.polls || 0) + 1 });
          await new Promise((r) => setTimeout(r, pollMs));
          continue;
        }
      }
      // iOS: hỏi popup tốn ~2s khi không có popup → chỉ hỏi mỗi 4 lần đọc, để không lỡ màn tester bấm qua nhanh
      if (!android && n % 4 === 0) {
        const alert = await alertButtons(driver);
        const alertKey = alert ? alert.join('|') : null;
        if (alertKey && alertKey !== alertShown) log(id, `Popup hệ thống đang che màn hình (${alert.join(' / ')}) — bấm một nút trên Simulator để đóng.`);
        alertShown = alertKey;
      }
      // < 2 phần tử: app đang mở / chuyển màn → chưa ghi
      if (els.length >= 2 && sig !== last) {
        await snap(id, appId, driver, { seenBy: 'record' });
        last = sig;
      } else {
        const c = store.get('captures', id);
        store.patch('captures', id, { polls: (c.polls || 0) + 1 });
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  const LOOPS = { record: recordLoop, ...loops };

  async function run(id, app, opts, job) {
    let session = null;
    try {
      log(id, `Đang mở app trên ${app.platform === 'Android' ? 'thiết bị Android' : 'Simulator'}…`);
      session = await openSession({ app, udid: opts.udid });
      log(id, opts.mode === 'record' ? `Sẵn sàng — bấm qua app trên ${app.platform === 'Android' ? 'thiết bị Android' : 'Simulator'}, tool tự ghi lại từng màn.` : 'AI bắt đầu khám phá app.');
      await LOOPS[opts.mode](id, app.id, session.driver, job, { ...opts, app, snap: (d, o) => snap(id, app.id, d, o), log: (t) => log(id, t), update: (p) => update(id, p), renameScreen: (sid, n) => map.renameScreen(sid, n), screens: () => store.list('screens').filter((s) => s.appId === app.id) });
      const c = store.get('captures', id);
      if (c.status === 'running') update(id, { status: job.stop ? 'stopped' : 'done' });
    } catch (e) {
      update(id, { status: job.stop ? 'stopped' : 'error', error: job.stop ? null : String(e.message || e).split('\n')[0] });
    } finally {
      await session?.close().catch(() => {});
      try { map.exportLocators(app.id); } catch {}
      update(id, { finishedAt: new Date().toISOString() });
      running.delete(id);
      lock.release(id);
      emit('lock', lock.current());
      emit('app', { id: app.id });
    }
  }

  async function start(appId, opts) {
    const app = store.get('apps', appId);
    if (!app) throw Object.assign(new Error('Không có app này'), { status: 404 });
    if (app.status !== 'ready') throw Object.assign(new Error('App chưa sẵn sàng (đang chuẩn bị project hoặc bị lỗi)'), { status: 409 });
    if (!LOOPS[opts.mode]) throw Object.assign(new Error(`Chế độ "${opts.mode}" không có`), { status: 400 });
    const id = `cap-${crypto.randomUUID().slice(0, 8)}`;
    const label = opts.mode === 'record' ? `Ghi locator · ${app.name}` : `AI khám phá · ${app.name}`;
    const got = lock.acquire({ kind: 'capture', id, label });
    if (!got.ok) throw Object.assign(new Error(`Simulator đang bận: ${got.holder.label}`), { status: 409 });
    emit('lock', lock.current());
    store.put('captures', { id, appId, mode: opts.mode, udid: opts.udid, status: 'running', screensFound: 0, polls: 0, seen: [], current: null, log: [], startedAt: new Date().toISOString() });
    const job = { stop: false };
    running.set(id, job);
    run(id, app, opts, job);
    return id;
  }

  async function stop(id) {
    const job = running.get(id);
    if (!job) return;
    job.stop = true;
    while (running.has(id)) await new Promise((r) => setTimeout(r, 20));
  }

  return { start, stop };
}

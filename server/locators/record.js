// Job lấy locator (giữ simulator qua lock). 2 chế độ:
//   record  — tester tự bấm qua app trên Simulator, tool đọc page source liên tục và lưu màn mới
//   explore — AI tự bấm khám phá (server/locators/explore.js)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseElements, screenSignature, isTransient } from './pageSource.js';
import { systemDialog } from '../device/platforms.js';
import { buildStamp } from '../apps/buildStamp.js';
import { recordNavEdge, arriveOf, targetOf } from '../apps/navGraph.js';

const MAX_LOG = 300;

// pollMs: nghỉ giữa 2 lần đọc; alertIdleMs: màn đứng yên bao lâu mới hỏi popup hệ thống; alertEveryMs: hỏi lại sau bao lâu.
// iOS mỗi lần hỏi mất ~2 giây khi không có popup và chặn vòng đọc → màn lướt qua trong lúc hỏi bị sót (đo: màn "Recipe imported"
// hiện 1,8 giây rơi đúng lúc hỏi) → chỉ hỏi khi màn đứng yên lâu (tester có thể đang bị popup chặn), và thưa
export const RECORD_DEFAULTS = { pollMs: 250, alertIdleMs: 10000, alertEveryMs: 30000 };
export function createCaptures({ store, lock, emit, map, openSession, attachSession = openSession, loops = {}, pollMs = RECORD_DEFAULTS.pollMs, alertIdleMs = RECORD_DEFAULTS.alertIdleMs, alertEveryMs = RECORD_DEFAULTS.alertEveryMs, buildStampOf = buildStamp }) {
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

  // Chụp màn hiện tại: cập nhật ảnh live, màn mới → thêm vào map. xml: page source đầy đủ đã đọc sẵn (khỏi đọc lại ~1s)
  async function snap(id, appId, driver, { nameHint, seenBy, xml: given }) {
    const xml = given || await driver.getPageSource();
    const png = Buffer.from(await driver.takeScreenshot(), 'base64');
    fs.mkdirSync(path.dirname(liveFile(id)), { recursive: true });
    fs.writeFileSync(liveFile(id), png);
    const elements = parseElements(xml);
    // < 2 phần tử: app đang mở / chuyển màn; chữ đang hiện từng ký tự (splash) → chưa ghi
    if (elements.length < 2 || isTransient(elements)) return { xml, screen: null, isNew: false, elements };
    const { screen, isNew, added } = map.addSnapshot(appId, { xml, png, nameHint, seenBy });
    const c = store.get('captures', id);
    const prevId = c.current?.screenId;
    // Lần đầu tới màn này trong lần ghi → màn phải đứng sau màn vừa rời: danh sách màn theo đúng thứ tự tester bấm
    //   (quay lại màn đã qua trong lần ghi này = Back → không xếp lại)
    if (prevId && screen.id !== prevId && !(c.seen || []).includes(screen.id)) map.placeAfter?.(screen.id, prevId, { force: isNew });
    const seen = new Set([...(c.seen || []), screen.id]);
    update(id, {
      polls: (c.polls || 0) + 1, seen: [...seen], screensFound: seen.size,
      current: { screenName: screen.name, screenId: screen.id, screenshot: `/files/data/captures/${id}.png?t=${Date.now()}` },
    });
    // Màn đã có trong map (lấy locator trước đó / quay lại) vẫn báo khi chuyển tới → tester thấy lần bấm đã được ghi nhận
    if (isNew) log(id, `Màn mới: ${screen.name} (${screen.elements.length} phần tử)`);
    else if (screen.id !== prevId) log(id, `Đã có: ${screen.name}${added ? ` (thêm ${added} phần tử)` : ''}`);
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

  // iOS: page source bỏ thuộc tính visible nhanh hơn ~6 lần (đo: ~180ms so với ~1.100ms) — chỉ để phát hiện màn đổi
  //   (không dùng để ghi: thiếu visible thì phần tử bị che / màn trước còn trong cây lẫn vào màn)
  const fastSource = (driver) => driver.execute('mobile: source', { format: 'xml', excludedAttributes: 'visible' }).catch(() => driver.getPageSource());

  async function recordLoop(id, appId, driver, job, opts = {}) {
    const android = opts.app?.platform === 'Android';
    let last = null;
    let lastFast = null;
    let candidate = null; // chữ ký nhanh vừa đổi, chờ lần đọc sau giống nhau (màn đã đứng yên) mới ghi
    let alertShown = null;
    let stillSince = Date.now();
    let alertAt = 0;
    const bump = () => { const c = store.get('captures', id); store.patch('captures', id, { polls: (c.polls || 0) + 1 }); };
    for (let n = 0; !job.stop; n++) {
      // iOS: đọc nhanh để biết màn có đổi không; đổi mới đọc bản đầy đủ (1 lần) để ghi. Android: page source vốn nhanh
      if (!android) {
        const fsig = screenSignature(parseElements(await fastSource(driver)));
        // Màn vừa đổi: chờ lần đọc kế tiếp giống hệt (đứng yên ~1 vòng) rồi mới ghi — bỏ khung hình đang chạy hiệu ứng
        //   (vd chữ "T-a-s-t-o-r-y" hiện dần thành màn rác "T"); màn hiện 1–2 giây như "Importing" vẫn bắt kịp
        if (fsig !== lastFast && fsig !== candidate) {
          candidate = fsig;
          stillSince = Date.now();
          bump();
          await new Promise((r) => setTimeout(r, pollMs));
          continue;
        }
        if (fsig === lastFast) {
          // Màn đứng yên lâu → có thể popup hệ thống đang chặn tester → hỏi (thưa, vì mỗi lần hỏi tốn ~1,7s)
          if (Date.now() - stillSince >= alertIdleMs && Date.now() - alertAt >= alertEveryMs) {
            alertAt = Date.now();
            const alert = await alertButtons(driver);
            const alertKey = alert ? alert.join('|') : null;
            if (alertKey && alertKey !== alertShown) log(id, `Popup hệ thống đang che màn hình (${alert.join(' / ')}) — bấm một nút trên Simulator để đóng.`);
            alertShown = alertKey;
          }
          bump();
          await new Promise((r) => setTimeout(r, pollMs));
          continue;
        }
        lastFast = fsig;
        candidate = null;
      }
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
      // < 2 phần tử: app đang mở / chuyển màn → chưa ghi
      if (els.length >= 2 && sig !== last) {
        await snap(id, appId, driver, { seenBy: 'record', xml });
        last = sig;
      } else bump();
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  const LOOPS = { record: recordLoop, ...loops };

  // Bấm ở màn A sang màn B (AI khám phá / đi tới màn) → ghi cạnh vào sơ đồ màn của workspace (data/nav-graph.json, cùng định dạng
  // runner/navgraph.js, theo build hiện tại) để Run và chuyển đổi test case dùng. Ghi lúc job kết thúc: tên màn lúc đó là tên cuối
  // (AI / tester có thể đổi tên màn mới ngay sau khi tới). Bỏ nút mua; màn không còn trong map (đã xoá / gộp) → bỏ
  function flushNavEdges(app, list) {
    if (!list.length || !app.workspace) return 0;
    const build = buildStampOf(app.appPath)?.stamp;
    if (!build) return 0;
    let n = 0;
    for (const e of list) {
      const from = store.get('screens', e.from);
      const to = store.get('screens', e.to);
      if (!from || !to || from.name === to.name) continue;
      const arrive = arriveOf(to.elements || []);
      if (!arrive) continue;
      if (recordNavEdge(app.workspace, build, { from: from.name, to: to.name, sel: e.locator, target: targetOf(from.elements || [], e.locator), arrive })) n++;
    }
    return n;
  }

  async function run(id, app, opts, job) {
    let session = null;
    const navEdges = []; // { from, to (screen id), locator }
    const addEdge = (f, t, a) => {
      const e = map.addEdge(app.id, f, t, a);
      if (a?.action === 'tap' && a.locator) navEdges.push({ from: f, to: t, locator: a.locator });
      return e;
    };
    try {
      log(id, `Đang mở app trên ${app.platform === 'Android' ? 'thiết bị Android' : 'Simulator'}…`);
      // fromCurrent: gắn vào app đang mở sẵn (không cài / mở lại) → khám phá bắt đầu từ đúng màn tester đang đứng
      session = await (opts.fromCurrent ? attachSession : openSession)({ app, udid: opts.udid });
      log(id, opts.mode === 'record' ? `Sẵn sàng — bấm qua app trên ${app.platform === 'Android' ? 'thiết bị Android' : 'Simulator'}, tool tự ghi lại từng màn.` : 'AI bắt đầu khám phá app.');
      await LOOPS[opts.mode](id, app.id, session.driver, job, { ...opts, app, snap: (d, o) => snap(id, app.id, d, o), log: (t) => log(id, t), update: (p) => update(id, p), renameScreen: (sid, n) => map.renameScreen(sid, n), screens: () => store.list('screens').filter((s) => s.appId === app.id), edges: { list: () => map.edges(app.id), add: addEdge } });
      const c = store.get('captures', id);
      if (c.status === 'running') update(id, { status: job.stop ? 'stopped' : 'done' });
    } catch (e) {
      update(id, { status: job.stop ? 'stopped' : 'error', error: job.stop ? null : String(e.message || e).split('\n')[0] });
    } finally {
      await session?.close().catch(() => {});
      try { map.exportLocators(app.id); } catch {}
      try { const n = flushNavEdges(app, navEdges); if (n) log(id, `Ghi ${n} đường chuyển màn vào sơ đồ màn (nav-graph) của app`); } catch {}
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
    if (opts.startScreenId && !store.get('screens', opts.startScreenId)) throw Object.assign(new Error('Màn bắt đầu không có trong locator map'), { status: 400 });
    const id = `cap-${crypto.randomUUID().slice(0, 8)}`;
    const label = opts.mode === 'record' ? `Ghi locator · ${app.name}` : `AI khám phá · ${app.name}`;
    const got = lock.acquire({ kind: 'capture', id, label });
    if (!got.ok) throw Object.assign(new Error(`Thiết bị đang bận: ${got.holder.label}`), { status: 409 });
    emit('lock', lock.current());
    await lock.ready?.();
    store.put('captures', { id, appId, mode: opts.mode, udid: opts.udid, status: 'running', screensFound: 0, polls: 0, seen: [], current: null, log: [], startedAt: new Date().toISOString() });
    const job = { stop: false, ctl: new AbortController() }; // ctl: bấm Dừng → huỷ lần gọi AI đang chạy
    running.set(id, job);
    run(id, app, opts, job);
    return id;
  }

  async function stop(id) {
    const job = running.get(id);
    if (!job) return;
    job.stop = true;
    try { job.ctl?.abort(); } catch {}
    while (running.has(id)) await new Promise((r) => setTimeout(r, 20));
  }

  return { start, stop };
}

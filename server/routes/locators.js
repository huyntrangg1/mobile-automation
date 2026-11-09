import { Router } from 'express';
import { listOverrides, removeOverride, updateOverride } from '../runs/overrides.js';
import { matchLocator } from '../locators/tryLocator.js';
import { resolveTarget } from '../ai/resolve.js';
import { createAssist } from '../ai/assist.js';
import { clampExplore } from '../locators/explore.js';
import { resolveBuyCheck } from '../ai/resolve.js';


const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };

export default function locatorRoutes({ store, map, captures, emit, tryLive }, { resolve = resolveTarget, assist = null } = {}) {
  const r = Router();
  const assistAi = assist || createAssist({ store });
  const lite = (s) => ({ id: s.id, appId: s.appId, name: s.name, screenshot: s.screenshot, count: s.elements.length, seenBy: s.seenBy, updatedAt: s.updatedAt });
  const changed = (appId) => { map.exportLocators(appId); emit('app', { id: appId }); };

  // Locator tester đã sửa khi chạy (Fix script & go on) — xem / xoá (hoàn tác) ở trang Locator map
  const wsOf = (appId) => store.get('apps', appId)?.workspace;
  r.get('/apps/:appId/overrides', (req, res) => (wsOf(req.params.appId) ? res.json(listOverrides(wsOf(req.params.appId))) : res.status(404).json({ error: 'Không có app này' })));
  r.put('/apps/:appId/overrides', wrap((req, res) => {
    const ws = wsOf(req.params.appId);
    if (!ws) return res.status(404).json({ error: 'Không có app này' });
    updateOverride(ws, req.body?.key, req.body?.locator);
    res.json(listOverrides(ws));
  }));
  r.delete('/apps/:appId/overrides', wrap((req, res) => {
    const ws = wsOf(req.params.appId);
    if (!ws) return res.status(404).json({ error: 'Không có app này' });
    if (!req.body?.key) return res.status(400).json({ error: 'Thiếu key' });
    removeOverride(ws, req.body.key);
    res.json(listOverrides(ws));
  }));
  r.get('/apps/:appId/screens', (req, res) => res.json((map.list ? map.list(req.params.appId) : store.list('screens').filter((s) => s.appId === req.params.appId)).map(lite)));
  // Dọn map: gộp màn trùng, bỏ khung hình hiệu ứng, xếp theo thứ tự đi qua ở các lần lấy locator
  r.post('/apps/:appId/screens/tidy', wrap((req, res) => {
    const caps = store.list('captures').filter((c) => c.appId === req.params.appId && c.seen?.length)
      .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    const out = map.tidy(req.params.appId, caps.map((c) => ({ seen: c.seen, mode: c.mode })));
    changed(req.params.appId);
    res.json({ ...out, runs: caps.length });
  }));
  r.get('/screens/:id', (req, res) => {
    const s = store.get('screens', req.params.id);
    if (!s) return res.status(404).json({ error: 'Không có màn này' });
    const { source, ...rest } = s;
    res.json(rest);
  });
  r.put('/screens/:id', wrap((req, res) => {
    const s = map.renameScreen(req.params.id, String(req.body?.name || ''));
    changed(s.appId);
    res.json(lite(s));
  }));
  // Sửa phần tử: { key } đổi tên Target; { locator?, type? } sửa tay locator / loại
  r.put('/screens/:id/elements/:idx', wrap((req, res) => {
    const idx = Number(req.params.idx);
    const b = req.body || {};
    let s = 'key' in b ? map.setElementKey(req.params.id, idx, b.key) : null;
    if (b.locator !== undefined || b.type) s = map.updateElement(req.params.id, idx, { locator: b.locator, type: b.type });
    if (!s) return res.status(400).json({ error: 'Không có gì để sửa' });
    changed(s.appId);
    res.json({ ok: true });
  }));
  // Thử locator trên page source đã lưu của màn (lần chụp gần nhất) — không cần thiết bị
  r.post('/screens/:id/try', (req, res) => {
    const s = store.get('screens', req.params.id);
    if (!s) return res.status(404).json({ error: 'Không có màn này' });
    const r = matchLocator(s.source, req.body?.locator);
    res.json({ ...r, count: r.elements.length, shotUrl: s.screenshot, win: s.win || null });
  });
  // Thử trên máy: app đang mở sẵn ở đúng màn; tap = bấm thử phần tử đầu tiên / điểm
  r.post('/apps/:appId/try-live', wrap(async (req, res) => {
    const { udid, locator, tap } = req.body || {};
    res.json(await tryLive.run({ appId: req.params.appId, udid, locator, tap: !!tap }));
  }));
  r.post('/screens/:id/elements', wrap((req, res) => {
    const s = map.addElement(req.params.id, req.body || {});
    changed(s.appId);
    res.status(201).json({ ok: true });
  }));
  r.delete('/screens/:id/elements/:idx', wrap((req, res) => {
    const s = map.removeElement(req.params.id, Number(req.params.idx));
    changed(s.appId);
    res.json({ ok: true });
  }));
  r.post('/screens/:id/merge', wrap((req, res) => {
    const s = map.mergeScreens(req.params.id, req.body?.dropId);
    changed(s.appId);
    res.json(lite(s));
  }));
  r.delete('/screens/:id', wrap((req, res) => {
    const s = store.get('screens', req.params.id);
    map.deleteScreen(req.params.id);
    if (s) changed(s.appId);
    res.json({ ok: true });
  }));

  r.get('/apps/:appId/captures', (req, res) => res.json(store.list('captures').filter((c) => c.appId === req.params.appId).reverse()));
  r.get('/captures/:id', (req, res) => {
    const c = store.get('captures', req.params.id);
    if (!c) return res.status(404).json({ error: 'Không có lần lấy locator này' });
    res.json(c);
  });
  r.post('/apps/:appId/captures', wrap(async (req, res) => {
    const { mode, udid, hints, maxSteps, maxMinutes, fromCurrent, startScreenId } = req.body || {};
    if (!udid) return res.status(400).json({ error: 'Chọn thiết bị' });
    // Giới hạn trên (≤150 bước, ≤60 phút): số lớn / sai → giữ thiết bị hàng giờ
    const lim = clampExplore({ maxSteps, maxMinutes });
    const id = await captures.start(req.params.appId, { mode, udid, hints, maxSteps: lim.maxSteps, maxMinutes: lim.maxMinutes, fromCurrent: !!fromCurrent, startScreenId: startScreenId || undefined });
    res.status(201).json(store.get('captures', id));
  }));
  r.post('/captures/:id/stop', wrap(async (req, res) => {
    await captures.stop(req.params.id);
    res.json(store.get('captures', req.params.id));
  }));
  // Trình chạy (wdio) hỏi lúc chạy: phần tử nào trên màn khớp mô tả target → { locator } hoặc { locator: null }
  r.post('/apps/:appId/resolve', wrap(async (req, res) => {
    const app = store.get('apps', req.params.appId);
    if (!app) return res.status(404).json({ error: 'Không có app này' });
    const { target, screen, kind, elements } = req.body || {};
    const out = await resolve({ target, screen, kind, elements, platform: app.platform || 'iOS' });
    // Trình chạy lưu kết quả thành locator sửa (override) → không bao giờ trả nút mua / xác nhận mua
    const chk = out?.locator ? resolveBuyCheck(out.locator, Array.isArray(elements) ? elements : [], target) : { ok: true };
    if (!chk.ok) return res.json({ locator: null, reason: chk.why });
    res.json({ locator: out?.locator || null, reason: out?.reason || '' });
  }));
  // AI hỗ trợ lúc chạy (Run option): bước thao tác / điều hướng kẹt → 1 thao tác gỡ kẹt { action, locator, name, text, reason }
  r.post('/apps/:appId/assist', wrap(async (req, res) => {
    if (!store.get('apps', req.params.appId)) return res.status(404).json({ error: 'Không có app này' });
    res.json(await assistAi(req.params.appId, req.body || {}));
  }));
  return r;
}

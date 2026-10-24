import { Router } from 'express';

const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };

export default function locatorRoutes({ store, map, captures, emit }) {
  const r = Router();
  const lite = (s) => ({ id: s.id, appId: s.appId, name: s.name, screenshot: s.screenshot, count: s.elements.length, seenBy: s.seenBy, updatedAt: s.updatedAt });
  const changed = (appId) => { map.exportLocators(appId); emit('app', { id: appId }); };

  r.get('/apps/:appId/screens', (req, res) => res.json(store.list('screens').filter((s) => s.appId === req.params.appId).map(lite)));
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
  r.put('/screens/:id/elements/:idx', wrap((req, res) => {
    const s = map.setElementKey(req.params.id, Number(req.params.idx), req.body?.key);
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
    const { mode, udid, hints, maxSteps, maxMinutes } = req.body || {};
    if (!udid) return res.status(400).json({ error: 'Chọn thiết bị' });
    const id = await captures.start(req.params.appId, { mode, udid, hints, maxSteps, maxMinutes });
    res.status(201).json(store.get('captures', id));
  }));
  r.post('/captures/:id/stop', wrap(async (req, res) => {
    await captures.stop(req.params.id);
    res.json(store.get('captures', req.params.id));
  }));
  return r;
}

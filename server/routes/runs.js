import { Router } from 'express';
import { listDevices } from '../device/platforms.js';
import { rerunCaseIds } from '../runs/runner.js';

const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
const lite = ({ log, ...r }) => r;

export default function runRoutes({ store, runner, generator }) {
  const r = Router();
  r.get('/runs', (req, res) => {
    const apps = new Map(store.list('apps').map((a) => [a.id, a.name]));
    res.json(store.list('runs').filter((x) => !req.query.appId || x.appId === req.query.appId).reverse().map((x) => ({ ...lite(x), appName: apps.get(x.appId) })));
  });
  r.get('/runs/:id', (req, res) => {
    const x = store.get('runs', req.params.id);
    if (!x) return res.status(404).json({ error: 'Không có run này' });
    res.json({ ...x, appName: store.get('apps', x.appId)?.name });
  });
  const start = async (appId, udid, caseIds, res) => {
    try {
      const app = store.get('apps', appId);
      const files = [...new Set((caseIds || []).map((cid) => store.get('cases', cid)?.file).filter(Boolean))];
      if (app && generator) for (const f of files) await generator.refreshScript(app, f);
      const run = await runner.startRun({ appId, udid, caseIds: caseIds || [] });
      const sim = (await listDevices().catch(() => [])).find((s) => s.udid === udid);
      if (sim) store.patch('runs', run.id, { deviceName: `${sim.name} · ${sim.os}` });
      res.status(201).json(lite(store.get('runs', run.id)));
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message, missing: e.missing });
    }
  };
  r.post('/apps/:appId/runs', wrap(async (req, res) => {
    const { udid, caseIds } = req.body || {};
    await start(req.params.appId, udid, caseIds, res);
  }));
  // Run lại: cùng thiết bị; onlyFailed = chỉ case Failed / Blocked / Not Run (case phía trước của chuỗi tự kéo theo)
  r.post('/runs/:id/rerun', wrap(async (req, res) => {
    const old = store.get('runs', req.params.id);
    if (!old) return res.status(404).json({ error: 'Không có run này' });
    const ids = rerunCaseIds(old, !!req.body?.onlyFailed, req.body?.tcIds);
    if (!ids.length) return res.status(400).json({ error: req.body?.tcIds?.length ? 'Không có case nào được chọn thuộc run này' : 'Run này không có case lỗi để chạy lại' });
    await start(old.appId, req.body?.udid || old.udid, ids, res);
  }));
  // Xoá run: { ids: [...] } hoặc { olderThanDays: 7 }
  r.post('/runs/delete', wrap(async (req, res) => {
    const { ids, olderThanDays } = req.body || {};
    if (!ids?.length && !olderThanDays) return res.status(400).json({ error: 'Chưa chọn run để xoá' });
    res.json(await runner.deleteRuns(ids?.length ? ids : null, { olderThanDays: Number(olderThanDays) || undefined }));
  }));
  r.post('/runs/:id/pause', wrap(async (req, res) => {
    try { await runner.pause(req.params.id); res.json({ ok: true }); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  }));
  r.post('/runs/:id/resume', wrap(async (req, res) => {
    await runner.resume(req.params.id);
    res.json({ ok: true });
  }));
  r.post('/runs/:id/stop', wrap(async (req, res) => {
    await runner.stop(req.params.id);
    res.json({ ok: true });
  }));
  return r;
}

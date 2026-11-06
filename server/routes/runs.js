import { Router } from 'express';
import { upgradeWorkspace } from '../apps/workspace.js';
import { listDevices } from '../device/platforms.js';
import { rerunCaseIds } from '../runs/runner.js';
import { writeBugs } from '../ai/bugText.js';

const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
const lite = ({ log, ...r }) => r;

export default function runRoutes({ store, runner, generator, bugWriter = writeBugs }) {
  const r = Router();
  // Form Log Asana của report (mở qua tool) xin AI viết lại bug theo skill test-report (reference.md → "Cách viết bug")
  r.post('/bug-text', wrap(async (req, res) => {
    const { runId, bugs } = req.body || {};
    if (runId && !store.get('runs', runId)) return res.status(404).json({ error: 'Không có run này' });
    const out = await bugWriter(bugs);
    if (!out.ok) return res.status(out.status || 500).json({ error: out.error });
    res.json({ bugs: out.bugs });
  }));
  r.get('/runs', (req, res) => {
    const apps = new Map(store.list('apps').map((a) => [a.id, a.name]));
    res.json(store.list('runs').filter((x) => !req.query.appId || x.appId === req.query.appId).reverse().map((x) => ({ ...lite(x), appName: apps.get(x.appId) })));
  });
  r.get('/runs/:id', (req, res) => {
    const x = store.get('runs', req.params.id);
    if (!x) return res.status(404).json({ error: 'Không có run này' });
    res.json({ ...x, appName: store.get('apps', x.appId)?.name });
  });
  const start = async (appId, udid, caseIds, res, manualFix = false) => {
    try {
      const app = store.get('apps', appId);
      const files = [...new Set((caseIds || []).map((cid) => store.get('cases', cid)?.file).filter(Boolean))];
      if (app) await upgradeWorkspace(app); // workspace tạo từ template cũ thiếu file / export khung script cần
      if (app && generator) for (const f of files) await generator.refreshScript(app, f);
      const run = await runner.startRun({ appId, udid, caseIds: caseIds || [], manualFix: !!manualFix });
      const sim = (await listDevices().catch(() => [])).find((s) => s.udid === udid);
      if (sim) store.patch('runs', run.id, { deviceName: `${sim.name} · ${sim.os}` });
      res.status(201).json(lite(store.get('runs', run.id)));
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message, missing: e.missing });
    }
  };
  r.post('/apps/:appId/runs', wrap(async (req, res) => {
    const { udid, caseIds, manualFix } = req.body || {};
    await start(req.params.appId, udid, caseIds, res, manualFix);
  }));
  // Run lại: cùng thiết bị; onlyFailed = chỉ case Failed / Blocked / Not Run (case phía trước của chuỗi tự kéo theo)
  r.post('/runs/:id/rerun', wrap(async (req, res) => {
    const old = store.get('runs', req.params.id);
    if (!old) return res.status(404).json({ error: 'Không có run này' });
    const ids = rerunCaseIds(old, !!req.body?.onlyFailed, req.body?.tcIds);
    if (!ids.length) return res.status(400).json({ error: req.body?.tcIds?.length ? 'Không có case nào được chọn thuộc run này' : 'Run này không có case lỗi để chạy lại' });
    await start(old.appId, req.body?.udid || old.udid, ids, res, req.body?.manualFix ?? old.manualFix);
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
  // Chế độ sửa tay khi lỗi: tester trả lời câu hỏi đang chờ { helpId, action, locator?, element? }
  r.post('/runs/:id/answer', wrap(async (req, res) => {
    try { await runner.answer(req.params.id, req.body || {}); res.json({ ok: true }); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  }));
  r.post('/runs/:id/stop', wrap(async (req, res) => {
    await runner.stop(req.params.id);
    res.json({ ok: true });
  }));
  return r;
}

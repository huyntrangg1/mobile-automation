import { Router } from 'express';
import { upgradeWorkspace } from '../apps/workspace.js';
import { listDevices } from '../device/platforms.js';
import { rerunCaseIds } from '../runs/runner.js';
import { writeBugs } from '../ai/bugText.js';
import { previewAssist, applyAssist } from '../runs/applyAssist.js';
import { importTestcases } from '../testcases/importXlsx.js';

const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
const lite = ({ log, ...r }) => r;

export default function runRoutes({ store, runner, generator, emit = null, bugWriter = writeBugs, importer = importTestcases, devices = listDevices }) {
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
  const start = async (appId, udid, caseIds, res, manualFix = false, aiAssist = false) => {
    try {
      const app = store.get('apps', appId);
      const files = [...new Set((caseIds || []).map((cid) => store.get('cases', cid)?.file).filter(Boolean))];
      if (app) await upgradeWorkspace(app); // workspace tạo từ template cũ thiếu file / export khung script cần
      if (app && generator) for (const f of files) await generator.refreshScript(app, f);
      const run = await runner.startRun({ appId, udid, caseIds: caseIds || [], manualFix: !!manualFix, aiAssist: !!aiAssist && !manualFix });
      const sim = (await devices().catch(() => [])).find((s) => s.udid === udid);
      if (sim) store.patch('runs', run.id, { deviceName: `${sim.name} · ${sim.os}` });
      res.status(201).json(lite(store.get('runs', run.id)));
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message, missing: e.missing });
    }
  };
  r.post('/apps/:appId/preflight', wrap(async (req, res) => {
    const { udid, caseIds } = req.body || {};
    res.json(await runner.check({ appId: req.params.appId, udid, caseIds }));
  }));
  r.post('/apps/:appId/runs', wrap(async (req, res) => {
    const { udid, caseIds, manualFix, aiAssist } = req.body || {};
    await start(req.params.appId, udid, caseIds, res, manualFix, aiAssist);
  }));
  // Run lại: cùng thiết bị; onlyFailed = chỉ case Failed / Blocked / Not Run (case phía trước của chuỗi tự kéo theo)
  r.post('/runs/:id/rerun', wrap(async (req, res) => {
    const old = store.get('runs', req.params.id);
    if (!old) return res.status(404).json({ error: 'Không có run này' });
    const ids = rerunCaseIds(old, !!req.body?.onlyFailed, req.body?.tcIds);
    if (!ids.length) return res.status(400).json({ error: req.body?.tcIds?.length ? 'Không có case nào được chọn thuộc run này' : 'Run này không có case lỗi để chạy lại' });
    // Máy tester chọn / nhớ lần trước không còn (máy ảo đã xoá, iPhone rút cáp) → chạy trên máy của run cũ
    let udid = req.body?.udid || old.udid;
    if (udid !== old.udid) {
      const list = await devices().catch(() => null);
      if (list && !list.some((d) => d.udid === udid)) udid = old.udid;
    }
    await start(old.appId, udid, ids, res, req.body?.manualFix ?? old.manualFix, req.body?.aiAssist ?? old.aiAssist);
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
  // AI hỗ trợ khi chạy — lệch so với script: xem trước thay đổi test case / áp dụng (sửa Excel + gen lại case) / bỏ qua
  const runOf = (req) => {
    const run = store.get('runs', req.params.id);
    if (!run) throw Object.assign(new Error('Không có run này'), { status: 404 });
    return run;
  };
  // Đọc lại run ngay trước khi ghi (runner vừa ghi results / log trong lúc áp dụng) — chỉ đổi assistDecisions + đúng case đó
  const decide = (runId, tc, i, decision) => {
    const run = store.get('runs', runId);
    if (!run) return null;
    const patch = { assistDecisions: { ...(run.assistDecisions || {}), [i]: decision } };
    const cur = run.results?.[tc];
    if (cur?.assist) patch.results = { ...run.results, [tc]: { ...cur, assist: cur.assist.map((x) => (x.i === Number(i) ? { ...x, decision } : x)) } };
    const out = store.patch('runs', runId, patch);
    if (typeof emit === 'function') emit('run', out);
    return out;
  };
  const decided = (run, i) => run.assistDecisions?.[i] || null;
  const fail = (res, e) => res.status(e.status || 500).json({ error: e.message });
  r.get('/runs/:id/assist/:tc/:i', wrap(async (req, res) => {
    try { res.json(await previewAssist({ store, run: runOf(req), tcId: req.params.tc, index: req.params.i })); } catch (e) { fail(res, e); }
  }));
  r.post('/runs/:id/assist/:tc/:i/apply', wrap(async (req, res) => {
    try {
      const run = runOf(req);
      // Run đang chạy: kết quả / lệch còn đổi, file Excel đang dùng → áp dụng sau khi run xong
      if (runner?.isRunning?.(run.id) || run.status === 'running') return res.status(409).json({ error: 'Run đang chạy — đợi run xong rồi áp dụng vào test case' });
      // Đã quyết định rồi (áp dụng 2 lần → chèn dòng trùng)
      if (decided(run, req.params.i)) return res.status(409).json({ error: decided(run, req.params.i) === 'applied' ? 'Lần lệch này đã được áp dụng vào test case' : 'Lần lệch này đã được bỏ qua' });
      const out = await applyAssist({ store, run, tcId: req.params.tc, index: req.params.i, importer, generator });
      decide(run.id, req.params.tc, req.params.i, 'applied');
      res.json(out);
    } catch (e) { fail(res, e); }
  }));
  r.post('/runs/:id/assist/:tc/:i/dismiss', wrap(async (req, res) => {
    try {
      const run = runOf(req);
      if (decided(run, req.params.i) === 'applied') return res.status(409).json({ error: 'Lần lệch này đã được áp dụng vào test case' });
      decide(run.id, req.params.tc, req.params.i, 'dismissed');
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  }));
  r.post('/runs/:id/stop', wrap(async (req, res) => {
    await runner.stop(req.params.id);
    res.json({ ok: true });
  }));
  return r;
}

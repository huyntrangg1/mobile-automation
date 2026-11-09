import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { exportToSimutil } from '../scripts/simutil.js';

const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };

export default function scriptRoutes({ store, emit, generator }) {
  const r = Router();
  const appOf = (req) => {
    const a = store.get('apps', req.params.appId);
    if (!a) throw Object.assign(new Error('Không có app này'), { status: 404 });
    return a;
  };

  r.post('/apps/:appId/scripts/generate', wrap(async (req, res) => {
    const app = appOf(req);
    if (app.status !== 'ready') return res.status(409).json({ error: 'App chưa sẵn sàng' });
    const ids = (req.body?.caseIds || []).filter((id) => store.get('cases', id)?.appId === app.id);
    if (!ids.length) return res.status(400).json({ error: 'Chưa chọn case' });
    // Case đã sửa tay: gen lại sẽ ghi đè code sửa tay → phải xác nhận (body.force)
    const hand = ids.map((id) => store.get('cases', id)).filter((c) => c?.script?.editedByHand);
    if (hand.length && !req.body?.force) {
      return res.status(409).json({ error: `Case đã sửa tay: ${hand.map((c) => c.tcId).join(', ')} — gen lại sẽ ghi đè code sửa tay. Xác nhận để gen lại (force).`, editedByHand: hand.map((c) => c.id) });
    }
    generator.generate(app.id, ids).catch((e) => console.error('generate:', e)); // chạy nền, tiến độ qua SSE "script"
    res.status(202).json({ queued: ids.length });
  }));

  // Dừng gen: body { caseIds } hoặc { all: true } (mọi case đang gen / chờ gen của app)
  r.post('/apps/:appId/scripts/cancel', wrap(async (req, res) => {
    const app = appOf(req);
    const ids = req.body?.all ? generator.generatingIds(app.id) : (req.body?.caseIds || []).filter((id) => store.get('cases', id)?.appId === app.id);
    res.json({ cancelled: generator.cancel(ids) });
  }));

  r.get('/apps/:appId/scripts', wrap(async (req, res) => {
    const app = appOf(req);
    const files = [...new Set(store.list('cases').filter((c) => c.appId === app.id).map((c) => c.file))];
    res.json(files.map((f) => ({ file: f, exists: fs.existsSync(generator.scriptPath(app, f)), cases: generator.casesOf(app.id, f).length })));
  }));

  r.get('/apps/:appId/scripts/:file', wrap(async (req, res) => {
    const app = appOf(req);
    const p = generator.scriptPath(app, req.params.file);
    const code = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    const cases = generator.casesOf(app.id, req.params.file);
    const lines = code.split('\n');
    const at = (id) => lines.findIndex((l) => l === `// #region ${id}`) + 1; // dòng 1-based, 0 = chưa có
    res.json({ file: req.params.file, path: p, code, hash: generator.hashOf(code), cases: cases.map((c) => ({ ...c, line: at(c.tcId) })) });
  }));

  // Lưu cả file sửa tay: lấy lại các region, khung do tool sinh lại. hash = bản client đã tải (409 nếu file đã đổi)
  r.put('/apps/:appId/scripts/:file', wrap(async (req, res) => {
    const app = appOf(req);
    const saved = await generator.saveFile(app, req.params.file, String(req.body?.code || ''), req.body?.hash);
    if (saved.conflict) return res.status(409).json({ error: 'File đã thay đổi trên server (vừa gen / lưu ở chỗ khác). Tải lại rồi sửa tiếp.' });
    if (saved.error) return res.status(400).json({ error: saved.regionError ? saved.error : `Code lỗi cú pháp, chưa lưu:\n${saved.error}` });
    for (const c of generator.casesOf(app.id, req.params.file)) {
      if (saved.changed.includes(c.tcId)) {
        const script = { ...c.script, status: 'generated', editedByHand: true, reviewed: false };
        store.patch('cases', c.id, { script });
        emit('script', { appId: app.id, caseId: c.id, script });
      }
    }
    res.json({ ok: true });
  }));

  // Export sang SimUtil: ghi ~/.simutil/projects/<app>-<file>/scripts/<TC>.js (format @kwcase, từ các dòng Excel)
  r.post('/apps/:appId/scripts/:file/simutil', wrap(async (req, res) => {
    const app = appOf(req);
    const cases = generator.casesOf(app.id, req.params.file);
    const excel = cases[0]?.fileName && app.workspace ? path.join(app.workspace, 'data/testcases', cases[0].fileName) : null;
    res.json(exportToSimutil(app, req.params.file, cases, { excel }));
  }));

  r.post('/cases/:id/reviewed', wrap(async (req, res) => {
    const c = store.get('cases', req.params.id);
    if (!c) return res.status(404).json({ error: 'Không có case này' });
    const script = { ...c.script, reviewed: req.body?.reviewed !== false };
    store.patch('cases', c.id, { script });
    emit('script', { appId: c.appId, caseId: c.id, script });
    res.json(script);
  }));
  return r;
}

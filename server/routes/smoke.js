// AI Smoke Test: bắt đầu / xem / dừng một lần chạy, danh sách theo app, report ngắn (HTML vẽ lúc xem).
import fs from 'node:fs';
import os from 'node:os';
import { Router } from 'express';
import multer from 'multer';
import { renderReport } from '../smoke/report.js';

// File Figma .json xuất từ plugin có thể lớn (ảnh PNG base64) → lưu tạm trên đĩa, xoá ngay sau khi start đã đọc
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 200 * 1024 * 1024 } });

export default function smokeRoutes({ store, smoke }) {
  const r = Router();
  r.post('/apps/:appId/smoke', upload.single('figmaJson'), async (req, res) => {
    const { udid, prdUrl, figmaUrl, notes, account } = req.body || {};
    const robust = ![false, 'false', '0', 0].includes((req.body || {}).robust); // mặc định bật; JSON boolean hoặc chuỗi từ multipart
    const depth = (req.body || {}).depth === 'full' ? 'full' : 'smoke';
    const clean = [true, 'true', '1', 1].includes((req.body || {}).clean); // mặc định tắt: dùng lại app đã onboard
    try {
      res.status(201).json(await smoke.start({ appId: req.params.appId, udid, prdUrl, figmaUrl, notes, account, robust, clean, depth, figmaFile: req.file?.path, figmaName: req.file?.originalname }));
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    } finally {
      if (req.file) fs.rmSync(req.file.path, { force: true });
    }
  });
  r.get('/apps/:appId/smoke', (req, res) => res.json(store.list('smoke').filter((x) => x.appId === req.params.appId).reverse().map(({ log, ...x }) => x)));
  r.get('/smoke/:id', (req, res) => {
    const x = store.get('smoke', req.params.id);
    if (!x) return res.status(404).json({ error: 'Không có lần chạy này' });
    res.json({ ...x, live: smoke.running(x.id), appName: store.get('apps', x.appId)?.name });
  });
  r.post('/smoke/:id/stop', async (req, res) => {
    try { await smoke.stop(req.params.id); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.get('/smoke/:id/report', (req, res) => {
    const x = store.get('smoke', req.params.id);
    if (!x) return res.status(404).json({ error: 'Không có lần chạy này' });
    res.type('html').send(renderReport(x, store.get('apps', x.appId)?.name || x.appId));
  });
  return r;
}

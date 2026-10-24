// Express app: API dưới /api, file runtime (ảnh màn, report) dưới /files, web build ở web/dist.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { sseHandler } from './events.js';
import { DATA, ROOT } from './paths.js';

export function createApp(ctx, routers = []) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.get('/api/health', (req, res) => res.json({ ok: true, lock: ctx.lock.current() }));
  app.get('/api/events', sseHandler);
  for (const r of routers) app.use('/api', r(ctx));
  // Chỉ ảnh màn / ảnh live / report — không lộ store JSON (biến môi trường của app)
  for (const d of ['screens', 'captures', 'runs']) app.use(`/files/data/${d}`, express.static(path.join(DATA, d)));
  const dist = path.join(ROOT, 'web/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api|\/files).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  // Lỗi trong route → JSON có message đọc được trên UI
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: String(err.message || err) });
  });
  return app;
}

import os from 'node:os';
import { Router } from 'express';
import multer from 'multer';
import { importTestcases } from '../testcases/importXlsx.js';
import { closure } from '../testcases/closure.js';

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 30 * 1024 * 1024 } });
const lite = ({ rows, pre, ...c }) => ({ ...c, steps: rows.length, checks: rows.filter((r) => r.kind === 'Check').length });

export default function testcaseRoutes({ store, emit }) {
  const r = Router();
  const appCases = (appId) => store.list('cases').filter((c) => c.appId === appId).sort((a, b) => (a.file === b.file ? a.order - b.order : a.file.localeCompare(b.file)));

  r.get('/apps/:appId/cases', (req, res) => res.json(appCases(req.params.appId).map(lite)));
  r.get('/cases/:id', (req, res) => {
    const c = store.get('cases', req.params.id);
    if (!c) return res.status(404).json({ error: 'Không có case này' });
    res.json(c);
  });
  r.post('/apps/:appId/testcases', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Chưa chọn file' });
      const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      const out = await importTestcases({ store, appId: req.params.appId, srcPath: req.file.path, fileName: name });
      emit('app', { id: req.params.appId });
      res.json(out);
    } catch (e) { next(e); }
  });
  // Xem trước một lần chạy: case thêm vào chuỗi, case chưa chạy được
  r.post('/apps/:appId/run-plan', (req, res) => {
    const cases = appCases(req.params.appId);
    const out = closure(cases, req.body?.caseIds || []);
    const by = new Map(cases.map((c) => [c.id, c]));
    res.json({ ...out, cases: out.run.map((id) => lite(by.get(id))) });
  });
  return r;
}

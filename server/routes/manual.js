// Import test case manual: phân tích + lọc → chỉnh lựa chọn → chuyển đổi (nền) → import + gen. Chuyển đổi chỉ dùng thiết bị khi gửi
// udid (chạy thử luồng chung trên thiết bị, giữ khoá thiết bị trong lúc chạy thử).
import os from 'node:os';
import { Router } from 'express';
import multer from 'multer';
import { viewOf } from '../testcases/convert/converter.js';

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 30 * 1024 * 1024 } });
const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
const view = viewOf; // không trả nội dung manual gốc (src) và dòng Keyword (plan) về trình duyệt
const summary = (mi) => { const { cases, sheetReview, ...rest } = view(mi); return { ...rest, counts: { cases: cases.length, manual: cases.filter((c) => c.mode === 'manual').length } }; };

export default function manualRoutes({ store, converter }) {
  const r = Router();
  const need = (id) => {
    const mi = converter.get(id);
    if (!mi) throw Object.assign(new Error('Không có lần import manual này'), { status: 404 });
    return mi;
  };

  // Đợi phân tích xong rồi trả kết quả (lỗi như file sai định dạng báo ngay); tiến độ còn lại qua SSE "manualImport"
  r.post('/apps/:appId/manual/analyze', upload.single('file'), wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Chưa chọn file' });
    const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    res.json(view(await converter.analyze({ appId: req.params.appId, srcPath: req.file.path, fileName })));
  }));
  r.get('/apps/:appId/manual', (req, res) => res.json(converter.list(req.params.appId).map(summary)));
  r.get('/manual/:id', wrap(async (req, res) => res.json(view(need(req.params.id)))));
  r.put('/manual/:id/choices', wrap(async (req, res) => {
    const { sheet, tcId, mode } = req.body || {};
    need(req.params.id);
    res.json(view(converter.choose(req.params.id, { sheet, tcId, mode })));
  }));
  // Trả lời điểm mờ — trước hoặc sau khi chuyển đổi (case đã chuyển mà đổi câu trả lời thì chờ chuyển lại riêng)
  r.put('/manual/:id/clarify', wrap(async (req, res) => {
    const { sheet, tcId, answers } = req.body || {};
    need(req.params.id);
    res.json(view(converter.clarify(req.params.id, { sheet, tcId, answers })));
  }));
  // AI điền sẵn gợi ý cho các điểm mờ chưa trả lời (đọc locator map); user chỉ duyệt / sửa
  r.post('/manual/:id/suggest', wrap(async (req, res) => {
    need(req.params.id);
    res.json(view(await converter.suggest(req.params.id, { cases: req.body?.cases })));
  }));
  // Chọn cách xử lý một chỗ lệch giữa tài liệu và app: doc (theo tài liệu) / app (tài liệu đã cũ)
  r.put('/manual/:id/spec', wrap(async (req, res) => {
    const { sheet, tcId, step, manual, app, choice } = req.body || {};
    need(req.params.id);
    res.json(view(converter.specChoose(req.params.id, { sheet, tcId, step, manual, app, choice })));
  }));
  r.post('/manual/:id/convert', wrap(async (req, res) => {
    const mi = need(req.params.id);
    if (converter.busy(mi.id)) return res.status(409).json({ error: 'Đang xử lý file này — đợi xong rồi thử lại' });
    converter.convert(mi.id, { gen: req.body?.gen !== false, fresh: req.body?.fresh === true, udid: typeof req.body?.udid === 'string' ? req.body.udid.trim() : '' }).catch((e) => console.error('convert:', e.message)); // chạy nền, tiến độ qua SSE
    res.status(202).json({ id: mi.id });
  }));
  r.post('/manual/:id/stop', wrap(async (req, res) => {
    need(req.params.id);
    converter.stop(req.params.id);
    res.status(202).json({ id: req.params.id });
  }));
  r.post('/manual/:id/conflicts', wrap(async (req, res) => {
    const { sheet, tcId, action } = req.body || {};
    need(req.params.id);
    res.json(view(converter.resolveConflict(req.params.id, { sheet, tcId }, action)));
  }));
  return r;
}

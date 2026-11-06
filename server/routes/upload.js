// Upload file build từ máy khác trong team (không trỏ được đường dẫn trên máy chạy server).
// .apk giữ nguyên; .zip chứa .app (build iOS Simulator) được giải nén. Trả về đường dẫn trên máy chủ
// để dùng tiếp với Thêm app / Cập nhật build như đường dẫn nhập tay.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Router } from 'express';
import multer from 'multer';
import { DATA } from '../paths.js';
import { readAppInfo } from '../device/platforms.js';

const exec = promisify(execFile);

// Tìm .app nằm nông nhất trong thư mục giải nén (zip thường có 1 cấp thư mục bọc ngoài)
export function findAppBundle(dir, depth = 0) {
  if (depth > 3) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== '__MACOSX');
  const hit = entries.find((e) => /\.app$/i.test(e.name));
  if (hit) return path.join(dir, hit.name);
  for (const e of entries) {
    const f = findAppBundle(path.join(dir, e.name), depth + 1);
    if (f) return f;
  }
  return null;
}

export default function uploadRoutes(ctx, { root = path.join(DATA, 'uploads'), readInfo = readAppInfo } = {}) {
  const r = Router();
  const upload = multer({ dest: path.join(root, 'tmp'), limits: { fileSize: 1024 * 1024 * 1024 } });
  r.post('/builds/upload', (req, res, next) => { fs.mkdirSync(path.join(root, 'tmp'), { recursive: true }); next(); }, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Chưa chọn file' });
    const name = path.basename(Buffer.from(req.file.originalname, 'latin1').toString('utf8'));
    const dir = path.join(root, `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(4).toString('hex')}`);
    const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.mkdirSync(dir, { recursive: true });
      let file;
      if (/\.apk$/i.test(name)) {
        file = path.join(dir, name);
        fs.renameSync(req.file.path, file);
      } else if (/\.zip$/i.test(name)) {
        // ditto giữ đúng symlink / quyền chạy của bundle .app (unzip đôi khi làm hỏng)
        await exec('ditto', ['-x', '-k', req.file.path, dir]);
        fs.rmSync(req.file.path, { force: true });
        file = findAppBundle(dir);
        if (!file) throw new Error('Trong file zip không có thư mục .app (build iOS Simulator)');
      } else if (/\.ipa$/i.test(name)) {
        throw new Error('.ipa là build cho iPhone thật — cần .app build cho Simulator, nén thành .zip rồi tải lên');
      } else {
        throw new Error('Chỉ nhận .apk (Android) hoặc .zip chứa .app (iOS Simulator)');
      }
      const info = await readInfo(file);
      const { simPlistFix, ...meta } = info;
      res.status(201).json({ path: file, ...meta });
    } catch (e) {
      fs.rmSync(req.file.path, { force: true });
      cleanup();
      res.status(400).json({ error: `File app không dùng được: ${e.message}` });
    }
  });
  return r;
}

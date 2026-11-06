// Đọc chữ trên ảnh chụp màn hình (OCR) cho chữ app không đưa vào page source: chữ vẽ trong ảnh / biểu đồ / mockup,
// badge không có accessibility id. Dùng Apple Vision (ocr.swift, build 1 lần bằng swiftc) → chỉ chạy trên macOS;
// máy khác / build lỗi → available() = false, các bước kiểm giữ cách cũ (chỉ page source).
import { execFile, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ocr.swift');
let bin; // đường dẫn binary; null = không dùng được

function binary() {
  if (bin !== undefined) return bin;
  if (process.platform !== 'darwin' || process.env.OCR === 'off' || !fs.existsSync(SRC)) return (bin = null);
  // Tên theo nội dung ocr.swift → sửa file thì build lại
  const hash = crypto.createHash('sha1').update(fs.readFileSync(SRC)).digest('hex').slice(0, 10);
  const out = path.join(os.tmpdir(), `qa-ocr-${hash}`);
  try {
    if (!fs.existsSync(out)) execFileSync('swiftc', ['-O', SRC, '-o', out], { stdio: 'ignore', timeout: 120000 });
    return (bin = out);
  } catch {
    return (bin = null);
  }
}

export const available = () => Boolean(binary());

// PNG (Buffer) → [{ text, conf, x, y, w, h }] (khung tỉ lệ 0..1, gốc trên-trái), xếp từ trên xuống.
// Bất đồng bộ: gọi đồng bộ sẽ chặn cả tiến trình (giới hạn thời gian case không chạy được trong lúc đọc ảnh)
export async function ocrPng(png) {
  const b = binary();
  if (!b) return [];
  const file = path.join(os.tmpdir(), `qa-ocr-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`);
  await fs.promises.writeFile(file, png);
  try {
    const out = await new Promise((resolve, reject) => {
      execFile(b, [file], { timeout: 20000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
    return JSON.parse(String(out)).sort((a, c) => a.y - c.y || a.x - c.x);
  } catch {
    return [];
  } finally {
    fs.rmSync(file, { force: true });
  }
}

// Chuẩn hoá để so: thường, bỏ dấu câu / khoảng trắng / emoji; chữ Kirin trông giống Latin (OCR hay nhầm "у" ↔ "y")
const LOOKALIKE = { а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', к: 'k', м: 'm', т: 't', н: 'h', в: 'b' };
export const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase()
  .replace(/./gu, (ch) => LOOKALIKE[ch] || ch)
  .replace(/[^\p{L}\p{N}]+/gu, '');

function distance(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return dp[b.length];
}

// Tìm chữ target trong kết quả OCR: phải là CẢ một dòng (hoặc tối đa 3 dòng liền nhau khi câu xuống dòng), cho lệch
// vài ký tự do OCR đọc nhầm. Không khớp một đoạn nằm trong câu khác — vd "Red Thai curry tonight?" không được khớp vào
// tiêu đề "Cook your Red thai curry tonight?", "Back" không khớp trong "Feedback".
// → { x, y, w, h } (tỉ lệ 0..1, khung bao các dòng khớp) hoặc null
export function findText(lines, target, { minConf = 0.5 } = {}) {
  const t = norm(target);
  if (t.length < 2) return null;
  const ok = lines.filter((l) => l.conf >= minConf);
  const tol = t.length >= 8 ? Math.max(1, Math.floor(t.length / 10)) : 0;
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= ok.length; i++) {
      const part = ok.slice(i, i + n);
      const s = norm(part.map((l) => l.text).join(' '));
      const hit = s === t || (tol > 0 && Math.abs(s.length - t.length) <= tol && distance(s, t) <= tol);
      if (!hit) continue;
      const x = Math.min(...part.map((l) => l.x));
      const y = Math.min(...part.map((l) => l.y));
      return { x, y, w: Math.max(...part.map((l) => l.x + l.w)) - x, h: Math.max(...part.map((l) => l.y + l.h)) - y };
    }
  }
  return null;
}

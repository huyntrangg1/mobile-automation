// Vẽ khung đỏ lên ảnh evidence rồi thu nhỏ thành JPG (sips có sẵn trên macOS) để nhúng vào report.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';

const RED = [229, 20, 20];

// dash > 0 → nét đứt (khung "chỗ lẽ ra phải hiện")
function strokeRect(png, x0, y0, x1, y1, thick, dash = 0) {
  const clampX = (v) => Math.max(0, Math.min(png.width - 1, Math.round(v)));
  const clampY = (v) => Math.max(0, Math.min(png.height - 1, Math.round(v)));
  const [l, r, t, b] = [clampX(x0), clampX(x1), clampY(y0), clampY(y1)];
  const paint = (x, y) => {
    if (dash && Math.floor((x + y) / dash) % 2) return;
    const i = (png.width * y + x) << 2;
    [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]] = [...RED, 255];
  };
  for (let k = 0; k < thick; k++) {
    for (let x = l; x <= r; x++) { paint(x, clampY(t + k)); paint(x, clampY(b - k)); }
    for (let y = t; y <= b; y++) { paint(clampX(l + k), y); paint(clampX(r - k), y); }
  }
}

// ev: { image (base64 PNG), win (point), rect (point) | null, missing? } → ghi `${outBase}.jpg`, trả về đường dẫn
export function writeEvidence(ev, outBase) {
  const png = PNG.sync.read(Buffer.from(ev.image, 'base64'));
  if (ev.rect) {
    const s = png.width / ev.win.width; // ảnh chụp theo pixel, vị trí phần tử theo point
    const pad = 6 * s;
    const { x, y, width, height } = ev.rect;
    strokeRect(png, x * s - pad, y * s - pad, (x + width) * s + pad, (y + height) * s + pad, Math.max(4, Math.round(2.5 * s)), ev.missing ? Math.round(10 * s) : 0);
  }
  const tmp = `${outBase}.png`;
  const out = `${outBase}.jpg`;
  fs.writeFileSync(tmp, PNG.sync.write(png));
  execFileSync('sips', ['-Z', '1100', '-s', 'format', 'jpeg', '-s', 'formatOptions', '75', tmp, '--out', out], { stdio: 'ignore' });
  fs.rmSync(tmp);
  return out;
}

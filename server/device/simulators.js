import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = async () => (await promisify(execFile)('xcrun', ['simctl', 'list', 'devices', 'available', '-j'])).stdout;

// Simulator iOS khả dụng, máy đang bật (Booted) lên đầu
export async function listSimulators(execImpl = run) {
  const { devices } = JSON.parse(await execImpl());
  const out = [];
  for (const [runtime, list] of Object.entries(devices)) {
    const m = runtime.match(/SimRuntime\.iOS-(\d+)-(\d+)/);
    if (!m) continue;
    for (const d of list) {
      if (d.isAvailable === false) continue;
      out.push({ udid: d.udid, name: d.name, os: `iOS ${m[1]}.${m[2]}`, booted: d.state === 'Booted' });
    }
  }
  return out.sort((a, b) => Number(b.booted) - Number(a.booted));
}

const HOME = os.homedir();
const SIM_DEVICES = path.join(HOME, 'Library/Developer/CoreSimulator/Devices');
const DERIVED = path.join(HOME, 'Library/Developer/Xcode/DerivedData');
const readPlist = async (file) => JSON.parse((await promisify(execFile)('plutil', ['-convert', 'json', '-o', '-', file])).stdout);
// Ảnh icon trong .app có thể là PNG kiểu Apple (CgBI) trình duyệt không đọc được → sips chuyển về PNG thường
const sipsPng = async (src, dest) => { await promisify(execFile)('sips', ['-s', 'format', 'png', src, '--out', dest]); };
const dirs = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } };

// Đường dẫn trong container simulator đổi UUID mỗi lần cài lại → phải copy ra trước khi lưu
export const isSimContainerPath = (p, devices = SIM_DEVICES) => p.startsWith(devices + path.sep) && p.includes('/data/Containers/Bundle/Application/');

// Dung lượng .app: duyệt bất đồng bộ (không chặn server đang theo dõi run), nhớ theo path + mtime (build không đổi thì không duyệt lại)
const sizeCache = new Map();
async function dirSize(p) {
  let total = 0;
  for (const e of await fs.promises.readdir(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    total += e.isDirectory() ? await dirSize(f) : (await fs.promises.lstat(f)).size;
  }
  return total;
}
async function buildSize(p, mtime) {
  const key = `${p}:${mtime}`;
  if (!sizeCache.has(key)) sizeCache.set(key, await dirSize(p).catch(() => null));
  return sizeCache.get(key);
}

// Icon chính của app (AppIcon60x60@2x.png…) theo Info.plist, không có thì lấy file AppIcon*.png lớn nhất
function iconFile(appPath, info) {
  let files = [];
  try { files = fs.readdirSync(appPath).filter((f) => /\.png$/i.test(f)); } catch { return null; }
  const names = info.CFBundleIcons?.CFBundlePrimaryIcon?.CFBundleIconFiles || [];
  for (const n of [...names].reverse()) for (const suf of ['@3x.png', '@2x.png', '.png']) if (files.includes(n + suf)) return n + suf;
  return files.filter((f) => /^AppIcon/i.test(f) && !/ipad/i.test(f)).sort().pop() || null;
}

// Build iOS có trên máy: app đã cài trên từng simulator + build Xcode trong DerivedData. Mới nhất lên đầu.
// iconDir: thư mục cache icon (PNG đã chuyển) — icon trả về là tên file trong đó
export async function listBuilds({ devices = SIM_DEVICES, derived = DERIVED, plist = readPlist, sims = listSimulators, iconDir = null, toPng = sipsPng } = {}) {
  const names = Object.fromEntries((await sims().catch(() => [])).map((s) => [s.udid, `${s.name} (${s.os})`]));
  const found = [];
  for (const udid of dirs(devices)) {
    const base = path.join(devices, udid, 'data/Containers/Bundle/Application');
    for (const c of dirs(base)) for (const a of dirs(path.join(base, c)).filter((x) => x.endsWith('.app'))) found.push({ path: path.join(base, c, a), kind: 'simulator', source: names[udid] || `Simulator ${udid.slice(0, 8)}` });
  }
  for (const proj of dirs(derived)) {
    const products = path.join(derived, proj, 'Build/Products');
    for (const conf of dirs(products).filter((x) => x.endsWith('-iphonesimulator'))) {
      for (const a of dirs(path.join(products, conf)).filter((x) => x.endsWith('.app'))) found.push({ path: path.join(products, conf, a), kind: 'xcode', source: `Xcode · ${conf.replace('-iphonesimulator', '')}` });
    }
  }
  const out = new Map();
  for (const f of found) {
    let info;
    try { info = await plist(path.join(f.path, 'Info.plist')); } catch { continue; }
    const bundleId = info.CFBundleIdentifier;
    // Bỏ WebDriverAgent / test runner — không phải app cần test
    if (!bundleId || /\.xctrunner$/.test(bundleId) || /WebDriverAgent/i.test(f.path)) continue;
    const version = info.CFBundleShortVersionString ? `${info.CFBundleShortVersionString} (${info.CFBundleVersion ?? '?'})` : '?';
    let mtime = 0;
    try { mtime = fs.statSync(f.path).mtimeMs; } catch {}
    const b = { path: f.path, name: info.CFBundleDisplayName || info.CFBundleName || path.basename(f.path, '.app'), bundleId, version, kind: f.kind, source: f.source, mtime, info };
    // Cùng bundle id + version ở nhiều simulator → giữ bản mới nhất
    const key = `${bundleId}@${version}`;
    if (!out.has(key) || out.get(key).mtime < mtime) out.set(key, b);
  }
  for (const b of out.values()) {
    b.size = await buildSize(b.path, b.mtime);
    b.icon = null;
    const { info } = b;
    delete b.info;
    const src = iconDir && iconFile(b.path, info);
    if (!src) continue;
    const name = `${crypto.createHash('sha1').update(`${b.path}:${b.mtime}`).digest('hex').slice(0, 16)}.png`;
    try {
      if (!fs.existsSync(path.join(iconDir, name))) { fs.mkdirSync(iconDir, { recursive: true }); await toPng(path.join(b.path, src), path.join(iconDir, name)); }
      b.icon = name;
    } catch {}
  }
  return [...out.values()].sort((a, b) => b.mtime - a.mtime);
}


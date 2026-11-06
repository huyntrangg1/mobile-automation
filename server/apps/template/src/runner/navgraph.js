// Sơ đồ màn của app: "màn A — bấm X → màn B", ghi lại từ các lần chạy thật (k.nav sau một bước Tap thành công).
// Dùng khi case "Tiếp nối" bị chặn vì case trước lỗi: cài lại app rồi đi theo sơ đồ tới màn bắt đầu của case đó (không chạy lại case trước).
// Mỗi cạnh gắn với build đã chạy (BUILD_STAMP): đổi build → cạnh cũ bị bỏ, vì locator / luồng có thể đã đổi.
import fs from 'node:fs';
import path from 'node:path';
import * as ui from '../utils/ui.js';

const fileOf = (cwd = process.cwd()) => path.join(cwd, 'data', 'nav-graph.json');
const buildOf = () => process.env.BUILD_STAMP || '';

function read(cwd) {
  try { return JSON.parse(fs.readFileSync(fileOf(cwd), 'utf8')); } catch { return { edges: [] }; }
}

// edge: { from, to, sel, target, arrive: { sel, what }, needsInput }
//   needsInput: trước lần bấm đó tester có nhập chữ ở màn này → đi lại không đủ (thiếu dữ liệu nhập) → không dùng khi tìm đường
export function recordEdge(edge, { cwd } = {}) {
  try {
    if (!edge?.from || !edge.to || edge.from === edge.to || typeof edge.sel !== 'string' || !edge.arrive?.sel) return;
    if (edge.sel.startsWith('point:') || String(edge.arrive.sel).startsWith('point:')) return;
    const build = buildOf();
    const g = read(cwd);
    const edges = g.edges.filter((e) => e.build === build && !(e.from === edge.from && e.to === edge.to));
    edges.push({ ...edge, build, at: new Date().toISOString() });
    fs.mkdirSync(path.dirname(fileOf(cwd)), { recursive: true });
    fs.writeFileSync(fileOf(cwd), JSON.stringify({ edges }, null, 1));
  } catch {}
}

// Đường ngắn nhất (ít bước bấm nhất) từ màn `from` tới màn `to` trong build hiện tại → mảng cạnh, [] nếu cùng màn, null nếu không có đường
export function findPath(from, to, { cwd } = {}) {
  if (from === to) return [];
  const build = buildOf();
  const edges = read(cwd).edges.filter((e) => e.build === build && !e.needsInput);
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const e of edges.filter((x) => x.from === cur)) {
      if (prev.has(e.to)) continue;
      prev.set(e.to, e);
      if (e.to === to) {
        const out = [];
        for (let n = to; prev.get(n); n = prev.get(n).from) out.unshift(prev.get(n));
        return out;
      }
      queue.push(e.to);
    }
  }
  return null;
}

// Đi theo đường: bấm từng nút rồi chờ dấu hiệu của màn kế (cùng cách k.nav chờ màn)
export async function walkPath(route, say = () => {}) {
  for (const e of route) {
    say(`Điều hướng: ${e.from} → bấm "${e.target}" → ${e.to}`);
    await ui.tap(e.sel);
    await ui.el(e.arrive.sel, 15000).catch(() => { throw new Error(`Không tới được màn ${e.to}: không thấy ${e.arrive.what || e.arrive.sel} sau 15s`); });
  }
}

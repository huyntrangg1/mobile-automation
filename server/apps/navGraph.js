// Sơ đồ màn của app (workspace/data/nav-graph.json) — bản phía server của runner/navgraph.js (recordEdge), cùng định dạng:
//   { edges: [{ from, to, sel, target, arrive: { sel, what }, needsInput, build, at }] }
// Server ghi cạnh khi lấy locator (AI khám phá / đi tới màn) và khi chạy thử luồng chung lúc chuyển đổi → Run và lần chuyển đổi sau dùng lại.
import fs from 'node:fs';
import path from 'node:path';

// Giữ đúng như runner/navgraph.js: nút mua / thanh toán / đăng nhập bên thứ ba không vào sơ đồ
export const NAV_BUY = /\b(subscribe|buy|purchase|start (my |your )?(free )?trial|try (it )?free|get premium|upgrade|pay|continue with (apple|google|facebook)|sign in with)\b|[$€£₫¥]\s?\d/i;

export const navGraphFile = (workspace) => path.join(workspace, 'data', 'nav-graph.json');

export function readNavEdges(workspace) {
  if (!workspace) return [];
  try { return JSON.parse(fs.readFileSync(navGraphFile(workspace), 'utf8')).edges || []; } catch { return []; }
}

// Như recordEdge: chỉ giữ cạnh của build hiện tại, mỗi cặp (from, to) một cạnh (cạnh mới thay cạnh cũ). → true nếu đã ghi
export function recordNavEdge(workspace, build, edge) {
  try {
    if (!workspace || !build) return false; // không biết build → không ghi (cạnh của build khác sẽ bị dùng nhầm)
    if (!edge?.from || !edge.to || edge.from === edge.to || typeof edge.sel !== 'string' || !edge.sel || !edge.arrive?.sel) return false;
    if (edge.sel.startsWith('point:') || String(edge.arrive.sel).startsWith('point:')) return false;
    if (NAV_BUY.test(`${edge.target || ''} ${edge.sel}`)) return false;
    const edges = readNavEdges(workspace).filter((e) => e.build === build && !(e.from === edge.from && e.to === edge.to));
    edges.push({ from: edge.from, to: edge.to, sel: edge.sel, target: edge.target || '', arrive: { sel: edge.arrive.sel, what: edge.arrive.what || '' }, needsInput: !!edge.needsInput, build, at: new Date().toISOString() });
    fs.mkdirSync(path.dirname(navGraphFile(workspace)), { recursive: true });
    fs.writeFileSync(navGraphFile(workspace), JSON.stringify({ edges }, null, 1));
    return true;
  } catch {
    return false;
  }
}

// Dấu hiệu nhận màn (arrive) từ danh sách phần tử: tiêu đề = chữ tĩnh trên cùng (bỏ Back / Close, chữ trông như dữ liệu), không có thì nút có tên
export function arriveOf(elements = []) {
  const named = (e) => String(e?.name || '').trim();
  const t = elements.filter((e) => e.type === 'StaticText' && named(e) && !/^(back|close)$/i.test(named(e)) && !/\d|@/.test(named(e)) && named(e).length <= 80 && e.locator && !String(e.locator).startsWith('point:'))
    .sort((a, b) => (a.rect?.y || 0) - (b.rect?.y || 0) || (a.rect?.x || 0) - (b.rect?.x || 0))[0];
  if (t) return { sel: t.locator, what: `tiêu đề "${named(t).replace(/\s+/g, ' ')}"` };
  const b = elements.find((e) => e.type === 'Button' && named(e) && e.locator && !NAV_BUY.test(named(e)));
  return b ? { sel: b.locator, what: `nút "${named(b)}"` } : null;
}

// Tên hiển thị của phần tử có locator `sel` trên màn (để làm "target" của cạnh)
export function targetOf(elements = [], sel) {
  const el = elements.find((e) => e.locator === sel || e.alts?.includes(sel));
  return String(el?.name || el?.label || '').trim() || String(sel || '').replace(/^~/, '');
}

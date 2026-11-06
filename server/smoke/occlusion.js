// Bỏ khỏi cây layer Figma những layer KHÔNG nhìn thấy được trong bản design, trước khi so với app và trước khi tóm tắt cho AI:
//   - layer ẩn (visible:false) và con của layer ẩn (hiddenByAncestor)
//   - layer nằm hoàn toàn ngoài khung frame (frame cắt phần thừa)
//   - layer bị một layer ĐẶC phía trên (vẽ sau) che kín, vd màn nền nằm dưới một modal nền trắng
// Lý do (lần chạy Blood Sugar): frame "Blood Sugar - Log" = màn Action nằm dưới lớp phủ tối + modal trắng. Plugin xuất đúng cây layer,
// nhưng chữ như "Sleep", "Duration" của màn nền bị modal che hẳn nên không ai thấy; tool vẫn coi là phải có và báo "thiếu chữ".
// Thận trọng: chỉ coi là "che" khi layer trên là SOLID đặc (opacity 1, mọi cha cũng đặc, đang hiện) và bao trọn hộp layer dưới.
const EPS = 1;
const OPAQUE = 0.99;
const contains = (a, b) => a.x <= b.x + EPS && a.y <= b.y + EPS && a.x + a.width >= b.x + b.width - EPS && a.y + a.height >= b.y + b.height - EPS;
const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const op = (v) => (v == null ? 1 : v);
const isHidden = (n) => n.visible === false || n.hiddenByAncestor === true;
const isSolidCover = (n) => n.type !== 'TEXT' && !isHidden(n) && op(n.opacity) >= OPAQUE && !!n.absoluteBoundingBox
  && (n.fills || []).some((p) => p.type === 'SOLID' && p.visible !== false && op(p.opacity) >= OPAQUE);

export function pruneOccluded(root) {
  const removed = { hidden: 0, clipped: 0, occluded: 0 };
  const frame = root.absoluteBoundingBox;
  // Lượt 1: đánh số theo thứ tự vẽ (sau = nằm trên), tìm các layer đặc có thể che
  let counter = 0;
  const info = new Map();
  const covers = [];
  const number = (n, chainOpaque) => {
    const rec = { idx: counter++, end: 0 };
    info.set(n, rec);
    const mine = chainOpaque && !isHidden(n) && op(n.opacity) >= OPAQUE;
    if (n !== root && mine && isSolidCover(n)) covers.push({ idx: rec.idx, box: n.absoluteBoundingBox });
    for (const c of n.children || []) number(c, mine);
    rec.end = counter - 1;
  };
  number(root, true);
  // Lượt 2: dựng cây mới, bỏ layer ẩn / ngoài khung / bị che
  const build = (n) => {
    const out = { ...n };
    if (!n.children) return out;
    out.children = [];
    for (const c of n.children) {
      if (isHidden(c)) { removed.hidden++; continue; }
      const b = c.absoluteBoundingBox;
      if (b && frame && !intersects(b, frame)) { removed.clipped++; continue; }
      const { end } = info.get(c);
      if (b && covers.some((k) => k.idx > end && contains(k.box, b))) { removed.occluded++; continue; }
      out.children.push(build(c));
    }
    return out;
  };
  return { node: build(root), removed };
}

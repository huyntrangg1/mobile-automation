// Danh sách "cần review" sau chuyển đổi: đối chiếu Target với Locator map của app + gộp với điểm mờ và lưu ý của write.mjs.
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// table = map.locatorTable(appId): { [tên màn]: [{ key, type, locator }] } → mảng cảnh báo; map rỗng (chưa lấy locator) → []
export function checkTargets(plans, table) {
  const screens = Object.keys(table || {});
  if (!screens.length) return [];
  const out = [];
  const missingScreen = new Set();
  for (const tc of plans) {
    for (const r of tc.rows) {
      if (!r.target || /^run flow$/i.test(r.keyword)) continue;
      const name = screens.find((n) => n === r.screen) || screens.find((n) => slug(n) && slug(r.screen) && (slug(n).includes(slug(r.screen)) || slug(r.screen).includes(slug(n))));
      if (!name) {
        if (!missingScreen.has(r.screen)) { missingScreen.add(r.screen); out.push(`Màn "${r.screen}" chưa có trong Locator map (${tc.id} step ${r.step}: "${r.target}")`); }
        continue;
      }
      if (!table[name].some((e) => norm(e.key) === norm(r.target))) out.push(`${tc.id} step ${r.step}: "${r.target}" chưa có trong Locator map màn ${r.screen}`);
    }
  }
  return out;
}

// → mảng chuỗi có nhãn nguồn, bỏ trùng, thứ tự: điểm mờ trong manual → quy tắc skill → Locator map
export function buildReview({ writeReview = [], targets = [], ambiguity = {} }) {
  const manual = Object.entries(ambiguity).flatMap(([id, list]) => list.map((a) => `[Manual] ${id}: ${a.text}`));
  return [...new Set([...manual, ...writeReview.map((l) => `[Quy tắc] ${l}`), ...targets.map((l) => `[Locator map] ${l}`)])];
}

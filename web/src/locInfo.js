// Cảnh báo khi gen script có hai loại "thiếu locator": cả màn chưa có trong locator map, hoặc màn có nhưng thiếu một phần tử.
export const MISS_SCREEN = /^Màn "([^"]+)" chưa có trong locator map/;
export const MISS_ELEM = /^Màn (.+?): không tìm thấy "(.+?)" trong locator map/;

// Từ danh sách case → { absent: [[tên màn, số case]], els: { tên màn: [phần tử thiếu] } }
export function missingFrom(cases) {
  const absent = new Map();
  const els = {};
  for (const c of cases || []) {
    const seen = new Set();
    for (const w of c.script?.warnings || []) {
      const a = MISS_SCREEN.exec(w);
      const e = MISS_ELEM.exec(w);
      if (a && !seen.has(a[1])) { seen.add(a[1]); absent.set(a[1], (absent.get(a[1]) || 0) + 1); }
      if (e) { (els[e[1]] ||= new Set()).add(e[2]); }
    }
  }
  return {
    absent: [...absent.entries()].sort((x, y) => y[1] - x[1]),
    els: Object.fromEntries(Object.entries(els).map(([k, v]) => [k, [...v]])),
  };
}

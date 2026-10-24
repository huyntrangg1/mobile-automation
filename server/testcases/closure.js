// Case "Tiếp nối <TC trước>" cần các case phía trước chạy cùng để app ở đúng trạng thái → thêm vào, tới case "Cài lại app".
const READY = new Set(['generated']);
const REASON = { none: 'Chưa có script', generating: 'Đang gen script', failed: 'Gen script lỗi', stale: 'Bước đã đổi, cần gen lại' };

export function closure(cases, selectedIds) {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const want = new Set();
  const missing = [];
  const miss = (c, reason) => { if (!missing.some((m) => m.id === c.id)) missing.push({ id: c.id, tcId: c.tcId, reason }); };
  for (const sid of selectedIds) {
    let c = byId.get(sid);
    if (!c) continue;
    const guard = new Set();
    while (c && !guard.has(c.id)) {
      guard.add(c.id);
      want.add(c.id);
      if (c.fresh || !c.prev) break;
      const prev = cases.find((x) => x.appId === c.appId && x.file === c.file && x.tcId === c.prev);
      if (!prev) { miss(c, `Case phía trước ${c.prev} không có trong file`); break; }
      c = prev;
    }
  }
  const run = cases.filter((c) => want.has(c.id)).sort((a, b) => (a.file === b.file ? a.order - b.order : a.file.localeCompare(b.file))).map((c) => c.id);
  for (const id of run) {
    const c = byId.get(id);
    if (!READY.has(c.script?.status)) miss(c, REASON[c.script?.status] || 'Chưa có script');
  }
  return { run, added: run.filter((id) => !selectedIds.includes(id)), missing };
}

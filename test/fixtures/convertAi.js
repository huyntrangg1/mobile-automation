// AI giả cho chuyển đổi manual → automation: trả lời cả 3 loại lời gọi (lọc / lập khung / viết dòng) theo schema.
const row = (extra) => ({ step: 1, screen: 'Welcome', ...extra });
export const goodTc = (id, fresh) => ({
  id, fresh, pre: [],
  rows: [
    ...(fresh ? [row({ kind: 'Action', keyword: 'Launch fresh' }), row({ kind: 'Nav', keyword: 'Verify screen', target: 'Welcome' })] : []),
    row({ kind: 'Check', keyword: 'Verify text', target: 'Get Started', value: 'Get Started', compare: 'equals', label: 'Tiêu đề Welcome' }),
  ],
});
export const badTc = (id, fresh) => ({ ...goodTc(id, fresh), rows: goodTc(id, fresh).rows.map((r) => (r.kind === 'Check' ? { ...r, label: undefined } : r)) });

// manual: id case AI quyết "manual" ở bước lọc · rowsFor(id, fresh, callNo): PlanTc cho bước viết dòng
export function fakeConvertAi({ manual = [], rowsFor = goodTc } = {}) {
  const f = async (req) => {
    const p = req.schema.properties;
    const ids = () => [...req.prompt.matchAll(/"id": "([^"]+)"/g)].map((m) => m[1]);
    if (p.decisions) { f.filter++; return { ok: true, data: { decisions: ids().map((id) => ({ id, mode: manual.includes(id) ? 'manual' : 'automate', reason: manual.includes(id) ? 'AI: popup hệ thống' : 'ok' })) } }; }
    if (p.order) { f.skeleton++; const list = ids(); return { ok: true, data: { order: list.map((id) => ({ id, fresh: false })), groups: [list], flows: {} } }; }
    const group = JSON.parse(req.prompt.match(/"group": (\[[\s\S]*?\])/)[1]);
    const fresh = JSON.parse(req.prompt.match(/"fresh": (\{[\s\S]*?\})/)[1]);
    f.rows.push(group);
    return { ok: true, data: { testcases: group.map((id) => rowsFor(id, fresh[id], f.rows.length)) } };
  };
  Object.assign(f, { filter: 0, skeleton: 0, rows: [], total: () => f.filter + f.skeleton + f.rows.length });
  return f;
}

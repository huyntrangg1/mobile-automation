import test from 'node:test';
import assert from 'node:assert/strict';
import { rulesFrom } from '../server/testcases/convert/rules.js';
import { splitGroups, buildSkeleton } from '../server/testcases/convert/skeleton.js';

const ids = (n, p = 'TC_') => Array.from({ length: n }, (_, i) => `${p}${i + 1}`);
const mc = (id) => ({ id, module: 'Welcome', scenario: `Kịch bản ${id}`, pre: 'Đã cài app', steps: 'BƯỚC-BÍ-MẬT', expected: 'MONG-ĐỢI-BÍ-MẬT' });
const ai = (data) => { const f = async (req) => { f.calls.push(req); return data ? { ok: true, data } : { ok: false, error: 'lỗi' }; }; f.calls = []; return f; };

test('rulesFrom lấy đúng phần theo tiêu đề của SKILL.md vendor; tiêu đề không có → lỗi', () => {
  assert.match(rulesFrom('Order the TCs into runs'), /fresh: true/);
  assert.doesNotMatch(rulesFrom('Order the TCs into runs'), /Write each TC as v2 rows/);
  assert.match(rulesFrom('Reference'), /Keywords/);
  assert.throws(() => rulesFrom('Không có tiêu đề này'), /Không thấy mục/);
});

test('splitGroups: 23 id trong một nhóm → 10/10/3 đủ id, đúng thứ tự', () => {
  const order = ids(23).map((id) => ({ id, fresh: false }));
  const g = splitGroups(order, [ids(23)]);
  assert.deepEqual(g.map((x) => x.length), [10, 10, 3]);
  assert.deepEqual(g.flat(), ids(23));
});

test('splitGroups: bỏ id lạ, id trùng giữ lần đầu, thêm id thiếu vào nhóm cuối', () => {
  const order = ['A', 'B', 'C', 'D'].map((id) => ({ id, fresh: false }));
  assert.deepEqual(splitGroups(order, [['A', 'X', 'B'], ['B', 'C']]), [['A', 'B'], ['C', 'D']]);
});

test('buildSkeleton: case đầu sheet luôn fresh (ép bằng code); id thiếu / lạ được chỉnh; prompt có Steps (để lập luồng đúng) nhưng không có Expected, chứa mọi id', async () => {
  const cases = ['A', 'B', 'C'].map(mc);
  const f = ai({ order: [{ id: 'A', fresh: false }, { id: 'ZZ', fresh: true }, { id: 'B', fresh: false }], groups: [['A', 'B']], flows: {} });
  const r = await buildSkeleton({ sheet: 'Welcome', cases, runClaude: f });
  assert.equal(r.ok, true);
  assert.deepEqual(r.skeleton.order.map((o) => [o.id, o.fresh]), [['A', true], ['B', false], ['C', false]]);
  assert.deepEqual(r.skeleton.groups.flat(), ['A', 'B', 'C']);
  assert.equal(f.calls.length, 1);
  const sent = `${f.calls[0].system}\n${f.calls[0].prompt}`;
  for (const id of ['A', 'B', 'C']) assert.ok(sent.includes(id));
  assert.ok(sent.includes('BƯỚC-BÍ-MẬT') && !sent.includes('MONG-ĐỢI-BÍ-MẬT'));
  assert.match(f.calls[0].system, /fresh: true/); // quy tắc từ SKILL.md
});

test('buildSkeleton: AI trả thiếu order hoặc lỗi → ok:false kèm thông báo', async () => {
  assert.equal((await buildSkeleton({ sheet: 'S', cases: [mc('A')], runClaude: ai({ groups: [] }) })).ok, false);
  const e = await buildSkeleton({ sheet: 'S', cases: [mc('A')], runClaude: ai(null) });
  assert.equal(e.ok, false);
  assert.match(e.error, /lỗi/);
});

test('buildSkeleton: mỗi nhóm là một lần cài app → case đầu mỗi nhóm luôn fresh (write.mjs từ chối chuỗi nối tiếp > 10 TC)', async () => {
  const cases = ids(23).map(mc);
  const f = ai({ order: ids(23).map((id) => ({ id, fresh: false })), groups: [ids(23)], flows: {} });
  const r = await buildSkeleton({ sheet: 'S', cases, runClaude: f });
  assert.deepEqual(r.skeleton.groups.map((g) => g.length), [10, 10, 3]);
  const fresh = r.skeleton.order.filter((o) => o.fresh).map((o) => o.id);
  assert.deepEqual(fresh, ['TC_1', 'TC_11', 'TC_21']);
});

test('buildSkeleton dùng model nhẹ; writeGroup không ép model (dùng model mặc định của người dùng)', async () => {
  const f = ai({ order: [{ id: 'A', fresh: true }], groups: [['A']], flows: {} });
  await buildSkeleton({ sheet: 'S', cases: [mc('A')], runClaude: f });
  assert.equal(f.calls[0].model, 'claude-sonnet-5-5');
  const { writeGroup } = await import('../server/testcases/convert/rows.js');
  const g = ai({ testcases: [{ id: 'A', pre: [], rows: [] }] });
  await writeGroup({ skeleton: { order: [{ id: 'A', fresh: true }], groups: [['A']], flows: {} }, group: ['A'], cases: [mc('A')], runClaude: g });
  assert.equal(g.calls[0].model, undefined);
});

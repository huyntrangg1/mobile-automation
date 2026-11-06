import test from 'node:test';
import assert from 'node:assert/strict';
import { writeGroup, mergePlan } from '../server/testcases/convert/rows.js';

const mc = (id) => ({ id, module: 'Welcome', scenario: `Kịch bản ${id}`, description: '', pre: 'Đã cài app', steps: `Bước của ${id}`, expected: `Mong đợi của ${id}`, platform: 'All' });
const row = { step: 1, screen: 'Welcome', kind: 'Check', keyword: 'Verify displayed', target: 'Get Started', label: 'Nút Get Started' };
const tc = (id, extra = {}) => ({ id, fresh: false, pre: [], rows: [row], ...extra });
const skeleton = { order: [{ id: 'A', fresh: true }, { id: 'B', fresh: false }, { id: 'C', fresh: false }, { id: 'D', fresh: false }], groups: [['A', 'B'], ['C', 'D']], flows: { 'Welcome → Login': [row] } };
const ai = (fn) => { const f = async (req) => { f.calls.push(req); const d = fn(req); return d ? { ok: true, data: d } : { ok: false, error: 'AI lỗi' }; }; f.calls = []; return f; };

test('writeGroup: AI trả đủ id → ok, fresh lấy từ khung; id lạ bị loại', async () => {
  const f = ai(() => ({ testcases: [tc('A', { fresh: false }), tc('B'), tc('ZZ')] }));
  const r = await writeGroup({ skeleton, group: ['A', 'B'], cases: ['A', 'B', 'C', 'D'].map(mc), runClaude: f });
  assert.equal(r.ok, true);
  assert.deepEqual(r.testcases.map((t) => [t.id, t.fresh]), [['A', true], ['B', false]]);
  assert.equal(f.calls[0].noTools, true);
});

test('writeGroup: thiếu một id của nhóm → ok:false nêu id đó; AI lỗi → ok:false', async () => {
  const miss = await writeGroup({ skeleton, group: ['A', 'B'], cases: ['A', 'B'].map(mc), runClaude: ai(() => ({ testcases: [tc('A')] })) });
  assert.equal(miss.ok, false);
  assert.match(miss.error, /Thiếu B/);
  const bad = await writeGroup({ skeleton, group: ['A'], cases: [mc('A')], runClaude: ai(() => null) });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /AI lỗi/);
});

test('writeGroup: chỉ case của nhóm + tên flow có trong prompt; feedback được nối vào; system giống nhau giữa các nhóm (để cache)', async () => {
  const f = ai((req) => ({ testcases: JSON.parse(req.prompt.match(/"group": (\[[\s\S]*?\])/)[1]).map((id) => tc(id)) }));
  const cases = ['A', 'B', 'C', 'D'].map(mc);
  await writeGroup({ skeleton, group: ['A', 'B'], cases, runClaude: f });
  await writeGroup({ skeleton, group: ['C', 'D'], cases, runClaude: f, feedback: 'TC_C: thiếu label' });
  assert.ok(f.calls[0].prompt.includes('Bước của A') && !f.calls[0].prompt.includes('Bước của C'));
  assert.ok(f.calls[0].prompt.includes('Welcome → Login'));
  assert.ok(!f.calls[0].prompt.includes('thiếu label') && f.calls[1].prompt.includes('TC_C: thiếu label'));
  assert.equal(f.calls[0].system, f.calls[1].system);
  assert.match(f.calls[0].system, /Verify displayed/); // bảng keyword từ SKILL.md
});

test('mergePlan: xếp theo thứ tự khung, ép fresh theo khung, giữ flows và manual', () => {
  const plan = mergePlan({ skeleton, groupResults: [[tc('C'), tc('D')], [tc('B'), tc('A', { fresh: false })]], manual: [{ tc: 'X', reason: 'OAuth' }] });
  assert.deepEqual(plan.testcases.map((t) => [t.id, t.fresh]), [['A', true], ['B', false], ['C', false], ['D', false]]);
  assert.deepEqual(Object.keys(plan.flows), ['Welcome → Login']);
  assert.deepEqual(plan.manual, [{ tc: 'X', reason: 'OAuth' }]);
  assert.deepEqual(plan.testdata, []);
});

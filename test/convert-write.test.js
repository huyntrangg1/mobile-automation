import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpDir } from './helpers.js';
import { writePlan, convertSheet } from '../server/testcases/convert/writeXlsx.js';

const mk = (n, sel = true) => Array.from({ length: n }, (_, i) => ({ id: `TC_W_${String(i + 1).padStart(3, '0')}`, module: 'Welcome', type: 'Positive', platform: 'All', scenario: `s${i + 1}`, description: '', pre: '', steps: 'b', expected: 'e', priority: 'High', selected: sel }));
const good = (id, fresh) => ({ id, fresh, pre: [], rows: [
  ...(fresh ? [{ step: 1, screen: 'Welcome', kind: 'Action', keyword: 'Launch fresh' }, { step: 1, screen: 'Welcome', kind: 'Nav', keyword: 'Verify screen', target: 'Welcome' }] : []),
  { step: 1, screen: 'Welcome', kind: 'Check', keyword: 'Verify text', target: 'Get Started', value: 'Get Started', compare: 'equals', label: 'Tiêu đề Welcome' }] });
const noLabel = (id, fresh) => ({ ...good(id, fresh), rows: good(id, fresh).rows.map((r) => (r.kind === 'Check' ? { ...r, label: undefined } : r)) });
const decisions = (cases) => cases.map((c) => ({ id: c.id, mode: 'automate', reason: '' }));

// AI giả: lập khung (schema có `order`) rồi viết dòng (schema có `testcases`); rowsFor quyết định nội dung theo lần gọi
function fakeAi(rowsFor, { delay = 0 } = {}) {
  const f = async (req) => {
    f.active++; f.maxActive = Math.max(f.maxActive, f.active);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    f.active--;
    if (req.schema.properties.order) {
      f.skeleton++;
      const ids = [...req.prompt.matchAll(/"id": "(TC_W_\d+)"/g)].map((m) => m[1]);
      return { ok: true, data: { order: ids.map((id) => ({ id, fresh: false })), groups: [ids], flows: {} } };
    }
    const group = JSON.parse(req.prompt.match(/"group": (\[[\s\S]*?\])/)[1]);
    f.rowsCalls.push(group);
    const fresh = JSON.parse(req.prompt.match(/"fresh": (\{[\s\S]*?\})/)[1]);
    return { ok: true, data: { testcases: group.map((id) => rowsFor(id, fresh[id], f.rowsCalls.length)) } };
  };
  Object.assign(f, { skeleton: 0, rowsCalls: [], active: 0, maxActive: 0 });
  return f;
}

test('writePlan: plan hợp lệ → ghi file xlsx thật; case chưa selected nhưng có trong plan vẫn ghi được', async () => {
  const out = tmpDir();
  const cases = mk(2);
  cases[1].selected = false;
  const r = await writePlan({ plan: { testcases: [good('TC_W_001', true), good('TC_W_002', false)], flows: {}, testdata: [], manual: [] }, sheet: { sheet: 'Welcome', cases }, outDir: out });
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.equal(r.files.length, 1);
  assert.ok(fs.existsSync(r.files[0]) && r.files[0].endsWith('-automation.xlsx'));
});

test('writePlan: Check thiếu label → ok:false, problems nêu TC; "contains" đi vào review', async () => {
  const bad = await writePlan({ plan: { testcases: [noLabel('TC_W_001', true)], flows: {}, testdata: [], manual: [] }, sheet: { sheet: 'Welcome', cases: mk(1) }, outDir: tmpDir() });
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join('\n'), /TC_W_001.*Check label/);
  const c = good('TC_W_001', true);
  c.rows[c.rows.length - 1].compare = 'contains';
  const rev = await writePlan({ plan: { testcases: [c], flows: {}, testdata: [], manual: [] }, sheet: { sheet: 'Welcome', cases: mk(1) }, outDir: tmpDir() });
  assert.equal(rev.ok, true);
  assert.ok(rev.review.some((l) => /contains/i.test(l)), rev.review.join('|'));
});

test('convertSheet: lần 1 sai (thiếu label), lần 2 đúng → ok, đúng 2 lần viết dòng và có feedback ở lần 2', async () => {
  const cases = mk(2);
  const ai = fakeAi((id, fresh, n) => (n === 1 ? noLabel(id, fresh) : good(id, fresh)));
  const r = await convertSheet({ sheet: { sheet: 'Welcome', cases }, decisions: decisions(cases), runClaude: ai, outDir: tmpDir() });
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.equal(ai.rowsCalls.length, 2);
  assert.equal(ai.skeleton, 1);
  assert.deepEqual(Object.keys(r.plans).sort(), ['TC_W_001', 'TC_W_002']);
});

test('convertSheet: AI luôn sai → ok:false sau đúng 1 + maxFix lần viết, vẫn trả plans', async () => {
  const cases = mk(1);
  const ai = fakeAi((id, fresh) => noLabel(id, fresh));
  const r = await convertSheet({ sheet: { sheet: 'Welcome', cases }, decisions: decisions(cases), runClaude: ai, outDir: tmpDir(), maxFix: 3 });
  assert.equal(r.ok, false);
  assert.equal(ai.rowsCalls.length, 4);
  assert.ok(r.problems.length > 0 && r.plans.TC_W_001);
});

test('convertSheet: nhóm đã có trong cache (fresh khớp) → không gọi AI viết dòng', async () => {
  const cases = mk(2);
  const cache = { TC_W_001: good('TC_W_001', true), TC_W_002: good('TC_W_002', false) };
  const ai = fakeAi(() => { throw new Error('không được gọi'); });
  const r = await convertSheet({ sheet: { sheet: 'Welcome', cases }, decisions: decisions(cases), runClaude: ai, outDir: tmpDir(), cache });
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.equal(ai.rowsCalls.length, 0);
});

test('convertSheet: 25 case → 3 nhóm, AI chạy đồng thời tối đa `concurrency`', async () => {
  const cases = mk(25);
  const ai = fakeAi((id, fresh) => good(id, fresh), { delay: 20 });
  // khung giả lập 1 nhóm → splitGroups chia 10/10/5
  const r = await convertSheet({ sheet: { sheet: 'Welcome', cases }, decisions: decisions(cases), runClaude: ai, outDir: tmpDir(), concurrency: 2 });
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.equal(ai.rowsCalls.length, 3);
  assert.ok(ai.maxActive <= 2 && ai.maxActive >= 2, `maxActive=${ai.maxActive}`);
});

test('convertSheet: case để manual đi vào plan.manual (không cần dòng Keyword); nhóm AI thiếu id → chỉ lỗi cho nhóm đó, kèm thông báo', async () => {
  const cases = mk(2);
  const dec = [{ id: 'TC_W_001', mode: 'automate', reason: '' }, { id: 'TC_W_002', mode: 'manual', reason: 'Đăng nhập Google' }];
  const r = await convertSheet({ sheet: { sheet: 'Welcome', cases }, decisions: dec, runClaude: fakeAi((id, fresh) => good(id, fresh)), outDir: tmpDir() });
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.deepEqual(Object.keys(r.plans), ['TC_W_001']);
  const bad = await convertSheet({ sheet: { sheet: 'Welcome', cases: mk(1) }, decisions: decisions(mk(1)), runClaude: async (req) => (req.schema.properties.order ? { ok: true, data: { order: [{ id: 'TC_W_001', fresh: true }], groups: [['TC_W_001']], flows: {} } } : { ok: true, data: { testcases: [] } }), outDir: tmpDir(), maxFix: 1 });
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join('\n'), /Thiếu TC_W_001/);
});

test('onProgress: sau khi lập khung báo ngay tổng số bước (số nhóm + 1) và nhãn "Đã lập khung", không đứng ở nhãn cũ', async () => {
  const cases = mk(25);
  const events = [];
  await convertSheet({ sheet: { sheet: 'Welcome', cases }, decisions: decisions(cases), runClaude: fakeAi((id, fresh) => good(id, fresh)), outDir: tmpDir(), onProgress: (p) => events.push(p) });
  const afterSkeleton = events[1];
  assert.equal(afterSkeleton.done, 0);
  assert.equal(afterSkeleton.total, 4); // 3 nhóm + bước ghi file
  assert.match(afterSkeleton.label, /Đã lập khung.*3 nhóm/);
  assert.ok(events.at(-1).done === events.at(-1).total);
});

test('convertSheet mặc định chạy 5 nhóm cùng lúc', async () => {
  const cases = mk(60);
  const ai = fakeAi((id, fresh) => good(id, fresh), { delay: 30 });
  const r = await convertSheet({ sheet: { sheet: 'Welcome', cases }, decisions: decisions(cases), runClaude: ai, outDir: tmpDir() });
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.equal(ai.rowsCalls.length, 6);
  assert.equal(ai.maxActive, 5);
});

test('vòng sửa lỗi báo tiến độ: nêu số lỗi, lần sửa n/maxFix và lỗi đầu tiên (không im lặng)', async () => {
  const cases = mk(2);
  const events = [];
  const ai = fakeAi((id, fresh, n) => (n === 1 ? noLabel(id, fresh) : good(id, fresh)));
  const r = await convertSheet({ sheet: { sheet: 'Welcome', cases }, decisions: decisions(cases), runClaude: ai, outDir: tmpDir(), onProgress: (p) => events.push(p) });
  assert.equal(r.ok, true);
  const fix = events.find((p) => /sửa lại lần 1\/3/.test(p.label));
  assert.ok(fix, events.map((e) => e.label).join(' | '));
  assert.match(fix.label, /Kiểm tra phát hiện \d+ lỗi/);
  assert.match(fix.label, /Check label/);
});

test('convertSheet: onSkeleton một lần, onGroup mỗi nhóm viết xong; có sẵn skeleton → không gọi AI lập khung', async () => {
  const cases = mk(25);
  const sk = [], gr = [];
  const ai = fakeAi((id, fresh) => good(id, fresh));
  const r = await convertSheet({ sheet: { sheet: 'Welcome', cases }, decisions: decisions(cases), runClaude: ai, outDir: tmpDir(), onSkeleton: (s) => sk.push(s), onGroup: (t) => gr.push(t.map((x) => x.id)) });
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.equal(sk.length, 1);
  assert.deepEqual(gr.map((g) => g.length).sort(), [10, 10, 5]);
  const ai2 = fakeAi((id, fresh) => good(id, fresh));
  const r2 = await convertSheet({ sheet: { sheet: 'Welcome', cases }, decisions: decisions(cases), runClaude: ai2, outDir: tmpDir(), skeleton: sk[0] });
  assert.equal(r2.ok, true, r2.problems.join('; '));
  assert.equal(ai2.skeleton, 0);
});

// Chuyển lại một phần (khung đã lập + case đã viết xong): case cũ giữ nguyên từng dòng, không lập lại khung, chỉ viết case cần viết
test('convertSheet chuyển lại một phần: khoá case đã xong, chỉ viết case lỗi; lỗi lặp chỉ viết lại case lỗi', async () => {
  const cases = mk(3);
  const skeleton = { order: cases.map((c, i) => ({ id: c.id, fresh: i === 0 })), groups: [cases.map((c) => c.id)], flows: {} };
  const keep1 = good('TC_W_001', true);
  const keep2 = { ...good('TC_W_002', false), rows: [...good('TC_W_002', false).rows.map((r) => ({ ...r, compare: 'contains' }))] }; // contains: hậu kiểm bình thường sẽ đổi → khoá thì giữ nguyên
  const cache = { TC_W_001: keep1, TC_W_002: keep2 };
  // case 3: lần đầu thiếu label (lỗi) → lần 2 đúng
  const ai = fakeAi((id, fresh, n) => (n === 1 ? noLabel(id, fresh) : good(id, fresh)));
  const r = await convertSheet({ sheet: { sheet: 'Welcome', cases }, decisions: decisions(cases), runClaude: ai, outDir: tmpDir(), cache, skeleton });
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.equal(ai.skeleton, 0);
  assert.deepEqual(ai.rowsCalls, [['TC_W_003'], ['TC_W_003']]);
  assert.deepEqual(r.plans.TC_W_002.rows, keep2.rows);
});

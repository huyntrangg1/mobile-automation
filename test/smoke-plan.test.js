import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFigmaUrl } from '../server/smoke/figmaUrl.js';
import { planFlows } from '../server/smoke/plan.js';

test('parseFigmaUrl: link mẫu → fileKey + nodeId đổi "-" thành ":"', () => {
  const u = 'https://www.figma.com/design/SrFaXD304rwjPXcNRqXzh0/Moss--Copy-?node-id=5433-75649&t=ziUVGfKavDRTZA2Q-4';
  assert.deepEqual(parseFigmaUrl(u), { fileKey: 'SrFaXD304rwjPXcNRqXzh0', nodeId: '5433:75649' });
});

test('parseFigmaUrl: không có node-id → nodeId null', () => {
  assert.deepEqual(parseFigmaUrl('https://www.figma.com/design/SrFaXD304rwjPXcNRqXzh0/Moss'), { fileKey: 'SrFaXD304rwjPXcNRqXzh0', nodeId: null });
});

test('parseFigmaUrl: nhánh /branch/ dùng branchKey làm fileKey', () => {
  const r = parseFigmaUrl('https://www.figma.com/design/MainFileKey1234567890ab/branch/BranchKey1234567890abcd/Moss?node-id=1-2');
  assert.deepEqual(r, { fileKey: 'BranchKey1234567890abcd', nodeId: '1:2' });
});

test('parseFigmaUrl: link không phải figma design → null', () => {
  assert.equal(parseFigmaUrl('https://example.com/x'), null);
  assert.equal(parseFigmaUrl('không phải link'), null);
  assert.equal(parseFigmaUrl('https://www.figma.com/board/abcdefghijklmnopqrstuv/x?node-id=1-2'), null);
});

const PRD = 'https://developers.begamob.com/workspace/stress-watch/prd1/blood-sugar';
const FIG = 'https://www.figma.com/design/SrFaXD304rwjPXcNRqXzh0/Moss--Copy-?node-id=5433-75649';
const flow = (i) => ({ id: `f${i}`, name: `Luồng ${i}`, goal: 'g', prdQuote: 'q', expected: ['x'], frames: [{ nodeId: '1:2', name: 'Log' }], unclear: [] });
const fake = (res) => { const calls = []; return { calls, runClaude: async (o) => { calls.push(o); return typeof res === 'function' ? res(o) : res; } }; };

test('planFlows: gọi runClaude một lần, bật MCP đọc PRD + Figma, prompt có link PRD và nodeId', async () => {
  const { calls, runClaude } = fake({ ok: true, data: { flows: [flow(1)] } });
  const r = await planFlows({ prdUrl: PRD, figmaUrl: FIG, runClaude });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  for (const t of ['mcp__begamob__project_doc_get_by_url', 'mcp__figma__create_session', 'mcp__figma__get_metadata']) assert.ok(calls[0].allowedTools.includes(t), t);
  assert.ok(!calls[0].allowedTools.some((t) => t.startsWith('mcp__claude_ai_')), 'claude -p không nạp công cụ connector claude.ai');
  assert.match(calls[0].prompt, /create_session/);
  assert.match(calls[0].prompt, new RegExp(PRD));
  assert.match(calls[0].prompt, /5433:75649/);
  assert.match(calls[0].prompt, /SrFaXD304rwjPXcNRqXzh0/);
});

test('planFlows: cắt còn maxFlows luồng', async () => {
  const { runClaude } = fake({ ok: true, data: { flows: [1, 2, 3, 4].map(flow) } });
  const r = await planFlows({ prdUrl: PRD, figmaUrl: FIG, runClaude, maxFlows: 2 });
  assert.deepEqual(r.flows.map((f) => f.id), ['f1', 'f2']);
});

test('planFlows: runClaude lỗi → { ok:false, error } nhắc PRD / Figma và giữ nguyên lỗi gốc', async () => {
  const { runClaude } = fake({ ok: false, error: 'Claude lỗi (exit 1): hết phiên' });
  const r = await planFlows({ prdUrl: PRD, figmaUrl: FIG, runClaude });
  assert.equal(r.ok, false);
  assert.match(r.error, /PRD/);
  assert.match(r.error, /Figma/);
  assert.match(r.error, /hết phiên/);
});

test('planFlows: không có luồng nào → báo lỗi, không báo đạt', async () => {
  const { runClaude } = fake({ ok: true, data: { flows: [] } });
  assert.deepEqual(await planFlows({ prdUrl: PRD, figmaUrl: FIG, runClaude }), { ok: false, error: 'Không rút được luồng chính từ PRD' });
});

test('planFlows: AI báo vấn đề đọc nguồn (problem) → đưa vào lỗi', async () => {
  const { runClaude } = fake({ ok: true, data: { flows: [], problem: 'không có quyền đọc PRD' } });
  const r = await planFlows({ prdUrl: PRD, figmaUrl: FIG, runClaude });
  assert.equal(r.ok, false);
  assert.match(r.error, /không có quyền đọc PRD/);
});

test('planFlows: link Figma không có node-id hoặc không hợp lệ → lỗi, KHÔNG gọi runClaude', async () => {
  for (const figmaUrl of ['https://www.figma.com/design/SrFaXD304rwjPXcNRqXzh0/Moss', 'https://example.com/x']) {
    const { calls, runClaude } = fake({ ok: true, data: { flows: [flow(1)] } });
    const r = await planFlows({ prdUrl: PRD, figmaUrl, runClaude });
    assert.equal(r.ok, false);
    assert.match(r.error, /Figma/);
    assert.equal(calls.length, 0);
  }
});

test('planFlows: không có PRD → chỉ bật công cụ Figma, prompt nói rõ chỉ dựa vào Figma, vẫn ra luồng', async () => {
  for (const prdUrl of ['', undefined]) {
    const { calls, runClaude } = fake({ ok: true, data: { flows: [{ ...flow(1), prdQuote: '' }] } });
    const r = await planFlows({ prdUrl, figmaUrl: FIG, runClaude });
    assert.equal(r.ok, true);
    assert.ok(!calls[0].allowedTools.some((t) => t.includes('begamob')));
    assert.ok(calls[0].allowedTools.includes('mcp__figma__get_metadata'));
    assert.match(calls[0].prompt, /không có PRD/i);
    assert.doesNotMatch(calls[0].prompt, /developers\.begamob/);
  }
});

test('planFlows: không có PRD → lời lỗi chỉ nhắc Figma, không nhắc PRD', async () => {
  const none = fake({ ok: true, data: { flows: [] } });
  const a = await planFlows({ figmaUrl: FIG, runClaude: none.runClaude });
  assert.match(a.error, /Figma/);
  assert.doesNotMatch(a.error, /PRD/);
  const bad = fake({ ok: false, error: 'hết phiên' });
  const b = await planFlows({ figmaUrl: FIG, runClaude: bad.runClaude });
  assert.match(b.error, /Figma/);
  assert.doesNotMatch(b.error, /PRD/);
});

test('planFlows: chỉ có PRD (không Figma) → chỉ bật công cụ PRD, prompt nói rõ không có Figma', async () => {
  const { calls, runClaude } = fake({ ok: true, data: { flows: [{ ...flow(1), frames: [] }] } });
  const r = await planFlows({ prdUrl: PRD, figmaUrl: '', runClaude });
  assert.equal(r.ok, true);
  assert.deepEqual(calls[0].allowedTools, ['mcp__begamob__project_doc_get_by_url']);
  assert.match(calls[0].prompt, new RegExp(PRD));
  assert.match(calls[0].prompt, /không có Figma/i);
});

test('planFlows: chỉ có PRD → lời lỗi chỉ nhắc PRD, không nhắc Figma', async () => {
  const none = fake({ ok: true, data: { flows: [] } });
  const a = await planFlows({ prdUrl: PRD, runClaude: none.runClaude });
  assert.match(a.error, /PRD/);
  assert.doesNotMatch(a.error, /Figma/);
  const bad = fake({ ok: false, error: 'hết phiên' });
  const b = await planFlows({ prdUrl: PRD, runClaude: bad.runClaude });
  assert.match(b.error, /PRD/);
  assert.doesNotMatch(b.error, /Figma/);
});

test('planFlows: không có link nào → lỗi, KHÔNG gọi runClaude', async () => {
  const { calls, runClaude } = fake({ ok: true, data: { flows: [flow(1)] } });
  const r = await planFlows({ runClaude });
  assert.equal(r.ok, false);
  assert.match(r.error, /PRD.*Figma/);
  assert.equal(calls.length, 0);
});

test('planFlows: KHÔNG dùng chế độ lean (cần MCP đọc PRD / Figma)', async () => {
  const { calls, runClaude } = fake({ ok: true, data: { flows: [flow(1)] } });
  await planFlows({ prdUrl: PRD, figmaUrl: FIG, runClaude });
  assert.ok(!calls[0].lean);
  assert.ok(!calls[0].noTools);
});

test('planFlows: chuyển onUsage cho runClaude', async () => {
  const { calls, runClaude } = fake({ ok: true, data: { flows: [flow(1)] } });
  const onUsage = () => {};
  await planFlows({ prdUrl: PRD, figmaUrl: FIG, runClaude, onUsage });
  assert.equal(calls[0].onUsage, onUsage);
});

test('planFlows: lỗi đọc nguồn có hướng dẫn đăng nhập lại MCP bằng /mcp', async () => {
  const { runClaude } = fake({ ok: false, error: 'hết phiên' });
  const r = await planFlows({ prdUrl: PRD, figmaUrl: FIG, runClaude });
  assert.match(r.error, /\/mcp/);
});

test('planFlows: có cả hai link mà một nguồn không đọc được (sources.failed) → lỗi nêu đúng nguồn, kèm /mcp', async () => {
  const a = await planFlows({ prdUrl: PRD, figmaUrl: FIG, runClaude: fake({ ok: true, data: { flows: [flow(1)], sources: { prd: 'failed', figma: 'read' } } }).runClaude });
  assert.equal(a.ok, false);
  assert.match(a.error, /PRD/);
  assert.match(a.error, /\/mcp/);
  const b = await planFlows({ prdUrl: PRD, figmaUrl: FIG, runClaude: fake({ ok: true, data: { flows: [flow(1)], sources: { prd: 'read', figma: 'failed' } } }).runClaude });
  assert.equal(b.ok, false);
  assert.match(b.error, /Figma/);
});

test('planFlows: sources đều read (hoặc không có) → ra luồng bình thường', async () => {
  const a = await planFlows({ prdUrl: PRD, figmaUrl: FIG, runClaude: fake({ ok: true, data: { flows: [flow(1)], sources: { prd: 'read', figma: 'read' } } }).runClaude });
  assert.equal(a.ok, true);
  const b = await planFlows({ prdUrl: PRD, figmaUrl: FIG, runClaude: fake({ ok: true, data: { flows: [flow(1)] } }).runClaude });
  assert.equal(b.ok, true);
});

test('planFlows: chuyển signal cho runClaude (bấm Dừng huỷ được lần rút luồng)', async () => {
  const { calls, runClaude } = fake({ ok: true, data: { flows: [flow(1)] } });
  const signal = new AbortController().signal;
  await planFlows({ prdUrl: PRD, figmaUrl: FIG, runClaude, signal });
  assert.equal(calls[0].signal, signal);
});

test('planFlows: lỗi do vượt giới hạn gọi Figma MCP → KHÔNG gợi ý đăng nhập lại, nói rõ là giới hạn', async () => {
  const problem = 'get_metadata bị từ chối do vượt giới hạn số lần gọi Figma MCP của gói Starter';
  const a = await planFlows({ prdUrl: PRD, figmaUrl: FIG, runClaude: fake({ ok: true, data: { flows: [flow(1)], sources: { prd: 'read', figma: 'failed' }, problem } }).runClaude });
  assert.equal(a.ok, false);
  assert.match(a.error, /giới hạn/);
  assert.doesNotMatch(a.error, /chưa đăng nhập/);
  assert.match(a.error, /chỉ PRD|bỏ link Figma/i);
  const b = await planFlows({ prdUrl: PRD, figmaUrl: FIG, runClaude: fake({ ok: false, error: 'rate limit exceeded' }).runClaude });
  assert.doesNotMatch(b.error, /chưa đăng nhập/);
});

test('planFlows: lỗi thường vẫn gợi ý /mcp đăng nhập lại', async () => {
  const r = await planFlows({ prdUrl: PRD, figmaUrl: FIG, runClaude: fake({ ok: false, error: 'hết phiên' }).runClaude });
  assert.match(r.error, /\/mcp/);
});

const SUMMARY = '- [1:2] Action - Blood Sugar No data (screen): Blood Sugar | Log Now\n- [1:3] Blood Sugar - Log (screen): Save';

test('planFlows: Figma từ file .json (figmaSummary) → KHÔNG dùng công cụ Figma MCP; chỉ Figma → không dùng công cụ nào (noTools)', async () => {
  const { calls, runClaude } = fake({ ok: true, data: { flows: [flow(1)] } });
  const r = await planFlows({ figmaSummary: SUMMARY, runClaude });
  assert.equal(r.ok, true);
  assert.equal(calls[0].noTools, true);
  assert.match(calls[0].prompt, /\[1:2\] Action - Blood Sugar No data/);
  assert.match(calls[0].prompt, /file Figma .json|không có công cụ đọc Figma/i);
  assert.doesNotMatch(calls[0].prompt, /create_session|get_metadata/);
});

test('planFlows: PRD + Figma .json → chỉ bật công cụ PRD; file .json thắng link Figma (link không cần hợp lệ)', async () => {
  const { calls, runClaude } = fake({ ok: true, data: { flows: [flow(1)], sources: { prd: 'read', figma: 'read' } } });
  const r = await planFlows({ prdUrl: PRD, figmaUrl: 'https://example.com/khong-hop-le', figmaSummary: SUMMARY, runClaude });
  assert.equal(r.ok, true);
  assert.deepEqual(calls[0].allowedTools, ['mcp__begamob__project_doc_get_by_url']);
  assert.ok(!calls[0].noTools);
});

test('planFlows: chỉ Figma .json mà không ra luồng → lỗi nhắc Figma (không nhắc PRD)', async () => {
  const r = await planFlows({ figmaSummary: SUMMARY, runClaude: fake({ ok: true, data: { flows: [] } }).runClaude });
  assert.equal(r.ok, false);
  assert.match(r.error, /Figma/);
  assert.doesNotMatch(r.error, /PRD/);
});

test('planFlows: link PRD không hợp lệ → lỗi ngay, KHÔNG gọi runClaude', async () => {
  const { calls, runClaude } = fake({ ok: true, data: { flows: [flow(1)] } });
  const r = await planFlows({ prdUrl: 'ghi chú dán nhầm', figmaSummary: '- [1:2] A (screen): x', runClaude });
  assert.equal(r.ok, false);
  assert.match(r.error, /Link PRD/);
  assert.equal(calls.length, 0);
});

test('planFlows: depth "full" → prompt thêm luồng sâu (validation, đơn vị, ranh giới, chặn tap liên tục, empty state) và cho tới 16 luồng; mặc định vẫn smoke 8', async () => {
  const many = { ok: true, data: { sources: { prd: 'read' }, flows: Array.from({ length: 20 }, (_, i) => flow(i)) } };
  const a = fake(many);
  const full = await planFlows({ prdUrl: PRD, runClaude: a.runClaude, depth: 'full' });
  assert.equal(full.flows.length, 16);
  assert.match(a.calls[0].prompt, /ranh giới/);
  assert.match(a.calls[0].prompt, /chặn tap liên tục|bấm liên tục/);
  assert.match(a.calls[0].prompt, /tối đa 16 luồng/);
  const b = fake(many);
  const smoke = await planFlows({ prdUrl: PRD, runClaude: b.runClaude });
  assert.equal(smoke.flows.length, 8);
  assert.doesNotMatch(b.calls[0].prompt, /ranh giới/);
});

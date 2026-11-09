// Pha (b) của chuyển đổi: viết dòng Keyword cho một nhóm case (một lần gọi AI / nhóm) rồi ghép các nhóm thành plan.json.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rulesFrom } from './rules.js';
import { ROW_SCHEMA } from './skeleton.js';

const PROMPT = fileURLToPath(new URL('../../ai/prompts/convert-rows.md', import.meta.url));
const SCHEMA = {
  type: 'object',
  properties: { testcases: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, fresh: { type: 'boolean' }, pre: { type: 'array', items: { type: 'string' } }, rows: { type: 'array', items: ROW_SCHEMA } }, required: ['id', 'rows'] } } },
  required: ['testcases'],
};

// System prompt cố định giữa các nhóm (được cache): hướng dẫn + quy tắc viết dòng + bảng keyword của SKILL.md
const systemPrompt = (appText = '') => `${fs.readFileSync(PROMPT, 'utf8')}\n${rulesFrom('Write each TC as v2 rows')}\n\n${rulesFrom('Reference')}${appText}`;

// → { ok: true, testcases: PlanTc[] } | { ok: false, error }   (PlanTc = { id, fresh, pre: string[], rows, platform? })
export async function writeGroup({ skeleton, group, cases, runClaude, signal, feedback, appText = '' }) {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const flat = skeleton.order.map((o) => o.id);
  const prevId = flat[flat.indexOf(group[0]) - 1];
  const message = {
    group,
    fresh: Object.fromEntries(skeleton.order.filter((o) => group.includes(o.id)).map((o) => [o.id, o.fresh])),
    flows: Object.keys(skeleton.flows || {}),
    previousCase: prevId ? { id: prevId, scenario: byId.get(prevId)?.scenario } : null,
    cases: group.map((id) => { const c = byId.get(id) || {}; return { id, scenario: c.scenario, description: c.description, pre: c.pre, steps: c.steps, expected: c.expected, platform: c.platform, ...(c.clarification ? { clarification: c.clarification } : {}) }; }),
  };
  const prompt = JSON.stringify(message, null, 1) + (feedback ? `\n\nfeedback (lỗi lần trước, sửa đúng các case này):\n${feedback}` : '');
  const r = await runClaude({ system: systemPrompt(appText), prompt, schema: SCHEMA, noTools: true, timeoutMs: 600000, signal });
  if (!r.ok) return { ok: false, error: `Viết dòng Keyword lỗi: ${r.error}` };
  const got = new Map((r.data?.testcases || []).filter((t) => group.includes(t.id)).map((t) => [t.id, t]));
  const missing = group.filter((id) => !got.has(id));
  if (missing.length) return { ok: false, error: `Thiếu ${missing.join(', ')} trong kết quả của AI` };
  const fresh = new Map(skeleton.order.map((o) => [o.id, o.fresh]));
  return {
    ok: true,
    testcases: group.map((id) => {
      const t = got.get(id);
      return { id, fresh: fresh.get(id) ?? false, pre: Array.isArray(t.pre) ? t.pre : t.pre ? [String(t.pre)] : [], rows: t.rows || [], ...(byId.get(id)?.platform && byId.get(id).platform !== 'All' ? { platform: byId.get(id).platform } : {}) };
    }),
  };
}

// Ghép kết quả các nhóm theo thứ tự khung; fresh lấy từ khung (AI không được đổi)
export function mergePlan({ skeleton, groupResults, manual }) {
  const all = new Map(groupResults.flat().map((t) => [t.id, t]));
  const testcases = skeleton.order.filter((o) => all.has(o.id)).map((o) => ({ ...all.get(o.id), fresh: o.fresh }));
  return { testcases, flows: skeleton.flows || {}, testdata: [], manual: manual || [] };
}

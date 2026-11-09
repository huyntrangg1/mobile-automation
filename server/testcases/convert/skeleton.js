// Pha (a) của chuyển đổi: MỘT lần gọi AI cho cả sheet — thứ tự chạy, fresh, nhóm chạy (≤ 10 case), flows dùng chung.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rulesFrom } from './rules.js';
import { lightModel } from './models.js';

const PROMPT = fileURLToPath(new URL('../../ai/prompts/convert-skeleton.md', import.meta.url));
export const ROW_SCHEMA = { type: 'object', properties: { step: { type: 'number' }, screen: { type: 'string' }, kind: { type: 'string' }, keyword: { type: 'string' }, target: { type: 'string' }, value: { type: 'string' }, compare: { type: 'string' }, label: { type: 'string' } }, required: ['step', 'screen', 'kind', 'keyword'] };
const SCHEMA = {
  type: 'object',
  properties: {
    order: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, fresh: { type: 'boolean' } }, required: ['id', 'fresh'] } },
    groups: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
    flows: { type: 'object', additionalProperties: { type: 'array', items: ROW_SCHEMA } },
  },
  required: ['order', 'groups'],
};

// Chuẩn hoá nhóm AI đề xuất: bỏ id lạ / trùng (giữ lần đầu), thêm id thiếu vào nhóm cuối, chia nhóm > max
export function splitGroups(order, groups, max = 10) {
  const known = new Set(order.map((o) => o.id));
  const seen = new Set();
  const clean = groups.map((g) => g.filter((id) => known.has(id) && !seen.has(id) && seen.add(id))).filter((g) => g.length);
  const missing = order.map((o) => o.id).filter((id) => !seen.has(id));
  if (missing.length) clean.length ? clean[clean.length - 1].push(...missing) : clean.push(missing);
  return clean.flatMap((g) => Array.from({ length: Math.ceil(g.length / max) }, (_, i) => g.slice(i * max, (i + 1) * max)));
}

export async function buildSkeleton({ sheet, cases, runClaude, signal, feedback, appText = '' }) {
  const system = `${fs.readFileSync(PROMPT, 'utf8')}\n${rulesFrom('Order the TCs into runs')}${appText}`;
  const list = cases.map((c) => ({ id: c.id, module: c.module, scenario: c.scenario, pre: c.pre, steps: c.steps, ...(c.clarification ? { clarification: c.clarification } : {}) }));
  const r = await runClaude({ system, prompt: `Sheet: ${sheet}\nCác case:\n${JSON.stringify(list, null, 1)}${feedback ? `\n\nfeedback (lỗi ở luồng dùng chung lần trước, sửa đúng các dòng này):\n${feedback}` : ''}`, schema: SCHEMA, noTools: true, timeoutMs: 300000, model: lightModel(), signal });
  if (!r.ok) return { ok: false, error: `Lập khung sheet "${sheet}" lỗi: ${r.error}` };
  if (!Array.isArray(r.data?.order) || !Array.isArray(r.data?.groups)) return { ok: false, error: `Lập khung sheet "${sheet}": AI trả thiếu order / groups` };
  const known = new Set(cases.map((c) => c.id));
  const seen = new Set();
  const order = r.data.order.filter((o) => known.has(o.id) && !seen.has(o.id) && seen.add(o.id)).map((o) => ({ id: o.id, fresh: Boolean(o.fresh) }));
  for (const c of cases) if (!seen.has(c.id)) order.push({ id: c.id, fresh: false });
  if (order.length) order[0].fresh = true; // case đầu sheet luôn cài lại app
  const groups = splitGroups(order, r.data.groups);
  // Mỗi nhóm là một lần chạy trên một lần cài app: case đầu nhóm luôn fresh (write.mjs từ chối chuỗi nối tiếp quá 10 TC)
  const lead = new Set(groups.map((g) => g[0]));
  for (const o of order) if (lead.has(o.id)) o.fresh = true;
  return { ok: true, skeleton: { order, groups, flows: r.data.flows || {} } };
}

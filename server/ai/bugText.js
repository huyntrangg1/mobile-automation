// Viết lại nội dung bug (Title / Precondition / Steps / Actual / Expected) theo skill test-report: reference.md → mục
// "### Cách viết bug". Report gửi bản nháp mẫu câu + dữ kiện gốc (facts); form Log Asana hiện kết quả để tester review.
import fs from 'node:fs';
import path from 'node:path';
import { runClaude as defaultRunClaude } from './claude.js';
import { TEST_REPORT_SKILL } from '../paths.js';

export const GUIDE_FILE = path.join(TEST_REPORT_SKILL, 'reference.md');
const MAX_BUGS = 20;

// Mục "### Cách viết bug" (tới heading ## / ### kế tiếp); không có → null
export function guideOf(md) {
  const m = String(md).match(/^### Cách viết bug\s*$([\s\S]*?)(?=^#{2,3} )/m);
  return m ? m[1].trim() : null;
}

const SCHEMA = {
  type: 'object',
  properties: {
    bugs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          pre: { type: 'array', items: { type: 'string' } },
          steps: { type: 'array', items: { type: 'string' } },
          actual: { type: 'string' },
          expected: { type: 'string' },
        },
        required: ['id', 'title', 'pre', 'steps', 'actual', 'expected'],
      },
    },
  },
  required: ['bugs'],
};

const str = (v) => (typeof v === 'string' ? v : '');
const lines = (v) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : []);
// Bỏ số thứ tự AI lỡ thêm ("1. Nhấn …") — Asana tự đánh số
const unnumber = (s) => s.replace(/^\d+[.)]\s+/, '');

// bugs: [{ id, draft: { title, pre[], steps[], actual, expected }, facts }] → { ok, bugs: [...] } | { ok: false, error, status }
export async function writeBugs(bugs, { runClaude = defaultRunClaude, guideFile = GUIDE_FILE, model } = {}) {
  if (!Array.isArray(bugs) || !bugs.length) return { ok: false, status: 400, error: 'Không có bug nào' };
  if (bugs.length > MAX_BUGS) return { ok: false, status: 400, error: `Tối đa ${MAX_BUGS} bug mỗi lần` };
  const input = bugs.filter((b) => b && b.id && b.draft && b.facts);
  if (!input.length) return { ok: false, status: 400, error: 'Bug thiếu dữ kiện (report cũ — build lại report)' };
  let guide;
  try { guide = guideOf(fs.readFileSync(guideFile, 'utf8')); } catch { guide = null; }
  if (!guide) return { ok: false, status: 500, error: 'Không đọc được mục "Cách viết bug" trong reference.md của skill test-report' };
  const prompt = `Viết lại ${input.length} bug dưới đây theo hướng dẫn. Trả về đủ ${input.length} bug, giữ nguyên id.\n\n${JSON.stringify(input.map(({ id, draft, facts }) => ({ id, draft, facts })), null, 1)}`;
  const r = await runClaude({ prompt, schema: SCHEMA, system: guide, noTools: true, timeoutMs: 140000, model });
  if (!r.ok) return { ok: false, status: 502, error: r.error };
  const byId = new Map((r.data?.bugs || []).map((b) => [String(b.id), b]));
  const out = [];
  for (const b of input) {
    const a = byId.get(String(b.id));
    if (!a) continue;
    const x = { id: b.id, title: str(a.title).trim(), pre: lines(a.pre), steps: lines(a.steps).map(unnumber), actual: str(a.actual).trim(), expected: str(a.expected).trim() };
    // Thiếu field bắt buộc → bỏ bug đó (form giữ mẫu câu)
    if (x.title && x.steps.length && x.actual && x.expected) out.push(x);
  }
  if (!out.length) return { ok: false, status: 502, error: 'AI trả về nội dung không dùng được' };
  return { ok: true, bugs: out };
}

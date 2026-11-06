// Rút danh sách luồng chính từ PRD (begamob) và / hoặc Figma — cần ít nhất một trong hai.
// AI đọc trực tiếp từ link qua MCP; code chỉ nhận JSON có cấu trúc.
import fs from 'node:fs';
import { runClaude as defaultRunClaude } from '../ai/claude.js';
import { parseFigmaUrl } from './figmaUrl.js';
import { checkPrdUrl } from './prdUrl.js';

const PROMPT = fs.readFileSync(new URL('../ai/prompts/smoke-plan.md', import.meta.url), 'utf8');
// Tên công cụ của kết nối MCP thường `begamob` và `figma` (đăng nhập bằng /mcp). `claude -p` KHÔNG nạp công cụ của connector claude.ai.
export const PRD_TOOL = 'mcp__begamob__project_doc_get_by_url';
export const FIGMA_SESSION_TOOL = 'mcp__figma__create_session';
export const FIGMA_TOOL = 'mcp__figma__get_metadata';
const SOURCE = { type: 'string', enum: ['read', 'failed', 'none'] };
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    problem: { type: 'string' },
    sources: { type: 'object', properties: { prd: SOURCE, figma: SOURCE } },
    flows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          goal: { type: 'string' },
          prdQuote: { type: 'string' },
          expected: { type: 'array', items: { type: 'string' } },
          frames: { type: 'array', items: { type: 'object', properties: { nodeId: { type: 'string' }, name: { type: 'string' } }, required: ['nodeId', 'name'] } },
          unclear: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'name', 'goal', 'prdQuote', 'expected', 'frames', 'unclear'],
      },
    },
  },
  required: ['flows'],
};
const MODEL = process.env.QAPD_SMOKE_MODEL || process.env.QAPD_EXPLORE_MODEL || 'claude-sonnet-5-5';
const DEPTH_FULL = fs.readFileSync(new URL('../ai/prompts/smoke-plan-full.md', import.meta.url), 'utf8');
const fill = (tpl, v) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(v[k] ?? ''));
const prdSection = (url) => (url
  ? `- PRD (tài liệu begamob): ${url} — đọc bằng công cụ project_doc_get_by_url. Tài liệu dài: đọc mục lục trước, rồi đọc từng mục bằng tham số \`section\` (và \`offset\` nếu cần). KHÔNG kéo cả tài liệu một lần.`
  : '- Không có PRD: dựa vào Figma và thông lệ app mobile để suy ra luồng.');
const jsonSection = (summary) => `- Figma (từ file .json do plugin xuất; không có công cụ đọc Figma, CHỈ dùng danh sách frame dưới đây — mỗi dòng: [id] tên (loại): chữ RIÊNG của frame · chuyển cảnh prototype; dòng đầu trong ngoặc, nếu có, là chữ chung của hầu hết các màn). Trong "frames" dùng đúng id và tên như trong danh sách:\n${summary}`;
const figmaSection = (fig) => (fig
  ? `- Figma: file ${fig.fileKey}, node ${fig.nodeId} — gọi create_session trước (fileKey này, mô tả "smoke test: liệt kê frame màn hình"), rồi truyền sessionId vào get_metadata. Gọi get_metadata đúng một lần ở node này CHỈ để liệt kê frame cấp màn hình (tên + id). Node này có thể rất lớn: KHÔNG gọi get_design_context cho cả node, KHÔNG liệt kê frame con bên trong màn hình.`
  : '- Không có Figma: chỉ dựa vào PRD; "frames" để mảng rỗng.');

export const FULL_MAX_FLOWS = 16;
export async function planFlows({ prdUrl = '', figmaUrl = '', figmaSummary = '', notes = '', runClaude = defaultRunClaude, model = MODEL, depth = 'smoke', maxFlows = depth === 'full' ? FULL_MAX_FLOWS : 8, onUsage, signal }) {
  const prdCheck = checkPrdUrl(prdUrl);
  if (!prdCheck.ok) return { ok: false, error: prdCheck.error };
  const prd = prdCheck.url;
  const summary = String(figmaSummary || '').trim();
  const figUrl = summary ? '' : String(figmaUrl || '').trim(); // file .json thắng link Figma (không tốn lần gọi Figma MCP)
  if (!prd && !figUrl && !summary) return { ok: false, error: 'Cần ít nhất một: link PRD, link Figma hoặc file Figma .json' };
  let fig = null;
  if (figUrl) {
    fig = parseFigmaUrl(figUrl);
    if (!fig) return { ok: false, error: 'Link Figma không hợp lệ (cần dạng figma.com/design/…)' };
    if (!fig.nodeId) return { ok: false, error: 'Link Figma thiếu node-id: mở section cần test trong Figma, chọn nó rồi copy link' };
  }
  const hasFigma = !!(fig || summary);
  const label = prd && hasFigma ? 'PRD hoặc Figma' : prd ? 'PRD' : 'Figma';
  const login = `Nếu do chưa đăng nhập: trong Claude Code gõ /mcp rồi đăng nhập lại ${[prd && 'begamob', fig && 'figma'].filter(Boolean).join(' và ')}.`;
  // Vượt giới hạn gọi (vd Figma MCP gói Starter) là lỗi khác với chưa đăng nhập: đừng gợi ý sai
  const limitHint = `Đây là giới hạn số lần gọi của dịch vụ, không phải lỗi đăng nhập. Chờ tới kỳ reset, đổi sang gói cao hơn, hoặc chạy chỉ PRD (bỏ link Figma).`;
  const hintFor = (text) => (/giới hạn|rate.?limit|quota|too many/i.test(String(text || '')) ? limitHint : login);
  const prompt = fill(PROMPT, { prdSection: prdSection(prd), figmaSection: summary ? jsonSection(summary) : figmaSection(fig), notes: notes || 'không có', maxFlows, depthSection: depth === 'full' ? DEPTH_FULL : '' });
  const allowedTools = [...(prd ? [PRD_TOOL] : []), ...(fig ? [FIGMA_SESSION_TOOL, FIGMA_TOOL] : [])];
  // Chỉ có file .json: không cần công cụ nào → chế độ không công cụ (gọn, rẻ)
  const c = await runClaude(allowedTools.length
    ? { prompt, schema: PLAN_SCHEMA, allowedTools, timeoutMs: 300000, model, onUsage, signal }
    : { prompt, schema: PLAN_SCHEMA, noTools: true, timeoutMs: 300000, model, onUsage, signal });
  if (!c.ok) return { ok: false, cancelled: c.cancelled, error: `Không đọc được ${label}: ${c.error}. ${hintFor(c.error)}` };
  // Nguồn người dùng đã đưa mà AI báo không đọc được → lỗi rõ, không chạy tiếp lặng lẽ bằng nguồn còn lại
  const failed = [prd && c.data?.sources?.prd === 'failed' && 'PRD', fig && c.data?.sources?.figma === 'failed' && 'Figma'].filter(Boolean);
  if (failed.length) return { ok: false, error: `Không đọc được ${failed.join(' và ')}: ${c.data.problem || 'AI báo không đọc được nguồn này'}. ${hintFor(c.data.problem)}` };
  const flows = (c.data?.flows || []).slice(0, maxFlows);
  const noun = prd ? 'PRD' : 'Figma';
  if (!flows.length) return { ok: false, error: c.data?.problem ? `Không rút được luồng chính từ ${noun}: ${c.data.problem}. ${hintFor(c.data.problem)}` : `Không rút được luồng chính từ ${noun}` };
  return { ok: true, flows };
}

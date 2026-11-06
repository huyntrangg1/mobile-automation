// Lấy ảnh PNG của một frame Figma về đĩa: AI (Figma MCP) trả URL ảnh ngắn hạn, tool tải về. Không ném lỗi.
import fs from 'node:fs';
import path from 'node:path';
import { runClaude as defaultRunClaude } from '../ai/claude.js';
import { FIGMA_SESSION_TOOL } from './plan.js';

const SCREENSHOT_TOOL = 'mcp__figma__get_screenshot';
const SCHEMA = { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] };
const MODEL = process.env.QAPD_SMOKE_IMAGE_MODEL || 'claude-haiku-5-5';
const prompt = (fileKey, nodeId) => `Lấy ảnh một frame Figma. Gọi create_session với fileKey "${fileKey}" (mô tả "smoke test: lấy ảnh frame"), rồi gọi get_screenshot với fileKey "${fileKey}", nodeId "${nodeId}", maxDimension 1400, sessionId vừa nhận. Trả JSON {"url": "<đường dẫn ảnh trong kết quả get_screenshot>"}. Không tải ảnh, không gọi công cụ nào khác.`;

async function defaultDownload(url, outFile) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
}

export async function fetchFrameImage({ fileKey, nodeId, outFile, runClaude = defaultRunClaude, download = defaultDownload, model = MODEL, onUsage, signal }) {
  const c = await runClaude({ prompt: prompt(fileKey, nodeId), schema: SCHEMA, allowedTools: [FIGMA_SESSION_TOOL, SCREENSHOT_TOOL], timeoutMs: 120000, model, onUsage, signal });
  if (!c.ok) return { ok: false, cancelled: c.cancelled, error: `Không lấy được ảnh frame ${nodeId}: ${c.error}` };
  const url = c.data?.url;
  if (!url) return { ok: false, error: `Không lấy được ảnh frame ${nodeId}: Figma không trả URL ảnh` };
  try {
    await download(url, outFile);
  } catch (e) {
    return { ok: false, error: `Không tải được ảnh frame ${nodeId}: ${String(e.message || e)}` };
  }
  return { ok: true, file: outFile };
}

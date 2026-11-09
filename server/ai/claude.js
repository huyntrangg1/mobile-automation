// Gọi Claude Code CLI chạy ngầm (`claude -p`) và nhận JSON theo schema. Không bao giờ throw.
// Bản thật: thay bằng Anthropic API key của công ty (xem spec bàn giao).
import { spawn } from 'node:child_process';

const tail = (s, n = 600) => (s.length > n ? `…${s.slice(-n)}` : s).trim();

// Lấy object JSON từ chuỗi kết quả (có thể nằm trong ```json … ```)
function parseLoose(text) {
  if (typeof text !== 'string') return undefined;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  try { return JSON.parse(raw); } catch {}
  const a = raw.indexOf('{');
  const b = raw.lastIndexOf('}');
  if (a >= 0 && b > a) try { return JSON.parse(raw.slice(a, b + 1)); } catch {}
  return undefined;
}

// noTools: không tool, không MCP — chỉ trả lời từ prompt trong 1 lượt (mỗi lần gọi bớt ~40K token định nghĩa tool / MCP).
//   Kèm chế độ gọn: system prompt riêng thay system prompt của Claude Code, không nạp settings / CLAUDE.md / memory / skill
//   của máy (đo được: phần gửi kèm mỗi lần gọi ~5.900 → ~850 token).
// system: phần prompt cố định (giống nhau giữa nhiều lần gọi) → được cache, lần gọi sau đọc lại rẻ hơn ~10 lần
// model: bỏ trống = QAPD_AI_MODEL (nếu có) hoặc model mặc định của Claude Code
// signal: AbortSignal — tester bấm dừng → kill claude, trả { ok: false, cancelled: true }
const LEAN_SYSTEM = 'Bạn là trợ lý tự động hoá kiểm thử. Làm đúng yêu cầu trong tin nhắn, trả lời bằng JSON theo schema.';
// lean: giữ đúng các công cụ trong allowedTools (vd chỉ Read để xem ảnh) nhưng tắt MCP, dùng system prompt gọn, không nạp settings / skill.
//   Dùng cho vòng lặp nhiều lần gọi liên tiếp (AI Smoke Test): đo thật một lần gọi mặc định nạp ~33.000 token định nghĩa công cụ / MCP.
//   KHÔNG dùng khi cần công cụ MCP (đọc PRD / Figma) — lean tắt hết MCP.
export function runClaude({ prompt, schema, cwd, timeoutMs = 180000, allowedTools = ['Read'], noTools = false, lean = false, noPersist = false, onUsage, system, model = process.env.QAPD_AI_MODEL, signal, spawnImpl = spawn, killGraceMs = 5000 }) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    let proc;
    let exited = false;
    let onAbort = null;
    // Gỡ listener abort khi xong: signal dùng chung cho cả lần chạy (smoke / khám phá gọi AI hàng trăm lần) → không rò listener
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); if (onAbort) signal?.removeEventListener?.('abort', onAbort); resolve(r); } };
    // SIGTERM rồi SIGKILL nếu claude không thoát sau killGraceMs (treo khi đang gọi tool / MCP)
    const kill = () => {
      try { proc?.kill('SIGTERM'); } catch {}
      const t = setTimeout(() => { if (!exited) { try { proc?.kill('SIGKILL'); } catch {} } }, killGraceMs);
      t.unref?.();
    };
    const args = ['-p', '--output-format', 'json'];
    if (schema) args.push('--json-schema', JSON.stringify(schema));
    if (noTools) args.push('--tools', '', '--strict-mcp-config', '--system-prompt', system || LEAN_SYSTEM, '--setting-sources', '', '--disable-slash-commands');
    else if (lean && allowedTools?.length) args.push('--tools', allowedTools.join(','), '--allowedTools', allowedTools.join(','), '--strict-mcp-config', '--system-prompt', system || LEAN_SYSTEM, '--setting-sources', '', '--disable-slash-commands');
    else if (allowedTools?.length) args.push('--allowedTools', allowedTools.join(','));
    if (noPersist) args.push('--no-session-persistence'); // không lưu transcript lên đĩa (vd prompt có mật khẩu tài khoản test)
    if (model) args.push('--model', model);
    try {
      proc = spawnImpl('claude', args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return finish({ ok: false, error: `Không chạy được claude: ${e.message}` });
    }
    let out = '';
    let err = '';
    timer = setTimeout(() => {
      kill();
      finish({ ok: false, error: `Claude quá thời gian (${Math.round(timeoutMs / 1000)}s)` });
    }, timeoutMs);
    const abort = () => { kill(); finish({ ok: false, cancelled: true, error: 'Đã dừng gen' }); };
    if (signal?.aborted) return abort();
    onAbort = abort;
    signal?.addEventListener('abort', abort, { once: true });
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', (e) => finish({ ok: false, error: `Không chạy được claude: ${e.message}` }));
    proc.on('close', (code) => {
      exited = true;
      if (code !== 0) return finish({ ok: false, error: `Claude lỗi (exit ${code}): ${tail(err || out) || 'không có thông báo'}` });
      let res;
      try { res = JSON.parse(out); } catch {
        return finish({ ok: false, error: `Claude trả về nội dung không đọc được: ${tail(out, 200)}` });
      }
      try { onUsage?.({ usage: res.usage || {}, cost: res.total_cost_usd || 0 }); } catch {} // đo token / chi phí thật của lần gọi
      if (res.is_error) return finish({ ok: false, error: `Claude báo lỗi: ${tail(String(res.result || res.subtype || ''))}` });
      const data = res.structured_output ?? parseLoose(res.result);
      if (data === undefined) return finish({ ok: false, error: `Claude trả về nội dung không đọc được: ${tail(String(res.result || ''), 200)}` });
      finish({ ok: true, data });
    });
    proc.stdin.on?.('error', () => {}); // claude thoát trước khi đọc hết prompt (EPIPE) → lỗi báo qua "close"
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

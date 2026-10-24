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

export function runClaude({ prompt, schema, cwd, timeoutMs = 180000, allowedTools = ['Read'], model, spawnImpl = spawn }) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const args = ['-p', '--output-format', 'json'];
    if (schema) args.push('--json-schema', JSON.stringify(schema));
    if (allowedTools?.length) args.push('--allowedTools', allowedTools.join(','));
    if (model) args.push('--model', model);
    let proc;
    try {
      proc = spawnImpl('claude', args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return finish({ ok: false, error: `Không chạy được claude: ${e.message}` });
    }
    let out = '';
    let err = '';
    timer = setTimeout(() => {
      proc.kill('SIGTERM');
      finish({ ok: false, error: `Claude quá thời gian (${Math.round(timeoutMs / 1000)}s)` });
    }, timeoutMs);
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', (e) => finish({ ok: false, error: `Không chạy được claude: ${e.message}` }));
    proc.on('close', (code) => {
      if (code !== 0) return finish({ ok: false, error: `Claude lỗi (exit ${code}): ${tail(err || out) || 'không có thông báo'}` });
      let res;
      try { res = JSON.parse(out); } catch {
        return finish({ ok: false, error: `Claude trả về nội dung không đọc được: ${tail(out, 200)}` });
      }
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

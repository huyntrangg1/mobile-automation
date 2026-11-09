import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runClaude } from '../server/ai/claude.js';

// Tiến trình giả: phát stdout / stderr rồi exit với code cho trước (hoặc treo nếu hang)
function fakeSpawn({ stdout = '', stderr = '', code = 0, hang = false }) {
  const calls = [];
  const impl = (cmd, args, opts) => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    p.stdin = { write: (s) => calls.push({ stdin: s }), end: () => {} };
    p.killed = false;
    p.kill = () => { p.killed = true; setImmediate(() => p.emit('close', null, 'SIGTERM')); };
    calls.push({ cmd, args, opts, proc: p });
    if (!hang) setImmediate(() => {
      if (stdout) p.stdout.emit('data', Buffer.from(stdout));
      if (stderr) p.stderr.emit('data', Buffer.from(stderr));
      p.emit('close', code);
    });
    return p;
  };
  return { impl, calls };
}

const schema = { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] };

test('stdout JSON có structured_output → ok + data', async () => {
  const { impl, calls } = fakeSpawn({ stdout: JSON.stringify({ type: 'result', is_error: false, structured_output: { x: 1 } }) });
  const r = await runClaude({ prompt: 'p', schema, spawnImpl: impl });
  assert.deepEqual(r, { ok: true, data: { x: 1 } });
  assert.ok(calls[0].args.includes('-p'));
  assert.ok(calls[0].args.includes('--json-schema'));
});

test('không có structured_output thì parse result là JSON', async () => {
  const { impl } = fakeSpawn({ stdout: JSON.stringify({ type: 'result', result: '```json\n{"x":2}\n```' }) });
  assert.deepEqual(await runClaude({ prompt: 'p', schema, spawnImpl: impl }), { ok: true, data: { x: 2 } });
});

test('stdout không phải JSON → ok:false, error "không đọc được"', async () => {
  const { impl } = fakeSpawn({ stdout: 'hello' });
  const r = await runClaude({ prompt: 'p', schema, spawnImpl: impl });
  assert.equal(r.ok, false);
  assert.match(r.error, /không đọc được/);
});

test('exit code khác 0 → error chứa stderr', async () => {
  const { impl } = fakeSpawn({ stderr: 'Invalid API key · Please run /login', code: 1 });
  const r = await runClaude({ prompt: 'p', schema, spawnImpl: impl });
  assert.equal(r.ok, false);
  assert.match(r.error, /Please run \/login/);
});

test('is_error trong kết quả → ok:false', async () => {
  const { impl } = fakeSpawn({ stdout: JSON.stringify({ type: 'result', is_error: true, result: 'Credit balance is too low' }) });
  const r = await runClaude({ prompt: 'p', schema, spawnImpl: impl });
  assert.equal(r.ok, false);
  assert.match(r.error, /Credit balance/);
});

test('quá timeoutMs → kill, error "quá thời gian"', async () => {
  const { impl, calls } = fakeSpawn({ hang: true });
  const r = await runClaude({ prompt: 'p', schema, timeoutMs: 30, spawnImpl: impl });
  assert.equal(r.ok, false);
  assert.match(r.error, /quá thời gian/);
  assert.equal(calls[0].proc.killed, true);
});

test('spawn ném lỗi (không có lệnh claude) → ok:false, không throw', async () => {
  const r = await runClaude({ prompt: 'p', schema, spawnImpl: () => { throw new Error('spawn claude ENOENT'); } });
  assert.equal(r.ok, false);
  assert.match(r.error, /ENOENT/);
});

test('noTools: tắt hết tool + MCP (--tools "" --strict-mcp-config), không kèm --allowedTools', async () => {
  const { impl, calls } = fakeSpawn({ stdout: JSON.stringify({ type: 'result', structured_output: { x: 1 } }) });
  await runClaude({ prompt: 'p', schema, noTools: true, spawnImpl: impl });
  const a = calls[0].args;
  assert.equal(a[a.indexOf('--tools') + 1], '');
  assert.ok(a.includes('--strict-mcp-config'));
  assert.ok(!a.includes('--allowedTools'));
});

test('signal abort → kill claude, trả cancelled', async () => {
  const { impl, calls } = fakeSpawn({ hang: true });
  const ctl = new AbortController();
  const p = runClaude({ prompt: 'p', schema, spawnImpl: impl, signal: ctl.signal });
  ctl.abort();
  assert.deepEqual(await p, { ok: false, cancelled: true, error: 'Đã dừng gen' });
  assert.equal(calls[0].proc.killed, true);
});

test('noTools: chế độ gọn — system prompt riêng (hoặc phần cố định truyền vào), không nạp settings / skill', async () => {
  const { impl, calls } = fakeSpawn({ stdout: JSON.stringify({ type: 'result', is_error: false, structured_output: { x: 1 } }) });
  await runClaude({ prompt: 'p', schema, noTools: true, system: 'PHẦN CỐ ĐỊNH', spawnImpl: impl });
  const a = calls[0].args;
  assert.equal(a[a.indexOf('--system-prompt') + 1], 'PHẦN CỐ ĐỊNH');
  assert.equal(a[a.indexOf('--setting-sources') + 1], '');
  assert.ok(a.includes('--disable-slash-commands'));
});

test('lean: giữ đúng các công cụ được phép (--tools + --allowedTools), tắt MCP, system prompt gọn, không nạp settings / skill', async () => {
  const { impl, calls } = fakeSpawn({ stdout: JSON.stringify({ type: 'result', is_error: false, structured_output: { x: 1 } }) });
  await runClaude({ prompt: 'p', schema, lean: true, allowedTools: ['Read'], system: 'GỌN', spawnImpl: impl });
  const a = calls[0].args;
  assert.equal(a[a.indexOf('--tools') + 1], 'Read');
  assert.equal(a[a.indexOf('--allowedTools') + 1], 'Read');
  assert.ok(a.includes('--strict-mcp-config'));
  assert.equal(a[a.indexOf('--system-prompt') + 1], 'GỌN');
  assert.equal(a[a.indexOf('--setting-sources') + 1], '');
  assert.ok(a.includes('--disable-slash-commands'));
});

test('không lean: giữ hành vi cũ (chỉ --allowedTools, không tắt MCP)', async () => {
  const { impl, calls } = fakeSpawn({ stdout: JSON.stringify({ type: 'result', is_error: false, structured_output: { x: 1 } }) });
  await runClaude({ prompt: 'p', schema, allowedTools: ['Read'], spawnImpl: impl });
  const a = calls[0].args;
  assert.ok(!a.includes('--strict-mcp-config'));
  assert.ok(!a.includes('--tools'));
});

test('onUsage: báo usage + chi phí của lần gọi, không đổi kết quả trả về', async () => {
  const usage = { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 7 };
  const { impl } = fakeSpawn({ stdout: JSON.stringify({ type: 'result', is_error: false, structured_output: { x: 1 }, usage, total_cost_usd: 0.12 }) });
  const seen = [];
  const r = await runClaude({ prompt: 'p', schema, spawnImpl: impl, onUsage: (u) => seen.push(u) });
  assert.deepEqual(r, { ok: true, data: { x: 1 } });
  assert.deepEqual(seen, [{ usage, cost: 0.12 }]);
});

test('onUsage: lỗi trong callback không làm hỏng lần gọi', async () => {
  const { impl } = fakeSpawn({ stdout: JSON.stringify({ type: 'result', is_error: false, structured_output: { x: 1 } }) });
  const r = await runClaude({ prompt: 'p', schema, spawnImpl: impl, onUsage: () => { throw new Error('boom'); } });
  assert.equal(r.ok, true);
});

test('noPersist: thêm --no-session-persistence (không lưu transcript, vd có mật khẩu test trong prompt)', async () => {
  const { impl, calls } = fakeSpawn({ stdout: JSON.stringify({ type: 'result', is_error: false, structured_output: { x: 1 } }) });
  await runClaude({ prompt: 'p', schema, noPersist: true, spawnImpl: impl });
  assert.ok(calls[0].args.includes('--no-session-persistence'));
  const b = fakeSpawn({ stdout: JSON.stringify({ type: 'result', is_error: false, structured_output: { x: 1 } }) });
  await runClaude({ prompt: 'p', schema, spawnImpl: b.impl });
  assert.ok(!b.calls[0].args.includes('--no-session-persistence'));
});

test('signal dùng chung nhiều lần gọi: gỡ listener abort khi xong (không rò)', async () => {
  const ctl = new AbortController();
  let added = 0;
  let removed = 0;
  const sig = ctl.signal;
  const add = sig.addEventListener.bind(sig);
  const rem = sig.removeEventListener.bind(sig);
  sig.addEventListener = (...a) => { added++; return add(...a); };
  sig.removeEventListener = (...a) => { removed++; return rem(...a); };
  for (let i = 0; i < 3; i++) {
    const { impl } = fakeSpawn({ stdout: JSON.stringify({ type: 'result', structured_output: { x: i } }) });
    await runClaude({ prompt: 'p', schema, spawnImpl: impl, signal: sig });
  }
  assert.equal(added, 3);
  assert.equal(removed, 3);
});

test('dừng mà claude không thoát sau SIGTERM → SIGKILL sau thời gian chờ', async () => {
  const sigs = [];
  const { EventEmitter: EE } = await import('node:events');
  const impl = () => {
    const p = new EE();
    p.stdout = new EE(); p.stderr = new EE();
    p.stdin = { write: () => {}, end: () => {} };
    p.kill = (s) => { sigs.push(s); if (s === 'SIGKILL') setImmediate(() => p.emit('close', null, 'SIGKILL')); };
    return p;
  };
  const ctl = new AbortController();
  const r = runClaude({ prompt: 'p', schema, spawnImpl: impl, signal: ctl.signal, killGraceMs: 20 });
  ctl.abort();
  assert.equal((await r).cancelled, true);
  await new Promise((res) => setTimeout(res, 60));
  assert.deepEqual(sigs, ['SIGTERM', 'SIGKILL']);
});

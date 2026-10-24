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

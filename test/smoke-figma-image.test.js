import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFrameImage } from '../server/smoke/figmaImage.js';

const base = { fileKey: 'SrFaXD304rwjPXcNRqXzh0', nodeId: '5434:75805', outFile: '/tmp/x/frame.png' };
const setup = (res) => {
  const calls = { claude: [], download: [] };
  return {
    calls,
    runClaude: async (o) => { calls.claude.push(o); return res; },
    download: async (url, file) => { calls.download.push([url, file]); },
  };
};

test('fetchFrameImage: lấy url ảnh từ Figma MCP rồi tải về outFile', async () => {
  const { calls, runClaude, download } = setup({ ok: true, data: { url: 'https://x/y.png' } });
  const r = await fetchFrameImage({ ...base, runClaude, download });
  assert.deepEqual(r, { ok: true, file: '/tmp/x/frame.png' });
  assert.deepEqual(calls.download, [['https://x/y.png', '/tmp/x/frame.png']]);
  assert.deepEqual([...calls.claude[0].allowedTools].sort(), ['mcp__figma__create_session', 'mcp__figma__get_screenshot']);
  assert.match(calls.claude[0].prompt, /SrFaXD304rwjPXcNRqXzh0/);
  assert.match(calls.claude[0].prompt, /5434:75805/);
});

test('fetchFrameImage: runClaude lỗi → { ok:false, error }, không tải', async () => {
  const { calls, runClaude, download } = setup({ ok: false, error: 'hết phiên' });
  const r = await fetchFrameImage({ ...base, runClaude, download });
  assert.equal(r.ok, false);
  assert.match(r.error, /hết phiên/);
  assert.equal(calls.download.length, 0);
});

test('fetchFrameImage: AI không trả url → { ok:false }, không tải', async () => {
  const { calls, runClaude, download } = setup({ ok: true, data: {} });
  const r = await fetchFrameImage({ ...base, runClaude, download });
  assert.equal(r.ok, false);
  assert.equal(calls.download.length, 0);
});

test('fetchFrameImage: tải ảnh lỗi → { ok:false, error } thay vì ném', async () => {
  const { runClaude } = setup({ ok: true, data: { url: 'https://x/y.png' } });
  const r = await fetchFrameImage({ ...base, runClaude, download: async () => { throw new Error('HTTP 403'); } });
  assert.equal(r.ok, false);
  assert.match(r.error, /HTTP 403/);
});

test('fetchFrameImage: chuyển onUsage cho runClaude', async () => {
  const { calls, runClaude, download } = setup({ ok: true, data: { url: 'https://x/y.png' } });
  const onUsage = () => {};
  await fetchFrameImage({ ...base, runClaude, download, onUsage });
  assert.equal(calls.claude[0].onUsage, onUsage);
});

test('fetchFrameImage: chuyển signal cho runClaude', async () => {
  const { calls, runClaude, download } = setup({ ok: true, data: { url: 'https://x/y.png' } });
  const signal = new AbortController().signal;
  await fetchFrameImage({ ...base, runClaude, download, signal });
  assert.equal(calls.claude[0].signal, signal);
});

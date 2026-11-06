import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLive } from '../server/runs/runner.js';

const at = new Date(2026, 9, 29, 3, 7, 5).getTime();

test('formatLive: bước, điểm kiểm (lấy được / mong đợi), giai đoạn cài app, thời gian case', () => {
  const ctx = { titles: { TC_1: { title: 'Mở Terms' } }, startedAt: {} };
  assert.equal(formatLive({ type: 'start', tc: 'TC_1', at }, ctx), '[03:07:05] ▶ TC_1 — Mở Terms');
  assert.equal(formatLive({ type: 'info', tc: 'TC_1', text: 'Cài app (3.2s)', at }, ctx), '[03:07:05]    · Cài app (3.2s)');
  assert.equal(formatLive({ type: 'step', kind: 'Action', step: 1, screen: 'Welcome', keyword: 'Tap', target: 'Terms of Service', ok: true, at }, ctx),
    '[03:07:05]    ✓ B1 · Welcome · Tap "Terms of Service"');
  assert.equal(formatLive({ type: 'step', kind: 'Check', step: 1, screen: 'Trang ngoài', keyword: 'Verify external URL', label: 'URL Terms', actual: 'https://a.com/t', expected: 'https://a.com/t', ok: true, at }, ctx),
    '[03:07:05]    ✓ B1 · Trang ngoài · Verify external URL "URL Terms": lấy được "https://a.com/t" · mong đợi "https://a.com/t"');
  assert.equal(formatLive({ type: 'step', tc: 'TC_1', kind: 'Check', step: 2, screen: 'Welcome', keyword: 'Verify not displayed', label: 'Không có Log in', actual: true, expected: false, ok: false, at }, ctx),
    '[03:07:05]    ✗ B2 · Welcome · Verify not displayed "Không có Log in": lấy được có hiện · mong đợi không hiện');
  assert.equal(formatLive({ type: 'end', tc: 'TC_1', ok: true, at: at + 12300 }, ctx), '[03:07:17] ■ TC_1 FAILED · 1 điểm kiểm lệch (12.3s)');
  assert.equal(formatLive({ type: 'start', tc: 'TC_2', at }, ctx), '[03:07:05] ▶ TC_2');
  assert.equal(formatLive({ type: 'end', tc: 'TC_2', ok: true, at: at + 1000 }, ctx), '[03:07:06] ■ TC_2 PASSED (1.0s)');
  assert.equal(formatLive({ type: 'end', tc: 'TC_1', ok: false, error: 'Không thấy "X"', at }, ctx), '[03:07:05] ■ TC_1 dừng: Không thấy "X" · 1 điểm kiểm lệch (0.0s)');
});

test('NOISE: bỏ dòng wdio lặp lại, giữ lỗi thật và Spec Files', async () => {
  const { NOISE } = await import('../server/runs/runner.js');
  for (const l of ['[Recime.app iOS #0-0]    ✓ TC_1 Mở Terms', '[0-0] RUNNING in iOS on iOS - file:///x', '    at Object.assertAll (file:///x)', 'AssertionError [ERR_ASSERTION]: Lệch 1/3 điểm kiểm:', '  - Step 1 Không có link: app = true, mong đợi = false', '      actual expected', '      falsetrue', '------------------------------------------------------------------'])
    assert.ok(NOISE.test(l), l);
  for (const l of ['Execution of 1 workers started at 2026-10-28T20:14:58.464Z', '[0-0] Error: Không khởi động được WebDriverAgent', 'Spec Files:	 0 passed, 1 failed, 1 total (100% completed) in 00:00:28'])
    assert.ok(!NOISE.test(l), l);
});

test('runner: dòng live đang ghi dở không bị mất — đọc ở lần sau khi đã ghi xong', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { EventEmitter } = await import('node:events');
  const { createStore } = await import('../server/store.js');
  const { createLock } = await import('../server/lock.js');
  const { createRunner } = await import('../server/runs/runner.js');
  const { tmpDir } = await import('./helpers.js');
  const dataDir = tmpDir();
  const ws = tmpDir();
  fs.mkdirSync(path.join(ws, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'tests/f.e2e.js'), '');
  const store = createStore(dataDir);
  store.put('apps', { id: 'a', name: 'A', workspace: ws, appPath: '/x.app', bundleId: 'b', platform: 'iOS', status: 'ready' });
  store.put('cases', { id: 'a:f:TC_1', appId: 'a', file: 'f', tcId: 'TC_1', order: 0, title: 'T', fresh: true, prev: null, pre: [], rows: [], script: { status: 'generated' } });
  let proc;
  const spawnImpl = () => { proc = new EventEmitter(); proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); proc.kill = () => {}; return proc; };
  const runner = createRunner({ store, lock: createLock(), emit: () => {}, dataDir, spawnImpl, scriptPath: () => path.join(ws, 'tests/f.e2e.js'), pollMs: 5, shotMs: 5, screenshotImpl: async () => { throw new Error('x'); }, wdaCheck: async () => false });
  const run = await runner.startRun({ appId: 'a', udid: 'U', caseIds: ['a:f:TC_1'] });
  const live = store.get('runs', run.id).livePath;
  const ev = JSON.stringify({ type: 'start', tc: 'TC_1', at: Date.now() });
  fs.writeFileSync(live, ev.slice(0, 10)); // đang ghi dở
  await new Promise((r) => setTimeout(r, 30));
  fs.appendFileSync(live, `${ev.slice(10)}\n`);
  await new Promise((r) => setTimeout(r, 30));
  proc.emit('close', 0);
  assert.ok(store.get('runs', run.id).log.some((l) => /▶ TC_1/.test(l)));
});

// Giới hạn thời gian case: hết giờ → huỷ đúng case đó (k.* / $ ném lỗi), chờ code của case dừng rồi mới báo lỗi; case sau không bị ảnh hưởng
import test from 'node:test';
import assert from 'node:assert/strict';
import { runWithLimit, guardApi, guardGlobals } from '../server/apps/template/src/runner/limit.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('case xong trong giới hạn → không lỗi; lỗi của case giữ nguyên', async () => {
  await runWithLimit({ reason: null }, async () => { await sleep(5); }, { ms: 200 });
  await assert.rejects(runWithLimit({ reason: null }, async () => { throw new Error('Không tới được màn X'); }, { ms: 200 }), /Không tới được màn X/);
});

test('quá giờ → lệnh k.* tiếp theo của case ném lỗi, chờ case dừng hẳn rồi mới báo lỗi (có bước cuối)', async () => {
  const done = [];
  const k = guardApi({ async tap(name) { done.push(name); await sleep(30); } });
  let stopped = false;
  const err = await runWithLimit({ reason: null }, async () => {
    try {
      for (let i = 0; i < 100; i++) await k.tap(`b${i}`);
    } finally {
      stopped = true;
    }
  }, { ms: 70, settleMs: 1000, describe: () => `Tap "b${done.length - 1}"` }).catch((e) => e);
  assert.match(err.message, /^Quá thời gian 0\.07s — case bị huỷ \(bước cuối đã làm: Tap "b\d+"\)$/);
  assert.equal(stopped, true); // code của case đã dừng trước khi runWithLimit trả lỗi
  const n = done.length;
  await sleep(80);
  assert.equal(done.length, n); // không còn bấm thêm sau khi báo lỗi
  assert.ok(n < 10);
});

test('$ toàn cục của case đã huỷ ném lỗi; case sau (ngữ cảnh khác) gọi $ bình thường', async () => {
  const g = { $: (sel) => `el:${sel}`, $$: (sel) => [sel] };
  guardGlobals(g);
  guardGlobals(g); // gọi lại không bọc 2 lần
  const calls = [];
  await runWithLimit({ reason: null }, async () => {
    for (;;) { calls.push(g.$('a')); await sleep(10); }
  }, { ms: 40, settleMs: 500 }).catch(() => {});
  const n = calls.length;
  await sleep(40);
  assert.equal(calls.length, n);
  await runWithLimit({ reason: null }, async () => { assert.equal(g.$('b'), 'el:b'); assert.deepEqual(g.$$('c'), ['c']); }, { ms: 200 });
});

test('ms = 0 (sửa tay chờ tester) → không giới hạn', async () => {
  await runWithLimit({ reason: null }, async () => { await sleep(30); }, { ms: 0 });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createStore } from '../server/store.js';
import locatorRoutes from '../server/routes/locators.js';
import { tmpDir } from './helpers.js';

async function setup(resolve) {
  const store = createStore(tmpDir());
  store.put('apps', { id: 'a', name: 'A', platform: 'iOS' });
  const started = [];
  const captures = { start: async (appId, o) => { started.push(o); store.put('captures', { id: 'c1', appId }); return 'c1'; }, stop: async () => {} };
  const ex = express();
  ex.use(express.json());
  ex.use('/api', locatorRoutes({ store, map: {}, captures, emit: () => {}, tryLive: {} }, { resolve, assist: async () => ({}) }));
  const server = ex.listen(0);
  const post = async (url, body) => { const r = await fetch(`http://127.0.0.1:${server.address().port}/api${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  return { post, started, close: () => server.close() };
}
const els = [{ type: 'Button', name: 'Subscribe', locator: '~Subscribe' }, { type: 'Button', name: 'Back', locator: '~Back' }];

test('POST /resolve: AI chọn nút mua cho mô tả khác → trả locator null kèm lý do chặn; nút thường thì trả như cũ', async () => {
  const h = await setup(async ({ target }) => ({ locator: target === 'Nút quay lại' ? '~Subscribe' : '~Back', reason: 'ai' }));
  try {
    const r1 = await h.post('/apps/a/resolve', { target: 'Nút quay lại', screen: 'S', kind: 'tap', elements: els });
    assert.equal(r1.body.locator, null);
    assert.match(r1.body.reason, /nút mua/);
    const r2 = await h.post('/apps/a/resolve', { target: 'Back', screen: 'S', kind: 'tap', elements: els });
    assert.equal(r2.body.locator, '~Back');
  } finally { h.close(); }
});

test('POST /captures: maxSteps / maxMinutes bị giới hạn (≤150, ≤60)', async () => {
  const h = await setup(async () => null);
  try {
    const r = await h.post('/apps/a/captures', { mode: 'explore', udid: 'U', maxSteps: 100000, maxMinutes: 9999 });
    assert.equal(r.status, 201);
    assert.equal(h.started[0].maxSteps, 150);
    assert.equal(h.started[0].maxMinutes, 60);
  } finally { h.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStore } from '../server/store.js';
import { createLock } from '../server/lock.js';
import { createScreenMap } from '../server/locators/screenMap.js';
import { createCaptures } from '../server/locators/record.js';
import { tmpDir } from './helpers.js';

const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}.xml`, import.meta.url), 'utf8');

// Driver giả: mỗi lần getPageSource trả màn kế tiếp trong danh sách (giữ màn cuối)
function fakeSession(sources, alerts = []) {
  let i = 0;
  let a = 0;
  const state = { closed: false };
  return {
    state,
    open: async () => ({
      driver: {
        getPageSource: async () => sources[Math.min(i++, sources.length - 1)],
        takeScreenshot: async () => Buffer.from('png').toString('base64'),
        pause: async () => {},
        execute: async (cmd) => {
          const btns = alerts[Math.min(a++, alerts.length - 1)];
          if (cmd === 'mobile: alert' && btns) return btns;
          throw new Error('no alert open');
        },
      },
      close: async () => { state.closed = true; },
    }),
  };
}

function setup(sources, alerts) {
  const dataDir = tmpDir();
  const store = createStore(dataDir);
  store.put('apps', { id: 'ikf', workspace: tmpDir(), appPath: '/x.app', bundleId: 'b', status: 'ready' });
  const lock = createLock();
  const events = [];
  const sess = fakeSession(sources, alerts);
  const caps = createCaptures({ store, lock, emit: (t, p) => events.push([t, p]), map: createScreenMap({ store, dataDir }), openSession: sess.open, pollMs: 1 });
  return { store, lock, caps, events, sess };
}

const until = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); }
};

test('record: welcome → login trống → login đã nhập → 2 màn; Dừng → stopped, đóng session, nhả lock', async () => {
  const { store, lock, caps, sess } = setup([fx('welcome'), fx('welcome'), fx('login-empty'), fx('login-filled')]);
  const id = await caps.start('ikf', { mode: 'record', udid: 'U' });
  assert.equal(lock.current().id, id);
  await until(() => store.list('screens').length === 2 && store.get('captures', id).polls >= 4);
  await caps.stop(id);
  const c = store.get('captures', id);
  assert.equal(c.status, 'stopped');
  assert.equal(c.screensFound, 2);
  assert.equal(sess.state.closed, true);
  assert.equal(lock.current(), null);
});

test('đang có job khác giữ simulator → start bị từ chối kèm lý do', async () => {
  const { lock, caps } = setup([fx('welcome')]);
  lock.acquire({ kind: 'run', id: 'RUN-0001', label: 'Đang chạy RUN-0001' });
  await assert.rejects(caps.start('ikf', { mode: 'record', udid: 'U' }), /Đang chạy RUN-0001/);
});

test('app chưa sẵn sàng → từ chối', async () => {
  const { store, caps } = setup([fx('welcome')]);
  store.patch('apps', 'ikf', { status: 'preparing' });
  await assert.rejects(caps.start('ikf', { mode: 'record', udid: 'U' }), /chưa sẵn sàng/);
});

test('mở session lỗi → capture error, lock được nhả', async () => {
  const dataDir = tmpDir();
  const store = createStore(dataDir);
  store.put('apps', { id: 'ikf', workspace: tmpDir(), status: 'ready' });
  const lock = createLock();
  const caps = createCaptures({ store, lock, emit: () => {}, map: createScreenMap({ store, dataDir }), openSession: async () => { throw new Error('WDA không khởi động'); }, pollMs: 1 });
  const id = await caps.start('ikf', { mode: 'record', udid: 'U' });
  await until(() => store.get('captures', id).status === 'error');
  assert.match(store.get('captures', id).error, /WDA/);
  assert.equal(lock.current(), null);
});

const EMPTY = '<?xml version="1.0"?><AppiumAUT><XCUIElementTypeApplication name="FitAgain" width="440" height="956"/></AppiumAUT>';

test('lần đọc rỗng lúc app đang mở không tạo màn', async () => {
  const { store, caps } = setup([EMPTY, EMPTY, fx('welcome')]);
  const id = await caps.start('ikf', { mode: 'record', udid: 'U' });
  await until(() => store.get('captures', id).polls >= 4);
  await caps.stop(id);
  assert.deepEqual(store.list('screens').map((s) => s.name), ['Welcome']);
});

test('popup hệ thống đang mở → nhắc tester 1 lần, kèm tên nút', async () => {
  const { store, caps } = setup([fx('welcome')], [['Ask App Not to Track', 'Allow']]);
  const id = await caps.start('ikf', { mode: 'record', udid: 'U' });
  await until(() => store.get('captures', id).polls >= 5);
  await caps.stop(id);
  const notes = store.get('captures', id).log.filter((l) => /Popup hệ thống/.test(l.text));
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /Ask App Not to Track/);
});

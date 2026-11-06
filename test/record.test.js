import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStore } from '../server/store.js';
import { createLock } from '../server/lock.js';
import { createScreenMap } from '../server/locators/screenMap.js';
import { createCaptures } from '../server/locators/record.js';
import { tmpDir } from './helpers.js';

const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}.xml`, import.meta.url), 'utf8');

// Driver giả: mỗi lần đọc nhanh (mobile: source) sang màn kế tiếp trong danh sách (giữ màn cuối);
// getPageSource (bản đầy đủ) trả màn đang hiện. state.full đếm số lần đọc bản đầy đủ
function fakeSession(sources, alerts = []) {
  let i = -1;
  let a = 0;
  const state = { closed: false, full: 0, alertAsks: 0 };
  const cur = () => sources[Math.min(Math.max(i, 0), sources.length - 1)];
  return {
    state,
    open: async () => ({
      driver: {
        getPageSource: async () => { state.full++; return cur(); },
        takeScreenshot: async () => Buffer.from('png').toString('base64'),
        pause: async () => {},
        execute: async (cmd) => {
          if (cmd === 'mobile: source') { i++; return cur(); }
          state.alertAsks++;
          const btns = alerts[Math.min(a++, alerts.length - 1)];
          if (cmd === 'mobile: alert' && btns) return btns;
          throw new Error('no alert open');
        },
      },
      close: async () => { state.closed = true; },
    }),
  };
}

function setup(sources, alerts, opts = {}) {
  const dataDir = tmpDir();
  const store = createStore(dataDir);
  store.put('apps', { id: 'ikf', workspace: tmpDir(), appPath: '/x.app', bundleId: 'b', status: 'ready' });
  const lock = createLock();
  const events = [];
  const sess = fakeSession(sources, alerts);
  const caps = createCaptures({ store, lock, emit: (t, p) => events.push([t, p]), map: createScreenMap({ store, dataDir }), openSession: sess.open, pollMs: 1, ...opts });
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
  const { store, caps } = setup([fx('welcome')], [['Ask App Not to Track', 'Allow']], { alertIdleMs: 0, alertEveryMs: 0 });
  const id = await caps.start('ikf', { mode: 'record', udid: 'U' });
  await until(() => store.get('captures', id).polls >= 5);
  await caps.stop(id);
  const notes = store.get('captures', id).log.filter((l) => /Popup hệ thống/.test(l.text));
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /Ask App Not to Track/);
});

test('đọc nhanh để phát hiện màn đổi: bản đầy đủ chỉ đọc khi màn đổi; màn đứng yên chưa đủ lâu thì không hỏi popup', async () => {
  const { store, caps, sess } = setup([fx('welcome'), fx('welcome'), fx('welcome'), fx('login-empty'), fx('login-empty'), fx('login-empty')], [], { alertIdleMs: 60000 });
  const id = await caps.start('ikf', { mode: 'record', udid: 'U' });
  await until(() => store.list('screens').length === 2 && store.get('captures', id).polls >= 6);
  await caps.stop(id);
  assert.equal(sess.state.full, 2); // 2 lần màn đổi (welcome, login) → 2 lần đọc đầy đủ
  assert.equal(sess.state.alertAsks, 0);
});

test('khung hình đang chạy hiệu ứng (đổi mỗi lần đọc) không bị ghi thành màn; màn đứng yên mới ghi', async () => {
  const anim = [fx('welcome'), fx('login-empty'), fx('welcome'), fx('login-empty')]; // đổi liên tục, không lần nào đứng yên
  const { store, caps } = setup([...anim, fx('login-filled'), fx('login-filled'), fx('login-filled')], [], { alertIdleMs: 60000 });
  const id = await caps.start('ikf', { mode: 'record', udid: 'U' });
  await until(() => store.get('captures', id).polls >= 7);
  await caps.stop(id);
  assert.deepEqual(store.list('screens').map((s) => s.name), ['Log In']);
});

test('quay lại / đi qua màn đã có trong map → vẫn báo trong log (tester thấy lần bấm đã được ghi nhận), không báo lặp khi màn không đổi', async () => {
  const { store, caps } = setup([fx('welcome'), fx('welcome'), fx('login-empty'), fx('login-empty'), fx('welcome'), fx('welcome')]);
  const id = await caps.start('ikf', { mode: 'record', udid: 'U' });
  await until(() => store.get('captures', id).log.filter((l) => /Đã có/.test(l.text)).length >= 1);
  await caps.stop(id);
  const lines = store.get('captures', id).log.map((l) => l.text);
  assert.equal(lines.filter((t) => /^Màn mới/.test(t)).length, 2);
  assert.equal(lines.filter((t) => /^Đã có: /.test(t)).length, 1, lines.join('\n'));
});

test('hỏi popup hệ thống (iOS, ~2 giây / lần, chặn vòng đọc) chỉ khi màn đứng yên lâu, thưa — không làm sót màn lướt qua nhanh', async () => {
  const { RECORD_DEFAULTS } = await import('../server/locators/record.js');
  assert.ok(RECORD_DEFAULTS.alertIdleMs >= 10000, `alertIdleMs ${RECORD_DEFAULTS.alertIdleMs}`);
  assert.ok(RECORD_DEFAULTS.alertEveryMs >= 20000, `alertEveryMs ${RECORD_DEFAULTS.alertEveryMs}`);
});

test('thứ tự màn = thứ tự tester bấm ở lần ghi (màn đã có từ trước được xếp lại); khung hình chữ hiện từng ký tự không ghi', async () => {
  const splash = `<?xml version="1.0" encoding="UTF-8"?><XCUIElementTypeApplication type="XCUIElementTypeApplication" name="App" x="0" y="0" width="402" height="874" visible="true">${['T', 'a', 's', 't'].map((c, i) => `<XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="${c}" label="${c}" x="${150 + i * 16}" y="530" width="16" height="34" visible="true" enabled="true"/>`).join('')}</XCUIElementTypeApplication>`;
  const { store, caps } = setup([splash, splash, splash, fx('welcome'), fx('welcome'), fx('welcome'), fx('login-empty'), fx('login-empty'), fx('login-empty')], [], { alertIdleMs: 60000 });
  // Map cũ: Log In đứng trước Welcome
  const { createScreenMap: mk } = await import('../server/locators/screenMap.js');
  const pre = mk({ store, dataDir: tmpDir() });
  pre.addSnapshot('ikf', { xml: fx('login-empty') });
  pre.addSnapshot('ikf', { xml: fx('welcome') });
  assert.deepEqual(pre.list('ikf').map((s) => s.name), ['Log In', 'Welcome']);
  const id = await caps.start('ikf', { mode: 'record', udid: 'U' });
  await until(() => store.get('captures', id).log.filter((l) => /Đã có/.test(l.text)).length >= 2);
  await caps.stop(id);
  assert.deepEqual(pre.list('ikf').map((s) => s.name), ['Welcome', 'Log In']);
});

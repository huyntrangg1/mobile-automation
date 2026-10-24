import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStore } from '../server/store.js';
import { createLock } from '../server/lock.js';
import { createScreenMap } from '../server/locators/screenMap.js';
import { createCaptures } from '../server/locators/record.js';
import { exploreLoop } from '../server/locators/explore.js';
import { tmpDir } from './helpers.js';

const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}.xml`, import.meta.url), 'utf8');
const EMAIL_BTN = '-ios predicate string:type == "XCUIElementTypeButton" AND name == "Continue with email"';

// App giả 2 màn: Welcome --tap "Continue with email"--> Log In --tap ~Back--> Welcome
const EMPTY = '<?xml version="1.0"?><AppiumAUT><XCUIElementTypeApplication name="FitAgain" width="440" height="956"/></AppiumAUT>';

function fakeApp({ emptyFirst = false } = {}) {
  const st = { cur: 'welcome', taps: [], typed: [], reads: 0 };
  const driver = {
    getPageSource: async () => (emptyFirst && st.reads++ === 0 ? EMPTY : fx(st.cur === 'welcome' ? 'welcome' : 'login-empty')),
    takeScreenshot: async () => Buffer.from('png').toString('base64'),
    pause: async () => {},
    execute: async () => { throw new Error('no alert open'); },
    $: async (sel) => ({
      click: async () => { st.taps.push(sel); if (sel === EMAIL_BTN) st.cur = 'login'; if (sel === '~Back') st.cur = 'welcome'; },
      setValue: async (v) => { st.typed.push([sel, v]); },
      waitForExist: async () => true,
    }),
  };
  return { st, open: async () => ({ driver, close: async () => {} }) };
}

function setup(answers, appOpts) {
  const dataDir = tmpDir();
  const store = createStore(dataDir);
  store.put('apps', { id: 'ikf', workspace: tmpDir(), status: 'ready', bundleId: 'b', appPath: '/x.app' });
  const lock = createLock();
  const app = fakeApp(appOpts);
  const prompts = [];
  let i = 0;
  const runClaude = async ({ prompt }) => { prompts.push(prompt); const a = answers[Math.min(i++, answers.length - 1)]; return typeof a === 'function' ? a() : a; };
  const caps = createCaptures({ store, lock, emit: () => {}, map: createScreenMap({ store, dataDir }), openSession: app.open,
    loops: { explore: (...args) => exploreLoop(...args, { runClaude }) }, pollMs: 1 });
  return { store, lock, caps, app, prompts };
}

const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); }
};
const ok = (data) => ({ ok: true, data });

test('AI bấm sang Log In rồi done → 2 màn, status done, tên màn theo AI', async () => {
  const { store, caps, app } = setup([
    ok({ action: 'tap', locator: EMAIL_BTN, screenName: 'Welcome', reason: 'mở form email' }),
    ok({ action: 'done', screenName: 'Log In', reason: 'đủ' }),
  ]);
  const id = await caps.start('ikf', { mode: 'explore', udid: 'U', maxSteps: 10 });
  await until(() => store.get('captures', id).status !== 'running');
  const c = store.get('captures', id);
  assert.equal(c.status, 'done');
  assert.equal(c.screensFound, 2);
  assert.deepEqual(app.st.taps, [EMAIL_BTN]);
  assert.deepEqual(store.list('screens').map((s) => s.name).sort(), ['Log In', 'Welcome']);
});

test('locator AI bịa không có trên màn → không bấm, log "bỏ qua"', async () => {
  const { store, caps, app } = setup([
    ok({ action: 'tap', locator: '~Không có nút này', screenName: 'Welcome', reason: 'x' }),
    ok({ action: 'done', screenName: 'Welcome', reason: 'x' }),
  ]);
  const id = await caps.start('ikf', { mode: 'explore', udid: 'U' });
  await until(() => store.get('captures', id).status !== 'running');
  assert.deepEqual(app.st.taps, []);
  assert.ok(store.get('captures', id).log.some((l) => /bỏ qua/i.test(l.text)));
});

test('3 lỗi AI liên tiếp → error, lock nhả', async () => {
  const { store, caps, lock } = setup([{ ok: false, error: 'Claude quá thời gian' }]);
  const id = await caps.start('ikf', { mode: 'explore', udid: 'U' });
  await until(() => store.get('captures', id).status !== 'running');
  const c = store.get('captures', id);
  assert.equal(c.status, 'error');
  assert.match(c.error, /quá thời gian/);
  assert.equal(lock.current(), null);
});

test('hết maxSteps → done, số bước đúng', async () => {
  const { store, caps } = setup([ok({ action: 'tap', locator: '~Back', screenName: 'X', reason: 'x' })]);
  const id = await caps.start('ikf', { mode: 'explore', udid: 'U', maxSteps: 3 });
  await until(() => store.get('captures', id).status !== 'running');
  assert.equal(store.get('captures', id).status, 'done');
  assert.equal(store.get('captures', id).steps, 3);
});

test('prompt có gợi ý dữ liệu và thao tác đã thử ở màn này', async () => {
  const { store, caps, prompts } = setup([
    ok({ action: 'type', locator: '~Welcome', text: 'a@b.c', screenName: 'Welcome', reason: 'x' }),
    ok({ action: 'done', screenName: 'Welcome', reason: 'x' }),
  ]);
  const id = await caps.start('ikf', { mode: 'explore', udid: 'U', hints: { email: 'qa@ik.com' } });
  await until(() => store.get('captures', id).status !== 'running');
  assert.match(prompts[0], /qa@ik\.com/);
  assert.match(prompts[1], /type ~Welcome/);
});

test('màn rỗng lúc app đang tải không được lưu thành màn', async () => {
  const { store, caps } = setup([ok({ action: 'done', screenName: 'X', reason: 'x' })], { emptyFirst: true });
  const id = await caps.start('ikf', { mode: 'explore', udid: 'U' });
  await until(() => store.get('captures', id).status !== 'running');
  assert.equal(store.list('screens').filter((s) => s.elements.length === 0).length, 0);
});

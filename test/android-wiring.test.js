// Nối Android vào luồng có sẵn: ghi locator, tự khám phá, run, gen
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createLock } from '../server/lock.js';
import { createScreenMap } from '../server/locators/screenMap.js';
import { createCaptures } from '../server/locators/record.js';
import { exploreLoop } from '../server/locators/explore.js';
import { createRunner } from '../server/runs/runner.js';
import { createGenerator } from '../server/scripts/generate.js';
import { ROOT } from '../server/paths.js';
import { tmpDir } from './helpers.js';

const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}.xml`, import.meta.url), 'utf8');
const PERM = '<?xml version="1.0"?><hierarchy rotation="0" width="1080" height="2424"><android.widget.FrameLayout package="com.google.android.permissioncontroller" class="android.widget.FrameLayout" bounds="[0,0][1080,2424]" displayed="true"><android.widget.TextView package="com.google.android.permissioncontroller" class="android.widget.TextView" text="Allow API Demos to send you notifications?" bounds="[0,0][1,1]" displayed="true"/><android.widget.Button package="com.google.android.permissioncontroller" class="android.widget.Button" text="Allow" resource-id="com.android.permissioncontroller:id/permission_allow_button" clickable="true" bounds="[0,0][1,1]" displayed="true"/><android.widget.Button package="com.google.android.permissioncontroller" class="android.widget.Button" text="Don’t allow" resource-id="com.android.permissioncontroller:id/permission_deny_button" clickable="true" bounds="[0,0][1,1]" displayed="true"/></android.widget.FrameLayout></hierarchy>';
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); } };

function capSetup(sources, { loops } = {}) {
  const dataDir = tmpDir();
  const store = createStore(dataDir);
  store.put('apps', { id: 'and', name: 'API Demos', platform: 'Android', workspace: tmpDir(), status: 'ready', appPath: '/a.apk', bundleId: 'io.appium.android.apis' });
  let i = 0;
  const taps = [];
  const opened = [];
  const driver = {
    getPageSource: async () => sources[Math.min(i++, sources.length - 1)],
    takeScreenshot: async () => Buffer.from('png').toString('base64'),
    pause: async () => {},
    execute: async () => { throw new Error('mobile: alert không có trên Android'); },
    $: async (sel) => ({ click: async () => taps.push(sel), setValue: async () => {} }),
  };
  const caps = createCaptures({ store, lock: createLock(), emit: () => {}, map: createScreenMap({ store, dataDir }), pollMs: 1,
    openSession: async (args) => { opened.push(args); return { driver, close: async () => {} }; }, loops });
  return { store, caps, taps, opened };
}

test('ghi locator Android: mở phiên với app + thiết bị; hộp xin quyền → nhắc tester, không ghi thành màn', async () => {
  const { store, caps, opened } = capSetup([PERM, PERM, fx('android-main'), fx('android-main')]);
  const id = await caps.start('and', { mode: 'record', udid: 'emulator-5554' });
  await until(() => store.list('screens').length === 1 && store.get('captures', id).polls >= 3);
  await caps.stop(id);
  assert.equal(opened[0].app.platform, 'Android');
  assert.equal(opened[0].udid, 'emulator-5554');
  const notes = store.get('captures', id).log.filter((l) => /Popup hệ thống/.test(l.text));
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /Don’t allow/);
  assert.ok(!store.list('screens').some((s) => /notifications/.test(s.name)));
});

test('tự khám phá Android: hộp xin quyền → tự bấm nút từ chối', async () => {
  const ok = (data) => ({ ok: true, data });
  const { store, caps, taps } = capSetup([PERM, fx('android-main')], {
    loops: { explore: (...a) => exploreLoop(...a, { runClaude: async () => ok({ action: 'done', screenName: 'Main', reason: 'x' }) }) },
  });
  const id = await caps.start('and', { mode: 'explore', udid: 'emulator-5554' });
  await until(() => store.get('captures', id).status !== 'running');
  assert.deepEqual(taps, ['android=new UiSelector().resourceId("com.android.permissioncontroller:id/permission_deny_button")']);
  assert.ok(store.get('captures', id).log.some((l) => /Đóng popup hệ thống: Don’t allow/.test(l.text)));
});

test('run Android: env PLATFORM / APP_VERSION / ANDROID_HOME, chụp màn theo nền tảng, chỉ giữ dòng Platform All / Android', async () => {
  const dataDir = tmpDir();
  const ws = tmpDir();
  fs.mkdirSync(path.join(ws, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'tests/f.e2e.js'), '//');
  const store = createStore(dataDir);
  store.put('apps', { id: 'and', name: 'API Demos', platform: 'Android', workspace: ws, status: 'ready', env: {}, appPath: '/a.apk', bundleId: 'io.x', version: '6.0.2 (28)', activity: 'io.x.Main' });
  const rows = [{ step: 1, kind: 'Action', keyword: 'Tap', target: 'A', platform: 'All' }, { step: 2, kind: 'Action', keyword: 'Tap', target: 'iOS only', platform: 'iOS' }, { step: 3, kind: 'Action', keyword: 'Tap', target: 'Android only', platform: 'Android' }];
  store.put('cases', { id: 'and:f:TC_A', appId: 'and', file: 'f', tcId: 'TC_A', order: 0, fresh: true, prev: null, rows, script: { status: 'generated' } });
  let env;
  const shots = [];
  const spawnImpl = (cmd, args, opts) => { env = opts.env; const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = () => {}; setTimeout(() => p.emit('close', 0), 30); return p; };
  const runner = createRunner({ store, lock: createLock(), emit: () => {}, dataDir, spawnImpl, shotMs: 5, pollMs: 5,
    screenshotImpl: async (udid, file, platform) => { shots.push(platform); fs.writeFileSync(file, 'x'); },
    scriptPath: (app, f) => path.join(app.workspace, 'tests', `${f}.e2e.js`) });
  await runner.startRun({ appId: 'and', udid: 'emulator-5554', caseIds: ['and:f:TC_A'] });
  await until(() => store.get('runs', 'RUN-0001').status !== 'running');
  assert.equal(env.PLATFORM, 'Android');
  assert.equal(env.APP_VERSION, '6.0.2 (28)');
  assert.equal(env.APP_ACTIVITY, 'io.x.Main');
  assert.ok(env.ANDROID_HOME);
  assert.equal(shots[0], 'Android');
  assert.deepEqual(store.get('runs', 'RUN-0001').results.TC_A.rows.map((r) => r.target), ['A', 'Android only']);
});

test('gen cho app Android: bỏ dòng Platform = iOS khi cảnh báo thiếu locator; prompt nói đúng nền tảng', async () => {
  const dataDir = tmpDir();
  const ws = tmpDir();
  fs.cpSync(path.join(ROOT, 'server/apps/template/src/utils'), path.join(ws, 'src/utils'), { recursive: true });
  const store = createStore(dataDir);
  store.put('apps', { id: 'and', name: 'API Demos', platform: 'Android', workspace: ws, helperPack: null });
  const map = createScreenMap({ store, dataDir });
  map.addSnapshot('and', { xml: fx('android-main'), png: null, nameHint: 'Main' });
  const rows = [{ step: 1, screen: 'Main', kind: 'Action', keyword: 'Tap', target: 'Chỉ iOS', platform: 'iOS' }, { step: 2, screen: 'Main', kind: 'Action', keyword: 'Tap', target: 'Views', platform: 'All' }];
  store.put('cases', { id: 'and:f:TC_A', appId: 'and', file: 'f', tcId: 'TC_A', order: 0, title: 'A', fresh: true, prev: null, pre: [], rows, script: { status: 'none', warnings: [] } });
  let prompt = '';
  const gen = createGenerator({ store, map, emit: () => {}, runClaude: async (o) => { prompt = o.prompt; return { ok: true, data: { body: "async ({ tc, data, sa, fill }) => {\n  await ui.tap(L['Main']['Views']);\n}", warnings: [] } }; } });
  const s = await gen.generateCase('and:f:TC_A');
  assert.equal(s.status, 'generated');
  assert.deepEqual(s.warnings, []);
  assert.match(prompt, /Appium, Android/);
  assert.match(prompt, /khác "All" và khác "Android"/);
});

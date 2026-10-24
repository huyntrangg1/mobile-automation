import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createScreenMap } from '../server/locators/screenMap.js';
import { tmpDir } from './helpers.js';

const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}.xml`, import.meta.url), 'utf8');
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function setup() {
  const dataDir = tmpDir();
  const wsDir = tmpDir();
  const store = createStore(dataDir);
  store.put('apps', { id: 'ikf', workspace: wsDir });
  return { store, wsDir, map: createScreenMap({ store, dataDir }) };
}

test('Log In trống rồi đã nhập → 1 màn; lỗi validation được thêm vào màn cũ; Welcome là màn mới', () => {
  const { store, map } = setup();
  const a = map.addSnapshot('ikf', { xml: fx('login-empty'), png: PNG, seenBy: 'record' });
  assert.equal(a.isNew, true);
  assert.equal(a.screen.name, 'Log In');
  const b = map.addSnapshot('ikf', { xml: fx('login-filled'), png: PNG, seenBy: 'record' });
  assert.equal(b.isNew, false);
  assert.equal(b.screen.id, a.screen.id);
  const c = map.addSnapshot('ikf', { xml: fx('login-error'), png: PNG, seenBy: 'record' });
  assert.equal(c.isNew, false);
  assert.ok(c.screen.elements.some((e) => e.name === 'Invalid email format'));
  const w = map.addSnapshot('ikf', { xml: fx('welcome'), png: PNG, seenBy: 'explore' });
  assert.equal(w.isNew, true);
  assert.equal(store.list('screens').length, 2);
  assert.ok(fs.existsSync(path.join(map.screenshotPath(w.screen))));
});

test('nameHint được dùng làm tên màn mới', () => {
  const { map } = setup();
  assert.equal(map.addSnapshot('ikf', { xml: fx('welcome'), png: PNG, nameHint: 'Welcome' }).screen.name, 'Welcome');
});

test('trùng tên màn → thêm số', () => {
  const { map, store } = setup();
  map.addSnapshot('ikf', { xml: fx('welcome'), png: PNG, nameHint: 'Start' });
  map.addSnapshot('ikf', { xml: fx('login-empty'), png: PNG, nameHint: 'Start' });
  assert.deepEqual(store.list('screens').map((s) => s.name).sort(), ['Start', 'Start 2']);
});

test('rename / merge / delete', () => {
  const { map, store } = setup();
  const w = map.addSnapshot('ikf', { xml: fx('welcome'), png: PNG }).screen;
  const l = map.addSnapshot('ikf', { xml: fx('login-empty'), png: PNG }).screen;
  map.renameScreen(w.id, 'Màn chào');
  assert.equal(store.get('screens', w.id).name, 'Màn chào');
  map.mergeScreens(w.id, l.id);
  assert.equal(store.get('screens', l.id), undefined);
  assert.ok(store.get('screens', w.id).elements.some((e) => e.type === 'TextField'));
  map.deleteScreen(w.id);
  assert.equal(store.list('screens').length, 0);
});

test('exportLocators sinh locators/map.js import được, key = name / label hoặc key tester đặt', async () => {
  const { map, wsDir } = setup();
  const l = map.addSnapshot('ikf', { xml: fx('login-empty'), png: PNG }).screen;
  const idx = l.elements.findIndex((e) => e.type === 'TextField');
  map.setElementKey(l.id, idx, 'Email');
  const file = map.exportLocators('ikf');
  assert.equal(file, path.join(wsDir, 'locators/map.js'));
  const { L } = await import(`${file}?t=${Date.now()}`);
  assert.equal(L['Log In'].Email, '-ios class chain:**/XCUIElementTypeTextField');
  assert.equal(L['Log In']['Continue with email'], '~Continue with email');
  assert.equal(L['Log In']['Enter your password'], '-ios class chain:**/XCUIElementTypeSecureTextField');
});

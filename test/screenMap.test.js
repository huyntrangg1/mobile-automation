import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createScreenMap } from '../server/locators/screenMap.js';
import { parseElements } from '../server/locators/pageSource.js';
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

test('sửa tay phần tử: sửa locator (đánh dấu manual), locator sai dạng → 400', () => {
  const { map } = setup();
  const { screen } = map.addSnapshot('ikf', { xml: fx('login-empty'), png: PNG });
  const s = map.updateElement(screen.id, 0, { locator: '-ios predicate string:name == "X"' });
  assert.equal(s.elements[0].locator, '-ios predicate string:name == "X"');
  assert.equal(s.elements[0].manual, true);
  assert.throws(() => map.updateElement(screen.id, 0, { locator: 'abc' }), (e) => e.status === 400);
  assert.throws(() => map.updateElement(screen.id, 99, { locator: '~a' }), (e) => e.status === 404);
});

test('thêm phần tử tay (cả point:) → có trong locator map; xoá → không quay lại khi lấy locator lần sau', () => {
  const { map } = setup();
  const { screen } = map.addSnapshot('ikf', { xml: fx('login-empty'), png: PNG });
  const n = screen.elements.length;
  let s = map.addElement(screen.id, { type: 'Button', key: 'Close X', locator: 'point:0.08,0.07' });
  assert.equal(s.elements.length, n + 1);
  assert.equal(map.locatorTable('ikf')[s.name].find((r) => r.key === 'Close X').locator, 'point:0.08,0.07');
  assert.throws(() => map.addElement(screen.id, { type: 'Button', key: '', locator: '~a' }), (e) => e.status === 400);
  assert.throws(() => map.addElement(screen.id, { type: 'Button', key: 'k', locator: 'point:2,0.5' }), (e) => e.status === 400);
  const victim = s.elements[0];
  s = map.removeElement(screen.id, 0);
  assert.ok(!s.elements.some((e) => e.type === victim.type && e.name === victim.name && e.label === victim.label));
  const again = map.addSnapshot('ikf', { xml: fx('login-empty'), png: PNG });
  assert.ok(!again.screen.elements.some((e) => e.type === victim.type && e.name === victim.name && e.label === victim.label));
  assert.ok(again.screen.elements.some((e) => e.key === 'Close X'));
});

test('refreshElements: đọc lại page source đã lưu → thêm phần tử còn thiếu (vd Other có nhãn), không thêm lại phần tử đã xoá, không đụng phần tử sửa tay', () => {
  const { store, map } = setup();
  const { screen } = map.addSnapshot('ikf', { xml: fx('login-empty'), png: PNG });
  const src = screen.source.replace('</XCUIElementTypeWindow>', '<XCUIElementTypeOther type="XCUIElementTypeOther" name="Onboarding progress" label="Onboarding progress" value="0%" visible="true" accessible="true" x="1" y="2" width="3" height="4"/><XCUIElementTypeOther type="XCUIElementTypeOther" name="Gone" label="Gone" visible="true" accessible="true" x="1" y="2" width="3" height="4"/></XCUIElementTypeWindow>');
  store.patch('screens', screen.id, { source: src, removed: ['Other|Gone|Gone'] });
  map.updateElement(screen.id, 0, { locator: '~manual' });
  const n = map.refreshElements('ikf');
  const s = store.get('screens', screen.id);
  assert.equal(n, 1);
  assert.ok(s.elements.some((e) => e.name === 'Onboarding progress' && e.locator === '~Onboarding progress'));
  assert.ok(!s.elements.some((e) => e.name === 'Gone'));
  assert.equal(s.elements[0].locator, '~manual');
  assert.equal(map.refreshElements('ikf'), 0);
});

test('sửa loại phần tử → lấy locator lại không thêm bản gốc thành phần tử trùng', () => {
  const { map } = setup();
  const a = map.addSnapshot('ikf', { xml: fx('login-empty'), png: PNG, seenBy: 'record' });
  const n = a.screen.elements.length;
  const before = a.screen.elements[0];
  map.updateElement(a.screen.id, 0, { type: before.type === 'Other' ? 'Button' : 'Other' });
  const b = map.addSnapshot('ikf', { xml: fx('login-empty'), png: PNG, seenBy: 'record' });
  assert.equal(b.screen.id, a.screen.id);
  assert.equal(b.screen.elements.length, n);
  assert.equal(b.screen.elements.filter((e) => e.name === before.name && e.label === before.label).length, 1);
});

test('gộp màn: phần tử màn giữ lại đã xoá không quay lại; danh sách đã xoá của 2 màn được gộp', () => {
  const { map, store } = setup();
  const el = (type, name) => ({ type, name, label: name, value: '', rect: null, visible: true, enabled: true, locator: `~${name}`, alts: [`~${name}`] });
  store.put('screens', { id: 'k', appId: 'ikf', name: 'A', elements: [el('Button', 'Next')], removed: ['Button|Skip|Skip'] });
  store.put('screens', { id: 'd', appId: 'ikf', name: 'B', elements: [el('Button', 'Skip'), el('Button', 'Back')], removed: ['Other|Ad|Ad'] });
  const s = map.mergeScreens('k', 'd');
  assert.deepEqual(s.elements.map((e) => e.name), ['Next', 'Back']);
  assert.deepEqual(s.removed.sort(), ['Button|Skip|Skip', 'Other|Ad|Ad']);
});

// Page source iOS tối giản từ danh sách [loại, tên, y]
const ios = (els) => `<?xml version="1.0" encoding="UTF-8"?><XCUIElementTypeApplication type="XCUIElementTypeApplication" name="App" x="0" y="0" width="402" height="874" visible="true">${
  els.map(([t, n, y]) => `<XCUIElementType${t} type="XCUIElementType${t}" name="${n}" label="${n}" x="20" y="${y}" width="200" height="30" visible="true" enabled="true"/>`).join('')}</XCUIElementTypeApplication>`;

test('cùng tiêu đề màn + trùng ≥ nửa số nút → cùng 1 màn (tutorial tự chuyển bước, bản ghi thiếu nút "Log in"); khác tiêu đề dù cùng nút → màn riêng', () => {
  const store = createStore(tmpDir());
  const map = createScreenMap({ store, dataDir: tmpDir() });
  const step = (n, text) => ios([['Button', 'Back', 60], ['StaticText', 'Smart social media imports', 130], ['StaticText', `Step ${n} of 3`, 160], ['StaticText', text, 200], ['Button', 'Tap here', 700]]);
  const a = map.addSnapshot('app', { xml: step(1, 'Find a recipe you like, then tap its Share button') });
  const b = map.addSnapshot('app', { xml: step(2, 'Choose share recipe') });
  const c = map.addSnapshot('app', { xml: step(3, 'In the share menu, pick Tastory.') });
  assert.equal(a.isNew, true);
  assert.equal(b.screen.id, a.screen.id);
  assert.equal(c.screen.id, a.screen.id);
  const welcome = (login) => ios([['StaticText', 'Welcome to, Tastory', 100], ['Button', 'Get Started', 600], ...(login ? [['StaticText', 'Already have an account?', 650], ['Button', 'Log in', 680]] : []), ['StaticText', 'By continuing, you agree to our Terms', 760]]);
  const w1 = map.addSnapshot('app', { xml: welcome(true) });
  assert.equal(map.addSnapshot('app', { xml: welcome(false) }).screen.id, w1.screen.id);
  // Màn onboarding khác nhau chỉ có Back + Continue giống nhau → vẫn tách
  const page = (title) => ios([['Button', 'Back', 60], ['StaticText', title, 130], ['Button', 'Continue', 770]]);
  const p1 = map.addSnapshot('app', { xml: page("You're in the right place") });
  const p2 = map.addSnapshot('app', { xml: page('Good news') });
  assert.notEqual(p1.screen.id, p2.screen.id);
  assert.equal(store.list('screens').length, 4);
});

test('màn đang tải dở (paywall chưa hiện nút) → gộp vào màn đầy đủ; màn chỉ có thanh tab không bị gộp vào các tab', () => {
  const store = createStore(tmpDir());
  const map = createScreenMap({ store, dataDir: tmpDir() });
  const plans = [['StaticText', 'Choose your', 190], ['StaticText', 'Trial Experience', 228], ['StaticText', 'Yearly', 300], ['StaticText', 'Weekly', 390], ['StaticText', 'Remind me before my trial ends', 480]];
  const half = map.addSnapshot('app', { xml: ios(plans) });
  const full = map.addSnapshot('app', { xml: ios([['StaticText', 'Restore', 60], ['Button', 'Close', 60], ...plans, ['Button', 'Start free trial', 700], ['Button', 'Terms', 800], ['Button', 'Privacy', 800]]) });
  assert.equal(full.screen.id, half.screen.id);
  const tabs = [['Button', 'Meal Plan', 830], ['Button', 'Groceries', 830], ['Button', 'Discover', 830]];
  const bar = map.addSnapshot('app', { xml: ios(tabs) });
  const groceries = map.addSnapshot('app', { xml: ios([['StaticText', 'Groceries', 100], ['StaticText', 'Your list is empty', 300], ['StaticText', 'Add items from recipes', 330], ['Button', 'Add item', 400], ...tabs]) });
  assert.notEqual(groceries.screen.id, bar.screen.id);
});

test('tidy: gộp màn trùng cũ (giữ màn đứng trước, tên cũ thành alias), bỏ khung hình chữ hiện từng ký tự, xếp theo lần ghi', () => {
  const { store, map } = setup();
  const step = (n, text) => ios([['Button', 'Back', 60], ['StaticText', 'Smart social media imports', 130], ['StaticText', `Step ${n} of 3`, 160], ['StaticText', text, 200], ['Button', 'Tap here', 700]]);
  // Dữ liệu cũ (ghi trước khi tool tự gộp): put thẳng vào store
  const old = (id, name, xml, order) => store.put('screens', { id, appId: 'ikf', name, elements: parseElements(xml), order });
  old('w', 'Welcome', fx('welcome'), 0);
  old('s1', 'Smart social media imports', step(1, 'Find a recipe'), 1);
  old('l', 'Log In', fx('login-empty'), 2);
  old('s2', 'Smart social media imports 2', step(2, 'Choose share recipe'), 3);
  old('y', 'y', ios([['StaticText', 'T', 500], ['StaticText', 'a', 500], ['StaticText', 's', 500], ['StaticText', 'y', 500]]), 4);
  const out = map.tidy('ikf', ['y', 'w', 's2', 'l']);
  assert.deepEqual(out.merged, [{ keep: 'Smart social media imports', drop: 'Smart social media imports 2' }]);
  assert.deepEqual(out.removed, ['y']);
  assert.deepEqual(map.list('ikf').map((s) => s.name), ['Welcome', 'Smart social media imports', 'Log In']);
  assert.deepEqual(store.get('screens', 's1').aliases, ['Smart social media imports 2']);
  assert.ok(map.locatorTable && map.exportLocators('ikf'));
});

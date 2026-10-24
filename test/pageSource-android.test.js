import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseElements, sameScreen, platformOf, windowOf } from '../server/locators/pageSource.js';

const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}.xml`, import.meta.url), 'utf8');
const main = parseElements(fx('android-main'));
const views = parseElements(fx('android-views'));
const controls = parseElements(fx('android-controls'));
const filled = parseElements(fx('android-controls-filled'));

test('nhận ra page source Android / iOS', () => {
  assert.equal(platformOf(fx('android-main')), 'Android');
  assert.equal(platformOf(fx('welcome')), 'iOS');
});

test('kích thước cửa sổ Android lấy từ hierarchy', () => {
  assert.deepEqual(windowOf(fx('android-main')), { width: 1080, height: 2424 });
  assert.deepEqual(windowOf(fx('welcome')), { width: 440, height: 956 });
});

test('màn chính: mục "Views" có locator ~content-desc', () => {
  const v = main.find((e) => e.name === 'Views');
  assert.ok(v);
  assert.equal(v.locator, '~Views');
});

test('2 nút Save trùng tên → locator theo resource-id', () => {
  const saves = controls.filter((e) => e.type === 'Button' && e.name === 'Save');
  assert.equal(saves.length, 2);
  assert.deepEqual(saves.map((e) => e.locator), [
    'android=new UiSelector().resourceId("io.appium.android.apis:id/button")',
    'android=new UiSelector().resourceId("io.appium.android.apis:id/button_disabled")',
  ]);
});

test('ô nhập EditText: loại TextField, nhãn = hint, chưa nhập thì value rỗng', () => {
  const f = controls.find((e) => e.type === 'TextField');
  assert.equal(f.label, 'hint text');
  assert.equal(f.value, '');
  assert.equal(f.locator, 'android=new UiSelector().resourceId("io.appium.android.apis:id/edit")');
  assert.equal(filled.find((e) => e.type === 'TextField').value, 'hello');
});

test('CheckBox / RadioButton được giữ, toạ độ từ bounds', () => {
  const c = controls.find((e) => e.name === 'Checkbox 1');
  assert.equal(c.type, 'CheckBox');
  assert.deepEqual(c.rect, { x: 0, y: 460, width: 318, height: 183 });
  assert.ok(controls.some((e) => e.type === 'RadioButton' && e.name === 'RadioButton 2'));
});

test('bỏ thanh điều hướng / thanh trạng thái hệ thống', () => {
  assert.ok(!controls.some((e) => /navigationBarBackground|statusBarBackground/.test(e.alts.join(' '))));
});

test('cùng màn Controls trống / đã nhập; màn chính khác màn Views', () => {
  assert.equal(sameScreen(controls, filled), true);
  assert.equal(sameScreen(main, views), false);
});

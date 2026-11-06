// Thử locator trên page source đã lưu (trang Locator map): locator khớp những phần tử nào
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchLocator } from '../server/locators/tryLocator.js';

const ios = fs.readFileSync(new URL('./fixtures/tastory-welcome.xml', import.meta.url), 'utf8');
const android = fs.readFileSync(new URL('./fixtures/android-main.xml', import.meta.url), 'utf8');
const names = (r) => r.elements.map((e) => e.name || e.label);

test('iOS ~id → name; trả loại, chữ, vị trí, hiển thị', () => {
  const r = matchLocator(ios, '~Get Started');
  assert.equal(r.elements.length, 1);
  assert.deepEqual([r.elements[0].type, r.elements[0].name, r.elements[0].visible], ['Button', 'Get Started', true]);
  assert.deepEqual(Object.keys(r.elements[0].rect), ['x', 'y', 'width', 'height']);
  assert.equal(matchLocator(ios, '~Không có').elements.length, 0);
});

test('iOS predicate: == / OR / AND / BEGINSWITH[c] / CONTAINS / != / visible == 1', () => {
  assert.deepEqual(names(matchLocator(ios, '-ios predicate string:name == "Get Started" OR label == "Get Started"')), ['Get Started']);
  assert.deepEqual(names(matchLocator(ios, '-ios predicate string:type == "XCUIElementTypeButton" AND name == "Log in"')), ['Log in']);
  assert.deepEqual(names(matchLocator(ios, '-ios predicate string:type == "XCUIElementTypeStaticText" AND name BEGINSWITH[c] "welcome to"')), ['Welcome to, Tastory', 'Welcome to']);
  assert.ok(names(matchLocator(ios, '-ios predicate string:label CONTAINS "Tastory"')).includes('Tastory'));
  const notTitle = names(matchLocator(ios, '-ios predicate string:type == "XCUIElementTypeStaticText" AND visible == 1 AND name != "Welcome to, Tastory"'));
  assert.equal(notTitle[0], 'Welcome to');
});

test('iOS class chain: **/Type[n], **/Type[`predicate`]', () => {
  assert.deepEqual(names(matchLocator(ios, '-ios class chain:**/XCUIElementTypeButton[1]')), ['Get Started']);
  assert.deepEqual(names(matchLocator(ios, '-ios class chain:**/XCUIElementTypeButton[`name == "Log in"`]')), ['Log in']);
  assert.equal(matchLocator(ios, '-ios class chain:**/XCUIElementTypeButton').elements.length, 2);
});

test('xpath', () => {
  assert.deepEqual(names(matchLocator(ios, '//XCUIElementTypeButton[@name="Log in"]')), ['Log in']);
});

test('Android: ~content-desc, id=resource-id, UiSelector text / textContains / resourceId', () => {
  assert.ok(matchLocator(android, '~Access\'ibility').elements.length >= 1);
  assert.ok(matchLocator(android, 'android=new UiSelector().text("API Demos")').elements.length >= 1);
  assert.ok(matchLocator(android, 'android=new UiSelector().textContains("Demos")').elements.length >= 1);
  assert.ok(matchLocator(android, 'id=android:id/text1').elements.length >= 1);
  assert.ok(matchLocator(android, 'android=new UiSelector().resourceId("android:id/text1")').elements.length >= 1);
});

test('point:x,y → điểm, không phần tử; locator sai dạng / predicate không đọc được → error', () => {
  assert.deepEqual(matchLocator(ios, 'point:0.1,0.05').point, { fx: 0.1, fy: 0.05 });
  assert.match(matchLocator(ios, 'abc').error, /không đúng dạng/);
  assert.match(matchLocator(ios, '-ios predicate string:name ==').error, /Không đọc được/);
});

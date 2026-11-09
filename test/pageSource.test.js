import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseElements, sameScreen, screenSignature, toPrompt } from '../server/locators/pageSource.js';

const fx = (n) => fs.readFileSync(new URL(`./fixtures/${n}.xml`, import.meta.url), 'utf8');
const welcome = parseElements(fx('welcome'));
const loginEmpty = parseElements(fx('login-empty'));
const loginFilled = parseElements(fx('login-filled'));
const loginError = parseElements(fx('login-error'));

test('Welcome có nút "Continue with email" với locator ~ (name duy nhất trong các Button)', () => {
  const b = welcome.find((e) => e.type === 'Button' && e.name === 'Continue with email');
  assert.ok(b);
  assert.equal(b.locator, '-ios predicate string:type == "XCUIElementTypeButton" AND name == "Continue with email"');
  assert.ok(b.alts.includes('~Continue with email'));
});

test('name duy nhất trên màn → locator ~name', () => {
  const t = welcome.find((e) => e.name === 'OR');
  assert.equal(t.locator, '~OR');
});

test('ô Email không có name → class chain TextField', () => {
  const f = loginEmpty.find((e) => e.type === 'TextField');
  assert.equal(f.locator, '-ios class chain:**/XCUIElementTypeTextField');
  assert.equal(f.label, 'Enter your email'); // placeholder dùng làm nhãn để người / AI nhận ra
});

test('bỏ bàn phím hệ thống và phần tử ẩn', () => {
  assert.ok(!loginFilled.some((e) => e.type === 'Key' || e.name === 'q'));
  assert.ok(!loginFilled.some((e) => e.name === 'Typing Predictions'));
});

test('cùng màn Log In: trống / đã nhập / có lỗi validation', () => {
  assert.equal(sameScreen(loginEmpty, loginFilled), true);
  assert.equal(sameScreen(loginEmpty, loginError), true);
});

test('Welcome khác Log In', () => {
  assert.equal(sameScreen(welcome, loginEmpty), false);
});

test('screenSignature không phụ thuộc giá trị ô nhập', () => {
  assert.equal(screenSignature(loginEmpty), screenSignature(loginFilled));
});

test('toPrompt mỗi phần tử một dòng, có loại và locator', () => {
  const p = toPrompt(loginEmpty);
  assert.match(p, /Button "Continue with email"/);
  assert.match(p, /TextField .*Enter your email/);
});

test('giữ phần tử Other có nhãn accessibility (vd progress bar "Onboarding progress") và ProgressIndicator; bỏ Other không tên / không accessible', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><AppiumAUT><XCUIElementTypeApplication type="XCUIElementTypeApplication" name="T" visible="true" x="0" y="0" width="402" height="874"><XCUIElementTypeWindow type="XCUIElementTypeWindow" visible="true" x="0" y="0" width="402" height="874">
<XCUIElementTypeOther type="XCUIElementTypeOther" value="0%" name="Onboarding progress" label="Onboarding progress" enabled="true" visible="true" accessible="true" x="72" y="85" width="258" height="6"/>
<XCUIElementTypeOther type="XCUIElementTypeOther" enabled="true" visible="true" accessible="false" x="0" y="0" width="402" height="874"/>
<XCUIElementTypeOther type="XCUIElementTypeOther" name="container" label="" enabled="true" visible="true" accessible="false" x="0" y="0" width="402" height="874"/>
<XCUIElementTypeProgressIndicator type="XCUIElementTypeProgressIndicator" value="50%" name="Loading" enabled="true" visible="true" accessible="true" x="10" y="10" width="100" height="4"/>
</XCUIElementTypeWindow></XCUIElementTypeApplication></AppiumAUT>`;
  const els = parseElements(xml);
  assert.deepEqual(els.map((e) => [e.type, e.name, e.value, e.locator]), [['Other', 'Onboarding progress', '0%', '~Onboarding progress'], ['ProgressIndicator', 'Loading', '50%', '~Loading']]);
});

// moss: các màn onboarding cùng bố cục (Back + một câu dài + Continue) bị gộp làm một vì câu > 60 ký tự bị bỏ qua khi so màn
test('sameScreen: màn hướng dẫn cùng bố cục nhưng khác câu (dài) → khác màn; chữ dữ liệu (số, tên) vẫn không tách màn', async () => {
  const { sameScreen } = await import('../server/locators/pageSource.js');
  const page = (title) => [{ type: 'Button', name: 'Back' }, { type: 'StaticText', name: title }, { type: 'Button', name: 'Continue' }];
  assert.equal(sameScreen(page('Your body sends signals every day. Understanding them can make a real difference'), page('This is HRV, which is a key indicator of your stress and overall well-being.')), false);
  assert.equal(sameScreen(page('This is HRV, which is a key indicator of your stress and overall well-being.'), page('This is HRV, which is a key indicator of your stress and overall well-being.')), true);
  const home = (n) => [{ type: 'StaticText', name: `Hi, ${n}` }, { type: 'StaticText', name: 'Your score today 82' }, { type: 'Button', name: 'Home' }, { type: 'Button', name: 'Log' }, { type: 'Button', name: 'Settings' }];
  assert.equal(sameScreen(home('Anna'), home('Ben')), true);
});

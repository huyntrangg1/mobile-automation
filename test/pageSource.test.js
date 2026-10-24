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

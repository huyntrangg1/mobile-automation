// Hộp thoại sửa tay: nhận ra app đang ở màn khác màn bước cần (gốc lỗi ở bước trước)
import test from 'node:test';
import assert from 'node:assert/strict';
import { wrongScreenOf } from '../server/runs/help.js';

const el = (type, name, locator = `~${name}`) => ({ type, name, label: name, locator, alts: [locator] });
const WELCOME = { name: 'Welcome to, Tastory', elements: [el('StaticText', 'Welcome to'), el('Button', 'Get Started'), el('Button', 'Terms of Service'), el('Button', 'Privacy Policy')] };
const GOALS = { name: 'What brings you to Tastory?', aliases: ['Goals'], elements: [el('StaticText', 'What brings you to Tastory?'), el('Button', 'Eat healthier'), el('Button', 'Cook faster'), el('Button', 'Continue')] };
const screens = [WELCOME, GOALS];

test('bước cần màn Goals (locator thuộc Goals) nhưng app đang ở Welcome → báo sai màn kèm tên 2 màn', () => {
  const w = wrongScreenOf({ sel: '~Continue', screen: 'Goals', target: 'Continue' }, WELCOME.elements, screens);
  assert.deepEqual([w.now, w.expected], ['Welcome to, Tastory', 'What brings you to Tastory?']);
});

test('app đúng màn (chỉ thiếu phần tử / locator sai) → không báo sai màn (để tester chọn phần tử)', () => {
  assert.equal(wrongScreenOf({ sel: '~Continue', screen: 'Goals', target: 'Continue' }, GOALS.elements, screens), null);
  // locator không có trong map (tìm theo chữ) → dựa vào tên màn / alias
  assert.equal(wrongScreenOf({ sel: '-ios predicate string:name == "Skip"', screen: 'Goals', target: 'Skip' }, GOALS.elements, screens), null);
});

test('locator không có trong map + app ở màn khác tên → vẫn báo sai màn; màn lạ (không nhận ra) → không đoán', () => {
  const w = wrongScreenOf({ sel: '-ios predicate string:name == "Skip"', screen: 'Goals', target: 'Skip' }, WELCOME.elements, screens);
  assert.deepEqual([w.now, w.expected], ['Welcome to, Tastory', null]);
  assert.equal(wrongScreenOf({ sel: '~Continue', screen: 'Goals', target: 'Continue' }, [el('Button', 'Lạ 1'), el('Button', 'Lạ 2')], screens), null);
});

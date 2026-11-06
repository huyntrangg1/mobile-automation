import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { keywordsNote, locatorText, pickScreens } from '../server/scripts/promptParts.js';
import { tmpDir } from './helpers.js';

const el = (...keys) => keys.map((key) => ({ key, type: 'Button' }));
const TABLE = {
  'What brings you to Tastory?': el('Back', 'Eat healthier', 'Continue'),
  'Become a better cook with Tastory': el('Back', 'Become a better cook with Tastory', 'Continue'),
  'Welcome to Tastory': el('Get Started', 'Log in'),
  'Settings': el('Back', 'Logout'),
};
const ROWS = [
  { step: 1, screen: 'Goals', kind: 'Action', keyword: 'Tap', target: 'Eat healthier', value: '' },
  { step: 1, screen: 'Goals', kind: 'Action', keyword: 'Tap', target: 'Continue', value: '' },
  { step: 2, screen: 'Become a better cook', kind: 'Nav', keyword: 'Verify screen', target: 'Become a better cook', value: '' },
];

test('pickScreens: màn có phần tử trùng Target, tên màn chứa tên màn Excel, chữ trong Pre-condition; bỏ chữ chung chung (Back / Continue)', () => {
  assert.deepEqual(pickScreens(ROWS, TABLE), ['What brings you to Tastory?', 'Become a better cook with Tastory']);
  assert.ok(pickScreens(ROWS, TABLE, { pre: ['Welcome → bấm "Get Started"'] }).includes('Welcome to Tastory'));
  assert.ok(pickScreens([{ screen: 'Cài đặt', target: 'x' }], TABLE, { aliases: { Settings: ['Cài đặt'] } }).includes('Settings'));
});

test('locatorText: màn chọn → đủ phần tử; màn khác → chỉ tên + vài phần tử', () => {
  const t = locatorText(TABLE, ['What brings you to Tastory?']);
  assert.match(t, /## "What brings you to Tastory\?"\n- Button "Back"\n- Button "Eat healthier"/);
  assert.match(t, /## Màn khác[^\n]*\n- "Become a better cook with Tastory": "Back" · /);
  assert.ok(!t.includes('"Logout"\n'));
});

test('keywordsNote: trích đoạn Launch fresh … Select date của keywords.js; không có file → rỗng', (t) => {
  const dir = tmpDir(t);
  assert.equal(keywordsNote(dir), '');
  fs.mkdirSync(path.join(dir, 'src/runner'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/runner/keywords.js'), "x\n    case 'Launch fresh': return a();\n    case 'Tap': b();\n    case 'Select date': return c();\n    case 'number': y\n");
  const n = keywordsNote(dir);
  assert.match(n, /case 'Launch fresh'[\s\S]*case 'Select date'/);
  assert.ok(!n.includes("case 'number'"));
});

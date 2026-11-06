import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { caseScript, exportToSimutil, methodOf, rowCall } from '../server/scripts/simutil.js';
import { tmpDir } from './helpers.js';

const o = { step: 1, screen: 'Welcome', row: 13 };

test('methodOf: keyword Excel → hàm KwRun; không có → null', () => {
  assert.equal(methodOf('Tap'), 'tap');
  assert.equal(methodOf('Verify not selected'), 'verifyNotSelected');
  assert.equal(methodOf('Relaunch app'), 'relaunch');
  assert.equal(methodOf('Verify external URL'), 'verifyExternalUrl');
  assert.equal(methodOf('Handle permission'), 'handlePermission');
  assert.equal(methodOf('Verify layout'), null);
});

test('rowCall: đúng chữ ký từng nhóm, giống script SimUtil tự sinh', () => {
  const c = (r) => rowCall(r, o).code;
  assert.equal(c({ keyword: 'Tap', target: 'Terms of Service' }), 'await t.tap("Terms of Service",{"step":1,"screen":"Welcome","row":13});');
  assert.equal(c({ keyword: 'Launch fresh' }), 'await t.launchFresh({"step":1,"screen":"Welcome","row":13});');
  assert.equal(c({ keyword: 'Verify external URL', target: 'Terms', value: 'https://x', compare: 'contains' }), 'await t.verifyExternalUrl("https://x","contains",{"step":1,"screen":"Welcome","row":13});');
  assert.equal(c({ keyword: 'Verify text', target: 'Title', value: '' }), 'await t.verifyText("Title","equals",{"step":1,"screen":"Welcome","row":13});');
  assert.equal(c({ keyword: 'Verify text', target: 'Title', value: 'Hi' }), 'await t.verifyText("Hi","equals",{"step":1,"screen":"Welcome","row":13,"target":"Title"});');
  assert.equal(c({ keyword: 'Wait until displayed', target: 'Get Started', value: '30' }), 'await t.waitUntilDisplayed("Get Started",30,{"step":1,"screen":"Welcome","row":13});');
  assert.equal(c({ keyword: 'Wait', value: '3' }), 'await t.wait(3,{"step":1,"screen":"Welcome","row":13});');
  assert.equal(c({ keyword: 'Handle permission', target: 'Ask App Not to Track', value: "Don't allow" }), 'await t.handlePermission("Ask App Not to Track","Don\'t allow",{"step":1,"screen":"Welcome","row":13});');
  assert.equal(c({ keyword: 'Verify count', target: 'Goals', value: '5' }), 'await t.verifyCount("Goals",5,"number",{"step":1,"screen":"Welcome","row":13});');
  const u = rowCall({ keyword: 'Verify layout', target: 'Card', value: 'above Continue' }, o);
  assert.ok(u.unsupported);
  assert.equal(u.code, 'await t.unsupported("Verify layout","Card","above Continue",{"step":1,"screen":"Welcome","row":13});');
});

test('caseScript: cú pháp hợp lệ, lọc dòng khác nền tảng, label vào o', () => {
  const c = { tcId: 'TC_1', title: 'Mở "Terms"', pre: ['Tiếp nối TC_0'], rows: [
    { step: 1, screen: 'Welcome', keyword: 'Tap', target: 'Terms', platform: 'All' },
    { step: 1, screen: 'Welcome', keyword: 'Back', platform: 'Android' },
    { step: 2, screen: 'Welcome', keyword: 'Verify displayed', target: 'Get Started', label: 'Quay lại', platform: 'iOS' },
  ] };
  const s = caseScript(c, { project: 'p', source: 'f.xlsx', platform: 'iOS', caseRow: 10 });
  assert.equal(s.rows, 2);
  assert.ok(s.code.startsWith('// @kwcase TC_1\n// @source f.xlsx'));
  assert.ok(!s.code.includes('t.back('));
  assert.ok(s.code.includes('await t.verifyDisplayed("Get Started",{"step":2,"screen":"Welcome","row":12,"label":"Quay lại"});'));
  const f = path.join(tmpDir(), 'TC_1.js');
  fs.writeFileSync(f, s.code);
  execFileSync(process.execPath, ['--check', f]);
});

test('exportToSimutil: ghi project, xoá script cũ, copy Excel, gắn bundle id vào scenario.json', () => {
  const home = tmpDir();
  fs.writeFileSync(path.join(home, 'scenario.json'), JSON.stringify({ project: 'x', projectAppIds: { x: { android: '', ios: 'a' } } }));
  const excel = path.join(tmpDir(), 'onb.xlsx');
  fs.writeFileSync(excel, 'xlsx');
  const app = { id: 'tastory', name: 'Tastory 1.0.4', platform: 'iOS', bundleId: 'com.x' };
  const cases = [
    { tcId: 'TC_B', order: 1, rows: [{ step: 1, screen: 'S', keyword: 'Verify layout', target: 'a' }] },
    { tcId: 'TC_A', order: 0, rows: [{ step: 1, screen: 'S', keyword: 'Tap', target: 'a' }] },
  ];
  const old = path.join(home, 'projects/tastory-1.0.4-onb/scripts/TC_OLD.js');
  fs.mkdirSync(path.dirname(old), { recursive: true });
  fs.writeFileSync(old, '');
  const r = exportToSimutil(app, 'onb', cases, { home, excel });
  assert.equal(r.project, 'tastory-1.0.4-onb');
  assert.equal(r.replaced, true);
  assert.deepEqual(fs.readdirSync(path.join(r.dir, 'scripts')).sort(), ['TC_A.js', 'TC_B.js']);
  assert.ok(fs.existsSync(path.join(r.dir, 'testcases/onb.xlsx')));
  assert.deepEqual(r.unsupported, { TC_B: ['Verify layout'] });
  // TC_A đứng trước (order 0) → caseRow nhỏ hơn
  const row = (f) => Number(/"caseRow": (\d+)/.exec(fs.readFileSync(path.join(r.dir, 'scripts', f), 'utf8'))[1]);
  assert.ok(row('TC_A.js') < row('TC_B.js'));
  const s = JSON.parse(fs.readFileSync(path.join(home, 'scenario.json'), 'utf8'));
  assert.equal(s.project, 'x');
  assert.deepEqual(s.projectAppIds['tastory-1.0.4-onb'], { android: '', ios: 'com.x' });
  assert.deepEqual(s.projectAppIds.x, { android: '', ios: 'a' });
});

test('exportToSimutil: không có case → lỗi 400', () => {
  assert.throws(() => exportToSimutil({ id: 'a' }, 'f', [], { home: tmpDir() }), (e) => e.status === 400);
});

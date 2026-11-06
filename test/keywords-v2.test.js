// Bộ keyword v2: Compare, biến {{tên}}, sheet Flows / Run flow, Platform ở dòng Case, các hàm k mới
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { compareValues, expectLabel, fillVars, generateValue, numberIn, parseDate } from '../server/apps/template/src/runner/compare.js';
import { expandFlow, loadV2 } from '../server/apps/template/data/loaders/testcase-v2.js';
import { tmpDir } from './helpers.js';

test('Compare: đủ các kiểu của bộ v2; kiểu lạ → lỗi (không pass âm thầm)', () => {
  const ok = (a, e, c) => compareValues(a, e, c);
  assert.ok(ok('Hello', 'Hello', '') && ok('Hello', 'Hello', 'equals') && !ok('Hello', 'hello', 'equals'));
  assert.ok(ok('Hello', 'Bye', 'not equals') && ok('Hello world', 'world', 'contains') && ok('Hello', 'x', 'not contains'));
  assert.ok(ok('Today 08:30', '^Today \\d{2}:\\d{2}$', 'regex'));
  assert.ok(ok('12 recipes', '10', 'greater than') && ok('10', '10', 'greater or equal') && ok('3', '5', 'less than') && ok('5', '5', 'less or equal'));
  assert.ok(ok('', '', 'empty') && ok('x', '', 'not empty') && !ok('x', '', 'empty'));
  assert.ok(ok('80,5', '80.5', 'number') && ok('1,498', '1498', 'number'));
  assert.ok(ok('5 m', '5m', 'unit') && !ok('5 m', '5 km', 'unit'));
  assert.ok(ok('05/03/2026', '5/3/2026', 'date:DD/MM/YYYY') && ok('Mar 5, 2026', 'March 5, 2026', 'date:MMM D, YYYY'));
  assert.ok(!ok(null, 'x', 'equals'));
  assert.throws(() => ok('a', 'b', 'roughly'), /Compare "roughly" không hỗ trợ/);
  assert.equal(expectLabel('world', 'contains'), 'contains "world"');
  assert.equal(expectLabel('Hello', ''), 'Hello');
  assert.equal(numberIn('Total: 1,250 kcal'), 1250);
  assert.equal(parseDate('Mar 5, 2026', 'MMM D, YYYY'), '2026-03-05');
  assert.equal(parseDate('5-3-2026', 'DD/MM/YYYY'), null);
});

test('Biến {{tên}}: thay trong Value; thiếu biến → lỗi rõ tên; Generate data đúng dạng', () => {
  assert.equal(fillVars('Hi {{ name }}, mã {{code}}', { name: 'An', code: 7 }), 'Hi An, mã 7');
  assert.throws(() => fillVars('{{email}}', {}), /Chưa có biến \{\{email\}\}/);
  assert.match(generateValue('email'), /^qa\.[0-9a-f]{8}@example\.com$/);
  assert.match(generateValue('phone'), /^09\d{8}$/);
  assert.match(generateValue('uuid'), /^[0-9a-f-]{36}$/);
  assert.throws(() => generateValue('ssn'), /không hỗ trợ/);
});

test('Run flow: thay bằng dòng của luồng tại chỗ gọi (Step của dòng gọi), luồng lồng nhau, chặn vòng lặp', () => {
  const flows = {
    'Qua Goals': [{ step: 1, screen: 'Welcome', kind: 'Action', keyword: 'Tap', target: 'Get Started', platform: 'All' }, { step: 2, keyword: 'Run flow', value: 'Chọn goal', platform: 'All' }],
    'Chọn goal': [{ step: 1, screen: 'Goals', kind: 'Action', keyword: 'Tap', target: 'Eat healthier', platform: 'All' }],
    Lặp: [{ step: 1, keyword: 'Run flow', value: 'Lặp', platform: 'All' }],
  };
  const rows = expandFlow({ step: 3, keyword: 'Run flow', value: 'Qua Goals', platform: 'iOS' }, flows);
  assert.deepEqual(rows.map((r) => [r.step, r.target, r.platform]), [[3, 'Get Started', 'iOS'], [3, 'Eat healthier', 'iOS']]);
  assert.throws(() => expandFlow({ step: 1, keyword: 'Run flow', value: 'Không có', platform: 'All' }, flows), /không có luồng này/);
  assert.throws(() => expandFlow({ step: 1, keyword: 'Run flow', value: 'Lặp', platform: 'All' }, flows), /gọi lại chính nó/);
});

test('loadV2: đọc sheet Flows (Run flow được thay) và Platform ở dòng Case', async () => {
  const wb = new ExcelJS.Workbook();
  const head = ['TC ID', 'Title', 'Priority', 'Pre-condition', 'Data Set', 'Step', 'Screen', 'Kind', 'Keyword', 'Target', 'Value', 'Compare', 'Platform', 'Check label'];
  const tc = wb.addWorksheet('TestCases');
  tc.addRow(head);
  tc.addRow(['TC_1', 'Offline import', 'High', 'Cài lại app', '', '', '', 'Case', '', '', '', '', 'Android', '']);
  tc.addRow(['', '', '', '', '', 1, '', 'Action', 'Run flow', '', 'Vào Goals', '', '', '']);
  tc.addRow(['', '', '', '', '', 2, 'Goals', 'Check', 'Verify displayed', 'Continue', '', '', '', 'Continue hiện']);
  const fl = wb.addWorksheet('Flows');
  fl.addRow(['Flow', 'Step', 'Screen', 'Kind', 'Keyword', 'Target', 'Value', 'Compare', 'Platform', 'Check label']);
  fl.addRow(['Vào Goals', 1, 'Welcome', 'Action', 'Tap', 'Get Started', '', '', '', '']);
  const file = path.join(tmpDir(), 'f.xlsx');
  await wb.xlsx.writeFile(file);
  const { testcases } = await loadV2(file);
  assert.equal(testcases[0].platform, 'Android');
  assert.deepEqual(testcases[0].rows.map((r) => [r.step, r.screen, r.keyword, r.target]), [[1, 'Welcome', 'Tap', 'Get Started'], [2, 'Goals', 'Verify displayed', 'Continue']]);
});

// ===== Hàm k trên thiết bị giả =====
async function kWith(dev) {
  const eqs = [];
  const logs = [];
  globalThis.driver = { isAndroid: false, pause: async () => {}, waitUntil: async (fn) => fn(), ...dev.driver };
  globalThis.$ = dev.$;
  globalThis.$$ = dev.$$ || (async () => []);
  const { createSteps } = await import('../server/apps/template/src/runner/steps.js');
  const vars = {};
  const k = createSteps({ sa: { eq: (...a) => eqs.push(a) }, logStep: (e) => logs.push(e), snapshot: async () => ({}), env: { BUNDLE_ID: 'com.x' }, cwd: tmpDir(), vars });
  return { k, eqs, logs, vars };
}
const el = (attrs = {}, extra = {}) => ({ waitForExist: async () => {}, isDisplayed: async () => true, getAttribute: async (a) => attrs[a] ?? null, getText: async () => attrs.text ?? '', getLocation: async () => ({ y: attrs.y ?? 0 }), click: async () => extra.onClick?.(), elementId: 'E1', ...extra });

test('k.count / k.order: tự cuộn gom hết danh sách (mục trùng tính 1), rồi cuộn lại lên', async () => {
  const pages = [['A', 'B', 'C'], ['C', 'D'], ['D']];
  let p = 0;
  const execs = [];
  const { k, eqs } = await kWith({
    driver: { execute: async (cmd, o) => { execs.push([cmd, o?.direction]); if (cmd === 'mobile: scroll' && o.direction === 'down') p = Math.min(p + 1, pages.length - 1); } },
    $: () => el(),
    $$: async () => pages[p].map((t, i) => el({ label: t, y: i })),
  });
  await k.count(1, 'Recipe', 'Nguyên liệu', 'Đủ 4 nguyên liệu', '~item', '4');
  p = 0;
  await k.order(1, 'Recipe', 'Nguyên liệu', 'Thứ tự', '~item', 'A; B; C; D');
  assert.deepEqual(eqs.map((e) => [e[2], e[3]]), [['4', '4'], ['A;B;C;D', 'A;B;C;D']]);
  assert.ok(execs.some(([c, d]) => c === 'mobile: scroll' && d === 'up'));
});

test('k.notShown within: chờ ngược đúng số giây; k.toggle chỉ bấm khi sai trạng thái', async () => {
  let waited = 0;
  let on = '0';
  let clicks = 0;
  const { k, eqs } = await kWith({
    driver: { execute: async () => [] },
    $: (sel) => (sel === '~next' ? { waitForExist: async ({ timeout }) => { waited = timeout; throw new Error('x'); } } : el({ value: on }, { onClick: () => { clicks++; on = on === '1' ? '0' : '1'; } })),
  });
  await k.notShown(1, 'Goals', 'Màn tiếp', 'Không chuyển màn', '~next', { within: 3 });
  assert.equal(waited, 3000);
  assert.deepEqual([eqs[0][2], eqs[0][3]], [false, false]);
  await k.toggle(2, 'Settings', 'Reminders', '~sw', 'on');
  await k.toggle(2, 'Settings', 'Reminders', '~sw', 'on');
  assert.equal(clicks, 1);
});

test('k.saveValue + fill: biến dùng ở dòng sau; k.appOpened; Run setup thiếu hook → lỗi rõ', async () => {
  const { k, eqs, vars } = await kWith({
    driver: { execute: async (cmd) => (cmd === 'mobile: queryAppState' ? 4 : null) },
    $: () => el({ label: 'Red thai curry' }),
  });
  await k.saveValue(1, 'Recipe', 'Tên món', '~title', 'recipe');
  assert.equal(vars.recipe, 'Red thai curry');
  assert.equal(k.fill('Món: {{recipe}}'), 'Món: Red thai curry');
  await k.appOpened(2, 'Home', 'Tastory đang mở', 'com.x');
  assert.deepEqual([eqs[0][2], eqs[0][3]], ['com.x', 'com.x']);
  await assert.rejects(k.runSetup(3, 'Home', 'seed'), /Chưa khai báo hook setup "seed" trong src\/hooks\.js/);
});

test('k.text: chữ đang đổi (slide tự chuyển) → đọc lại tới khi khớp; hết giờ vẫn sai thì báo chữ đọc cuối', async () => {
  const seq = ['Step 1 of 3', 'Step 1 of 3', 'Step 2 of 3'];
  let i = 0;
  const { k, eqs } = await kWith({ driver: {}, $: () => el({}, { getAttribute: async (a) => (a === 'label' ? seq[Math.min(i++, seq.length - 1)] : null) }) });
  await k.text(1, 'Tutorial', 'Step', 'Sang bước 2', '~step', 'Step 2 of 3');
  await k.text(1, 'Tutorial', 'Step', 'Không có bước 4', '~step', 'Step 4 of 3', { timeout: 400 });
  assert.deepEqual(eqs.map((e) => [e[2], e[3]]), [['Step 2 of 3', 'Step 2 of 3'], ['Step 2 of 3', 'Step 4 of 3']]);
});

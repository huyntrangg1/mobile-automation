import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildScript, readRegions, helperModules } from '../server/scripts/scriptFile.js';
import { IK_FITNESS } from '../server/paths.js';
import { tmpDir } from './helpers.js';

const HELPERS = [{ ns: 'ui', rel: 'src/utils/ui.js' }, { ns: 'app', rel: 'src/utils/app.js' }];
const BODY_A = "async ({ tc, data, sa, fill }) => {\n  await ui.tap(L['Welcome']['Continue with email']);\n}";
const BODY_B = "async ({ tc, data, sa, fill }) => {\n  sa.eq(1, 'Đang ở Log In', true, true);\n}";

test('buildScript: region theo thứ tự Excel, file hợp lệ cú pháp', () => {
  const code = buildScript({ file: 'auth', order: ['TC_A', 'TC_B', 'TC_C'], regions: { TC_B: BODY_B, TC_A: BODY_A }, helpers: HELPERS, pack: null });
  assert.ok(code.indexOf('#region TC_A') < code.indexOf('#region TC_B'));
  assert.ok(!code.includes('#region TC_C'));
  const f = path.join(tmpDir(), 'auth.e2e.js');
  fs.writeFileSync(f, code);
  execFileSync(process.execPath, ['--check', f]);
});

test('readRegions(buildScript(...)) trả lại đúng từng ký tự', () => {
  const code = buildScript({ file: 'auth', order: ['TC_A', 'TC_B'], regions: { TC_A: BODY_A, TC_B: BODY_B }, helpers: HELPERS, pack: null });
  assert.deepEqual(readRegions(code), { TC_A: BODY_A, TC_B: BODY_B });
});

test('region sửa tay được giữ khi build lại', () => {
  const code = buildScript({ file: 'auth', order: ['TC_A', 'TC_B'], regions: { TC_A: BODY_A, TC_B: BODY_B }, helpers: HELPERS, pack: null });
  const edited = code.replace("sa.eq(1, 'Đang ở Log In', true, true);", "sa.eq(1, 'Đang ở Log In', true, true); // sửa tay");
  const again = buildScript({ file: 'auth', order: ['TC_A', 'TC_B'], regions: { ...readRegions(edited), TC_A: BODY_A }, helpers: HELPERS, pack: null });
  assert.match(readRegions(again).TC_B, /sửa tay/);
});

test('import helper dạng namespace; pack ik-fitness có ensureAccounts', () => {
  const code = buildScript({ file: 'auth', order: [], regions: {}, helpers: HELPERS, pack: 'ik-fitness' });
  assert.match(code, /import \* as ui from '\.\.\/src\/utils\/ui\.js';/);
  assert.match(code, /ensureAccounts/);
  assert.ok(!/runTestcase/.test(code));
});

test('helperModules liệt kê module + export của helper pack, đặt namespace không trùng', (t) => {
  if (!fs.existsSync(IK_FITNESS)) return t.skip('không có ../ik-fitness');
  const ws = tmpDir();
  for (const d of ['src/utils', 'src/pages', 'src/components', 'src/flows', 'src/locators']) fs.cpSync(path.join(IK_FITNESS, d), path.join(ws, d), { recursive: true });
  const mods = helperModules(ws);
  const ns = mods.map((m) => m.ns);
  assert.equal(new Set(ns).size, ns.length);
  const ui = mods.find((m) => m.rel === 'src/utils/ui.js');
  assert.equal(ui.ns, 'ui');
  assert.ok(ui.exports.includes('tap'));
  assert.ok(mods.some((m) => m.rel === 'src/pages/index.js'));
  assert.ok(!mods.some((m) => /softAssert|evidence/.test(m.rel))); // đã import riêng trong khung
});

test('khung: có RUN_CASES → it() cho đúng các case đó (thiếu region → Blocked); không có → mọi case có region; mọi case đều planTest', async () => {
  const code = buildScript({ file: 'auth', order: ['TC_A', 'TC_B'], regions: { TC_A: BODY_A, TC_B: BODY_B }, helpers: HELPERS, pack: null });
  assert.match(code, /RUN_CASES/);
  assert.match(code, /planTest\(/);
  assert.match(code, /if \(RUN\.length \? !RUN\.includes\(tc\.id\) : !CASES\[tc\.id\]\) continue;/);
});

test('export không trùng giữa các module được import thẳng theo tên (AI hay gọi CreateAccountPage trực tiếp)', () => {
  const helpers = [
    { ns: 'pages', rel: 'src/pages/index.js', exports: ['CreateAccountPage', 'AccountCreatedPage'] },
    { ns: 'ui', rel: 'src/utils/ui.js', exports: ['tap', 'el'] },
    { ns: 'other', rel: 'src/utils/other.js', exports: ['tap', 'L'] },
  ];
  const code = buildScript({ file: 'auth', order: [], regions: {}, helpers, pack: null });
  assert.match(code, /import \{ CreateAccountPage, AccountCreatedPage \} from '\.\.\/src\/pages\/index\.js';/);
  assert.match(code, /import \{ el \} from '\.\.\/src\/utils\/ui\.js';/); // tap trùng 2 module → chỉ qua namespace
  assert.ok(!/import \{[^}]*\bL\b[^}]*\} from '\.\.\/src\/utils\/other\.js'/.test(code)); // L là tên của khung
  const f = path.join(tmpDir(), 'auth.e2e.js');
  fs.writeFileSync(f, code);
  execFileSync(process.execPath, ['--check', f]);
});

test('khung ghi từng bước ra file live (LIVE_STEPS) — logStep và sa.eq đều được ghi, không ghi ảnh evidence', async () => {
  const code = buildScript({ file: 'f', order: ['TC_A'], regions: { TC_A: GOOD_LIVE }, helpers: [], pack: null });
  assert.match(code, /process\.env\.LIVE_STEPS/);
  assert.match(code, /import \{ setCase, planTest, logStep as reportLogStep, addFlowBug, noteScreen, resetCurrent \}/);
  assert.match(code, /live\(\{ type: 'start', tc: tc\.id \}\)/);
  assert.match(code, /live\(\{ type: 'end', tc: tc\.id/);
  assert.ok(!/ev[,)].*live\(/.test(code));
  const f = path.join(tmpDir(), 'f.e2e.js');
  fs.writeFileSync(f, code);
  execFileSync(process.execPath, ['--check', f]);
});
const GOOD_LIVE = "async ({ tc, data, sa, fill }) => {\n  logStep({ kind: 'Action', step: 1, keyword: 'Tap', target: 'X', ok: true });\n}";

test('khung chờ khi có file PAUSE_FILE trước mỗi case (không cắt giữa case), giữ phiên Appium, ghi live paused/resumed', () => {
  const code = buildScript({ file: 'f', order: ['TC_A'], regions: { TC_A: GOOD_LIVE }, helpers: [], pack: null });
  assert.match(code, /process\.env\.PAUSE_FILE/);
  assert.match(code, /beforeEach\(async function \(\) \{/);
  assert.match(code, /this\.timeout\(0\)/);
  assert.match(code, /live\(\{ type: 'paused' \}\)/);
  assert.match(code, /live\(\{ type: 'resumed' \}\)/);
  assert.match(code, /driver\.getWindowRect\(\)/);
});

test('khung truyền k = createSteps(...) vào case (bước dùng chung src/runner/steps.js)', () => {
  const code = buildScript({ file: 'auth', order: ['TC_A'], regions: { TC_A: BODY_A }, helpers: HELPERS, pack: null });
  assert.match(code, /import \{ createSteps \} from '\.\.\/src\/runner\/steps\.js';/);
  assert.match(code, /k: createSteps\(\{ sa, logStep, snapshot, flowBug: addFlowBug, noteScreen, summarize: screenSummary, tc: tc\.id, vars \}\)/);
  assert.match(code, /const fill = \(v\) => fillVars\(fillValue\(v, data\), vars\);/);
  assert.match(code, /import \{ setCase, planTest, logStep as reportLogStep, addFlowBug, noteScreen, resetCurrent \} from '\.\.\/src\/report\/collector\.js';/);
  assert.match(code, /import \{ screenSummary \} from '\.\.\/src\/report\/hooks\.js';/);
});

test('steps.js: nav ném đúng mẫu câu lỗi report đọc được; text so equals / contains', async () => {
  const exists = new Set(['ok']);
  globalThis.driver = { isAndroid: false };
  globalThis.$ = (sel) => ({ waitForExist: async () => { if (!exists.has(sel)) throw new Error('x'); }, getAttribute: async (a) => (a === 'label' ? 'Hello world' : null) });
  const { createSteps } = await import('../server/apps/template/src/runner/steps.js');
  const eqs = [];
  const k = createSteps({ sa: { eq: (...a) => eqs.push(a) }, logStep: () => {}, snapshot: async () => ({ k: null }) });
  await assert.rejects(k.nav('Awesome', 'missing', 'nút "Show me how"', 10), /^Error: Không tới được màn Awesome: không thấy nút "Show me how" sau 0.01s$/);
  await k.text(1, 'S', 'Title', 'lbl', 'ok', 'Hello world');
  await k.text(1, 'S', 'Title', 'lbl', 'ok', 'world', { compare: 'contains' });
  await k.text(1, 'S', 'Title', 'lbl', 'ok', 'Bye');
  // contains: report ghi rõ kiểu so ("contains …") thay vì chỉ giá trị
  assert.deepEqual(eqs.map((e) => [e[2], e[3]]), [['Hello world', 'Hello world'], ['contains "world"', 'contains "world"'], ['Hello world', 'Bye']]);
  delete globalThis.driver; delete globalThis.$;
});

test('steps.js: text ghép nhiều phần tử + strip; gone / alert báo đúng mẫu câu lỗi; alert bấm nút và ghi bước', async () => {
  const texts = { a: 'Recipe imported successfully!', b: '✨ Just like magic ✨' };
  let alertUp = false;
  const accepted = [];
  globalThis.driver = {
    isAndroid: false,
    waitUntil: async (fn, { timeout }) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timeout'); },
    execute: async (cmd, o) => { if (o.action === 'getButtons') return alertUp ? ['Don’t Allow', 'Allow'] : []; accepted.push(o.buttonLabel); return null; },
  };
  globalThis.$ = (sel) => ({ waitForExist: async () => { if (!(sel in texts)) throw new Error('x'); }, getAttribute: async (k) => (k === 'label' ? texts[sel] : null) });
  const { createSteps } = await import('../server/apps/template/src/runner/steps.js');
  const eqs = [];
  const steps = [];
  const k = createSteps({ sa: { eq: (...a) => eqs.push(a) }, logStep: (e) => steps.push(e), snapshot: async () => ({ k: null }) });
  await k.text(6, 'Recipe imported', 'Title', 'lbl', ['a', 'b'], 'Recipe imported successfully! Just like magic', { strip: '✨' });
  assert.deepEqual(eqs.at(-1).slice(2, 4), ['Recipe imported successfully! Just like magic', 'Recipe imported successfully! Just like magic']);
  await assert.rejects(k.gone('Tutorial social', 'a', 'chữ "Step 1 of 3"', 20), /^Error: Không tới được màn Tutorial social: chữ "Step 1 of 3" vẫn còn sau 0.02s$/);
  await assert.rejects(k.alert(8, 'Permission dialog', 'Allow', { timeout: 20 }), /^Error: Không tới được màn Permission dialog: không thấy hộp thoại hệ thống "Cho phép" sau 0.02s$/);
  alertUp = true;
  await k.alert(8, 'Permission dialog', 'Allow', { label: 'Dialog xin quyền hiện' });
  assert.deepEqual(accepted, ['Allow']);
  assert.equal(eqs.at(-1)[1], 'Dialog xin quyền hiện');
  assert.deepEqual(steps.at(-1), { kind: 'Action', step: 8, screen: 'Permission dialog', keyword: 'Tap', target: 'Allow', value: '', ok: true });
  delete globalThis.driver; delete globalThis.$;
});

test('khung: lỗi không phải điểm kiểm → phục hồi (cài lại app, chạy lại case trước không ghi report) rồi thử lại; sửa tay thì tắt', async () => {
  const code = buildScript({ file: 'auth', order: ['TC_A', 'TC_B'], regions: { TC_A: BODY_A, TC_B: BODY_B }, helpers: HELPERS, pack: null });
  assert.match(code, /process\.env\.MANUAL_FIX === '1' \? 0 : Number\(process\.env\.AUTO_RECOVER \?\? 1\)/);
  assert.match(code, /e\.name !== 'AssertionError' && attempt < RECOVER/);
  assert.match(code, /await recoverTo\(tc, say\)/);
  assert.match(code, /resetCurrent\(\)/); // bỏ bước đã ghi của lần lỗi
  assert.match(code, /logStep: \(\) => \{\}/); // chạy lại case trước không ghi report
  const f = path.join(tmpDir(), 'x.mjs');
  fs.writeFileSync(f, code);
  execFileSync(process.execPath, ['--check', f]); // cú pháp hợp lệ
});

test('khung: case Tiếp nối bị chặn → cài lại app + đi theo sơ đồ màn tới màn bắt đầu (không có đường → vẫn Blocked); ghi vào Pre-condition', async () => {
  const code = buildScript({ file: 'auth', order: ['TC_A', 'TC_B'], regions: { TC_A: BODY_A, TC_B: BODY_B }, helpers: HELPERS, pack: null });
  assert.match(code, /import \{ findPath, walkPath \} from '\.\.\/src\/runner\/navgraph\.js';/);
  assert.match(code, /process\.env\.AUTO_NAVIGATE !== '0'/);
  assert.match(code, /if \(blockedBy && !\(await navigateStart\(tc, meta, say\)\)\) throw new Error/);
  assert.match(code, /meta\.precondition = \[/);
  const f = path.join(tmpDir(), 'n.mjs');
  fs.writeFileSync(f, code);
  execFileSync(process.execPath, ['--check', f]);
});

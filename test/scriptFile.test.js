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
  assert.match(code, /import \{ setCase, planTest, logStep as reportLogStep \}/);
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

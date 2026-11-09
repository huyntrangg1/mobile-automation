import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspace } from '../server/apps/workspace.js';
import { IK_FITNESS, TEST_REPORT_SKILL } from '../server/paths.js';
import { tmpDir } from './helpers.js';

const fakeInstall = () => {
  const calls = [];
  return { calls, impl: async (cmd, args, cwd) => { calls.push({ cmd, args, cwd }); } };
};

test('helper pack ik-fitness: có wdio.conf.js, page objects, gọi install.sh --force rồi npm install', async (t) => {
  if (!fs.existsSync(IK_FITNESS)) return t.skip('không có ../ik-fitness');
  const root = tmpDir();
  const { calls, impl } = fakeInstall();
  const dir = await createWorkspace({ id: 'ikf', helperPack: 'ik-fitness' }, { root, installImpl: impl });
  assert.equal(dir, path.join(root, 'ikf'));
  for (const f of ['wdio.conf.js', 'package.json', 'config/capabilities/ios.caps.js', 'src/utils/ui.js', 'src/pages/index.js',
    'src/runner/fixtures.js', 'data/loaders/testcase-v2.js', 'data/fixtures/accounts.js', 'locators/map.js']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `thiếu ${f}`);
  }
  assert.deepEqual(calls[0], { cmd: 'bash', args: [path.join(TEST_REPORT_SKILL, 'scripts/install.sh'), dir, '--force'], cwd: dir });
  assert.equal(calls[1].cmd, 'npm');
  assert.equal(calls[1].args[0], 'install');
});

test('không helper pack: có loader + ui.js chung, không có page objects', async () => {
  const root = tmpDir();
  const dir = await createWorkspace({ id: 'g', helperPack: null }, { root, installImpl: fakeInstall().impl });
  assert.ok(fs.existsSync(path.join(dir, 'data/loaders/testcase-v2.js')));
  assert.ok(fs.existsSync(path.join(dir, 'src/utils/ui.js')));
  assert.ok(fs.existsSync(path.join(dir, 'src/utils/app.js')));
  assert.ok(!fs.existsSync(path.join(dir, 'src/pages')));
});

test('không sửa ik-fitness: file nguồn giữ nguyên mtime', async (t) => {
  if (!fs.existsSync(IK_FITNESS)) return t.skip('không có ../ik-fitness');
  const f = path.join(IK_FITNESS, 'src/utils/app.js');
  const before = fs.statSync(f).mtimeMs;
  await createWorkspace({ id: 'x', helperPack: 'ik-fitness' }, { root: tmpDir(), installImpl: fakeInstall().impl });
  assert.equal(fs.statSync(f).mtimeMs, before);
});

test('upgradeWorkspace: workspace cũ thiếu steps.js → copy từ template; thiếu export report → cài lại report; đủ thì không làm gì', async () => {
  const { upgradeWorkspace } = await import('../server/apps/workspace.js');
  const ws = tmpDir();
  const w = (f, s) => { fs.mkdirSync(path.dirname(path.join(ws, f)), { recursive: true }); fs.writeFileSync(path.join(ws, f), s); };
  w('src/runner/describe.js', 'export function describeCase() {}');
  w('src/report/collector.js', 'export function setCase() {}');
  w('src/report/hooks.js', 'export async function screenSummary() {}');
  const inst = fakeInstall();
  const fixed = await upgradeWorkspace({ workspace: ws }, { installImpl: inst.impl });
  // steps.js cần ui.js (workspace chưa có) → chép kèm, không để Run lỗi vì thiếu file
  assert.deepEqual(fixed, ['src/runner/steps.js', 'src/utils/ui.js', 'src/runner/compare.js', 'src/runner/limit.js', 'src/runner/layout.js', 'src/runner/ocr.js', 'src/runner/navgraph.js',
    'config/capabilities/ios.caps.js', 'src/report/*']);
  assert.ok(fs.existsSync(path.join(ws, 'src/runner/ocr.swift'))); // file đi kèm ocr.js
  assert.match(fs.readFileSync(path.join(ws, 'src/runner/steps.js'), 'utf8'), /export function createSteps/);
  assert.equal(inst.calls.length, 1);
  assert.ok(inst.calls[0].args[0].endsWith('scripts/install.sh'));
  w('src/report/collector.js', 'export function addFlowBug() {}\nexport function resetCurrent() {}\nexport { noteScreen };');
  assert.deepEqual(await upgradeWorkspace({ workspace: ws }, { installImpl: inst.impl }), []);
});

test('upgradeWorkspace: caps cũ (tắt app khi xong case — chạy case để giữ app mở cần giữ app mở) → thay bằng template, giữ .bak', async () => {
  const { upgradeWorkspace } = await import('../server/apps/workspace.js');
  const TPL = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/apps/template');
  const ws = tmpDir();
  fs.cpSync(TPL, ws, { recursive: true });
  for (const f of ['src/report/collector.js', 'src/report/hooks.js']) { fs.mkdirSync(path.dirname(path.join(ws, f)), { recursive: true }); }
  fs.writeFileSync(path.join(ws, 'src/report/collector.js'), 'export function addFlowBug() {}\nexport function resetCurrent() {}\nexport { noteScreen };');
  fs.writeFileSync(path.join(ws, 'src/report/hooks.js'), 'export async function screenSummary() {}');
  const caps = path.join(ws, 'config/capabilities/ios.caps.js');
  const oldCaps = 'export const iosCaps = {}; // cũ';
  fs.writeFileSync(caps, oldCaps);
  const fixed = await upgradeWorkspace({ workspace: ws }, { installImpl: async () => {} });
  // caps không phải bản template nào (sửa tay) → vẫn thay nhưng báo rõ thay đổi riêng nằm ở .bak
  assert.equal(fixed.length, 1);
  assert.match(fixed[0], /^config\/capabilities\/ios\.caps\.js đã sửa tay → thay bằng template.*ios\.caps\.js\.bak/);
  assert.match(fs.readFileSync(caps, 'utf8'), /KEEP_APP_OPEN/);
  assert.equal(fs.readFileSync(`${caps}.bak`, 'utf8'), oldCaps);
  // wdio.conf.js / steps.js của template không còn bước so Figma trong lần chạy test case
  assert.doesNotMatch(fs.readFileSync(path.join(ws, 'wdio.conf.js'), 'utf8'), /designCheck/);
  assert.doesNotMatch(fs.readFileSync(path.join(ws, 'src/runner/steps.js'), 'utf8'), /captureScreen/);
});

test('upgradeWorkspace: steps.js đã có (helper pack / sửa tay) nhưng thiếu export → báo Chuẩn bị lại, không ghi đè', async () => {
  const { upgradeWorkspace } = await import('../server/apps/workspace.js');
  const ws = tmpDir();
  fs.mkdirSync(path.join(ws, 'src/runner'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'src/runner/steps.js'), '// bản cũ');
  await assert.rejects(upgradeWorkspace({ workspace: ws }, { installImpl: async () => {} }), /Chuẩn bị lại/);
  assert.equal(fs.readFileSync(path.join(ws, 'src/runner/steps.js'), 'utf8'), '// bản cũ');
});

// Workspace cũ: steps.js là bản template cũ (được cập nhật) nhưng ui.js cũ thiếu hàm bản mới dùng → ui.js (chưa sửa tay) cũng phải cập nhật;
// ui.js đã sửa tay mà thiếu export → báo rõ, không ghi đè
test('upgradeWorkspace: cập nhật steps.js kéo theo file nó cần (bản cũ chưa sửa tay); file đã sửa tay thiếu export → ghi chú', async () => {
  const { upgradeWorkspace, recordTemplate } = await import('../server/apps/workspace.js');
  const TPL = path.join(path.dirname(new URL(import.meta.url).pathname), '../server/apps/template');
  const ws = tmpDir();
  fs.cpSync(TPL, ws, { recursive: true });
  // bản "cũ" đã ghi hash lúc tạo workspace: steps.js + ui.js cũ
  fs.writeFileSync(path.join(ws, 'src/runner/steps.js'), '// steps cũ\nexport function createSteps() {}\n');
  fs.writeFileSync(path.join(ws, 'src/utils/ui.js'), 'export async function el() {}\n');
  recordTemplate(ws, ['src/runner/steps.js', 'src/utils/ui.js'], { template: ws });
  for (const f of ['src/report/collector.js', 'src/report/hooks.js']) fs.mkdirSync(path.dirname(path.join(ws, f)), { recursive: true });
  fs.writeFileSync(path.join(ws, 'src/report/collector.js'), 'export function addFlowBug() {}\nexport function resetCurrent() {}\nexport function setCase() {}\nexport { noteScreen };');
  fs.writeFileSync(path.join(ws, 'src/report/hooks.js'), 'export async function screenSummary() {}');
  const fixed = await upgradeWorkspace({ workspace: ws }, { installImpl: async () => {} });
  assert.ok(fixed.some((f) => f.startsWith('src/runner/steps.js')), fixed.join('|'));
  assert.ok(fixed.includes('src/utils/ui.js'), fixed.join('|'));
  assert.equal(fs.readFileSync(path.join(ws, 'src/utils/ui.js'), 'utf8'), fs.readFileSync(path.join(TPL, 'src/utils/ui.js'), 'utf8'));
  // lần 2: ui.js bị sửa tay, thiếu export → ghi chú, không ghi đè
  fs.writeFileSync(path.join(ws, 'src/runner/steps.js'), '// steps cũ 2\nexport function createSteps() {}\n');
  recordTemplate(ws, ['src/runner/steps.js'], { template: ws });
  fs.writeFileSync(path.join(ws, 'src/utils/ui.js'), 'export async function el() {} // sửa tay\n');
  const fixed2 = await upgradeWorkspace({ workspace: ws }, { installImpl: async () => {} });
  assert.ok(fixed2.some((f) => /src\/utils\/ui\.js đã sửa tay, thiếu .*loose/.test(f)), fixed2.join('|'));
  assert.match(fs.readFileSync(path.join(ws, 'src/utils/ui.js'), 'utf8'), /sửa tay/);
});

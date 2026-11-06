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
  assert.deepEqual(fixed, ['src/runner/steps.js', 'src/runner/navgraph.js', 'src/runner/compare.js', 'src/runner/limit.js', 'src/runner/layout.js', 'src/runner/ocr.js',
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
  assert.deepEqual(fixed, ['config/capabilities/ios.caps.js (bản cũ: config/capabilities/ios.caps.js.bak)']);
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

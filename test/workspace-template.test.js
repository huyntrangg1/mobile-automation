import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { upgradeWorkspace, createWorkspace, readManifest, templateState, MANIFEST, KNOWN_TEMPLATE } from '../server/apps/workspace.js';
import { tmpDir } from './helpers.js';

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
// Template giả: steps.js có 3 hàm k, import ./limit.js
function fakeTemplate(steps = 'import { x } from \'./limit.js\';\nexport function createSteps() {\n  return {\n    async tap(a) {},\n    async closePopup(a) {},\n    async tapOutside(a) {},\n  };\n}\n') {
  const t = tmpDir();
  const w = (f, c) => { fs.mkdirSync(path.dirname(path.join(t, f)), { recursive: true }); fs.writeFileSync(path.join(t, f), c); };
  w('src/runner/steps.js', steps);
  w('src/runner/limit.js', 'export const runWithLimit = 1; export const x = 1;');
  w('src/runner/describe.js', 'export function describeCase() {}');
  w('src/runner/navgraph.js', 'export function findPath() {}');
  w('src/runner/compare.js', 'export function fillVars() {}');
  w('src/runner/layout.js', 'export function evaluate() {}');
  w('src/runner/ocr.js', 'export function findText() {}');
  w('src/runner/ocr.swift', '//');
  w('config/capabilities/ios.caps.js', 'export const KEEP_APP_OPEN = true;');
  return t;
}
// Workspace = bản sao template + report đủ export
function wsFrom(t) {
  const ws = tmpDir();
  fs.cpSync(t, ws, { recursive: true });
  fs.mkdirSync(path.join(ws, 'src/report'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'src/report/collector.js'), 'export function addFlowBug() {}\nexport function resetCurrent() {}\nexport { noteScreen };');
  fs.writeFileSync(path.join(ws, 'src/report/hooks.js'), 'export async function screenSummary() {}');
  return ws;
}
const OLD_STEPS = 'export function createSteps() {\n  return {\n    async tap(a) {},\n  };\n}\n';

test('upgradeWorkspace: steps.js chưa sửa tay (hash đã ghi khi copy) mà template có bản mới → cập nhật, giữ .bak, ghi lại hash', async () => {
  const t = fakeTemplate();
  const ws = wsFrom(t);
  fs.writeFileSync(path.join(ws, 'src/runner/steps.js'), OLD_STEPS);
  fs.writeFileSync(path.join(ws, MANIFEST), JSON.stringify({ files: { 'src/runner/steps.js': sha(OLD_STEPS) } }));
  const fixed = await upgradeWorkspace({ workspace: ws }, { installImpl: async () => {}, template: t });
  assert.equal(fs.readFileSync(path.join(ws, 'src/runner/steps.js'), 'utf8'), fs.readFileSync(path.join(t, 'src/runner/steps.js'), 'utf8'));
  assert.equal(fs.readFileSync(path.join(ws, 'src/runner/steps.js.bak'), 'utf8'), OLD_STEPS);
  assert.match(fixed[0], /src\/runner\/steps\.js \(cập nhật theo template mới/);
  assert.equal(readManifest(ws).files['src/runner/steps.js'], sha(fs.readFileSync(path.join(t, 'src/runner/steps.js'), 'utf8')));
  // Lần sau: đã đủ → không làm gì
  assert.deepEqual(await upgradeWorkspace({ workspace: ws }, { installImpl: async () => {}, template: t }), []);
});

test('upgradeWorkspace: steps.js trùng byte một bản template cũ đã biết (workspace tạo trước khi có hash) → cập nhật', async () => {
  const t = fakeTemplate();
  const ws = wsFrom(t);
  KNOWN_TEMPLATE['src/runner/steps.js'].push(sha(OLD_STEPS));
  try {
    fs.writeFileSync(path.join(ws, 'src/runner/steps.js'), OLD_STEPS);
    assert.equal(templateState(ws, 'src/runner/steps.js', { template: t }), 'pristine');
    const fixed = await upgradeWorkspace({ workspace: ws }, { installImpl: async () => {}, template: t });
    assert.equal(fixed.length, 1);
    assert.match(fs.readFileSync(path.join(ws, 'src/runner/steps.js'), 'utf8'), /closePopup/);
  } finally { KNOWN_TEMPLATE['src/runner/steps.js'].pop(); }
});

test('upgradeWorkspace: steps.js đã sửa tay thiếu hàm k → KHÔNG ghi đè, báo "cần chuẩn bị lại" kèm tên hàm thiếu', async () => {
  const t = fakeTemplate();
  const ws = wsFrom(t);
  const hand = `${OLD_STEPS}// sửa tay\n`;
  fs.writeFileSync(path.join(ws, 'src/runner/steps.js'), hand);
  const fixed = await upgradeWorkspace({ workspace: ws }, { installImpl: async () => {}, template: t });
  assert.equal(fs.readFileSync(path.join(ws, 'src/runner/steps.js'), 'utf8'), hand);
  assert.equal(fixed.length, 1);
  assert.match(fixed[0], /đã sửa tay, thiếu k\.closePopup, k\.tapOutside — cần chuẩn bị lại/);
});

test('upgradeWorkspace: steps.js sửa tay nhưng đủ hàm k → giữ nguyên, không báo', async () => {
  const t = fakeTemplate();
  const ws = wsFrom(t);
  const hand = `${fs.readFileSync(path.join(t, 'src/runner/steps.js'), 'utf8')}// sửa tay\n`;
  fs.writeFileSync(path.join(ws, 'src/runner/steps.js'), hand);
  assert.deepEqual(await upgradeWorkspace({ workspace: ws }, { installImpl: async () => {}, template: t }), []);
  assert.equal(fs.readFileSync(path.join(ws, 'src/runner/steps.js'), 'utf8'), hand);
});

test('upgradeWorkspace: cập nhật steps.js kéo theo file nó import mà workspace chưa có', async () => {
  const t = fakeTemplate("import { y } from './extra.js';\nexport function createSteps() {\n  return {\n    async tap(a) {},\n  };\n}\n");
  fs.writeFileSync(path.join(t, 'src/runner/extra.js'), 'export const y = 1;');
  const ws = wsFrom(t);
  fs.rmSync(path.join(ws, 'src/runner/extra.js'));
  fs.writeFileSync(path.join(ws, 'src/runner/steps.js'), OLD_STEPS);
  fs.writeFileSync(path.join(ws, MANIFEST), JSON.stringify({ files: { 'src/runner/steps.js': sha(OLD_STEPS) } }));
  const fixed = await upgradeWorkspace({ workspace: ws }, { installImpl: async () => {}, template: t });
  assert.ok(fs.existsSync(path.join(ws, 'src/runner/extra.js')));
  assert.ok(fixed.includes('src/runner/extra.js'));
});

test('upgradeWorkspace: caps chưa sửa tay (hash đã ghi) → thay, ghi "bản cũ" (không phải "đã sửa tay")', async () => {
  const t = fakeTemplate();
  const ws = wsFrom(t);
  const old = 'export const iosCaps = {};';
  fs.writeFileSync(path.join(ws, 'config/capabilities/ios.caps.js'), old);
  fs.writeFileSync(path.join(ws, MANIFEST), JSON.stringify({ files: { 'config/capabilities/ios.caps.js': sha(old) } }));
  const fixed = await upgradeWorkspace({ workspace: ws }, { installImpl: async () => {}, template: t });
  assert.equal(fixed.length, 1);
  assert.doesNotMatch(fixed[0], /đã sửa tay/);
  assert.match(fs.readFileSync(path.join(ws, 'config/capabilities/ios.caps.js'), 'utf8'), /KEEP_APP_OPEN/);
});

test('createWorkspace ghi hash các file template (.qapd-template.json)', async () => {
  const root = tmpDir();
  const dir = await createWorkspace({ id: 'h', helperPack: null }, { root, installImpl: async () => {} });
  const m = readManifest(dir);
  assert.equal(m.files['src/runner/steps.js'], sha(fs.readFileSync(path.join(dir, 'src/runner/steps.js'))));
  assert.equal(templateState(dir, 'src/runner/steps.js'), 'same');
});

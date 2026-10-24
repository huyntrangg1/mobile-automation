import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

// Repo chỉ có qa-pipeline-demo: không có ../ik-fitness, không có ../.claude/skills/test-report
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const none = fs.mkdtempSync(path.join(os.tmpdir(), 'none-'));
process.env.QAPD_IK_FITNESS = path.join(none, 'ik-fitness');
process.env.QAPD_SKILL = path.join(none, 'test-report');
const { createWorkspace, availablePacks } = await import('../server/apps/workspace.js');
const { TEST_REPORT_VENDOR, WDA_DIR, ROOT } = await import('../server/paths.js');

test('tạo workspace không cần ik-fitness: loader Excel + tiện ích có sẵn trong template, report từ bản vendor', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  const calls = [];
  const dir = await createWorkspace({ id: 'x', helperPack: null }, { root, installImpl: async (cmd, args) => { calls.push([cmd, args]); } });
  for (const f of ['data/loaders/testcase-v2.js', 'data/loaders/testdata.js', 'src/utils/ui.js', 'src/utils/plan.js', 'src/utils/units.js', 'src/utils/date.js', 'src/utils/app.js', 'src/runner/describe.js']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `thiếu ${f}`);
  }
  assert.equal(calls[0][1][0], path.join(TEST_REPORT_VENDOR, 'scripts/install.sh'));
});

test('bản vendor của skill test-report nằm trong tool và đủ file', () => {
  assert.ok(TEST_REPORT_VENDOR.startsWith(ROOT));
  for (const f of ['SKILL.md', 'scripts/install.sh', 'assets/src/report/hooks.js', 'assets/src/utils/softAssert.js']) assert.ok(fs.existsSync(path.join(TEST_REPORT_VENDOR, f)), `thiếu ${f}`);
});

test('helper pack ik-fitness chỉ có khi thư mục ../ik-fitness tồn tại', () => {
  assert.deepEqual(availablePacks(), []);
});

test('chưa có WDA build sẵn của ik-fitness → dùng thư mục .wda-build của tool', () => {
  assert.equal(WDA_DIR, path.join(ROOT, '.wda-build'));
});

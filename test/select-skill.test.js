import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SELECT_AUTOMATION_VENDOR, SELECT_AUTOMATION_SRC } from '../server/paths.js';
import { runChecks } from '../scripts/doctor-checks.js';

test('vendor/select-automation có SKILL.md, extract.mjs, write.mjs, VERSION', () => {
  for (const f of ['SKILL.md', 'scripts/extract.mjs', 'scripts/write.mjs', 'VERSION']) {
    assert.ok(fs.existsSync(path.join(SELECT_AUTOMATION_VENDOR, f)), `thiếu ${f}`);
  }
  assert.match(fs.readFileSync(path.join(SELECT_AUTOMATION_VENDOR, 'SKILL.md'), 'utf8'), /Rules marked ✱/);
  assert.ok(SELECT_AUTOMATION_SRC.length > 0);
});

test('extract.mjs của vendor chạy được: file không tồn tại → thoát mã 1', () => {
  const r = spawnSync(process.execPath, [path.join(SELECT_AUTOMATION_VENDOR, 'scripts/extract.mjs'), '/không/có/file.xlsx'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Cần đường dẫn file xlsx/);
});

test('doctor: skill chọn case automation trong tool lệch bản gốc → cảnh báo; khớp → ok; không có bản gốc → không báo', async () => {
  const find = (r) => r.items.find((i) => i.id === 'select-skill-sync');
  assert.equal(find(await runChecks({ selectSkillSync: async () => 'diff' })).status, 'warn');
  assert.equal(find(await runChecks({ selectSkillSync: async () => 'same' })).status, 'ok');
  assert.equal(find(await runChecks({ selectSkillSync: async () => undefined })), undefined);
});

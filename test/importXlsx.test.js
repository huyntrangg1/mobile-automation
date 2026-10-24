import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { createStore } from '../server/store.js';
import { importTestcases } from '../server/testcases/importXlsx.js';
import { ROOT } from '../server/paths.js';
import { tmpDir } from './helpers.js';

const SRC = path.join(ROOT, 'test/fixtures/authentication-automation.xlsx');
const LOADER = path.join(ROOT, 'server/apps/template/data/loaders/testcase-v2.js');

function setup() {
  const store = createStore(tmpDir());
  const ws = tmpDir();
  store.put('apps', { id: 'ikf', workspace: ws });
  return { store, ws };
}

test('import authentication → 38 case, copy vào workspace, fresh / prev đúng', async () => {
  const { store, ws } = setup();
  const r = await importTestcases({ store, appId: 'ikf', srcPath: SRC, fileName: 'authentication-automation.xlsx', loaderPath: LOADER });
  assert.equal(r.total, 38);
  assert.ok(fs.existsSync(path.join(ws, 'data/testcases/authentication-automation.xlsx')));
  const cases = store.list('cases');
  assert.equal(cases.length, 38);
  const spl = store.get('cases', 'ikf:authentication-automation:TC_SPL_001');
  assert.equal(spl.fresh, true);
  assert.equal(spl.module, 'SPL');
  assert.equal(spl.order, 0);
  assert.equal(spl.script.status, 'none');
  assert.equal(store.get('cases', 'ikf:authentication-automation:TC_LOGIN_001').prev, 'TC_WEL_003');
});

test('import lại cùng file → giữ trạng thái script', async () => {
  const { store } = setup();
  const args = { store, appId: 'ikf', srcPath: SRC, fileName: 'authentication-automation.xlsx', loaderPath: LOADER };
  await importTestcases(args);
  store.patch('cases', 'ikf:authentication-automation:TC_SPL_001', { script: { status: 'generated', warnings: [] } });
  const r = await importTestcases(args);
  assert.equal(r.changed, 0);
  assert.equal(store.get('cases', 'ikf:authentication-automation:TC_SPL_001').script.status, 'generated');
});

test('import lại file đã sửa bước → case đã gen chuyển stale, case khác giữ', async () => {
  const { store } = setup();
  const args = { store, appId: 'ikf', srcPath: SRC, fileName: 'authentication-automation.xlsx', loaderPath: LOADER };
  await importTestcases(args);
  for (const id of ['TC_SPL_001', 'TC_WEL_001']) store.patch('cases', `ikf:authentication-automation:${id}`, { script: { status: 'generated', warnings: [] } });
  // Sửa Value của 1 dòng thuộc TC_SPL_001
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SRC);
  const sh = wb.getWorksheet('TestCases');
  const head = sh.getRow(1).values.map((v) => String(v ?? ''));
  const kw = head.indexOf('Keyword');
  const tgt = head.indexOf('Target');
  sh.getRow(3).getCell(tgt).value = 'Welcome (sửa)';
  assert.ok(sh.getRow(3).getCell(kw).value);
  const edited = path.join(tmpDir(), 'authentication-automation.xlsx');
  await wb.xlsx.writeFile(edited);
  const r = await importTestcases({ ...args, srcPath: edited });
  assert.equal(r.changed, 1);
  assert.equal(store.get('cases', 'ikf:authentication-automation:TC_SPL_001').script.status, 'stale');
  assert.equal(store.get('cases', 'ikf:authentication-automation:TC_WEL_001').script.status, 'generated');
});

test('file thiếu sheet TestCases → lỗi rõ ràng, không ghi gì', async () => {
  const { store, ws } = setup();
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Khac');
  const bad = path.join(tmpDir(), 'bad.xlsx');
  await wb.xlsx.writeFile(bad);
  await assert.rejects(importTestcases({ store, appId: 'ikf', srcPath: bad, fileName: 'bad.xlsx', loaderPath: LOADER }), /TestCases/);
  assert.equal(store.list('cases').length, 0);
  assert.ok(!fs.existsSync(path.join(ws, 'data/testcases/bad.xlsx')));
});

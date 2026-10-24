// Import file Excel test case format automation v2 vào workspace của app (bản copy — không đụng file gốc).
// Đọc bằng loadV2 của workspace (cùng code script sẽ dùng lúc chạy).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const fileStem = (name) => path.basename(name).replace(/\.xlsx$/i, '').replace(/[^A-Za-z0-9_-]+/g, '-');
const moduleOf = (tcId) => (tcId.match(/^TC_([A-Za-z0-9]+)_/) || [])[1] || 'Khác';
const hash = (tc) => crypto.createHash('sha1').update(JSON.stringify([tc.title, tc.pre, tc.dataSet, tc.rows])).digest('hex').slice(0, 12);

export async function importTestcases({ store, appId, srcPath, fileName, loaderPath }) {
  const app = store.get('apps', appId);
  if (!app) throw Object.assign(new Error('Không có app này'), { status: 404 });
  if (!/\.xlsx$/i.test(fileName)) throw Object.assign(new Error('Cần file .xlsx'), { status: 400 });
  const stem = fileStem(fileName);
  // Đọc thử từ bản tạm trước: file lỗi thì không ghi đè bản đang dùng
  const loader = await import(pathToFileURL(loaderPath || path.join(app.workspace, 'data/loaders/testcase-v2.js')).href);
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qapd-imp-')), `${stem}.xlsx`);
  fs.copyFileSync(srcPath, tmp);
  let parsed;
  try {
    parsed = await loader.loadV2(tmp);
  } catch (e) {
    throw Object.assign(new Error(`Không đọc được file Excel (format automation v2): ${e.message}`), { status: 400 });
  }
  if (!parsed.testcases.length) throw Object.assign(new Error('Sheet TestCases không có case nào (dòng Kind = Case)'), { status: 400 });
  const dest = path.join(app.workspace, 'data/testcases', `${stem}.xlsx`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(tmp, dest);

  let changed = 0;
  let added = 0;
  const now = new Date().toISOString();
  const seen = new Set();
  parsed.testcases.forEach((tc, order) => {
    const id = `${appId}:${stem}:${tc.id}`;
    seen.add(id);
    const old = store.get('cases', id);
    const rowsHash = hash(tc);
    let script = old?.script || { status: 'none', warnings: [], reviewed: false };
    if (old && old.rowsHash !== rowsHash) {
      changed++;
      if (['generated', 'failed'].includes(script.status)) script = { ...script, status: 'stale', reviewed: false };
    }
    if (!old) added++;
    store.put('cases', {
      id, appId, file: stem, fileName: `${stem}.xlsx`, tcId: tc.id, title: tc.title, priority: tc.priority, module: moduleOf(tc.id),
      order, fresh: tc.fresh, prev: tc.prev, pre: tc.pre, dataSet: tc.dataSet, rows: tc.rows, rowsHash, script,
      importedAt: now,
    });
  });
  // Case đã bị xoá khỏi file
  let removed = 0;
  for (const c of store.list('cases')) {
    if (c.appId === appId && c.file === stem && !seen.has(c.id)) { store.remove('cases', c.id); removed++; }
  }
  return { file: stem, total: parsed.testcases.length, added, changed, removed };
}

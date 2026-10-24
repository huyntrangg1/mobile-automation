// Xoá test case đã import: một số case, cả một file Excel, hoặc tất cả của app.
// Script: gỡ region của case đã xoá; file Excel hết case → xoá bản copy Excel và file script.
import fs from 'node:fs';
import path from 'node:path';

const err = (message, status = 409) => Object.assign(new Error(message), { status });

// { ids, files, orphans }: orphans = case còn lại "Tiếp nối" một case sắp xoá
export function planRemoval(store, appId, { caseIds, file, all }) {
  const cases = store.list('cases').filter((c) => c.appId === appId);
  const pick = all ? cases : file ? cases.filter((c) => c.file === file) : cases.filter((c) => (caseIds || []).includes(c.id));
  const ids = new Set(pick.map((c) => c.id));
  const gone = new Set(pick.map((c) => `${c.file}:${c.tcId}`));
  const orphans = cases.filter((c) => !ids.has(c.id) && c.prev && gone.has(`${c.file}:${c.prev}`)).map((c) => ({ id: c.id, tcId: c.tcId, prev: c.prev }));
  return { ids: [...ids], files: [...new Set(pick.map((c) => c.file))], orphans };
}

export async function removeCases({ store, generator, lock }, app, sel) {
  const plan = planRemoval(store, app.id, sel);
  if (!plan.ids.length) throw err('Chưa chọn case để xoá', 400);
  const busy = plan.ids.map((id) => store.get('cases', id)).filter((c) => c.script?.status === 'generating');
  if (busy.length) throw err(`Không xoá được: ${busy.map((c) => c.tcId).join(', ')} đang gen script — chờ gen xong`);
  const holder = lock?.current();
  if (holder?.kind === 'run' && store.get('runs', holder.id)?.appId === app.id) throw err(`Không xoá được khi app đang chạy test: ${holder.label}`);
  for (const id of plan.ids) store.remove('cases', id);
  for (const file of plan.files) {
    const left = store.list('cases').some((c) => c.appId === app.id && c.file === file);
    if (left) await generator.refreshScript(app, file);
    else {
      fs.rmSync(generator.scriptPath(app, file), { force: true });
      fs.rmSync(path.join(app.workspace, 'data/testcases', `${file}.xlsx`), { force: true });
    }
  }
  return { removed: plan.ids.length, files: plan.files, orphans: plan.orphans };
}

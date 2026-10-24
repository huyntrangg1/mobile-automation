// Lưu trạng thái của tool trong file JSON, mỗi collection 1 file (dir/<col>.json). Ghi qua file tạm rồi rename.
import fs from 'node:fs';
import path from 'node:path';

export function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const cache = new Map();
  const file = (col) => path.join(dir, `${col}.json`);
  const load = (col) => {
    if (!cache.has(col)) cache.set(col, fs.existsSync(file(col)) ? JSON.parse(fs.readFileSync(file(col), 'utf8')) : []);
    return cache.get(col);
  };
  const save = (col) => {
    const tmp = `${file(col)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(load(col), null, 1));
    fs.renameSync(tmp, file(col));
  };
  return {
    list: (col) => load(col).map((o) => structuredClone(o)),
    get: (col, id) => {
      const o = load(col).find((x) => x.id === id);
      return o && structuredClone(o);
    },
    put(col, obj) {
      if (!obj?.id) throw new Error('store.put: thiếu id');
      const rows = load(col);
      const i = rows.findIndex((x) => x.id === obj.id);
      if (i < 0) rows.push(structuredClone(obj));
      else rows[i] = structuredClone(obj);
      save(col);
      return obj;
    },
    patch(col, id, partial) {
      const rows = load(col);
      const o = rows.find((x) => x.id === id);
      if (!o) return undefined;
      Object.assign(o, structuredClone(partial));
      save(col);
      return structuredClone(o);
    },
    remove(col, id) {
      cache.set(col, load(col).filter((x) => x.id !== id));
      save(col);
    },
  };
}

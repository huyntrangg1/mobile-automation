import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { updateBuild } from '../server/routes/apps.js';
import { tmpDir } from './helpers.js';

// Build giả: thư mục .app có Info.plist; readInfo stub đọc version / bundle id từ tên thư mục cha
function setup() {
  const store = createStore(tmpDir());
  const ws = tmpDir();
  const sim = tmpDir();
  const oldCopy = path.join(ws, 'build/Fit-1.0.app');
  fs.mkdirSync(oldCopy, { recursive: true });
  store.put('apps', { id: 'a', name: 'Fit', platform: 'iOS', bundleId: 'com.x.fit', version: '1.0 (1)', appPath: oldCopy, workspace: ws, createdAt: '2026-10-01T00:00:00Z' });
  store.put('cases', { id: 'a:f:TC1', appId: 'a', script: { status: 'generated' } });
  const mkBuild = (dir, name) => { const p = path.join(dir, name); fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, 'Info.plist'), name); return p; };
  const INFO = { 'Fit-1.1.app': { platform: 'iOS', bundleId: 'com.x.fit', version: '1.1 (2)' }, 'Other.app': { platform: 'iOS', bundleId: 'com.x.other', version: '9' }, 'Fit.apk': { platform: 'Android', bundleId: 'com.x.fit', version: '1' } };
  const opts = { readInfo: async (p) => INFO[path.basename(p)], simPath: (p) => p.startsWith(sim) };
  const events = [];
  const ctx = { store, emit: (...e) => events.push(e), lock: { current: () => null } };
  return { store, ws, sim, oldCopy, mkBuild, opts, ctx, events };
}

test('updateBuild: build mới từ simulator → copy vào workspace, đổi version, giữ case/script, xoá bản copy cũ', async () => {
  const t = setup();
  const src = t.mkBuild(t.sim, 'Fit-1.1.app');
  const a = await updateBuild(t.ctx, t.store.get('apps', 'a'), src, t.opts);
  assert.equal(a.appPath, path.join(t.ws, 'build/Fit-1.1.app'));
  assert.equal(a.version, '1.1 (2)');
  assert.ok(fs.existsSync(path.join(a.appPath, 'Info.plist')));
  assert.equal(fs.existsSync(t.oldCopy), false);
  assert.deepEqual(a.buildHistory, [{ version: '1.0 (1)', at: '2026-10-01T00:00:00Z' }]);
  assert.equal(t.store.get('cases', 'a:f:TC1').script.status, 'generated');
  assert.deepEqual(t.events, [['app', { id: 'a' }]]);
  assert.deepEqual(fs.readdirSync(path.join(t.ws, 'build')), ['Fit-1.1.app']);
});

test('updateBuild: file nhập tay ngoài simulator → dùng thẳng đường dẫn, không copy', async () => {
  const t = setup();
  const own = t.mkBuild(tmpDir(), 'Fit-1.1.app');
  const a = await updateBuild(t.ctx, t.store.get('apps', 'a'), own, t.opts);
  assert.equal(a.appPath, own);
});

test('updateBuild: khác bundle id / khác nền tảng / thiết bị bận → lỗi, app giữ nguyên', async () => {
  const t = setup();
  const app = () => t.store.get('apps', 'a');
  await assert.rejects(updateBuild(t.ctx, app(), t.mkBuild(t.sim, 'Other.app'), t.opts), (e) => e.status === 400 && /com\.x\.other/.test(e.message));
  await assert.rejects(updateBuild(t.ctx, app(), t.mkBuild(t.sim, 'Fit.apk'), t.opts), (e) => e.status === 400 && /Android/.test(e.message));
  t.ctx.lock.current = () => ({ label: 'Run R1' });
  await assert.rejects(updateBuild(t.ctx, app(), t.mkBuild(t.sim, 'Fit-1.1.app'), t.opts), (e) => e.status === 409);
  assert.equal(app().version, '1.0 (1)');
  assert.ok(fs.existsSync(t.oldCopy));
});

test('updateBuild: Info.plist ghi iPhoneOS nhưng file chạy là Simulator → copy vào workspace (kể cả file nhập tay) rồi sửa plist trên bản copy', async () => {
  const t = setup();
  const own = t.mkBuild(tmpDir(), 'Fit-1.1.app');
  const fixed = [];
  const opts = { ...t.opts, readInfo: async () => ({ platform: 'iOS', bundleId: 'com.x.fit', version: '1.1 (2)', simPlistFix: true }), fixPlist: async (p) => fixed.push(p) };
  const a = await updateBuild(t.ctx, t.store.get('apps', 'a'), own, opts);
  assert.equal(a.appPath, path.join(t.ws, 'build/Fit-1.1.app'));
  assert.deepEqual(fixed, [a.appPath]);
  assert.ok(fs.existsSync(path.join(own, 'Info.plist')));
  assert.equal(a.simPlistFix, undefined);
});

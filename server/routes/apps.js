import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { availablePacks, createWorkspace, HELPER_PACKS } from '../apps/workspace.js';
import { DATA, WORKSPACES } from '../paths.js';
import { fixSimPlist, readAppInfo } from '../device/platforms.js';
import { isSimContainerPath, listBuilds } from '../device/simulators.js';

const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';

// Biến môi trường mặc định theo helper pack
const DEFAULT_ENV = { 'ik-fitness': { ALLOW_ACCOUNT_CREATE: '1' } };

// Tạo / làm lại workspace. Không làm khi simulator đang chạy job (npm install dưới wdio đang chạy);
// template ghi đè locators/map.js → xuất lại từ locator map.
export async function prepareApp({ store, map, emit, lock, create = createWorkspace }, app) {
  const holder = lock?.current();
  if (holder) throw Object.assign(new Error(`Thiết bị đang bận: ${holder.label} — chờ xong rồi chuẩn bị lại`), { status: 409 });
  store.patch('apps', app.id, { status: 'preparing', error: null });
  emit('app', { id: app.id });
  try {
    await create(app);
    map?.exportLocators(app.id);
    store.patch('apps', app.id, { status: 'ready' });
  } catch (e) {
    store.patch('apps', app.id, { status: 'error', error: String(e.message || e) });
  }
  emit('app', { id: app.id });
}

// Xoá app và mọi thứ của nó: run, phiên lấy locator, màn + ảnh, test case, workspace (gồm build đã copy vào).
// File app nhập tay nằm ngoài workspace thì giữ nguyên.
export async function removeApp({ store, emit, lock, runner, tryLive, map, generator }, app, { workspaces = WORKSPACES } = {}) {
  const holder = lock?.current();
  if (holder) throw Object.assign(new Error(`Thiết bị đang bận: ${holder.label} — chờ xong rồi xoá`), { status: 409 });
  if (app.status === 'preparing') throw Object.assign(new Error('App đang chuẩn bị project — chờ xong rồi xoá'), { status: 409 });
  await tryLive?.closeAll?.();
  // Case đang gen / chờ gen → dừng, để AI trả về không ghi lại vào workspace sắp xoá
  generator?.cancel(generator.generatingIds(app.id));
  const runIds = store.list('runs').filter((r) => r.appId === app.id).map((r) => r.id);
  if (runIds.length) {
    const { skipped } = await runner.deleteRuns(runIds);
    if (skipped.length) throw Object.assign(new Error(`Không xoá được ${skipped.map((x) => x.id).join(', ')}: ${skipped[0].reason}`), { status: 409 });
  }
  const dataDir = map.dataDir;
  for (const c of store.list('captures').filter((x) => x.appId === app.id)) {
    fs.rmSync(path.join(dataDir, 'captures', `${c.id}.png`), { force: true });
    store.remove('captures', c.id);
  }
  const screens = store.list('screens').filter((x) => x.appId === app.id);
  for (const sc of screens) store.remove('screens', sc.id);
  fs.rmSync(path.join(dataDir, 'screens', app.id), { recursive: true, force: true });
  const cases = store.list('cases').filter((x) => x.appId === app.id);
  for (const c of cases) store.remove('cases', c.id);
  // Chỉ xoá workspace nằm trong thư mục workspaces của tool
  const ws = path.resolve(app.workspace || '');
  if (app.workspace && ws.startsWith(path.resolve(workspaces) + path.sep)) fs.rmSync(ws, { recursive: true, force: true });
  store.remove('apps', app.id);
  emit('app', { id: app.id });
  return { runs: runIds.length, screens: screens.length, cases: cases.length };
}

const BUILD_ICONS = path.join(DATA, 'build-icons');

// Đổi app sang build mới (cùng bundle id, cùng nền tảng). Test case, script, locator, lịch sử run giữ nguyên —
// đường dẫn build chỉ được truyền vào lúc Run (APP_PATH). Build từ container simulator được copy vào workspace.
export async function updateBuild({ store, emit, lock }, app, appPath, { readInfo = readAppInfo, simPath = isSimContainerPath, fixPlist = fixSimPlist } = {}) {
  const holder = lock?.current();
  if (holder) throw Object.assign(new Error(`Thiết bị đang bận: ${holder.label} — chờ xong rồi cập nhật build`), { status: 409 });
  let file = String(appPath || '').trim().replace(/\/$/, '');
  let info;
  try {
    info = await readInfo(file);
  } catch (e) {
    throw Object.assign(new Error(`File app không dùng được: ${e.message}`), { status: 400 });
  }
  if (info.platform !== (app.platform || 'iOS')) throw Object.assign(new Error(`Build mới là ${info.platform}, app "${app.name}" là ${app.platform || 'iOS'}`), { status: 400 });
  if (info.bundleId !== app.bundleId) throw Object.assign(new Error(`Build mới có bundle id ${info.bundleId}, khác app "${app.name}" (${app.bundleId}) — đây là app khác, hãy Thêm app`), { status: 400 });
  const buildDir = path.join(app.workspace, 'build');
  const old = app.appPath;
  // Copy vào workspace khi: lấy từ container simulator (UUID đổi khi cài lại), hoặc Info.plist cần sửa (không sửa file gốc của tester)
  const { simPlistFix, ...meta } = info;
  if (simPath(file) || simPlistFix) {
    const dest = path.join(buildDir, path.basename(file));
    // Copy vào chỗ tạm rồi mới thay, lỗi giữa chừng không làm hỏng build đang dùng
    const tmp = `${dest}.tmp-${Date.now()}`;
    try {
      await fs.promises.cp(file, tmp, { recursive: true });
      await fs.promises.rm(dest, { recursive: true, force: true });
      await fs.promises.rename(tmp, dest);
    } catch (e) {
      await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
      throw Object.assign(new Error(`Không copy được build từ simulator: ${e.message}`), { status: 400 });
    }
    file = dest;
  }
  if (simPlistFix) await fixPlist(file);
  // Build cũ tool đã copy vào workspace → xoá cho đỡ tốn chỗ (file app nhập tay ngoài tool thì giữ)
  if (old && old !== file && path.resolve(old).startsWith(path.resolve(buildDir) + path.sep)) await fs.promises.rm(old, { recursive: true, force: true }).catch(() => {});
  const now = new Date().toISOString();
  const history = [{ version: app.version, at: app.buildAt || app.createdAt }, ...(app.buildHistory || [])].slice(0, 10);
  const next = store.patch('apps', app.id, { appPath: file, version: meta.version, activity: meta.activity, label: meta.label, buildAt: now, buildHistory: history });
  emit?.('app', { id: app.id });
  return next;
}

export default function appRoutes(ctx, { builds = () => listBuilds({ iconDir: BUILD_ICONS }) } = {}) {
  const { store, emit } = ctx;
  const r = Router();
  const summary = (a) => {
    const runs = store.list('runs').filter((x) => x.appId === a.id);
    return {
      ...a,
      screens: store.list('screens').filter((s) => s.appId === a.id).length,
      cases: store.list('cases').filter((c) => c.appId === a.id).length,
      lastRun: runs.sort((x, y) => String(y.startedAt).localeCompare(String(x.startedAt)))[0] || null,
    };
  };

  const prepare = (app) => prepareApp(ctx, app);

  r.get('/apps', (req, res) => res.json(store.list('apps').map(summary)));
  r.get('/apps/:id', (req, res) => {
    const a = store.get('apps', req.params.id);
    if (!a) return res.status(404).json({ error: 'Không có app này' });
    res.json(summary(a));
  });

  r.get('/helper-packs', (req, res) => res.json(availablePacks().map((id) => ({ id, platform: HELPER_PACKS[id].platform }))));

  r.get('/builds', async (req, res) => {
    try { res.json(await builds()); } catch (e) { res.status(500).json({ error: `Không quét được build: ${e.message}` }); }
  });

  r.get('/builds/icon/:file', (req, res) => {
    if (!/^[0-9a-f]{16}\.png$/.test(req.params.file)) return res.status(404).end();
    res.sendFile(path.join(BUILD_ICONS, req.params.file), (e) => { if (e && !res.headersSent) res.status(404).end(); });
  });

  r.post('/apps', async (req, res) => {
    const { name, appPath, helperPack = null } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Cần tên app' });
    let info;
    try {
      info = await readAppInfo(String(appPath || '').trim().replace(/\/$/, ''));
    } catch (e) {
      return res.status(400).json({ error: `File app không dùng được: ${e.message}` });
    }
    const pack = helperPack && HELPER_PACKS[helperPack];
    if (helperPack && (!pack || !availablePacks().includes(helperPack))) return res.status(400).json({ error: `Không có helper pack "${helperPack}" trên máy này` });
    if (pack && pack.platform !== info.platform) return res.status(400).json({ error: `Helper pack "${helperPack}" dành cho ${pack.platform}, app này là ${info.platform}` });
    let id = slug(name);
    for (let i = 2; store.get('apps', id); i++) id = `${slug(name)}-${i}`;
    let file = String(appPath).trim().replace(/\/$/, '');
    const { simPlistFix, ...meta } = info;
    // Build lấy từ container simulator (UUID đổi khi cài lại) hoặc Info.plist cần sửa → copy vào workspace của app
    if (isSimContainerPath(file) || simPlistFix) {
      const dest = path.join(WORKSPACES, id, 'build', path.basename(file));
      try {
        await fs.promises.cp(file, dest, { recursive: true, force: true });
      } catch (e) {
        return res.status(400).json({ error: `Không copy được build từ simulator: ${e.message}` });
      }
      file = dest;
    }
    if (simPlistFix) {
      try { await fixSimPlist(file); } catch (e) { return res.status(400).json({ error: `Không sửa được Info.plist của build: ${e.message}` }); }
    }
    const app = {
      id, name: name.trim(), appPath: file, ...meta, helperPack,
      env: { ...(DEFAULT_ENV[helperPack] || {}) }, workspace: path.join(WORKSPACES, id), status: 'preparing', createdAt: new Date().toISOString(), buildAt: new Date().toISOString(),
    };
    store.put('apps', app);
    prepare(app).catch((e) => store.patch('apps', app.id, { status: 'error', error: e.message }));
    res.status(201).json(summary(app));
  });

  r.put('/apps/:id/build', async (req, res) => {
    const a = store.get('apps', req.params.id);
    if (!a) return res.status(404).json({ error: 'Không có app này' });
    try {
      res.json(summary(await updateBuild(ctx, a, req.body?.appPath)));
    } catch (e) {
      res.status(e.status || 500).json({ error: String(e.message || e) });
    }
  });

  r.put('/apps/:id', (req, res) => {
    const a = store.get('apps', req.params.id);
    if (!a) return res.status(404).json({ error: 'Không có app này' });
    const { name, env, aiNotes, deepLinks } = req.body || {};
    const patch = {};
    if (name?.trim()) patch.name = name.trim();
    if (typeof aiNotes === 'string') patch.aiNotes = aiNotes.trim().slice(0, 4000);
    if (typeof deepLinks === 'string') patch.deepLinks = deepLinks.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 50); // hồ sơ app: deep link cho AI Smoke Test
    if (env && typeof env === 'object') {
      for (const k of Object.keys(env)) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) return res.status(400).json({ error: `Tên biến "${k}" không hợp lệ (chữ, số, _)` });
      patch.env = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, String(v ?? '')]));
    }
    res.json(summary(store.patch('apps', a.id, patch)));
    emit('app', { id: a.id });
  });

  r.delete('/apps/:id', async (req, res) => {
    const a = store.get('apps', req.params.id);
    if (!a) return res.status(404).json({ error: 'Không có app này' });
    try {
      res.json(await removeApp(ctx, a));
    } catch (e) {
      res.status(e.status || 500).json({ error: String(e.message || e) });
    }
  });

  r.post('/apps/:id/rebuild-workspace', (req, res) => {
    const a = store.get('apps', req.params.id);
    if (!a) return res.status(404).json({ error: 'Không có app này' });
    const holder = ctx.lock.current();
    if (holder) return res.status(409).json({ error: `Thiết bị đang bận: ${holder.label} — chờ xong rồi chuẩn bị lại` });
    prepare(a).catch(() => {});
    res.json({ ok: true });
  });
  return r;
}

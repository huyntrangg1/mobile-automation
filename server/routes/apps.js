import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { availablePacks, createWorkspace, HELPER_PACKS } from '../apps/workspace.js';
import { WORKSPACES } from '../paths.js';
import { readAppInfo } from '../device/platforms.js';

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

export default function appRoutes(ctx) {
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
    const app = {
      id, name: name.trim(), appPath: String(appPath).trim().replace(/\/$/, ''), ...info, helperPack,
      env: { ...(DEFAULT_ENV[helperPack] || {}) }, workspace: path.join(WORKSPACES, id), status: 'preparing', createdAt: new Date().toISOString(),
    };
    store.put('apps', app);
    prepare(app).catch((e) => store.patch('apps', app.id, { status: 'error', error: e.message }));
    res.status(201).json(summary(app));
  });

  r.put('/apps/:id', (req, res) => {
    const a = store.get('apps', req.params.id);
    if (!a) return res.status(404).json({ error: 'Không có app này' });
    const { name, env } = req.body || {};
    const patch = {};
    if (name?.trim()) patch.name = name.trim();
    if (env && typeof env === 'object') {
      for (const k of Object.keys(env)) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) return res.status(400).json({ error: `Tên biến "${k}" không hợp lệ (chữ, số, _)` });
      patch.env = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, String(v ?? '')]));
    }
    res.json(summary(store.patch('apps', a.id, patch)));
    emit('app', { id: a.id });
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

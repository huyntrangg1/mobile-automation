import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import uploadRoutes, { findAppBundle } from '../server/routes/upload.js';
import { lanUrls } from '../server/net/lan.js';
import { tmpDir } from './helpers.js';

async function boot(readInfo) {
  const root = tmpDir();
  const app = express();
  app.use('/api', uploadRoutes({}, { root, readInfo }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const send = async (name, content = 'x') => {
    const fd = new FormData();
    fd.append('file', new Blob([content]), name);
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/builds/upload`, { method: 'POST', body: fd });
    return { status: res.status, body: await res.json() };
  };
  return { root, send, close: () => srv.close() };
}

test('upload .apk → lưu trên máy chủ, trả đường dẫn + thông tin build', async (t) => {
  const s = await boot(async (f) => ({ platform: 'Android', bundleId: 'io.demo', version: '1.0', label: 'Demo' }));
  t.after(s.close);
  const r = await s.send('Demo App.apk', 'apk-bytes');
  assert.equal(r.status, 201);
  assert.equal(r.body.bundleId, 'io.demo');
  assert.ok(r.body.path.startsWith(s.root));
  assert.equal(fs.readFileSync(r.body.path, 'utf8'), 'apk-bytes');
});

test('upload sai loại file / .ipa / build không đọc được → 400, không để lại file', async (t) => {
  const s = await boot(async () => { throw new Error('không phải APK'); });
  t.after(s.close);
  assert.match((await s.send('a.ipa')).body.error, /Simulator/);
  assert.match((await s.send('a.txt')).body.error, /\.apk/);
  const bad = await s.send('a.apk');
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /không phải APK/);
  const left = fs.readdirSync(s.root).filter((d) => d !== 'tmp');
  assert.deepEqual(left, []);
  assert.deepEqual(fs.readdirSync(path.join(s.root, 'tmp')), []);
});

test('tìm .app trong thư mục giải nén (bỏ __MACOSX)', () => {
  const d = tmpDir();
  fs.mkdirSync(path.join(d, '__MACOSX', 'X.app'), { recursive: true });
  fs.mkdirSync(path.join(d, 'build', 'Debug-iphonesimulator', 'Fit.app'), { recursive: true });
  assert.equal(findAppBundle(d), path.join(d, 'build', 'Debug-iphonesimulator', 'Fit.app'));
  assert.equal(findAppBundle(tmpDir()), null);
});

test('lanUrls: chỉ IPv4 không phải loopback', () => {
  const urls = lanUrls(5178, { lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], en0: [{ family: 'IPv6', address: 'fe80::1', internal: false }, { family: 'IPv4', address: '192.168.1.20', internal: false }] });
  assert.deepEqual(urls, ['http://192.168.1.20:5178']);
});

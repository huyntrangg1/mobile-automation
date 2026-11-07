import test from 'node:test';
import assert from 'node:assert/strict';
import { preflight } from '../server/runs/preflight.js';

const SIM = 'AEB04EEE-C04D-4DC5-856B-D6784E7B0FCB';
const app = { id: 'a', platform: 'iOS', appPath: '/x.app', workspace: '/ws' };
const tc = (tcId, o = {}) => ({ id: `a:f:${tcId}`, tcId, file: 'f', fresh: false, prev: null, rows: [{ screen: 'Welcome', kind: 'Check', keyword: 'Verify displayed' }], script: { status: 'generated' }, ...o });
const deps = (o = {}) => ({
  listDevices: async () => [{ udid: SIM, name: 'iPhone 17 Pro', booted: true, platform: 'iOS' }],
  exists: () => true, portBusy: async () => false, syntaxError: async () => null, navEdges: () => 5, specPath: (f) => `/ws/tests/${f}.e2e.js`, build: 'b1', ...o,
});
const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]));

test('preflight: mọi thứ ổn → ok, không có mục fail', async () => {
  const r = await preflight({ app, udid: SIM, runCases: [tc('A', { fresh: true }), tc('B', { prev: 'A' })], deps: deps() });
  assert.equal(r.ok, true);
  assert.ok(!r.items.some((i) => i.status === 'fail'));
});

test('preflight: thiết bị không có / iPhone offline → fail; Simulator đang tắt → ok kèm ghi chú tool tự bật', async () => {
  let r = await preflight({ app, udid: 'NOPE', runCases: [tc('A', { fresh: true })], deps: deps() });
  assert.equal(byId(r.items).device.status, 'fail');
  assert.equal(r.ok, false);
  r = await preflight({ app, udid: SIM, runCases: [tc('A', { fresh: true })], deps: deps({ listDevices: async () => [{ udid: SIM, booted: false, platform: 'iOS' }] }) });
  assert.equal(byId(r.items).device.status, 'ok');
  assert.match(byId(r.items).device.detail, /tự bật/);
  r = await preflight({ app, udid: '00008120-001055C03C44A01E', runCases: [tc('A', { fresh: true })], deps: deps({ listDevices: async () => [{ udid: '00008120-001055C03C44A01E', offline: true, note: 'Mở khoá iPhone' }] }) });
  assert.equal(byId(r.items).device.status, 'fail');
});

test('preflight: file app không có → fail; cổng 4723 bận (Appium của run cũ) → warn', async () => {
  const r = await preflight({ app, udid: SIM, runCases: [tc('A', { fresh: true })], deps: deps({ exists: () => false, portBusy: async () => true }) });
  assert.equal(byId(r.items).app.status, 'fail');
  assert.equal(byId(r.items).appium.status, 'warn');
});

test('preflight (dry-run): script lỗi cú pháp → fail; script cũ hơn test case → warn liệt kê case', async () => {
  const r = await preflight({ app, udid: SIM, runCases: [tc('A', { fresh: true, script: { status: 'stale' } })], deps: deps({ syntaxError: async () => 'Unexpected token (12:3)' }) });
  assert.equal(byId(r.items).syntax.status, 'fail');
  assert.match(byId(r.items).syntax.detail, /Unexpected token/);
  assert.equal(byId(r.items).stale.status, 'warn');
  assert.match(byId(r.items).stale.detail, /A/);
});

test('preflight (dry-run): chuỗi Tiếp nối không biết màn bắt đầu → warn; chưa có sơ đồ màn cho build này → warn', async () => {
  const root = tc('A', { fresh: true, rows: [{ screen: '', kind: 'Action', keyword: 'Launch fresh' }] });
  const r = await preflight({ app, udid: SIM, runCases: [root, tc('B', { prev: 'A' })], deps: deps({ navEdges: () => 0 }) });
  assert.equal(byId(r.items).chain.status, 'warn');
  assert.match(byId(r.items).chain.detail, /A/);
  assert.equal(byId(r.items).navgraph.status, 'warn');
  // chỉ toàn case cài lại app → không cần sơ đồ, không cảnh báo
  const r2 = await preflight({ app, udid: SIM, runCases: [tc('A', { fresh: true })], deps: deps({ navEdges: () => 0 }) });
  assert.equal(byId(r2.items).navgraph, undefined);
});

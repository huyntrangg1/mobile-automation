import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpDir } from './helpers.js';
import { makeManual } from './fixtures/manualWorkbook.js';
import { fakeConvertAi, badTc, goodTc } from './fixtures/convertAi.js';
import { createStore } from '../server/store.js';
import { importTestcases } from '../server/testcases/importXlsx.js';
import { createConverter } from '../server/testcases/convert/converter.js';

const LOADER = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/apps/template/data/loaders/testcase-v2.js');
const mcase = (n, extra = {}) => ({ id: `TC_W_${String(n).padStart(3, '0')}`, priority: 'High', steps: `Bước ${n}`, ...extra });

function env({ ai = fakeConvertAi(), appStatus = 'ready' } = {}) {
  const dir = tmpDir();
  const store = createStore(path.join(dir, 'store'));
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  store.put('apps', { id: 'app1', name: 'App', workspace: ws, status: appStatus, platform: 'iOS' });
  const events = [];
  const gen = [];
  const imports = [];
  const conv = createConverter({
    store, map: { locatorTable: () => ({}) }, emit: (t, p) => events.push([t, p]), dataDir: path.join(dir, 'data'), runClaude: ai,
    generator: { generate: async (appId, ids) => { gen.push(ids); } },
    importer: async (a) => { imports.push(a.fileName); return importTestcases({ ...a, loaderPath: LOADER }); },
  });
  return { dir, store, ws, conv, ai, events, gen, imports };
}
const analyze = (e, file, name = 'onboarding.xlsx') => e.conv.analyze({ appId: 'app1', srcPath: file, fileName: name });
const modeOf = (mi, tc, sheet = 'Welcome') => mi.cases.find((c) => c.id === tc && c.sheet === sheet);

test('analyze: luật code lọc case Google; AI xét case mơ hồ; case thường automate; file không phải manual → lỗi 400', async () => {
  const e = env();
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1), mcase(2), mcase(3, { steps: 'Bấm Continue with Google' }), mcase(4, { steps: 'Chờ popup quảng cáo' })] }] });
  const mi = await analyze(e, f);
  assert.equal(mi.status, 'ready');
  assert.deepEqual(['TC_W_001', 'TC_W_002', 'TC_W_003', 'TC_W_004'].map((id) => [modeOf(mi, id).mode, modeOf(mi, id).by]), [['automate', 'rule'], ['automate', 'rule'], ['manual', 'rule'], ['automate', 'ai']]);
  assert.equal(e.ai.filter, 1);
  assert.ok(fs.existsSync(path.join(e.ws, 'data/manual/onboarding.xlsx')));
  const bad = path.join(e.dir, 'not-manual.xlsx');
  fs.writeFileSync(bad, 'x');
  await assert.rejects(() => analyze(e, bad), (err) => err.status === 400);
});

test('choose lưu lựa chọn theo (sheet, TC); analyze lại cùng file → giữ lựa chọn, 0 lần gọi AI', async () => {
  const e = env();
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1), mcase(2, { steps: 'Bấm Continue with Google' })] }] });
  let mi = await analyze(e, f);
  mi = e.conv.choose(mi.id, { sheet: 'Welcome', tcId: 'TC_W_002', mode: 'automate' });
  assert.equal(modeOf(mi, 'TC_W_002').by, 'user');
  assert.throws(() => e.conv.choose(mi.id, { sheet: 'Welcome', tcId: 'TC_W_002', mode: 'khác' }), (err) => err.status === 400);
  const before = e.ai.total();
  const again = await analyze(e, f);
  assert.equal(modeOf(again, 'TC_W_002').mode, 'automate');
  assert.equal(e.ai.total(), before);
});

test('cùng TC ID ở hai sheet: choose chỉ tác động sheet được chỉ định', async () => {
  const e = env();
  const f = await makeManual(e.dir, { sheets: [{ name: 'Sex', cases: [mcase(1)] }, { name: 'Age', cases: [mcase(1)] }] });
  let mi = await analyze(e, f);
  mi = e.conv.choose(mi.id, { sheet: 'Age', tcId: 'TC_W_001', mode: 'manual' });
  assert.equal(modeOf(mi, 'TC_W_001', 'Sex').mode, 'automate');
  assert.equal(modeOf(mi, 'TC_W_001', 'Age').mode, 'manual');
});

test('convert: lần 1 gọi AI + import + gen; lần 2 không đổi → 0 lần gọi AI, không import, status done', async () => {
  const e = env();
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1), mcase(2), mcase(3)] }] });
  const mi = await analyze(e, f);
  await e.conv.convert(mi.id);
  let done = e.conv.get(mi.id);
  assert.equal(done.status, 'done', done.problems.join('; '));
  assert.deepEqual(done.cases.map((c) => c.state), ['converted', 'converted', 'converted']);
  assert.equal(e.imports.length, 1);
  assert.equal(e.store.list('cases').length, 3);
  assert.equal(e.gen.length, 1);
  assert.equal(e.gen[0].length, 3);
  const calls = e.ai.total();
  await analyze(e, f);
  await e.conv.convert(mi.id);
  assert.equal(e.ai.total(), calls);
  assert.equal(e.imports.length, 1);
  assert.equal(e.conv.get(mi.id).status, 'done');
});

test('app chưa ready → vẫn import nhưng không gen và ghi cảnh báo trong review', async () => {
  const e = env({ appStatus: 'preparing' });
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1)] }] });
  const mi = await analyze(e, f);
  await e.conv.convert(mi.id);
  assert.equal(e.gen.length, 0);
  assert.ok(e.conv.get(mi.id).review.some((l) => /chưa sẵn sàng/i.test(l)));
});

test('đổi nội dung 1 case → chỉ viết lại nhóm đó; case đã sửa tay trong automation → conflict, sheet không bị ghi đè cho tới khi giải quyết', async () => {
  const e = env();
  const f1 = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1), mcase(2)] }], file: 'v1.xlsx' });
  const mi = await analyze(e, f1);
  await e.conv.convert(mi.id);
  const stored = e.store.list('cases').find((c) => c.tcId === 'TC_W_002');
  e.store.patch('cases', stored.id, { rowsHash: 'sửa-tay' }); // QA sửa tay rồi import lại file automation
  const f2 = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1), mcase(2, { steps: 'Bước 2 đã đổi' })] }], file: 'v2.xlsx' });
  const mi2 = await analyze(e, f2, 'onboarding.xlsx');
  assert.equal(modeOf(mi2, 'TC_W_001').state, 'converted');
  assert.equal(modeOf(mi2, 'TC_W_002').state, 'conflict');
  const rowsBefore = e.ai.rows.length;
  const imports = e.imports.length;
  await e.conv.convert(mi2.id);
  assert.equal(e.imports.length, imports, 'sheet có conflict không được import');
  assert.match(e.conv.get(mi2.id).problems.join('\n'), /xung đột/i);
  e.conv.resolveConflict(mi2.id, { sheet: 'Welcome', tcId: 'TC_W_002' }, 'reconvert');
  await e.conv.convert(mi2.id);
  assert.equal(e.imports.length, imports + 1);
  assert.equal(e.ai.rows.length, rowsBefore + 1); // chỉ nhóm chứa TC_W_002 được viết lại
  assert.equal(modeOf(e.conv.get(mi2.id), 'TC_W_002').state, 'converted');
});

test('resolveConflict keep: giữ dòng Keyword đã sửa tay (không gọi AI viết lại)', async () => {
  const e = env();
  const f1 = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1)] }], file: 'v1.xlsx' });
  const mi = await analyze(e, f1);
  await e.conv.convert(mi.id);
  const stored = e.store.list('cases')[0];
  e.store.patch('cases', stored.id, { rowsHash: 'sửa-tay' });
  const f2 = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1, { steps: 'đã đổi' })] }], file: 'v2.xlsx' });
  const mi2 = await analyze(e, f2);
  const rows = e.ai.rows.length;
  const kept = e.conv.resolveConflict(mi2.id, { sheet: 'Welcome', tcId: 'TC_W_001' }, 'keep');
  assert.equal(modeOf(kept, 'TC_W_001').state, 'converted');
  await e.conv.convert(mi2.id);
  assert.equal(e.ai.rows.length, rows);
});

test('case biến mất khỏi file manual → vào removed, nhưng case trong store vẫn còn', async () => {
  const e = env();
  const f1 = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1), mcase(2)] }], file: 'v1.xlsx' });
  const mi = await analyze(e, f1);
  await e.conv.convert(mi.id);
  const f2 = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1)] }], file: 'v2.xlsx' });
  const mi2 = await analyze(e, f2);
  assert.deepEqual(mi2.removed, ['Welcome:TC_W_002']);
  assert.equal(e.store.list('cases').length, 2);
});

test('một sheet lỗi (AI luôn sai) → các case sheet đó state error kèm lý do; sheet khác vẫn converted', async () => {
  const e = env({ ai: fakeConvertAi({ rowsFor: (id, fresh) => (id === 'TC_W_001' ? badTc(id, fresh) : goodTc(id, fresh)) }) });
  const f = await makeManual(e.dir, { sheets: [{ name: 'Sex', cases: [mcase(1)] }, { name: 'Age', cases: [mcase(2)] }] });
  const mi = await analyze(e, f);
  await e.conv.convert(mi.id);
  const done = e.conv.get(mi.id);
  assert.equal(modeOf(done, 'TC_W_001', 'Sex').state, 'error');
  assert.match(modeOf(done, 'TC_W_001', 'Sex').error, /label/i);
  assert.equal(modeOf(done, 'TC_W_002', 'Age').state, 'converted');
});

test('tên file có dấu / ngoặc → stem an toàn; file gốc chỉ nằm trong <workspace>/data/manual', async () => {
  const e = env();
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1)] }] });
  const mi = await analyze(e, f, 'Báo cáo (2).xlsx');
  assert.match(mi.stem, /^[A-Za-z0-9_-]+$/);
  assert.ok(fs.existsSync(path.join(e.ws, 'data/manual', `${mi.stem}.xlsx`)));
});

test('convert khi đang converting → lỗi 409', async () => {
  const e = env();
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1)] }] });
  const mi = await analyze(e, f);
  const first = e.conv.convert(mi.id);
  await assert.rejects(() => e.conv.convert(mi.id), (err) => err.status === 409);
  await first;
});

test('sau import phát sự kiện "app" để bảng case của trang Test Cases tự tải lại', async () => {
  const e = env();
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1)] }] });
  const mi = await analyze(e, f);
  await e.conv.convert(mi.id);
  assert.ok(e.events.some(([t, p]) => t === 'app' && p.id === 'app1'));
});

// ---- Sửa sau rà soát độc lập (C1, C2, I1–I7) ----
import { badTc as bad } from './fixtures/convertAi.js';
const conv2 = (e, ai) => createConverter({ store: e.store, map: { locatorTable: () => ({}) }, emit: () => {}, dataDir: path.join(e.dir, 'data'), runClaude: ai,
  generator: { generate: async () => {} }, importer: (a) => importTestcases({ ...a, loaderPath: LOADER }) });

test('C1: hai file manual có sheet trùng tên → file automation đầu ra khác nhau, không xoá case của nhau', async () => {
  const e = env();
  const f1 = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1)] }], file: 'a.xlsx' });
  const f2 = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(2)] }], file: 'b.xlsx' });
  const a = await analyze(e, f1, 'a.xlsx');
  await e.conv.convert(a.id);
  const b = await analyze(e, f2, 'b.xlsx');
  await e.conv.convert(b.id);
  assert.equal(e.store.list('cases').length, 2);
  assert.equal(new Set(e.store.list('cases').map((c) => c.file)).size, 2);
});

test('C1: file automation có sẵn trong store trùng tên đầu ra → không bị ghi đè (đổi tên đầu ra)', async () => {
  const e = env();
  e.store.put('cases', { id: 'app1:onboarding-Welcome-automation:TC_OLD', appId: 'app1', file: 'onboarding-Welcome-automation', tcId: 'TC_OLD', rows: [], rowsHash: 'x', script: { status: 'generated' } });
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1)] }] });
  const mi = await analyze(e, f);
  await e.conv.convert(mi.id);
  assert.ok(e.store.get('cases', 'app1:onboarding-Welcome-automation:TC_OLD'), 'case có sẵn phải còn nguyên');
  assert.equal(e.store.list('cases').length, 2);
});

test('C1: sheet toàn ký tự không phải Latin vẫn ra tên file hợp lệ, không đụng nhau', async () => {
  const e = env();
  const f = await makeManual(e.dir, { sheets: [{ name: 'Đăng nhập', cases: [mcase(1)] }, { name: 'Tuổi', cases: [mcase(2)] }] });
  const mi = await analyze(e, f);
  await e.conv.convert(mi.id);
  assert.equal(e.conv.get(mi.id).status, 'done', e.conv.get(mi.id).problems.join('; '));
  assert.equal(new Set(e.store.list('cases').map((c) => c.file)).size, 2);
});

test('C2: case lỗi chuyển đổi → convert lần hai thử lại và thành converted', async () => {
  const flaky = { fail: true };
  const e = env({ ai: fakeConvertAi({ rowsFor: (id, fresh) => (flaky.fail ? bad(id, fresh) : goodTc(id, fresh)) }) });
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1)] }] });
  const mi = await analyze(e, f);
  await e.conv.convert(mi.id);
  assert.equal(modeOf(e.conv.get(mi.id), 'TC_W_001').state, 'error');
  flaky.fail = false;
  await e.conv.convert(mi.id);
  assert.equal(modeOf(e.conv.get(mi.id), 'TC_W_001').state, 'converted');
  assert.equal(e.store.list('cases').length, 1);
});

test('I1: một nhóm hỏng không bắt cả sheet làm lại — nhóm tốt giữ plan, lần sau chỉ viết lại nhóm hỏng', async () => {
  const flaky = { fail: true };
  const e = env({ ai: fakeConvertAi({ rowsFor: (id, fresh) => (flaky.fail && id === 'TC_W_011' ? bad(id, fresh) : goodTc(id, fresh)) }) });
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: Array.from({ length: 11 }, (_, i) => mcase(i + 1)) }] });
  const mi = await analyze(e, f);
  await e.conv.convert(mi.id);
  const first = e.conv.get(mi.id);
  assert.equal(modeOf(first, 'TC_W_011').state, 'error');
  assert.ok(modeOf(first, 'TC_W_001').plan, 'nhóm tốt giữ plan');
  assert.notEqual(modeOf(first, 'TC_W_001').state, 'error');
  flaky.fail = false;
  const before = e.ai.rows.length;
  await e.conv.convert(mi.id);
  assert.equal(e.ai.rows.length, before + 1, 'chỉ nhóm hỏng được viết lại');
  assert.equal(e.store.list('cases').length, 11);
});

test('I2: đang chuyển đổi / phân tích thì choose, resolveConflict, convert, analyze cùng file đều bị từ chối 409', async () => {
  const slow = (inner) => async (req) => { await new Promise((r) => setTimeout(r, 80)); return inner(req); };
  const e = env({ ai: slow(fakeConvertAi()) });
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1)] }] });
  const mi = await analyze(e, f);
  const p = e.conv.convert(mi.id);
  assert.throws(() => e.conv.choose(mi.id, { sheet: 'Welcome', tcId: 'TC_W_001', mode: 'manual' }), (err) => err.status === 409);
  assert.throws(() => e.conv.resolveConflict(mi.id, { sheet: 'Welcome', tcId: 'TC_W_001' }, 'keep'), (err) => err.status === 409);
  assert.equal(e.conv.busy(mi.id), true);
  await assert.rejects(() => analyze(e, f), (err) => err.status === 409);
  await p;
  assert.equal(e.conv.busy(mi.id), false);
  const f2 = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1, { steps: 'Chờ popup' })] }], file: 'p.xlsx' });
  const a1 = analyze(e, f2, 'p.xlsx');
  await assert.rejects(() => analyze(e, f2, 'p.xlsx'), (err) => err.status === 409);
  await a1;
});

test('I3: server khởi động lại giữa chừng → trạng thái analyzing/converting thành error; analyze dở không để lại phân loại sai', async () => {
  const e = env();
  e.store.put('manualImports', { id: 'app1:stuck', appId: 'app1', status: 'converting', cases: [], sheets: [], removed: [], review: [], sheetReview: {}, problems: [] });
  conv2(e, fakeConvertAi());
  assert.equal(e.store.get('manualImports', 'app1:stuck').status, 'error');
  assert.match(e.store.get('manualImports', 'app1:stuck').error, /gián đoạn/);
  // analyze chết giữa lúc phân loại (AI ném lỗi) → lần analyze sau phải phân loại lại, không tin kết quả mặc định
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1, { steps: 'Chờ popup quảng cáo' })] }] });
  const boom = async () => { throw new Error('boom'); };
  await assert.rejects(() => conv2(e, boom).analyze({ appId: 'app1', srcPath: f, fileName: 'onboarding.xlsx' }));
  const ai = fakeConvertAi({ manual: ['TC_W_001'] });
  const mi = await conv2(e, ai).analyze({ appId: 'app1', srcPath: f, fileName: 'onboarding.xlsx' });
  assert.equal(ai.filter, 1);
  assert.equal(modeOf(mi, 'TC_W_001').mode, 'manual');
});

test('I4: cùng TC ID ở hai sheet → phân loại theo từng sheet, không trộn', async () => {
  const e = env();
  const f = await makeManual(e.dir, { sheets: [{ name: 'Sex', cases: [mcase(1, { steps: 'Bấm Continue with Google' })] }, { name: 'Age', cases: [mcase(1)] }] });
  const mi = await analyze(e, f);
  assert.equal(modeOf(mi, 'TC_W_001', 'Sex').mode, 'manual');
  assert.equal(modeOf(mi, 'TC_W_001', 'Age').mode, 'automate');
});

test('I5: thông báo theo kiểu file — automation chỉ cách chọn lại; file lạ nêu cột cần có và các sheet đã thấy', async () => {
  const e = env();
  const AUTOMATION = path.join(path.dirname(fileURLToPath(import.meta.url)), '../samples/apidemos-automation.xlsx');
  await assert.rejects(() => analyze(e, AUTOMATION), (err) => err.status === 400 && /File automation/.test(err.message));
  const odd = await makeManual(e.dir, { sheets: [{ name: 'Sheet Lạ', cases: [mcase(1)] }], noHeader: true });
  await assert.rejects(() => analyze(e, odd), (err) => err.status === 400 && /Test Case #/.test(err.message) && /Sheet Lạ/.test(err.message) && !/chọn Import → File automation/.test(err.message));
});

test('I6: sự kiện manualImport không mang nội dung manual gốc (src) và dòng Keyword (plan)', async () => {
  const e = env();
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1)] }] });
  const mi = await analyze(e, f);
  await e.conv.convert(mi.id);
  const sent = e.events.filter(([t]) => t === 'manualImport');
  assert.ok(sent.length > 2);
  for (const [, p] of sent) for (const c of p.cases) assert.ok(!('src' in c) && !('plan' in c));
});

test('I7: "Giữ bản sửa tay" từ chối case dùng TestData (dataSet) thay vì làm mất âm thầm', async () => {
  const e = env();
  const f1 = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1)] }], file: 'v1.xlsx' });
  const mi = await analyze(e, f1);
  await e.conv.convert(mi.id);
  const stored = e.store.list('cases')[0];
  e.store.patch('cases', stored.id, { rowsHash: 'sửa-tay', dataSet: 'DS1' });
  const f2 = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1, { steps: 'đã đổi' })] }], file: 'v2.xlsx' });
  const mi2 = await analyze(e, f2);
  assert.throws(() => e.conv.resolveConflict(mi2.id, { sheet: 'Welcome', tcId: 'TC_W_001' }, 'keep'), (err) => err.status === 409 && /TestData/.test(err.message));
});

test('convert(id, { gen: false }) → vẫn import nhưng không gen script, có ghi chú trong review', async () => {
  const e = env();
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1)] }] });
  const mi = await analyze(e, f);
  await e.conv.convert(mi.id, { gen: false });
  assert.equal(e.store.list('cases').length, 1);
  assert.equal(e.gen.length, 0);
  assert.ok(e.conv.get(mi.id).review.some((l) => /Chưa gen script/.test(l)));
});

test('gián đoạn giữa chừng: nhóm đã viết xong được lưu ngay; chuyển đổi lại dùng lại khung + plan, chỉ viết nhóm còn lại', async () => {
  let crash = true;
  const inner = fakeConvertAi();
  const ai = async (req) => {
    if (!req.schema.properties.order && !req.schema.properties.decisions && crash && /TC_W_011/.test(req.prompt) && !/TC_W_001/.test(req.prompt)) throw new Error('mất kết nối');
    return inner(req);
  };
  const e = env({ ai });
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: Array.from({ length: 11 }, (_, i) => mcase(i + 1)) }] });
  const mi = await analyze(e, f);
  await assert.rejects(() => e.conv.convert(mi.id), /mất kết nối/);
  const mid = e.conv.get(mi.id);
  assert.equal(mid.status, 'error');
  assert.ok(modeOf(mid, 'TC_W_001').plan && modeOf(mid, 'TC_W_001').cached, 'nhóm đã xong được lưu');
  assert.ok(mid.skeletons.Welcome, 'khung được lưu');
  crash = false;
  const skeletonCalls = inner.skeleton;
  const rowsBefore = inner.rows.length;
  await e.conv.convert(mi.id);
  assert.equal(e.conv.get(mi.id).status, 'done', e.conv.get(mi.id).problems.join('; '));
  assert.equal(inner.skeleton, skeletonCalls, 'không lập khung lại');
  assert.equal(inner.rows.length, rowsBefore + 1, 'chỉ viết nhóm còn thiếu');
  assert.equal(e.store.list('cases').length, 11);
});

test('đổi lựa chọn automate/manual → chữ ký đổi, khung được lập lại (không dùng khung cũ)', async () => {
  const e = env();
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1), mcase(2)] }] });
  const mi = await analyze(e, f);
  await e.conv.convert(mi.id);
  const before = e.ai.skeleton;
  e.conv.choose(mi.id, { sheet: 'Welcome', tcId: 'TC_W_002', mode: 'manual' });
  await e.conv.convert(mi.id);
  assert.equal(e.ai.skeleton, before + 1);
});

test('stop: dừng giữa chừng → status stopped (không phải lỗi), nhóm đã xong giữ plan, chuyển lại chỉ viết nhóm còn thiếu', async () => {
  const inner = fakeConvertAi();
  let waiting;
  const started = new Promise((r) => { waiting = r; });
  let hang = true;
  const ai = async (req) => {
    const isRows = !req.schema.properties.order && !req.schema.properties.decisions;
    if (hang && isRows && /TC_W_011/.test(req.prompt) && !/TC_W_001/.test(req.prompt)) {
      waiting();
      await new Promise((r) => req.signal.addEventListener('abort', r, { once: true }));
      return { ok: false, cancelled: true, error: 'Đã dừng' };
    }
    return inner(req);
  };
  const e = env({ ai });
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: Array.from({ length: 11 }, (_, i) => mcase(i + 1)) }] });
  const mi = await analyze(e, f);
  const run = e.conv.convert(mi.id);
  await started;
  e.conv.stop(mi.id);
  await run;
  const mid = e.conv.get(mi.id);
  assert.equal(mid.status, 'stopped');
  assert.deepEqual(mid.problems, []);
  assert.ok(modeOf(mid, 'TC_W_001').cached, 'nhóm đã xong giữ plan');
  assert.ok(mid.cases.every((c) => c.state !== 'error'), 'dừng không đánh dấu case lỗi');
  assert.equal(e.store.list('cases').length, 0, 'chưa import gì');
  assert.throws(() => e.conv.stop(mi.id), (err) => err.status === 409, 'không còn gì để dừng');
  hang = false;
  const rowsBefore = inner.rows.length;
  await e.conv.convert(mi.id);
  assert.equal(e.conv.get(mi.id).status, 'done', e.conv.get(mi.id).problems.join('; '));
  assert.equal(inner.rows.length, rowsBefore + 1, 'chỉ viết nhóm bị dừng');
  assert.equal(e.store.list('cases').length, 11);
});

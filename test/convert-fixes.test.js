// Sửa lỗi chuyển đổi manual → automation (khoá case, lệch tài liệu, lỗi nhóm, case chuyển manual, khớp TC ID, pre có thao tác…)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpDir } from './helpers.js';
import { makeManual } from './fixtures/manualWorkbook.js';
import { fakeConvertAi, goodTc } from './fixtures/convertAi.js';
import { createStore } from '../server/store.js';
import { importTestcases } from '../server/testcases/importXlsx.js';
import { createConverter, specRulesOf } from '../server/testcases/convert/converter.js';
import { convertSheet, dropUnusedFlows } from '../server/testcases/convert/writeXlsx.js';
import { mentionsId, checkChain, isActionPre } from '../server/testcases/convert/appCheck.js';

const LOADER = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/apps/template/data/loaders/testcase-v2.js');
const mcase = (n, extra = {}) => ({ id: `TC_W_${String(n).padStart(3, '0')}`, priority: 'High', steps: `Bước ${n}`, ...extra });

function env({ ai = fakeConvertAi(), locatorTable = {}, generator } = {}) {
  const dir = tmpDir();
  const store = createStore(path.join(dir, 'store'));
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  store.put('apps', { id: 'app1', name: 'App', workspace: ws, status: 'ready', platform: 'iOS' });
  const conv = createConverter({
    store, map: { locatorTable: () => locatorTable }, emit: () => {}, dataDir: path.join(dir, 'data'), runClaude: ai,
    generator: generator || { generate: async () => {} },
    importer: (a) => importTestcases({ ...a, loaderPath: LOADER }),
  });
  return { dir, store, ws, conv, ai };
}
const analyze = (e, file, name = 'onboarding.xlsx') => e.conv.analyze({ appId: 'app1', srcPath: file, fileName: name });
const caseOf = (mi, id, sheet = 'Welcome') => mi.cases.find((c) => c.id === id && c.sheet === sheet);
const stored = (e, mi, id) => e.store.get('cases', `app1:${caseOf(mi, id).outFile}:${id}`);

// ---- #10 khớp TC ID theo ranh giới từ
test('mentionsId: TC_1 không khớp TC_10 / TC_1a; khớp khi đứng riêng hoặc trước dấu câu', () => {
  assert.equal(mentionsId('TC_10 step 1: lỗi', 'TC_1'), false);
  assert.equal(mentionsId('TC_1a: lỗi', 'TC_1'), false);
  assert.equal(mentionsId('TC_1 step 1: lỗi', 'TC_1'), true);
  assert.equal(mentionsId('Thiếu TC_1, TC_2 trong kết quả', 'TC_2'), true);
  assert.equal(mentionsId('lỗi (TC.1)', 'TC.1'), true);
});

// ---- #13 pre có thao tác / case tiếp nối kiểm trạng thái ban đầu
test('checkChain: pre có thao tác của case tiếp nối → lỗi; case fresh / pre là điều kiện → không', () => {
  assert.equal(isActionPre('Tap "Weekly" để bỏ chọn'), true);
  assert.equal(isActionPre('2. Bỏ chọn tất cả mục'), true);
  assert.equal(isActionPre('Back về màn Home'), true);
  assert.equal(isActionPre('Background app đang chạy'), false);
  assert.equal(isActionPre('Đang ở màn Home, chưa chọn mục nào'), false);
  const p = checkChain({ testcases: [
    { id: 'TC_A', fresh: true, pre: ['Tap Start → màn X'], rows: [] },
    { id: 'TC_B', fresh: false, pre: ['Đang ở màn X', 'Tap Back về màn Y'], rows: [] },
  ] });
  assert.deepEqual(p, ['TC_B pre: "Tap Back về màn Y" là thao tác — viết thành dòng Action ở Step 0 (pre chỉ ghi điều kiện, không được chạy)']);
});

test('checkChain: case trước bấm "Weekly", case tiếp nối kiểm ngay "Weekly" chưa chọn → lỗi; có Deselect all / Tap ở Step 0 hoặc fresh → không', () => {
  const prev = { id: 'TC_A', fresh: true, rows: [{ step: 1, screen: 'S', kind: 'Action', keyword: 'Tap', target: 'Weekly' }] };
  const chk = { step: 1, screen: 'S', kind: 'Check', keyword: 'Verify not selected', target: 'Weekly', label: 'x' };
  const bad = checkChain({ testcases: [prev, { id: 'TC_B', fresh: false, rows: [chk] }] });
  assert.equal(bad.length, 1);
  assert.match(bad[0], /^TC_B step 1: Verify not selected "Weekly" .*TC_A/);
  assert.deepEqual(checkChain({ testcases: [prev, { id: 'TC_B', fresh: false, rows: [{ step: 0, screen: 'S', kind: 'Action', keyword: 'Deselect all' }, chk] }] }), []);
  assert.deepEqual(checkChain({ testcases: [prev, { id: 'TC_B', fresh: false, rows: [{ step: 0, screen: 'S', kind: 'Action', keyword: 'Tap', target: 'Weekly' }, chk] }] }), []);
  assert.deepEqual(checkChain({ testcases: [prev, { id: 'TC_B', fresh: true, rows: [chk] }] }), []);
  assert.deepEqual(checkChain({ testcases: [prev, { id: 'TC_B', fresh: false, rows: [chk] }], only: new Set(['TC_A']) }), [], 'case khoá không kiểm');
});

test('convertSheet: pre có thao tác → feedback cho AI, AI chuyển thành Action ở Step 0', async () => {
  const calls = [];
  const ai = fakeConvertAi({ rowsFor: (id, fresh, n) => (id === 'TC_W_002' && n === 1 ? { ...goodTc(id, fresh), pre: ['Tap Back về màn Welcome'] } : goodTc(id, fresh)) });
  const wrap = async (req) => { if (req.schema.properties.testcases) calls.push(req.prompt); return ai(req); };
  const cases = [mcase(1), mcase(2)].map((c) => ({ ...c, selected: true }));
  const r = await convertSheet({ sheet: { sheet: 'Welcome', cases }, decisions: cases.map((c) => ({ id: c.id, mode: 'automate' })), runClaude: wrap, outDir: tmpDir() });
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.equal(calls.length, 2);
  assert.match(calls[1], /TC_W_002 pre: "Tap Back về màn Welcome" là thao tác/);
});

// ---- #2 chỉ khoá case người gọi chỉ định (plan "cached" vẫn được hậu kiểm)
test('convertSheet({ locked }): plan cached không nằm trong locked → vẫn hậu kiểm (sửa được); không truyền locked → giữ cách cũ', async () => {
  const cases = [mcase(1), mcase(2)].map((c) => ({ ...c, selected: true }));
  const skeleton = { order: [{ id: 'TC_W_001', fresh: true }, { id: 'TC_W_002', fresh: false }], groups: [['TC_W_001'], ['TC_W_002']], flows: {} };
  const cache = { TC_W_001: goodTc('TC_W_001', true), TC_W_002: { ...goodTc('TC_W_002', false), pre: ['Tap Back về màn Welcome'] } };
  const dec = cases.map((c) => ({ id: c.id, mode: 'automate' }));
  const ai1 = fakeConvertAi();
  const r1 = await convertSheet({ sheet: { sheet: 'Welcome', cases }, decisions: dec, runClaude: ai1, outDir: tmpDir(), cache, skeleton, locked: ['TC_W_001'] });
  assert.equal(r1.ok, true);
  assert.deepEqual(ai1.rows, [['TC_W_002']], 'chỉ case cached (không khoá) được viết lại');
  const ai2 = fakeConvertAi();
  await convertSheet({ sheet: { sheet: 'Welcome', cases }, decisions: dec, runClaude: ai2, outDir: tmpDir(), cache, skeleton });
  assert.equal(ai2.rows.length, 0);
});

// ---- #7 dừng trong vòng sửa lỗi → vẫn trả plans
test('convertSheet: dừng sau khi đã viết xong nhóm → plans vẫn còn (không trả {})', async () => {
  const ctl = new AbortController();
  const cases = [mcase(1)].map((c) => ({ ...c, selected: true }));
  const r = await convertSheet({ sheet: { sheet: 'Welcome', cases }, decisions: [{ id: 'TC_W_001', mode: 'automate' }], runClaude: fakeConvertAi(), outDir: tmpDir(), signal: ctl.signal, onGroup: () => ctl.abort() });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.plans), ['TC_W_001']);
});

// ---- #4 luồng không TC nào dùng
test('dropUnusedFlows: bỏ luồng không TC nào gọi, giữ luồng có dùng', () => {
  const plan = { testcases: [{ id: 'T', rows: [{ keyword: 'Run flow', value: 'A' }] }], flows: { A: [{}], B: [{}] } };
  assert.deepEqual(Object.keys(dropUnusedFlows(plan).flows), ['A']);
});

// ---- #8 luật lệch tài liệu lấy từ lựa chọn đã lưu, không từ specDiffs (bị làm mới)
test('specRulesOf: specDiffs đã rỗng vẫn ra luật từ specChoice + specRuleOf; dữ liệu cũ (chỉ specDiffs) vẫn đọc được', () => {
  const r = specRulesOf({ specChoice: { '1|How old': 'doc', '2|Weekly': 'app' }, specRuleOf: { '1|How old': { step: 1, manual: 'How old', app: 'Which age' } }, specDiffs: [] });
  assert.deepEqual(r.enforce, [{ step: 1, manual: 'How old', app: 'Which age' }]);
  assert.deepEqual(r.allow, [{ step: 2, manual: 'Weekly' }]);
  const old = specRulesOf({ specChoice: { '1|How old': 'doc' }, specDiffs: [{ step: 1, manual: 'How old', app: 'Which age', fixed: false }] });
  assert.deepEqual(old.enforce, [{ step: 1, manual: 'How old', app: 'Which age' }]);
});

// ---- #1 #5 specChoose "doc" được áp dụng khi chuyển lại một phần; lệch của case khoá không bị xoá
test('specChoose "doc" cho 1 case khi case khác đã khoá → Check đổi về chữ tài liệu; specDiffs của case khoá giữ nguyên', async () => {
  const APP = 'Which age group are you in?';
  const rowsFor = (id, fresh) => ({ id, fresh, pre: [], rows: [
    ...(fresh ? [{ step: 1, screen: 'Welcome', kind: 'Action', keyword: 'Launch fresh' }, { step: 1, screen: 'Welcome', kind: 'Nav', keyword: 'Verify screen', target: 'Welcome' }, { step: 1, screen: 'Welcome', kind: 'Check', keyword: 'Verify displayed', target: 'Welcome', label: 'Màn' }] : []),
    { step: 1, screen: 'Welcome', kind: 'Check', keyword: 'Verify text', target: APP, value: APP, compare: 'equals', label: 'Tiêu đề' }] });
  const e = env({ ai: fakeConvertAi({ rowsFor }), locatorTable: { Welcome: [{ key: APP }, { key: 'Welcome' }] } });
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1, { expected: '1. Hiển thị "How old are you?"' }), mcase(2, { expected: '1. Hiển thị "How old are you?"' })] }] });
  const mi = await analyze(e, f);
  await e.conv.convert(mi.id);
  let cur = e.conv.get(mi.id);
  assert.equal(caseOf(cur, 'TC_W_002').state, 'converted');
  const d = caseOf(cur, 'TC_W_002').specDiffs[0];
  assert.equal(d.app, APP);
  const diffs1 = caseOf(cur, 'TC_W_001').specDiffs;
  assert.equal(diffs1.length, 1);
  e.conv.specChoose(mi.id, { sheet: 'Welcome', tcId: 'TC_W_002', step: d.step, manual: d.manual, app: d.app, choice: 'doc' });
  const rowsBefore = e.ai.rows.length;
  await e.conv.convert(mi.id);
  cur = e.conv.get(mi.id);
  assert.equal(e.ai.rows.length, rowsBefore, 'không gọi AI viết lại');
  assert.equal(caseOf(cur, 'TC_W_002').state, 'converted');
  assert.ok(stored(e, cur, 'TC_W_002').rows.some((r) => r.value === 'How old are you?'), 'Check theo tài liệu');
  assert.ok(caseOf(cur, 'TC_W_002').specDiffs.some((x) => x.byUser && x.fixed));
  assert.deepEqual(caseOf(cur, 'TC_W_001').specDiffs, diffs1, 'case khoá giữ lệch cũ');
  // #5: mọi case trong file vừa ghi có outHash khớp store → analyze lại không báo xung đột
  for (const id of ['TC_W_001', 'TC_W_002']) assert.equal(caseOf(cur, id).outHash, stored(e, cur, id).rowsHash);
  const again = await analyze(e, f);
  assert.ok(again.cases.every((c) => c.state === 'converted'));
});

test('#5: case đã chuyển xong thiếu outHash (dữ liệu cũ) → lần ghi sau cập nhật cho mọi case automate của file', async () => {
  const e = env();
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1), mcase(2), mcase(3)] }] });
  const mi = await analyze(e, f);
  await e.conv.convert(mi.id);
  const cur = e.store.get('manualImports', mi.id);
  delete caseOf(cur, 'TC_W_001').outHash;
  e.store.put('manualImports', cur);
  e.conv.choose(mi.id, { sheet: 'Welcome', tcId: 'TC_W_003', mode: 'manual' });
  await e.conv.convert(mi.id);
  const done = e.conv.get(mi.id);
  assert.equal(caseOf(done, 'TC_W_001').outHash, stored(e, done, 'TC_W_001').rowsHash);
});

// ---- #3 lỗi nhóm không nhắc TC nào → nhóm đã xong giữ plan
test('lỗi nhóm không nhắc TC ID nào → chỉ case chưa viết thành error, nhóm đã xong giữ plan (cached)', async () => {
  const inner = fakeConvertAi();
  const ai = async (req) => {
    if (req.schema.properties.testcases && /TC_W_011/.test(req.prompt) && !/TC_W_001/.test(req.prompt)) return { ok: false, error: 'hết thời gian' };
    return inner(req);
  };
  const e = env({ ai });
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: Array.from({ length: 11 }, (_, i) => mcase(i + 1)) }] });
  const mi = await analyze(e, f);
  await e.conv.convert(mi.id);
  const done = e.conv.get(mi.id);
  assert.equal(caseOf(done, 'TC_W_011').state, 'error');
  assert.equal(caseOf(done, 'TC_W_001').state, 'pending');
  assert.ok(caseOf(done, 'TC_W_001').plan && caseOf(done, 'TC_W_001').cached);
});

// ---- #6 trả lời điểm mờ không lập lại khung
test('trả lời điểm mờ sau khi chuyển → chỉ viết lại case đó, không lập lại khung', async () => {
  const e = env();
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1), mcase(2)] }] });
  const mi = await analyze(e, f);
  await e.conv.convert(mi.id);
  const sk = e.ai.skeleton;
  const rows = e.ai.rows.length;
  e.conv.clarify(mi.id, { sheet: 'Welcome', tcId: 'TC_W_002', answers: { EMPTY_PRE: 'Tiếp nối TC_W_001' } });
  await e.conv.convert(mi.id);
  assert.equal(e.ai.skeleton, sk);
  assert.deepEqual(e.ai.rows.slice(rows), [['TC_W_002']]);
});

// ---- #9 case chuyển sang manual
test('mọi case chuyển manual → case của file automation cũ bị gỡ khỏi store; outFile được xoá', async () => {
  const removed = [];
  const e = env({ generator: { generate: async () => {}, refreshScript: async () => null, scriptPath: (app, file) => { removed.push(file); return path.join(app.workspace, 'scripts', `${file}.js`); } } });
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1), mcase(2)] }] });
  const mi = await analyze(e, f);
  await e.conv.convert(mi.id);
  assert.equal(e.store.list('cases').length, 2);
  e.conv.choose(mi.id, { sheet: 'Welcome', tcId: 'TC_W_001', mode: 'manual' });
  e.conv.choose(mi.id, { sheet: 'Welcome', tcId: 'TC_W_002', mode: 'manual' });
  await e.conv.convert(mi.id);
  const done = e.conv.get(mi.id);
  assert.equal(done.status, 'done', done.problems.join('; '));
  assert.equal(e.store.list('cases').length, 0);
  assert.equal(removed.length, 1);
  assert.ok(done.cases.every((c) => c.state === 'converted' && !c.outFile));
});

test('một case chuyển manual + sheet lỗi → case manual vẫn chờ (file chưa ghi lại), không đánh dấu converted', async () => {
  const flaky = { fail: false };
  const e = env({ ai: fakeConvertAi({ rowsFor: (id, fresh) => (flaky.fail ? { ...goodTc(id, fresh), rows: goodTc(id, fresh).rows.map((r) => (r.kind === 'Check' ? { ...r, label: undefined } : r)) } : goodTc(id, fresh)) }) });
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1), mcase(2)] }] });
  const mi = await analyze(e, f);
  await e.conv.convert(mi.id);
  e.conv.choose(mi.id, { sheet: 'Welcome', tcId: 'TC_W_002', mode: 'manual' });
  e.conv.clarify(mi.id, { sheet: 'Welcome', tcId: 'TC_W_001', answers: { EMPTY_PRE: 'x' } });
  flaky.fail = true;
  await e.conv.convert(mi.id);
  const done = e.conv.get(mi.id);
  assert.equal(caseOf(done, 'TC_W_002').state, 'pending');
  assert.equal(e.store.list('cases').length, 2, 'file automation chưa đổi');
});

// ---- #11 trạng thái khi không ghi được gì + nhãn tiến độ có số sheet
test('không sheet nào ghi được → status error (kèm problems); nhiều sheet → nhãn tiến độ có "Sheet i/n"', async () => {
  const bad = (id, fresh) => ({ ...goodTc(id, fresh), rows: goodTc(id, fresh).rows.map((r) => (r.kind === 'Check' ? { ...r, label: undefined } : r)) });
  const e = env({ ai: fakeConvertAi({ rowsFor: bad }) });
  const f = await makeManual(e.dir, { sheets: [{ name: 'Welcome', cases: [mcase(1)] }] });
  const mi = await analyze(e, f);
  await e.conv.convert(mi.id);
  const done = e.conv.get(mi.id);
  assert.equal(done.status, 'error');
  assert.ok(done.problems.length && done.error);

  const labels = [];
  const e2 = env();
  const orig = e2.store.put.bind(e2.store);
  e2.store.put = (kind, v) => { if (kind === 'manualImports' && v.progress?.label) labels.push(v.progress.label); return orig(kind, v); };
  const f2 = await makeManual(e2.dir, { sheets: [{ name: 'A', cases: [mcase(1)] }, { name: 'B', cases: [mcase(2)] }] });
  const m2 = await analyze(e2, f2);
  await e2.conv.convert(m2.id);
  assert.ok(labels.some((l) => /^Sheet 1\/2 · /.test(l)) && labels.some((l) => /^Sheet 2\/2 · /.test(l)));
  assert.equal(e2.conv.get(m2.id).status, 'done');
});

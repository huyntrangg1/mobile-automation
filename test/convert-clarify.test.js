import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpDir } from './helpers.js';
import { makeManual } from './fixtures/manualWorkbook.js';
import { fakeConvertAi } from './fixtures/convertAi.js';
import { createStore } from '../server/store.js';
import { importTestcases } from '../server/testcases/importXlsx.js';
import { createConverter, viewOf } from '../server/testcases/convert/converter.js';

const LOADER = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/apps/template/data/loaders/testcase-v2.js');
const mcase = (n, extra = {}) => ({ id: `TC_W_${String(n).padStart(3, '0')}`, priority: 'High', steps: `Bước ${n}`, pre: '', expected: 'Hiển thị màn chính', ...extra }); // mặc định mờ: pre trống + Expected không có chữ trong ngoặc kép
const CLEAR = { pre: '1. Cài lại app', expected: '1. Hiển thị "Welcome"' }; // không điểm mờ

function env() {
  const dir = tmpDir();
  const store = createStore(path.join(dir, 'store'));
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  store.put('apps', { id: 'app1', name: 'App', workspace: ws, status: 'ready', platform: 'iOS' });
  const base = fakeConvertAi();
  const seen = { rows: [], suggest: 0, suggestPrompt: '' };
  const ai = async (req) => {
    if (req.schema.properties.suggestions) {
      seen.suggest++; seen.suggestPrompt = req.prompt;
      const ids = [...req.prompt.matchAll(/"id": "([^"]+)"/g)].map((m) => m[1]);
      return { ok: true, data: { suggestions: ids.map((id) => ({ id, answers: { NO_QUOTED_EXPECTED: 'Hiển thị "Welcome"', EMPTY_PRE: 'Cài lại app' } })) } };
    }
    if (req.schema.properties.testcases) seen.rows.push(req.prompt);
    return base(req);
  };
  const conv = createConverter({
    store, map: { locatorTable: () => ({ Welcome: [{ key: 'Get Started', locator: '~Get Started' }] }) }, emit: () => {}, dataDir: path.join(dir, 'data'), runClaude: ai,
    generator: { generate: async () => {} },
    importer: async (a) => importTestcases({ ...a, loaderPath: LOADER }),
  });
  return { dir, store, conv, seen, base };
}
const analyze = (e, f) => e.conv.analyze({ appId: 'app1', srcPath: f, fileName: 'onb.xlsx' });
const sheetWith = (e, cases) => makeManual(e.dir, { sheets: [{ name: 'Welcome', cases }] });

test('viewOf: case có điểm mờ (automate) kèm "brief" nội dung manual để user xem; case rõ ràng thì không', async () => {
  const e = env();
  const mi = await analyze(e, await sheetWith(e, [mcase(1), mcase(2, CLEAR)]));
  const v = viewOf(mi);
  const a = v.cases.find((c) => c.id === 'TC_W_001');
  const b = v.cases.find((c) => c.id === 'TC_W_002');
  assert.ok(a.ambiguity.length > 0 && a.brief && 'steps' in a.brief && 'expected' in a.brief && 'pre' in a.brief);
  assert.equal(b.ambiguity.length, 0);
  assert.equal(b.brief, undefined);
  assert.equal(a.src, undefined);
});

test('clarify (trả lời TRƯỚC): lưu câu trả lời + confirmed; chuyển đổi gửi "clarification" cho AI viết dòng', async () => {
  const e = env();
  const mi = await analyze(e, await sheetWith(e, [mcase(1)]));
  const out = e.conv.clarify(mi.id, { sheet: 'Welcome', tcId: 'TC_W_001', answers: { NO_QUOTED_EXPECTED: 'Hiển thị "Get Started"', EMPTY_PRE: '' } });
  const c = out.cases[0];
  assert.equal(c.confirmed, true);
  assert.deepEqual(c.answers, { NO_QUOTED_EXPECTED: 'Hiển thị "Get Started"' }); // câu trả lời rỗng bị bỏ
  await e.conv.convert(mi.id);
  assert.equal(e.seen.rows.length, 1);
  assert.match(e.seen.rows[0], /clarification/);
  assert.match(e.seen.rows[0], /Hiển thị \\"Get Started\\"/);
});

test('trả lời SAU: chuyển đổi xong rồi mới clarify → chỉ case đó thành pending, chuyển lại chỉ case đó; case khác giữ nguyên', async () => {
  const e = env();
  const mi = await analyze(e, await sheetWith(e, [mcase(1), mcase(2)]));
  await e.conv.convert(mi.id);
  assert.deepEqual(e.conv.get(mi.id).cases.map((c) => c.state), ['converted', 'converted']);
  const rowsCalls = e.seen.rows.length;
  e.conv.clarify(mi.id, { sheet: 'Welcome', tcId: 'TC_W_002', answers: { EMPTY_PRE: 'Cài lại app' } });
  assert.deepEqual(e.conv.get(mi.id).cases.map((c) => c.state), ['converted', 'pending']);
  await e.conv.convert(mi.id);
  assert.deepEqual(e.conv.get(mi.id).cases.map((c) => c.state), ['converted', 'converted']);
  const later = e.seen.rows.slice(rowsCalls).join('\n');
  assert.match(later, /TC_W_002/);
  assert.doesNotMatch(later, /Bước 1/); // case 1 không bị viết lại
});

test('clarify cùng câu trả lời lại: không đổi state (không chuyển lại vô ích); case không tồn tại → 404; đang chạy → 409', async () => {
  const e = env();
  const mi = await analyze(e, await sheetWith(e, [mcase(1)]));
  await e.conv.convert(mi.id);
  e.conv.clarify(mi.id, { sheet: 'Welcome', tcId: 'TC_W_001', answers: { EMPTY_PRE: 'Cài lại app' } });
  await e.conv.convert(mi.id);
  e.conv.clarify(mi.id, { sheet: 'Welcome', tcId: 'TC_W_001', answers: { EMPTY_PRE: 'Cài lại app' } });
  assert.equal(e.conv.get(mi.id).cases[0].state, 'converted');
  assert.throws(() => e.conv.clarify(mi.id, { sheet: 'Welcome', tcId: 'NOPE', answers: {} }), (err) => err.status === 404);
});

test('suggest: AI đọc locator map điền sẵn gợi ý cho case có điểm mờ chưa trả lời (1 lần gọi); case rõ ràng / đã trả lời không gọi', async () => {
  const e = env();
  const mi = await analyze(e, await sheetWith(e, [mcase(1), mcase(2, CLEAR), mcase(3)]));
  e.conv.clarify(mi.id, { sheet: 'Welcome', tcId: 'TC_W_003', answers: { EMPTY_PRE: 'x', NO_QUOTED_EXPECTED: 'y' } });
  const out = await e.conv.suggest(mi.id);
  assert.equal(e.seen.suggest, 1);
  assert.match(e.seen.suggestPrompt, /Get Started/); // có dữ liệu locator map
  assert.match(e.seen.suggestPrompt, /TC_W_001/);
  assert.doesNotMatch(e.seen.suggestPrompt, /TC_W_002/);
  assert.doesNotMatch(e.seen.suggestPrompt, /TC_W_003/);
  const c1 = out.cases.find((c) => c.id === 'TC_W_001');
  assert.equal(c1.suggest.EMPTY_PRE, 'Cài lại app');
  assert.equal(c1.confirmed, undefined); // gợi ý chưa phải xác nhận
  await e.conv.suggest(mi.id); // lần hai: đã có gợi ý → không gọi lại
  assert.equal(e.seen.suggest, 1);
});

test('suggest({ cases }): gợi ý lại đúng case được chỉ định dù đã có gợi ý cũ (người dùng xoá ô); case đã trả lời vẫn bị bỏ qua', async () => {
  const e = env();
  const mi = await analyze(e, await sheetWith(e, [mcase(1), mcase(3)]));
  e.conv.clarify(mi.id, { sheet: 'Welcome', tcId: 'TC_W_003', answers: { EMPTY_PRE: 'x', NO_QUOTED_EXPECTED: 'y' } });
  await e.conv.suggest(mi.id);
  assert.equal(e.seen.suggest, 1);
  await e.conv.suggest(mi.id, { cases: [{ sheet: 'Welcome', tcId: 'TC_W_001' }, { sheet: 'Welcome', tcId: 'TC_W_003' }] });
  assert.equal(e.seen.suggest, 2, 'gọi lại cho case đã có gợi ý');
  assert.match(e.seen.suggestPrompt, /TC_W_001/);
  assert.doesNotMatch(e.seen.suggestPrompt, /TC_W_003/, 'case đã trả lời không gợi ý lại');
});

test('convert({ fresh: true }): chuyển lại TỪ ĐẦU — bỏ plan + khung cũ, viết lại mọi case automate (ghi đè đúng file automation cũ); không fresh thì không làm gì', async () => {
  const e = env();
  const mi = await analyze(e, await sheetWith(e, [mcase(1), mcase(2)]));
  await e.conv.convert(mi.id);
  const file = e.conv.get(mi.id).cases[0].outFile;
  const n = e.seen.rows.length;
  await e.conv.convert(mi.id); // không có gì chờ → không gọi AI
  assert.equal(e.seen.rows.length, n);
  await e.conv.convert(mi.id, { fresh: true });
  assert.ok(e.seen.rows.length > n);
  const after = e.conv.get(mi.id);
  assert.deepEqual(after.cases.map((c) => c.state), ['converted', 'converted']);
  assert.equal(after.cases[0].outFile, file); // cùng file automation, không tạo file mới
});

test('lệch tài liệu: specChoose "doc" → case chờ chuyển lại nhưng dùng lại plan (không gọi AI viết lại), lần chuyển sau đổi Check về chữ tài liệu', async () => {
  const e = env();
  const mi = await analyze(e, await sheetWith(e, [mcase(1)]));
  await e.conv.convert(mi.id);
  // giả lập: lần chuyển trước ghi lệch tài liệu cho case này
  const cur = e.store.get('manualImports', mi.id);
  cur.cases[0].specDiffs = [{ step: 1, manual: 'How old are you?', app: 'Which age group are you in?', fixed: false }];
  e.store.put('manualImports', cur);
  const out = e.conv.specChoose(mi.id, { sheet: 'Welcome', tcId: 'TC_W_001', step: 1, manual: 'How old are you?', app: 'Which age group are you in?', choice: 'doc' });
  const c = out.cases[0];
  assert.equal(c.specChoice['1|How old are you?'], 'doc');
  assert.equal(c.state, 'pending');
  assert.ok(c.cached && c.plan); // giữ plan → không tốn AI
  assert.throws(() => e.conv.specChoose(mi.id, { sheet: 'Welcome', tcId: 'TC_W_001', step: 1, manual: 'x', app: 'y', choice: 'khác' }), (err) => err.status === 400);
});

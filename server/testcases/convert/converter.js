// Điều phối "Import manual": phân tích file → lọc → (người dùng chỉnh) → chuyển đổi từng sheet → import → gen script.
// Trạng thái lưu trong store: manualImports (mỗi file manual của một app) và manualChoices (lựa chọn automate / manual của người dùng, giữ qua các lần import lại).
// Chuyển đổi và gen không dùng thiết bị nên không lấy khoá thiết bị. Mỗi import có khoá trong bộ nhớ: đang phân tích / chuyển đổi thì mọi thao tác ghi khác bị từ chối (409).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { runClaude as defaultRunClaude } from '../../ai/claude.js';
import { fileStem, importTestcases } from '../importXlsx.js';
import { detectKind, extractManual, sheetNames } from './detect.js';
import { findAmbiguity } from './ambiguity.js';
import { classifyCases } from './classify.js';
import { convertSheet } from './writeXlsx.js';
import { checkTargets, buildReview } from './review.js';

const sha = (x) => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 12);
const manualHash = (c) => sha([c.scenario, c.description, c.pre, c.steps, c.expected]);
const fail = (status, message) => Object.assign(new Error(message), { status });
const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, '-');
const same = (sheet, id) => (c) => c.sheet === sheet && c.id === id;
// Dòng "Cài lại app" / "Tiếp nối …" do write.mjs tự thêm → bỏ khi lấy lại pre từ store
const AUTO_PRE = /^\s*(\d+\.\s*)?(Cài lại app|Tiếp nối)/i;
const INTERRUPTED = 'Bị gián đoạn (server khởi động lại giữa chừng) — import lại file hoặc bấm Chuyển đổi lại';

// Bản gửi về trình duyệt (route + SSE): bỏ nội dung manual gốc (src) và dòng Keyword (plan) cho gọn
// Case có điểm mờ (và sẽ automate) kèm "brief" = phần nội dung manual cần để user trả lời điểm mờ
export const viewOf = ({ skeletons, ...mi }) => ({
  ...mi,
  cases: mi.cases.map(({ src, plan, ...c }) => (c.ambiguity?.length && c.mode === 'automate' && src
    ? { ...c, brief: { pre: src.pre || '', steps: src.steps || '', expected: src.expected || '' } } : c)),
});

const ANSWER_LABEL = { NO_QUOTED_EXPECTED: 'Chữ chính xác cần kiểm (Expected)', EMPTY_PRE: 'Trạng thái bắt đầu (Pre-condition)', VAGUE_STEP: 'Giá trị cụ thể cho bước còn chung chung' };
const cleanAnswers = (a) => Object.fromEntries(Object.entries(a || {}).map(([k, v]) => [k, String(v ?? '').trim()]).filter(([, v]) => v));
// Nội dung manual gửi cho AI: thêm câu trả lời đã được người viết test case xác nhận (ưu tiên hơn suy đoán)
const srcWithAnswers = (c) => {
  const a = cleanAnswers(c.answers);
  const keys = Object.keys(a);
  return keys.length ? { ...c.src, clarification: keys.map((k) => `${ANSWER_LABEL[k] || k}: ${a[k]}`).join('\n') } : c.src;
};

export function createConverter({ store, map, emit, generator, importer = importTestcases, runClaude = defaultRunClaude, dataDir }) {
  const running = new Map(); // importId → 'analyzing' | 'converting'
  const lock = (id, kind) => {
    if (running.has(id)) throw fail(409, running.get(id) === 'converting' ? 'Đang chuyển đổi file này — đợi xong rồi thử lại' : 'Đang phân tích file này — đợi xong rồi thử lại');
    running.set(id, kind);
  };
  const idle = (id) => { if (running.has(id)) lock(id); };

  // Server khởi động lại giữa chừng: trạng thái đang chạy không còn tiến trình nào giữ → báo lỗi để người dùng chạy lại
  for (const mi of store.list('manualImports')) {
    if (['analyzing', 'converting'].includes(mi.status)) store.put('manualImports', { ...mi, status: 'error', error: INTERRUPTED, progress: null });
  }

  const need = (id) => {
    const mi = store.get('manualImports', id);
    if (!mi) throw fail(404, 'Không có lần import manual này');
    return mi;
  };
  const save = (mi) => {
    mi.updatedAt = new Date().toISOString();
    store.put('manualImports', mi);
    emit('manualImport', viewOf(mi));
    return mi;
  };
  const storeCaseOf = (mi, c) => (c.outFile ? store.get('cases', `${mi.appId}:${c.outFile}:${c.id}`) : null);
  // Case đã chuyển đổi mà dòng Keyword trong store bị sửa tay (import lại file automation) → xung đột, không ghi đè
  const refreshConflicts = (mi) => {
    for (const c of mi.cases) {
      if (c.state !== 'converted' || c.mode !== 'automate' || !c.outHash) continue;
      const sc = storeCaseOf(mi, c);
      if (sc && sc.rowsHash !== c.outHash) c.state = 'conflict';
    }
  };

  const idFor = (appId, fileName) => `${appId}:${fileStem(fileName)}`;

  async function analyze({ appId, srcPath, fileName }) {
    const app = store.get('apps', appId);
    if (!app) throw fail(404, 'Không có app này');
    const id = idFor(appId, fileName);
    lock(id, 'analyzing');
    try {
      const kind = await detectKind(srcPath);
      if (kind === 'automation') throw fail(400, 'File này là test case automation, không phải manual. Chọn Import → File automation.');
      if (kind !== 'manual') {
        const names = await sheetNames(srcPath);
        throw fail(400, `Không nhận ra định dạng file${names.length ? ` (sheet: ${names.join(', ')})` : ''}. File manual cần sheet có cột "Test Case #" (kit v2); file automation cần sheet "TestCases" có cột Keyword.`);
      }
      return await analyzeManual({ app, appId, id, srcPath, fileName });
    } catch (e) {
      const cur = store.get('manualImports', id);
      if (cur?.status === 'analyzing') save({ ...cur, status: 'error', error: e.message });
      throw e;
    } finally {
      running.delete(id);
    }
  }

  async function analyzeManual({ app, appId, id, srcPath, fileName }) {
    const old = store.get('manualImports', id);
    const stem = fileStem(fileName);
    const data = await extractManual(srcPath);
    const dest = path.join(app.workspace ? path.join(app.workspace, 'data/manual') : path.join(dataDir, 'manual', appId), `${stem}.xlsx`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(srcPath, dest);

    const oldBy = new Map((old?.cases || []).map((c) => [`${c.sheet}:${c.id}`, c]));
    const cases = [];
    for (const sh of data.sheets) {
      for (const src of sh.cases.filter((c) => c.selected)) {
        const hash = manualHash(src);
        const prev = oldBy.get(`${sh.sheet}:${src.id}`);
        const base = { sheet: sh.sheet, id: src.id, title: src.scenario, src, ambiguity: findAmbiguity(src) };
        // Giữ kết quả cũ chỉ khi nội dung không đổi và lần phân tích trước đã phân loại xong (analyze dở thì phân loại lại)
        if (prev && prev.hash === hash && prev.classified !== false) { cases.push({ ...prev, ...base }); continue; }
        const entry = { ...base, hash, mode: 'automate', reason: '', by: 'rule', state: 'pending', classified: false, ...(prev?.outFile ? { outFile: prev.outFile, outHash: prev.outHash } : {}) };
        // Nội dung manual đổi nhưng dòng Keyword trong store đã bị sửa tay → xung đột (không ghi đè âm thầm)
        const sc = prev?.state === 'converted' && prev.mode === 'automate' ? storeCaseOf({ appId }, prev) : null;
        if (sc && sc.rowsHash !== prev.outHash) entry.state = 'conflict';
        cases.push(entry);
      }
    }
    const seen = new Set(cases.map((c) => `${c.sheet}:${c.id}`));
    const removed = [...oldBy.keys()].filter((k) => !seen.has(k));
    // Lựa chọn của người dùng thắng mọi kết quả phân loại
    for (const c of cases) {
      const ch = store.get('manualChoices', `${appId}:${c.sheet}:${c.id}`);
      if (ch) Object.assign(c, { mode: ch.mode, reason: 'Bạn chọn', by: 'user', classified: true });
    }
    const mi = { id, appId, stem, fileName, status: 'analyzing', error: null, sheets: data.sheets.map((s) => ({ sheet: s.sheet, total: s.total, selected: s.selected })), cases, removed, review: old?.review || [], sheetReview: old?.sheetReview || {}, skeletons: old?.skeletons || {}, problems: [], progress: null, createdAt: old?.createdAt || new Date().toISOString() };
    refreshConflicts(mi);
    save(mi);
    // Phân loại theo từng sheet (cùng TC ID ở hai sheet không được trộn kết quả)
    for (const sheet of [...new Set(cases.map((c) => c.sheet))]) {
      const todo = cases.filter((c) => c.sheet === sheet && !c.classified);
      if (!todo.length) continue;
      const dec = await classifyCases({ cases: todo.map((c) => c.src), runClaude });
      for (const d of dec) { const c = todo.find((x) => x.id === d.id); if (c) Object.assign(c, { mode: d.mode, reason: d.reason, by: d.by }); }
      for (const c of todo) c.classified = true;
    }
    mi.status = 'ready';
    return save(mi);
  }

  function choose(importId, { sheet, tcId, mode }) {
    if (!['automate', 'manual'].includes(mode)) throw fail(400, 'mode phải là "automate" hoặc "manual"');
    idle(importId);
    const mi = need(importId);
    const c = mi.cases.find(same(sheet, tcId));
    if (!c) throw fail(404, 'Không có case này trong file');
    store.put('manualChoices', { id: `${mi.appId}:${sheet}:${tcId}`, mode });
    const changed = c.mode !== mode;
    Object.assign(c, { mode, reason: 'Bạn chọn', by: 'user', classified: true });
    if (changed && c.state !== 'conflict') c.state = 'pending';
    return save(mi);
  }

  // User trả lời điểm mờ (TRƯỚC khi chuyển đổi, hoặc SAU khi đã chuyển): lưu câu trả lời; đổi câu trả lời của case đã chuyển → chỉ case đó chờ chuyển lại
  function clarify(importId, { sheet, tcId, answers }) {
    idle(importId);
    const mi = need(importId);
    const c = mi.cases.find(same(sheet, tcId));
    if (!c) throw fail(404, 'Không có case này trong file');
    const next = cleanAnswers(answers);
    const changed = JSON.stringify(next) !== JSON.stringify(cleanAnswers(c.answers));
    c.answers = next;
    c.confirmed = true;
    if (changed && c.state === 'converted' && c.mode === 'automate') { c.state = 'pending'; delete c.plan; delete c.cached; }
    return save(mi);
  }

  // AI đọc locator map (chữ / tên phần tử đã lấy trên các màn) điền sẵn gợi ý cho điểm mờ; user chỉ duyệt hoặc sửa
  async function suggest(importId) {
    lock(importId, 'analyzing');
    try {
      const mi = need(importId);
      const todo = mi.cases.filter((c) => c.mode === 'automate' && c.ambiguity?.length && !c.suggest && !Object.keys(cleanAnswers(c.answers)).length);
      if (!todo.length) return mi;
      const table = map.locatorTable(mi.appId) || {};
      const screens = Object.fromEntries(Object.entries(table).map(([n, rows]) => [n, (rows || []).slice(0, 40).map((r) => r.key)]));
      const prompt = `Locator map của app (tên màn → tên phần tử / chữ đã lấy được):\n${JSON.stringify(screens)}\n\nCác case có điểm mờ:\n${JSON.stringify(todo.map((c) => ({ id: c.id, scenario: c.title, pre: c.src.pre, steps: c.src.steps, expected: c.src.expected, ambiguity: c.ambiguity.map((a) => ({ code: a.code, text: a.text })) })), null, 1)}\n\nVới MỖI case và MỖI mã điểm mờ của nó, đề xuất câu trả lời ngắn: NO_QUOTED_EXPECTED = chữ chính xác trên màn (chỉ dùng chữ có trong locator map hoặc trong nội dung case, không bịa), EMPTY_PRE = trạng thái bắt đầu (cài lại app hay tiếp nối case trước), VAGUE_STEP = giá trị cụ thể để nhập / kiểm. Không chắc thì để chuỗi rỗng.`;
      const r = await runClaude({
        prompt, noTools: true, timeoutMs: 300000,
        schema: { type: 'object', properties: { suggestions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, answers: { type: 'object', additionalProperties: { type: 'string' } } }, required: ['id', 'answers'] } } }, required: ['suggestions'] },
      });
      if (!r.ok) throw fail(502, `AI gợi ý lỗi: ${r.error}`);
      for (const s of r.data?.suggestions || []) {
        const c = todo.find((x) => x.id === s.id);
        if (c) c.suggest = cleanAnswers(s.answers);
      }
      for (const c of todo) c.suggest ||= {};
      return save(mi);
    } finally {
      running.delete(importId);
    }
  }

  function resolveConflict(importId, { sheet, tcId }, action) {
    idle(importId);
    const mi = need(importId);
    const c = mi.cases.find(same(sheet, tcId));
    if (!c) throw fail(404, 'Không có case này trong file');
    if (c.state !== 'conflict') throw fail(409, 'Case này không có xung đột');
    if (action === 'reconvert') c.state = 'pending';
    else if (action === 'keep') {
      const sc = storeCaseOf(mi, c);
      if (!sc) throw fail(409, 'Không còn case này trong store để giữ');
      if (sc.dataSet) throw fail(409, 'Case dùng TestData (dataSet) — "Giữ bản sửa tay" chưa hỗ trợ; chọn "Chuyển lại" hoặc sửa trực tiếp file automation.');
      const clean = (r) => Object.fromEntries(Object.entries({ step: r.step, screen: r.screen, kind: r.kind, keyword: r.keyword, target: r.target, value: r.value, compare: r.compare, platform: r.platform, label: r.label }).filter(([, v]) => v !== undefined && v !== ''));
      c.plan = { id: c.id, fresh: Boolean(sc.fresh), pre: (sc.pre || []).filter((l) => !AUTO_PRE.test(l)), rows: sc.rows.map(clean) };
      c.state = 'converted';
      c.outHash = sc.rowsHash;
    } else throw fail(400, 'action phải là "keep" hoặc "reconvert"');
    return save(mi);
  }

  // Tên file automation đầu ra: gắn với file manual + sheet (không dùng chung tên `<sheet>-automation` của skill, vì import thay cả file
  // và xoá case không còn trong file mới). Đã có file của chính import này cho sheet → dùng lại; ngược lại tên mới chưa có trong store
  function outStemFor(mi, sheet, entries) {
    const owned = entries.map((c) => c.outFile).find(Boolean);
    if (owned) return { out: owned, into: owned };
    const slug = safe(sheet).replace(/^-+|-+$/g, '');
    const part = slug && slug === sheet ? slug : `${slug || 'sheet'}-${sha(sheet).slice(0, 6)}`;
    const base = fileStem(`${mi.stem}-${part}-automation.xlsx`);
    const taken = (s) => store.list('cases').some((c) => c.appId === mi.appId && c.file === s);
    let out = base;
    for (let n = 2; taken(out); n++) out = `${base}-${n}`;
    return { out, into: '*new' };
  }

  // gen: false → chỉ chuyển đổi + import, để người dùng tự chọn case cần gen script (gen cả sheet mất nhiều thời gian)
  async function convert(importId, { gen = true } = {}) {
    lock(importId, 'converting');
    let mi;
    try {
      mi = need(importId);
      mi.status = 'converting';
      mi.problems = [];
      mi.error = null;
      refreshConflicts(mi);
      save(mi);
      const app = store.get('apps', mi.appId);
      for (const sheet of [...new Set(mi.cases.map((c) => c.sheet))]) {
        const entries = mi.cases.filter((c) => c.sheet === sheet);
        const todo = (c) => c.state === 'pending' || c.state === 'error';
        if (!entries.some((c) => todo(c) || c.state === 'conflict')) continue;
        if (entries.some((c) => c.state === 'conflict')) {
          mi.problems.push(`Sheet ${sheet}: có case xung đột (dòng Keyword đã sửa tay) — chọn "Giữ bản sửa tay" hoặc "Chuyển lại" trước khi chuyển đổi`);
          continue;
        }
        // Dùng lại plan đã có: case đã chuyển xong, hoặc nhóm tốt của lần trước bị lỗi giữa chừng (cached)
        const cache = Object.fromEntries(entries.filter((c) => c.mode === 'automate' && c.plan && (c.state === 'converted' || c.cached)).map((c) => [c.id, c.plan]));
        // Khung đã lập chỉ dùng lại khi danh sách case automate của sheet (id + nội dung) không đổi
        const sig = sha(entries.filter((c) => c.mode === 'automate').map((c) => [c.id, c.hash, cleanAnswers(c.answers)]));
        const saved = mi.skeletons?.[sheet];
        const r = await convertSheet({
          sheet: { sheet, cases: entries.map(srcWithAnswers) }, decisions: entries.map((c) => ({ id: c.id, mode: c.mode, reason: c.reason })), runClaude, cache,
          skeleton: saved?.sig === sig ? saved.skeleton : undefined,
          onSkeleton: (skeleton) => { (mi.skeletons ||= {})[sheet] = { sig, skeleton }; save(mi); },
          onGroup: (tcs) => { for (const t of tcs) { const c = entries.find((x) => x.id === t.id && x.mode === 'automate'); if (c && c.state !== 'converted') Object.assign(c, { plan: t, cached: true }); } save(mi); },
          outDir: path.join(dataDir, 'manual-out', safe(mi.id), safe(sheet)),
          onProgress: (p) => { mi.progress = p; save(mi); },
        });
        const pending = entries.filter(todo);
        if (!r.ok) {
          // Chỉ case bị nhắc trong lỗi (hoặc không có plan) thành error; nhóm tốt giữ plan để lần sau không gọi AI lại
          const mentions = (c) => r.problems.filter((p) => p.includes(c.id));
          const anyMentioned = pending.some((c) => mentions(c).length);
          for (const c of pending) {
            if (c.mode !== 'automate') { c.state = 'converted'; continue; }
            const plan = r.plans[c.id];
            if (plan && anyMentioned && !mentions(c).length) Object.assign(c, { state: 'pending', plan, cached: true, error: null });
            else { Object.assign(c, { state: 'error', error: (mentions(c).length ? mentions(c) : r.problems).join('; ') }); delete c.plan; delete c.cached; }
          }
          mi.problems.push(`Sheet ${sheet}: ${r.problems.join('; ')}`);
          continue;
        }
        let warn = [];
        if (r.files.length) {
          const { out, into } = outStemFor(mi, sheet, entries);
          let imp;
          try { imp = await importer({ store, appId: mi.appId, srcPath: r.files[0], fileName: `${out}.xlsx`, into }); } catch (e) {
            for (const c of pending) if (c.mode === 'automate') Object.assign(c, { state: 'error', error: `Import lỗi: ${e.message}` });
            mi.problems.push(`Sheet ${sheet}: import lỗi: ${e.message}`);
            continue;
          }
          emit('app', { id: mi.appId }); // bảng case của trang Test Cases tải lại
          for (const c of pending) {
            if (c.mode === 'automate') { Object.assign(c, { state: 'converted', error: null, plan: r.plans[c.id], outFile: imp.file, outHash: store.get('cases', `${mi.appId}:${imp.file}:${c.id}`)?.rowsHash }); delete c.cached; }
            else c.state = 'converted';
          }
          const ids = store.list('cases').filter((c) => c.appId === mi.appId && c.file === imp.file && ['none', 'stale'].includes(c.script?.status)).map((c) => c.id);
          if (ids.length && !gen) warn = [`[Gen] Chưa gen script cho ${ids.length} case (bạn tắt tự gen) — chọn case ở bảng Test Cases rồi bấm Generate script`];
          else if (ids.length && app?.status === 'ready') generator.generate(mi.appId, ids).catch((e) => console.error('generate:', e));
          else if (ids.length) warn = [`[Gen] App chưa sẵn sàng — chưa gen script cho ${ids.length} case, gen sau khi app sẵn sàng`];
        } else for (const c of pending) c.state = 'converted';
        mi.sheetReview[sheet] = [...buildReview({
          writeReview: r.review,
          targets: checkTargets(Object.values(r.plans), map.locatorTable(mi.appId)),
          ambiguity: Object.fromEntries(entries.filter((c) => c.mode === 'automate' && c.ambiguity.length).map((c) => [c.id, c.ambiguity])),
        }), ...warn];
      }
      mi.review = Object.values(mi.sheetReview).flat();
      mi.status = 'done';
      mi.progress = null;
      save(mi);
    } catch (e) {
      if (mi) { mi.status = 'error'; mi.error = e.message; save(mi); }
      throw e;
    } finally {
      running.delete(importId);
    }
  }

  return { idFor, analyze, choose, clarify, suggest, convert, resolveConflict, busy: (id) => running.has(id), get: (id) => store.get('manualImports', id), list: (appId) => store.list('manualImports').filter((m) => m.appId === appId) };
}

// AI gen code cho từng case → ghi vào region của case trong file script của Excel (một file / Excel).
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runClaude as defaultRunClaude } from '../ai/claude.js';
import { TEST_REPORT_SKILL } from '../paths.js';
import { buildScript, helperModules, readRegions } from './scriptFile.js';
import { keywordsNote, locatorText, pickScreens } from './promptParts.js';

// Đọc lại mỗi lần gen: sửa prompt có hiệu lực ngay, không cần khởi động lại server (--watch không theo dõi .md)
const PROMPT_FILE = fileURLToPath(new URL('../ai/prompts/gen-case.md', import.meta.url));
const prompt = () => fs.readFileSync(PROMPT_FILE, 'utf8');
const SCHEMA = { type: 'object', properties: { body: { type: 'string' }, warnings: { type: 'array', items: { type: 'string' } } }, required: ['body', 'warnings'] };
const CONCURRENCY = 3;
// Code AI không được tự gọi (k lo evidence / điểm kiểm / log đúng mẫu): gặp → hỏi AI sửa
const MISUSE = [
  { call: 'snapshot(', re: /\bsnapshot\s*\(/ },
  { call: 'sa.eq(', re: /\bsa\.eq\s*\(/ },
  { call: 'logStep(', re: /(^|[^.\w])logStep\s*\(/m },
];
const K_TABLES = { v2: fileURLToPath(new URL('../ai/prompts/k-table-v2.md', import.meta.url)), legacy: fileURLToPath(new URL('../ai/prompts/k-table-legacy.md', import.meta.url)) };
// Mã case dùng được làm tên region trong file script (scriptFile.js bỏ qua mã khác → case "đã gen" mà không có code)
export const VALID_TC_ID = /^[A-Za-z0-9_.-]+$/;
export const BAD_TC_ID = 'Mã case có ký tự không hỗ trợ (dấu cách / dấu tiếng Việt) — đổi TC ID';
// Hàm k luôn có (không khai báo dạng "async tên(" trong steps.js)
const K_ALWAYS = ['log', 'byText', 'textOf', 'fill', 'vars', 'check'];

// Tên các hàm k mà src/runner/steps.js của workspace thật sự có (đọc "async tên(" trong object trả về).
// null = không đọc được file (không lọc)
export function stepsMethods(ws) {
  let src;
  try { src = fs.readFileSync(path.join(ws, 'src/runner/steps.js'), 'utf8'); } catch { return null; }
  const names = new Set(K_ALWAYS);
  for (const m of src.matchAll(/^[ \t]+async\s+([A-Za-z_$][\w$]*)\s*\(/gm)) names.add(m[1]);
  return names;
}

// Bảng k gửi cho AI, chỉ giữ dòng gọi hàm k mà workspace có (workspace tạo từ template cũ có thể thiếu closePopup, tapOutside…).
// → { text, missing: tên hàm k bị thiếu, dropped: cột đầu của các dòng bị bỏ }
export function kTableFor(ws) {
  const methods = stepsMethods(ws);
  const v2 = !!methods?.has('count');
  const raw = fs.readFileSync(v2 ? K_TABLES.v2 : K_TABLES.legacy, 'utf8').trim();
  if (!methods) return { text: raw, missing: [], dropped: [] };
  const missing = new Set();
  const dropped = [];
  const lines = raw.split('\n').filter((l) => {
    if (!l.startsWith('|')) return true;
    const used = [...l.matchAll(/\bk\.([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
    const lack = used.filter((n) => !methods.has(n));
    if (!lack.length) return true;
    lack.forEach((n) => missing.add(n));
    dropped.push(l.split('|')[1].replace(/\*\*/g, '').trim());
    return false;
  });
  return { text: lines.join('\n'), missing: [...missing], dropped };
}
const normEol = (s) => String(s).replace(/\r\n?/g, '\n');
const fill = (tpl, v) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(v[k] ?? ''));

// Phần "Instrumenting a spec" + "Rules for checks" của skill test-report (đọc lúc chạy để luôn theo bản mới)
function skillRules() {
  try {
    const md = fs.readFileSync(path.join(TEST_REPORT_SKILL, 'SKILL.md'), 'utf8');
    const part = (h) => (md.match(new RegExp(`## ${h}\\n([\\s\\S]*?)(?=\\n## )`)) || [])[1] || '';
    return `# Quy tắc report (skill test-report)\n${part('Rules for checks').trim()}`;
  } catch {
    return '';
  }
}

async function syntaxError(code) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qapd-chk-')), 'x.mjs');
  fs.writeFileSync(f, code);
  try {
    await promisify(execFile)(process.execPath, ['--check', f]);
    return null;
  } catch (e) {
    return String(e.stderr || e.message).split('\n').filter((l) => /Error|\^|:\d+/.test(l)).slice(0, 4).join('\n') || 'SyntaxError';
  }
}

export function createGenerator({ store, map, emit, runClaude = defaultRunClaude }) {
  const fileLocks = new Map(); // file script → promise (ghi tuần tự)
  const withFile = (key, fn) => {
    const next = (fileLocks.get(key) || Promise.resolve()).then(fn, fn);
    fileLocks.set(key, next.catch(() => {}));
    return next;
  };
  const setScript = (c, script) => {
    store.patch('cases', c.id, { script });
    emit('script', { appId: c.appId, caseId: c.id, script });
    return script;
  };
  // file = stem của Excel (fileStem): chỉ chữ, số, _ - → không thoát ra ngoài workspace
  const scriptPath = (app, file) => {
    if (!/^[A-Za-z0-9_-]+$/.test(String(file))) throw Object.assign(new Error(`Tên file không hợp lệ: ${file}`), { status: 400 });
    return path.join(app.workspace, 'tests', `${file}.e2e.js`);
  };
  const hashOf = (code) => crypto.createHash('sha1').update(code).digest('hex');
  const casesOf = (appId, file) => store.list('cases').filter((c) => c.appId === appId && c.file === file).sort((a, b) => a.order - b.order);

  // Ghi file với region mới; lỗi cú pháp → trả lỗi, file giữ nguyên.
  // Region của case không còn (xoá / đổi TC ID) hoặc mã case không hợp lệ bị bỏ khi sinh lại → chép file cũ ra .bak trước, báo lại
  async function saveRegions(app, file, change) {
    const p = scriptPath(app, file);
    const old = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    const regions = old ? readRegions(normEol(old)) : {};
    Object.assign(regions, change);
    const order = casesOf(app.id, file).map((c) => c.tcId);
    const code = buildScript({ file, order, regions, helpers: helperModules(app.workspace), pack: app.helperPack });
    const err = await syntaxError(code);
    if (err) return { error: err };
    const dropped = Object.keys(regions).filter((id) => !order.includes(id) || !VALID_TC_ID.test(id));
    let backup = null;
    if (old && dropped.length) {
      backup = `${p}.${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}.bak`;
      try { fs.writeFileSync(backup, old); } catch { backup = null; }
      console.warn(`[script] ${path.basename(p)}: bỏ region ${dropped.join(', ')} (case không còn / mã không hợp lệ)${backup ? ` — bản cũ: ${backup}` : ''}`);
    }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, code);
    return { path: p, ...(dropped.length ? { dropped, backup } : {}) };
  }

  function warningsFor(c, table, platform = 'iOS') {
    const out = [];
    const names = Object.keys(table);
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const r of c.rows) {
      if (!r.screen || (r.platform && !['All', platform].includes(r.platform))) continue;
      const screen = names.find((n) => n === r.screen) || names.find((n) => norm(n).includes(norm(r.screen)));
      if (!screen) {
        const w = `Màn "${r.screen}" chưa có trong locator map — lấy locator màn này hoặc đổi tên màn cho khớp`;
        if (!out.includes(w)) out.push(w);
        continue;
      }
      if (r.kind === 'Nav' || !r.target || /\$\{/.test(r.target)) continue;
      if (!table[screen].some((e) => e.key === r.target)) {
        const w = `Màn ${screen}: không tìm thấy "${r.target}" trong locator map`;
        if (!out.includes(w)) out.push(w);
      }
    }
    return out;
  }

  // Workspace thiếu hàm k cho keyword case dùng (steps.js cũ / sửa tay) → nhắc chuẩn bị lại
  function kWarnings(c, kt) {
    if (!kt.missing.length) return [];
    const norm = (x) => String(x || '').toLowerCase().trim();
    const hit = c.rows.some((r) => r.keyword && kt.dropped.some((d) => d.split('/').map(norm).some((part) => part && (part === norm(r.keyword) || part.startsWith(`${norm(r.keyword)} `)))));
    return hit ? [`Workspace thiếu k.${kt.missing.join(', k.')} (src/runner/steps.js cũ) — AI viết code riêng cho keyword đó; vào Cài đặt app → Chuẩn bị lại để dùng bản mới`] : [];
  }

  // Script trước khi bấm gen — dừng gen thì trả lại đúng trạng thái này (vd vẫn "Đã gen" bản cũ)
  const before = new Map();
  const controllers = new Map(); // case đang gọi AI → AbortController
  const queues = new Set(); // hàng đợi của các lần generate() đang chạy — dừng case còn chờ thì rút khỏi hàng
  const restore = (id) => {
    const c = store.get('cases', id);
    const prev = before.get(id);
    before.delete(id);
    if (c) setScript(c, prev && prev.status !== 'generating' ? prev : { ...c.script, status: 'none', error: null });
  };

  async function generateCase(caseId, signal) {
    const c = store.get('cases', caseId);
    if (!c) return null; // case bị xoá (import lại) trong lúc chờ gen
    const app = store.get('apps', c.appId);
    const startHash = c.rowsHash;
    if (!VALID_TC_ID.test(String(c.tcId))) return setScript(c, { ...c.script, status: 'failed', error: `${BAD_TC_ID} ("${c.tcId}")`, warnings: [] });
    setScript(c, { ...c.script, status: 'generating', error: null });
    try {
      map.exportLocators(app.id);
      const table = map.locatorTable(app.id);
      const helpers = helperModules(app.workspace);
      const kt = kTableFor(app.workspace);
      const aliases = Object.fromEntries(store.list('screens').filter((s) => s.appId === app.id).map((s) => [s.name, s.aliases || []]));
      const base = {
        appName: app.name, platform: app.platform || 'iOS', file: c.file, tcId: c.tcId, title: c.title,
        freshNote: c.fresh ? 'Case này "Cài lại app": khung đã cài lại và mở app (và tạo sẵn tài khoản dữ liệu nếu case cần) trước khi gọi hàm.' : `Case này tiếp nối ${c.prev}: app đang ở trạng thái case trước để lại.`,
        pre: c.pre.map((l) => `- ${l}`).join('\n') || '- (không có)',
        rows: c.rows.map((r) => [r.step, r.screen, r.kind, r.keyword, r.target, r.value, r.compare, r.label].join(' | ')).join('\n'),
        locators: locatorText(table, pickScreens(c.rows, table, { aliases, pre: c.pre })),
        helpers: helpers.map((h) => `  - ${h.ns}: ${h.exports.join(', ')}`).join('\n'),
        keywords: keywordsNote(app.workspace),
        skillRules: skillRules(),
        // Bảng k: runner mới của template có đủ keyword v2; helper pack có runner riêng (chưa có) → bảng cũ
        kTable: kt.text,
        // Hành vi riêng của app tester ghi ở Cài đặt app (vd tutorial tự chuyển slide) — AI không tự biết được
        appNotes: app.aiNotes ? `# Ghi chú về app (tester viết — tuân theo khi viết code)\n${app.aiNotes}\n` : '',
      };
      let retry = '';
      let last = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        // Không tool: mọi thứ cần đã có trong prompt → 1 lượt, không lục workspace
        // Phần trước "# Case" (hợp đồng, bảng k, quy tắc, helper) giống nhau giữa các case cùng app → system prompt (được cache);
        // phần của case (bước, locator, lỗi lần trước) → tin nhắn
        const full = fill(prompt(), { ...base, retry });
        const cut = full.indexOf('\n# Case ');
        const r = await runClaude({ system: cut > 0 ? full.slice(0, cut) : undefined, prompt: cut > 0 ? full.slice(cut + 1) : full, schema: SCHEMA, cwd: app.workspace, timeoutMs: 300000, noTools: true, signal });
        if (r.cancelled || signal?.aborted) return null; // dừng gen → generate() trả lại script cũ
        if (!r.ok) return setScript(c, { ...c.script, status: 'failed', error: r.error, warnings: [] });
        const body = String(r.data.body || '').trim();
        if (!/^async\s*\(/.test(body) || !/=>\s*\{[\s\S]*\}$/.test(body)) return setScript(c, { ...c.script, status: 'failed', error: 'AI trả về body không phải hàm async ({ tc, data, sa, fill }) => { … }', warnings: [] });
        if (/runTestcase/.test(body)) return setScript(c, { ...c.script, status: 'failed', error: 'Code AI gen gọi runTestcase (keyword runner) — không được dùng', warnings: [] });
        // Tự gọi snapshot / sa.eq / logStep → hay sai chữ ký (lỗi lúc chạy, bug vô nghĩa) → bắt AI sửa, không lưu
        const misuse = MISUSE.filter((m) => m.re.test(body)).map((m) => m.call);
        if (misuse.length) {
          last = `Không gọi trực tiếp: ${misuse.join(', ')}`;
          retry = `\n# Lần trước code sai quy tắc, sửa lại:\n${last} — điểm kiểm dùng k.shown / k.text / k.selected / k.enabled hoặc đọc giá trị rồi k.check(step, screen, keyword, target, label, sel, actual, expected); thao tác riêng xong gọi k.log(...).\n`;
          continue;
        }
        const saved = await withFile(`${app.id}:${c.file}`, () => saveRegions(app, c.file, { [c.tcId]: body }));
        if (!saved.error) {
          // Đọc lại file: region của case phải có thật (khung bỏ qua mã case lạ / case vừa bị xoá khỏi Excel)
          let onDisk = {};
          try { onDisk = readRegions(normEol(fs.readFileSync(saved.path, 'utf8'))); } catch {}
          if (!onDisk[c.tcId]) return setScript(store.get('cases', c.id) || c, { ...c.script, status: 'failed', error: VALID_TC_ID.test(c.tcId) ? 'Không ghi được code của case vào file script (case không còn trong Excel?) — import lại rồi gen lại' : `${BAD_TC_ID} ("${c.tcId}")`, warnings: [] });
          const warnings = [...warningsFor(c, table, app.platform || 'iOS'), ...kWarnings(c, kt), ...(r.data.warnings || [])];
          // Import lại đổi bước trong lúc gen → script này theo bước cũ
          const stale = store.get('cases', c.id)?.rowsHash !== startHash;
          return setScript(store.get('cases', c.id) || c, { status: stale ? 'stale' : 'generated', warnings, reviewed: false, editedByHand: false, path: saved.path, error: null, generatedAt: new Date().toISOString() });
        }
        last = saved.error;
        retry = `\n# Lần trước code bị lỗi cú pháp, sửa lại:\n${saved.error}\n`;
      }
      return setScript(c, { ...c.script, status: 'failed', error: `Sau 2 lần gen vẫn lỗi: ${last}`, warnings: [] });
    } catch (e) {
      return setScript(c, { ...c.script, status: 'failed', error: String(e.message || e) });
    }
  }

  // Gen nhiều case: AI chạy song song tối đa 3, ghi file tuần tự
  const inFlight = new Set(); // case đang chờ / đang gen — bấm Generate lần nữa không chạy trùng

  async function generate(appId, caseIds) {
    const queue = caseIds.filter((id) => !inFlight.has(id));
    queue.forEach((id) => inFlight.add(id));
    queues.add(queue);
    for (const id of queue) {
      const c = store.get('cases', id);
      if (c) { before.set(id, c.script); setScript(c, { ...c.script, status: 'generating', error: null }); }
    }
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        const ctl = new AbortController();
        controllers.set(id, ctl);
        try {
          // null = dừng trước khi ghi file → trả script cũ. Bấm dừng lúc AI đã trả và đang ghi file → giữ kết quả mới (file đã đổi)
          if ((await generateCase(id, ctl.signal)) === null && ctl.signal.aborted) restore(id);
        } catch (e) { console.error(`Gen ${id} lỗi:`, e); } finally { controllers.delete(id); before.delete(id); inFlight.delete(id); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    queues.delete(queue);
  }

  // Dừng gen: case đang gọi AI → kill; case còn chờ → bỏ khỏi hàng. Cả hai trả lại script trước khi gen.
  function cancel(caseIds) {
    let n = 0;
    for (const id of caseIds) {
      if (!inFlight.has(id)) continue;
      n++;
      const ctl = controllers.get(id);
      if (ctl) { ctl.abort(); continue; }
      // Còn chờ trong hàng → rút ra luôn (gen lại ngay sau đó không bị coi là trùng)
      for (const q of queues) { const i = q.indexOf(id); if (i >= 0) q.splice(i, 1); }
      inFlight.delete(id);
      restore(id);
    }
    return n;
  }
  const generatingIds = (appId) => [...inFlight].filter((id) => store.get('cases', id)?.appId === appId);

  // Lưu cả file sửa tay: chỉ khi file trên đĩa chưa đổi kể từ lúc client tải (baseHash), ghi tuần tự cùng generator
  function saveFile(app, file, code, baseHash) {
    return withFile(`${app.id}:${file}`, async () => {
      const p = scriptPath(app, file);
      const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
      if (baseHash !== hashOf(cur)) return { conflict: true };
      const before = readRegions(normEol(cur));
      // Editor / Windows lưu xuống dòng CRLF → regex region không khớp → mất hết thay đổi. Chuẩn hoá trước khi đọc
      const text = normEol(code);
      const regions = readRegions(text);
      if (!Object.keys(regions).length && (/\/\/ #region \S+/.test(text) || Object.keys(before).length)) {
        return { regionError: true, error: 'Không đọc được region nào của case trong code gửi lên (thiếu / sai dòng "// #region <TC>" … "// #endregion <TC>") — chưa lưu để không mất code' };
      }
      const saved = await saveRegions(app, file, regions);
      if (saved.error) return saved;
      return { ...saved, changed: Object.keys(regions).filter((k) => regions[k] !== before[k]) };
    });
  }

  // Sinh lại khung (giữ region) — trước mỗi Run, để file gen bằng khung cũ có đủ tính năng mới
  function refreshScript(app, file) {
    if (!fs.existsSync(scriptPath(app, file))) return Promise.resolve(null);
    return withFile(`${app.id}:${file}`, () => saveRegions(app, file, {}));
  }

  return { generate, cancel, generatingIds, generateCase, saveRegions, saveFile, refreshScript, scriptPath, casesOf, hashOf };
}

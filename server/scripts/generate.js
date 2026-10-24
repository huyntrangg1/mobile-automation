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

const PROMPT = fs.readFileSync(fileURLToPath(new URL('../ai/prompts/gen-case.md', import.meta.url)), 'utf8');
const SCHEMA = { type: 'object', properties: { body: { type: 'string' }, warnings: { type: 'array', items: { type: 'string' } } }, required: ['body', 'warnings'] };
const CONCURRENCY = 3;
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

  // Ghi file với region mới; lỗi cú pháp → trả lỗi, file giữ nguyên
  async function saveRegions(app, file, change) {
    const p = scriptPath(app, file);
    const regions = fs.existsSync(p) ? readRegions(fs.readFileSync(p, 'utf8')) : {};
    Object.assign(regions, change);
    const code = buildScript({ file, order: casesOf(app.id, file).map((c) => c.tcId), regions, helpers: helperModules(app.workspace), pack: app.helperPack });
    const err = await syntaxError(code);
    if (err) return { error: err };
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, code);
    return { path: p };
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

  async function generateCase(caseId) {
    const c = store.get('cases', caseId);
    if (!c) return null; // case bị xoá (import lại) trong lúc chờ gen
    const app = store.get('apps', c.appId);
    const startHash = c.rowsHash;
    setScript(c, { ...c.script, status: 'generating', error: null });
    try {
      map.exportLocators(app.id);
      const table = map.locatorTable(app.id);
      const helpers = helperModules(app.workspace);
      const base = {
        appName: app.name, platform: app.platform || 'iOS', file: c.file, tcId: c.tcId, title: c.title,
        freshNote: c.fresh ? 'Case này "Cài lại app": khung đã cài lại và mở app (và tạo sẵn tài khoản dữ liệu nếu case cần) trước khi gọi hàm.' : `Case này tiếp nối ${c.prev}: app đang ở trạng thái case trước để lại.`,
        pre: c.pre.map((l) => `- ${l}`).join('\n') || '- (không có)',
        rows: c.rows.map((r) => [r.step, r.screen, r.kind, r.keyword, r.target, r.value, r.compare, r.label].join(' | ')).join('\n'),
        locators: Object.entries(table).map(([n, rows]) => `## Màn "${n}"\n${rows.map((r) => `- ${r.type} "${r.key}" → L['${n}'][${JSON.stringify(r.key)}]`).join('\n')}`).join('\n\n'),
        helpers: helpers.map((h) => `  - ${h.ns}: ${h.exports.join(', ')}`).join('\n'),
        skillRules: skillRules(),
      };
      let retry = '';
      let last = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await runClaude({ prompt: fill(PROMPT, { ...base, retry }), schema: SCHEMA, cwd: app.workspace, timeoutMs: 300000 });
        if (!r.ok) return setScript(c, { ...c.script, status: 'failed', error: r.error, warnings: [] });
        const body = String(r.data.body || '').trim();
        if (!/^async\s*\(/.test(body) || !/=>\s*\{[\s\S]*\}$/.test(body)) return setScript(c, { ...c.script, status: 'failed', error: 'AI trả về body không phải hàm async ({ tc, data, sa, fill }) => { … }', warnings: [] });
        if (/runTestcase/.test(body)) return setScript(c, { ...c.script, status: 'failed', error: 'Code AI gen gọi runTestcase (keyword runner) — không được dùng', warnings: [] });
        const saved = await withFile(`${app.id}:${c.file}`, () => saveRegions(app, c.file, { [c.tcId]: body }));
        if (!saved.error) {
          const warnings = [...warningsFor(c, table, app.platform || 'iOS'), ...(r.data.warnings || [])];
          // Import lại đổi bước trong lúc gen → script này theo bước cũ
          const stale = store.get('cases', c.id)?.rowsHash !== startHash;
          return setScript(store.get('cases', c.id) || c, { status: stale ? 'stale' : 'generated', warnings, reviewed: false, editedByHand: false, path: saved.path, error: null, generatedAt: new Date().toISOString() });
        }
        last = saved.error;
        retry = `\n# Lần trước code bị lỗi cú pháp, sửa lại:\n${saved.error}\n`;
      }
      return setScript(c, { ...c.script, status: 'failed', error: `SyntaxError sau 2 lần gen: ${last}`, warnings: [] });
    } catch (e) {
      return setScript(c, { ...c.script, status: 'failed', error: String(e.message || e) });
    }
  }

  // Gen nhiều case: AI chạy song song tối đa 3, ghi file tuần tự
  const inFlight = new Set(); // case đang chờ / đang gen — bấm Generate lần nữa không chạy trùng

  async function generate(appId, caseIds) {
    const queue = caseIds.filter((id) => !inFlight.has(id));
    queue.forEach((id) => inFlight.add(id));
    for (const id of queue) {
      const c = store.get('cases', id);
      if (c) setScript(c, { ...c.script, status: 'generating', error: null });
    }
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        try { await generateCase(id); } catch (e) { console.error(`Gen ${id} lỗi:`, e); } finally { inFlight.delete(id); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  }

  // Lưu cả file sửa tay: chỉ khi file trên đĩa chưa đổi kể từ lúc client tải (baseHash), ghi tuần tự cùng generator
  function saveFile(app, file, code, baseHash) {
    return withFile(`${app.id}:${file}`, async () => {
      const p = scriptPath(app, file);
      const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
      if (baseHash !== hashOf(cur)) return { conflict: true };
      const before = readRegions(cur);
      const regions = readRegions(code);
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

  return { generate, generateCase, saveRegions, saveFile, refreshScript, scriptPath, casesOf, hashOf };
}

// Cầu nối write.mjs của skill (kiểm tra + ghi file automation v2) và vòng chuyển đổi cho MỘT sheet:
//   lập khung → viết dòng theo nhóm (song song) → write.mjs → lỗi thì viết lại đúng nhóm bị nhắc, tối đa maxFix lần.
import { checkApp, contextText, checkSpec, checkCoverage, tighten, checkChain, mentionsId, withEdges } from './appCheck.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { SELECT_AUTOMATION_VENDOR } from '../../paths.js';
import { buildSkeleton } from './skeleton.js';
import { writeGroup, mergePlan } from './rows.js';

// Các dòng "- …" ngay sau một dòng tiêu đề khớp `head`, tới dòng trống / tiêu đề khác
function bullets(out, head) {
  const lines = out.split('\n');
  const i = lines.findIndex((l) => head.test(l));
  if (i < 0) return [];
  const res = [];
  for (const l of lines.slice(i + 1)) {
    if (/^- /.test(l)) res.push(l.slice(2).trim());
    else if (l.trim() === '' && res.length) break;
    else if (l.trim() !== '' && !/^- /.test(l) && res.length) break;
  }
  return res;
}

// → { ok, files, problems, review }. Case có trong plan được coi là selected (người dùng có thể đã chuyển manual → automate).
export async function writePlan({ plan, sheet, outDir }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qapd-write-'));
  const inPlan = new Set(plan.testcases.map((t) => t.id));
  const casesJson = { source: '', sheets: [{ sheet: sheet.sheet, total: sheet.cases.length, selected: 0, cases: sheet.cases.map((c) => ({ ...c, selected: Boolean(c.selected) || inPlan.has(c.id) })) }] };
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan));
  fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(casesJson));
  fs.mkdirSync(outDir, { recursive: true });
  const { out, err, code } = await new Promise((resolve) => {
    execFile(process.execPath, [path.join(SELECT_AUTOMATION_VENDOR, 'scripts/write.mjs'), path.join(dir, 'plan.json'), path.join(dir, 'cases.json'), outDir],
      { maxBuffer: 20 * 1024 * 1024 }, (e, stdout, stderr) => resolve({ out: String(stdout), err: String(stderr), code: e ? (typeof e.code === 'number' ? e.code : 1) : 0 }));
  });
  const files = out.split('\n').filter((l) => /^\/.*-automation\.xlsx$/.test(l.trim())).map((l) => l.trim());
  let problems = bullets(out, /^LỖI \(\d+\):/);
  if (code !== 0 && !problems.length) problems = [`write.mjs lỗi: ${(err || out).split('\n').find((l) => l.trim()) || `exit ${code}`}`];
  return { ok: code === 0 && !problems.length, files, problems, review: bullets(out, /^Cần review/) };
}

// Số nhóm viết dòng Keyword chạy cùng lúc (QAPD_CONVERT_CONCURRENCY để đổi)
const DEFAULT_CONCURRENCY = Number(process.env.QAPD_CONVERT_CONCURRENCY) || 5;

// AI hay ghi nhầm cột Kind / Keyword (vd kind "verify", keyword "Nav"); sửa các nhầm lẫn chắc chắn bằng code thay vì nhờ AI viết lại
const KINDS = { action: 'Action', nav: 'Nav', check: 'Check', case: 'Case' };
export function fixRow(r) {
  if (!r || typeof r !== 'object') return r;
  let { kind, keyword, target } = r;
  const kw = String(keyword || '').trim();
  kind = KINDS[String(kind || '').trim().toLowerCase()] || kind;
  if (/^nav$/i.test(kw)) { kind = 'Nav'; keyword = 'Verify screen'; }
  // Kind không thuộc Action / Nav / Check (AI hay ghi "Verify") → suy ra từ keyword: Verify screen = Nav, Verify … / Run check = Check, còn lại = Action
  if (!['Action', 'Nav', 'Check', 'Case'].includes(kind) && kw) kind = /^verify screen$/i.test(kw) ? 'Nav' : /^(verify |run check$)/i.test(kw) ? 'Check' : 'Action';
  if (kind === 'Nav' && !String(target || '').trim() && r.screen) target = r.screen; // Verify screen cần Target = tên màn
  // Keyword gần đúng (AI hay viết "Verify element visible") → keyword chuẩn
  if (kind === 'Check') {
    if (/^verify (element )?(not )(visible|displayed|shown)$/i.test(String(keyword || '').trim())) keyword = 'Verify not displayed';
    else if (/^verify (element )?(visible|displayed|shown|present|exists?)$/i.test(String(keyword || '').trim())) keyword = 'Verify displayed';
  }
  return { ...r, kind, keyword, ...(target !== undefined || kind === 'Nav' ? { target } : {}) };
}
// Dòng Check của luồng chung bắt buộc có Check label: AI hay bỏ trống → lấy từ target, rồi tới tên màn
export function fixFlowRow(row) {
  const r = fixRow(row);
  if (r && r.kind === 'Check' && !String(r.label || '').trim()) {
    const label = String(r.target || '').trim() || String(r.screen || '').trim();
    if (label) return { ...r, label };
  }
  if (r && r.keyword === 'Handle permission' && !String(r.value || '').trim()) return { ...r, value: 'Allow' }; // tool luôn cho phép quyền
  return r;
}
// Sau mỗi Verify screen phải có một check dương riêng của màn (write.mjs bắt buộc, không thì app treo / sai màn vẫn pass).
// AI hay bỏ sót → thêm Verify displayed theo chính tên màn (cùng target với dòng Verify screen nên cùng cách tìm phần tử), rồi đánh lại số step.
export function fixFlowRows(rows) {
  if (!Array.isArray(rows)) return rows;
  const fixed = rows.map(fixFlowRow);
  const out = [];
  fixed.forEach((r, i) => {
    out.push(r);
    if (r?.kind !== 'Nav') return;
    let ok = false;
    for (let j = i + 1; j < fixed.length && fixed[j]?.kind === 'Check'; j++) if (fixed[j].screen === r.screen && fixed[j].keyword !== 'Verify not displayed') ok = true;
    if (!ok) out.push({ step: 0, screen: r.screen, kind: 'Check', keyword: 'Verify displayed', target: r.target || r.screen, label: `Màn ${r.screen} hiển thị` });
  });
  return out.map((r, i) => ({ ...r, step: i + 1 }));
}
// ===== Tự sửa bằng code các lỗi có quy luật (không tốn AI) — chạy trước mỗi lần ghi file =====
const COMPARE_ALIAS = { equal: 'equals', eq: 'equals', '=': 'equals', '==': 'equals', is: 'equals', contain: 'contains', includes: 'contains', include: 'contains',
  'not equal': 'not equals', '!=': 'not equals', 'not contain': 'not contains', '>': 'greater than', '>=': 'greater or equal', '<': 'less than', '<=': 'less or equal' };
const COMPARE_OK = ['equals', 'not equals', 'contains', 'not contains', 'regex', 'greater than', 'greater or equal', 'less than', 'less or equal', 'empty', 'not empty', 'number', 'unit', 'all-on'];
const PLATFORM_ALIAS = { all: 'All', ios: 'iOS', android: 'Android', both: 'All', '': 'All' };
// Dòng của 1 TC: thêm check dương sau Verify screen (giữ số step), điền Check label trống, chuẩn hoá Compare / Platform, Set network → Android
export function autoFixRows(rows) {
  if (!Array.isArray(rows)) return rows;
  const fixed = rows.map((r) => {
    if (!r || typeof r !== 'object') return r;
    const x = { ...r };
    if (x.compare != null && x.compare !== '') {
      const c = String(x.compare).trim().toLowerCase();
      if (COMPARE_ALIAS[c]) x.compare = COMPARE_ALIAS[c];
      else if (!COMPARE_OK.includes(c) && !/^date:/.test(c)) x.compare = 'equals';
      else x.compare = /^date:/.test(c) ? x.compare : c;
    }
    if (x.platform != null && PLATFORM_ALIAS[String(x.platform).trim().toLowerCase()] !== undefined) x.platform = PLATFORM_ALIAS[String(x.platform).trim().toLowerCase()];
    if (x.keyword === 'Set network') x.platform = 'Android';
    if (x.kind === 'Check' && !String(x.label || '').trim()) x.label = `${x.keyword}${x.target ? ` "${x.target}"` : ''}`;
    return x;
  });
  const out = [];
  fixed.forEach((r, i) => {
    out.push(r);
    if (r?.kind !== 'Nav') return;
    let ok = false;
    for (let j = i + 1; j < fixed.length && fixed[j]?.kind === 'Check'; j++) if (fixed[j].screen === r.screen && fixed[j].keyword !== 'Verify not displayed') ok = true;
    if (!ok) out.push({ step: r.step, screen: r.screen, kind: 'Check', keyword: 'Verify displayed', target: r.target || r.screen, label: `Màn ${r.screen} hiển thị`, platform: r.platform });
  });
  return out;
}

// Lỗi chuỗi tiếp nối (khung): "X có Relaunch app nên phải đứng cuối chuỗi — Y cần fresh = true", "Y: chuỗi tiếp nối quá N TC … fresh = true"
// → TC phải đặt fresh = true. AI viết lại dòng không sửa được (fresh nằm ở khung) → code sửa khung
export function chainFreshFixes(problems = []) {
  const ids = new Set();
  for (const p of problems) {
    const m = p.match(/—\s*(\S+) cần fresh = true/) || p.match(/^(\S+): chuỗi tiếp nối quá .*fresh = true/);
    if (m) ids.add(m[1].replace(/[,:;]$/, ''));
  }
  return [...ids];
}

// ===== Gom đoạn đường đi giống nhau ở Step 0 của nhiều TC thành luồng dùng chung (Run flow) =====
// Đoạn = các dòng trên 1 màn + Verify screen (Nav) sang màn kế + check ngay sau. Đoạn giống hệt (bỏ qua Check label) ở ≥ minUses TC → 1 luồng.
// Bước không được đặt trong luồng (Launch fresh, Relaunch, Reset, Background, Set network, Run flow) giữ nguyên trong TC
const NOT_IN_FLOW = new Set(['Launch fresh', 'Relaunch app', 'Reset app data', 'Background app', 'Set network', 'Run flow']);
const rowKey = (r) => JSON.stringify([r.kind, r.keyword, r.screen || '', r.target || '', r.value || '', r.compare || '', r.platform || 'All']);
function segments(rows) {
  const segs = [];
  let cur = [];
  const flush = () => { if (cur.length) segs.push({ rows: cur }); cur = []; };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (NOT_IN_FLOW.has(r.keyword)) { flush(); segs.push({ rows: [r], keep: true }); continue; }
    cur.push(r);
    if (r.kind === 'Nav') {
      while (i + 1 < rows.length && rows[i + 1].kind === 'Check' && rows[i + 1].screen === r.screen) cur.push(rows[++i]);
      flush();
    }
  }
  flush();
  return segs;
}
export function extractFlows({ testcases, flows = {}, minUses = 3 }) {
  const step0 = (t) => (t.rows || []).filter((r) => Number(r.step) === 0);
  const per = new Map(); // tc id → segments of its Step 0
  const count = new Map(); // key → { rows, uses: Set }
  for (const t of testcases) {
    const segs = segments(step0(t));
    per.set(t.id, segs);
    for (const sg of segs) {
      if (sg.keep || !sg.rows.some((r) => r.kind === 'Nav') || !sg.rows.some((r) => r.kind === 'Action')) continue;
      const key = sg.rows.map(rowKey).join('|');
      sg.key = key;
      if (!count.has(key)) count.set(key, { rows: sg.rows, uses: new Set() });
      count.get(key).uses.add(t.id);
    }
  }
  const out = { ...flows };
  const nameOf = new Map();
  const existing = new Map(Object.entries(flows).map(([n, rows]) => [(rows || []).map(rowKey).join('|'), n]));
  const made = [];
  for (const [key, c] of count) {
    if (c.uses.size < minUses) continue;
    let name = existing.get(key);
    if (!name) {
      const from = c.rows.find((r) => r.kind === 'Action')?.screen || c.rows[0].screen || 'Màn';
      const to = c.rows.find((r) => r.kind === 'Nav')?.screen || 'Màn kế';
      name = `${from} → ${to}`;
      for (let k = 2; out[name] && out[name].map(rowKey).join('|') !== key; k++) name = `${from} → ${to} (${k})`;
      out[name] = c.rows.map((r, i) => ({ ...r, step: i + 1 }));
      made.push({ name, uses: c.uses.size });
    }
    nameOf.set(key, name);
  }
  if (!nameOf.size) return { testcases, flows, made };
  const tcs = testcases.map((t) => {
    const segs = per.get(t.id);
    if (!segs.some((sg) => sg.key && nameOf.has(sg.key))) return t;
    const head = segs.flatMap((sg) => (sg.key && nameOf.has(sg.key) ? [{ step: 0, screen: '', kind: 'Action', keyword: 'Run flow', target: '', value: nameOf.get(sg.key), platform: 'All' }] : sg.rows));
    return { ...t, rows: [...head, ...(t.rows || []).filter((r) => Number(r.step) !== 0)] };
  });
  return { testcases: tcs, flows: out, made };
}

// Luồng khung đã khai báo mà không TC nào gọi (vd case dùng nó chuyển sang manual) → bỏ trước khi ghi, không để write.mjs chặn cả sheet
export function dropUnusedFlows(plan) {
  const used = new Set(plan.testcases.flatMap((t) => (t.rows || []).filter((r) => r.keyword === 'Run flow').map((r) => r.value)));
  return { ...plan, flows: Object.fromEntries(Object.entries(plan.flows || {}).filter(([n]) => used.has(n))) };
}
const fixFlows = (flows) => Object.fromEntries(Object.entries(flows || {}).map(([n, rows]) => [n, Array.isArray(rows) ? fixFlowRows(rows) : rows]));

// Kiểm luồng dùng chung ngay sau khi lập khung (trước khi tốn 40+ lần gọi AI viết nhóm): chạy write.mjs với plan chỉ có flows
export async function checkFlows({ flows, sheet, outDir }) {
  if (!Object.keys(flows || {}).length) return [];
  const r = await writePlan({ plan: { testcases: [], flows, testdata: [], manual: [] }, sheet: { sheet: sheet.sheet, cases: [] }, outDir: path.join(os.tmpdir(), `qapd-flowchk-${process.pid}`) });
  return r.problems.filter((p) => !/khai báo nhưng không TC nào dùng/.test(p));
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const k = next++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// decisions: [{ id, mode: 'automate'|'manual', reason }] cho các case của sheet · cache: { [id]: PlanTc } dùng lại cho nhóm không đổi
// → { ok, files, plans: { [id]: PlanTc }, problems, review }
// dryRun(skeleton, { signal, onProgress }) → { skeleton, review, edges }: chạy thử luồng chung trên thiết bị (tuỳ chọn) — sửa luồng trước khi
//   viết nhóm; khung đã chạy thử (skeleton.flowsChecked) không chạy lại. Cạnh chuyển màn mới thấy được thêm vào ngữ cảnh app của prompt / hậu kiểm
// skeleton: khung đã lập từ lần trước (cùng danh sách case) → bỏ bước lập khung · onSkeleton(skeleton) / onGroup(PlanTc[]): gọi ngay khi khung / một nhóm xong
// → người gọi lưu lại, để gián đoạn hoặc lỗi giữa chừng thì lần sau chuyển đổi tiếp từ chỗ dở
export async function convertSheet({ sheet, decisions, runClaude, outDir, maxFix = 3, concurrency = DEFAULT_CONCURRENCY, signal, onProgress = () => {}, cache = {}, skeleton: given, onSkeleton = () => {}, onGroup = () => {}, appCtx = null, specRules = {}, locked: lockedIds, dryRun = null }) {
  let appText = contextText(appCtx);
  const flowApp = (flows) => Object.entries(flows || {}).flatMap(([n, rows]) => checkApp({ owner: `Luồng "${n}"`, rows, ctx: appCtx }));
  const isApp = new Set();
  const mode = new Map(decisions.map((d) => [d.id, d]));
  const auto = sheet.cases.filter((c) => mode.get(c.id)?.mode === 'automate');
  const manual = sheet.cases.filter((c) => mode.get(c.id)?.mode === 'manual').map((c) => ({ tc: c.id, reason: mode.get(c.id).reason || 'Để manual' }));
  const stopped = (plans = {}) => ({ ok: false, files: [], plans, problems: ['Đã dừng chuyển đổi'], review: [] });
  if (!auto.length) return { ok: true, files: [], plans: {}, problems: [], review: [] };
  if (signal?.aborted) return stopped();

  onProgress({ done: 0, total: 1, label: given ? `Dùng lại khung đã lập cho sheet ${sheet.sheet}` : `Lập khung sheet ${sheet.sheet}` });
  let sk = given ? { ok: true, skeleton: given } : await buildSkeleton({ sheet: sheet.sheet, cases: auto, runClaude, signal, appText });
  if (!sk.ok) return { ok: false, files: [], plans: {}, problems: [sk.error], review: [] };
  // Chuyển lại một phần (khung đã lập + có case đã viết xong dùng lại được): GIỮ NGUYÊN khung, luồng chung và dòng của các case đã xong
  // ("khoá") — chỉ viết case cần viết. Không thì đổi khung / luồng / hậu kiểm sẽ làm đổi dòng hàng chục case → script phải gen lại hết
  // lockedIds (người gọi truyền): chỉ case đã chuyển xong, không đổi gì từ lần ghi trước. Plan "cached" (nhóm xong của lần dừng / lỗi) dùng lại nhưng vẫn hậu kiểm
  const lockable = (id) => cache[id] && (lockedIds ? new Set(lockedIds).has(id) : true);
  const partial = Boolean(given) && auto.some((c) => lockable(c.id));
  let skeleton = partial ? { ...sk.skeleton } : { ...sk.skeleton, flows: fixFlows(sk.skeleton.flows) };
  // Luồng chung sai thì mọi nhóm dựa vào nó đều lỗi: sửa ngay (1 lần nhờ AI lập lại khung), không để tới bước kiểm cuối
  // Lỗi theo app (target không có thật, chuyển màn thiếu nút) cũng đưa vào vòng lập lại khung; còn sót sau cùng thì chỉ cảnh báo (locator map có thể cũ)
  const allFlowProblems = async () => { const f = await checkFlows({ flows: skeleton.flows, sheet }); const a = flowApp(skeleton.flows); a.forEach((x) => isApp.add(x)); return [...f, ...a]; };
  let flowProblems = await allFlowProblems();
  let rebuilt = false;
  // Nhờ AI lập lại khung tối đa 2 lần, mỗi lần kèm đúng danh sách lỗi còn lại (lần 1 thường chưa sửa hết)
  // Khung đã dùng ghi file thành công trước đó → không lập lại (vấn đề còn lại chỉ đưa vào Cần review)
  if (partial && flowProblems.length) { flowProblems.forEach((x) => isApp.add(x)); }
  for (let attempt = 0; attempt < 2 && flowProblems.length && !partial && !signal?.aborted; attempt++) {
    const again = await buildSkeleton({ sheet: sheet.sheet, cases: auto, runClaude, signal, feedback: flowProblems.join('\n'), appText });
    if (!again.ok) break;
    skeleton = { ...again.skeleton, flows: fixFlows(again.skeleton.flows) }; rebuilt = true; flowProblems = await allFlowProblems();
  }
  let flowWarn = flowProblems.filter((p) => isApp.has(p));
  flowProblems = flowProblems.filter((p) => !isApp.has(p));
  if (flowProblems.length) return { ok: false, files: [], plans: {}, problems: flowProblems.map((p) => `Khung: ${p}`), review: [] };
  let flowReview = [];
  let checked = false;
  if (dryRun && !signal?.aborted && Object.keys(skeleton.flows || {}).length && !skeleton.flowsChecked) {
    const d = await dryRun(skeleton, { signal, onProgress });
    flowReview = d?.review || [];
    if (d?.skeleton && d.skeleton !== skeleton) { skeleton = d.skeleton; checked = true; }
    if (d?.edges?.length) { appCtx = withEdges(appCtx, d.edges); appText = contextText(appCtx); }
    if (checked && !partial) flowWarn = flowApp(skeleton.flows); // cảnh báo theo app của luồng sau khi sửa
    if (signal?.aborted) { if (checked) onSkeleton(skeleton); return stopped(); }
  }
  if (!given || rebuilt || checked) onSkeleton(skeleton);
  const freshOf = new Map(skeleton.order.map((o) => [o.id, o.fresh]));
  // Case khoá: có plan cũ khớp khung → dùng nguyên, không hậu kiểm lại, không viết lại trong vòng sửa lỗi
  const locked = new Set(partial ? auto.filter((c) => lockable(c.id) && cache[c.id].fresh === freshOf.get(c.id)).map((c) => c.id) : []);
  const byIdSrc = new Map(auto.map((c) => [c.id, c]));
  const results = new Map(); // id → PlanTc
  let done = 0;
  const total = skeleton.groups.length + 1;
  const tick = (label) => onProgress({ done: ++done, total, label });
  onProgress({ done: 0, total, label: `Đã lập khung: ${skeleton.groups.length} nhóm — đang viết dòng Keyword (${Math.min(concurrency, skeleton.groups.length)} nhóm cùng lúc)` });

  const runGroup = async (group, feedback) => {
    let fb = feedback;
    let error = null;
    for (let attempt = 0; attempt <= maxFix; attempt++) {
      if (signal?.aborted) return 'Đã dừng chuyển đổi';
      const r = await writeGroup({ skeleton, group, cases: auto, runClaude, signal, feedback: fb, appText });
      if (r.ok) { r.testcases.forEach((t) => { t.rows = (t.rows || []).map(fixRow); results.set(t.id, t); }); onGroup(r.testcases); return null; }
      error = r.error;
      fb = r.error;
    }
    return error;
  };

  const groupErrors = (await pool(skeleton.groups, concurrency, async (group) => {
    // Chỉ viết lại các case chưa có plan dùng được (vd vừa đổi câu trả lời điểm mờ); case còn lại của nhóm dùng lại plan cũ
    const usable = (id) => cache[id] && cache[id].fresh === freshOf.get(id);
    const need = group.filter((id) => !usable(id));
    group.filter(usable).forEach((id) => results.set(id, cache[id]));
    if (!need.length) { tick(`Dùng lại nhóm ${group[0]}…`); return null; }
    const e = await runGroup(need);
    tick(`Đã viết nhóm ${group[0]}…`);
    return e;
  })).filter(Boolean);
  const plans = () => Object.fromEntries([...results]);
  if (groupErrors.length) return { ok: false, files: [], plans: plans(), problems: groupErrors, review: [] };

  // Gom đường đi giống nhau ở Step 0 (vd chuỗi onboarding lặp ở hàng chục TC) thành luồng dùng chung — ít dòng, ít lỗi lặp lại,
  // chạy thử trên thiết bị được. Chỉ TC chưa khoá; QAPD_EXTRACT_FLOWS=0 để tắt
  const gomReview = [];
  if (process.env.QAPD_EXTRACT_FLOWS !== '0') {
    const open = [...results.values()].filter((t) => !locked.has(t.id));
    const ex = extractFlows({ testcases: open, flows: skeleton.flows || {} });
    if (ex.made.length) {
      ex.testcases.forEach((t) => results.set(t.id, t));
      const added = Object.fromEntries(ex.made.map((m) => [m.name, fixFlowRows(ex.flows[m.name])]));
      skeleton = { ...skeleton, flows: { ...(skeleton.flows || {}), ...added } };
      for (const m of ex.made) gomReview.push(`[Gom luồng] ${m.uses} case có cùng đoạn đường đi → luồng dùng chung "${m.name}"`);
      // Luồng mới gom: chạy thử trên thiết bị nếu được bật (chỉ các luồng mới)
      if (dryRun && !signal?.aborted) {
        const d = await dryRun({ ...skeleton, flows: added, flowsChecked: undefined }, { signal, onProgress });
        if (d?.skeleton?.flows) skeleton = { ...skeleton, flows: { ...skeleton.flows, ...d.skeleton.flows } };
        flowReview = [...flowReview, ...(d?.review || [])];
      }
      onSkeleton(skeleton);
    }
  }

  let last = { problems: [], review: [], files: [] };
  for (let attempt = 0; attempt <= maxFix; attempt++) {
    if (signal?.aborted) return stopped(plans());
    // Theo tài liệu + độ bám: Check theo Expected của manual (không theo chữ app), mỗi bước Expected có Check, contains → equals khi manual ghi nguyên chuỗi
    const specDiffs = {};
    const specP = [];
    const covP = [];
    // Lỗi có quy luật: sửa bằng code trước (không tốn một vòng AI)
    for (const t of results.values()) if (!locked.has(t.id)) t.rows = autoFixRows(t.rows);
    for (const t of results.values()) {
      const src = byIdSrc.get(t.id);
      if (!src || locked.has(t.id)) continue;
      const sp = checkSpec({ tc: t.id, rows: t.rows, src, ctx: appCtx, allow: specRules[t.id]?.allow || [], enforce: specRules[t.id]?.enforce || [] });
      t.rows = tighten({ rows: sp.rows, src });
      if (sp.diffs.length) specDiffs[t.id] = sp.diffs;
      specP.push(...sp.problems);
      covP.push(...checkCoverage({ tc: t.id, rows: t.rows, src }));
    }
    const plan = dropUnusedFlows(mergePlan({ skeleton, groupResults: [[...results.values()]], manual }));
    last = await writePlan({ plan, sheet, outDir });
    // Kiểm theo app / tài liệu / độ bám: tối đa 2 lần nhờ AI viết lại; còn sót thì vẫn ghi file, đưa vào "Cần review"
    const appP = plan.testcases.filter((t) => !locked.has(t.id)).flatMap((t) => checkApp({ owner: t.id, rows: t.rows, ctx: appCtx }));
    // Chuỗi tiếp nối: thao tác nằm trong pre (không được chạy), case kiểm trạng thái ban đầu của phần tử case trước vừa bấm
    const chainP = checkChain({ testcases: plan.testcases, only: new Set(plan.testcases.map((t) => t.id).filter((id) => !locked.has(id))) });
    // AI chỉ sửa được lỗi theo app khi có tên gần đúng để thay; phần tử không có trong locator map và không có gì gần giống
    // (thường do màn chưa được lấy locator) → chỉ cảnh báo, không bắt AI viết lại cả nhóm vô ích
    const fixableApp = appP.filter((p) => !/không có trong locator map/.test(p) || /gần nhất:/.test(p));
    const extra = [...fixableApp, ...specP, ...covP, ...chainP];
    const warn = [...[...flowWarn, ...appP].map((p) => `[App] ${p}`), ...specP.map((p) => `[Tài liệu] ${p}`), ...covP.map((p) => `[Thiếu kiểm] ${p}`), ...chainP.map((p) => `[Chuỗi] ${p}`)];
    if (last.ok && (!extra.length || attempt >= Math.min(Number(process.env.QAPD_WARN_FIX_ROUNDS ?? 1), maxFix))) { onProgress({ done: total, total, label: `Đã ghi ${sheet.sheet}` }); return { ok: true, files: last.files, plans: plans(), problems: [], review: [...last.review, ...gomReview, ...warn], flowReview, specDiffs }; }
    // Lỗi chuỗi tiếp nối (nằm ở khung, AI viết lại dòng không sửa được) → code đặt TC đó cài lại app rồi chỉ viết lại TC đó
    const reFresh = chainFreshFixes(last.problems).filter((id) => freshOf.has(id) && freshOf.get(id) !== true);
    if (reFresh.length && attempt < maxFix) {
      skeleton = { ...skeleton, order: skeleton.order.map((o) => (reFresh.includes(o.id) ? { ...o, fresh: true } : o)) };
      reFresh.forEach((id) => { freshOf.set(id, true); locked.delete(id); });
      onSkeleton(skeleton);
      onProgress({ done: total - 1, total, label: `Sửa chuỗi tiếp nối: ${reFresh.join(', ')} → cài lại app — viết lại ${reFresh.length} case` });
      const errs = (await pool(reFresh.map((id) => [id]), concurrency, (g) => runGroup(g, `${g[0]} giờ là case CÀI LẠI APP (fresh = true): viết lại từ đầu, đường đi tới màn bắt đầu ở Step 0 (Run flow / thao tác), không dựa vào case trước`))).filter(Boolean);
      if (errs.length) return { ok: false, files: [], plans: plans(), problems: errs, review: [] };
      continue;
    }
    if (attempt === maxFix) break;
    if (last.ok) last = { ...last, problems: extra };
    else last = { ...last, problems: [...last.problems, ...(attempt < Number(process.env.QAPD_WARN_FIX_ROUNDS ?? 1) ? extra : [])] };
    onProgress({ done: total - 1, total, label: `Kiểm tra phát hiện ${last.problems.length} lỗi — AI sửa lại lần ${attempt + 1}/${maxFix}: ${last.problems[0].slice(0, 140)}` });
    // Viết lại đúng các nhóm có case bị nhắc trong lỗi (không nhắc case nào → viết lại tất cả)
    // Case khoá không viết lại: chỉ các case chưa khoá của nhóm
    const open = (g) => g.filter((id) => !locked.has(id));
    const mentioned = (g) => last.problems.filter((p) => open(g).some((id) => mentionsId(p, id)));
    const hit = skeleton.groups.filter((g) => mentioned(g).length).map((g) => Object.assign(open(g), { all: g }));
    // Lỗi không nhắc case nào = lỗi nằm trong luồng dùng chung của khung; viết lại nhóm không sửa được nó, đừng đốt 40+ lần gọi AI vô ích
    if (!hit.length) break;
    const redo = hit;
    const errs = (await pool(redo, concurrency, (g) => runGroup([...g], mentioned(g.all).join('\n')))).filter(Boolean);
    if (errs.length) return { ok: false, files: [], plans: plans(), problems: errs, review: [] };
  }
  return { ok: false, files: last.files, plans: plans(), problems: last.problems, review: last.review };
}

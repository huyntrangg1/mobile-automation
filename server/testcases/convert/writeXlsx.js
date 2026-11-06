// Cầu nối write.mjs của skill (kiểm tra + ghi file automation v2) và vòng chuyển đổi cho MỘT sheet:
//   lập khung → viết dòng theo nhóm (song song) → write.mjs → lỗi thì viết lại đúng nhóm bị nhắc, tối đa maxFix lần.
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
// skeleton: khung đã lập từ lần trước (cùng danh sách case) → bỏ bước lập khung · onSkeleton(skeleton) / onGroup(PlanTc[]): gọi ngay khi khung / một nhóm xong
// → người gọi lưu lại, để gián đoạn hoặc lỗi giữa chừng thì lần sau chuyển đổi tiếp từ chỗ dở
export async function convertSheet({ sheet, decisions, runClaude, outDir, maxFix = 3, concurrency = DEFAULT_CONCURRENCY, signal, onProgress = () => {}, cache = {}, skeleton: given, onSkeleton = () => {}, onGroup = () => {} }) {
  const mode = new Map(decisions.map((d) => [d.id, d]));
  const auto = sheet.cases.filter((c) => mode.get(c.id)?.mode === 'automate');
  const manual = sheet.cases.filter((c) => mode.get(c.id)?.mode === 'manual').map((c) => ({ tc: c.id, reason: mode.get(c.id).reason || 'Để manual' }));
  const stopped = () => ({ ok: false, files: [], plans: {}, problems: ['Đã dừng chuyển đổi'], review: [] });
  if (!auto.length) return { ok: true, files: [], plans: {}, problems: [], review: [] };
  if (signal?.aborted) return stopped();

  onProgress({ done: 0, total: 1, label: given ? `Dùng lại khung đã lập cho sheet ${sheet.sheet}` : `Lập khung sheet ${sheet.sheet}` });
  const sk = given ? { ok: true, skeleton: given } : await buildSkeleton({ sheet: sheet.sheet, cases: auto, runClaude, signal });
  if (!sk.ok) return { ok: false, files: [], plans: {}, problems: [sk.error], review: [] };
  const { skeleton } = sk;
  if (!given) onSkeleton(skeleton);
  const freshOf = new Map(skeleton.order.map((o) => [o.id, o.fresh]));
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
      const r = await writeGroup({ skeleton, group, cases: auto, runClaude, signal, feedback: fb });
      if (r.ok) { r.testcases.forEach((t) => results.set(t.id, t)); onGroup(r.testcases); return null; }
      error = r.error;
      fb = r.error;
    }
    return error;
  };

  const groupErrors = (await pool(skeleton.groups, concurrency, async (group) => {
    const reusable = group.every((id) => cache[id] && cache[id].fresh === freshOf.get(id));
    if (reusable) { group.forEach((id) => results.set(id, cache[id])); tick(`Dùng lại nhóm ${group[0]}…`); return null; }
    const e = await runGroup(group);
    tick(`Đã viết nhóm ${group[0]}…`);
    return e;
  })).filter(Boolean);
  const plans = () => Object.fromEntries([...results]);
  if (groupErrors.length) return { ok: false, files: [], plans: plans(), problems: groupErrors, review: [] };

  let last = { problems: [], review: [], files: [] };
  for (let attempt = 0; attempt <= maxFix; attempt++) {
    if (signal?.aborted) return stopped();
    const plan = mergePlan({ skeleton, groupResults: [[...results.values()]], manual });
    last = await writePlan({ plan, sheet, outDir });
    if (last.ok) { onProgress({ done: total, total, label: `Đã ghi ${sheet.sheet}` }); return { ok: true, files: last.files, plans: plans(), problems: [], review: last.review }; }
    if (attempt === maxFix) break;
    onProgress({ done: total - 1, total, label: `Kiểm tra phát hiện ${last.problems.length} lỗi — AI sửa lại lần ${attempt + 1}/${maxFix}: ${last.problems[0].slice(0, 140)}` });
    // Viết lại đúng các nhóm có case bị nhắc trong lỗi (không nhắc case nào → viết lại tất cả)
    const mentioned = (g) => last.problems.filter((p) => g.some((id) => p.includes(id)));
    const hit = skeleton.groups.filter((g) => mentioned(g).length);
    const redo = hit.length ? hit : skeleton.groups;
    const errs = (await pool(redo, concurrency, (g) => runGroup(g, (hit.length ? mentioned(g) : last.problems).join('\n')))).filter(Boolean);
    if (errs.length) return { ok: false, files: [], plans: plans(), problems: errs, review: [] };
  }
  return { ok: false, files: last.files, plans: plans(), problems: last.problems, review: last.review };
}

// Kiểm dòng Keyword THEO APP (không chỉ hình thức): target phải là phần tử có thật trong locator map, và chuyển màn phải bấm đúng nút
// như sơ đồ màn đã ghi từ các lần chạy. Nguyên nhân gốc của RUN-0142: AI lập luồng không nhìn thấy app → bấm "first option", thiếu "Continue".
const ACT = new Set(['Tap', 'Double tap', 'Long press', 'Toggle', 'Enter', 'Clear', 'Scroll to', 'Select picker', 'Select date', 'Set ruler']);
const ICON = /^(ic|il|img)[A-Z0-9]/; // tên asset ảnh, không phải chữ trên nút
// Nút đi tiếp: một màn có thể sang màn sau bằng nhiều nút (sơ đồ chỉ ghi nút đã bấm ở lần chạy trước) → đã bấm nút kiểu này thì không báo thiếu
const PROCEED = /^(continue|next|get started|done|skip|start|save|ok|confirm|let s go|tiếp tục|tiếp|bắt đầu|xong|lưu|bỏ qua)$/;

export const norm = (s) => String(s ?? '').toLowerCase().replace(/[‘’“”"]/g, '').replace(/^(nút|button|btn)\s+/, '').replace(/[←→✕×✖]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// locatorTable: { tên màn: [{ key, type }] } (screenMap.locatorTable) · edges: sơ đồ màn [{ from, to, target }]
export function appContext({ locatorTable = {}, edges = [] } = {}) {
  const screens = {};
  for (const [name, rows] of Object.entries(locatorTable || {})) {
    const keys = [...new Set((rows || []).map((r) => String(r.key || '').replace(/\s*\n\s*/g, ' ').trim()).filter((k) => k && !ICON.test(k)))];
    if (keys.length) screens[name] = keys;
  }
  const names = new Set(Object.values(screens).flat().map(norm).filter(Boolean));
  const seen = new Set();
  const graph = (edges || []).filter((e) => e?.from && e?.to && e?.target).filter((e) => { const k = `${norm(e.from)}|${norm(e.to)}|${norm(e.target)}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((e) => ({ from: e.from, to: e.to, target: e.target }));
  return { screens, names, edges: graph };
}

const known = (ctx, target) => {
  const t = norm(target);
  if (!t || ctx.names.has(t)) return true;
  return [...ctx.names].some((n) => n.length >= 4 && t.length >= 4 && (n.includes(t) || t.includes(n))); // chữ dài bị cắt / thêm chữ thừa
};
const nearest = (ctx, target, n = 3) => {
  const w = new Set(norm(target).split(' ').filter((x) => x.length > 2));
  return [...new Set(Object.values(ctx.screens).flat())].map((k) => [k, norm(k).split(' ').filter((x) => w.has(x)).length]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
};

// → mảng lỗi (chuỗi). owner = "TC_X" hoặc 'Luồng "A → B"' để vòng sửa biết nhóm / khung nào cần viết lại
export function checkApp({ owner, rows, ctx }) {
  const out = [];
  if (!ctx?.names?.size && !ctx?.edges?.length) return out;
  let screen = null;
  let taps = [];
  let prevTap = null; // Tap ngay trước (cùng màn, chưa có Nav xen giữa): { target, screen }
  for (const r of rows || []) {
    const target = String(r.target || '').trim();
    if (ctx.names.size && ACT.has(r.keyword) && target && !target.startsWith('point:') && !/\{\{|\$\{/.test(target) && !known(ctx, target)) {
      const near = nearest(ctx, target);
      out.push(`${owner} step ${r.step}: "${target}" không có trong locator map của app — dùng đúng tên phần tử thật${near.length ? ` (gần nhất: ${near.map((x) => `"${x}"`).join(', ')})` : ''}`);
    }
    const sc = String(r.screen || '').trim();
    if (r.kind === 'Nav' && screen && sc && norm(sc) !== norm(screen)) {
      const ways = ctx.edges.filter((x) => norm(x.from) === norm(screen) && norm(x.to) === norm(sc));
      const e = ways[0];
      if (e && !taps.some((t) => ways.some((w) => norm(w.target) === norm(t)) || PROCEED.test(norm(t)))) out.push(`${owner} step ${r.step}: theo sơ đồ màn, từ màn "${screen}" sang "${sc}" phải bấm "${e.target}" (mới bấm: ${taps.length ? taps.map((t) => `"${t}"`).join(', ') : 'không có'})`);
    }
    // Hành vi đã thấy trên app thật: bấm Y ở màn S thì app TỰ sang màn T (vd chọn đáp án là tự chuyển màn) → bấm thêm Z ở S là bấm nhầm trên màn T
    if (r.keyword === 'Tap' && target && sc) {
      const auto = prevTap && norm(prevTap.screen) === norm(sc) && autoNext(ctx, sc, prevTap.target);
      if (auto) out.push(`${owner} step ${r.step}: sau khi bấm "${prevTap.target}" app tự sang màn "${auto.to}" (đã thấy trên app thật) — bỏ "Tap ${target}" hoặc thêm Nav tới ${auto.to}`);
      prevTap = { target, screen: sc };
    } else if (r.kind === 'Nav' || (r.kind === 'Action' && ACT.has(r.keyword)) || r.keyword === 'Run flow') prevTap = null;
    if (sc && norm(sc) !== norm(screen || '')) { screen = sc; taps = []; }
    if (ACT.has(r.keyword) && target) taps.push(target);
  }
  return out;
}

// Cạnh "màn S --bấm Y--> màn T" (T ≠ S) trong sơ đồ màn → cạnh đó, không có → null
export function autoNext(ctx, screen, target) {
  const s = norm(screen);
  const t = norm(target);
  if (!s || !t) return null;
  return (ctx?.edges || []).find((e) => norm(e.from) === s && norm(e.target) === t && norm(e.to) !== s) || null;
}

// Cạnh đáng nói riêng với AI: bấm một lựa chọn / phần tử (không phải nút đi tiếp, không phải Back / Close) mà app tự chuyển màn
const BACKISH = /^(back|close|x|đóng|quay lại)$|\(header\)/;
export const behaviourEdges = (ctx) => (ctx?.edges || []).filter((e) => !PROCEED.test(norm(e.target)) && !BACKISH.test(norm(e.target)) && !BACKISH.test(String(e.target || '').toLowerCase()));

// Phần đưa vào prompt (system, được cache giữa các nhóm): màn → tên phần tử thật, và sơ đồ màn
export function contextText(ctx, { maxPerScreen = 30, maxChars = 12000 } = {}) {
  if (!ctx || (!Object.keys(ctx.screens).length && !ctx.edges.length)) return '';
  const lines = ['', 'APP THẬT (lấy từ locator map và các lần chạy trước) — target của Tap / Enter / Toggle… PHẢI là tên phần tử có trong danh sách này (chép đúng chữ), không đặt tên mô tả như "first option", "Nút Back", "Goal thứ 1".'];
  // Đặt trước danh sách màn (dài, có thể bị cắt): đây là điều AI không thể đoán từ tài liệu
  const auto = behaviourEdges(ctx);
  if (auto.length) {
    lines.push('Hành vi đã thấy trên app thật (bấm phần tử này là app TỰ chuyển màn — KHÔNG thêm "Tap Continue" / nút đi tiếp sau bước đó; bước sau phải là Nav tới màn mới):');
    for (const e of auto) lines.push(`- Màn ${JSON.stringify(e.from)}: bấm ${JSON.stringify(e.target)} → tự sang ${JSON.stringify(e.to)}`);
  }
  lines.push('Màn → phần tử:');
  for (const [n, keys] of Object.entries(ctx.screens)) lines.push(`- ${n}: ${keys.slice(0, maxPerScreen).map((k) => JSON.stringify(k)).join(', ')}`);
  if (ctx.edges.length) {
    lines.push('Sơ đồ màn (đi từ màn này sang màn kia phải bấm đúng nút này; luồng / bước chuyển màn phải có dòng bấm nút đó):');
    for (const e of ctx.edges) lines.push(`- ${e.from} —bấm ${JSON.stringify(e.target)}→ ${e.to}`);
  }

  const text = lines.join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text;
}

// ---- Lệch tài liệu: Check phải kiểm theo Expected của manual, KHÔNG theo chữ đang có trên app (locator map chỉ dùng cho thao tác)
const QUOTE = /["“]([^"”]{2,160})["”]/g;
const quotesOf = (s) => [...String(s || '').matchAll(QUOTE)].map((m) => m[1].trim());
const hasHole = (s) => /\[[^\]]*\]/.test(s); // "[giá] — 7 Days Trial": chỗ trống, không dùng nguyên văn được
const bare = (s) => norm(String(s).replace(/\[[^\]]*\]/g, ' '));
const sameText = (a, b) => { const x = bare(a); const y = bare(b); return !!x && !!y && (x === y || (y.length >= 4 && x.includes(y)) || (x.length >= 4 && y.includes(x))); };
// Expected đánh số "1. …" → { 1: '…', 2: '…' } (dòng không số nối vào bước trước)
export function expectedByStep(expected) {
  const out = {};
  let cur = null;
  for (const line of String(expected || '').split('\n')) {
    const m = line.match(/^\s*(\d+)[.)]\s*(.*)$/);
    if (m) { cur = Number(m[1]); out[cur] = m[2]; } else if (cur != null && line.trim()) out[cur] += ` ${line.trim()}`;
  }
  return out;
}
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'you', 'your', 'are', 'is', 'do', 'be', 'it', 'we', 'll', 'my', 'with', 'và', 'của', 'cho', 'bạn']);
const words = (x) => new Set(bare(x).split(' ').filter((w) => w.length > 1 && !STOP.has(w)));
const overlap = (a, b) => { const x = words(a); const y = words(b); if (!x.size || !y.size) return 0; let n = 0; for (const w of x) if (y.has(w)) n++; return n / Math.min(x.size, y.size); };
const SPEC_KW = new Set(['Verify text', 'Verify value', 'Verify selected', 'Verify not selected']);

// Lệch tài liệu = AI thay chữ tài liệu bằng chữ app: ở cùng một bước, (1) có chữ trong ngoặc kép của Expected KHÔNG được Check nào kiểm,
// và (2) có Check kiểm chữ KHÔNG có trong tài liệu nhưng CÓ trên app (locator map). Check bổ sung hợp lệ (tiêu đề màn…) không bị coi là lệch.
// rows: dòng của case · src: nội dung manual · ctx: appContext · allow: [{ step, manual }] người dùng đã chọn "theo app (tài liệu cũ)"
// → { rows (đổi về chữ tài liệu khi ghép 1–1 chắc chắn), diffs: [{ step, manual, app, fixed }], problems (gửi lại AI) }
export function checkSpec({ tc, rows, src, ctx, allow = [], enforce = [] }) {
  const out = (rows || []).map((r) => ({ ...r }));
  const diffs = [];
  const problems = [];
  if (!ctx?.names?.size) return { rows: out, diffs, problems };
  const lines = expectedByStep(src?.expected);
  const all = quotesOf(`${src?.expected || ''}\n${src?.steps || ''}`);
  const valOf = (r) => String(((r.keyword === 'Verify text' || r.keyword === 'Verify value') ? r.value : r.target) || '').trim();
  const checks = out.filter((r) => r.kind === 'Check');
  for (const [k, text] of Object.entries(lines)) {
    const step = Number(k);
    const here = checks.filter((r) => Number(r.step) === step);
    const unchecked = quotesOf(text).filter((q) => !checks.some((r) => sameText(valOf(r), q) || sameText(r.target || '', q)))
      .filter((q) => !allow.some((a) => Number(a.step) === step && sameText(a.manual, q)));
    if (!unchecked.length) continue;
    const subs = here.filter((r) => SPEC_KW.has(r.keyword) && valOf(r) && !all.some((q) => sameText(valOf(r), q)) && known(ctx, valOf(r)));
    if (!subs.length) continue;
    // Tự đổi chỉ khi chắc chắn: ghép 1–1 VÀ hai chữ gần giống (biến thể: "Cookbooks, cards & handwritten notes" ↔ "Cookbooks & handwritten notes").
    // Khác hẳn ("Which age group…" ↔ "How old are you?") có thể là Check khác hợp lệ → để AI sửa / người dùng chọn
    const forced = enforce.find((e) => Number(e.step) === step && unchecked.some((q) => sameText(e.manual, q)) && subs.some((r) => sameText(valOf(r), e.app)));
    if (forced && !hasHole(forced.manual)) {
      const r = subs.find((x) => sameText(valOf(x), forced.app));
      if (r.keyword === 'Verify text' || r.keyword === 'Verify value') { r.value = forced.manual; if (sameText(r.target || '', forced.app)) r.target = forced.manual; } else r.target = forced.manual;
      diffs.push({ step, manual: forced.manual, app: forced.app, fixed: true, byUser: true });
      continue;
    }
    if (unchecked.length === 1 && subs.length === 1 && !hasHole(unchecked[0]) && overlap(unchecked[0], valOf(subs[0])) >= 0.5) {
      const r = subs[0];
      const app = valOf(r);
      if (r.keyword === 'Verify text' || r.keyword === 'Verify value') { r.value = unchecked[0]; if (sameText(r.target || '', app)) r.target = unchecked[0]; } else r.target = unchecked[0];
      diffs.push({ step, manual: unchecked[0], app, fixed: true });
      continue;
    }
    for (const r of subs) diffs.push({ step, manual: unchecked.join(' / '), app: valOf(r), fixed: false });
    problems.push(`${tc} step ${k}: Expected ghi ${unchecked.map((q) => `"${q}"`).join(', ')} nhưng Check đang kiểm chữ của app ${subs.map((r) => `"${valOf(r)}"`).join(', ')} — Check phải theo tài liệu (chữ trên app chỉ dùng cho thao tác)`);
  }
  return { rows: out, diffs, problems };
}

// ---- Độ bám: mỗi bước Expected phải có Check bám vào
const DESIGN = /đúng design|thiết kế|màu|icon|hình minh hoạ|minh họa|minh hoạ|bo góc|animation|hiệu ứng|font|layout/i;
const CHECKISH = new Set(['Check', 'Nav']);
export function checkCoverage({ tc, rows, src }) {
  const lines = expectedByStep(src?.expected);
  const problems = [];
  for (const [k, text] of Object.entries(lines)) {
    if (DESIGN.test(text) && !quotesOf(text).length) continue;
    const at = (rows || []).filter((r) => Number(r.step) === Number(k) && CHECKISH.has(r.kind));
    if (!at.length) { problems.push(`${tc} step ${k}: Expected "${text.slice(0, 120)}" — bước này không có Check nào (thêm Check bám đúng kết quả mong đợi, không chỉ Wait until displayed)`); continue; }
    const blob = (rows || []).filter((r) => CHECKISH.has(r.kind)).map((r) => `${r.target || ''} ${r.value || ''}`).join(' | ');
    const miss = quotesOf(text).filter((q) => !hasHole(q) && !sameText(blob, q) && !bare(blob).includes(bare(q)));
    if (miss.length) problems.push(`${tc} step ${k}: Expected ghi ${miss.map((q) => `"${q}"`).join(', ')} nhưng chưa có Check nào kiểm chữ này (dùng Verify text equals)`);
  }
  return problems;
}

// contains → equals khi Value trùng NGUYÊN chuỗi trong tài liệu (contains thì app thừa / sai đuôi chữ vẫn pass)
export function tighten({ rows, src }) {
  const all = quotesOf(`${src?.expected || ''}\n${src?.steps || ''}`).map(bare);
  return (rows || []).map((r) => (r.kind === 'Check' && r.keyword === 'Verify text' && r.compare === 'contains' && r.value && all.includes(bare(r.value)) ? { ...r, compare: 'equals' } : r));
}

// ---- Khớp TC ID theo ranh giới từ: "TC_1" không được khớp "TC_10" / "TC_1a" (includes() thì khớp nhầm)
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function mentionsId(text, id) {
  if (!id) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escRe(id)}(?![\\p{L}\\p{N}_])`, 'u').test(String(text ?? ''));
}

// ---- Pre-condition chỉ là chữ, runner KHÔNG chạy: thao tác viết trong pre của case tiếp nối sẽ không xảy ra → case mang trạng thái của case trước
const ACTION_PRE = /^\s*(?:\d+[.)]\s*)?(?:[-•*]\s*)?(tap|bấm|nhấn|chọn|bỏ chọn|nhập|vuốt|back|quay lại|đóng|kéo|swipe|select|deselect|enter|type|close|open)(?=$|[\s:,.;"“'→-])/iu;
export const isActionPre = (line) => ACTION_PRE.test(String(line ?? ''));
// Thao tác làm đổi trạng thái phần tử (chọn / bật / nhập)
const STATEFUL = new Set(['Tap', 'Double tap', 'Long press', 'Toggle', 'Enter', 'Select picker', 'Select date', 'Set ruler']);
// Check trạng thái BAN ĐẦU của một phần tử: chưa chọn / đang khoá
const INITIAL_CHECK = new Set(['Verify not selected', 'Verify disabled']);
// Dòng đưa app / phần tử về trạng thái ban đầu
const RESET = new Set(['Launch fresh', 'Relaunch app', 'Reset app data', 'Deselect all']);

// testcases: plan.testcases theo thứ tự chạy ({ id, fresh, pre, rows }) · only: Set id cần kiểm (undefined = tất cả)
// → mảng lỗi (bắt đầu bằng TC ID để vòng sửa viết lại đúng nhóm)
export function checkChain({ testcases, only } = {}) {
  const out = [];
  (testcases || []).forEach((t, i) => {
    if (only && !only.has(t.id)) return;
    if (t.fresh) return; // case cài lại app: write.mjs đã kiểm pre (đường đi phải là Run flow)
    for (const l of t.pre || []) {
      if (isActionPre(l)) out.push(`${t.id} pre: "${l}" là thao tác — viết thành dòng Action ở Step 0 (pre chỉ ghi điều kiện, không được chạy)`);
    }
    const prev = testcases[i - 1];
    if (!prev) return;
    const tapped = new Set((prev.rows || []).filter((r) => STATEFUL.has(r.keyword) && String(r.target || '').trim()).map((r) => norm(r.target)));
    if (!tapped.size) return;
    const touched = new Set();
    let reset = false;
    for (const r of t.rows || []) {
      if (RESET.has(r.keyword) || r.keyword === 'Run flow') reset = true; // Run flow: đường đi có thể đi qua màn khác rồi quay lại — không đoán
      const tg = norm(r.target);
      if (r.kind === 'Action' && tg) touched.add(tg);
      if (r.kind === 'Action' && !RESET.has(r.keyword) && r.keyword !== 'Run flow' && !/^wait/i.test(r.keyword || '') && Number(r.step) >= 1) break; // hết phần "đầu case"
      if (reset) break;
      if (r.kind === 'Check' && INITIAL_CHECK.has(r.keyword) && tg && tapped.has(tg) && !touched.has(tg)) {
        out.push(`${t.id} step ${r.step}: ${r.keyword} "${r.target}" kiểm trạng thái ban đầu nhưng ${prev.id} (case trước trong chuỗi) đã thao tác "${r.target}" — thêm dòng Action đưa về trạng thái ban đầu ở Step 0 (vd Deselect all / Tap bỏ chọn) hoặc để case fresh = true`);
      }
    }
  });
  return out;
}

// Thêm cạnh mới thấy (vd chạy thử luồng chung trên thiết bị) vào ngữ cảnh app: cạnh mới đứng trước, bỏ trùng
export function withEdges(ctx, edges = []) {
  if (!edges.length) return ctx;
  const base = ctx || { screens: {}, names: new Set(), edges: [] };
  const seen = new Set();
  const all = [...edges, ...base.edges].filter((e) => e?.from && e?.to && e?.target).filter((e) => { const k = `${norm(e.from)}|${norm(e.to)}|${norm(e.target)}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((e) => ({ from: e.from, to: e.to, target: e.target }));
  return { ...base, edges: all };
}

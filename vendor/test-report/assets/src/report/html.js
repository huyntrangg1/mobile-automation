// Dựng reports/bug-report.html (1 file, ảnh nhúng sẵn) từ kết quả từng test do hook afterTest ghi ra.
// result: { suite, title, passed, duration, error, case, bugs: [{ id, title, step, label, actual, expected, screen,
//           image (data URL) | null, found }], }

import fs from 'node:fs';
import { classify, prioritize, SEVERITY } from './classify.js';
import { parseLine, actionText, lookText, whenText, checkText, flowText, splitPrecondition, userActions, seenText, NAV_ERROR } from './phrasing.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const show = (v) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));
const secs = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);
const stepNo = (line) => Number((String(line).match(/^(\d+)\./) || [])[1]);

const stripNo = (l) => String(l).replace(/^\d+\.\s*/, '');

const uniqArr = (a) => [...new Set(a)];

// Văn bản bug (Title / Precondition / Steps / Actual / Expected / Attachment) — để dán vào Jira / Asana / Excel
export function bugText(b) {
  const screens = areasOf(b);
  return [
    b.title,
    `Priority: ${b.priority}   Severity: ${b.severity}   Loại: ${b.type}`,
    `Lý do: Severity — ${b.reason}; Priority — ${b.prioReason}`,
    ...(b.unverified.length ? [`Chưa xác minh: ${b.unverified.join('; ')}`] : []),
    '',
    ...(screens.length > 1 ? ['Affected Area:', ...screens.map((w) => `- ${w}`), ''] : []),
    ...(b.pre.length ? ['Precondition:', ...b.pre.map((l, i) => `${i + 1}. ${l}`), ''] : []),
    'Steps to Reproduce:', ...b.stepsClean.map((l, i) => `${i + 1}. ${l}`),
    '',
    'Actual Result:', `- ${b.actual}`,
    '',
    'Expected Result:', `- ${b.expectedShort}`,
    ...(b.screens.some((x) => x.image) ? ['', 'Attachment:', b.noBox ? '- Ảnh màn hình lúc bị chặn' : b.design ? '- Ảnh Figma (trái) và app (phải), chỗ lệch khoanh đỏ' : '- Ảnh evidence (phần lỗi khoanh đỏ)'] : []),
  ].join('\n');
}

// Điểm kiểm "app đang ở đúng màn": nhãn kiểu Tiêu đề / Tới / Sang / Mở lại / … về, hoặc đúng điểm kiểm ngay sau dòng Nav của màn
const SCREEN_LABEL = /^(tiêu đề|tới |sang |vào |mở lại|đóng .* về|hết .* sang|.* sang thẳng)/i;
function isScreenCheck(b, rows = []) {
  if (SCREEN_LABEL.test(String(b.label || ''))) return true;
  return rows.some((x, i) => x.kind === 'Nav' && rows[i + 1]?.kind === 'Check' && rows[i + 1].label === b.label);
}

// Gộp điểm kiểm lệch trong 1 test case thành 1 bug khi chúng là cùng 1 lỗi (mỗi bug thật = 1 card, như tester tự log):
//   1) Màn sai: sau cùng 1 thao tác mà điểm kiểm "đúng màn" lệch → các điểm lệch khác sau thao tác đó là hệ quả, gộp vào nó.
//   2) Màn khác test case / design ở nhiều điểm nội dung (chữ, phần tử phải có, trạng thái chọn, giá trị…) cùng lúc
//      (sau cùng 1 thao tác, trên cùng màn, ≥ 2 loại kiểm) → 1 bug "Màn S khác test case ở N điểm" (vd Paywall chưa theo design).
//   3) Cùng loại kiểm trên cùng màn (vd 2 lựa chọn cùng không tự bỏ chọn, 2 lựa chọn cùng sai số logo) → 1 bug.
//   Thừa phần tử (Verify not displayed), bố cục, nút bật / tắt không gộp vào nhóm nội dung (vd sai chữ nút CTA và thừa nút Back = 2 bug).
// Bug gộp: câu chữ của điểm kiểm đầu, Actual / Expected ghép các điểm, Steps dài nhất, đủ ảnh evidence, Severity cao nhất.
const CONTENT = /^Verify (text|displayed|selected|value|placeholder|count|order|attribute)$/;
// So với Figma: mỗi màn gom theo nhóm (cùng keyword "Verify design <nhóm>") → tiêu đề nói số điểm lệch
const DESIGN_GROUP = {
  text: (n) => `có ${n} chỗ chữ khác Figma`,
  layout: (n) => `có ${n} phần tử lệch vị trí / kích thước so với Figma`,
  font: (n) => `có ${n} chữ sai cỡ so với Figma`,
  color: (n) => `có ${n} chỗ sai màu so với Figma`,
  image: (n) => `có ${n} icon / ảnh / vùng khác Figma`,
};
// Câu Actual của nhóm nội dung: bỏ "khi …" (đã có ở tiêu đề / Steps) để các điểm giống nhau ở nhiều test không lặp lại
const noWhen = (s, when) => (when ? String(s).split(` ${when}`).join('') : String(s).replace(/\s+khi [^.;]*(?=[.;])/g, ''));
function mergeChecks(list) {
  const used = new Set();
  const groups = [];
  for (const p of list) {
    if (!p.screenCheck || used.has(p)) continue;
    const g = list.filter((x) => !used.has(x) && x.trigger === p.trigger && x.screenCheck === false);
    used.add(p);
    g.forEach((x) => used.add(x));
    groups.push([p, ...g]);
  }
  const byMoment = new Map();
  for (const x of list) {
    if (used.has(x) || !CONTENT.test(x.keyword || '')) continue;
    const k = `${x.trigger}|${x.screen}`;
    if (!byMoment.has(k)) byMoment.set(k, []);
    byMoment.get(k).push(x);
  }
  for (const g of byMoment.values()) {
    if (new Set(g.map((x) => x.keyword)).size < 2) continue; // cùng 1 loại kiểm → để bước 3 (giữ câu chữ của loại đó)
    g.forEach((x) => used.add(x));
    g.content = true;
    groups.push(g);
  }
  const byKind = new Map();
  for (const x of list) {
    if (used.has(x)) continue;
    const k = `${x.keyword || x.label}|${x.screen}`;
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k).push(x);
  }
  groups.push(...byKind.values());
  // Giữ thứ tự gặp lỗi trong test
  groups.sort((a, b) => list.indexOf(a[0]) - list.indexOf(b[0]));
  // App không ở đúng màn sau thao tác = sai luồng (lỗi chức năng), không phải "thiếu chữ trên màn"
  const wrongScreen = (b) => (b.screenCheck && SEVERITY.indexOf(b.severity) < SEVERITY.indexOf('Major')
    ? { ...b, type: 'Function', kind: 'screen', severity: 'Major', reason: 'App không ở đúng màn sau thao tác: sai luồng so với test case', unverified: [] }
    : b);
  return groups.map((g) => {
    const [first, ...rest] = g;
    const p = wrongScreen(first);
    if (!rest.length) return p;
    const all = [p, ...rest];
    const top = all.reduce((m, x) => (SEVERITY.indexOf(x.severity) > SEVERITY.indexOf(m.severity) ? x : m), p);
    const longest = all.reduce((m, x) => (x.stepsClean.length > m.stepsClean.length ? x : m), p);
    const design = DESIGN_GROUP[String(p.keyword || '').replace(/^Verify design\s*/, '')];
    const short = g.content ? `Màn ${p.screen} khác test case ở ${all.length} điểm${p.when ? ` ${p.when}` : ''}`
      : /^Verify design/.test(p.keyword || '') && design ? `Màn ${p.screen} ${design(all.length)}` : p.short;
    return {
      ...p,
      short,
      title: `[BUG][${p.screen || p.feature}] ${short}`,
      contentGroup: Boolean(g.content),
      severity: top.severity, reason: top.reason, kind: top.kind, type: top.type,
      unverified: uniqArr(all.flatMap((x) => x.unverified)),
      labels: all.map((x) => x.label),
      actual: uniqArr(all.map((x) => (g.content ? noWhen(x.actual, x.when) : x.actual))).join(' '),
      expectedShort: uniqArr(all.map((x) => x.expectedShort)).join(' '),
      steps: longest.steps,
      stepsClean: longest.stepsClean,
      tcExpected: uniqArr(all.flatMap((x) => x.tcExpected)),
      facts: { ...p.facts, checks: all.flatMap((x) => x.facts?.checks || []), tcExpected: uniqArr(all.flatMap((x) => x.tcExpected)) },
      extraShots: rest.filter((x) => x.image).map((x) => ({ screen: x.screen, image: x.image, found: x.found, missing: x.missing, noBox: x.noBox, design: Boolean(x.design) })),
    };
  });
}

// Màn bị ảnh hưởng (không lặp khi 1 bug có nhiều ảnh trên cùng màn)
const areasOf = (b) => uniqArr(b.screens.map((x) => x.screen).filter(Boolean));

// Ghép bug từ test case (xlsx) + điểm kiểm bị lệch. Câu chữ từng trường: phrasing.js (định nghĩa ở reference.md → Bug fields)
//   Steps lấy từ nhật ký bước đã chạy (r.steps) — đúng thứ tự thật; không có nhật ký thì từ cột Steps của test case
// tapped: phần tử có test case thao tác (Tap) trong cả lần chạy — bằng chứng phần tử dùng để điều hướng
function buildBugs(r, env, tapped = new Set()) {
  const c = r.case || {};
  const feature = c.feature || String(c.title || r.suite || 'App').split(/\s+/)[0];
  const envLine = `Thiết bị: ${env.device} · ${env.platform || ''} ${env.platformVersion} · App ${env.appVersion} · locale ${env.locale}`.replace(/ {2,}/g, ' ');
  const log = r.steps || [];
  const start = c.start || log.find((s) => s.screen)?.screen;
  // "Tiếp nối TC trước" → "Đang ở màn <màn bắt đầu>"; không biết màn bắt đầu thì lấy màn của điểm kiểm
  const preOf = (screen) => {
    const p = splitPrecondition(c.precondition, start || screen);
    return { pre: [...p.pre, envLine], preSteps: p.steps };
  };
  // Thao tác theo cột Steps (không có nhật ký): "2. Enter "Email" = a → Tap "X"" → [{ step, keyword, target, value }]
  const planned = (c.steps || []).flatMap((l) => stripNo(l).split(' → ').map((x) => ({ step: stepNo(l), ...parseLine(x) })));
  // Tên màn theo test case (cột Screen) cho dòng cùng step + phần tử; test case không ghi màn → null (dùng màn trên app)
  const sheetScreen = (kind, step, target) => (c.rows || []).find((x) => x.kind === kind && x.step === step && x.target === target)?.screen || null;
  // Dữ kiện gốc của bug (không qua mẫu câu) — form Log Asana gửi cho AI viết lại (reference.md → "Cách viết bug")
  const factsOf = (extra) => ({ tc: { id: c.id || null, title: c.title || String(r.title || '').replace(c.id || '', '').trim(), feature }, seen: r.seen || null, checks: [], ...extra });
  const errText = (e) => String(e || '').split('\n').slice(0, 3).join('\n').slice(0, 400) || null;
  const finish = (b) => {
    // Severity theo giá trị gốc của điểm kiểm (không theo câu mô tả đã ghép); Priority tính sau khi gộp bug (dedupe)
    const cls = classify({ ...b, actual: b.actualRaw, expected: b.expectedRaw, tcPriority: c.priority });
    const { pre, preSteps } = preOf(b.step == null ? null : b.screen);
    const out = {
      ...b, ...cls, feature, pre, stepsClean: [...preSteps, ...b.steps],
      tcId: c.id || '—', tcPriority: c.priority || '—', where: c.id ? `${c.id} · ${c.title || String(r.title).replace(c.id, '').trim()}` : r.title,
    };
    out.title = `[BUG][${b.screen || feature}] ${b.short}`;
    return out;
  };
  const checkBugs = r.bugs.map((b) => {
    // Điểm kiểm cũ không ghi keyword → lấy từ cột Expected cùng step, khớp theo tên phần tử trong nhãn
    const guess = (c.expected || []).filter((l) => stepNo(l) === b.step).flatMap((l) => stripNo(l).split(' → ').map(parseLine))
      .find((x) => x.target && String(b.label).includes(x.target)) || {};
    const info = { keyword: b.keyword || guess.keyword, target: b.target ?? guess.target, value: b.value ?? guess.value };
    const at = Number.isInteger(b.at) ? b.at : log.findIndex((s) => s.kind === 'Check' && s.step === b.step && s.label === b.label);
    // Không có nhật ký: bỏ thao tác nhấn chính phần tử đang kiểm ở cùng step (nhấn nút gửi diễn ra sau khi kiểm)
    const done = at >= 0
      ? log.slice(0, at).filter((s) => s.kind === 'Action')
      : planned.filter((x) => x.step < b.step || (x.step === b.step && !(x.keyword === 'Tap' && x.target === info.target)));
    const screen = sheetScreen('Check', b.step, info.target) || b.screen || `Step ${b.step}`;
    const actionable = Boolean(info.target) && tapped.has(info.target);
    const when = whenText(done, { ...b, ...info, screen });
    const t = checkText({ ...b, ...info, screen }, when);
    const acts = userActions(done);
    return finish({
      ...b, ...info, screen, actionable,
      // Phần tử cần có nhưng không có → gộp với bug chặn luồng vì không thấy cùng phần tử đó (dedupe)
      missingTarget: ((/^Verify (displayed|text)$/.test(info.keyword || '') && b.actual === false) || b.actual == null) ? info.target : null,
      // Gộp trong TC (mergeChecks): sau cùng thao tác nào (số thao tác người dùng đã làm), có phải điểm kiểm "đúng màn" không
      trigger: acts.length,
      when,
      screenCheck: isScreenCheck({ ...b, ...info }, c.rows),
      short: t.short,
      steps: [...acts.map(actionText), lookText({ ...b, ...info, screen })],
      tcExpected: (c.expected || []).filter((l) => stepNo(l) === b.step),
      actual: t.actual,
      expectedShort: t.expected,
      actualRaw: b.actual,
      expectedRaw: b.expected,
      facts: factsOf({
        screen,
        // Màn ngay lúc lệch (addBug đọc); report cũ chưa có → màn lúc test kết thúc, chỉ khi sau điểm kiểm không còn thao tác nào
        seen: b.seen || (at >= 0 && !log.slice(at + 1).some((s) => s.kind === 'Action') ? r.seen || null : null),
        checks: [{ step: b.step, screen, label: b.label, keyword: info.keyword || null, target: info.target ?? null, value: info.value ?? null, actual: b.actual ?? null, expected: b.expected ?? null }],
        tcExpected: (c.expected || []).filter((l) => stepNo(l) === b.step),
      }),
    });
  });
  // Bước chặn luồng tester cho chạy tiếp (chế độ sửa tay: Skip / Use element) → 1 bug mỗi bước, viết như bug chặn luồng
  const flows = (r.flows || []).map((f) => {
    const done = log.slice(0, f.at).filter((s) => s.kind === 'Action');
    const last = userActions(done).at(-1);
    // Bước nav (không tới được màn): màn của bug = màn đang đứng khi thao tác cuối, không phải màn không tới được
    const at = f.target === '(screen)' && last ? sheetScreen('Action', last.step, last.target) || last.screen || f.screen : f.screen;
    const t = flowText(f.error, { last, failed: { prevScreen: at, screen: f.target === '(screen)' ? null : f.screen }, seen: f.seen });
    return finish({
      step: f.step, label: 'Luồng', screen: t.screen, short: t.short, blocked: true, missingTarget: null,
      steps: userActions(done).map(actionText), tcExpected: [], actual: t.actual, expectedShort: t.expected, image: f.image, found: false, noBox: true,
      facts: factsOf({ screen: t.screen, error: errText(f.error), seen: f.seen || r.seen || null }),
    });
  });
  // Phần tử cần có mà không có → Actual = màn đang hiện lúc đó (vd bottom sheet khác che màn); "không hiển thị X" đã có ở Title.
  //   Bug gộp có cả điểm lệch loại khác → giữ câu cũ, nối thêm câu màn đang hiện
  const checks = mergeChecks(checkBugs).map((x) => {
    const ks = x.facts?.checks || [];
    const s = seenText(x.facts?.seen);
    if (!s || !(x.missingTarget || ks.some((k) => k.actual == null))) return x;
    return { ...x, actual: ks.every((k) => k.actual == null) ? s : `${x.actual} ${s}` };
  });
  // Failed: các điểm kiểm lệch (+ bước đã cho chạy tiếp) là đủ. Blocked: thêm bug chặn luồng (giữ cả hai)
  if (r.status !== 'blocked' && (checks.length || flows.length)) return [...checks, ...flows];
  // Blocked do môi trường / dữ liệu → không phải bug của app, chỉ hiện lý do ở dòng test
  if (r.status === 'blocked' && r.blockKind === 'env') return [...checks, ...flows];
  // Không qua điểm kiểm: Blocked (bug chặn luồng) hoặc Failed bằng assert thường → 1 bug từ thông báo lỗi
  const blocked = r.status === 'blocked';
  let done;
  let failed;
  // Điểm kiểm lệch (soft assert) không làm dừng test → không phải chỗ bị chặn
  const bad = log.findIndex((s) => s.ok === false && s.kind !== 'Check');
  if (bad >= 0) {
    failed = log[bad];
    done = log.slice(0, bad).filter((s) => s.kind === 'Action');
    failed.prevScreen = [...log.slice(0, bad)].reverse().find((s) => s.screen)?.screen;
  } else if (log.some((s) => s.kind === 'Action')) {
    // Có nhật ký nhưng bước lỗi không ghi vào (vd chờ màn kế tiếp quá lâu) → Steps = các thao tác đã chạy
    done = log.filter((s) => s.kind === 'Action');
    failed = { kind: 'Nav', prevScreen: done.at(-1).screen };
  } else {
    // Không có nhật ký: cắt Steps tới thao tác có phần tử không tìm thấy (nếu nhận ra trong thông báo lỗi).
    //   Không tới được màn (Nav): cắt trước thao tác đầu tiên trên phần tử dấu hiệu của màn đó
    const err = String(r.error || '');
    const nav = err.match(NAV_ERROR);
    const name = (nav ? [, nav[3]] : err.match(/name == \\?"([^"\\]+)/) || err.match(/Không thấy (?:ô nhập )?"(.+?)"/) || [])[1];
    const i = name ? planned.findIndex((x) => x.target === name) : -1;
    // Nav: cắt trước dòng Nav của màn đó trong test case; màn không có trong test case → bị chặn ở Precondition, chưa chạy step nào
    const rows = c.rows || [];
    const navAt = nav ? rows.findIndex((x) => x.kind === 'Nav' && x.target === nav[1]) : -1;
    const inCase = nav && rows.some((x) => x.screen === nav[1]);
    if (i >= 0) done = planned.slice(0, i);
    else if (navAt >= 0) done = rows.slice(0, navAt).filter((x) => x.kind === 'Action');
    else done = nav && rows.length && !inCase ? [] : planned;
    failed = i >= 0 && !nav ? planned[i] : null;
  }
  const last = userActions(done).at(-1);
  if (failed && last) failed.prevScreen = sheetScreen('Action', last.step, last.target) || failed.prevScreen;
  const t = flowText(r.error, { last, failed, startScreen: start, seen: r.seen });
  const err = String(r.error || '');
  const missingTarget = NAV_ERROR.test(err) ? null
    : failed?.target || (err.match(/name == \\?"([^"\\]+)/) || err.match(/Không thấy (?:ô nhập )?"(.+?)"/) || [])[1] || null;
  const stop = finish({
    step: null,
    label: blocked ? 'Luồng' : 'Kết quả',
    screen: t.screen,
    short: t.short,
    blocked,
    missingTarget,
    steps: userActions([...done, ...(failed?.kind === 'Action' || (failed && !failed.kind) ? [failed] : [])]).map(actionText),
    tcExpected: [],
    actual: t.actual,
    expectedShort: t.expected,
    image: r.failShot,
    found: false,
    noBox: true,
    facts: factsOf({ screen: t.screen, error: errText(r.error) }),
  });
  const story = blocked ? tellStory(checks, stop) : null;
  return story ? [...checks.filter((x) => !story.parts.includes(x)), story.bug, ...flows] : [...checks, ...flows, stop];
}

// TC bị chặn mà trước đó đã có điểm lệch trên cùng màn (vd tutorial sai tiêu đề, sai bước rồi kết thúc sớm) → 1 bug kể lại
// theo thứ tự: "Sau khi <thao tác>: <điểm lệch>; <điểm lệch>. Sau khi <thao tác>: app hiển thị màn …". Người đọc thấy cả chuỗi,
// không phải tự ghép từ nhiều mẩu ("Không hiển thị Step 2 of 4", "Không thấy Tap here"…). Điểm lệch ở màn khác vẫn là bug riêng.
function tellStory(checks, stop) {
  const parts = checks.filter((x) => x.screen && x.screen === stop.screen);
  if (!parts.length) return null;
  const sentences = [];
  let head = null;
  for (const x of parts) {
    const when = x.when || '';
    const h = !when ? 'Ban đầu' : /^khi vừa/.test(when) ? when.replace(/^./, (ch) => ch.toUpperCase()) : `Sau ${when}`;
    const point = noWhen(x.actual, when).replace(/\.$/, '').replace(/^./, (ch) => ch.toLowerCase());
    if (h === head) sentences[sentences.length - 1] += `; ${point}`;
    else sentences.push(`${h}: ${point}`);
    head = h;
  }
  // Câu của lỗi chặn bắt đầu bằng đúng thao tác vừa kể ("Sau khi nhấn X, …") → nối vào câu đó, không lặp "Sau khi nhấn X"
  const tail = head && stop.actual.startsWith(`${head}, `) ? stop.actual.slice(head.length + 2) : null;
  if (tail) sentences[sentences.length - 1] += `; ${tail.replace(/\.$/, '')}`;
  const actual = [...sentences, ...(tail ? [] : [stop.actual])].map((s) => (/[.!?]$/.test(s) ? s : `${s}.`)).join(' ');
  const root = parts[0];
  const all = [...parts, stop];
  const top = all.reduce((m, x) => (SEVERITY.indexOf(x.severity) > SEVERITY.indexOf(m.severity) ? x : m), root);
  return {
    parts,
    bug: {
      ...root,
      severity: top.severity, reason: top.reason, kind: top.kind, type: top.type,
      unverified: uniqArr(all.flatMap((x) => x.unverified)),
      blocked: true,
      stopLink: true, // dòng "⛔ Dừng" của test trỏ về bug này
      labels: uniqArr(parts.flatMap((x) => x.labels || [x.label])),
      actual,
      expectedShort: uniqArr(all.map((x) => x.expectedShort)).join(' '),
      steps: stop.steps,
      stepsClean: stop.stepsClean,
      facts: { ...stop.facts, checks: parts.flatMap((x) => x.facts?.checks || []), tcExpected: uniqArr(parts.flatMap((x) => x.tcExpected || [])) },
      extraShots: [...parts.slice(1).filter((x) => x.image), stop].filter((x) => x.image)
        .map((x) => ({ screen: x.screen, image: x.image, found: x.found, missing: x.missing, noBox: x.noBox, design: Boolean(x.design) })),
    },
  };
}

// Gộp bug, 2 bước. Bug gộp lấy Severity cao nhất (kèm lý do) và Priority TC cao nhất; Priority tính sau khi gộp.
//   1) Cùng màn + cùng điểm kiểm ở nhiều test / bộ data → chỉ giữ 1 bug đại diện (lần gặp đầu), không ghi số lần gặp.
//   2) Cùng lỗi (cùng điểm kiểm, cùng giá trị sai) trên nhiều màn → 1 bug, Affected Area = các màn đó.
// r.mine: các bug của test r (để liệt kê ở dòng test và lọc danh sách Bug theo test).
const RANK = ['Low', 'Normal', 'High', 'Very High'];
const TC_RANK = ['Low', 'Medium', 'High'];
const raise = (m, b) => {
  if (SEVERITY.indexOf(b.severity) > SEVERITY.indexOf(m.severity)) Object.assign(m, { severity: b.severity, reason: b.reason, kind: b.kind, type: b.type });
  if (TC_RANK.indexOf(b.tcPriority) > TC_RANK.indexOf(m.tcPriority)) m.tcPriority = b.tcPriority;
  m.unverified = uniqArr([...m.unverified, ...b.unverified]);
};
function dedupe(rows, nextId) {
  const groups = new Map();
  for (const r of rows) {
    r.mine = [];
    for (const b of r.built) {
      // Màn khác test case ở nhiều điểm (nhóm nội dung) → 1 bug cho màn đó dù gặp ở nhiều test (vd Paywall chưa theo design)
      const key = b.step == null ? `flow|${b.short}` : b.contentGroup ? `content|${b.feature}|${b.screen}` : `${b.feature}|${b.screen}|${b.label}`;
      let g = groups.get(key);
      if (!g) {
        g = { ...b, tests: [], screens: [{ screen: b.screen, image: b.image, found: b.found, missing: b.missing, noBox: b.noBox, design: Boolean(b.design) }, ...(b.extraShots || [])] };
        groups.set(key, g);
      } else {
        raise(g, b);
        if (b.contentGroup && !g.tests.includes(r.key)) {
          // Ghép các điểm lệch của test mới (không lặp câu), đủ ảnh; tiêu đề không còn "khi …" của riêng 1 test
          const joinSentences = (a, x) => uniqArr([...a.split(/(?<=\.)\s+/), ...x.split(/(?<=\.)\s+/)]).join(' ');
          g.actual = joinSentences(noWhen(g.actual), noWhen(b.actual));
          g.expectedShort = joinSentences(g.expectedShort, b.expectedShort);
          g.labels = uniqArr([...(g.labels || [g.label]), ...(b.labels || [b.label])]);
          if (g.facts) g.facts = { ...g.facts, checks: [...(g.facts.checks || []), ...(b.facts?.checks || [])] };
          g.screens.push({ screen: b.screen, image: b.image, found: b.found, missing: b.missing, noBox: b.noBox, design: Boolean(b.design) }, ...(b.extraShots || []));
          g.short = `Màn ${g.screen} khác test case ở ${g.actual.split(/(?<=\.)\s+/).length} điểm`;
          g.title = `[BUG][${g.screen}] ${g.short}`;
        }
      }
      if (!g.tests.includes(r.key)) g.tests.push(r.key);
      if (!r.mine.includes(g)) r.mine.push(g);
    }
  }
  //   Thiếu cùng 1 phần tử (điểm kiểm "phải hiển thị X" và test bị chặn vì không thấy X để thao tác) → 1 bug,
  //   đại diện là bug từ điểm kiểm (có màn + bước rõ hơn); màn trống của bug chặn luồng không tính vào Affected Area.
  const merged = new Map();
  const absorb = (m, g) => {
    raise(m, g);
    for (const x of g.screens) if (x.screen && !m.screens.some((y) => y.screen === x.screen)) m.screens.push(x);
    for (const t of g.tests) if (!m.tests.includes(t)) m.tests.push(t);
  };
  for (const g of groups.values()) {
    const key = g.missingTarget ? `missing|${g.feature}|${g.missingTarget}`
      : g.step == null ? `flow|${g.short}` : `${g.feature}|${g.label}|${show(g.actualRaw)}|${show(g.expectedRaw)}`;
    const m = merged.get(key);
    g.root = g;
    if (!m) {
      merged.set(key, g);
    } else if (m.step == null && g.step != null) {
      if (!g.screens.some((x) => x.screen)) g.screens = m.screens;
      absorb(g, m);
      m.root = g;
      merged.set(key, g);
    } else {
      absorb(m, g);
      g.root = m;
    }
  }
  const rootOf = (g) => (g.root === g ? g : rootOf(g.root));
  for (const r of rows) r.mine = uniqArr(r.mine.map(rootOf));
  const all = [...merged.values()];
  // TC bị chặn theo vì TC trước bị chặn (hooks ghi "TC trước bị chặn (TC_x)") → bug chặn luồng ở TC_x chặn thêm các TC đó
  const tcOf = Object.fromEntries(rows.map((r) => [r.key, r.case?.id]));
  const blockedBy = rows.map((r) => (String(r.error || '').match(/TC trước bị chặn \(([^)]+)\)/) || [])[1]).filter(Boolean);
  for (const b of all) {
    const ids = b.tests.map((t) => tcOf[t]);
    const p = prioritize({
      severity: b.severity, tcPriority: b.tcPriority, testCount: b.tests.length, screenCount: areasOf(b).length,
      blocksAfter: blockedBy.filter((id) => ids.includes(id)).length,
    });
    Object.assign(b, p, { unverified: uniqArr([...b.unverified, ...p.unverified]) });
    b.id = nextId();
    if (areasOf(b).length > 1) b.title = `[BUG][${b.feature}] ${b.short}`;
    b.text = bugText(b);
  }
  return all;
}

const ICON = {
  copy: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M11 5V3.5A1 1 0 0 0 10 2.5H3.5a1 1 0 0 0-1 1V10a1 1 0 0 0 1 1H5"/></svg>',
  download: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10"/></svg>',
  print: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 6V2.5h7V6M4.5 11.5h-2v-5h11v5h-2M4.5 9.5h7v4h-7z"/></svg>',
  moon: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z"/></svg>',
  passed: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  failed: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
  blocked: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M4.2 11.8l7.6-7.6"/></svg>',
  skipped: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l5 4-5 4M10 4v8"/></svg>',
  notrun: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M5.5 8h5"/></svg>',
};
const PCODE = { 'Very High': 'P0', High: 'P1', Normal: 'P2', Low: 'P3' };

function bugCard(b, share) {
  const list = (lines) => `<ol class="lines">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>`;
  const caption = (x) => (x.design
    ? `Màn ${x.screen} — trái: Figma, phải: app; chỗ lệch khoanh đỏ${x.missing ? ' (nét đứt: chỗ lẽ ra phải có)' : ''}`
    : x.noBox
    ? 'Màn hình lúc test fail'
    : x.found ? `Màn ${x.screen} — phần lỗi khoanh đỏ`
      : x.missing ? `Màn ${x.screen} — không có phần tử cần kiểm; khung đỏ nét đứt là chỗ lẽ ra phải hiện`
        : `Màn ${x.screen} — không tìm thấy phần tử cần kiểm trên màn hình`);
  const areas = areasOf(b).length > 1;
  const shots = b.screens.filter((x) => x.image);
  // Dữ liệu để form Asana dựng html_notes (đơn lẻ hoặc gộp nhiều bug UI cùng màn) và để dashboard đọc
  const data = {
    id: b.id, title: b.title, short: b.short, feature: b.feature, screen: b.screen, label: b.label, type: b.type,
    priority: b.priority, severity: b.severity, pre: b.pre, steps: b.stepsClean,
    actual: b.actual, expected: b.expectedShort, screens: areasOf(b),
    facts: b.facts || null,
  };
  // Lỗi trên nhiều màn: ảnh của từng màn, bấm ảnh nhỏ để đổi
  const evidence = shots.length ? `
<img class="main" src="${shots[0].image}" alt="Evidence ${esc(b.id)}"${shots.length === 1 ? ` data-occ="0" data-name="${esc(b.id)}"` : ''}>
${shots.length > 1 ? `<div class="thumbs">${shots.map((x, i) => `<img src="${x.image}" data-occ="${i}" data-name="${esc(b.id)}-${i + 1}" data-cap="${esc(caption(x))}" class="${i ? '' : 'on'}" alt="${esc(x.screen)}" title="${esc(x.screen)}">`).join('')}</div>` : ''}
<figcaption>${esc(caption(shots[0]))}</figcaption>` : '<div class="noimg">Không có ảnh</div>';
  return `
<details class="bug" id="bug-${esc(b.id)}" data-tests="${b.tests.join(' ')}" data-type="${esc(b.type)}" data-priority="${esc(b.priority)}" data-severity="${esc(b.severity)}" data-screen="${esc(b.screen || '')}" data-label="${esc(b.label)}" data-bug="${esc(JSON.stringify(data))}">
<summary class="bug-head">${share ? '' : `<input type="checkbox" class="pick" aria-label="Chọn ${esc(b.id)}">`}<span class="bug-id">${esc(b.id)}</span><span class="bug-tags"><span class="type type-${esc(b.type)}" title="${esc(b.reason)}">${esc(b.type)}</span><span class="sev sev-${esc(b.severity)}" title="Severity"><span class="sev-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>${esc(b.severity)}</span><span class="prio prio-${b.priority.replace(/\s+/g, '')}" title="Priority"><b>${PCODE[b.priority] || ''}</b>${esc(b.priority)}</span>${areas ? `<span class="chip" title="Cùng lỗi trên nhiều màn">${b.screens.length} màn</span>` : ''}</span><h4>${esc(b.title)}</h4><span class="bug-acts"><button class="copy btn btn-sm" data-text="${esc(b.text)}">${ICON.copy}Copy bug</button>${share ? '' : `<button class="asana btn btn-sm btn-primary" data-id="${esc(b.id)}">Log Asana</button>`}<span class="caret" aria-hidden="true"></span></span></summary>
<div class="bug-body">
<div class="fields">
<dl class="meta"><div><dt>Severity</dt><dd><b>${esc(b.severity)}</b> <span class="muted">— ${esc(b.reason)}</span></dd></div><div><dt>Priority</dt><dd><b>${esc(b.priority)}</b> <span class="muted">— ${esc(b.prioReason)}</span></dd></div><div><dt>Loại bug</dt><dd>${esc(b.type)}</dd></div><div><dt>TC</dt><dd>${esc(b.where)} <span class="muted">(Priority TC: ${esc(b.tcPriority)})</span></dd></div>${b.unverified.length ? `<div><dt>Chưa xác minh</dt><dd><ul class="where">${b.unverified.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></dd></div>` : ''}${areas ? `<div><dt>Affected Area</dt><dd><ul class="where">${b.screens.map((x) => `<li>${esc(x.screen)}</li>`).join('')}</ul></dd></div>` : ''}</dl>
<h5>Precondition</h5>${list(b.pre)}
<h5>Steps to Reproduce</h5>${list(b.stepsClean)}
<div class="compare"><div class="act"><h5>Actual Result</h5><p class="actual">${esc(b.actual)}</p></div><div><h5>Expected Result</h5><p class="expected">${esc(b.expectedShort)}</p></div></div>
${b.tcExpected.length ? `<p class="muted small">Theo test case: ${b.tcExpected.map(esc).join(' · ')}</p>` : ''}
</div>
<figure class="evidence">${evidence}
</figure>
</div>
</details>`;
}

// Trạng thái test case: nhãn hiển thị + class màu
export const STATUS = {
  passed: ['Passed', 'pass', 'Kết quả thực tế khớp kết quả mong đợi'],
  failed: ['Failed', 'fail', 'Kết quả thực tế khác mong đợi (có bug)'],
  blocked: ['Blocked', 'blocked', 'Không chạy được do vấn đề bên ngoài (môi trường, bug chặn luồng, thiếu dữ liệu)'],
  skipped: ['Skipped', 'skipped', 'Cố ý không chạy trong lần này'],
  notrun: ['Not Run', 'notrun', 'Chưa được chạy'],
};

// Số liệu của report (dùng chung cho HTML và file Excel): test kèm bug của từng test, danh sách bug đã gộp, đếm trạng thái
export function buildModel({ results, env }) {
  // Mã bug đánh liên tục trong cả report (BUG-001…)
  let n = 0;
  const nextId = () => `BUG-${String(++n).padStart(3, '0')}`;
  // Phần tử được bấm ở bất kỳ test case nào (nhật ký bước + cột Steps)
  const tapped = new Set(results.flatMap((r) => [
    ...(r.steps || []).filter((x) => x.kind === 'Action' && x.keyword === 'Tap').map((x) => x.target),
    ...(r.case?.steps || []).flatMap((l) => stripNo(l).split(' → ').map(parseLine)).filter((x) => x.keyword === 'Tap').map((x) => x.target),
  ]));
  const withBugs = results.map((r, i) => ({ ...r, key: `t${i + 1}`, built: ['failed', 'blocked'].includes(r.status) ? buildBugs(r, env, tapped) : [] }));
  const bugs = dedupe(withBugs, nextId);
  const tcOf = Object.fromEntries(withBugs.map((r) => [r.key, r.case?.id || r.suite]));
  for (const b of bugs) b.tcIds = uniqArr(b.tests.map((t) => tcOf[t]));
  const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, results.filter((r) => r.status === k).length]));
  const executed = counts.passed + counts.failed + counts.blocked;
  return { withBugs, bugs, counts, executed, rate: executed ? Math.round((counts.passed / executed) * 100) : 0 };
}

// Mở 1 test case → danh sách bước: Precondition + từng bước (thao tác / tới màn / điểm kiểm) kèm kết quả.
// Có nhật ký bước (r.steps, ghi lúc chạy) → ✓ / ✗ từng bước; không có (spec cũ) → bước theo test case, ✗ ở bước có bug.
function stepsView(r) {
  const c = r.case || {};
  const bugLink = (b) => (b ? `<a class="sbug" href="#bug-${esc(b.id)}" data-goto="${esc(b.id)}">${esc(b.id)}</a>` : '');
  const pre = c.precondition?.length ? `<h5>Precondition</h5><ol class="lines">${c.precondition.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>` : '';
  const val = (v) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));
  let body = '';
  if (r.steps?.length) {
    body = r.steps.map((s) => {
      const what = s.kind === 'Check'
        ? esc(s.label)
        : s.kind === 'Nav' ? `Tới màn <b>${esc(s.screen || s.target)}</b>`
          : `${esc(s.keyword)}${s.target ? ` "${esc(s.target)}"` : ''}${s.value ? ` = ${esc(s.value)}` : ''}`;
      const bug = s.kind === 'Check' && !s.ok ? r.mine.find((b) => (b.labels || [b.label]).includes(s.label)) : null;
      const res = s.ok
        ? `<span class="sok">${s.kind === 'Check' ? '✓' : '•'}</span>`
        : s.kind === 'Check'
          ? `<span class="sfail">✗</span> <span class="muted">app ${esc(val(s.actual))} · mong đợi ${esc(val(s.expected))}</span> ${bugLink(bug)}`
          : `<span class="sfail">⛔ Dừng</span> <span class="muted">${esc(String(s.error || '').split('\n')[0])}</span> ${bugLink(r.mine.find((b) => b.step == null || b.stopLink))}`;
      return `<tr class="k-${s.kind.toLowerCase()}${s.ok ? '' : ' bad'}"><td class="sn">${s.step ?? ''}</td><td>${what}</td><td>${res}</td></tr>`;
    }).join('');
    if (r.status === 'blocked') body += `<tr><td></td><td colspan="2" class="muted">Các bước sau không chạy</td></tr>`;
  } else {
    // Không có nhật ký: ghép bước thao tác + điểm kiểm theo số step của test case
    const lines = new Map();
    for (const [kind, list] of [['Action', c.steps || []], ['Check', c.expected || []]]) {
      for (const l of list) {
        const n = Number((String(l).match(/^(\d+)\./) || [])[1]);
        if (!lines.has(n)) lines.set(n, []);
        lines.get(n).push({ kind, text: String(l).replace(/^\d+\.\s*/, '') });
      }
    }
    body = [...lines].sort((a, b) => a[0] - b[0]).map(([n, items]) => {
      const bugs = r.mine.filter((b) => b.step === n);
      return items.map((it, i) => `<tr class="k-${it.kind.toLowerCase()}"><td class="sn">${i ? '' : n}</td><td>${esc(it.text)}</td>
        <td>${it.kind === 'Check' ? (bugs.length ? `<span class="sfail">✗</span> ${bugs.map(bugLink).join(' ')}` : r.status === 'passed' ? '<span class="sok">✓</span>' : '') : ''}</td></tr>`).join('');
    }).join('');
  }
  const table = body ? `<h5>Các bước</h5><table class="steps"><thead><tr><th>Step</th><th>Thao tác / Điểm kiểm</th><th>Kết quả</th></tr></thead><tbody>${body}</tbody></table>` : '';
  return `<div class="stepsview">${pre}${table}</div>`;
}

// Giao diện: ui/report.css + ui/page.js (chung) + ui/asana.js (chỉ bản đầy đủ) + ui/dashboard.js (KPI, biểu đồ, bộ lọc chung).
// Script nhúng nguyên văn, nên viết JS trong các file đó như JS thường (không cần escape như trong template literal).
const ui = (f) => fs.readFileSync(new URL(`./ui/${f}`, import.meta.url), 'utf8');

// share = bản để đăng lên trang Artifact claude.ai: không có khung <html>/<head>/<body> (trang tự bọc),
// bỏ Export PDF và Log Asana vì môi trường đó chặn hộp thoại in và gọi API ra ngoài.
// xlsxFiles: [{ name, b64 }] file Excel cho nút Export Excel (file test case đã ghi kết quả) — chỉ bản đầy đủ (trang share chặn tải file)
// Cần xem (không đổi số Passed / Failed / Blocked): case Blocked không rõ lỗi của ai (blockKind review), case có lệch so với script
// (AI hỗ trợ gỡ kẹt / tool đóng popup ngoài test case — ai-assist.jsonl) hoặc có điểm kiểm không làm được tự động (unverified.jsonl)
export function reviewItems({ withBugs, deviations = [], unverified = [] }) {
  const tcOf = (r) => r.case?.id || String(r.title || '').split(' ')[0];
  const by = new Map();
  const add = (r, why) => { const k = r.key; if (!by.has(k)) by.set(k, { r, why: [] }); by.get(k).why.push(why); };
  const find = (tc) => withBugs.find((r) => tc && tcOf(r) === tc);
  for (const r of withBugs) if (r.status === 'blocked' && r.blockKind === 'review') add(r, `Blocked — cần xem lỗi app hay môi trường: ${String(r.error || '').split('\n')[0]}`);
  for (const d of deviations) {
    const r = find(d.tc);
    if (!r) continue;
    const what = d.kind === 'overlay' ? 'Tool đóng popup ngoài test case' : 'AI hỗ trợ gỡ kẹt';
    add(r, `${what} ở bước ${d.step ?? '?'}${d.screen ? ` (màn ${d.screen})` : ''}: ${String(d.error || '').split('\n')[0]}`);
  }
  for (const u of unverified) {
    const r = find(u.tc);
    const why = `Step ${u.step ?? ''} · ${u.label || u.target || ''}: không kiểm được tự động${u.why ? ` (${u.why})` : ''} — kiểm tay`;
    if (r) add(r, why);
    else by.set(`u${by.size}`, { r: { case: { id: u.tc || '—' }, status: null }, why: [why] });
  }
  return [...by.values()];
}

export function renderReport({ appName = 'App', results, env, startedAt, share = false, xlsxFiles = [], unverified = [], deviations = [] }) {
  const { withBugs, bugs } = buildModel({ results, env });
  // Không phải bug của app: case Blocked do môi trường / công cụ / kịch bản. Tách khỏi Bug Details (không có nút Log Asana) để không ai log nhầm
  const envBlocked = withBugs.filter((r) => r.status === 'blocked' && r.blockKind === 'env');
  const notApp = envBlocked.length;
  const notAppRows = envBlocked.map((r) => `<tr><td class="mono">${esc(r.case?.id || '—')}</td><td>Blocked</td><td>${esc(String(r.error || '').split('\n')[0])}</td></tr>`).join('');
  const notAppSection = notApp ? `
  <section id="not-app">
    <div class="sec-head"><h2>Không phải bug của app</h2><span class="hint">${notApp} mục — do môi trường / công cụ / kịch bản test, cần xử lý phía test chứ không log bug</span></div>
    <div class="card"><div class="card-body"><table class="steps"><thead><tr><th>Test case</th><th>Kết quả</th><th>Lý do</th></tr></thead><tbody>${notAppRows}</tbody></table></div></div>
  </section>` : '';
  const review = reviewItems({ withBugs, deviations, unverified });
  const reviewKeys = new Set(review.map((x) => x.r.key).filter(Boolean));
  const reviewSection = review.length ? `
  <section id="review">
    <div class="sec-head"><h2>Cần xem</h2><span class="hint">${review.length} case — kết quả có thể chưa phản ánh đúng app (lệch so với script, điểm kiểm phải kiểm tay, lỗi chưa rõ của app hay môi trường). Không đổi số Passed / Failed</span></div>
    <div class="card"><div class="card-body"><table class="steps"><thead><tr><th>Test case</th><th>Kết quả</th><th>Cần xem</th></tr></thead><tbody>${review.map(({ r, why }) => `<tr><td class="mono">${esc(r.case?.id || '—')}</td><td>${esc(r.status ? (STATUS[r.status] || STATUS.failed)[0] : '—')}</td><td><ul class="where">${why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></td></tr>`).join('')}</tbody></table></div></div>
  </section>` : '';
  const suites = uniqArr(withBugs.map((r) => r.suite).filter(Boolean));

  const rows = withBugs.map((r) => {
    const [label, cls, meaning] = STATUS[r.status] || STATUS.failed;
    const env_ = r.status === 'blocked' && r.blockKind === 'env';
    const mine = r.mine;
    const ran = !['skipped', 'notrun'].includes(r.status);
    const head = `
<span class="c-status"><span class="badge st-${cls}" title="${esc(meaning)}">${ICON[r.status] || ''}${label}</span></span>
<span class="c-tc">${esc(r.case?.id || '—')}</span>
<span class="c-name"><b>${esc(r.suite)}</b><br>${esc(r.title)}${reviewKeys.has(r.key) ? ' <span class="rv-flag" title="Có mục cần xem lại — xem mục Cần xem bên dưới">Cần xem</span>' : ''}</span>
<span class="c-bugs${mine.length ? '' : ' muted'}">${mine.length ? `${mine.length} bug` : env_ ? 'Môi trường' : '—'}</span>
<span class="c-time">${ran ? secs(r.duration) : '—'}</span>`;
    // Blocked: lý do bị chặn (ảnh lúc dừng chỉ hiện ở đây khi không có bug card)
    const blocker = r.status === 'blocked' ? `<div class="blocker"><b>Blocked — ${env_ ? 'lỗi môi trường / dữ liệu, không phải bug của app' : r.blockKind === 'review' ? 'cần xem: chưa rõ lỗi của app hay môi trường (vd app crash làm mất phiên, case trước để app sai màn) — bug vẫn được ghi bên dưới' : 'bug chặn luồng (xem bước ⛔ bên dưới)'}</b>
<pre>${esc(r.error || '')}</pre>${env_ && r.failShot ? `<img src="${r.failShot}" alt="Màn hình lúc bị chặn">` : ''}</div>` : '';
    const body = ran ? `${blocker}${stepsView(r)}` : `<p class="muted small">${esc(meaning)}</p>`;
    return `<details class="row" data-t="${r.key}" data-tc="${esc(r.case?.id || r.title)}" data-suite="${esc(r.suite)}" data-status="${r.status}" data-sec="${ran ? (r.duration / 1000).toFixed(1) : 0}"><summary>${head}</summary><div class="bugs">${body}</div></details>`;
  }).join('');

  const opts = (list) => list.map((v) => `<option>${esc(v)}</option>`).join('');
  const excel = xlsxFiles.map((f) => `<a class="btn pdf xls" download="${esc(f.name)}" title="${esc(f.name)}" href="data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${f.b64}">${ICON.download}Excel${xlsxFiles.length > 1 ? `: ${esc(f.name)}` : ''}</a>`).join('');

  return `${share ? '' : '<!doctype html>\n<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'}
<title>${esc(appName)} · Test Report</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
${ui('report.css')}
</style>${share ? '' : `</head><body data-app="${esc(appName)}" data-run="${esc(startedAt)}">`}
<header class="hdr">
  <div><div class="overline">${esc([appName, ...suites].join(' · '))}</div><h1>Test Report</h1></div>
  <dl class="hdr-meta" title="UDID ${esc(env.udid)}"><div><dt>Build</dt><dd>App ${esc(env.appVersion)}</dd></div><div><dt>Platform</dt><dd>${esc(env.platform || 'OS')} ${esc(env.platformVersion)} · ${esc(env.device)}</dd></div><div><dt>Environment</dt><dd>Locale ${esc(env.locale)}</dd></div><div><dt>Test run</dt><dd>${esc(startedAt)}</dd></div><div><dt>Duration</dt><dd><span id="m-dur">—</span></dd></div></dl>
  <div class="hdr-actions">${share ? '' : `${excel}<button type="button" class="btn pdf" title="Mở hộp thoại in → chọn Save as PDF">${ICON.print}PDF</button>`}<button type="button" class="btn theme-btn" id="theme" title="Đổi giao diện sáng / tối" aria-label="Đổi giao diện sáng / tối">${ICON.moon}</button></div>
</header>

<div class="fbar" role="search" aria-label="Bộ lọc">
  <label class="field grow"><span class="overline">Tìm kiếm</span><input class="inp" id="flt-q" type="search" placeholder="Mã TC, mã bug, tiêu đề…  ( / )"></label>
  <label class="field"><span class="overline">Test suite</span><select class="sel" id="flt-suite"><option value="">Tất cả</option>${opts(suites)}</select></label>
  <label class="field"><span class="overline">Kết quả</span><select class="sel" id="flt-status"><option value="">Tất cả</option>${Object.entries(STATUS).map(([k, [name]]) => `<option value="${k}">${name}</option>`).join('')}</select></label>
  <label class="field"><span class="overline">Loại bug</span><select class="sel" id="flt-type"><option value="">Tất cả</option><option>Function</option><option>UI</option></select></label>
  <label class="field"><span class="overline">Priority</span><select class="sel" id="flt-priority"><option value="">Tất cả</option>${opts(RANK.slice().reverse())}</select></label>
  <label class="field"><span class="overline">Severity</span><select class="sel" id="flt-severity"><option value="">Tất cả</option><option>Critical</option><option>Major</option><option>Minor</option><option>Trivial</option></select></label>
  <div class="fbar-end"><span class="fcount" id="flt-count"></span><button type="button" class="btn btn-ghost btn-sm" id="flt-reset">Reset</button></div>
</div>

<main class="page">
  <section class="kpis" id="kpis" aria-label="Tổng quan"></section>

  <div class="grid2">
    <section class="card"><div class="card-head"><div><h3>Test Execution Results</h3><p class="hint" id="c-exec-sub"></p></div></div><div class="card-body" id="c-exec"></div></section>
    <section class="card"><div class="card-head"><div><h3>Defects by Priority</h3><p class="hint">Bấm để lọc danh sách bug</p></div></div><div class="card-body" id="c-prio"></div></section>
  </div>
  <div class="grid2">
    <section class="card"><div class="card-head"><div><h3>Bugs by Module</h3><p class="hint">Theo màn hình · Function / UI</p></div></div><div class="card-body" id="c-module"></div></section>
    <section class="card"><div class="card-head"><div><h3>Bugs by Severity</h3><p class="hint">Bấm để lọc danh sách bug</p></div></div><div class="card-body" id="c-sev"></div></section>
  </div>

  <section>
    <div class="sec-head"><h2>Test Run Result</h2><span class="hint" id="tc-n"></span><span class="sp"></span>
      <span class="sec-tools"><button type="button" class="btn btn-sm" id="tc-expand">Mở tất cả</button> <button type="button" class="btn btn-sm" id="tc-collapse">Thu gọn</button></span></div>
    <div class="card tc-card">
      <div class="table" id="tc-table">
        <div class="tc-head" aria-hidden="true"><span>Kết quả</span><span>Test case</span><span>Tên</span><span class="r">Bug</span><span class="r">Thời gian</span></div>
        ${rows}
      </div>
    </div>
  </section>

  ${reviewSection}

  ${notAppSection}

  <section class="buglist" id="bugs">
    <div class="sec-head"><h2>Bug Details</h2><span class="hint" id="bf-n"></span><span class="sp"></span>
      <span class="sec-tools" style="display:inline-flex;gap:8px;flex-wrap:wrap">${share ? '' : '<button type="button" class="btn btn-sm" id="pick-all">Chọn bug đang hiện</button>'}<button type="button" class="btn btn-sm" id="bug-expand">Mở tất cả</button><button type="button" class="btn btn-sm" id="bug-csv">${ICON.download}CSV</button></span></div>
    <p class="hint" style="margin:0 0 12px">Mỗi lỗi chỉ ghi 1 lần (lấy lần gặp đầu làm đại diện, dù xảy ra ở nhiều test / bộ data). Lỗi xuất hiện trên nhiều màn ghi ở Affected Area.${share ? '' : ' Chọn bug để log Asana ở đây.'}</p>
    <div class="bugcards">${bugs.map((b) => bugCard(b, share)).join('') || '<p class="empty">Không có bug.</p>'}</div>
  </section>
</main>
<div class="tip" id="tip"></div>
${share ? '' : `<div class="selbar" id="selbar"><span id="sel-n"></span><button type="button" id="sel-clear">Bỏ chọn</button><button type="button" class="asana" id="sel-log">Log lên Asana</button></div>
<div class="modal" id="asana-modal"><form>
  <h3>Log bug lên Asana</h3>
  <p class="hint">Mỗi bug = 1 <b>subtask</b> của task cha (Precondition / Steps / Actual / Expected / Attachment), Priority set vào custom field của project, kèm ảnh evidence.</p>
  <div id="f-token-box">
    <label>Asana Personal Access Token <small>— tạo ở <a href="https://app.asana.com/0/my-apps" target="_blank" rel="noopener">My apps → Personal access token</a></small></label>
    <input type="password" id="f-token" autocomplete="off">
    <div class="row2"><input type="checkbox" id="f-remember" checked><span>Nhớ token trên trình duyệt này (không lưu vào file report)</span></div>
  </div>
  <div id="f-token-saved" class="hint" style="display:none">Đang dùng token đã lưu · <button type="button" class="linkbtn" id="f-forget">Đổi / xoá token</button></div>
  <label>Task cha <small>— dán link task Asana hoặc ID</small></label>
  <input type="text" id="f-parent" placeholder="https://app.asana.com/0/…/…" required>
  <div id="f-bulk"><label>Bug sẽ log <small id="f-bulk-n"></small></label>
    <div class="row2" id="f-merge-row" style="margin:0 0 8px"><input type="checkbox" id="f-merge" checked><span>Gộp các bug <b>UI</b> cùng màn hình thành 1 subtask</span></div>
    <ul class="f-list" id="f-list"></ul></div>
  <div id="f-single">
  <label>Title</label>
  <input type="text" id="f-title">
  <label>Priority <small>— tự chọn theo mức ảnh hưởng, sửa được; set vào field Priority của project</small></label>
  <select id="f-priority">${opts(RANK.slice().reverse())}</select>
  <label>Nội dung sẽ log <small>— review và sửa trước khi tạo; chỉ đổi nội dung trên Asana, không đổi report</small></label>
  <div id="f-edit"></div>
  </div>
  <label>Assignee <small>— email, để trống nếu chưa giao</small></label>
  <input type="email" id="f-assignee" placeholder="ten@ikameglobal.com">
  <div class="row2"><input type="checkbox" id="f-attach" checked><span>Đính kèm ảnh evidence (đã khoanh đỏ)</span></div>
  <div class="status" id="f-status"></div>
  <div class="actions"><button type="button" id="f-cancel">Huỷ</button><button type="submit" class="go" id="f-submit">Tạo subtask</button></div>
</form></div>`}
<script>
${ui('page.js')}
${share ? '' : ui('asana.js')}
</script>
<script>
${ui('dashboard.js')}
</script>${share ? '' : '</body></html>'}`;
}

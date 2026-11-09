// Chạy thử luồng chung (skeleton.flows) trên thiết bị THẬT trong lúc chuyển đổi (tuỳ chọn, cần chọn thiết bị).
// AI lập luồng chỉ nhìn chữ (manual + locator map + sơ đồ màn) nên không biết hành vi động của app, vd chọn "None of above"
// là app TỰ sang màn sau → AI thêm "Tap Continue" thì bấm nhầm Continue của màn sau (nhảy 2 màn, mọi case dùng luồng đều lỗi).
// Ở đây: cài lại + mở app, chạy từng luồng theo chuỗi "A → B", và SỬA luồng (trong bộ nhớ, trước khi viết nhóm):
//   a) bấm thừa sau khi app tự chuyển màn → bỏ dòng Tap đó
//   b) không thấy target trên màn → khớp theo chữ (đúng / gần đúng), rồi nhờ AI chọn phần tử (resolveTarget, có chặn mua) → đổi target
//   c) không thấy dấu hiệu Nav nhưng thấy tên màn → giữ, ghi chú
// Mọi lần bấm qua lớp chặn mua (doAction + buyGuard, không bao giờ bấm nút mua / xác nhận mua). Check chỉ kiểm lỏng (có hiện không), không chặn.
// Mỗi lần chuyển màn thấy được (kể cả tự chuyển sau khi chọn) ghi vào sơ đồ màn của app (data/nav-graph.json, build hiện tại).
import crypto from 'node:crypto';
import { runClaude as defaultRunClaude } from '../../ai/claude.js';
import { resolveTarget, resolveBuyCheck } from '../../ai/resolve.js';
import { parseElements, screenSignature } from '../../locators/pageSource.js';
import { doAction, dismissAlert } from '../../locators/explore.js';
import { looksLikePaywall, closeOverlay } from '../../locators/overlay.js';
import { handleAlert } from '../../smoke/alerts.js';
import { isBuyTarget } from '../../smoke/guard.js';
import { recordNavEdge, NAV_BUY } from '../../apps/navGraph.js';
import { buildStamp } from '../../apps/buildStamp.js';
import { openSession as defaultOpenSession } from '../../device/session.js';
import { norm } from './appCheck.js';

export const FLOW_TIMING = { pollMs: 300, quietMs: 1000, settleMaxMs: 5000, navTimeoutMs: 10000, startTimeoutMs: 25000, checkTimeoutMs: 1500, maxMinutes: 15 };
const TAP = new Set(['Tap', 'Toggle']);
const PASSIVE = /^(verify|run check|run setup|save value|generate data|wait until not displayed)/i;
const TAG = '[Chạy thử]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nameOf = (e) => String(e?.name || e?.label || '').replace(/\s+/g, ' ').trim();
const short = (e) => String(e?.message || e).split('\n')[0].slice(0, 200);

// "A → B" → { from: 'A', to: 'B' }; không đúng dạng → màn của dòng đầu / màn của Nav cuối
export function flowEnds(name, rows = []) {
  const parts = String(name).split(/\s*(?:→|->)\s*/).map((s) => s.trim()).filter(Boolean);
  const navs = rows.filter((r) => r.kind === 'Nav');
  return {
    from: parts.length >= 2 ? parts[0] : String(rows[0]?.screen || '').trim(),
    to: parts.length >= 2 ? parts.at(-1) : String(navs.at(-1)?.screen || rows.at(-1)?.screen || '').trim(),
  };
}

// Thứ tự chạy: đi theo chuỗi A → B, B → C… từ các luồng gốc (màn đầu không là màn cuối của luồng nào), nhánh rẽ chạy sau
export function chainOrder(flows) {
  const list = Object.entries(flows || {}).filter(([, rows]) => Array.isArray(rows)).map(([name, rows]) => ({ name, ...flowEnds(name, rows) }));
  const roots = list.filter((f) => !list.some((g) => g !== f && norm(g.to) === norm(f.from)));
  const seen = new Set();
  const out = [];
  const visit = (f) => {
    if (seen.has(f.name)) return;
    seen.add(f.name);
    out.push(f);
    for (const g of list) if (norm(g.from) === norm(f.to)) visit(g);
  };
  roots.forEach(visit);
  list.forEach(visit); // vòng lặp / luồng lẻ
  return out;
}

// Phần tử khớp chữ: đúng (sau chuẩn hoá) → gần đúng (chứa nhau, ≥ 4 ký tự; ưu tiên nút)
function byText(elements, text, { loose = true } = {}) {
  const n = norm(text);
  if (!n) return null;
  const texts = (e) => [e.name, e.label].map(norm).filter(Boolean);
  const exact = elements.find((e) => texts(e).includes(n));
  if (exact || !loose) return exact ? { el: exact, how: 'exact' } : null;
  if (n.length < 4) return null;
  const cands = elements.filter((e) => texts(e).some((t) => t.length >= 4 && (t.includes(n) || n.includes(t))));
  const el = cands.find((e) => ['Button', 'Cell', 'Link', 'Switch', 'CheckBox', 'RadioButton'].includes(e.type)) || cands[0];
  return el ? { el, how: 'loose' } : null;
}

// skeleton: { order, groups, flows } · driver: phiên Appium (đã cài lại + mở app) · restart(): mở phiên mới, cài lại app → driver
// record(edge): ghi cạnh sơ đồ màn · → { skeleton, review, edges, aborted }
export async function dryRunFlows({ skeleton, driver: first, restart, app = {}, locatorTable = {}, runClaude = defaultRunClaude, signal, onProgress = () => {}, record = () => false, timing = {} }) {
  const T = { ...FLOW_TIMING, ...timing };
  const deadline = Date.now() + T.maxMinutes * 60000;
  let driver = first;
  const flows = { ...(skeleton.flows || {}) };
  const review = [];
  const note = (l) => { const s = `${TAG} ${l}`; if (!review.includes(s)) review.push(s); };
  const edges = [];
  const seen = new Set(); // màn đã nhận ra chắc chắn trong lần chạy này (dấu hiệu của nó dùng được)
  const okFlows = new Set();
  const allRows = () => Object.values(flows).flat();
  let win = null;

  // Dấu hiệu nhận màn S: dòng Nav của S trong luồng đang chạy (cuối cùng) → Nav của S ở luồng khác → Check tiêu đề ngay sau Nav → tên màn
  const markersOf = (S, rows = []) => {
    const navOf = (rs) => rs.filter((r) => r?.kind === 'Nav' && norm(r.screen) === norm(S)).map((r) => r.target).filter(Boolean);
    const titles = [];
    for (const rs of Object.values(flows)) {
      rs.forEach((r, i) => { if (r?.kind === 'Nav' && norm(r.screen) === norm(S)) { const c = rs[i + 1]; if (c?.kind === 'Check' && norm(c.screen) === norm(S) && /^verify (text|displayed)$/i.test(c.keyword || '')) titles.push(c.value || c.target); } });
    }
    return [...new Set([...navOf(rows).reverse(), ...navOf(allRows()), ...titles, ...mapTexts(S), S].map((x) => String(x || '').trim()).filter(Boolean))];
  };
  // Chữ tĩnh của màn S trong locator map mà màn khác không có (tiêu đề…) — nhận màn đầu luồng (thường không có dòng Nav nào)
  const mapKey = (S) => Object.keys(locatorTable || {}).find((n) => norm(n) === norm(S));
  const mapTexts = (S) => {
    const k = mapKey(S);
    if (!k) return [];
    const others = new Set(Object.entries(locatorTable).filter(([n]) => n !== k).flatMap(([, rs]) => (rs || []).map((r) => norm(r.key))));
    return (locatorTable[k] || []).filter((r) => r.type === 'StaticText' && r.key && !/\d|@/.test(r.key) && String(r.key).length <= 80 && !others.has(norm(r.key))).slice(0, 5).map((r) => r.key);
  };
  const at = (S, els, rows) => { for (const m of markersOf(S, rows)) { const hit = byText(els, m, { loose: m.length >= 8 }); if (hit) return { el: hit.el, marker: m }; } return null; };
  // Màn bắt đầu của luồng: dấu hiệu như trên, không có thì target của thao tác đầu tiên trên màn đó có trên màn (yếu: không coi là "đã thấy")
  //   Chỉ dùng cho luồng gốc (không luồng nào dẫn tới màn S), và khi màn đang hiện không phải một màn đã biết khác ("Continue" có ở nhiều màn)
  const atStart = (S, els, rows, weakOk = false) => {
    const hit = at(S, els, rows);
    if (hit) return { ...hit, strong: true };
    if (!weakOk || knownScreens().some((x) => norm(x) !== norm(S) && at(x, els, rows))) return null;
    const first = (rows || []).find((r) => norm(r.screen) === norm(S) && (TAP.has(r.keyword) || r.keyword === 'Enter') && r.target);
    const weak = first ? byText(els, first.target, { loose: false }) : null;
    return weak ? { el: weak.el, marker: first.target, strong: false } : null;
  };
  const knownScreens = () => [...new Set(allRows().map((r) => String(r?.screen || '').trim()).filter(Boolean))];

  const read = async () => parseElements(await driver.getPageSource());
  // Chờ màn đứng yên (chữ ký không đổi trong quietMs) → phần tử
  const settle = async () => {
    const end = Date.now() + T.settleMaxMs;
    let els = await read();
    let sig = screenSignature(els);
    let since = Date.now();
    while (Date.now() < end) {
      await sleep(T.pollMs);
      const next = await read();
      const s2 = screenSignature(next);
      els = next;
      if (s2 !== sig) { sig = s2; since = Date.now(); } else if (Date.now() - since >= T.quietMs) break;
    }
    return els;
  };
  // Popup hệ thống / paywall che: đóng như AI khám phá (không mua). → true nếu đã đóng được gì
  const clearOverlay = async (els) => {
    const a = await dismissAlert(driver, app.platform).catch(() => null);
    if (a) return true;
    if (looksLikePaywall(els)) {
      win = win || await driver.getWindowSize?.().catch(() => null);
      const how = await closeOverlay(driver, els, { app, win }).catch(() => null);
      if (how) return true;
    }
    return false;
  };
  // Chờ tới khi thấy màn S (tối đa ms), đóng popup / paywall chen giữa → { els, hit } hoặc null
  const waitAt = async (S, rows, ms, weakOk = false) => {
    const end = Date.now() + ms;
    let tries = 0;
    for (;;) {
      const els = await read();
      const hit = atStart(S, els, rows, weakOk);
      if (hit) return { els, hit };
      if (tries++ % 3 === 1 && await clearOverlay(els)) continue;
      if (Date.now() >= end) return null;
      await sleep(T.pollMs);
    }
  };
  const waitText = async (text, ms) => {
    const end = Date.now() + ms;
    for (;;) {
      const els = await read();
      const hit = byText(els, text);
      if (hit) return { els, hit };
      if (Date.now() >= end) return null;
      await sleep(T.pollMs);
    }
  };

  // Tìm phần tử cho target ở màn S: locator map → chữ đúng / gần đúng → AI chọn (có chặn mua). → { el, newTarget?, why? } | null
  const findTarget = async (els, row, kind) => {
    const target = String(row.target || '').trim();
    const mapRow = (locatorTable?.[row.screen] || []).find((r) => norm(r.key) === norm(target));
    if (mapRow) { const el = els.find((e) => e.locator === mapRow.locator || e.alts?.includes(mapRow.locator)); if (el) return { el }; }
    const hit = byText(els, target);
    if (hit?.how === 'exact') return { el: hit.el };
    if (hit && nameOf(hit.el)) return { el: hit.el, newTarget: nameOf(hit.el), why: `khớp gần đúng theo chữ trên màn "${row.screen}"` };
    const r = await resolveTarget({ target, screen: row.screen, kind, platform: app.platform, elements: els }, { runClaude }).catch(() => null);
    if (!r?.locator) return null;
    const buy = resolveBuyCheck(r.locator, els, target);
    if (!buy.ok) return null;
    const el = els.find((e) => e.locator === r.locator);
    if (!el || !nameOf(el)) return null;
    return { el, newTarget: nameOf(el), why: `AI chọn phần tử trên màn "${row.screen}"${r.reason ? `: ${r.reason}` : ''}` };
  };

  // Bấm qua lớp chặn mua: nút trông như mua → không bấm; tờ thanh toán / app khác → doAction(guard) chỉ cho đóng / huỷ
  const tapEl = async (el, els) => {
    const n = nameOf(el);
    if (isBuyTarget(el) || NAV_BUY.test(n)) return { ok: false, blocked: `không bấm "${n}" (trông như nút mua / thanh toán)` };
    let last = '';
    const ok = await doAction(driver, { action: 'tap', locator: el.locator }, (t) => { last = t; }, '', { app, elements: els });
    if (!ok && /^Chặn/.test(last)) return { ok: false, blocked: last.replace(/^Chặn:\s*/, '') };
    return { ok, error: ok ? null : last };
  };

  // Sau một lần bấm ở màn S: màn đổi sang màn T đã biết → ghi cạnh S --target--> T
  const afterTap = async (S, el, target, rows, laterScreens, typed = false) => {
    const els = await settle();
    if (!seen.has(S) || at(S, els, rows)) return { els, moved: null };
    const order = [...laterScreens, ...knownScreens()].filter((x, i, a) => norm(x) !== norm(S) && a.findIndex((y) => norm(y) === norm(x)) === i);
    for (const T2 of order) {
      const hit = at(T2, els, rows);
      if (!hit) continue;
      seen.add(T2);
      const edge = { from: S, to: T2, sel: el.locator, target, arrive: { sel: hit.el.locator, what: `tiêu đề "${nameOf(hit.el)}"` }, needsInput: typed };
      if (!NAV_BUY.test(`${target} ${el.locator}`) && !edges.some((e) => e.from === S && e.to === T2 && e.target === target)) { edges.push(edge); record(edge); }
      return { els, moved: T2 };
    }
    return { els, moved: null };
  };

  // Chạy một luồng → { ok, rows (đã sửa) }. walk: chỉ đi qua để tới màn bắt đầu của luồng khác (không sửa thêm)
  async function runFlow(f, { walk = false } = {}) {
    const rows = flows[f.name].map((r) => ({ ...r }));
    const out = [];
    const missed = [];
    let lastTap = null;
    let typedOn = null; // màn vừa nhập chữ: bấm đi tiếp từ màn đó thì cạnh cần dữ liệu nhập (needsInput)
    let changed = false;
    const fail = (msg) => { if (!walk) note(`Luồng "${f.name}": ${msg}`); return { ok: false, rows: [...out, ...rows.slice(out.length + removed)], changed }; };
    let removed = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (signal?.aborted) return { ok: false, aborted: true, rows: [...out, ...rows.slice(i)], changed };
      if (Date.now() > deadline) { note(`Hết thời gian chạy thử (${T.maxMinutes} phút) — các luồng còn lại chưa chạy thử`); return { ok: false, timeout: true, rows: [...out, ...rows.slice(i)], changed }; }
      const S = String(row.screen || '').trim();
      const kw = String(row.keyword || '').trim();
      const later = [...new Set(rows.slice(i + 1).map((r) => String(r.screen || '').trim()).filter((x) => x && norm(x) !== norm(S))), f.to];
      if (row.kind === 'Nav') {
        const marker = String(row.target || S).trim();
        const got = await waitText(marker, T.navTimeoutMs);
        if (got) {
          seen.add(S);
          if (lastTap && !lastTap.recorded && norm(lastTap.screen) !== norm(S)) {
            lastTap.recorded = true;
            const edge = { from: lastTap.screen, to: S, sel: lastTap.el.locator, target: lastTap.target, arrive: { sel: got.hit.el.locator, what: `tiêu đề "${nameOf(got.hit.el)}"` }, needsInput: !!lastTap.typed };
            if (!edges.some((e) => e.from === edge.from && e.to === edge.to && e.target === edge.target)) { edges.push(edge); record(edge); }
          }
          out.push(row); continue;
        }
        const els = await read();
        const by = at(S, els, rows);
        if (by) {
          seen.add(S);
          if (!walk) note(`Luồng "${f.name}": giữ bước ${row.step} Nav "${marker}" (không thấy chữ này nhưng thấy màn "${S}" qua "${by.marker}" — nên kiểm lại dấu hiệu nhận màn)`);
          out.push(row); continue;
        }
        return fail(`không tới được màn "${S}" ở bước ${row.step} (không thấy "${marker}" sau ${Math.round(T.navTimeoutMs / 1000)}s) — các bước sau chưa chạy thử`);
      }
      if (row.kind === 'Check' || PASSIVE.test(kw)) {
        if (/^wait until displayed$/i.test(kw) && row.target) { if (!(await waitText(row.target, T.navTimeoutMs))) missed.push(row.target); out.push(row); continue; }
        const want = [row.value, row.target].map((x) => String(x || '').trim()).filter((x) => x && !/\{\{|\$\{/.test(x));
        if (row.kind === 'Check' && want.length && !/not/i.test(kw)) {
          const els = await read();
          if (!want.some((w) => byText(els, w))) {
            const again = await waitText(want[0], T.checkTimeoutMs);
            if (!again) missed.push(want[0]);
          }
        }
        out.push(row); continue;
      }
      if (/^wait$/i.test(kw)) { await sleep(Math.min(5, Number(row.value) || 1) * 1000 * (T.pollMs / FLOW_TIMING.pollMs)); out.push(row); continue; }
      if (kw === 'Handle permission') {
        const deny = /don.?t|deny|không|từ chối|not now/i.test(String(row.value || ''));
        await (deny ? dismissAlert(driver, app.platform) : handleAlert(driver, app.platform)).catch(() => null);
        out.push(row); continue;
      }
      if (TAP.has(kw) || kw === 'Enter') {
        const target = String(row.target || '').trim();
        if (!target || target.startsWith('point:') || /\{\{|\$\{/.test(target)) { out.push(row); if (!walk) note(`Luồng "${f.name}": bước ${row.step} ${kw} "${target}" chưa chạy thử được (target theo toạ độ / biến)`); return { ok: false, rows: [...out, ...rows.slice(i + 1)], changed }; }
        let els = await settle();
        if (!seen.has(S) && at(S, els, rows)) seen.add(S);
        // a) App đã tự sang màn sau: màn S (đã thấy trước đó) không còn, màn sau của luồng đang hiện → dòng bấm này là bấm thừa
        if (TAP.has(kw) && seen.has(S) && !at(S, els, rows)) {
          const next = later.find((x) => at(x, els, rows));
          if (next) {
            if (!walk) note(`Luồng "${f.name}": bỏ bước ${row.step} "${kw} ${target}" (app tự chuyển sang màn "${next}" sau bước trước — bấm thêm sẽ bấm nhầm trên màn "${next}")`);
            changed = true; removed++; continue;
          }
        }
        let found = await findTarget(els, row, kw === 'Enter' ? 'enter' : 'tap');
        if (!found && await clearOverlay(els)) { els = await settle(); found = await findTarget(els, row, kw === 'Enter' ? 'enter' : 'tap'); }
        if (!found) return fail(`không thấy "${target}" trên màn "${S}" ở bước ${row.step} (khớp chữ và AI đều không tìm được) — kiểm lại target, các bước sau chưa chạy thử`);
        let use = row;
        if (found.newTarget && norm(found.newTarget) !== norm(target)) {
          if (TAP.has(kw) && (isBuyTarget(found.el) || NAV_BUY.test(found.newTarget))) return fail(`bước ${row.step}: "${target}" chỉ khớp được nút mua "${found.newTarget}" — không bấm, không đổi`);
          use = { ...row, target: found.newTarget };
          changed = true;
          if (!walk) note(`Luồng "${f.name}": đổi target bước ${row.step} "${target}" → "${found.newTarget}" (${found.why})`);
        }
        if (kw === 'Enter') {
          const val = String(row.value ?? '');
          if (/\{\{|\$\{/.test(val)) { out.push(use); if (!walk) note(`Luồng "${f.name}": bước ${row.step} Enter dùng biến — chưa chạy thử được các bước sau`); return { ok: false, rows: [...out, ...rows.slice(i + 1)], changed }; }
          const ok = await doAction(driver, { action: 'type', locator: found.el.locator, text: val }, () => {}, '', { app, elements: els });
          if (!ok) return fail(`không nhập được vào "${use.target}" ở bước ${row.step}`);
          out.push(use);
          typedOn = S;
          continue;
        }
        const t = await tapEl(found.el, els);
        if (t.blocked) { out.push(use); return fail(`chặn bước ${row.step} "${kw} ${use.target}": ${t.blocked} — không chạy tiếp luồng này`); }
        if (!t.ok) return fail(`không bấm được "${use.target}" ở bước ${row.step}`);
        out.push(use);
        lastTap = { screen: S, el: found.el, target: use.target, recorded: false, typed: norm(typedOn || '') === norm(S) };
        const after = await afterTap(S, found.el, use.target, rows, later, lastTap.typed);
        if (after.moved) lastTap.recorded = norm(after.moved) !== norm(S);
        continue;
      }
      if (/^back$/i.test(kw)) {
        const els = await read();
        const b = els.find((e) => e.type === 'Button' && /^(back|close|←)$/i.test(nameOf(e)));
        if (b) await doAction(driver, { action: 'tap', locator: b.locator }, () => {}, '', { app, elements: els }); else await driver.back?.().catch(() => {});
        out.push(row); continue;
      }
      // Keyword chưa chạy thử được (Scroll to, Select picker, Long press…): giữ nguyên, phần sau của luồng chưa kiểm được
      out.push(row);
      if (!walk) note(`Luồng "${f.name}": bước ${row.step} "${kw}" chưa chạy thử được — các bước sau giữ nguyên, chưa kiểm`);
      return { ok: false, rows: [...out, ...rows.slice(i + 1)], changed };
    }
    if (missed.length && !walk) note(`Luồng "${f.name}": chưa thấy ${[...new Set(missed)].map((m) => `"${m}"`).join(', ')} khi chạy thử (chỉ kiểm lỏng, không sửa)`);
    return { ok: true, rows: out, changed };
  }

  const renumber = (orig, rows) => (orig.every((r, i) => Number(r.step) === i + 1) ? rows.map((r, i) => ({ ...r, step: i + 1 })) : rows);
  const order = chainOrder(flows);
  const predOf = (f) => order.find((g) => g !== f && norm(g.to) === norm(f.from) && okFlows.has(g.name)) || order.find((g) => g !== f && norm(g.to) === norm(f.from));
  const chainTo = (f) => {
    const ch = [];
    for (let p = predOf(f); p && !ch.includes(p) && p !== f && ch.length < 15; p = predOf(p)) ch.unshift(p);
    return ch;
  };
  let aborted = false;
  let restarts = 0;
  const fresh = async () => {
    restarts++;
    driver = await restart();
  };
  for (const [i, f] of order.entries()) {
    if (signal?.aborted) { aborted = true; break; }
    if (Date.now() > deadline) { note(`Hết thời gian chạy thử (${T.maxMinutes} phút) — các luồng còn lại chưa chạy thử`); break; }
    onProgress({ done: i, total: order.length, label: `Chạy thử luồng chung trên thiết bị: ${f.name} (${i + 1}/${order.length})` });
    try {
      const root = !predOf(f);
      let start = await waitAt(f.from, flows[f.name], i === 0 ? T.startTimeoutMs : T.checkTimeoutMs, root);
      if (!start) {
        // Không đứng ở màn bắt đầu: cài lại app, rồi đi theo chuỗi luồng đã có tới màn đó
        await fresh();
        start = await waitAt(f.from, flows[f.name], T.startTimeoutMs, root);
        if (!start) {
          const ch = chainTo(f);
          let walked = ch.length > 0;
          for (const g of ch) {
            const st = await waitAt(g.from, flows[g.name], T.startTimeoutMs, !predOf(g));
            if (!st) { walked = false; break; }
            if (st.hit.strong) seen.add(g.from);
            const r = await runFlow(g, { walk: true });
            if (r.aborted) { aborted = true; break; }
            if (!r.ok) { walked = false; break; }
          }
          if (aborted) break;
          start = walked ? await waitAt(f.from, flows[f.name], T.navTimeoutMs) : null;
          if (!start) {
            note(`Luồng "${f.name}": bỏ qua — không thấy màn bắt đầu "${f.from}" sau khi mở app${ch.length ? ` và đi theo ${ch.map((g) => `"${g.name}"`).join(' → ')}` : ''}`);
            continue;
          }
        }
      }
      if (start.hit.strong) seen.add(f.from);
      const r = await runFlow(f);
      if (r.changed) flows[f.name] = renumber(flows[f.name], r.rows);
      if (r.ok) okFlows.add(f.name);
      if (r.aborted) { aborted = true; break; }
      if (r.timeout) break;
    } catch (e) {
      note(`Luồng "${f.name}": lỗi khi chạy thử (${short(e)}) — giữ nguyên các bước còn lại`);
      if (/session|ECONNREFUSED|socket hang up|terminated/i.test(short(e))) {
        try { await fresh(); } catch (e2) { note(`Dừng chạy thử: không mở lại được phiên trên thiết bị (${short(e2)})`); break; }
      }
    }
  }
  const ran = okFlows.size;
  if (!aborted) note(`Đã chạy thử ${ran}/${order.length} luồng chung trên thiết bị${restarts ? ` (cài lại app ${restarts} lần)` : ''}${edges.length ? `, ghi ${edges.length} đường chuyển màn vào sơ đồ màn` : ''}`);
  return { skeleton: { ...skeleton, flows }, review, edges, aborted, okFlows: [...okFlows] };
}

// Khoá thiết bị + phiên Appium (cổng 4724, như lấy locator / smoke) quanh dryRunFlows. Thiết bị bận / không mở được phiên
// → bỏ qua (ghi chú), chuyển đổi chạy tiếp như cũ. → { skeleton, review, edges, ran }
export function createFlowCheck({ lock, emit = () => {}, openSession = defaultOpenSession, runClaude = defaultRunClaude, buildStampOf = buildStamp, timing = {} } = {}) {
  return async function flowCheck({ app, udid, skeleton, locatorTable = {}, signal, onProgress = () => {} }) {
    const skip = (why) => ({ skeleton, review: [`${TAG} Bỏ qua chạy thử luồng chung: ${why} — chuyển đổi tiếp như bình thường`], edges: [], ran: false });
    if (!Object.keys(skeleton?.flows || {}).length) return { skeleton, review: [], edges: [], ran: false };
    if (!lock) return skip('server chưa nối khoá thiết bị');
    const id = `flowchk-${crypto.randomUUID().slice(0, 8)}`;
    const got = lock.acquire({ kind: 'flowcheck', id, label: `Chạy thử luồng chung · ${app.name || app.id}` });
    if (!got.ok) return skip(`thiết bị đang bận (${got.holder?.label || 'job khác'})`);
    emit('lock', lock.current());
    let session = null;
    try {
      await lock.ready?.();
      onProgress({ done: 0, total: 1, label: 'Chạy thử luồng chung trên thiết bị: đang cài lại và mở app…' });
      try { session = await openSession({ app, udid }); } catch (e) { return skip(`không mở được phiên trên thiết bị (${short(e)})`); }
      const build = buildStampOf(app.appPath)?.stamp || '';
      const restart = async () => {
        await session?.close?.().catch(() => {});
        session = null;
        session = await openSession({ app, udid });
        return session.driver;
      };
      const r = await dryRunFlows({ skeleton, driver: session.driver, restart, app, locatorTable, runClaude, signal, onProgress, timing, record: (e) => recordNavEdge(app.workspace, build, e) });
      const out = r.aborted ? r.skeleton : { ...r.skeleton, flowsChecked: { at: new Date().toISOString(), build, udid } };
      return { skeleton: out, review: r.review, edges: r.edges, ran: !r.aborted };
    } catch (e) {
      return skip(`lỗi khi chạy thử (${short(e)})`);
    } finally {
      await session?.close?.().catch(() => {});
      lock.release(id);
      emit('lock', lock.current());
    }
  };
}

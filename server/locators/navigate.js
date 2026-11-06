// Đi tới một màn đã có trong locator map: dùng đường đã ghi (edges: bấm gì ở màn nào thì sang màn nào), thiếu thì hỏi AI từng bước.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toPrompt } from './pageSource.js';
import { looksLikePaywall, closeOverlay } from './overlay.js';

const PROMPT = fs.readFileSync(fileURLToPath(new URL('../ai/prompts/goto-step.md', import.meta.url)), 'utf8');
const SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['tap', 'type', 'back', 'relaunch', 'arrived', 'giveup'] },
    locator: { type: 'string' }, text: { type: 'string' }, screenName: { type: 'string' }, reason: { type: 'string' },
  },
  required: ['action', 'screenName', 'reason'],
};
const fill = (tpl, v) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(v[k] ?? ''));

// Cạnh đầu tiên trên đường ngắn nhất from → to (BFS), bỏ cạnh đã thử hỏng
export function nextEdge(edges, from, to, bad = new Set()) {
  const out = new Map();
  for (const e of edges) if (!bad.has(e.id)) (out.get(e.from) || out.set(e.from, []).get(e.from)).push(e);
  const seen = new Set([from]);
  const queue = (out.get(from) || []).map((e) => ({ e, first: e }));
  while (queue.length) {
    const { e, first } = queue.shift();
    if (e.to === to) return first;
    if (seen.has(e.to)) continue;
    seen.add(e.to);
    for (const n of out.get(e.to) || []) queue.push({ e: n, first });
  }
  return null;
}

// Bỏ chữ có số / ngày tháng: là dữ liệu của thiết kế, app có thể đang ở trạng thái khác (không có dữ liệu) → AI không được đuổi theo
const hintsOf = (s) => s.elements.filter((e) => e.name && !/\d/.test(e.name) && (e.type === 'StaticText' || e.type === 'Button')).slice(0, 12).map((e) => `${e.type} "${e.name}"`).join(', ') || '(không có)';

// ctx: { target, edges:{list,add}, driver, app, snap, log, settle, doAction, dismissAlert, relaunch, runClaude, model, hints, screens, shouldStop }
// → true nếu tới được màn đích
export async function navigateTo(ctx) {
  const { target, edges, driver, app, snap, log, settle, doAction, dismissAlert, relaunch, runClaude, model, maxSteps = 25 } = ctx;
  const isTarget = ctx.isTarget || ((s) => s.id === target.id);
  const bad = new Set();
  const tried = [];
  const closeTried = new Map();
  const visits = new Map();
  let pending = null; // thao tác vừa làm: { from, action }
  let blank = 0;
  let checkAlert = true;
  let relaunched = 0;
  let aiFails = 0;
  log(`Đi tới màn "${target.name}" trước khi khám phá…`);
  for (let step = 1; step <= maxSteps && !ctx.shouldStop?.(); step++) {
    if (checkAlert) { const c = await dismissAlert(driver, app?.platform); if (c) log(`Đóng popup hệ thống: ${c}`); }
    const { screen, elements } = await snap(driver, { seenBy: ctx.seenBy || 'explore' });
    if (!screen) {
      if (++blank > 10) throw new Error('Màn hình trống quá lâu — app có thể bị treo');
      step--; await driver.pause(1500); continue;
    }
    blank = 0;
    if (pending && pending.from !== screen.id && pending.action.action === 'tap') edges.add(pending.from, screen.id, pending.action);
    if (isTarget(screen, elements)) { log(`Đã tới "${target.name}".`); return true; }
    const n = (visits.get(screen.id) || 0) + 1;
    visits.set(screen.id, n);
    checkAlert = pending?.from === screen.id;
    pending = null;
    if (n > 3) {
      if (relaunched++ >= 2) break;
      log('Đi quanh một màn quá lâu → mở lại app');
      visits.clear(); bad.clear(); await relaunch(driver, app); await driver.pause(1500); continue;
    }
    const has = (loc) => elements.some((e) => e.locator === loc || e.alts.includes(loc));
    // Paywall / quảng cáo chắn đường (màn đích không phải paywall) → đóng
    if (looksLikePaywall(elements) && !looksLikePaywall(target.elements)) {
      const set = closeTried.get(screen.id) || new Set();
      closeTried.set(screen.id, set);
      const how = await closeOverlay(driver, elements, { app, win: ctx.win, tried: set });
      if (how) { log(`Paywall chắn đường — đã đóng: ${how}`); await settle(driver, snap, { android: app?.platform === 'Android' }); continue; }
    }
    // 1. Đường đã ghi
    const e = nextEdge(edges.list(), screen.id, target.id, bad);
    if (e && has(e.locator)) {
      const a = { action: e.action, locator: e.locator, text: e.text, reason: 'theo đường đã ghi' };
      tried.push(`${a.action} ${a.locator}`);
      if (await doAction(driver, a, log, '(đường đã ghi) ')) pending = { from: screen.id, action: a };
      else { bad.add(e.id); checkAlert = true; }
      await settle(driver, snap, { android: app?.platform === 'Android' });
      continue;
    }
    // 2. Hỏi AI
    const prompt = fill(PROMPT, {
      appName: app?.name || app?.id, platform: app?.platform || 'iOS', device: app?.platform === 'Android' ? 'thiết bị Android' : 'Simulator',
      targetName: target.title ? `${target.name} (tiêu đề màn: "${target.title}")` : target.name, targetHints: hintsOf(target), elements: toPrompt(elements), step, maxSteps,
      knownScreens: ctx.screens().map((s) => s.name).join(', '), tried: tried.slice(-8).join('; ') || 'chưa có',
      hints: Object.entries(ctx.hints || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ') || 'không có',
    });
    const r = await runClaude({ prompt, schema: SCHEMA, timeoutMs: 120000, noTools: true, model });
    if (!r.ok) {
      log(`AI lỗi: ${r.error}`);
      if (++aiFails >= 3) throw new Error(`AI lỗi 3 lần liên tiếp: ${r.error}`);
      continue;
    }
    aiFails = 0;
    const a = r.data;
    // AI thấy đang ở đúng màn đích (tiêu đề có thể là nút dropdown, dữ liệu khác thiết kế) → tin; bước so ảnh sau đó vẫn kiểm sameScreen
    if (a.action === 'arrived') { log(`AI xác nhận đã tới "${target.name}": ${a.reason}`); return true; }
    if (a.action === 'giveup') { log(`AI bỏ cuộc: ${a.reason}`); break; }
    if (a.action === 'tap' || a.action === 'type') {
      if (!has(a.locator)) { log(`Bỏ qua: AI chọn locator không có trên màn (${a.locator})`); continue; }
      tried.push(`${a.action} ${a.locator}`);
      if (await doAction(driver, a, log)) pending = { from: screen.id, action: { action: a.action, locator: a.locator, text: a.text } };
      else checkAlert = true;
    } else if (a.action === 'back') {
      const back = elements.find((x) => x.type === 'Button' && /^(Back|Close)$/i.test(x.name));
      if (back) await (await driver.$(back.locator)).click().catch(() => {}); else await driver.back?.().catch(() => {});
      log(`Quay lại — ${a.reason}`);
    } else if (a.action === 'relaunch') {
      if (relaunched++ >= 2) break;
      log(`Mở lại app — ${a.reason}`);
      visits.clear(); await relaunch(driver, app);
    }
    await settle(driver, snap, { android: app?.platform === 'Android' });
  }
  return false;
}

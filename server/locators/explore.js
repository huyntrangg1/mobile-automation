// Chế độ "Tự khám phá": mỗi bước đọc màn → hỏi AI thao tác tiếp → thực hiện. Locator AI chọn phải có trên màn.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runClaude as defaultRunClaude } from '../ai/claude.js';
import { parseElements, screenSignature, toPrompt } from './pageSource.js';
import { systemDialog } from '../device/platforms.js';
import { navigateTo } from './navigate.js';
import os from 'node:os';
import path from 'node:path';
import { looksLikePaywall, closeOverlay, tapAway, foreignForeground, isCloseName, BUY } from './overlay.js';
import { swipe, tapPoint } from '../ui/device.js';
import { isBuyTarget, elementAtPoint } from '../smoke/guard.js';

const PROMPT = fs.readFileSync(fileURLToPath(new URL('../ai/prompts/explore-step.md', import.meta.url)), 'utf8');
const PAYWALL_PROMPT = fs.readFileSync(fileURLToPath(new URL('../ai/prompts/explore-paywall.md', import.meta.url)), 'utf8');
const PAYWALL_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['tapPoint', 'tap', 'swipe', 'wait', 'back', 'relaunch', 'giveUp'] },
    x: { type: 'number' }, y: { type: 'number' }, locator: { type: 'string' }, text: { type: 'string' }, reason: { type: 'string' },
  },
  required: ['action', 'reason'],
};
const clampPct = (n) => Math.min(100, Math.max(0, Number(n) || 0));
const SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['tap', 'type', 'back', 'relaunch', 'done'] },
    locator: { type: 'string' },
    text: { type: 'string' },
    screenName: { type: 'string' },
    reason: { type: 'string' },
    // Thao tác khác đáng thử trên màn này (ưu tiên giảm dần) — quay lại màn thì dùng tiếp, khỏi hỏi AI lại
    next: { type: 'array', items: { type: 'object', properties: { action: { type: 'string', enum: ['tap', 'type'] }, locator: { type: 'string' }, text: { type: 'string' }, reason: { type: 'string' } }, required: ['action', 'locator'] } },
  },
  required: ['action', 'screenName', 'reason'],
};
// Khám phá chỉ cần chọn nút để bấm → model nhanh. Đo với prompt 1 bước: Sonnet ~5,1s ($0,006–0,015), Haiku ~7,3s ($0,001),
// Opus mặc định ~9s. Đổi bằng QAPD_EXPLORE_MODEL
const EXPLORE_MODEL = process.env.QAPD_EXPLORE_MODEL || 'claude-sonnet-5-5';
const fill = (tpl, v) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(v[k] ?? ''));

// Popup hệ thống (theo dõi, thông báo, vị trí…) → chọn từ chối như ik-fitness/src/utils/app.js
export async function dismissAlert(driver, platform) {
  if (platform === 'Android') {
    // Hộp xin quyền Android nằm trong page source → bấm nút từ chối
    try {
      const dlg = systemDialog(await driver.getPageSource());
      if (!dlg?.deny) return null;
      await (await driver.$(dlg.deny)).click();
      return dlg.buttons.find((b) => /don.?t allow|deny|từ chối|not now/i.test(b)) || 'từ chối';
    } catch {
      return null;
    }
  }
  try {
    const buttons = await driver.execute('mobile: alert', { action: 'getButtons' });
    if (!Array.isArray(buttons) || !buttons.length) return null;
    // Hộp xác nhận mua / tờ thanh toán: KHÔNG BAO GIỜ bấm nút mua — chọn Cancel, không có thì dismiss
    const safe = buttons.filter((b) => !BUY.test(b));
    const pick = safe.find((b) => /not to track|don.t allow|không cho phép|từ chối|not now|cancel|hủy|huỷ/i.test(b)) || safe[0];
    if (!pick) { await driver.execute('mobile: alert', { action: 'dismiss' }); return 'Đóng hộp thoại mua (không xác nhận)'; }
    await driver.execute('mobile: alert', { action: 'accept', buttonLabel: pick });
    return pick;
  } catch {
    return null;
  }
}

// Sau mỗi thao tác: theo dõi nhanh tới khi màn đứng yên (quiet ms) hoặc hết maxMs, ghi mọi màn trung gian đứng yên ≥ 1 vòng
// (vd "Importing…" chỉ hiện 1–2 giây — AI nghĩ ~8s mỗi bước nên chụp đầu bước sau là lỡ). iOS đọc nhanh bỏ visible (~180ms)
// Bấm / nhập theo locator; false nếu không làm được (vd phần tử biến mất, popup che)
export async function doAction(driver, a, log, prefix = '') {
  try {
    const el = await driver.$(a.locator);
    if (a.action === 'tap') await el.click();
    else await el.setValue(a.text || '');
    log(`${prefix}${a.action === 'tap' ? 'Bấm' : `Nhập "${a.text}" vào`} ${a.locator.replace(/^~/, '')}${a.reason ? ` — ${a.reason}` : ''}`);
    return true;
  } catch (e) {
    log(`Không thao tác được ${a.locator}: ${String(e.message).split('\n')[0]}`);
    return false;
  }
}

export async function settle(driver, snap, { android = false, pollMs = 250, quietMs = 1200, maxMs = 6000 } = {}) {
  const fast = () => (android ? driver.getPageSource() : driver.execute('mobile: source', { format: 'xml', excludedAttributes: 'visible' }).catch(() => driver.getPageSource()));
  const end = Date.now() + maxMs;
  let prev = null;
  let saved = null;
  let since = Date.now();
  while (Date.now() < end) {
    const els = parseElements(await fast());
    const sig = screenSignature(els);
    if (sig !== prev) { prev = sig; since = Date.now(); } else {
      if (sig !== saved && els.length >= 2) { await snap(driver, { seenBy: 'explore' }); saved = sig; }
      if (Date.now() - since >= quietMs) return;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

// Android dùng appId + activateApp, iOS dùng bundleId + launchApp
export async function relaunchApp(driver, app) {
  const arg = app?.platform === 'Android' ? { appId: app.bundleId } : { bundleId: app.bundleId };
  await driver.execute('mobile: terminateApp', arg).catch(() => {});
  await driver.execute(app?.platform === 'Android' ? 'mobile: activateApp' : 'mobile: launchApp', arg).catch(() => {});
}

export async function exploreLoop(id, appId, driver, job, opts, { runClaude = defaultRunClaude, settleOpts = {}, model = EXPLORE_MODEL } = {}) {
  const { snap, log, update, renameScreen, screens, app } = opts;
  const maxSteps = Number(opts.maxSteps) || 60;
  const deadline = Date.now() + (Number(opts.maxMinutes) || 20) * 60000;
  const tried = new Map(); // screen id → thao tác đã thử
  const hints = Object.entries(opts.hints || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ') || 'không có';
  let aiFails = 0;
  let loading = 0;
  const plans = new Map(); // screen id → thao tác AI đã đề xuất mà chưa làm
  // Hỏi popup hệ thống tốn ~1,7s khi không có (iOS) → chỉ hỏi lúc đầu, khi thao tác trước lỗi hoặc màn không đổi sau thao tác
  let checkAlert = true;
  let lastScreenId = null;
  const overlayTried = new Map(); // screen id → locator đã bấm để đóng paywall (không bấm lặp)
  const overlayCloses = new Map(); // screen id → số lần đã đóng; quá 3 mà vẫn kẹt → mở lại app
  let win = null;
  const paywallWaited = new Set();
  const paywallAi = new Map(); // screen id → thao tác AI đã tự mò ở paywall
  const awayTried = new Map();
  const { edges } = opts;
  // Thao tác vừa làm; màn kế tiếp khác màn cũ → ghi đường đi (màn cũ --thao tác--> màn mới)
  let pending = null;
  // Bắt đầu từ một màn đã có: đi tới đó trước (đường đã ghi, thiếu thì AI dẫn đường)
  if (opts.startScreenId) {
    const target = screens().find((s) => s.id === opts.startScreenId);
    if (!target) throw new Error('Màn bắt đầu không còn trong locator map');
    win = await driver.getWindowSize?.().catch(() => null);
    const ok = await navigateTo({
      target, edges, driver, app, snap, log, runClaude, model, hints: opts.hints, screens, win,
      settle, doAction, dismissAlert, relaunch: relaunchApp, shouldStop: () => job.stop,
    });
    if (!ok && !job.stop) throw new Error(`Không đi tới được màn "${target.name}" — đưa app tới màn đó rồi chọn "Từ màn app đang mở"`);
  }
  for (let step = 1; step <= maxSteps && !job.stop; step++) {
    if (Date.now() > deadline) { log(`Hết thời gian (${opts.maxMinutes || 20} phút).`); break; }
    if (checkAlert) {
      const closed = await dismissAlert(driver, app?.platform);
      if (closed) log(`Đóng popup hệ thống: ${closed}`);
    }
    const { screen, isNew, elements } = await snap(driver, { seenBy: 'explore' });
    if (pending && screen && screen.id !== pending.from) edges?.add(pending.from, screen.id, pending.action);
    pending = null;
    checkAlert = !!screen && screen.id === lastScreenId;
    lastScreenId = screen?.id ?? null;
    if (!screen) {
      // App đang tải: chờ, không tính bước (tối đa 10 lần liền)
      // Trống vì app khác (tờ thanh toán store, quảng cáo ngoài app) đang che → đóng / kéo app về lại
      if (loading >= 2 && await foreignForeground(driver, app)) {
        const how = await closeOverlay(driver, [], { app, win });
        if (how) { log(`Đóng màn che ngoài app: ${how}`); loading = 0; step--; await driver.pause(1000); continue; }
      }
      if (++loading > 10) throw new Error('Màn hình trống quá lâu — app có thể bị treo');
      step--;
      await driver.pause(1500);
      continue;
    }
    loading = 0;
    // Paywall / IAP / tờ thanh toán: tool KHÔNG mua, chỉ ghi màn rồi đóng bằng code (AI hay bấm Subscribe rồi kẹt)
    const paywall = looksLikePaywall(elements);
    if (paywall || checkAlert) {
      win = win || await driver.getWindowSize?.().catch(() => null);
      const foreign = await foreignForeground(driver, app);
      if (paywall || foreign) {
        const n = (overlayCloses.get(screen.id) || 0) + 1;
        overlayCloses.set(screen.id, n);
        if (n > 3) {
          log('Đóng paywall nhiều lần vẫn kẹt → mở lại app');
          overlayCloses.set(screen.id, 0);
          await relaunchApp(driver, app);
          continue;
        }
        const set = overlayTried.get(screen.id) || new Set();
        overlayTried.set(screen.id, set);
        const how = await closeOverlay(driver, elements, { app, win, tried: set });
        if (how) {
          log(`${paywall ? 'Màn paywall / IAP' : 'Màn che ngoài app'} — đã đóng: ${how}`);
          await settle(driver, snap, { android: app?.platform === 'Android', ...settleOpts });
          continue;
        }
        // Nhiều paywall chỉ hiện nút X sau vài giây → chờ rồi đọc lại 1 lần trước khi nhờ AI
        if (paywall && !paywallWaited.has(screen.id)) {
          paywallWaited.add(screen.id);
          log('Màn paywall chưa thấy nút đóng — chờ 4s xem nút X hiện ra không');
          await driver.pause(4000);
          overlayTried.set(screen.id, new Set());
          overlayCloses.set(screen.id, n - 1);
          continue;
        }
        if (paywall) {
          // Code bó tay: nhờ AI NHÌN ẢNH rồi tự mò (chạm điểm, vuốt, chờ…) — vẫn tuyệt đối không mua
          const pTried = paywallAi.get(screen.id) || [];
          if (pTried.length < 6) {
            const shot = path.join(os.tmpdir(), `qapd-paywall-${process.pid}.png`);
            try { fs.writeFileSync(shot, Buffer.from(await driver.takeScreenshot(), 'base64')); } catch {}
            const pr = await runClaude({
              prompt: fill(PAYWALL_PROMPT, { platform: app?.platform || 'iOS', appName: app?.name || appId, shot, elements: toPrompt(elements), tried: pTried.join('; ') || 'chưa có' }),
              schema: PAYWALL_SCHEMA, allowedTools: ['Read'], lean: true, noPersist: true, timeoutMs: 120000, model,
            });
            if (pr.ok && pr.data?.action && pr.data.action !== 'giveUp') {
              const a = pr.data;
              pTried.push(`${a.action}${a.action === 'tapPoint' ? ` ${Math.round(a.x)},${Math.round(a.y)}` : a.locator ? ` ${a.locator}` : a.text ? ` ${a.text}` : ''}`);
              paywallAi.set(screen.id, pTried);
              const hit = a.action === 'tapPoint' ? elementAtPoint(elements, win, clampPct(a.x), clampPct(a.y)) : elements.find((e) => e.locator === a.locator || e.alts.includes(a.locator));
              if (hit && isBuyTarget(hit, true) && !isCloseName(hit.name || hit.label)) { log(`Paywall: chặn thao tác của AI vì rơi vào nút mua "${hit.name || hit.label}"`); }
              else {
                try {
                  if (a.action === 'tapPoint') await tapPoint(driver, clampPct(a.x), clampPct(a.y));
                  else if (a.action === 'tap' && a.locator) await (await driver.$(a.locator)).click();
                  else if (a.action === 'swipe') await swipe(driver, ['up', 'down', 'left', 'right'].includes(a.text) ? a.text : 'down');
                  else if (a.action === 'wait') await driver.pause(4000);
                  else if (a.action === 'back') await driver.back?.().catch(() => {});
                  else if (a.action === 'relaunch') await relaunchApp(driver, app);
                  log(`Paywall — AI tự mò: ${a.action}${a.reason ? ` (${a.reason})` : ''}`);
                } catch (e) { log(`Paywall — thao tác của AI lỗi: ${String(e.message).split('\n')[0]}`); }
              }
              await settle(driver, snap, { android: app?.platform === 'Android', ...settleOpts });
              overlayCloses.set(screen.id, 0);
              continue;
            }
          }
          log('Màn paywall nhưng không đóng được — để AI chọn (không được mua)');
        }
      }
    }
    const done = tried.get(screen.id) || [];
    const has = (loc) => elements.some((e) => e.locator === loc || e.alts.includes(loc));
    // Màn đã có kế hoạch từ lần hỏi trước → làm thao tác kế tiếp chưa thử, không gọi AI
    const planned = (plans.get(screen.id) || []).filter((p) => !done.includes(`${p.action} ${p.locator}`) && has(p.locator));
    if (planned.length) {
      const p = planned[0];
      plans.set(screen.id, planned.slice(1));
      tried.set(screen.id, [...done, `${p.action} ${p.locator}`]);
      update({ steps: step });
      const ok = await doAction(driver, p, log, '(theo kế hoạch) ');
      if (ok) pending = { from: screen.id, action: { action: p.action, locator: p.locator, text: p.text } };
      checkAlert = checkAlert || !ok;
      await settle(driver, snap, { android: app?.platform === 'Android', ...settleOpts });
      continue;
    }
    const prompt = fill(PROMPT, {
      appName: app?.name || appId, platform: app?.platform || 'iOS', device: app?.platform === 'Android' ? 'thiết bị Android' : 'Simulator', elements: toPrompt(elements), step, maxSteps,
      knownScreens: screens().map((s) => s.name).join(', '), tried: done.join('; ') || 'chưa có', hints,
    });
    // Không tool / MCP: prompt đã có đủ phần tử trên màn → mỗi bước bớt ~40K token khởi tạo
    const r = await runClaude({ prompt, schema: SCHEMA, timeoutMs: 120000, noTools: true, model });
    update({ steps: step });
    if (!r.ok) {
      aiFails++;
      log(`AI lỗi: ${r.error}`);
      if (aiFails >= 3) throw new Error(`AI lỗi 3 lần liên tiếp: ${r.error}`);
      continue;
    }
    aiFails = 0;
    const a = r.data;
    if (isNew && a.screenName && a.screenName !== screen.name) {
      try { renameScreen(screen.id, a.screenName); } catch {}
    }
    if (a.action === 'done') { log(`AI dừng: ${a.reason}`); break; }
    const key = `${a.action}${a.locator ? ` ${a.locator}` : ''}`;
    tried.set(screen.id, [...done, key]);
    plans.set(screen.id, (a.next || []).filter((p) => p.locator && p.locator !== a.locator));
    if (a.action === 'tap' || a.action === 'type') {
      if (!has(a.locator)) {
        log(`Bỏ qua: AI chọn locator không có trên màn (${a.locator})`);
        continue;
      }
      if (await doAction(driver, a, log)) pending = { from: screen.id, action: { action: a.action, locator: a.locator, text: a.text } };
      else checkAlert = true;
    } else if (a.action === 'back') {
      const back = elements.find((e) => e.type === 'Button' && /^(Back|Close)$/i.test(e.name));
      // Back đã thử ở màn này mà vẫn kẹt (tooltip / popup chỉ có chữ) → chạm ra ngoài popup
      if (!back && done.includes('back')) {
        win = win || await driver.getWindowSize?.().catch(() => null);
        const set = awayTried.get(screen.id) || new Set();
        awayTried.set(screen.id, set);
        const how = await tapAway(driver, win, { app, tried: set });
        if (how) log(`Back không đóng được — ${how}`);
        else await driver.back?.().catch(() => {});
      } else if (back) await (await driver.$(back.locator)).click().catch(() => {});
      else await driver.back?.().catch(() => {});
      log(`Quay lại — ${a.reason}`);
    } else if (a.action === 'relaunch') {
      await relaunchApp(driver, app);
      log(`Mở lại app — ${a.reason}`);
    }
    await settle(driver, snap, { android: app?.platform === 'Android', ...settleOpts });
  }
}

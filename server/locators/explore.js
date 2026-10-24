// Chế độ "Tự khám phá": mỗi bước đọc màn → hỏi AI thao tác tiếp → thực hiện. Locator AI chọn phải có trên màn.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runClaude as defaultRunClaude } from '../ai/claude.js';
import { toPrompt } from './pageSource.js';
import { systemDialog } from '../device/platforms.js';

const PROMPT = fs.readFileSync(fileURLToPath(new URL('../ai/prompts/explore-step.md', import.meta.url)), 'utf8');
const SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['tap', 'type', 'back', 'relaunch', 'done'] },
    locator: { type: 'string' },
    text: { type: 'string' },
    screenName: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['action', 'screenName', 'reason'],
};
const fill = (tpl, v) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(v[k] ?? ''));

// Popup hệ thống (theo dõi, thông báo, vị trí…) → chọn từ chối như ik-fitness/src/utils/app.js
async function dismissAlert(driver, platform) {
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
    const pick = buttons.find((b) => /not to track|don.t allow|không cho phép|từ chối|not now/i.test(b)) || buttons[0];
    await driver.execute('mobile: alert', { action: 'accept', buttonLabel: pick });
    return pick;
  } catch {
    return null;
  }
}

export async function exploreLoop(id, appId, driver, job, opts, { runClaude = defaultRunClaude } = {}) {
  const { snap, log, update, renameScreen, screens, app } = opts;
  const maxSteps = Number(opts.maxSteps) || 60;
  const deadline = Date.now() + (Number(opts.maxMinutes) || 20) * 60000;
  const tried = new Map(); // screen id → thao tác đã thử
  const hints = Object.entries(opts.hints || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ') || 'không có';
  let aiFails = 0;
  let loading = 0;
  for (let step = 1; step <= maxSteps && !job.stop; step++) {
    if (Date.now() > deadline) { log(`Hết thời gian (${opts.maxMinutes || 20} phút).`); break; }
    const closed = await dismissAlert(driver, app?.platform);
    if (closed) log(`Đóng popup hệ thống: ${closed}`);
    const { screen, isNew, elements } = await snap(driver, { seenBy: 'explore' });
    if (!screen) {
      // App đang tải: chờ, không tính bước (tối đa 10 lần liền)
      if (++loading > 10) throw new Error('Màn hình trống quá lâu — app có thể bị treo');
      step--;
      await driver.pause(1500);
      continue;
    }
    loading = 0;
    const done = tried.get(screen.id) || [];
    const prompt = fill(PROMPT, {
      appName: app?.name || appId, platform: app?.platform || 'iOS', device: app?.platform === 'Android' ? 'thiết bị Android' : 'Simulator', elements: toPrompt(elements), step, maxSteps,
      knownScreens: screens().map((s) => s.name).join(', '), tried: done.join('; ') || 'chưa có', hints,
    });
    const r = await runClaude({ prompt, schema: SCHEMA, timeoutMs: 120000 });
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
    if (a.action === 'tap' || a.action === 'type') {
      if (!elements.some((e) => e.locator === a.locator || e.alts.includes(a.locator))) {
        log(`Bỏ qua: AI chọn locator không có trên màn (${a.locator})`);
        continue;
      }
      try {
        const el = await driver.$(a.locator);
        if (a.action === 'tap') await el.click();
        else await el.setValue(a.text || '');
        log(`${a.action === 'tap' ? 'Bấm' : `Nhập "${a.text}" vào`} ${a.locator.replace(/^~/, '')} — ${a.reason}`);
      } catch (e) {
        log(`Không thao tác được ${a.locator}: ${String(e.message).split('\n')[0]}`);
      }
    } else if (a.action === 'back') {
      const back = elements.find((e) => e.type === 'Button' && /^(Back|Close)$/i.test(e.name));
      if (back) await (await driver.$(back.locator)).click().catch(() => {});
      else await driver.back?.().catch(() => {});
      log(`Quay lại — ${a.reason}`);
    } else if (a.action === 'relaunch') {
      await driver.execute('mobile: terminateApp', { bundleId: app.bundleId }).catch(() => {});
      await driver.execute('mobile: launchApp', { bundleId: app.bundleId }).catch(() => {});
      log(`Mở lại app — ${a.reason}`);
    }
    await driver.pause(800);
  }
}

// AI hỗ trợ lúc chạy (Run option "Cho AI hỗ trợ khi chạy"): script kẹt ở bước thao tác / điều hướng → AI nhìn ảnh + phần tử
// của màn đang hiện, chọn MỘT thao tác gỡ kẹt. Chỉ thao tác / điều hướng, không bao giờ đụng điểm kiểm (worker chỉ gọi từ bước chặn luồng).
// Mọi lần AI giúp được ghi thành "lệch so với script" để tester quyết định có sửa test case theo hay không.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runClaude as defaultRunClaude } from './claude.js';
import { BUY, looksLikePaywall, isCloseName } from '../locators/overlay.js';

const PROMPT = fs.readFileSync(fileURLToPath(new URL('./prompts/run-assist.md', import.meta.url)), 'utf8');
export const ACTIONS = ['use', 'arrived', 'tap', 'tapPoint', 'type', 'swipe', 'back', 'wait', 'giveUp'];
const SCHEMA = {
  type: 'object',
  properties: { action: { type: 'string', enum: ACTIONS }, locator: { type: 'string' }, text: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, reason: { type: 'string' } },
  required: ['action', 'reason'],
};
const MODEL = process.env.QAPD_ASSIST_MODEL || process.env.QAPD_EXPLORE_MODEL || 'claude-sonnet-5-5';
const NEEDS_LOCATOR = new Set(['use', 'arrived', 'tap', 'type']);
// Nút mua chắc chắn (kể cả ngoài paywall); "Continue" / "Confirm" chỉ coi là mua khi màn trông như paywall
const HARD_BUY = /\b(subscribe|buy|purchase|start (free )?trial|try (it )?free|get premium|upgrade)\b|[$€£₫¥]\s?\d/i;

const fill = (t, v) => t.replace(/\{\{(\w+)\}\}/g, (_, k) => (v[k] == null ? '' : String(v[k])));
const nameOf = (e) => e?.name || e?.label || '';

export function rowsText(rows = [], stuck = {}) {
  let marked = false;
  return rows.map((r) => {
    const hit = !marked && r.step === stuck.step && (r.screen === stuck.screen || r.target === stuck.target) && (r.target === stuck.target || r.kind === 'Nav');
    if (hit) marked = true;
    return `${hit ? '►' : ' '} ${r.step}. [${r.screen || ''}] ${r.kind} ${r.keyword}${r.target ? ` "${r.target}"` : ''}${r.value ? ` = ${r.value}` : ''}`;
  }).slice(0, 120).join('\n');
}

export function goalText({ kind, screen, target, error }) {
  if (kind === 'overlay') return 'bước KIỂM không thấy phần tử cần kiểm — xem màn có popup / tờ trong app NGOÀI luồng test (mời đăng nhập, đánh giá, khuyến mãi…) đang che không. Có thì chọn "tap" vào nút ĐÓNG của nó (X, Close, Not now…), tuyệt đối không bấm đăng nhập / mua. Không có popup che thì "giveUp" (để script báo lỗi thật)';
  if (kind === 'nav') return `tới màn "${screen}"${target && target !== '(screen)' ? ` (thấy "${target}")` : ''}${/không chuyển sang màn/.test(error || '') ? ' sau bước bấm trước' : ''}`;
  if (kind === 'gone') return `chờ "${target}" biến mất trên màn "${screen}"`;
  if (kind === 'enter') return `nhập vào "${target}" trên màn "${screen}"`;
  if (kind === 'back') return `quay lại từ màn "${screen}"`;
  return `bấm "${target}" trên màn "${screen}"`;
}

// Kiểm câu trả lời của AI: locator phải có trong danh sách; không bao giờ là nút mua → { ok, step } | { ok:false, why }
// Phần tử AI chỉ ra: đúng locator, hoặc AI ghi tên / nhãn nút ("Continue" thay vì "~Continue") → phần tử có đúng tên đó (duy nhất)
export function findElement(elements, ref) {
  const want = String(ref || '').trim();
  if (!want) return null;
  const exact = elements.find((e) => e.locator === want);
  if (exact) return exact;
  const bare = want.replace(/^~/, '').trim().toLowerCase();
  const byName = elements.filter((e) => [e.name, e.label].some((n) => String(n || '').trim().toLowerCase() === bare));
  if (!byName.length) return null;
  // nhiều phần tử cùng tên → ưu tiên Button
  return byName.find((e) => /button/i.test(e.type || '')) || byName[0];
}
// win: { width, height } (điểm) — để biết điểm chạm theo % rơi vào phần tử nào
export function vetAction(a, elements = [], win = null) {
  if (!a || !ACTIONS.includes(a.action)) return { ok: false, why: 'AI không trả thao tác hợp lệ' };
  if (a.action === 'giveUp') return { ok: true, step: { action: 'giveUp', reason: a.reason || '' } };
  const paywall = looksLikePaywall(elements);
  if (a.action === 'tapPoint') {
    const x = Number(a.x);
    const y = Number(a.y);
    if (!(x >= 0 && x <= 100 && y >= 0 && y <= 100)) return { ok: false, why: 'Toạ độ chạm phải là % (0–100) của màn' };
    // Mọi phần tử chứa điểm chạm (không chỉ phần tử nhỏ nhất) — rơi vào nút mua → chặn; không biết kích thước màn mà đang ở paywall → chặn
    if (!win?.width) { if (paywall) return { ok: false, why: 'Không biết kích thước màn trên paywall — không chạm theo toạ độ' }; }
    else {
      const px = (x / 100) * win.width;
      const py = (y / 100) * win.height;
      const hit = elements.filter((e) => Array.isArray(e.rect) && px >= e.rect[0] && px <= e.rect[0] + e.rect[2] && py >= e.rect[1] && py <= e.rect[1] + e.rect[3]);
      const buy = hit.find((e) => !isCloseName(nameOf(e)) && (HARD_BUY.test(nameOf(e)) || (paywall && BUY.test(nameOf(e)))));
      if (buy) return { ok: false, why: `Chặn: điểm chạm rơi vào "${nameOf(buy)}" (trông như nút mua)` };
    }
    return { ok: true, step: { action: 'tapPoint', x, y, locator: '', name: a.text || `điểm ${Math.round(x)}%, ${Math.round(y)}%`, text: '', reason: a.reason || '' } };
  }
  let el = null;
  if (NEEDS_LOCATOR.has(a.action)) {
    el = findElement(elements, a.locator);
    if (!el) return { ok: false, why: `AI chọn phần tử không có trên màn (${a.locator || 'trống'}) — chọn đúng locator trong danh sách, hoặc dùng tapPoint theo toạ độ trên ảnh nếu nút không có trong danh sách` };
    a = { ...a, locator: el.locator };
    const n = nameOf(el);
    const paywall = looksLikePaywall(elements);
    if (a.action !== 'arrived' && !isCloseName(n) && (HARD_BUY.test(n) || (paywall && BUY.test(n)))) return { ok: false, why: `Chặn: "${n}" trông như nút mua` };
  }
  if (a.action === 'swipe' && !['up', 'down', 'left', 'right'].includes(String(a.text))) return { ok: false, why: 'Hướng vuốt không hợp lệ' };
  return { ok: true, step: { action: a.action, locator: a.locator || '', name: nameOf(el), text: a.text || '', reason: a.reason || '' } };
}

export function createAssist({ store, runClaude = defaultRunClaude, model = MODEL } = {}) {
  return async function assist(appId, body = {}) {
    const app = store.get('apps', appId);
    const elements = Array.isArray(body.elements) ? body.elements.filter((e) => e && e.locator) : [];
    const tc = store.list('cases').find((c) => c.appId === appId && c.tcId === body.tc && (!body.file || c.file === body.file));
    const list = elements.slice(0, 150).map((e) => {
      const r = Array.isArray(e.rect) && e.rect[2] ? ` [x ${e.rect[0]}, y ${e.rect[1]}, ${e.rect[2]}×${e.rect[3]}]` : '';
      return `- ${e.type} "${nameOf(e)}"${r} → ${e.locator}`;
    }).join('\n');
    const prompt = fill(PROMPT, {
      platform: app?.platform || 'iOS', appName: app?.name || appId, tc: body.tc || '', title: tc?.title || '',
      rows: rowsText(tc?.rows || [], body), goal: goalText(body), error: body.error || '', tried: (body.tried || []).join('; ') || 'chưa có',
      shot: body.shot && fs.existsSync(body.shot) ? body.shot : '(không có ảnh)', elements: list || '(không đọc được phần tử)',
    });
    const r = await runClaude({ prompt, schema: SCHEMA, allowedTools: ['Read'], lean: true, noPersist: true, timeoutMs: 90000, model });
    if (!r.ok) return { action: 'giveUp', reason: `AI không trả lời được: ${String(r.error || '').slice(0, 120)}` };
    const v = vetAction(r.data, elements, body.win || null);
    return v.ok ? v.step : { action: 'refused', reason: v.why };
  };
}

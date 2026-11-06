// Lọc case manual: luật từ khóa trước (rẻ, chắc), AI chỉ xét các case còn mơ hồ — gom vào MỘT lần gọi.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lightModel } from './models.js';

const PROMPT = fileURLToPath(new URL('../../ai/prompts/convert-filter.md', import.meta.url));
const SCHEMA = {
  type: 'object',
  properties: { decisions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, mode: { enum: ['automate', 'manual'] }, reason: { type: 'string' } }, required: ['id', 'mode', 'reason'] } } },
  required: ['decisions'],
};

const textOf = (c) => [c.scenario, c.description, c.pre, c.steps, c.expected].map((x) => String(x || '')).join('\n');

// Luật cứng: [regex, lý do, điều kiện thêm]. Màu / animation không nằm đây (skill: tự động hoá phần đọc được) → để AI xét.
const RULES = [
  [/(google|apple)[\s\S]{0,40}(đăng nhập|login|sign in|continue)|(đăng nhập|login|sign in|continue with)[\s\S]{0,40}(google|apple)/i, 'Đăng nhập Google / Apple: popup OAuth của bên thứ 3'],
  [/\bIAP\b|in-app purchase|mua (gói|premium|hàng)|thanh toán|sandbox|store payment/i, 'Mua hàng IAP / thanh toán store: cần tài khoản sandbox'],
  [/(tắt|ngắt|mất)\s+(mạng|wifi|kết nối)|network off|offline/i, 'Tắt mạng trên iOS: không điều khiển được (Android dùng Set network)', (c) => c.platform === 'iOS'],
  [/settings\s+(của|hệ thống|iphone)|trong\s+(cài đặt|settings)|cài đặt\s+(của\s+)?(iphone|hệ thống)|apple watch|health app|cuộc gọi đến|incoming call/i, 'Nằm ngoài app đang test: Settings hệ thống / thiết bị khác'],
  [/chưa chốt|\bTBD\b|\bpending\b|\bopen\s+(q&a|question)/i, 'Q&A chưa chốt: chưa có kết quả mong đợi chính thức'],
];
// Không khớp luật cứng nhưng có dấu hiệu cần người / AI xem
const AMBIGUOUS = /popup|webview|trình duyệt|hệ thống|quảng cáo|thông báo|animation|biểu đồ|màu|color|hiệu ứng|mạng|offline|wifi|widget|âm thanh|rung/i;

export function prefilter(c) {
  const t = textOf(c);
  for (const [re, reason, when] of RULES) if (re.test(t) && (!when || when(c))) return { reason };
  return null;
}

// → [{ id, mode: 'automate'|'manual', reason, by: 'rule'|'ai' }], chỉ case selected, giữ thứ tự đầu vào
export async function classifyCases({ cases, runClaude, signal }) {
  const out = new Map();
  const unsure = [];
  for (const c of cases.filter((x) => x.selected)) {
    const hit = prefilter(c);
    if (hit) out.set(c.id, { id: c.id, mode: 'manual', reason: hit.reason, by: 'rule' });
    else if (AMBIGUOUS.test(textOf(c))) unsure.push(c);
    else out.set(c.id, { id: c.id, mode: 'automate', reason: 'Tự động hoá được', by: 'rule' });
  }
  if (unsure.length) {
    const list = unsure.map((c) => ({ id: c.id, platform: c.platform, scenario: c.scenario, steps: String(c.steps || '').slice(0, 600), expected: String(c.expected || '').slice(0, 600) }));
    const r = await runClaude({ system: fs.readFileSync(PROMPT, 'utf8'), prompt: `Danh sách case:\n${JSON.stringify(list, null, 1)}`, schema: SCHEMA, noTools: true, timeoutMs: 180000, model: lightModel(), signal });
    const got = new Map((r.ok ? r.data.decisions || [] : []).map((d) => [d.id, d]));
    for (const c of unsure) {
      const d = got.get(c.id);
      out.set(c.id, d && ['automate', 'manual'].includes(d.mode)
        ? { id: c.id, mode: d.mode, reason: d.reason || '', by: 'ai' }
        : { id: c.id, mode: 'automate', reason: 'AI không trả lời, giữ automate', by: 'ai' });
    }
  }
  return cases.filter((x) => x.selected).map((c) => out.get(c.id));
}

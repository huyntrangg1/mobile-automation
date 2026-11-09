// Bước dùng chung cho script AI gen: mỗi dòng test case (Tap / Nav / Verify …) là 1 lời gọi `k.xxx(...)`.
// Khung file tạo `k = createSteps({ sa, logStep, snapshot, … })` cho từng case → AI không phải viết lại helper trong mỗi case,
// log / evidence / câu lỗi luôn cùng một mẫu (report đọc câu lỗi "Không tới được màn …" để viết bug).
// Chế độ sửa tay khi lỗi (MANUAL_FIX=1): bước chặn luồng lỗi → hỏi tester qua HELP_DIR/help.json, chờ answer.json, làm theo.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ui from '../utils/ui.js';
import { compareValues, expectLabel, fillVars, generateValue, parseDate } from './compare.js';
import { guardApi } from './limit.js';
import { parseRules, formatRules, needsImage, readPng, evaluate, describeResults } from './layout.js';
import * as ocr from './ocr.js';
import { recordEdge } from './navgraph.js';

// $ / $$ của module này: locator theo chữ khớp lỏng khoảng trắng / xuống dòng (ui.loose)
const $ = (sel) => globalThis.$(ui.loose(sel));
const $$ = (sel) => globalThis.$$(ui.loose(sel));

// Hộp thoại xin quyền theo dõi (ATT): iOS bật lúc mở app hoặc sau bước đầu, có lần không bật; k tự đóng khi nó che màn.
// Bước chủ động bấm / xử lý hộp thoại này mà không thấy nó → coi như đã đóng trước đó, đi tiếp (không chặn luồng)
const TRACKING = /not to track|allow tracking|\btracking\b|theo dõi/i;
const TRACKING_WAIT = 5000;

const ALL = ['block', 'skip', 'retry', 'use', 'fix'];
// gone / alert: không có phần tử nào để chọn thay
const CHOICES = { tap: ALL, back: ALL, enter: ALL, nav: ALL, gone: ['block', 'skip', 'retry'], alert: ['block', 'skip', 'retry'] };
// Lựa chọn Use element trong lần chạy này (worker): màn|target → locator — các case sau tự dùng, không hỏi lại
const used = new Map();

// Selector theo chữ hiển thị (khi locator map không có phần tử)
export const byText = (t) => (driver.isAndroid
  ? `android=new UiSelector().text(${JSON.stringify(String(t))})`
  : `-ios predicate string:name == ${JSON.stringify(String(t))} OR label == ${JSON.stringify(String(t))}`);

// Chữ của phần tử (iOS: label → value → name; Android: text); không thấy trong 3s → null
export async function textOf(sel, timeout = 3000) {
  if (!(await ui.exists(sel, timeout))) return null;
  const e = await $(sel);
  if (driver.isAndroid) return e.getText();
  return (await e.getAttribute('label')) || (await e.getAttribute('value')) || (await e.getAttribute('name'));
}

// Fix script: lưu locator (đã chạy được) vào locators/overrides.json — giữ các dòng khác; file hỏng → ghi mới
function saveOverride(cwd, key, locator, element = '') {
  const file = path.join(cwd, 'locators/overrides.json');
  let all = {};
  try { all = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch {}
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...all, [key]: { locator, element, at: new Date().toISOString() } }, null, 2));
}

// Locator tester đã "Fix script" (server ghi locators/overrides.json): màn|target → locator; thiếu / hỏng → {}
export function readOverrides(cwd = process.cwd()) {
  try {
    const all = JSON.parse(fs.readFileSync(path.join(cwd, 'locators/overrides.json'), 'utf8'));
    return Object.fromEntries(Object.entries(all || {}).map(([k, v]) => [k, v?.locator]).filter(([, l]) => l));
  } catch {
    return {};
  }
}

// Phần tử còn hiển thị (chờ biến mất): còn trong cây nhưng không hiển thị (màn đã chuyển, phần tử cũ bị ẩn) → coi như đã biến mất.
// Không đọc được trạng thái hiển thị → tin vào việc còn trong cây (giữ cách cũ)
async function stillShown(sel) {
  if (!(await ui.exists(sel, 300))) return false;
  try {
    return await (await $(sel)).isDisplayed();
  } catch {
    return true;
  }
}

// Điểm tester chọn trên ảnh (phần tử không có tên): "point:<x>,<y>" theo tỉ lệ màn hình 0..1 → bấm theo toạ độ
const isPoint = (s) => typeof s === 'string' && s.startsWith('point:');
async function tapPoint(spec) {
  const [fx, fy] = spec.slice(6).split(',').map(Number);
  const { width, height } = await driver.getWindowRect();
  const at = { x: Math.round(fx * width), y: Math.round(fy * height) };
  await driver.execute(driver.isAndroid ? 'mobile: clickGesture' : 'mobile: tap', at);
}

// Nút của alert hệ thống theo ý định — chữ khác nhau theo phiên bản iOS và ngôn ngữ máy (ATT, thông báo, vị trí)
const ALERT_BUTTONS = {
  allow: ['Allow', 'Allow While Using App', 'Allow Once', 'OK', 'Cho phép', 'Cho phép khi dùng ứng dụng', 'Cho phép một lần'],
  deny: ["Don't Allow", 'Ask App Not to Track', 'Không cho phép', 'Yêu cầu ứng dụng không theo dõi'],
};
const INTENT_TEXT = { allow: 'Cho phép', deny: 'Từ chối' };
// Hộp thoại hệ thống KHÔNG có trong test case (mặc định SYSTEM_ALERT=smart): theo dõi quảng cáo (ATT) → từ chối;
// xin quyền (thông báo, ảnh, camera, micro, vị trí, Health…) → cho phép để tính năng chạy được. Không phải hộp xin quyền → không tự bấm
const TRACK_DENY = ['Ask App Not to Track', 'Yêu cầu ứng dụng không theo dõi'];
const SMART_ALLOW = ['Allow Full Access', 'Allow While Using App', 'Allow', 'Cho phép truy cập đầy đủ', 'Cho phép khi dùng ứng dụng', 'Cho phép', 'Allow Once', 'Cho phép một lần'];
// Nút "từ chối" chỉ có ở hộp XIN QUYỀN của hệ thống → dấu hiệu để phân biệt với alert của chính app (vd "Xoá? Cancel / OK")
const PERMISSION_DENY = /^(don.?t allow|ask app not to track|limit access|keep only while using|không cho phép|yêu cầu ứng dụng không theo dõi|giới hạn quyền truy cập|chỉ giữ khi dùng ứng dụng)/i;
export function smartPick(buttons) {
  // Alert không phải hộp xin quyền (không có nút từ chối kiểu hệ thống) → không tự bấm gì (có thể là alert của app: xoá, đăng xuất…)
  if (!buttons.some((b) => PERMISSION_DENY.test(normBtn(b)))) return null;
  // "OK" chỉ hợp lệ khi đi kèm nút từ chối của hệ thống (vd quyền camera cũ: Don't Allow / OK)
  // Hộp nâng quyền vị trí (Keep Only While Using / Change to Always Allow): giữ quyền khi dùng app — không tự nâng lên "luôn luôn"
  for (const c of [...TRACK_DENY, 'Keep Only While Using', 'Chỉ giữ khi dùng ứng dụng', ...SMART_ALLOW, 'OK']) {
    const b = buttons.find((x) => normBtn(x) === normBtn(c));
    if (b) return b;
  }
  return null;
}
const normBtn = (s) => String(s ?? '').replace(/[‘’]/g, "'").toLowerCase().trim(); // iOS dùng nháy cong: Don’t Allow
const alertIntent = (button) => INTENT_TEXT[normBtn(button)] || button;
// Chữ đúng của nút trước (chữ cụ thể), rồi tới danh sách theo ý định
export function pickAlertButton(buttons, button) {
  const exact = buttons.find((b) => normBtn(b) === normBtn(button));
  if (exact) return exact;
  for (const c of ALERT_BUTTONS[normBtn(button)] || []) {
    const b = buttons.find((x) => normBtn(x) === normBtn(c));
    if (b) return b;
  }
  return null;
}
// Nút của alert đang hiện (iOS: mobile: alert; Android: hộp xin quyền là phần tử thường).
// Lỗi gì cũng coi như không có hộp thoại — không làm hỏng step
async function alertButtons() {
  try {
    if (!driver.isAndroid) return (await driver.execute('mobile: alert', { action: 'getButtons' })) || [];
    const els = await $$('android=new UiSelector().resourceIdMatches(".*permission.*button.*|.*button[0-9]")');
    const out = [];
    for (const e of els) out.push(await e.getText().catch(() => ''));
    return out.filter(Boolean);
  } catch {
    return [];
  }
}

// Back: Android phím Back của máy; iOS không có Back hệ thống và nhiều app tắt vuốt mép để lùi → bấm nút Back / ← của màn
// (nav bar "Back", SF Symbol chevron.left / arrow.left)
const BACK_BUTTON = '-ios predicate string:type == "XCUIElementTypeButton" AND (name == "Back" OR label == "Back" OR name BEGINSWITH "chevron.left" OR name == "arrow.left")';
const ANDROID_BACK = 'android:back';
// Press key: tên phím → keycode Android / ký tự gửi qua bàn phím iOS
const KEYCODES = { ENTER: 66, DEL: 67, DELETE: 67, BACKSPACE: 67, TAB: 61, SPACE: 62, BACK: 4, ESCAPE: 111, SEARCH: 84 };
const IOS_KEYS = { ENTER: '\n', DEL: '\b', DELETE: '\b', BACKSPACE: '\b', TAB: '\t', SPACE: ' ' };
const SWIPE_DIRS = ['up', 'down', 'left', 'right'];
const dirOf = (v) => {
  const d = String(v || 'down').trim().toLowerCase();
  if (!SWIPE_DIRS.includes(d)) throw new Error(`Hướng "${v}" không hợp lệ — dùng up / down / left / right`);
  return d;
};
// Chữ dùng để nhận diện / so thứ tự một mục danh sách
async function itemText(e) {
  if (driver.isAndroid) return (await e.getText().catch(() => '')) || (await e.getAttribute('content-desc').catch(() => '')) || '';
  return (await e.getAttribute('label').catch(() => '')) || (await e.getAttribute('name').catch(() => '')) || (await e.getAttribute('value').catch(() => '')) || '';
}
async function isOn(e) {
  const attr = async (k) => String(await e.getAttribute(k).catch(() => null));
  return driver.isAndroid
    ? (await attr('checked')) === 'true' || (await attr('selected')) === 'true'
    : (await attr('value')) === '1' || (await attr('selected')) === 'true' || /\bSelected\b/.test(await attr('traits'));
}
// Cuộn 1 lần (cả màn hoặc trong phần tử sel)
async function scrollOnce(direction, sel) {
  if (driver.isAndroid) {
    const r = sel ? await driver.getElementRect((await ui.el(sel)).elementId) : { x: 0, y: 0, ...(await driver.getWindowRect()) };
    const box = { left: Math.round(r.x), top: Math.round(r.y + r.height * 0.1), width: Math.round(r.width), height: Math.round(r.height * 0.8) };
    await driver.execute('mobile: scrollGesture', { ...box, direction, percent: 0.7 });
  } else {
    await driver.execute('mobile: scroll', { direction, ...(sel ? { elementId: (await ui.el(sel)).elementId } : {}) });
  }
}
// Gom mọi mục khớp sel, cuộn xuống tới khi không còn mục mới (tối đa max lần); giữ thứ tự từ trên xuống. Mục trùng chữ chỉ tính 1
async function collectItems(sel, { scroll = true, max = 12, container } = {}) {
  const seen = [];
  let scrolled = 0;
  for (let i = 0; i <= max; i++) {
    const els = await $$(sel);
    const page = [];
    for (const e of els) {
      const t = await itemText(e);
      const y = (await e.getLocation().catch(() => ({ y: 0 }))).y;
      if (t) page.push({ t, y });
    }
    page.sort((a, b) => a.y - b.y);
    const fresh = page.filter((p) => !seen.includes(p.t));
    seen.push(...fresh.map((p) => p.t));
    if (!scroll || (i > 0 && !fresh.length)) break;
    await scrollOnce('down', container).catch(() => {});
    scrolled++;
  }
  // Cuộn lại lên để bước sau thấy màn như cũ
  for (let i = 0; scroll && i < scrolled; i++) await scrollOnce('up', container).catch(() => {});
  return seen;
}

// ===== Tìm phần tử lúc chạy theo mô tả (khi locator không thấy / màn chưa lấy locator) =====
const ATTR = (tag, k) => { const m = tag.match(new RegExp(`\\s${k}="([^"]*)"`)); return m ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, ' ') : ''; };
const IOS_KEEP = /^(Button|StaticText|TextField|SecureTextField|TextView|Cell|Switch|Link|Image|SearchField|Other|Tab)$/;
// Phần tử thao tác được trên màn đang hiện (iOS: đang hiển thị, có tên / nhãn) → { type, name, label, locator }
export function screenElements(xml, android = false) {
  const out = [];
  if (android) {
    for (const tag of xml.match(/<node\b[^>]*>/g) || []) {
      const text = ATTR(tag, 'text');
      const desc = ATTR(tag, 'content-desc');
      const id = ATTR(tag, 'resource-id');
      const type = ATTR(tag, 'class').split('.').pop();
      if (!text && !desc && !id) continue;
      const locator = desc ? `~${desc}` : id ? `android=new UiSelector().resourceId(${JSON.stringify(id)})` : `android=new UiSelector().text(${JSON.stringify(text)})`;
      out.push({ type, name: desc || text, label: text, locator });
    }
    return out;
  }
  const tags = xml.match(/<XCUIElementType\w+\b[^>]*>/g) || [];
  const names = tags.map((t) => ATTR(t, 'name'));
  for (const tag of tags) {
    const type = tag.match(/<XCUIElementType(\w+)/)[1];
    if (!IOS_KEEP.test(type) || ATTR(tag, 'visible') === 'false') continue;
    const name = ATTR(tag, 'name');
    const label = ATTR(tag, 'label');
    if (!name && !label) continue;
    const locator = name && names.filter((n) => n === name).length === 1 ? `~${name}`
      : `-ios predicate string:type == "XCUIElementType${type}" AND ${name ? `name == ${JSON.stringify(name)}` : `label == ${JSON.stringify(label)}`}`;
    // Vị trí / kích thước: AI nhận ra "ảnh", "vùng" = nút trong suốt lớn phủ ảnh (vd "Tap here" phủ ảnh tutorial)
    const rect = ['x', 'y', 'width', 'height'].map((k) => Math.round(Number(ATTR(tag, k)) || 0));
    out.push({ type, name, label, locator, rect });
  }
  return out;
}
const bigrams = (s) => { const t = String(s).toLowerCase(); const o = []; for (let i = 0; i < t.length - 1; i++) o.push(t.slice(i, i + 2)); return o; };
const dice = (a, b) => {
  const x = bigrams(a); const y = [...bigrams(b)];
  if (!x.length || !y.length) return a && b && a.toLowerCase() === b.toLowerCase() ? 1 : 0;
  let hit = 0;
  for (const g of x) { const i = y.indexOf(g); if (i >= 0) { hit++; y.splice(i, 1); } }
  return (2 * hit) / (x.length + y.length);
};
// Mô tả trong Excel → chữ có thể có trên màn: chữ trong ngoặc kép nếu có, bỏ phần ngoặc đơn và chữ tả loại (Nút, Icon…)
const targetText = (t) => {
  const q = String(t).match(/["“]([^"”]+)["”]/);
  if (q) return q[1];
  return String(t).replace(/\([^)]*\)/g, ' ').replace(/^(nút|button|icon|biểu tượng|ảnh|link|tab|ô)\s+/i, '').replace(/\s+/g, ' ').trim();
};
// Loại bấm / nhập được ưu tiên hơn chữ tĩnh / ảnh bên trong nó (nút "Continue" chứa StaticText "Continue")
const ACTIONABLE = ['Button', 'Cell', 'Link', 'TextField', 'SecureTextField', 'TextView', 'SearchField', 'Switch', 'Tab'];
const rank = (t) => { const i = ACTIONABLE.indexOf(t); return i < 0 ? ACTIONABLE.length : i; };
// Khớp chữ rõ ràng (≥ 0.85, các ứng viên sát điểm đều cùng một chữ) → locator; không chắc → null (để AI chọn)
export function pickByText(target, els) {
  const want = targetText(target);
  if (!want) return null;
  const textOfEl = (e) => (dice(want, e.name) >= dice(want, e.label) ? e.name : e.label);
  const scored = els.map((e) => ({ e, s: Math.max(dice(want, e.name), dice(want, e.label)) })).sort((a, b) => b.s - a.s);
  if (!scored.length || scored[0].s < 0.85) return null;
  const close = scored.filter((x) => scored[0].s - x.s < 0.1);
  if (new Set(close.map((x) => textOfEl(x.e).toLowerCase())).size > 1) return null; // nhiều chữ khác nhau đều gần → không chắc
  return close.sort((a, b) => rank(a.e.type) - rank(b.e.type))[0].e.locator;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Popup trong app ngoài test case: nút đóng rõ ràng / chữ cho thấy là popup mời (đăng nhập, đánh giá, khuyến mãi, cập nhật…)
// KHÔNG gồm Skip / Cancel / Bỏ qua: trên màn thường (onboarding) chúng là nút điều hướng thật, bấm sẽ bỏ qua cả luồng
const OVERLAY_CLOSE = /^(close|x|✕|✖|×|xmark|xmark\.circle(\.fill)?|dismiss|not now|maybe later|no,? thanks?|later|đóng|để sau|không,? cảm ơn)$/i;
// Câu mời kiểu popup (không phải link "Log in" thường gặp trên màn): sign in to…, save your…, rate us, bật thông báo, ưu đãi, cập nhật
const OVERLAY_HINT = /sign ?in to |log ?in to |create (an |your )?account|save your |keep your .* (safe|synced)|rate (us|the app|this app|our app)|enjoying (the|this|our)? ?app|leave (us )?a review|turn on (push )?notifications|special offer|limited[- ]time offer|update available|new version (is )?available|đăng nhập để|đánh giá ứng dụng|bật thông báo|ưu đãi đặc biệt|có phiên bản mới/i;
// Nút mua / xác nhận thanh toán / đăng nhập bên thứ ba — tool không bao giờ tự bấm (đóng popup, bấm lại, AI chọn, đi theo sơ đồ màn)
export const HARD_BUY = /\b(subscribe|buy|purchase|start (my |your )?(free )?trial|try (it )?free|get premium|upgrade|pay|confirm purchase|1-tap buy|continue with (apple|google|facebook)|sign in with)\b|[$€£₫¥]\s?\d|\d\s?[$€£₫¥]/i;
const BUY_WORD = HARD_BUY;
// Hook setup "đóng màn chặn" có sẵn (không cần viết trong src/hooks.js)
const DISMISS_HOOK = /^(dismiss|close|skip|exit)_(the_)?(paywall|ad|ads|popup|offer|promo|interstitial|subscription)s?$/i;
const STALE_RE = /expired from the internal cache|stale element|either not present or it has expired/i;
const overlayGaveUp = new Set(); // popup AI đã không tìm được nút đóng trong lần chạy này
// Màn đang tải (không kết luận kẹt sớm khi thấy những dấu hiệu này trong page source)
const LOADING = /loading|importing|please wait|processing|warming up|getting .{0,40}ready|preparing|generating|saving|syncing|uploading|downloading|analy[sz]ing|đang (tải|xử lý|chuẩn bị|tạo|lưu|đồng bộ)|ActivityIndicator|ProgressIndicator|ProgressBar|ProgressView/i;
// B: chỗ kẹt AI đã bó tay trong lần chạy này (worker) → case sau kẹt y chỗ đó thì không hỏi lại
const assistGaveUp = new Map();
// Hook có sẵn (dùng khi src/hooks.js của dự án không khai báo cùng tên): vòng đời app — không cần viết code riêng
const lifecycleArg = (env) => (driver.isAndroid ? { appId: env.BUNDLE_ID } : { bundleId: env.BUNDLE_ID });
const appState = (env) => driver.execute('mobile: queryAppState', lifecycleArg(env)).catch(() => -1);
const STATE = { 0: 'không rõ', 1: 'không chạy', 2: 'chạy nền (treo)', 3: 'chạy nền', 4: 'đang mở' };
const notRunning = async ({ env }) => { const s = await appState(env); return { pass: s === 1 || s === 0, actual: STATE[s] || `trạng thái ${s}`, expected: 'không chạy' }; };
const terminate = async ({ env }) => { await driver.execute('mobile: terminateApp', lifecycleArg(env)).catch(() => {}); };
// Hook không kiểm tự động được trên iOS Simulator (không có API đọc): ghi "không kiểm tự động được — kiểm tay", không Blocked cả case
const NO_API = 'iOS không cho đọc trạng thái này qua Appium — kiểm tay';
export const UNVERIFIABLE_HOOKS = /^(notification_permission_(enabled|disabled|off|on|denied|granted|allowed)|app_data_cleared|user_plus_status_active|user_is_(free|plus|premium))$/i;
export const BUILTIN_HOOKS = {
  setup: {
    kill_app: terminate, terminate_app: terminate, close_app: terminate, force_close_app: terminate,
    uninstall_app: async ({ env }) => { await driver.execute('mobile: removeApp', lifecycleArg(env)); },
    launch_app: async ({ env }) => { await driver.execute('mobile: activateApp', lifecycleArg(env)); },
    background_app: async () => { await driver.execute('mobile: backgroundApp', { seconds: -1 }).catch(() => {}); },
  },
  check: {
    app_process_terminated_before_relaunch: notRunning, app_killed_before_relaunch: notRunning, app_not_in_memory: notRunning,
    app_went_to_background: async ({ env }) => { const s = await appState(env); return { pass: s === 2 || s === 3, actual: STATE[s] || `trạng thái ${s}`, expected: 'chạy nền' }; },
    app_in_background: async ({ env }) => { const s = await appState(env); return { pass: s === 2 || s === 3, actual: STATE[s] || `trạng thái ${s}`, expected: 'chạy nền' }; },
    app_not_running: notRunning, app_terminated: notRunning, app_killed: notRunning, app_closed: notRunning,
    app_running: async ({ env }) => { const s = await appState(env); return { pass: s === 4, actual: STATE[s] || `trạng thái ${s}`, expected: 'đang mở' }; },
    app_uninstalled: async ({ env }) => { const inst = await driver.execute('mobile: isAppInstalled', lifecycleArg(env)).catch(() => null); return { pass: inst === false, actual: inst ? 'vẫn còn cài' : inst === false ? 'đã gỡ' : 'không đọc được', expected: 'đã gỡ' }; },
    app_installed: async ({ env }) => { const inst = await driver.execute('mobile: isAppInstalled', lifecycleArg(env)).catch(() => null); return { pass: inst === true, actual: inst ? 'đã cài' : 'chưa cài', expected: 'đã cài' }; },
  },
};
// Một thao tác AI hỗ trợ → chữ cho tester đọc
export const assistLabel = (a) => ({ tapPoint: `Chạm "${a.name || ''}" (theo toạ độ ${Math.round(a.x)}%, ${Math.round(a.y)}%)`, use: `Dùng "${a.name || a.locator}" thay cho phần tử của script`, arrived: `Đã ở đúng màn (thấy "${a.name || a.locator}")`, tap: `Bấm "${a.name || a.locator}"`, type: `Nhập "${a.text}" vào "${a.name || a.locator}"`, swipe: `Vuốt ${a.text}`, back: 'Back', wait: 'Chờ 4s' }[a.action] || a.action);
const firstLine = (e) => String(e?.message || e).split('\n')[0];
// Lỗi không thấy phần tử để thao tác: dòng đầu nêu target + màn (report đặt bug đúng màn), dòng sau giữ lỗi gốc
const notFound = (target, screen) => (e) => {
  if (!/still not (existing|displayed)/.test(String(e?.message || e))) throw e; // tìm thấy nhưng thao tác lỗi → giữ lỗi gốc
  throw new Error(`Không thấy "${target}" trên màn ${screen}\n${String(e?.message || e)}`);
};

// Nút đóng trình duyệt trong app (SFSafariViewController)
const BROWSER_DONE = '-ios predicate string:type == "XCUIElementTypeButton" AND visible == 1 AND (name IN {"Done", "Close", "Xong", "Đóng"} OR label IN {"Done", "Close", "Xong", "Đóng"})';

// Thanh địa chỉ trình duyệt mở từ app: iOS SFSafariViewController / Safari (TextField "TabBarItemTitle", label "Address"),
// Android Chrome Custom Tab / Chrome (url_bar)
const URL_BAR = {
  ios: '-ios predicate string:(name IN {"TabBarItemTitle", "URL", "Address"} OR label IN {"Address", "URL"}) AND visible == 1',
  android: 'android=new UiSelector().resourceIdMatches(".*:id/(url_bar|location_bar_status_text|title_bar_url)")',
};
// Giá trị thanh địa chỉ có ký tự định hướng vô hình (U+200E…) và lúc đang tải chỉ có các ký tự đó
export const cleanUrl = (s) => String(s ?? '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
const urlKey = (s) => cleanUrl(s).toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
// URL đầy đủ của trang web đang hiển thị (iOS: Safari / SFSafariViewController qua Web Inspector — caps includeSafariInWebviews).
// Tab Safari cũ từ lần chạy trước vẫn còn → chỉ lấy tab visible. Luôn quay lại context ban đầu. Không đọc được → null
export async function visibleWebUrl() {
  if (driver.isAndroid) return null;
  let list;
  try { list = await driver.execute('mobile: getContexts', { waitForWebviewMs: 1500 }); } catch { return null; }
  const webs = (Array.isArray(list) ? list : []).filter((c) => c && c.id !== 'NATIVE_APP' && /mobilesafari|SafariViewService/i.test(c.bundleId || ''));
  if (!webs.length) return null;
  const back = await driver.getContext().catch(() => 'NATIVE_APP');
  try {
    for (const c of webs) {
      try {
        await driver.switchContext(c.id);
        const [href, vis] = await driver.execute('return [location.href, document.visibilityState]');
        if (vis === 'visible' && /^https?:/i.test(href)) return href;
      } catch {}
    }
    return null;
  } finally {
    await driver.switchContext(typeof back === 'string' ? back : 'NATIVE_APP').catch(() => {});
  }
}

// So URL đang hiện với URL mong đợi. Trình duyệt trong app (SFSafariViewController, Custom Tab) chỉ hiện tên miền
// → chỉ so được tên miền (hostOnly = true)
export function matchUrl(shown, expected) {
  const got = urlKey(shown);
  const want = urlKey(expected);
  if (!got) return { ok: false, hostOnly: false };
  if (got.includes('/')) return { ok: got === want, hostOnly: false };
  return { ok: got === want.split('/')[0], hostOnly: true };
}

// vars: biến của TC ({{tên}} trong Value) — khung tạo 1 object / case, fill() của case đọc cùng object
export function createSteps({ sa, logStep, snapshot, flowBug = () => {}, noteScreen = () => {}, summarize = async () => null, env = process.env, cwd = process.cwd(), tc = null, vars = {}, autoDismiss = true, watch = [] }) {
  const manual = env.MANUAL_FIX === '1' && !!env.HELP_DIR;
  // AI hỗ trợ khi chạy (Run option): bước thao tác / điều hướng kẹt → AI gỡ kẹt; điểm kiểm không bao giờ qua đây. Sửa tay (manual) được ưu tiên
  const assist = env.AI_ASSIST === '1' && !manual && !!env.QAPD_API && !!env.APP_ID;
  // Số từ biến môi trường: '0' là 0 thật (không bị đổi thành mặc định)
  const numEnv = (k, d) => (env[k] != null && env[k] !== '' && !Number.isNaN(Number(env[k])) ? Number(env[k]) : d);
  const aiTimeout = numEnv('AI_TIMEOUT_MS', 60000); // mỗi lần gọi AI tối đa (không để 1 bước treo vài phút)
  let aiCalls = 0;
  const budget = () => aiCalls++ < numEnv('AI_ASSIST_BUDGET', 8); // số lần gọi AI tối đa cho 1 case
  let directOk = false; // bước chặn luồng vừa rồi làm được ngay lần đầu (không nhờ tự tìm / bấm lại / AI) → mới ghi vào sơ đồ màn
  let lastTapAt = 0; // thời điểm lần bấm gần nhất (chữ thoáng qua chỉ tính nếu thấy SAU lần bấm này)
  let networkOff = false;
  let stepTarget = null; // target của bước k đang chạy (xem trackTarget)
  // Hộp thoại hệ thống ngoài test case (vd ATT bật lên lúc mở app): deny (mặc định) | allow | off
  const alertPolicy = String(env.SYSTEM_ALERT || 'smart').toLowerCase();
  let lastStep = null; // nav / gone không có step → dùng step của thao tác gần nhất
  // Bước bấm ngay trước (bấm được nhưng app không chuyển màn → hỏi / sửa chính bước bấm): { step, screen, target, sel, press }
  let lastTap = null;
  // Thao tác gần nhất đã làm xong — bước sau lỗi vì app sai màn thì gốc lỗi thường ở đây
  let prevAct = null;
  // Có nhập chữ ở màn hiện tại chưa (bước bấm sau đó dẫn sang màn khác chỉ đi lại được khi có dữ liệu nhập đó → sơ đồ màn đánh dấu)
  let typedHere = false;
  const act = (step, screen, keyword, target, value = '') => {
    lastStep = step;
    lastTap = null;
    prevAct = { step, screen, keyword, target };
    logStep({ kind: 'Action', step, screen, keyword, target, value, ok: true });
  };
  // Locator không thấy → tìm theo mô tả trên màn đang hiện: khớp chữ rõ thì dùng, không thì hỏi AI qua server (QAPD_API).
  // Tìm được → lưu như "Fix script" (lần sau dùng luôn, không tìm lại). AUTO_RESOLVE=0 để tắt
  // ai = false: chỉ nhận khớp chữ rõ ràng (chờ màn: AI chọn bừa 1 phần tử sẽ cho đi tiếp ở màn sai)
  async function autoResolve(kind, { screen, target }, { ai = true } = {}) {
    if (env.AUTO_RESOLVE === '0' || !target) return null;
    let xml;
    try { xml = await driver.getPageSource(); } catch { return null; }
    const els = screenElements(xml, driver.isAndroid);
    if (!els.length) return null;
    let loc = pickByText(target, els);
    let how = 'khớp chữ';
    // AI chọn phần tử chỉ khi bật "AI hỗ trợ" (tốn AI, kết quả có thể sai) — và có giới hạn thời gian
    if (!loc && ai && assist && budget()) {
      try {
        const r = await fetch(`${env.QAPD_API}/apps/${encodeURIComponent(env.APP_ID)}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target, screen, kind, elements: els }), signal: AbortSignal.timeout(aiTimeout) });
        loc = r.ok ? (await r.json()).locator : null;
        how = 'AI chọn';
      } catch { loc = null; }
    }
    // Không bao giờ tự bấm nút mua / thanh toán, dù khớp chữ hay AI chọn
    const el = loc && els.find((e) => e.locator === loc);
    if (el && HARD_BUY.test(`${el.name || ''} ${el.label || ''}`)) return null;
    return loc ? { loc, how } : null;
  }
  const info_ = (text) => { if (env.LIVE_STEPS) { try { fs.appendFileSync(env.LIVE_STEPS, `${JSON.stringify({ at: Date.now(), type: 'info', tc, text })}\n`); } catch {} } };

  const appArg = () => (driver.isAndroid ? { appId: env.BUNDLE_ID } : { bundleId: env.BUNDLE_ID });
  // Hook dự án (keyword Run setup / Run check): src/hooks.js của workspace — export setup / check = { tên: async ({ driver, vars, env }) => … }
  let hooks;
  const loadHooks = async () => {
    if (!hooks) {
      const file = path.join(cwd, 'src/hooks.js');
      hooks = fs.existsSync(file) ? await import(pathToFileURL(file).href) : {};
    }
    return hooks;
  };
  const check = async (step, screen, keyword, target, value, label, sel, actual, expected, anchor) => {
    lastStep = step;
    const ev = await snapshot(screen, { k: ui.loose(sel) }, anchor ? { k: ui.loose(anchor) } : {});
    sa.eq(step, label, actual, expected, ev.k, { keyword, target, value, screen });
    // Vừa đóng popup ngoài test case để đọc bước kiểm này → ghi "lệch so với script" (cùng chỗ với AI hỗ trợ) để tester quyết định
    if (pendingOverlay) {
      const p = pendingOverlay;
      pendingOverlay = null;
      const entry = { at: Date.now(), tc, step, screen, target, kind: 'overlay', source: p.how === 'AI chỉ nút đóng' ? 'ai' : 'tool', error: `Popup ngoài test case${p.title ? ` "${p.title}"` : ''} che màn khi kiểm "${target}"`, how: 'retry', actions: [{ action: 'tap', locator: p.locator, name: p.name, text: '', reason: `Đóng popup ngoài test case${p.title ? ` "${p.title}"` : ''} (${p.how}) rồi kiểm lại — kết quả kiểm sau khi đóng: ${actual === expected ? 'đạt' : 'vẫn sai'}` }], tapRow: null };
      if (env.REPORTS_DIR) { try { fs.appendFileSync(path.join(env.REPORTS_DIR, 'ai-assist.jsonl'), `${JSON.stringify(entry)}\n`); } catch {} }
    }
  };

  // Phần tử chỉ có toạ độ (point:… tester chọn trên ảnh, không có tên): bấm được nhưng không kiểm hiển thị được →
  // ghi bước bỏ qua (không Passed giả, không Blocked vì Appium từ chối selector)
  function pointOnly(step, screen, keyword, target) {
    logStep({ kind: 'Action', step, screen, keyword, target, value: '', ok: true, note: 'Bỏ qua: phần tử chỉ có toạ độ, không kiểm hiển thị được — kiểm tay hoặc thêm tên phần tử (accessibility id)' });
  }
  // Chữ không có trong page source (vẽ trong ảnh / biểu đồ / mockup, badge không có tên) → đọc trên ảnh chụp màn hình (OCR).
  //   → khung chữ (pt) để report khoanh đỏ, hoặc null (không thấy / máy không có OCR / OCR=off)
  async function seeOnScreen(text, tries = 2) {
    if (env.OCR === 'off' || !text) return null;
    try {
      if (!ocr.available()) return null;
      for (let i = 0; i < tries; i++) {
        const [shot, win] = await Promise.all([driver.takeScreenshot(), driver.getWindowSize()]);
        const f = ocr.findText(await ocr.ocrPng(Buffer.from(shot, 'base64')), text);
        if (f) return { x: f.x * win.width, y: f.y * win.height, width: f.w * win.width, height: f.h * win.height };
        if (i < tries - 1) await sleep(700);
      }
    } catch {}
    return null;
  }
  // Tờ xin quyền Health (không phải alert, nằm trong cây phần tử): "Turn On All" rồi "Allow"
  async function healthSheet() {
    const on = '-ios predicate string:type == "XCUIElementTypeButton" AND (name == "Turn On All" OR label == "Turn On All" OR name == "Bật tất cả")';
    if (!(await ui.exists(on, 500))) return false;
    await ui.tap(on);
    const ok = '-ios predicate string:type == "XCUIElementTypeButton" AND (name == "Allow" OR label == "Allow" OR name == "Cho phép")';
    if (await ui.exists(ok, 2000)) await ui.tap(ok);
    logStep({ kind: 'Action', step: lastStep, screen: 'Quyền Health', keyword: 'Tap', target: 'Turn On All → Allow', value: '', ok: true, note: 'Tờ xin quyền Health không có trong test case' });
    return true;
  }
  // Có hộp thoại hệ thống đang che màn → đóng theo SYSTEM_ALERT, ghi bước (không phải bug). true nếu đã đóng
  async function dismissUnexpected() {
    if (alertPolicy === 'off') return false;
    const buttons = await alertButtons();
    // Bước ĐANG CHẠY nhắm vào chính nút của hộp thoại này (Tap "Allow", chờ / kiểm nút "Don't Allow"…) → để bước đó tự làm.
    // Hộp thoại bật lên ở bước khác vẫn tự đóng như thường, kể cả khi case có bước xử lý một hộp thoại khác ở chỗ khác
    if (stepTarget && buttons.some((b) => normBtn(b) === normBtn(stepTarget))) return false;
    const pick = buttons.length ? (alertPolicy === 'smart' ? smartPick(buttons) : pickAlertButton(buttons, alertPolicy)) : null;
    if (!pick) return (alertPolicy === 'smart' || alertPolicy === 'allow') && !driver.isAndroid ? healthSheet() : false;
    if (driver.isAndroid) await ui.tap(`android=new UiSelector().text(${JSON.stringify(pick)})`);
    else await driver.execute('mobile: alert', { action: 'accept', buttonLabel: pick });
    logStep({ kind: 'Action', step: lastStep, screen: 'Hộp thoại hệ thống', keyword: 'Tap', target: pick, value: '', ok: true, note: 'Hộp thoại hệ thống không có trong test case' });
    return true;
  }
  // Chờ phần tử; hộp thoại hệ thống ngoài test case bật lên giữa chừng (vd ATT sau khi bấm Get Started) → đóng ngay rồi chờ tiếp,
  // không đợi hết giờ mới đóng (mỗi lần mất ~15s). Case có bước xử lý hộp thoại (autoDismiss = false) → chờ như cũ, đi theo test case
  // Phát hiện kẹt sớm (EARLY_STUCK=0 để tắt): chờ ≤ 20s mà màn đứng yên (page source không đổi) ≥ STUCK_MS và không có dấu hiệu
  //   đang tải → kết luận luôn, không chờ hết giờ (app đã đứng ở màn khác thì chờ thêm cũng vô ích). Chờ dài hơn 20s (tác vụ chạy lâu:
  //   import, AI, tải mạng) vẫn chờ đủ. Màn có animation / đồng hồ chạy → page source đổi liên tục → không bao giờ kết luận sớm.
  async function waitEl(sel, timeout = 15000, { early: earlyOk = true } = {}) {
    const dismiss = alertPolicy !== 'off';
    // Thời gian chờ tester tự đặt (Wait until displayed N giây) → chờ đủ, không kết luận sớm
    const early = earlyOk && env.EARLY_STUCK !== '0' && timeout <= 20000;
    if ((!dismiss && !early) || timeout <= 2000) return ui.el(sel, timeout);
    const stuckMs = Number(env.STUCK_MS) || 5000;
    let prev = null;
    let stable = 0;
    let waited = 0;
    // Đếm theo thời gian đã chờ từng lượt (không theo đồng hồ) → luôn dừng, kể cả khi tìm phần tử báo lỗi ngay
    for (let left = timeout; ; ) {
      const slice = Math.max(300, Math.min(1500, left));
      try {
        return await ui.el(sel, slice);
      } catch (e) {
        left -= slice;
        waited += slice;
        if (left <= 0 || !/still not existing|timed? ?out/i.test(String(e?.message || e))) throw e;
        if (early) {
          const src = await Promise.resolve().then(() => driver.getPageSource()).catch(() => null);
          stable = src && src === prev ? stable + slice : 0;
          prev = src;
          if (stable >= stuckMs && waited >= stuckMs + 1500 && !LOADING.test(src)) throw new Error(`${firstLine(e)} — màn đứng yên ${Math.round(stable / 1000)}s, không đang tải → kết luận sớm`);
        }
      }
      if (dismiss && (await dismissUnexpected())) { stable = 0; prev = null; }
    }
  }
  // Đọc giá trị điểm kiểm; sai mà có hộp thoại hệ thống che → đóng rồi đọc lại
  // Đọc giá trị điểm kiểm; sai mà có hộp thoại hệ thống che → đóng rồi đọc lại.
  // Vẫn KHÔNG THẤY phần tử cần kiểm (null / false / rỗng — không phải "thấy nhưng sai chữ") mà màn đang có popup trong app ngoài
  // test case (tờ mời đăng nhập, đánh giá, khuyến mãi…) → đóng popup như người test tay rồi đọc lại 1 lần. Không đổi cách so kết quả.
  const measure = async (get, ok) => {
    let v = await get();
    if (!ok(v) && (await dismissUnexpected())) v = await get();
    if (!ok(v) && (v == null || v === false || v === '') && (await closeOverlay())) v = await get();
    return v;
  };
  // Đóng màn chặn (paywall / quảng cáo / popup) theo yêu cầu của test case: nút đóng rõ ràng (Close, X, Not now…) → bấm; không có nút đó
  // và bật AI hỗ trợ → AI chỉ nút đóng (kể cả chạm theo toạ độ — nút X vẽ bằng ảnh); không bao giờ bấm mua. Không có màn chặn → coi như đã đóng
  async function dismissBlocker(step, screen, name) {
    await dismissUnexpected();
    for (let i = 0; i < 3; i++) {
      let xml = '';
      try { xml = await driver.getPageSource(); } catch {}
      const els = screenElements(xml, driver.isAndroid);
      const label = (e) => String(e.name || e.label || '').trim();
      const closer = els.find((e) => OVERLAY_CLOSE.test(label(e)) && !HARD_BUY.test(label(e)));
      if (closer) {
        await ui.tap(closer.locator, 2000);
        info_(`${name}: bấm "${label(closer)}" để đóng`);
        await sleep(1200);
        continue; // có thể còn lớp chặn khác (paywall → ưu đãi giảm giá)
      }
      if (!assist || !budget()) break;
      let a = null;
      try {
        const win = await Promise.resolve().then(() => driver.getWindowRect()).then((w) => ({ width: w.width, height: w.height })).catch(() => null);
        let shot = null;
        if (env.REPORTS_DIR) { const d = path.join(env.REPORTS_DIR, 'ai-assist'); fs.mkdirSync(d, { recursive: true }); shot = path.join(d, `${Date.now()}.png`); await browser.saveScreenshot(shot).catch(() => { shot = null; }); }
        const r = await fetch(`${env.QAPD_API}/apps/${encodeURIComponent(env.APP_ID)}/assist`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tc, step, screen, target: '', kind: 'overlay', error: `Test case yêu cầu đóng màn chặn (${name}) — paywall / quảng cáo / popup. Chỉ chỉ ra nút ĐÓNG (X, Close, Not now…), không bao giờ nút mua; không có màn chặn → giveUp`, elements: els, shot, win, tried: [] }), signal: AbortSignal.timeout(aiTimeout) });
        a = r.ok ? await r.json() : null;
      } catch {}
      if (a?.action === 'tap' && a.locator) await ui.tap(a.locator, 2000);
      else if (a?.action === 'tapPoint') await tapPoint(`point:${Number(a.x) / 100},${Number(a.y) / 100}`);
      else break;
      info_(`${name}: AI chỉ nút đóng "${a.name || ''}"${a.reason ? ` — ${a.reason}` : ''}`);
      await sleep(1200);
    }
  }
  // Popup trong app che màn (không phải hộp thoại hệ thống): tìm nút đóng rõ ràng (X / Close / Not now…) khi màn có dấu hiệu popup ngoài
  // luồng; không chắc thì nhờ AI (khi bật AI hỗ trợ) chỉ ra nút đóng — AI chỉ được đóng, không bấm mua / đăng nhập. CLOSE_POPUPS=0 để tắt
  let overlayClosed = 0;
  // Chữ thoáng qua test case cần kiểm (Importing…, Loading…): xem page source ngay sau mỗi lần bấm, thấy thì nhớ thời điểm —
  // tới bước kiểm mà chữ đã qua (app chạy nhanh) vẫn tính là đã hiện. Chỉ chạy khi case có chữ kiểu này (khung truyền `watch`)
  const seenAt = new Map();
  const norm = (t) => String(t).replace(/\.\.\./g, '…').replace(/\s+/g, ' ').trim().toLowerCase();
  async function peek() {
    const left = watch.filter((w) => !seenAt.has(w));
    if (!left.length) return;
    let src = '';
    try { src = norm((await driver.getPageSource()).replace(/&#10;/g, ' ').replace(/&amp;/g, '&')); } catch { return; }
    for (const w of left) if (src.includes(norm(w))) seenAt.set(w, Date.now());
  }
  const isWatched = (t) => watch.some((w) => norm(w) === norm(t));
  // Bước kiểm không làm được (chữ thoáng qua không kịp thấy, hook không có API): ghi riêng — report để vào mục "không kiểm được", không thành bug
  function noteUnverified(x) {
    if (!env.REPORTS_DIR) return;
    try { fs.appendFileSync(path.join(env.REPORTS_DIR, 'unverified.jsonl'), `${JSON.stringify({ at: Date.now(), tc, ...x })}\n`); } catch {}
  }
  let pendingOverlay = null; // popup vừa đóng → bước kiểm kế tiếp ghi lệch so với script
  async function closeOverlay() {
    if (env.CLOSE_POPUPS === '0' || overlayClosed >= 3) return false;
    let xml = '';
    try { xml = await driver.getPageSource(); } catch { return false; }
    const els = screenElements(xml, driver.isAndroid);
    const label = (e) => String(e.name || e.label || '').trim();
    const hint = els.find((e) => OVERLAY_HINT.test(label(e)));
    const closers = els.filter((e) => OVERLAY_CLOSE.test(label(e)) && !BUY_WORD.test(label(e)));
    let pick = hint && closers.length ? { locator: closers[0].locator, name: label(closers[0]), how: 'nút đóng' } : null;
    if (!pick && assist && hint && !overlayGaveUp.has(label(hint)) && budget()) {
      try {
        const r = await fetch(`${env.QAPD_API}/apps/${encodeURIComponent(env.APP_ID)}/assist`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tc, step: lastStep, screen: prevAct?.screen || '', target: '', kind: 'overlay', error: 'Bước kiểm không thấy phần tử cần kiểm — có thể bị popup che', elements: els, tried: [] }), signal: AbortSignal.timeout(aiTimeout) });
        const a = r.ok ? await r.json() : null;
        if (a?.action === 'tap' && a.locator && !BUY_WORD.test(a.name || '')) pick = { locator: a.locator, name: a.name || a.locator, how: 'AI chỉ nút đóng', reason: a.reason };
      } catch {}
      if (!pick) overlayGaveUp.add(label(hint));
    }
    if (!pick) return false;
    try { await ui.tap(pick.locator, 2000); } catch { return false; }
    overlayClosed++;
    await sleep(800);
    const title = hint ? label(hint) : pick.reason || '';
    pendingOverlay = { title: hint ? label(hint) : '', name: pick.name, locator: pick.locator, how: pick.how };
    const note = `Popup ngoài test case${title ? `: "${title}"` : ''} che màn khi kiểm — đã đóng (${pick.how}) rồi kiểm lại. Nếu popup này không đúng thiết kế, log bug riêng`;
    info_(`Đóng popup ngoài test case${title ? ` "${title}"` : ''} (bấm "${pick.name}")`);
    logStep({ kind: 'Action', step: lastStep, screen: 'Popup ngoài test case', keyword: 'Tap', target: pick.name, value: '', ok: true, note });
    return true;
  }

  // Màn lúc lỗi (ảnh + màn đang hiện) → bug "chặn luồng nhưng đã cho chạy tiếp"
  const evidence = async () => {
    const dir = path.join(env.REPORTS_DIR || env.HELP_DIR, 'screenshots');
    fs.mkdirSync(dir, { recursive: true });
    let shot = path.join(dir, `${Date.now()}-flow.png`);
    await browser.saveScreenshot(shot).catch(() => { shot = null; });
    return { shot, seen: await summarize() };
  };

  // Hỏi tester: ghi help.json (+ ảnh, page source, dòng live), chờ answer.json cùng id; giữ phiên Appium khi chờ lâu
  // sel: locator bước đang dùng → server biết bước cần màn nào trong locator map (so với màn đang hiện để báo "sai màn")
  async function ask(kind, { step, screen, target }, err, sel = null) {
    const dir = env.HELP_DIR;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const shot = path.join(dir, 'help.png');
    const source = path.join(dir, 'help.xml');
    await browser.saveScreenshot(shot).catch(() => {});
    fs.writeFileSync(source, await browser.getPageSource().catch(() => ''));
    fs.writeFileSync(path.join(dir, 'help.json'), JSON.stringify({ id, tc, step, screen, target, kind, error: firstLine(err), choices: CHOICES[kind], shot, source, sel: typeof sel === 'string' ? sel : null, prev: prevAct }));
    if (env.LIVE_STEPS) fs.appendFileSync(env.LIVE_STEPS, `${JSON.stringify({ at: Date.now(), type: 'help', tc, id, step, screen, target })}\n`);
    const poll = Number(env.HELP_POLL_MS) || 500;
    const keepAlive = Number(env.HELP_KEEPALIVE_MS) || 30000;
    const answerFile = path.join(dir, 'answer.json');
    for (let last = Date.now(); ; await sleep(poll)) {
      try {
        const a = JSON.parse(fs.readFileSync(answerFile, 'utf8'));
        if (a.id === id) {
          for (const f of [answerFile, path.join(dir, 'help.json'), path.join(dir, 'help.answered.json')]) fs.rmSync(f, { force: true });
          return a;
        }
      } catch {}
      if (Date.now() - last >= keepAlive) {
        last = Date.now();
        await driver.getWindowRect().catch(() => {});
      }
    }
  }

  // Bước chặn luồng: run(sel) làm thao tác (lỗi → ném). Trả true nếu đã làm, false nếu tester Skip.
  // opts (nav / gone ngay sau một bước bấm): ask = { kind, info, prefix } hỏi về bước bấm; retry() / use(loc) bấm lại / bấm phần tử khác rồi chờ; key = khoá lưu (Use / Fix)
  async function guarded(kind, info, sel, run, opts = {}) {
    const key = `${info.screen}|${info.target}`;
    const saveKey = opts.key || key;
    const start = readOverrides(cwd)[key] || sel;
    const retryRun = opts.retry || (() => run(start));
    const useRun = opts.use || run;
    let err;
    directOk = false;
    try {
      await run(start);
      directOk = true;
      return true;
    } catch (e) {
      err = e;
    }
    // Phần tử hết hạn giữa chừng (app vẽ lại màn) → ném luôn để guardApi làm lại cả bước (không tốn AI / tự tìm)
    if (STALE_RE.test(String(err?.message || err))) throw err;
    // Hộp thoại hệ thống ngoài test case che màn → đóng rồi làm lại 1 lần (k.alert là bước chủ động kiểm hộp thoại → không đóng)
    if (kind !== 'alert' && (await dismissUnexpected())) {
      try {
        await run(start);
        return true;
      } catch (e) {
        err = e;
      }
    }
    // Bấm / nhập mà không thấy phần tử theo locator → tìm theo mô tả trên màn đang hiện (cách SimUtil), được thì lưu cho lần sau
    // Chờ màn (Wait until displayed / Verify screen) hết giờ → tìm chữ đặc trưng của màn trên màn đang hiện (chỉ khớp chữ, không AI):
    //   màn đã tới nhưng chữ đổi nhẹ (build mới) → đi tiếp, ghi lệch locator; Verify text phía sau vẫn bắt chữ sai
    const navMiss = kind === 'nav' && /^Không tới được màn/.test(firstLine(err));
    if ((['tap', 'enter'].includes(kind) && /^Không thấy "/.test(firstLine(err))) || navMiss) {
      const want = navMiss && info.target === '(screen)' ? ui.selText(start) : info.target;
      const found = await autoResolve(kind, { ...info, target: want }, { ai: !navMiss });
      if (found && found.loc !== start) {
        try {
          await run(found.loc);
          ui.noteDrift({ screen: info.screen, target: want, locator: start, found: found.loc, how: `tự tìm (${found.how})`, kind });
          // Chờ màn: chỉ dùng lần này, không lưu (saveKey có thể là của bước bấm trước; lưu thì các run sau không còn báo lệch)
          if (navMiss) {
            info_(`Màn ${info.screen}: không thấy "${want}" đúng như locator, tìm thấy chữ gần giống → ${found.loc} — đi tiếp, chỉ dùng lần này (cập nhật Locator map)`);
            return true;
          }
          // Đã có locator lưu cho bước này (tester Fix / lần tự tìm trước) → không ghi đè: app có thể đang ở trạng thái khác
          const saved = !!readOverrides(cwd)[saveKey] || found.how === 'AI chọn'; // AI chọn: chỉ dùng lần này, không lưu
          if (!saved) saveOverride(cwd, saveKey, found.loc, `tự tìm (${found.how})`);
          info_(`Tự tìm "${info.target}" trên màn ${info.screen} (${found.how}) → ${found.loc}${saved ? ' — chỉ dùng lần này (giữ locator đã lưu)' : ' — đã lưu cho lần sau'}`);
          return true;
        } catch {}
      }
    }
    // (Sau khi tự tìm theo chữ không ra) Bấm xong mà app chưa chuyển màn, nút vừa bấm vẫn đang hiện → bấm lại 1 lần (lần trước rơi vào lúc màn còn chuyển cảnh,
    // như người test tay bấm lại). Không dùng AI, ghi log để biết
    if (kind === 'nav' && opts.retry && lastTap?.kind === 'tap' && env.AUTO_RETAP !== '0' && typeof lastTap.sel === 'string' && !isPoint(lastTap.sel) && (await ui.visible(lastTap.sel, 500)) && !LOADING.test(await Promise.resolve().then(() => driver.getPageSource()).catch(() => ''))) {
      info_(`Bấm lại "${lastTap.target}" trên màn ${lastTap.screen}: lần bấm trước app chưa chuyển sang ${info.screen}`);
      try {
        await opts.retry();
        return true;
      } catch (e) {
        err = e;
      }
    }
    if (assist && (await aiAssist(kind, info, err, { run, start, useRun, opts }))) return true;
    if (!manual) throw err;
    // Màn ngay lúc lỗi — không chụp lúc tester trả lời (app chậm có thể đã sang màn khác)
    const ev = await evidence();
    const remembered = used.get(saveKey);
    if (remembered) {
      try {
        await useRun(remembered);
        flowBug({ ...info, error: firstLine(err), ...ev });
        return true;
      } catch {}
    }
    for (;;) {
      const a = opts.ask ? await ask(opts.ask.kind, opts.ask.info, new Error(`${opts.ask.prefix} — ${firstLine(err)}`), opts.ask.sel) : await ask(kind, info, err, start);
      if (a.action === 'block') {
        noteScreen(ev); // afterTest không đọc được màn thì report dùng màn này
        // Tester xác nhận app đang ở màn khác → lỗi ghi rõ màn thật + bước trước (gốc lỗi), vẫn đúng mẫu "Không tới được màn …"
        if (a.wrongScreen) {
          const p = a.prev || prevAct;
          throw new Error(`Không tới được màn ${info.screen}: app đang ở màn "${a.wrongScreen}"${p ? ` sau step ${p.step} (${p.keyword}${p.target ? ` "${p.target}"` : ''} trên màn ${p.screen})` : ''}\n${firstLine(err)}`);
        }
        throw err;
      }
      if (a.action === 'skip') {
        flowBug({ ...info, error: firstLine(err), ...ev });
        return false;
      }
      try {
        await (a.action === 'retry' ? retryRun() : useRun(a.locator));
      } catch {
        continue; // vẫn không làm được → hỏi lại (giữ lỗi gốc cho bug)
      }
      if (a.action === 'use') {
        used.set(saveKey, a.locator);
        flowBug({ ...info, error: firstLine(err), ...ev });
      }
      if (a.action === 'fix') saveOverride(cwd, saveKey, a.locator, a.element);
      return true;
    }
  }

  // AI hỗ trợ: tối đa AI_ASSIST_MAX (mặc định 4) thao tác cho 1 lần kẹt. Sau mỗi thao tác thử lại đúng bước của script.
  // Gỡ được → ghi "lệch so với script" (REPORTS_DIR/ai-assist.jsonl + live) để tester chọn Áp dụng vào test case / Bỏ qua.
  async function aiAssist(kind, info, err, { run, start, useRun, opts }) {
    const max = numEnv('AI_ASSIST_MAX', 4);
    const dir = env.REPORTS_DIR ? path.join(env.REPORTS_DIR, 'ai-assist') : null;
    if (dir) fs.mkdirSync(dir, { recursive: true });
    const done = [];
    const tried = [];
    const error = firstLine(err);
    const tapRow = opts.ask ? { ...opts.ask.info, kind: opts.ask.kind } : null; // kẹt ở chờ màn sau bước bấm → dòng bấm là gốc
    const memo = `${kind}|${info.screen}|${info.target}|${error.replace(/\d+(\.\d+)?s\b/g, '')}`;
    const seen = assistGaveUp.get(memo);
    if (seen) {
      info_(`AI hỗ trợ: chỗ kẹt này AI đã xem ở ${seen.tc} — "${seen.reason}" → không hỏi lại`);
      return false;
    }
    info_(`AI hỗ trợ: kẹt ở ${info.screen}${info.target && info.target !== '(screen)' ? ` "${info.target}"` : ''} — nhờ AI xem màn`);
    const record = (how) => {
      const entry = { at: Date.now(), tc, step: info.step ?? lastStep, screen: info.screen, target: info.target, kind, error, how, actions: done, tapRow };
      if (env.REPORTS_DIR) { try { fs.appendFileSync(path.join(env.REPORTS_DIR, 'ai-assist.jsonl'), `${JSON.stringify(entry)}\n`); } catch {} }
      const what = done.map((a) => assistLabel(a)).join(' → ');
      info_(`AI hỗ trợ: ${what} — đi tiếp (ghi lệch so với script)`);
      logStep({ kind: 'Action', step: entry.step, screen: info.screen, keyword: 'AI hỗ trợ', target: what, value: '', ok: true, note: `Lệch so với script: ${done.map((a) => a.reason).filter(Boolean).join(' / ')}` });
      return true;
    };
    for (let i = 0; i < max; i++) {
      let xml = '';
      try { xml = await driver.getPageSource(); } catch {}
      const elements = screenElements(xml, driver.isAndroid);
      let shot = null;
      if (dir) { shot = path.join(dir, `${Date.now()}.png`); await browser.saveScreenshot(shot).catch(() => { shot = null; }); }
      let a = null;
      const win = await Promise.resolve().then(() => driver.getWindowRect()).then((w) => ({ width: w.width, height: w.height })).catch(() => null);
      if (!budget()) { info_('AI hỗ trợ: đã hết lượt gọi AI cho case này (AI_ASSIST_BUDGET) — giữ lỗi của script'); return false; }
      try {
        const r = await fetch(`${env.QAPD_API}/apps/${encodeURIComponent(env.APP_ID)}/assist`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tc, step: info.step ?? lastStep, screen: info.screen, target: info.target, kind, error, elements, shot, tried, win }), signal: AbortSignal.timeout(aiTimeout) });
        a = r.ok ? await r.json() : null;
      } catch { a = null; }
      // Câu trả lời bị tool từ chối (phần tử không có, trông như nút mua…) → báo lý do cho AI và cho thử lại (trong giới hạn số lần)
      if (a?.action === 'refused') {
        tried.push(`(bị từ chối: ${a.reason})`);
        info_(`AI hỗ trợ: câu trả lời bị từ chối — ${a.reason} — hỏi lại`);
        continue;
      }
      if (!a || a.action === 'giveUp') {
        if (a?.action === 'giveUp' && !done.length) assistGaveUp.set(memo, { tc, reason: String(a.reason || '').slice(0, 160) });
        info_(`AI hỗ trợ: dừng — ${a?.reason || 'không gọi được AI'}`);
        return false;
      }
      if (kind === 'nav' && a.action === 'use') a.action = 'arrived';
      a.shot = shot;
      tried.push(assistLabel(a));
      try {
        if (a.action === 'use') { await useRun(a.locator); done.push(a); return record('use'); }
        if (a.action === 'arrived') {
          // "Đã ở đúng màn" phải có bằng chứng: phần tử AI chỉ ra khớp tên màn / dấu hiệu màn trong script (≥ 0.85), không phải phần tử bất kỳ
          const want = [ui.selText(start), info.screen, info.target].filter((x) => x && x !== '(screen)');
          const name = String(a.name || ui.selText(a.locator) || '').toLowerCase();
          const close = want.some((w) => { const x = String(w).toLowerCase(); return name === x || (name.length > 3 && (name.includes(x) || x.includes(name))) || dice(name, x) >= 0.85; });
          if (kind !== 'nav' || !close || !(await ui.exists(a.locator, 3000))) throw new Error('không ở màn đích');
          done.push(a);
          return record('arrived');
        }
        if (a.action === 'tap') await ui.tap(a.locator, 3000);
        else if (a.action === 'tapPoint') await tapPoint(`point:${Number(a.x) / 100},${Number(a.y) / 100}`);
        else if (a.action === 'type') await ui.typeInto(a.locator, a.text);
        else if (a.action === 'back') await (driver.isAndroid ? driver.back() : ui.tap(BACK_BUTTON, 3000));
        else if (a.action === 'swipe') await swipeDir(a.text);
        else if (a.action === 'wait') await sleep(4000);
        done.push(a);
      } catch {
        tried[tried.length - 1] += ' (không làm được)';
        continue;
      }
      await sleep(800);
      await dismissUnexpected();
      try {
        await run(start);
        return record('retry');
      } catch {}
    }
    info_(`AI hỗ trợ: thử ${max} lần không gỡ được — giữ lỗi của script`);
    return false;
  }
  async function swipeDir(dir) {
    const { width: w, height: h } = await driver.getWindowSize();
    const [sx, sy, ex, ey] = { up: [0.5, 0.7, 0.5, 0.3], down: [0.5, 0.3, 0.5, 0.7], left: [0.8, 0.5, 0.2, 0.5], right: [0.2, 0.5, 0.8, 0.5] }[dir] || [0.5, 0.7, 0.5, 0.3];
    await ui.drag(sx * w, sy * h, ex * w, ey * h);
  }

  // nav / gone ngay sau một bước bấm: lỗi thuộc về bước bấm (bấm được nhưng app không chuyển) → hỏi / sửa bước bấm
  const afterTap = (screen, wait) => {
    const t = lastTap;
    if (!t) return {};
    return {
      ask: { kind: t.kind, info: { step: t.step, screen: t.screen, target: t.target }, prefix: `${t.verb} không chuyển sang màn ${screen}`, sel: t.sel },
      retry: async () => { await t.press(t.sel); await wait(); },
      use: async (loc) => { await t.press(loc); await wait(); },
      key: `${t.screen}|${t.target}`,
    };
  };

  // Bước đang chạy nhắm vào phần tử nào (target của k.xxx(step, screen, target…); nav: chữ của dấu hiệu màn) → dismissUnexpected không
  // tự đóng đúng hộp thoại mà bước đó cần thao tác
  const trackTarget = (api) => {
    for (const [name, fn] of Object.entries(api)) {
      if (typeof fn !== 'function' || name === 'fill' || name === 'byText' || name === 'textOf') continue;
      api[name] = function (...args) {
        stepTarget = name === 'nav' ? ui.selText(args[1]) : typeof args[2] === 'string' ? args[2] : null;
        return fn.apply(this, args);
      };
    }
    return api;
  };
  return guardApi(trackTarget({
    byText,
    textOf,
    // Tap: sel mặc định = theo chữ của target
    //   Không có sel → đoán theo chữ của target, chỉ chờ 1,5s rồi tự tìm theo mô tả (target thường là lời tả, không phải chữ trên màn)
    //   Target là nút của hộp thoại theo dõi (ATT) → xử lý như hộp thoại hệ thống (không có thì đi tiếp)
    async tap(step, screen, target, sel) {
      if (!sel && TRACKING.test(String(target))) return this.alert(step, screen, target, { target });
      const guess = !sel;
      sel ||= byText(target);
      const press = (s) => (isPoint(s) ? tapPoint(s) : (guess && s === byText(target) ? ui.tap(s, 1500) : waitEl(s).then((e) => e.click())).catch(notFound(target, screen)));
      if (!(await guarded('tap', { step, screen, target }, sel, press))) return;
      act(step, screen, 'Tap', target);
      lastTapAt = Date.now();
      if (watch.length) await peek();
      lastTap = { step, screen, target, sel: used.get(`${screen}|${target}`) || readOverrides(cwd)[`${screen}|${target}`] || sel, press, verb: `Nhấn "${target}"`, kind: 'tap', typed: typedHere };
    },
    // Back: Android phím Back; iOS bấm nút Back / ← của màn (không vuốt — app có thể tắt vuốt mép).
    // Không thấy nút / không lùi về màn (k.nav sau đó lỗi) → hỏi / sửa chính bước Back (Use / Fix lưu nút khác cho bước này)
    async back(step, screen, target = 'Back') {
      const press = (s) => (s === ANDROID_BACK ? driver.back() : isPoint(s) ? tapPoint(s) : ui.tap(s).catch(notFound(target, screen)));
      const sel = driver.isAndroid ? ANDROID_BACK : BACK_BUTTON;
      if (!(await guarded('back', { step, screen, target }, sel, press))) return;
      act(step, screen, 'Back', target);
      lastTap = { step, screen, target, sel: used.get(`${screen}|${target}`) || readOverrides(cwd)[`${screen}|${target}`] || sel, press, verb: 'Nhấn Back', kind: 'back' };
    },
    async enter(step, screen, target, value, sel) {
      if (await guarded('enter', { step, screen, target }, sel, (s) => ui.typeInto(s, value).catch(notFound(target, screen)))) { act(step, screen, 'Enter', target, value); typedHere = true; }
    },
    // Nav (Verify screen): chờ phần tử đặc trưng của màn đích. what = mô tả phần tử, vd 'nút "Continue"', 'tiêu đề "Log In"'
    async nav(screen, sel, what, timeout = 15000) {
      // Dấu hiệu nhận màn chỉ có toạ độ (không có tên) → không chờ được phần tử: chờ màn đứng yên rồi đi tiếp, ghi chú (không Blocked giả)
      if (isPoint(sel)) {
        const end = Date.now() + Math.min(timeout, 5000);
        for (let prev = null; Date.now() < end; await new Promise((r) => setTimeout(r, 400))) {
          const src = await driver.getPageSource().catch(() => null);
          if (src && src === prev) break;
          prev = src;
        }
        logStep({ kind: 'Action', step: lastStep, screen, keyword: 'Verify screen', target: screen, value: '', ok: true, note: `Không kiểm được đã tới màn ${screen}: dấu hiệu nhận màn (${what}) chỉ có toạ độ — dùng tiêu đề màn` });
        return;
      }
      const wait = (s) => waitEl(s, timeout).catch(() => { throw new Error(`Không tới được màn ${screen}: không thấy ${what} sau ${timeout / 1000}s`); });
      await guarded('nav', { step: lastStep, screen, target: '(screen)' }, sel, wait, afterTap(screen, () => wait(sel)));
      // Tới được màn sau một bước bấm → ghi cạnh vào sơ đồ màn (dùng để điều hướng khi case trước lỗi)
      const t = lastTap;
      if (t && !t.recorded && t.kind === 'tap' && t.screen !== screen && directOk) {
        t.recorded = true;
        recordEdge({ from: t.screen, to: screen, sel: t.sel, target: t.target, arrive: { sel, what }, needsInput: !!t.typed }, { cwd });
      }
      typedHere = false;
    },
    // Verify displayed; anchor: phần tử ngay trên chỗ lẽ ra hiện (report khoanh chỗ đó khi thiếu)
    async shown(step, screen, target, label, sel = byText(target), { anchor, timeout = 3000 } = {}) {
      if (isPoint(sel)) return pointOnly(step, screen, 'Verify displayed', target);
      // Không có trong page source → đọc chữ trên ảnh (chữ trong hình / biểu đồ vẫn là "hiển thị")
      let seen = null;
      const read = async () => {
        if (await ui.exists(sel, timeout)) return true;
        seen = await seeOnScreen(target);
        return Boolean(seen);
      };
      let v = await measure(read, (x) => x === true);
      if (v !== true && isWatched(target)) {
        await peek();
        const w = watch.find((x) => norm(x) === norm(target));
        if (seenAt.has(w) && seenAt.get(w) >= lastTapAt) v = true;
        else {
          logStep({ kind: 'Action', step, screen, keyword: 'Verify displayed', target, value: '', ok: true, note: `Không kiểm được: chữ thoáng qua "${target}" không kịp thấy (app chạy quá nhanh) — kiểm tay` });
          noteUnverified({ step, screen, target, label, why: `Chữ thoáng qua "${target}" không kịp thấy` });
          return;
        }
      }
      await check(step, screen, 'Verify displayed', target, '', label, seen || sel, v, true, seen ? undefined : anchor);
    },
    // within (giây, từ Value): chờ ngược — phần tử xuất hiện trong N giây → sai; hết N giây không thấy → đúng (kiểm "không chuyển màn")
    async notShown(step, screen, target, label, sel = byText(target), { within } = {}) {
      if (isPoint(sel)) return pointOnly(step, screen, 'Verify not displayed', target);
      const ms = Number(within) > 0 ? Number(within) * 1000 : 1500;
      // Không có trong page source nhưng chữ vẫn vẽ trên màn (trong hình) → vẫn là đang hiển thị
      let seen = null;
      const read = async () => {
        if (await ui.exists(sel, ms)) return true;
        seen = await seeOnScreen(target, 1);
        return Boolean(seen);
      };
      const v = await measure(read, (x) => x === false);
      await check(step, screen, 'Verify not displayed', target, within ? String(within) : '', label, seen || sel, v, false);
    },
    // Verify text: compare = cột Compare (equals mặc định, contains, regex, number, date:…; xem compare.js)
    //   sel là mảng → câu bị tách nhiều phần tử: ghép chữ từng phần (cách 1 dấu cách); strip: ký tự trang trí bỏ đi trước khi so (vd '✨')
    //   actual: tự truyền chữ đã đọc (trường hợp đặc biệt)
    //   Chữ đang đổi (slide tự chuyển, animation, đang tải) → đọc lại tới khi khớp, tối đa timeout; hết giờ thì so lần đọc cuối
    async text(step, screen, target, label, sel, expected, { compare = 'equals', strip = '', actual, timeout = 3000 } = {}) {
      const sels = Array.isArray(sel) ? sel : [sel];
      const read = async () => {
        let got = actual;
        if (got === undefined) {
          const parts = [];
          for (const s of sels) parts.push(await textOf(s));
          got = parts.some((p) => p != null) ? parts.filter((p) => p != null).join(' ') : null;
        }
        if (got != null && strip) got = [...strip].reduce((s, ch) => s.split(ch).join(''), String(got));
        return got != null ? String(got).replace(/\s+/g, ' ').trim() : null;
      };
      const okOf = (got) => compareValues(got, expected, compare);
      const until = async () => {
        const end = Date.now() + timeout;
        let got = await read();
        while (!okOf(got) && actual === undefined && Date.now() < end) {
          await sleep(300);
          got = await read();
        }
        return got;
      };
      let got = await measure(until, okOf);
      // Chữ thoáng qua (Importing…, Loading…) không còn khi tới bước kiểm: đã thấy ngay sau lần bấm trước → tính là đã hiện;
      // không kịp thấy → "không kiểm được" (ghi riêng, không thành bug). Chữ có nhưng sai → vẫn so như thường
      if (got == null && actual === undefined && isWatched(expected)) {
        await peek();
        const w = watch.find((x) => norm(x) === norm(expected));
        if (seenAt.has(w) && seenAt.get(w) >= lastTapAt) {
          logStep({ kind: 'Action', step, screen, keyword: 'Verify text', target, value: String(expected), ok: true, note: `Chữ thoáng qua "${expected}" đã hiện ngay sau thao tác trước (${((Date.now() - seenAt.get(w)) / 1000).toFixed(1)}s trước bước kiểm), tới bước kiểm thì app đã chuyển tiếp` });
          got = String(expected);
        } else {
          logStep({ kind: 'Action', step, screen, keyword: 'Verify text', target, value: String(expected), ok: true, note: `Không kiểm được: chữ thoáng qua "${expected}" không kịp thấy (app chạy quá nhanh) — kiểm tay` });
          noteUnverified({ step, screen, target, label, why: `Chữ thoáng qua "${expected}" không kịp thấy` });
          return;
        }
      }
      // Phần tử không có trong page source (chữ vẽ trong hình, badge không tên) → tìm đúng chữ mong đợi trên ảnh
      let seen = null;
      if (got == null && actual === undefined && ['', 'equals', 'contains'].includes(compare)) {
        seen = await seeOnScreen(strip ? [...strip].reduce((s, ch) => s.split(ch).join(''), String(expected)) : expected);
        if (seen) got = String(expected);
      }
      const want = expectLabel(expected, compare);
      await check(step, screen, 'Verify text', target, expected, label, seen || sels[0], okOf(got) ? want : got, want);
    },
    // Chờ phần tử biến mất — màn chuyển bước nhưng phần tử kế tiếp trùng chữ (tutorial / coachmark bấm "Next" nhiều lần)
    async gone(screen, sel, what, timeout = 10000) {
      const wait = (s) => driver.waitUntil(async () => !(await stillShown(s)), { timeout, interval: 300 })
        .catch(() => { throw new Error(`Không tới được màn ${screen}: ${what} vẫn còn sau ${timeout / 1000}s`); });
      await guarded('gone', { step: lastStep, screen, target: what }, sel, wait, afterTap(`${screen} (bước tiếp theo)`, () => wait(sel)));
    },
    // Hộp thoại hệ thống (tracking / thông báo / vị trí …): chờ hiện → chọn nút → (label: ghi điểm kiểm "nút hiển thị") → bấm
    //   button: ý định 'allow' | 'deny' (chữ nút khác nhau theo iOS / ngôn ngữ — xem ALERT_BUTTONS) hoặc chữ nút cụ thể
    async alert(step, screen, button = 'allow', { label, timeout = 15000, target } = {}) {
      const want = alertIntent(button);
      let pick = null;
      // Hộp thoại theo dõi (ATT) có thể đã được tự đóng / iOS không hỏi → chờ ngắn, không thấy thì ghi bước và đi tiếp
      if (TRACKING.test(`${target || ''} ${button}`)) {
        const up = await driver.waitUntil(async () => (await alertButtons()).length > 0, { timeout: Math.min(timeout, TRACKING_WAIT), interval: 300 }).catch(() => false);
        if (!up) {
          act(step, screen, 'Handle permission', target || want, 'không hiện — đã tự đóng trước đó hoặc iOS không hỏi');
          return;
        }
      }
      const found = async () => {
        const buttons = await alertButtons();
        if (!buttons.length) return false;
        pick = pickAlertButton(buttons, button);
        if (!pick) throw new Error(`Hộp thoại hệ thống không có nút "${want}" — đang hiện: ${buttons.map((b) => `"${b}"`).join(', ')}`);
        return true;
      };
      const shownUp = await guarded('alert', { step, screen, target: want }, null, () => driver.waitUntil(found, { timeout, interval: 300 })
        .catch((e) => { throw /^Hộp thoại hệ thống không có nút/.test(e?.message) ? e : new Error(`Không tới được màn ${screen}: không thấy hộp thoại hệ thống "${want}" sau ${timeout / 1000}s`); }));
      if (!shownUp) return;
      const sel = driver.isAndroid
        ? `android=new UiSelector().text(${JSON.stringify(pick)})`
        : `-ios predicate string:type == "XCUIElementTypeButton" AND label == ${JSON.stringify(pick)}`;
      if (label) await check(step, screen, 'Verify displayed', pick, '', label, sel, true, true);
      if (driver.isAndroid) await ui.tap(sel);
      else await driver.execute('mobile: alert', { action: 'accept', buttonLabel: pick });
      act(step, screen, 'Tap', pick);
    },
    async enabled(step, screen, target, label, sel = byText(target), expected = true) {
      const on = await measure(async () => ((await ui.exists(sel, 3000)) ? ui.isEnabled(sel) : null), (v) => v === expected);
      await check(step, screen, expected ? 'Verify enabled' : 'Verify disabled', target, '', label, sel, on, expected);
    },
    // Verify selected: iOS selected="true", value "1" hoặc traits có "Selected"; Android selected / checked. Không thấy phần tử → null
    async selected(step, screen, target, label, sel = byText(target), expected = true) {
      const read = async () => {
        if (!(await ui.exists(sel, 3000))) return null;
        const e = await $(sel);
        const attr = async (k) => String(await e.getAttribute(k).catch(() => null));
        return driver.isAndroid
          ? (await attr('selected')) === 'true' || (await attr('checked')) === 'true'
          : (await attr('selected')) === 'true' || (await attr('value')) === '1' || /\bSelected\b/.test(await attr('traits'));
      };
      await check(step, screen, 'Verify selected', target, '', label, sel, await measure(read, (v) => v === expected), expected);
    },
    // Verify external URL: trang mở ra (Safari / trình duyệt trong app / Chrome) đúng địa chỉ.
    //   Ưu tiên URL đầy đủ của tab đang hiển thị (Web Inspector); không đọc được thì đọc thanh địa chỉ — chỉ có tên miền → so tên miền (ghi rõ trong label).
    //   Chờ tới khi đọc được và ổn định (hết tải / chuyển hướng)
    async url(step, screen, target, label, expected, { timeout = 20000, compare = '' } = {}) {
      const sel = driver.isAndroid ? URL_BAR.android : URL_BAR.ios;
      const readBar = async () => {
        if (!(await ui.exists(sel, 500))) return '';
        const e = await $(sel);
        const v = cleanUrl(await e.getAttribute(driver.isAndroid ? 'text' : 'value').catch(() => ''));
        return /^(address|url|search or enter website name)$/i.test(v) ? '' : v;
      };
      let shown = '';
      let prev = null;
      await driver.waitUntil(async () => {
        shown = cleanUrl(await visibleWebUrl()) || (await readBar());
        const stable = shown && shown === prev; // 2 lần đọc liên tiếp giống nhau → hết chuyển hướng / tải
        prev = shown;
        return stable;
      }, { timeout, interval: 700 }).catch(() => {});
      const part = /contains/i.test(compare); // Value là một phần URL
      // contains + chỉ đọc được tên miền (trình duyệt trong app) + Value có tên miền → so tên miền như equals
      const hostShown = !!shown && !urlKey(shown).includes('/') && /^[^/]+\.[^/]+/.test(urlKey(expected));
      const { ok, hostOnly } = part && !hostShown ? { ok: !!shown && cleanUrl(shown).toLowerCase().includes(cleanUrl(expected).toLowerCase()), hostOnly: false } : matchUrl(shown, expected);
      const want = part ? `contains "${cleanUrl(expected)}"` : cleanUrl(expected);
      const note = hostOnly ? ' (trình duyệt trong app chỉ hiện tên miền — so tên miền)' : '';
      await check(step, screen, 'Verify external URL', target, want, `${label}${note}`, sel, ok ? want : shown || '(không đọc được thanh địa chỉ)', want);
    },
    // Close browser: quay lại app từ trang web app vừa mở.
    //   Safari / Chrome ngoài app (app không còn ở trước) → đưa app về trước (= bấm "◀ App" trên thanh trạng thái — nút đó của hệ thống,
    //   không nằm trong cây phần tử của trình duyệt nên không bấm trực tiếp được).
    //   Trình duyệt trong app (SFSafariViewController / Custom Tab) → bấm Done / Close (Android: phím Back)
    async closeBrowser(step, screen, target = 'Close browser') {
      const id = driver.isAndroid ? { appId: env.BUNDLE_ID } : { bundleId: env.BUNDLE_ID };
      const state = await driver.execute('mobile: queryAppState', id).catch(() => 4);
      if (state !== 4) await driver.execute('mobile: activateApp', id);
      else if (driver.isAndroid) await driver.back();
      else if (await ui.exists(BROWSER_DONE, 3000)) await ui.tap(BROWSER_DONE);
      else throw new Error(`Không tới được màn ${screen}: app đang ở trước nhưng không thấy nút Done / Close của trình duyệt trong app`);
      act(step, screen, 'Close browser', target);
    },
    // ===== Vòng đời app =====
    // Relaunch app: kill tiến trình (terminateApp) rồi mở lại
    async relaunch(step, screen) {
      await driver.execute('mobile: terminateApp', appArg()).catch(() => {});
      await driver.execute('mobile: activateApp', appArg());
      act(step, screen, 'Relaunch app', '');
    },
    // Reset app data: xoá dữ liệu app rồi mở lại, không cài lại. iOS: chỉ simulator; Keychain KHÔNG bị xoá (giới hạn của iOS)
    async resetData(step, screen) {
      await driver.execute('mobile: terminateApp', appArg()).catch(() => {});
      await driver.execute('mobile: clearApp', appArg());
      await driver.execute('mobile: activateApp', appArg());
      act(step, screen, 'Reset app data', '', driver.isAndroid ? '' : 'Keychain giữ nguyên');
    },
    // Background app: xuống nền N giây rồi tự mở lại
    async background(step, screen, seconds) {
      await driver.execute('mobile: backgroundApp', { seconds: Number(seconds) || 3 });
      act(step, screen, 'Background app', '', String(seconds));
    },
    // Open deep link: mở app thẳng vào màn (scheme://…)
    async deepLink(step, screen, url) {
      await driver.execute('mobile: deepLink', driver.isAndroid ? { url, package: env.BUNDLE_ID } : { url, bundleId: env.BUNDLE_ID });
      act(step, screen, 'Open deep link', '', url);
    },
    // Open URL: mở URL trên trình duyệt của máy (Safari / Chrome)
    async openUrl(step, screen, url) {
      await driver.execute('mobile: deepLink', driver.isAndroid ? { url, package: 'com.android.chrome' } : { url, bundleId: 'com.apple.mobilesafari' });
      act(step, screen, 'Open URL', '', url);
    },
    // Open notification: mở thanh / trung tâm thông báo, chạm thông báo có tiêu đề target
    async openNotification(step, screen, title, { timeout = 15000 } = {}) {
      const sel = byText(title);
      const run = async () => {
        if (driver.isAndroid) {
          await driver.openNotifications();
          await ui.tap(`android=new UiSelector().textContains(${JSON.stringify(String(title))})`, timeout);
          return;
        }
        // iOS: kéo từ mép trên xuống; thông báo thuộc SpringBoard → tìm trong SpringBoard rồi trả lại app
        const { width, height } = await driver.getWindowRect();
        await ui.drag(width * 0.3, 2, width * 0.3, height * 0.7);
        await driver.updateSettings({ defaultActiveApplication: 'com.apple.springboard' });
        try {
          await ui.tap(`-ios predicate string:label CONTAINS ${JSON.stringify(String(title))}`, timeout);
        } finally {
          await driver.updateSettings({ defaultActiveApplication: 'auto' }).catch(() => {});
        }
      };
      const wrap = () => run().catch(() => { throw new Error(`Không tới được màn ${screen}: không thấy thông báo "${title}" sau ${timeout / 1000}s`); });
      if (await guarded('tap', { step, screen, target: title }, sel, wrap)) act(step, screen, 'Open notification', title);
    },

    // ===== Chạm, nhập, cuộn =====
    async doubleTap(step, screen, target, sel = byText(target)) {
      const press = async (s) => {
        // Phần tử chỉ có toạ độ (point:…) → chạm 2 lần nhanh tại điểm đó
        if (isPoint(s)) { await tapPoint(s); await tapPoint(s); return; }
        const e = await ui.el(s).catch(notFound(target, screen));
        await driver.execute(driver.isAndroid ? 'mobile: doubleClickGesture' : 'mobile: doubleTap', { elementId: e.elementId });
      };
      if (await guarded('tap', { step, screen, target }, sel, press)) {
        act(step, screen, 'Double tap', target);
        // Hộp thoại hệ thống bật lên ngay sau lần bấm đầu (vd ATT khi mới cài app) → lần bấm thứ 2 có thể đã bị hộp thoại nuốt:
        // kết quả bấm đúp chưa đáng tin → ghi rõ (không tự sửa kết quả)
        if (!driver.isAndroid && (await alertButtons()).length) logStep({ kind: 'Action', step, screen, keyword: 'Double tap', target, value: '', ok: true, note: 'Cảnh báo: hộp thoại hệ thống bật lên ngay sau lần bấm đầu — lần bấm thứ 2 có thể đã bị nuốt, kết quả bấm đúp chưa đáng tin (nên đi qua hộp thoại này trước khi bấm đúp)' });
      }
    },
    async longPress(step, screen, target, sel = byText(target), seconds = 1) {
      const sec = Number(seconds) || 1;
      const press = async (s) => {
        const e = await ui.el(s).catch(notFound(target, screen));
        await driver.execute(driver.isAndroid ? 'mobile: longClickGesture' : 'mobile: touchAndHold', driver.isAndroid ? { elementId: e.elementId, duration: sec * 1000 } : { elementId: e.elementId, duration: sec });
      };
      if (await guarded('tap', { step, screen, target }, sel, press)) act(step, screen, 'Long press', target, String(sec));
    },
    // Close popup: popup / tờ trong app CÓ THỂ hiện (mời đăng nhập, đánh giá, khuyến mãi…) → hiện thì bấm nút đóng (target),
    // không hiện trong `seconds` giây thì bỏ qua, không lỗi (popup kiểu này không phải lần nào cũng hiện)
    async closePopup(step, screen, target = 'Close', sel = byText(target), seconds = 3) {
      if (await ui.visible(sel, (Number(seconds) || 3) * 1000)) {
        await ui.tap(sel, 2000);
        act(step, screen, 'Close popup', target);
      } else logStep({ kind: 'Action', step, screen, keyword: 'Close popup', target, value: '', ok: true, note: 'Popup không hiện — bỏ qua' });
    },
    // Tap outside: chạm vùng nền tối phía trên sheet / popup (sel = chính sheet; bỏ trống → gần mép trên màn)
    async tapOutside(step, screen, target, sel) {
      const { width, height } = await driver.getWindowRect();
      let y = Math.round(height * 0.08);
      if (sel && (await ui.exists(sel, 3000))) {
        const r = await driver.getElementRect((await $(sel)).elementId);
        if (r.y > 60) y = Math.round(r.y / 2);
      }
      await driver.execute(driver.isAndroid ? 'mobile: clickGesture' : 'mobile: tap', { x: Math.round(width / 2), y });
      act(step, screen, 'Tap outside', target || '');
    },
    // Toggle: đưa switch / checkbox về on / off (đang đúng thì không bấm); bấm xong vẫn sai → lỗi
    async toggle(step, screen, target, sel, value) {
      const want = /^(on|true|1|bật)$/i.test(String(value).trim());
      const run = async (s) => {
        const e = await ui.el(s).catch(notFound(target, screen));
        if ((await isOn(e)) !== want) await e.click();
        if ((await isOn(await $(s))) !== want) throw new Error(`"${target}" trên màn ${screen} không chuyển sang ${want ? 'on' : 'off'}`);
      };
      if (await guarded('tap', { step, screen, target }, sel, run)) act(step, screen, 'Toggle', target, want ? 'on' : 'off');
    },
    // Deselect all: bỏ chọn mọi mục đang chọn trong nhóm (itemsSel = selector khớp các mục)
    async deselectAll(step, screen, target, itemsSel) {
      for (const e of await $$(itemsSel)) if (await isOn(e)) await e.click();
      act(step, screen, 'Deselect all', target);
    },
    async clear(step, screen, target, sel) {
      if (await guarded('enter', { step, screen, target }, sel, async (s) => (await ui.el(s).catch(notFound(target, screen))).clearValue())) act(step, screen, 'Clear', target);
    },
    // Press key: ENTER / DEL / TAB / SPACE / BACK / SEARCH …
    async pressKey(step, screen, key) {
      const k = String(key).trim().toUpperCase();
      if (driver.isAndroid) {
        if (!(k in KEYCODES)) throw new Error(`Phím "${key}" chưa hỗ trợ — dùng: ${Object.keys(KEYCODES).join(', ')}`);
        await driver.execute('mobile: pressKey', { keycode: KEYCODES[k] });
      } else {
        if (!(k in IOS_KEYS)) throw new Error(`Phím "${key}" chưa hỗ trợ trên iOS — dùng: ${Object.keys(IOS_KEYS).join(', ')}`);
        await driver.keys([IOS_KEYS[k]]);
      }
      act(step, screen, 'Press key', '', k);
    },
    async hideKeyboard(step, screen) {
      if (await driver.isKeyboardShown().catch(() => false)) {
        await (driver.isAndroid ? driver.hideKeyboard() : driver.execute('mobile: hideKeyboard', { keys: ['Done', 'Return', 'Xong', 'Go', 'Search'] }).catch(() => driver.hideKeyboard()));
      }
      act(step, screen, 'Hide keyboard', '');
    },
    // Set ruler: kéo thước (rulerSel) tới value, đọc số hiện tại ở valueSel. Đo số đơn vị / pixel sau mỗi lần kéo rồi chỉnh dần
    async ruler(step, screen, target, rulerSel, valueSel, value, { tolerance = 0, tries = 8 } = {}) {
      const want = Number(String(value).replace(',', '.'));
      const read = async () => ui.toNumber(await textOf(valueSel, 5000));
      const r = await driver.getElementRect((await ui.el(rulerSel)).elementId);
      const horizontal = r.width >= r.height;
      const mid = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      const dragBy = (px) => (horizontal ? ui.drag(mid.x, mid.y, mid.x + px, mid.y) : ui.drag(mid.x, mid.y, mid.x, mid.y + px));
      let cur = await read();
      let perPx = null;
      for (let i = 0; i < tries && Math.abs(cur - want) > tolerance; i++) {
        const span = (horizontal ? r.width : r.height) * 0.35;
        const px = perPx ? Math.max(-span, Math.min(span, (want - cur) / perPx)) : (want > cur ? -span / 4 : span / 4);
        await dragBy(px);
        const next = await read();
        if (next !== cur && px) perPx = (next - cur) / px;
        cur = next;
      }
      if (Math.abs(cur - want) > tolerance) throw new Error(`Không tới được màn ${screen}: thước "${target}" dừng ở ${cur}, không kéo được tới ${want}`);
      act(step, screen, 'Set ruler', target, String(value));
    },
    // Select picker: wheel picker (iOS PickerWheel; Android NumberPicker / spinner) → mục value
    async selectPicker(step, screen, target, sel, value) {
      const run = async (s) => {
        if (driver.isAndroid) {
          await ui.tap(`android=new UiScrollable(new UiSelector().scrollable(true)).scrollTextIntoView(${JSON.stringify(String(value))})`);
          return;
        }
        const e = await ui.el(s).catch(notFound(target, screen));
        await e.addValue(String(value));
        const got = await e.getAttribute('value');
        if (!String(got).includes(String(value))) throw new Error(`Picker "${target}" đang ở "${got}", không chọn được "${value}"`);
      };
      if (await guarded('enter', { step, screen, target }, sel, run)) act(step, screen, 'Select picker', target, String(value));
    },
    // Select date: date picker dạng wheel (iOS, locale en_US: Month / Day / Year). Dạng lịch (inline) → báo dùng helper pack
    async selectDate(step, screen, target, sel, value, format = 'DD/MM/YYYY') {
      const iso = parseDate(value, format);
      if (!iso) throw new Error(`Ngày "${value}" không đúng định dạng ${format}`);
      const [y, m, d] = iso.split('-').map(Number);
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const run = async (s) => {
        if (driver.isAndroid) throw new Error('Select date trên Android chưa hỗ trợ chung — dùng helper pack của app');
        const box = await ui.el(s).catch(notFound(target, screen));
        const wheels = await box.$$('-ios class chain:**/XCUIElementTypePickerWheel');
        if (wheels.length !== 3) throw new Error(`Date picker "${target}" không phải dạng 3 wheel (có ${wheels.length}) — dạng lịch cần helper pack của app`);
        for (const [w, v] of [[wheels[0], months[m - 1]], [wheels[1], String(d)], [wheels[2], String(y)]]) await w.addValue(v);
      };
      if (await guarded('enter', { step, screen, target }, sel, run)) act(step, screen, 'Select date', target, String(value));
    },
    // Scroll: cuộn 1 lần (sel = vùng cuộn, tuỳ chọn)
    async scroll(step, screen, direction, sel) {
      await scrollOnce(dirOf(direction), sel);
      act(step, screen, 'Scroll', '', dirOf(direction));
    },
    // Scroll to: cuộn (mặc định xuống) tới khi thấy phần tử; hết max lần → lỗi chặn luồng
    async scrollTo(step, screen, target, sel = byText(target), { direction = 'down', max = 10, container } = {}) {
      const run = async (s) => {
        for (let i = 0; i <= max; i++) {
          if (await ui.exists(s, 800) && (await (await $(s)).isDisplayed().catch(() => true))) return;
          await scrollOnce(dirOf(direction), container);
        }
        throw new Error(`Không thấy "${target}" trên màn ${screen} sau ${max} lần cuộn`);
      };
      if (await guarded('tap', { step, screen, target }, sel, run)) act(step, screen, 'Scroll to', target);
    },
    // Swipe: vuốt trên phần tử (sel) hoặc cả màn
    async swipe(step, screen, direction, sel, target = '') {
      const d = dirOf(direction);
      if (driver.isAndroid) {
        const r = sel ? await driver.getElementRect((await ui.el(sel)).elementId) : { x: 0, y: 0, ...(await driver.getWindowRect()) };
        await driver.execute('mobile: swipeGesture', { left: Math.round(r.x), top: Math.round(r.y + r.height * 0.2), width: Math.round(r.width), height: Math.round(r.height * 0.6), direction: d, percent: 0.75 });
      } else {
        await driver.execute('mobile: swipe', { direction: d, ...(sel ? { elementId: (await ui.el(sel)).elementId } : {}) });
      }
      act(step, screen, 'Swipe', target, d);
    },

    // ===== Hệ thống, thời gian =====
    // Handle permission: Value Allow / Don't allow → k.alert theo ý định
    async permission(step, screen, target, value, opts) {
      return this.alert(step, screen, /don.?t|deny|từ chối|không/i.test(String(value)) ? 'deny' : 'allow', { ...opts, target });
    },
    // Set network: chỉ Android (iOS không tắt mạng được qua Appium → lỗi rõ, dòng này phải để Platform = Android)
    async setNetwork(step, screen, value) {
      const on = /^(on|true|1|bật)$/i.test(String(value).trim());
      // iOS Simulator dùng mạng của máy Mac, Appium không tắt được → case cần mất mạng = Skipped trên iOS (không phải Blocked)
      if (!driver.isAndroid) throw Object.assign(new Error('iOS Simulator không giả lập mất mạng được (Set network chỉ chạy trên Android) — kiểm tay hoặc chạy trên Android'), { name: 'SkipCase' });
      await driver.execute('mobile: setConnectivity', { wifi: on, data: on });
      networkOff = !on;
      act(step, screen, 'Set network', '', on ? 'on' : 'off');
    },
    // Dọn sau case (khung gọi trong finally): bật lại mạng nếu case tắt mà chưa bật
    async cleanup() {
      if (networkOff && driver.isAndroid) await driver.execute('mobile: setConnectivity', { wifi: true, data: true }).catch(() => {});
      networkOff = false;
    },
    async wait(step, screen, seconds) {
      await driver.pause((Number(seconds) || 1) * 1000);
      act(step, screen, 'Wait', '', String(seconds));
    },
    async waitDisplayed(step, screen, target, sel = byText(target), seconds = 10) {
      const ms = (Number(seconds) || 10) * 1000;
      const run = (s) => waitEl(s, ms, { early: false }).catch(() => { throw new Error(`Không tới được màn ${screen}: "${target}" không hiện sau ${ms / 1000}s`); });
      if (await guarded('nav', { step, screen, target }, sel, run)) act(step, screen, 'Wait until displayed', target, String(seconds));
    },
    async waitNotDisplayed(step, screen, target, sel = byText(target), seconds = 10) {
      const ms = (Number(seconds) || 10) * 1000;
      const run = (s) => driver.waitUntil(async () => !(await stillShown(s)), { timeout: ms, interval: 300 })
        .catch(() => { throw new Error(`Không tới được màn ${screen}: "${target}" vẫn còn sau ${ms / 1000}s`); });
      if (await guarded('gone', { step, screen, target }, sel, run)) act(step, screen, 'Wait until not displayed', target, String(seconds));
    },
    async waitEnabled(step, screen, target, sel = byText(target), seconds = 10) {
      const ms = (Number(seconds) || 10) * 1000;
      const run = (s) => driver.waitUntil(async () => (await ui.exists(s, 300)) && (await (await $(s)).isEnabled()), { timeout: ms, interval: 300 })
        .catch(() => { throw new Error(`Không tới được màn ${screen}: "${target}" không bấm được sau ${ms / 1000}s`); });
      if (await guarded('nav', { step, screen, target }, sel, run)) act(step, screen, 'Wait until enabled', target, String(seconds));
    },

    // ===== Dữ liệu, hook =====
    // Save value: lưu chữ / giá trị hiện tại của phần tử vào biến {{name}}
    async saveValue(step, screen, target, sel, name) {
      const read = async (s) => {
        const t = await textOf(s, 5000);
        if (t == null) throw new Error(`Không thấy "${target}" trên màn ${screen}`);
        vars[name] = t;
      };
      if (await guarded('tap', { step, screen, target }, sel, read)) act(step, screen, 'Save value', target, `{{${name}}} = ${vars[name]}`);
    },
    async setVar(step, screen, name, value) {
      vars[name] = String(value);
      act(step, screen, 'Set variable', name, String(value));
    },
    async generate(step, screen, name, kind) {
      vars[name] = generateValue(kind);
      act(step, screen, 'Generate data', name, `${kind}: ${vars[name]}`);
    },
    fill: (v) => fillVars(v, vars),
    vars,
    // Run setup: hook dự án (src/hooks.js → setup[name]) — seed data, giả lập lỗi, đặt ngày…
    async runSetup(step, screen, name) {
      const own = (await loadHooks()).setup?.[name];
      // Hook có sẵn: đóng paywall / quảng cáo / popup (dismiss_paywall, close_paywall, skip_paywall, close_ad, dismiss_popup…) — app nào cũng cần
      if (typeof own !== 'function' && DISMISS_HOOK.test(String(name))) {
        await dismissBlocker(step, screen, name);
        act(step, screen, 'Run setup', '', name);
        return;
      }
      const fn = own || BUILTIN_HOOKS.setup[String(name).toLowerCase()];
      if (typeof fn !== 'function') throw new Error(`Chưa khai báo hook setup "${name}" trong src/hooks.js`);
      await fn({ driver, vars, env });
      act(step, screen, 'Run setup', '', name);
    },

    // ===== Check =====
    // Verify screen ở Kind Check: đúng màn hay không → sai thì Failed (Nav Verify screen sai thì Blocked)
    async screen(step, screen, label, sel, { timeout = 15000 } = {}) {
      await check(step, screen, 'Verify screen', screen, '', label, sel, await measure(() => ui.exists(sel, timeout), (v) => v === true), true);
    },
    // Verify value: giá trị hiện tại của ô nhập / control (iOS value, Android text)
    async value(step, screen, target, label, sel, expected, { compare = '' } = {}) {
      const read = async () => {
        if (!(await ui.exists(sel, 3000))) return null;
        const e = await $(sel);
        return driver.isAndroid ? e.getText() : e.getAttribute('value');
      };
      const okOf = (v) => compareValues(v, expected, compare);
      const got = await measure(read, okOf);
      const want = expectLabel(expected, compare);
      await check(step, screen, 'Verify value', target, expected ?? '', label, sel, okOf(got) ? want : got, want);
    },
    // Verify placeholder: ô trống đang hiện đúng placeholder (iOS placeholderValue, Android hint)
    async placeholder(step, screen, target, label, sel, expected, { compare = '' } = {}) {
      const read = async () => ((await ui.exists(sel, 3000)) ? (await $(sel)).getAttribute(driver.isAndroid ? 'hint' : 'placeholderValue') : null);
      const okOf = (v) => compareValues(v, expected, compare);
      const got = await measure(read, okOf);
      const want = expectLabel(expected, compare);
      await check(step, screen, 'Verify placeholder', target, expected, label, sel, okOf(got) ? want : got, want);
    },
    // Verify focused: con trỏ đang ở ô (Android focused; iOS phần tử đang giữ bàn phím = active element)
    async focused(step, screen, target, label, sel) {
      const read = async () => {
        if (!(await ui.exists(sel, 3000))) return null;
        const e = await $(sel);
        if (driver.isAndroid) return (await e.getAttribute('focused')) === 'true';
        const active = await driver.getActiveElement().catch(() => null);
        const id = active && (active.ELEMENT || active['element-6066-11e4-a52e-4f735466cecf']);
        return !!id && id === e.elementId;
      };
      await check(step, screen, 'Verify focused', target, '', label, sel, await measure(read, (v) => v === true), true);
    },
    async keyboard(step, screen, label, expected = true) {
      const shownNow = await driver.isKeyboardShown().catch(() => false);
      await check(step, screen, expected ? 'Verify keyboard displayed' : 'Verify keyboard not displayed', '', '', label, null, shownNow, expected);
    },
    // Verify attribute: spec "<thuộc tính>=<giá trị>", vd "checked=true"
    async attribute(step, screen, target, label, sel, spec, { compare = '' } = {}) {
      const i = String(spec).indexOf('=');
      if (i < 1) throw new Error(`Verify attribute cần Value dạng <thuộc tính>=<giá trị>, nhận "${spec}"`);
      const name = String(spec).slice(0, i).trim();
      const expected = String(spec).slice(i + 1).trim();
      const read = async () => ((await ui.exists(sel, 3000)) ? (await $(sel)).getAttribute(name) : null);
      const okOf = (v) => compareValues(v, expected, compare);
      const got = await measure(read, okOf);
      const want = `${name}=${expectLabel(expected, compare)}`;
      await check(step, screen, 'Verify attribute', target, spec, label, sel, okOf(got) ? want : `${name}=${got}`, want);
    },
    // Verify selected Compare all-on: mọi mục trong nhóm đều bật
    async allOn(step, screen, target, label, itemsSel) {
      const els = await $$(itemsSel);
      const off = [];
      for (const e of els) if (!(await isOn(e))) off.push(await itemText(e));
      await check(step, screen, 'Verify selected', target, 'all-on', label, itemsSel, els.length && !off.length ? 'all-on' : `tắt: ${off.join(', ') || '(không có mục nào)'}`, 'all-on');
    },
    // Verify count: số mục trong danh sách — tự cuộn hết danh sách (scroll: false = chỉ phần đang hiện). Mục trùng chữ tính 1
    async count(step, screen, target, label, itemsSel, expected, { compare = '', scroll = true, container } = {}) {
      const items = await collectItems(itemsSel, { scroll, container });
      const ok = compareValues(String(items.length), String(expected), compare || 'number');
      const want = expectLabel(expected, compare);
      await check(step, screen, 'Verify count', target, String(expected), label, itemsSel, ok ? want : String(items.length), want);
    },
    // Verify layout: vị trí / kích thước (pt) + dò ảnh chụp (số dòng chữ, khoảng trống tới hình không có tên) — luật trong layout.js
    //   value vd "width <= 260; centerOffset <= 4; spaceBelow >= 36" / "lines = 2; left >= 24; right >= 24"
    async layout(step, screen, target, label, sel = byText(target), value) {
      if (isPoint(sel)) return pointOnly(step, screen, 'Verify layout', target);
      const rules = parseRules(value);
      const want = formatRules(rules);
      const read = async () => {
        if (!(await ui.exists(sel, 3000))) return null;
        const e = await $(sel);
        const [loc, size, win] = await Promise.all([e.getLocation(), e.getSize(), driver.getWindowSize()]);
        const rect = { x: loc.x, y: loc.y, width: size.width, height: size.height };
        const png = needsImage(rules) ? readPng(await driver.takeScreenshot()) : null;
        return evaluate(rules, { rect, win, png, scale: png ? png.width / win.width : 1 });
      };
      const res = await measure(read, (v) => v?.ok === true);
      await check(step, screen, 'Verify layout', target, want, label, sel, !res ? null : res.ok ? want : describeResults(res.results), want);
    },
    // Verify order: các nhãn theo thứ tự "a;b;c" — tự cuộn hết danh sách
    async order(step, screen, target, label, itemsSel, expected, { scroll = true, container } = {}) {
      const items = await collectItems(itemsSel, { scroll, container });
      const want = String(expected).split(';').map((x) => x.trim()).filter(Boolean).join(';');
      await check(step, screen, 'Verify order', target, want, label, itemsSel, items.join(';'), want);
    },
    // Verify app opened: app đang ở foreground là bundle id / package này
    async appOpened(step, screen, label, id) {
      const state = await driver.execute('mobile: queryAppState', driver.isAndroid ? { appId: id } : { bundleId: id }).catch(() => 0);
      await check(step, screen, 'Verify app opened', id, id, label, null, state === 4 ? id : `${id} không ở foreground`, id);
    },
    // Run check: hook kiểm phía backend (src/hooks.js → check[name]) trả { pass, actual?, expected? }
    async runCheck(step, screen, name, label) {
      const fn = (await loadHooks()).check?.[name] || BUILTIN_HOOKS.check[String(name).toLowerCase()];
      // Hook check không có (không có API đọc, hoặc dự án chưa viết): ghi "không kiểm được", case chạy tiếp — kiểm không đổi trạng thái app
      if (typeof fn !== 'function') {
        const why = UNVERIFIABLE_HOOKS.test(String(name)) ? NO_API : `chưa khai báo hook check "${name}" trong src/hooks.js — viết hook hoặc kiểm tay`;
        logStep({ kind: 'Action', step, screen, keyword: 'Run check', target: name, value: '', ok: true, note: `Không kiểm tự động được (${why}): ${label || name}` });
        noteUnverified({ step, screen, target: name, label, why });
        return;
      }
      const r = (await fn({ driver, vars, env })) || {};
      const want = r.expected ?? 'pass';
      await check(step, screen, 'Run check', name, '', label, null, r.pass ? want : (r.actual ?? 'fail'), want);
    },

    // Điểm kiểm cho keyword k chưa có: code riêng đọc actual rồi gọi hàm này — k chụp evidence + sa.eq đúng mẫu
    // (không gọi snapshot / sa.eq trực tiếp)
    async check(step, screen, keyword, target, label, sel, actual, expected, { anchor } = {}) {
      await check(step, screen, keyword, target, typeof expected === 'string' ? expected : '', label, sel, actual, expected, anchor);
    },
    // Đánh dấu bước đã làm bằng code riêng (Set ruler, Select date, alert hệ thống …) để Steps to Reproduce đủ bước
    log: act,
  }));
}

// Page source XML (Appium XCUITest) → danh sách phần tử có ý nghĩa + locator đề xuất + nhận diện màn.
// Ưu tiên locator giống ik-fitness/src/locators/ios: ~accessibility id → predicate type+name → class chain.
import crypto from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';

const KEEP = new Set(['Button', 'StaticText', 'TextField', 'SecureTextField', 'TextView', 'SearchField', 'Switch', 'Toggle',
  'Image', 'Cell', 'Slider', 'Picker', 'PickerWheel', 'DatePicker', 'Link', 'SegmentedControl', 'Stepper', 'Alert']);
const INPUTS = new Set(['TextField', 'SecureTextField', 'TextView', 'SearchField']);
// Cây con không thuộc app: bàn phím, thanh gợi ý gõ
const SKIP_SUBTREE = new Set(['Keyboard']);
// Phần tử của bàn phím / thanh gợi ý nằm ngoài cây Keyboard → bỏ cả cây con
const SKIP_NAMES = /^(inputView|SystemInputAssistantView|CenterPageView|Typing Predictions|UIKeyboardLayoutStar.*|Emoji|dictation|Next keyboard)$/;

const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const short = (t) => t.replace(/^XCUIElementType/, '');

export const platformOf = (xml) => (/<hierarchy[\s>]/.test(xml) ? 'Android' : 'iOS');

// Kích thước cửa sổ: iOS = point (phần tử Application), Android = pixel (thẻ hierarchy) — cùng đơn vị với toạ độ phần tử
export function windowOf(xml) {
  const m = platformOf(xml) === 'Android'
    ? xml.match(/<hierarchy[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/)
    : xml.match(/<XCUIElementTypeApplication[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

// ---- Android (UiAutomator2)
// Lớp Android → loại phần tử dùng chung với iOS (giữ được nhận diện màn, bảng locator, prompt AI)
const ANDROID_TYPES = [
  [/EditText|AutoCompleteTextView/, 'TextField'], [/CheckBox|CheckedTextView/, 'CheckBox'], [/RadioButton/, 'RadioButton'],
  [/Switch|ToggleButton/, 'Switch'], [/ImageButton|\.Button$/, 'Button'], [/ImageView/, 'Image'], [/SeekBar|Slider/, 'Slider'],
  [/Spinner/, 'Picker'], [/TextView/, 'StaticText'], [/WebView/, 'WebView'],
];
const SKIP_PKG = /^(com\.android\.systemui|.*inputmethod.*)$/;
const SKIP_RID = /(navigationBarBackground|statusBarBackground)$/;
const qa = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

function parseAndroid(doc) {
  const raw = [];
  const walk = (node) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const a = (k) => c.getAttribute(k) || '';
      if (SKIP_PKG.test(a('package')) || SKIP_RID.test(a('resource-id'))) continue;
      const cls = a('class');
      let type = (ANDROID_TYPES.find(([re]) => re.test(cls)) || [])[1];
      if (type === 'TextField' && a('password') === 'true') type = 'SecureTextField';
      // View bấm được có content-desc (nút tự vẽ) → Button
      if (!type && a('clickable') === 'true' && a('content-desc')) type = 'Button';
      const visible = a('displayed') !== 'false';
      if (type && visible) {
        const isInput = type === 'TextField' || type === 'SecureTextField';
        const name = a('content-desc') || (isInput ? '' : a('text'));
        const m = a('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/) || [0, 0, 0, 0, 0];
        const el = {
          type, name, label: isInput ? a('hint') : a('text'), value: isInput ? (a('showing-hint') === 'true' ? '' : a('text')) : '',
          rect: { x: +m[1], y: +m[2], width: m[3] - m[1], height: m[4] - m[2] }, visible, enabled: a('enabled') !== 'false',
          cls, rid: a('resource-id'), text: a('text'),
        };
        if (type !== 'Image' || name) raw.push(el);
      }
      walk(c);
    }
  };
  walk(doc);
  const count = (pred) => raw.filter(pred).length;
  const clsIdx = new Map();
  return raw.map((e) => {
    const i = clsIdx.get(e.cls) || 0;
    clsIdx.set(e.cls, i + 1);
    const alts = [];
    if (e.name && count((x) => x.name === e.name) === 1) alts.push(`~${e.name}`);
    if (e.rid && count((x) => x.rid === e.rid) === 1) alts.push(`android=new UiSelector().resourceId("${qa(e.rid)}")`);
    if (e.text && count((x) => x.text === e.text) === 1) alts.push(`android=new UiSelector().text("${qa(e.text)}")`);
    alts.push(`android=new UiSelector().className("${qa(e.cls)}").instance(${i})`);
    const { cls, rid, text, ...rest } = e;
    return { ...rest, locator: alts[0], alts };
  });
}

export function parseElements(xml) {
  const doc = new DOMParser({ onError: () => {} }).parseFromString(xml, 'text/xml');
  if (platformOf(xml) === 'Android') return parseAndroid(doc);
  const raw = [];
  const walk = (node) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const type = short(c.tagName);
      if (SKIP_SUBTREE.has(type) || SKIP_NAMES.test(c.getAttribute('name') || '')) continue;
      if (/^_Tt/.test(c.getAttribute('name') || '')) { walk(c); continue; } // tên nội bộ SwiftUI (NavigationBar…)
      const visible = c.getAttribute('visible') !== 'false';
      if (KEEP.has(type) && visible) {
        const name = c.getAttribute('name') || '';
        const placeholder = c.getAttribute('placeholderValue') || '';
        let value = c.getAttribute('value') || '';
        if (INPUTS.has(type) && value === placeholder) value = '';
        const n = (k) => Number(c.getAttribute(k) || 0);
        const el = {
          type, name, label: c.getAttribute('label') || placeholder || '', value,
          rect: { x: n('x'), y: n('y'), width: n('width'), height: n('height') },
          visible, enabled: c.getAttribute('enabled') !== 'false',
        };
        if (type !== 'Image' || name) raw.push(el); // ảnh không tên = trang trí
      }
      walk(c);
    }
  };
  walk(doc);
  return withLocators(raw);
}

function withLocators(els) {
  const count = (pred) => els.filter(pred).length;
  const typeIdx = new Map();
  return els.map((e) => {
    const full = `XCUIElementType${e.type}`;
    const i = (typeIdx.get(e.type) || 0) + 1;
    typeIdx.set(e.type, i);
    const alts = [];
    if (e.name) {
      if (count((x) => x.name === e.name) === 1) alts.push(`~${e.name}`);
      if (count((x) => x.name === e.name && x.type === e.type) === 1) alts.push(`-ios predicate string:type == "${full}" AND name == "${q(e.name)}"`);
      else alts.push(`-ios class chain:**/${full}[\`name == "${q(e.name)}"\`][${els.filter((x) => x.type === e.type && x.name === e.name).indexOf(e) + 1}]`);
      if (!alts.some((a) => a.startsWith('~'))) alts.push(`~${e.name}`); // dùng được khi strictSelectors=false (lấy phần tử đầu)
    }
    alts.push(count((x) => x.type === e.type) === 1 ? `-ios class chain:**/${full}` : `-ios class chain:**/${full}[${i}]`);
    return { ...e, locator: alts[0], alts };
  });
}

// Chữ trông như dữ liệu (số, email, giờ, câu dài) không dùng để nhận diện màn
const dynamicText = (t) => /\d|@/.test(t) || t.length > 60;

function keyset(els) {
  const s = new Set();
  for (const e of els) {
    if (INPUTS.has(e.type)) s.add(`${e.type}`);
    else if (e.type === 'Button' && e.name) s.add(`Button:${e.name}`);
    else if (e.type === 'StaticText' && e.name && !dynamicText(e.name)) s.add(`Text:${e.name}`);
  }
  return s;
}

export function screenSignature(els) {
  return crypto.createHash('sha1').update([...keyset(els)].sort().join('\n')).digest('hex').slice(0, 12);
}

const jaccard = (A, B) => {
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const k of A) if (B.has(k)) inter++;
  return inter / (A.size + B.size - inter);
};
const structural = (s) => new Set([...s].filter((k) => !k.startsWith('Text:')));

// Độ giống 2 màn (0–1). Màn có ≥ 3 nút / ô nhập: so khung tương tác trước (chữ dữ liệu như "Hi, Anna" / "Hi, Ben" không làm tách màn)
export function screenSimilarity(a, b) {
  const A = keyset(a);
  const B = keyset(b);
  const sa = structural(A);
  const sb = structural(B);
  const full = jaccard(A, B);
  if (sa.size >= 3 && sb.size >= 3) return Math.max(full, jaccard(sa, sb) >= 0.8 ? jaccard(sa, sb) : 0);
  return full;
}

// Cùng một màn khi độ giống ≥ 80%
export const sameScreen = (a, b, threshold = 0.8) => screenSimilarity(a, b) >= threshold;

// Bản rút gọn cho AI: mỗi phần tử 1 dòng
export function toPrompt(els) {
  return els.map((e) => {
    const bits = [`${e.type} "${e.name || e.label}"`];
    if (e.label && e.label !== e.name) bits.push(`label="${e.label}"`);
    if (e.value && e.value !== e.name) bits.push(`value="${e.value}"`);
    if (!e.enabled) bits.push('disabled');
    bits.push(`@${Math.round(e.rect.x)},${Math.round(e.rect.y)}`);
    bits.push(`→ ${e.locator}`);
    return bits.join(' ');
  }).join('\n');
}

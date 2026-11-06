// Thử locator trên page source đã lưu của một màn (không cần thiết bị): locator khớp những phần tử nào.
// Hỗ trợ cú pháp Appium hay dùng: ~id, -ios predicate string (NSPredicate cơ bản), -ios class chain (**/Type[`pred`][n]),
// //xpath, id=resource-id, android=new UiSelector()…, point:x,y. Kết quả là ước lượng theo lúc chụp — máy thật có thể khác.
import { DOMParser } from '@xmldom/xmldom';
import xpath from 'xpath';
import { checkLocator } from './locatorFormat.js';

const ROOTS = new Set(['AppiumAUT', 'hierarchy', 'XCUIElementTypeApplication']);
const fail = (message) => Object.assign(new Error(message), { syntax: true });

const kids = (n) => [...(n.childNodes || [])].filter((c) => c.nodeType === 1);
function walk(n, out = []) {
  for (const c of kids(n)) { out.push(c); walk(c, out); }
  return out;
}
const isAndroid = (doc) => doc.documentElement?.nodeName === 'hierarchy';

// Thông tin phần tử để hiện kết quả
function info(n, android) {
  const a = (k) => n.getAttribute(k) || '';
  if (android) {
    const b = a('bounds').match(/\d+/g)?.map(Number) || [0, 0, 0, 0];
    return { type: (a('class') || n.nodeName).split('.').pop(), name: a('content-desc') || a('resource-id'), label: a('text'), rect: { x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1] }, visible: a('displayed') !== 'false', enabled: a('enabled') === 'true' };
  }
  return { type: (a('type') || n.nodeName).replace('XCUIElementType', ''), name: a('name'), label: a('label'), rect: { x: +a('x'), y: +a('y'), width: +a('width'), height: +a('height') }, visible: a('visible') === 'true', enabled: a('enabled') === 'true' };
}

// ---- NSPredicate (cơ bản): so sánh thuộc tính, AND / OR / NOT, ngoặc, [c][d]
function tokenize(src) {
  const out = [];
  const re = /\s*(?:("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(==|!=|<=|>=|=|<|>|\(|\)|&&|\|\|)|(\[[cdn]+\])|([A-Za-z_][\w.]*)|(-?\d+(?:\.\d+)?))/y;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    if (/^\s*$/.test(src.slice(re.lastIndex))) break;
    if (!(m = re.exec(src))) throw fail(`Không đọc được predicate gần: "${src.slice(re.lastIndex, re.lastIndex + 20)}"`);
    if (m[1]) out.push({ t: 'str', v: m[1].slice(1, -1).replace(/\\(.)/g, '$1') });
    else if (m[2]) out.push({ t: 'op', v: m[2] });
    else if (m[3]) out.push({ t: 'mod', v: m[3] });
    else if (m[4]) out.push({ t: 'id', v: m[4] });
    else out.push({ t: 'num', v: Number(m[5]) });
  }
  return out;
}
const KW = (tok, ...w) => tok?.t === 'id' && w.includes(tok.v.toUpperCase());
function parsePredicate(src) {
  const tk = tokenize(src);
  let i = 0;
  const peek = () => tk[i];
  const next = () => tk[i++];
  const or = () => {
    let l = and();
    while (KW(peek(), 'OR') || peek()?.v === '||') { next(); const r = and(); const a = l; l = (n) => a(n) || r(n); }
    return l;
  };
  const and = () => {
    let l = not();
    while (KW(peek(), 'AND') || peek()?.v === '&&') { next(); const r = not(); const a = l; l = (n) => a(n) && r(n); }
    return l;
  };
  const not = () => {
    if (KW(peek(), 'NOT') || peek()?.v === '!') { next(); const e = not(); return (n) => !e(n); }
    if (peek()?.v === '(') { next(); const e = or(); if (next()?.v !== ')') throw fail('Không đọc được predicate: thiếu ")"'); return e; }
    return cmp();
  };
  const cmp = () => {
    const attr = next();
    if (attr?.t !== 'id') throw fail(`Không đọc được predicate: cần tên thuộc tính (name, label, type…) ở vị trí ${i}`);
    const op = next();
    if (!op || !(op.t === 'op' || KW(op, 'BEGINSWITH', 'ENDSWITH', 'CONTAINS', 'LIKE', 'MATCHES'))) throw fail(`Không đọc được predicate: thiếu phép so sánh sau "${attr.v}"`);
    let mod = '';
    if (peek()?.t === 'mod') mod = next().v;
    const val = next();
    if (!val || !['str', 'num', 'id'].includes(val.t)) throw fail(`Không đọc được predicate: thiếu giá trị sau "${attr.v} ${op.v}"`);
    const ci = mod.includes('c');
    const di = mod.includes('d');
    const norm = (s) => {
      let x = String(s ?? '');
      if (di) x = x.normalize('NFD').replace(/\p{M}/gu, '');
      return ci ? x.toLowerCase() : x;
    };
    const opName = op.t === 'op' ? op.v : op.v.toUpperCase();
    return (n) => {
      let left = n.getAttribute(attr.v);
      if (left === '' && !n.hasAttribute(attr.v)) left = null;
      // Số / boolean: visible == 1, enabled == true
      if (val.t === 'num' || KW(val, 'TRUE', 'FALSE', 'YES', 'NO')) {
        const want = val.t === 'num' ? val.v : (KW(val, 'TRUE', 'YES') ? 1 : 0);
        const have = left === 'true' ? 1 : left === 'false' ? 0 : Number(left);
        return { '==': have === want, '=': have === want, '!=': have !== want, '<': have < want, '>': have > want, '<=': have <= want, '>=': have >= want }[opName] ?? false;
      }
      const l = norm(left);
      const r = norm(val.v);
      switch (opName) {
        case '==': case '=': return left !== null && l === r;
        case '!=': return l !== r;
        case 'BEGINSWITH': return left !== null && l.startsWith(r);
        case 'ENDSWITH': return left !== null && l.endsWith(r);
        case 'CONTAINS': return left !== null && l.includes(r);
        case 'LIKE': return left !== null && new RegExp(`^${r.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`).test(l);
        case 'MATCHES': return left !== null && new RegExp(`^(?:${val.v})$`, ci ? 'i' : '').test(String(left));
        default: return false;
      }
    };
  };
  const e = or();
  if (i < tk.length) throw fail(`Không đọc được predicate: thừa "${tk[i].v}"`);
  return e;
}

// ---- Class chain: **/Type[`pred`][n]/Type…
function classChain(doc, chain) {
  const segs = [];
  let cur = '';
  let tick = false;
  for (const ch of chain) {
    if (ch === '`') tick = !tick;
    if (ch === '/' && !tick) { segs.push(cur); cur = ''; } else cur += ch;
  }
  segs.push(cur);
  let set = [doc.documentElement];
  let deep = false;
  for (const seg of segs) {
    if (seg === '**') { deep = true; continue; }
    const m = seg.match(/^([\w*]+)((?:\[[^\]]*\])*)$/);
    if (!m) throw fail(`Không đọc được class chain ở "${seg}"`);
    const type = m[1];
    let pool = [...new Set(set.flatMap((n) => (deep ? walk(n) : kids(n))))].filter((n) => !ROOTS.has(n.nodeName) && (type === '*' || n.nodeName === type));
    for (const [, b] of m[2].matchAll(/\[([^\]]*)\]/g)) {
      if (/^`.*`$/.test(b)) pool = pool.filter(parsePredicate(b.slice(1, -1)));
      else if (/^-?\d+$/.test(b)) { const k = Number(b); const el = k > 0 ? pool[k - 1] : pool[pool.length + k]; pool = el ? [el] : []; }
      else throw fail(`Class chain chưa hỗ trợ "[${b}]"`);
    }
    set = pool;
    deep = false;
  }
  return set;
}

// ---- UiSelector (Android): text / textContains / textStartsWith / textMatches / description(Contains) / resourceId(Matches) / className / instance
function uiSelector(doc, expr) {
  const calls = [...expr.matchAll(/\.(\w+)\(\s*(?:"((?:[^"\\]|\\.)*)"|(\d+)|(true|false))\s*\)/g)];
  if (!/^new UiSelector\(\)/.test(expr) || !calls.length) throw fail('Không đọc được UiSelector — dạng: new UiSelector().text("…")');
  let pool = walk(doc.documentElement).filter((n) => !ROOTS.has(n.nodeName));
  for (const [, fn, s, num] of calls) {
    const a = (k) => (n) => n.getAttribute(k) || '';
    const tests = {
      text: (n) => a('text')(n) === s, textContains: (n) => a('text')(n).includes(s), textStartsWith: (n) => a('text')(n).startsWith(s),
      textMatches: (n) => new RegExp(`^(?:${s})$`).test(a('text')(n)), description: (n) => a('content-desc')(n) === s,
      descriptionContains: (n) => a('content-desc')(n).includes(s), resourceId: (n) => a('resource-id')(n) === s,
      resourceIdMatches: (n) => new RegExp(`^(?:${s})$`).test(a('resource-id')(n)), className: (n) => a('class')(n) === s,
    };
    if (fn === 'instance') { const el = pool[Number(num)]; pool = el ? [el] : []; continue; }
    if (!tests[fn]) throw fail(`UiSelector chưa hỗ trợ .${fn}()`);
    pool = pool.filter(tests[fn]);
  }
  return pool;
}

// → { elements: [{ type, name, label, rect, visible, enabled }], point?, error? }
export function matchLocator(xml, locator) {
  let loc;
  try { loc = checkLocator(locator); } catch (e) { return { elements: [], error: e.message }; }
  const p = loc.match(/^point:(\d*\.?\d+),(\d*\.?\d+)$/);
  if (p) return { elements: [], point: { fx: Number(p[1]), fy: Number(p[2]) } };
  const doc = new DOMParser({ onError: () => {} }).parseFromString(String(xml || ''), 'text/xml');
  const android = isAndroid(doc);
  const all = () => walk(doc.documentElement).filter((n) => !ROOTS.has(n.nodeName));
  try {
    let nodes;
    if (loc.startsWith('~')) {
      const id = loc.slice(1);
      nodes = all().filter((n) => (android ? n.getAttribute('content-desc') === id : n.getAttribute('name') === id));
    } else if (loc.startsWith('-ios predicate string:')) nodes = all().filter(parsePredicate(loc.slice(22)));
    else if (loc.startsWith('-ios class chain:')) nodes = classChain(doc, loc.slice(17));
    else if (loc.startsWith('//')) nodes = xpath.select(loc, doc).filter((n) => n.nodeType === 1 && !ROOTS.has(n.nodeName));
    else if (loc.startsWith('id=')) { const id = loc.slice(3); nodes = all().filter((n) => { const r = n.getAttribute('resource-id') || ''; return r === id || r.endsWith(`:id/${id}`); }); }
    else if (loc.startsWith('android=')) nodes = uiSelector(doc, loc.slice(8));
    else nodes = [];
    return { elements: nodes.map((n) => info(n, android)) };
  } catch (e) {
    return { elements: [], error: e.syntax ? e.message : `Không đọc được locator: ${e.message}` };
  }
}

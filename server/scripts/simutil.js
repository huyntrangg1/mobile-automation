// Export test case sang SimUtil (app Mac ~/Applications/SimUtil.app, dữ liệu ở ~/.simutil).
// SimUtil chạy file ~/.simutil/projects/<project>/scripts/<TC>.js: spec WebdriverIO + Mocha dạng "@kwcase", mỗi dòng
// keyword của Excel là một lệnh trên `t` (KwRun do SimUtil cung cấp). Bộ keyword của SimUtil trùng format automation v2
// của tool → sinh thẳng từ các dòng Excel đã import (không gọi AI, không dùng code region của tool vì cần runtime `k` riêng).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SIMUTIL_HOME = () => process.env.SIMUTIL_HOME || path.join(os.homedir(), '.simutil');

// Nhóm chữ ký của KwRun (theo API SimUtil đưa cho AI convert)
const ONLY_O = new Set(['launchFresh', 'launch', 'relaunch', 'resetApp', 'back', 'hideKeyboard', 'closeBrowser', 'verifyKeyboardDisplayed', 'verifyKeyboardNotDisplayed']);
const VALUE_O = new Set(['wait', 'backgroundApp', 'openDeepLink', 'openUrl', 'pressKey', 'setNetwork', 'runFlow', 'runSetup', 'verifyAppOpened', 'runCheck']);
const TARGET_O = new Set(['tap', 'doubleTap', 'tapOutside', 'deselectAll', 'clear', 'scrollTo', 'openNotification', 'verifyScreen', 'verifyDisplayed', 'verifyNotDisplayed', 'verifyFocused', 'verifyEnabled', 'verifyDisabled', 'verifySelected', 'verifyNotSelected']);
const TARGET_VALUE_O = new Set(['enter', 'setRuler', 'selectDate', 'longPress', 'toggle', 'selectPicker', 'scroll', 'swipe', 'handlePermission', 'waitUntilDisplayed', 'waitUntilNotDisplayed', 'waitUntilEnabled', 'saveValue', 'setVariable', 'generateData', 'verifyPlaceholder', 'verifyOrder']);
// keyword → [hàm, compare mặc định]
const COMPARE = { verifyText: 'equals', verifyValue: 'equals', verifyAttribute: 'equals', verifyCount: 'number', verifyExternalUrl: 'contains' };
// Tên trong Excel khác tên hàm KwRun
const ALIAS = { 'relaunch app': 'relaunch', 'launch app': 'launch', 'reset app data': 'resetApp', 'reset app': 'resetApp', 'background app': 'backgroundApp', 'open url': 'openUrl', 'verify external url': 'verifyExternalUrl', 'verify url': 'verifyExternalUrl' };
const KNOWN = new Set([...ONLY_O, ...VALUE_O, ...TARGET_O, ...TARGET_VALUE_O, 'verifyText', 'verifyValue', 'verifyAttribute', 'verifyCount', 'verifyExternalUrl']);

const camel = (s) => s.trim().toLowerCase().split(/\s+/).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');
export function methodOf(keyword) {
  const k = String(keyword || '').trim().toLowerCase();
  const m = ALIAS[k] || camel(k);
  return KNOWN.has(m) ? m : null;
}

const J = (v) => JSON.stringify(v);
const num = (v) => (v !== '' && v != null && !Number.isNaN(Number(v)) ? Number(v) : v);

// Một dòng Excel → một lệnh `await t.xxx(...)`. unsupported = keyword SimUtil không có (vd Verify layout)
export function rowCall(r, o) {
  const m = methodOf(r.keyword);
  const target = r.target ?? '';
  const value = r.value ?? '';
  const opt = J(o);
  if (!m) return { code: `await t.unsupported(${J(r.keyword)},${J(target)},${J(value)},${opt});`, unsupported: true };
  let args;
  if (ONLY_O.has(m)) args = [];
  else if (VALUE_O.has(m)) args = [num(value !== '' ? value : target)];
  else if (TARGET_O.has(m)) args = [target];
  else if (TARGET_VALUE_O.has(m)) args = [target, ['longPress', 'waitUntilDisplayed', 'waitUntilNotDisplayed', 'waitUntilEnabled'].includes(m) ? num(value) : value];
  else if (m === 'verifyText') {
    // expected: Value, không có thì Target; có cả hai → o.target = Target
    args = [value !== '' ? value : target, r.compare || COMPARE[m]];
    if (value !== '' && target !== '') return { code: `await t.verifyText(${args.map(J).join(',')},${J({ ...o, target })});` };
  } else if (m === 'verifyExternalUrl') args = [value !== '' ? value : target, r.compare || COMPARE[m]];
  else args = [target, num(value), r.compare || COMPARE[m]]; // verifyValue / verifyAttribute / verifyCount
  return { code: `await t.${m}(${[...args.map(J), opt].join(',')});` };
}

// Script @kwcase cho 1 case. caseRow / row: số thứ tự giả lập dòng Excel (SimUtil dùng làm khoá cache locator + thứ tự)
export function caseScript(c, { project, source, platform, caseRow }) {
  const rows = (c.rows || []).filter((r) => !r.platform || r.platform === 'All' || r.platform === platform);
  const unsupported = [];
  const calls = rows.map((r, i) => {
    const o = { step: num(r.step), screen: r.screen || '', row: caseRow + 1 + i, ...(r.label ? { label: r.label } : {}) };
    const x = rowCall(r, o);
    if (x.unsupported) unsupported.push(r.keyword);
    return `        ${x.code}`;
  });
  const CASE = { id: c.tcId, title: c.title || '', priority: c.priority || '', app: project, feature: c.module || '', pre: c.pre || [], source, caseRow, controls: [] };
  const RUNS = [{ dataSet: c.dataSet || '', run: '1', row: -1, label: ' run 1', vars: {} }];
  const name = `${c.tcId} ${c.title || ''}`.trim();
  const code = `// @kwcase ${c.tcId}
// @source ${source}
// ${(c.title || '').replace(/\n/g, ' ')}
// Export từ QA Pipeline (Excel automation v2): mỗi dòng keyword là một lệnh. Sửa Excel rồi export lại sẽ ghi đè file này.

const CASE = ${JSON.stringify(CASE, null, 2)};

const RUNS = ${JSON.stringify(RUNS, null, 2)};

describe(${J(name)}, () => {
  for (const data of RUNS) {
    it(\`${c.tcId} · \${data.label}\`, async () => {
      const t = new KwRun(CASE, data);
      try {
${calls.join('\n')}
      } finally {
        await t.finish();
      }
    });
  }
});
`;
  return { code, rows: rows.length, unsupported };
}

const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
export const projectName = (app, file) => slug(`${app.name || app.id}-${file}`);

// Ghi project SimUtil: scripts/<TC>.js (xoá script cũ của lần export trước) + testcases/<file Excel>. Gắn bundle id vào
// scenario.json để SimUtil điền sẵn ô iOS / Android appId của project.
export function exportToSimutil(app, file, cases, { home = SIMUTIL_HOME(), excel } = {}) {
  if (!cases.length) throw Object.assign(new Error('File này chưa có case nào'), { status: 400 });
  const project = projectName(app, file);
  const dir = path.join(home, 'projects', project);
  const scriptsDir = path.join(dir, 'scripts');
  const existed = fs.existsSync(scriptsDir);
  fs.rmSync(scriptsDir, { recursive: true, force: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  const source = excel ? path.basename(excel) : `${file}.xlsx`;
  if (excel && fs.existsSync(excel)) {
    fs.mkdirSync(path.join(dir, 'testcases'), { recursive: true });
    fs.copyFileSync(excel, path.join(dir, 'testcases', source));
  }
  const platform = app.platform || 'iOS';
  const unsupported = {};
  let caseRow = 2; // dòng 1 là header
  for (const c of [...cases].sort((a, b) => a.order - b.order)) {
    const s = caseScript(c, { project, source, platform, caseRow });
    fs.writeFileSync(path.join(scriptsDir, `${c.tcId.replace(/[^A-Za-z0-9._-]/g, '_')}.js`), s.code);
    if (s.unsupported.length) unsupported[c.tcId] = s.unsupported;
    caseRow += s.rows + 1;
  }
  setAppId(home, project, platform, app.bundleId);
  return { project, dir, count: cases.length, replaced: existed, unsupported };
}

function setAppId(home, project, platform, bundleId) {
  if (!bundleId) return;
  const f = path.join(home, 'scenario.json');
  let s = {};
  try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { if (fs.existsSync(f)) return; } // file lỗi → không đụng
  const key = platform === 'Android' ? 'android' : 'ios';
  s.projectAppIds = { ...(s.projectAppIds || {}), [project]: { android: '', ios: '', ...(s.projectAppIds?.[project] || {}), [key]: bundleId } };
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(s));
}

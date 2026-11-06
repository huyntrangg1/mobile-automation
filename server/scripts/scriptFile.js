// Một file Excel = một file test script tests/<file>.e2e.js.
// Khung (import, thứ tự chạy, chuỗi Tiếp nối, report) do tool sinh; mỗi case là 1 region do AI viết (sửa tay được):
//   // #region TC_X
//   CASES['TC_X'] = async ({ tc, data, sa, fill, k }) => { … };   (k = bước dùng chung, src/runner/steps.js)
//   // #endregion TC_X
import fs from 'node:fs';
import path from 'node:path';

const HELPER_DIRS = ['src/utils', 'src/pages', 'src/components', 'src/flows', 'src/locators'];
// Đã import riêng trong khung
const SKIP = /src\/utils\/(softAssert|evidence)\.js$/;

const exportsOf = (code) => [...code.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1])
  .concat([...code.matchAll(/^export\s*\{([^}]+)\}/gm)].flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean)));

// Module helper trong workspace → { ns, rel, exports } (ns = tên namespace dùng trong script)
export function helperModules(workspace) {
  const files = [];
  const walk = (rel) => {
    const abs = path.join(workspace, rel);
    if (!fs.existsSync(abs)) return;
    for (const f of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = `${rel}/${f.name}`;
      if (f.isDirectory()) walk(r);
      else if (f.name.endsWith('.js') && !SKIP.test(r)) files.push(r);
    }
  };
  HELPER_DIRS.forEach(walk);
  // pages: chỉ dùng index.js (gom mọi page object)
  const keep = files.filter((r) => !r.startsWith('src/pages/') || r === 'src/pages/index.js').sort();
  const used = new Set();
  return keep.map((rel) => {
    const parts = rel.replace(/\.js$/, '').split('/').slice(1); // bỏ "src"
    let ns = parts.at(-1) === 'index' ? parts.at(-2) : parts.at(-1);
    ns = ns.replace(/[^A-Za-z0-9_$]/g, '_');
    if (used.has(ns) || ['L', 'tc', 'data', 'sa', 'fill', 'app'].includes(ns) && rel !== 'src/utils/app.js') ns = parts.join('_').replace(/[^A-Za-z0-9_$]/g, '_');
    used.add(ns);
    return { ns, rel, exports: exportsOf(fs.readFileSync(path.join(workspace, rel), 'utf8')) };
  });
}

const REGION = /\/\/ #region (\S+)\n([\s\S]*?)\n\/\/ #endregion \1/g;
const ASSIGN = /^CASES\[(['"])(.+?)\1\] = ([\s\S]*);\s*$/;

// region → thân hàm case (chỉ phần sau "CASES['X'] = ")
export function readRegions(code) {
  const out = {};
  for (const m of code.matchAll(REGION)) {
    const a = m[2].match(ASSIGN);
    out[m[1]] = a ? a[3] : m[2];
  }
  return out;
}

// Tên khung đã dùng — export trùng tên chỉ gọi được qua namespace
const RESERVED = new Set(['L', 'tc', 'data', 'sa', 'fill', 'fillValue', 'snapshot', 'logStep', 'setCase', 'planTest', 'softAssert', 'describeCase',
  'loadV2', 'testcaseFile', 'CASES', 'fs', 'live', 'LIVE', 'current', 'reportLogStep', 'PAUSE', 'FILE', 'SUITE', 'RUN', 'testcases', 'testdata', 'ensureAccounts', 'blockedBy', 'driver', 'browser', '$', '$$', 'createSteps', 'k', 'addFlowBug', 'noteScreen', 'screenSummary', 'resetCurrent', 'startScreen', 'findPath', 'walkPath', 'recoverTo', 'chainBefore', 'navigateStart', 'RECOVER', 'NAVIGATE', 'silent']);

export function buildScript({ file, order, regions, helpers, pack }) {
  const count = new Map();
  for (const h of helpers) for (const e of new Set(h.exports || [])) count.set(e, (count.get(e) || 0) + 1);
  const nsNames = new Set(helpers.map((h) => h.ns));
  const named = (h) => [...new Set(h.exports || [])].filter((e) => count.get(e) === 1 && !RESERVED.has(e) && !nsNames.has(e));
  const imports = helpers.map((h) => {
    const n = named(h);
    return `import * as ${h.ns} from '../${h.rel}';${n.length ? `\nimport { ${n.join(', ')} } from '../${h.rel}';` : ''}`;
  }).join('\n');
  const packLines = pack === 'ik-fitness' ? "import { ensureAccounts } from '../src/runner/fixtures.js';\n" : '';
  const body = order.filter((id) => regions[id] && /^[A-Za-z0-9_.-]+$/.test(id)).map((id) => `// #region ${id}\nCASES['${id}'] = ${regions[id].trim()};\n// #endregion ${id}`).join('\n\n');
  return `// ${file}.e2e.js — sinh bởi QA Pipeline từ data/testcases/${file}.xlsx.
// Phần ngoài các "#region" do tool sinh lại mỗi lần lưu. Mỗi case nằm trong 1 region (AI viết, sửa tay được).
import { loadV2, fill as fillValue } from '../data/loaders/testcase-v2.js';
import { testcaseFile } from '../data/loaders/testdata.js';
import fs from 'node:fs';
import { setCase, planTest, logStep as reportLogStep, addFlowBug, noteScreen, resetCurrent } from '../src/report/collector.js';
import { screenSummary } from '../src/report/hooks.js';
import { softAssert } from '../src/utils/softAssert.js';
import { snapshot } from '../src/utils/evidence.js';
import { describeCase, startScreen } from '../src/runner/describe.js';
import { findPath, walkPath } from '../src/runner/navgraph.js';
import { createSteps } from '../src/runner/steps.js';
import { fillVars } from '../src/runner/compare.js';
import { runWithLimit, guardGlobals } from '../src/runner/limit.js';
import { L } from '../locators/map.js';
${imports}
${packLines}
const FILE = testcaseFile('${file}.xlsx');
const { testcases, testdata } = await loadV2(FILE);
const SUITE = '${file}';
// Case được chọn chạy lần này (tool truyền vào); case khác chỉ planTest → Not Run trong report
const RUN = (process.env.RUN_CASES || '').split(',').filter(Boolean);
const CASES = {};
// Tiến độ từng bước cho màn Run (tool đọc file này); report chung vẫn nhận logStep như cũ
const LIVE = process.env.LIVE_STEPS;
const live = (e) => { if (LIVE) { try { fs.appendFileSync(LIVE, \`\${JSON.stringify({ at: Date.now(), ...e })}\\n\`); } catch {} } };
let current = null;
// Bước cuối đã làm của case đang chạy — ghi vào lý do khi case quá thời gian
let lastDone = '';
const logStep = (e) => { reportLogStep(e); live({ type: 'step', tc: current, ...e }); lastDone = \`\${e.keyword || e.kind} "\${e.target || e.label || ''}" (step \${e.step})\`; };
// Giới hạn mỗi case (ms): hết giờ → huỷ case, chờ code của case dừng hẳn rồi mới sang case sau. Chế độ sửa tay (chờ tester) không giới hạn
const CASE_MS = process.env.MANUAL_FIX === '1' ? 0 : Number(process.env.CASE_TIMEOUT_MS) || 240000;

${body}

let blockedBy = null; // case gần nhất bị chặn trong lượt cài app hiện tại

// Tự phục hồi: case lỗi không phải điểm kiểm (không thấy phần tử, không tới được màn, lỗi thiết bị…) → cài lại app, chạy lại (không ghi report)
// các case phía trước của chuỗi Tiếp nối tới case Cài lại app, rồi thử lại case này. Tối đa AUTO_RECOVER lần (mặc định 1; 0 = tắt).
// Chế độ sửa tay: tester xử lý lỗi nên không tự phục hồi. Chỉ cứu được lỗi chập chờn (app chậm, popup, thiết bị) — lỗi lặp lại ở cả hai lần vẫn Blocked.
const RECOVER = process.env.MANUAL_FIX === '1' ? 0 : Number(process.env.AUTO_RECOVER ?? 1);
const chainBefore = (tc) => {
  const out = [];
  const seen = new Set([tc.id]);
  for (let c = tc; c && !c.fresh && c.prev && !seen.has(c.prev);) {
    c = testcases.find((x) => x.id === c.prev);
    if (!c) break;
    seen.add(c.id);
    out.unshift(c);
  }
  return out;
};
const silent = { eq() {}, assertAll() {} };
async function recoverTo(tc, say) {
  const chain = chainBefore(tc);
  const root = chain[0] || tc;
  say('Phục hồi: cài lại app' + (chain.length ? ', chạy lại ' + chain.map((c) => c.id).join(', ') + ' (không ghi report)' : '') + ', rồi thử lại ' + tc.id);
  if (chain.length && root.fresh) await app.freshStart({ log: say }); // case Cài lại app tự cài ở đầu lần thử lại, không cài hai lần
  for (const c of chain) {
    if (!CASES[c.id]) throw new Error('Chưa có script cho ' + c.id + ' để chạy lại');
    const d = testdata.find((r) => r['Data Set'] === c.dataSet) || {};
    const v = {};
    const f = (x) => fillVars(fillValue(x, d), v);
    await runWithLimit({ reason: null }, () => CASES[c.id]({ tc: c, data: d, sa: silent, fill: f, k: createSteps({ sa: silent, logStep: () => {}, snapshot: async () => ({}), flowBug: () => {}, noteScreen: () => {}, summarize: async () => null, tc: c.id, vars: v }) }), { ms: CASE_MS, describe: () => '' });
    say('Đã chạy lại ' + c.id);
  }
}

// Case Tiếp nối bị chặn vì case trước lỗi → không chặn theo: cài lại app rồi đi theo sơ đồ màn (ghi từ các lần chạy trước, cùng build) tới
// màn bắt đầu của case này. Không có đường đi / đi không tới → giữ Blocked. AUTO_NAVIGATE=0 để tắt.
// Chỉ bảo đảm đúng MÀN, không bảo đảm đúng DỮ LIỆU (lựa chọn / tài khoản case trước tạo ra) → ghi vào Pre-condition của case để QA biết.
const NAVIGATE = process.env.AUTO_NAVIGATE !== '0';
async function navigateStart(tc, meta, say) {
  if (!NAVIGATE || tc.fresh) return false;
  const root = chainBefore(tc)[0];
  const from = root?.fresh ? startScreen(root) : null;
  const to = startScreen(tc);
  if (!from || !to) return false;
  const route = findPath(from, to);
  if (!route) { say('Không có đường đi từ màn ' + from + ' tới màn ' + to + ' trong sơ đồ màn của build này — giữ Blocked'); return false; }
  const skipped = blockedBy;
  say(skipped + ' bị chặn → không chạy theo chuỗi: cài lại app, đi từ màn ' + from + ' tới màn ' + to + (route.length ? ' (' + route.length + ' bước bấm)' : ''));
  try {
    await app.freshStart({ log: say });
    await walkPath(route, say);
  } catch (e) {
    say('Điều hướng không được: ' + String(e.message || e).split('\\n')[0]);
    return false;
  }
  blockedBy = null;
  meta.precondition = [...(meta.precondition || []), 'Bắt đầu bằng điều hướng tự động ' + from + ' → ' + to + ' (không chạy ' + skipped + ' vì bị chặn) — dữ liệu do case trước tạo ra có thể chưa có'];
  setCase(meta);
  return true;
}

describe(SUITE, () => {
  // Tạm dừng: tool tạo file PAUSE_FILE → chờ trước case kế tiếp (không cắt giữa case), giữ phiên Appium sống
  const PAUSE = process.env.PAUSE_FILE;
  beforeEach(async function () {
    if (!PAUSE || !fs.existsSync(PAUSE)) return;
    this.timeout(0);
    live({ type: 'paused' });
    for (let n = 1; fs.existsSync(PAUSE); n++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (n % 30 === 0) await driver.getWindowRect().catch(() => {});
    }
    live({ type: 'resumed' });
  });
  for (const tc of testcases) {
    const title = \`\${tc.id} \${tc.title}\`;
    planTest({ suite: SUITE, title, case: { id: tc.id, title: tc.title, file: FILE } });
    if (RUN.length ? !RUN.includes(tc.id) : !CASES[tc.id]) continue;
    it(title, async function () {
      // Platform ở dòng Case khác nền tảng đang chạy → Skipped (không chạy giả thành Passed)
      if (tc.platform && !['All', process.env.PLATFORM || 'iOS'].includes(tc.platform)) {
        live({ type: 'start', tc: tc.id });
        live({ type: 'end', tc: tc.id, ok: true, skipped: \`Chỉ chạy trên \${tc.platform}\` });
        this.skip();
      }
      const data = testdata.find((r) => r['Data Set'] === tc.dataSet) || {};
      const meta = { id: tc.id, title: tc.title, priority: tc.priority, feature: SUITE, file: FILE, ...describeCase(tc, data) };
      setCase(meta);
      if (tc.fresh) blockedBy = null;
      current = tc.id;
      lastDone = '';
      // Mocha chờ đủ: giới hạn của case + thời gian cài app + chờ case bị huỷ dừng hẳn (+ mỗi lần phục hồi / điều hướng: cài lại app và chạy lại / đi lại)
      if (CASE_MS) this.timeout((CASE_MS + 150000) * (1 + RECOVER * (1 + chainBefore(tc).length)) + 300000);
      guardGlobals();
      const say = (text) => live({ type: 'info', tc: tc.id, text });
      if (blockedBy && !(await navigateStart(tc, meta, say))) throw new Error(\`TC trước bị chặn (\${blockedBy}) nên app không ở đúng trạng thái để chạy tiếp\`);
      if (!CASES[tc.id]) { blockedBy = tc.id; throw new Error(\`Chưa có script cho \${tc.id} trong file — gen script trước khi chạy\`); }
      let sa;
      for (let attempt = 0; ; attempt++) {
        live({ type: 'start', tc: tc.id });
        sa = softAssert();
        const eq = sa.eq;
        // Ghi điểm kiểm ra file live (không kèm ảnh evidence)
        sa.eq = (step, label, actual, expected, evidence, info = {}) => {
          live({ type: 'step', tc: current, kind: 'Check', step, label, ok: actual === expected, actual, expected, ...info });
          return eq(step, label, actual, expected, evidence, info);
        };
        try {
${pack === 'ik-fitness' ? '          if (tc.fresh) await ensureAccounts(tc);\n' : ''}          if (tc.fresh) await app.freshStart({ log: say });
          // Biến của TC ({{tên}}): Save value / Set variable / Generate data ghi vào, fill() đọc ra — cùng 1 object
          const vars = {};
          const fill = (v) => fillVars(fillValue(v, data), vars);
          await runWithLimit({ reason: null }, () => CASES[tc.id]({ tc, data, sa, fill, k: createSteps({ sa, logStep, snapshot, flowBug: addFlowBug, noteScreen, summarize: screenSummary, tc: tc.id, vars }) }), { ms: CASE_MS, describe: () => lastDone });
          blockedBy = null;
          break;
        } catch (e) {
          // Lỗi điều hướng / thiếu phần tử có thể do app chậm / popup / thiết bị chập chờn → phục hồi rồi thử lại (điểm kiểm lệch thật thì không thử lại)
          if (e.name !== 'AssertionError' && attempt < RECOVER) {
            say(\`Lỗi: \${String(e.message || e).split('\\n')[0]} — thử phục hồi (lần \${attempt + 1}/\${RECOVER})\`);
            try {
              await recoverTo(tc, say);
              resetCurrent();
              setCase(meta);
              lastDone = '';
              continue;
            } catch (re) {
              say(\`Phục hồi không được: \${String(re.message || re).split('\\n')[0]}\`);
            }
          }
          // Lỗi điều hướng / thiếu phần tử làm hỏng trạng thái app → case sau trong chuỗi bị chặn
          if (e.name !== 'AssertionError') blockedBy = tc.id;
          live({ type: 'end', tc: tc.id, ok: false, error: String(e.message || e).split('\\n')[0] });
          throw e;
        }
      }
      live({ type: 'end', tc: tc.id, ok: true });
      sa.assertAll();
    });
  }
});
`;
}

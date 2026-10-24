// Một file Excel = một file test script tests/<file>.e2e.js.
// Khung (import, thứ tự chạy, chuỗi Tiếp nối, report) do tool sinh; mỗi case là 1 region do AI viết (sửa tay được):
//   // #region TC_X
//   CASES['TC_X'] = async ({ tc, data, sa, fill }) => { … };
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
  'loadV2', 'testcaseFile', 'CASES', 'fs', 'live', 'LIVE', 'current', 'reportLogStep', 'PAUSE', 'FILE', 'SUITE', 'RUN', 'testcases', 'testdata', 'ensureAccounts', 'blockedBy', 'driver', 'browser', '$', '$$']);

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
import { setCase, planTest, logStep as reportLogStep } from '../src/report/collector.js';
import { softAssert } from '../src/utils/softAssert.js';
import { snapshot } from '../src/utils/evidence.js';
import { describeCase } from '../src/runner/describe.js';
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
const logStep = (e) => { reportLogStep(e); live({ type: 'step', tc: current, ...e }); };

${body}

let blockedBy = null; // case gần nhất bị chặn trong lượt cài app hiện tại

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
    it(title, async () => {
      const data = testdata.find((r) => r['Data Set'] === tc.dataSet) || {};
      setCase({ id: tc.id, title: tc.title, priority: tc.priority, feature: SUITE, file: FILE, ...describeCase(tc, data) });
      if (tc.fresh) blockedBy = null;
      if (blockedBy) throw new Error(\`TC trước bị chặn (\${blockedBy}) nên app không ở đúng trạng thái để chạy tiếp\`);
      if (!CASES[tc.id]) { blockedBy = tc.id; throw new Error(\`Chưa có script cho \${tc.id} trong file — gen script trước khi chạy\`); }
      current = tc.id;
      live({ type: 'start', tc: tc.id });
      const sa = softAssert();
      const eq = sa.eq;
      // Ghi điểm kiểm ra file live (không kèm ảnh evidence)
      sa.eq = (step, label, actual, expected, evidence, info = {}) => {
        live({ type: 'step', tc: current, kind: 'Check', step, label, ok: actual === expected, actual, expected, ...info });
        return eq(step, label, actual, expected, evidence, info);
      };
      try {
${pack === 'ik-fitness' ? '        if (tc.fresh) await ensureAccounts(tc);\n' : ''}        if (tc.fresh) await app.freshStart();
        await CASES[tc.id]({ tc, data, sa, fill: (v) => fillValue(v, data) });
        blockedBy = null;
      } catch (e) {
        // Lỗi điều hướng / thiếu phần tử làm hỏng trạng thái app → case sau trong chuỗi bị chặn
        if (e.name !== 'AssertionError') blockedBy = tc.id;
        live({ type: 'end', tc: tc.id, ok: false, error: String(e.message || e).split('\\n')[0] });
        throw e;
      }
      live({ type: 'end', tc: tc.id, ok: true });
      sa.assertAll();
    });
  }
});
`;
}

// Ghi test case automation format v2 (mỗi thao tác / điểm kiểm = 1 dòng): giữ TC lẻ, chạy liên tiếp, chỉ cài lại app khi cần.
// Pre-condition dòng 1 = "Cài lại app" hoặc "Tiếp nối <TC trước>"; thứ tự TC trong sheet = thứ tự chạy.
// Mỗi sheet chức năng của file gốc → 1 file riêng: <out-dir>/<sheet>-automation.xlsx (TestCases + TestData), style theo mẫu v2.
// Case test tay chỉ in ra màn hình (vẫn nằm trong file gốc).
//   node scripts/write.mjs <plan.json> <cases.json> <out-dir>
// plan: {
//   testcases: [{ id, fresh: true|false, pre: [], dataSet?: "", rows: [{ step, screen, kind: Action|Nav|Check, keyword, target?, value?, compare?, platform?, label? }] }],
//            (xếp theo thứ tự chạy; fresh = cài lại app trước TC này)
//   flows?: { "<tên luồng>": [rows như trên] },   (gọi bằng keyword Run flow, Value = tên luồng → sheet Flows)
//   testdata?: [{ "Data Set", "Run", ...cột, "Ghi chú"? }],
//   manual: [{ tc, reason }]
// }
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [planFile, casesFile, outDir] = process.argv.slice(2);
const ExcelJS = createRequire(import.meta.url)('exceljs'); // exceljs cài trong thư mục skill (npm install)
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const src = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
const original = new Map(src.sheets.flatMap((s) => s.cases.map((c) => [c.id, { ...c, sheet: s.sheet }])));

// ---- Bộ từ khoá v2 (danh sách chọn trong file mẫu + Relaunch app, contains + nhóm bổ sung bên dưới)
const KEYWORDS = {
  Action: ['Launch fresh', 'Relaunch app', 'Reset app data', 'Background app', 'Open deep link', 'Open URL', 'Open notification',
    'Tap', 'Double tap', 'Long press', 'Tap outside', 'Toggle', 'Deselect all', 'Enter', 'Clear', 'Press key', 'Hide keyboard', 'Set ruler', 'Select date',
    'Select picker', 'Scroll', 'Scroll to', 'Swipe', 'Back', 'Close browser', 'Handle permission', 'Set network',
    'Wait', 'Wait until displayed', 'Wait until not displayed', 'Wait until enabled',
    'Run flow', 'Save value', 'Set variable', 'Generate data', 'Run setup'],
  Nav: ['Verify screen'],
  Check: ['Verify displayed', 'Verify not displayed', 'Verify text', 'Verify value', 'Verify placeholder', 'Verify focused', 'Verify attribute',
    'Verify keyboard displayed', 'Verify keyboard not displayed', 'Verify enabled', 'Verify disabled', 'Verify selected',
    'Verify not selected', 'Verify order', 'Verify count', 'Verify layout', 'Verify external URL', 'Verify app opened', 'Run check'],
};
// Keyword tạo biến dùng lại bằng {{tên}}: tên biến nằm ở Value (Save value) hoặc Target (Set variable, Generate data)
const VAR_FROM = { 'Save value': 'value', 'Set variable': 'target', 'Generate data': 'target' };
// Value bắt buộc + định dạng của các keyword cần tham số
const VALUE_RULES = {
  Swipe: [/^(left|right|up|down)$/, 'left / right / up / down'],
  'Background app': [/^\d+$/, 'số giây ở nền'],
  'Long press': [/^(\d+)?$/, 'số giây (hoặc để trống)'],
  Wait: [/^\d+$/, 'số giây'],
  'Wait until displayed': [/^\d+$/, 'timeout (giây)'],
  'Wait until not displayed': [/^\d+$/, 'timeout (giây)'],
  'Set network': [/^(on|off)$/, 'on / off'],
  'Handle permission': [/^(Allow|Don't allow)$/, "Allow / Don't allow"],
  'Open deep link': [/^[a-z][\w+.-]*:\/\/\S+$/i, 'URL deep link (scheme://…)'],
  Enter: [/\S/, 'text cần nhập'],
  'Set ruler': [/\S/, 'giá trị trên thước'],
  'Select date': [/\S/, 'ngày cần chọn'],
  'Select picker': [/\S/, 'mục cần chọn trên wheel'],
  'Run flow': [/\S/, 'tên luồng trong plan.flows'],
  'Save value': [/^\w+$/, 'tên biến (chữ, số, _)'],
  'Run setup': [/\S/, 'tên hook dev cung cấp'],
  'Run check': [/\S/, 'tên hook dev cung cấp'],
  'Verify value': [/\S/, 'giá trị mong đợi'],
  'Verify placeholder': [/\S/, 'placeholder mong đợi'],
  'Verify count': [/^\d+$/, 'số lượng'],
  // Luật bố cục: "<đo> <so sánh> <số>" cách nhau ";" — đo: width, height, left, right, top, bottom, centerOffset, lines, spaceAbove, spaceBelow
  'Verify layout': [/^\s*(width|height|left|right|top|bottom|centerOffset|lines|spaceAbove|spaceBelow)\s*(<=|>=|=|<|>)\s*-?\d+(\.\d+)?\s*(;\s*(width|height|left|right|top|bottom|centerOffset|lines|spaceAbove|spaceBelow)\s*(<=|>=|=|<|>)\s*-?\d+(\.\d+)?\s*)*;?\s*$/, 'luật bố cục, vd "width <= 260; lines = 2"'],
  'Verify order': [/;/, 'các nhãn theo thứ tự, cách nhau bằng ";"'],
  'Verify external URL': [/\S/, 'URL hoặc đoạn URL'],
  'Verify app opened': [/^[A-Za-z][\w-]*(\.[\w-]+)+$/, 'bundle id / package (vd com.apple.AppStore)'],
  'Open URL': [/^https?:\/\/\S+$/i, 'URL http(s)://…'],
  Toggle: [/^(on|off)$/, 'on / off'],
  'Press key': [/^[A-Za-z0-9_]+$/, 'tên phím (vd ENTER, DEL, TAB)'],
  Scroll: [/^(up|down|left|right)$/, 'up / down / left / right'],
  'Wait until enabled': [/^\d+$/, 'timeout (giây)'],
  'Set variable': [/\S/, 'giá trị gán cho biến'],
  'Generate data': [/^(email|phone|text|number|uuid)$/, 'email / phone / text / number / uuid'],
  'Verify attribute': [/^[\w-]+=.*$/, '<thuộc tính>=<giá trị> (vd checked=true)'],
};
// Keyword thao tác / kiểm trên 1 phần tử → Target bắt buộc
const NEEDS_TARGET = ['Open notification', 'Tap', 'Double tap', 'Long press', 'Tap outside', 'Toggle', 'Deselect all', 'Enter', 'Clear', 'Set ruler',
  'Select date', 'Select picker', 'Scroll to', 'Handle permission', 'Wait until displayed', 'Wait until not displayed', 'Wait until enabled',
  'Save value', 'Set variable', 'Generate data', 'Verify screen', 'Verify displayed', 'Verify not displayed', 'Verify text', 'Verify value',
  'Verify placeholder', 'Verify focused', 'Verify attribute', 'Verify enabled', 'Verify disabled', 'Verify selected', 'Verify not selected',
  'Verify order', 'Verify count', 'Verify layout'];
const ALL_KEYWORDS = [...KEYWORDS.Action, ...KEYWORDS.Nav, ...KEYWORDS.Check];
const COMPARES = ['equals', 'not equals', 'contains', 'not contains', 'regex', 'greater than', 'greater or equal', 'less than', 'less or equal',
  'empty', 'not empty', 'number', 'unit', 'date:DD/MM/YYYY', 'all-on'];
const NUMERIC_COMPARES = ['greater than', 'greater or equal', 'less than', 'less or equal'];
const PLATFORMS = ['All', 'iOS', 'Android'];

// ---- Style của file mẫu v2
const HEAD_FILL = 'FF1F4E78';
const KIND_FILL = { Case: 'FFD9E1F2', Nav: 'FFEDF3FA', Check: 'FFFFF2CC' };
const BORDER = Object.fromEntries(['left', 'right', 'top', 'bottom'].map((s) => [s, { style: 'thin', color: { argb: 'FFBFBFBF' } }]));
const list = (items) => ({ type: 'list', allowBlank: true, formulae: [`"${items.join(',')}"`] });
function styleSheet(ws) {
  const n = ws.columnCount;
  const head = ws.getRow(1);
  head.height = 30;
  for (let c = 1; c <= n; c++) {
    Object.assign(head.getCell(c), {
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } },
      font: { bold: true, color: { argb: 'FFFFFFFF' } },
      alignment: { vertical: 'middle', wrapText: true },
      border: BORDER,
    });
  }
  ws.eachRow((row, i) => {
    if (i === 1) return;
    for (let c = 1; c <= n; c++) Object.assign(row.getCell(c), { border: BORDER, alignment: { vertical: 'top', wrapText: true } });
  });
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1, topLeftCell: 'B2' }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: n } };
}
// Tô màu theo Kind + dropdown Kind / Keyword / Compare / Platform; kindCol = cột Kind (Keyword, Compare, Platform lần lượt +1, +4, +5)
function paintRows(ws, kindCol) {
  const n = ws.columnCount;
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const kind = row.getCell(kindCol).value;
    if (KIND_FILL[kind]) for (let col = 1; col <= n; col++) row.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: KIND_FILL[kind] } };
    if (kind === 'Case') row.font = { bold: true };
    row.getCell(kindCol).dataValidation = list(['Case', 'Action', 'Nav', 'Check']);
    // Danh sách keyword > 255 ký tự (giới hạn list inline của Excel) → lấy từ sheet ẩn Lists
    row.getCell(kindCol + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [`Lists!$A$1:$A$${ALL_KEYWORDS.length}`] };
    row.getCell(kindCol + 4).dataValidation = list(COMPARES);
    row.getCell(kindCol + 5).dataValidation = list(PLATFORMS);
  });
}

// ---- Kiểm
const problems = [];
const auto = new Map(plan.testcases.map((t) => [t.id, t]));
const manual = new Set(plan.manual.map((m) => m.tc));
if (auto.size !== plan.testcases.length) problems.push('Có TC lặp');
for (const c of original.values()) {
  if (!c.selected) continue;
  if (!auto.has(c.id) && !manual.has(c.id)) problems.push(`Chưa xếp: ${c.id} (${c.sheet} · ${c.module})`);
  if (auto.has(c.id) && manual.has(c.id)) problems.push(`Vừa automation vừa Manual: ${c.id}`);
}
for (const id of [...auto.keys(), ...manual]) if (!original.get(id)?.selected) problems.push(`Không có / không thuộc diện chọn: ${id}`);
// TC đầu tiên của mỗi sheet phải cài lại app (chưa có TC trước để tiếp nối)
const firstOfSheet = new Set();
for (const t of plan.testcases) {
  const sh = original.get(t.id)?.sheet;
  if (!firstOfSheet.has(sh)) {
    firstOfSheet.add(sh);
    if (!t.fresh) problems.push(`${t.id}: TC đầu tiên của sheet ${sh} phải có fresh = true`);
  }
}
const TRANSIENT = /…|\.\.\.|loading|importing|toast|snackbar/i; // popup / loader / toast thoáng qua
const AUTO_SCREEN = /^(importing|loading|uploading|processing)\b/i; // màn / slide tự chuyển sang màn sau
const review = [];
const dataSets = new Set((plan.testdata || []).map((r) => r['Data Set']));
const flows = plan.flows || {};
const hooks = new Set();

// Kiểm từng dòng (dùng chung cho TC và luồng trong plan.flows); saved = biến đã Save value trước dòng này
function checkRows(owner, rows, saved, inFlow) {
  for (const r of rows) {
    const at = `${owner} step ${r.step}`;
    if (!KEYWORDS[r.kind]?.includes(r.keyword)) problems.push(`${at}: keyword "${r.keyword}" không hợp lệ cho Kind ${r.kind}`);
    if (r.kind === 'Check' && !r.label) problems.push(`${at}: dòng Check thiếu Check label`);
    const vr = VALUE_RULES[r.keyword];
    const emptyCompare = ['empty', 'not empty'].includes(r.compare); // so rỗng / không rỗng → không có Value
    if (vr && !emptyCompare && !vr[0].test(String(r.value ?? ''))) problems.push(`${at}: ${r.keyword} cần Value = ${vr[1]}`);
    if (NEEDS_TARGET.includes(r.keyword) && !String(r.target ?? '').trim()) problems.push(`${at}: ${r.keyword} cần Target`);
    if (r.compare && !COMPARES.includes(r.compare)) problems.push(`${at}: Compare "${r.compare}" không có trong danh sách`);
    if (NUMERIC_COMPARES.includes(r.compare) && !/^-?\d+(\.\d+)?$/.test(String(r.value ?? ''))) problems.push(`${at}: Compare ${r.compare} cần Value là số`);
    if (emptyCompare && String(r.value ?? '') !== '') problems.push(`${at}: Compare ${r.compare} để trống Value`);
    if (r.compare === 'regex') {
      try { new RegExp(r.value); } catch { problems.push(`${at}: regex "${r.value}" sai cú pháp`); }
    }
    if (r.platform && !PLATFORMS.includes(r.platform)) problems.push(`${at}: Platform "${r.platform}" lạ`);
    if (r.keyword === 'Set network' && r.platform !== 'Android') problems.push(`${at}: Set network chỉ chạy trên Android — Platform = Android`);
    if (r.keyword === 'Run flow') {
      if (inFlow) problems.push(`${at}: luồng không gọi lồng luồng khác`);
      else if (!flows[r.value]) problems.push(`${at}: luồng "${r.value}" chưa khai báo trong plan.flows`);
      else for (const fr of flows[r.value]) if (VAR_FROM[fr.keyword]) saved.add(fr[VAR_FROM[fr.keyword]]);
    }
    if (inFlow && ['Launch fresh', 'Relaunch app', 'Reset app data', 'Background app', 'Set network'].includes(r.keyword))
      problems.push(`${at}: luồng dùng lại không chứa ${r.keyword} (đặt thẳng trong TC)`);
    for (const [, v] of String(r.value ?? '').matchAll(/\{\{(\w+)\}\}/g))
      if (!saved.has(v)) problems.push(`${at}: biến {{${v}}} chưa được tạo (Save value / Set variable / Generate data) trước đó trong TC này`);
    if (VAR_FROM[r.keyword]) {
      const name = r[VAR_FROM[r.keyword]];
      if (!/^\w+$/.test(String(name ?? ''))) problems.push(`${at}: tên biến "${name}" chỉ gồm chữ, số, _`);
      saved.add(name);
    }
    if (['Run setup', 'Run check'].includes(r.keyword)) hooks.add(r.value);
    if (r.keyword === 'Wait' && Number(r.value) > 30) review.push(`${at}: Wait ${r.value} giây — chờ cố định lâu, cân nhắc Wait until …`);
  }
}

for (const [name, rows] of Object.entries(flows)) {
  if (!Array.isArray(rows) || !rows.length) { problems.push(`Luồng "${name}": không có dòng nào`); continue; }
  checkRows(`Luồng "${name}"`, rows, new Set(), true);
  lintChecks({ id: `Luồng "${name}"`, rows });
}
const usedFlows = new Set();
for (const t of plan.testcases) {
  if (typeof t.fresh !== 'boolean') problems.push(`${t.id}: thiếu fresh (true / false)`);
  if (t.platform && !PLATFORMS.includes(t.platform)) problems.push(`${t.id}: platform "${t.platform}" lạ`);
  if (t.dataSet && !dataSets.has(t.dataSet)) problems.push(`${t.id}: Data Set "${t.dataSet}" không có trong TestData`);
  if (!t.rows?.some((r) => r.kind === 'Check')) problems.push(`${t.id}: không có dòng Check`);
  checkRows(t.id, t.rows || [], new Set(), false);
  for (const r of t.rows || []) if (r.keyword === 'Run flow') usedFlows.add(r.value);
  lintChecks(t);
}
// Luồng thừa không làm sai TC nào → chỉ cần review (không chặn ghi cả sheet)
for (const name of Object.keys(flows)) if (!usedFlows.has(name)) review.push(`Luồng "${name}" khai báo nhưng không TC nào dùng`);
lintChains();

// ---- Quy tắc xếp chuỗi (SKILL.md bước 4): 1 TC lỗi không kéo cả file Blocked theo
function lintChains() {
  const BREAK = ['Relaunch app', 'Reset app data', 'Background app', 'Set network'];
  // Bước dễ chặn luồng nhưng đôi khi phải nằm giữa chuỗi (đường tới màn sau) → không cấm, đưa vào Cần review
  const RISKY = ['Handle permission', 'Close browser'];
  const MAX_CHAIN = 10;
  const bySheet = new Map();
  for (const t of plan.testcases) {
    const sh = original.get(t.id)?.sheet;
    if (!bySheet.has(sh)) bySheet.set(sh, []);
    bySheet.get(sh).push(t);
  }
  for (const list of bySheet.values()) {
    let len = 0;
    list.forEach((t, i) => {
      len = t.fresh ? 1 : len + 1;
      if (len === MAX_CHAIN + 1) problems.push(`${t.id}: chuỗi tiếp nối quá ${MAX_CHAIN} TC — cắt ở ranh giới nhóm màn, TC này fresh = true`);
      const brk = (t.rows || []).find((r) => BREAK.includes(r.keyword));
      if (brk && list[i + 1] && !list[i + 1].fresh)
        problems.push(`${t.id}: có ${brk.keyword} nên phải đứng cuối chuỗi — ${list[i + 1].id} cần fresh = true, hoặc tách ${t.id} chạy riêng`);
      const risky = (t.rows || []).find((r) => RISKY.includes(r.keyword));
      if (risky && list[i + 1] && !list[i + 1].fresh)
        review.push(`${t.id}: có ${risky.keyword} giữa chuỗi — lỗi ở đây chặn ${list[i + 1].id} trở đi; cân nhắc để cuối chuỗi`);
    });
  }
  for (const t of plan.testcases) {
    const rows = t.rows || [];
    rows.forEach((r, i) => {
      if (['Relaunch app', 'Reset app data', 'Background app'].includes(r.keyword) && rows[i + 1]?.kind === 'Nav')
        problems.push(`${t.id} step ${r.step}: màn sau ${r.keyword} là Expected — kiểm bằng Check, không Nav (sai màn phải ra Failed, không Blocked)`);
    });
    for (const l of t.pre || []) {
      if (/bỏ chọn tất cả|bỏ chọn hết|deselect all/i.test(l))
        problems.push(`${t.id} pre: "${l}" — bỏ chọn tất cả viết thành dòng Action · Deselect all ở Step 0, không viết trong pre`);
      else if (/bỏ chọn/i.test(l) && !/mọi|cả \d|chưa chọn .*nào|không còn .*nào/i.test(l))
        review.push(`${t.id} pre: "${l}" chỉ ghi phần chênh với TC trước — ghi trạng thái cuối (Deselect all rồi chọn đúng …)`);
      if (t.fresh && /→|\btap\b|\bchọn\b|\bbấm\b|\bnhấn\b/i.test(l))
        problems.push(`${t.id} pre: "${l}" — đường đi của TC cài lại app viết bằng Run flow ở Step 0 (mỗi chặng màn → màn là 1 flow), pre chỉ ghi điều kiện thiết bị`);
    }
    for (const r of rows) if (r.keyword === 'Verify layout') review.push(`${t.id} step ${r.step}: ngưỡng bố cục "${r.value}" — đối chiếu design / cỡ màn thiết bị chạy`);
  }
}

// ---- Quy tắc viết check (SKILL.md bước 5): lỗi = case pass dù app sai
function lintChecks(t) {
  const rows = t.rows || [];
  const checks = rows.filter((r) => r.kind === 'Check');
  if (checks.length && checks.every((r) => r.keyword === 'Verify not displayed'))
    problems.push(`${t.id}: chỉ có Verify not displayed — thêm check dương (app treo / sai màn cũng pass)`);
  rows.forEach((r, i) => {
    if (r.kind === 'Nav') {
      let ok = false;
      for (let j = i + 1; j < rows.length && rows[j].kind === 'Check'; j++)
        if (rows[j].screen === r.screen && rows[j].keyword !== 'Verify not displayed') ok = true;
      if (!ok) problems.push(`${t.id} step ${r.step}: sau Verify screen "${r.screen}" thiếu check dương riêng của màn (vd tiêu đề equals)`);
    }
    if (r.keyword === 'Verify displayed' && TRANSIENT.test(r.target || ''))
      problems.push(`${t.id} step ${r.step}: "${r.target}" thoáng qua — dùng Wait until displayed / not displayed, không Verify displayed`);
    // Màn tự chuyển (slide Importing…, loader): app đã sang màn sau trước khi runner kịp thấy → chờ màn đích, không chờ / bấm trên nó
    if (['Wait until displayed', 'Tap'].includes(r.keyword) && (AUTO_SCREEN.test(r.screen || '') || AUTO_SCREEN.test(r.target || '')))
      problems.push(`${t.id} step ${r.step}: ${r.keyword} trên màn tự chuyển "${r.screen}" — bỏ dòng này, chờ màn đích (Wait until displayed tiêu đề) hoặc chờ dấu hiệu bước trước biến mất`);
    if (['contains', 'regex'].includes(r.compare) && r.keyword !== 'Verify external URL') review.push(`${t.id} step ${r.step}: ${r.compare} "${r.value}"`);
  });
}

// ---- Ghi: 1 file / sheet chức năng
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sheetOf = (id) => original.get(id)?.sheet;
const sheets = [...new Set([...plan.testcases.map((t) => sheetOf(t.id)), ...plan.manual.map((m) => sheetOf(m.tc))])].filter(Boolean);
fs.mkdirSync(outDir, { recursive: true });
const written = [];
for (const sheet of sheets) {
  const wb = new ExcelJS.Workbook();
  const mine = plan.testcases.filter((t) => sheetOf(t.id) === sheet); // giữ thứ tự chạy của plan

  const ws = wb.addWorksheet('TestCases');
  ws.columns = [
    ['TC ID', 16], ['Title', 34], ['Priority', 8], ['Pre-condition', 40], ['Data Set', 13], ['Step', 6], ['Screen', 17], ['Kind', 8],
    ['Keyword', 17], ['Target', 26], ['Value', 30], ['Compare', 14], ['Platform', 9], ['Check label', 32], ['Test Result', 11], ['Last Run', 16],
  ].map(([header, width]) => ({ header, key: header, width }));
  mine.forEach((t, i) => {
    const c = original.get(t.id) || {};
    // Dòng đầu Pre-condition quyết định cách bắt đầu TC; thứ tự TC trong sheet = thứ tự chạy
    const where = t.fresh ? 'Cài lại app' : `Tiếp nối ${mine[i - 1]?.id}`;
    const pre = (t.pre || []).filter((l) => !(t.fresh && /^Cài lại app/i.test(l)));
    ws.addRow({
      'TC ID': t.id, Title: c.description || c.scenario, Priority: c.priority, Kind: 'Case', 'Data Set': t.dataSet || '',
      'Pre-condition': [where, ...pre].map((l, i) => `${i + 1}. ${l}`).join('\n'),
      // Platform ở dòng Case: cả TC chỉ chạy trên nền tảng đó (nền tảng khác → Skipped)
      ...(t.platform && t.platform !== 'All' ? { Platform: t.platform } : {}),
    });
    for (const r of t.rows) {
      ws.addRow({
        Step: r.step, Screen: r.screen, Kind: r.kind, Keyword: r.keyword, Target: r.target ?? '', Value: r.value ?? '',
        Compare: r.compare ?? '', Platform: r.platform || 'All', 'Check label': r.label ?? '',
      });
    }
  });
  styleSheet(ws);
  paintRows(ws, 8);

  // Luồng dùng lại mà các TC của sheet này gọi (Run flow) → sheet Flows, runner chạy như thể nằm tại chỗ gọi
  const myFlows = [...new Set(mine.flatMap((t) => (t.rows || []).filter((r) => r.keyword === 'Run flow').map((r) => r.value)))];
  if (myFlows.length) {
    const fw = wb.addWorksheet('Flows');
    fw.columns = [['Flow', 20], ['Step', 6], ['Screen', 17], ['Kind', 8], ['Keyword', 17], ['Target', 26], ['Value', 30], ['Compare', 14],
      ['Platform', 9], ['Check label', 32]].map(([header, width]) => ({ header, key: header, width }));
    // Luồng chưa khai báo: đã ghi vào problems ở bước kiểm → bỏ qua ở đây (không crash, để lỗi được báo rõ cho từng TC)
    for (const name of myFlows)
      for (const r of Array.isArray(flows[name]) ? flows[name] : []) {
        fw.addRow({
          Flow: name, Step: r.step, Screen: r.screen, Kind: r.kind, Keyword: r.keyword, Target: r.target ?? '', Value: r.value ?? '',
          Compare: r.compare ?? '', Platform: r.platform || 'All', 'Check label': r.label ?? '',
        });
      }
    styleSheet(fw);
    paintRows(fw, 4);
  }

  const td = wb.addWorksheet('TestData');
  const sets = new Set(mine.map((t) => t.dataSet).filter(Boolean));
  const rows = (plan.testdata || []).filter((r) => sets.has(r['Data Set']));
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !['Data Set', 'Run', 'Ghi chú'].includes(k));
  td.columns = ['Data Set', 'Run', ...keys, 'Ghi chú', 'Result', 'Bug', 'Last Run'].map((k) => ({ header: k, key: k, width: k === 'Ghi chú' ? 40 : 14 }));
  for (const r of rows) td.addRow(r);
  styleSheet(td);

  const lists = wb.addWorksheet('Lists', { state: 'hidden' });
  ALL_KEYWORDS.forEach((k) => lists.addRow([k]));

  const file = path.join(outDir, `${slug(sheet)}-automation.xlsx`);
  await wb.xlsx.writeFile(file);
  const installs = mine.filter((t) => t.fresh).length;
  written.push(`${file}\n  ${sheet}: ${mine.length} TC automation · ${plan.manual.filter((x) => sheetOf(x.tc) === sheet).length} manual · cài app ${installs} lần (trước: ${mine.length})`);
}

const sel = [...original.values()].filter((c) => c.selected).length;
console.log(`Đã ghi:\n${written.join('\n')}`);
console.log(`Case gốc: ${original.size} · chọn ${sel} · automation ${auto.size} · manual ${manual.size} · không chọn ${original.size - sel}`);
// Case test tay vẫn nằm trong file gốc → chỉ liệt kê ở đây, không ghi vào file automation
console.log(`Test tay (giữ trong file gốc):\n${plan.manual.map((m) => `  ${m.tc}: ${m.reason}`).join('\n')}`);
if (hooks.size) console.log(`\nHook cần dev cung cấp (Run setup / Run check):\n- ${[...hooks].join('\n- ')}`);
if (review.length) console.log(`\nCần review (so sánh lỏng, ghi lý do trong báo cáo):\n- ${review.join('\n- ')}`);
if (problems.length) { console.log(`\nLỖI (${problems.length}):\n- ${problems.join('\n- ')}`); process.exit(1); }
console.log('Độ phủ + format v2: OK');

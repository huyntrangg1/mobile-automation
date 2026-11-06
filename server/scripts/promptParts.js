// Phần prompt gen-case gửi cho AI — gửi đúng cái case cần để bớt token (AI không đọc file, chỉ dùng prompt):
//   locator: màn liên quan tới case → đủ phần tử; màn khác → tên + vài phần tử (AI tự khớp tên màn Excel ↔ map)
//   keywords: cách helper pack làm từng keyword (trích src/runner/keywords.js nếu có)
import fs from 'node:fs';
import path from 'node:path';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
// Chữ có ở hầu hết các màn → không dùng để đoán màn liên quan
const GENERIC = new Set(['back', 'continue', 'close', 'next', 'done', 'ok', 'cancel', 'skip', 'title', 'subtitle', 'allow']);
// Trùng nhau, hoặc chuỗi này chứa chuỗi kia (đủ dài để không khớp bừa)
const like = (a, b) => a === b || (Math.min(a.length, b.length) >= 6 && (a.includes(b) || b.includes(a)));

// Tên màn trong locator map mà case có thể dùng: tên / alias khớp cột Screen hoặc Target / Value,
// hoặc màn có phần tử khớp Target / Value / chữ trong ngoặc kép ở Pre-condition
export function pickScreens(rows, table, { aliases = {}, pre = [] } = {}) {
  const screens = [...new Set(rows.map((r) => norm(r.screen)).filter(Boolean))];
  const want = new Set();
  for (const r of rows) for (const v of [r.target, r.value]) if (v && !/\$\{/.test(v) && !GENERIC.has(norm(v))) want.add(norm(v));
  for (const l of pre) for (const m of String(l).matchAll(/"([^"]+)"/g)) if (!GENERIC.has(norm(m[1]))) want.add(norm(m[1]));
  const wants = [...want];
  return Object.keys(table).filter((name) => {
    const names = [name, ...(aliases[name] || [])].map(norm);
    if (names.some((n) => screens.some((s) => like(n, s)) || wants.some((w) => like(n, w)))) return true;
    return table[name].some((e) => {
      const k = norm(e.key);
      return !GENERIC.has(k) && wants.some((w) => like(k, w));
    });
  });
}

export function locatorText(table, picked) {
  const full = picked.map((n) => `## "${n}"\n${table[n].map((r) => `- ${r.type} ${JSON.stringify(r.key)}`).join('\n')}`).join('\n\n');
  const rest = Object.keys(table).filter((n) => !picked.includes(n));
  if (!rest.length) return full;
  const brief = rest.map((n) => `- "${n}": ${table[n].slice(0, 6).map((r) => JSON.stringify(r.key)).join(' · ')}`).join('\n');
  return `${full}\n\n## Màn khác (chỉ tên + vài phần tử — case dùng tới thì vẫn gọi L['màn']['phần tử'])\n${brief}`;
}

// Đoạn xử lý từng keyword hành động của helper pack (Launch fresh … Select date) — thay cho việc AI tự đọc file
export function keywordsNote(workspace) {
  const file = path.join(workspace, 'src/runner/keywords.js');
  if (!fs.existsSync(file)) return '';
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const a = lines.findIndex((l) => l.includes("case 'Launch fresh'"));
  const b = lines.findIndex((l, i) => i > a && l.includes("case 'Select date'"));
  if (a < 0 || b < 0) return '';
  return `- App này làm từng keyword như sau (trích src/runner/keywords.js) — gọi đúng helper / page object tương ứng:\n\`\`\`js\n${lines.slice(a, b + 1).join('\n')}\n\`\`\``;
}

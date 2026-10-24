// Câu chữ của bug: đổi bước / điểm kiểm dạng keyword (Tap "X", Enter "Email" = a, Verify disabled "Y")
// thành câu tiếng Việt tự nhiên cho Title, Precondition, Steps to Reproduce, Actual, Expected.
// Định nghĩa từng trường: reference.md → "Bug fields".

const q = (v) => `"${v}"`;
const masked = (v) => /^[*•]+$/.test(String(v ?? ''));

// "Enter "Email" = a" / "Tap "X"" / "Launch fresh" → { keyword, target, value }
export function parseLine(line) {
  const m = String(line).trim().match(/^([A-Za-z][A-Za-z ]*?)(?: "(.+?)")?(?: = (.*))?$/);
  return m ? { keyword: m[1], target: m[2] || '', value: m[3] ?? '' } : { text: String(line).trim() };
}

// 1 thao tác → 1 câu (Steps to Reproduce)
export function actionText(s) {
  if (s.text) return s.text;
  const { keyword, target: t, value: v } = s;
  switch (keyword) {
    case 'Launch fresh': return 'Mở app (bản cài mới)';
    case 'Relaunch app': return 'Tắt hẳn app rồi mở lại';
    case 'Back': return 'Nhấn Back';
    case 'Tap': return `Nhấn ${q(t)}`;
    case 'Enter': return v === '' ? `Xoá hết ô ${t}` : `Nhập ${t}: ${q(v)}`;
    case 'Clear': return `Xoá hết ô ${t}`;
    case 'Set ruler': return `Kéo thước ${t} tới ${v}`;
    case 'Select date': return `Chọn ${t}: ${v}`;
    case 'Hide keyboard': return 'Ẩn bàn phím';
    case 'Swipe': return `Vuốt ${String(t || v).toLowerCase()}`;
    case 'Scroll to': return `Cuộn tới ${q(t)}`;
    default: return [keyword, t && q(t), v && `= ${v}`].filter(Boolean).join(' ');
  }
}

// Điểm kiểm → bước cuối của Steps ("Quan sát …")
export function lookText(b) {
  const t = b.target || b.value;
  if (/Verify (en|dis)abled/.test(b.keyword || '')) return `Quan sát nút ${q(t)}`;
  if (b.keyword === 'Verify value' && t) return `Quan sát ô ${t}`;
  if (t) return `Quan sát ${q(t)} trên màn ${b.screen}`;
  return `Quan sát ${b.label}`;
}

// Ngữ cảnh lúc lệch, để dev biết lỗi xảy ra khi nào → "khi nhấn "Create account" với Password "Abc1234" (7 ký tự)"
//   - thao tác cuối (nếu không phải nhập liệu) + giá trị đang có trong các ô nhập (giá trị nhập cuối của từng ô)
//   - chỉ nêu ô liên quan nếu tên ô có trong điểm kiểm (vd lỗi "Password must…" → chỉ ô Password); không thì nêu hết
//   - ô mật khẩu ghi thêm số ký tự; chưa thao tác gì → "khi vừa vào màn S"
export function whenText(actions, b) {
  const v = new Map();
  for (const a of actions) {
    if (a.keyword === 'Launch fresh' || a.keyword === 'Relaunch app') v.clear();
    else if (a.keyword === 'Enter') v.set(a.target, String(a.value));
    else if (a.keyword === 'Clear') v.set(a.target, '');
  }
  const about = [b.target, b.value, b.label].join(' ').toLowerCase();
  const related = [...v].filter(([k]) => about.includes(String(k).toLowerCase()));
  const fields = (related.length ? related : [...v]).map(([k, x]) => {
    if (x === '') return `${k} để trống`;
    return /password|mật khẩu/i.test(k) ? `${k} ${q(x)} (${x.length} ký tự)` : `${k} ${q(x)}`;
  }).join(', ');
  const last = actions.at(-1);
  const did = last && !['Enter', 'Clear'].includes(last.keyword) ? actionText(last).replace(/^./, (c) => c.toLowerCase()) : '';
  if (did) return `khi ${did}${fields ? ` với ${fields}` : ''}`;
  if (fields) return `khi nhập ${fields}`;
  return b.screen ? `khi vừa vào màn ${b.screen}` : '';
}

// Điểm kiểm bị lệch → { short (vế sau của Title), actual, expected } — 1 câu mỗi trường
// b: { keyword?, target?, value?, label, actual, expected, screen }; when: whenText(...) lúc lệch
export function checkText(b, when = '') {
  const { keyword: k = '', actual: a, expected: e, label } = b;
  const t = b.target || b.value || '';
  const w = when ? ` ${when}` : '';
  // Phần tử cần kiểm không có, chỗ lẽ ra phải hiện đang có chữ khác → nêu ra (vd hiện lỗi khác)
  const instead = b.instead?.length ? `; chỗ đó hiện ${b.instead.map(q).join(', ')}` : '';
  const sentence = (s) => (s.endsWith('.') ? s : `${s}.`);
  if (a == null && /Verify (en|dis)abled|Verify selected|Verify value/.test(k)) {
    return { short: `Không thấy ${q(t)}${w}`, actual: `Màn ${b.screen} không có ${q(t)}${w}.`, expected: sentence(`Màn ${b.screen} có ${q(t)}`) };
  }
  switch (k) {
    case 'Verify disabled':
      return {
        short: `Nút ${q(t)} vẫn enable${w}`,
        actual: `Nút ${q(t)} vẫn enable, nhấn được${w}.`,
        expected: `Nút ${q(t)} bị disable, không nhấn được.`,
      };
    case 'Verify enabled':
      return {
        short: `Nút ${q(t)} bị disable${w}`,
        actual: `Nút ${q(t)} bị disable, không nhấn được${w}.`,
        expected: `Nút ${q(t)} enable, nhấn được.`,
      };
    case 'Verify displayed':
    case 'Verify text':
      return {
        short: `Không hiển thị ${q(t)}${w}`,
        actual: `Màn ${b.screen} không hiển thị ${q(t)}${w}${instead}.`,
        expected: `Màn ${b.screen} hiển thị ${q(t)}.`,
      };
    case 'Verify not displayed':
      return {
        short: `${q(t)} vẫn hiển thị${w}`,
        actual: `${q(t)} vẫn hiển thị trên màn ${b.screen}${w}.`,
        expected: `${q(t)} không còn hiển thị.`,
      };
    case 'Verify selected':
      return {
        short: `${q(t)} không được chọn${w}`,
        actual: `${q(t)} có giá trị ${q(a)}${w}.`,
        expected: `${q(t)} được chọn (${q(e)}).`,
      };
    case 'Verify value':
      if (masked(e) && !masked(a)) {
        return { short: `Ô ${t} hiện rõ mật khẩu thay vì ẩn${w}`, actual: `Ô ${t} hiện rõ ${q(a)}${w}.`, expected: `Ô ${t} ẩn ký tự (hiện dấu chấm).` };
      }
      if (masked(a) && !masked(e)) {
        return { short: `Ô ${t} vẫn ẩn ký tự thay vì hiện rõ${w}`, actual: `Ô ${t} vẫn hiện dấu chấm${w}.`, expected: `Ô ${t} hiện rõ ${q(e)}.` };
      }
      return { short: `${t} hiển thị ${q(a)} thay vì ${q(e)}${w}`, actual: `${t} hiển thị ${q(a)}${w}.`, expected: `${t} hiển thị ${q(e)}.` };
    default: {
      // Spec tự viết (không theo keyword): dựa vào nhãn điểm kiểm
      if (typeof a === 'boolean' || typeof e === 'boolean') {
        const on = (v) => (v ? 'có hiển thị' : 'không hiển thị');
        return { short: `${label} ${on(a)}${w}`, actual: `${label} ${on(a)}${w}.`, expected: `${label} ${on(e)}.` };
      }
      return { short: `${label} hiển thị ${q(a)} thay vì ${q(e)}${w}`, actual: `${label} hiển thị ${q(a)}${w}.`, expected: `${label} hiển thị ${q(e)}.` };
    }
  }
}

// Lỗi chặn luồng (Nav không tới màn / không thấy phần tử để thao tác) → { screen, short, actual, expected }
// last: thao tác cuối đã làm xong trước khi lỗi; failed: bước lỗi (nếu biết)
export function flowText(error, { last, failed, startScreen } = {}) {
  const raw = String(error || 'Test fail').split('\n')[0];
  const nav = raw.match(/Không tới được màn (.+?): không thấy "(.+?)" sau (\d+)s/);
  const after = last ? `Sau khi ${actionText(last).replace(/^./, (c) => c.toLowerCase())}, ` : '';
  if (nav) {
    const [, screen, sign, s] = nav;
    return {
      // Màn đang đứng khi thao tác (không phải màn không tới được)
      screen: failed?.prevScreen || null,
      short: last ? `Không chuyển sang màn ${screen} sau khi ${actionText(last).replace(/^./, (c) => c.toLowerCase())}` : `Không tới được màn ${screen}`,
      actual: `${after}app không chuyển sang màn ${screen} (chờ ${s}s không thấy ${q(sign)}).`,
      expected: `App chuyển sang màn ${screen}.`,
    };
  }
  const wait = raw.match(/name == \\?"([^"\\]+)\\?"[\s\S]*still not (?:existing|displayed) after (\d+)ms/)
    || raw.match(/Không thấy (?:ô nhập )?"(.+?)"(?: sau (\d+)s)?/);
  if (wait) {
    const screen = failed?.screen || startScreen;
    const where = screen ? `màn ${screen}` : 'màn hình';
    return {
      screen,
      short: `Không thấy ${q(wait[1])}`,
      actual: `${after}${where} không có ${q(wait[1])}.`.replace(/^./, (c) => c.toUpperCase()),
      expected: `${where.replace(/^./, (c) => c.toUpperCase())} có ${q(wait[1])}.`,
    };
  }
  return { screen: failed?.screen || startScreen, short: raw.slice(0, 120), actual: `${after}${raw.slice(0, 200)}`.replace(/^./, (c) => c.toUpperCase()), expected: 'Các bước của test case chạy hết, không lỗi.' };
}

// Precondition của test case → { pre: điều kiện thật cần có, steps: dòng thao tác chuyển sang đầu Steps }
//   "Tiếp nối TC_x" → "Đang ở màn <start>" · "Ghi chú bước N: …" bỏ (ghi chú cho tester) · dòng thao tác → Steps
export function splitPrecondition(lines, startScreen) {
  const pre = [];
  const steps = [];
  for (const raw of lines || []) {
    const l = String(raw).replace(/^\d+\.\s*/, '').trim();
    if (!l || /^Ghi chú bước/i.test(l)) continue;
    if (/^Tiếp nối/i.test(l)) { if (startScreen) pre.push(`Đang ở màn ${startScreen}`); continue; }
    if (/^Cài lại app/i.test(l)) { pre.push('Xoá app, cài lại bản mới'); continue; }
    const p = parseLine(l.replace(/\s*\(.*\)$/, ''));
    if (!p.text && /^(Launch fresh|Relaunch app|Back|Tap|Enter|Clear|Set ruler|Select date)$/.test(p.keyword)) steps.push(actionText(p));
    else pre.push(l);
  }
  return { pre: [...new Set(pre)], steps };
}

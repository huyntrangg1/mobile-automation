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

// Bước kỹ thuật của script (chờ, kiểm, gọi luồng, biến, hook) — người dùng không làm → không vào Steps to Reproduce, không làm ngữ cảnh "khi …"
const TECHNICAL = /^(Wait|Wait until .+|Verify .+|Run flow|Run setup|Run check|Save value|Set variable|Generate data|Close browser)$/;
export function userActions(actions) {
  return (actions || []).filter((a) => !TECHNICAL.test(a.keyword || '')
    // Hộp thoại không hiện (runner đã tự đóng trước đó) → không phải thao tác người dùng làm
    && !(a.keyword === 'Handle permission' && /không hiện/.test(String(a.value || ''))));
}

// 1 thao tác → 1 câu (Steps to Reproduce)
export function actionText(s) {
  if (s.text) return s.text;
  const { keyword, target: t, value: v } = s;
  switch (keyword) {
    case 'Launch fresh': return 'Mở app (bản cài mới)';
    case 'Relaunch app': return 'Tắt hẳn app rồi mở lại';
    case 'Background app': return `Đưa app xuống nền${v ? ` ${v} giây` : ''} rồi mở lại`;
    case 'Back': return 'Nhấn Back';
    case 'Tap': return `Nhấn ${q(t)}`;
    case 'Deselect all': return `Bỏ chọn ${String(t || 'tất cả').replace(/^./, (c) => c.toLowerCase())}`;
    case 'Handle permission': return `Hộp thoại ${t || 'xin quyền'}: chọn ${q(v)}`;
    case 'Toggle': return `${/^(on|bật|true)$/i.test(String(v)) ? 'Bật' : 'Tắt'} ${q(t)}`;
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
  if (/^Verify design/.test(b.keyword || '')) return `Quan sát màn ${b.screen}, so với Figma`;
  if (/Verify (en|dis)abled/.test(b.keyword || '')) return `Quan sát nút ${q(t)}`;
  if (b.keyword === 'Verify value' && t) return `Quan sát ô ${t}`;
  if (t) return `Quan sát ${q(t)} trên màn ${b.screen}`;
  return `Quan sát ${b.label}`;
}

// Ngữ cảnh lúc lệch, để dev biết lỗi xảy ra khi nào → "khi nhấn "Create account" với Password "Abc1234" (7 ký tự)"
//   - thao tác cuối (nếu không phải nhập liệu) + giá trị đang có trong các ô nhập (giá trị nhập cuối của từng ô)
//   - chỉ nêu ô liên quan nếu tên ô có trong điểm kiểm (vd lỗi "Password must…" → chỉ ô Password); không thì nêu hết
//   - ô mật khẩu ghi thêm số ký tự; chưa thao tác gì → "khi vừa vào màn S"
//   - chỉ thao tác người dùng (bỏ chờ / kiểm / luồng); "Bỏ chọn tất cả" là dọn trạng thái → không làm ngữ cảnh
export function whenText(all, b) {
  const actions = userActions(all).filter((a) => a.keyword !== 'Deselect all');
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
  // So với Figma: câu đã viết sẵn ở bước so (số đo cụ thể: lệch bao nhiêu pt, mã màu, cỡ chữ)
  if (/^Verify design/.test(k) && b.design) return { short: b.design.short, actual: b.design.actual, expected: b.design.expected };
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
    case 'Verify text':
      // Có hiển thị nhưng sai chữ → "hiển thị sai …, phải là …" (không phải "không hiển thị")
      //   Target chính là chữ mong đợi (tiêu đề, dòng chữ) → nói theo màn: "Màn S hiển thị "a" thay vì "e"" (dễ hiểu hơn "e hiển thị sai a")
      if (typeof a === 'string' && a !== '' && (!b.target || b.target === e)) {
        return {
          short: `Màn ${b.screen} hiển thị ${q(a)} thay vì ${q(e)}${w}`,
          actual: `Màn ${b.screen} hiển thị ${q(a)} thay vì ${q(e)}${w}.`,
          expected: `Màn ${b.screen} hiển thị ${q(e)} (theo test case).`,
        };
      }
      if (typeof a === 'string' && a !== '') {
        return { short: `${t} hiển thị sai ${q(a)}, phải là ${q(e)}`, actual: `${t} hiển thị ${q(a)}${w}.`, expected: `${t} phải là ${q(e)} (theo test case).` };
      }
    // falls through
    case 'Verify displayed':
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
      // Mong đợi KHÔNG chọn (Verify not selected) mà app vẫn chọn → "vẫn được chọn"
      if (e === false) {
        return {
          short: `${q(t)} vẫn được chọn${w}`,
          actual: `${q(t)} vẫn ở trạng thái được chọn${w}.`,
          expected: `${q(t)} không được chọn.`,
        };
      }
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

// "Không tới được màn X: không thấy [nút|tiêu đề|card|…] "Y" sau Ns" → [, X, loại phần tử (có thể trống), Y]
export const NAV_ERROR = /Không tới được màn (.+?): không thấy (?:([^"]{1,20}?) )?"(.+?)"/;
// "Không tới được màn X: [chữ|nút|…] "Y" vẫn còn sau Ns" → [, X, loại phần tử, Y]
export const STUCK_ERROR = /Không tới được màn (.+?): (?:([^"]{1,20}?) )?"(.+?)" vẫn còn/;

// Lỗi chặn luồng (Nav không tới màn / không thấy phần tử để thao tác) → { screen, short, actual, expected }
// last: thao tác cuối đã làm xong trước khi lỗi; failed: bước lỗi (nếu biết)
// Màn đang hiện lúc điểm kiểm lệch (phần tử cần có mà không có) → Actual: "Màn đang hiện "T" bottom sheet (nút "A", "B")."
export const seenText = (seen) => (seen?.title ? `Màn đang hiện ${q(seen.title)}${seen.kind ? ` ${seen.kind}` : ''}${seen.buttons?.length ? ` (nút ${seen.buttons.map(q).join(', ')})` : ''}.` : '');

// seen: màn app đang hiện lúc lỗi { title, text, buttons } (hook đọc page source) → Actual ghi đúng cái người dùng thấy
export function flowText(error, { last, failed, startScreen, seen } = {}) {
  const raw = String(error || 'Test fail').split('\n')[0];
  const nav = raw.match(NAV_ERROR);
  const did = last ? actionText(last) : '';
  const after = did ? `Sau khi ${did.replace(/^./, (c) => c.toLowerCase())}, ` : '';
  // Alert hệ thống (k.alert): có hộp thoại nhưng thiếu nút cần bấm → nêu các nút đang hiện
  const noBtn = raw.match(/^Hộp thoại hệ thống không có nút "(.+?)" — đang hiện: (.+)$/);
  if (noBtn) {
    return {
      screen: failed?.prevScreen || failed?.screen || startScreen || null,
      short: `Hộp thoại hệ thống không có nút ${q(noBtn[1])}`,
      actual: `${after}hộp thoại hệ thống hiện nút ${noBtn[2]}.`.replace(/^./, (c) => c.toUpperCase()),
      expected: `Hộp thoại hệ thống có nút ${q(noBtn[1])} (theo test case).`,
    };
  }
  if (nav && nav[2] === 'hộp thoại hệ thống') {
    return {
      screen: failed?.prevScreen || null,
      short: `${did ? `${did} ` : ''}không hiện hộp thoại hệ thống`.replace(/^./, (c) => c.toUpperCase()),
      actual: `${after}không có hộp thoại hệ thống nào hiện ra.`.replace(/^./, (c) => c.toUpperCase()),
      expected: `Hiện hộp thoại hệ thống có nút ${q(nav[3])} (theo test case).`,
    };
  }
  // Nhấn Back mà không lùi về màn trước → "không lùi về màn …"
  const isBack = last && (last.keyword === 'Back' || /^(back|quay lại|<)$/i.test(String(last.target || '')));
  if (nav && isBack) {
    const screen = nav[1];
    return {
      screen: failed?.prevScreen || null,
      short: `${did} không lùi về màn ${screen}`,
      actual: seen?.title ? `${after}app vẫn ở màn ${q(seen.title)}, không lùi về màn ${screen}.` : `${after}app không lùi về màn ${screen}.`,
      expected: `App lùi về màn ${screen} (theo test case).`,
    };
  }
  if (nav) {
    const [, screen, kind, name] = nav;
    const sign = `${kind ? `${kind} ` : ''}${q(name)}`;
    // Màn đang đứng khi thao tác (không phải màn không tới được)
    const at = failed?.prevScreen || null;
    const expected = `App chuyển sang màn ${screen}, có ${sign} (theo test case).`;
    if (seen?.title) {
      const btns = seen.buttons?.length ? `; màn chỉ có nút ${seen.buttons.map(q).join(', ')}` : '';
      return {
        screen: at,
        short: `${did ? `${did} ` : ''}hiển thị màn ${q(seen.title)} thay vì màn ${screen}`.replace(/^./, (c) => c.toUpperCase()),
        actual: `${after}app hiển thị màn ${q(seen.title)}${seen.text ? ` (${q(seen.text)})` : ''}${btns}. Không có ${sign}.`,
        expected,
      };
    }
    return {
      screen: at,
      short: `${did ? `${did} ` : ''}không chuyển sang màn ${screen}`.replace(/^./, (c) => c.toUpperCase()),
      actual: `${after}app không chuyển sang màn ${screen}, không thấy ${sign}.`,
      expected,
    };
  }
  // "Không tới được màn S: chữ "X" vẫn còn sau Ns" (bước cũ không biến mất — màn không sang bước kế)
  const stuck = raw.match(STUCK_ERROR);
  if (stuck) {
    const [, screen, kind, name] = stuck;
    const sign = `${kind ? `${kind} ` : ''}${q(name)}`;
    return {
      screen: failed?.prevScreen || screen,
      short: `${did ? `${did}, ` : ''}màn ${screen} không sang bước tiếp theo`.replace(/^./, (c) => c.toUpperCase()),
      actual: `${after}màn ${screen} vẫn hiện ${sign}, không sang bước tiếp theo.`.replace(/^./, (c) => c.toUpperCase()),
      expected: `Màn ${screen} sang bước tiếp theo (theo test case).`,
    };
  }
  const wait = raw.match(/name == \\?"([^"\\]+)\\?"[\s\S]*still not (?:existing|displayed) after (\d+)ms/)
    || raw.match(/Không thấy (?:ô nhập )?"(.+?)"(?: sau (\d+)s)?/);
  if (wait) {
    // "Không thấy "X" trên màn S" (bước chung k) → màn S; không thì màn của bước lỗi / thao tác cuối
    const screen = (raw.match(/ trên màn (.+)$/) || [])[1] || failed?.screen || failed?.prevScreen || startScreen;
    const where = screen ? `màn ${screen}` : 'màn hình';
    // Biết màn app đang hiện (page source lúc lỗi) → nêu ra, vd tutorial kết thúc sớm và app đã ở "Recipe imported successfully!".
    // Không tự kết luận "đã sang màn khác": tên màn trong test case có thể khác tiêu đề trên app
    if (seen?.title) {
      const btns = seen.buttons?.length ? `; màn chỉ có nút ${seen.buttons.map(q).join(', ')}` : '';
      return {
        screen,
        short: `Không thấy ${q(wait[1])}, app đang hiện màn ${q(seen.title)}`,
        actual: `${after}app hiển thị màn ${q(seen.title)}${seen.text ? ` (${q(seen.text)})` : ''}${btns}. Không có ${q(wait[1])}.`.replace(/^./, (c) => c.toUpperCase()),
        expected: `${where.replace(/^./, (c) => c.toUpperCase())} có ${q(wait[1])} (theo test case).`,
      };
    }
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
//   "Tiếp nối TC_x" → "Đang ở màn <start>" · "Ghi chú …" bỏ (ghi chú cho tester) · dòng thao tác → Steps
export function splitPrecondition(lines, startScreen) {
  const pre = [];
  const steps = [];
  for (const raw of lines || []) {
    const l = String(raw).replace(/^\d+\.\s*/, '').trim();
    if (!l || /^Ghi chú/i.test(l)) continue;
    if (/^Tiếp nối/i.test(l)) { if (startScreen) pre.push(`Đang ở màn ${startScreen}`); continue; }
    if (/^Cài lại app/i.test(l)) { pre.push('Xoá app, cài lại bản mới'); continue; }
    const p = parseLine(l.replace(/\s*\(.*\)$/, ''));
    if (!p.text && /^(Launch fresh|Relaunch app|Back|Tap|Enter|Clear|Set ruler|Select date)$/.test(p.keyword)) steps.push(actionText(p));
    else pre.push(l);
  }
  return { pre: [...new Set(pre)], steps };
}

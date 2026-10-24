// Phân loại bug theo rule trong reference.md → "Priority / Severity".
//   Severity: mức ảnh hưởng tới chức năng, dữ liệu, khả năng đi hết luồng — chỉ dựa trên bằng chứng của điểm kiểm.
//   Priority: mức khẩn cần xử lý — từ Severity + tầm quan trọng của test case + phạm vi ảnh hưởng. Không suy thẳng từ Severity.
//   Mỗi bug có lý do ngắn; điều không xác minh được từ lần chạy (workaround, phạm vi) ghi vào unverified thay vì đoán.

export const SEVERITY = ['Trivial', 'Minor', 'Major', 'Critical'];
export const PRIORITY = ['Low', 'Normal', 'High', 'Very High'];

// Chữ của dòng báo lỗi kiểm tra dữ liệu (vd "Invalid email format", "Password must be at least 8 characters")
const ERROR_TEXT = /invalid|must|required|does not match|incorrect|already (?:exists|registered|taken|in use)|not found|error|không hợp lệ|bắt buộc|không đúng|đã tồn tại/i;
const NO_WORKAROUND = 'Chưa xác minh có cách khác để đi tiếp (workaround)';
const nums = (v) => (String(v ?? '').match(/\d+/g) || []).map(Number).sort((a, b) => a - b).join(',');
const letters = (v) => String(v ?? '').toLowerCase().replace(/[^\p{L}]+/gu, '');
const masked = (v) => /^[*•]+$/.test(String(v ?? ''));

// b: { step, keyword?, target?, value?, label, actual, expected, tcPriority, actionable, blocked }
//   actionable: có test case trong lần chạy thao tác trên phần tử đang kiểm (vd Tap vào link đó) → phần tử dùng để điều hướng
//   blocked: bug chặn luồng (test dừng giữa chừng)
// → { type: Function | UI, kind, severity, reason, unverified: [] }
export function classify(b) {
  const fn = (kind, severity, reason, unverified = []) => ({ type: 'Function', kind, severity, reason, unverified });
  const ui = (kind, severity, reason, unverified = []) => ({ type: 'UI', kind, severity, reason, unverified });
  // TC High = luồng chính → lỗi chặn trên luồng đó là Critical
  const main = b.tcPriority === 'High';

  if (b.step == null) {
    if (!b.blocked) return fn('result', 'Major', 'Kết quả khác mong đợi, test không đi hết các bước');
    return main
      ? fn('flow', 'Critical', 'Chặn hoàn toàn luồng chính (TC High): không đi hết được test case', [NO_WORKAROUND])
      : fn('flow', 'Major', 'Luồng bị gián đoạn: không đi hết được test case', [NO_WORKAROUND]);
  }

  const { keyword: k = '', actual: a, expected: e, label } = b;
  const t = String(b.target || b.value || label);
  // Phần tử cần có nhưng không có trên màn
  const absent = (/^Verify (displayed|text)$/.test(k) && a === false) || (a == null && /^Verify /.test(k) && k !== 'Verify not displayed');
  if (absent) {
    if (ERROR_TEXT.test(t)) return fn('validation', 'Major', `Không báo lỗi "${t}": kiểm tra dữ liệu không hoạt động đúng`);
    if (b.actionable) {
      return fn('navigation', main ? 'Critical' : 'Major', `Thiếu "${t}" mà người dùng cần thao tác: không vào được chức năng tương ứng`,
        ['Chưa xác minh có đường khác để tới chức năng này']);
    }
    return ui('visibility', 'Minor', `Thiếu "${t}" trên màn, chức năng chính vẫn dùng được`,
      ['Chưa xác minh phần tử này có dùng cho thao tác quan trọng nào không']);
  }

  switch (k) {
    case 'Verify disabled':
      return fn('state-allow', 'Major', 'Nút vẫn cho gửi khi dữ liệu không hợp lệ: kiểm tra dữ liệu không hoạt động đúng');
    case 'Verify enabled':
      return fn('state-block', main ? 'Critical' : 'Major', 'Nút bị khoá khi dữ liệu hợp lệ: người dùng không đi tiếp được', [NO_WORKAROUND]);
    case 'Verify not displayed':
      return ui('visibility', 'Minor', `"${t}" vẫn hiển thị khi đáng lẽ phải ẩn`,
        ['Chưa xác minh phần tử còn hiện có gây thao tác nhầm không']);
    case 'Verify selected':
      return fn('selection', 'Major', 'Trạng thái lựa chọn sai: ảnh hưởng tới dữ liệu người dùng chọn');
    case 'Verify value':
      if (masked(e) && !masked(a)) return fn('security', 'Major', 'Mật khẩu hiện rõ thay vì bị che: lộ thông tin nhạy cảm');
      if (masked(a) && !masked(e)) return fn('content', 'Minor', 'Không hiện được mật khẩu khi người dùng chọn hiện');
      break;
    default:
  }

  // Không có loại kiểm tra (spec tự viết) hoặc so giá trị: dựa vào giá trị / nhãn
  if (typeof a === 'boolean' || typeof e === 'boolean') {
    if (/enable|disable/i.test(label)) {
      return e === true
        ? fn('state-block', main ? 'Critical' : 'Major', 'Nút bị khoá: người dùng không đi tiếp được', [NO_WORKAROUND])
        : fn('state-allow', 'Major', 'Nút vẫn cho thao tác khi không được phép');
    }
    if (/màn|sheet/i.test(label)) return fn('screen', 'Major', 'Luồng thiếu / thừa màn so với test case');
    if (/chọn|bật/i.test(label)) return fn('selection', 'Major', 'Trạng thái lựa chọn sai');
    return ui('visibility', 'Minor', 'Phần tử hiển thị / ẩn không đúng',
      ['Chưa xác minh lỗi hiển thị này có chặn thao tác nào không']);
  }
  if (a == null || a === '') return ui('empty', 'Minor', 'Không hiển thị nội dung cần có');
  if ((typeof a === 'number' && typeof e === 'number') || (nums(a) && nums(e) && nums(a) !== nums(e))) {
    return fn('value', 'Major', 'Sai số liệu so với dữ liệu / công thức');
  }
  if (nums(a) && nums(e)) return ui('format', 'Minor', 'Cùng giá trị, sai định dạng hiển thị');
  const [la, le] = [letters(a), letters(e)];
  if (la && le && (la.includes(le) || le.includes(la))) return ui('text', 'Trivial', 'Sai chữ / đơn vị, không ảnh hưởng chức năng');
  return fn('content', 'Major', 'Nội dung sai so với dữ liệu / logic');
}

// Mức Priority xuất phát theo Severity × Priority của test case (High / Medium / Low)
const BASE = {
  Critical: { High: 'Very High', Medium: 'High', Low: 'High' },
  Major: { High: 'High', Medium: 'High', Low: 'Normal' },
  Minor: { High: 'Normal', Medium: 'Normal', Low: 'Low' },
  Trivial: { High: 'Low', Medium: 'Low', Low: 'Low' },
};

// b: { severity, tcPriority (cao nhất trong các TC gặp lỗi), testCount, screenCount (số màn có lỗi), blocksAfter (số TC sau bị chặn theo) }
// → { priority, prioReason, unverified: [] }
//   Lỗi trên ≥ 2 màn hoặc chặn các TC phía sau → tăng 1 mức (trừ Trivial).
//   Cùng 1 lỗi gặp ở nhiều TC chỉ khác bộ data không tính là phạm vi rộng (vẫn ghi số TC vào lý do).
export function prioritize(b) {
  const known = ['High', 'Medium', 'Low'].includes(b.tcPriority);
  const tp = known ? b.tcPriority : 'Medium';
  let i = PRIORITY.indexOf(BASE[b.severity][tp]);
  const why = [`Severity ${b.severity}`, `TC ${tp}${known ? '' : ' (tạm tính)'}`];
  if (b.testCount > 1) why.push(`gặp ở ${b.testCount} TC`);
  const spread = [];
  if (b.screenCount > 1) spread.push(`lỗi trên ${b.screenCount} màn`);
  if (b.blocksAfter > 0) spread.push(`chặn thêm ${b.blocksAfter} TC phía sau`);
  if (spread.length && b.severity !== 'Trivial' && i < PRIORITY.length - 1) {
    i++;
    why.push(`${spread.join(', ')} → tăng 1 mức`);
  } else why.push(...spread);
  return {
    priority: PRIORITY[i],
    prioReason: why.join(' · '),
    unverified: known ? [] : ['Chưa có Priority của test case, tạm tính Medium'],
  };
}

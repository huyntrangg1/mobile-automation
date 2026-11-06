// Ô "Link PRD" phải là đường link tài liệu begamob (/workspace/…): đó là loại duy nhất công cụ MCP đọc được.
// Kiểm ngay từ đầu để chữ ghi chú dán nhầm không bị đem đi hỏi AI (tốn một lần gọi rồi báo "không đọc được PRD").
// Rỗng là hợp lệ vì PRD là tuỳ chọn.
export function checkPrdUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { ok: true, url: '' };
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: 'Link PRD không hợp lệ: ô này cần một đường link (https://…), không phải chữ ghi chú. Để trống nếu không dùng PRD.' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'Link PRD không hợp lệ: cần bắt đầu bằng https://' };
  if (!u.pathname.includes('/workspace/')) return { ok: false, error: 'Link PRD không hợp lệ: tool chỉ đọc được tài liệu begamob dạng https://developers.begamob.com/workspace/<dự-án>/…' };
  return { ok: true, url: s };
}

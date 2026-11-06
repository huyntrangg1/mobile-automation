// Chế độ sửa tay khi lỗi: nhớ lựa chọn lần trước của tester (trình duyệt này); không đọc được storage → tắt
export const loadManualFix = () => { try { return localStorage.getItem('qapd.manualFix') === '1'; } catch { return false; } };
export const saveManualFix = (on) => { try { localStorage.setItem('qapd.manualFix', on ? '1' : '0'); } catch {} };

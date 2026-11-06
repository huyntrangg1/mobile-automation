// Chặn rời trang khi đang có thay đổi chưa lưu (vd đang sửa script). BrowserRouter không có useBlocker
// → link nội bộ được chặn bằng listener click, các chỗ tự nav() (chọn app ở sidebar…) gọi confirmLeave().
let message = null;

export function setLeaveGuard(msg) { message = msg || null; }

export function confirmLeave() {
  if (!message || window.confirm(message)) { message = null; return true; }
  return false;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => { if (message) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!message || !a || a.target === '_blank' || a.origin !== location.origin) return;
    if (!confirmLeave()) { e.preventDefault(); e.stopPropagation(); }
  }, true);
}

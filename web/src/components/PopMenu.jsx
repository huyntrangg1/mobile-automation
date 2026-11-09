import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';

// Nút "⋯" mở menu thao tác phụ. Menu vẽ bằng position:fixed vì bảng hoặc khung cuộn sẽ cắt menu nằm trong nó.
// Menu vẽ qua portal ra <body>: popup / khung có transform làm position:fixed tính theo khung đó (menu lệch, bị cắt).
// children là hàm nhận `close` để mục menu tự đóng menu sau khi bấm.
export function PopMenu({ label, disabled = false, small = true, text, icon, children }) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!pos) return undefined;
    const close = () => setPos(null);
    const esc = (e) => e.key === 'Escape' && close();
    window.addEventListener('click', close); window.addEventListener('resize', close); window.addEventListener('scroll', close, true); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('click', close); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); window.removeEventListener('keydown', esc); };
  }, [pos]);
  const open = (e) => {
    e.stopPropagation();
    if (pos) { setPos(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
  };
  return (
    <>
      {text
        ? <button className={`btn${small ? ' btn-sm' : ''}`} type="button" aria-haspopup="menu" aria-expanded={!!pos} aria-label={label} disabled={disabled} onClick={open}>{icon && <Icon name={icon} />}{text}<Icon name="chev" size={14} /></button>
        : <button className={`btn${small ? ' btn-sm' : ''} btn-ghost btn-icon`} type="button" aria-haspopup="menu" aria-expanded={!!pos} aria-label={label} disabled={disabled} onClick={open}><Icon name="more" /></button>}
      {pos && createPortal(<div className="menu-pop" role="menu" style={{ top: pos.top, right: pos.right }}>{children(() => setPos(null))}</div>, document.body)}
    </>
  );
}

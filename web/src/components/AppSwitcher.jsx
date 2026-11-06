import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon.jsx';
import { initials } from './ui.jsx';

// Chọn app đang làm: nút hiện app hiện tại (tên viết tắt, tên, nền tảng · version), mở ra danh sách có ô tìm.
// Popover vẽ bằng position:fixed vì sidebar có thể cuộn / cắt nội dung.
export function AppSwitcher({ apps, app, onPick }) {
  const [pos, setPos] = useState(null);
  const [q, setQ] = useState('');
  const btn = useRef(null);
  const close = () => { setPos(null); setQ(''); };
  useEffect(() => {
    if (!pos) return undefined;
    const out = (e) => { if (!e.target.closest('.asw-pop') && !btn.current?.contains(e.target)) close(); };
    const esc = (e) => { if (e.key === 'Escape') { close(); btn.current?.focus(); } };
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc); window.addEventListener('resize', close);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); window.removeEventListener('resize', close); };
  }, [pos]);
  const open = () => {
    if (pos) { close(); return; }
    const r = btn.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 248) });
  };
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return apps.filter((a) => !t || `${a.name} ${a.bundleId}`.toLowerCase().includes(t));
  }, [apps, q]);
  const meta = (a) => `${a.platform || 'iOS'} · v${a.version}`;
  return (
    <div className="asw-wrap">
      <button ref={btn} type="button" className="asw" aria-haspopup="listbox" aria-expanded={!!pos} aria-label={`App đang làm: ${app.name}. Bấm để đổi app`} onClick={open}>
        <span className="ap-av" aria-hidden="true">{initials(app.name)}</span>
        <span className="asw-t"><b title={app.name}>{app.name}</b><span className="cap trunc">{meta(app)}</span></span>
        <Icon name="chev" size={14} className="asw-chev" />
      </button>
      {pos && (
        <div className="asw-pop" style={{ top: pos.top, left: pos.left, width: pos.width }}>
          {apps.length > 6 && (
            <div className="asw-search"><Icon name="search" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm app…" aria-label="Tìm app" /></div>
          )}
          <ul role="listbox" aria-label="Chọn app" className="asw-list">
            {list.map((a) => (
              <li key={a.id} role="option" aria-selected={a.id === app.id}>
                <button type="button" className={a.id === app.id ? 'asw-opt on' : 'asw-opt'} onClick={() => { close(); if (a.id !== app.id) onPick(a); }}>
                  <span className="ap-av" aria-hidden="true">{initials(a.name)}</span>
                  <span className="asw-t"><b title={a.name}>{a.name}</b><span className="cap trunc">{meta(a)}</span></span>
                  {a.id === app.id && <Icon name="check" className="asw-tick" />}
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="cap asw-none">Không có app khớp.</li>}
          </ul>
          <Link className="asw-all" to="/apps" onClick={close}>Tất cả app<Icon name="arrow" size={12} /></Link>
        </div>
      )}
    </div>
  );
}

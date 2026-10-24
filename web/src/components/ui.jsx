import { Icon } from './Icon.jsx';

// Trạng thái kết quả chạy: glyph + màu theo ikqa (không chỉ dựa vào màu)
export const EXEC = {
  passed: ['badge b-pass', '✓', 'Passed'],
  failed: ['badge b-fail', '✕', 'Failed'],
  blocked: ['badge b-blocked', '⊘', 'Blocked'],
  skipped: ['badge b-skip', '–', 'Skipped'],
  notrun: ['badge b-notrun', '○', 'Not Run'],
  running: ['badge b-running', '●', 'Running'],
  queued: ['badge b-queued', '…', 'Queued'],
};

export function ExecBadge({ status }) {
  const [cls, g, l] = EXEC[status] || EXEC.notrun;
  return <span className={cls}><span aria-hidden="true">{g}</span>{l}</span>;
}

export function PageHeader({ title, sub, children }) {
  return (
    <div className="ph">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      <div className="sp" />
      {children}
    </div>
  );
}

export function Empty({ icon = 'file', title, children }) {
  return (
    <div className="empty">
      <span className="empty-ic"><Icon name={icon} size={20} /></span>
      <b style={{ color: 'var(--ink)' }}>{title}</b>
      {children}
    </div>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="alert alert-err" role="alert"><Icon name="warn" /><div>{String(error.message || error)}</div></div>;
}

export function Drawer({ title, sub, onClose, children, footer }) {
  return (
    <div className="overlay">
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dh">
          <div><h2>{title}</h2>{sub && <span className="cap">{sub}</span>}</div>
          <button className="btn btn-ghost btn-icon" type="button" aria-label="Đóng" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="db">{children}</div>
        {footer && <div className="df">{footer}</div>}
      </aside>
    </div>
  );
}

export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '—');
export const fmtDur = (ms) => {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

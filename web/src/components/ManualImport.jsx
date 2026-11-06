// Import test case manual: hai danh sách "sẽ automate" / "để manual (lý do)", chuyển case qua lại, chuyển đổi nền, danh sách review.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useEvents } from '../useEvents.js';
import { Icon } from './Icon.jsx';
import { ErrorNote } from './ui.jsx';
import { splitByMode, moveCase, summary, keyOf } from '../manualSelection.js';

const BY = { rule: 'Luật', ai: 'AI', user: 'Bạn chọn' };
const STATUS = { analyzing: 'Đang phân tích…', ready: 'Sẵn sàng', converting: 'Đang chuyển đổi…', done: 'Xong', error: 'Lỗi' };
// Server trả bản đã bỏ nội dung manual gốc / dòng Keyword; sự kiện SSE gửi bản đầy đủ → bỏ khi nhận
const strip = (mi) => ({ ...mi, cases: mi.cases.map(({ src, plan, ...c }) => c) });

const STATE = { done: ['pass', 'Đã chuyển'], pending: ['none', 'Chờ chuyển'], error: ['fail', 'Lỗi'], conflict: ['blk', 'Xung đột'] };

function Row({ c, onMove, onResolve, busy }) {
  const to = c.mode === 'automate' ? 'manual' : 'automate';
  const st = c.mode === 'automate' ? STATE[c.state] : null;
  return (
    <li className="mi-row">
      <span className="mono cap mi-id">{c.id}</span>
      <div className="mi-main">
        <span className="trunc-2" title={c.title}>{c.title}</span>
        <span className="cap mi-meta">
          {c.mode === 'manual' && c.reason ? <>{c.reason} · </> : null}{BY[c.by] || c.by}
          {c.ambiguity?.length > 0 && <span className="warn-txt" title={c.ambiguity.map((a) => a.text).join('\n')}><Icon name="warn" size={12} />{c.ambiguity.length} điểm mờ</span>}
        </span>
        {c.state === 'error' && c.error && <details className="mi-err"><summary className="err-line">{String(c.error).split(/[;\n]/)[0].slice(0, 140)}</summary><pre className="err-pre">{String(c.error).split('; ').join('\n')}</pre></details>}
        {c.state === 'conflict' && (
          <span className="cap">Dòng Keyword đã sửa tay, manual cũng đổi:{' '}
            <button type="button" className="linkbtn" disabled={busy} onClick={() => onResolve(c, 'keep')}>Giữ bản sửa tay</button>{' · '}
            <button type="button" className="linkbtn" disabled={busy} onClick={() => onResolve(c, 'reconvert')}>Chuyển lại</button>
          </span>
        )}
      </div>
      {st && <span className={`dotl ${st[0]}`}>{st[1]}</span>}
      <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => onMove(c, to)} title={to === 'manual' ? 'Chuyển sang manual (không automate case này)' : 'Chuyển sang automate'}>
        {to === 'manual' ? 'Để manual' : 'Automate'}
      </button>
    </li>
  );
}

export function ManualImport({ importId, initial, onClose }) {
  const [mi, setMi] = useState(initial ? strip(initial) : null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('automate');
  const [qq, setQq] = useState('');
  const [autoGen, setAutoGen] = useState(true); // gen script ngay sau khi chuyển đổi (tắt nếu muốn chọn case cần gen)
  useEffect(() => { if (!mi) api.get(`/manual/${importId}`).then(setMi).catch(setErr); }, [importId]);
  useEvents('manualImport', (e) => { if (e.id === importId) setMi(strip(e)); });

  const act = async (fn) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr(e); api.get(`/manual/${importId}`).then(setMi).catch(() => {}); }
    setBusy(false);
  };
  const move = (c, mode) => act(async () => {
    setMi((m) => ({ ...m, cases: moveCase(m.cases, c, mode) }));
    setMi(await api.put(`/manual/${importId}/choices`, { sheet: c.sheet, tcId: c.id, mode }));
  });
  const resolve = (c, action) => act(async () => setMi(await api.post(`/manual/${importId}/conflicts`, { sheet: c.sheet, tcId: c.id, action })));
  const convert = () => act(async () => { await api.post(`/manual/${importId}/convert`, { gen: autoGen }); });

  if (!mi) return <div className="overlay"><div className="scrim" /><section className="help-modal"><div className="skel" style={{ height: 160, margin: 20 }} /><ErrorNote error={err} /></section></div>;
  const { automate, manual } = splitByMode(mi.cases);
  const sum = summary(mi);
  const working = ['analyzing', 'converting'].includes(mi.status);
  const todo = mi.cases.filter((c) => c.state === 'pending' || c.state === 'error').length;
  const p = mi.progress;
  const pct = p ? Math.round((p.done / Math.max(1, p.total)) * 100) : 0;
  const list = (tab === 'automate' ? automate : manual).filter((c) => !qq || `${c.id} ${c.title}`.toLowerCase().includes(qq.toLowerCase()));
  return (
    <div className="overlay">
      <div className="scrim" />
      <section className="help-modal mi-modal" role="dialog" aria-modal="true" aria-label={`Import manual ${mi.fileName}`}>
        <div className="mi-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 className="mono">{mi.fileName}</h2>
            <span className="cap">{STATUS[mi.status] || mi.status}{sum.ambiguous > 0 && ` · ${sum.ambiguous} case có điểm mờ`}{sum.conflicts > 0 && ` · ${sum.conflicts} xung đột`}</span>
          </div>
          <button className="btn btn-ghost btn-icon" type="button" aria-label="Đóng" onClick={onClose}><Icon name="close" /></button>
        </div>
        {mi.status === 'converting' && (
          <div className="mi-prog">
            <div className="row" style={{ justifyContent: 'space-between' }}><b>Đang chuyển đổi và gen script</b><span className="num"><b>{p?.done ?? 0}</b> / {p?.total ?? '…'} nhóm · {pct}%</span></div>
            <div className="conv conv-lg" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
            <span className="cap trunc-2">{p?.label || 'Đang khởi động…'}</span>
          </div>
        )}
        <ErrorNote error={err || (mi.status === 'error' ? new Error(mi.error) : null)} />
        <div className="mi-tools">
          <div className="seg2" role="tablist" aria-label="Danh sách case">
            <button type="button" role="tab" aria-selected={tab === 'automate'} className={tab === 'automate' ? 'on' : ''} onClick={() => setTab('automate')}>Sẽ automate <span className="num">{automate.length}</span></button>
            <button type="button" role="tab" aria-selected={tab === 'manual'} className={tab === 'manual' ? 'on' : ''} onClick={() => setTab('manual')}>Để manual <span className="num">{manual.length}</span></button>
          </div>
          <span style={{ flex: 1 }} />
          <input className="inp search-inp" type="search" placeholder="Tìm theo ID, tiêu đề" value={qq} onChange={(e) => setQq(e.target.value)} aria-label="Tìm case" />
        </div>
        <div className="mi-scroll">
          <ul className="mi-list">{list.map((c) => <Row key={keyOf(c)} c={c} onMove={move} onResolve={resolve} busy={busy || working} />)}</ul>
          {list.length === 0 && <div className="empty"><b style={{ color: 'var(--ink)' }}>Không có case</b></div>}
          {tab === 'manual' && mi.removed?.length > 0 && (
            <div className="alert alert-warn" style={{ margin: 12 }}><Icon name="warn" /><div>
              <b>{mi.removed.length} case không còn trong file manual</b> (vẫn còn trong bảng Test Cases cho tới khi sheet chứa chúng được chuyển đổi lại — lúc đó chúng bị xoá cùng script; hoặc xoá ở bảng nếu không cần): {mi.removed.join(', ')}
            </div></div>
          )}
        </div>
        {(mi.problems?.length > 0 || mi.review?.length > 0) && (
          <div className="mi-notes">
            {mi.problems.length > 0 && <div className="alert alert-warn"><Icon name="warn" /><div><b>Cần xử lý</b><ul>{mi.problems.map((l, i) => <li key={i}>{l}</li>)}</ul></div></div>}
            {mi.review.length > 0 && <details open={mi.status === 'done'}><summary><b>Cần review ({mi.review.length})</b></summary><ul className="mi-review">{mi.review.map((l, i) => <li key={i}>{l}</li>)}</ul></details>}
          </div>
        )}
        <div className="hm-foot">
          <span className="cap" style={{ flex: 1 }}>{todo ? `${todo} case chờ chuyển đổi (gồm case lỗi lần trước).` : 'Không có case nào chờ chuyển đổi.'}</span>
          <label className="cap" style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="Bỏ tick nếu muốn chọn case cần gen ở bảng Test Cases (gen cả sheet mất khá lâu)"><input type="checkbox" className="cb" checked={autoGen} onChange={(e) => setAutoGen(e.target.checked)} disabled={working} />Tự gen script sau khi chuyển đổi</label>
          <button type="button" className="btn" onClick={onClose}>Đóng</button>
          <button type="button" className="btn btn-primary" disabled={busy || working || (!todo && sum.conflicts === 0)} onClick={convert}><Icon name="spark" />Chuyển đổi & gen script</button>
        </div>
      </section>
    </div>
  );
}

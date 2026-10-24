import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon.jsx';
import { api } from '../api.js';
import { useEvents } from '../useEvents.js';
import { Empty, ErrorNote, ExecBadge, PageHeader, fmtDur, fmtTime } from '../components/ui.jsx';

const STATE = { running: 'Đang chạy', done: 'Xong', stopped: 'Đã dừng', error: 'Lỗi', interrupted: 'Bị ngắt' };

export function Runs({ lock }) {
  const nav = useNavigate();
  const [runs, setRuns] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api.get('/runs').then(setRuns).catch(setErr);
  useEffect(() => { load(); }, []);
  useEvents('run', (x) => setRuns((l) => (l?.some((y) => y.id === x.id) ? l.map((y) => (y.id === x.id ? { ...y, ...x } : y)) : (load(), l))));
  const [pick, setPick] = useState({});
  const [msg, setMsg] = useState(null);
  const done = (runs || []).filter((r) => r.status !== 'running');
  const picked = done.filter((r) => pick[r.id]).map((r) => r.id);
  const del = async (body, what) => {
    if (!window.confirm(`Xoá ${what}? Kết quả, log, ảnh và report của run sẽ bị xoá hẳn. Run đang chạy không bị xoá.`)) return;
    setErr(null);
    try {
      const r = await api.post('/runs/delete', body);
      setPick({});
      setMsg(r.deleted.length ? `Đã xoá ${r.deleted.length} run${r.skipped.length ? ` · bỏ qua ${r.skipped.length} run đang chạy` : ''}.` : 'Không có run nào để xoá.');
      load();
    } catch (e) { setErr(e); }
  };
  return (
    <main className="content" style={{ maxWidth: 1180 }}>
      <PageHeader title="Test Runs" sub="Mỗi run giữ report riêng; mở run để xem kết quả, log và report." />
      <ErrorNote error={err} />
      {msg && <div className="alert alert-info" role="status"><Icon name="check" /><div>{msg}</div></div>}
      {runs?.length > 0 && (
        <div className="pick-bar">
          <span className="cap">{picked.length ? `${picked.length} run đã chọn` : 'Tick run để xoá'}</span>
          {picked.length > 0 && <button className="btn btn-sm btn-ghost" type="button" onClick={() => setPick({})}>Bỏ chọn</button>}
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm btn-ghost btn-danger" type="button" onClick={() => del({ olderThanDays: 7 }, 'các run cũ hơn 7 ngày')}>Xoá run cũ hơn 7 ngày</button>
          <button className="btn btn-sm btn-danger" type="button" disabled={!picked.length} onClick={() => del({ ids: picked }, `${picked.length} run đã chọn`)}>Xoá đã chọn{picked.length ? ` (${picked.length})` : ''}</button>
        </div>
      )}
      {runs && runs.length === 0 ? <section className="card"><Empty icon="play" title="Chưa có run nào">Chọn case ở Test Cases rồi bấm Run.</Empty></section> : (
        <section className="card" style={{ overflow: 'hidden' }}>
          <table className="dt">
            <thead><tr><th style={{ width: 40 }}><input className="cb" type="checkbox" aria-label="Chọn tất cả run đã xong" checked={done.length > 0 && picked.length === done.length} onChange={(e) => setPick(e.target.checked ? Object.fromEntries(done.map((r) => [r.id, true])) : {})} /></th><th>Run</th><th>App · file</th><th>Thiết bị</th><th>Kết quả</th><th className="r">Pass rate</th><th className="r">Thời gian</th><th></th></tr></thead>
            <tbody>{(runs || []).map((r) => {
              const c = r.counts || {};
              const rate = c.passed + c.failed ? `${Math.round((c.passed / (c.passed + c.failed)) * 100)}%` : '—';
              return (
                <tr key={r.id} className={pick[r.id] ? 'sel' : ''}>
                  <td><input className="cb" type="checkbox" aria-label={`Chọn ${r.id}`} disabled={r.status === 'running'} title={r.status === 'running' ? 'Run đang chạy — Stop trước khi xoá' : ''} checked={!!pick[r.id]} onChange={(e) => setPick({ ...pick, [r.id]: e.target.checked })} /></td>
                  <td><Link className="mono" to={`/runs/${r.id}`} style={{ fontWeight: 600 }}>{r.id}</Link><span className="name-sub">{fmtTime(r.startedAt)} · {STATE[r.status]}</span></td>
                  <td className="wrap">{r.appName}<span className="name-sub">{r.files?.join(', ')} · {r.order?.length} case</span></td>
                  <td className="wrap cap">{r.deviceName}</td>
                  <td>
                    {r.status === 'running' && <span className="run-prog"><span className={r.paused ? 'badge b-blocked' : 'badge b-running'}>{r.paused ? '⏸ Tạm dừng' : '● Đang chạy'}</span> <span className="cap mono">{(r.order || []).filter((id) => !['queued', 'running'].includes(r.results?.[id]?.status)).length}/{r.order?.length || 0} case</span></span>}
                    {['passed', 'failed', 'blocked', 'notrun'].filter((k) => c[k]).map((k) => <span key={k} style={{ marginRight: 6 }}><ExecBadge status={k} /> <b className="mono">{c[k]}</b></span>)}
                  </td>
                  <td className="r mono">{rate}</td>
                  <td className="r mono">{r.finishedAt ? fmtDur(new Date(r.finishedAt) - new Date(r.startedAt)) : '…'}</td>
                  <td className="r">{r.status === 'running' && <Link className="btn btn-sm btn-primary" to={`/runs/${r.id}`}><Icon name="arrow" />Theo dõi</Link>}{r.status !== 'running' && (
                    <button className="btn btn-sm" type="button" disabled={!!lock} title={lock ? `Thiết bị đang bận: ${lock.label}` : `Chạy lại ${r.order?.length} case của ${r.id}`}
                      onClick={() => api.post(`/runs/${r.id}/rerun`, {}).then((x) => nav(`/runs/${x.id}`)).catch(setErr)}><Icon name="play" />Run lại</button>)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </section>
      )}
    </main>
  );
}

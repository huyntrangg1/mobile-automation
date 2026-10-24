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
  return (
    <main className="content" style={{ maxWidth: 1180 }}>
      <PageHeader title="Test Runs" sub="Mỗi run giữ report riêng; mở run để xem kết quả, log và report." />
      <ErrorNote error={err} />
      {runs && runs.length === 0 ? <section className="card"><Empty icon="play" title="Chưa có run nào">Chọn case ở Test Cases rồi bấm Run.</Empty></section> : (
        <section className="card" style={{ overflow: 'hidden' }}>
          <table className="dt">
            <thead><tr><th>Run</th><th>App · file</th><th>Thiết bị</th><th>Kết quả</th><th className="r">Pass rate</th><th className="r">Thời gian</th><th></th></tr></thead>
            <tbody>{(runs || []).map((r) => {
              const c = r.counts || {};
              const rate = c.passed + c.failed ? `${Math.round((c.passed / (c.passed + c.failed)) * 100)}%` : '—';
              return (
                <tr key={r.id}>
                  <td><Link className="mono" to={`/runs/${r.id}`} style={{ fontWeight: 600 }}>{r.id}</Link><span className="name-sub">{fmtTime(r.startedAt)} · {STATE[r.status]}</span></td>
                  <td className="wrap">{r.appName}<span className="name-sub">{r.files?.join(', ')} · {r.order?.length} case</span></td>
                  <td className="wrap cap">{r.deviceName}</td>
                  <td>{['passed', 'failed', 'blocked', 'notrun'].filter((k) => c[k]).map((k) => <span key={k} style={{ marginRight: 6 }}><ExecBadge status={k} /> <b className="mono">{c[k]}</b></span>)}</td>
                  <td className="r mono">{rate}</td>
                  <td className="r mono">{r.finishedAt ? fmtDur(new Date(r.finishedAt) - new Date(r.startedAt)) : '…'}</td>
                  <td className="r">{r.status !== 'running' && (
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

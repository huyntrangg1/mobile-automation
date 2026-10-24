import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../components/Icon.jsx';
import { ErrorNote, PageHeader } from '../components/ui.jsx';

export function AppSettings({ reloadApps }) {
  const { appId } = useParams();
  const [app, setApp] = useState(null);
  const [rows, setRows] = useState([]);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api.get(`/apps/${appId}`).then((a) => { setApp(a); setRows(Object.entries(a.env || {}).map(([k, v]) => ({ k, v }))); });
  useEffect(() => { load(); }, [appId]);
  if (!app) return <main className="content"><div className="skel" style={{ height: 200 }} /></main>;
  const save = async () => {
    setErr(null);
    try {
      await api.put(`/apps/${appId}`, { env: Object.fromEntries(rows.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v])) });
      setMsg('Đã lưu');
      reloadApps();
      setTimeout(() => setMsg(null), 2000);
    } catch (e) { setErr(e); }
  };
  const upd = (i, k) => (e) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));
  return (
    <main className="content" style={{ maxWidth: 920 }}>
      <PageHeader title="Cài đặt app" sub={`${app.name} · ${app.bundleId}`} />
      <section className="card">
        <div className="card-h"><div><h2>Biến môi trường</h2><span className="cap">Truyền vào mỗi lần Run. Test case dùng bằng <code className="mono">{'${env.TEN_BIEN}'}</code>.</span></div></div>
        <div className="card-b stack-12">
          <ErrorNote error={err} />
          {rows.length === 0 && <p className="cap" style={{ margin: 0 }}>Chưa có biến nào.</p>}
          {rows.map((r, i) => (
            <div className="env-row" key={i}>
              <input className="inp mono" aria-label="Tên biến" value={r.k} onChange={upd(i, 'k')} placeholder="TEN_BIEN" />
              <input className="inp mono" aria-label={`Giá trị ${r.k}`} value={r.v} onChange={upd(i, 'v')} placeholder="giá trị" />
              <button className="btn btn-ghost btn-icon" type="button" aria-label={`Xoá ${r.k}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="close" /></button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-sm" type="button" onClick={() => setRows([...rows, { k: '', v: '' }])}><Icon name="plus" />Thêm biến</button>
            <span style={{ flex: 1 }} />
            {msg && <span className="cap" role="status">{msg}</span>}
            <button className="btn btn-primary" type="button" onClick={save}>Lưu</button>
          </div>
        </div>
      </section>
      <section className="card">
        <div className="card-h"><div><h2>Project WebdriverIO</h2><span className="cap mono">{app.workspace}</span></div>
          <button className="btn btn-sm" type="button" onClick={() => api.post(`/apps/${appId}/rebuild-workspace`).then(load)}><Icon name="refresh" />Chuẩn bị lại</button></div>
        <dl className="kv card-b">
          <dt>Trạng thái</dt><dd>{app.status === 'ready' ? 'Sẵn sàng' : app.status === 'preparing' ? 'Đang chuẩn bị…' : `Lỗi: ${app.error}`}</dd>
          <dt>Helper pack</dt><dd>{app.helperPack || 'Không dùng'}</dd>
          <dt>File app</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{app.appPath}</dd>
        </dl>
      </section>
    </main>
  );
}

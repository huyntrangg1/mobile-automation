import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useEvents } from '../useEvents.js';
import { Icon } from '../components/Icon.jsx';
import { ErrorNote, PageHeader } from '../components/ui.jsx';
import { UpdateBuild } from './Apps.jsx';

export function AppSettings({ reloadApps }) {
  const { appId } = useParams();
  const [app, setApp] = useState(null);
  const [rows, setRows] = useState([]);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [notes, setNotes] = useState(null); // null = chưa sửa → hiện giá trị của app
  const [notesMsg, setNotesMsg] = useState(null);
  const [links, setLinks] = useState(null);
  const saveLinks = async () => {
    setErr(null);
    try {
      const text = links ?? '';
      await api.put(`/apps/${appId}`, { deepLinks: text });
      setApp((o) => ({ ...o, deepLinks: text.split('\n').map((x) => x.trim()).filter(Boolean) }));
      setLinks(null);
    } catch (e) { setErr(e); }
  };
  const saveNotes = async () => {
    setErr(null);
    try {
      const a = await api.put(`/apps/${appId}`, { aiNotes: notes ?? app.aiNotes ?? '' });
      setApp((o) => ({ ...o, aiNotes: a.aiNotes }));
      setNotes(null);
      setNotesMsg('Đã lưu — áp dụng cho lần gen script sau');
      setTimeout(() => setNotesMsg(null), 3000);
    } catch (e) { setErr(e); }
  };
  const load = () => api.get(`/apps/${appId}`).then((a) => { setApp(a); setRows(Object.entries(a.env || {}).map(([k, v]) => ({ k, v }))); }).catch(setErr);
  useEffect(() => { load(); }, [appId]);
  // Trạng thái chuẩn bị project đổi ở server (đang chuẩn bị → sẵn sàng / lỗi) → cập nhật, giữ biến môi trường đang gõ
  useEvents('app', (e) => e.id === appId && api.get(`/apps/${appId}`).then((a) => setApp((o) => ({ ...o, status: a.status, error: a.error }))).catch(() => {}));
  const rebuild = () => { setErr(null); api.post(`/apps/${appId}/rebuild-workspace`).then(() => setApp((o) => ({ ...o, status: 'preparing', error: null }))).catch(setErr); };
  if (!app) return <main className="content"><ErrorNote error={err} /><div className="skel" style={{ height: 200 }} /></main>;
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
        <div className="card-h"><div><h2>Biến môi trường</h2><span className="cap">Truyền vào mỗi lần Run. Test case dùng bằng <code className="mono">{'${env.TEN_BIEN}'}</code>. So UI với Figma cần <code className="mono">FIGMA_TOKEN</code> (Figma → Settings → Security → Personal access token, quyền File content: read).</span></div></div>
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
        <div className="card-h"><div><h2>Ghi chú cho AI</h2><span className="cap">Hành vi riêng của app mà AI không tự biết. AI đọc mỗi lần gen script. Case đã gen cần gen lại để áp dụng.</span></div></div>
        <div className="card-b stack-12">
          <textarea className="inp" rows={5} value={notes ?? app.aiNotes ?? ''} onChange={(e) => setNotes(e.target.value)} aria-label="Ghi chú cho AI"
            placeholder={'Vd: Tutorial là slideshow tự chuyển slide sau vài giây; tap vào ảnh chuyển slide ngay. Muốn tới bước N thì chờ chữ "Step N of 3" hiện, không đếm số lần tap.'} style={{ height: 'auto', padding: 10, resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ flex: 1 }} />
            {notesMsg && <span className="cap" role="status">{notesMsg}</span>}
            <button className="btn btn-primary" type="button" onClick={saveNotes} disabled={notes === null}>Lưu ghi chú</button>
          </div>
        </div>
      </section>
      <section className="card">
        <div className="card-h"><div><h2>Deep link</h2><span className="cap">Mỗi dòng một link đã thống nhất với dev (vd moss://bloodsugar). AI Smoke Test dùng để vào thẳng màn con thay vì đi nhiều bước.</span></div></div>
        <div className="card-b stack-12">
          <textarea className="inp mono" rows={4} value={links ?? (Array.isArray(app.deepLinks) ? app.deepLinks.join('\n') : app.deepLinks || '')} onChange={(e) => setLinks(e.target.value)} aria-label="Deep link" placeholder="moss://bloodsugar" style={{ height: 'auto', padding: 12 }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ flex: 1 }} />
            <button className="btn btn-primary" type="button" onClick={saveLinks} disabled={links === null}>Lưu deep link</button>
          </div>
        </div>
      </section>
      <section className="card">
        <div className="card-h"><div><h2>Project WebdriverIO</h2><span className="cap mono">{app.workspace}</span></div>
          <button className="btn btn-sm" type="button" onClick={rebuild} disabled={app.status === 'preparing'}><Icon name="refresh" />Chuẩn bị lại</button></div>
        <dl className="kv card-b">
          <dt>Trạng thái</dt><dd>{app.status === 'ready' ? 'Sẵn sàng' : app.status === 'preparing' ? 'Đang chuẩn bị…' : `Lỗi: ${app.error}`}</dd>
          <dt>Helper pack</dt><dd>{app.helperPack || 'Không dùng'}</dd>
          <dt>File app</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{app.appPath}</dd>
          <dt>Build</dt><dd><span className="mono">v{app.version}</span> <button className="btn btn-sm" type="button" onClick={() => setUpdating(true)} style={{ marginLeft: 8 }}><Icon name="upload" />Cập nhật build</button></dd>
        </dl>
      </section>
      {updating && <UpdateBuild app={app} onClose={() => setUpdating(false)} onDone={() => { load(); reloadApps(); }} />}
    </main>
  );
}

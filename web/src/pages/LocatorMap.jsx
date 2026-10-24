import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useEvents } from '../useEvents.js';
import { Icon } from '../components/Icon.jsx';
import { Empty, ErrorNote, PageHeader, fmtTime } from '../components/ui.jsx';
import { StartCapture } from '../components/StartCapture.jsx';

export function LocatorMap({ apps, lock }) {
  const { appId } = useParams();
  const app = apps.find((a) => a.id === appId);
  const [screens, setScreens] = useState(null);
  const [sel, setSel] = useState(null);
  const [starting, setStarting] = useState(false);
  const [captures, setCaptures] = useState([]);
  const load = useCallback(() => {
    api.get(`/apps/${appId}/screens`).then((l) => { setScreens(l); setSel((s) => (s && l.some((x) => x.id === s) ? s : l[0]?.id || null)); });
    api.get(`/apps/${appId}/captures`).then(setCaptures);
  }, [appId]);
  useEffect(load, [load]);
  useEvents('app', (e) => e.id === appId && load());
  const live = captures.find((c) => c.status === 'running');
  if (!app) return <main className="content"><div className="skel" style={{ height: 240 }} /></main>;
  return (
    <main className="content content-wide">
      <PageHeader title="Locator map" sub={`${app.name} · ${screens?.length ?? 0} màn · AI dùng bản đồ này để viết script`}>
        {live && <Link className="btn" to={`/apps/${appId}/capture/${live.id}`}><span className="dev-dot busy" />Đang lấy locator</Link>}
        <button className="btn btn-primary" type="button" onClick={() => setStarting(true)} disabled={app.status !== 'ready'}><Icon name="map" />Lấy locator</button>
      </PageHeader>
      {app.status === 'preparing' && <div className="alert alert-info"><Icon name="refresh" /><div>Đang chuẩn bị project WebdriverIO cho app (cài thư viện). Xong là lấy locator được.</div></div>}
      {screens && screens.length === 0 ? (
        <section className="card">
          <Empty icon="map" title="Chưa có màn nào">
            <span>Chọn một trong hai chế độ: AI tự khám phá app, hoặc bạn tự bấm qua app để tool ghi lại.</span>
            <button className="btn btn-primary" type="button" onClick={() => setStarting(true)} disabled={app.status !== 'ready'} style={{ marginTop: 8 }}><Icon name="map" />Lấy locator</button>
          </Empty>
        </section>
      ) : (
        <div className="lm">
          <section className="lm-list card" aria-label="Danh sách màn">
            {(screens || []).map((s) => (
              <button key={s.id} type="button" className={sel === s.id ? 'lm-item on' : 'lm-item'} onClick={() => setSel(s.id)}>
                <img src={s.screenshot} alt="" loading="lazy" />
                <span className="lm-item-t"><b>{s.name}</b><span className="cap">{s.count} phần tử · {s.seenBy === 'explore' ? 'AI' : 'Ghi lại'}</span></span>
              </button>
            ))}
          </section>
          {sel && <ScreenDetail key={sel} id={sel} screens={screens} onChanged={load} />}
        </div>
      )}
      {captures.length > 0 && (
        <details className="card hist">
          <summary className="card-h"><h2>Lịch sử lấy locator</h2><span className="cap">{captures.length} lần</span></summary>
          <table className="dt"><tbody>{captures.map((c) => (
            <tr key={c.id}><td><Link to={`/apps/${appId}/capture/${c.id}`}>{c.mode === 'explore' ? 'Tự khám phá' : 'Ghi lại khi tôi bấm'}</Link></td><td className="cap">{fmtTime(c.startedAt)}</td><td>{c.screensFound} màn</td><td className="cap">{STATUS_TXT[c.status]}</td></tr>
          ))}</tbody></table>
        </details>
      )}
      {starting && <StartCapture app={app} lock={lock} onClose={() => setStarting(false)} />}
    </main>
  );
}

export const STATUS_TXT = { running: 'Đang chạy', done: 'Xong', stopped: 'Đã dừng', error: 'Lỗi', interrupted: 'Bị ngắt (server khởi động lại)' };

function ScreenDetail({ id, screens, onChanged }) {
  const [s, setS] = useState(null);
  const [hover, setHover] = useState(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState(null);
  const [mergeId, setMergeId] = useState('');
  const load = () => api.get(`/screens/${id}`).then((x) => { setS(x); setName(x.name); });
  useEffect(() => { load(); }, [id]);
  if (!s) return <section className="card lm-detail"><div className="skel" style={{ height: 400 }} /></section>;
  const act = (p) => p.then(() => { setErr(null); onChanged(); load(); }).catch(setErr);
  const win = s.win || { width: 440, height: 956 };
  const box = (e) => ({ left: `${(e.rect.x / win.width) * 100}%`, top: `${(e.rect.y / win.height) * 100}%`, width: `${(e.rect.width / win.width) * 100}%`, height: `${(e.rect.height / win.height) * 100}%` });
  return (
    <section className="card lm-detail">
      <div className="lm-shot">
        <div className="phone">
          <img src={s.screenshot} alt={`Ảnh màn ${s.name}`} />
          {hover != null && s.elements[hover] && <span className="hl-box" style={box(s.elements[hover])} />}
        </div>
      </div>
      <div className="lm-body">
        <ErrorNote error={err} />
        <div className="lm-head">
          <label className="field" style={{ flex: 1 }}><span className="label">Tên màn <span className="cap" style={{ fontWeight: 400 }}>— khớp cột Screen trong Excel</span></span>
            <span style={{ display: 'flex', gap: 8 }}>
              <input className="inp" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && act(api.put(`/screens/${id}`, { name }))} />
              <button className="btn" type="button" disabled={name === s.name || !name.trim()} onClick={() => act(api.put(`/screens/${id}`, { name }))}>Đổi tên</button>
            </span></label>
        </div>
        <div className="lm-tools">
          <select className="sel" value={mergeId} onChange={(e) => setMergeId(e.target.value)} aria-label="Gộp với màn">
            <option value="">Gộp màn khác vào màn này…</option>
            {screens.filter((x) => x.id !== id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <button className="btn btn-sm" type="button" disabled={!mergeId} onClick={() => act(api.post(`/screens/${id}/merge`, { dropId: mergeId })).then(() => setMergeId(''))}>Gộp</button>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm btn-danger" type="button" onClick={() => window.confirm(`Xoá màn "${s.name}"?`) && act(api.del(`/screens/${id}`))}>Xoá màn</button>
        </div>
        <div className="lm-table">
          <table className="dt lm-dt">
            <colgroup><col style={{ width: 92 }} /><col style={{ width: '27%' }} /><col /><col style={{ width: 150 }} /></colgroup>
            <thead><tr><th>Loại</th><th>Tên / nhãn</th><th>Locator</th><th>Target trong Excel</th></tr></thead>
            <tbody>{s.elements.map((e, i) => (
              <tr key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} className={hover === i ? 'sel' : ''}>
                <td><span className="type-chip">{e.type}</span></td>
                <td className="wrap">{e.name || <span className="muted">{e.label || '—'}</span>}</td>
                <td className="mono wrap loc">{e.locator}</td>
                <td><KeyInput value={e.key || ''} placeholder={e.name || e.label} onSave={(k) => act(api.put(`/screens/${id}/elements/${i}`, { key: k }))} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function KeyInput({ value, placeholder, onSave }) {
  const [v, setV] = useState(value);
  return <input className="inp inp-sm" value={v} placeholder={placeholder} aria-label="Tên Target" onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />;
}

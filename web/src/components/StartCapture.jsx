import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from './Icon.jsx';
import { Drawer, ErrorNote } from './ui.jsx';

const MODES = [
  { id: 'explore', icon: 'spark', title: 'Tự khám phá', desc: 'AI tự bấm qua app và ghi lại từng màn. Không cần thao tác, nhưng có thể sót màn nằm sau form khó.', time: '10–20 phút' },
  { id: 'record', icon: 'record', title: 'Ghi lại khi tôi bấm', desc: 'Bạn tự bấm qua app trên thiết bị (Simulator / emulator), tool ghi lại locator của mỗi màn đi qua. Chắc chắn đủ màn bạn đi.', time: 'Tuỳ bạn' },
];

export function StartCapture({ app, onClose, lock }) {
  const nav = useNavigate();
  const [sims, setSims] = useState([]);
  const [mode, setMode] = useState('record');
  const [udid, setUdid] = useState('');
  const [hints, setHints] = useState({ email: '', password: '' });
  const [maxSteps, setMaxSteps] = useState(60);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get(`/devices?platform=${app.platform || 'iOS'}`).then((l) => { setSims(l); setUdid(l[0]?.udid || ''); }).catch(setErr); }, [app.platform]);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const c = await api.post(`/apps/${app.id}/captures`, { mode, udid, hints: mode === 'explore' ? hints : undefined, maxSteps: Number(maxSteps) });
      nav(`/apps/${app.id}/capture/${c.id}`);
    } catch (e) { setErr(e); setBusy(false); }
  };
  return (
    <Drawer title="Lấy locator" sub={app.name} onClose={onClose}
      footer={<><span className="cap">Màn mới được gộp vào locator map hiện có.</span><span style={{ flex: 1 }} /><button className="btn" type="button" onClick={onClose}>Huỷ</button>
        <button className="btn btn-primary" type="button" onClick={go} disabled={busy || !udid || !!lock}>{busy ? 'Đang mở…' : 'Bắt đầu'}</button></>}>
      <ErrorNote error={err} />
      {lock && <div className="alert alert-warn"><Icon name="warn" /><div>Thiết bị đang bận: <b>{lock.label}</b>. Chờ xong rồi bắt đầu.</div></div>}
      <fieldset className="mode-pick">
        <legend className="label">Chế độ</legend>
        {MODES.map((m) => (
          <label key={m.id} className={mode === m.id ? 'mode on' : 'mode'}>
            <input type="radio" name="mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} className="sr-only" />
            <span className="mode-ic"><Icon name={m.icon} size={18} /></span>
            <span className="mode-t"><b>{m.title}</b><span className="cap">{m.desc}</span></span>
            <span className="cap mode-time">{m.time}</span>
          </label>
        ))}
      </fieldset>
      {sims.length === 0 && <div className="alert alert-warn"><Icon name="warn" /><div>Chưa thấy thiết bị {app.platform || 'iOS'} nào đang bật{app.platform === 'Android' ? ' — mở emulator (Android Studio → Device Manager) hoặc cắm máy thật bật USB debugging' : ''}.</div></div>}
      <label className="field"><span className="label">Thiết bị ({app.platform || 'iOS'})</span>
        <select className="sel" value={udid} onChange={(e) => setUdid(e.target.value)}>
          {sims.map((s) => <option key={s.udid} value={s.udid}>{s.name} · {s.os}{s.booted ? ' — đang bật' : ''}</option>)}
        </select></label>
      {mode === 'explore' && (
        <div className="stack-12">
          <span className="label">Dữ liệu gợi ý cho AI <span className="cap" style={{ fontWeight: 400 }}>— để vượt qua form đăng nhập / đăng ký</span></span>
          <div className="grid-2">
            <label className="field"><span className="cap">Email test</span><input className="inp" value={hints.email} onChange={(e) => setHints({ ...hints, email: e.target.value })} placeholder="qa+demo@ikameglobal.com" /></label>
            <label className="field"><span className="cap">Mật khẩu test</span><input className="inp" value={hints.password} onChange={(e) => setHints({ ...hints, password: e.target.value })} placeholder="Test1234" /></label>
          </div>
          <label className="field" style={{ maxWidth: 200 }}><span className="cap">Số bước tối đa</span><input className="inp" type="number" min="5" max="200" value={maxSteps} onChange={(e) => setMaxSteps(e.target.value)} /></label>
        </div>
      )}
    </Drawer>
  );
}

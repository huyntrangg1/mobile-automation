import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from './Icon.jsx';
import { Drawer, ErrorNote } from './ui.jsx';
import { DevicePicker, WrongPlatform, useDevices } from './DevicePicker.jsx';

const MODES = [
  { id: 'explore', icon: 'spark', title: 'Tự khám phá', desc: 'AI tự bấm qua app và ghi lại từng màn. Không cần thao tác, nhưng có thể sót màn nằm sau form khó.', time: '10–20 phút' },
  { id: 'record', icon: 'record', title: 'Ghi lại khi tôi bấm', desc: 'Bạn tự bấm qua app trên thiết bị (Simulator / emulator), tool ghi lại locator của mỗi màn đi qua. Chắc chắn đủ màn bạn đi.', time: 'Tuỳ bạn' },
];

export function StartCapture({ app, onClose, lock, initialMode }) {
  const nav = useNavigate();
  const [mode, setMode] = useState(initialMode || 'record');
  const [hints, setHints] = useState({ email: '', password: '' });
  const [maxSteps, setMaxSteps] = useState(60);
  const [startFrom, setStartFrom] = useState('begin'); // begin | current | id màn
  const [screens, setScreens] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const platform = app.platform || 'iOS';
  const { devices: sims, udid, setUdid, picked, wrong } = useDevices(platform, setErr);
  useEffect(() => { api.get(`/apps/${app.id}/screens`).then(setScreens).catch(() => {}); }, [app.id]);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const c = await api.post(`/apps/${app.id}/captures`, { mode, udid, hints: mode === 'explore' ? hints : undefined, maxSteps: Number(maxSteps), fromCurrent: mode === 'explore' && startFrom === 'current', startScreenId: mode === 'explore' && !['begin', 'current'].includes(startFrom) ? startFrom : undefined });
      nav(`/apps/${app.id}/capture/${c.id}`);
    } catch (e) { setErr(e); setBusy(false); }
  };
  return (
    <Drawer title="Lấy locator" sub={app.name} onClose={onClose}
      footer={<><span className="cap">Màn mới được gộp vào locator map hiện có.</span><span style={{ flex: 1 }} /><button className="btn" type="button" onClick={onClose}>Huỷ</button>
        <button className="btn btn-primary" type="button" onClick={go} disabled={busy || !udid || wrong || !!lock}>{busy ? 'Đang mở…' : 'Bắt đầu'}</button></>}>
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
      {sims.filter((d) => d.platform === platform).length === 0 && <div className="alert alert-warn"><Icon name="warn" /><div>Chưa thấy thiết bị {app.platform || 'iOS'} nào đang bật{app.platform === 'Android' ? ' — mở emulator (Android Studio → Device Manager) hoặc cắm máy thật bật USB debugging' : ''}.</div></div>}
      <section className="field"><span className="label">Thiết bị</span>
        <DevicePicker devices={sims} value={udid} onChange={setUdid} platform={platform} />
        {wrong && <WrongPlatform platform={platform} picked={picked} />}</section>
      {mode === 'explore' && (
        <div className="stack-12">
          <span className="label">Dữ liệu gợi ý cho AI <span className="cap" style={{ fontWeight: 400 }}>— để vượt qua form đăng nhập / đăng ký</span></span>
          <div className="grid-2">
            <label className="field"><span className="cap">Email test</span><input className="inp" value={hints.email} onChange={(e) => setHints({ ...hints, email: e.target.value })} placeholder="qa+demo@ikameglobal.com" /></label>
            <label className="field"><span className="cap">Mật khẩu test</span><input className="inp" value={hints.password} onChange={(e) => setHints({ ...hints, password: e.target.value })} placeholder="Test1234" /></label>
          </div>
          <label className="field"><span className="cap">Bắt đầu khám phá từ</span>
            <select className="inp" value={startFrom} onChange={(e) => setStartFrom(e.target.value)}>
              <option value="begin">Đầu app (cài lại, mở mới)</option>
              <option value="current">Màn app đang mở trên thiết bị (không cài / mở lại)</option>
              {screens.length > 0 && <optgroup label="Màn đã có trong locator map">{screens.map((sc) => <option key={sc.id} value={sc.id}>{sc.name}</option>)}</optgroup>}
            </select>
            {!['begin', 'current'].includes(startFrom) && <span className="cap">Tool mở app mới rồi tự đi tới màn này (theo đường đã ghi, thiếu thì AI dẫn đường), sau đó mới khám phá.</span>}
          </label>
          <label className="field" style={{ maxWidth: 200 }}><span className="cap">Số bước tối đa</span><input className="inp" type="number" min="5" max="200" value={maxSteps} onChange={(e) => setMaxSteps(e.target.value)} /></label>
        </div>
      )}
    </Drawer>
  );
}

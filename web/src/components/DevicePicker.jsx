import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Icon } from './Icon.jsx';

// Lấy thiết bị cả hai nền tảng (tab iOS / Android cần dữ liệu), mặc định chọn máy đang bật của nền tảng app.
// Android lỗi (chưa cài SDK) thì coi như rỗng. `wrong` = máy đang chọn không cùng nền tảng với app.
export function useDevices(platform, onError) {
  const [devices, setDevices] = useState([]);
  const [udid, setUdid] = useState('');
  useEffect(() => {
    if (!platform) return undefined;
    let stale = false;
    Promise.all([api.get('/devices?platform=iOS'), api.get('/devices?platform=Android').catch(() => [])]).then(([ios, and]) => {
      if (stale) return;
      const all = [...ios, ...and];
      const mine = all.filter((d) => d.platform === platform);
      setDevices(all); setUdid((mine.find((d) => d.booted) || mine[0])?.udid || '');
    }).catch((e) => !stale && onError?.(e));
    return () => { stale = true; };
  }, [platform]);
  const picked = devices.find((d) => d.udid === udid);
  return { devices, udid, setUdid, picked, wrong: !!picked && !!platform && picked.platform !== platform };
}

export function WrongPlatform({ platform, picked }) {
  return <div className="alert alert-warn"><Icon name="warn" /><div>App này là <b>{platform}</b> nhưng thiết bị đã chọn là {picked.platform}. Chọn thiết bị {platform}.</div></div>;
}

// Danh sách chọn thiết bị: ô tìm, nhóm "Đang bật" lên trước, mỗi dòng có chấm trạng thái.
// Thay cho <select> — chọn bằng bấm dòng, giá trị là udid. Logic chọn mặc định để trang gọi quyết.
export function DevicePicker({ devices, value, onChange, platform = 'iOS', disabled = false }) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState(platform);
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = devices.filter((d) => d.platform === tab && (!s || `${d.name} ${d.os}`.toLowerCase().includes(s)));
    const on = list.filter((d) => d.booted);
    const off = list.filter((d) => !d.booted);
    const restName = tab === 'Android' ? 'Android emulators' : 'iOS simulators';
    return [
      { key: 'on', name: 'Đang bật', items: on },
      { key: 'off', name: on.length ? 'Đã tắt' : restName, items: off },
    ].filter((g) => g.items.length);
  }, [devices, q, tab]);

  return (
    <div className="devpick">
      <div className="chips" role="tablist" aria-label="Nền tảng">
        {['iOS', 'Android'].map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`chip${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>
            {t}<span className="count">{devices.filter((d) => d.platform === t).length}</span>
          </button>
        ))}
      </div>
      <div className="search devpick-search">
        <Icon name="search" />
        <input className="inp" type="search" placeholder="Tìm thiết bị…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm thiết bị" />
      </div>
      <div className="devpick-body" role="radiogroup" aria-label="Thiết bị">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="devpick-head"><span>{g.name}</span><span className="mono">{g.items.length}</span></div>
            {g.items.map((d) => {
              const on = d.udid === value;
              return (
                <button key={d.udid} type="button" role="radio" aria-checked={on} disabled={disabled}
                  className={`devpick-row${on ? ' on' : ''}`} onClick={() => onChange(d.udid)}>
                  <span className="devpick-ic"><Icon name="phone" /><i className={`devpick-dot${d.booted ? ' booted' : ''}`} title={d.booted ? 'Đang bật' : 'Đã tắt'} /></span>
                  <span className="devpick-txt"><b>{d.name}</b><span className="mono cap">{d.os}</span>{d.note && <span className="cap" style={{ color: 'var(--danger, #b42318)' }}>{d.note}</span>}</span>
                  {on && <Icon name="check" className="devpick-check" />}
                </button>
              );
            })}
          </div>
        ))}
        {groups.length === 0 && <div className="devpick-empty cap">{q ? `Không có thiết bị khớp “${q}”.` : 'Chưa có thiết bị nào.'}</div>}
      </div>
    </div>
  );
}

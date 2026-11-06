import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useEvents } from '../useEvents.js';
import { Icon } from '../components/Icon.jsx';
import { Empty, ErrorNote, PageHeader, fmtTime } from '../components/ui.jsx';
import { StartCapture } from '../components/StartCapture.jsx';
import { PopMenu } from '../components/PopMenu.jsx';
import { missingFrom } from '../locInfo.js';

const LM_TABS = [
  ['all', 'Tất cả', () => true],
  ['explore', 'AI khám phá', (x) => x.seenBy === 'explore'],
  ['record', 'Ghi lại', (x) => x.seenBy === 'record'],
  ['miss', 'Thiếu phần tử', (x, m) => (m.els[x.name]?.length || 0) > 0],
];

export function LocatorMap({ apps, lock }) {
  const { appId } = useParams();
  const app = apps.find((a) => a.id === appId);
  const [screens, setScreens] = useState(null);
  const [sel, setSel] = useState(null);
  const [starting, setStarting] = useState(false);
  const [captures, setCaptures] = useState([]);
  const [devices, setDevices] = useState([]);
  const [udid, setUdid] = useState(''); // thiết bị để "Thử trên máy"
  const [figMsg, setFigMsg] = useState(null);
  const [figErr, setFigErr] = useState(null);
  const [tidying, setTidying] = useState(false);
  const [tab, setTab] = useState('all');
  const [term, setTerm] = useState('');
  const [miss, setMiss] = useState({ absent: [], els: {} }); // màn / phần tử Excel cần mà map chưa có (từ cảnh báo khi gen script)
  useEffect(() => { api.get(`/apps/${appId}/cases`).then((cs) => setMiss(missingFrom(cs))).catch(() => {}); }, [appId]);
  // Gộp màn trùng + xếp theo lần ghi gần nhất (dữ liệu ghi từ trước khi tool tự gộp)
  const tidy = async () => {
    setTidying(true); setFigErr(null);
    try {
      const r = await api.post(`/apps/${appId}/screens/tidy`, {});
      const bits = [];
      if (r.merged.length) bits.push(`gộp ${r.merged.length} màn trùng (${r.merged.map((m) => `${m.drop} → ${m.keep}`).join(', ')})`);
      if (r.removed.length) bits.push(`bỏ ${r.removed.length} khung hình hiệu ứng (${r.removed.join(', ')})`);
      if (r.ordered) bits.push(`xếp màn theo thứ tự đi qua (${r.runs} lần lấy locator)`);
      setFigMsg(bits.length ? `Đã ${bits.join(' · ')}. Tên cũ vẫn dùng được trong script.` : 'Map đã gọn — không có màn trùng.');
      load();
    } catch (e) { setFigErr(e); }
    setTidying(false);
  };
  useEffect(() => {
    if (!app) return;
    api.get(`/devices?platform=${app.platform || 'iOS'}`).then((l) => { setDevices(l); setUdid((u) => u || l.find((d) => d.booted)?.udid || ''); }).catch(() => {});
  }, [app?.id]);
  const load = useCallback(() => {
    api.get(`/apps/${appId}/screens`).then((l) => { setScreens(l); setSel((s) => (s && l.some((x) => x.id === s) ? s : l[0]?.id || null)); });
    api.get(`/apps/${appId}/captures`).then(setCaptures);
  }, [appId]);
  useEffect(load, [load]);
  useEvents('app', (e) => e.id === appId && load());
  const live = captures.find((c) => c.status === 'running');
  const shown = (screens || []).filter((x) => LM_TABS.find((t) => t[0] === tab)[2](x, miss) && (!term.trim() || x.name.toLowerCase().includes(term.trim().toLowerCase())));
  useEffect(() => { document.querySelector('.lm-th[aria-current]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [sel, screens]);
  if (!app) return <main className="content"><div className="skel" style={{ height: 240 }} /></main>;
  return (
    <main className="content content-wide">
      <PageHeader title="Locator map" sub={`${app.name} · ${screens?.length ?? 0} màn · AI dùng bản đồ này để viết script`}>
        <button className="btn" type="button" onClick={tidy} disabled={tidying || !!live || !screens?.length} title="Gộp các màn trùng nhau, bỏ khung hình đang chạy hiệu ứng, xếp màn theo thứ tự bạn bấm qua"><Icon name="refresh" />{tidying ? 'Đang dọn…' : 'Dọn map'}</button>
        {live && <Link className="btn" to={`/apps/${appId}/capture/${live.id}`}><span className="dev-dot busy" />Đang lấy locator</Link>}
        <button className="btn btn-primary" type="button" onClick={() => setStarting(true)} disabled={app.status !== 'ready'}><Icon name="map" />Lấy locator</button>
      </PageHeader>
      <ErrorNote error={figErr} />
      {figMsg && <div className="alert alert-info" role="status"><Icon name="check" /><div>{figMsg}</div><button className="btn btn-sm btn-ghost btn-icon" type="button" aria-label="Đóng" onClick={() => setFigMsg(null)} style={{ marginLeft: 'auto' }}><Icon name="close" /></button></div>}
      {app.status === 'preparing' && <div className="alert alert-info"><Icon name="refresh" /><div>Đang chuẩn bị project WebdriverIO cho app (cài thư viện). Xong là lấy locator được.</div></div>}
      {screens === null ? (
        <div className="skel" style={{ height: 240 }} />
      ) : screens.length === 0 ? (
        <section className="card">
          <Empty icon="map" title="Chưa có màn nào">
            <span>Chọn một trong hai chế độ: AI tự khám phá app, hoặc bạn tự bấm qua app để tool ghi lại.</span>
            <button className="btn btn-primary" type="button" onClick={() => setStarting(true)} disabled={app.status !== 'ready'} style={{ marginTop: 8 }}><Icon name="map" />Lấy locator</button>
          </Empty>
        </section>
      ) : (
        <>
          {(miss.absent.length > 0 || Object.keys(miss.els).length > 0) && (
            <details className="lm-miss">
              <summary><Icon name="warn" /><span><b>{miss.absent.length} màn Excel cần mà chưa có trong map</b>{Object.keys(miss.els).length > 0 && <> · {Object.keys(miss.els).length} màn khác thiếu phần tử</>}</span>
                <span className="lm-miss-act"><span className="linkbtn">Xem</span><button className="btn btn-sm" type="button" onClick={(e) => { e.preventDefault(); setStarting(true); }} disabled={app.status !== 'ready'}><Icon name="map" />Lấy locator</button></span></summary>
              <ul>{miss.absent.map(([n, k]) => <li key={n}><b>{n}</b> <span className="cap">· {k} case</span></li>)}</ul>
            </details>
          )}
          <div className="lm-flt">
            <div className="search"><Icon name="search" /><input className="inp" type="search" placeholder="Tìm màn…" aria-label="Tìm màn" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
            <div className="chips" role="tablist" aria-label="Lọc màn">
              {LM_TABS.map(([k, l, f]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`chip${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l}<span className="count">{(screens || []).filter((x) => f(x, miss)).length}</span></button>)}
            </div>
            <span className="cap num" style={{ marginLeft: 'auto' }}>{shown.length}/{screens.length} màn</span>
          </div>
          <div className="card lm-strip" role="listbox" aria-label="Các màn">
            {shown.map((x) => (
              <button key={x.id} type="button" role="option" aria-selected={sel === x.id} aria-current={sel === x.id ? 'true' : undefined} className="lm-th" onClick={() => setSel(x.id)}>
                <span className="lm-no">{String(screens.indexOf(x) + 1).padStart(2, '0')}</span>
                <img src={x.screenshot} alt="" loading="lazy" />
                <b title={x.name}>{x.name}</b>
                <span className="n">{x.count} phần tử</span>
                {miss.els[x.name]?.length > 0 && <span className="lm-warn" title={`Excel cần: ${miss.els[x.name].join(', ')}`}><Icon name="warn" size={12} />{miss.els[x.name].length} thiếu</span>}
              </button>
            ))}
            {shown.length === 0 && <div className="lm-none">Không có màn khớp.</div>}
          </div>
          {sel && <ScreenDetail key={sel} id={sel} appId={appId} udid={udid} setUdid={setUdid} devices={devices} screens={screens} missEl={miss.els[(screens.find((x) => x.id === sel) || {}).name] || []}
            pos={screens.findIndex((x) => x.id === sel) + 1} total={screens.length} onPrev={() => setSel(screens[screens.findIndex((x) => x.id === sel) - 1]?.id || sel)} onNext={() => setSel(screens[screens.findIndex((x) => x.id === sel) + 1]?.id || sel)} onChanged={load} />}
        </>
      )}
      <Overrides appId={appId} udid={udid} />
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

// Locator tester sửa khi chạy (chế độ sửa tay: Fix script & go on) — thắng locator trong script; Xoá = hoàn tác
function Overrides({ appId, udid }) {
  const [list, setList] = useState([]);
  const [err, setErr] = useState(null);
  const [tried, setTried] = useState(null);
  const [trying, setTrying] = useState(false);
  const tryLive = async (locator, tap = false) => {
    setTrying(true); setErr(null);
    try { setTried({ ...(await api.post(`/apps/${appId}/try-live`, { udid, locator, tap })), locator, live: true }); } catch (e) { setErr(e); }
    setTrying(false);
  };
  const load = useCallback(() => api.get(`/apps/${appId}/overrides`).then(setList).catch(setErr), [appId]);
  useEffect(() => { load(); }, [load]);
  useEvents('run', (x) => x.appId === appId && x.status !== 'running' && load());
  if (!list.length) return null;
  const remove = (key) => api.del(`/apps/${appId}/overrides`, { key }).then(setList).catch(setErr);
  return (
    <section className="card">
      <div className="card-h"><h2>Đã sửa khi chạy</h2><span className="cap">{list.length} locator — dùng thay locator trong script ở mọi lần chạy</span></div>
      <ErrorNote error={err} />
      {tried && (
        <div className="try-live">
          <div className="phone try-shot"><img src={tried.shotUrl} alt="Màn đang mở trên máy" />
            {tried.elements.map((e, i) => e.rect?.width > 0 && <span key={i} className={i === 0 ? 'try-box first' : 'try-box'} style={{ left: `${(e.rect.x / tried.win.width) * 100}%`, top: `${(e.rect.y / tried.win.height) * 100}%`, width: `${(e.rect.width / tried.win.width) * 100}%`, height: `${(e.rect.height / tried.win.height) * 100}%` }} />)}
            {tried.point && <span className="hm-point" style={{ left: `${tried.point.fx * 100}%`, top: `${tried.point.fy * 100}%` }} />}</div>
          <TryResult r={tried} udid={udid} busy={trying} onLive={(tap) => tryLive(tried.locator, tap)} onClose={() => setTried(null)} />
        </div>
      )}
      <div className="tw"><table className="dt"><thead><tr><th>Màn (Excel)</th><th>Target</th><th>Phần tử đã chọn</th><th>Locator</th><th>Lúc</th><th /></tr></thead>
        <tbody>{list.map((o) => (
          <tr key={o.key}><td>{o.screen}</td><td>{o.target}</td><td>{o.element || '—'}</td><td><LocInput value={o.locator} onSave={(l) => api.put(`/apps/${appId}/overrides`, { key: o.key, locator: l }).then(setList).catch(setErr)} /></td><td className="cap">{fmtTime(o.at)}</td>
            <td className="r nowrap"><button className="btn btn-sm btn-ghost" type="button" disabled={!udid || trying} title={udid ? 'Thử trên máy — mở app tới đúng màn trước' : 'Chọn thiết bị ở thanh trên bảng phần tử'} onClick={() => tryLive(o.locator)}>Thử trên máy</button><button className="btn btn-sm btn-ghost" type="button" onClick={() => remove(o.key)}>Xoá</button></td></tr>
        ))}</tbody></table></div>
    </section>
  );
}

export const STATUS_TXT = { running: 'Đang chạy', done: 'Xong', stopped: 'Đã dừng', error: 'Lỗi', interrupted: 'Bị ngắt (server khởi động lại)' };

function ScreenDetail({ id, appId, udid, setUdid, devices, screens, missEl, pos, total, onPrev, onNext, onChanged }) {
  const [s, setS] = useState(null);
  const [hover, setHover] = useState(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState(null);
  const [mergeId, setMergeId] = useState('');
  const [merging, setMerging] = useState(false);
  const [adding, setAdding] = useState(null); // { type, key, locator } khi đang thêm phần tử tay
  const [tried, setTried] = useState(null); // kết quả Thử: { locator, live, count, elements, point?, shotUrl, win, error? }
  const [trying, setTrying] = useState(false);
  const tryIt = async (locator, { live = false, tap = false } = {}) => {
    setTrying(true); setErr(null);
    try {
      const r = live ? await api.post(`/apps/${appId}/try-live`, { udid, locator, tap }) : await api.post(`/screens/${id}/try`, { locator });
      setTried({ ...r, locator, live });
    } catch (e) { setErr(e); }
    setTrying(false);
  };
  const load = () => api.get(`/screens/${id}`).then((x) => { setS(x); setName(x.name); });
  useEffect(() => { load(); }, [id]);
  if (!s) return <section className="card lm-detail"><div className="skel" style={{ height: 400 }} /></section>;
  const act = (p) => p.then(() => { setErr(null); onChanged(); load(); }).catch(setErr);
  const win = s.win || { width: 440, height: 956 };
  const box = (e, w = win) => ({ left: `${(e.rect.x / w.width) * 100}%`, top: `${(e.rect.y / w.height) * 100}%`, width: `${(e.rect.width / w.width) * 100}%`, height: `${(e.rect.height / w.height) * 100}%` });
  const tw = tried?.win || win;
  const commitName = () => { const n = name.trim(); if (!n) { setName(s.name); return; } if (n !== s.name) act(api.put(`/screens/${id}`, { name: n })); };
  return (
    <section className="lm-detail">
      <div className="lm-shot">
        <div className="phone">
          <img src={tried?.shotUrl || s.screenshot} alt={tried?.live ? 'Màn đang mở trên máy' : `Ảnh màn ${s.name}`} style={adding ? { cursor: 'crosshair' } : undefined} onClick={(ev) => {
            if (!adding) return;
            const r = ev.currentTarget.getBoundingClientRect();
            const fx = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
            const fy = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
            setAdding({ ...adding, locator: `point:${fx.toFixed(3)},${fy.toFixed(3)}`, point: { fx, fy } });
          }} />
          {hover != null && s.elements[hover]?.rect && <span className="hl-box" style={box(s.elements[hover])} />}
          {tried?.elements?.map((e, i) => e.rect?.width > 0 && <span key={i} className={i === 0 ? 'try-box first' : 'try-box'} style={box(e, tw)} />)}
          {tried?.point && <span className="hm-point" style={{ left: `${tried.point.fx * 100}%`, top: `${tried.point.fy * 100}%` }} />}
          {adding?.point && <span className="hm-point" style={{ left: `${adding.point.fx * 100}%`, top: `${adding.point.fy * 100}%` }} />}
        </div>
      </div>
      <div className="lm-body">
        <ErrorNote error={err} />
        {tried && <TryResult r={tried} udid={udid} busy={trying} onLive={(tap) => tryIt(tried.locator, { live: true, tap })} onClose={() => setTried(null)} />}
        <div className="lm-dh">
          <input className="lm-ttl" value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { setName(s.name); e.currentTarget.blur(); } }}
            aria-label="Tên màn (khớp cột Screen trong Excel)" title="Tên màn — khớp cột Screen trong Excel. Bấm để đổi tên." />
          <span className="cap">{s.seenBy === 'explore' ? 'AI khám phá' : 'Ghi lại'}</span>
          {missEl.length > 0 && <span className="lm-warn" title={`Excel cần: ${missEl.join(', ')}`}><Icon name="warn" size={12} />{missEl.length} phần tử thiếu</span>}
          <span style={{ flex: 1 }} />
          <span className="cap num">{pos}/{total}</span>
          <button className="btn btn-icon" type="button" aria-label="Màn trước" disabled={pos <= 1} onClick={onPrev}><Icon name="arrow" className="flip" /></button>
          <button className="btn btn-icon" type="button" aria-label="Màn sau" disabled={pos >= total} onClick={onNext}><Icon name="arrow" /></button>
          <PopMenu label="Thao tác với màn" small={false}>
            {(close) => (
              <>
                <button type="button" role="menuitem" onClick={() => { close(); setMerging(true); }}><Icon name="layers" />Gộp màn khác vào màn này…</button>
                <hr />
                <button type="button" role="menuitem" className="danger" onClick={() => { close(); if (window.confirm(`Xoá màn "${s.name}"?`)) act(api.del(`/screens/${id}`)); }}><Icon name="trash" />Xoá màn…</button>
              </>
            )}
          </PopMenu>
        </div>
        {merging && (
          <div className="lm-merge">
            <select className="sel" value={mergeId} onChange={(e) => setMergeId(e.target.value)} aria-label="Gộp với màn">
              <option value="">Chọn màn để gộp vào màn này…</option>
              {screens.filter((x) => x.id !== id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <button className="btn btn-sm btn-primary" type="button" disabled={!mergeId} onClick={() => act(api.post(`/screens/${id}/merge`, { dropId: mergeId })).then(() => { setMergeId(''); setMerging(false); })}>Gộp</button>
            <button className="btn btn-sm" type="button" onClick={() => { setMerging(false); setMergeId(''); }}>Huỷ</button>
          </div>
        )}
        <div className="lm-tb">
          <span className="cap">Thiết bị thử</span>
          <select className="sel" value={udid} onChange={(e) => setUdid(e.target.value)} aria-label="Thiết bị để thử locator" title="Thiết bị cho nút Thử trên máy — mở app tới đúng màn trước">
            <option value="">Chọn thiết bị…</option>
            {devices.map((d) => <option key={d.udid} value={d.udid}>{d.name}{d.booted ? ' — đang bật' : ''}</option>)}
          </select>
          <span style={{ flex: 1 }} />
          <span className="cap num">{s.elements.length} phần tử</span>
          <button className="btn btn-sm" type="button" disabled={!!adding} onClick={() => setAdding({ type: 'Button', key: '', locator: '' })}><Icon name="plus" />Thêm phần tử</button>
        </div>
        <div className="lm-table">
          <table className="dt lm-dt">
            <colgroup><col style={{ width: 88 }} /><col style={{ width: '26%' }} /><col /><col style={{ width: 130 }} /><col style={{ width: 104 }} /></colgroup>
            <thead><tr><th>Loại</th><th>Tên / nhãn</th><th>Locator</th><th>Target Excel</th><th /></tr></thead>
            <tbody>{s.elements.map((e, i) => (
              <tr key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} className={hover === i ? 'sel' : ''}>
                <td><span className="type-chip">{e.type}</span></td>
                <td className="wrap">{e.name || <span className="muted">{e.label || '—'}</span>}</td>
                <td><LocInput value={e.locator} alts={e.alts} onSave={(l) => act(api.put(`/screens/${id}/elements/${i}`, { locator: l }))} />{e.manual && <span className="cap"> · sửa tay</span>}</td>
                <td><KeyInput value={e.key || ''} placeholder={e.name || e.label} onSave={(k) => act(api.put(`/screens/${id}/elements/${i}`, { key: k }))} /></td>
                <td className="r nowrap"><button className="btn btn-sm btn-ghost" type="button" disabled={trying} title="Thử locator trên ảnh đã lưu của màn này" onClick={() => tryIt(e.locator)}>Thử</button><button className="btn btn-sm btn-ghost btn-icon" type="button" aria-label={`Xoá ${e.key || e.name || e.label || e.type}`} title="Xoá phần tử (lấy locator lần sau không thêm lại)" onClick={() => window.confirm(`Xoá phần tử "${e.key || e.name || e.label || e.type}"?`) && act(api.del(`/screens/${id}/elements/${i}`))}><Icon name="close" /></button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {adding ? (
          <div className="lm-add">
            <select className="sel" value={adding.type} onChange={(ev) => setAdding({ ...adding, type: ev.target.value })} aria-label="Loại phần tử">
              {['Button', 'StaticText', 'TextField', 'Image', 'Cell', 'Other'].map((t) => <option key={t}>{t}</option>)}
            </select>
            <input className="inp" placeholder="Target trong Excel (vd Close)" value={adding.key} onChange={(ev) => setAdding({ ...adding, key: ev.target.value })} />
            <input className="inp mono" placeholder="Locator — hoặc bấm vào ảnh để lấy vị trí" value={adding.locator} onChange={(ev) => setAdding({ ...adding, locator: ev.target.value, point: null })} />
            <button className="btn btn-primary btn-sm" type="button" disabled={!adding.key.trim() || !adding.locator.trim()} onClick={() => act(api.post(`/screens/${id}/elements`, { type: adding.type, key: adding.key, locator: adding.locator })).then(() => setAdding(null))}>Thêm</button>
            <button className="btn btn-sm" type="button" disabled={!adding.locator.trim() || trying} onClick={() => tryIt(adding.locator.trim())}>Thử</button>
            <button className="btn btn-sm" type="button" onClick={() => setAdding(null)}>Huỷ</button>
            {adding.locator.startsWith('point:') && <span className="cap">Vị trí trên màn — chỉ dùng cho bước Tap (không dùng cho kiểm chữ / hiển thị).</span>}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function KeyInput({ value, placeholder, onSave }) {
  const [v, setV] = useState(value);
  return <input className="inp inp-sm" value={v} placeholder={placeholder} aria-label="Tên Target" onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />;
}

// Ô sửa locator: gợi ý các locator thay thế tool đã ghi (alts); Enter / rời ô để lưu
function LocInput({ value, alts = [], onSave }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const listId = useMemo(() => `alts-${Math.random().toString(36).slice(2, 8)}`, []);
  const save = () => v.trim() && v !== value && onSave(v.trim());
  return (
    <>
      <input className="inp inp-sm mono" value={v} list={alts.length ? listId : undefined} aria-label="Locator" onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      {alts.length > 0 && <datalist id={listId}>{alts.map((a) => <option key={a} value={a} />)}</datalist>}
      {v.startsWith('point:') && <span className="cap">chỉ dùng cho Tap</span>}
    </>
  );
}

// Kết quả thử locator: tìm thấy mấy phần tử, là gì; nút thử trên máy / bấm thử
function TryResult({ r, udid, busy, onLive, onClose }) {
  const where = r.live ? 'trên màn đang mở ở máy' : 'trên ảnh đã lưu (lần chụp gần nhất)';
  const first = r.elements?.[0];
  const desc = (e) => `${e.type} "${e.name || e.label || '—'}"${e.visible ? '' : ' · đang ẩn'}${e.enabled ? '' : ' · bị disable'}`;
  let cls = 'alert-ok';
  let msg;
  if (r.error) { cls = 'alert-err'; msg = r.error; }
  else if (r.point) msg = `Vị trí trên màn (${Math.round(r.point.fx * 100)}%, ${Math.round(r.point.fy * 100)}%) — chỉ dùng cho Tap${r.tapped ? ' · đã bấm thử' : ''}`;
  else if (!r.count) { cls = 'alert-err'; msg = `Không thấy phần tử nào ${where}${r.live ? ' — app có đang ở đúng màn không?' : ''}`; }
  else if (r.count === 1) msg = `Tìm thấy 1 phần tử ${where}: ${desc(first)}${r.tapped ? ' · đã bấm thử (ảnh là màn sau khi bấm)' : ''}`;
  else { cls = 'alert-warn'; msg = `Tìm thấy ${r.count} phần tử ${where} — chưa đủ cụ thể, khi chạy sẽ dùng cái đầu tiên (${desc(first)})${r.tapped ? ' · đã bấm thử cái đầu tiên' : ''}`; }
  return (
    <div className={`alert ${cls} try-result`} role="status">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mono cap trunc-2">{r.locator}</div>
        <div>{msg}</div>
        <div className="try-actions">
          <button className="btn btn-sm" type="button" disabled={!udid || busy} title={udid ? 'Mở app tới đúng màn trước' : 'Chọn thiết bị ở thanh trên bảng phần tử'} onClick={() => onLive(false)}>{busy ? 'Đang thử…' : 'Thử trên máy'}</button>
          <button className="btn btn-sm" type="button" disabled={!udid || busy || (!r.point && !r.count && r.live)} title="Bấm thật vào phần tử đầu tiên / vị trí trên máy" onClick={() => window.confirm('Bấm thật trên máy? App sẽ chuyển màn nếu nút có tác dụng.') && onLive(true)}>Thử bấm</button>
          <button className="btn btn-sm btn-ghost" type="button" onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>
  );
}

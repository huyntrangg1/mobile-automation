import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useEvents } from '../useEvents.js';
import { Icon } from '../components/Icon.jsx';
import { ErrorNote, PageHeader, fmtDur, fmtTime } from '../components/ui.jsx';
import { StartCapture } from '../components/StartCapture.jsx';
import { STATUS_TXT } from './LocatorMap.jsx';

const BADGE = { running: ['stt-run', 'Đang chạy'], done: ['stt-done', 'Xong'], stopped: ['stt-stop', 'Đã dừng'], error: ['stt-err', 'Lỗi'], interrupted: ['stt-err', 'Bị ngắt'] };
const GLYPH = { tap: '↗', back: '←', fail: '✕', new: '＋', seen: '·', stop: '■', upd: '＋', sys: '·' };
const PEEK = 5; // số sự kiện mới nhất hiện khi nhật ký đang gập

// "-ios predicate string:type == "XCUIElementTypeButton" AND name == "Eat healthier"" → Button “Eat healthier”
const shortLoc = (s) => s
  .replace(/-ios predicate string:type == "XCUIElementType(\w+)" AND name == "(.+?)"/, '$1 “$2”')
  .replace(/^~/, '')
  .replace(/^-ios class chain:.*$/, 'phần tử (class chain)');

// Nhật ký của tool là các câu văn; tách loại sự kiện theo từ đầu câu
function classify(text) {
  let m;
  if ((m = text.match(/^Màn mới: (.+?) \((\d+) phần tử\)/))) return { k: 'new', title: m[1], n: m[2] };
  if (/^Đã có:/.test(text)) return { k: 'seen', title: text.replace(/^Đã có: /, '') };
  if (/^Không thao tác được/.test(text)) return { k: 'fail', title: 'Không thao tác được', reason: shortLoc(text.replace(/^Không thao tác được\s*/, '')) };
  if (/^Quay lại/.test(text)) return { k: 'back', title: 'Quay lại', reason: text.split(' — ').slice(1).join(' — ') };
  if (/^(\(theo kế hoạch\) )?Bấm /.test(text)) {
    const plan = /^\(theo kế hoạch\)/.test(text);
    const parts = text.replace(/^\(theo kế hoạch\)\s*/, '').replace(/^Bấm /, '').split(' — ');
    return { k: 'tap', plan, title: `Bấm ${shortLoc(parts[0])}`, reason: parts.slice(1).join(' — ') };
  }
  if (/^AI dừng/.test(text)) return { k: 'stop', title: 'AI dừng', reason: text.replace(/^AI dừng:?\s*/, '') };
  if ((m = text.match(/^(.+?): thêm (\d+) phần tử$/))) return { k: 'upd', title: m[1], reason: `thêm ${m[2]} phần tử vào màn đã có` };
  return { k: 'sys', title: text.split(' — ')[0], reason: text.split(' — ').slice(1).join(' — ') };
}

export function CaptureLive({ apps = [], lock }) {
  const { appId, captureId } = useParams();
  const app = apps.find((a) => a.id === appId);
  const [c, setC] = useState(null);
  const [err, setErr] = useState(null);
  const [stopping, setStopping] = useState(false);
  const [retry, setRetry] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [screens, setScreens] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  const stop = () => { setStopping(true); setErr(null); api.post(`/captures/${captureId}/stop`).catch((e) => { setErr(e); setStopping(false); }); };
  const logRef = useRef(null);
  useEffect(() => { api.get(`/captures/${captureId}`).then(setC).catch(setErr); }, [captureId]);
  useEvents('capture', (x) => x.id === captureId && setC(x));
  const running = c?.status === 'running';
  // Đồng hồ thời lượng chạy thật khi phiên còn đang chạy
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  // Các màn đã ghi: lấy theo danh sách màn của app, nạp lại mỗi khi phiên ghi thêm màn
  const seenKey = (c?.seen || []).join(',');
  useEffect(() => { api.get(`/apps/${appId}/screens`).then(setScreens).catch(() => {}); }, [appId, seenKey]);
  const events = useMemo(() => (c?.log || []).map((l) => ({ ...classify(l.text), at: l.at })), [c?.log]);
  const byId = useMemo(() => Object.fromEntries(screens.map((s) => [s.id, s])), [screens]);
  const found = (c?.seen || []).map((id) => byId[id]).filter(Boolean);
  const newNames = new Set(events.filter((e) => e.k === 'new').map((e) => e.title));
  const nFail = events.filter((e) => e.k === 'fail').length;
  const shown = logOpen ? events : events.slice(-PEEK);
  // Nhật ký mở rộng và phiên đang chạy: tự cuộn tới sự kiện mới nhất
  useEffect(() => { if (logOpen && running) logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [logOpen, running, events.length]);
  if (!c) return <main className="content"><ErrorNote error={err} /><div className="skel" style={{ height: 400 }} /></main>;
  const [bCls, bTxt] = BADGE[c.status] || BADGE.done;
  const title = running ? (c.mode === 'explore' ? 'AI đang khám phá app' : 'Ghi lại khi tôi bấm') : `${c.mode === 'explore' ? 'Tự khám phá' : 'Ghi lại'} · ${STATUS_TXT[c.status]}`;
  const elapsed = (c.finishedAt ? new Date(c.finishedAt).getTime() : now) - new Date(c.startedAt).getTime();
  const failed = c.status === 'error' || c.status === 'interrupted';
  const total = c.screensFound ?? found.length; // số màn phiên đã ghi lúc đó; một số có thể đã gộp / xoá khỏi map sau này
  const gone = Math.max(0, total - found.length);
  return (
    <main className="content content-wide">
      <PageHeader title={title} sub={`Bắt đầu ${fmtTime(c.startedAt)} · ${running ? 'đã chạy' : 'kéo dài'} ${fmtDur(elapsed)}`}>
        {running ? (
          <button className="btn btn-danger" type="button" onClick={stop} disabled={stopping}><Icon name="stop" />{stopping ? 'Đang dừng…' : c.mode === 'record' ? 'Dừng ghi' : 'Dừng'}</button>
        ) : (
          <>
            {failed && app && <button className="btn btn-primary" type="button" onClick={() => setRetry(true)}><Icon name="refresh" />Thử lại</button>}
            <Link className={failed ? 'btn' : 'btn btn-primary'} to={`/apps/${appId}/locators`}>Xem locator map<Icon name="arrow" /></Link>
          </>
        )}
      </PageHeader>
      <ErrorNote error={err} />
      {c.error && (
        <div className="alert alert-err" role="alert"><Icon name="warn" /><div><b>Phiên dừng vì lỗi</b>
          <div>{c.error}. Đã ghi được {total} màn trước khi dừng; bạn có thể thử lại từ đầu hoặc xem các màn đã có.</div></div></div>
      )}
      {running && c.mode === 'record' && (
        <div className="alert alert-info"><Icon name="record" /><div><b>Bấm qua app trên thiết bị (cửa sổ Simulator / emulator).</b> Mỗi màn bạn mở được ghi lại tự động. Đi hết các màn cần test rồi bấm Dừng ghi.</div></div>
      )}
      <div className="cap-live">
        <div className="cp-ph">
          <div className="phone phone-live">
            {c.current?.screenshot ? <img src={c.current.screenshot} alt="Màn hình hiện tại trên thiết bị" /> : <div className="phone-wait"><span className="dev-dot busy" />Đang mở app…</div>}
          </div>
          <span className="cap">{running ? 'Màn hiện tại' : 'Màn cuối'}: <b>{c.current?.screenName || '—'}</b></span>
        </div>
        <div className="stack-16" style={{ minWidth: 0 }}>
          <div className="cp-sum">
            <span className={`stt ${bCls}`}><i />{bTxt}</span>
            <span>Thời lượng <b>{fmtDur(elapsed)}</b></span>
            <span>{c.mode === 'explore' ? 'Bước AI' : 'Lần đọc'} <b>{c.mode === 'explore' ? c.steps || 0 : c.polls || 0}</b></span>
            <span>Màn đã ghi <b>{total}</b>{newNames.size > 0 && <span className="cap"> (+{newNames.size} mới)</span>}</span>
            {nFail > 0 && <span>Lỗi thao tác <b className="cp-bad">{nFail}</b></span>}
          </div>
          <section className="card">
            <div className="card-h"><h2>Màn đã ghi</h2><span className="cap num">{found.length}{newNames.size > 0 ? ` · ${newNames.size} mới` : ''}{gone > 0 ? ` · ${gone} màn đã gộp hoặc xoá khỏi map` : ''}</span></div>
            {found.length === 0 ? <p className="cap" style={{ padding: 16 }}>{running ? 'Chưa ghi được màn nào, đang chờ màn đầu tiên…' : 'Phiên này không ghi được màn nào.'}</p> : (
              <div className="cp-grid">
                {found.map((s) => (
                  <div key={s.id} className={newNames.has(s.name) ? 'cp-gc new' : 'cp-gc'}>
                    <img src={s.screenshot} alt="" loading="lazy" />
                    <b title={s.name}>{s.name}</b>
                    <span className="cap num">{s.count} phần tử</span>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="card cp-log">
            <button type="button" className="cp-log-h" aria-expanded={logOpen} onClick={() => setLogOpen(!logOpen)}>
              <h2>Nhật ký</h2>
              <span className="cap num">{events.length} sự kiện · đang xem {logOpen ? 'tất cả' : `${Math.min(PEEK, events.length)} mới nhất`}</span>
              {running && <span className="cap cp-live"><span className="dev-dot busy" style={{ display: 'inline-block', width: 8, height: 8 }} />Đang chạy</span>}
              <span className="linkbtn">{logOpen ? 'Thu gọn' : 'Xem toàn bộ'}</span>
            </button>
            <ol className={logOpen ? 'cp-tl open' : 'cp-tl'} ref={logRef} role="log" aria-live="polite">
              {shown.map((e, i) => (
                <li key={`${e.at}-${i}`} className={`cp-ev ${e.k}`}>
                  <span className="ic" aria-hidden="true">{GLYPH[e.k] || '·'}</span>
                  <span className="tt">{e.k === 'new' ? `Màn mới · ${e.title}` : e.k === 'seen' ? `Đã có: ${e.title}` : e.title}{e.plan && <span className="tag">theo kế hoạch</span>}</span>
                  <span className="tm">{new Date(e.at).toLocaleTimeString('vi-VN')}</span>
                  {e.k === 'new' && <span className="rs">{e.n} phần tử đã ghi</span>}
                  {e.k !== 'new' && e.reason && <span className="rs">{e.reason}</span>}
                </li>
              ))}
              {events.length === 0 && <li className="cp-ev"><span className="tt cp-muted">Chưa có sự kiện nào.</span></li>}
            </ol>
          </section>
        </div>
      </div>
      {retry && app && <StartCapture app={app} lock={lock} initialMode={c.mode} onClose={() => setRetry(false)} />}
    </main>
  );
}

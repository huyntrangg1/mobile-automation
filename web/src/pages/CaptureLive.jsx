import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useEvents } from '../useEvents.js';
import { Icon } from '../components/Icon.jsx';
import { ErrorNote, PageHeader, fmtTime } from '../components/ui.jsx';
import { STATUS_TXT } from './LocatorMap.jsx';

export function CaptureLive() {
  const { appId, captureId } = useParams();
  const [c, setC] = useState(null);
  const [err, setErr] = useState(null);
  const logRef = useRef(null);
  useEffect(() => { api.get(`/captures/${captureId}`).then(setC).catch(setErr); }, [captureId]);
  useEvents('capture', (x) => x.id === captureId && setC(x));
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [c?.log?.length]);
  if (!c) return <main className="content"><ErrorNote error={err} /><div className="skel" style={{ height: 400 }} /></main>;
  const running = c.status === 'running';
  const title = c.mode === 'explore' ? 'AI đang khám phá app' : 'Ghi lại khi tôi bấm';
  return (
    <main className="content content-wide">
      <PageHeader title={running ? title : `${c.mode === 'explore' ? 'Tự khám phá' : 'Ghi lại'} · ${STATUS_TXT[c.status]}`} sub={`Bắt đầu ${fmtTime(c.startedAt)}`}>
        {running ? (
          <button className="btn btn-danger" type="button" onClick={() => api.post(`/captures/${captureId}/stop`)}><Icon name="stop" />{c.mode === 'record' ? 'Dừng ghi' : 'Dừng'}</button>
        ) : (
          <Link className="btn btn-primary" to={`/apps/${appId}/locators`}>Xem locator map<Icon name="arrow" /></Link>
        )}
      </PageHeader>
      {c.error && <ErrorNote error={c.error} />}
      <div className="cap-live">
        <div className="phone phone-live">
          {c.current?.screenshot ? <img src={c.current.screenshot} alt="Màn hình hiện tại trên thiết bị" /> : <div className="phone-wait"><span className="dev-dot busy" />Đang mở app…</div>}
        </div>
        <div className="stack-16" style={{ minWidth: 0 }}>
          {running && c.mode === 'record' && (
            <div className="alert alert-info"><Icon name="record" /><div><b>Bấm qua app trên thiết bị (cửa sổ Simulator / emulator).</b> Mỗi màn bạn mở được ghi lại tự động. Đi hết các màn cần test rồi bấm Dừng ghi.</div></div>
          )}
          <div className="kpis kpis-3">
            <div className="card kpi"><span className="overline">Màn đã ghi</span><span className="kpi-v">{c.screensFound}</span></div>
            <div className="card kpi"><span className="overline">Màn hiện tại</span><span className="kpi-v kpi-sm">{c.current?.screenName || '—'}</span></div>
            <div className="card kpi"><span className="overline">{c.mode === 'explore' ? 'Bước AI' : 'Lần đọc'}</span><span className="kpi-v">{c.mode === 'explore' ? c.steps || 0 : c.polls || 0}</span></div>
          </div>
          <section className="card">
            <div className="card-h"><h2>Nhật ký</h2>{running && <span className="cap"><span className="dev-dot busy" style={{ display: 'inline-block', marginRight: 6, width: 8, height: 8 }} />Đang chạy</span>}</div>
            <div className="code log" ref={logRef} role="log" aria-live="polite">
              {c.log.map((l, i) => <div key={i}><span className="muted">{new Date(l.at).toLocaleTimeString('vi-VN')}</span> {l.text}</div>)}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useEvents } from '../useEvents.js';
import { Icon } from '../components/Icon.jsx';
import { ErrorNote, ExecBadge, PageHeader, fmtDur, fmtTime } from '../components/ui.jsx';
import { StepList } from '../components/StepList.jsx';

const ORDER = ['running', 'failed', 'blocked', 'notrun', 'skipped', 'queued', 'passed'];
const COL = { passed: 'var(--pass)', failed: 'var(--fail)', blocked: 'var(--blocked)', skipped: 'var(--skipped)', notrun: 'var(--skipped)', running: 'var(--ink)' };
const RUN_STATE = { running: ['badge b-running', '● Running'], done: ['badge b-queued', 'Completed'], stopped: ['badge b-skip', 'Stopped'], error: ['badge b-fail', 'Lỗi'], interrupted: ['badge b-skip', 'Interrupted'] };

export function RunView({ lock }) {
  const { runId } = useParams();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('res');
  const [open, setOpen] = useState(null);
  const [pick, setPick] = useState({}); // TC ID tester tick để chạy lại
  const logRef = useRef(null);
  useEffect(() => { api.get(`/runs/${runId}`).then(setR).catch(setErr); }, [runId]);
  useEvents('run', (x) => x.id === runId && setR((old) => ({ ...old, ...x })));
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [r?.log?.length, tab]);
  if (!r) return <main className="content"><ErrorNote error={err} /><div className="skel" style={{ height: 300 }} /></main>;
  const running = r.status === 'running';
  const total = r.order.length;
  const done = r.order.filter((id) => !['queued', 'running'].includes(r.results[id]?.status)).length;
  const c = r.counts;
  const rate = c.passed + c.failed ? Math.round((c.passed / (c.passed + c.failed)) * 100) : null;
  const [cls, label] = running && r.paused ? ['badge b-blocked', '⏸ Đã tạm dừng'] : RUN_STATE[r.status] || RUN_STATE.done;
  const act = (what) => api.post(`/runs/${runId}/${what}`).catch(setErr);
  const badN = r.order.filter((id) => ['failed', 'blocked', 'notrun', 'interrupted'].includes(r.results[id]?.status)).length;
  const picked = r.order.filter((id) => pick[id]);
  const isBad = (id) => ['failed', 'blocked', 'notrun', 'interrupted'].includes(r.results[id]?.status);
  const rerun = async (onlyFailed, tcIds) => {
    setBusy(true); setErr(null);
    try { const x = await api.post(`/runs/${runId}/rerun`, { onlyFailed, tcIds }); setPick({}); nav(`/runs/${x.id}`); } catch (e) { setErr(e); }
    setBusy(false);
  };
  const curId = r.current || r.order.find((id) => r.results[id]?.status === 'running');
  const rows = [...r.order].sort((a, b) => ORDER.indexOf(r.results[a].status) - ORDER.indexOf(r.results[b].status) || r.order.indexOf(a) - r.order.indexOf(b));
  const bar = ['passed', 'failed', 'blocked', 'skipped', 'notrun'].filter((k) => c[k]).map((k) => ({ k, w: `${(c[k] / total) * 100}%` }));
  return (
    <main className="content" style={{ maxWidth: 1180 }}>
      <div className="crumb-line cap"><Link to="/runs">Test Runs</Link> / <span className="mono">{r.id}</span></div>
      <PageHeader title={<span className="ttl">{r.id} <span className={cls}>{label}</span></span>} sub={`${r.appName} · ${r.files.map((f) => `${f}.xlsx`).join(', ')} · ${r.deviceName} · ${fmtTime(r.startedAt)}${r.finishedAt ? ` · ${fmtDur(new Date(r.finishedAt) - new Date(r.startedAt))}` : ''}`}>
        {running && !r.pauseRequested && <button className="btn" type="button" onClick={() => act('pause')} title="Dừng trước case kế tiếp — case đang chạy vẫn chạy xong"><Icon name="pause" />Tạm dừng</button>}
        {running && r.pauseRequested && !r.paused && <span className="cap pause-wait"><span className="dev-dot busy" />Chờ case hiện tại xong rồi tạm dừng…</span>}
        {running && r.pauseRequested && <button className={r.paused ? 'btn btn-primary' : 'btn'} type="button" onClick={() => act('resume')}><Icon name="play" />{r.paused ? 'Tiếp tục' : 'Huỷ tạm dừng'}</button>}
        {running && <button className="btn btn-danger" type="button" onClick={() => window.confirm(`Dừng hẳn ${r.id}? Case chưa chạy sẽ thành Not Run.`) && act('stop')}><Icon name="stop" />Stop</button>}
        {!running && badN > 0 && <button className="btn" type="button" disabled={busy || !!lock} title={lock ? `Thiết bị đang bận: ${lock.label}` : ''} onClick={() => rerun(true)}><Icon name="refresh" />Run lại case lỗi ({badN})</button>}
        {!running && <button className="btn" type="button" disabled={busy || !!lock} title={lock ? `Thiết bị đang bận: ${lock.label}` : ''} onClick={() => rerun(false)}><Icon name="play" />Run lại</button>}
        {r.reportUrl && <a className="btn btn-primary" href={r.reportUrl} target="_blank" rel="noreferrer"><Icon name="ext" />Mở report</a>}
      </PageHeader>
      {r.error && <ErrorNote error={r.error} />}
      {running && r.paused && <div className="alert alert-warn" role="status"><Icon name="pause" /><div><b>Đang tạm dừng</b> trước case kế tiếp. App và phiên Appium vẫn giữ nguyên — bấm <b>Tiếp tục</b> để chạy tiếp, hoặc <b>Stop</b> để dừng hẳn.</div></div>}
      {err && r && <ErrorNote error={err} />}
      <section className="card card-b run-sum">
        <div className="run-stats">
          {['passed', 'failed', 'blocked', 'notrun', 'skipped'].filter((k) => c[k] || ['passed', 'failed'].includes(k)).map((k) => (
            <div className="stat" key={k}><ExecBadge status={k} /><b>{c[k]}</b></div>
          ))}
          <div className="stat"><span className="overline">Pass rate</span><b>{rate == null ? '—' : `${rate}%`}</b><span className="cap">Passed ÷ (Passed + Failed)</span></div>
        </div>
        <div className="meter run-meter" role="img" aria-label={`Tiến độ ${done}/${total}`}>{bar.map((b) => <i key={b.k} style={{ width: b.w, background: COL[b.k] }} />)}{running && <i className="m-run" style={{ width: `${100 / total}%` }} />}</div>
        <span className="cap">{done}/{total} case xong{r.added?.length ? ` · ${r.added.length} case được thêm vào chuỗi` : ''}</span>
      </section>
      <div className="tabs" role="tablist">
        <button className={tab === 'res' ? 'tab on' : 'tab'} type="button" role="tab" aria-selected={tab === 'res'} onClick={() => setTab('res')}>Kết quả <span className="count">{total}</span></button>
        <button className={tab === 'log' ? 'tab on' : 'tab'} type="button" role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')}>Log {running && <span className="dev-dot busy" style={{ width: 8, height: 8 }} />}</button>
        {r.reportUrl && <button className={tab === 'rep' ? 'tab on' : 'tab'} type="button" role="tab" aria-selected={tab === 'rep'} onClick={() => setTab('rep')}>Report</button>}
      </div>
      {tab === 'res' && (
        <div>
        {!running && (
          <div className="pick-bar">
            <button className="btn btn-sm" type="button" disabled={!badN} onClick={() => setPick(Object.fromEntries(r.order.filter(isBad).map((id) => [id, true])))}>Chọn case lỗi ({badN})</button>
            {picked.length > 0 && <button className="btn btn-sm btn-ghost" type="button" onClick={() => setPick({})}>Bỏ chọn</button>}
            <span className="cap">{picked.length ? `${picked.length} case đã chọn` : 'Tick case trong bảng để chạy lại riêng'}</span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-sm btn-primary" type="button" disabled={!picked.length || busy || !!lock} title={lock ? `Thiết bị đang bận: ${lock.label}` : ''} onClick={() => rerun(false, picked)}><Icon name="play" />Run lại đã chọn{picked.length ? ` (${picked.length})` : ''}</button>
          </div>
        )}
        <section className="card" style={{ overflow: 'hidden' }}>
          <table className="dt">
            <thead><tr>{!running && <th style={{ width: 40 }}><input className="cb" type="checkbox" aria-label="Chọn tất cả case" checked={picked.length === r.order.length} onChange={(e) => setPick(e.target.checked ? Object.fromEntries(r.order.map((id) => [id, true])) : {})} /></th>}<th>ID</th><th>Test case</th><th>Kết quả</th><th className="r">Bug</th><th className="r">Thời gian</th></tr></thead>
            <tbody>{rows.map((id) => {
              const x = r.results[id];
              const isOpen = open === id;
              return [
                <tr key={id} className={`${x.rows?.length || x.error ? 'clickable' : ''}${pick[id] ? ' sel' : ''}`} onClick={() => (x.rows?.length || x.error) && setOpen(isOpen ? null : id)} aria-expanded={isOpen}>
                  {!running && <td onClick={(e) => e.stopPropagation()}><input className="cb" type="checkbox" aria-label={`Chọn ${id} để chạy lại`} checked={!!pick[id]} onChange={(e) => setPick({ ...pick, [id]: e.target.checked })} /></td>}
                  <td className="mono">{id}</td>
                  <td className="wrap">{x.title}{r.added?.includes(id) && <span className="cap"> · thêm vào chuỗi</span>}
                    {x.error && <span className="name-sub err-line">{x.error.split('\n')[0]}</span>}
                    {!isOpen && x.rows?.length > 0 && !running && <span className="name-sub">Bấm để xem từng bước</span>}</td>
                  <td><ExecBadge status={x.status} />{x.blockKind === 'env' && <span className="cap"> môi trường</span>}</td>
                  <td className="r mono">{x.bugs || '—'}</td>
                  <td className="r mono">{fmtDur(x.duration)}</td>
                </tr>,
                isOpen && <tr key={`${id}-e`}><td colSpan={running ? 5 : 6} className="run-detail-cell">
                  {x.rows?.length > 0 && <StepList rows={x.rows} live={x.live || []} running={x.status === 'running'} failed={['failed', 'blocked'].includes(x.status)} error={x.error} />}
                  {x.error && <pre className="code err-pre">{x.error}</pre>}</td></tr>,
              ];
            })}</tbody>
          </table>
        </section>
        {running && (
          <div className="run-live">
          <section className="card run-steps" aria-label="Bước đang chạy">
            <div className="card-h"><div style={{ minWidth: 0 }}><h2>Bước đang chạy</h2>
              <span className="cap trunc-2">{curId ? <><span className="mono">{curId}</span> · {r.results[curId]?.title}</> : r.paused ? 'Đã tạm dừng — chưa chạy case kế tiếp' : 'Đang chuẩn bị case…'}</span></div>
              {curId && <ExecBadge status="running" />}</div>
            {curId ? <StepList rows={r.results[curId]?.rows || []} live={r.results[curId]?.live || []} running /> : <div className="empty" style={{ padding: 24 }}>{r.paused ? 'Bấm Tiếp tục để chạy case kế tiếp.' : 'Đang khởi động Appium và mở app…'}</div>}
          </section>
          <section className="card run-sim" aria-label="Màn hình thiết bị">
            <div className="card-h"><h2>Thiết bị</h2><span className="cap"><span className="dev-dot busy" style={{ display: 'inline-block', width: 8, height: 8, marginRight: 6 }} />trực tiếp · {r.deviceName}</span></div>
            <div className="sim-wrap">
              <div className="phone sim-phone">
                {r.liveShot ? <img src={r.liveShot} alt="Màn hình thiết bị đang chạy test" /> : <div className="phone-wait"><span className="dev-dot busy" />Đang mở thiết bị…</div>}
              </div>
              <button className="linkbtn" type="button" onClick={() => setTab('log')}>Xem log</button>
            </div>
          </section>
          </div>
        )}
        </div>
      )}
      {tab === 'log' && <section className="card"><div className="code log log-tall" ref={logRef} role="log">{(r.log || []).map((l, i) => <div key={i}>{l}</div>)}{!r.log?.length && <span className="muted">Chưa có log.</span>}</div></section>}
      {tab === 'rep' && r.reportUrl && <section className="card report-frame"><iframe title={`Report ${r.id}`} src={r.reportUrl} /></section>}
    </main>
  );
}

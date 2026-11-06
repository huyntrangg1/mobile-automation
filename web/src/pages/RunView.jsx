import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useEvents } from '../useEvents.js';
import { Icon } from '../components/Icon.jsx';
import { PopMenu } from '../components/PopMenu.jsx';
import { ErrorNote, ExecBadge, PageHeader, fmtDur, fmtTime } from '../components/ui.jsx';
import { StepList } from '../components/StepList.jsx';
import { HelpDialog } from '../components/HelpDialog.jsx';
import { loadManualFix, saveManualFix } from '../manualFix.js';

const ORDER = ['running', 'failed', 'blocked', 'notrun', 'skipped', 'queued', 'passed'];
const COL = { passed: 'var(--pass)', failed: 'var(--fail)', blocked: 'var(--blocked)', skipped: 'var(--skipped)', notrun: 'var(--skipped)', running: 'var(--ink)' };
const RUN_STATE = { running: ['stt-run', 'Đang chạy'], done: ['stt-done', 'Xong'], stopped: ['stt-stop', 'Đã dừng'], error: ['stt-err', 'Lỗi'], interrupted: ['stt-err', 'Bị ngắt'] };
const GLYPH = { passed: ['✓', 'ok'], failed: ['✕', 'err'], blocked: ['⊘', 'warn'], skipped: ['–', 'dim'], notrun: ['○', 'dim'], running: ['●', 'run'], queued: ['…', 'dim'], interrupted: ['✕', 'err'] };
const isBad = (s) => ['failed', 'blocked', 'notrun', 'interrupted'].includes(s);
const FILTERS = [
  ['attn', 'Cần xem', (s) => ['failed', 'blocked', 'interrupted'].includes(s)],
  ['notrun', 'Chưa chạy', (s) => s === 'notrun'],
  ['passed', 'Passed', (s) => s === 'passed'],
  ['skipped', 'Skipped', (s) => s === 'skipped'],
  ['all', 'Tất cả', () => true],
];

export function RunView({ lock, setCurrentApp }) {
  const { runId } = useParams();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('res');
  const [selId, setSelId] = useState(null); // case đang xem ở cột phải; null = tự theo case đang chạy / case đầu danh sách
  const [filter, setFilter] = useState(null); // null = lọc mặc định theo kết quả run
  const [q, setQ] = useState('');
  const [pick, setPick] = useState({}); // TC ID tester tick để chạy lại
  const [manualFix, setManualFix] = useState(loadManualFix); // Run lại có bật sửa tay khi lỗi không
  const logRef = useRef(null);
  useEffect(() => { api.get(`/runs/${runId}`).then(setR).catch(setErr); }, [runId]);
  // Sidebar theo app của run đang xem
  useEffect(() => { if (r?.appId) setCurrentApp?.(r.appId); }, [r?.appId, setCurrentApp]);
  useEvents('run', (x) => x.id === runId && setR((old) => ({ ...old, ...x })));
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [r?.log?.length, tab]);

  const results = r?.results || {};
  const order = r?.order || [];
  const running = r?.status === 'running';
  const stat = (id) => results[id]?.status;
  const countsBy = useMemo(() => Object.fromEntries(FILTERS.map(([k, , f]) => [k, order.filter((id) => f(stat(id))).length])), [r]);
  const defFilter = running ? 'all' : countsBy.attn > 0 ? 'attn' : countsBy.notrun > 0 ? 'notrun' : 'all';
  const f = filter && countsBy[filter] > 0 ? filter : defFilter;
  const list = useMemo(() => {
    const fn = FILTERS.find((x) => x[0] === f)[2];
    const t = q.trim().toLowerCase();
    return order.filter((id) => fn(stat(id)) && (!t || `${id} ${results[id]?.title || ''}`.toLowerCase().includes(t)))
      .sort((a, b) => ORDER.indexOf(stat(a)) - ORDER.indexOf(stat(b)) || order.indexOf(a) - order.indexOf(b));
  }, [r, f, q]);
  const curId = r?.current || order.find((id) => stat(id) === 'running');
  const sel = selId && list.includes(selId) ? selId : running && curId && list.includes(curId) ? curId : list[0];
  const idx = list.indexOf(sel);

  if (!r) return (
    <main className="content">
      <div className="crumb-line cap"><Link to="/runs">Test Runs</Link> / <span className="mono">{runId}</span></div>
      <ErrorNote error={err} />
      {err ? <Link className="btn" to="/runs">Về danh sách run</Link> : <div className="skel" style={{ height: 300 }} />}
    </main>
  );
  const total = order.length;
  const done = order.filter((id) => !['queued', 'running'].includes(stat(id))).length;
  const c = r.counts;
  const rate = c.passed + c.failed ? Math.round((c.passed / (c.passed + c.failed)) * 100) : null;
  const [cls, label] = running && r.help ? ['stt-pause', 'Đang chờ tester sửa'] : running && r.paused ? ['stt-pause', 'Đã tạm dừng'] : RUN_STATE[r.status] || RUN_STATE.done;
  const act = (what) => api.post(`/runs/${runId}/${what}`).catch(setErr);
  const badN = order.filter((id) => isBad(stat(id))).length;
  const onlyNotRun = badN > 0 && order.filter((id) => isBad(stat(id))).every((id) => stat(id) === 'notrun');
  const picked = order.filter((id) => pick[id]);
  const rerun = async (onlyFailed, tcIds) => {
    setBusy(true); setErr(null);
    try { const x = await api.post(`/runs/${runId}/rerun`, { onlyFailed, tcIds, manualFix }); setPick({}); nav(`/runs/${x.id}`); } catch (e) { setErr(e); }
    setBusy(false);
  };
  const remove = async () => {
    if (!window.confirm(`Xoá ${r.id}? Kết quả, log, ảnh và report sẽ bị xoá hẳn.`)) return;
    try { await api.post('/runs/delete', { ids: [r.id] }); nav('/runs'); } catch (e) { setErr(e); }
  };
  const bar = ['passed', 'failed', 'blocked', 'skipped', 'notrun'].filter((k) => c[k]).map((k) => ({ k, w: `${(c[k] / total) * 100}%` }));
  const x = sel ? results[sel] : null;
  const lockTitle = lock ? `Thiết bị đang bận: ${lock.label}` : '';
  const duration = r.finishedAt ? fmtDur(new Date(r.finishedAt) - new Date(r.startedAt)) : null;
  const shownAllPicked = list.length > 0 && list.every((id) => pick[id]);
  return (
    <main className="content content-wide">
      <div className="crumb-line cap"><Link to="/runs">Test Runs</Link> / <span className="mono">{r.id}</span></div>
      <PageHeader title={<span className="ttl">{r.id} <span className={`stt ${cls}`}><i />{label}</span></span>} sub={`${r.appName} · ${r.files.map((f2) => `${f2}.xlsx`).join(', ')} · ${r.deviceName} · ${fmtTime(r.startedAt)}${duration ? ` · ${duration}` : ''}`}>
        <div className="rv-acts">
        {running && !r.pauseRequested && <button className="btn" type="button" onClick={() => act('pause')} title="Dừng trước case kế tiếp — case đang chạy vẫn chạy xong"><Icon name="pause" />Tạm dừng</button>}
        {running && r.pauseRequested && !r.paused && <span className="cap pause-wait"><span className="dev-dot busy" />Chờ case hiện tại xong rồi tạm dừng…</span>}
        {running && r.pauseRequested && <button className={r.paused ? 'btn btn-primary' : 'btn'} type="button" onClick={() => act('resume')}><Icon name="play" />{r.paused ? 'Tiếp tục' : 'Huỷ tạm dừng'}</button>}
        {running && <button className="btn btn-danger" type="button" onClick={() => window.confirm(`Dừng hẳn ${r.id}? Case chưa chạy sẽ thành Not Run.`) && act('stop')}><Icon name="stop" />Stop</button>}
        {!running && (
          <>
            <label className="cap" style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="Step không làm được thì dừng lại cho bạn chọn Block / Skip / Retry / Use element / Fix script"><input className="cb" type="checkbox" checked={manualFix} onChange={(e) => { setManualFix(e.target.checked); saveManualFix(e.target.checked); }} />Sửa tay khi lỗi</label>
            {badN > 0
              ? <button className="btn btn-primary" type="button" disabled={busy || !!lock} title={lock ? lockTitle : 'Chạy lại các case lỗi, bị chặn hoặc chưa chạy'} onClick={() => rerun(true)}><Icon name="refresh" />{onlyNotRun ? `Run lại case chưa chạy (${badN})` : `Run lại case chưa đạt (${badN})`}</button>
              : <button className="btn btn-primary" type="button" disabled={busy || !!lock} title={lockTitle} onClick={() => rerun(false)}><Icon name="play" />Run lại</button>}
            <PopMenu label="Thao tác khác với run" small={false}>
              {(close) => (
                <>
                  {badN > 0 && <button type="button" role="menuitem" disabled={busy || !!lock} onClick={() => { close(); rerun(false); }}><Icon name="play" />Run lại tất cả ({total} case)</button>}
                  {badN > 0 && <hr />}
                  <button type="button" role="menuitem" className="danger" onClick={() => { close(); remove(); }}><Icon name="trash" />Xoá run…</button>
                </>
              )}
            </PopMenu>
          </>
        )}
        </div>
      </PageHeader>
      {r.error && <ErrorNote error={r.error} />}
      {running && r.paused && <div className="alert alert-warn" role="status"><Icon name="pause" /><div><b>Đang tạm dừng</b> trước case kế tiếp. App và phiên Appium vẫn giữ nguyên — bấm <b>Tiếp tục</b> để chạy tiếp, hoặc <b>Stop</b> để dừng hẳn.</div></div>}
      {err && r && <ErrorNote error={err} />}
      {running && r.help && (
        <HelpDialog key={r.help.id} help={r.help}
          onAnswer={(action, el, extra = {}) => api.post(`/runs/${runId}/answer`, { helpId: r.help.id, action, locator: el?.locator, element: el ? el.name || el.label || el.type : undefined, ...extra })} />
      )}
      <section className="card card-b run-sum">
        <div className="run-stats">
          {['passed', 'failed', 'blocked', 'notrun', 'skipped'].filter((k) => c[k] || ['passed', 'failed'].includes(k)).map((k) => (
            <div className="stat" key={k}><ExecBadge status={k} /><b>{c[k]}</b></div>
          ))}
          <div className="stat"><span className="overline">Pass rate</span><b>{rate == null ? '—' : `${rate}%`}</b><span className="cap">{rate == null ? 'Chưa có case Passed / Failed' : `${c.passed}/${c.passed + c.failed} case có kết quả${c.blocked ? `, chưa tính ${c.blocked} blocked` : ''}`}</span></div>
        </div>
        <div className="meter run-meter" role="img" aria-label={`Tiến độ ${done}/${total}`}>{bar.map((b) => <i key={b.k} style={{ width: b.w, background: COL[b.k] }} />)}{running && <i className="m-run" style={{ width: `${100 / total}%` }} />}</div>
        <span className="cap">
          {running ? `${done}/${total} case xong` : c.notrun > 0 ? `Run ${RUN_STATE[r.status]?.[1]?.toLowerCase() || 'kết thúc'}${duration ? ` sau ${duration}` : ''}: ${c.notrun} case chưa chạy` : `${total} case`}
          {r.added?.length ? ` · ${r.added.length} case được thêm vào chuỗi` : ''}
        </span>
      </section>
      <div className="tabs" role="tablist">
        <button className={tab === 'res' ? 'tab on' : 'tab'} type="button" role="tab" aria-selected={tab === 'res'} onClick={() => setTab('res')}>Kết quả <span className="count">{total}</span></button>
        <button className={tab === 'log' ? 'tab on' : 'tab'} type="button" role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')}>Log {running && <span className="dev-dot busy" style={{ width: 8, height: 8 }} />}</button>
        {r.reportUrl && <button className={tab === 'rep' ? 'tab on' : 'tab'} type="button" role="tab" aria-selected={tab === 'rep'} onClick={() => setTab('rep')}>Report</button>}
      </div>
      {tab === 'res' && (
        <div className="rv">
          <nav className="card rv-list" aria-label="Case trong run">
            <div className="rv-tools">
              <div className="search"><Icon name="search" /><input className="inp" type="search" placeholder="Tìm case…" aria-label="Tìm case" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <div className="chips" role="group" aria-label="Lọc case">
                {FILTERS.map(([k, l]) => (countsBy[k] > 0 || k === 'all') && <button key={k} type="button" className={`chip${f === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{l}<span className="count">{countsBy[k]}</span></button>)}
              </div>
              {!running && list.length > 0 && (
                <label className="rv-all cap"><input className="cb" type="checkbox" checked={shownAllPicked} onChange={(e) => setPick(e.target.checked ? { ...pick, ...Object.fromEntries(list.map((id) => [id, true])) } : Object.fromEntries(Object.entries(pick).filter(([id]) => !list.includes(id))))} />Chọn {list.length} case đang hiện để chạy lại</label>
              )}
            </div>
            <div className="rv-scroll">
              {list.map((id) => {
                const s = stat(id);
                const [g, gc] = GLYPH[s] || ['·', 'dim'];
                return (
                  <div key={id} className={`rv-row${pick[id] ? ' sel' : ''}`}>
                    {!running && <input className="cb" type="checkbox" aria-label={`Chọn ${id} để chạy lại`} checked={!!pick[id]} onChange={(e) => setPick({ ...pick, [id]: e.target.checked })} />}
                    <button type="button" className="rv-item" aria-current={id === sel ? 'true' : undefined} onClick={() => setSelId(id)}>
                      <span className={`rv-mk ${gc}`} aria-label={s}>{g}</span>
                      <span className="rv-id">{id}</span>
                      <span className="rv-d">{results[id].duration != null ? fmtDur(results[id].duration) : ''}</span>
                      <span className="rv-tt" title={results[id].title}>{results[id].title}</span>
                    </button>
                  </div>
                );
              })}
              {list.length === 0 && <p className="cap" style={{ padding: 16, textAlign: 'center' }}>Không có case khớp.</p>}
            </div>
            {picked.length > 0 && (
              <div className="rv-foot">
                <span className="cap">{picked.length} case đã chọn</span>
                <span style={{ flex: 1 }} />
                <button className="btn btn-sm btn-ghost" type="button" onClick={() => setPick({})}>Bỏ chọn</button>
                <button className="btn btn-sm btn-primary" type="button" disabled={busy || !!lock} title={lockTitle} onClick={() => rerun(false, picked)}><Icon name="play" />Run lại ({picked.length})</button>
              </div>
            )}
          </nav>
          <section className="card rv-detail" aria-label="Chi tiết case">
            {!x ? <p className="cap" style={{ padding: 24 }}>Không có case nào để hiện.</p> : (
              <>
                <div className="rv-dh">
                  <div className="rv-dh1">
                    <span className="mono rv-did">{sel}</span>
                    <ExecBadge status={x.status} />{x.blockKind === 'env' && <span className="cap">môi trường</span>}
                    {x.duration != null && <span className="cap">{fmtDur(x.duration)}</span>}
                    {x.bugs > 0 && <span className="cap">{x.bugs} bug</span>}
                    {r.added?.includes(sel) && <span className="cap">thêm vào chuỗi</span>}
                    <span style={{ flex: 1 }} />
                    <span className="cap mono num">{idx + 1}/{list.length}</span>
                    <button className="btn btn-icon btn-sm" type="button" aria-label="Case trước" disabled={idx <= 0} onClick={() => setSelId(list[idx - 1])}><Icon name="arrow" className="flip" /></button>
                    <button className="btn btn-icon btn-sm" type="button" aria-label="Case sau" disabled={idx >= list.length - 1} onClick={() => setSelId(list[idx + 1])}><Icon name="arrow" /></button>
                  </div>
                  <h2 className="rv-dt">{x.title}</h2>
                </div>
                {x.status === 'notrun' && !running && <p className="cap rv-note">Case này chưa chạy{r.status === 'stopped' ? ' — run đã dừng trước khi tới đây' : ''}.</p>}
                {x.error && <pre className="code err-pre rv-err">{x.error}</pre>}
                {running && sel === curId ? (
                  <div className="rv-live">
                    <div className="rv-live-steps">
                      <div className="rv-lh"><b>Bước đang chạy</b><ExecBadge status="running" /></div>
                      <StepList key={sel} rows={x.rows || []} live={x.live || []} running />
                    </div>
                    <div className="rv-live-dev">
                      <div className="rv-lh"><b>Thiết bị</b><span className="cap trunc"><span className="dev-dot busy" style={{ display: 'inline-block', width: 8, height: 8, marginRight: 6 }} />trực tiếp</span></div>
                      <div className="phone sim-phone">
                        {r.liveShot ? <img src={r.liveShot} alt="Màn hình thiết bị đang chạy test" /> : <div className="phone-wait"><span className="dev-dot busy" />Đang mở thiết bị…</div>}
                      </div>
                      <button className="linkbtn" type="button" onClick={() => setTab('log')}>Xem log</button>
                    </div>
                  </div>
                ) : x.rows?.length > 0 ? (
                  <StepList key={sel} rows={x.rows} live={x.live || []} running={x.status === 'running'} failed={['failed', 'blocked'].includes(x.status)} error={x.error} collapseDone />
                ) : <p className="cap rv-note">Case này không có bước nào để hiện.</p>}
              </>
            )}
          </section>
        </div>
      )}
      {tab === 'log' && <section className="card"><div className="code log log-tall" ref={logRef} role="log">{(r.log || []).map((l, i) => <div key={i}>{l}</div>)}{!r.log?.length && <span className="muted">Chưa có log.</span>}</div></section>}
      {tab === 'rep' && r.reportUrl && (
        <>
          <div className="rv-rep"><span className="cap">Report nhúng trong trang.</span><a className="btn btn-sm" href={r.reportUrl} target="_blank" rel="noreferrer"><Icon name="ext" />Mở trong tab mới</a></div>
          <section className="card report-frame"><iframe title={`Report ${r.id}`} src={r.reportUrl} /></section>
        </>
      )}
    </main>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useEvents } from '../useEvents.js';
import { Icon } from '../components/Icon.jsx';
import { ErrorNote, PageHeader, fmtTime } from '../components/ui.jsx';
import { RUN_STATUS } from './SmokeTest.jsx';

const FLOW = {
  pending: ['badge b-notrun', 'Chờ'], running: ['badge b-running', '● Đang chạy'], ok: ['badge b-pass', '✓ Khớp'], deviation: ['badge b-fail', '✕ Có lệch'],
  unreachable: ['badge b-blocked', '⊘ Không tới được'], unverifiable: ['badge b-skip', '◔ Không kiểm được'],
};
const KIND = { prd: ['badge b-fail', 'Lệch PRD'], figma: ['badge b-fail', 'Lệch Figma'], conflict: ['badge b-blocked', 'PRD và Figma mâu thuẫn'], unclear: ['badge b-skip', 'PRD chưa rõ'], robust: ['badge b-blocked', 'Độ bền'] };

const MARK = { pending: ['dim', '·'], running: ['run', '●'], ok: ['ok', '✓'], deviation: ['err', '✕'], unreachable: ['warn', '⊘'], unverifiable: ['dim', '◔'] };
const FILTERS = [
  ['all', 'Tất cả', () => true],
  ['dev', 'Có lệch', (f) => f.status === 'deviation'],
  ['ok', 'Khớp', (f) => f.status === 'ok'],
  ['open', 'Chưa kết luận', (f) => f.status === 'unreachable' || f.status === 'unverifiable'],
];
const REAL = ['prd', 'figma', 'conflict', 'robust']; // loại điểm lệch là lỗi thật; 'unclear' = PRD chưa rõ, AI không kết luận được

function Shot({ label, src, alt }) {
  if (!src) return null;
  return (
    <figure className="sx-shot">
      <figcaption className="overline">{label}</figcaption>
      <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={alt} loading="lazy" /></a>
    </figure>
  );
}

const num = (n) => Number(n || 0).toLocaleString('vi-VN');
const usageLine = (u) => (u && u.calls ? `${num(u.calls)} lần gọi AI · ${num(u.input + u.cacheCreate + u.cacheRead)} token vào (${num(u.cacheRead)} đọc từ cache) · ${num(u.output)} token ra · ≈ ${Number(u.costUsd || 0).toFixed(2)} USD` : '');

export function SmokeRunView({ setCurrentApp }) {
  const { id } = useParams();
  const [run, setRun] = useState(null);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState('all');
  const [selId, setSelId] = useState(null);
  const load = useCallback(() => api.get(`/smoke/${id}`).then((r) => { setRun(r); setCurrentApp?.(r.appId); }).catch(setErr), [id]);
  useEffect(() => { load(); }, [load]);
  useEvents('smoke', (r) => r.id === id && setRun((old) => ({ ...old, ...r, live: r.status === 'running' })));
  const flows = run?.flows || [];
  const findings = run?.findings || [];
  const byFlow = useMemo(() => {
    const m = {};
    for (const x of findings) (m[x.flowId] ||= []).push(x);
    return m;
  }, [run]);
  if (!run) return <main className="content"><ErrorNote error={err} /><div className="skel" style={{ height: 240 }} /></main>;
  const active = run.status === 'running' && run.live !== false;
  const count = (...s) => flows.filter((f) => s.includes(f.status)).length;
  const nReal = findings.filter((x) => REAL.includes(x.kind)).length;
  const nUnclear = findings.filter((x) => x.kind === 'unclear').length;
  const [sc, sl] = active ? RUN_STATUS.running : (RUN_STATUS[run.status] || RUN_STATUS.done);
  const cur = run.current != null ? flows[run.current] : null;
  const shown = flows.filter((f) => FILTERS.find((x) => x[0] === filter)[2](f));
  // Mặc định mở luồng có lỗi thật đầu tiên, rồi luồng có điểm lệch bất kỳ, rồi luồng đầu
  const first = flows.find((f) => (byFlow[f.id] || []).some((x) => REAL.includes(x.kind))) || flows.find((f) => byFlow[f.id]?.length) || flows[0];
  const sel = flows.find((f) => f.id === selId) || first;
  const selFindings = sel ? byFlow[sel.id] || [] : [];
  const kpis = [['Lệch PRD / Figma', nReal, 'fail', 'lỗi thật, cần xem'], ['PRD chưa rõ', nUnclear, 'blocked', 'AI không kết luận được'], ['Đi hết luồng', count('ok', 'deviation'), 'pass', `trên ${flows.length} luồng`], ['Chưa kết luận được', count('unreachable', 'unverifiable'), '', 'không tới được màn']];
  const u = run.usage;
  const cost = u && u.calls ? `Chi phí AI ≈ ${Number(u.costUsd || 0).toFixed(2)} USD (${num(u.calls)} lần gọi)` : '';
  return (
    <main className="content content-wide">
      <div className="crumb"><Link to={`/apps/${run.appId}/smoke`}>AI Smoke Test</Link> / <span className="mono">{run.id}</span></div>
      <PageHeader title={<>{run.id} <span className={sc}>{sl}</span></>} sub={[run.appName, fmtTime(run.startedAt), cost].filter(Boolean).join(' · ')}>
        {active && <button className="btn" type="button" onClick={() => api.post(`/smoke/${id}/stop`, {}).catch(setErr)}><Icon name="stop" />Dừng</button>}
        <a className="btn" href={`/api/smoke/${id}/report`} target="_blank" rel="noreferrer"><Icon name="ext" />Mở report ngắn</a>
      </PageHeader>
      {usageLine(u) && <details className="cap sx-use"><summary>Chi tiết chi phí AI</summary>{usageLine(u)}</details>}
      <ErrorNote error={err || (run.error && { message: run.error })} />
      <section className="kpis">
        {kpis.map(([l, v, k, h]) => (
          <div key={l} className="card kpi"><span className="overline">{l}</span><span className="kpi-v" style={k && v > 0 ? { color: `var(--${k}-ink)` } : undefined}>{v}</span><span className="cap">{h}</span></div>
        ))}
      </section>
      {active && (
        <section className="card card-b sx-live">
          {run.liveShot && <img src={run.liveShot} alt="Màn app lúc này" />}
          <div>
            <span className="overline">{cur ? `Đang làm · luồng ${run.current + 1}/${flows.length}` : 'Đang chuẩn bị (đọc PRD + Figma)'}</span>
            {cur && <b>{cur.name}</b>}
            <span className="cap">{(run.log || []).slice(-1)[0] || '…'}</span>
          </div>
        </section>
      )}
      {flows.length > 0 && (
        <div className="rv">
          <nav className="card rv-list" aria-label="Các luồng">
            <div className="rv-tools">
              <div className="chips" role="group" aria-label="Lọc luồng">
                {FILTERS.map(([k, l, fn]) => { const n = flows.filter(fn).length; return (n > 0 || k === 'all') && <button key={k} type="button" className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{l}<span className="count">{n}</span></button>; })}
              </div>
            </div>
            <div className="rv-scroll">
              {shown.map((f) => {
                const [mc, mg] = MARK[f.status] || MARK.pending;
                const fs = byFlow[f.id] || [];
                const nr = fs.filter((x) => REAL.includes(x.kind)).length;
                const nu = fs.length - nr;
                const note = [nr && `${nr} lệch`, nu && `${nu} cần làm rõ`].filter(Boolean).join(' · ') || (FLOW[f.status] || FLOW.pending)[1].replace(/^[●✓✕⊘◔]\s*/, '');
                return (
                  <div key={f.id} className="rv-row">
                    <button type="button" className="rv-item" aria-current={f.id === sel?.id ? 'true' : undefined} onClick={() => setSelId(f.id)}>
                      <span className={`rv-mk ${mc}`} aria-hidden="true">{mg}</span>
                      <span className="sx-name" title={f.name}>{f.name}</span>
                      <span className="rv-d">{f.steps > 0 ? `${f.steps} bước` : ''}</span>
                      <span className="rv-tt">{note}</span>
                    </button>
                  </div>
                );
              })}
              {shown.length === 0 && <p className="cap" style={{ padding: 16 }}>Không có luồng nào khớp bộ lọc.</p>}
            </div>
          </nav>
          <section className="rv-detail sx-detail" aria-label="Chi tiết luồng">
            {selFindings.length === 0 && sel && (
              <article className="card card-b sx-flow">
                <div><span className={(FLOW[sel.status] || FLOW.pending)[0]}>{(FLOW[sel.status] || FLOW.pending)[1]}</span> <span className="cap">{sel.steps > 0 ? `${sel.steps} bước` : ''}</span></div>
                <h2>{sel.name}</h2>
                <p>{sel.summary || (active ? 'Chưa có kết quả.' : 'Không có ghi chú.')}</p>
              </article>
            )}
            {selFindings.map((x, i) => {
              const [c, l] = KIND[x.kind] || KIND.prd;
              return (
                <article key={i} className="card sx-find">
                  <div><span className={c}>{l}</span> <b>{x.summary}</b></div>
                  <span className="cap">Luồng: {sel.name}{sel.steps > 0 ? ` · ${sel.steps} bước` : ''}{x.frameName ? ` · Frame Figma: ${x.frameName}` : ''}</span>
                  {x.prdQuote && <blockquote className="cap">{x.prdQuote}</blockquote>}
                  {(x.appShot || x.figmaShot) && (
                    <div className="sx-shots">
                      <Shot label={x.figmaShot ? 'App' : 'App thật'} src={x.appShot} alt={`App: ${x.summary}`} />
                      <Shot label="Figma" src={x.figmaShot} alt={`Figma: ${x.frameName}`} />
                    </div>
                  )}
                </article>
              );
            })}
            {selFindings.length > 0 && sel?.summary && <p className="cap sx-sum"><b>Kết luận luồng:</b> {sel.summary}</p>}
          </section>
        </div>
      )}
      {flows.length === 0 && !active && <section className="card card-b"><span className="cap">Lần chạy này chưa có luồng nào.</span></section>}
      <details className="card card-b"><summary className="cap">Log ({run.log?.length || 0} dòng)</summary><pre className="log">{(run.log || []).join('\n')}</pre></details>
    </main>
  );
}

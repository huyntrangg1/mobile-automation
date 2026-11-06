import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon.jsx';
import { PopMenu } from '../components/PopMenu.jsx';
import { api } from '../api.js';
import { useEvents } from '../useEvents.js';
import { Empty, ErrorNote, PageHeader, fmtDur, fmtTime } from '../components/ui.jsx';
import { loadManualFix } from '../manualFix.js';

// Trạng thái run: [class badge, nhãn]. Run đang chạy mà tạm dừng tính là một trạng thái riêng.
const STATE = { running: ['stt-run', 'Đang chạy'], paused: ['stt-pause', 'Tạm dừng'], done: ['stt-done', 'Xong'], stopped: ['stt-stop', 'Đã dừng'], error: ['stt-err', 'Lỗi'], interrupted: ['stt-err', 'Bị ngắt'] };
const stateOf = (r) => (r.status === 'running' && r.paused ? 'paused' : r.status);
const hot = (r) => r.status === 'error' || r.status === 'interrupted'; // run hỏng thật: tô nền cả dòng
const TABS = [
  ['all', 'Tất cả', () => true],
  ['running', 'Đang chạy', (r) => r.status === 'running'],
  ['fail', 'Có fail', (r) => r.counts?.failed > 0],
  ['stop', 'Lỗi / dừng', (r) => ['error', 'stopped', 'interrupted'].includes(r.status)],
];

// Mốc ngày của nhóm: Hôm nay / Hôm qua / dd/mm
const dayLabel = (iso) => {
  const d = new Date(iso), n = new Date();
  const at = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((at(n) - at(d)) / 86400000);
  if (diff <= 0) return 'Hôm nay';
  if (diff === 1) return 'Hôm qua';
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: d.getFullYear() !== n.getFullYear() ? 'numeric' : undefined });
};
const passRate = (c) => (c.passed + c.failed ? `${Math.round((c.passed / (c.passed + c.failed)) * 100)}%` : null);
const iconOf = (r) => {
  const k = stateOf(r);
  if (k === 'running') return ['ico-run', '●'];
  if (k === 'paused') return ['ico-pause', '⏸'];
  if (k === 'stopped') return ['ico-stop', '■'];
  return hot(r) || r.counts?.failed > 0 ? ['ico-fail', '✕'] : ['ico-done', '✓'];
};

export function Runs({ lock }) {
  const nav = useNavigate();
  const [runs, setRuns] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api.get('/runs').then(setRuns).catch(setErr);
  useEffect(() => { load(); }, []);
  // Xoá run / xoá app (ở tab khác) phát 'app' → tải lại danh sách
  useEvents('app', () => load());
  useEvents('run', (x) => setRuns((l) => (l?.some((y) => y.id === x.id) ? l.map((y) => (y.id === x.id ? { ...y, ...x } : y)) : (load(), l))));
  const [pick, setPick] = useState({});
  const [msg, setMsg] = useState(null);
  const [term, setTerm] = useState('');
  const [tab, setTab] = useState('all');
  const picked = (runs || []).filter((r) => pick[r.id]).map((r) => r.id);
  const del = async (body, what) => {
    if (!window.confirm(`Xoá ${what}? Kết quả, log, ảnh và report của run sẽ bị xoá hẳn. Run đang chạy không bị xoá.`)) return;
    setErr(null);
    try {
      const r = await api.post('/runs/delete', body);
      setPick({});
      setMsg(r.deleted.length ? `Đã xoá ${r.deleted.length} run${r.skipped.length ? ` · bỏ qua ${r.skipped.length} run đang chạy` : ''}.` : 'Không có run nào để xoá.');
      load();
    } catch (e) { setErr(e); }
  };
  const shown = useMemo(() => {
    const s = term.trim().toLowerCase();
    const f = TABS.find((t) => t[0] === tab)[2];
    return [...(runs || [])]
      .filter((r) => f(r) && (!s || `${r.id} ${r.appName} ${(r.files || []).join(' ')} ${r.deviceName}`.toLowerCase().includes(s)))
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  }, [runs, term, tab]);
  const groups = useMemo(() => {
    const out = [];
    shown.forEach((r) => { const k = dayLabel(r.startedAt); const g = out.find((x) => x.k === k); if (g) g.items.push(r); else out.push({ k, items: [r] }); });
    return out;
  }, [shown]);
  const selectable = shown.filter((r) => r.status !== 'running');
  const allPicked = selectable.length > 0 && selectable.every((r) => pick[r.id]);
  const rerun = (r) => api.post(`/runs/${r.id}/rerun`, { manualFix: loadManualFix() }).then((x) => nav(`/runs/${x.id}`)).catch(setErr);

  return (
    <main className="content">
      <PageHeader title="Test Runs" sub="Mỗi run giữ report riêng; mở run để xem kết quả, log và report.">
        <PopMenu label="Thao tác khác" small={false}>
          {(close) => <button type="button" role="menuitem" className="danger" onClick={() => { close(); del({ olderThanDays: 7 }, 'các run cũ hơn 7 ngày'); }}><Icon name="trash" />Xoá run cũ hơn 7 ngày…</button>}
        </PopMenu>
      </PageHeader>
      <ErrorNote error={err} />
      {msg && <div className="alert alert-info" role="status"><Icon name="check" /><div>{msg}</div></div>}
      {runs === null && !err && <div className="skel" style={{ height: 240 }} />}
      {runs && runs.length === 0 && <section className="card"><Empty icon="play" title="Chưa có run nào">Chọn case ở Test Cases rồi bấm Run.</Empty></section>}
      {runs && runs.length > 0 && (
        <>
          <div className="ap-flt">
            <div className="search">
              <Icon name="search" />
              <input className="inp" type="search" placeholder="Tìm run, app, thiết bị…" aria-label="Tìm run" value={term} onChange={(e) => setTerm(e.target.value)} />
            </div>
            <div className="chips" role="tablist" aria-label="Lọc theo trạng thái">
              {TABS.map(([k, l, f]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`chip${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l}<span className="count">{runs.filter(f).length}</span></button>)}
            </div>
            {selectable.length > 0 && <button className="btn btn-sm btn-ghost" type="button" onClick={() => setPick(allPicked ? {} : Object.fromEntries(selectable.map((r) => [r.id, true])))}>{allPicked ? 'Bỏ chọn tất cả' : 'Chọn tất cả run đã xong'}</button>}
          </div>
          {groups.length === 0 && <div className="ap-wrap"><div className="ap-none" style={{ padding: 32 }}>Không có run khớp bộ lọc.</div></div>}
          {groups.map((g) => (
            <section className="rn-day" key={g.k}>
              <h2 className="rn-dh"><span>{g.k}</span><span className="mono">{g.items.length} run</span></h2>
              <div className="rn-list">{g.items.map((r) => <RunRow key={r.id} r={r} checked={!!pick[r.id]} onCheck={(v) => setPick({ ...pick, [r.id]: v })} onOpen={() => nav(`/runs/${r.id}`)} onRerun={() => rerun(r)} lock={lock} />)}</div>
            </section>
          ))}
        </>
      )}
      {picked.length > 0 && (
        <div className="selbar" role="region" aria-label="Run đã chọn">
          <span>{picked.length} run đã chọn</span>
          <button className="btn btn-sm" type="button" onClick={() => setPick({})}>Bỏ chọn</button>
          <span className="sp" />
          <button className="btn btn-sm btn-danger" type="button" onClick={() => del({ ids: picked }, `${picked.length} run đã chọn`)}><Icon name="trash" />Xoá đã chọn ({picked.length})</button>
        </div>
      )}
    </main>
  );
}

function RunRow({ r, checked, onCheck, onOpen, onRerun, lock }) {
  const c = r.counts || {};
  const k = stateOf(r);
  const [stCls, stLabel] = STATE[k] || ['stt-stop', k];
  const [icCls, icGlyph] = iconOf(r);
  const order = r.order?.length || 0;
  const doneN = (r.order || []).filter((id) => !['queued', 'running'].includes(r.results?.[id]?.status)).length;
  const total = Math.max(1, (c.passed || 0) + (c.failed || 0) + (c.blocked || 0) + (c.skipped || 0) + (c.notrun || 0));
  const seg = (key, cls) => (c[key] ? <span className={cls} style={{ width: `${(c[key] / total) * 100}%` }} /> : null);
  const rate = passRate(c);
  const noResult = !c.passed && !c.failed && !c.blocked && !c.skipped;
  const onRow = (e) => { if (!e.target.closest('a,button,input,label')) onOpen(); };
  return (
    <div className={`rn-row${hot(r) ? ' hot' : ''}`} onClick={onRow}>
      <span className={`ico ${icCls}`} aria-hidden="true">{icGlyph}</span>
      <div className="rn-info">
        <div className="rn-id"><Link className="mono" to={`/runs/${r.id}`}>{r.id}</Link><span className={`stt ${stCls}`}><i />{stLabel}</span></div>
        <span className="rn-sub" title={`${r.appName} · ${(r.files || []).join(', ')}`}>{r.appName} · {(r.files || []).join(', ')} · {order} case</span>
        <span className="rn-sub">{r.deviceName} · {fmtTime(r.startedAt)} · {r.finishedAt ? fmtDur(new Date(r.finishedAt) - new Date(r.startedAt)) : 'đang chạy'}</span>
      </div>
      <div>
        <div className="stk" role="img" aria-label={`${c.passed || 0} pass, ${c.failed || 0} fail, ${c.blocked || 0} blocked, ${c.skipped || 0} skip, ${c.notrun || 0} chưa chạy`}>
          {seg('passed', 'rb-p')}{seg('failed', 'rb-f')}{seg('blocked', 'rb-b')}{seg('skipped', 'rb-s')}
        </div>
        <div className="rnum">
          {r.status === 'running' ? (
            <><span><b>{doneN}/{order}</b> case</span>{c.failed > 0 && <span className="f">✕ <b>{c.failed}</b></span>}</>
          ) : noResult ? (
            <span><b>{c.notrun || 0}</b> case chưa chạy</span>
          ) : (
            <>
              <span title="Pass">✓ <b>{c.passed || 0}</b></span><span className="f" title="Fail">✕ <b>{c.failed || 0}</b></span>
              {c.blocked > 0 && <span title="Blocked">⊘ <b>{c.blocked}</b></span>}{c.skipped > 0 && <span title="Skip">– <b>{c.skipped}</b></span>}
              {rate && <span className="rt" title={`${c.passed}/${c.passed + c.failed} case có kết quả${c.blocked ? `, chưa tính ${c.blocked} blocked` : ''}`}><b>{rate}</b></span>}
            </>
          )}
        </div>
      </div>
      <div className="rn-act">
        <input className="cb" type="checkbox" aria-label={`Chọn ${r.id}`} disabled={r.status === 'running'} title={r.status === 'running' ? 'Run đang chạy — Stop trước khi xoá' : ''} checked={checked} onChange={(e) => onCheck(e.target.checked)} />
        {r.status === 'running'
          ? <Link className="btn btn-sm btn-primary" to={`/runs/${r.id}`}><Icon name="arrow" />Theo dõi</Link>
          : <button className="btn btn-sm" type="button" disabled={!!lock} title={lock ? `Thiết bị đang bận: ${lock.label}` : `Chạy lại ${order} case của ${r.id}`} onClick={onRerun}><Icon name="play" />Run lại</button>}
      </div>
    </div>
  );
}

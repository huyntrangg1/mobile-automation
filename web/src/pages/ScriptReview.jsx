import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { EditorView } from '@codemirror/view';
import { api } from '../api.js';
import { genScripts } from '../genScripts.js';
import { useEvents } from '../useEvents.js';
import { Icon } from '../components/Icon.jsx';
import { Empty, ErrorNote, PageHeader } from '../components/ui.jsx';
import { ScriptBadge, SCRIPT } from '../components/scriptStatus.jsx';
import { confirmLeave, setLeaveGuard } from '../leaveGuard.js';
import { MISS_SCREEN, MISS_ELEM } from '../locInfo.js';

const KIND = { Action: 'k-act', Nav: 'k-nav', Check: 'k-chk' };
// Cảnh báo "thiếu locator" khác ghi chú thường của AI: tách bằng cùng quy tắc với màn Test Cases
const isMiss = (w) => MISS_SCREEN.test(w) || MISS_ELEM.test(w);
const locOf = (c) => {
  const miss = [], els = [];
  for (const w of c.script.warnings || []) {
    const a = MISS_SCREEN.exec(w), b = MISS_ELEM.exec(w);
    if (a) miss.push(a[1]); else if (b) els.push([b[1], b[2]]);
  }
  return { miss: [...new Set(miss)], els };
};

// Một route, hai tầng: không có ?case= là danh sách file + case (như Test Cases); có ?case= là chi tiết một case
export function ScriptReview({ apps }) {
  const { appId } = useParams();
  const [params] = useSearchParams();
  const app = apps.find((a) => a.id === appId);
  if (!app) return <main className="content"><div className="skel" style={{ height: 240 }} /></main>;
  return params.get('case') ? <ScriptDetail key={appId} app={app} /> : <ScriptList key={appId} app={app} />;
}

/* ───────────────────────── Tầng 1: danh sách file + case ───────────────────────── */

function ScriptList({ app }) {
  const appId = app.id;
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const fileF = params.get('file') || '';
  const [cases, setCases] = useState(null);
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [exported, setExported] = useState(null); // kết quả export SimUtil gần nhất
  const load = useCallback(() => api.get(`/apps/${appId}/cases`).then(setCases).catch(setErr), [appId]);
  useEffect(() => { load(); }, [load]);
  useEvents('script', (s) => s.appId === appId && setCases((cs) => cs?.map((c) => (c.id === s.caseId ? { ...c, script: s.script } : c))));
  useEvents('app', (e) => e.id === appId && load());

  const files = [...new Set((cases || []).map((c) => c.file))];
  const cur = files.includes(fileF) ? fileF : files[0] || '';
  const inFile = (cases || []).filter((c) => c.file === cur);
  const loc = useMemo(() => Object.fromEntries((cases || []).map((c) => [c.id, locOf(c)])), [cases]);
  const hasLoc = (c) => loc[c.id] && (loc[c.id].miss.length > 0 || loc[c.id].els.length > 0);
  const reviewedN = (c) => c.script.status === 'generated' && c.script.reviewed;
  const stat = (list) => {
    const st = { n: list.length, rev: 0, gen: 0, bad: 0 };
    for (const c of list) {
      if (c.script.status === 'generated') { if (c.script.reviewed) st.rev++; else st.gen++; } else if (c.script.status !== 'generating') st.bad++;
    }
    return st;
  };
  const curSt = stat(inFile);
  const counts = useMemo(() => {
    const m = {};
    for (const c of inFile) m[c.script.status] = (m[c.script.status] || 0) + 1;
    return m;
  }, [cases, cur]);
  const locN = inFile.filter(hasLoc).length;
  const missScreens = useMemo(() => {
    const m = new Map();
    for (const c of inFile) for (const sc of new Set([...loc[c.id].miss, ...loc[c.id].els.map((e) => e[0])])) m.set(sc, (m.get(sc) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [inFile, loc]);
  const shown = inFile.filter((c) => (!filter
    || (filter === 'warn' ? hasLoc(c) : filter === 'todo' ? c.script.status === 'generated' && !c.script.reviewed : filter === 'done' ? reviewedN(c) : c.script.status === filter))
    && (!q || `${c.tcId} ${c.title}`.toLowerCase().includes(q.toLowerCase())));
  const groups = useMemo(() => {
    const g = new Map();
    for (const c of shown) { if (!g.has(c.module)) g.set(c.module, { module: c.module, items: [] }); g.get(c.module).items.push(c); }
    return [...g.values()];
  }, [shown]);
  const todo = inFile.filter((c) => ['none', 'failed', 'stale'].includes(c.script.status));
  const fmtD = (iso) => (iso ? new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) : '');
  const impAt = (list) => fmtD(list.map((c) => c.importedAt).filter(Boolean).sort()[0]);
  const open = (c) => nav(`/apps/${appId}/scripts?${new URLSearchParams({ file: c.file, case: c.tcId })}`);

  const genAll = async () => {
    const min = Math.ceil((todo.length / 3) * 1.5);
    if (!window.confirm(`Gen script cho ${todo.length} case chưa có script trong ${cur}.xlsx (gồm cả case gen lỗi / cần gen lại)?\nAI chạy 3 case cùng lúc, ước tính khoảng ${min} phút. Bạn vẫn dùng tool bình thường trong lúc chờ.`)) return;
    setErr(null);
    try { await genScripts(appId, todo.map((c) => c.id)); setMsg(`Đang gen script cho ${todo.length} case — trạng thái cập nhật trực tiếp trong bảng.`); } catch (e) { setErr(e); }
  };
  const toSimutil = async () => {
    setErr(null);
    try {
      const r = await api.post(`/apps/${appId}/scripts/${cur}/simutil`);
      setExported({ ...r, bad: Object.entries(r.unsupported) });
    } catch (e) { setErr(e); }
  };
  const fileBar = (st) => (
    <>
      <div className="rbar" role="img" aria-label={`${st.rev} đã review, ${st.gen} chưa review, ${st.bad} cần xử lý`}>
        <i className="p" style={{ width: `${(st.rev / st.n) * 100}%` }} /><i className="s" style={{ width: `${(st.gen / st.n) * 100}%` }} /><i className="f" style={{ width: `${(st.bad / st.n) * 100}%` }} />
      </div>
      <span className="rtxt num"><b>{st.rev}</b> đã review · {st.gen} chưa review{st.bad > 0 && <> · <b className="fail-n">{st.bad}</b> cần xử lý</>}</span>
    </>
  );
  const warnRows = (c) => {
    const li = loc[c.id];
    const names = [...li.miss, ...li.els.map((e) => `${e[0]} › ${e[1]}`)];
    if (!names.length) return null;
    return <span className="sub warn-txt" title={c.script.warnings.join('\n')}><Icon name="warn" size={12} />Thiếu locator: {names.slice(0, 2).join(', ')}{names.length > 2 ? ` +${names.length - 2}` : ''}</span>;
  };
  const reviewCell = (c) => {
    if (c.script.status !== 'generated') return <ScriptBadge script={c.script} />;
    return c.script.reviewed ? <span className="dotl pass">Đã review</span> : <span className="dotl none">Chưa review</span>;
  };

  if (cases && cases.length === 0) return (
    <main className="content"><PageHeader title="Scripts" /><section className="card"><Empty icon="code" title="Chưa có file test case"><Link className="btn btn-primary" to={`/apps/${appId}/cases`}>Import Excel</Link></Empty></section></main>
  );
  return (
    <main className="content content-wide">
      <PageHeader title="Scripts" sub={`${app.name} · ${files.length} file script · ${cases?.length ?? 0} case · mỗi case là một region, review là tuỳ chọn`} />
      <ErrorNote error={err} />
      {msg && <div className="alert alert-info" role="status"><Icon name="check" /><div>{msg}</div></div>}
      {exported && (
        <div className={exported.bad.length ? 'alert alert-warn' : 'alert alert-ok'} role="status"><Icon name={exported.bad.length ? 'warn' : 'check'} /><div style={{ flex: 1, minWidth: 0 }}>
          Đã export {exported.count} case sang SimUtil{exported.replaced ? ' (ghi đè bản trước)' : ''} — project <b className="mono">{exported.project}</b>. Mở SimUtil → Scenarios → chọn project này để chạy.
          <div className="cap mono">{exported.dir}</div>
          {exported.bad.length > 0 && <div className="cap">Keyword SimUtil không hỗ trợ (thành t.unsupported, kiểm tay): {exported.bad.map(([tc, ks]) => `${tc}: ${[...new Set(ks)].join(', ')}`).join(' · ')}</div>}
        </div><button className="linkbtn" type="button" onClick={() => setExported(null)}>Đóng</button></div>
      )}
      {cases === null && !err && <div className="skel" style={{ height: 240 }} />}
      {cases && cases.length > 0 && (
        <div className="sp2">
          <section className="card file-list" aria-label="Danh sách file script">
            {files.map((f) => {
              const list = cases.filter((c) => c.file === f);
              return (
                <button key={f} type="button" className="fi" aria-current={f === cur ? 'true' : undefined} onClick={() => { setParams({ file: f }, { replace: true }); setFilter(''); setQ(''); }}>
                  <span className="fn">{f}</span>
                  <span className="cap num">{list.length} case · import {impAt(list)}</span>
                  {fileBar(stat(list))}
                </button>
              );
            })}
          </section>
          <div className="stack-16 file-detail">
            <div className="fh">
              <div className="grow"><h2>{cur}.e2e.js</h2>
                <span className="cap">{inFile.length} case · script {inFile.filter((c) => c.script.status === 'generated').length}/{inFile.length} đã gen · từ {cur}.xlsx</span></div>
              <button className="btn btn-sm" type="button" onClick={genAll} disabled={!todo.length}><Icon name="spark" />Gen script{todo.length ? ` (${todo.length})` : ''}</button>
              <button className="btn btn-sm" type="button" onClick={toSimutil} title="Ghi các case của file này vào ~/.simutil/projects để chạy bằng SimUtil"><Icon name="ext" />Export SimUtil</button>
            </div>
            <div className="summary-line num">
              <span><b>{curSt.rev}</b> đã review</span><span><b>{curSt.gen}</b> chưa review</span>
              {curSt.bad > 0 && <span><b className="fail-n">{curSt.bad}</b> cần xử lý</span>}
            </div>
            {missScreens.length > 0 && (
              <div className="alert alert-warn loc-banner">
                <Icon name="warn" />
                <div style={{ flex: 1 }}><b>{missScreens.length} màn thiếu trong locator map</b>
                  <span className="cap" style={{ marginLeft: 8 }}>Nhiều nhất: {missScreens.slice(0, 3).map(([n, k]) => `${n} (${k} case)`).join(', ')}</span></div>
                <Link className="btn btn-sm" to={`/apps/${appId}/locators`}><Icon name="map" />Lấy locator</Link>
              </div>
            )}
            <div className="fbar">
              <div className="chips" role="group" aria-label="Lọc case">
                <button className={!filter ? 'chip on' : 'chip'} type="button" onClick={() => setFilter('')}>Tất cả <span className="count">{inFile.length}</span></button>
                {curSt.gen > 0 && <button className={filter === 'todo' ? 'chip on' : 'chip'} type="button" onClick={() => setFilter('todo')}>Chưa review <span className="count">{curSt.gen}</span></button>}
                {curSt.rev > 0 && <button className={filter === 'done' ? 'chip on' : 'chip'} type="button" onClick={() => setFilter('done')}>Đã review <span className="count">{curSt.rev}</span></button>}
                {Object.keys(SCRIPT).filter((k) => k !== 'generated' && counts[k]).map((k) => (
                  <button key={k} className={filter === k ? 'chip on' : 'chip'} type="button" onClick={() => setFilter(k)}>{SCRIPT[k][1]} <span className="count">{counts[k]}</span></button>
                ))}
                {locN > 0 && <button className={filter === 'warn' ? 'chip on chip-warn' : 'chip chip-warn'} type="button" onClick={() => setFilter('warn')}><Icon name="warn" size={12} />Thiếu locator <span className="count">{locN}</span></button>}
              </div>
              <span style={{ flex: 1 }} />
              <input className="inp search-inp" type="search" placeholder="Tìm theo ID, tiêu đề" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm case" />
            </div>
            <section className="card" style={{ overflowX: 'auto' }}>
              <table className="dt tc-table sr-table">
                <thead><tr><th>ID</th><th>Test case</th><th>Bắt đầu</th><th>Script</th><th aria-label="Mở" /></tr></thead>
                {groups.map((g) => (
                  <tbody key={g.module}>
                    {groups.length > 1 && <tr className="grp"><td colSpan={5}><b>{g.module}</b> <span className="cap">· {g.items.length} case</span></td></tr>}
                    {g.items.map((c) => (
                      <tr key={c.id} className="sr-row" onClick={(e) => { if (!e.target.closest('a,button')) open(c); }}>
                        <td className="nowrap"><span className="mono">{c.tcId}</span><span className="sub cap num" style={{ display: 'block' }}>{c.steps} bước · <span className={`pr ${c.priority}`}>{c.priority}</span></span></td>
                        <td className="wrap"><Link to={`/apps/${appId}/scripts?${new URLSearchParams({ file: c.file, case: c.tcId })}`} className="tc-title">{c.title}</Link>
                          {warnRows(c)}
                          {c.script.status === 'failed' && <span className="name-sub warn-txt">{c.script.error}</span>}</td>
                        <td className="cap nowrap">{c.fresh ? 'Cài lại app' : <>Sau <span className="mono">{c.prev.replace(/^TC_[A-Z]+_/, '…')}</span></>}</td>
                        <td className="nowrap">{reviewCell(c)}</td>
                        <td className="r"><Icon name="arrow" className="sr-go" /></td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
              {shown.length === 0 && <Empty title="Không có case khớp bộ lọc" />}
            </section>
          </div>
        </div>
      )}
    </main>
  );
}

/* ───────────────────────── Tầng 2: chi tiết một case ───────────────────────── */

function ScriptDetail({ app }) {
  const appId = app.id;
  const [params, setParams] = useSearchParams();
  const file = params.get('file') || '';
  const caseId = params.get('case');
  const [doc, setDoc] = useState(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const viewRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [warnOpen, setWarnOpen] = useState(false);
  const [lq, setLq] = useState('');
  const [lf, setLf] = useState('');
  // Gập / mở cột bước Excel: nhớ lựa chọn trên máy này
  const [stepsOpen, setStepsOpen] = useState(() => { try { return localStorage.getItem('qapd.scriptSteps') !== '0'; } catch { return true; } });
  const toggleSteps = () => setStepsOpen((v) => { try { localStorage.setItem('qapd.scriptSteps', v ? '0' : '1'); } catch { /* bỏ qua */ } return !v; });
  const [changed, setChanged] = useState(false); // file trên server đổi trong lúc đang sửa
  const editing = useRef(false);
  // Link chỉ có ?case= (không có file) → mặc định file đầu tiên, như bản cũ
  useEffect(() => {
    if (file) return;
    api.get(`/apps/${appId}/scripts`).then((f) => f[0] && setParams({ file: f[0].file, case: caseId }, { replace: true })).catch(setErr);
  }, [appId, file]);
  const load = useCallback(() => {
    if (!file) return;
    api.get(`/apps/${appId}/scripts/${file}`).then((d) => { setDoc(d); setCode(d.code); setChanged(false); }).catch(setErr);
  }, [appId, file]);
  useEffect(load, [load]);
  useEvents('script', (s) => {
    if (s.appId !== appId) return;
    setDoc((d) => d && { ...d, cases: d.cases.map((c) => (c.id === s.caseId ? { ...c, script: s.script } : c)) });
    if (s.script.status === 'generating') return;
    // Đang sửa dở → không ghi đè, chỉ báo
    if (editing.current) setChanged(true);
    else load();
  });
  const list = doc?.cases || [];
  const idx = Math.max(0, list.findIndex((c) => c.tcId === caseId));
  const cur = list[idx];
  const dirty = doc && code !== doc.code;
  editing.current = !!dirty;
  // Đang sửa dở → hỏi trước khi rời trang / đổi file
  useEffect(() => {
    setLeaveGuard(dirty ? `Bạn đang sửa ${file}.e2e.js mà chưa lưu. Rời đi sẽ mất phần đã sửa?` : null);
    return () => setLeaveGuard(null);
  }, [dirty, file]);
  useEffect(() => { setWarnOpen(false); }, [caseId]);

  // Nhảy editor tới region của case đang chọn
  useEffect(() => {
    const v = viewRef.current;
    if (!v || !cur?.line || dirty) return;
    const line = v.state.doc.line(Math.min(cur.line, v.state.doc.lines));
    v.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 24 }) });
  }, [cur?.id, cur?.line, doc?.code, ready]);

  const go = (c) => c && setParams({ file, case: c.tcId });
  const save = async () => {
    setErr(null);
    try { await api.put(`/apps/${appId}/scripts/${file}`, { code, hash: doc.hash }); setMsg('Đã lưu'); setTimeout(() => setMsg(null), 2000); load(); } catch (e) { setErr(e); if (e.status === 409) setChanged(true); }
  };
  const regen = () => genScripts(appId, [cur.id]).catch(setErr);
  const reviewed = () => api.post(`/cases/${encodeURIComponent(cur.id)}/reviewed`, { reviewed: !cur.script.reviewed }).then(load).catch(setErr);
  const exts = useMemo(() => [javascript(), EditorView.lineWrapping], []);
  const LFILT = [
    ['', 'Tất cả', () => true],
    ['todo', 'Chưa review', (c) => c.script.status === 'generated' && !c.script.reviewed],
    ['miss', 'Thiếu locator', (c) => (c.script.warnings || []).some(isMiss)],
    ['bad', 'Lỗi / chưa gen', (c) => ['failed', 'none', 'stale'].includes(c.script.status)],
  ];
  const shownList = useMemo(() => {
    const f = LFILT.find((x) => x[0] === lf)[2];
    const t = lq.trim().toLowerCase();
    return list.filter((c) => f(c) && (!t || `${c.tcId} ${c.title}`.toLowerCase().includes(t)));
  }, [list, lf, lq]);
  // Dấu trạng thái ở đầu dòng: chỉ trạng thái thật của script, không đánh ⚠ từng dòng (gần như case nào cũng có cảnh báo)
  const mark = (c) => {
    const st = c.script.status;
    if (st === 'generating') return <span className="sl-gen" title="Đang gen" />;
    if (st === 'failed') return <span className="sl-mk err" title="Gen lỗi">✕</span>;
    if (st === 'stale') return <span className="sl-mk warn" title="Cần gen lại">↻</span>;
    if (st === 'none') return <span className="sl-mk dim" title="Chưa gen">○</span>;
    return c.script.reviewed ? <span className="sl-mk ok" title="Đã review">✓</span> : null;
  };
  useEffect(() => { document.querySelector('.sl-item[aria-current]')?.scrollIntoView({ block: 'nearest' }); }, [cur?.id, doc]);
  const backTo = `/apps/${appId}/scripts?${new URLSearchParams({ file })}`;

  // Bước Excel gộp theo màn: tiêu đề màn một lần, không lặp "1 · Welcome" ở từng bước
  const stepGroups = useMemo(() => {
    const out = [];
    for (const r of cur?.rows || []) {
      const last = out[out.length - 1];
      if (last && last.screen === r.screen) last.rows.push(r); else out.push({ screen: r.screen, rows: [r] });
    }
    return out;
  }, [cur?.id, doc]);

  if (!doc) return <main className="content"><ErrorNote error={err} /><div className="skel" style={{ height: 240 }} /></main>;
  const w = cur?.script.warnings || [];
  const missN = w.filter(isMiss).length;
  return (
    <main className="content content-wide sr-page">
      <PageHeader title={<span style={{ fontFamily: 'var(--font-mono)' }}>{cur?.tcId || caseId}</span>}
        sub={<Link to={backTo} onClick={(e) => { if (!confirmLeave()) e.preventDefault(); }}>‹ {file}.e2e.js · {list.length} case</Link>}>
        {msg && <span className="cap" role="status">{msg}</span>}
        <div className="sr-pager" role="group" aria-label="Chuyển case">
          <button className="btn btn-icon" type="button" aria-label="Case trước" disabled={idx <= 0} onClick={() => go(list[idx - 1])}><Icon name="arrow" className="flip" /></button>
          <span className="cap mono num">{idx + 1}/{list.length}</span>
          <button className="btn btn-icon" type="button" aria-label="Case sau" disabled={idx >= list.length - 1} onClick={() => go(list[idx + 1])}><Icon name="arrow" /></button>
        </div>
        <button className="btn" type="button" onClick={() => setCode(doc.code)} disabled={!dirty}>Bỏ sửa</button>
        <button className="btn btn-primary" type="button" onClick={save} disabled={!dirty}>Lưu file</button>
      </PageHeader>
      <ErrorNote error={err} />
      {changed && (
        <div className="alert alert-warn"><Icon name="warn" /><div style={{ flex: 1 }}>File vừa thay đổi trên server (một case gen xong hoặc lưu ở tab khác). Phần bạn đang sửa chưa được lưu.</div>
          <button className="btn btn-sm" type="button" onClick={() => { navigator.clipboard?.writeText(code); load(); }}>Sao chép phần đang sửa rồi tải lại</button></div>
      )}
      {!cur ? <section className="card"><Empty icon="code" title="Không tìm thấy case này trong file"><Link className="btn" to={backTo}>Về danh sách</Link></Empty></section> : (
        <div className={`sd3${stepsOpen ? '' : ' no-steps'}`}>
          <nav className="card sl-box" aria-label="Case trong file">
            <div className="sl-tools">
              <div className="search"><Icon name="search" /><input className="inp" type="search" placeholder="Tìm case…" aria-label="Tìm case" value={lq} onChange={(e) => setLq(e.target.value)} /></div>
              <div className="chips" role="group" aria-label="Lọc case">
                {LFILT.map(([k, l, f]) => { const n = list.filter(f).length; return (k === '' || n > 0 || lf === k) && <button key={k || 'all'} type="button" className={`chip${lf === k ? ' on' : ''}`} onClick={() => setLf(k)}>{l}<span className="count">{n}</span></button>; })}
              </div>
            </div>
            <div className="sl-scroll">
              {shownList.map((c) => (
                <button key={c.id} type="button" className="sl-item" aria-current={c.tcId === cur.tcId ? 'true' : undefined} onClick={() => go(c)}>
                  <span className="sl-id">{c.tcId}</span>{mark(c)}<span className="sl-tt" title={c.title}>{c.title}</span>
                </button>
              ))}
              {shownList.length === 0 && <p className="cap" style={{ padding: 16, textAlign: 'center' }}>Không có case khớp.</p>}
            </div>
          </nav>
          <section className="card sr-code">
            <div className="sd-head">
              <div className="sd-r1"><ScriptBadge script={cur.script} /><span className="cap">{cur.fresh ? 'Cài lại app' : `Tiếp nối ${cur.prev}`}{cur.script.editedByHand ? ' · đã sửa tay' : ''}</span></div>
              <h2 className="sd-title">{cur.title}</h2>
              <div className="sd-r1" style={{ justifyContent: 'flex-end' }}>
                {cur.script.status === 'generating'
                  ? <button className="btn btn-sm btn-danger" type="button" onClick={() => api.post(`/apps/${appId}/scripts/cancel`, { caseIds: [cur.id] }).catch(setErr)}><Icon name="stop" />Dừng gen</button>
                  : <button className="btn btn-sm" type="button" onClick={regen}><Icon name="spark" />{cur.script.status === 'none' ? 'Gen' : 'Gen lại'}</button>}
                <button className={cur.script.reviewed ? 'btn btn-sm on-ok' : 'btn btn-sm'} type="button" onClick={reviewed} disabled={cur.script.status !== 'generated'}><Icon name="check" />{cur.script.reviewed ? 'Đã review' : 'Đánh dấu đã review'}</button>
              </div>
            </div>
            {cur.script.status === 'failed' && <div className="alert alert-err" style={{ margin: '12px 16px 0' }}><Icon name="warn" /><div><b>Gen lỗi:</b> {cur.script.error}</div></div>}
            {w.length > 0 && (
              <div className="sd-warn">
                <button type="button" className="sd-warn-bar" aria-expanded={warnOpen} onClick={() => setWarnOpen(!warnOpen)}>
                  <Icon name="warn" size={14} /><span>{missN > 0 && <b>{missN} thiếu locator</b>}{missN > 0 && w.length > missN ? ' · ' : ''}{w.length > missN && `${w.length - missN} ghi chú khi gen`}</span>
                  <span className="sd-warn-go">{warnOpen ? 'Thu gọn' : 'Xem'}</span>
                </button>
                {warnOpen && <ul className="warn-list sd-warn-list">{w.map((t) => <li key={t}>{isMiss(t) && <span className="sd-tag">Thiếu locator</span>}{t}</li>)}</ul>}
              </div>
            )}
            <div className="sd-bar"><span className="cap num">Case {idx + 1}/{list.length}</span><span style={{ flex: 1 }} />
              <button className="btn btn-sm btn-ghost" type="button" aria-pressed={stepsOpen} onClick={toggleSteps}>{stepsOpen ? 'Ẩn bước Excel' : `Hiện bước Excel (${cur.rows.length})`}</button></div>
            {!doc.code ? <Empty icon="code" title="File chưa có case nào được gen">Chọn case ở Test Cases → Generate script, hoặc bấm Gen ở trên.</Empty> : (
              <CodeMirror value={code} height="calc(100vh - 360px)" minHeight="320px" extensions={exts} onChange={setCode} onCreateEditor={(v) => { viewRef.current = v; setReady(true); }} basicSetup={{ foldGutter: true }} aria-label="Code test script" />
            )}
          </section>
          {stepsOpen && <aside className="card sr-steps" aria-label="Bước trong Excel">
            <div className="card-h"><h2>Bước trong Excel <span className="cap" style={{ fontWeight: 400 }}>· {cur.rows.length} bước</span></h2></div>
            {cur.pre?.length > 0 && <div className="sr-pre cap">{cur.pre.map((p) => <div key={p}>{p}</div>)}</div>}
            <ol className="steps">
              {stepGroups.map((g, gi) => (
                <Fragment key={gi}>
                  <li className="sg"><span>{g.screen || '—'}</span></li>
                  {g.rows.map((r, i) => (
                    <li key={i}><span className={`kind ${KIND[r.kind] || ''}`}>{r.kind}</span>
                      <div><b>{r.keyword}</b> {r.target && <>“{r.target}”</>} {r.value && r.value !== r.target && <span className="muted">= {r.value}</span>}{r.label && <div className="cap">{r.label}</div>}</div></li>
                  ))}
                </Fragment>
              ))}
            </ol>
          </aside>}
        </div>
      )}
    </main>
  );
}

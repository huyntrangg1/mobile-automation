import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useEvents } from '../useEvents.js';
import { Icon } from '../components/Icon.jsx';
import { Empty, ErrorNote, PageHeader } from '../components/ui.jsx';
import { SCRIPT, ScriptBadge } from '../components/scriptStatus.jsx';
import { ManualImport } from '../components/ManualImport.jsx';

export function TestCases({ apps }) {
  const { appId } = useParams();
  const nav = useNavigate();
  const app = apps.find((a) => a.id === appId);
  const [cases, setCases] = useState(null);
  const [sel, setSel] = useState({});
  const [filter, setFilter] = useState('');
  // Lọc theo file Excel đã import (giữ trên URL: ?file=authentication-automation)
  const [params, setParams] = useSearchParams();
  const fileF = params.get('file') || '';
  const setFileF = (f) => setParams(f ? { file: f } : {}, { replace: true });
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  // Kiểu file import: manual (tool tự lọc + chuyển sang automation + gen script) hoặc automation (như cũ)
  const kindRef = useRef('automation');
  const reRef = useRef(null);
  const [menu, setMenu] = useState(false);
  const [runs, setRuns] = useState([]);
  const [manualOpen, setManualOpen] = useState(null);
  const [manuals, setManuals] = useState([]);
  const loadManuals = useCallback(() => api.get(`/apps/${appId}/manual`).then(setManuals).catch(() => {}), [appId]);
  useEffect(() => { loadManuals(); }, [loadManuals]);
  useEvents('manualImport', (e) => e.appId === appId && loadManuals());
  const loadRuns = useCallback(() => api.get('/runs').then((r) => setRuns(r.filter((x) => x.appId === appId))).catch(() => {}), [appId]);
  useEffect(() => { loadRuns(); }, [loadRuns]);
  useEvents('run', (x) => x.appId === appId && x.status !== 'running' && loadRuns());
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(false);
    const key = (e) => e.key === 'Escape' && close();
    document.addEventListener('click', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', key); };
  }, [menu]);
  const load = useCallback(() => api.get(`/apps/${appId}/cases`).then(setCases).catch(setErr), [appId]);
  useEffect(() => { setSel({}); load(); }, [load]);
  useEvents('script', (s) => s.appId === appId && setCases((cs) => cs?.map((c) => (c.id === s.caseId ? { ...c, script: s.script } : c))));
  useEvents('app', (e) => e.id === appId && load());

  const doImportManual = async (file) => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post(`/apps/${appId}/manual/analyze`, fd);
      setManualOpen(r.id);
    } catch (e) { setErr(e); }
    setBusy(false);
  };
  const doImport = async (file, into = null, kind = kindRef.current) => {
    if (!file) return;
    if (kind === 'manual') return doImportManual(file);
    setBusy(true); setErr(null); setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (into) fd.append('into', into);
      const r = await api.post(`/apps/${appId}/testcases`, fd);
      setFileF(r.file);
      setMsg(`Đã import ${r.file}.xlsx: ${r.total} case (${r.added} mới, ${r.changed} đổi bước${r.removed ? `, ${r.removed} bị xoá` : ''}).${r.changed ? ' Chỉ case đổi bước cần gen lại script.' : ''}`);
      load();
    } catch (e) {
      // File tên khác nhưng trùng nhiều case với file đã import → hỏi cập nhật file cũ (giữ script) hay tách file mới
      const m = e.status === 409 && e.data?.match;
      if (m) {
        setBusy(false);
        if (window.confirm(`"${file.name}" có ${m.overlap}/${m.total} case trùng TC ID với ${m.file}.xlsx đã import (${m.existing} case).\n\nCập nhật ${m.file}.xlsx bằng file này? Case không đổi giữ nguyên script, chỉ case bị sửa phải gen lại; case không còn trong file mới sẽ bị xoá.`)) return doImport(file, m.file);
        if (window.confirm(`Import "${file.name}" thành file riêng? Toàn bộ ${m.total} case là case mới, phải gen script từ đầu.`)) return doImport(file, '*new');
        return;
      }
      setErr(e);
    }
    setBusy(false);
  };
  // Xoá: xem trước (số case, case "Tiếp nối" bị ảnh hưởng) → hỏi xác nhận → xoá
  const remove = async (sel, what) => {
    setErr(null);
    try {
      const plan = await api.post(`/apps/${appId}/cases/remove-plan`, sel);
      if (!plan.ids.length) return;
      const orphan = plan.orphans.length ? `\n\n⚠ ${plan.orphans.length} case "Tiếp nối" case bị xoá sẽ không chạy được nữa: ${plan.orphans.slice(0, 8).map((o) => o.tcId).join(', ')}${plan.orphans.length > 8 ? '…' : ''}` : '';
      const files = sel.caseIds ? '' : `\nXoá cả bản copy Excel và file script: ${plan.files.map((f) => `${f}.xlsx`).join(', ')}.`;
      if (!window.confirm(`Xoá ${what} — ${plan.ids.length} case?${files}\nLịch sử run cũ vẫn giữ. Case xoá lẻ sẽ quay lại nếu import lại đúng file Excel đó.${orphan}`)) return;
      const r = await api.post(`/apps/${appId}/cases/remove`, sel);
      setSel({});
      if (sel.file || sel.all) setFileF('');
      setMsg(`Đã xoá ${r.removed} case.`);
      load();
    } catch (e) { setErr(e); }
  };
  // Dừng gen: case đã gen trước đó giữ script cũ, case chưa gen về "Chưa gen"
  const stopGen = async (body) => {
    setErr(null);
    try {
      const r = await api.post(`/apps/${appId}/scripts/cancel`, body);
      setMsg(r.cancelled ? `Đã dừng gen ${r.cancelled} case.` : 'Không còn case nào đang gen.');
    } catch (e) { setErr(e); }
  };
  const generate = async (only) => {
    setErr(null);
    try {
      const ids = only || Object.keys(sel).filter((k) => sel[k]);
      await api.post(`/apps/${appId}/scripts/generate`, { caseIds: ids });
      setMsg(`Đang gen script cho ${ids.length} case — trạng thái cập nhật trực tiếp trong bảng.`);
    } catch (e) { setErr(e); }
  };

  const files = [...new Set((cases || []).map((c) => c.file))];
  // File đang mở: theo ?file=, mặc định file đầu tiên
  const cur = files.includes(fileF) ? fileF : files[0] || '';
  const inFile = (cases || []).filter((c) => c.file === cur);
  // Kết quả lần chạy gần nhất của từng case (lấy từ lịch sử run của app)
  const lastMap = useMemo(() => {
    const m = {};
    const t = (r) => new Date(r.startedAt || 0).getTime();
    [...runs].sort((a, b) => t(a) - t(b)).forEach((r) => {
      // results theo TC ID; caseIds[i] ↔ order[i] cho biết case thuộc file nào. Hai file có TC ID trùng không được lẫn kết quả → khoá theo id đầy đủ (app:file:TC)
      (r.order || Object.keys(r.results || {})).forEach((tc, i) => {
        const v = (r.results || {})[tc];
        if (!v || ['notrun', 'queued', 'running'].includes(v.status)) return; // chưa chạy thật thì không tính là kết quả
        const key = r.caseIds?.[i] || `${r.appId}:${tc}`;
        m[key] = { s: v.status, run: r.id, at: t(r) };
      });
    });
    return m;
  }, [runs]);
  // Cảnh báo locator → màn thiếu / phần tử thiếu
  const locInfo = useMemo(() => {
    const m = {};
    for (const c of cases || []) {
      const miss = [], els = [];
      for (const w of c.script.warnings || []) {
        const a = /^Màn "([^"]+)" chưa có trong locator map/.exec(w);
        const b = /^Màn (.+?): không tìm thấy "(.+?)" trong locator map/.exec(w);
        if (a) miss.push(a[1]); else if (b) els.push([b[1], b[2]]);
      }
      m[c.id] = { miss: [...new Set(miss)], els };
    }
    return m;
  }, [cases]);
  const hasLoc = (c) => locInfo[c.id] && (locInfo[c.id].miss.length > 0 || locInfo[c.id].els.length > 0);
  const isAttn = (c) => ['failed', 'blocked'].includes(lastMap[c.id]?.s);
  const fileStat = (list) => {
    const st = { n: list.length, p: 0, f: 0, s: 0, ran: 0, gen: 0 };
    for (const c of list) {
      const r = lastMap[c.id]?.s;
      if (r) st.ran++;
      if (r === 'passed') st.p++; else if (r === 'failed') st.f++; else if (r) st.s++;
      if (c.script.status === 'generated') st.gen++;
    }
    return st;
  };
  const curSt = fileStat(inFile);
  const counts = useMemo(() => {
    const m = {};
    for (const c of inFile) m[c.script.status] = (m[c.script.status] || 0) + 1;
    return m;
  }, [cases, cur]);
  const attnN = inFile.filter(isAttn).length;
  const locN = inFile.filter(hasLoc).length;
  // Màn thiếu trong locator map của file đang mở, xếp theo số case bị ảnh hưởng
  const missScreens = useMemo(() => {
    const m = new Map();
    for (const c of inFile) for (const sc of new Set([...locInfo[c.id].miss, ...locInfo[c.id].els.map((e) => e[0])])) m.set(sc, (m.get(sc) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [inFile, locInfo]);
  const genN = (cases || []).filter((c) => c.script.status === 'generating').length;
  const shown = inFile.filter((c) => (!filter
    || (filter === 'warn' ? hasLoc(c) : filter === 'attn' ? isAttn(c) : filter === 'pass' ? lastMap[c.id]?.s === 'passed' : c.script.status === filter))
    && (!q || `${c.tcId} ${c.title}`.toLowerCase().includes(q.toLowerCase())));
  const groups = useMemo(() => {
    const g = new Map();
    for (const c of shown) {
      if (!g.has(c.module)) g.set(c.module, { module: c.module, items: [] });
      g.get(c.module).items.push(c);
    }
    // case fail / blocked lên đầu mỗi nhóm
    for (const x of g.values()) x.items = [...x.items.filter(isAttn), ...x.items.filter((c) => !isAttn(c))];
    return [...g.values()];
  }, [shown, lastMap]);
  const picked = Object.keys(sel).filter((k) => sel[k]);
  const toggle = (ids, v) => setSel((s0) => { const n = { ...s0 }; ids.forEach((id) => (v ? (n[id] = true) : delete n[id])); return n; });
  const todo = inFile.filter((c) => ['none', 'failed', 'stale'].includes(c.script.status));
  const showScriptCol = inFile.some((c) => c.script.status !== 'generated');
  const fmtD = (iso) => (iso ? new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) : '');
  const impAt = (list) => fmtD(list.map((c) => c.importedAt).filter(Boolean).sort()[0]);
  const srcManual = manuals.find((m) => cur.startsWith(m.stem));
  const goRun = () => nav(`/apps/${appId}/run?${new URLSearchParams({ cases: picked.join(','), ...(cur ? { file: cur } : {}) })}`);
  const genAll = () => {
    const min = Math.ceil((todo.length / 3) * 1.5);
    if (window.confirm(`Gen script cho ${todo.length} case chưa có script trong ${cur}.xlsx (gồm cả case gen lỗi / cần gen lại)?\nAI chạy 3 case cùng lúc, ước tính khoảng ${min} phút. Bạn vẫn dùng tool bình thường trong lúc chờ.`)) generate(todo.map((c) => c.id));
  };

  if (!app) return <main className="content"><div className="skel" style={{ height: 240 }} /></main>;
  const dropProps = {
    onDragOver: (e) => { e.preventDefault(); setDrag(true); },
    onDragLeave: () => setDrag(false),
    onDrop: (e) => { e.preventDefault(); setDrag(false); doImport(e.dataTransfer.files[0]); },
  };
  const RES = { passed: ['pass', 'Pass'], failed: ['fail', 'Fail'], blocked: ['blk', 'Blocked'], skipped: ['', 'Skipped'] };
  const resCell = (c) => {
    const r = lastMap[c.id];
    if (!r) return <span className="dotl none">Chưa chạy</span>;
    const [cls, label] = RES[r.s] || ['', r.s];
    return <span className={`dotl ${cls}`}>{label}<Link to={`/runs/${r.run}`} className="cap tc-run">{r.run.replace('RUN-0', '#')}</Link></span>;
  };
  const resBar = (st) => (
    <>
      <div className="rbar" role="img" aria-label={st.ran ? `Pass ${st.p}, Fail ${st.f}, còn lại ${st.s}` : 'Chưa chạy'}>
        <i className="p" style={{ width: `${(st.p / st.n) * 100}%` }} /><i className="f" style={{ width: `${(st.f / st.n) * 100}%` }} /><i className="s" style={{ width: `${(st.s / st.n) * 100}%` }} />
      </div>
      <span className="rtxt num">{st.ran ? <><b>{st.p}</b> pass · <b className="fail-n">{st.f}</b> fail{st.s ? ` · ${st.s} skip` : ''}</> : 'Chưa chạy lần nào'}</span>
    </>
  );
  const converting = manuals.filter((m) => m.status === 'converting');
  const pickKind = (k) => { kindRef.current = k; setMenu(false); fileRef.current?.click(); };
  const warnRows = (c) => {
    const li = locInfo[c.id];
    const names = [...li.miss, ...li.els.map((e) => `${e[0]} › ${e[1]}`)];
    if (!names.length) return null;
    return <span className="sub warn-txt" title={c.script.warnings.join('\n')}><Icon name="warn" size={12} />Thiếu locator: {names.slice(0, 2).join(', ')}{names.length > 2 ? ` +${names.length - 2}` : ''}</span>;
  };
  return (
    <main className="content content-wide" {...dropProps}>
      <PageHeader title="Test Cases" sub={`${app.name} · ${files.length} file · ${cases?.length ?? 0} case`}>
        {genN > 0 && <button className="btn btn-danger" type="button" onClick={() => stopGen({ all: true })} title="Dừng mọi case đang gen / chờ gen của app"><Icon name="stop" />Dừng gen ({genN})</button>}
        <div className="menu">
          <button className="btn" type="button" aria-haspopup="menu" aria-expanded={menu} disabled={busy} onClick={(e) => { e.stopPropagation(); setMenu((v) => !v); }}>
            <Icon name="upload" />{busy ? 'Đang xử lý…' : 'Import Excel'}<Icon name="chev" size={14} />
          </button>
          <div className={menu ? 'pop open' : 'pop'} role="menu" onClick={(e) => e.stopPropagation()}>
            <button className="mi2" type="button" role="menuitem" onClick={() => pickKind('automation')}><span className="ic"><Icon name="code" /></span><span><b>Automation</b><span className="cap">File đã đúng định dạng automation. Import xong gen script cho case cần chạy.</span></span></button>
            <button className="mi2" type="button" role="menuitem" onClick={() => pickKind('manual')}><span className="ic"><Icon name="cases" /></span><span><b>Manual</b><span className="cap">File test case viết tay. Tool tự lọc case automate được, chuyển sang automation rồi gen script.</span></span></button>
          </div>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => { doImport(e.target.files[0]); e.target.value = ''; }} />
        <input ref={reRef} type="file" accept=".xlsx" hidden onChange={(e) => { doImport(e.target.files[0], cur, 'automation'); e.target.value = ''; }} />
      </PageHeader>
      <ErrorNote error={err} />
      {converting.map((m) => (
        <div key={m.id} className="alert alert-info conv-row" role="status">
          <Icon name="refresh" />
          <div style={{ flex: 1 }}>
            <b className="mono">{m.fileName}</b> <span className="cap">· Đang chuyển manual → automation{m.progress ? ` · ${m.progress.done}/${m.progress.total} nhóm` : ''}</span>
            {m.progress && <div className="conv"><i style={{ width: `${(m.progress.done / Math.max(1, m.progress.total)) * 100}%` }} /></div>}
          </div>
          <button className="btn btn-sm" type="button" onClick={() => setManualOpen(m.id)}>Xem tiến trình</button>
        </div>
      ))}
      {manualOpen && <ManualImport importId={manualOpen} onClose={() => { setManualOpen(null); load(); loadManuals(); }} />}
      {msg && <div className="alert alert-info" role="status"><Icon name="check" /><div>{msg}</div></div>}
      {cases && cases.length === 0 ? (
        <section className={drag ? 'card drop on' : 'card drop'}>
          <Empty icon="upload" title="Chưa import file test case nào">
            <span>Kéo file Excel vào đây, hoặc dùng Import Excel: Automation (sheet TestCases: Kind / Screen / Keyword / Target / Value) hoặc Manual (cột "Test Case #"). Mỗi file hiện thành một dòng; mở file để chọn case và chạy.</span>
            <button className="btn btn-primary" type="button" onClick={() => pickKind('automation')} style={{ marginTop: 8 }}><Icon name="upload" />Chọn file .xlsx</button>
          </Empty>
        </section>
      ) : (
        <div className="sp2">
          <section className="card file-list" aria-label="Danh sách file test case">
            {files.map((f) => {
              const list = (cases || []).filter((c) => c.file === f);
              return (
                <button key={f} type="button" className="fi" aria-current={f === cur ? 'true' : undefined} onClick={() => { setFileF(f); setFilter(''); setQ(''); }}>
                  <span className="fn">{f}</span>
                  <span className="cap num">{list.length} case · import {impAt(list)}</span>
                  {resBar(fileStat(list))}
                </button>
              );
            })}
          </section>
          <div className="stack-16 file-detail">
            <div className="fh">
              <div className="grow"><h2>{cur}.xlsx</h2>
                <span className="cap">{inFile.length} case · import {impAt(inFile)}{srcManual ? ` · từ ${srcManual.fileName} · ${srcManual.counts.cases - srcManual.counts.manual} automate / ${srcManual.counts.manual} manual` : ''} · script {curSt.gen}/{curSt.n}</span>
                {srcManual && <button className="linkbtn" type="button" onClick={() => setManualOpen(srcManual.id)} style={{ marginLeft: 8 }}>Mở danh sách automate / manual</button>}
              </div>
              <button className="btn btn-sm" type="button" onClick={genAll} disabled={!todo.length}><Icon name="spark" />Gen script{todo.length ? ` (${todo.length})` : ''}</button>
              <button className="btn btn-sm" type="button" onClick={() => reRef.current?.click()} disabled={busy}><Icon name="refresh" />Import lại</button>
              <button className="btn btn-sm btn-ghost btn-icon btn-danger" type="button" aria-label={`Xoá file ${cur}.xlsx`} title="Xoá file này" onClick={() => remove({ file: cur }, `file ${cur}.xlsx`)}><Icon name="trash" /></button>
            </div>
            <div className="summary-line num">
              {curSt.ran ? <><span><b>{curSt.p}</b> pass</span><span><b className="fail-n">{curSt.f}</b> fail</span><span><b>{curSt.s}</b> skip / blocked</span></> : <span>Chưa chạy lần nào</span>}
              {inFile.some((c) => lastMap[c.id]) && <span className="muted">· Run gần nhất {inFile.map((c) => lastMap[c.id]).filter(Boolean).sort((a, b) => (b.at || 0) - (a.at || 0))[0].run}</span>}
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
                {attnN > 0 && <button className={filter === 'attn' ? 'chip on' : 'chip'} type="button" onClick={() => setFilter('attn')}>Cần xem <span className="count">{attnN}</span></button>}
                {curSt.p > 0 && <button className={filter === 'pass' ? 'chip on' : 'chip'} type="button" onClick={() => setFilter('pass')}>Pass <span className="count">{curSt.p}</span></button>}
                {Object.keys(SCRIPT).filter((k) => k !== 'generated' && counts[k]).map((k) => (
                  <button key={k} className={filter === k ? 'chip on' : 'chip'} type="button" onClick={() => setFilter(k)}>{SCRIPT[k][1]} <span className="count">{counts[k]}</span></button>
                ))}
                {locN > 0 && <button className={filter === 'warn' ? 'chip on chip-warn' : 'chip chip-warn'} type="button" onClick={() => setFilter('warn')}><Icon name="warn" size={12} />Thiếu locator <span className="count">{locN}</span></button>}
              </div>
              <span style={{ flex: 1 }} />
              <input className="inp search-inp" type="search" placeholder="Tìm theo ID, tiêu đề" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm case" />
            </div>
            <section className={drag ? 'card drop on' : 'card'} style={{ overflowX: 'auto' }}>
              <table className="dt tc-table">
                <thead><tr>
                  <th style={{ width: 40 }}><input className="cb" type="checkbox" aria-label="Chọn tất cả" checked={shown.length > 0 && shown.every((c) => sel[c.id])} onChange={(e) => toggle(shown.map((c) => c.id), e.target.checked)} /></th>
                  <th>ID</th><th>Test case</th><th>Bắt đầu</th><th>Lần chạy gần nhất</th>{showScriptCol && <th>Script</th>}
                </tr></thead>
                {groups.map((g) => (
                  <tbody key={g.module}>
                    {groups.length > 1 && (
                      <tr className="grp"><td><input className="cb" type="checkbox" aria-label={`Chọn module ${g.module}`} checked={g.items.every((c) => sel[c.id])} onChange={(e) => toggle(g.items.map((c) => c.id), e.target.checked)} /></td>
                        <td colSpan={showScriptCol ? 5 : 4}><b>{g.module}</b> <span className="cap">· {g.items.length} case</span></td></tr>
                    )}
                    {g.items.map((c) => (
                      <tr key={c.id} className={sel[c.id] ? 'sel' : ''}>
                        <td><input className="cb" type="checkbox" aria-label={`Chọn ${c.tcId}`} checked={!!sel[c.id]} onChange={(e) => toggle([c.id], e.target.checked)} /></td>
                        <td className="nowrap"><span className="mono">{c.tcId}</span><span className="sub cap num" style={{ display: 'block' }}>{c.steps} bước · <span className={`pr ${c.priority}`}>{c.priority}</span></span></td>
                        <td className="wrap"><Link to={`/apps/${appId}/scripts?${new URLSearchParams({ file: c.file, case: c.tcId })}`} className="tc-title">{c.title}</Link>
                          {warnRows(c)}
                          {c.script.status === 'failed' && <span className="name-sub warn-txt">{c.script.error}</span>}</td>
                        <td className="cap nowrap">{c.fresh ? 'Cài lại app' : <>Sau <span className="mono">{c.prev.replace(/^TC_[A-Z]+_/, '…')}</span></>}</td>
                        <td className="nowrap">{resCell(c)}</td>
                        {showScriptCol && <td className="nowrap"><ScriptBadge script={c.script} />{c.script.status === 'generating' && <button className="btn btn-sm btn-ghost btn-icon" type="button" aria-label={`Dừng gen ${c.tcId}`} title="Dừng gen case này" onClick={() => stopGen({ caseIds: [c.id] })} style={{ marginLeft: 4 }}><Icon name="stop" size={12} /></button>}</td>}
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
              {shown.length === 0 && <Empty title="Không có case khớp bộ lọc" />}
            </section>
            {picked.length > 0 && (
              <div className="selbar">
                <b>{picked.length} case đã chọn</b>
                <button className="btn btn-sm" type="button" onClick={() => setSel({})}>Bỏ chọn</button>
                <span className="sp" />
                <button className="btn btn-sm btn-danger" type="button" onClick={() => remove({ caseIds: picked }, `${picked.length} case đã chọn`)}>Xoá</button>
                <button className="btn btn-sm" type="button" onClick={() => generate()}><Icon name="spark" />Generate script</button>
                <button className="btn btn-sm btn-primary" type="button" onClick={goRun}><Icon name="play" />Run {picked.length} case</button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

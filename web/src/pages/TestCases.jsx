import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useEvents } from '../useEvents.js';
import { Icon } from '../components/Icon.jsx';
import { Empty, ErrorNote, PageHeader } from '../components/ui.jsx';
import { SCRIPT, ScriptBadge } from '../components/scriptStatus.jsx';

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
  const load = useCallback(() => api.get(`/apps/${appId}/cases`).then(setCases).catch(setErr), [appId]);
  useEffect(() => { setSel({}); load(); }, [load]);
  useEvents('script', (s) => s.appId === appId && setCases((cs) => cs?.map((c) => (c.id === s.caseId ? { ...c, script: s.script } : c))));
  useEvents('app', (e) => e.id === appId && load());

  const doImport = async (file) => {
    if (!file) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post(`/apps/${appId}/testcases`, fd);
      setFileF(r.file);
      setMsg(`Đã import ${r.file}.xlsx: ${r.total} case (${r.added} mới, ${r.changed} đổi bước${r.removed ? `, ${r.removed} bị xoá` : ''}).`);
      load();
    } catch (e) { setErr(e); }
    setBusy(false);
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
  const inFile = (cases || []).filter((c) => !fileF || c.file === fileF);
  const counts = useMemo(() => {
    const m = {};
    for (const c of inFile) m[c.script.status] = (m[c.script.status] || 0) + 1;
    return m;
  }, [cases, fileF]);
  const warnCount = inFile.filter((c) => c.script.warnings?.length).length;
  const shown = inFile.filter((c) => (!filter || (filter === 'warn' ? c.script.warnings?.length > 0 : c.script.status === filter)) && (!q || `${c.tcId} ${c.title}`.toLowerCase().includes(q.toLowerCase())));
  const groups = useMemo(() => {
    const g = new Map();
    for (const c of shown) {
      const k = `${c.file}|${c.module}`;
      if (!g.has(k)) g.set(k, { file: c.file, module: c.module, items: [] });
      g.get(k).items.push(c);
    }
    return [...g.values()];
  }, [shown]);
  const picked = Object.keys(sel).filter((k) => sel[k]);
  const toggle = (ids, v) => setSel((s) => { const n = { ...s }; ids.forEach((id) => (v ? (n[id] = true) : delete n[id])); return n; });
  const todo = inFile.filter((c) => ['none', 'failed', 'stale'].includes(c.script.status));
  const genAll = () => {
    const min = Math.ceil((todo.length / 3) * 1.5);
    if (window.confirm(`Gen script cho ${todo.length} case chưa có script${fileF ? ` trong ${fileF}.xlsx` : ''} (gồm cả case gen lỗi / cần gen lại)?\nAI chạy 3 case cùng lúc, ước tính khoảng ${min} phút. Bạn vẫn dùng tool bình thường trong lúc chờ.`)) generate(todo.map((c) => c.id));
  };

  if (!app) return <main className="content"><div className="skel" style={{ height: 240 }} /></main>;
  const dropProps = {
    onDragOver: (e) => { e.preventDefault(); setDrag(true); },
    onDragLeave: () => setDrag(false),
    onDrop: (e) => { e.preventDefault(); setDrag(false); doImport(e.dataTransfer.files[0]); },
  };
  return (
    <main className="content content-wide" {...dropProps}>
      <PageHeader title="Test Cases" sub={`${app.name} · ${cases?.length ?? 0} case từ ${files.length} file Excel`}>
        <button className="btn" type="button" onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="upload" />{busy ? 'Đang import…' : 'Import Excel'}</button>
        {picked.length > 0
          ? <button className="btn" type="button" onClick={() => generate()}><Icon name="spark" />Generate script ({picked.length})</button>
          : <button className="btn" type="button" onClick={genAll} disabled={!todo.length}><Icon name="spark" />Gen tất cả chưa có script{todo.length ? ` (${todo.length})` : ''}</button>}
        <button className="btn btn-primary" type="button" title={picked.length ? '' : 'Tick chọn case trong bảng trước'} onClick={() => nav(`/apps/${appId}/run?cases=${encodeURIComponent(picked.join(','))}`)} disabled={!picked.length}><Icon name="play" />Run{picked.length ? ` (${picked.length})` : ''}</button>
        <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => { doImport(e.target.files[0]); e.target.value = ''; }} />
      </PageHeader>
      <ErrorNote error={err} />
      {msg && <div className="alert alert-info" role="status"><Icon name="check" /><div>{msg}</div></div>}
      {cases && cases.length === 0 ? (
        <section className={drag ? 'card drop on' : 'card drop'}>
          <Empty icon="upload" title="Kéo file Excel test case vào đây">
            <span>Format automation v2: sheet TestCases (Kind / Screen / Keyword / Target / Value) và TestData.</span>
            <button className="btn btn-primary" type="button" onClick={() => fileRef.current?.click()} style={{ marginTop: 8 }}><Icon name="upload" />Chọn file .xlsx</button>
          </Empty>
        </section>
      ) : (
        <>
          <div className="fbar">
            {files.length > 1 && (
              <label className="file-pick">
                <Icon name="file" size={14} />
                <span className="sr-only">Lọc theo file Excel</span>
                <select className="sel" value={fileF} onChange={(e) => setFileF(e.target.value)}>
                  <option value="">Tất cả file ({cases?.length ?? 0})</option>
                  {files.map((f) => <option key={f} value={f}>{f}.xlsx ({(cases || []).filter((c) => c.file === f).length})</option>)}
                </select>
              </label>
            )}
            <div className="chips" role="group" aria-label="Lọc theo trạng thái script">
              <button className={!filter ? 'chip on' : 'chip'} type="button" onClick={() => setFilter('')}>Tất cả <span className="count">{inFile.length}</span></button>
              {Object.keys(SCRIPT).filter((k) => counts[k]).map((k) => (
                <button key={k} className={filter === k ? 'chip on' : 'chip'} type="button" onClick={() => setFilter(k)}>{SCRIPT[k][1]} <span className="count">{counts[k]}</span></button>
              ))}
              {warnCount > 0 && <button className={filter === 'warn' ? 'chip on chip-warn' : 'chip chip-warn'} type="button" onClick={() => setFilter('warn')}><Icon name="warn" size={12} />Có cảnh báo <span className="count">{warnCount}</span></button>}
            </div>
            <span style={{ flex: 1 }} />
            <input className="inp search-inp" type="search" placeholder="Tìm theo ID, tiêu đề" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm case" />
          </div>
          <section className={drag ? 'card drop on' : 'card'} style={{ overflow: 'hidden' }}>
            <table className="dt tc-table">
              <thead><tr>
                <th style={{ width: 40 }}><input className="cb" type="checkbox" aria-label="Chọn tất cả" checked={shown.length > 0 && shown.every((c) => sel[c.id])} onChange={(e) => toggle(shown.map((c) => c.id), e.target.checked)} /></th>
                <th>ID</th><th>Test case</th><th>Bắt đầu</th><th className="r">Bước</th><th>Priority</th><th>Script</th>
              </tr></thead>
              {groups.map((g) => (
                <tbody key={`${g.file}|${g.module}`}>
                  <tr className="grp"><td><input className="cb" type="checkbox" aria-label={`Chọn module ${g.module}`} checked={g.items.every((c) => sel[c.id])} onChange={(e) => toggle(g.items.map((c) => c.id), e.target.checked)} /></td>
                    <td colSpan={6}><b>{g.module}</b> <span className="cap">{fileF ? '' : `· ${g.file} `}· {g.items.length} case</span></td></tr>
                  {g.items.map((c) => (
                    <tr key={c.id} className={sel[c.id] ? 'sel' : ''}>
                      <td><input className="cb" type="checkbox" aria-label={`Chọn ${c.tcId}`} checked={!!sel[c.id]} onChange={(e) => toggle([c.id], e.target.checked)} /></td>
                      <td className="mono">{c.tcId}</td>
                      <td className="wrap"><Link to={`/apps/${appId}/scripts?file=${c.file}&case=${c.tcId}`} className="tc-title">{c.title}</Link>
                        {c.script.warnings?.length > 0 && <span className="name-sub warn-txt" title={c.script.warnings.join('\n')}><Icon name="warn" size={12} /><span className="clamp-2">{c.script.warnings[0]}</span>{c.script.warnings.length > 1 ? ` (+${c.script.warnings.length - 1})` : ''}</span>}
                        {c.script.status === 'failed' && <span className="name-sub warn-txt">{c.script.error}</span>}</td>
                      <td className="cap">{c.fresh ? 'Cài lại app' : <>Sau <span className="mono">{c.prev}</span></>}</td>
                      <td className="r mono">{c.steps}</td>
                      <td className="cap">{c.priority}</td>
                      <td><ScriptBadge script={c.script} /></td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
            {shown.length === 0 && <Empty title="Không có case khớp bộ lọc" />}
          </section>
          <div className={picked.length ? 'selbar' : 'card selbar-idle'}>
            {picked.length ? <>
              <b>{picked.length} case đã chọn</b>
              <button className="btn btn-sm" type="button" onClick={() => setSel({})}>Bỏ chọn</button>
              <span className="sp" />
              <button className="btn btn-sm" type="button" onClick={() => generate()}><Icon name="spark" />Generate script</button>
              <button className="btn btn-sm btn-primary" type="button" onClick={() => nav(`/apps/${appId}/run?cases=${encodeURIComponent(picked.join(','))}`)}><Icon name="play" />Run</button>
            </> : <span className="cap">Tick chọn case trong bảng, rồi bấm <b>Run</b> (case chưa có script thì Generate trước). Case "Sau TC…" chạy kèm các case phía trước.</span>}
          </div>
        </>
      )}
    </main>
  );
}

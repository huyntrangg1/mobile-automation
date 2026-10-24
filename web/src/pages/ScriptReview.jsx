import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { EditorView } from '@codemirror/view';
import { api } from '../api.js';
import { useEvents } from '../useEvents.js';
import { Icon } from '../components/Icon.jsx';
import { Empty, ErrorNote, PageHeader } from '../components/ui.jsx';
import { ScriptBadge } from '../components/scriptStatus.jsx';

const KIND = { Action: 'k-act', Nav: 'k-nav', Check: 'k-chk' };

export function ScriptReview({ apps }) {
  const { appId } = useParams();
  const [params, setParams] = useSearchParams();
  const [files, setFiles] = useState(null);
  const file = params.get('file') || files?.[0]?.file;
  const [doc, setDoc] = useState(null);
  const [code, setCode] = useState('');
  const [caseId, setCaseId] = useState(params.get('case'));
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const viewRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [allWarn, setAllWarn] = useState(false);
  const app = apps.find((a) => a.id === appId);

  useEffect(() => { api.get(`/apps/${appId}/scripts`).then(setFiles).catch(setErr); }, [appId]);
  const [changed, setChanged] = useState(false); // file trên server đổi trong lúc đang sửa
  const editing = useRef(false);
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
  const cur = doc?.cases.find((c) => c.tcId === caseId) || doc?.cases.find((c) => c.line) || doc?.cases[0];
  useEffect(() => { if (cur) api.get(`/cases/${encodeURIComponent(cur.id)}`).then(setDetail); }, [cur?.id, cur?.script?.status]);
  const dirty = doc && code !== doc.code;
  editing.current = !!dirty;

  // Nhảy editor tới region của case đang chọn
  useEffect(() => {
    const v = viewRef.current;
    if (!v || !cur?.line || dirty) return;
    const line = v.state.doc.line(Math.min(cur.line, v.state.doc.lines));
    v.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 24 }) });
    document.getElementById(`sr-${cur.tcId}`)?.scrollIntoView({ block: 'nearest' });
  }, [cur?.id, cur?.line, doc?.code, ready]);

  const pick = (c) => { setCaseId(c.tcId); setParams({ file, case: c.tcId }, { replace: true }); };
  const save = async () => {
    setErr(null);
    try { await api.put(`/apps/${appId}/scripts/${file}`, { code, hash: doc.hash }); setMsg('Đã lưu'); setTimeout(() => setMsg(null), 2000); load(); } catch (e) { setErr(e); if (e.status === 409) setChanged(true); }
  };
  const regen = () => api.post(`/apps/${appId}/scripts/generate`, { caseIds: [cur.id] }).catch(setErr);
  const reviewed = () => api.post(`/cases/${encodeURIComponent(cur.id)}/reviewed`, { reviewed: !cur.script.reviewed }).then(load).catch(setErr);
  const exts = useMemo(() => [javascript(), EditorView.lineWrapping], []);

  if (!app) return <main className="content"><div className="skel" style={{ height: 240 }} /></main>;
  if (files && files.length === 0) return (
    <main className="content"><PageHeader title="Scripts" /><section className="card"><Empty icon="code" title="Chưa có file test case"><Link className="btn btn-primary" to={`/apps/${appId}/cases`}>Import Excel</Link></Empty></section></main>
  );
  return (
    <main className="content content-wide sr-page">
      <PageHeader title={`${file || ''}.e2e.js`} sub="Một file script cho cả file Excel · mỗi case là một region · review là tuỳ chọn">
        {files?.length > 1 && (
          <select className="sel" value={file} onChange={(e) => setParams({ file: e.target.value })} aria-label="File script">
            {files.map((f) => <option key={f.file} value={f.file}>{f.file}.e2e.js</option>)}
          </select>
        )}
        {msg && <span className="cap" role="status">{msg}</span>}
        <button className="btn" type="button" onClick={() => setCode(doc.code)} disabled={!dirty}>Bỏ sửa</button>
        <button className="btn btn-primary" type="button" onClick={save} disabled={!dirty}>Lưu file</button>
      </PageHeader>
      <ErrorNote error={err} />
      {changed && (
        <div className="alert alert-warn"><Icon name="warn" /><div style={{ flex: 1 }}>File vừa thay đổi trên server (một case gen xong hoặc lưu ở tab khác). Phần bạn đang sửa chưa được lưu.</div>
          <button className="btn btn-sm" type="button" onClick={() => { navigator.clipboard?.writeText(code); load(); }}>Sao chép phần đang sửa rồi tải lại</button></div>
      )}
      <div className="sr">
        <nav className="card sr-list" aria-label="Case trong file">
          {(doc?.cases || []).map((c) => (
            <button key={c.id} id={`sr-${c.tcId}`} type="button" className={cur?.id === c.id ? 'sr-item on' : 'sr-item'} onClick={() => pick(c)}>
              <span className="mono">{c.tcId}</span>
              <ScriptBadge script={c.script} />
              {c.script.warnings?.length > 0 && <span className="sr-warn" title={c.script.warnings.join('\n')}><Icon name="warn" size={12} />{c.script.warnings.length}</span>}
            </button>
          ))}
        </nav>
        <section className="card sr-code">
          {cur && (
            <div className="sr-case">
              <div style={{ minWidth: 0, flex: 1 }}>
                <b className="mono">{cur.tcId}</b> <span>{cur.title}</span>
                <div className="cap">{cur.fresh ? 'Cài lại app' : `Tiếp nối ${cur.prev}`}{cur.script.editedByHand ? ' · đã sửa tay' : ''}</div>
              </div>
              <button className="btn btn-sm" type="button" onClick={regen} disabled={cur.script.status === 'generating'}><Icon name="spark" />{cur.script.status === 'none' ? 'Gen' : 'Gen lại'}</button>
              <button className={cur.script.reviewed ? 'btn btn-sm on-ok' : 'btn btn-sm'} type="button" onClick={reviewed} disabled={cur.script.status !== 'generated'}><Icon name="check" />{cur.script.reviewed ? 'Đã review' : 'Đánh dấu đã review'}</button>
            </div>
          )}
          {cur?.script.status === 'failed' && <div className="alert alert-err" style={{ margin: '0 16px 12px' }}><Icon name="warn" /><div><b>Gen lỗi:</b> {cur.script.error}</div></div>}
          {cur?.script.warnings?.length > 0 && (
            <div className="alert alert-warn" style={{ margin: '0 16px 12px' }}><Icon name="warn" /><div style={{ flex: 1, minWidth: 0 }}>
              <ul className="warn-list">{(allWarn ? cur.script.warnings : cur.script.warnings.slice(0, 2)).map((w) => <li key={w}>{w}</li>)}</ul>
              {cur.script.warnings.length > 2 && <button className="linkbtn" type="button" onClick={() => setAllWarn(!allWarn)}>{allWarn ? 'Thu gọn' : `Xem thêm ${cur.script.warnings.length - 2} cảnh báo`}</button>}</div></div>
          )}
          {doc && !doc.code ? <Empty icon="code" title="File chưa có case nào được gen">Chọn case ở Test Cases → Generate script, hoặc bấm Gen ở trên.</Empty> : (
            <CodeMirror value={code} height="calc(100vh - 300px)" extensions={exts} onChange={setCode} onCreateEditor={(v) => { viewRef.current = v; setReady(true); }} basicSetup={{ foldGutter: true }} aria-label="Code test script" />
          )}
        </section>
        <aside className="card sr-steps" aria-label="Bước trong Excel">
          <div className="card-h"><h2>Bước trong Excel</h2></div>
          {detail?.pre?.length > 0 && <div className="sr-pre cap">{detail.pre.map((p) => <div key={p}>{p}</div>)}</div>}
          <ol className="steps">
            {(detail?.rows || []).map((r, i) => (
              <li key={i}><span className={`kind ${KIND[r.kind] || ''}`}>{r.kind}</span>
                <div><span className="mono cap">{r.step} · {r.screen}</span><div><b>{r.keyword}</b> {r.target && <>“{r.target}”</>} {r.value && <span className="muted">= {r.value}</span>}</div>{r.label && <div className="cap">{r.label}</div>}</div></li>
            ))}
          </ol>
        </aside>
      </div>
    </main>
  );
}

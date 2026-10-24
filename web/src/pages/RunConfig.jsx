import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useEvents } from '../useEvents.js';
import { Icon } from '../components/Icon.jsx';
import { Drawer, ErrorNote } from '../components/ui.jsx';
import { ScriptBadge } from '../components/scriptStatus.jsx';

export function RunConfig({ lock, apps = [] }) {
  const { appId } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const caseIds = (params.get('cases') || '').split(',').filter(Boolean);
  const [plan, setPlan] = useState(null);
  const [sims, setSims] = useState([]);
  const [udid, setUdid] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.post(`/apps/${appId}/run-plan`, { caseIds }).then(setPlan).catch(setErr);
    const platform = apps.find((a) => a.id === appId)?.platform || 'iOS';
    api.get(`/devices?platform=${platform}`).then((l) => { setSims(l); setUdid(l[0]?.udid || ''); }).catch(setErr);
  }, [appId, params.get('cases'), apps.find((a) => a.id === appId)?.platform]);
  const close = () => nav(`/apps/${appId}/cases`);
  const start = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.post(`/apps/${appId}/runs`, { udid, caseIds }); nav(`/runs/${r.id}`); } catch (e) { setErr(e); setBusy(false); }
  };
  const ready = plan && plan.missing.length === 0 && plan.run.length > 0;
  const genMissing = async () => {
    setErr(null);
    try {
      await api.post(`/apps/${appId}/scripts/generate`, { caseIds: plan.missing.map((m) => m.id) });
      setPlan({ ...plan, missing: plan.missing.map((m) => ({ ...m, reason: 'Đang gen script…' })) });
    } catch (e) { setErr(e); }
  };
  useEvents('script', (s) => s.appId === appId && api.post(`/apps/${appId}/run-plan`, { caseIds }).then(setPlan).catch(() => {}));
  const warned = plan?.cases.filter((c) => c.script.warnings?.length) || [];
  const warnN = warned.length;
  return (
    <Drawer title={`Run ${caseIds.length} case đã chọn`} sub={apps.find((a) => a.id === appId)?.platform || 'iOS'} onClose={close}
      footer={<><span className="cap">Report tạo tự động khi run xong.</span><span style={{ flex: 1 }} /><button className="btn" type="button" onClick={close}>Huỷ</button>
        <button className="btn btn-primary" type="button" onClick={start} disabled={!ready || busy || !udid || !!lock}><Icon name="play" />{busy ? 'Đang bắt đầu…' : `Start run (${plan?.run.length || 0})`}</button></>}>
      <ErrorNote error={err} />
      {lock && <div className="alert alert-warn"><Icon name="warn" /><div>Thiết bị đang bận: <b>{lock.label}</b>.</div></div>}
      <label className="field"><span className="label">Thiết bị</span>
        <select className="sel" value={udid} onChange={(e) => setUdid(e.target.value)}>
          {sims.map((s) => <option key={s.udid} value={s.udid}>{s.name} · {s.os}{s.booted ? ' — đang bật' : ''}</option>)}
        </select></label>
      {plan && (
        <>
          {plan.added.length > 0 && (
            <div className="alert alert-info"><Icon name="arrow" /><div>Thêm <b>{plan.added.length} case phía trước</b> để app ở đúng trạng thái (case đã chọn "tiếp nối" các case này).</div></div>
          )}
          {plan.missing.length > 0 && (
            <div className="alert alert-err"><Icon name="warn" />
              <div style={{ flex: 1 }}><b>{plan.missing.length} case chưa chạy được</b>
                <ul className="warn-list">{plan.missing.map((m) => <li key={m.id}><span className="mono">{m.tcId}</span> — {m.reason} · <Link to={`/apps/${appId}/scripts?file=${m.id.split(':')[1]}&case=${m.tcId}`}>Mở script</Link></li>)}</ul>
                <button className="btn btn-sm" type="button" style={{ marginTop: 8 }} onClick={genMissing}><Icon name="spark" />Gen script cho {plan.missing.length} case này</button></div></div>
          )}
          {warnN > 0 && (
            <div className="alert alert-warn"><Icon name="warn" />
              <div style={{ flex: 1, minWidth: 0 }}><b>{warnN} case có cảnh báo khi gen</b> — vẫn chạy được; nên review trước.
                <ul className="warn-cases">{warned.map((c) => (
                  <li key={c.id}><span className="mono">{c.tcId}</span> <span className="clamp-2">{c.script.warnings[0]}{c.script.warnings.length > 1 ? ` (+${c.script.warnings.length - 1})` : ''}</span>
                    <Link to={`/apps/${appId}/scripts?file=${c.file}&case=${c.tcId}`}>Xem</Link></li>
                ))}</ul></div></div>
          )}
          <section className="field">
            <span className="label">{plan.run.length} case sẽ chạy, theo thứ tự trong file</span>
            <div className="list run-list">
              {plan.cases.map((c, i) => (
                <div className="li" key={c.id}>
                  <span className="cap mono" style={{ width: 20 }}>{i + 1}</span>
                  <span className="mono" style={{ width: 120 }}>{c.tcId}</span>
                  <span style={{ flex: 1, minWidth: 0 }} className="trunc-2">{c.title}{plan.added.includes(c.id) && <span className="cap"> · thêm vào chuỗi</span>}</span>
                  <ScriptBadge script={c.script} />
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </Drawer>
  );
}

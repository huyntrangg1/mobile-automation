import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useEvents } from '../useEvents.js';
import { Icon } from '../components/Icon.jsx';
import { Drawer, ErrorNote } from '../components/ui.jsx';
import { DevicePicker, WrongPlatform, useDevices } from '../components/DevicePicker.jsx';
import { ScriptBadge } from '../components/scriptStatus.jsx';
import { loadManualFix, saveManualFix } from '../manualFix.js';

export function RunConfig({ lock, apps = [] }) {
  const { appId } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const caseIds = (params.get('cases') || '').split(',').filter(Boolean);
  const fileF = params.get('file');
  const app = apps.find((a) => a.id === appId);
  const [plan, setPlan] = useState(null);
  const [manualFix, setManualFix] = useState(loadManualFix);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.post(`/apps/${appId}/run-plan`, { caseIds }).then(setPlan).catch(setErr); }, [appId, params.get('cases')]);
  // Chờ biết app là iOS hay Android rồi mới lấy thiết bị (mở thẳng URL khi danh sách app chưa tải xong)
  const platform = app ? app.platform || 'iOS' : null;
  const { devices: sims, udid, setUdid, picked, wrong: wrongPlatform } = useDevices(platform, setErr);
  // Kiểm tra trước khi chạy (thiết bị, file app, cú pháp script, chuỗi Tiếp nối…): chạy lại khi đổi thiết bị / danh sách case / script
  const [pf, setPf] = useState(null);
  const recheck = () => udid && api.post(`/apps/${appId}/preflight`, { udid, caseIds }).then(setPf).catch(() => setPf(null));
  useEffect(() => { setPf(null); recheck(); }, [appId, udid, params.get('cases')]);
  useEvents('script', (s) => s.appId === appId && recheck());
  const close = () => nav(`/apps/${appId}/cases${fileF ? `?${new URLSearchParams({ file: fileF })}` : ''}`);
  const start = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.post(`/apps/${appId}/runs`, { udid, caseIds, manualFix }); nav(`/runs/${r.id}`); } catch (e) { setErr(e); setBusy(false); }
  };
  const ready = plan && !wrongPlatform && plan.missing.length === 0 && plan.run.length > 0 && pf?.ok !== false;
  // Chỉ gen case thật sự thiếu script — case chỉ thiếu "case phía trước" giữ nguyên script đang có
  const needGen = plan?.missing.filter((m) => m.needsScript) || [];
  const genMissing = async () => {
    setErr(null);
    try {
      await api.post(`/apps/${appId}/scripts/generate`, { caseIds: needGen.map((m) => m.id) });
      setPlan({ ...plan, missing: plan.missing.map((m) => (m.needsScript ? { ...m, needsScript: false, reason: 'Đang gen script…' } : m)) });
    } catch (e) { setErr(e); }
  };
  useEvents('script', (s) => s.appId === appId && api.post(`/apps/${appId}/run-plan`, { caseIds }).then(setPlan).catch(() => {}));
  const warned = plan?.cases.filter((c) => c.script.warnings?.length) || [];
  const warnN = warned.length;
  return (
    <Drawer title={`Run ${caseIds.length} case đã chọn`} sub={platform || '…'} onClose={close}
      footer={<><span className="cap">Report tạo tự động khi run xong.</span><span style={{ flex: 1 }} /><button className="btn" type="button" onClick={close}>Huỷ</button>
        <button className="btn btn-primary" type="button" onClick={start} disabled={!ready || busy || !udid || !!lock}><Icon name="play" />{busy ? 'Đang bắt đầu…' : `Start run (${plan?.run.length || 0})`}</button></>}>
      <ErrorNote error={err} />
      {lock && <div className="alert alert-warn"><Icon name="warn" /><div>Thiết bị đang bận: <b>{lock.label}</b>.</div></div>}
      <section className="field"><span className="label">Thiết bị</span>
        <DevicePicker devices={sims} value={udid} onChange={setUdid} platform={platform || 'iOS'} />
        {wrongPlatform && <WrongPlatform platform={platform} picked={picked} />}</section>
      <label className="field" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <input className="cb" type="checkbox" checked={manualFix} onChange={(e) => { setManualFix(e.target.checked); saveManualFix(e.target.checked); }} style={{ marginTop: 3 }} />
        <span><b>Sửa tay khi lỗi</b><br /><span className="cap">Step không làm được (không thấy nút, không tới màn) thì dừng lại cho bạn chọn: Block, Skip step, Retry, Use element hoặc Fix script — rồi chạy tiếp phần sau. Cần có người ngồi xem màn Run.</span></span>
      </label>
      {!pf && udid && <section className="field"><span className="label">Kiểm tra trước khi chạy</span><span className="cap">Đang kiểm…</span></section>}
      {pf && pf.items.length > 0 && (
        <section className="field"><span className="label">Kiểm tra trước khi chạy <button type="button" className="linkbtn cap" onClick={recheck}>Kiểm lại</button></span>
          {pf.items.filter((i) => i.status !== 'ok').map((i) => (
            <div key={i.id} className={`alert ${i.status === 'fail' ? 'alert-err' : 'alert-warn'}`}><Icon name="warn" />
              <div style={{ flex: 1, minWidth: 0 }}><b>{i.status === 'fail' ? '✗' : '⚠'} {i.label}</b> — {i.detail}{i.fix && <div className="cap">Cách xử lý: {i.fix}</div>}</div></div>
          ))}
          {pf.items.every((i) => i.status === 'ok')
            ? <div className="alert alert-info"><Icon name="check" /><div><b>Sẵn sàng chạy</b> — {pf.items.map((i) => `✓ ${i.label}${i.detail ? ` (${i.detail})` : ''}`).join(' · ')}</div></div>
            : <span className="cap">{pf.items.filter((i) => i.status === 'ok').map((i) => `✓ ${i.label}`).join(' · ')}</span>}
        </section>
      )}
      {plan && (
        <>
          {plan.added.length > 0 && (
            <div className="alert alert-info"><Icon name="arrow" /><div>Thêm <b>{plan.added.length} case phía trước</b> để app ở đúng trạng thái (case đã chọn "tiếp nối" các case này).</div></div>
          )}
          {plan.missing.length > 0 && (
            <div className="alert alert-err"><Icon name="warn" />
              <div style={{ flex: 1 }}><b>{plan.missing.length} case chưa chạy được</b>
                <ul className="warn-list">{plan.missing.map((m) => <li key={m.id}><span className="mono">{m.tcId}</span> — {m.reason} · <Link to={`/apps/${appId}/scripts?${new URLSearchParams({ file: m.id.split(':')[1], case: m.tcId })}`}>Mở script</Link></li>)}</ul>
                {needGen.length > 0 && <button className="btn btn-sm" type="button" style={{ marginTop: 8 }} onClick={genMissing}><Icon name="spark" />Gen script cho {needGen.length} case thiếu script</button>}</div></div>
          )}
          {warnN > 0 && (
            <div className="alert alert-warn"><Icon name="warn" />
              <div style={{ flex: 1, minWidth: 0 }}><b>{warnN} case có cảnh báo khi gen</b> — vẫn chạy được; nên review trước.
                <ul className="warn-cases">{warned.map((c) => (
                  <li key={c.id}><span className="mono">{c.tcId}</span> <span className="clamp-2">{c.script.warnings[0]}{c.script.warnings.length > 1 ? ` (+${c.script.warnings.length - 1})` : ''}</span>
                    <Link to={`/apps/${appId}/scripts?${new URLSearchParams({ file: c.file, case: c.tcId })}`}>Xem</Link></li>
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

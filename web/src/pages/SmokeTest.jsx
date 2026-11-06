import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useEvents } from '../useEvents.js';
import { Icon } from '../components/Icon.jsx';
import { Empty, ErrorNote, PageHeader, fmtTime } from '../components/ui.jsx';
import { DevicePicker, WrongPlatform, useDevices } from '../components/DevicePicker.jsx';

export const RUN_STATUS = {
  running: ['badge b-running', '● Đang chạy'], done: ['badge b-pass', 'Xong'], stopped: ['badge b-skip', 'Đã dừng'],
  error: ['badge b-fail', 'Lỗi'], interrupted: ['badge b-blocked', 'Bị ngắt'],
};

const SOURCES = [['prd', 'PRD', 'begamob'], ['figma', 'Link Figma', 'cần node-id'], ['file', 'File Figma .json', 'từ plugin']];

export function SmokeTest({ apps, lock }) {
  const { appId } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'runs' ? 'runs' : 'new';
  const setTab = (t) => setParams(t === 'new' ? {} : { tab: t }, { replace: true });
  const app = apps.find((a) => a.id === appId);
  const [err, setErr] = useState(null);
  const [runs, setRuns] = useState([]);
  const [src, setSrc] = useState({ prd: true, figma: false, file: false });
  const [prdUrl, setPrdUrl] = useState('');
  const [figmaUrl, setFigmaUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [account, setAccount] = useState('');
  const [figmaFile, setFigmaFile] = useState(null);
  const [robust, setRobust] = useState(true);
  const [full, setFull] = useState(false);
  const [clean, setClean] = useState(false);
  const [busy, setBusy] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const fileRef = useRef(null);
  const { devices, udid, setUdid, picked, wrong } = useDevices(app?.platform || 'iOS', setErr);
  const load = useCallback(() => api.get(`/apps/${appId}/smoke`).then(setRuns).catch(setErr), [appId]);
  useEffect(() => { load(); }, [load]);
  useEvents('smoke', (r) => r.appId === appId && load());
  if (!app) return <main className="content"><ErrorNote error={{ message: 'Không có app này' }} /></main>;
  const toggle = (k) => setSrc((o) => ({ ...o, [k]: !o[k] }));
  const usePrd = src.prd && prdUrl.trim();
  // Ô PRD phải là link begamob (…/workspace/…): chữ ghi chú dán nhầm bị chặn ngay ở đây (server cũng kiểm lại)
  const prdBad = !!usePrd && !/^https?:\/\/\S+\/workspace\/\S+$/.test(prdUrl.trim());
  const useFig = src.figma && !figmaFile && figmaUrl.trim();
  const useFile = src.file && figmaFile;
  const ready = (usePrd || useFig || useFile) && !prdBad && udid && !wrong && !lock;
  const why = lock ? `Thiết bị đang bận: ${lock.label}` : prdBad ? 'Link PRD không hợp lệ: cần link begamob dạng …/workspace/…' : !(usePrd || useFig || useFile) ? 'Nhập ít nhất một nguồn: link PRD, link Figma hoặc file Figma .json' : !udid ? 'Chọn thiết bị' : wrong ? 'Thiết bị khác nền tảng với app' : '';
  const start = async () => {
    setBusy(true); setErr(null);
    try {
      let body = { udid, prdUrl: usePrd ? prdUrl.trim() : '', figmaUrl: useFig ? figmaUrl.trim() : '', notes: notes.trim(), account: account.trim() || undefined, robust, clean, depth: full ? 'full' : 'smoke' };
      if (useFile) { // có file → gửi multipart (file có thể lớn, kèm ảnh frame)
        const fd = new FormData();
        for (const [k, v] of Object.entries(body)) if (v && k !== 'robust' && k !== 'clean') fd.append(k, v);
        fd.append('robust', String(robust)); // false cũng phải gửi (mặc định phía server là bật)
        fd.append('clean', String(clean));
        fd.append('figmaJson', figmaFile, figmaFile.name);
        body = fd;
      }
      const r = await api.post(`/apps/${appId}/smoke`, body);
      nav(`/smoke/${r.id}`);
    } catch (e) { setErr(e); setBusy(false); }
  };
  const adv = (notes.trim() ? 1 : 0) + (account.trim() ? 1 : 0) + (robust ? 0 : 1) + (full ? 1 : 0);
  return (
    <main className="content">
      <PageHeader title="AI Smoke Test" sub={`${app.name} · AI tự mò app theo PRD và / hoặc Figma rồi báo điểm lệch`} />
      <ErrorNote error={err} />
      <div className="tabs" role="tablist">
        <button className={tab === 'new' ? 'tab on' : 'tab'} type="button" role="tab" aria-selected={tab === 'new'} onClick={() => setTab('new')}>Chạy mới</button>
        <button className={tab === 'runs' ? 'tab on' : 'tab'} type="button" role="tab" aria-selected={tab === 'runs'} onClick={() => setTab('runs')}>Lần chạy <span className="count">{runs.length}</span></button>
      </div>
      {tab === 'new' && (
        <section className="card sm-form">
          <div className="sm-sec">
            <div className="sm-h"><h2>1. Nguồn để AI đối chiếu</h2><span className="cap">Chọn ít nhất một. Có cả PRD và Figma thì AI đối chiếu thêm PRD với Figma.</span></div>
            <div className="chips" role="group" aria-label="Nguồn">
              {SOURCES.map(([k, t, hint]) => (
                <button key={k} type="button" aria-pressed={src[k]} className={`chip${src[k] ? ' on' : ''}`} onClick={() => toggle(k)}>
                  {src[k] && <Icon name="check" size={14} />}{t}<span className="cap sm-hint">{hint}</span>
                </button>
              ))}
            </div>
            {src.prd && (
              <label className="field"><span className="label">Link PRD</span>
                <input className="inp" type="url" value={prdUrl} onChange={(e) => setPrdUrl(e.target.value)} placeholder="https://developers.begamob.com/workspace/…" aria-invalid={prdBad} />
                {prdBad && <span className="cap" role="alert" style={{ color: 'var(--danger, #b42318)' }}>Ô này cần một đường link begamob dạng https://developers.begamob.com/workspace/… (không phải chữ ghi chú). Tắt nguồn PRD nếu không dùng.</span>}</label>
            )}
            {src.figma && (
              <label className="field"><span className="label">Link Figma</span>
                <input className="inp" type="url" value={figmaUrl} onChange={(e) => setFigmaUrl(e.target.value)} placeholder="https://www.figma.com/design/…?node-id=…" />
                <span className="cap">Chọn section cần test trong Figma rồi copy link: link phải có node-id.{figmaFile ? ' Đang có file .json nên link này bị bỏ qua.' : ''}</span></label>
            )}
            {src.file && (
              <div className="field"><span className="label">File Figma .json</span>
                <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => setFigmaFile(e.target.files?.[0] || null)} />
                <div className="sm-file">
                  <Icon name="file" />
                  {figmaFile ? <><b className="trunc">{figmaFile.name}</b><button className="btn btn-sm btn-ghost" type="button" onClick={() => { setFigmaFile(null); if (fileRef.current) fileRef.current.value = ''; }}>Bỏ file</button></>
                    : <><span className="cap">Chưa chọn file</span><button className="btn btn-sm" type="button" onClick={() => fileRef.current?.click()}><Icon name="upload" />Chọn file</button></>}
                </div>
                <span className="cap">Xuất bằng plugin "QA Pipeline – Export frame" (thư mục <b>figma-plugin</b>). File có sẵn ảnh frame, màu, chữ nên <b>không tốn lần gọi Figma MCP</b>. Chọn file thì link Figma bị bỏ qua.</span></div>
            )}
          </div>
          <div className="sm-sec">
            <div className="sm-h"><h2>2. Thiết bị</h2></div>
            <div className="sm-dev">
              {picked ? <><span className={`dev-dot${picked.booted ? '' : ' off'}`} /><b className="trunc">{picked.name}</b><span className="cap">{/^(iOS|Android)/i.test(picked.os || '') ? picked.os : `${picked.platform} ${picked.os || ''}`.trim()}{picked.booted ? ' · đang bật' : ' · đang tắt'}</span></> : <span className="cap">Chưa chọn thiết bị</span>}
              <button className="btn btn-sm" type="button" aria-expanded={devOpen} onClick={() => setDevOpen(!devOpen)}>{devOpen ? 'Xong' : 'Đổi'}</button>
            </div>
            {devOpen && <DevicePicker devices={devices} value={udid} onChange={(u) => { setUdid(u); setDevOpen(false); }} platform={app.platform || 'iOS'} />}
            {wrong && <WrongPlatform platform={app.platform || 'iOS'} picked={picked} />}
          </div>
          <details className="sm-sec sm-adv">
            <summary><b>3. Tuỳ chọn nâng cao</b><span className="cap">{adv ? `${adv} mục đã chỉnh` : 'Ghi chú · mức kiểm · kiểm bền vững · tài khoản test'}</span></summary>
            <div className="sm-adv-b">
              <label className="field"><span className="label">Ghi chú cho AI</span>
                <textarea className="inp" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Vd: chỉ test tính năng Blood Sugar; bỏ qua onboarding" style={{ height: 'auto', padding: 12 }} /></label>
              <label className="sm-chk">
                <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />
                <span><b>Kiểm mở rộng (giống skill mobile-testing)</b><span className="cap">Ngoài luồng chính, AI rút thêm luồng sâu từ PRD / Figma: validation, đổi đơn vị, ranh giới giá trị, bấm liên tục, empty state (tối đa 16 luồng). Lâu và tốn token hơn khoảng 2 lần. Mặc định tắt (chỉ smoke 8 luồng).</span></span>
              </label>
              <label className="sm-chk">
                <input type="checkbox" checked={robust} onChange={(e) => setRobust(e.target.checked)} />
                <span><b>Kiểm bền vững</b><span className="cap">Sau các luồng chính, AI thử đưa app xuống nền rồi mở lại, mở lại app (kill), xoay màn hình và xem dữ liệu còn không. Thêm khoảng 15 bước. Mất mạng, push, deep link chưa hỗ trợ.</span></span>
              </label>
              <label className="sm-chk">
                <input type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} />
                <span><b>Cài sạch app</b><span className="cap">Mặc định tool dùng lại app đã onboard từ lần chạy trước (cùng thiết bị, cùng bản build) nên không phải đi lại onboarding, nhanh hơn khoảng 30 bước. Tích ô này để cài lại app từ đầu.</span></span>
              </label>
              <label className="field"><span className="label">Tài khoản test</span>
                <input className="inp" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="email / mật khẩu để AI đăng nhập" autoComplete="off" />
                <span className="cap">Chỉ dùng trong lần chạy này, không được lưu lại.</span></label>
            </div>
          </details>
          <div className="sm-bar">
            <p className="cap">{why || 'App được cài sạch trước khi chạy. AI tự qua onboarding, quyền và paywall (không mua / đăng ký), rồi kiểm các luồng chính. Mỗi điểm lệch kèm ảnh và đoạn PRD để bạn kiểm lại. Không sinh test case.'}</p>
            <button className="btn btn-primary" type="button" onClick={start} disabled={busy || !ready}><Icon name="play" />{busy ? 'Đang bắt đầu…' : 'Chạy smoke test'}</button>
          </div>
        </section>
      )}
      {tab === 'runs' && (
        <section className="card">
          {runs.length === 0 ? <Empty icon="play" title="Chưa có lần chạy nào">Chạy smoke test ở tab Chạy mới, kết quả sẽ hiện ở đây.</Empty> : (
            <div className="tw"><table className="ui-table">
              <thead><tr><th>Lần chạy</th><th>Bắt đầu</th><th>Trạng thái</th><th>Luồng</th><th>Điểm lệch</th></tr></thead>
              <tbody>{runs.map((r) => {
                const [c, l] = RUN_STATUS[r.status] || RUN_STATUS.done;
                const n = r.findings?.length ?? 0;
                return (
                  <tr key={r.id} className="clickable" onClick={() => nav(`/smoke/${r.id}`)}>
                    <td><Link className="mono" to={`/smoke/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.id}</Link></td>
                    <td>{fmtTime(r.startedAt)}</td><td><span className={c}>{l}</span></td>
                    <td className="num">{r.flows?.length ?? 0}</td><td>{n > 0 ? <span className="badge b-fail">{n} lệch</span> : <span className="cap">0</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
        </section>
      )}
    </main>
  );
}

// Import test case manual: hai danh sách "sẽ automate" / "để manual (lý do)", chuyển case qua lại, chuyển đổi nền, danh sách review.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useEvents } from '../useEvents.js';
import { Icon } from './Icon.jsx';
import { ErrorNote } from './ui.jsx';
import { PopMenu } from './PopMenu.jsx';
import { useDevices } from './DevicePicker.jsx';
import { splitByMode, moveCase, summary, keyOf, groupReview, cleanProblems } from '../manualSelection.js';

const BY = { rule: 'Luật', ai: 'AI', user: 'Bạn chọn' };
const STATUS = { analyzing: 'Đang phân tích…', ready: 'Sẵn sàng', converting: 'Đang chuyển đổi…', done: 'Đã chuyển đổi', stopped: 'Đã dừng', error: 'Lỗi' };
const STEPS = [['review', 'Soát case'], ['run', 'Chuyển đổi'], ['result', 'Kết quả']];
// Server trả bản đã bỏ nội dung manual gốc / dòng Keyword; sự kiện SSE gửi bản đầy đủ → bỏ khi nhận
const strip = (mi) => ({ ...mi, cases: mi.cases.map(({ src, plan, ...c }) => c) });

const STATE = { done: ['pass', 'Đã chuyển'], pending: ['none', 'Chờ chuyển'], error: ['fail', 'Lỗi'], conflict: ['blk', 'Xung đột'] };

function Row({ c, onMove, onResolve, busy }) {
  const to = c.mode === 'automate' ? 'manual' : 'automate';
  const st = c.mode === 'automate' ? STATE[c.state] : null;
  return (
    <li className="mi-row">
      <span className="mono cap mi-id">{c.id}</span>
      <div className="mi-main">
        <span className="trunc-2" title={c.title}>{c.title}</span>
        <span className="cap mi-meta">
          {c.mode === 'manual' && c.reason ? <>{c.reason} · </> : null}{BY[c.by] || c.by}
          {c.ambiguity?.length > 0 && <span className="warn-txt" title={c.ambiguity.map((a) => a.text).join('\n')}><Icon name="warn" size={12} />{c.ambiguity.length} điểm mờ</span>}
        </span>
        {c.state === 'error' && c.error && <details className="mi-err"><summary className="err-line">{String(c.error).split(/[;\n]/)[0].slice(0, 140)}</summary><pre className="err-pre">{String(c.error).split('; ').join('\n')}</pre></details>}
        {c.state === 'conflict' && (
          <span className="cap">Dòng Keyword đã sửa tay, manual cũng đổi:{' '}
            <button type="button" className="linkbtn" disabled={busy} onClick={() => onResolve(c, 'keep')}>Giữ bản sửa tay</button>{' · '}
            <button type="button" className="linkbtn" disabled={busy} onClick={() => onResolve(c, 'reconvert')}>Chuyển lại</button>
          </span>
        )}
      </div>
      {st && <span className={`dotl ${st[0]}`}>{st[1]}</span>}
      <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => onMove(c, to)} title={to === 'manual' ? 'Chuyển sang manual (không automate case này)' : 'Chuyển sang automate'}>
        {to === 'manual' ? 'Để manual' : 'Automate'}
      </button>
    </li>
  );
}

// Câu hỏi cho từng điểm mờ, dựng từ mã + nội dung case (không dùng a.text đã lưu, để import cũ cũng hiện câu mới):
// ask = câu hỏi, from/quote = đoạn manual đang bị hỏi, why = vì sao cần trả lời, ph = ví dụ câu trả lời
function questionOf(a, brief) {
  if (a.code === 'NO_QUOTED_EXPECTED') return {
    ask: 'Màn hình phải hiện chữ gì thì coi là đạt?',
    from: 'Expected đang ghi', quote: brief?.expected,
    why: 'Expected chưa có chữ nào đặt trong dấu ngoặc kép, nên tool không biết phải tìm đúng chữ nào trên màn. Ghi lại chữ hiện trên app, đặt trong ngoặc kép. Để trống thì AI tự đoán và dễ kiểm sai.',
    ph: 'vd: Hiện tiêu đề "History", có đủ các dòng "90 mg/dL" … "125 mg/dL"',
  };
  if (a.code === 'EMPTY_PRE') return {
    ask: 'Case này bắt đầu từ trạng thái nào?',
    from: 'Pre-condition', quote: '(đang để trống)',
    why: 'Tool cần biết nên cài lại app từ đầu hay chạy tiếp từ màn mà case trước dừng lại.',
    ph: 'vd: Cài lại app, hoàn tất onboarding / Tiếp nối case trước, đang ở màn Goals',
  };
  if (a.code === 'VAGUE_STEP') {
    const hit = String(a.text || '').match(/"([^"]+)"/)?.[1] || '';
    const line = String(brief?.steps || '').split('\n').find((l) => hit && l.toLowerCase().includes(hit)) || brief?.steps;
    return {
      ask: hit ? `Bước ghi "${hit}": cụ thể là giá trị nào?` : 'Bước này cần giá trị cụ thể nào?',
      from: 'Bước đang ghi', quote: line,
      why: 'Tool cần một giá trị cụ thể để nhập hoặc kiểm, không tự hiểu được thế nào là "hợp lệ", "phù hợp".',
      ph: 'vd: nhập "abc@gmail.com"',
    };
  }
  return { ask: a.text || a.code, ph: '' };
}

// Một case có điểm mờ: xem nội dung manual, trả lời từng điểm (AI đã điền gợi ý nếu có), xác nhận hoặc để manual
function ClarifyCard({ c, draft, onDraft, onConfirm, onManual, busy }) {
  const val = (code) => draft?.[code] ?? c.answers?.[code] ?? c.suggest?.[code] ?? '';
  return (
    <li className="mi-row mi-clarify">
      <div className="mi-main" style={{ gap: 8 }}>
        <div><span className="mono cap">{c.id}</span> <b>{c.title}</b>{c.confirmed && <span className="dotl pass" style={{ marginLeft: 8 }}>Đã trả lời</span>}</div>
        {c.brief && (
          <details><summary className="cap">Xem nội dung manual</summary>
            <div className="cap" style={{ whiteSpace: 'pre-wrap' }}>{[['Pre-condition', c.brief.pre], ['Steps', c.brief.steps], ['Expected', c.brief.expected]].map(([k, v]) => <div key={k}><b>{k}:</b> {v || '(trống)'}</div>)}</div>
          </details>
        )}
        {c.ambiguity.map((a) => {
          const q = questionOf(a, c.brief);
          return (
            <label key={a.code} className="field mi-q"><span className="mi-q-ask">{q.ask}</span>
              {q.quote && <span className="mi-q-quote"><span className="cap">{q.from}:</span> {q.quote}</span>}
              {q.why && <span className="cap">{q.why}</span>}
              <textarea className="inp" rows={2} value={val(a.code)} placeholder={q.ph} onChange={(e) => onDraft(c, a.code, e.target.value)} style={{ height: 'auto', padding: 10 }} disabled={busy} />
              {c.suggest?.[a.code] && !c.answers?.[a.code] && draft?.[a.code] === undefined && <span className="cap">AI gợi ý — sửa nếu chưa đúng</span>}
            </label>
          );
        })}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => onConfirm(c)}>{c.confirmed ? 'Cập nhật câu trả lời' : 'Xác nhận'}</button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => onManual(c)}>Để manual</button>
        </div>
      </div>
    </li>
  );
}

export function ManualImport({ importId, initial, onClose }) {
  const [mi, setMi] = useState(initial ? strip(initial) : null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('automate');
  const [qq, setQq] = useState('');
  // keyOf(case) → { mã điểm mờ: chữ đang gõ }. Lưu theo file để đóng / mở lại popup vẫn còn (kể cả khi bạn đã xoá hẳn gợi ý của AI)
  const DKEY = `qapd.mi.drafts.${importId}`;
  const [drafts, setDrafts] = useState(() => { try { return JSON.parse(localStorage.getItem(DKEY) || '{}') || {}; } catch { return {}; } });
  useEffect(() => { try { if (Object.keys(drafts).length) localStorage.setItem(DKEY, JSON.stringify(drafts)); else localStorage.removeItem(DKEY); } catch {} }, [drafts]);
  const [tabInit, setTabInit] = useState(false);
  const [autoGen, setAutoGen] = useState(true); // gen script ngay sau khi chuyển đổi (tắt nếu muốn chọn case cần gen ở bảng Test Cases)
  const [fresh, setFresh] = useState(false); // chuyển lại từ đầu: bỏ kết quả cũ, ghi đè file automation
  const [lastGen, setLastGen] = useState(true);
  const [view, setView] = useState(null); // 'review' | 'run' | 'result'; null = theo trạng thái của import
  const prev = useRef(null);
  useEffect(() => { if (!mi) api.get(`/manual/${importId}`).then(setMi).catch(setErr); }, [importId]);
  // Chạy thử luồng chung trên thiết bị (tuỳ chọn): bật / tắt + thiết bị nhớ theo app (localStorage)
  const appId = mi?.appId;
  const [platform, setPlatform] = useState(null);
  useEffect(() => { if (appId) api.get(`/apps/${appId}`).then((a) => setPlatform(a?.platform || 'iOS')).catch(() => setPlatform('iOS')); }, [appId]);
  const { devices, udid, setUdid } = useDevices(platform);
  const FKEY = appId ? `qapd.mi.flowcheck.${appId}` : null;
  const [dry, setDry] = useState(false);
  useEffect(() => { if (!FKEY) return; try { setDry(!!JSON.parse(localStorage.getItem(FKEY) || '{}').on); } catch {} }, [FKEY]);
  useEffect(() => {
    if (!FKEY || !devices.length) return;
    try { const u = JSON.parse(localStorage.getItem(FKEY) || '{}').udid; if (u && devices.some((d) => d.udid === u)) setUdid(u); } catch {}
  }, [FKEY, devices]);
  const saveDry = (patch) => { if (!FKEY) return; try { const cur = JSON.parse(localStorage.getItem(FKEY) || '{}'); localStorage.setItem(FKEY, JSON.stringify({ ...cur, ...patch })); } catch {} };
  const mine = devices.filter((d) => d.platform === (platform || 'iOS'));
  useEvents('manualImport', (e) => { if (e.id === importId) setMi(strip(e)); });
  // Đang chuyển đổi → màn tiến độ; vừa chuyển đổi xong (hoặc lỗi) → màn kết quả
  useEffect(() => {
    const st = mi?.status;
    if (st === 'converting') setView('run');
    else if (prev.current === 'converting' && (st === 'done' || st === 'error')) setView('result');
    else if (prev.current === 'converting' && st === 'stopped') setView('review');
    prev.current = st;
  }, [mi?.status]);

  const act = async (fn) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr(e); api.get(`/manual/${importId}`).then(setMi).catch(() => {}); }
    setBusy(false);
  };
  const move = (c, mode) => act(async () => {
    setMi((m) => ({ ...m, cases: moveCase(m.cases, c, mode) }));
    setMi(await api.put(`/manual/${importId}/choices`, { sheet: c.sheet, tcId: c.id, mode }));
  });
  const resolve = (c, action) => act(async () => setMi(await api.post(`/manual/${importId}/conflicts`, { sheet: c.sheet, tcId: c.id, action })));
  const convert = () => act(async () => { await api.post(`/manual/${importId}/convert`, { gen: autoGen, fresh, ...(dry && udid ? { udid } : {}) }); setLastGen(autoGen); setFresh(false); setView('run'); });
  const draft = (c, code, v) => setDrafts((d) => ({ ...d, [keyOf(c)]: { ...d[keyOf(c)], [code]: v } }));
  const answersOf = (c) => Object.fromEntries(c.ambiguity.map((a) => [a.code, drafts[keyOf(c)]?.[a.code] ?? c.answers?.[a.code] ?? c.suggest?.[a.code] ?? '']));
  const confirm = (c) => act(async () => {
    const out = await api.put(`/manual/${importId}/clarify`, { sheet: c.sheet, tcId: c.id, answers: answersOf(c) });
    setMi(out);
    setDrafts((d) => { const n = { ...d }; delete n[keyOf(c)]; return n; });
  });
  const stopRun = () => act(async () => { await api.post(`/manual/${importId}/stop`, {}); });
  // Lệch giữa tài liệu và app: doc = kiểm theo tài liệu (app sai → Failed, là bug) · app = tài liệu đã cũ, kiểm theo chữ app
  const specChoose = (c, d, choice) => act(async () => setMi(await api.put(`/manual/${importId}/spec`, { sheet: c.sheet, tcId: c.id, step: d.step, manual: d.manual, app: d.app, choice })));
  // Quy tắc nút "AI gợi ý": bật khi có ít nhất một case chưa xác nhận còn ô trống (chưa có chữ trong ô, kể cả ô bạn đã xoá gợi ý); tắt kèm lý do
  const valueOf = (c, code) => drafts[keyOf(c)]?.[code] ?? c.answers?.[code] ?? c.suggest?.[code] ?? '';
  const emptyCodes = (c) => c.ambiguity.filter((a) => !String(valueOf(c, a.code)).trim()).map((a) => a.code);
  const needSuggest = mi ? mi.cases.filter((c) => c.mode === 'automate' && c.ambiguity?.length && !c.confirmed && emptyCodes(c).length) : [];
  const suggest = () => act(async () => {
    const out = await api.post(`/manual/${importId}/suggest`, { cases: needSuggest.map((c) => ({ sheet: c.sheet, tcId: c.id })) });
    // Ô đã xoá thì bỏ nháp rỗng để gợi ý mới hiện ra; ô bạn đang có chữ giữ nguyên
    setDrafts((d) => {
      const n = { ...d };
      for (const c of needSuggest) {
        const cur = { ...n[keyOf(c)] };
        for (const code of emptyCodes(c)) delete cur[code];
        if (Object.keys(cur).length) n[keyOf(c)] = cur; else delete n[keyOf(c)];
      }
      return n;
    });
    setMi(out);
  });
  // Lưu mọi câu trả lời chưa xác nhận (gồm gợi ý của AI); chuyển đổi là nút riêng ở chân popup
  const confirmAll = () => act(async () => {
    for (const c of mi.cases.filter((x) => x.mode === 'automate' && x.ambiguity?.length && !x.confirmed)) {
      await api.put(`/manual/${importId}/clarify`, { sheet: c.sheet, tcId: c.id, answers: answersOf(c) });
    }
    setMi(await api.get(`/manual/${importId}`));
    setDrafts({});
  });

  if (!mi) return <div className="overlay"><div className="scrim" /><section className="help-modal"><div className="skel" style={{ height: 160, margin: 20 }} /><ErrorNote error={err} /></section></div>;
  const { automate, manual } = splitByMode(mi.cases);
  const sum = summary(mi);
  const working = ['analyzing', 'converting'].includes(mi.status);
  const todo = mi.cases.filter((c) => c.state === 'pending' || c.state === 'error').length;
  const errored = mi.cases.filter((c) => c.mode === 'automate' && c.state === 'error');
  const converted = mi.cases.filter((c) => c.mode === 'automate' && c.state === 'converted').length;
  const p = mi.progress;
  const pct = p ? Math.round((p.done / Math.max(1, p.total)) * 100) : 0;
  const askable = mi.cases.filter((c) => c.mode === 'automate' && c.ambiguity?.length);
  const unconfirmed = askable.filter((c) => !c.confirmed);
  if (!tabInit && askable.length) { setTabInit(true); if (unconfirmed.length && mi.status === 'ready') setTab('clarify'); }
  const specItems = mi.cases.filter((c) => c.mode === 'automate').flatMap((c) => (c.specDiffs || []).map((d) => ({ c, d, choice: c.specChoice?.[`${d.step}|${d.manual}`] || (d.fixed ? 'doc' : null) })))
    .filter((x) => !qq || `${x.c.id} ${x.c.title}`.toLowerCase().includes(qq.toLowerCase()));
  const specOpen = specItems.filter((x) => !x.choice).length;
  const list = (tab === 'automate' ? automate : tab === 'manual' ? manual : askable).filter((c) => !qq || `${c.id} ${c.title}`.toLowerCase().includes(qq.toLowerCase()));
  const cur = view || (mi.status === 'converting' ? 'run' : 'review');
  const hasResult = (mi.problems?.length || 0) + (mi.review?.length || 0) > 0 || converted > 0;
  const problems = cleanProblems(mi.problems);
  const canConvert = !(busy || working || (!todo && !fresh && sum.conflicts === 0));
  const stepIdx = STEPS.findIndex(([k]) => k === cur);

  return (
    <div className="overlay">
      <div className="scrim" />
      <section className="help-modal mi-modal" role="dialog" aria-modal="true" aria-label={`Import manual ${mi.fileName}`}>
        <div className="mi-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 className="mono">{mi.fileName}</h2>
            <span className="cap">{STATUS[mi.status] || mi.status}{sum.ambiguous > 0 && ` · ${sum.ambiguous} case có điểm mờ`}{sum.conflicts > 0 && ` · ${sum.conflicts} xung đột`}</span>
          </div>
          <button className="btn btn-ghost btn-icon" type="button" aria-label="Đóng" onClick={onClose}><Icon name="close" /></button>
        </div>
        <ol className="mi-steps" aria-label="Các bước">
          {STEPS.map(([k, l], i) => (
            <li key={k} className={i === stepIdx ? 'on' : i < stepIdx ? 'done' : ''} aria-current={i === stepIdx ? 'step' : undefined}><span className="mi-sn">{i < stepIdx ? '✓' : i + 1}</span>{l}</li>
          ))}
          {cur === 'review' && hasResult && <li className="mi-steps-r"><button type="button" className="linkbtn" onClick={() => setView('result')}>Xem kết quả lần trước</button></li>}
        </ol>

        {cur === 'review' && (
          <>
            <ErrorNote error={err || (mi.status === 'error' ? new Error(mi.error) : null)} />
            {mi.status === 'stopped' && <div className="alert alert-info" style={{ margin: '12px 20px 0' }} role="status"><Icon name="stop" /><div><b>Đã dừng chuyển đổi.</b> Các nhóm đã viết xong được giữ lại; bấm Chuyển đổi để làm tiếp phần còn lại.</div></div>}
            <div className="mi-tools">
              <div className="seg2" role="tablist" aria-label="Danh sách case">
                {askable.length > 0 && <button type="button" role="tab" aria-selected={tab === 'clarify'} className={tab === 'clarify' ? 'on' : ''} onClick={() => setTab('clarify')}>Cần xác nhận <span className="num">{unconfirmed.length}</span></button>}
                {(mi.cases.some((c) => c.specDiffs?.length)) && <button type="button" role="tab" aria-selected={tab === 'spec'} className={tab === 'spec' ? 'on' : ''} onClick={() => setTab('spec')}>Lệch tài liệu <span className="num">{specOpen}</span></button>}
                <button type="button" role="tab" aria-selected={tab === 'automate'} className={tab === 'automate' ? 'on' : ''} onClick={() => setTab('automate')}>Sẽ automate <span className="num">{automate.length}</span></button>
                <button type="button" role="tab" aria-selected={tab === 'manual'} className={tab === 'manual' ? 'on' : ''} onClick={() => setTab('manual')}>Để manual <span className="num">{manual.length}</span></button>
              </div>
              <span style={{ flex: 1 }} />
              <input className="inp search-inp" type="search" placeholder="Tìm theo ID, tiêu đề" value={qq} onChange={(e) => setQq(e.target.value)} aria-label="Tìm case" />
            </div>
            <div className="mi-scroll">
              {tab === 'clarify' && askable.length > 0 && (
                <div className="alert" style={{ margin: 12 }}><Icon name="warn" /><div>
                  <b>{unconfirmed.length} case có điểm mờ chưa trả lời.</b> Trả lời để AI không phải đoán. Bỏ qua cũng được: AI tự đoán, và case nào bạn trả lời sau sẽ được chuyển lại riêng.
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-sm" disabled={busy || working || !needSuggest.length} title={working ? 'Đang chuyển đổi — đợi xong' : !unconfirmed.length ? 'Mọi case đã được xác nhận' : !needSuggest.length ? 'Mọi ô đã có câu trả lời — xoá ô nào muốn AI gợi ý lại' : `AI gợi ý cho ${needSuggest.length} case còn ô trống`} onClick={suggest}><Icon name="spark" />AI gợi ý câu trả lời{needSuggest.length > 0 && <span className="num"> ({needSuggest.length})</span>}</button>
                    <button type="button" className="btn btn-sm" disabled={busy || working || !unconfirmed.length} onClick={confirmAll}>Xác nhận tất cả</button>
                  </div>
                </div></div>
              )}
              {tab === 'spec' && (
                <>
                  <div className="alert" style={{ margin: 12 }}><Icon name="warn" /><div>
                    <b>Chỗ tài liệu (Expected) và app đang hiện chữ khác nhau.</b> <b>Theo tài liệu</b>: script kiểm đúng chữ tài liệu, app sai thì case Failed — đó là lỗi cần báo. <b>Theo app</b>: tài liệu đã cũ (nên cập nhật file manual). Mục <b>Chưa chọn</b> hiện đang kiểm theo chữ app. Chọn xong bấm Chuyển đổi — chỉ sửa đúng dòng kiểm, không gọi AI lại.
                  </div></div>
                  <ul className="mi-list">{specItems.map(({ c, d, choice }) => (
                    <li key={`${keyOf(c)}|${d.step}|${d.manual}|${d.app}`} className="mi-row">
                      <span className="mono cap mi-id">{c.id}</span>
                      <div className="mi-main">
                        <span className="trunc-2" title={c.title}>Bước {d.step} · {c.title}</span>
                        <span className="cap">Tài liệu: <b>"{d.manual}"</b> · App đang hiện: <b>"{d.app}"</b>{d.fixed && !d.byUser && choice === 'doc' ? ' · tool đã tự đổi về chữ tài liệu (gần giống)' : ''}</span>
                      </div>
                      {!choice && <span className="dotl blk">Chưa chọn</span>}
                      <div className="seg2" role="group" aria-label={`Cách kiểm bước ${d.step} của ${c.id}`}>
                        <button type="button" className={choice === 'doc' ? 'on' : ''} disabled={busy || working} onClick={() => specChoose(c, d, 'doc')}>Theo tài liệu</button>
                        <button type="button" className={choice === 'app' ? 'on' : ''} disabled={busy || working} onClick={() => specChoose(c, d, 'app')}>Theo app</button>
                      </div>
                    </li>
                  ))}</ul>
                  {specItems.length === 0 && <div className="empty"><b style={{ color: 'var(--ink)' }}>Không có chỗ lệch</b></div>}
                </>
              )}
              {tab !== 'spec' && <ul className="mi-list">{tab === 'clarify'
                ? list.map((c) => <ClarifyCard key={keyOf(c)} c={c} draft={drafts[keyOf(c)]} onDraft={draft} onConfirm={confirm} onManual={(x) => move(x, 'manual')} busy={busy || working} />)
                : list.map((c) => <Row key={keyOf(c)} c={c} onMove={move} onResolve={resolve} busy={busy || working} />)}</ul>}
              {tab !== 'spec' && list.length === 0 && <div className="empty"><b style={{ color: 'var(--ink)' }}>Không có case</b></div>}
              {tab === 'manual' && mi.removed?.length > 0 && (
                <div className="alert alert-warn" style={{ margin: 12 }}><Icon name="warn" /><div>
                  <b>{mi.removed.length} case không còn trong file manual</b> (vẫn còn trong bảng Test Cases cho tới khi sheet chứa chúng được chuyển đổi lại — lúc đó chúng bị xoá cùng script; hoặc xoá ở bảng nếu không cần): {mi.removed.join(', ')}
                </div></div>
              )}
            </div>
            <div className="mi-opts">
              <span className="cap">Sau khi chuyển đổi</span>
              <div className="seg2" role="group" aria-label="Sau khi chuyển đổi">
                <button type="button" className={autoGen ? 'on' : ''} aria-pressed={autoGen} onClick={() => setAutoGen(true)} disabled={working}>Gen script luôn</button>
                <button type="button" className={!autoGen ? 'on' : ''} aria-pressed={!autoGen} onClick={() => setAutoGen(false)} disabled={working} title="Chỉ chuyển đổi; chọn case cần gen ở bảng Test Cases (gen cả sheet mất khá lâu)">Chỉ chuyển đổi</button>
              </div>
              <label className="mi-dry" title="Trước khi viết các nhóm, tool cài lại app trên thiết bị rồi chạy thử từng luồng chung (đường đi dùng lại cho nhiều case), tự sửa bước sai và ghi lại hành vi thật (vd chọn đáp án là tự chuyển màn). Giữ thiết bị trong lúc chạy thử; không bao giờ bấm mua.">
                <input type="checkbox" checked={dry} disabled={working} onChange={(e) => { setDry(e.target.checked); saveDry({ on: e.target.checked }); }} />
                <span>Chạy thử luồng chung trên thiết bị (khuyên dùng — AI học hành vi thật của app, vd chọn đáp án tự chuyển màn)</span>
              </label>
              {dry && (
                <select className="inp mi-dry-dev" aria-label="Thiết bị chạy thử" value={udid} disabled={working} onChange={(e) => { setUdid(e.target.value); saveDry({ udid: e.target.value }); }}>
                  {!mine.length && <option value="">Không có thiết bị {platform || ''}</option>}
                  {mine.map((d) => <option key={d.udid} value={d.udid}>{d.name} · {d.os}{d.booted ? ' (đang bật)' : ''}</option>)}
                </select>
              )}
              {fresh && <span className="mi-chip" role="status"><b>Chuyển lại từ đầu</b> — bỏ kết quả cũ, ghi đè file automation<button type="button" className="linkbtn" onClick={() => setFresh(false)}>Bỏ</button></span>}
            </div>
            <div className="hm-foot">
              <span className="cap" style={{ flex: 1 }}>
                {todo || fresh ? <><b>{fresh ? automate.length : todo} case</b> sẽ được chuyển đổi{!fresh && errored.length > 0 ? ` (gồm ${errored.length} case lỗi lần trước)` : ''}{unconfirmed.length > 0 ? ` · ${unconfirmed.length} điểm mờ chưa trả lời, AI sẽ tự đoán` : ''}</> : 'Không có case nào cần chuyển đổi.'}
              </span>
              <PopMenu label="Tuỳ chọn khác" text="Tuỳ chọn" small={false} disabled={working}>
                {(close) => (
                  <button type="button" role="menuitem" onClick={() => { setFresh(true); close(); }}>Chuyển lại từ đầu…</button>
                )}
              </PopMenu>
              <button type="button" className="btn" onClick={onClose}>Đóng</button>
              <button type="button" className="btn btn-primary" disabled={!canConvert} onClick={convert}><Icon name="spark" />{fresh ? 'Chuyển lại từ đầu' : `Chuyển đổi ${todo || ''} case`.replace('  ', ' ')}</button>
            </div>
          </>
        )}

        {cur === 'run' && (
          <>
            <div className="mi-run">
              <span className="overline">{mi.status === 'converting' ? 'Đang chuyển đổi' : 'Đang chờ'}{lastGen ? ' và gen script' : ''}</span>
              <div className="mi-run-n num"><b>{p?.done ?? 0}</b> / {p?.total ?? '…'} nhóm <span>· {pct}%</span></div>
              <div className="conv conv-lg" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
              <span className="cap trunc-2">{p?.label || 'Đang khởi động…'}</span>
              <p className="cap">Bạn có thể đóng cửa sổ này, chuyển đổi vẫn chạy nền. Mở lại file để xem tiếp.</p>
            </div>
            <ErrorNote error={err} />
            <div className="hm-foot">
              <button type="button" className="btn btn-danger" disabled={busy || mi.status !== 'converting'} onClick={stopRun}><Icon name="stop" />{busy ? 'Đang dừng…' : 'Dừng chuyển đổi'}</button>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn" onClick={onClose}>Đóng, chạy nền</button>
            </div>
          </>
        )}

        {cur === 'result' && (
          <>
            <div className="mi-scroll mi-result">
              <ErrorNote error={err} />
              <div className="mi-kpis">
                <div className="card kpi"><span className="overline">Đã chuyển</span><span className="kpi-v" style={converted ? { color: 'var(--pass-ink)' } : undefined}>{converted}</span><span className="cap">case automate</span></div>
                <div className="card kpi"><span className="overline">Lỗi</span><span className="kpi-v" style={errored.length ? { color: 'var(--fail-ink)' } : undefined}>{errored.length}</span><span className="cap">chưa chuyển được</span></div>
                <div className="card kpi"><span className="overline">Để manual</span><span className="kpi-v">{manual.length}</span><span className="cap">không automate</span></div>
              </div>
              {converted > 0 && lastGen && mi.status === 'done' && <div className="alert alert-info"><Icon name="spark" /><div><b>Script đang được gen nền.</b> Trạng thái từng case cập nhật trực tiếp trong bảng Test Cases.</div></div>}
              {specItems.length > 0 && (
                <div className={specOpen ? 'alert' : 'alert alert-info'} role="status"><Icon name="warn" /><div>
                  <b>Lệch tài liệu: {specItems.length} chỗ{specOpen ? `, ${specOpen} chỗ chưa chọn` : ' (đã chọn hết)'}.</b> Chỗ app hiển thị khác chữ trong tài liệu: chọn kiểm theo tài liệu (app có thể sai) hay theo app (tài liệu cũ).
                  <div style={{ marginTop: 8 }}><button type="button" className="btn btn-sm" onClick={() => { setQq(''); setTab('spec'); setView('review'); }}>Xem và chọn</button></div>
                </div></div>
              )}
              {problems.length > 0 && (
                <div className="alert alert-err" role="alert"><Icon name="warn" /><div><b>Không chuyển đổi được{errored.length ? ` ${errored.length} case` : ''}</b>
                  <ul className="mi-review">{problems.slice(0, 3).map((l, i) => <li key={i}>{l}</li>)}</ul>
                  {problems.length > 3 && <details><summary className="cap">Xem thêm {problems.length - 3} lỗi</summary><ul className="mi-review">{problems.slice(3).map((l, i) => <li key={i}>{l}</li>)}</ul></details>}
                </div></div>
              )}
              {errored.length > 0 && (
                <section className="mi-sec"><h3>Case lỗi ({errored.length})</h3>
                  <ul className="mi-list">{errored.map((c) => <Row key={keyOf(c)} c={c} onMove={move} onResolve={resolve} busy={busy || working} />)}</ul>
                </section>
              )}
              {groupReview(mi.review).length > 0 && (
                <section className="mi-sec"><h3>Cần review ({mi.review.length})</h3>
                  {groupReview(mi.review).map((g) => (
                    <details key={g.label} className="mi-group"><summary><b>{g.label}</b> <span className="cap num">{g.items.length}</span></summary><ul className="mi-review">{g.items.map((l, i) => <li key={i}>{l}</li>)}</ul></details>
                  ))}
                </section>
              )}
              {!problems.length && !mi.review?.length && converted === 0 && <div className="empty"><b style={{ color: 'var(--ink)' }}>Chưa có kết quả</b></div>}
            </div>
            <div className="hm-foot">
              <button type="button" className="btn" onClick={() => setView('review')}>Quay lại soát case</button>
              <span style={{ flex: 1 }} />
              {errored.length > 0 && <button type="button" className="btn" disabled={!canConvert} onClick={convert}><Icon name="refresh" />Chuyển lại {errored.length} case lỗi</button>}
              <button type="button" className="btn btn-primary" onClick={onClose}>Xong, xem bảng Test Cases</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

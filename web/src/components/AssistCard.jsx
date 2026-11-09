// AI hỗ trợ khi chạy: mỗi lần AI gỡ kẹt = 1 "lệch so với script". Tester xem thay đổi test case (trước / sau) rồi
// Áp dụng vào test case (sửa Excel + gen lại script case đó) hoặc Bỏ qua (giữ test case như cũ; lần chạy sau vẫn có thể kẹt).
import { useState } from 'react';
import { api } from '../api.js';
import { Icon } from './Icon.jsx';
import { ErrorNote } from './ui.jsx';

export const assistLabel = (a) => ({
  use: `Dùng "${a.name || a.locator}" thay cho phần tử của script`,
  tapPoint: `Chạm "${a.name || ''}" theo toạ độ (${Math.round(a.x)}%, ${Math.round(a.y)}%)`,
  arrived: `Đã ở đúng màn (thấy "${a.name || a.locator}")`,
  tap: `Bấm "${a.name || a.locator}"`,
  type: `Nhập "${a.text}" vào "${a.name || a.locator}"`,
  swipe: `Vuốt ${a.text}`,
  back: 'Back',
  wait: 'Chờ 4s',
}[a.action] || a.action);

const rowText = (r) => `${r.step}. [${r.screen || ''}] ${r.kind} · ${r.keyword}${r.target ? ` "${r.target}"` : ''}${r.value ? ` = ${r.value}` : ''}`;

function Diff({ p }) {
  // Chỉ hiện quanh chỗ đổi (±3 dòng) cho gọn
  const idx = p.after.map((r, i) => (r.added || r.changed ? i : -1)).filter((i) => i >= 0);
  const lo = Math.max(0, Math.min(...idx) - 3);
  const hi = Math.min(p.after.length, Math.max(...idx) + 4);
  return (
    <div className="code" style={{ fontSize: 12, whiteSpace: 'pre-wrap', margin: '8px 0' }}>
      {lo > 0 && <div className="muted">…</div>}
      {p.after.slice(lo, hi).map((r, i) => {
        const before = r.changed ? p.before.find((b) => b.step === r.step && b.keyword === r.keyword && b.screen === r.screen && b.target !== r.target) : null;
        return (
          <div key={i}>
            {before && <div style={{ color: 'var(--fail-ink)' }}>− {rowText(before)}</div>}
            <div style={r.added || r.changed ? { color: 'var(--pass-ink)', fontWeight: 600 } : undefined}>{r.added || r.changed ? '+ ' : '  '}{rowText(r)}</div>
          </div>
        );
      })}
      {hi < p.after.length && <div className="muted">…</div>}
    </div>
  );
}

function Item({ runId, tc, e, running }) {
  const [p, setP] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);
  const decision = done?.decision || e.decision;
  const preview = async () => { setBusy(true); setErr(null); try { setP(await api.get(`/runs/${runId}/assist/${encodeURIComponent(tc)}/${e.i}`)); } catch (x) { setErr(x); } setBusy(false); };
  const apply = async () => { setBusy(true); setErr(null); try { const out = await api.post(`/runs/${runId}/assist/${encodeURIComponent(tc)}/${e.i}/apply`, {}); setDone({ decision: 'applied', out }); } catch (x) { setErr(x); } setBusy(false); };
  const dismiss = async () => { setBusy(true); setErr(null); try { await api.post(`/runs/${runId}/assist/${encodeURIComponent(tc)}/${e.i}/dismiss`, {}); setDone({ decision: 'dismissed' }); } catch (x) { setErr(x); } setBusy(false); };
  return (
    <li style={{ marginBottom: 10 }}>
      <div><b>Bước {e.step ?? '?'} · màn {e.screen}</b>{e.target && e.target !== '(screen)' && <> · “{e.target}”</>}</div>
      <div className="cap">{e.kind === 'overlay' ? 'Lệch' : 'Script kẹt'}: {e.error}</div>
      <ol style={{ margin: '4px 0 0 18px' }}>
        {e.actions.map((a, i) => <li key={i}>{assistLabel(a)}{a.reason && <span className="cap"> — {a.reason}</span>}</li>)}
      </ol>
      <ErrorNote error={err} />
      {decision === 'applied' && <div className="cap" style={{ color: 'var(--pass-ink)', marginTop: 4 }}>✓ Đã áp dụng vào test case{done?.out?.regenerating ? ` — đang gen lại script ${done.out.regenerating} case` : ''}.</div>}
      {decision === 'dismissed' && <div className="cap" style={{ marginTop: 4 }}>Đã bỏ qua — test case giữ nguyên.</div>}
      {!decision && !p && (
        <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={preview}><Icon name="spark" />Xem thay đổi test case</button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={dismiss}>Bỏ qua</button>
        </div>
      )}
      {!decision && p && !p.ok && <div className="cap" style={{ marginTop: 4 }}>{p.error}<div><button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={dismiss}>Bỏ qua</button></div></div>}
      {!decision && p?.ok && (
        <div style={{ marginTop: 6 }}>
          <ul className="cap" style={{ margin: 0, paddingLeft: 18 }}>{p.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
          {p.flow && <div className="alert alert-warn" style={{ margin: '6px 0' }}><Icon name="warn" /><div>Dòng này nằm trong luồng dùng chung <b>{p.flow}</b> (sheet Flows) — sửa sẽ áp dụng cho {p.cases.length} case: {p.cases.join(', ')}.</div></div>}
          <Diff p={p} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy || running} title={running ? 'Run đang chạy — áp dụng sau khi run xong' : undefined} onClick={apply}><Icon name="check" />Áp dụng vào test case</button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={dismiss}>Bỏ qua</button>
          </div>
        </div>
      )}
    </li>
  );
}

export function AssistCard({ runId, tc, assist, running }) {
  if (!assist?.length) return null;
  const open = assist.filter((e) => !e.decision).length;
  const ai = assist.filter((e) => e.kind !== 'overlay' || e.source === 'ai').length;
  const pop = assist.filter((e) => e.kind === 'overlay').length;
  return (
    <div className="alert alert-info" style={{ margin: '12px 16px 0' }} role="status"><Icon name="spark" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <b>Lệch so với script: {assist.length} chỗ{open ? ` (${open} chưa quyết định)` : ''}</b>
        <div className="cap">
          {ai > 0 && <>AI hỗ trợ {ai} lần (gỡ kẹt thao tác / điều hướng). </>}
          {pop > 0 && <>Tool đóng {pop} popup ngoài test case che màn rồi kiểm lại. </>}
          Điểm kiểm vẫn do script tự so. Lần chạy sau có thể ra kết quả khác nếu không sửa test case theo — Áp dụng để thêm bước vào test case, hoặc log bug riêng nếu popup / màn đó không đúng thiết kế.
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
          {assist.map((e) => <Item key={e.i} runId={runId} tc={tc} e={e} running={running} />)}
        </ul>
        {running && <div className="cap">Run đang chạy — áp dụng được sau khi run xong.</div>}
      </div>
    </div>
  );
}

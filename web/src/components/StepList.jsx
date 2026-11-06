// Bước của 1 case (từ Excel) + tiến độ thật đọc từ file live: ✓ xong · ● đang chạy · ✕ lệch · ○ chưa tới
import { useEffect, useRef, useState } from 'react';
import { stepStates } from './stepStates.js';

const KIND = { Action: 'k-act', Nav: 'k-nav', Check: 'k-chk' };
const show = (v) => (v === true ? 'true' : v === false ? 'false' : v == null ? '—' : String(v));
const ICON = { done: '✓', fail: '✕', run: '●', todo: '○', stop: '⊘' };

// collapseDone: case đã chạy xong mà có bước lỗi → gập các bước đạt thành một dòng, bước lỗi nằm ngay đầu mắt
export function StepList({ rows, live, running, failed, error, collapseDone = false }) {
  const [showAll, setShowAll] = useState(false);
  const st = stepStates(rows, live, { running, failed });
  const curRef = useRef(null);
  const cur = st.findIndex((s) => s.state === 'run');
  // Tự cuộn theo bước đang chạy (chỉ trong khung bước, không kéo cả trang)
  useEffect(() => {
    const el = curRef.current;
    const box = el?.closest('.steplist');
    if (el && box) box.scrollTo({ top: el.offsetTop - box.offsetTop - 40, behavior: 'smooth' });
  }, [cur, live.length]);
  const done = st.filter((s) => s.state === 'done' || s.state === 'fail').length;
  const hasProblem = st.some((s) => s.state !== 'done');
  const collapse = collapseDone && !running && hasProblem && !showAll;
  const items = [];
  rows.forEach((r, i) => {
    if (collapse && st[i].state === 'done') {
      const last = items[items.length - 1];
      if (last?.group) last.n += 1; else items.push({ group: true, n: 1, key: `g${i}` });
    } else items.push({ r, i });
  });
  return (
    <div className="steplist">
      <div className="steplist-meta cap">{done}/{rows.length} bước{st.some((s) => s.state === 'fail') ? ` · ${st.filter((s) => s.state === 'fail').length} điểm kiểm lệch` : ''}
        {collapseDone && !running && hasProblem && showAll && <button type="button" className="linkbtn" style={{ marginLeft: 8 }} onClick={() => setShowAll(false)}>Gập bước đạt</button>}</div>
      <ol>
        {items.map((it) => {
          if (it.group) return <li key={it.key} className="st-group"><button type="button" className="linkbtn" onClick={() => setShowAll(true)}>✓ {it.n} bước đạt · hiện</button></li>;
          const { r, i } = it;
          const s = st[i];
          return (
            <li key={i} ref={s.state === 'run' ? curRef : undefined} className={`st st-${s.state}`} aria-current={s.state === 'run' ? 'step' : undefined}>
              <span className="st-ic" aria-hidden="true">{ICON[s.state]}</span>
              <span className={`kind ${KIND[r.kind] || ''}`}>{r.kind}</span>
              <div className="st-body">
                <span className="cap mono">{r.step} · {r.screen}</span>
                <div><b>{r.keyword}</b>{r.target ? ` “${r.target}”` : ''}{r.value ? <span className="muted"> = {r.value}</span> : null}</div>
                {r.label && <div className="cap">{r.label}</div>}
                {s.state === 'fail' && <div className="st-diff">App: <b>{show(s.ev.actual)}</b> · mong đợi: <b>{show(s.ev.expected)}</b></div>}
                {s.state === 'stop' && error && <div className="st-diff">{error.split('\n')[0]}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

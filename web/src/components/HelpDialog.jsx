// Chế độ sửa tay khi lỗi: step chặn luồng đang chờ tester — chọn phần tử trên ảnh / danh sách rồi Block / Skip / Retry / Use / Fix
import { useState } from 'react';
import { Icon } from './Icon.jsx';
import { ErrorNote } from './ui.jsx';

const KIND = { tap: 'Tap', back: 'Back', enter: 'Enter', nav: 'Verify screen', gone: 'Chờ màn sang bước', alert: 'Hộp thoại hệ thống' };
const ACTIONS = {
  block: { label: 'Block', hint: 'Dừng case này (Blocked) và log bug như bình thường.' },
  skip: { label: 'Skip step', hint: 'Bỏ qua step này, log bug, chạy tiếp các step sau.' },
  retry: { label: 'Retry', hint: 'Thử lại step (vd app load chậm). Được thì không log bug.' },
  use: { label: 'Use element', hint: 'Dùng phần tử đã chọn cho lần chạy này, vẫn log bug (app khác test case).' },
  fix: { label: 'Fix script & go on', hint: 'Lưu phần tử đã chọn cho các lần chạy sau, không log bug (script sai, app đúng).' },
};
const nameOf = (e) => e.name || e.label || '';

export function HelpDialog({ help, onAnswer }) {
  const [pick, setPick] = useState(null);
  const [q, setQ] = useState('');
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // App đang ở màn khác màn bước cần → gốc lỗi ở bước trước: chọn phần tử trên màn này vô ích → ẩn (mở lại được nếu chắc chắn)
  const wrong = help.wrongScreen;
  const [pickAnyway, setPickAnyway] = useState(false);
  const canPick = help.choices.includes('use') && (!wrong || pickAnyway);
  const mapEls = help.mapElements || []; // phần tử tester thêm / sửa tay trong Locator map (màn giống màn đang hiện)
  // Bước Tap: bấm thẳng vào ảnh (chỗ không có phần tử có tên, vd nút X không gắn nhãn) → bấm theo toạ độ tỉ lệ màn hình
  const canPoint = canPick && ['tap', 'back'].includes(help.kind);
  // Verify screen: Use / Fix = coi phần tử là dấu hiệu màn (không bấm) — ghi rõ để không nhầm với bấm
  const prevTxt = help.prev ? `step ${help.prev.step} · ${help.prev.keyword}${help.prev.target ? ` "${help.prev.target}"` : ''} (màn ${help.prev.screen})` : 'bước trước';
  const WRONG = wrong && {
    block: { label: 'Block — lỗi từ bước trước', hint: `Dừng case (Blocked). Bug ghi: app đang ở màn "${wrong.now}" sau ${prevTxt}.` },
    retry: { label: 'Đã đưa app về đúng màn — chạy tiếp', hint: `Tự thao tác trên simulator / máy để về màn ${wrong.expected || help.screen}, rồi bấm nút này: tool làm lại step này.` },
  };
  const label = (a) => (WRONG?.[a] ? WRONG[a].label : help.kind === 'nav' && a === 'use' ? 'Dùng làm dấu hiệu màn' : help.kind === 'nav' && a === 'fix' ? 'Lưu làm dấu hiệu màn' : ACTIONS[a].label);
  const hintOf = (a) => (WRONG?.[a] ? WRONG[a].hint : help.kind === 'nav' && ['use', 'fix'].includes(a) ? 'Không bấm phần tử này — chỉ coi nó là dấu hiệu đã tới màn. Muốn bấm thay thì sửa ở bước bấm trước đó.' : ACTIONS[a].hint);
  const pickPoint = (ev) => {
    if (!canPoint) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    const fy = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
    setPick({ type: 'Điểm', name: `điểm (${Math.round(fx * 100)}%, ${Math.round(fy * 100)}%)`, locator: `point:${fx.toFixed(3)},${fy.toFixed(3)}`, point: { fx, fy } });
  };
  const els = help.elements.filter((e) => !q || `${e.type} ${nameOf(e)}`.toLowerCase().includes(q.toLowerCase()));
  const win = help.win;
  const box = (e) => ({ left: `${(e.rect.x / win.width) * 100}%`, top: `${(e.rect.y / win.height) * 100}%`, width: `${(e.rect.width / win.width) * 100}%`, height: `${(e.rect.height / win.height) * 100}%` });
  const send = async (action) => {
    setBusy(true);
    const extra = wrong && action === 'block' ? { wrongScreen: wrong.now, prev: help.prev } : {};
    try { await onAnswer(action, ['use', 'fix'].includes(action) ? pick : null, extra); } catch (e) { setErr(e); setBusy(false); }
  };
  const what = help.target === '(screen)' ? `"${help.screen}"` : `"${help.target}"`;
  return (
    <div className="overlay">
      <div className="scrim" />
      <section className="help-modal" role="dialog" aria-modal="true" aria-label={`Sửa step ${what}`}>
        <div className="hm-head">
          <h2><Icon name="warn" /> Sửa step: {KIND[help.kind] || help.kind} {what}</h2>
          <span className="cap">{help.tc} · step {help.step ?? '—'} · {help.screen}</span>
          <div className="hm-err">{help.error}</div>
        </div>
        {wrong && (
          <div className="alert alert-warn hm-wrong"><Icon name="warn" /><div style={{ flex: 1, minWidth: 0 }}>
            <b>App đang ở màn "{wrong.now}"</b>{wrong.expected ? <>, không phải màn "{wrong.expected}" mà step này cần</> : <>, không phải màn {help.screen}</>}.
            {' '}Lỗi nhiều khả năng từ <b>{prevTxt}</b> — chọn phần tử trên màn này không sửa được.
            <div className="cap" style={{ marginTop: 4 }}>Chọn <b>Block</b> để ghi bug đúng gốc, hoặc tự đưa app về đúng màn trên simulator rồi chọn <b>chạy tiếp</b>. Nếu bước trước bấm sai locator: sau run, sửa locator của bước đó ở Locator map.</div>
            {!pickAnyway && help.choices.includes('use') && <button type="button" className="linkbtn" onClick={() => setPickAnyway(true)}>Màn này thật ra đúng — vẫn chọn phần tử</button>}
          </div></div>
        )}
        <ErrorNote error={err} />
        <div className="hm-body">
          <div className="phone hm-shot">
            <img src={help.shotUrl} alt={`Màn hình lúc lỗi — ${help.screen}`} onClick={pickPoint} style={canPoint ? { cursor: 'crosshair' } : undefined} />
            {canPick && win && help.elements.filter((e) => e.rect?.width).map((e, i) => (
              <button key={`${i}-${e.locator}`} type="button" className={pick?.locator === e.locator ? 'hm-box on' : 'hm-box'} style={box(e)} title={`${e.type} ${nameOf(e)}`} onClick={() => setPick(e)} />
            ))}
            {pick?.point && <span className="hm-point" style={{ left: `${pick.point.fx * 100}%`, top: `${pick.point.fy * 100}%` }} />}
          </div>
          <div className="hm-side">
            {canPick ? (
              <>
                {help.suggestions.length > 0 && (
                  <div className="hm-sugg"><span className="cap">Có phải ý bạn là</span>
                    {help.suggestions.map((e) => <button key={e.locator} type="button" className={pick?.locator === e.locator ? 'hm-chip on' : 'hm-chip'} onClick={() => setPick(e)}>{nameOf(e)} · {e.type}</button>)}
                  </div>
                )}
                {mapEls.length > 0 && (
                  <div className="hm-sugg"><span className="cap">Đã thêm / sửa tay trong Locator map</span>
                    {mapEls.map((e) => {
                      const pt = e.locator.match(/^point:(\d*\.?\d+),(\d*\.?\d+)$/);
                      const off = pt && !canPoint; // vị trí chỉ dùng cho bước Tap
                      return (
                        <button key={`map-${e.locator}`} type="button" disabled={off} title={`${e.screen} · ${e.locator}${off ? ' — vị trí chỉ dùng cho bước Tap' : ''}`}
                          className={pick?.locator === e.locator ? 'hm-chip on' : 'hm-chip'}
                          onClick={() => setPick({ ...e, name: e.key || nameOf(e), ...(pt ? { point: { fx: Number(pt[1]), fy: Number(pt[2]) } } : {}) })}>
                          {e.key || nameOf(e) || e.type}{pt ? ' · vị trí' : ` · ${e.type}`}
                        </button>
                      );
                    })}
                    {!canPoint && mapEls.some((e) => e.locator.startsWith('point:')) && (
                      <div className="cap" style={{ width: '100%' }}>Vị trí chỉ dùng cho bước <b>Tap</b> — bước này là {KIND[help.kind] || help.kind}. Nếu bước bấm trước đó bấm sai chỗ, chọn <b>Block</b> rồi sửa locator của bước đó ở Locator map → "Đã sửa khi chạy".</div>
                    )}
                  </div>
                )}
                {canPoint && <div className="cap">Không có trong danh sách (vd nút không gắn nhãn)? <b>Bấm thẳng vào chỗ đó trên ảnh</b> — tool sẽ bấm theo vị trí.</div>}
                <input className="inp" placeholder="Lọc phần tử" value={q} onChange={(e) => setQ(e.target.value)} />
                <div className="hm-list" role="listbox" aria-label="Phần tử trên màn">
                  {els.map((e) => (
                    <button key={e.locator} type="button" role="option" aria-selected={pick?.locator === e.locator} className={pick?.locator === e.locator ? 'hm-el on' : 'hm-el'} onClick={() => setPick(e)}>
                      <span className="mono cap">{e.type}</span><span>{nameOf(e) || '—'}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : wrong ? null : <div className="cap">Bước này không có phần tử để chọn thay — chọn Block, Skip step hoặc Retry.</div>}
          </div>
        </div>
        <div className="hm-foot">
          <span className="cap" style={{ flex: 1 }}>{hint || (pick ? `Đã chọn: ${pick.type} "${nameOf(pick)}"` : '')}</span>
          {help.choices.filter((a) => canPick || !['use', 'fix'].includes(a)).map((a) => (
            <button key={a} type="button" className={a === 'fix' || (wrong && !canPick && a === 'block') ? 'btn btn-primary' : 'btn'} disabled={busy || (['use', 'fix'].includes(a) && !pick)}
              onMouseEnter={() => setHint(hintOf(a))} onMouseLeave={() => setHint('')} onClick={() => send(a)}>{label(a)}</button>
          ))}
        </div>
      </section>
    </div>
  );
}

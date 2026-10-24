// Ghép bước đã chạy (file live) vào các dòng Excel của case — dùng cho màn Run
const same = (row, ev) => row.kind === ev.kind && (row.keyword === ev.keyword || !ev.keyword) && (!row.target || !ev.target || row.target === ev.target || String(ev.target).includes(row.target));

// Ghép sự kiện đã chạy vào các dòng Excel theo thứ tự; dòng nằm trước dòng đã khớp mà AI không log (vd Nav) coi như đã qua
export function stepStates(rows = [], live = [], { running, failed }) {
  const out = rows.map(() => ({ state: 'todo' }));
  let j = 0;
  let last = -1;
  rows.forEach((row, i) => {
    for (let k = j; k < live.length; k++) {
      if (same(row, live[k])) {
        out[i] = { state: live[k].ok === false ? 'fail' : 'done', ev: live[k] };
        j = k + 1;
        last = i;
        break;
      }
    }
  });
  for (let i = 0; i < last; i++) if (out[i].state === 'todo') out[i] = { state: 'done', implicit: true };
  const next = out.findIndex((s) => s.state === 'todo');
  if (next >= 0 && running) out[next] = { state: 'run' };
  if (next >= 0 && failed && !running) out[next] = { state: 'stop' };
  return out;
}


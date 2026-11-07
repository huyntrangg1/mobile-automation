// Dòng Steps / Expected / Pre-condition cho report từ các dòng test case v2 (không chạy gì).
import { fill } from '../../data/loaders/testcase-v2.js';

const PLATFORM = process.env.PLATFORM || 'iOS';
export const runsHere = (r) => !r.platform || r.platform === 'All' || r.platform === PLATFORM;
// Màn bắt đầu = màn của dòng đầu tiên CÓ tên màn (dòng Launch fresh / Run flow thường để trống cột Screen)
export const startScreen = (tc) => tc.rows.find((r) => runsHere(r) && String(r.screen || '').trim())?.screen;

export function describeCase(tc, data = {}) {
  const v = (x) => { try { return fill(x, data); } catch { return x; } };
  const line = (r) => [r.keyword, r.target && `"${v(r.target)}"`, r.value && `= ${v(r.value)}`].filter(Boolean).join(' ');
  const by = (kind) => {
    const m = new Map();
    for (const r of tc.rows.filter((x) => x.kind === kind && runsHere(x))) m.set(r.step, [...(m.get(r.step) || []), line(r)]);
    return [...m].map(([step, l]) => `${step}. ${l.join(' → ')}`);
  };
  // rows: tên màn theo test case (cột Screen) cho từng dòng → report đặt tên màn trong bug theo test case
  const rows = tc.rows.filter(runsHere).map((r) => ({ step: r.step, screen: r.screen, kind: r.kind, keyword: r.keyword, target: v(r.target) }));
  return { steps: by('Action'), expected: by('Check'), precondition: tc.pre.map(v), start: startScreen(tc), rows };
}

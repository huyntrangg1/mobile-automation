// Câu hỏi của worker (chế độ sửa tay khi lỗi): <run dir>/help.json + help.png + help.xml → run.help cho màn Run
import fs from 'node:fs';
import path from 'node:path';
import { parseElements, screenSimilarity, windowOf } from '../locators/pageSource.js';

const bigrams = (s) => {
  const t = String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const out = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
};
// Hệ số Dice trên cặp ký tự liền nhau: 1 = giống hệt, 0 = không chung cặp nào
function dice(a, b) {
  const x = bigrams(a);
  const y = bigrams(b);
  if (!x.length || !y.length) return a && b && String(a).toLowerCase() === String(b).toLowerCase() ? 1 : 0;
  const pool = [...y];
  let hit = 0;
  for (const g of x) {
    const i = pool.indexOf(g);
    if (i >= 0) { hit++; pool.splice(i, 1); }
  }
  return (2 * hit) / (x.length + y.length);
}

// "Có phải ý bạn là…": tối đa 3 phần tử có chữ gần target nhất (≥ 0.4)
export function suggest(target, elements) {
  return elements
    .map((e) => ({ e, s: dice(target, e.name || e.label) }))
    .filter((x) => x.s >= 0.4)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.e);
}

// App đang ở màn khác màn bước này cần? (gốc lỗi ở bước trước, chọn locator trên màn này vô ích)
//   Màn bước cần = màn trong Locator map có locator của bước (sel); không có (tìm theo chữ) → màn có tên / phần tử gần tên màn + target.
//   Màn đang hiện = màn giống page source lúc lỗi nhất (≥ 0.7). Khác nhau rõ → { now, expected, score }
export function wrongScreenOf({ sel, screen, target }, parsed, screens) {
  if (!parsed.length || !screens.length) return null;
  const ranked = screens.map((s) => ({ s, sc: screenSimilarity(s.elements || [], parsed) })).sort((a, b) => b.sc - a.sc);
  const best = ranked[0];
  if (!best || best.sc < 0.7) return null; // không nhận ra màn đang hiện → không đoán
  const hasSel = (s) => sel && (s.elements || []).some((e) => e.locator === sel || (e.alts || []).includes(sel));
  const near = (s) => [s.name, ...(s.aliases || [])].some((n) => dice(n, screen) >= 0.6)
    || (target && target !== '(screen)' && (s.elements || []).some((e) => [e.key, e.name, e.label].some((x) => x && dice(x, target) >= 0.8)));
  const expected = screens.filter(hasSel);
  if (expected.length) {
    if (expected.includes(best.s)) return null;
    const exp = ranked.find((x) => expected.includes(x.s));
    if (exp && exp.sc >= 0.6) return null; // màn cần cũng khá giống màn đang hiện (vd cùng màn, vài phần tử khác) → không kết luận sai màn
    return { now: best.s.name, expected: expected[0].name, score: Math.round(best.sc * 100) };
  }
  if (near(best.s)) return null;
  return { now: best.s.name, expected: null, score: Math.round(best.sc * 100) };
}

// help.json chưa trả lời → { id, tc, step, screen, target, kind, error, choices, shotUrl, win, elements, suggestions } | null
// screens: các màn trong Locator map của app → màn giống màn đang hiện nhất cho thêm phần tử tester đã thêm / sửa tay
//   (vd point: cho nút không có nhãn — page source lúc chạy không có)
export function readHelp(runDir, runId, { screens = [] } = {}) {
  let h;
  try { h = JSON.parse(fs.readFileSync(path.join(runDir, 'help.json'), 'utf8')); } catch { return null; }
  let xml = '';
  try { xml = fs.readFileSync(h.source, 'utf8'); } catch {}
  const parsed = xml ? parseElements(xml) : [];
  const elements = parsed.filter((e) => e.locator).map(({ type, name, label, rect, locator }) => ({ type, name, label, rect, locator }));
  // Mọi màn đủ giống (≥ 0.5; map có thể có nhiều bản của cùng màn), giống nhất trước; bỏ trùng theo locator
  const near = screens.map((s) => ({ s, sc: parsed.length ? screenSimilarity(s.elements || [], parsed) : 0 })).filter((x) => x.sc >= 0.5).sort((a, b) => b.sc - a.sc);
  const seen = new Set();
  const mapElements = near.flatMap(({ s }) => (s.elements || []).filter((e) => e.manual && e.locator && !seen.has(e.locator) && seen.add(e.locator))
    .map(({ type, name, label, rect, locator, key }) => ({ type, name, label, rect, locator, key: key || name || label || '', screen: s.name })));
  return {
    id: h.id, tc: h.tc, step: h.step, screen: h.screen, target: h.target, kind: h.kind, error: h.error, choices: h.choices,
    shotUrl: `/files/data/runs/${runId}/${path.basename(h.shot || 'help.png')}?t=${h.id}`,
    win: xml ? windowOf(xml) : null,
    elements,
    mapElements,
    suggestions: h.target && h.target !== '(screen)' ? suggest(h.target, elements) : [],
    prev: h.prev || null,
    wrongScreen: wrongScreenOf(h, parsed, screens),
  };
}

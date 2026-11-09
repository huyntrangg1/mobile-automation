// Giới hạn thời gian 1 case. Mocha hết timeout chỉ bỏ qua case: code cũ vẫn chạy và bấm vào app trong khi case sau đã bắt đầu.
// Ở đây: hết giờ → đánh dấu huỷ cho riêng case đó (k.* và $ / $$ gọi từ case đó ném lỗi ngay), chờ code của case dừng hẳn rồi mới báo lỗi.
// Case nào đang chạy được nhận ra qua AsyncLocalStorage → case sau (chạy trong ngữ cảnh khác) không bị ảnh hưởng.
import { AsyncLocalStorage } from 'node:async_hooks';

const ctx = new AsyncLocalStorage();

export function stopIfAborted() {
  const c = ctx.getStore();
  if (c?.reason) throw new Error(c.reason);
}

// Bọc các hàm của api (vd object k của steps.js): case đã huỷ gọi tiếp → ném lỗi ngay, không chạm tới app
const STALE = /expired from the internal cache|stale element|either not present or it has expired/i;
export function guardApi(api) {
  for (const [name, fn] of Object.entries(api)) {
    if (typeof fn !== 'function') continue;
    // Phần tử hết hạn giữa chừng (app vẽ lại màn: "has expired from the internal cache", stale element) → làm lại bước đó 1 lần.
    // Lỗi xảy ra trước khi bước kịp bấm / ghi điểm kiểm nên làm lại không bị trùng
    api[name] = function (...args) {
      stopIfAborted();
      const out = fn.apply(this, args);
      if (!out || typeof out.then !== 'function') return out;
      return out.catch(async (e) => {
        if (!STALE.test(String(e?.message || e))) throw e;
        await new Promise((r) => setTimeout(r, 500));
        stopIfAborted();
        return fn.apply(this, args);
      });
    };
  }
  return api;
}

// Bọc $ / $$ toàn cục 1 lần: code AI tự viết (gọi thẳng $) của case đã huỷ cũng dừng
export function guardGlobals(g = globalThis) {
  for (const name of ['$', '$$']) {
    const raw = g[name];
    if (typeof raw !== 'function' || raw.guarded) continue;
    const wrapped = (...args) => {
      stopIfAborted();
      return raw(...args);
    };
    wrapped.guarded = true;
    g[name] = wrapped;
  }
}

// Chạy fn (case) tối đa ms. ms = 0 → không giới hạn (chế độ sửa tay chờ tester trả lời).
// Hết giờ: ctl.reason = lý do huỷ, chờ fn dừng (tối đa settleMs) rồi ném lỗi. describe() = bước cuối đã làm, ghi vào lý do.
export async function runWithLimit(ctl, fn, { ms = 0, settleMs = 60000, describe = () => '' } = {}) {
  const run = ctx.run(ctl, fn);
  if (!ms) return run;
  const LIMIT = Symbol('limit');
  let timer;
  const first = await Promise.race([run.then(() => null), new Promise((r) => { timer = setTimeout(() => r(LIMIT), ms); })])
    .finally(() => clearTimeout(timer));
  if (first !== LIMIT) return;
  const last = describe();
  ctl.reason = `Quá thời gian ${ms / 1000}s — case bị huỷ${last ? ` (bước cuối đã làm: ${last})` : ''}`;
  let settle;
  await Promise.race([run.catch(() => {}), new Promise((r) => { settle = setTimeout(r, settleMs); })]);
  clearTimeout(settle);
  throw new Error(ctl.reason);
}

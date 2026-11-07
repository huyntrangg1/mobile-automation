// Kiểm tra trước khi chạy (như "preflight" + "dry-run" của skill test-execution): bắt lỗi môi trường / script TRƯỚC khi chiếm thiết bị,
// thay vì để wdio chết giữa chừng ("wdio dừng (exit 1)…"). fail = chặn Run; warn = vẫn chạy được, nên xem.
import { startScreen } from '../apps/template/src/runner/describe.js';

const item = (id, group, label, status, detail = '', fix = '') => ({ id, group, label, status, detail, fix });
const list = (xs, n = 6) => xs.slice(0, n).join(', ') + (xs.length > n ? ` (+${xs.length - n})` : '');

// runCases: case sẽ chạy (đã gồm case phía trước của chuỗi), theo thứ tự · deps: các hàm hỏi máy (thật ở runner, giả ở test)
export async function preflight({ app, udid, runCases, deps }) {
  const items = [];
  const platform = app.platform || 'iOS';

  // ---- Thiết bị
  const devices = await deps.listDevices(platform).catch(() => []);
  const d = devices.find((x) => x.udid === udid);
  if (!d) items.push(item('device', 'Thiết bị', 'Thiết bị', 'fail', `Không thấy thiết bị ${udid}`, 'Chọn lại thiết bị, hoặc bật Simulator / cắm máy rồi tải lại trang'));
  else if (d.offline) items.push(item('device', 'Thiết bị', 'Thiết bị', 'fail', d.note || 'Thiết bị đang offline', 'Mở khoá máy, cắm lại cáp, bấm Tin cậy trên máy'));
  else items.push(item('device', 'Thiết bị', 'Thiết bị', 'ok', d.booted === false ? `${d.name || udid} đang tắt — tool tự bật và chờ khởi động xong` : d.name || udid));

  if (!app.appPath || !deps.exists(app.appPath)) items.push(item('app', 'Thiết bị', 'File app', 'fail', app.appPath ? `Không thấy ${app.appPath}` : 'App chưa có file build', 'Cập nhật bản build ở Cài đặt app'));
  else items.push(item('app', 'Thiết bị', 'File app', 'ok'));

  if (await deps.portBusy(4723).catch(() => false)) items.push(item('appium', 'Thiết bị', 'Cổng Appium 4723', 'warn', 'Đang có Appium khác chiếm cổng (thường do run trước chưa tắt hẳn) — wdio có thể không khởi động được', 'Đợi vài giây cho run trước dọn xong, hoặc tắt Appium cũ: lsof -ti :4723 | xargs kill'));

  // ---- Script (dry-run: không chạy gì, chỉ kiểm mọi thứ khớp)
  const files = [...new Set(runCases.map((c) => c.file))];
  const bad = [];
  for (const f of files) { const e = await deps.syntaxError(deps.specPath(f)); if (e) bad.push(`${f}: ${e}`); }
  items.push(bad.length ? item('syntax', 'Script', 'Cú pháp file script', 'fail', bad.join('; '), 'Mở trang Scripts sửa đoạn lỗi, hoặc gen lại case đó') : item('syntax', 'Script', 'Cú pháp file script', 'ok'));

  const stale = runCases.filter((c) => c.script?.status === 'stale').map((c) => c.tcId);
  if (stale.length) items.push(item('stale', 'Script', 'Script cũ hơn test case', 'warn', `${stale.length} case đã sửa test case sau khi gen script: ${list(stale)}`, 'Gen lại script cho các case này'));

  // Case Tiếp nối: nếu case trước bị chặn, tool cài lại app rồi đi theo sơ đồ màn từ màn bắt đầu của case đầu chuỗi tới màn bắt đầu của case này
  const by = new Map(runCases.map((c) => [c.tcId, c]));
  const rootOf = (c) => { const seen = new Set(); let x = c; while (x && !x.fresh && x.prev && !seen.has(x.tcId)) { seen.add(x.tcId); x = by.get(x.prev); } return x; };
  const follow = runCases.filter((c) => !c.fresh && c.prev);
  const noStart = new Set();
  for (const c of follow) {
    const root = rootOf(c);
    if (!root || !startScreen(root)) noStart.add(root?.tcId || c.prev);
    if (!startScreen(c)) noStart.add(c.tcId);
  }
  if (noStart.size) items.push(item('chain', 'Script', 'Màn bắt đầu của chuỗi Tiếp nối', 'warn', `Không biết màn bắt đầu (cột Screen trống ở mọi dòng): ${list([...noStart])} — case trước bị chặn thì case sau không tự điều hướng được, sẽ Blocked theo`, 'Điền cột Screen cho dòng thao tác đầu tiên của các case này'));
  if (follow.length && !deps.navEdges(app.workspace, deps.build)) items.push(item('navgraph', 'Script', 'Sơ đồ màn của build này', 'warn', 'Chưa có đường đi nào được ghi cho bản build này — case Tiếp nối bị chặn sẽ không tự điều hướng được', 'Chạy trước một lượt các case đi qua nhiều màn (E2E) để tool ghi sơ đồ'));

  return { ok: !items.some((i) => i.status === 'fail'), items };
}

// Các hàm hỏi máy thật
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { listDevices } from '../device/platforms.js';

export function realDeps({ specPath, build }) {
  return {
    listDevices, build, specPath,
    exists: (p) => fs.existsSync(p),
    portBusy: async (port) => {
      try { return (await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
    },
    syntaxError: (p) => new Promise((resolve) => {
      if (!fs.existsSync(p)) return resolve('chưa có file script — gen script trước');
      execFile(process.execPath, ['--check', p], (e, _o, err) => resolve(e ? (String(err || e.message).split('\n').find((l) => /Error/.test(l)) || 'lỗi cú pháp').trim() : null));
    }),
    navEdges: (workspace, stamp) => {
      try { return JSON.parse(fs.readFileSync(path.join(workspace, 'data', 'nav-graph.json'), 'utf8')).edges.filter((e) => e.build === stamp).length; } catch { return 0; }
    },
  };
}

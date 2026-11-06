// Run: chạy wdio trong workspace của app cho các case đã chọn (+ case phía trước của chuỗi), theo dõi kết quả trực tiếp.
// Kết quả đọc từ REPORTS_DIR/results/*.json do report chung (skill test-report, writeResult) ghi sau mỗi test.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { closure } from '../testcases/closure.js';
import { WDA_DIR } from '../paths.js';
import { androidEnv, deviceScreenshot, wdaInstalled } from '../device/platforms.js';
import { readHelp } from './help.js';

const MAX_LOG = 2000;
const STATUSES = ['passed', 'failed', 'blocked', 'skipped', 'notrun'];

// Dấu vết build: đổi khi cài build mới kể cả khi version không tăng.
//   iOS .app: hash _CodeSignature/CodeResources (chứa hash mọi file trong bundle) + Info.plist; .apk / không ký: kích thước + giờ sửa
//   at = lúc build có trong workspace (giờ sửa Info.plist / file apk). Không đọc được → null
export function buildStamp(appPath) {
  try {
    const dir = fs.statSync(appPath).isDirectory();
    const main = dir ? path.join(appPath, 'Info.plist') : appPath;
    const st = fs.statSync(main);
    const parts = dir ? [path.join(appPath, '_CodeSignature/CodeResources'), main].filter((f) => fs.existsSync(f)) : [];
    const stamp = parts.length
      ? crypto.createHash('sha1').update(Buffer.concat(parts.map((f) => fs.readFileSync(f)))).digest('hex').slice(0, 12)
      : `${st.size}-${Math.round(st.mtimeMs)}`;
    return { stamp, at: new Date(st.mtimeMs).toISOString() };
  } catch {
    return null;
  }
}

const when = (iso) => new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

// Cảnh báo lúc bắt đầu run: build khác run trước của app / Locator map lấy trước khi có build này
export function buildNotes({ build, prev, mapFile }) {
  const notes = [];
  if (!build) return notes;
  if (prev?.build?.stamp && prev.build.stamp !== build.stamp) notes.push(`⚠ Build khác lần chạy trước (${prev.id}) — locator theo chữ khớp lỏng, chờ màn tự tìm lại; locator lệch được liệt kê cuối run`);
  let mapAt = null;
  try { mapAt = fs.statSync(mapFile).mtime.toISOString(); } catch {}
  if (mapAt && mapAt < build.at) notes.push(`⚠ Locator map lấy lúc ${when(mapAt)}, trước khi có build này (${when(build.at)}) — nên lấy lại locator các màn bị lệch`);
  return notes;
}

// Locator lệch (steps ghi REPORTS_DIR/locator-drift.jsonl): gộp theo màn + locator
export function readDrift(reportsDir) {
  let lines = [];
  try { lines = fs.readFileSync(path.join(reportsDir, 'locator-drift.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { return []; }
  const seen = new Map();
  for (const l of lines) {
    try {
      const d = JSON.parse(l);
      const key = `${d.screen || ''}|${d.locator}`;
      if (!seen.has(key)) seen.set(key, d);
    } catch {}
  }
  return [...seen.values()];
}
export function driftLog(drift) {
  if (!drift.length) return [];
  return [
    `⚠ ${drift.length} locator lệch so với app — test vẫn chạy tiếp, nên cập nhật Locator map:`,
    ...drift.map((d) => `   · ${d.screen ? `${d.screen}: ` : ''}${d.locator} → ${d.actual != null ? `app: ${JSON.stringify(d.actual)}` : `dùng ${d.found}`} (${d.how})`),
  ];
}


// Case cho "Run lại": tất cả case của run, chỉ case lỗi (Failed / Blocked / Not Run), hoặc đúng các TC ID tester chọn
export function rerunCaseIds(run, onlyFailed, tcIds) {
  const bad = new Set(['failed', 'blocked', 'notrun', 'interrupted']);
  const pick = tcIds?.length ? new Set(tcIds) : null;
  return run.caseIds.filter((id, i) => (pick ? pick.has(run.order[i]) : !onlyFailed || bad.has(run.results[run.order[i]]?.status)));
}

// Dòng log dễ đọc từ 1 sự kiện live: từng bước làm gì, điểm kiểm lấy được gì so với mong đợi, thời gian
const hhmmss = (ms) => new Date(ms).toTimeString().slice(0, 8);
const shown = (v, keyword = '') => {
  if (typeof v === 'boolean' && /displayed/i.test(keyword)) return v ? 'có hiện' : 'không hiện';
  if (v === null || v === undefined) return 'không thấy';
  const s = typeof v === 'string' ? JSON.stringify(v) : String(v);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
};
export function formatLive(e, ctx = {}) {
  const { titles = {}, startedAt = {} } = ctx;
  const fails = (ctx.fails ||= {});
  const at = e.at ? `[${hhmmss(e.at)}] ` : '';
  if (e.type === 'start') { startedAt[e.tc] = e.at; return `${at}▶ ${e.tc}${titles[e.tc]?.title ? ` — ${titles[e.tc].title}` : ''}`; }
  if (e.type === 'info') return `${at}   · ${e.text}`;
  if (e.type === 'end') {
    const dur = startedAt[e.tc] && e.at ? ` (${((e.at - startedAt[e.tc]) / 1000).toFixed(1)}s)` : '';
    const lech = fails[e.tc] ? ` · ${fails[e.tc]} điểm kiểm lệch` : '';
    if (e.skipped) return `${at}■ ${e.tc} SKIPPED · ${e.skipped}`;
    return `${at}■ ${e.tc} ${e.ok ? (lech ? 'FAILED' : 'PASSED') : `dừng: ${e.error || 'lỗi'}`}${lech}${dur}`;
  }
  if (e.type === 'paused') return `${at}⏸ Tạm dừng`;
  if (e.type === 'resumed') return `${at}▶ Chạy tiếp`;
  if (e.type !== 'step') return null;
  const mark = e.ok === false ? '✗' : '✓';
  const where = `B${e.step ?? '?'}${e.screen ? ` · ${e.screen}` : ''}`;
  if (e.kind === 'Check') {
    if (e.ok === false) fails[e.tc] = (fails[e.tc] || 0) + 1;
    return `${at}   ${mark} ${where} · ${e.keyword || 'Check'} "${e.label}": lấy được ${shown(e.actual, e.keyword)} · mong đợi ${shown(e.expected, e.keyword)}`;
  }
  return `${at}   ${mark} ${where} · ${e.keyword}${e.target ? ` "${e.target}"` : ''}${e.value ? ` = "${e.value}"` : ''}${e.note ? ` (${e.note})` : ''}`;
}
// Dòng wdio lặp lại điều log của tool đã ghi (từng case ✓/✗, tóm tắt spec, stack trace của điểm kiểm lệch)
// — giữ dòng lỗi thật (khởi động phiên, lỗi không thuộc điểm kiểm) và dòng "Spec Files"
export const NOISE = /Hook executed|operate on a modal dialog|^\[[^\]]+ #\d+-\d+\]|^\[\d+-\d+\] (RUNNING|PASSED|FAILED) in|^\s+at |AssertionError|^\s+- Step \d|^\s*actual\s+expected|^\s*(true|false)+\s*$|"spec" Reporter|^-{10,}\s*$/;

export function createRunner({ store, lock, emit, dataDir, scriptPath, spawnImpl = spawn, screenshotImpl = deviceScreenshot, wdaCheck = wdaInstalled, shotMs = 1000, pollMs = 1000, killGraceMs = 15000 }) {
  const procs = new Map(); // runId → { proc, stopping }

  // Mã run tăng dần, không dùng lại mã của run đã xoá (giữ số cuối trong store "meta")
  const seq = () => Math.max(store.get('meta', 'runSeq')?.value || 0, ...store.list('runs').map((r) => Number(r.id.replace(/\D/g, '')) || 0));
  const nextRunId = () => `RUN-${String(seq() + 1).padStart(4, '0')}`;
  const nextId = () => {
    const id = nextRunId();
    store.put('meta', { id: 'runSeq', value: Number(id.replace(/\D/g, '')) });
    return id;
  };
  const update = (id, patch) => {
    const r = store.patch('runs', id, patch);
    emit('run', r);
    return r;
  };

  // File live do khung script ghi: { type: start | step | end, tc, … } mỗi dòng
  function readLive(run) {
    let lines = [];
    try { lines = fs.readFileSync(run.livePath, 'utf8').split('\n').filter(Boolean); } catch { return null; }
    const by = {};
    let current = null;
    let paused = false;
    for (const l of lines) {
      let e;
      try { e = JSON.parse(l); } catch { continue; }
      if (e.type === 'paused') { paused = true; continue; }
      if (e.type === 'resumed') { paused = false; continue; }
      if (!e.tc) continue;
      if (e.type === 'start') { by[e.tc] = []; current = e.tc; }
      else if (e.type === 'end') { if (current === e.tc) current = null; }
      else if (e.type === 'step') {
        const { type, tc, ...step } = e;
        (by[e.tc] ||= []).push(step);
      }
    }
    return { by, current, paused };
  }

  // Đọc kết quả hiện có → results theo TC ID
  function scan(run, final, paused = false) {
    const dir = path.join(run.reportsDir, 'results');
    const results = { ...run.results };
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json') || f === 'env.json' || f.startsWith('planned-')) continue;
        let r;
        try { r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
        const tcId = r.case?.id || String(r.title || '').split(' ')[0];
        if (!results[tcId]) continue;
        results[tcId] = { status: r.status || (r.passed ? 'passed' : 'failed'), duration: r.duration ?? null, error: r.error ? String(r.error).slice(0, 2000) : null, bugs: r.bugs?.length || 0, blockKind: r.blockKind || null };
      }
    }
    // Case đang chạy = case đầu tiên chưa có kết quả
    let marked = false;
    for (const id of run.order) {
      if (!['queued', 'running'].includes(results[id].status)) continue;
      // Đang tạm dừng: chưa case nào chạy → mọi case chưa xong là Queued
      results[id] = { ...results[id], status: final ? 'notrun' : (marked || paused ? 'queued' : 'running') };
      marked = true;
    }
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const r of Object.values(results)) if (r.status in counts) counts[r.status]++;
    return { results, counts };
  }

  // manualFix: chế độ sửa tay khi lỗi — step chặn luồng dừng lại hỏi tester (help.json / answer.json trong thư mục run)
  async function startRun({ appId, udid, caseIds, manualFix = false }) {
    const app = store.get('apps', appId);
    if (!app) throw Object.assign(new Error('Không có app này'), { status: 404 });
    if (app.status !== 'ready') throw Object.assign(new Error('App chưa sẵn sàng'), { status: 409 });
    if (!udid) throw Object.assign(new Error('Chọn thiết bị'), { status: 400 });
    const cases = store.list('cases').filter((c) => c.appId === appId);
    const plan = closure(cases, caseIds);
    if (!plan.run.length) throw Object.assign(new Error('Chưa chọn case'), { status: 400 });
    if (plan.missing.length) throw Object.assign(new Error(`Không chạy được: ${plan.missing.map((m) => `${m.tcId}: ${m.reason}`).join('; ')}`), { status: 400, missing: plan.missing });
    const byId = new Map(cases.map((c) => [c.id, c]));
    const runCases = plan.run.map((id) => byId.get(id));
    const files = [...new Set(runCases.map((c) => c.file))];
    const specs = files.map((f) => scriptPath(app, f));
    const noFile = specs.find((p) => !fs.existsSync(p));
    if (noFile) throw Object.assign(new Error(`Chưa có file script ${path.basename(noFile)} — gen script trước`), { status: 400 });

    const id = nextId();
    const got = lock.acquire({ kind: 'run', id, label: `Đang chạy ${id} · ${app.name}` });
    if (!got.ok) throw Object.assign(new Error(`Thiết bị đang bận: ${got.holder.label}`), { status: 409 });
    emit('lock', lock.current());
    await lock.ready?.();
    const reportsDir = path.join(dataDir, 'runs', id, 'reports');
    const livePath = path.join(dataDir, 'runs', id, 'live.jsonl');
    const pausePath = path.join(dataDir, 'runs', id, 'pause');
    const runDir = path.join(dataDir, 'runs', id);
    fs.mkdirSync(reportsDir, { recursive: true });
    const order = runCases.map((c) => c.tcId);
    const build = buildStamp(app.appPath);
    const prev = store.list('runs').filter((r) => r.appId === appId && r.build?.stamp).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
    const notes = buildNotes({ build, prev, mapFile: path.join(app.workspace || '', 'locators/map.js') });
    const run = {
      build, buildNotes: notes, drift: [],
      id, appId, udid, deviceName: udid, caseIds: plan.run, order, added: plan.added.map((x) => byId.get(x).tcId), files,
      status: 'running', counts: { passed: 0, failed: 0, blocked: 0, skipped: 0, notrun: 0 },
      results: Object.fromEntries(runCases.map((c) => [c.tcId, { status: 'queued', title: c.title, module: c.module }])),
      reportsDir, livePath, pausePath, manualFix: !!manualFix, help: null, current: null, paused: false, pauseRequested: false, reportUrl: null, startedAt: new Date().toISOString(), finishedAt: null, log: [...notes],
    };
    store.put('runs', run);
    // Các bước trong Excel của từng case — màn Run hiện bước đang chạy trên nền danh sách này
    const pick = (r) => ({ step: r.step, screen: r.screen, kind: r.kind, keyword: r.keyword, target: r.target, value: r.value, label: r.label });
    const platform = app.platform || 'iOS';
    const titles = Object.fromEntries(runCases.map((c) => [c.tcId, { title: c.title, module: c.module, rows: (c.rows || []).filter((r) => !r.platform || ['All', platform].includes(r.platform)).map(pick) }]));

    const env = {
      ...process.env, ...(app.env || {}),
      REPORTS_DIR: reportsDir, LIVE_STEPS: livePath, PAUSE_FILE: pausePath, MANUAL_FIX: manualFix ? '1' : '', HELP_DIR: runDir, RUN_CASES: order.join(','), SPECS: specs.join(','), DEVICE_UDID: udid,
      BUILD_STAMP: build?.stamp || '', APP_NAME: app.name, APP_PATH: app.appPath, BUNDLE_ID: app.bundleId, REPORT_OPEN: '0', FORCE_COLOR: '0',
      PLATFORM: platform, APP_VERSION: app.version || '', APP_ACTIVITY: app.activity || '', ...androidEnv(),
      WDA_DIR, WDA_PREBUILT: fs.existsSync(path.join(WDA_DIR, 'Build/Products')) ? '1' : '0',
      WDA_PREINSTALLED: platform === 'iOS' && (await wdaCheck(udid)) ? '1' : '0',
      // Tìm phần tử lúc chạy theo mô tả (k gọi về server khi locator không thấy)
      QAPD_API: `http://127.0.0.1:${process.env.PORT || 5178}/api`, APP_ID: appId,
    };
    const proc = spawnImpl('npx', ['wdio', 'run', 'wdio.conf.js'], { cwd: app.workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const job = { proc, stopping: false, closed: false };
    procs.set(id, job);
    let buf = [];
    const onData = (d) => {
      const lines = String(d).replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((l) => l.trim() && !NOISE.test(l));
      buf.push(...lines);
    };
    // Sự kiện live mới (bước, điểm kiểm) → dòng log dễ đọc. Đọc tiếp từ vị trí đã đọc (không đọc lại cả file);
    // chỉ nhận dòng đã ghi xong (có \n) — dòng đang ghi dở đọc ở lần sau
    let liveOffset = 0;
    const liveCtx = { titles, startedAt: {} };
    const liveLog = () => {
      let chunk;
      try {
        const fd = fs.openSync(livePath, 'r');
        try {
          const size = fs.fstatSync(fd).size;
          if (size <= liveOffset) return;
          chunk = Buffer.alloc(size - liveOffset);
          fs.readSync(fd, chunk, 0, chunk.length, liveOffset);
        } finally { fs.closeSync(fd); }
      } catch { return; }
      const end = chunk.lastIndexOf(0x0a);
      if (end < 0) return;
      liveOffset += end + 1;
      for (const l of chunk.subarray(0, end).toString('utf8').split('\n').filter(Boolean)) {
        try { const t = formatLive(JSON.parse(l), liveCtx); if (t) buf.push(t); } catch {}
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    const withLive = (results, lv = readLive(run)) => {
      for (const k of Object.keys(results)) results[k] = { ...results[k], ...titles[k], live: lv?.by[k] || results[k].live || [] };
      livePaused = !!lv?.paused;
      return lv?.current ?? null;
    };
    let livePaused = false;
    const tick = () => {
      const cur = store.get('runs', id);
      const lv = readLive(run);
      const { results, counts } = scan(cur, false, !!lv?.paused);
      const current = withLive(results, lv);
      liveLog();
      const log = buf.length ? [...cur.log, ...buf].slice(-MAX_LOG) : cur.log;
      buf = [];
      update(id, { results, counts, log, current, paused: livePaused, help: manualFix ? readHelp(runDir, id, { screens: store.list('screens').filter((s) => s.appId === appId) }) : null });
    };
    const timer = setInterval(tick, pollMs);
    // Chụp màn simulator liên tục (ghi file tạm rồi đổi tên để trình duyệt không đọc ảnh dở)
    const shotFile = path.join(dataDir, 'runs', id, 'screen.jpg');
    const shoot = async () => {
      while (!job.closed) {
        const tmp = `${shotFile}.tmp.jpg`;
        try {
          await screenshotImpl(udid, tmp, platform);
          fs.renameSync(tmp, shotFile);
          store.patch('runs', id, { liveShot: `/files/data/runs/${id}/screen.jpg?t=${Date.now()}` });
        } catch {}
        await new Promise((r) => setTimeout(r, shotMs));
      }
    };
    shoot();
    proc.on('close', (code) => {
      job.closed = true;
      fs.rmSync(pausePath, { force: true });
      for (const f of ['help.json', 'help.answered.json', 'answer.json']) fs.rmSync(path.join(runDir, f), { force: true });
      clearInterval(timer);
      tick();
      const cur = store.get('runs', id);
      const { results, counts } = scan(cur, true);
      withLive(results);
      const html = path.join(reportsDir, 'bug-report.html');
      const anyResult = Object.values(results).some((r) => r.status !== 'notrun');
      const status = job.stopping ? 'stopped' : (anyResult || code === 0 ? 'done' : 'error');
      const secs = ((Date.now() - Date.parse(cur.startedAt)) / 1000).toFixed(1);
      const summary = `Kết quả: ${['passed', 'failed', 'blocked', 'skipped', 'notrun'].filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`).join(' · ') || 'không có case nào chạy'} · ${secs}s`;
      const drift = readDrift(reportsDir);
      update(id, {
        log: [...store.get('runs', id).log, ...driftLog(drift), summary].slice(-MAX_LOG),
        drift, results, counts, status, current: null, help: null, paused: false, pauseRequested: false, exitCode: code, finishedAt: new Date().toISOString(),
        reportUrl: fs.existsSync(html) ? `/files/data/runs/${id}/reports/bug-report.html` : null,
        error: status === 'error' ? `wdio dừng (exit ${code}) trước khi chạy được case nào — xem log` : null,
      });
      procs.delete(id);
      lock.release(id);
      emit('lock', lock.current());
      emit('app', { id: appId });
    });
    proc.on('error', (e) => { buf.push(`Không chạy được wdio: ${e.message}`); });
    return { ...run };
  }

  // Tạm dừng / tiếp tục: file cờ mà khung script kiểm trước mỗi case
  async function pause(id) {
    const run = store.get('runs', id);
    if (!procs.has(id) || !run) throw Object.assign(new Error('Run không còn chạy'), { status: 409 });
    fs.writeFileSync(run.pausePath, String(Date.now()));
    update(id, { pauseRequested: true });
  }
  async function resume(id) {
    const run = store.get('runs', id);
    if (!run) return;
    fs.rmSync(run.pausePath, { force: true });
    update(id, { pauseRequested: false });
  }

  // Trả lời câu hỏi đang chờ: block / skip / retry / use / fix (fix → lưu vào bảng sửa locator của workspace)
  async function answer(id, { helpId, action, locator, element, wrongScreen, prev } = {}) {
    const run = store.get('runs', id);
    const fail = (message, status) => Object.assign(new Error(message), { status });
    if (!run || !procs.has(id)) throw fail('Run không còn chạy', 409);
    const dir = path.dirname(run.livePath);
    const h = readHelp(dir, id);
    if (!h || h.id !== helpId) throw fail('Câu hỏi này đã được trả lời hoặc hết hạn', 409);
    if (!h.choices.includes(action)) throw fail(`Không chọn được "${action}" cho bước này`, 400);
    if (['use', 'fix'].includes(action) && !locator) throw fail('Chọn phần tử trước', 400);
    if (String(locator || '').startsWith('point:') && !['tap', 'back'].includes(h.kind)) throw fail('Chọn điểm trên ảnh chỉ dùng cho bước Tap — chọn một phần tử trong danh sách', 400);
    // Đổi tên help.json trước: tick sau không đưa lại câu hỏi, trả lời lần 2 bị từ chối (409)
    fs.renameSync(path.join(dir, 'help.json'), path.join(dir, 'help.answered.json'));
    // Fix: worker tự lưu override sau khi locator chạy được (locator hỏng không bị lưu)
    fs.writeFileSync(path.join(dir, 'answer.json'), JSON.stringify({ id: helpId, action, ...(locator ? { locator } : {}), ...(element ? { element } : {}), ...(wrongScreen ? { wrongScreen, prev: prev || null } : {}) }));
    update(id, { help: null });
  }

  async function stop(id) {
    const job = procs.get(id);
    if (!job) return;
    const run = store.get('runs', id);
    // Đang hỏi tester → trả lời Block để case dừng gọn trước khi tắt wdio
    const h = run?.manualFix ? readHelp(path.dirname(run.livePath), id) : null;
    if (h) fs.writeFileSync(path.join(path.dirname(run.livePath), 'answer.json'), JSON.stringify({ id: h.id, action: 'block' }));
    if (run?.pausePath) fs.rmSync(run.pausePath, { force: true });
    job.stopping = true;
    // wdio / Appium treo khi dọn dẹp → leo thang để nhả simulator
    const send = (sig) => { if (!job.closed) { try { job.proc.kill(sig); } catch {} } };
    send('SIGINT');
    setTimeout(() => send('SIGTERM'), killGraceMs);
    setTimeout(() => send('SIGKILL'), killGraceMs * 2);
  }

  // Xoá run (dữ liệu, ảnh, report). ids = danh sách mã, hoặc { olderThanDays } = mọi run bắt đầu trước N ngày
  async function deleteRuns(ids, { olderThanDays } = {}) {
    const cutoff = olderThanDays ? Date.now() - olderThanDays * 864e5 : null;
    const pick = ids ? ids.map((id) => store.get('runs', id)).filter(Boolean) : store.list('runs').filter((r) => cutoff && Date.parse(r.startedAt) < cutoff);
    const deleted = [];
    const skipped = [];
    for (const r of pick) {
      if (r.status === 'running' || procs.has(r.id)) { skipped.push({ id: r.id, reason: 'Đang chạy — Stop trước khi xoá' }); continue; }
      store.put('meta', { id: 'runSeq', value: seq() }); // giữ số cao nhất trước khi xoá
      fs.rmSync(path.join(dataDir, 'runs', r.id), { recursive: true, force: true });
      store.remove('runs', r.id);
      deleted.push(r.id);
    }
    if (deleted.length) emit('app', {});
    return { deleted, skipped };
  }

  return { startRun, stop, pause, resume, answer, deleteRuns, nextRunId };
}

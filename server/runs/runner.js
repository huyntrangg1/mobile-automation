// Run: chạy wdio trong workspace của app cho các case đã chọn (+ case phía trước của chuỗi), theo dõi kết quả trực tiếp.
// Kết quả đọc từ REPORTS_DIR/results/*.json do report chung (skill test-report, writeResult) ghi sau mỗi test.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { closure } from '../testcases/closure.js';
import { WDA_DIR } from '../paths.js';
import { androidEnv, deviceScreenshot } from '../device/platforms.js';

const MAX_LOG = 2000;
const STATUSES = ['passed', 'failed', 'blocked', 'skipped', 'notrun'];


// Case cho "Run lại": tất cả case của run, chỉ case lỗi (Failed / Blocked / Not Run), hoặc đúng các TC ID tester chọn
export function rerunCaseIds(run, onlyFailed, tcIds) {
  const bad = new Set(['failed', 'blocked', 'notrun', 'interrupted']);
  const pick = tcIds?.length ? new Set(tcIds) : null;
  return run.caseIds.filter((id, i) => (pick ? pick.has(run.order[i]) : !onlyFailed || bad.has(run.results[run.order[i]]?.status)));
}

export function createRunner({ store, lock, emit, dataDir, scriptPath, spawnImpl = spawn, screenshotImpl = deviceScreenshot, shotMs = 1000, pollMs = 1000, killGraceMs = 15000 }) {
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

  async function startRun({ appId, udid, caseIds }) {
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
    const reportsDir = path.join(dataDir, 'runs', id, 'reports');
    const livePath = path.join(dataDir, 'runs', id, 'live.jsonl');
    const pausePath = path.join(dataDir, 'runs', id, 'pause');
    fs.mkdirSync(reportsDir, { recursive: true });
    const order = runCases.map((c) => c.tcId);
    const run = {
      id, appId, udid, deviceName: udid, caseIds: plan.run, order, added: plan.added.map((x) => byId.get(x).tcId), files,
      status: 'running', counts: { passed: 0, failed: 0, blocked: 0, skipped: 0, notrun: 0 },
      results: Object.fromEntries(runCases.map((c) => [c.tcId, { status: 'queued', title: c.title, module: c.module }])),
      reportsDir, livePath, pausePath, current: null, paused: false, pauseRequested: false, reportUrl: null, startedAt: new Date().toISOString(), finishedAt: null, log: [],
    };
    store.put('runs', run);
    // Các bước trong Excel của từng case — màn Run hiện bước đang chạy trên nền danh sách này
    const pick = (r) => ({ step: r.step, screen: r.screen, kind: r.kind, keyword: r.keyword, target: r.target, value: r.value, label: r.label });
    const platform = app.platform || 'iOS';
    const titles = Object.fromEntries(runCases.map((c) => [c.tcId, { title: c.title, module: c.module, rows: (c.rows || []).filter((r) => !r.platform || ['All', platform].includes(r.platform)).map(pick) }]));

    const env = {
      ...process.env, ...(app.env || {}),
      REPORTS_DIR: reportsDir, LIVE_STEPS: livePath, PAUSE_FILE: pausePath, RUN_CASES: order.join(','), SPECS: specs.join(','), DEVICE_UDID: udid,
      APP_NAME: app.name, APP_PATH: app.appPath, BUNDLE_ID: app.bundleId, REPORT_OPEN: '0', FORCE_COLOR: '0',
      PLATFORM: platform, APP_VERSION: app.version || '', APP_ACTIVITY: app.activity || '', ...androidEnv(),
      WDA_DIR, WDA_PREBUILT: fs.existsSync(path.join(WDA_DIR, 'Build/Products')) ? '1' : '0',
    };
    const proc = spawnImpl('npx', ['wdio', 'run', 'wdio.conf.js'], { cwd: app.workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const job = { proc, stopping: false, closed: false };
    procs.set(id, job);
    let buf = [];
    const onData = (d) => {
      const lines = String(d).replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((l) => l.trim());
      buf.push(...lines);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    const withLive = (results) => {
      const lv = readLive(run);
      for (const k of Object.keys(results)) results[k] = { ...results[k], ...titles[k], live: lv?.by[k] || results[k].live || [] };
      livePaused = !!lv?.paused;
      return lv?.current ?? null;
    };
    let livePaused = false;
    const tick = () => {
      const cur = store.get('runs', id);
      const { results, counts } = scan(cur, false, !!readLive(run)?.paused);
      const current = withLive(results);
      const log = buf.length ? [...cur.log, ...buf].slice(-MAX_LOG) : cur.log;
      buf = [];
      update(id, { results, counts, log, current, paused: livePaused });
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
      clearInterval(timer);
      tick();
      const cur = store.get('runs', id);
      const { results, counts } = scan(cur, true);
      withLive(results);
      const html = path.join(reportsDir, 'bug-report.html');
      const anyResult = Object.values(results).some((r) => r.status !== 'notrun');
      const status = job.stopping ? 'stopped' : (anyResult || code === 0 ? 'done' : 'error');
      update(id, {
        results, counts, status, current: null, paused: false, pauseRequested: false, exitCode: code, finishedAt: new Date().toISOString(),
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

  async function stop(id) {
    const job = procs.get(id);
    if (!job) return;
    const run = store.get('runs', id);
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

  return { startRun, stop, pause, resume, deleteRuns, nextRunId };
}

// AI Smoke Test: PRD + Figma → AI rút luồng chính → AI tự mò app trên thiết bị theo từng luồng → ghi điểm lệch.
// Cùng kiểu với các runner khác (khóa thiết bị, phiên Appium, store + emit, recover) nhưng KHÔNG dùng locator map.
import fs from 'node:fs';
import path from 'node:path';
import { openSession, attachSession } from '../device/session.js';
import { scrollToText, fingerprint } from './scroll.js';
import { screenOverlap } from './screenMatch.js';
import { runClaude as defaultRunClaude } from '../ai/claude.js';
import { parseElements, isTransient, toPrompt } from '../locators/pageSource.js';
import { settle, doAction, relaunchApp, MAX_OVERLAY_CLOSES } from '../locators/explore.js';
import { handleAlert } from './alerts.js';
import { isBuyTarget, purchaseCheck, storeContext, pointCheck } from './guard.js';
import { isRealIos } from '../device/platforms.js';
import { looksLikePaywall, closeOverlay, foreignForeground } from '../locators/overlay.js';
import { swipe, tapPoint } from '../ui/device.js';
import { planFlows } from './plan.js';
import { fetchFrameImage } from './figmaImage.js';
import { parseFigmaUrl } from './figmaUrl.js';
import { checkPrdUrl } from './prdUrl.js';
import { keepFinding } from './noise.js';
import { analyzeCapture } from '../ui/analyze.js';
import { backgroundApp, rotateDevice, openDeepLink, sendPush, appDeepLinks } from './lifecycle.js';
import { readExport } from '../locators/figmaFrames.js';
import { loadFigmaExport, summarizeFrames } from './figmaExport.js';

const read = (f) => fs.readFileSync(new URL(`../ai/prompts/${f}`, import.meta.url), 'utf8');
const PROMPT = read('smoke-step.md');
const KNOWLEDGE = read('smoke-knowledge.md');
const ROBUST_KNOWLEDGE = read('smoke-robust.md');
const FULL_KNOWLEDGE = 'CHẾ ĐỘ KIỂM MỞ RỘNG: luồng này có thể là luồng sâu (validation, đổi đơn vị, ranh giới giá trị, bấm liên tục, empty state). Với luồng sâu được phép thử giá trị biên và thao tác lặp theo đúng "expected"; quy tắc "không đào sâu trường hợp biên" ở trên KHÔNG áp dụng. Mốc PRD ghi chưa rõ thì ghi kind unclear, không kết luận đúng sai.';
const ACTIONS = ['tap', 'tapPoint', 'type', 'swipe', 'scrollTo', 'wait', 'back', 'relaunch', 'background', 'rotate', 'openLink', 'push', 'done'];
const STEP_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ACTIONS },
    locator: { type: 'string' },
    x: { type: 'number' },
    y: { type: 'number' },
    text: { type: 'string' },
    summary: { type: 'string' },
    atFrame: { type: 'string' },
    flowStatus: { type: 'string', enum: ['ok', 'deviation', 'unreachable', 'unverifiable'] },
    finding: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['prd', 'figma', 'conflict', 'unclear', 'robust'] }, summary: { type: 'string' }, prdQuote: { type: 'string' }, frameName: { type: 'string' } },
      required: ['kind', 'summary'],
    },
  },
  required: ['action'],
};
// Push giả lập chỉ chạy trên iOS Simulator (simctl push) → thiết bị khác không đưa "push" vào schema / prompt
export const canPush = (app, udid) => app?.platform !== 'Android' && /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(String(udid || ''));
export function stepSchemaFor(push) {
  if (push) return STEP_SCHEMA;
  return { ...STEP_SCHEMA, properties: { ...STEP_SCHEMA.properties, action: { type: 'string', enum: ACTIONS.filter((a) => a !== 'push') } } };
}
const PUSH_LINE = '- "push": gửi push giả lập tới app (chỉ iOS Simulator), "text" là "tiêu đề|nội dung". Chỉ dùng khi luồng đang kiểm thông báo; sau đó nhìn xem app xử lý ra sao (banner, mở màn đích).\n';
// Sau khi bấm nút mua trong app (mở tờ thanh toán): bấy nhiêu bước kế tiếp chỉ được đóng / huỷ — tờ StoreKit có thể không có trong cây phần tử
const ARMED_STEPS = 3;
const MODEL = process.env.QAPD_SMOKE_MODEL || process.env.QAPD_EXPLORE_MODEL || 'claude-sonnet-5-5';
const fill = (tpl, v) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(v[k] ?? ''));
const clampPct = (n) => Math.min(100, Math.max(0, Number(n) || 0));
// Giai đoạn chuẩn bị: AI tự đưa app tới màn chính (onboarding, quyền, paywall) — ngân sách bước riêng, không tính vào luồng nào
const PREPARE = {
  id: 'prepare', name: 'Chuẩn bị: đưa app tới màn chính',
  goal: 'Đi qua onboarding, cho phép các quyền hệ thống mà tính năng cần (Health, thông báo, camera, vị trí, ảnh…; chỉ từ chối theo dõi quảng cáo), đóng quảng cáo / paywall (TUYỆT ĐỐI không mua) cho tới khi thấy màn chính của app. Khi đã ở màn chính: dùng "done" với flowStatus "ok". Không ghi điểm lệch ở giai đoạn này.',
  prdQuote: '', expected: ['Thấy màn chính của app (không còn onboarding, paywall, popup che)'], frames: [], unclear: [],
};
// Luồng giả chạy sau các luồng chính: thử xuống nền / mở lại / xoay màn hình (thao tác thật, kết luận bằng quan sát của AI)
const ROBUST = {
  id: 'robust', name: 'Kiểm bền vững (nền / mở lại / xoay màn hình)',
  goal: 'Thử các gián đoạn thường gặp và xem app có giữ nguyên trạng thái: đưa app xuống nền ~5 giây rồi mở lại, mở lại app (kill), xoay màn hình. Ghi điểm lệch kind "robust" khi trạng thái hoặc dữ liệu mất.',
  prdQuote: '', expected: ['Sau khi xuống nền rồi mở lại: đúng màn đó, dữ liệu và ô đã nhập còn', 'Sau khi mở lại app: dữ liệu đã lưu còn', 'Xoay màn hình (nếu app cho xoay): nội dung không mất, không bị cắt'], frames: [], unclear: [],
};
const bad = (status, message) => Object.assign(new Error(message), { status });

// Chạy fn trên từng phần tử, tối đa n việc cùng lúc
async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { while (queue.length) await fn(queue.shift()); }));
}

export function createSmoke({ store, lock, emit, dataDir, openImpl = openSession, attachImpl = attachSession, pushImpl = sendPush, runClaude = defaultRunClaude, loadFlows = planFlows, frameImage = fetchFrameImage, analyze = analyzeCapture, model = MODEL, settleOpts = {}, limits = {} }) {
  const lim = { maxSteps: 25, prepSteps: 40, robustSteps: 15, flowMs: 300000, totalMs: 1200000, ...limits };
  const jobs = new Map();
  const update = (id, patch) => { const r = store.patch('smoke', id, patch); emit('smoke', r); return r; };
  const log = (id, t) => { const r = store.get('smoke', id); if (r) update(id, { log: [...r.log, `${new Date().toLocaleTimeString('vi-VN')}  ${t}`].slice(-300) }); };
  // Cộng dồn token / chi phí thật của mọi lần gọi AI trong một lần chạy (đọc từ kết quả `claude -p`)
  const usages = new Map();
  const addUsage = (id) => ({ usage: u = {}, cost = 0 }) => {
    const t = usages.get(id) || { calls: 0, input: 0, cacheCreate: 0, cacheRead: 0, output: 0, costUsd: 0 };
    usages.set(id, { calls: t.calls + 1, input: t.input + (u.input_tokens || 0), cacheCreate: t.cacheCreate + (u.cache_creation_input_tokens || 0), cacheRead: t.cacheRead + (u.cache_read_input_tokens || 0), output: t.output + (u.output_tokens || 0), costUsd: t.costUsd + (Number(cost) || 0) });
    if (store.get('smoke', id)) update(id, { usage: usages.get(id) });
  };
  const setFlow = (id, i, patch) => { const r = store.get('smoke', id); update(id, { flows: r.flows.map((x, j) => (j === i ? { ...x, ...patch } : x)) }); };
  const seq = () => Math.max(store.get('meta', 'smokeSeq')?.value || 0, ...store.list('smoke').map((r) => Number(r.id.replace(/\D/g, '')) || 0));
  const dir = (id) => path.join(dataDir, 'smoke', id);
  const url = (id, f) => `/files/data/smoke/${id}/${path.basename(f)}`;

  async function run(id, app, udid, job, { prdUrl, figmaUrl, notes, account, exp, robust, clean, depth }) {
    let session;
    try {
      const onUsage = addUsage(id);
      const signal = job.ctl.signal; // bấm Dừng → huỷ ngay mọi lần gọi AI đang chạy
      const persist = account ? { noPersist: true } : {}; // có mật khẩu trong prompt → không lưu transcript
      // Figma từ file .json: ghi ảnh frame vào thư mục lần chạy, AI nhận danh sách frame (không gọi Figma MCP)
      const jsonFrames = exp ? loadFigmaExport({ data: exp, dir: dir(id) }) : null;
      const planned = await loadFlows({ prdUrl, figmaUrl, figmaSummary: jsonFrames ? summarizeFrames(jsonFrames.frames) : '', notes, depth, onUsage, signal });
      if (!planned.ok) { if (!job.stop) update(id, { status: 'error', error: planned.error }); return; }
      const plan = planned.flows;
      update(id, { flows: [...plan, ...(robust ? [ROBUST] : [])].map((f) => ({ id: f.id, name: f.name, status: 'pending', steps: 0, summary: '' })) });
      log(id, `Rút được ${plan.length} luồng chính từ PRD`);
      fs.mkdirSync(dir(id), { recursive: true });

      // Ảnh frame Figma: tối đa 3 frame mỗi luồng, tải song song (tối đa 4 việc cùng lúc). Không tải được → bỏ so Figma cho frame đó.
      const fig = figmaUrl ? parseFigmaUrl(figmaUrl) : null;
      const frameFiles = new Map();
      const wanted = fig ? [...new Map(plan.flatMap((f) => f.frames.slice(0, 3)).map((fr) => [fr.nodeId, fr])).values()] : [];
      if (jsonFrames) { for (const f of jsonFrames.frames) frameFiles.set(f.id, f.png); log(id, `Figma từ file .json: ${jsonFrames.frames.length} frame`); }
      if (wanted.length) log(id, `Lấy ảnh ${wanted.length} frame Figma…`);
      let firstFrameError = '';
      await pool(wanted, 4, async (fr) => {
        if (job.stop) return;
        const r = await frameImage({ fileKey: fig.fileKey, nodeId: fr.nodeId, outFile: path.join(dir(id), `figma-${fr.nodeId.replace(/\W/g, '_')}.png`), onUsage, signal });
        if (r.ok) frameFiles.set(fr.nodeId, r.file); else { firstFrameError = firstFrameError || r.error; if (!r.cancelled) log(id, r.error); }
      });
      if (job.stop) return;
      // Có link Figma mà không tải được frame nào: không chạy tiếp (sẽ không đối chiếu Figma nhưng vẫn báo "Khớp")
      if (fig && wanted.length && frameFiles.size === 0) {
        update(id, { status: 'error', error: `Không tải được ảnh frame Figma nào nên không đối chiếu được với Figma (${firstFrameError}). Nếu do chưa đăng nhập: trong Claude Code gõ /mcp rồi đăng nhập lại figma.` });
        return;
      }

      // Như noReset của skill: cùng thiết bị + cùng bản build và không yêu cầu cài sạch → dùng lại app đã onboard (không cài lại, khỏi đi lại ~30 bước onboarding)
      const stateKey = `${app.id}|${udid}`;
      const buildTag = String(app.buildAt || app.version || '');
      const saved = store.get('smokeState', stateKey);
      let reuse = !clean && !!saved && saved.build === buildTag;
      session = await (reuse ? attachImpl : openImpl)({ app, udid });
      let driver = session.driver;
      if (reuse) log(id, 'Dùng lại app đã onboard từ lần chạy trước (không cài lại)');
      const android = app.platform === 'Android';
      const push = canPush(app, udid);
      const schema = stepSchemaFor(push);
      let rotated = false; // đã xoay ngang → hết luồng đưa về dọc (luồng sau / lần chạy sau không bị kẹt ngang)
      const live = path.join(dir(id), 'live.png');
      const win = await driver.getWindowSize?.().catch(() => null);
      // Bản nhẹ: page source + ảnh + phần tử, không ghi vào locator map
      const lastShot = { xml: '', png: null }; // lần chụp gần nhất, cho bộ so với Figma
      const snap = async (d) => {
        const xml = await d.getPageSource();
        const png = Buffer.from(await d.takeScreenshot(), 'base64');
        lastShot.xml = xml; lastShot.png = png;
        const elements = parseElements(xml);
        try { fs.writeFileSync(live, png); update(id, { liveShot: `/files/data/smoke/${id}/live.png?t=${Date.now()}` }); } catch {}
        return { elements, usable: elements.length >= 2 && !isTransient(elements) };
      };
      const links = appDeepLinks(app);
      const profileText = links.length ? `\n\nHỒ SƠ APP — deep link đã thống nhất với dev (dùng thao tác "openLink" để vào thẳng màn con khi luồng cần, thay vì đi qua nhiều bước): ${links.join(' ; ')}` : '';
      const deadline = Date.now() + (depth === 'full' ? lim.totalMs * 2 : lim.totalMs);
      const addFinding = (f, frames, a, evidence = null) => {
        const r = store.get('smoke', id);
        const fd = a.finding;
        if (r.findings.some((x) => x.flowId === f.id && x.kind === fd.kind && x.summary === fd.summary)) return false;
        const shot = path.join(dir(id), `${f.id}-finding-${r.findings.length + 1}.png`);
        try { fs.copyFileSync(live, shot); } catch {}
        const fr = frames.find((x) => x.file && fd.frameName && x.name.toLowerCase() === fd.frameName.toLowerCase()) || frames.find((x) => x.file);
        update(id, { findings: [...r.findings, { flowId: f.id, kind: fd.kind, summary: fd.summary, prdQuote: fd.prdQuote || '', frameName: fd.frameName || fr?.name || '', appShot: evidence ? url(id, evidence) : url(id, shot), figmaShot: !evidence && fr ? url(id, fr.file) : '', ...(evidence ? { evidence: true } : {}) }] });
        return true;
      };

      // So bằng code (bộ so ảnh với Figma: vị trí, kích thước, màu, cỡ chữ, chữ) màn hiện tại với một frame trong file Figma .json.
      // Chỉ có khi nạp file .json (có cây node). Trả số điểm lệch mới ghi. Không dùng AI → không tốn token.
      const density = driver.isAndroid ? (Number(driver.capabilities?.pixelRatio || driver.capabilities?.['appium:pixelRatio']) || (Number(driver.capabilities?.deviceScreenDensity) || 0) / 160 || null) : 1;
      const seenCmp = new Set(); // điểm lệch so bằng code đã ghi trong cả lần chạy (cùng loại + cùng mục tiêu chỉ ghi một lần)
      const compareFrame = async (f, fr, frames) => {
        // AI nêu tên frame có thể nhầm: kiểm bằng code màn hiện tại có đúng là màn đó không, không đúng thì không so (khỏi sinh điểm lệch rác)
        const ov = screenOverlap(parseElements(lastShot.xml), fr.texts);
        if (ov.checked && ov.ratio < 0.5) { log(id, `Màn hiện tại không khớp frame "${fr.name}" (trùng ${Math.round(ov.ratio * 100)}% chữ) nên không so`); return 0; }
        const cap = { png: lastShot.png, xml: lastShot.xml, win, density, platform: app.platform || 'iOS' };
        const r = await analyze({ capture: cap, frame: { name: fr.name, json: fr.json, png: fr.png }, evidenceBase: path.join(dir(id), `${f.id}-cmp-${String(fr.id).replace(/\W/g, '_')}`) });
        if (r.status === 'blocked') { log(id, r.error); return 0; }
        const all = (r.findings || []).filter((y) => y.severity !== 'Trivial');
        // Bỏ dữ liệu minh họa (số, ngày, đơn vị), lệch vị trí / cỡ chữ nhiễu, và trùng giữa các frame
        const appTexts = parseElements(lastShot.xml).flatMap((e) => [e.name, e.label, e.text, e.value]).filter(Boolean).map((x) => String(x).toLowerCase().trim());
        const kept = all.filter((y) => keepFinding(y, { appTexts, overlap: ov.checked ? ov.ratio : undefined })).filter((y) => { const k = `${y.kind}|${String(y.target || '').toLowerCase()}`; if (seenCmp.has(k)) return false; seenCmp.add(k); return true; }).slice(0, 6);
        let n = 0;
        for (const x of kept) {
          const summary = `${x.reason}: ${x.actual} ${x.expected}`.trim();
          if (addFinding(f, frames, { finding: { kind: 'figma', summary, prdQuote: '', frameName: fr.name } }, x.image || r.overview || null)) n++;
        }
        log(id, `So với frame "${fr.name}" bằng code: ${n} điểm lệch (bỏ ${all.length - kept.length} mục là dữ liệu minh họa / lệch căn chỉnh / trùng)`);
        return n;
      };

      // Một luồng → { status, summary, steps }
      const runFlowSteps = async (f, { maxSteps = lim.maxSteps } = {}) => {
        const frames = f.frames.slice(0, 3).map((fr) => ({ ...fr, file: frameFiles.get(fr.nodeId) }));
        const figmaFrames = frames.filter((x) => x.file).map((x) => `${x.name} → ${x.file}`).join('; ') || 'không có ảnh Figma';
        const flowEnd = Math.min(deadline, Date.now() + lim.flowMs);
        const tried = [];
        const overlayTried = new Set();
        let last = '';
        let lastFp = ''; // màn (trước thao tác) của lần trước: thao tác giống nhau nhưng màn đã đổi thì KHÔNG phải lặp (vd vuốt nhiều lần để cuộn)
        let repeat = 0;
        let aiFails = 0;
        let loading = 0;
        let paywalls = 0;
        let deviations = 0;
        let checkAlert = true;
        let lastOk = true;
        const compared = new Set(); // frame đã so bằng code trong luồng này (mỗi frame một lần)
        let swipesUp = 0; // số lần vuốt lên (cuộn xuống) làm màn đổi, tính từ lần chuyển màn gần nhất
        let atTop = false; // vuốt xuống mà màn không đổi nữa = đã về đầu màn (khối ở đầu màn bị đẩy ra ngoài khi cuộn xuống đáy)
        let atBottom = false; // vuốt lên mà màn không đổi nữa = đã hết màn
        let rejects = 0; // số lần từ chối kết luận "không có" khi chưa cuộn
        let carry = ''; // lời nhắc đưa vào lần hỏi AI kế tiếp
        let acted = false; // đã có ít nhất một thao tác thành công (chống "đạt" khi chưa làm gì)
        let foreignCloses = 0; // màn trống vì app khác che: số lần đã thử đóng liên tiếp
        let armed = 0; // > 0: vừa bấm nút mua trong app → tờ thanh toán có thể đang hiện → chỉ đóng / huỷ
        let step = 0;
        const end = (status, summary) => ({ status, summary, steps: step });
        for (step = 1; step <= maxSteps; step++) {
          if (job.stop) return end('unverifiable', 'Đã dừng');
          if (Date.now() > flowEnd) return end(deviations ? 'deviation' : 'unverifiable', 'Vượt giới hạn thời gian của luồng');
          if (checkAlert) {
            const closed = await handleAlert(driver, app.platform);
            if (closed) log(id, `Xử lý popup hệ thống: ${closed}`);
          }
          const s = await snap(driver);
          if (!s.usable) {
            if (loading >= 2 && await foreignForeground(driver, app)) {
              // App khác / tờ thanh toán cứ hiện lại: tối đa MAX_OVERLAY_CLOSES lần đóng, rồi mở lại app, quá nữa thì kết thúc luồng
              if (++foreignCloses > MAX_OVERLAY_CLOSES) {
                if (foreignCloses > MAX_OVERLAY_CLOSES * 2) return end(deviations ? 'deviation' : 'unverifiable', 'App khác / tờ thanh toán cứ che màn — không đóng được');
                log(id, 'Đóng màn che ngoài app nhiều lần vẫn kẹt → mở lại app');
                await relaunchApp(driver, app); loading = 0; step--; await driver.pause(1500); continue;
              }
              const how = await closeOverlay(driver, [], { app, win });
              if (how) { log(id, `Đóng màn che ngoài app: ${how}`); loading = 0; step--; await driver.pause(1000); continue; }
            }
            if (++loading > 10) return end(deviations ? 'deviation' : 'unverifiable', 'Màn hình trống quá lâu — app có thể bị treo');
            step--;
            await driver.pause(1500);
            continue;
          }
          loading = 0;
          foreignCloses = 0;
          // Paywall / IAP: tool KHÔNG mua, chỉ đóng. Tự đóng tối đa 2 lần; còn kẹt (vd nút X vẽ bằng ảnh) thì giao cho AI nhìn ảnh rồi bấm theo toạ độ
          const paywall = looksLikePaywall(s.elements);
          if (!paywall) paywalls = 0;
          if (paywall && paywalls < 2) {
            paywalls++;
            const how = await closeOverlay(driver, s.elements, { app, win, tried: overlayTried });
            if (how) { log(id, `Màn paywall / IAP — đã đóng: ${how}`); await settle(driver, snap, { android, ...settleOpts }); continue; }
          }
          const storeNow = storeContext(s.elements, await foreignForeground(driver, app).catch(() => null));
          if (armed > 0) armed--;
          const strict = storeNow.store || armed > 0;
          const notice = [strict ? 'Tờ thanh toán của store / app khác có thể đang hiện: TUYỆT ĐỐI không xác nhận mua (Subscribe / Buy / Confirm / Pay / 1-tap…). Chỉ bấm Cancel / Close / X, "back" hoặc vuốt xuống để đóng; tool sẽ từ chối mọi thao tác khác.' : '', paywall ? 'Màn này trông như paywall / mua hàng và tự đóng chưa được. Hãy đóng nó (không mua): xem ảnh màn hình để tìm nút X / Close / Skip; nếu nút không có trong danh sách phần tử thì dùng "tapPoint" bấm theo toạ độ % trên ảnh.' : '', carry].filter(Boolean).join('\n');
          carry = '';
          // Ảnh tốn token: bước chuẩn bị ở màn thường chỉ dùng danh sách phần tử; cần ảnh khi có paywall, màn ít phần tử, hoặc thao tác trước thất bại
          const needImage = f.id !== PREPARE.id || !!notice || s.elements.length < 4 || !lastOk;
          const prior = store.get('smoke', id).findings.filter((x) => x.flowId !== f.id).slice(-12);
          const known = prior.length ? prior.map((x) => `- [${x.kind}] ${x.summary}`).join('\n') : 'chưa có';
          const has = (loc) => s.elements.some((e) => e.locator === loc || e.alts.includes(loc));
          const prompt = fill(PROMPT, {
            platform: app.platform || 'iOS', appName: app.name, flowName: f.name, goal: f.goal, prdQuote: f.prdQuote || '(không có PRD)',
            expected: f.expected.map((x) => `- ${x}`).join('\n'), unclear: f.unclear.length ? f.unclear.map((x) => `- ${x}`).join('\n') : 'không có',
            appShot: needImage ? live : '(bước này không dùng ảnh: dựa vào danh sách phần tử)', figmaFrames: needImage ? figmaFrames : 'không dùng ảnh ở bước này', known, elements: toPrompt(s.elements), tried: tried.join('; ') || 'chưa có', account: account || 'không có',
            step, maxSteps, pushAction: push ? PUSH_LINE : '', knowledge: (f.id === ROBUST.id ? `${KNOWLEDGE}\n\n${ROBUST_KNOWLEDGE}` : KNOWLEDGE) + (depth === 'full' && f.id !== ROBUST.id && f.id !== PREPARE.id ? `\n\n${FULL_KNOWLEDGE}` : '') + profileText, notice,
          });
          const r = needImage
            ? await runClaude({ prompt, schema, allowedTools: ['Read'], lean: true, timeoutMs: 180000, model, onUsage, signal, ...persist })
            : await runClaude({ prompt, schema, noTools: true, timeoutMs: 180000, model, onUsage, signal, ...persist });
          if (!r.ok) {
            log(id, `AI lỗi: ${r.error}`);
            if (++aiFails >= 3) return end(deviations ? 'deviation' : 'unverifiable', `AI lỗi 3 lần liên tiếp: ${r.error}`);
            continue;
          }
          aiFails = 0;
          let a = r.data;
          // Danh sách phần tử chỉ có phần ĐANG HIỆN: chưa cuộn hết màn thì chưa chấp nhận kết luận "không có / thiếu" (màn Health dài, khối Blood Sugar nằm dưới)
          if (f.id !== PREPARE.id && f.id !== ROBUST.id && !(atBottom && atTop) && rejects < 2) {
            const MISSING = /không có|không thấy|thiếu|không hiển thị|không tìm thấy|missing|not found|absent/i;
            const claimDone = a.action === 'done' && a.flowStatus && a.flowStatus !== 'ok' && MISSING.test(a.summary || '');
            const claimFinding = a.finding?.summary && ['prd', 'figma', 'conflict'].includes(a.finding.kind) && MISSING.test(a.finding.summary);
            if (claimDone || claimFinding) {
              rejects++;
              log(id, `Chưa kiểm hết màn (đã vuốt lên ${swipesUp} lần${atBottom ? ', chưa về đầu màn' : ''}) nên chưa chấp nhận kết luận "không có / thiếu"`);
              carry = `Bạn vừa kết luận thiếu / không có một phần tử nhưng CHƯA kiểm hết cả màn (danh sách phần tử chỉ có phần đang hiện, mỗi lần vuốt chỉ cuộn khoảng nửa màn). Cần kiểm CẢ HAI đầu: vuốt xuống ("swipe" text=down) liên tục tới khi màn không đổi để thấy ĐẦU màn, rồi vuốt lên liên tục tới khi màn không đổi để thấy ĐÁY màn, vừa vuốt vừa tìm phần tử đó. Khối ở đầu màn sẽ bị đẩy ra ngoài khi bạn cuộn xuống đáy. Tình trạng hiện tại: ${atTop ? 'đã thấy đầu màn' : 'chưa thấy đầu màn'}, ${atBottom ? 'đã thấy đáy màn' : 'chưa thấy đáy màn'}. Rồi mới kết luận.`;
              if (claimDone) continue; // không kết thúc luồng
              a = { ...a, finding: undefined };
            }
          }
          if (f.id !== PREPARE.id && a.finding?.summary && addFinding(f, frames, a) && a.finding.kind !== 'unclear') deviations++;
          if (a.atFrame && jsonFrames && f.id !== PREPARE.id) {
            const want = String(a.atFrame).trim().toLowerCase();
            const fr = jsonFrames.frames.find((x) => x.name.trim().toLowerCase() === want);
            if (fr && !compared.has(fr.id)) { compared.add(fr.id); deviations += await compareFrame(f, fr, frames); }
          }
          if (a.action === 'done') {
            let status = a.flowStatus || (deviations ? 'deviation' : 'ok');
            if (status === 'ok' && deviations) status = 'deviation';
            if (status === 'ok' && !acted && f.id !== PREPARE.id) return end('unverifiable', `AI kết luận khi chưa thao tác gì${a.summary ? `: ${a.summary}` : ''}`);
            return end(status, a.summary || '');
          }
          const key = `${a.action} ${a.locator || ''} ${a.text || ''} ${a.action === 'tapPoint' ? `${a.x},${a.y}` : ''}`.trim();
          if (a.action !== 'wait') {
            const fpNow = fingerprint(s.elements);
            repeat = key === last && fpNow === lastFp ? repeat + 1 : 1;
            last = key;
            lastFp = fpNow;
            if (repeat >= 3) return end(deviations ? 'deviation' : 'unverifiable', 'AI lặp cùng một thao tác 3 lần liên tiếp');
          }
          tried.push(key);
          let ok = true;
          let chk = null;
          let scrollRes = null;
          if (a.action === 'tap' || a.action === 'type') {
            const target = a.locator && s.elements.find((e) => e.locator === a.locator || e.alts.includes(a.locator));
            if (!a.locator || !has(a.locator)) { log(id, `Bỏ qua: AI chọn locator không có trên màn (${a.locator})`); ok = false; }
            else if (!(chk = purchaseCheck(target, { store: strict })).ok) { log(id, `Chặn: ${chk.why}`); ok = false; }
            else {
              // Nút mua trong app (paywall): được bấm để mở tờ thanh toán — sau đó chỉ được đóng / huỷ
              if (a.action === 'tap' && target && isBuyTarget(target, paywall)) { armed = ARMED_STEPS + 1; log(id, `Bấm nút mua trong app "${target.name || target.label}" (chỉ mở tờ thanh toán — không xác nhận mua)`); }
              ok = await doAction(driver, a, (t) => log(id, t));
              if (ok && a.action === 'type') { try { await driver.hideKeyboard?.(); } catch { /* không có bàn phím để ẩn */ } } // như skill: ẩn bàn phím để không che phần tử kế tiếp
            }
          } else if (a.action === 'tapPoint') {
            const pc = pointCheck(s.elements, win, clampPct(a.x), clampPct(a.y), { paywall, store: strict });
            if (!pc.ok) { log(id, `Chặn: ${pc.why}`); ok = false; }
            else try {
              if (pc.hit && isBuyTarget(pc.hit, paywall)) armed = ARMED_STEPS + 1; await tapPoint(driver, clampPct(a.x), clampPct(a.y)); log(id, `Chạm điểm ${Math.round(clampPct(a.x))}%, ${Math.round(clampPct(a.y))}%`); } catch (e) { log(id, `Không chạm được điểm: ${String(e.message).split('\n')[0]}`); ok = false; }
          } else if (a.action === 'background') {
            try { const sec = await backgroundApp(driver, app, a.text); log(id, `Đưa app xuống nền ${sec} giây rồi mở lại`); } catch (e) { log(id, `Không đưa app xuống nền được: ${String(e.message).split('\n')[0]}`); ok = false; }
          } else if (a.action === 'openLink') {
            try { const u = await openDeepLink(driver, app, a.text); log(id, `Mở deep link ${u}`); } catch (e) { log(id, `Không mở được deep link: ${String(e.message).split('\n')[0]}`); ok = false; }
          } else if (a.action === 'push' && !push) {
            log(id, 'Bỏ qua push: push giả lập chỉ chạy trên iOS Simulator'); ok = false;
          } else if (a.action === 'push') {
            try { const [title, ...rest] = String(a.text || '').split('|'); const body = rest.join('|') || (rest.length ? '' : title); await pushImpl({ udid, app, title: rest.length ? title : '', body }); log(id, `Gửi push giả lập: ${a.text}`); await driver.pause(3000); } catch (e) { log(id, `Không gửi được push: ${String(e.message).split('\n')[0]}`); ok = false; }
          } else if (a.action === 'rotate') {
            try { const o = await rotateDevice(driver, a.text); rotated = o !== 'PORTRAIT'; log(id, `Xoay màn hình: ${o}`); } catch (e) { log(id, `Không xoay được (app có thể khóa hướng dọc): ${String(e.message).split('\n')[0]}`); ok = false; }
          } else if (a.action === 'scrollTo') {
            // Cuộn tới phần tử bằng code: vuốt từng lần, dừng khi thấy chữ đó hoặc hết màn (AI hay vuốt một lần rồi kết luận "không có")
            const label = String(a.text || '').trim();
            if (!label) { log(id, 'scrollTo thiếu chữ cần tìm'); ok = false; }
            else {
              try {
                const read = async () => { await settle(driver, snap, { android, ...settleOpts }); return parseElements(lastShot.xml); };
                scrollRes = await scrollToText({ label, elements: s.elements, read, swipeUp: () => swipe(driver, 'up'), max: 8 });
                log(id, scrollRes.found ? `Cuộn ${scrollRes.swipes} lần tới "${label}"` : `Cuộn ${scrollRes.swipes} lần${scrollRes.bottom ? ' tới hết màn' : ''}: không thấy "${label}"`);
                if (!scrollRes.found) carry = `scrollTo đã cuộn ${scrollRes.bottom ? 'hết màn' : 'đủ số lần cho phép'} (${scrollRes.swipes} lần vuốt) và KHÔNG thấy "${label}".`;
              } catch (e) { log(id, `Không cuộn được: ${String(e.message).split('\n')[0]}`); ok = false; }
            }
          } else if (a.action === 'swipe') {
            try { await swipe(driver, ['up', 'down', 'left', 'right'].includes(a.text) ? a.text : 'up'); log(id, `Vuốt ${a.text || 'up'}`); } catch (e) { log(id, `Không vuốt được: ${String(e.message).split('\n')[0]}`); ok = false; }
          } else if (a.action === 'wait') {
            await driver.pause(2000);
          } else if (a.action === 'back') {
            const back = s.elements.find((e) => e.type === 'Button' && /^(Back|Close)$/i.test(e.name));
            if (back) await (await driver.$(back.locator)).click().catch(() => {}); else await driver.back?.().catch(() => {});
            log(id, 'Quay lại');
          } else if (a.action === 'relaunch') {
            await relaunchApp(driver, app);
            log(id, 'Mở lại app');
          }
          if (ok && a.action !== 'wait') acted = true;
          checkAlert = !ok;
          lastOk = ok;
          await settle(driver, snap, { android, ...settleOpts });
          // Sau khi màn đã đứng yên: vuốt lên mà màn không đổi = đã hết màn; thao tác khác (trừ chờ) = đã sang màn / trạng thái khác → đếm lại
          if (a.action === 'swipe') {
            if (ok && (a.text || 'up') === 'up') { if (fingerprint(parseElements(lastShot.xml)) === fingerprint(s.elements)) atBottom = true; else swipesUp++; }
            else if (ok && a.text === 'down' && fingerprint(parseElements(lastShot.xml)) === fingerprint(s.elements)) atTop = true;
          } else if (a.action === 'scrollTo') {
            if (scrollRes) { swipesUp += scrollRes.swipes; if (scrollRes.bottom) atBottom = true; }
          } else if (a.action !== 'wait') { swipesUp = 0; atBottom = false; atTop = false; }
        }
        step = maxSteps;
        return end(deviations ? 'deviation' : 'unverifiable', `Vượt giới hạn số bước (${maxSteps})`);
      };
      // Luồng có xoay ngang (kiểm bền vững) → luôn đưa về dọc khi xong, kể cả khi luồng lỗi / dừng
      const runFlow = async (...a) => {
        try { return await runFlowSteps(...a); } finally {
          if (rotated) {
            rotated = false;
            try { await driver.setOrientation('PORTRAIT'); log(id, 'Đưa màn hình về dọc (PORTRAIT)'); } catch (e) { log(id, `Không đưa màn hình về dọc được: ${String(e.message).split('\n')[0]}`); }
          }
        }
      };

      // Chuẩn bị: AI tự đưa app tới màn chính. Không tới được → dừng với lý do rõ (chạy luồng khi app đang kẹt chỉ ra toàn "không kiểm được")
      log(id, reuse ? 'Chuẩn bị: mở lại app, về màn chính…' : 'Chuẩn bị: đưa app tới màn chính (onboarding, quyền, paywall)…');
      if (reuse) await relaunchApp(driver, app); // khởi động nguội để về đúng màn gốc
      let prep = await runFlow(PREPARE, { maxSteps: lim.prepSteps });
      // Máy iPhone thật: "cài sạch" không cài lại được app (cài bằng Xcode / TestFlight) → thử lại vô ích, bỏ qua
      if (prep.status !== 'ok' && reuse && !job.stop && app.platform !== 'Android' && isRealIos(udid)) log(id, 'iPhone thật: không cài sạch lại được nên không thử chuẩn bị lại — xoá app / dữ liệu bằng tay rồi chạy lại');
      else if (prep.status !== 'ok' && reuse && !job.stop) {
        // Trạng thái cũ hỏng (không tới được màn chính) → cài sạch và chuẩn bị lại MỘT lần, không bắt người dùng làm tay
        log(id, `Dùng lại app không tới được màn chính (${prep.summary || prep.status}) → cài sạch và chuẩn bị lại`);
        store.remove('smokeState', stateKey);
        reuse = false;
        await session.close?.().catch(() => {});
        session = await openImpl({ app, udid });
        driver = session.driver;
        prep = await runFlow(PREPARE, { maxSteps: lim.prepSteps });
      }
      update(id, { prepare: { status: prep.status, steps: prep.steps, summary: prep.summary } });
      if (prep.status === 'ok') {
        store.put('smokeState', { id: stateKey, appId: app.id, udid, build: buildTag, preparedAt: new Date().toISOString() }); // lần sau dùng lại app đã onboard
      } else if (!job.stop) {
        store.remove('smokeState', stateKey);
        update(id, { status: 'error', error: `Không đưa được app tới màn chính: ${prep.summary || prep.status}` });
        return;
      }
      for (let i = 0; i < plan.length && !job.stop; i++) {
        if (Date.now() > deadline) { setFlow(id, i, { status: 'unverifiable', summary: 'Hết thời gian của cả lần chạy' }); continue; }
        setFlow(id, i, { status: 'running' });
        update(id, { current: i });
        log(id, `Luồng ${i + 1}/${plan.length}: ${plan[i].name}`);
        try {
          setFlow(id, i, await runFlow(plan[i]));
        } catch (e) {
          setFlow(id, i, { status: 'unverifiable', summary: `Lỗi khi chạy luồng: ${String(e.message || e).split('\n')[0]}` });
        }
      }
      // Kiểm bền vững chạy cuối cùng, còn thời gian và chưa bị dừng
      if (robust && !job.stop && Date.now() < deadline) {
        const ri = plan.length;
        setFlow(id, ri, { status: 'running' });
        update(id, { current: ri });
        log(id, `Luồng ${ri + 1}/${ri + 1}: ${ROBUST.name}`);
        try { setFlow(id, ri, await runFlow(ROBUST, { maxSteps: lim.robustSteps })); } catch (e) { setFlow(id, ri, { status: 'unverifiable', summary: `Lỗi khi chạy: ${String(e.message || e).split('\n')[0]}` }); }
      }
      update(id, { status: job.stop ? 'stopped' : 'done' });
    } catch (e) {
      update(id, { status: job.stop ? 'stopped' : 'error', error: String(e.message || e).split('\n')[0] });
    } finally {
      if (store.get('smoke', id)?.status === 'running') update(id, { status: job.stop ? 'stopped' : 'done' });
      await session?.close?.().catch(() => {});
      update(id, { finishedAt: new Date().toISOString() });
      jobs.delete(id);
      lock.release(id);
      emit('lock', lock.current());
    }
  }

  async function start({ appId, udid, prdUrl, figmaUrl, figmaFile, figmaName = '', notes = '', account = null, robust = true, clean = false, depth = 'smoke' }) {
    const app = store.get('apps', appId);
    if (!app) throw bad(404, 'Không có app này');
    if (!udid) throw bad(400, 'Chọn thiết bị');
    // File Figma .json (plugin xuất) thắng link Figma: kiểm định dạng ngay (400) trước khi chiếm thiết bị
    let exp = null;
    if (figmaFile) {
      let text;
      try { text = fs.readFileSync(figmaFile, 'utf8'); } catch { throw bad(400, 'Không đọc được file Figma .json đã tải lên'); }
      exp = readExport(text);
    }
    const prdCheck = checkPrdUrl(prdUrl);
    if (!prdCheck.ok) throw bad(400, prdCheck.error);
    prdUrl = prdCheck.url;
    const hasPrd = !!prdUrl;
    const hasFig = !exp && !!String(figmaUrl || '').trim();
    if (!hasPrd && !hasFig && !exp) throw bad(400, 'Nhập ít nhất một: link PRD, link Figma hoặc file Figma .json');
    if (hasFig) {
      const fig = parseFigmaUrl(figmaUrl);
      if (!fig) throw bad(400, 'Link Figma không hợp lệ (cần dạng figma.com/design/…)');
      if (!fig.nodeId) throw bad(400, 'Link Figma thiếu node-id: mở section cần test trong Figma, chọn nó rồi copy link');
    }
    const id = `SM-${String(seq() + 1).padStart(4, '0')}`;
    const got = lock.acquire({ kind: 'smoke', id, label: `AI Smoke Test · ${app.name}` });
    if (!got.ok) throw bad(409, `Thiết bị đang bận: ${got.holder.label}`);
    emit('lock', lock.current());
    try {
      await lock.ready?.();
      store.put('meta', { id: 'smokeSeq', value: seq() + 1 });
      // Không lưu tài khoản test (có thể là mật khẩu) vào store — chỉ giữ trong bộ nhớ cho lần chạy này
      const rec = { id, appId, udid, depth: depth === 'full' ? 'full' : 'smoke', prdUrl, figmaUrl: exp ? '' : figmaUrl, figmaSource: exp ? 'json' : hasFig ? 'link' : 'none', figmaFileName: exp ? String(figmaName || '') : '', robust: robust !== false, notes, hasAccount: !!account, status: 'running', startedAt: new Date().toISOString(), log: [], flows: [], findings: [] };
      store.put('smoke', rec);
      const job = { stop: false, ctl: new AbortController() };
      jobs.set(id, job);
      run(id, app, udid, job, { prdUrl, figmaUrl: exp ? '' : figmaUrl, notes, account, exp, robust: robust !== false, clean: !!clean, depth: depth === 'full' ? 'full' : 'smoke' });
      return rec;
    } catch (e) {
      // Lỗi trước khi chạy (đọc / ghi store…) → nhả thiết bị, không khoá mãi
      if (!jobs.has(id)) { lock.release(id); emit('lock', lock.current()); }
      throw e;
    }
  }

  async function stop(id) {
    const j = jobs.get(id);
    if (!j) return;
    j.stop = true;
    j.ctl.abort();
    // Chờ lần chạy dọn xong (đóng phiên, nhả thiết bị) — tối đa stopWaitMs, không treo request Dừng mãi
    const until = Date.now() + (limits.stopWaitMs ?? 30000);
    while (jobs.has(id) && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
  }

  // Server khởi động lại giữa lúc đang chạy → run mồ côi: đánh dấu bị ngắt, luồng đang chạy về "chưa chạy"
  function recover() {
    for (const r of store.list('smoke')) {
      if (r.status !== 'running' || jobs.has(r.id)) continue;
      store.patch('smoke', r.id, { status: 'interrupted', flows: r.flows.map((f) => (f.status === 'running' ? { ...f, status: 'pending' } : f)), finishedAt: new Date().toISOString() });
    }
  }

  return { start, stop, recover, running: (id) => jobs.has(id) };
}

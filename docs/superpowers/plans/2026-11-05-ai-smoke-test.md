# AI Smoke Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm chức năng riêng **AI Smoke Test**: dán link PRD (begamob) + link Figma, AI tự mò app trên thiết bị theo các luồng chính, ra report ngắn các điểm lệch với PRD hoặc Figma. Sau đó gỡ "AI kiểm UI".

**Architecture:** Module mới `server/smoke/` theo mẫu `server/ui/aiCheck.js` (khóa thiết bị, phiên Appium, lưu `store` + `emit`, `recover`). Hai nguồn (PRD, Figma) được đọc bởi `claude -p` có bật công cụ MCP; code tool chỉ nhận JSON có cấu trúc. Kiến thức mobile nằm trong một file prompt chưng cất từ skill `mobile-testing`. UI là mục menu + 2 trang riêng, không đụng UI Testing (trừ bước gỡ AI kiểm UI cuối cùng).

**Tech Stack:** Node (ESM) + Express 5, `node:test`, WebdriverIO (phiên qua `server/device/session.js`), React + Vite, `claude -p` qua `runClaude` (`server/ai/claude.js`).

**Spec:** `docs/superpowers/specs/2026-11-05-ai-smoke-test-design.md`

> **Cập nhật sau khi thực thi:** kế hoạch này được thực thi inline và đã đổi ở các điểm sau (chi tiết ở spec mục 8, quyết định ở `.superpowers/sdd/…/progress.md`): PRD / Figma đều tuỳ chọn; tên công cụ MCP là `mcp__begamob__…` và `mcp__figma__…`; report vẽ lúc xem (không có `writeReport`); thêm giai đoạn chuẩn bị, `tapPoint`, chính sách quyền (`alerts.js`), lớp chặn mua (`guard.js`), chế độ gọn `lean`, đo token (`onUsage`), tín hiệu huỷ khi Dừng; Task 6 đã gỡ AI kiểm UI. Nếu thực thi lại plan này, đọc spec mục 8 trước.

## Global Constraints

- Tên chức năng: **AI Smoke Test**; menu riêng, route `/apps/:appId/smoke` và `/smoke/:id`; **không** nằm trong UI Testing, không dùng chung route/dữ liệu với nó.
- Không sinh test case, không ghi Excel, không đụng Run / UI Testing.
- **Không sửa skill `test-report`** (`vendor/test-report/`); report ngắn là bộ vẽ riêng trong tool.
- Không dùng `app.figmaFrames`; Figma đọc từ link qua Figma MCP, PRD đọc từ link begamob qua Web Document MCP (`mcp__claude_ai_Web_Document_MCP__project_doc_get_by_url`, đường dẫn bắt đầu `/workspace/`).
- Không đọc cả cây Figma một lần (node mẫu ~274.000 ký tự): chỉ frame cấp màn hình, ảnh lấy từng frame.
- Kết quả mỗi luồng chỉ có ba trạng thái: `ok` · `deviation` (lệch) · `unverifiable` (không kiểm được); luồng không tới được tính `unreachable`. Điểm lệch có `kind`: `prd` | `figma` | `conflict` | `unclear`.
- Không tính là lệch: sai số điểm ảnh, quảng cáo, nội dung động (ngày giờ, dữ liệu người dùng), biến thể A/B.
- AI **không bao giờ** bấm mua / đăng ký / dùng thử (giữ quy tắc của `explore-step.md`); gặp paywall/quảng cáo thì đóng.
- Mỗi kết luận kèm căn cứ: ảnh app, ảnh Figma (nếu có), đoạn PRD trích.
- Giới hạn mặc định: 8 luồng, 25 bước mỗi luồng, 5 phút mỗi luồng, 20 phút cả lần chạy.
- Một job một thiết bị: dùng `lock` hiện có với `kind: 'smoke'`.
- Văn bản hiển thị cho người dùng bằng tiếng Việt. Không commit trừ khi người dùng yêu cầu.

## Review Focus

- PRD link sai / không có quyền đọc → báo lỗi rõ ngay lúc bấm Start, không để chạy rồi mới hỏng (Task 1, Task 4).
- Link Figma không có `node-id` → báo lỗi, không đoán node (Task 2).
- Figma MCP chưa xác thực hoặc hết phiên giữa chừng → lần chạy kết thúc `error` kèm hướng dẫn, thiết bị được nhả khóa (Task 3).
- AI trả `done` quá sớm hoặc lặp một thao tác mãi → chặn bằng giới hạn bước và phát hiện lặp, luồng ghi `unverifiable` (Task 3).
- Thiết bị đang bận / server khởi động lại giữa chừng → 409 / `interrupted`, không treo khóa (Task 3, Task 4).
- PRD không có luồng nào rút ra được → lần chạy `error` "không rút được luồng", không báo "đạt" (Task 1).

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `server/smoke/figmaUrl.js` | Tách `fileKey`, `nodeId` từ link Figma |
| `server/smoke/plan.js` | Hỏi AI (có MCP) rút danh sách luồng chính từ PRD + Figma |
| `server/smoke/figmaImage.js` | Lấy ảnh PNG của một frame Figma về đĩa |
| `server/ai/prompts/smoke-knowledge.md` | Kiến thức mobile chưng cất từ skill `mobile-testing` |
| `server/ai/prompts/smoke-plan.md` | Prompt rút luồng |
| `server/ai/prompts/smoke-step.md` | Prompt chọn thao tác kế tiếp + ghi điểm lệch |
| `server/smoke/run.js` | `createSmoke`: start / stop / recover / vòng lặp chạy |
| `server/smoke/report.js` | Vẽ report HTML ngắn |
| `server/routes/smoke.js` | API |
| `web/src/pages/SmokeTest.jsx`, `SmokeRunView.jsx` | Trang bắt đầu + trang kết quả |
| `test/smoke-*.test.js` | Test |

---

### Task 1: Link Figma và rút luồng từ PRD + Figma

**Files:**
- Create: `server/smoke/figmaUrl.js`, `server/smoke/plan.js`, `server/ai/prompts/smoke-plan.md`
- Test: `test/smoke-plan.test.js`

**Interfaces:**
- Produces:
  - `parseFigmaUrl(url: string): { fileKey: string, nodeId: string | null } | null` — `nodeId` đổi dấu `-` thành `:` (`5433-75649` → `5433:75649`); `null` nếu không phải link `figma.com/design/...`; nhánh `/branch/:branchKey/` dùng `branchKey` làm `fileKey`.
  - `type Flow = { id: string, name: string, goal: string, prdQuote: string, expected: string[], frames: { nodeId: string, name: string }[], unclear: string[] }`
  - `planFlows({ prdUrl, figmaUrl, notes = '', runClaude, model, maxFlows = 8 }): Promise<{ ok: true, flows: Flow[] } | { ok: false, error: string }>`

- [ ] **Step 1: Test `parseFigmaUrl`.** Assert: link mẫu của spec → `{ fileKey: 'SrFaXD304rwjPXcNRqXzh0', nodeId: '5433:75649' }`; link không có `node-id` → `nodeId: null`; link `/branch/BR123abc.../` dùng branchKey; `https://example.com/x` → `null`.
- [ ] **Step 2: Chạy test, thấy FAIL** — `node --test test/smoke-plan.test.js`.
- [ ] **Step 3: Implement `parseFigmaUrl` trong `server/smoke/figmaUrl.js`** (dùng `new URL`, không regex dài).
- [ ] **Step 4: Test `planFlows` với `runClaude` giả** (cùng kiểu `test/ui-ai.test.js`). Assert: (a) gọi `runClaude` đúng một lần với `allowedTools` chứa `mcp__claude_ai_Web_Document_MCP__project_doc_get_by_url` và `mcp__claude_ai_Figma__get_metadata`, prompt chứa `prdUrl` và `nodeId` đã tách; (b) kết quả bị cắt còn `maxFlows`; (c) `runClaude` trả `{ ok:false, error }` → `planFlows` trả `{ ok:false, error }` có chữ "PRD" hoặc "Figma" tùy nguồn lỗi; (d) trả `flows: []` → `{ ok:false, error: 'Không rút được luồng chính từ PRD' }`; (e) `figmaUrl` không có `node-id` → `{ ok:false, error }` mà **không** gọi `runClaude`.
- [ ] **Step 5: Implement `planFlows` trong `server/smoke/plan.js`.** Nạp `smoke-plan.md`, thay `{{prdUrl}} {{fileKey}} {{nodeId}} {{notes}} {{maxFlows}}`; gọi `runClaude({ prompt, schema: PLAN_SCHEMA, allowedTools: [...], timeoutMs: 300000, model })`. `smoke-plan.md` yêu cầu AI: đọc PRD theo mục (dùng `section`, không kéo cả file một lần), gọi `get_metadata` ở `nodeId` chỉ để liệt kê frame cấp màn hình (không `get_design_context` cả section), chọn tối đa `maxFlows` luồng chính, mỗi luồng ghi `prdQuote` nguyên văn, và đưa các chỗ PRD ghi `[Cần xác nhận]` vào `unclear` thay vì suy đoán.
- [ ] **Step 6: Chạy test, thấy PASS** — `node --test test/smoke-plan.test.js`.
- [ ] **Step 7 (spike, chạy tay một lần):** viết `scripts/smoke-spike.js` gọi `planFlows` thật với `runClaude` thật và hai link mẫu của spec, in `flows`. Mong đợi: ≥ 3 luồng, mỗi luồng có `prdQuote` khác rỗng và ≥ 1 `frames`. Nếu `claude -p` không dùng được MCP ở chế độ này, dừng và báo người dùng trước khi làm Task 2.

### Task 2: Lấy ảnh frame Figma

**Files:**
- Create: `server/smoke/figmaImage.js`
- Test: `test/smoke-figma-image.test.js`

**Interfaces:**
- Consumes: `parseFigmaUrl` (Task 1), `runClaude` (`server/ai/claude.js`).
- Produces: `fetchFrameImage({ fileKey, nodeId, outFile, runClaude, download = defaultDownload, model }): Promise<{ ok: true, file: string } | { ok: false, error: string }>` — `download(url: string, outFile: string): Promise<void>`.

- [ ] **Step 1: Test.** `runClaude` giả (gọi với `allowedTools: ['mcp__claude_ai_Figma__get_screenshot']`) trả `{ ok:true, data:{ url:'https://x/y.png' } }`, `download` giả ghi file → `{ ok:true, file: outFile }` và `download` được gọi với đúng `url`. Trả `{ ok:false }` khi `runClaude` lỗi hoặc `data.url` thiếu; không gọi `download` trong hai trường hợp đó.
- [ ] **Step 2: Chạy test, thấy FAIL.**
- [ ] **Step 3: Implement `fetchFrameImage`.** Prompt ngắn: gọi `get_screenshot` với `fileKey`, `nodeId`, `maxDimension: 1400`, trả `{ url }`. `defaultDownload` dùng `fetch` + `fs.writeFileSync`.
- [ ] **Step 4: Chạy test, thấy PASS.**

### Task 3: Vòng chạy AI Smoke Test

**Files:**
- Create: `server/smoke/run.js`, `server/ai/prompts/smoke-knowledge.md`, `server/ai/prompts/smoke-step.md`
- Test: `test/smoke-run.test.js`

**Interfaces:**
- Consumes: `planFlows` (Task 1), `fetchFrameImage` (Task 2), `openSession` (`server/device/session.js`), `parseElements`/`isTransient`/`toPrompt` (`server/locators/pageSource.js`), `settle`/`doAction`/`dismissAlert`/`relaunchApp` (`server/locators/explore.js`), `swipe(driver, direction, count)` (`server/ui/device.js`), `createLock` (`server/lock.js`).
- Lưu ý đã kiểm trên code: (1) `doAction` chỉ làm `tap` và `type` (mọi action khác sẽ bị coi là nhập chữ), nên `swipe` dùng `swipe` của `server/ui/device.js`, còn `back` và `relaunch` xử lý như `exploreLoop` (đọc `server/locators/explore.js` từ dòng 125 để bám đúng cách); (2) `settle(driver, snap, opts)` gọi `snap(driver, { seenBy })`, nên `snap` của AI Smoke Test là bản nhẹ: lấy page source + ảnh + `parseElements`, **không** ghi vào locator map và `createSmoke` không nhận `map`; (3) danh sách phần tử đưa vào prompt dùng `toPrompt(elements)`; (4) với paywall/quảng cáo, đọc `server/locators/overlay.js` (`looksLikePaywall`, `closeOverlay`, `tapAway`, `foreignForeground`) và dùng lại thay vì tự viết.
- Produces: `createSmoke({ store, lock, emit, dataDir, openImpl = openSession, runClaude, loadFlows = planFlows, frameImage = fetchFrameImage, model, limits = { maxSteps: 25, flowMs: 300000, totalMs: 1200000 } })` trả `{ start, stop, recover, running }`:
  - `start({ appId, udid, prdUrl, figmaUrl, notes = '', account = null }): Promise<SmokeRun>` — ném `Error` có `status`: 404 (không có app), 400 (thiếu `udid`/`prdUrl`/`figmaUrl`, link Figma không có node), 409 (thiết bị bận).
  - `stop(id): Promise<void>`, `recover(): void`, `running(id): boolean`.
  - Collection `store` tên `smoke`; `SmokeRun = { id: 'SM-0001', appId, udid, prdUrl, figmaUrl, notes, status: 'running'|'done'|'stopped'|'error'|'interrupted', startedAt, finishedAt?, error?, log: string[], liveShot?, flows: { id, name, status: 'pending'|'running'|'ok'|'deviation'|'unreachable'|'unverifiable', steps: number, summary: string }[], findings: { flowId, kind: 'prd'|'figma'|'conflict'|'unclear', summary: string, prdQuote: string, frameName: string, appShot: string, figmaShot: string }[] }`. Số thứ tự id lưu ở `store` collection `meta`, key `smokeSeq`. Phát `emit('smoke', run)` mỗi lần đổi, `emit('lock', lock.current())` khi nhận/nhả khóa.
  - Quyết định của AI mỗi bước (schema `STEP_SCHEMA`): `{ action: 'tap'|'type'|'back'|'swipe'|'relaunch'|'done', locator?: string, text?: string, finding?: { kind, summary, prdQuote?, frameName? }, flowStatus?: 'ok'|'deviation'|'unverifiable' }`.

- [ ] **Step 1: Soạn `smoke-knowledge.md`.** Đọc `/Users/huyentrang/Downloads/core-automation-framework/skills/mobile-testing/GUIDE.md` và chưng cất **chỉ phần kiến thức chung** (popup quyền, chờ màn tải, gesture, vòng đời app, ads/IAP/Remote Config, chống flaky, mạng yếu) thành ≤ 80 dòng tiếng Việt. Không mang step Gherkin/Java, không nhắc `@KEY`, không nhắc file `references/*` (đã bị xóa).
- [ ] **Step 2: Soạn `smoke-step.md`** theo khuôn `explore-step.md`: nhận `{{flowName}} {{goal}} {{prdQuote}} {{expected}} {{elements}} {{tried}} {{step}}/{{maxSteps}} {{figmaFrames}} {{account}}` + kiến thức từ `smoke-knowledge.md`. Quy tắc: so màn hiện tại (ảnh app + ảnh frame Figma đính kèm bằng đường dẫn, AI đọc bằng `Read`) với PRD; chỉ ghi `finding` khi thấy lệch rõ (thiếu/thừa phần tử, sai chữ, sai luồng); PRD và Figma nói khác nhau thì `kind: 'conflict'` và **đi tiếp**, không dừng; chỗ PRD ghi chưa rõ thì `kind: 'unclear'`; `locator` chép nguyên văn từ danh sách; không bấm mua/đăng ký.
- [ ] **Step 3: Test `start` — lỗi đầu vào.** Assert `status` đúng: app không tồn tại 404; thiếu `udid` 400; `figmaUrl` không `node-id` 400; khóa đang giữ → 409 và `loadFlows` không được gọi.
- [ ] **Step 4: Test chạy trọn một luồng** (driver giả như `test/ui-ai.test.js`; `loadFlows` giả trả 1 luồng 1 frame; `frameImage` giả; `runClaude` giả trả lần lượt `{action:'tap',...}`, `{action:'done', flowStatus:'deviation', finding:{kind:'figma', summary:'Nút lệch', frameName:'Log Blood Sugar'}}`). Assert: `status:'done'`; luồng `deviation`; `findings` có 1 mục với `appShot` và `figmaShot` là đường dẫn dưới `/files/data/smoke/SM-0001/`; khóa được nhả (`lock.current() === null`).
- [ ] **Step 5: Test các đường lỗi/giới hạn.** (a) `loadFlows` trả `{ok:false,error}` → `status:'error'`, `error` giữ nguyên chữ, khóa nhả; (b) AI trả cùng `tap` + `locator` 3 lần liên tiếp → luồng `unverifiable`, sang luồng kế; (c) vượt `maxSteps` → luồng `unverifiable`; (d) `stop()` giữa chừng → `status:'stopped'`; (e) `recover()` đổi lần chạy `running` không có job thành `interrupted`; (f) lỗi mở phiên Appium → `status:'error'`, khóa nhả.
- [ ] **Step 6: Chạy test, thấy FAIL** — `node --test test/smoke-run.test.js`.
- [ ] **Step 7: Implement `createSmoke`** theo `createAiCheck`: `jobs` Map, `update/log` helper, `run(id, ...)` có `try/catch/finally` nhả khóa và đóng phiên. Bắt đầu: `loadFlows` → với mỗi luồng tải ảnh frame bằng `frameImage` (frame đầu tiên của luồng; lỗi tải ảnh không dừng cả lần chạy, chỉ bỏ so Figma và ghi vào `log`) → vòng bước: chụp + `parseElements` + gọi `runClaude` với `STEP_SCHEMA`, `allowedTools: ['Read']` → thực thi bằng `doAction`. Dừng luồng khi `action:'done'`, vượt `limits`, lặp 3 lần, hoặc `job.stop`. Cài tài khoản test (`account`) vào prompt như chế độ Tự khám phá. Cài sạch app khi mở phiên (không `keepState`).
- [ ] **Step 8: Chạy test, thấy PASS.**

### Task 4: Report ngắn và API

**Files:**
- Create: `server/smoke/report.js`, `server/routes/smoke.js`
- Modify: `server/routes/index.js` (thêm router vào `ROUTERS`), `server/app.js` (thêm `'smoke'` vào danh sách thư mục tĩnh), `server/index.js` (dựng `createSmoke`, gọi `recover()`, đưa vào `ctx`), `server/lock.js` (thêm `'smoke'` vào `JOB_COLS`)
- Test: `test/smoke-report.test.js`, `test/smoke-routes.test.js`

**Interfaces:**
- Consumes: `createSmoke` (Task 3).
- Produces:
  - `renderReport(run: SmokeRun, appName: string): string` (HTML tự chứa, một trang).
  - `writeReport(dir: string, run: SmokeRun, appName: string): string` — ghi `report.html`, trả đường dẫn file.
  - API: `POST /api/apps/:appId/smoke` (body `{ udid, prdUrl, figmaUrl, notes?, account? }` → 201 `SmokeRun`; lỗi theo `status` của `start`), `GET /api/apps/:appId/smoke` (danh sách mới nhất trước, không có `log`), `GET /api/smoke/:id` (kèm `live`, `appName`), `POST /api/smoke/:id/stop`, `GET /api/smoke/:id/report` → HTML.

- [ ] **Step 1: Test `renderReport`.** Với run có 3 luồng (`ok`, `deviation`, `unverifiable`) và 2 findings (`prd`, `conflict`): HTML chứa số luồng / đi hết / lệch ở đầu; mỗi finding có `summary`, `prdQuote`, ảnh app, ảnh Figma; luồng `unverifiable`/`unreachable` có dòng riêng kèm lý do; chuỗi người dùng được escape HTML (`<script>` trong `summary` không còn nguyên văn); độ dài HTML với 1 run mẫu < 20.000 ký tự (report ngắn).
- [ ] **Step 2: Chạy test, thấy FAIL.**
- [ ] **Step 3: Implement `renderReport` và `writeReport`.** Dùng bộ màu chung nhưng **không** import hay sửa `vendor/test-report`.
- [ ] **Step 4: Test route** (express + `createSmoke` giả, theo mẫu `test/ui.test.js`): POST hợp lệ → 201; lỗi 409/400 giữ nguyên `status` và `error`; GET danh sách chỉ của app đó, không có `log`; GET `/smoke/:id` không có → 404; `report` trả `content-type` HTML.
- [ ] **Step 5: Chạy test, thấy FAIL.**
- [ ] **Step 6: Implement `server/routes/smoke.js` và nối dây** (`routes/index.js`, `app.js`, `index.js`, `lock.js`). `writeReport` được gọi trong `createSmoke` khi lần chạy kết thúc (inject qua tham số `report = writeReport` để test được).
- [ ] **Step 7: Chạy toàn bộ** — `npm test`. Mong đợi: toàn bộ PASS.

### Task 5: Giao diện

**Files:**
- Create: `web/src/pages/SmokeTest.jsx`, `web/src/pages/SmokeRunView.jsx`
- Modify: `web/src/pages/index.jsx` (thêm 2 route: `/apps/:appId/smoke` → `SmokeTest`, `/smoke/:id` → `SmokeRunView`), `web/src/components/Sidebar.jsx` (thêm `NavLink` "AI Smoke Test" dưới "UI Testing", icon `spark`, `to={`/apps/${app.id}/smoke`}`; **và** thêm `'smoke'` vào mảng `keep` ở đầu file, để đổi app thì ở lại đúng trang này)

**Interfaces:**
- Consumes: API ở Task 4; từ `web/src/components/DevicePicker.jsx`: `useDevices(platform, onError)` trả `{ devices, udid, setUdid, picked, wrong }`, `DevicePicker({ devices, value, onChange, platform, disabled })`, `WrongPlatform({ platform, picked })`; từ `web/src/components/ui.jsx`: `PageHeader({ title, sub, children })`, `ErrorNote({ error })`, `fmtTime`; `useEvents('smoke', handler)`; `api`. Mẫu để bám: `web/src/pages/UiAiView.jsx`.

- [ ] **Step 1: `SmokeTest.jsx`.** Form: ô link PRD, ô link Figma, ô ghi chú (tuỳ chọn), tài khoản test (tuỳ chọn, mặc định thu gọn), `DevicePicker`, nút **Chạy smoke test** (tắt khi thiếu 2 link hoặc thiết bị đang bận, tooltip như `UiTesting.jsx`). Bên dưới là bảng các lần chạy trước của app (id, thời gian, trạng thái, số luồng / số lệch), bấm mở `/smoke/:id`. Lỗi từ API hiện bằng `ErrorNote`.
- [ ] **Step 2: `SmokeRunView.jsx`** theo khung `UiAiView.jsx`: tiêu đề + nút Dừng, thẻ tổng (luồng / đi hết / lệch / không kiểm được), ảnh live và dòng log cuối khi đang chạy, danh sách điểm lệch (ảnh app cạnh ảnh Figma, đoạn PRD, nhãn nguồn lệch bằng chữ: "Lệch PRD" / "Lệch Figma" / "PRD và Figma mâu thuẫn" / "PRD chưa rõ"), nút mở report ngắn.
- [ ] **Step 3: Kiểm tay trên trình duyệt.** `npm start`, mở `http://localhost:5178`, chọn một app, vào **AI Smoke Test**: form hiện đủ, nút tắt khi chưa nhập link, mục menu sáng đúng khi ở route smoke. (Không có test tự động cho UI trong repo.)
- [ ] **Step 4: `npm run build`** — mong đợi: build Vite không lỗi.

### Task 6: Chạy thật rồi gỡ "AI kiểm UI"

**Files:**
- Delete (chỉ sau khi Step 1 đạt): `server/ui/aiCheck.js`, `server/routes/uiAi.js`, `web/src/pages/UiAiView.jsx`, `test/ui-ai.test.js`, `server/ai/prompts/ui-compare.md` (xác nhận chỉ `aiCheck.js` dùng nó bằng `grep -rn ui-compare server`)
- Modify: `server/routes/index.js`, `server/index.js` (bỏ `createAiCheck`, `aiCheck.recover`, `aiCheck` trong `ctx`), `web/src/pages/index.jsx` (bỏ route `/ui-ai/:id`), `web/src/pages/UiTesting.jsx` (bỏ nút "AI kiểm UI", ô tick/`aiPick`/`aiArrows`/`aiOpen`, bảng `aiRuns`, cuộc gọi `/ui-ai`), `README.md` (bỏ mô tả AI kiểm UI, thêm mục AI Smoke Test)
- Giữ nguyên: `data/uiai` trên đĩa; `'uiai'` trong `server/app.js` (để link ảnh cũ không chết) và `JOB_COLS` trong `server/lock.js`.

- [ ] **Step 1: Chạy thật.** `npm start`, Simulator đã mở, build app mẫu của Trang; chạy AI Smoke Test với link PRD và Figma mẫu. Mong đợi: lần chạy kết thúc `done`, có report ngắn mở được, ít nhất 1 luồng có kết quả và ảnh làm căn cứ. Nếu không đạt, **không** sang Step 2; báo lỗi cho người dùng.
- [ ] **Step 2: Xin người dùng xác nhận gỡ** bằng một câu hỏi (kết quả Step 1 + danh sách file sẽ xóa). Chỉ xóa khi họ đồng ý.
- [ ] **Step 3: Gỡ code** như danh sách trên.
- [ ] **Step 4: Chạy** `npm test` và `npm run build`. Mong đợi: PASS / build không lỗi, và `grep -rn "aiCheck\|ui-ai\|UiAiView" server web/src test` không còn kết quả nào ngoài chú thích đã cố ý giữ.

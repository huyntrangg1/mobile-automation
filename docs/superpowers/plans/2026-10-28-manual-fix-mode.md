# Manual fix mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tuỳ chọn khi Run: step chặn luồng thì dừng, cho tester chọn Block / Skip / Retry / Use element / Fix script trên màn Run, rồi case chạy tiếp; bug log đúng theo lựa chọn.

**Architecture:** Bước chung `k` (worker wdio) khi lỗi + `MANUAL_FIX=1` ghi `help.json` (kèm ảnh + page source) vào thư mục run rồi chờ `answer.json`. Server (runner tick) thấy `help.json` → parse phần tử bằng `parseElements`, gợi ý, gắn vào `run.help`, đẩy SSE; giao diện hiện hộp thoại, `POST /runs/:id/answer` ghi `answer.json` (Fix → ghi thêm `locators/overrides.json` của workspace). Bug "chặn luồng nhưng đã cho chạy tiếp" ghi qua `addFlowBug` của skill test-report và thành bug trong report.

**Tech Stack:** Node 20+ ESM, Express 5, WebdriverIO 9 / Appium, React 18 + Vite, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-28-manual-fix-mode-design.md`

## Global Constraints
- Chế độ mặc định **tắt**; tắt → hành vi y như hiện nay (lỗi ném ra, case Blocked).
- Chạy test **không gọi AI** (không `runClaude` trong runner / route answer).
- Lựa chọn theo loại bước: `tap`, `enter`, `nav` → `['block','skip','retry','use','fix']`; `gone`, `alert` → `['block','skip','retry']`.
- Bug: block → bug chặn luồng (như cũ); skip, use → bug "đã cho chạy tiếp"; retry thành công, fix → không bug.
- Khoá override: `` `${screen}|${target}` `` với `screen` = tên màn Excel; bước `nav` dùng target `'(screen)'`.
- Case có bug "đã cho chạy tiếp" mà đi hết → trạng thái **Failed**.
- Stop khi đang hỏi → ghi answer `block` trước khi kill.
- Đổi report: sửa `.claude/skills/test-report/assets/src/`, rồi `bash .claude/skills/test-report/scripts/install.sh <project>` cho `ik-fitness` và mọi `qa-pipeline-demo/workspaces/*` (CLAUDE.md). `steps.js` template mới chép vào mọi workspace có `src/runner/steps.js`.
- Không commit (người dùng chưa yêu cầu); mỗi task kết thúc bằng chạy test.

## Review Focus
- Không ai trả lời lâu (> mocha timeout 300 s / Appium newCommandTimeout) → case không được tự fail, phiên Appium không được chết: test `waitAnswer` gọi keep-alive (Task 2).
- `help.json` cũ còn sót từ run trước / id không khớp → answer phải bị từ chối, worker không đọc nhầm: test route answer với id sai (Task 3).
- Locator tester chọn cũng không dùng được (Use element rồi tap lỗi) → hỏi lại, không treo / không ném lỗi lạ: test Use với locator hỏng (Task 2).
- Cùng màn + target lỗi lần 2 trong một run sau khi đã Use → không hỏi lại, vẫn ghi bug: test (Task 2).
- `overrides.json` hỏng / không tồn tại → `k` chạy như không có override: test (Task 2).

---

### Task 1: Report — bug "chặn luồng nhưng đã cho chạy tiếp" (skill test-report)

**Files:**
- Modify: `.claude/skills/test-report/assets/src/report/collector.js` (thêm `addFlowBug`, reset trong `resetCurrent`)
- Modify: `.claude/skills/test-report/assets/src/report/hooks.js` (`writeResult`: ghi `flows`, ảnh, status)
- Modify: `.claude/skills/test-report/assets/src/report/html.js` (`buildBugs`: bug cho từng flow)
- Modify: `.claude/skills/test-report/reference.md` (mục "Flow bugs": dòng "đã cho chạy tiếp")
- Test: `qa-pipeline-demo/test/report-flows.test.js` (import skill qua `TEST_REPORT_SKILL` từ `server/paths.js`)

**Interfaces:**
- Produces: `addFlowBug({ step, screen, target, error, seen = null, shot = null })` — đẩy vào `current.flows` kèm `at: current.steps.length` (vị trí trong nhật ký bước).
- Produces: result JSON có `flows: [{ step, screen, target, error, seen, image, at }]` (image = jpg đã thu nhỏ trong `evidence/`, như failShot); `flows.length && passed` → `status: 'failed'`, `passed: false`.
- Produces: `buildModel` ra 1 bug cho mỗi flow, dùng `flowText(error, { last, seen, failed: { prevScreen: screen } })`, Steps = các Action trong `r.steps.slice(0, at)`, `image` = flow.image, `noBox: true`.

- [ ] **Step 1: Write failing tests** `report-flows.test.js`:
  - `writeResult` với `addFlowBug({ step: 6, screen: 'Recipe source', target: '(screen)', error: 'Không tới được màn Awesome: không thấy nút "Show me how" sau 15s', seen: { title: 'Good news 🎉', text: null, buttons: ['Continue'] } })` và mocha `passed: true` → JSON có `status === 'failed'`, `flows.length === 1`.
  - `buildModel({ results: [thatResult], env: {} }).bugs` có 1 bug title `'[BUG][Recipe source] Nhấn "Continue" hiển thị màn "Good news 🎉" thay vì màn Awesome'` khi `steps` trước đó kết thúc bằng Action Tap "Continue" ở màn Recipe source.
  - Result có cả check bug và flow → 2 bug.
- [ ] **Step 2:** `node --test test/report-flows.test.js` → FAIL (`addFlowBug` không tồn tại).
- [ ] **Step 3:** Implement theo Interfaces. `buildBugs`: thêm bug flow **trước** nhánh `if (r.status !== 'blocked' && checks.length) return checks;` (tức mọi status), trả `[...checks, ...flows, ...(blocked ? [flowBugCuốiCũ] : [])]`.
- [ ] **Step 4:** `node --test test/report-flows.test.js` PASS; `npm test` PASS (153+).
- [ ] **Step 5:** Cài lại skill: `for p in ../ik-fitness workspaces/*; do bash ../.claude/skills/test-report/scripts/install.sh $p; done` rồi `--check` mỗi project → 0 file khác. Dựng lại `ik-fitness/reports` bằng code mới → vẫn 8 bug.

### Task 2: `k` ở chế độ sửa tay (template steps.js + khung script)

**Files:**
- Modify: `server/apps/template/src/runner/steps.js`
- Modify: `server/scripts/scriptFile.js` (khung: import `addFlowBug` từ `../src/report/collector.js`, `screenSummary` từ `../src/report/hooks.js`; truyền vào `createSteps`; thêm 2 tên vào `RESERVED`)
- Modify: `server/apps/template/wdio.conf.js` (`mochaOpts.timeout: process.env.MANUAL_FIX === '1' ? 0 : 300000`)
- Test: `test/steps-manual.test.js`; cập nhật `test/scriptFile.test.js` (khung truyền `flowBug`)

**Interfaces:**
- Consumes: `addFlowBug` (Task 1), `screenSummary()` (skill hooks.js, có sẵn).
- Produces: `createSteps({ sa, logStep, snapshot, flowBug, summarize, env = process.env, cwd = process.cwd() })`.
- Produces file `help.json` trong `env.HELP_DIR`: `{ id, tc, step, screen, target, kind, error, choices, shot, source }` (`shot` png, `source` xml — đường dẫn tuyệt đối trong HELP_DIR); dòng live `{ type: 'help', id, step, screen, target }`.
- Consumes file `answer.json`: `{ id, action: 'block'|'skip'|'retry'|'use'|'fix', locator? }` — chỉ nhận khi `id` khớp; đọc xong xoá cả hai file.
- Produces: `readOverrides(cwd) → { [key]: locator }` (đọc `locators/overrides.json`, lỗi/không có → `{}`), export từ steps.js để test.

- [ ] **Step 1: Write failing tests** `steps-manual.test.js` (mock `driver`, `$`, `browser.saveScreenshot`, `browser.getPageSource`, tmp dir làm `HELP_DIR` + `cwd`; một "tester" giả ghi `answer.json` khi thấy `help.json`):
  - `MANUAL_FIX` không đặt → `k.tap` thiếu phần tử ném lỗi như cũ, không tạo `help.json`.
  - bật + answer `block` → ném đúng câu lỗi gốc.
  - `skip` → không ném; `flowBug` được gọi 1 lần với `{ step, screen, target, error }`.
  - `retry` (phần tử xuất hiện trước lần thử 2) → không bug.
  - `use` với locator tồn tại → tap locator đó, `flowBug` 1 lần; lần gọi thứ 2 cùng `screen|target` → không tạo `help.json`, vẫn `flowBug` thêm 1 lần.
  - `use` với locator không tồn tại → hỏi lại (tạo `help.json` lần 2).
  - `fix` → không `flowBug`; có `locators/overrides.json` chứa key (giả lập server ghi) thì lần sau `k.tap` dùng override, không hỏi.
  - `k.nav` `use` → coi locator là dấu hiệu màn (chờ tồn tại), key `screen|(screen)`; `k.gone` / `k.alert` → `choices` chỉ `['block','skip','retry']`.
  - overrides.json hỏng JSON → `readOverrides` trả `{}`.
  - chờ answer > 30 s (fake timers / interval nhỏ qua `env.HELP_POLL_MS`) → gọi `driver.getWindowRect` keep-alive.
- [ ] **Step 2:** `node --test test/steps-manual.test.js` → FAIL.
- [ ] **Step 3:** Implement: một hàm nội bộ `guard(kind, info, attempt, useWith)` bọc các bước chặn luồng; tra override (`readOverrides`) và bộ nhớ run (`Map` module-scope) trước `sel` của script; khi hỏi: `browser.saveScreenshot(shot)`, ghi `source` từ `browser.getPageSource()`, ghi `help.json` + live line (append vào `env.LIVE_STEPS`), poll `answer.json` mỗi `env.HELP_POLL_MS || 500` ms, keep-alive mỗi 30 s. Bug ghi qua `flowBug({ ..., seen: await summarize(), shot })`.
- [ ] **Step 4:** `npm test` PASS. Khung: `buildScript` chứa `createSteps({ sa, logStep, snapshot, flowBug: addFlowBug, summarize: screenSummary })`.
- [ ] **Step 5:** Chép `steps.js` + `wdio.conf.js` (chỉ dòng timeout) vào mọi `workspaces/*`; `node --check` từng file.

### Task 3: Server — cờ chạy, phát hiện help, trả lời, override

**Files:**
- Create: `server/runs/overrides.js` — `readOverrides(workspace)`, `saveOverride(workspace, key, { locator, element, at })`, `removeOverride(workspace, key)`, `listOverrides(workspace) → [{ key, screen, target, locator, element, at }]`
- Create: `server/runs/help.js` — `suggest(target, elements) → elements[]` (tối đa 3, chữ gần giống nhất: Dice hệ số bigram trên `name || label`, chữ thường, ≥ 0.4), `readHelp(runDir, parse = parseElements, windowOf) → run.help | null`
- Modify: `server/runs/runner.js` — `startRun({ appId, udid, caseIds, manualFix = false })` → env `MANUAL_FIX: manualFix ? '1' : ''`, `HELP_DIR: <run dir>`; lưu `run.manualFix`; `tick()` gắn `help: readHelp(...)` (kèm `shotUrl: /files/data/runs/<id>/help.png?t=…`, `elements`, `win`, `suggestions`); `answer(id, { helpId, action, locator })`; `stop()` ghi answer `block` nếu đang có help.
- Modify: `server/routes/runs.js` — `POST /apps/:appId/runs` nhận `manualFix`; `POST /runs/:id/answer`.
- Modify: `server/routes/locators.js` — `GET /apps/:appId/overrides`, `DELETE /apps/:appId/overrides` body `{ key }`.
- Test: `test/manual-fix-server.test.js` (fake spawn như `runner.test.js`)

**Interfaces:**
- Consumes: định dạng `help.json` / `answer.json` của Task 2; `parseElements`, `windowOf` (`server/locators/pageSource.js`).
- Produces: `run.help = { id, tc, step, screen, target, kind, error, choices, shotUrl, win, elements: [{ type, name, label, rect, locator }], suggestions: [same] } | null`; API answer trả 409 khi không có help hoặc `helpId` lệch, 400 khi `action` không thuộc `choices` hoặc use/fix thiếu `locator`.

- [ ] **Step 1: Write failing tests:** startRun với `manualFix: true` → env có `MANUAL_FIX=1`, `HELP_DIR`; ghi `help.json` + xml mẫu (`test/fixtures`) → sau tick `run.help.elements.length > 0`, `suggestions[0].name === 'Get Started'` cho target `Get started`; answer `fix` → `answer.json` đúng + `locators/overrides.json` có key `Welcome|Get started`; answer với `helpId` sai → 409; `action: 'use'` cho kind `alert` → 400; `stop()` khi có help → `answer.json` `{ action: 'block' }` trước kill; `listOverrides` / `removeOverride`.
- [ ] **Step 2:** `node --test test/manual-fix-server.test.js` → FAIL.
- [ ] **Step 3:** Implement theo Interfaces (ảnh help copy sang `<run dir>/help.png` để phục vụ qua `/files`).
- [ ] **Step 4:** `npm test` PASS.

### Task 4: Giao diện

**Files:**
- Modify: `web/src/pages/RunConfig.jsx` — checkbox "Sửa tay khi lỗi" (mặc định bỏ chọn) → body `manualFix`.
- Create: `web/src/components/HelpDialog.jsx` — props `{ help, onAnswer(action, locator) }`: tiêu đề `Sửa step: <kind> "<target>"`, dòng phụ `<tc> · step <step> · <screen>`, câu lỗi (đỏ), chip "Có phải ý bạn là", ô lọc, danh sách phần tử (type, name/label), ảnh với khung phần tử (vị trí `rect / win`, cùng cách `box()` ở `LocatorMap.jsx`), bấm khung = chọn; nút theo `help.choices` (nhãn: Block, Skip step, Retry, Use element, Fix script & go on); Use/Fix tắt khi chưa chọn; dòng giải thích ngắn cho nút đang hover.
- Modify: `web/src/pages/RunView.jsx` — `r.help` có → hiện `HelpDialog`; `onAnswer` → `api.post(/runs/${id}/answer, { helpId: r.help.id, action, locator })`; badge "Đang chờ tester sửa".
- Modify: `web/src/pages/LocatorMap.jsx` — mục "Đã sửa khi chạy" (bảng key · locator · thời gian · nút Xoá) từ `GET /apps/:appId/overrides`.

- [ ] **Step 1:** `npm run build` PASS (không lỗi JSX).
- [ ] **Step 2:** Thử tay trên `http://localhost:5173`: Run TC_ONB_001 (Tastory 1.0.4) có bật chế độ → tới step 6 hiện hộp thoại (màn Good news); chọn "Continue" → **Use element** → case chạy tiếp; report có bug "Nhấn "Continue" hiển thị màn "Good news 🎉" thay vì màn Awesome" và trạng thái Failed. Chạy lại **tắt** chế độ → Blocked như cũ.

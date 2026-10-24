# QA Pipeline demo — kế hoạch làm

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web demo chạy trên Mac: thêm app → lấy locator (Tự khám phá / Ghi lại khi tôi bấm) → import Excel v2 → AI gen script WebdriverIO (review tuỳ chọn) → Run trên iOS Simulator → report `test-report`.

**Architecture:** Server Node (Express) giữ trạng thái trong file JSON dưới `data/`, điều khiển Appium/WebdriverIO và gọi `claude -p` để gen / khám phá. Mỗi app có một **workspace** WebdriverIO riêng trong `workspaces/<appId>/` (tool tạo từ template + "helper pack" copy từ `ik-fitness`). **Mỗi file Excel = một file test script** `tests/<fileStem>.e2e.js` chứa mọi case: phần khung (thứ tự chạy, chuỗi Tiếp nối, report) do tool sinh, còn mỗi case là một đoạn `// #region <TC ID>` … `// #endregion <TC ID>` do AI viết. Gen lại một case = thay đúng region của case đó. Web là React + Vite, nhận tiến độ qua SSE.

**Tech Stack:** Node 26 (ESM, JS thuần như workspace), Express 5, `webdriverio` 9 (session lấy locator), `@xmldom/xmldom` + `xpath`, `exceljs`, WebdriverIO 10 + Appium 2 xcuitest trong workspace (giống `ik-fitness`), React 18.3 + react-router-dom 6 + Vite 5, test bằng `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-24-qa-pipeline-demo-design.md`

## Global Constraints

- Không sửa gì trong `/Users/huyentrang/Desktop/automation/ik-fitness`; chỉ đọc / copy.
- Không phải git repo: bước "Commit" trong các task = bỏ qua (không `git init`, không commit / push).
- Workspace mỗi app phải cài report chung: `bash /Users/huyentrang/Desktop/automation/.claude/skills/test-report/scripts/install.sh <workspace>`, dev deps `pngjs exceljs @wdio/reporter`, hook đúng mục "Config" của skill với `onComplete → buildHtml(REPORTS, startedAt, { appName, open: false })`.
- Code AI gen **không được** gọi `runTestcase` (keyword runner); tool từ chối file có chuỗi đó.
- AI = Claude Code CLI `claude -p` (2.1.283, có `--output-format json`, `--json-schema`). Không cần API key.
- Một job thiết bị tại một thời điểm (lấy locator hoặc run); job khác bị từ chối kèm lý do.
- Giao diện tiếng Việt, thuật ngữ test giữ tiếng Anh (Passed, Failed, Blocked, Skipped, Not Run, Run, Locator…). Không emoji. Nền: design system `ikqa` (tokens copy từ canvas) + IBM Plex Sans / Mono. Phải đẹp hơn canvas.
- Không dữ liệu giả trên màn hình: mọi số liệu lấy từ store / kết quả chạy thật.
- Simulator mặc định: iPhone 17 Pro Max `C8F5C490-7394-47AD-A430-42EB9424EAB1`; app mẫu `ik-fitness/apps/ikFitnessHeathyApp.app`, bundle `com.begamob.fitness`.
- Tiêu chí xong: `ik-fitness/data/testcases/authentication-automation.xlsx` (38 case) chạy hết luồng, có Passed / Failed / Blocked thật, report khoanh đỏ, `ALLOW_ACCOUNT_CREATE=1`.

## Review Focus

1. **Case nối tiếp mà case trước bị chặn / chưa gen** — 37/38 case auth là "Tiếp nối". Kỳ vọng: harness cư xử như `ik-fitness/tests/regression/auth/authentication-automation.e2e.js` (ROUTES recovery, không thì Blocked với lý do rõ); Run config tự thêm case trước, case trước chưa gen → không cho chạy, nói rõ case nào. Test: Task 8 `closure` + Task 9 harness test.
2. **`claude -p` trả về rác / hết giờ / không đăng nhập** — kỳ vọng: case thành "Gen lỗi" kèm lý do đọc được, job khác vẫn chạy tiếp, không treo server. Test: Task 2.
3. **Cùng một màn gặp lại với dữ liệu khác** (ô nhập đã có chữ, lỗi validation hiện / ẩn) — kỳ vọng: không tạo màn trùng. Test: Task 3 `screenSignature`.
4. **Đang chạy mà bấm Run / Lấy locator lần nữa, hoặc server restart giữa chừng** — kỳ vọng: bị từ chối kèm lý do; khởi động lại thì job dở dang thành "Interrupted", lock được nhả. Test: Task 1 lock + Task 10.
5. **Import lại cùng file Excel đã sửa** — kỳ vọng: case giữ script cũ nếu bước không đổi, case có bước đổi chuyển "Cần gen lại". Test: Task 8.

---

## Cấu trúc file

```
qa-pipeline-demo/
  package.json                 scripts: dev (server + vite), start (build web rồi chạy server), test
  server/
    index.js                   Express app, mount routes, SSE /api/events, serve web/dist + /files
    store.js                   JSON store theo collection, ghi atomic
    events.js                  bus SSE
    lock.js                    khoá thiết bị 1 job
    ai/claude.js               runClaude()
    ai/prompts/{gen-case,explore-step}.md
    device/simulators.js       listSimulators()
    device/session.js          openSession()/closeSession() (Appium + webdriverio remote)
    locators/pageSource.js     parse XML → elements, locator đề xuất, screenSignature
    locators/screenMap.js      merge snapshot vào map, rename/merge/delete, export locators/map.js
    locators/record.js         chế độ Ghi lại khi tôi bấm
    locators/explore.js        chế độ Tự khám phá
    apps/workspace.js          tạo workspace từ template + helper pack
    apps/template/             package.json, wdio.conf.js của workspace
    testcases/importXlsx.js    copy + parse Excel v2, diff khi import lại
    testcases/closure.js       thêm case phía trước của chuỗi Tiếp nối
    scripts/generate.js        gen 1 case bằng AI, kiểm tra, lưu
    scripts/harness.js         sinh spec harness cho 1 file Excel
    runs/runner.js             spawn wdio, theo dõi results/, cập nhật run
    routes/{apps,locators,testcases,scripts,runs}.js
  web/                         Vite + React
    src/main.jsx, App.jsx, api.js, useEvents.js
    src/styles/{tokens.css,app.css}
    src/components/            Sidebar, Badge, Table, Drawer, Empty, LogView, Progress
    src/pages/                 Apps, LocatorMap, CaptureLive, TestCases, ScriptReview, RunConfig, RunView, Runs, AppSettings
  test/                        *.test.js (node:test) + fixtures/
  data/                        (runtime) store + runs/<runId>/reports
  workspaces/                  (runtime) workspace từng app
  README.md
```

---

### Task 1: Khung project, store, lock, SSE, giao diện vỏ

**Files:**

- Create: `package.json`, `server/index.js`, `server/store.js`, `server/events.js`, `server/lock.js`, `web/index.html`, `web/vite.config.js`, `web/src/{main.jsx,App.jsx,api.js,useEvents.js}`, `web/src/styles/{tokens.css,app.css}`, `web/src/components/Sidebar.jsx`
- Test: `test/store.test.js`, `test/lock.test.js`

**Interfaces:**

- Produces:
  - `createStore(dir) → { list(col), get(col,id), put(col,obj) /* obj.id bắt buộc */, patch(col,id,partial), remove(col,id) }` — mỗi collection = `dir/<col>.json`, ghi qua file tạm + rename.
  - `events.emit(type, payload)`; `GET /api/events` (SSE, `event: <type>`).
  - `lock.acquire(job: {kind:'capture'|'run', id, label}) → {ok:true} | {ok:false, holder}`, `lock.release(id)`, `lock.current()`. `lock.recover(store)` lúc khởi động: run / capture đang `running` → `interrupted`.
  - `web/src/api.js`: `api.get(path)`, `api.post(path, body)`, `api.put`, `api.del`; `useEvents(type, handler)`.
  - Layout: Sidebar (Apps · Test cases · Runs · Cài đặt app) + vùng nội dung; route `/apps`, `/apps/:appId/locators`, `/apps/:appId/capture/:captureId`, `/apps/:appId/settings`, `/apps/:appId/cases`, `/apps/:appId/scripts/:caseId`, `/apps/:appId/run`, `/runs`, `/runs/:runId`.

- [ ] **Step 1:** Viết `test/store.test.js`: `put` rồi `get` trả cùng object; `patch` gộp field; tạo store mới trên cùng thư mục đọc lại được dữ liệu; `list` của collection chưa có trả `[]`.
- [ ] **Step 2:** Viết `test/lock.test.js`: `acquire` lần 2 khi đang giữ → `{ok:false, holder.label}`; `release` rồi `acquire` → ok; `recover` đổi run `status:'running'` thành `'interrupted'` và lock trống.
- [ ] **Step 3:** `node --test test/` → FAIL (module chưa có).
- [ ] **Step 4:** Implement store, lock, events, server Express (port 5178, `GET /api/health`), Vite proxy `/api` + `/files`.
- [ ] **Step 5:** `tokens.css`: chuyển `ikqa` tokens thành CSS vars. Lấy file: `Artifact read` url `https://claude.ai/artifact/XNBhRATzqvfdbd2bTp5N8h` path `project/ds/ikqa/tokens.json`, kèm `project/app.css` để tham khảo component. Font IBM Plex Sans/Mono từ Google Fonts.
- [ ] **Step 6:** `node --test test/` → PASS; `npm run dev` mở `http://localhost:5173`, thấy sidebar và các route trống (Empty state có chữ, không lỗi console).

### Task 2: Gọi Claude (`runClaude`)

**Files:** Create `server/ai/claude.js` · Test `test/claude.test.js`

**Interfaces:**

- Produces: `runClaude({ prompt, schema, cwd, timeoutMs = 180000, spawnImpl }) → Promise<{ ok:true, data } | { ok:false, error:string }>`. Chạy `claude -p --output-format json --json-schema <schema> --allowedTools "Read"` với `cwd`, prompt qua stdin; đọc `structured_output` (hoặc `result` parse JSON) trong JSON trả về. Không bao giờ throw.

- [ ] **Step 1:** Test với `spawnImpl` giả: stdout JSON hợp lệ → `ok:true, data`; stdout không phải JSON → `ok:false`, error chứa "không đọc được"; exit code ≠ 0 kèm stderr "not logged in" → error chứa stderr; quá `timeoutMs` → process bị kill, error "quá thời gian".
- [ ] **Step 2:** Chạy → FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Smoke thật: `node -e` gọi `runClaude({prompt:'Trả về {"x":1}', schema:{type:'object',properties:{x:{type:'number'}},required:['x']}})` → `{ok:true,data:{x:1}}`. Kiểm tra lại tên field trong JSON output của CLI và sửa parser nếu khác.

### Task 3: Đọc page source → phần tử, locator, chữ ký màn

**Files:** Create `server/locators/pageSource.js` · Test `test/pageSource.test.js`, `test/fixtures/{login-empty,login-filled,welcome}.xml`

**Interfaces:**

- Produces:
  - `parseElements(xml) → Element[]`, `Element = { type, name, label, value, rect:{x,y,width,height}, visible, enabled, locator, alts:string[] }`. Chỉ giữ phần tử hiển thị, có ý nghĩa (Button, StaticText, TextField, SecureTextField, Switch, Image có name, Cell, Slider, Picker…).
  - Locator ưu tiên: `~<name>` nếu name duy nhất trên màn → `-ios predicate string:type == "<T>" AND name == "<n>"` → `-ios class chain:**/<Type>[n]`.
  - `screenSignature(elements) → string` — hash từ tập (type + name) của Button / StaticText **tĩnh** và *loại* ô nhập; bỏ `value`, bỏ chữ trong ô nhập, bỏ StaticText trông như dữ liệu / lỗi động (số, email) để màn có lỗi validation và màn trống vẫn cùng chữ ký nếu khung giống nhau ≥ 80% (so Jaccard): `sameScreen(sigA, sigB, elsA, elsB) → boolean`.
  - `toPrompt(elements) → string` — bản rút gọn từng dòng cho AI.

- [ ] **Step 1:** Fixture XML: lấy thật bằng Appium Inspector hoặc `driver.getPageSource()` trên app IK Fitness (màn Welcome, Log In trống, Log In đã nhập email sai + hiện lỗi "Invalid email format"). Lưu vào `test/fixtures/`.
- [ ] **Step 2:** Test: Welcome có phần tử `~Continue with email`; ô Email ở Log In ra locator class chain `**/XCUIElementTypeTextField` (không có name); `sameScreen(login-empty, login-filled) === true`; `sameScreen(welcome, login-empty) === false`; name trùng 2 phần tử → không dùng `~`.
- [ ] **Step 3–4:** FAIL → implement → PASS.

### Task 4: Simulator và phiên Appium

**Files:** Create `server/device/simulators.js`, `server/device/session.js` · Test `test/simulators.test.js`

**Interfaces:**

- Produces:
  - `listSimulators(execImpl) → [{ udid, name, os, booted }]` từ `xcrun simctl list devices available -j`, chỉ iOS.
  - `openSession({ udid, appPath, bundleId, noReset:false }) → { driver, close() }` — tự spawn `appium` (port 4724, tránh 4723 của wdio) nếu chưa chạy, `webdriverio.remote` với caps như `ik-fitness/config/capabilities/ios.caps.js` (language en, `derivedDataPath` + `usePrebuiltWDA` trỏ `ik-fitness/.wda-build` nếu có). `close()` đóng session và appium.
  - `GET /api/simulators`.

- [ ] **Step 1:** Test `listSimulators` với JSON mẫu của simctl → đúng udid/name/os, bỏ watchOS.
- [ ] **Step 2–3:** FAIL → implement → PASS.
- [ ] **Step 4:** Smoke thật: script `node scripts/smoke-session.js` mở IK Fitness, in 5 dòng đầu `toPrompt(parseElements(await driver.getPageSource()))`, đóng. Expected: thấy "Continue with email".

### Task 5: Apps — tạo app, workspace, biến môi trường

**Files:** Create `server/apps/workspace.js`, `server/apps/template/{package.json,wdio.conf.js}`, `server/routes/apps.js`, `web/src/pages/{Apps,AppSettings}.jsx` · Test `test/workspace.test.js`

**Interfaces:**

- Consumes: store (T1).
- Produces:
  - Store `apps`: `{ id, name, appPath, bundleId, platform:'iOS', helperPack: null | 'ik-fitness', env: {KEY:value}, workspace, status:'preparing'|'ready'|'error', error? }`. `bundleId` đọc từ `Info.plist` (`plutil -extract CFBundleIdentifier raw`).
  - `createWorkspace(app, { helperSource, installImpl }) → Promise<void>`:
    1. copy `template/` → `workspaces/<id>/`;
    2. helper pack `ik-fitness`: copy từ `ik-fitness/` các thư mục `src/utils src/pages src/components src/flows src/locators src/runner data/loaders data/fixtures`;
    3. chạy `install.sh <workspace>` của test-report;
    4. `npm install` (deps như `ik-fitness/package.json` + `pngjs exceljs @wdio/reporter`).
  - `template/wdio.conf.js`: như `ik-fitness/config/wdio.shared.conf.js` + caps iOS, nhưng đọc env `REPORTS_DIR`, `DEVICE_UDID`, `APP_PATH`, `BUNDLE_ID`, `APP_NAME`, `SPECS` (danh sách spec), bỏ allure; hook report đúng skill, `open:false`.
  - API: `GET/POST /api/apps`, `GET/PUT /api/apps/:id` (đổi tên, env), `POST /api/apps/:id/rebuild-workspace`.
  - UI Apps: card mỗi app (tên, bundle, số màn trong locator map, số case, run gần nhất), nút "Thêm app" mở drawer: đường dẫn `.app`, tên, helper pack (Không / ik-fitness), chế độ lấy locator (để bắt đầu luôn sau khi tạo). AppSettings: bảng biến môi trường sửa được, mặc định cho IK Fitness `ALLOW_ACCOUNT_CREATE=1`.

- [ ] **Step 1:** Test với `installImpl` giả và thư mục tạm: workspace có `wdio.conf.js`, `src/utils/ui.js` (từ helper pack), lệnh install.sh được gọi với đúng đường dẫn; helperPack null → không có `src/pages`.
- [ ] **Step 2–3:** FAIL → implement → PASS.
- [ ] **Step 4:** Thật: tạo app IK Fitness trên UI → status `ready`; chạy `bash …/install.sh workspaces/<id> --check` → mọi dòng "GIỐNG".

### Task 6: Locator map + chế độ "Ghi lại khi tôi bấm"

**Files:** Create `server/locators/screenMap.js`, `server/locators/record.js`, `server/routes/locators.js`, `web/src/pages/{LocatorMap,CaptureLive}.jsx` · Test `test/screenMap.test.js`

**Interfaces:**

- Consumes: `parseElements`, `sameScreen`, `screenSignature` (T3); `openSession` (T4); lock (T1).
- Produces:
  - Store `screens`: `{ id, appId, name, signature, elements:Element[], screenshot:'files/<appId>/screens/<id>.png', source:'…xml', seenBy:'record'|'explore', updatedAt }`.
  - `addSnapshot(appId, { xml, png, nameHint }) → { screen, isNew }` — trùng `sameScreen` thì gộp phần tử mới vào màn cũ; mới thì tạo, tên = `nameHint` hoặc tiêu đề StaticText lớn nhất trên cùng.
  - `renameScreen`, `mergeScreens(keepId, dropId)`, `deleteScreen`, `setElementKey(screenId, elementIdx, key)` (tên Target tester muốn dùng).
  - `exportLocators(appId) → writes workspaces/<id>/locators/map.js`: `export const L = { '<Screen>': { '<key>': '<locator>' } }`, key = `key` nếu có, không thì name / label.
  - Store `captures`: `{ id, appId, mode:'record'|'explore', status:'running'|'done'|'stopped'|'error'|'interrupted', screensFound, current:{ screenshot, screenName }, log:[], startedAt }`; event SSE `capture`.
  - `startRecord(appId) → captureId`: acquire lock, mở session (`noReset:false`), mỗi 1,5 s đọc page source; chữ ký khác lần trước → `addSnapshot`. `POST /api/captures/:id/stop`.
  - UI LocatorMap: lưới màn (ảnh + tên + số phần tử), chọn màn → bảng phần tử (loại, tên, locator, key sửa được), đổi tên / gộp / xoá màn, nút "Lấy locator" chọn chế độ. CaptureLive: ảnh màn hiện tại, số màn đã tìm thấy, log, nút Dừng; chế độ record có hướng dẫn "Bấm qua app trên Simulator…".

- [ ] **Step 1:** Test `addSnapshot` với fixtures T3: login-empty rồi login-filled → 1 màn, `isNew` lần 2 = false, phần tử lỗi "Invalid email format" được thêm vào màn; welcome → màn thứ 2. `exportLocators` sinh file import được và có `L['Log In']`.
- [ ] **Step 2–3:** FAIL → implement → PASS.
- [ ] **Step 4:** Thật: Ghi lại 5 màn IK Fitness (Welcome → Log In → Create account → Sex → Height); map có 5 màn, ảnh hiện trên UI.

### Task 7: Chế độ "Tự khám phá"

**Files:** Create `server/locators/explore.js`, `server/ai/prompts/explore-step.md` · Test `test/explore.test.js`

**Interfaces:**

- Consumes: `runClaude` (T2), `openSession` (T4), `addSnapshot` (T6), lock.
- Produces: `startExplore(appId, { maxSteps = 60, maxMinutes = 20, hints: {email,password,…} }) → captureId`. Vòng lặp: page source + ảnh → `addSnapshot` → `runClaude` với `toPrompt(elements)`, danh sách màn đã có, các thao tác đã thử ở màn này, hints → nhận `{ action:'tap'|'type'|'back'|'relaunch'|'done', locator?, text?, screenName, reason }` → thực hiện. Locator AI trả về phải là `locator` hoặc `alts` của một phần tử đang có (không thì bỏ, ghi log). Dừng khi `done`, hết bước / thời gian, hoặc người dùng bấm Dừng. Lỗi `runClaude` 3 lần liền → `error`.

- [ ] **Step 1:** Test với `driver` giả (2 màn cố định) và `runClaude` giả: AI trả locator không tồn tại → không tap, log ghi "bỏ qua"; `done` → status `done`, `screensFound = 2`; 3 lỗi AI liền → `error`, lock được nhả.
- [ ] **Step 2–3:** FAIL → implement → PASS.
- [ ] **Step 4:** Thật: Tự khám phá IK Fitness 30 bước, hints email/password test → ít nhất Welcome, Log In, Create account, một màn onboarding.

### Task 8: Import test case + chuỗi Tiếp nối

**Files:** Create `server/testcases/importXlsx.js`, `server/testcases/closure.js`, `server/routes/testcases.js`, `web/src/pages/TestCases.jsx` · Test `test/importXlsx.test.js`, `test/closure.test.js`

**Interfaces:**

- Produces:
  - Copy file vào `workspaces/<appId>/data/testcases/<file>.xlsx`, parse bằng `loadV2` của workspace (helper pack) — app không có helper pack: parser cùng format copy vào template.
  - Store `cases`: `{ id:'<appId>:<TC ID>', appId, file, tcId, title, priority, module /* tiền tố TC ID: SPL, WEL, LOGIN… */, order, fresh, prev, rowsHash, rows, script:{ status:'none'|'generating'|'generated'|'failed'|'stale', warnings:[], error?, reviewed:false, path? } }`.
  - Import lại: `rowsHash` đổi + đã gen → `stale` ("Cần gen lại"); không đổi → giữ.
  - `closure(cases, selectedIds) → { run: id[] /* đúng thứ tự file */, added: id[], missing: [{ id, reason }] }` — thêm mọi case `prev` lùi tới case `fresh`; case thêm vào chưa `generated` → `missing`.
  - API `POST /api/apps/:id/testcases` (multipart), `GET /api/apps/:id/cases`.
  - UI TestCases: vùng import kéo thả, bảng theo module (ID, tiêu đề, priority, trạng thái script, cảnh báo), chọn nhiều → "Generate script" / "Run".

- [ ] **Step 1:** Test import `ik-fitness/data/testcases/authentication-automation.xlsx` → 38 case, `TC_SPL_001.fresh === true`, `TC_LOGIN_001.prev === 'TC_WEL_003'`; import lại cùng file → status giữ nguyên.
- [ ] **Step 2:** Test `closure` với chọn `TC_LOGIN_002` → run = `TC_SPL_001 … TC_LOGIN_002` (6 case, đúng thứ tự), added 5; một case trong đó `none` → `missing` có nó.
- [ ] **Step 3–4:** FAIL → implement → PASS.

### Task 9: Gen script (một file / Excel) + Script review

**Files:** Create `server/scripts/generate.js`, `server/scripts/scriptFile.js`, `server/ai/prompts/gen-case.md`, `server/routes/scripts.js`, `web/src/pages/ScriptReview.jsx` · Test `test/generate.test.js`, `test/scriptFile.test.js`

**Interfaces:**

- Consumes: `runClaude`, `exportLocators`, store `cases`, `screens`.
- Produces:
  - File script duy nhất cho mỗi Excel: `workspaces/<appId>/tests/<fileStem>.e2e.js`. Bố cục:
    ```js
    // (khung do tool sinh — import, loadV2, chuỗi blockedBy, ROUTES, ensureAccounts, planTest/setCase)
    const CASES = {};
    // #region TC_LOGIN_002
    CASES['TC_LOGIN_002'] = async ({ tc, data, sa }) => { /* thao tác + sa.eq(...) */ };
    // #endregion TC_LOGIN_002
    // ... mỗi case một region, theo thứ tự trong Excel
    // (khung: describe → với mỗi tc: planTest; nếu CASES[tc.id] và tc.id thuộc RUN_CASES → it(...))
    ```

    Case chưa gen không có region → chỉ `planTest` → Not Run.
  - `scriptFile.js`: `readRegions(code) → { [tcId]: string }`, `writeScript(appId, file, regions) → path` (sinh lại khung, chèn region theo thứ tự Excel, `node --check`), `setRegion(appId, file, tcId, body)`. Khung giữ logic của `ik-fitness/tests/regression/auth/authentication-automation.e2e.js` (planTest mọi case, `describeCase` cho setCase, chuỗi `blockedBy`, ROUTES recovery, `ensureAccounts`); thân `it` gọi `await CASES[tc.id]({ tc, data, sa: softAssert() })` rồi `sa.assertAll()`; chỉ tạo `it()` cho case trong env `RUN_CASES`.
  - Thân case dùng `L` từ `locators/map.js`, helper trong `src/utils/*`, `src/pages/*`, `src/components/*`; mỗi Action gọi `logStep({ kind:'Action', step, screen, keyword, target, value, ok })`; mỗi Check: đọc giá trị → `snapshot(screen, { k: selector }, { k: anchor? })` trước khi rời màn → `sa.eq(step, label, actual, expected, ev.k, { keyword, target, value, screen })`; Nav lỗi thì để throw. Giá trị lấy qua `fill(row.value, data)` lúc chạy, không viết cứng.
  - `generateCase(caseId) → Promise<case.script>`: prompt `gen-case.md` gồm hướng dẫn "Instrumenting a spec" + "Rules for checks" của skill test-report (đọc từ `SKILL.md` lúc chạy), các dòng của case, locator map của các màn trong case (`toPrompt`), danh sách export của helper pack (đọc `export` từ file), một ví dụ. Schema trả về `{ body, warnings: string[] }` (`body` = biểu thức `async ({ tc, data, sa }) => { … }`), import thêm cần dùng phải nằm trong danh sách helper đã cho (khung import sẵn tất cả). Kiểm tra: có chuỗi `runTestcase` → failed; `setRegion` + `node --check` cả file lỗi cú pháp → thử lại 1 lần với lỗi kèm theo, vẫn lỗi → failed; Target không có trong `L[screen]` và không phải chữ hiển thị → warning "Màn X: không tìm thấy 'Y' trong locator map".
  - Gen nhiều case: AI gọi song song 3 case, còn ghi vào file thì tuần tự (một hàng ghi cho mỗi file, tránh hai case ghi đè nhau); mỗi case xong emit `script` SSE.
  - `GET /api/scripts/:appId/:file` (cả file + vị trí từng region), `PUT` cùng đường dẫn (lưu cả file sửa tay → `node --check`; region nào đổi so với bản AI → case đó `reviewed` vẫn false nhưng ghi `editedByHand:true`), `POST /api/scripts/:caseId/reviewed`.
  - UI ScriptReview: một file cho cả Excel. Trái: danh sách case (trạng thái, cảnh báo), chọn case → editor nhảy tới region đó và hiện bước Excel của case bên cạnh. Phải: code cả file (CodeMirror 6, JS, sửa được). Nút Lưu / Đánh dấu case đã review / Gen lại case.

- [ ] **Step 1:** Test `scriptFile`: `writeScript` với 2 region → file `node --check` qua, region theo thứ tự Excel; `setRegion` thay đúng một region, region kia giữ nguyên từng ký tự; `readRegions(writeScript(...))` trả lại đúng nội dung; import file với `describe/it/planTest` giả và `RUN_CASES=TC_SPL_001` → chỉ một `it`, mọi case đều `planTest`.
- [ ] **Step 2:** Test `generateCase` với `runClaude` giả: body có `runTestcase` → `failed`; body làm file lỗi cú pháp 2 lần → `failed` với error có "SyntaxError" và file trên đĩa không đổi; target thiếu → `generated` + warning đúng câu; gen 3 case song song → file có đủ 3 region.
- [ ] **Step 3–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Thật: gen `TC_SPL_001`, `TC_WEL_001`, `TC_LOGIN_001` → một file `authentication-automation.e2e.js` có 3 region; đọc code — dùng `L`, `snapshot`, `sa.eq` đúng hợp đồng.

### Task 10: Run — cấu hình, chạy, theo dõi, lịch sử

**Files:** Create `server/runs/runner.js`, `server/routes/runs.js`, `web/src/pages/{RunConfig,RunView,Runs}.jsx` · Test `test/runner.test.js`

**Interfaces:**

- Consumes: `closure` (T8), `writeScript` (T9), lock, `listSimulators`.
- Produces:
  - Store `runs`: `{ id:'RUN-0001' tăng dần, appId, udid, deviceName, caseIds, status:'running'|'done'|'stopped'|'error'|'interrupted', counts:{passed,failed,blocked,skipped,notrun}, results:{ [tcId]: { status, duration, error?, bugs:n } }, reportsDir:'data/runs/<id>/reports', reportUrl, startedAt, finishedAt, log:[] }`.
  - `startRun({ appId, udid, caseIds }) → run`: lock; `closure` (missing → từ chối 400 kèm danh sách); file script của Excel phải tồn tại; spawn `npx wdio run wdio.conf.js` trong workspace với env app + `REPORTS_DIR`, `RUN_CASES`, `DEVICE_UDID`, `SPECS`, `REPORT_OPEN=0`; theo dõi `REPORTS_DIR/results/*.json` (định dạng `writeResult` của test-report: `status`, `case.id`, `bugs`) → cập nhật `results` + SSE `run`; stdout / stderr → `log` (giữ 2000 dòng cuối). Kết thúc: đọc `bug-report.html` → `reportUrl = /files/runs/<id>/reports/bug-report.html`, nhả lock. `POST /api/runs/:id/stop` → SIGINT, status `stopped`.
  - UI RunConfig (drawer giống canvas): simulator (đang boot lên đầu), số case sẽ chạy, case được thêm tự động ("Thêm 5 case phía trước để app ở đúng trạng thái"), case không chạy được + lý do + nút tới chỗ sửa, cảnh báo script; nút "Start run (n)". RunView: header trạng thái, thống kê + thanh tiến độ, bảng case (trạng thái, thời gian, số bug), log trực tiếp, xong thì nút "Mở report" (iframe toàn màn + mở tab mới). Runs: bảng lịch sử như `Runs.dc.html` của canvas.

- [ ] **Step 1:** Test với `spawnImpl` giả ghi lần lượt 3 file results (passed, failed có 2 bug, blocked) rồi exit 0 → `counts` đúng, `results.TC_x.bugs === 2`, status `done`, lock trống; startRun khi lock đang giữ → lỗi có `holder.label`; closure có missing → lỗi liệt kê case.
- [ ] **Step 2–3:** FAIL → implement → PASS.

### Task 11: Chạy nghiệm thu authentication + README

**Files:** Create `README.md`

- [ ] **Step 1:** Từ UI, trên máy thật: thêm app IK Fitness (helper pack ik-fitness) → Ghi lại khi tôi bấm các màn auth (Welcome, Log In, Create account, Account created, Sex) → import `authentication-automation.xlsx` → gen cả 38 case → mở review 1 case → Run cả 38.
  Expected: run kết thúc `done`, có ít nhất một Passed và kết quả Failed / Blocked thật nếu app lệch; `bug-report.html` mở được trong tool, bug có ảnh khoanh đỏ; bản copy xlsx trong workspace có cột Test Result được ghi.
- [ ] **Step 2:** Chạy thêm Tự khám phá trên cùng app → map bổ sung màn, không nhân bản màn đã có.
- [ ] **Step 3:** Ghi tỉ lệ gen lỗi / Blocked do script để đưa vào spec cho dev. Case lỗi do prompt → sửa `gen-case.md` và gen lại (tối đa 2 vòng), ghi lại những gì đã sửa.
- [ ] **Step 4:** Rà giao diện: chụp từng màn của tool (desktop 1440 và hẹp 1024), đặt cạnh màn tương ứng của canvas; sửa chỗ kém hơn canvas (khoảng cách, phân cấp chữ, trạng thái rỗng / lỗi / đang tải, contrast ≥ 4.5:1, focus bàn phím).
- [ ] **Step 5:** README: yêu cầu máy, `npm install`, `npm start`, luồng 5 bước có ảnh chụp, giới hạn đã biết.

### Task 12: Spec bàn giao cho dev

Sau khi Task 11 xong. Viết spec cho bản thật theo mục 9 của thiết kế: luồng + màn (link canvas), những gì demo đã chứng minh (số liệu từ Task 11), chỗ làm tạm, việc cho bản thật (nhiều người dùng, máy chạy chung + hàng đợi, Android, auth, API key thay `claude -p`, helper pack theo app), mô hình dữ liệu (App, Screen, Element, Case, Script, Run, Result — lấy từ store). Hỏi người dùng muốn spec ở dạng Claude Doc chia sẻ được hay file trong repo trước khi tạo.

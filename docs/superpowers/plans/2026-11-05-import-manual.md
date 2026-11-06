# Import test case manual → script — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ở trang Test Cases, người dùng chọn "File manual", import file manual của QA và tool tự lọc → chuyển thành file automation v2 → import → gen script, không cần chạy skill ngoài.

**Architecture:** Module `server/testcases/convert/` gồm các bước thuần (detect, ambiguity, classify, skeleton, rows, writeXlsx, locatorCheck) do một `createConverter` ghép lại; AI gọi qua `runClaude` hiện có (truyền vào được để test). `extract.mjs` / `write.mjs` của skill `select-automation-testcases` được copy vào `vendor/` và chạy như tiến trình con. Tiến độ đẩy qua SSE `manualImport`; giao diện thêm hộp thoại hai danh sách.

**Tech Stack:** Node 20+ ESM, Express 5, `node:test`, `exceljs`, React 18 + Vite (đã có).

**Spec:** [docs/superpowers/specs/2026-11-05-import-manual-design.md](../specs/2026-11-05-import-manual-design.md)

**Quy ước repo:** không commit trừ khi người dùng yêu cầu — mỗi task kết thúc bằng bước "Checkpoint" (chạy test), không có bước commit. Văn bản giao diện và thông báo lỗi bằng tiếng Việt. Test: `node --test test/<file>.test.js`; toàn bộ: `npm test`.

## Global Constraints

- Chọn case theo `extract.mjs`: High + Medium lấy hết, Low chỉ lấy Positive; không lọc lại bằng tay hay AI.
- Nhóm chạy tối đa **10 case**; gọi AI viết dòng Keyword chạy song song tối đa **3** nhóm.
- AI sửa plan khi `write.mjs` từ chối: tối đa **3** lần (đề xuất của spec).
- Chuyển đổi **không** lấy khóa thiết bị (`lock`); gen script cũng không dùng thiết bị.
- Không có đính kèm tài liệu nguồn (PRD/Q&A/Figma) trong đợt này.
- Q&A: chỉ ô ghi rõ "chưa chốt" / "TBD" / "pending" / "open" mới để manual; chỉ nhắc "Q&A #n" thì vẫn automate.
- Đầu vào mờ chỉ cảnh báo (đánh "giả định"), không chặn.
- Import lại không ghi đè âm thầm dòng Keyword đã sửa tay; case biến mất khỏi file manual chỉ được xoá kèm xác nhận.
- Bộ quy tắc chuyển đổi = nội dung `vendor/select-automation/SKILL.md` (đọc lúc chạy, không chép vào code).

## Review Focus

Các đầu vào spec ngụ ý nhưng không task nào kiểm hết; mỗi dòng có test ở task sở hữu code:
1. File chỉ có sheet RTM / không có cột `Test Case #` (như 12 file `*_testcase.xlsx` thật) → lỗi rõ, không import rỗng (Task 2).
2. AI trả JSON hỏng, plan thiếu một case được chọn, hoặc tham chiếu TC ID không có → chỉ nhóm/case đó báo lỗi, phần còn lại đi tiếp (Task 6, 7).
3. Import lại file manual không đổi → 0 lần gọi AI (Task 9).
4. Cùng TC ID xuất hiện ở hai sheet; tên file có ký tự đặc biệt / trùng stem với file automation đã import (Task 2, 9).
5. Chọn kiểu "automation" nhưng file là manual (và ngược lại) → báo lỗi chỉ cách chọn lại (Task 10).

---

### Task 1: Copy skill vào `vendor/`, hằng số đường dẫn, kiểm lệch bản

**Files:**
- Create: `vendor/select-automation/SKILL.md`, `vendor/select-automation/scripts/extract.mjs`, `vendor/select-automation/scripts/write.mjs` — copy nguyên từ `~/Downloads/testcase-v2-kit 2/testcase-v2-kit/.claude/skills/select-automation-testcases/` (bản 3/11)
- Create: `vendor/select-automation/VERSION` — một dòng: ngày sửa `SKILL.md` gốc (`2026-11-03`) và đường dẫn nguồn
- Modify: `server/paths.js` — thêm `SELECT_AUTOMATION_VENDOR`, `SELECT_AUTOMATION_SRC`
- Create: `scripts/sync-select-skill.js` — copy từ `SELECT_AUTOMATION_SRC` vào vendor (giống `sync-report.js`), dùng lại `sameTree`
- Modify: `scripts/doctor-checks.js`, `package.json` (script `sync-select-skill`) — doctor báo khi vendor lệch bản gốc (chỉ khi bản gốc có mặt)
- Test: `test/select-skill.test.js`

**Interfaces:**
- Produces: `SELECT_AUTOMATION_VENDOR: string` (`<ROOT>/vendor/select-automation`), `SELECT_AUTOMATION_SRC: string` (`process.env.QAPD_SELECT_SKILL || <ROOT>/../.claude/skills/select-automation-testcases`), cả hai export từ `server/paths.js`.

- [ ] **Step 1: Viết test** `test/select-skill.test.js`: (a) tồn tại 3 file vendor và `SKILL.md` chứa `Rules marked ✱`; (b) `node vendor/select-automation/scripts/extract.mjs <file không tồn tại>` thoát mã 1 với thông báo `Cần đường dẫn file xlsx`; (c) `checkSelectSkill()` từ doctor-checks trả `{ ok: true }` khi nguồn không có mặt và `{ ok: false, detail }` khi hai cây khác nhau (dùng `QAPD_SELECT_SKILL` trỏ vào thư mục tạm).
- [ ] **Step 2: Chạy, xác nhận fail** — `node --test test/select-skill.test.js` (thiếu vendor / thiếu `checkSelectSkill`).
- [ ] **Step 3: Copy 3 file + `VERSION`; thêm hằng số vào `paths.js`; viết `scripts/sync-select-skill.js` và `checkSelectSkill(): { ok: boolean, detail?: string }` trong `doctor-checks.js`** theo mẫu `sync-report.js` / check report hiện có; nối vào `scripts/doctor.js`.
- [ ] **Step 4: Chạy test pass**, rồi `npm run doctor -- --skip-ai` không báo lệch bản.
- [ ] **Checkpoint:** `npm test` xanh.

---

### Task 2: Nhận diện kiểu file và trích xuất case manual

**Files:**
- Create: `server/testcases/convert/detect.js`
- Create: `test/fixtures/manualWorkbook.js` — helper tạo file kit v2 mini bằng `exceljs`
- Test: `test/convert-detect.test.js`

**Interfaces:**
- Produces:
  - `type ManualCase = { id, module, type, platform, scenario, description, pre, steps, expected, priority, selected: boolean }` (đúng khóa của `extract.mjs`)
  - `detectKind(filePath: string): Promise<'manual' | 'automation' | 'unknown'>` — `manual` nếu có sheet (không phải RTM) với dòng chứa ô `Test Case #`; `automation` nếu có sheet `TestCases` với cột `Keyword`; còn lại `unknown`
  - `extractManual(filePath: string): Promise<{ source: string, sheets: Array<{ sheet: string, total: number, selected: number, cases: ManualCase[] }> }>` — chạy `node vendor/select-automation/scripts/extract.mjs <file> --out <tmp>.json` bằng `execFile`, đọc JSON; ném `Error` (status 400, message tiếng Việt) khi không có sheet nào hoặc 0 case
- `test/fixtures/manualWorkbook.js` export `makeManual(dir, { sheets: [{ name, cases: [{ id, priority, type, ... }] }], rtm?: boolean }): Promise<string>` (đường dẫn file).

- [ ] **Step 1: Viết test**: `makeManual` với 1 sheet 3 case (High, Low+Positive, Low+Negative) → `extractManual` trả `selected` lần lượt `true,true,false`; sheet tên `RTM` bị bỏ qua; file không có `Test Case #` → `detectKind` = `unknown` và `extractManual` ném lỗi chứa `Test Case #`; file automation mẫu (dùng `test/fixtures` có sẵn hoặc `samples/apidemos-automation.xlsx`) → `detectKind` = `automation`; cùng TC ID ở hai sheet → cả hai xuất hiện trong kết quả (test ghi lại hành vi, để Task 9 xử lý trùng).
- [ ] **Step 2: Chạy, xác nhận fail.**
- [ ] **Step 3: Implement** hai hàm; đọc header bằng `exceljs` giống `extract.mjs` (cùng cách lấy text ô richText); `extractManual` dùng `process.execPath`.
- [ ] **Step 4: Chạy test pass.**
- [ ] **Checkpoint:** `npm test` xanh.

---

### Task 3: Dò điểm mờ trong file manual

**Files:**
- Create: `server/testcases/convert/ambiguity.js`
- Test: `test/convert-ambiguity.test.js`

**Interfaces:**
- Consumes: `ManualCase` (Task 2)
- Produces: `findAmbiguity(c: ManualCase): Array<{ code: 'NO_QUOTED_EXPECTED' | 'EMPTY_PRE' | 'VAGUE_STEP', text: string }>`; `text` tiếng Việt nêu thiếu gì.

- [ ] **Step 1: Viết test** với các case: Expected `Hiển thị tiêu đề "What is your sex?"` → `[]`; Expected không có ngoặc kép (`Hiển thị màn giới tính`) → có `NO_QUOTED_EXPECTED`; `pre` rỗng → `EMPTY_PRE`; steps chứa `nhập email hợp lệ` → `VAGUE_STEP`; Expected chỉ có ngoặc kép đơn / ngoặc nhọn kiểu `“…”` vẫn tính là có chữ (không báo).
- [ ] **Step 2: Chạy, xác nhận fail.**
- [ ] **Step 3: Implement** `findAmbiguity` bằng regex; cụm vague: `hợp lệ`, `không hợp lệ`, `đúng`, `phù hợp`, `bất kỳ` (hằng số `VAGUE` ở đầu file để dễ sửa).
- [ ] **Step 4: Chạy test pass.**
- [ ] **Checkpoint:** `npm test` xanh.

---

### Task 4: Lọc case để manual (luật code trước, AI sau)

**Files:**
- Create: `server/testcases/convert/classify.js`
- Create: `server/ai/prompts/convert-filter.md`
- Test: `test/convert-classify.test.js`

**Interfaces:**
- Consumes: `ManualCase`; `runClaude` có chữ ký như `server/ai/claude.js`
- Produces:
  - `prefilter(c: ManualCase): { reason: string } | null` — luật từ khóa: Google/Apple login, IAP / mua hàng, tắt mạng trên iOS (Platform iOS), Settings hệ thống, màu / animation, dấu hiệu chưa chốt (`chưa chốt|TBD|pending|open`) — mỗi luật ghi `reason` theo danh mục lý do của skill
  - `classifyCases({ cases: ManualCase[], runClaude, signal?: AbortSignal }): Promise<Array<{ id: string, mode: 'automate' | 'manual', reason: string, by: 'rule' | 'ai' }>>` — chỉ case `selected` được xét; case khớp `prefilter` → `manual`/`rule`; case còn lại: nếu không có dấu hiệu mơ hồ thì `automate`/`rule`, nếu mơ hồ thì gom vào **một** lần `runClaude` (schema `{ decisions: [{ id, mode, reason }] }`, `noTools: true`) → `by: 'ai'`; AI lỗi hoặc thiếu id → mặc định `automate` kèm `reason: 'AI không trả lời, giữ automate'`

- [ ] **Step 1: Viết test** với `runClaude` giả đếm số lần gọi: case "Đăng nhập Google" → `manual`, 0 lần gọi AI; case thường → `automate`, 0 lần gọi; nhắc `Q&A #3` đơn thuần → `automate`; ô ghi `chưa chốt` → `manual`; 3 case mơ hồ → đúng **1** lần gọi và kết quả theo AI; AI trả thiếu 1 id → id đó `automate`; `runClaude` trả `{ ok: false }` → tất cả mơ hồ thành `automate`; case không `selected` không xuất hiện trong kết quả.
- [ ] **Step 2: Chạy, xác nhận fail.**
- [ ] **Step 3: Implement** `prefilter`/`classifyCases`; viết `convert-filter.md` (danh mục lý do để manual của skill, yêu cầu trả JSON theo schema, không giải thích thừa). Định nghĩa "mơ hồ" = không khớp luật nhưng Steps/Expected nhắc `popup|webview|trình duyệt|hệ thống|quảng cáo|thông báo|animation|biểu đồ` (hằng số trong file).
- [ ] **Step 4: Chạy test pass.**
- [ ] **Checkpoint:** `npm test` xanh.

---

### Task 5: Lập khung cho một sheet (thứ tự, fresh, nhóm, flows)

**Files:**
- Create: `server/testcases/convert/skeleton.js`
- Create: `server/ai/prompts/convert-skeleton.md`
- Test: `test/convert-skeleton.test.js`

**Interfaces:**
- Consumes: `ManualCase`, `runClaude`
- Produces:
  - `type Skeleton = { order: Array<{ id: string, fresh: boolean, platform?: string }>, groups: string[][], flows: Record<string, PlanRow[]> }`, với `PlanRow = { step: number, screen: string, kind: 'Action'|'Nav'|'Check', keyword: string, target?: string, value?: string, compare?: string, label?: string, platform?: string }` (đúng schema `plan.json` của SKILL.md)
  - `splitGroups(order: Skeleton['order'], groups: string[][], max = 10): string[][]` — chia lại mọi nhóm > `max`, loại id lạ, thêm id thiếu vào nhóm cuối; giữ nguyên thứ tự `order`
  - `buildSkeleton({ sheet: string, cases: ManualCase[], runClaude, signal? }): Promise<{ ok: true, skeleton: Skeleton } | { ok: false, error: string }>` — **một** lần gọi AI; đầu vào gọn (id, scenario, pre, màn nhắc tới); case đầu sheet luôn `fresh: true` (ép bằng code sau khi AI trả)

- [ ] **Step 1: Viết test**: `splitGroups` với 23 id → nhóm 10/10/3, đủ id, đúng thứ tự; id lạ bị loại; id thiếu được thêm; `buildSkeleton` với AI giả trả `order[0].fresh=false` → kết quả ép `true`; AI trả JSON thiếu `order` → `{ ok: false }`; prompt gửi đi **không chứa** `steps` / `expected` (kiểm bằng chuỗi) và chứa mọi id.
- [ ] **Step 2: Chạy, xác nhận fail.**
- [ ] **Step 3: Implement**; `convert-skeleton.md` nói rõ: quy tắc xếp nhóm, `fresh`, bước rủi ro đứng cuối nhóm hoặc chạy riêng, `flows` một hop một flow, trích từ phần "Order the TCs into runs" của `vendor/select-automation/SKILL.md` — đọc file lúc chạy (hàm `rulesFrom(sectionTitle: string): string` dùng chung, đặt trong `server/testcases/convert/rules.js`, test bằng một đoạn tiêu đề có thật).
- [ ] **Step 4: Chạy test pass.**
- [ ] **Checkpoint:** `npm test` xanh.

---

### Task 6: Viết dòng Keyword theo nhóm và ghép plan

**Files:**
- Create: `server/testcases/convert/rows.js`
- Create: `server/ai/prompts/convert-rows.md`
- Test: `test/convert-rows.test.js`

**Interfaces:**
- Consumes: `Skeleton`, `PlanRow` (Task 5), `rulesFrom` (Task 5), `ManualCase`
- Produces:
  - `type PlanTc = { id: string, fresh: boolean, pre: string[], rows: PlanRow[], platform?: string }`
  - `writeGroup({ skeleton, group: string[], cases: ManualCase[], runClaude, signal?, feedback?: string }): Promise<{ ok: true, testcases: PlanTc[] } | { ok: false, error: string }>` — một lần gọi AI cho nhóm; `feedback` là lỗi của `write.mjs` ở lần trước (Task 7) nối vào tin nhắn; kết quả thiếu một id của nhóm → `{ ok: false, error: 'Thiếu TC_x' }`; id lạ bị bỏ
  - `mergePlan({ skeleton, groupResults: PlanTc[][], manual: Array<{ tc: string, reason: string }> }): { testcases: PlanTc[], flows: Skeleton['flows'], testdata: [], manual: Array<{ tc: string, reason: string }> }` — xếp `testcases` theo `skeleton.order`, ép `fresh` từ khung
- Cả `convert-rows.md` lẫn system prompt nạp phần "Write each TC as v2 rows" + "Reference" của `SKILL.md` qua `rulesFrom` (cố định giữa các nhóm để cache); phần theo nhóm (các case) đặt ở tin nhắn.

- [ ] **Step 1: Viết test** với `runClaude` giả: `writeGroup` ok với 3 id; thiếu 1 id → `{ ok:false }` chứa id đó; AI trả id lạ → bị loại; `feedback` có mặt trong prompt; hai lần gọi cho hai nhóm có **cùng** `system` (cache); `mergePlan` giữ đúng thứ tự khung và ghi đè `fresh`; `manual` đi qua nguyên vẹn.
- [ ] **Step 2: Chạy, xác nhận fail.**
- [ ] **Step 3: Implement** `writeGroup`, `mergePlan`; schema JSON của `runClaude` mô tả `{ testcases: [{ id, fresh, pre, rows }] }`.
- [ ] **Step 4: Chạy test pass.**
- [ ] **Checkpoint:** `npm test` xanh.

---

### Task 7: Cầu nối `write.mjs` và vòng sửa tối đa 3 lần cho một sheet

**Files:**
- Create: `server/testcases/convert/writeXlsx.js`
- Test: `test/convert-write.test.js`

**Interfaces:**
- Consumes: `PlanTc`, `mergePlan`, `writeGroup`, `buildSkeleton`, `ManualCase`
- Produces:
  - `writePlan({ plan, sheet: { sheet: string, cases: ManualCase[] }, outDir: string }): Promise<{ ok: boolean, files: string[], problems: string[], review: string[] }>` — ghi `plan.json` + `cases.json` (chỉ sheet này; case user chuyển manual→automate được đặt `selected: true`) vào thư mục tạm, chạy `node vendor/select-automation/scripts/write.mjs plan cases outDir`; `files` lấy từ các dòng sau `Đã ghi:`; `problems` lấy từ các dòng sau `LỖI (n):` (exit 1); `review` lấy từ các dòng sau `Cần review`
  - `convertSheet({ sheet, decisions, runClaude, outDir, maxFix = 3, concurrency = 3, signal?, onProgress?: (p: { done: number, total: number, label: string }) => void, cache?: Record<string, PlanTc> }): Promise<{ ok: boolean, files: string[], plans: Record<string, PlanTc>, problems: string[], review: string[] }>` — chạy `buildSkeleton` → `splitGroups` → `writeGroup` song song tối đa `concurrency` (nhóm mà mọi id đã có trong `cache` và khung không đổi thì dùng lại, không gọi AI) → `mergePlan` → `writePlan`; nếu `writePlan` lỗi: lập `feedback` từ `problems`, chỉ viết lại các nhóm chứa case bị nhắc, thử lại tối đa `maxFix` lần; hết lần mà vẫn lỗi → `{ ok: false, problems }` và `plans` vẫn trả để lưu

- [ ] **Step 1: Viết test**: với một `plan` hợp lệ tối thiểu (1 TC `fresh`, `Nav` + `Verify text`) `writePlan` ra file `.xlsx` thật và `ok: true` (chạy `write.mjs` thật trong test); plan thiếu `label` ở Check → `ok:false`, `problems` không rỗng; `convertSheet` với AI giả lần 1 trả plan sai, lần 2 trả đúng → `ok: true` và đúng **2** lần gọi `writeGroup`; AI luôn sai → `ok:false` sau đúng `maxFix` lần sửa (đếm gọi); nhóm có cache → 0 lần gọi AI cho nhóm đó; 25 case → AI được gọi đồng thời tối đa 3 (đếm đồng thời trong `runClaude` giả).
- [ ] **Step 2: Chạy, xác nhận fail.**
- [ ] **Step 3: Implement**; dùng pool giới hạn đồng thời tự viết gọn (không thêm dependency); thư mục tạm bằng `fs.mkdtempSync`.
- [ ] **Step 4: Chạy test pass.**
- [ ] **Checkpoint:** `npm test` xanh.

---

### Task 8: Đối chiếu Target với Locator map và gom danh sách review

**Files:**
- Create: `server/testcases/convert/review.js`
- Test: `test/convert-review.test.js`

**Interfaces:**
- Consumes: `PlanTc`/`PlanRow`; `map.locatorTable(appId)` trả `{ [screen]: Array<{ key, name?, label?, locator }> }` (xem `server/locators/screenMap.js:217`)
- Produces:
  - `checkTargets(plans: PlanTc[], table: ReturnType<typeof locatorTableType>): string[]` — mỗi cảnh báo dạng `<TC> step <n>: "<Target>" chưa có trong Locator map màn <screen>`; bỏ qua keyword không có Target và `Run flow`; map rỗng (app chưa lấy locator) → `[]`
  - `buildReview({ writeReview: string[], targets: string[], ambiguity: Record<string, Array<{ code: string, text: string }>> }): string[]` — gộp, bỏ trùng, nhóm theo nguồn (`write.mjs` / Locator map / điểm mờ trong manual)

- [ ] **Step 1: Viết test**: bảng có `Welcome → Get Started`; plan Tap `Get Started` trên `Welcome` → `[]`; Tap `Continue` trên `Welcome` → 1 cảnh báo; bảng `{}` → `[]`; so khớp không phân biệt hoa thường và khoảng trắng thừa; `buildReview` bỏ trùng.
- [ ] **Step 2: Chạy, xác nhận fail.** **Step 3: Implement.** **Step 4: Chạy test pass.**
- [ ] **Checkpoint:** `npm test` xanh.

---

### Task 9: Converter — trạng thái, lựa chọn, import lại, import + gen

**Files:**
- Create: `server/testcases/convert/converter.js`
- Test: `test/convert-converter.test.js`

**Interfaces:**
- Consumes: mọi hàm Task 2–8; `importTestcases` (`server/testcases/importXlsx.js`), `generator.generate(appId, ids)`, `fileStem`
- Produces:
  - Collection `manualImports` — `ManualImport = { id: '<appId>:<stem>', appId, stem, fileName, status: 'analyzing'|'ready'|'converting'|'done'|'error', error?, sheets: Array<{ sheet, total, selected }>, cases: Array<{ id, sheet, title, hash, mode, reason, by: 'rule'|'ai'|'user', ambiguity, state: 'pending'|'converted'|'error'|'conflict', error?, plan?: PlanTc, outHash?: string }>, removed: string[], review: string[], problems: string[], progress: { done, total, label } }`
  - Collection `manualChoices` — `{ id: '<appId>:<sheet>:<tcId>', mode: 'automate'|'manual' }` (có `sheet` vì cùng TC ID có thể nằm ở hai sheet)
  - `createConverter({ store, map, emit, generator, importer = importTestcases, runClaude, dataDir }): { analyze, choose, convert, resolveConflict, get, list }`
    - `analyze({ appId, srcPath, fileName }): Promise<ManualImport>` — ném lỗi status 400 nếu `detectKind` ≠ `manual`; phần chạy nền (classify) cập nhật và `emit('manualImport', mi)`; copy file gốc vào `<workspace>/data/manual/<stem>.xlsx`
    - `choose(importId, { sheet, tcId, mode }): ManualImport` — lưu `manualChoices` (`by: 'user'`), đánh `pending` các case/sheet bị ảnh hưởng
    - `convert(importId): Promise<void>` — mỗi sheet có case `pending` chạy `convertSheet`; ghi `plan` từng case để làm cache; import mọi file bằng `importer` (`into` = stem sẵn có nếu đã import, ngược lại `'*new'`); sau import, các case của file có `script.status` ∈ {`none`,`stale`} được `generator.generate` (app phải `ready`, ngược lại bỏ qua gen và ghi cảnh báo); lưu `outHash` = `rowsHash` của case sau import
    - `resolveConflict(importId, { sheet, tcId }, action: 'keep' | 'reconvert'): ManualImport`
- **Quy tắc import lại:** cùng `id`; case `hash` không đổi giữ nguyên `mode/by/plan/state`; `hash` đổi → `pending`, và nếu `store.get('cases', …).rowsHash !== outHash` (đã bị sửa tay) → `state: 'conflict'`, không chuyển đến khi `resolveConflict`; case không còn trong file → vào `removed` (không xoá); lựa chọn trong `manualChoices` thắng kết quả phân loại. `hash` = sha1 của `[scenario, description, pre, steps, expected]`.

- [ ] **Step 1: Viết test** (store thật trong thư mục tạm, `runClaude`/`importer`/`generator` giả):
  - analyze file có 3 case thường + 1 "Đăng nhập Google" → `mode` đúng; file `unknown` → lỗi 400;
  - `choose` đổi 1 case manual→automate, gọi `analyze` lại cùng file → lựa chọn còn nguyên, **0 lần** gọi `runClaude`;
  - `convert` lần 1 gọi AI; lần 2 (không đổi gì) → **0 lần** gọi AI, `importer` **không** được gọi (không có case `pending`), `status: 'done'`;
  - đổi nội dung 1 case → chỉ nhóm chứa nó được viết lại; đồng thời `store` có case với `rowsHash` khác `outHash` → `state: 'conflict'`, `convert` bỏ qua nó cho tới `resolveConflict(… 'reconvert')`;
  - case biến mất khỏi file mới → có trong `removed`, `store.get('cases', …)` vẫn còn;
  - cùng TC ID ở hai sheet → hai phần tử `cases` riêng (phân biệt bằng `sheet`), `choose` / `resolveConflict` chỉ tác động đúng sheet được truyền;
  - `convertSheet` trả `ok:false` → case `state: 'error'` kèm lỗi, các sheet khác vẫn `converted`;
  - tên file `Báo cáo (2).xlsx` → `stem` hợp lệ (`fileStem`), không ghi ra ngoài `data/manual`;
  - gen chỉ gọi cho case `none/stale`; app chưa `ready` → không gọi gen và có cảnh báo trong `review`.
- [ ] **Step 2: Chạy, xác nhận fail.**
- [ ] **Step 3: Implement** `createConverter`; dùng `store.put/get/list`; đẩy `emit('manualImport', mi)` mỗi lần đổi trạng thái; tiến độ từ `onProgress` của `convertSheet`; một import đang `converting` thì `convert` thứ hai trả lỗi 409.
- [ ] **Step 4: Chạy test pass.**
- [ ] **Checkpoint:** `npm test` xanh.

---

### Task 10: Route, kiểm tra kiểu file, nối ctx

**Files:**
- Create: `server/routes/manual.js`
- Modify: `server/routes/index.js` (thêm vào `ROUTERS`), `server/index.js` (tạo `converter`, thêm vào `ctx`), `server/routes/testcases.js` (từ chối file manual ở route cũ)
- Test: `test/convert-routes.test.js` (theo mẫu `test/manual-fix-server.test.js` / `test/delete.test.js` để dựng app thử)

**Interfaces:**
- Consumes: `createConverter` (Task 9), `detectKind` (Task 2)
- Produces (JSON, lỗi `{ error }`):
  - `POST /api/apps/:appId/manual/analyze` — multipart `file`; 202 `{ id }`; 400 khi không phải manual: `File này không phải test case manual (không có cột "Test Case #"). Nếu đây là file automation, chọn Import → File automation.`
  - `GET /api/apps/:appId/manual` → `ManualImport[]`; `GET /api/manual/:id` → `ManualImport`
  - `PUT /api/manual/:id/choices` body `{ sheet, tcId, mode }`; `POST /api/manual/:id/convert` → 202; `POST /api/manual/:id/conflicts` body `{ sheet, tcId, action }`
  - Route cũ `POST /api/apps/:appId/testcases`: nếu `detectKind(req.file.path) === 'manual'` → 400 `File này là test case manual. Chọn Import → File manual.`

- [ ] **Step 1: Viết test**: analyze file automation → 400 với đúng thông điệp; file manual → 202 rồi `GET` thấy `status` `ready`; route cũ với file manual → 400; `PUT choices` với `mode` lạ → 400; `convert` khi đang `converting` → 409.
- [ ] **Step 2: Chạy, xác nhận fail.** **Step 3: Implement** (bọc `wrap` như `routes/scripts.js`). **Step 4: Chạy test pass.**
- [ ] **Checkpoint:** `npm test` xanh.

---

### Task 11: Giao diện — chọn kiểu file, hai danh sách, review

**Files:**
- Create: `web/src/manualSelection.js` (hàm thuần), `web/src/components/ManualImport.jsx`
- Modify: `web/src/pages/TestCases.jsx` (nút Import có chọn kiểu file), `web/src/styles/app.css` (chỉ khi cần)
- Test: `test/manual-selection.test.js` (cho phần hàm thuần)

**Interfaces:**
- Consumes: API Task 10 (`PUT choices` và `POST conflicts` body có thêm `sheet`); sự kiện SSE `manualImport` qua `useEvents('manualImport', handler)`
- Produces: `splitByMode(cases: ManualImport['cases']): { automate: Case[], manual: Case[] }`; `moveCase(cases, tcId, mode): Case[]` (không đổi mảng gốc); `summary(mi): { automate: number, manual: number, ambiguous: number, review: number, conflicts: number }`

- [ ] **Step 1: Viết test** cho 3 hàm thuần (chuyển case, đếm, không đổi mảng gốc).
- [ ] **Step 2: Chạy, xác nhận fail.** **Step 3: Implement** hàm thuần.
- [ ] **Step 4: `ManualImport.jsx`**: một hộp thoại theo trạng thái `analyzing` (tiến độ) → `ready` (hai danh sách, mỗi dòng case manual hiện lý do, mỗi dòng case có điểm mờ hiện cảnh báo; nút chuyển qua lại gọi `PUT choices`; nút **Chuyển đổi** gọi `POST convert`) → `converting` (thanh tiến độ từ `progress`) → `done` (tóm tắt số case, danh sách review, danh sách xung đột với nút Giữ bản sửa tay / Chuyển lại, danh sách case biến mất kèm nút mở xác nhận xoá dùng luồng `remove-plan`/`remove` có sẵn). Nút "Mở lại danh sách" hiện ở trang Test Cases cho mọi import manual đã có.
- [ ] **Step 5: `TestCases.jsx`**: nút Import đổi thành nhóm hai lựa chọn **File manual** / **File automation** (mặc định automation để không đổi hành vi cũ); chọn manual → `POST /apps/:id/manual/analyze` rồi mở `ManualImport`.
- [ ] **Step 6: Kiểm tra** `npm run build` không lỗi; mở `npm run dev`, import `~/Downloads/onboarding-v1-0-4.xlsx` vào một app thử: hai danh sách hiện (93 case được chọn), chuyển một case, bấm Chuyển đổi, file `…-automation.xlsx` xuất hiện trong danh sách file của trang và case hiện "Cần gen"/đang gen. Ghi lại kết quả quan sát (không có test tự động cho phần hiển thị).
- [ ] **Checkpoint:** `npm test` xanh.

---

### Task 12: Thêm `Wait until enabled` vào bảng keyword

**Files:**
- Modify: `server/ai/prompts/k-table-v2.md`
- Test: `test/generate.test.js` (thêm một test) — hoặc file test hiện có đọc `k-table-v2.md`

**Interfaces:** Produces: dòng `Wait until enabled` trong bảng k; hàm tương ứng đã có trong `server/apps/template/src/runner/steps.js` (đọc tên hàm đúng ở đó để ghi lời gọi).

- [ ] **Step 1: Viết test** kiểm `k-table-v2.md` chứa `Wait until enabled`.
- [ ] **Step 2: Chạy, xác nhận fail.** **Step 3: Thêm dòng** cùng định dạng với dòng `Wait until displayed` / `not displayed`, gọi đúng hàm trong `steps.js`. **Step 4: Chạy test pass.**
- [ ] **Checkpoint:** `npm test` xanh.

---

## Tự kiểm

- **Bao phủ spec:** đầu vào + kiểm kiểu file (Task 2, 10); trích xuất (2); dò điểm mờ (3); lọc code-trước/AI (4); lập khung + nhóm ≤10 (5); viết dòng + song song 3 (6, 7); `write.mjs` + sửa ≤3 lần (7); đối chiếu Locator map + danh sách review (8); lưu lựa chọn, import lại theo hash, xung đột, case biến mất, gen tự động không khóa thiết bị (9); route + giao diện + mở lại danh sách (10, 11); vendor + kiểm lệch bản (1); `Wait until enabled` (12).
- **Nhất quán kiểu:** `ManualCase` (T2) dùng ở T3–T9; `Skeleton`/`PlanRow` (T5) dùng ở T6–T7; `PlanTc` (T6) dùng ở T7–T9; `rulesFrom` định nghĩa ở T5, dùng ở T6; `convertSheet` (T7) dùng ở T9; `ManualImport` (T9) dùng ở T10–T11.
- **Việc để người làm quyết định** (theo spec): danh sách từ khóa lọc, cụm mơ hồ, mô hình AI cho lọc / chuyển đổi và timeout, bố cục giao diện chi tiết.

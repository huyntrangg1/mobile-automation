# Report rules (agreed with QA). Change these only on request.

## Test case status (`statusOf` in hooks.js)

| Status  | When                                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Passed  | test passed                                                                                                                                                                     |
| Failed  | AssertionError (a soft or hard check differed) → creates bugs                                                                                                                  |
| Blocked | any other error. Environment errors (session, Appium/WDA, ECONN, missing env/data sheet; regex `ENV_ERROR`) → no bug. Otherwise a blocking defect → 1 bug, classified as in "Priority / Severity" |
| Skipped | `it.skip` / `describe.skip` (written by SkipReporter)                                                                                                                       |
| Not Run | registered with `planTest` but not executed this run                                                                                                                          |

Pass rate = Passed / (Passed + Failed + Blocked).

## Priority / Severity (`classify.js`)

### Definitions

| Priority  | Mức độ      | Rule phân loại | Tiêu chí đánh giá |
| --------- | ----------- | -------------- | ----------------- |
| Very High | Khẩn cấp    | Lỗi cần xử lý ngay vì chặn release, ảnh hưởng nghiêm trọng đến người dùng hoặc làm mất tính khả dụng của chức năng cốt lõi. | Không có workaround phù hợp; ảnh hưởng lớn đến release hoặc nghiệp vụ quan trọng. |
| High      | Cao         | Lỗi ảnh hưởng đáng kể đến chức năng chính, luồng người dùng quan trọng hoặc có khả năng tác động đến nhiều người dùng. | Cần sửa trong release hiện tại hoặc trước khi phát hành chức năng liên quan. |
| Normal    | Bình thường | Lỗi có ảnh hưởng nhưng người dùng vẫn có thể tiếp tục sử dụng sản phẩm; chưa tạo ra rủi ro cần xử lý khẩn cấp. | Có workaround hoặc ảnh hưởng giới hạn; không trực tiếp chặn release. |
| Low       | Thấp        | Lỗi ít ảnh hưởng, chủ yếu liên quan đến UI, nội dung hoặc trường hợp hiếm gặp. | Tác động thấp đến nghiệp vụ và trải nghiệm; có thể trì hoãn nếu cần. |

| Severity | Mức độ            | Rule phân loại |
| -------- | ----------------- | -------------- |
| Critical | Nghiêm trọng nhất | Lỗi khiến ứng dụng hoặc chức năng cốt lõi không thể sử dụng; có nguy cơ mất dữ liệu nghiêm trọng, ảnh hưởng diện rộng hoặc chặn hoàn toàn luồng chính. |
| Major    | Nghiêm trọng      | Chức năng chính không hoạt động đúng hoặc luồng nghiệp vụ quan trọng bị gián đoạn. |
| Minor    | Trung bình/nhẹ    | Lỗi ảnh hưởng đến một phần chức năng nhưng không chặn luồng chính; người dùng vẫn có thể tiếp tục sử dụng. |
| Trivial  | Rất nhẹ           | Lỗi hình thức hoặc sai lệch nhỏ, hầu như không ảnh hưởng đến chức năng và trải nghiệm cốt lõi. |

### Rules

1. Severity đánh giá mức độ ảnh hưởng của lỗi đến chức năng, dữ liệu và khả năng hoàn thành luồng nghiệp vụ.
2. Priority đánh giá mức độ khẩn cấp cần xử lý, dựa trên rủi ro release, ảnh hưởng người dùng, business impact và deadline.
3. Không mặc định suy ra Priority từ Severity. Bug Critical thường cần Priority cao, nhưng mức Priority cuối cùng phụ thuộc bối cảnh thực tế.
4. Lỗi UI không mặc định là Minor/Trivial; nếu chặn thao tác quan trọng, cần đánh giá theo tác động thực tế.
5. Lỗi có workaround vẫn có thể là Major nếu workaround bất tiện đáng kể hoặc ảnh hưởng nghiệp vụ quan trọng.
6. Chỉ phân loại dựa trên bằng chứng. Nếu thiếu thông tin về phạm vi ảnh hưởng hoặc khả năng workaround, cần ghi rõ điểm chưa xác minh thay vì tự suy đoán.
7. Mỗi bug cần có một Severity, một Priority và lý do phân loại ngắn gọn.

### How the report applies them

**Severity** (`classify`), from the failed check and run evidence only. "Main flow" = the test case has Priority High.

| Evidence | Type | Severity |
| -------- | ---- | -------- |
| Test stopped mid-flow (blocked) | Function | Critical on a main flow, else Major; workaround unverified |
| Failed without a check (plain assert) | Function | Major |
| Error message missing (`Invalid…`, `…must…`, `…does not match`…) | Function | Major — validation does not work (rule 4) |
| Element missing that some test case taps (link / button) | Function | Critical on a main flow, else Major; other route unverified (rule 4) |
| App not on the expected screen after an action (failed "đúng màn" check: label Tiêu đề / Tới / Sang / Mở lại…, or the check right after a Nav) | Function | Major — wrong flow |
| A whole sheet / screen / popup / dialog the flow must show is missing (check label names it) | Function | Major |
| Other element missing / still shown when it should hide | UI | Minor; whether it blocks an action is unverified |
| Button enabled with invalid data (`Verify disabled`) | Function | Major |
| Button disabled with valid data (`Verify enabled`) | Function | Critical on a main flow, else Major; workaround unverified |
| Password shown instead of masked | Function | Major (sensitive data) |
| Selection state wrong | Function | Major |
| Wrong number / content vs data or formula | Function | Major |
| Same value, different format; empty value | UI | Minor |
| Text or unit differs only in wording (cal vs kcal) | UI | Trivial |
| Screen differs from Figma (`Verify design <group>`, written by the QA Pipeline design check) | UI | From the measured gap: missing text / icon / image, wrong text, a gap > 3× tolerance, colour ΔE > 25, size > 20 %, font > 25 % → Minor; smaller gaps → Trivial |

**Priority** (`prioritize`), after dedupe, from Severity × Priority of the test case, then scope:

| Severity \ TC Priority | High | Medium | Low |
| ---------------------- | ---- | ------ | --- |
| Critical | Very High | High | High |
| Major | High | High | Normal |
| Minor | Normal | Normal | Low |
| Trivial | Low | Low | Low |

- One level up (not for Trivial) when the error shows on ≥ 2 screens, or a blocking bug stops later test cases ("TC trước bị chặn").
- The same error on several test cases that only differ by data is not wider scope; the count is only noted in the reason.
- No TC Priority → treated as Medium and listed as unverified.
- Merged bugs keep the highest Severity (with its reason) and the highest TC Priority.

**Shown on each bug:** Severity + reason, Priority + reason (e.g. `Severity Major · TC High · gặp ở 3 TC`), and "Chưa xác minh" when something could not be checked. "Copy bug" includes the same lines.

## Dedupe (`mergeChecks`, `dedupe` in html.js)

Inside one test (`mergeChecks`) — one real bug = one card, the way a tester logs it:

- **Wrong screen:** a failed "đúng màn" check (see Severity table) absorbs every other failed check made after the **same user action** — they are consequences (kill app → reopens on Welcome: title missing + "Get Started" still shown = 1 bug).
- **Screen differs from the test case in several content points:** failed content checks (`Verify text / displayed / selected / value / placeholder / count / order / attribute`) of **at least two kinds**, on the same screen, after the same user action → 1 bug titled `Màn S khác test case ở N điểm <khi …>` (e.g. a Paywall not built to the design yet). Actual lists each point once, without its own `khi …`.
- **Same kind of check on the same screen:** several failed checks with the same keyword on one screen → 1 bug (2 options both stay selected; 2 options both show the wrong number of logos).
- Never put into the content group: an extra element (`Verify not displayed`), layout (`Verify layout`), enabled / disabled. So CTA copy wrong and an extra Back button on the same screen = 2 bugs.
- Merged bug: title from the first check, Actual / Expected join every check's sentence, Steps = the longest, one screenshot per check, highest Severity. Each failed check row in the test links to the merged bug.

- **Blocked test with failed checks on the screen where it stopped** (`tellStory`): the failed checks and the blocking error are one bug, told in order — `Sau khi nhấn "Continue": màn Tutorial Website hiển thị "Smart social media imports" thay vì "One-tap blog imports". … Sau khi nhấn "Tap here": màn không hiển thị "Step 2 of 4"; app hiển thị màn "Recipe imported successfully!"…`. Title = the first wrong point. Failed checks on other screens stay separate bugs. The "⛔ Dừng" row of the test links to this bug.
- Text check whose target is the expected text itself (a title, a line of copy): `Màn S hiển thị "a" thay vì "e"`.

Across tests:

0. "Màn S khác test case" bugs of the same screen from several tests → one bug; points joined without repeats, title counts the distinct points, one screenshot per test.
1. Same screen + same check label across tests or data sets → **one representative bug** (first occurrence). The report does not show the occurrence count and does not list the runs.
2. Same label + same actual + same expected on **several screens** → one bug. **Affected Area** = those screens, with one screenshot per screen.
3. **Same missing element** → one bug: a check "X must be shown" that fails and a test blocked because X could not be found to act on (e.g. `Không thấy "Already a member? Log In"`). The bug from the check is the representative (it has the screen and clear steps); the blocked tests are added to its test list and their blocking counts toward Priority.

Bug IDs (BUG-001…) are sequential within a report.

## Bug fields

Two writers, same fields (Title, Precondition, Steps to Reproduce, Actual, Expected):
- **AI (preferred).** Report opened through QA Pipeline (`/files/data/runs/<RUN>/…`): the Log Asana form sends each picked bug — the template draft plus its raw `facts` — to `POST /api/bug-text`. The tool gives Claude the section "Cách viết bug" below and fills the form; the tester reviews before creating.
- **Templates (fallback).** Report opened as a file, or the AI call failed: the wording `phrasing.js` builds (shown in the report itself). It follows the same rules as far as fixed sentences can; it is not the target style.

Data rules (both writers):
- **Màn**: screen name from the test case (Screen column, `case.rows`), else the screen the script logged. Flow bugs: the screen the user was on when the step failed, never the screen that did not open.
- **Feature**: `case.feature`, else the first word of the suite.
- **Affected Area**: only when the same error shows on more than one screen.
- **`facts`** (`buildBugs` in html.js): TC id / title / feature, screen, failed checks with raw actual / expected, blocking error, test case Expected, and `seen` (screen summary: title, main text, buttons). A failed check reads its own `seen` the moment it fails (`addBug` in collector.js reads the page source without waiting; `screenSummary` waits for it), because a soft-assert test runs on and the screen at the end is another one. `kind` = `bottom sheet` / `popup` when every named element sits below 15% of the screen height (the dimmed screen behind is not in the page source) or an alert is shown. Template text: a check whose element is missing gets Actual `Màn đang hiện "T" bottom sheet (nút "A", "B").` (the missing element is already in the Title).
- **Attachment**: screenshot with the failing element boxed in red; element missing → dashed box under the anchor passed to `snapshot`; flow bugs → screenshot at failure, no box.
- **Priority / Severity / Loại**: from the impact table above, set as fields (Asana custom field Priority), never written in the content.

### Cách viết bug

Bạn viết bug cho dev đọc. Dev chưa từng thấy test case hay script. Viết tiếng Việt, câu ngắn, rõ, giọng tester chuyên nghiệp. Giữ nguyên tiếng Anh cho chữ trên app, tên màn, thuật ngữ test (Precondition, Steps…).

#### Dữ liệu bạn nhận
Mỗi bug có:
- `draft`: bản nháp do máy ghép theo mẫu câu (Title, Precondition, Steps, Actual, Expected). Dùng làm nguồn dữ kiện, **không** chép lại cách hành văn của nó.
- `facts`: dữ kiện gốc
  - `tc`: TC ID, tiêu đề TC (cho biết mục đích kiểm), feature.
  - `screen`: màn xảy ra lỗi (theo test case).
  - `checks`: các điểm kiểm bị lệch: `label` (tester đặt), `keyword` (Verify text / displayed / not displayed / enabled / selected…), `target` (phần tử), `actual` (app thực tế: `null` = không tìm thấy phần tử, `true/false` = có / không), `expected`.
  - `error`: lỗi chặn luồng (nếu test bị Blocked).
  - `seen`: màn app đang hiện đúng lúc lỗi: `title` (chữ đầu màn), `text`, `buttons`, `kind` (`bottom sheet` / `popup` đang che màn, `null` = màn thường). Dùng để nói **cái gì hiện ra thay vào**. `seen` = `null` nghĩa là không biết màn lúc đó — khi ấy **không** nói gì về phần tử khác đang hiện trên màn.
  - `tcExpected`: dòng Expected Result trong test case.

Chỉ viết điều có trong dữ liệu. Không bịa giá trị, không đoán nguyên nhân.

#### Từng field

##### Title
**Mục đích:** dev đọc riêng Title cũng hiểu lỗi gì, ở đâu.
- Dạng: `[BUG][<Khu vực>] <Hiện tượng sai>`, thêm `khi <điều kiện>` nếu điều kiện đó **gây ra** lỗi.
- **Khu vực:** tên màn nếu lỗi nằm trong nội dung một màn (thiếu / sai chữ, nút, trạng thái trên màn đó). Tên feature (vd `Onboarding`, `Paywall`) nếu lỗi về luồng: chuyển sai màn, mở lại không đúng chỗ, trạng thái không giữ qua nhiều màn. Feature lấy từ `facts.tc.feature` dạng dễ đọc (`onboarding-v1-0-4-automation` → `Onboarding`).
- **Hiện tượng:** điều người dùng thấy sai, bằng lời người dùng. Gọi đúng loại phần tử: nút, link, text, màn, popup, sheet. Lỗi luồng thì viết theo mục đích của TC (tiêu đề TC "Verify kill app … thì mở lại đúng màn đang dở" → "Không mở lại đúng màn đang dở khi kill app giữa luồng").
- Không lặp điều kiện ban đầu ("khi mở app (bản cài mới)", "khi vừa vào màn X") — đã có ở Precondition.
- Không dùng label điểm kiểm, keyword của script, mã điểm kiểm (D12, Q&A #3…).
- Không dùng "vẫn", "không còn" (ngụ ý trước đây đúng) trừ khi dữ liệu cho thấy là lỗi hồi quy.
- Ngắn, khoảng 15 từ.

Đúng: `[BUG][Welcome] Tồn tại link "Already have an account? Log in"`
Sai: `[BUG][Welcome] "Already have an account? Log in" vẫn hiển thị khi mở app (bản cài mới)`

Đúng: `[BUG][Onboarding] Không mở lại đúng màn onboarding đang dở khi kill app giữa luồng`
Sai: `[BUG][Encouragement] Không hiển thị "You're in the right place" khi tắt hẳn app rồi mở lại`

##### Precondition
**Mục đích:** trạng thái trước khi bắt đầu.
- Mỗi dòng 1 ý: cài mới / đã cài, tài khoản, dữ liệu cần có, màn bắt đầu.
- Dòng cuối: dòng thiết bị trong `draft` (giữ nguyên).
- Không chứa thao tác — thao tác thuộc Steps.

##### Steps to Reproduce
**Mục đích:** dev làm theo là gặp lỗi.
- Mỗi dòng 1 hành động, bắt đầu bằng động từ, đúng thứ tự trong `draft`. Không thêm, không bỏ thao tác.
- Thao tác gây lỗi ghi kèm màn đang đứng: `Ở màn Encouragement, tắt hẳn app rồi mở lại`.
- Bước cuối nói rõ quan sát gì: `Quan sát màn hiện tại` (lỗi luồng / sai màn) hoặc `Quan sát nút "X"` (lỗi trên màn).
- Không đánh số (hệ thống tự đánh).

##### Actual Result
**Mục đích:** mô tả đúng điều đã thấy.
- 1–2 câu. Nếu biết (từ `seen`) thì nêu cái hiện ra thay vào: màn khác, chữ khác.
- Nhiều điểm kiểm cùng một triệu chứng → **một** ý. Vd: "chữ tiêu đề màn A không có" + "nút của màn Welcome vẫn có" = app đang ở màn Welcome, không phải màn A.
- Chữ là tiêu đề nhận diện một màn → nói về màn ("Không hiển thị màn Encouragement"), không nói về chữ.
- Không đoán nguyên nhân, không phân tích.

##### Expected Result
**Mục đích:** hành vi đúng theo test case / PRD.
- Cùng chủ ngữ, cùng cách nói với Actual để dev đối chiếu: Actual `Không hiển thị màn Encouragement khi tắt hẳn app rồi mở lại.` → Expected `Hiển thị màn Encouragement khi tắt hẳn app rồi mở lại.`
- Không ghi "(theo test case)", không ghi đường dẫn file.

#### Trả về
Với mỗi bug: `id` (giữ nguyên), `title`, `pre` (mảng dòng), `steps` (mảng dòng), `actual`, `expected`.

### Design checks (UI theo Figma)

The QA Pipeline compares each screen that has a Figma frame with the app and writes one result per screen (suite `UI theo Figma`, case `UI-<screen>`, no xlsx write-back). Each gap is a check with keyword `Verify design text | layout | font | color | image` and a `design` object `{ short, actual, expected, severity, reason, kind }` already worded with measured values (`"Cook better" lệch 10pt sang phải so với Figma`, `Màu chữ "Price" là #DC1E1E, Figma #787878`). The report uses those sentences as they are.

- Gaps of one group on one screen → 1 bug (`mergeChecks` "same kind of check on the same screen"), titled `Màn S có N chỗ sai màu so với Figma` (wording in `DESIGN_GROUP`, html.js). One group = one bug, so a dev fixes colour and spacing separately.
- Attachment: Figma on the left, app on the right, the gap boxed in red on both (dashed on the app side when the element is missing).
- Screen with a Figma link not reached in the run → Not Run. Figma not readable (no token, wrong link) → Blocked, environment, no bug.

### Flow bugs (Blocked)

A Blocked test gets a flow bug **even when it also has failed checks** (each failed check stays its own bug).
Manual fix mode: a blocking step the tester let pass (Skip / Use element) is recorded with `addFlowBug({ step, screen, target, error, seen, shot })` and becomes the same kind of flow bug (Steps stop before it, Actual from `seen`); the case runs on and ends **Failed**. Fix script (script was wrong) records nothing. Actual says what the app really showed: `afterTest` passes `screenSummary()` (title, main text, buttons read from the page source at failure) to `writeResult`, and the screenshot at failure is always kept.

### Asana

- One subtask under a parent task, sent as `html_notes`: allowed tags only, no `<p>`, `\n` for line breaks.
- Priority goes into the project's "Priority" custom field (option "Very High"). If that fails, the form says to set it by hand.
- The form has a review step before creating. Title, Precondition, Steps (one line = one item), Actual and Expected are editable there, per subtask; edits only change what goes to Asana, not the report. Title / Steps / Actual / Expected cannot be empty.
- Opened through QA Pipeline, the form first asks the AI to rewrite the picked bugs (see "Bug fields" → "Cách viết bug"); "Create" stays disabled until it answers (max 150 s). Text the tester already edited is kept; "Khôi phục nội dung gốc" restores the AI version. Merged UI subtasks keep the template text.
- UI bugs on the same screen can be merged into one subtask (toggle in the form). Title: `[BUG][<Màn>] <n> lỗi UI: <title 1>; <title 2>`.

## Excel (`excel.js`)

- **Write-back** to the case file (needs `case.file`, `case.dataSet`, `case.run`). A backup is saved to `reports/xlsx-backup/` first.
  - TestCases sheet: `Test Result`, the worst status across runs (Failed > Blocked > Not Run > Skipped > Passed), and `Last Run`.
  - TestData sheet: `Result`, `Bug` and `Last Run`.
- **Export Excel button:** downloads the case file(s) after write-back. If no file was synced, it downloads `test-results.xlsx` instead.
- **`reports/test-results.xlsx`:** sheets Summary / Test Results / Bugs.

## Report layout

Markup is built in `renderReport` (html.js). Look and behaviour live in `assets/src/report/ui/`, embedded verbatim into the page:
`report.css` (tokens on `:root`, dark mode), `page.js` (copy, zoom, jump to bug, PDF), `asana.js` (full report only) and `dashboard.js` (everything below that reads the DOM).

1. Header: app · suites, Build / Platform / Environment / Test run / Duration, buttons Excel / PDF / light-dark.
2. Filter bar (sticky): search (`/`), Test suite, Result, Bug type, Priority, Severity, Reset. One filter drives everything below.
3. KPIs: Total cases, Passed, Failed, Blocked (click to filter), Pass rate (passed / run), Bugs (with count logged to Asana).
4. Charts: Test Execution Results (donut), Defects by Priority (bars P0–P3), Bugs by Module (Function / UI bars, display only — no click filter), Bugs by Severity (donut). All except Bugs by Module are clickable to filter.
5. Test case table: scrolls in its own box; a row opens its step list; Mở tất cả / Thu gọn.
6. Bug Details: cards with type, severity, priority, Copy bug, Log Asana; Chọn bug đang hiện (selection for Asana happens only here), Mở tất cả, CSV export of the bugs shown.

Rows need `data-t`, `data-tc`, `data-suite`, `data-status`, `data-sec`; bug cards need `data-bug` (JSON with `id`, `title`, `short`, `actual`, `expected`), `data-type`, `data-priority`, `data-severity`, `data-screen`, `data-tests`. `dashboard.js` reads only these.

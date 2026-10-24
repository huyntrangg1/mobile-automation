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
| Other element missing / still shown when it should hide | UI | Minor; whether it blocks an action is unverified |
| Button enabled with invalid data (`Verify disabled`) | Function | Major |
| Button disabled with valid data (`Verify enabled`) | Function | Critical on a main flow, else Major; workaround unverified |
| Password shown instead of masked | Function | Major (sensitive data) |
| Selection state wrong | Function | Major |
| Wrong number / content vs data or formula | Function | Major |
| Same value, different format; empty value | UI | Minor |
| Text or unit differs only in wording (cal vs kcal) | UI | Trivial |

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

## Dedupe (`dedupe` in html.js)

1. Same screen + same check label across tests or data sets → **one representative bug** (first occurrence). The report does not show the occurrence count and does not list the runs.
2. Same label + same actual + same expected on **several screens** → one bug. **Affected Area** = those screens, with one screenshot per screen.
3. **Same missing element** → one bug: a check "X must be shown" that fails and a test blocked because X could not be found to act on (e.g. `Không thấy "Already a member? Log In"`). The bug from the check is the representative (it has the screen and clear steps); the blocked tests are added to its test list and their blocking counts toward Priority.

Bug IDs (BUG-001…) are sequential within a report.

## Bug fields

Wording lives in `assets/src/report/phrasing.js`; `buildBugs` in `html.js` assembles the fields. Write for a dev who never saw the test case: plain Vietnamese sentences, concrete values, only what was observed.

| Field | Rule | Example |
|---|---|---|
| **Title** | `[BUG][<Feature> - <Màn>] <hành vi sai>`: one short sentence saying what is wrong **and when** (see `<khi …>` below), not "A thay vì B (mong đợi …)". Drop `- <Màn>` when the screen is unknown or the bug spans several screens. | `[BUG][Authentication - Log In] Nút "Continue with email" vẫn enable khi nhập Email "Yolina@"` |
| **Feature** | `case.feature` (the test case file / module), else the first word of the suite. | `Authentication` |
| **Màn** | Check bugs: the screen of the check. Flow bugs: the screen the user was on when the step failed, never the screen that did not open. | `Create account` |
| **Affected Area** | Only when the same error shows on more than one screen: list every screen. | `- Log In`<br>`- Create account` |
| **Precondition** | Real conditions only: starting screen, accounts / data that must exist, fresh install, then the device line (`Thiết bị: … · iOS … · App … · locale …`). "Tiếp nối TC_x" becomes `Đang ở màn <màn bắt đầu>`. "Ghi chú bước N" lines are dropped. Action lines (`Tap "X"`, `Launch fresh`) move to the top of Steps. | `1. Đang ở màn Log In`<br>`2. Tài khoản qa.plan… đã xong onboarding` |
| **Steps to Reproduce** | Numbered, one action per line, in the order really run (step log), up to the failing point. Check bugs end with `Quan sát …`. Flow bugs end with the action that failed. | `1. Nhập Email: "Yolina@"`<br>`2. Nhập Password: "Yolina123"`<br>`3. Quan sát nút "Continue with email"` |
| **Actual Result** | 1 sentence: what the app showed, with the values typed. No cause, no analysis. | `Nút "Continue with email" vẫn enable, nhấn được khi nhập Email "Yolina@".` |
| **Expected Result** | 1 sentence: the correct behaviour from the test case / spec. No file paths. | `Nút "Continue with email" bị disable, không nhấn được.` |
| **Attachment** | Screenshot with the failing element boxed in red. Element missing ("không hiển thị"): dashed red box where it should appear (under the anchor passed to `snapshot`), and the text found there is added to Actual: `…; chỗ đó hiện "That username is already taken."`. Flow bugs: screenshot at failure, no box. | |
| **Priority / Severity / Loại** | From the impact table above. Set as fields (Asana custom field Priority), never written inside the content. | `High · Major · Function` |

### Action wording (Steps)

| Keyword | Sentence |
|---|---|
| `Launch fresh` | Mở app (bản cài mới) |
| `Relaunch app` | Tắt hẳn app rồi mở lại |
| `Tap "X"` / `Back` | Nhấn "X" / Nhấn Back |
| `Enter "F" = v` | Nhập F: "v" (empty v → Xoá hết ô F) |
| `Clear "F"` | Xoá hết ô F |
| `Set ruler "H" = v` | Kéo thước H tới v |
| `Select date "B" = v` | Chọn B: v |
| `Hide keyboard` / `Swipe` / `Scroll to "X"` | Ẩn bàn phím / Vuốt <hướng> / Cuộn tới "X" |

### Check wording (Title · Actual · Expected)

Every check bug says **when** it happens, so a dev understands it from the title alone. `<khi …>` (`whenText` in phrasing.js) is built from the steps run before the check:

- the last action, if it is not typing: `khi nhấn "Create account"`, `khi tắt hẳn app rồi mở lại`;
- plus the value currently in each field (last value typed): `với Password "Abc1234" (7 ký tự)`. With no action before it: `khi nhập Email "Yolina@"`;
- only the fields named in the check (an error about "Password" → only the Password field). If no field is named, list them all;
- password fields also show their length: `(7 ký tự)`;
- nothing done yet on the screen: `khi vừa vào màn S`.

Title and Actual carry `<khi …>`. Expected does not repeat it.

| Keyword failing | Title | Actual | Expected |
|---|---|---|---|
| `Verify disabled "X"` | Nút "X" vẫn enable `<khi …>` | Nút "X" vẫn enable, nhấn được `<khi …>`. | Nút "X" bị disable, không nhấn được. |
| `Verify enabled "X"` | Nút "X" bị disable `<khi …>` | Nút "X" bị disable, không nhấn được `<khi …>`. | Nút "X" enable, nhấn được. |
| `Verify displayed "X"` / `Verify text` | Không hiển thị "X" `<khi …>` | Màn S không hiển thị "X" `<khi …>`. | Màn S hiển thị "X". |
| `Verify not displayed "X"` | "X" vẫn hiển thị `<khi …>` | "X" vẫn hiển thị trên màn S `<khi …>`. | "X" không còn hiển thị. |
| `Verify value "F" = e` | F hiển thị "a" thay vì "e" `<khi …>` | F hiển thị "a" `<khi …>`. | F hiển thị "e". |
| `Verify value` masked (`***`) | Ô F hiện rõ mật khẩu thay vì ẩn `<khi …>` | Ô F hiện rõ "a" `<khi …>`. | Ô F ẩn ký tự (hiện dấu chấm). |
| `Verify selected "X"` | "X" không được chọn `<khi …>` | "X" có giá trị "a" `<khi …>`. | "X" được chọn ("e"). |
| element missing (any) | Không thấy "X" `<khi …>` | Màn S không có "X" `<khi …>`. | Màn S có "X". |
| no keyword (custom spec) | `<label>` hiển thị "a" thay vì "e" / `<label>` không hiển thị, + `<khi …>` | | |

Examples:

- `[BUG][Authentication - Create account] Không hiển thị "Password must be at least 8 characters" khi nhấn "Create account" với Password "Abc1234" (7 ký tự)`
- `[BUG][Authentication - Log In] Nút "Continue with email" vẫn enable khi nhập Email "Yolina@"`

### Flow bugs (Blocked, no check failed)

| Cause | Title | Actual | Expected |
|---|---|---|---|
| Screen did not open (`Không tới được màn S: không thấy "Y" sau Ns`) | Không chuyển sang màn S sau khi `<thao tác cuối>` | Sau khi `<thao tác cuối>`, app không chuyển sang màn S (chờ Ns không thấy "Y"). | App chuyển sang màn S. |
| Element to act on missing | Không thấy "X" | Sau khi `<thao tác cuối>`, màn S không có "X". | Màn S có "X". |
| Other error | first line of the error | same | Các bước của test case chạy hết, không lỗi. |

### Asana

- One subtask under a parent task, sent as `html_notes`: allowed tags only, no `<p>`, `\n` for line breaks.
- Priority goes into the project's "Priority" custom field (option "Very High"). If that fails, the form says to set it by hand.
- The form has a review step before creating.
- UI bugs on the same screen can be merged into one subtask (toggle in the form). Title: `[BUG][<Feature> - <Màn>] <n> lỗi UI: <title 1>; <title 2>`.

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
6. High-Priority Issues: table of High / Very High bugs (toggle to show all) with Asana status and owner; a row jumps to the bug card.
7. Bug Details: cards with type, severity, priority, Copy bug, Log Asana; Chọn bug đang hiện (selection for Asana happens only here), Mở tất cả, CSV export of the bugs shown.

Rows need `data-t`, `data-tc`, `data-suite`, `data-status`, `data-sec`; bug cards need `data-bug` (JSON with `id`, `title`, `short`, `actual`, `expected`), `data-type`, `data-priority`, `data-severity`, `data-screen`, `data-tests`. `dashboard.js` reads only these.

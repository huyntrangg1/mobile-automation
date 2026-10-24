# QA Pipeline — bản demo (thiết kế)

Ngày: 2026-10-24 · Người yêu cầu: trangnth@ikameglobal.com
Thiết kế giao diện tham chiếu: canvas "AI Test Automation Tool" — https://claude.ai/artifact/XNBhRATzqvfdbd2bTp5N8h
(bản sao các màn ở scratchpad khi build; design system `ikqa` trong `project/ds/ikqa/tokens.json` của canvas).

## 1. Ý định

Team QA muốn một tool web: tester **thêm app → tool lấy locator → import test case → AI gen script → bấm Run → xem report**,
không phải viết code. Bây giờ chỉ làm **bản demo chạy thật trên máy Mac của người yêu cầu**, để gửi dev làm bản thật cho cả team.

Bàn giao cho dev gồm 2 thứ:
1. **Web demo** chạy được (code + README cách chạy).
2. **Spec cho bản thật** — tài liệu riêng, viết sau khi demo xong, dựa trên những gì demo đã chứng minh (xem mục 9).

## 2. Mục tiêu

- Luồng chính chạy **thật** từ đầu đến cuối trên app IK Fitness (iOS Simulator), không dùng dữ liệu giả:
  1. Thêm app (.app) → lấy locator bằng **1 trong 2 chế độ tester chọn** (mục 4.2).
  2. Import file Excel test case.
  3. AI gen test script WebdriverIO. **Review code là tuỳ chọn**: có thể Run ngay, hoặc mở code ra xem / sửa rồi mới Run.
  4. Run trên simulator, theo dõi tiến độ trực tiếp, ra report.
- Giao diện **đẹp hơn canvas** (yêu cầu rõ của người dùng): bám luồng và ngôn ngữ thiết kế của canvas, nhưng chăm chút hơn.

## 3. Không làm trong demo (ghi vào spec cho dev)

Đăng nhập / phân quyền · nhiều người dùng đồng thời, hàng đợi run · nhiều máy chạy / device farm · Android ·
Dashboard tổng nhiều app · log Asana từ tool (report sẵn có đã có nút Log Asana) · CI.

**Anti-goal** (dù chạy được vẫn coi là hỏng):
- Màn hình hiển thị số liệu giả / mock thay vì kết quả chạy thật.
- Tester phải mở terminal hoặc sửa code mới chạy được một test case.
- Report khác với report chung của workspace (skill `test-report`), hoặc copy riêng code report rồi sửa.

## 4. Luồng và hành vi

### 4.1 Màn hình (tối thiểu)

| Màn | Việc chính |
|---|---|
| Apps | Danh sách app; thêm app (chọn file .app, đặt tên); mở bản đồ locator |
| Locator map | Danh sách màn đã ghi (ảnh chụp + phần tử + locator); đổi tên / gộp / xoá màn; chạy lại lấy locator (chế độ nào cũng được, bổ sung vào map hiện có) |
| Test cases | Import Excel; danh sách case theo module; trạng thái script; chọn case → Generate |
| Script review | Xem code đã gen, cảnh báo của AI (vd target không có trong locator map); sửa được; đánh dấu "Đã review" (tuỳ chọn) |
| Run config | Chọn simulator, case sẽ chạy; báo trước case nào không chạy được và lý do |
| Run live / Run detail | Tiến độ từng case, log trực tiếp; xong thì kết quả + mở report |
| Runs | Lịch sử các lần chạy |

### 4.2 Lấy locator — 2 chế độ, tester chọn

Cả hai cho ra **cùng một bản đồ locator** của app, chạy chế độ nào sau cũng bổ sung vào map có sẵn.

- **Tự khám phá:** AI điều khiển app qua Appium: đọc page source + ảnh chụp → chọn thao tác tiếp (tap, nhập) → lặp.
  Tester có thể cho trước dữ liệu gợi ý (email / password test) để vượt form. Có giới hạn số bước / thời gian; dừng được giữa chừng.
  Màn chạy hiện ảnh màn hình hiện tại và số màn đã tìm thấy.
- **Ghi lại khi tôi bấm:** tool mở app trên simulator; tester tự bấm qua app; tool liên tục đọc page source,
  nhận ra màn mới và lưu lại. Tester bấm "Dừng ghi" khi xong.

Mỗi màn trong map gồm: tên màn (AI đặt, tester sửa được), ảnh chụp, page source XML, danh sách phần tử
(loại, name, label, value, vị trí) và **locator đề xuất** cho mỗi phần tử theo thứ tự ưu tiên của project hiện có:
accessibility id (`~…`) → `-ios predicate string` → `-ios class chain` (xem `ik-fitness/src/locators/ios/*.js`).
Hai lần gặp cùng một màn phải nhận là một màn (không nhân bản).

### 4.3 Test case và gen script

- Đầu vào: file Excel **format automation v2** team đang dùng — đọc như `ik-fitness/data/loaders/testcase-v2.js`
  (sheet TestCases + TestData; mỗi dòng có Kind / Screen / Keyword / Target / Value; biến `${…}`, `${env.X}`, `${gen.fn()}`).
- AI gen **test script WebdriverIO** cho case đã chọn, dùng locator map của app. Code sinh ra phải:
  - theo hướng dẫn "Instrumenting a spec" của skill `test-report` (`planTest`, `setCase`, `snapshot`, `softAssert().eq(..., evidence)`, `logStep`)
    để report vẫn khoanh đỏ bug như report hiện tại;
  - theo quy ước của `ik-fitness`: locator tách riêng, Page Object không assert.
- Trạng thái script mỗi case: **Chưa gen → Đang gen → Đã gen** (hoặc **Gen lỗi** kèm lý do).
  "Đã review" là cờ tuỳ chọn, không chặn Run. Case có target không tìm thấy trong locator map → AI ghi cảnh báo,
  vẫn Đã gen nhưng hiển thị cảnh báo ở Script review và Run config.
- Gen lại một case ghi đè script cũ của case đó (giữ bản cũ không bắt buộc trong demo).

### 4.4 Run và report

- Mỗi app có **một project WebdriverIO** do tool quản lý. Theo `CLAUDE.md` của workspace, project này phải cài report chung
  ngay khi tạo: `bash .claude/skills/test-report/scripts/install.sh <project>`, dev deps `pngjs exceljs @wdio/reporter`,
  và hook trong mục "Config" của skill, gồm `onComplete → buildHtml(..., { appName, open: false })`
  (demo mở report trong tool thay vì tự mở trình duyệt).
- Run = tool chạy `wdio` cho các script đã chọn trên simulator đã chọn; stream log và trạng thái từng case lên Run live.
- Xong → Run detail hiện số Passed / Failed / Blocked / Skipped / Not Run và mở `bug-report.html` của lần chạy đó.
  Mỗi lần chạy giữ report riêng (không bị lần sau ghi đè) để màn Runs xem lại được.
- Demo chỉ cần **một run tại một thời điểm**; đang chạy thì nút Run khoá kèm lý do.

## 5. Ràng buộc

- Chạy trên macOS của người yêu cầu: Node 26, Appium 2 + driver xcuitest 12.19.1, Xcode / iOS Simulator, Claude Code CLI (`claude`) đã cài.
- App thử: IK Fitness (`ik-fitness/apps/ikFitnessHeathyApp.app`); file test case thử: `ik-fitness/data/testcases/*.xlsx`.
- **Không sửa** project `ik-fitness` hiện có; demo đọc / copy từ nó khi cần.
- Không phải git repo; không commit / push.
- Ngôn ngữ giao diện: tiếng Việt, giữ thuật ngữ test bằng tiếng Anh như canvas (Passed, Failed, Run, Locator…).

## 6. Quyết định đã chốt

- **Demo lấy IK Fitness làm app mẫu.** Tool vẫn dựng chung (thêm app, lấy locator, gen, run không gắn cứng IK Fitness),
  nhưng project WebdriverIO của IK Fitness trong tool **được dùng lại code viết tay của `ik-fitness`**
  (copy, không sửa bản gốc): `src/utils/app.js` (freshStart, đóng sheet mật khẩu / alert hệ thống), component Ruler,
  birthday picker, Page Object, `src/runner/fixtures.js` (`ensureAccounts`). AI gen code gọi các helper này khi cần,
  thay vì tự viết lại. Code AI gen **không được gọi `runTestcase` / keyword runner** — đó là cách 2 đã bỏ.
  Spec cho dev ghi: bản thật cần cơ chế "helper pack" riêng cho mỗi app.
- **Tiêu chí xong của demo:** `ik-fitness/data/testcases/authentication-automation.xlsx` chạy hết luồng
  thêm app → lấy locator → import → gen → run, ra kết quả Passed / Failed / Blocked thật và report có khoanh đỏ.
- **Được tạo tài khoản thật trên server** khi chạy (tương đương `ALLOW_ACCOUNT_CREATE=1`).
- **Cách làm: AI viết code test** (không phải chạy thẳng Excel bằng keyword runner).
- Review code: tuỳ chọn.
- Lấy locator: 2 chế độ, tester chọn.
- Người dùng: cả team ở bản thật; demo một người, một máy.
- Bàn giao: web demo + spec.
- Giao diện đẹp hơn canvas.

## 7. Quyết định của Claude (người dùng chưa chốt — nêu ra để kiểm)

- **AI trong demo = Claude Code CLI chạy headless trên máy** (`claude -p …`), không cần API key. Spec ghi dev chuyển sang Anthropic API key công ty ở bản thật.
- Demo chạy dưới dạng web local (một lệnh `npm start`, mở `localhost`).
- Dùng design system `ikqa` + font IBM Plex của canvas làm nền giao diện.
- Dữ liệu demo lưu file cục bộ trong thư mục demo (không cần database server).
- **Một file Excel → một file script**, giữ đúng thứ tự case (case "Tiếp nối <TC trước>" cần chạy sau case trước).
  Gen lại một case = gen lại file đó. Script đọc steps / Data Set từ xlsx lúc chạy (`planTest` / `setCase` có `file`, `dataSet`, `run`)
  để report ghi ngược kết quả vào Excel và đánh dấu Not Run được.
- Excel import vào tool được **copy vào thư mục của tool**; write-back ghi vào bản copy, không đụng file gốc.
- Chọn một case nối tiếp ở Run config → tool **tự thêm các case phía trước** vào run và báo cho tester.
- Mỗi app có mục **"Biến môi trường"** trong tool (DEVICE_UDID không cần — chọn ở Run config; email / mật khẩu test,
  `${env.X}`, `ALLOW_ACCOUNT_CREATE`…); tool truyền vào `wdio` khi chạy. Tester không phải mở terminal.
- Mỗi lần chạy có **thư mục report riêng** (cấu hình qua wdio config, vì `onPrepare` của report xoá `reports/`).
- Simulator bị khoá khi đang lấy locator, giống khi đang chạy test.

## 8. Để builder tự quyết

Framework frontend / backend, cách lưu trữ cụ thể, cách stream log (SSE / WebSocket), cách nhận diện "cùng một màn",
prompt cho AI, cấu trúc thư mục, mức tests cho code demo.

## 9. Spec cho dev (bàn giao sau)

Viết khi demo chạy được, gồm: luồng và các màn (link canvas), những gì demo đã chứng minh, chỗ demo làm tạm,
các phần mục 3 cần làm cho bản thật (nhiều người dùng, máy chạy chung, hàng đợi, Android, auth, API key), và
mô hình dữ liệu (App, Locator map / Screen / Element, Test case, Script, Run, Result).

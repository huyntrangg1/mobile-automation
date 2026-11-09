# QA Pipeline

Tool web chạy trên Mac để tự động hoá kiểm thử app mobile (iOS Simulator / Android):
**thêm app → lấy locator → import test case (Excel automation, hoặc manual để AI chuyển) → AI gen script → Run → report**.
Kèm **AI Smoke Test**: AI tự mò app theo PRD / Figma và báo điểm lệch.

Dùng cho nhiều app / dự án: mỗi app có một project WebdriverIO riêng trong `workspaces/<app>/` do tool tạo và tự nâng cấp.

---

## 1. Chuẩn bị máy (làm một lần)

| Cần | Cách cài |
|---|---|
| macOS + **Node 20+** | https://nodejs.org (đã thử với Node 26) |
| **Appium 2+** | `npm install -g appium` |
| iOS: **Xcode** + iOS Simulator | App Store → Xcode, mở Xcode một lần để cài thành phần bổ sung |
| iOS: driver `xcuitest` | `appium driver install xcuitest` |
| Android (tuỳ chọn): Android SDK (`platform-tools`, `build-tools`, emulator hoặc máy thật bật USB debugging) | Android Studio; `ANDROID_HOME` hoặc `~/Library/Android/sdk` |
| Android: driver `uiautomator2` | `appium driver install uiautomator2` |
| **Claude Code** đã đăng nhập (`claude`) | https://claude.com/claude-code — tool gọi `claude -p` để chuyển test case, gen script, khám phá app, AI hỗ trợ khi chạy. Không cần API key |
| AI Smoke Test (tuỳ chọn): MCP `begamob` (PRD) và `figma` | Trong Claude Code gõ `/mcp`, đăng nhập một lần. `claude -p` không dùng connector của claude.ai |

Chỉ cần một trong hai nền tảng (iOS hoặc Android).

**Simulator iOS nên đặt tiếng Anh** (Simulator mới lấy ngôn ngữ của máy Mac — app có bản tiếng Việt sẽ hiện tiếng Việt và không khớp test case):
Simulator → Settings → General → Language & Region → English / United States. Hoặc chạy (thay `<UDID>`):

```bash
xcrun simctl spawn <UDID> defaults write .GlobalPreferences AppleLanguages -array en
xcrun simctl spawn <UDID> defaults write .GlobalPreferences AppleLocale -string en_US
xcrun simctl shutdown <UDID>; xcrun simctl boot <UDID>
```

## 2. Cài và chạy tool

```bash
git clone https://github.com/huyntrangg1/mobile-automation.git
cd mobile-automation           # thư mục repo
npm install
npm run doctor                 # kiểm tra máy, in lệnh cài cho mục còn thiếu (--skip-ai để bỏ bước gọi thử Claude)
npm start                      # build giao diện + chạy server → mở http://localhost:5178
```

Lần **Run đầu tiên** trên iOS, tool build WebDriverAgent vào `.wda-build/` (vài phút). Các lần sau dùng lại.

Lệnh khác:

```bash
npm test                       # bộ test của tool (node:test)
npm run dev                    # phát triển: server tự khởi động lại khi sửa code + Vite (http://localhost:5173)
npm run sync-report            # cập nhật report chung từ skill test-report (xem mục 6)
```

> Đang dùng `npm run dev` thì **đừng sửa file trong `server/` khi đang chuyển đổi / gen script / Run**: server tự khởi động lại và cắt ngang việc đang chạy.

### Chia sẻ cho team (mạng LAN)

`npm start` mở server cho cả mạng LAN và in link dạng `http://192.168.x.x:5178`. Không cần đăng nhập — ai mở được link đều dùng được mọi chức năng, nên chỉ dùng trong mạng tin cậy. Chỉ máy này: `HOST=127.0.0.1 npm start`.
Máy khác thêm app bằng **Chọn file .apk / .zip** (iOS: nén thư mục `.app` build cho Simulator thành `.zip`). Thiết bị dùng chung: mỗi lúc một job (lấy locator, chạy thử luồng, smoke hoặc run).

## 3. Bắt đầu nhanh

1. **Apps → Thêm app**: chọn file `.app` (build cho Simulator) hoặc `.apk`. Tool tự nhận nền tảng và tạo workspace (1–2 phút).
   File app không nằm trong repo. Thử nhanh Android: [ApiDemos-debug.apk](https://github.com/appium/android-apidemos/releases) + `samples/apidemos-automation.xlsx`.
2. **Locator map → Lấy locator**: *Tự khám phá* (AI tự bấm qua app, tối đa 150 bước / 60 phút; nhập tài khoản test nếu app cần đăng nhập) hoặc *Ghi lại khi tôi bấm*. Đổi tên màn cho khớp cột Screen trong test case.
3. **Test Cases → Import Excel**:
   - File **automation** (sheet TestCases: Kind / Screen / Keyword / Target / Value) → import thẳng.
   - File **manual** (cột "Test Case #", Steps, Expected) → mở màn chuyển đổi (mục 4).
4. Chọn case → **Gen script** (mỗi file Excel = một file `tests/<file>.e2e.js`, mỗi case một region AI viết; xem / sửa ở **Scripts**).
5. Chọn case → **Run** → chọn thiết bị → **Kiểm tra trước khi chạy** báo "Sẵn sàng chạy" → **Start run**. Xong mở report.

## 4. Chuyển test case manual → automation

Import file manual → tool phân loại case **Sẽ automate / Để manual**, rồi:

- **Cần xác nhận**: case có điểm mờ (Expected không rõ chữ, thiếu dữ liệu…). Trả lời trước hoặc bỏ qua để AI tự đoán; trả lời sau thì chỉ case đó được chuyển lại. Nút **AI gợi ý câu trả lời**.
- **Chạy thử luồng chung trên thiết bị** (khuyên dùng, chọn thiết bị trước khi bấm Chuyển đổi): sau khi lập khung, tool cài app và **chạy thật các luồng dùng chung** (đi qua onboarding, vào tab…) để học hành vi thật của app — vd chọn đáp án là tự chuyển màn thì bỏ bước "Continue" thừa. Các chỗ đã sửa hiện ở mục "Chạy thử trên thiết bị".
- AI viết dòng Keyword theo **app thật** (locator map + sơ đồ màn đã thấy) nhưng **điểm kiểm theo Expected của tài liệu**. Chỗ app khác tài liệu → tab **Lệch tài liệu**: chọn *Theo tài liệu* (app có thể sai) hoặc *Theo app* (tài liệu cũ).
- Kết quả có mục **Cần review**: `[App]` (tên phần tử không có trong app), `[Tài liệu]`, `[Thiếu kiểm]` (dòng Expected chưa có điểm kiểm), `[Chuỗi]` (case nối tiếp mang trạng thái của case trước).
- **Chuyển lại N case lỗi** chỉ chuyển lại các case đó (case đã xong giữ nguyên, không phải gen lại script). **Chuyển lại từ đầu** làm lại cả file.
- Precondition chỉ ghi điều kiện; thao tác chuẩn bị (bỏ chọn, quay lại màn…) được viết thành bước thật ở Step 0.

## 5. Khi chạy test

Tool xử lý giống người test tay, theo thứ tự:

- **Hộp xin quyền hệ thống** (ATT, thông báo, ảnh, camera, vị trí, Health…) tự xử lý ngay khi che màn — từ chối theo dõi quảng cáo, cho phép các quyền khác — trừ khi bước đang chạy nhắm đúng vào nút của hộp đó. **Alert của chính app (vd "Xoá? Cancel/OK") không bao giờ tự bấm.** Đổi bằng biến `SYSTEM_ALERT`.
- **Popup trong app** (mời đăng nhập, đánh giá, khuyến mãi…) che bước kiểm → đóng bằng nút Close / Not now rồi kiểm lại, ghi là **lệch so với script**.
- **Không thấy phần tử**: tự tìm theo chữ; bấm xong app chưa chuyển màn → bấm lại một lần; màn đứng yên (không đang tải) → kết luận sớm thay vì chờ hết giờ.
- **Case "Tiếp nối"**: kiểm app đang thật sự ở màn bắt đầu; sai màn / case trước bị chặn → cài lại app và đi theo sơ đồ màn (`workspaces/<app>/data/nav-graph.json`, học từ các lần chạy và lần khám phá).
- **Chạy lại case** chỉ khi lỗi chập chờn (mất phiên Appium, app văng, phần tử hết hạn); lỗi lặp lại y hệt thì báo luôn.
- **Cho AI hỗ trợ khi chạy** (ô chọn ở màn Run): bước thao tác / điều hướng kẹt thì AI xem màn và gỡ kẹt. **AI không bao giờ đụng điểm kiểm và không bấm mua.** Mỗi lần giúp được ghi "lệch so với script" kèm nút **Áp dụng vào test case** (sửa Excel + gen lại đúng case đó) / **Bỏ qua**.
- **Sửa tay khi lỗi** (ô chọn ở màn Run): bước kẹt thì dừng cho bạn chọn Block / Skip / Retry / Use element / Fix script.
- Không làm được trên nền tảng này (vd tắt mạng trên iOS Simulator) → **Skipped** kèm lý do. Hook kiểm phía backend chưa viết → "không kiểm được tự động", case chạy tiếp.
- **Run lại** cho chọn thiết bị khác (tool nhớ theo app).

**Report** (`bug-report.html`, skill `test-report`): Bug Details chỉ gồm lỗi nhiều khả năng của app; mục **Không phải bug của app** (lỗi môi trường / công cụ / kịch bản) và **Cần xem** (case pass nhưng có lệch so với script hoặc điểm kiểm không làm được) tách riêng. Run bị dừng vẫn có report. Kết quả ghi vào bản copy Excel trong workspace.

**Hook của dự án** (keyword Run setup / Run check): viết trong `workspaces/<app>/src/hooks.js` (seed dữ liệu qua API, kiểm backend…). Có sẵn hook vòng đời app: `kill_app`, `terminate_app`, `uninstall_app`, `launch_app`, `background_app`, `app_not_running`, `app_running`, `app_in_background`, `app_uninstalled`, `app_installed`…

## 6. AI Smoke Test

Menu **AI Smoke Test**: dán link PRD (begamob), link Figma (có `node-id`) và / hoặc file Figma `.json` (xuất bằng plugin trong `figma-plugin/` — không gọi Figma MCP), chọn thiết bị → **Chạy smoke test**.
App được cài sạch; AI đi qua onboarding, xử lý quyền, đóng quảng cáo / paywall (chỉ đóng, không bao giờ xác nhận mua), rút các luồng chính rồi chạy từng luồng, báo điểm lệch kèm ảnh app, ảnh Figma và đoạn PRD. Có file Figma `.json` thì so vị trí / kích thước / màu / chữ bằng code. Kết quả là nhận định của AI — kiểm lại từng điểm.

## 7. Biến môi trường

Đặt ở **Cài đặt app** (truyền vào mỗi lần Run) hoặc trước `npm start`.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `SYSTEM_ALERT` | `smart` | Hộp xin quyền ngoài test case: `smart` (từ chối ATT, cho phép quyền khác), `allow`, `deny`, `off` |
| `REDUCE_MOTION` | tắt | `1` = bật "Giảm chuyển động" (chạy nhanh hơn, nhưng app bỏ animation → khác test tay) |
| `AUTO_RECOVER` / `AUTO_NAVIGATE` / `AUTO_RESOLVE` / `AUTO_RETAP` / `START_CHECK` / `CLOSE_POPUPS` / `EARLY_STUCK` | bật | `0` để tắt từng cơ chế ở mục 5 |
| `STUCK_MS` | 5000 | Màn đứng yên bao lâu thì kết luận kẹt sớm |
| `AI_ASSIST_MAX` / `AI_ASSIST_BUDGET` / `AI_TIMEOUT_MS` | 4 / 8 / 60000 | AI hỗ trợ: số thao tác mỗi lần kẹt / số lần gọi AI mỗi case / thời gian tối đa mỗi lần gọi |
| `HOST` | `0.0.0.0` | `127.0.0.1` = chỉ máy này truy cập |
| `QAPD_AI_MODEL`, `QAPD_EXPLORE_MODEL`, `QAPD_ASSIST_MODEL`, `QAPD_RESOLVE_MODEL`, `QAPD_SMOKE_MODEL` | model mặc định của Claude Code / Sonnet | Đổi model cho từng việc |
| `QAPD_CONVERT_CONCURRENCY` | 5 | Số nhóm case AI viết cùng lúc khi chuyển đổi |
| `QAPD_DATA`, `QAPD_WORKSPACES` | `data/`, `workspaces/` | Nơi lưu dữ liệu tool / project của từng app |

## 8. Xử lý sự cố thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `'/bin/launchctl' failed with exit code 3` khi mở phiên | Tool không còn đặt ngôn ngữ qua Appium; đặt tiếng Anh cho Simulator bằng tay (mục 1) |
| Paywall trên Simulator không có giá / gói | StoreKit của Simulator đó bị hỏng sau một thời gian dùng (máy thật vẫn có giá). Tạo Simulator mới (`xcrun simctl create`, đặt tiếng Anh) hoặc Simulator → Device → Erase All Content and Settings |
| App hiện tiếng Việt, test case tiếng Anh | Đặt Simulator tiếng Anh (mục 1) |
| "Kiểm tra trước khi chạy" báo cổng 4723 bận | Tắt Appium đang chạy tay (`lsof -i :4723`), tool tự mở Appium khi Run (cổng 4724 dùng cho lấy locator / smoke) |
| Workspace báo "cần chuẩn bị lại" | File của workspace đã bị sửa tay nên tool không tự cập nhật — **Cài đặt app → Chuẩn bị lại** (bản cũ giữ ở `.bak`) |
| Gen lại script hỏi ghi đè | Case có code đã sửa tay; đồng ý thì code sửa tay bị thay (tool giữ `.bak`) |

## 9. Report chung và helper pack

- Report dùng bản trong `vendor/test-report/` (copy từ skill `test-report`). Bản gốc là skill: đặt ở `../.claude/skills/test-report` rồi `npm run sync-report` (copy vào vendor + cài lại cho mọi app). `npm run doctor` báo khi lệch.
- Chuyển đổi manual dùng bản `vendor/select-automation/` (skill `select-automation-testcases`), `npm run sync-select-skill` để cập nhật.
- Helper pack **ik-fitness** là tuỳ chọn: chỉ hiện khi có thư mục `../ik-fitness` cạnh tool.
- Workspace của app được **tự nâng cấp trước mỗi Run** theo template mới của tool: chỉ cập nhật file chưa sửa tay (giữ `.bak`), kéo theo file phụ thuộc, báo rõ file đã sửa tay.

## 10. Cấu trúc

```
server/              Express API + SSE; store JSON ở data/
  routes/            router Express
  ai/                runClaude() + prompt (chuyển đổi, gen, khám phá, smoke, AI hỗ trợ)
  device/            simulator / emulator / iPhone thật, phiên Appium (4724) để lấy locator
  locators/          page source → locator, locator map, khám phá bằng AI, bộ chặn nút mua
  apps/              tạo / nâng cấp workspace (template/ + helper pack), sơ đồ màn
    template/        project WebdriverIO mẫu: src/runner/steps.js (các bước k.*), khung chạy, utils
  testcases/         import Excel; convert/ = chuyển manual → automation (khung, viết dòng, kiểm theo app / tài liệu, chạy thử luồng)
  scripts/           khung file script + AI gen từng case
  runs/              chạy wdio, kiểm tra trước khi chạy, áp dụng lệch vào test case
  smoke/             AI Smoke Test
web/                 React + Vite
scripts/             doctor, sync-report, sync-select-skill
vendor/              test-report (report chung), select-automation (chuyển manual)
figma-plugin/        plugin Figma xuất frame (.json) cho AI Smoke Test
samples/             app + Excel mẫu (Android ApiDemos)
test/                bộ test của tool (npm test)
docs/                ảnh demo theo luồng, video
workspaces/<app>/    project WebdriverIO của từng app (tool sinh, không đưa lên git)
data/                store, ảnh màn, report từng run (không đưa lên git)
```

## 11. Giới hạn đã biết

- Một job dùng thiết bị tại một thời điểm cho cả máy.
- AI khi chuyển đổi chỉ biết hành vi app qua locator map và sơ đồ màn; bật **Chạy thử luồng chung trên thiết bị** để giảm bước sai. Chạy thử chỉ thực hiện Tap / Toggle / Enter / Back / Wait / Handle permission (luồng có Scroll, picker, Long press, biến `{{…}}` thì dừng chạy thử ở luồng đó và ghi chú), tối đa 15 phút.
- Điều hướng thay cho case bị chặn chỉ đi được khi sơ đồ màn của **build hiện tại** đã có đường; chỉ đảm bảo đúng màn, không đảm bảo dữ liệu case trước tạo ra.
- iOS Simulator không tắt mạng được (case cần mất mạng → Skipped), không đọc được quyền thông báo qua Appium.
- Android: đã thử trên emulator với ApiDemos; chưa có helper pack Android.
- Kết quả AI (chuyển đổi, AI hỗ trợ, smoke) có thể sai — các chỗ AI can thiệp đều được ghi rõ để kiểm lại.

## Tài liệu bàn giao

| Tài liệu | Link |
|---|---|
| Spec bản thật (chức năng từng màn, mô hình dữ liệu) | https://claude.ai/artifact/5fc6qKPU3oybSUvvaKswz1 |
| UI design theo luồng | https://claude.ai/artifact/1dtVCmkjQsipJRYva4u9Ez |
| Spec report chung (skill `test-report`) | https://claude.ai/artifact/LYY1m6GNmcJyU5Nfouvi3S |
| Ảnh chụp theo luồng / video demo | `docs/design/index.html`, `docs/qa-pipeline-demo-full.mp4` |

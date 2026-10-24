# QA Pipeline — bản demo

Tool web chạy trên Mac: **thêm app → lấy locator → import Excel test case → AI gen script → Run trên iOS Simulator → report**.
Bản demo cho một người, một máy. Bản thật cho cả team: xem spec bàn giao (`docs/`).

## Cần có trên máy

- macOS, Node 20+ (đã thử với Node 26), Appium 2 trở lên (`npm install -g appium`)
- iOS: Xcode + iOS Simulator, Appium driver `xcuitest` (`appium driver install xcuitest`)
- Android: Android SDK (`~/Library/Android/sdk` hoặc `ANDROID_HOME`, có `platform-tools` + `build-tools`), emulator đang bật hoặc máy thật bật USB debugging, Appium driver `uiautomator2` (`appium driver install uiautomator2`)
- Claude Code (`claude`) đã đăng nhập — tool gọi `claude -p` để gen script và tự khám phá app; không cần API key
- Chỉ cần một trong hai nền tảng. `npm run doctor` kiểm tra tất cả và in lệnh cài cho mục còn thiếu.

## Chạy

```bash
npm install
npm run doctor     # kiểm tra máy (thêm --skip-ai để bỏ bước gọi thử Claude)
npm start          # build giao diện rồi chạy server → http://localhost:5178
npm test           # test server (node:test)
npm run dev        # phát triển: server + Vite (http://localhost:5173)
```

File app (`.app` build cho Simulator, `.apk`) không nằm trong repo — tải bản build rồi chọn **Thêm app** và trỏ tới file đó.
Thử nhanh Android: tải [ApiDemos-debug.apk](https://github.com/appium/android-apidemos/releases) (app mẫu của Appium) vào `samples/`, dùng kèm `samples/apidemos-automation.xlsx`.

### Report chung và helper pack

- Report dùng bản trong `vendor/test-report/` (copy từ skill `test-report` của team). Bản gốc là skill: khi skill đổi, đặt skill ở `../.claude/skills/test-report` rồi chạy `npm run sync-report` (copy vào vendor + cài lại cho mọi app). `npm run doctor` báo khi hai bản lệch nhau.
- Helper pack **ik-fitness** (page object, kéo thước, popup iOS… của app IK Fitness) là tuỳ chọn: chỉ hiện khi có thư mục `../ik-fitness` cạnh tool. Không có thì mọi app vẫn chạy, AI tự viết các thao tác.

## Luồng 5 bước

1. **Apps → Thêm app**: đường dẫn file `.app` (iOS Simulator) hoặc `.apk` (Android) — tool tự nhận nền tảng; tên, helper pack (chỉ pack cùng nền tảng). Tool tạo project WebdriverIO riêng cho app
   ở `workspaces/<app>/` (cài report chung bằng `vendor/test-report/scripts/install.sh`) — khoảng 1–2 phút.
2. **Locator map → Lấy locator**, chọn 1 trong 2 chế độ:
   - *Ghi lại khi tôi bấm*: bạn bấm qua app trên cửa sổ Simulator, tool ghi lại từng màn (đọc mỗi 0,7 s).
     Popup hệ thống (quyền theo dõi, lưu mật khẩu) che màn hình thì tool nhắc bạn đóng.
   - *Tự khám phá*: AI tự bấm qua app (có giới hạn số bước); cho trước email / mật khẩu test để AI vượt form.
   Sau đó đổi tên màn cho khớp cột Screen trong Excel, gộp màn trùng, đặt tên Target cho ô nhập không có nhãn.
3. **Test Cases → Import Excel** (format automation v2: sheet TestCases + TestData). File được copy vào workspace;
   import lại file đã sửa → case đổi bước chuyển "Cần gen lại".
4. Chọn case → **Generate script**. Mỗi file Excel là **một** file `tests/<file>.e2e.js`; mỗi case là một region do AI viết.
   **Scripts** (tuỳ chọn): xem / sửa code, cảnh báo thiếu locator, đánh dấu đã review.
5. Chọn case → **Run** → chọn simulator. Case "Tiếp nối" tự kéo theo các case phía trước. Theo dõi trực tiếp, xong mở report
   (`bug-report.html` của skill `test-report`). Kết quả ghi vào bản copy Excel trong workspace; file gốc không đổi.

**Cài đặt app**: biến môi trường truyền vào mỗi lần Run (`${env.X}` trong Excel, `ALLOW_ACCOUNT_CREATE`…).

## Cấu trúc

```
server/            Express API + SSE; store JSON ở data/
  ai/              runClaude() + prompt
  device/          simulator, phiên Appium (cổng 4724) để lấy locator
  locators/        page source → phần tử / locator, locator map, 2 chế độ lấy locator
  apps/            tạo workspace (template/ + helper pack)
  testcases/       import Excel, chuỗi Tiếp nối
  scripts/         khung file script + AI gen từng case
  runs/            chạy wdio, theo dõi results/
web/               React + Vite (giao diện theo design system ikqa của canvas)
workspaces/<app>/  project WebdriverIO của từng app (tool sinh)
data/              store, ảnh màn, report từng run (data/runs/RUN-xxxx/reports)
```

## Giới hạn đã biết (demo)

- Một job dùng thiết bị tại một thời điểm (lấy locator hoặc run), cho cả máy.
- Android: đã thử trên emulator với app mẫu ApiDemos + `samples/apidemos-automation.xlsx`; chưa có APK của IK Fitness và chưa có helper pack Android.
- Case sau một case bị chặn trong cùng chuỗi được đánh Blocked (không tự đi tắt về màn bắt đầu như `ik-fitness`).
- Tự khám phá có thể tách một màn thành hai khi màn đổi nhiều (vd đổi kg/lbs) — gộp tay ở Locator map.
- Tên màn tự đoán từ tiêu đề ("What is your sex?") có thể khác cột Screen trong Excel ("Sex"); AI tự khớp và báo cảnh báo.
- Workspace tạo trước khi template của tool đổi cần bấm **Cài đặt app → Chuẩn bị lại**.

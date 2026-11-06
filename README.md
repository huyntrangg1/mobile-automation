# QA Pipeline — bản demo

Tool web chạy trên Mac: **thêm app → lấy locator → import Excel test case → AI gen script → Run trên iOS Simulator hoặc Android → report**.
Bản demo cho một người, một máy. Bản thật cho cả team: xem tài liệu bàn giao bên dưới.

## Tài liệu bàn giao

| Tài liệu | Link |
|---|---|
| Spec bản thật (chức năng từng màn, mô hình dữ liệu, việc cần làm) | https://claude.ai/artifact/5fc6qKPU3oybSUvvaKswz1 |
| UI design theo luồng (20 màn + chú thích cho dev) | https://claude.ai/artifact/1dtVCmkjQsipJRYva4u9Ez |
| Spec report chung (skill `test-report`) | https://claude.ai/artifact/LYY1m6GNmcJyU5Nfouvi3S |
| Ảnh chụp bản demo theo luồng | `docs/design/index.html` |
| Video demo | `docs/qa-pipeline-demo-full.mp4` |
| File build (.app, .apk) + Excel test case IK Fitness | [link Drive] |

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

### Chia sẻ cho team (mạng LAN)

`npm start` mở server cho cả mạng LAN (in ra link dạng `http://192.168.x.x:5178` để gửi team). Không cần đăng nhập.
Ai mở được link đều dùng được mọi chức năng (chạy test, xem biến môi trường của app), nên chỉ dùng trong mạng nội bộ tin cậy.
Chỉ cho máy này truy cập như cũ: `HOST=127.0.0.1 npm start`.
Người dùng máy khác thêm app bằng nút **Chọn file .apk / .zip** (iOS: nén thư mục `.app` build cho Simulator thành `.zip`); file lưu ở `data/uploads/`.
Thiết bị vẫn dùng chung: mỗi lúc một job (lấy locator hoặc run) cho cả team.

### Report chung và helper pack

- Report dùng bản trong `vendor/test-report/` (copy từ skill `test-report` của team). Bản gốc là skill: khi skill đổi, đặt skill ở `../.claude/skills/test-report` rồi chạy `npm run sync-report` (copy vào vendor + cài lại cho mọi app). `npm run doctor` báo khi hai bản lệch nhau.
- Helper pack **ik-fitness** (page object, kéo thước, popup iOS… của app IK Fitness) là tuỳ chọn: chỉ hiện khi có thư mục `../ik-fitness` cạnh tool. Không có thì mọi app vẫn chạy, AI tự viết các thao tác.

## Luồng 5 bước

1. **Apps → Thêm app**: đường dẫn file `.app` (iOS Simulator) hoặc `.apk` (Android) — tool tự nhận nền tảng; tên, helper pack (chỉ pack cùng nền tảng). Tool tạo project WebdriverIO riêng cho app
   ở `workspaces/<app>/` (cài report chung bằng `vendor/test-report/scripts/install.sh`) — khoảng 1–2 phút.
2. **Locator map → Lấy locator**, chọn 1 trong 2 chế độ:
   - *Ghi lại khi tôi bấm*: bạn bấm qua app trên thiết bị (cửa sổ Simulator / emulator), tool ghi lại từng màn (đọc mỗi 0,7 s).
     Popup hệ thống (quyền theo dõi, lưu mật khẩu, hộp xin quyền Android) che màn hình thì tool nhắc bạn đóng.
   - *Tự khám phá*: AI tự bấm qua app (giới hạn số bước và 20 phút); cho trước email / mật khẩu test để AI vượt form.
   Sau đó đổi tên màn cho khớp cột Screen trong Excel, gộp màn trùng, đặt tên Target cho ô nhập không có nhãn.
3. **Test Cases → Import Excel** (format automation v2: sheet TestCases + TestData). File được copy vào workspace;
   import lại file đã sửa → case đổi bước chuyển "Cần gen lại".
4. Chọn case → **Generate script**. Mỗi file Excel là **một** file `tests/<file>.e2e.js`; mỗi case là một region do AI viết.
   **Scripts** (tuỳ chọn): xem / sửa code, cảnh báo thiếu locator, đánh dấu đã review.
5. Chọn case → **Run** → chọn thiết bị → **Start run**. Case "Tiếp nối" tự kéo theo các case phía trước. Theo dõi trực tiếp, xong mở report
   (`bug-report.html` của skill `test-report`). Kết quả ghi vào bản copy Excel trong workspace; file gốc không đổi.
   Khi một step không làm được, tool xử lý theo thứ tự:
   - **Không thấy phần tử** (Tap / Enter): tự tìm trên màn đang hiện — khớp chữ trước, không được thì AI chọn 1 phần tử trong danh sách; tìm được thì chạy tiếp và lưu locator cho lần sau (`AUTO_RESOLVE=0` để tắt). Chỉ sửa được locator sai khi app đang ở đúng màn.
   - **Sửa tay khi lỗi** (ô chọn ở màn Run): step vẫn kẹt thì dừng lại cho bạn chọn Block, Skip step, Retry, Use element hoặc Fix script rồi chạy tiếp. Khi app đang ở màn khác màn step cần, hộp thoại báo lỗi nhiều khả năng ở bước trước.
   - **Case lỗi không phải điểm kiểm lệch** (không thấy phần tử, không tới được màn, lỗi thiết bị; không áp dụng khi bật Sửa tay): tự **phục hồi một lần** — cài lại app, chạy lại các case trước của chuỗi (không ghi report) rồi thử lại case đó (`AUTO_RECOVER=0` để tắt). Chỉ cứu được lỗi chập chờn.
   - **Case "Tiếp nối" sau một case bị chặn**: cài lại app rồi đi theo sơ đồ màn (ghi từ các lần chạy trước cùng build, lưu ở `workspaces/<app>/data/nav-graph.json`) tới màn bắt đầu của case đó, không chạy lại case trước (`AUTO_NAVIGATE=0` để tắt). Case ghi dòng này vào Pre-condition.

**AI Smoke Test** (mục riêng ở menu bên trái): AI tự mò app theo PRD và / hoặc Figma rồi báo điểm lệch. Không sinh test case.
1. Dán link PRD (begamob), link Figma (có `node-id`) và / hoặc chọn **file Figma `.json`** (xuất bằng plugin `figma-plugin/`, có sẵn ảnh frame, màu, chữ; **không gọi Figma MCP**, nên không tốn hạn mức gói Starter; có file thì link Figma bị bỏ qua) — cần ít nhất một trong ba — chọn thiết bị, bấm **Chạy smoke test**. Tuỳ chọn: ghi chú cho AI, tài khoản test (chỉ dùng trong lần chạy, không lưu).
2. App được cài sạch. AI tự **chuẩn bị**: đi qua onboarding, cho phép quyền tính năng cần (Health, thông báo, camera…; chỉ từ chối theo dõi quảng cáo), đóng quảng cáo / paywall (không bao giờ mua) tới màn chính. Không tới được thì lần chạy dừng với lý do.
3. **So bằng code khi có file Figma `.json`:** khi AI thấy màn đang hiện ĐÚNG là một frame trong file (`atFrame`), tool dùng bộ so ảnh với Figma (`server/ui/analyze.js`) để đo **vị trí, kích thước, màu nền, màu chữ, cỡ chữ, chữ thiếu** (tối đa 6 điểm lệch mỗi frame, bỏ lệch Trivial), không dùng AI nên không tốn thêm token. Điểm lệch có ảnh so Figma (trái) · App (phải). Nhận diện đúng màn vẫn là nhận định của AI.
3b. AI rút các luồng chính (tối đa 8) từ PRD / Figma rồi chạy từng luồng (tối đa 25 bước, 5 phút mỗi luồng, 20 phút cả lần). Mỗi luồng ra: khớp · có lệch · không tới được · không kiểm được. Điểm lệch có nhãn nguồn (lệch PRD · lệch Figma · PRD và Figma mâu thuẫn · PRD chưa rõ), kèm ảnh app, ảnh Figma và đoạn PRD. Nút **Mở report ngắn** ra trang HTML một màn.
4. Cần đăng nhập MCP `begamob` và `figma` một lần bằng `/mcp` trong Claude Code (tool gọi `claude -p`, nó **không** nạp connector claude.ai). Kết quả là nhận định của AI, có thể nhầm: mỗi điểm lệch có ảnh và đoạn PRD để kiểm lại. Tốn token (mỗi bước một lần gọi AI); các bước thao tác dùng chế độ gọn của `runClaude` (`lean`).

**Cài đặt app**: biến môi trường truyền vào mỗi lần Run (`${env.X}` trong Excel, `ALLOW_ACCOUNT_CREATE`…).

## Cấu trúc

```
server/            Express API + SSE; store JSON ở data/ (app.js, index.js, store.js, lock.js, events.js, paths.js)
  routes/          các router Express
  ai/              runClaude() + prompt
  net/             địa chỉ LAN để chia sẻ link cho team
  device/          simulator / emulator (iOS + Android), phiên Appium (cổng 4724) để lấy locator
  locators/        page source → phần tử / locator, locator map, 2 chế độ lấy locator
  apps/            tạo workspace (template/ + helper pack)
  testcases/       import Excel, chuỗi Tiếp nối
  scripts/         khung file script + AI gen từng case
  runs/            chạy wdio, theo dõi results/
web/               React + Vite (giao diện theo design system ikqa của canvas)
scripts/           doctor, sync-report, smoke-session
vendor/test-report/ bản copy report chung (skill test-report)
figma-plugin/      plugin Figma xuất frame (.json, kèm chuyển cảnh prototype) cho AI Smoke Test
server/smoke/        AI Smoke Test: rút luồng từ PRD / Figma (plan.js), vòng chạy trên thiết bị (run.js), popup quyền (alerts.js), ảnh frame Figma, report ngắn
server/ui/         thao tác thiết bị (device.js) và so ảnh chụp với frame Figma (analyze.js), dùng cho AI Smoke Test
samples/           app + Excel mẫu (Android ApiDemos)
test/              test server (node:test)
docs/              ảnh demo theo luồng, video
workspaces/<app>/  project WebdriverIO của từng app (tool sinh)
data/              store, ảnh màn, report từng run (data/runs/RUN-xxxx/reports)
```

## Giới hạn đã biết (demo)

- Một job dùng thiết bị tại một thời điểm (lấy locator hoặc run), cho cả máy.
- Android: đã thử trên emulator với app mẫu ApiDemos + `samples/apidemos-automation.xlsx`; chưa có APK của IK Fitness và chưa có helper pack Android.
- Điều hướng thay cho case bị chặn chỉ đi được khi sơ đồ màn của build hiện tại đã có đường (cần chạy qua các màn đó ít nhất một lần sau khi đổi build). Không có đường, hoặc đi không tới → case vẫn Blocked. Mới đảm bảo đúng **màn**, chưa kiểm dữ liệu case trước tạo ra (lựa chọn, tài khoản) — case chạy kiểu này có ghi chú trong Pre-condition. Chưa có AI điều hướng khi thiếu đường đi.
- Phục hồi tự động chỉ thử lại một lần và chỉ cứu được lỗi chập chờn; lỗi lặp lại ở cả hai lần vẫn Blocked.
- Sơ đồ màn chỉ ghi được ở workspace có `steps.js` bản mới (có `recordEdge`). Workspace tạo trước đó vẫn chạy được nhưng chưa có sơ đồ nên không điều hướng được; **Chuẩn bị lại không ghi đè `steps.js`** — cần chép lại từ `server/apps/template/src/runner/steps.js` (hoặc vá tay nếu đã sửa riêng).
- Tự khám phá có thể tách một màn thành hai khi màn đổi nhiều (vd đổi kg/lbs) — gộp tay ở Locator map.
- Tên màn tự đoán từ tiêu đề ("What is your sex?") có thể khác cột Screen trong Excel ("Sex"); AI tự khớp và báo cảnh báo.
- Workspace tạo trước khi template của tool đổi cần bấm **Cài đặt app → Chuẩn bị lại**.

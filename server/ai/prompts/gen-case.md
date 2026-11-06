Bạn viết code WebdriverIO (Appium, {{platform}}) cho MỘT test case của app "{{appName}}". Code chạy trong file `tests/{{file}}.e2e.js` của workspace. Mọi thứ cần đã có trong prompt này (không đọc file) — trả JSON ngay.

# Hợp đồng
Trả về `body`: một biểu thức hàm, đúng dạng
```js
async ({ tc, data, sa, fill, k }) => {
  // ...
}
```
Khung file đã có sẵn:
- Case bắt đầu ở trạng thái nào: xem dòng "Bắt đầu" của case bên dưới.
- `k` — bước dùng chung (src/runner/steps.js). **Mỗi dòng Tap / Enter / Nav / Verify … là 1 lời gọi `k.xxx`.** Không tự định nghĩa lại helper (nav, byText, checkShown, tapAction, labelOf …) trong case.
- `L[màn][target]` — locator map (bên dưới). `driver`, `$`, `$$` là global của WebdriverIO.
- `sa` = softAssert() — khung tự gọi `sa.assertAll()` sau khi hàm xong.
- `fill(str)` — thay `${cột TestData}`, `${env.X}`, `${gen.fn(arg)}` trong Value; luôn bọc Value có `${` bằng `fill('...')`, không tự tính.
- **Không gọi `snapshot` / `sa.eq` / `logStep` trực tiếp.** Điểm kiểm cho keyword `k` chưa có: tự đọc giá trị rồi gọi `k.check(...)`; thao tác riêng: làm xong gọi `k.log(...)`.
- Namespace helper đã import (namespace: export):
{{helpers}}
- KHÔNG được gọi `runTestcase` hay keyword runner.
{{keywords}}

# `k` — 1 dòng test case = 1 lời gọi
`screen` = tên màn ở cột Screen của dòng đó (đúng như trong Excel). `label` = cột Check label. `sel` = locator trong `L`; bỏ trống thì `k` tìm theo chữ của target.
{{kTable}}
- Hộp thoại hệ thống **không có trong test case** (vd ATT "Allow … to track" bật lên lúc mở app): không viết code xử lý — `k` tự đóng khi nó che màn (theo biến SYSTEM_ALERT của app, mặc định từ chối). Test case có dòng bấm / xử lý hộp thoại theo dõi ("Ask App Not to Track") → `k.permission(step, screen, 'Ask App Not to Track', "Don't allow")`; `k` tự đi tiếp nếu hộp thoại đã được đóng trước đó.
- **Không tự viết vòng lặp gọi thẳng `$()` / `$$()` / `ui.*`** để duyệt nhiều phần tử (đọc trạng thái chọn, bỏ chọn từng mục…): mỗi lời gọi chờ phần tử tới 15s, vòng lặp treo cả case. Bỏ chọn tất cả (kể cả khi Pre-condition ghi "bỏ chọn tất cả …") → `k.deselectAll(...)`; đọc / kiểm từng mục → `k.selected` / `k.count` / `k.order`.
- `k.byText(text)` = selector theo chữ (đúng cú pháp nền tảng). Selector của evidence phải là chính phần tử được kiểm.
- **Verify text: không tìm phần tử bằng chính chữ của nó** khi chữ đó có thể khác lúc chạy (đổi theo lựa chọn / dữ liệu, hoặc Value khác chữ đang có trong locator map) — phần tử trong map có tên là chữ cũ sẽ không thấy và bug ghi sai "không hiển thị". Chọn theo vị trí / loại, vd chữ ngay dưới title: `-ios predicate string:type == "XCUIElementTypeStaticText" AND visible == 1 AND name != "<title>"`. Title cố định của màn thì dùng locator trong map bình thường.
- **Target không có trong L:** dùng `k.byText(...)` hoặc `~id` nếu đoán được, và ghi `warnings` đề nghị tester thêm phần tử vào Locator map. **Không** tự chế locator lọc theo `visible == 1` trên loại phần tử phổ biến (`XCUIElementTypeImage`, `Other`, `Cell`… vd `-ios class chain:**/XCUIElementTypeImage[\`visible == 1\`]`): iOS phải kiểm tra từng phần tử, mất vài giây tới hàng chục giây — màn tự chuyển (slide, animation) sẽ chạy mất trong lúc chờ. Vùng bấm phủ một ảnh thường đã có trong L dưới tên khác (vd nút "Tap here" phủ ảnh tutorial).
- **Chuyển màn không có dòng Nav:** hai dòng liền nhau có cột Screen khác nhau (sang màn mới của app) mà Excel không có dòng Nav / Verify screen ở giữa → ngay sau thao tác cuối trên màn cũ, gọi `await k.nav(mànMới, selĐặcTrưngCủaMànMới, what)`. Thao tác đó không đưa app sang màn mới thì lỗi bị bắt đúng ở thao tác đó (tester được hỏi về chính nó), không để tới bước sau mới lỗi trên màn sai. Không chèn khi màn mới là trình duyệt / trang ngoài, hộp thoại hệ thống, hoặc chỉ là tên khác của cùng màn.
- Dòng Platform khác "All" và khác "{{platform}}" → bỏ qua (Platform ở dòng Case do khung tự xử lý — không viết code).
- Locator trong L đã đúng cú pháp của nền tảng (iOS: `~id`, `-ios predicate string:…`, `-ios class chain:…`; Android: `~content-desc`, `android=new UiSelector()…`).

{{skillRules}}

{{appNotes}}

# Màn trong Excel ↔ locator map
Tên màn trong cột Screen có thể khác tên trong locator map (vd "Sex" ↔ "What is your sex?"). Tự khớp theo nội dung và dùng tên của locator map trong `L[...]` (tham số `screen` của `k` vẫn là tên trong Excel). Target không có trong L: bỏ trống `sel` (hoặc `k.byText(...)`) và ghi một dòng trong `warnings`.

# Case {{tcId}} — {{title}}
Bắt đầu: {{freshNote}}
Pre-condition:
{{pre}}
Các dòng (Step | Screen | Kind | Keyword | Target | Value | Compare | Check label):
{{rows}}

# Locator map của app
Dòng `- Type "phần tử"` dưới `## "màn"` → dùng `L['màn']['phần tử']`.
{{locators}}

# Ví dụ (case khác, chỉ để tham khảo cách viết)
```js
async ({ tc, data, sa, fill, k }) => {
  const W = L['Welcome'];
  const LI = L['Log In'];
  await k.tap(1, 'Welcome', 'Continue with email', W['Continue with email']);
  await k.nav('Log In', LI['Log In'], 'tiêu đề "Log In"');
  await k.shown(1, 'Log In', 'Continue with email', 'Nút Continue with email hiển thị', LI['Continue with email']);
  await k.text(1, 'Log In', 'Title', 'Tiêu đề màn Log In', LI['Log In'], 'Log In');
  await k.enter(2, 'Log In', 'Email', fill('${email}'), LI['Enter your email']);
  await k.enabled(2, 'Log In', 'Continue with email', 'Nút Continue with email bị disable khi email sai', LI['Continue with email'], false);
}
```
{{retry}}

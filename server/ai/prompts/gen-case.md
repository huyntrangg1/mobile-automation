Bạn viết code WebdriverIO (Appium, {{platform}}) cho MỘT test case của app "{{appName}}". Code chạy trong file `tests/{{file}}.e2e.js` của workspace (thư mục hiện tại — dùng Read để xem helper nếu cần). Không viết file, chỉ trả JSON.

# Hợp đồng
Trả về `body`: một biểu thức hàm, đúng dạng
```js
async ({ tc, data, sa, fill }) => {
  // ...
}
```
Khung file đã có sẵn:
- {{freshNote}}
- `L[màn][target]` — locator map (bên dưới). `driver`, `$`, `$$` là global của WebdriverIO.
- `sa` = softAssert() — khung tự gọi `sa.assertAll()` sau khi hàm xong.
- `fill(str)` — thay `${cột TestData}`, `${env.X}`, `${gen.fn(arg)}` trong Value; luôn bọc Value có `${` bằng `fill('...')`, không tự tính.
- `snapshot(screen, { k: selector }, { k: anchor })` (src/utils/evidence.js), `logStep({...})` (src/report/collector.js).
- Namespace helper đã import (namespace: export):
{{helpers}}
- KHÔNG được gọi `runTestcase` hay keyword runner. Có thể đọc `src/runner/keywords.js` (nếu có) để học cách app này làm từng keyword (vd Enter vào ô Email/Password qua page object, Set ruler, Select date, popup hệ thống) rồi gọi các helper / page object tương ứng.

# Viết từng dòng của case
- Action: thực hiện, rồi `logStep({ kind: 'Action', step, screen, keyword, target, value, ok: true })`. Tap → `ui.tap(sel)`; Enter → nhập giá trị (ô nhập trong L thường là class chain); Back → nút Back của màn.
- Nav (Verify screen): chờ phần tử đặc trưng của màn đích (`ui.el(sel, 15000)`); không thấy thì `throw new Error('Không tới được màn X: …')` — đừng đưa vào sa.
- Check: đọc giá trị thật TRÊN MÀN ĐÓ, gọi `snapshot` trước khi rời màn, rồi `sa.eq(step, label, actual, expected, ev.k, { keyword, target, value, screen })`. label = cột Check label.
  - Verify displayed → actual = `await ui.exists(sel, 3000)`, expected = true; Verify not displayed → expected = false (exists ngắn, 1500ms).
  - Verify enabled / disabled → actual = `await (await ui.el(sel)).isEnabled()`, expected true / false.
  - Verify text / Verify value → actual = chữ / value đọc được (label, name hoặc value của phần tử), expected = fill(Value). Cột Compare = "contains" thì so sánh chứa.
  - Selector của evidence phải là chính phần tử được kiểm. Kiểm "hiển thị" có thể truyền anchor (phần tử ngay trên chỗ đó, vd ô Password cho dòng lỗi dưới nó).
- Dòng Platform khác "All" và khác "{{platform}}" → bỏ qua.
- Locator trong L đã đúng cú pháp của nền tảng (iOS: `~id`, `-ios predicate string:…`, `-ios class chain:…`; Android: `~content-desc`, `android=new UiSelector()…`). Selector theo chữ khi thiếu locator: iOS `-ios predicate string:name == "…" OR label == "…"`, Android `android=new UiSelector().text("…")`.

{{skillRules}}

# Màn trong Excel ↔ locator map
Tên màn trong cột Screen có thể khác tên trong locator map (vd "Sex" ↔ "What is your sex?"). Tự khớp theo nội dung và dùng tên của locator map trong `L[...]`. Target không có trong L: dùng selector theo chữ (cú pháp ở trên) và ghi một dòng trong `warnings`.

# Case {{tcId}} — {{title}}
Pre-condition:
{{pre}}
Các dòng (Step | Screen | Kind | Keyword | Target | Value | Compare | Check label):
{{rows}}

# Locator map của app
{{locators}}

# Ví dụ (case khác, chỉ để tham khảo cách viết)
```js
async ({ tc, data, sa, fill }) => {
  await ui.tap(L['Welcome']['Continue with email']);
  logStep({ kind: 'Action', step: 1, screen: 'Welcome', keyword: 'Tap', target: 'Continue with email', value: '', ok: true });
  await ui.el(L['Log In']['Log In'], 15000).catch(() => { throw new Error('Không tới được màn Log In: không thấy tiêu đề "Log In" sau 15s'); });
  const shown = await ui.exists(L['Log In']['Continue with email'], 3000);
  const ev = await snapshot('Log In', { k: L['Log In']['Continue with email'] });
  sa.eq(1, 'Nút Continue with email hiển thị', shown, true, ev.k, { keyword: 'Verify displayed', target: 'Continue with email', value: '', screen: 'Log In' });
}
```
{{retry}}

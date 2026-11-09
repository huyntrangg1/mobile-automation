| Dòng (Kind · Keyword) | Gọi |
|---|---|
| **Action · vòng đời app** | |
| Launch fresh | khung đã cài lại + mở app khi case "Cài lại app" → chỉ `k.log(step, screen, 'Launch fresh', '')` |
| Relaunch app | `await k.relaunch(step, screen)` — kill rồi mở lại |
| Reset app data | `await k.resetData(step, screen)` |
| Background app | `await k.background(step, screen, value)` — value = số giây |
| Open deep link / Open URL | `await k.deepLink(step, screen, fill(value))` / `await k.openUrl(step, screen, fill(value))` |
| Open notification | `await k.openNotification(step, screen, target)` — target = tiêu đề thông báo |
| **Action · chạm, nhập, cuộn** | |
| Tap | `await k.tap(step, screen, target, sel?)` |
| Double tap / Long press | `await k.doubleTap(step, screen, target, sel?)` / `await k.longPress(step, screen, target, sel?, value?)` — value = số giây giữ |
| Tap outside | `await k.tapOutside(step, screen, target, selCủaSheet?)` |
| Close popup | `await k.closePopup(step, screen, target, sel?, value?)` — popup / tờ trong app CÓ THỂ hiện (mời đăng nhập, đánh giá…): hiện thì bấm nút đóng `target`, không hiện trong value giây (mặc định 3) thì bỏ qua, không lỗi |
| Toggle | `await k.toggle(step, screen, target, sel, value)` — value on / off |
| Deselect all | `await k.deselectAll(step, screen, target, selKhớpCácMục)` |
| Enter / Clear | `await k.enter(step, screen, target, fill(value), sel)` / `await k.clear(step, screen, target, sel)` |
| Press key / Hide keyboard | `await k.pressKey(step, screen, value)` / `await k.hideKeyboard(step, screen)` |
| Set ruler | `await k.ruler(step, screen, target, selThước, selChữSốĐangHiện, value)` (helper pack có hàm riêng cho thước của app → dùng hàm đó rồi `k.log`) |
| Select picker / Select date | `await k.selectPicker(step, screen, target, sel, fill(value))` / `await k.selectDate(step, screen, target, sel, fill(value), 'DD/MM/YYYY')` — định dạng lấy từ Compare `date:…` nếu có |
| Scroll / Scroll to | `await k.scroll(step, screen, value, selVùngCuộn?)` / `await k.scrollTo(step, screen, target, sel?)` |
| Swipe | `await k.swipe(step, screen, value, sel?, target?)` — value = up / down / left / right |
| Back | `await k.back(step, screen)` — Android phím Back; iOS **bấm nút Back / ← của màn** (không vuốt — app có thể tắt vuốt mép). Không suy ra thao tác khác (vuốt…) từ label / title |
| Close browser | `await k.closeBrowser(step, screen)` — k tự xử lý Safari / Chrome ngoài app lẫn trình duyệt trong app; không tự tìm nút Done / "◀ App" |
| **Action · hệ thống, thời gian** | |
| Handle permission / hộp thoại hệ thống | `await k.permission(step, screen, target, value, { label? })` — value Allow / Don't allow (k tự chọn đúng chữ nút theo iOS / ngôn ngữ). Có dòng Verify displayed nút đó → truyền `label` |
| Set network | `await k.setNetwork(step, screen, value)` — chỉ Android |
| Wait | `await k.wait(step, screen, value)` |
| Wait until displayed / not displayed / enabled | `await k.waitDisplayed(...)` / `await k.waitNotDisplayed(...)` / `await k.waitEnabled(...)` — `(step, screen, target, sel?, value)`, value = timeout giây |
| **Action · dữ liệu, hook** | |
| Save value / Set variable / Generate data | `await k.saveValue(step, screen, target, sel, value)` / `await k.setVar(step, screen, target, fill(value))` / `await k.generate(step, screen, target, value)` — tên biến: Save value = value, hai keyword kia = target. `{{tên}}` ở Value dòng sau: luôn bọc `fill(value)` |
| Run setup | `await k.runSetup(step, screen, value)` |
| Run flow | không có — dòng Run flow đã được thay bằng các dòng của luồng (cột Flow) |
| **Nav (sai → Blocked)** | |
| Verify screen | `await k.nav(screen, sel, what, timeout?)` — `sel` = phần tử đặc trưng của màn đích (tiêu đề hoặc nút sẽ bấm tiếp; **có tên** — không dùng locator `point:…` chỉ có toạ độ), `what` = `'nút "Continue"'` / `'tiêu đề "Log In"'`. Màn chuyển chậm → timeout 30000. Không đưa vào sa |
| **Check (sai → Failed)** — `opts.compare` = cột Compare (bỏ trống nếu trống) | |
| Verify screen (Kind Check) | `await k.screen(step, screen, label, selTiêuĐềMàn)` |
| Verify displayed | `await k.shown(step, screen, target, label, sel?, { anchor? })` — anchor: phần tử ngay trên chỗ lẽ ra hiện |
| Verify not displayed | `await k.notShown(step, screen, target, label, sel?, { within: value })` — value = số giây chờ ngược (bỏ trống nếu Value trống) |
| Verify text | `await k.text(step, screen, target, label, sel, fill(value), { compare?, strip? })` — câu bị tách nhiều phần tử → `sel` là mảng; Value thiếu ký tự trang trí app có (vd ✨) → `strip: '✨'` |
| Verify value / placeholder | `await k.value(step, screen, target, label, sel, fill(value), { compare? })` / `await k.placeholder(...)` cùng tham số |
| Verify focused | `await k.focused(step, screen, target, label, sel)` |
| Verify keyboard displayed / not displayed | `await k.keyboard(step, screen, label, true / false)` |
| Verify attribute | `await k.attribute(step, screen, target, label, sel, value, { compare? })` — value dạng `checked=true` |
| Verify enabled / disabled | `await k.enabled(step, screen, target, label, sel?, true / false)` |
| Verify selected / not selected | `await k.selected(step, screen, target, label, sel?, true / false)`. Compare `all-on` → `await k.allOn(step, screen, target, label, selKhớpCácMục)` |
| Verify count / Verify order | `await k.count(step, screen, target, label, selKhớpCácMục, value, { compare? })` / `await k.order(step, screen, target, label, selKhớpCácMục, value)` — k tự cuộn hết danh sách; `selKhớpCácMục` phải khớp **từng mục** (không khớp cả khung danh sách) |
| Verify layout | `await k.layout(step, screen, target, label, sel, value)` — value nguyên văn cột Value (luật "width <= 260; lines = 2; spaceBelow >= 36"…). `sel` là chính phần tử được đo (chữ / nút có tên), không dùng phần tử chỉ có toạ độ |
| Verify external URL | `await k.url(step, screen, target, label, fill(value), { compare? })` — k tự chờ trang tải rồi đọc URL đầy đủ; **không tự đọc thanh địa chỉ** |
| Verify app opened | `await k.appOpened(step, screen, label, value)` |
| Run check | `await k.runCheck(step, screen, value, label)` |
| Keyword không có trong bảng | code riêng bằng helper / page object; điểm kiểm → `await k.check(step, screen, keyword, target, label, sel, actual, expected)`; thao tác → `k.log(step, screen, keyword, target, value)` |
| Bấm liền nhau trên màn chuyển bước (tutorial, coachmark) mà nút kế tiếp trùng chữ | `await k.gone(screen, selPhầnTửCủaBướcCũ, what)` rồi mới bấm tiếp — không dùng `driver.pause` |
- **Pre-condition** có bước thao tác (ngoài dòng "Cài lại app" / "Tiếp nối …"): BẮT BUỘC làm các bước đó bằng `k` trước dòng đầu tiên của case, `step` = Step của dòng đầu. Không bỏ qua, không giả định app đã ở đúng màn.
- **Target không có trong L (màn chưa lấy locator, phần tử chưa có trong map):** gọi `k.tap` / `k.enter` với `sel` bỏ trống (hoặc `k.byText(chữ)` nếu chắc chữ hiện trên màn). Lúc chạy không thấy, `k` tự tìm phần tử theo **mô tả target** trên màn đang hiện (khớp chữ, không chắc thì AI chọn) rồi lưu lại cho lần sau → viết target đúng như Excel, đủ ý để nhận ra phần tử. Không tự chế locator khác.

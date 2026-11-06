| Dòng | Gọi |
|---|---|
| Tap | `await k.tap(step, screen, target, sel?)` |
| Enter | `await k.enter(step, screen, target, fill(value), sel)` |
| Nav (Verify screen) | `await k.nav(screen, sel, what, timeout?)` — `sel` = phần tử đặc trưng của màn đích (tiêu đề hoặc nút sẽ bấm tiếp), `what` = `'nút "Continue"'` / `'tiêu đề "Log In"'`. Màn chuyển chậm (loading) → timeout 30000. Không đưa vào sa. |
| Verify displayed | `await k.shown(step, screen, target, label, sel?, { anchor? })` — anchor: phần tử ngay trên chỗ lẽ ra hiện |
| Verify not displayed | `await k.notShown(step, screen, target, label, sel?)` |
| Verify text / value | `await k.text(step, screen, target, label, sel, fill(value), { compare?, strip? })` — compare = cột Compare ('contains'). Câu bị tách nhiều phần tử → `sel` là mảng `[sel1, sel2]` (k tự ghép). Value không có ký tự trang trí mà app có (vd ✨) → `strip: '✨'` |
| Verify enabled / disabled | `await k.enabled(step, screen, target, label, sel?, true / false)` |
| Verify selected | `await k.selected(step, screen, target, label, sel?, true / false)` — trạng thái được chọn (goal, tab, radio…) |
| Verify khác k chưa có (Verify value, đếm số lượng…) | đọc giá trị bằng helper rồi `await k.check(step, screen, keyword, target, label, sel, actual, expected)` — `sel` là phần tử được kiểm (evidence) |
| Back | `await k.back(step, screen)` — **nhấn nút Back** (iOS: nút Back / ← của màn; Android: phím Back). Keyword Back luôn là nhấn Back — không suy ra thao tác khác (vuốt…) từ label / title |
| Hộp thoại hệ thống (tracking ATT, thông báo, vị trí…) | `await k.alert(step, screen, 'allow' | 'deny', { label? })` — truyền **ý định**, không truyền chữ nút (chữ nút khác nhau theo iOS / ngôn ngữ: Allow, Allow While Using App, Ask App Not to Track, Don’t Allow, Cho phép…; k tự chọn đúng nút). Excel ghi "Allow" / "Cho phép" → 'allow'; "Don't Allow" / "Ask App Not to Track" / "Từ chối" → 'deny'. Có dòng Verify displayed nút đó → truyền `label` (gộp luôn, không gọi `k.shown` riêng) |
| Bấm liền nhau trên màn chuyển bước (tutorial, coachmark) mà nút kế tiếp trùng chữ | `await k.gone(screen, selPhầnTửCủaBướcCũ, what)` rồi mới bấm tiếp — không dùng `driver.pause` |
| Keyword khác (Set ruler, Select date, Back …) | code riêng bằng helper / page object, rồi `k.log(step, screen, keyword, target, value)` |

# Chế độ "Sửa tay khi lỗi" (Manual fix) cho lần chạy test

Ngày: 2026-10-28 · Người yêu cầu: QA (trangnth) · Tham khảo: hộp thoại "Pick the element" của SimUtil

## Mục đích
Hiện nay một step không làm được (không tới được màn, không thấy phần tử để bấm) làm cả case dừng ở **Blocked**: mọi step phía sau không được kiểm, dù lỗi có khi chỉ là locator lệch. Tester muốn **sửa tại chỗ rồi chạy tiếp**, để vẫn kiểm được phần còn lại của case, mà **bug vẫn được log đúng**.

## Mục tiêu
- Tuỳ chọn khi bấm Run: **"Sửa tay khi lỗi"** (mặc định tắt). Tắt → chạy y như bây giờ.
- Bật: step lỗi chặn luồng → test **dừng tại step đó** (giữ app + phiên Appium), màn Run hiện hộp thoại cho tester chọn cách xử lý, rồi case **chạy tiếp**.
- Hộp thoại có: tên step (case, step, row, màn theo Excel), câu lỗi, ảnh màn hình hiện tại, danh sách phần tử trên màn (lọc được, bấm vào ảnh để chọn phần tử), gợi ý "Có phải ý bạn là…" (phần tử gần giống target nhất).
- 5 lựa chọn và cách log bug (đã chốt với người yêu cầu):

| Lựa chọn | Hành vi | Bug |
|---|---|---|
| **Block** | Dừng case như hiện nay | Log bug chặn luồng (như hiện nay) |
| **Skip step** | Bỏ qua step này, chạy step kế | Log bug |
| **Retry** | Thử lại step (vd app load chậm) | Không log nếu lần thử lại thành công |
| **Use element** | Dùng phần tử tester chọn **cho lần chạy này**, chạy tiếp | **Vẫn log bug** (app khác test case) |
| **Fix script & go on** | Lưu phần tử đã chọn cho **các lần chạy sau**, chạy tiếp | **Không log bug** (tester xác nhận script sai, app đúng) |

## Không làm (non-goals)
- Không dừng ở điểm kiểm sai (Verify text / displayed …): soft assert vẫn log bug và chạy tiếp như hiện nay.
- Không gọi AI trong lúc chạy (chạy test phải không tốn token).
- Không áp dụng cho chạy CI / không có người — chế độ tắt mặc định.

## Không được xảy ra (anti-goals)
- Bật chế độ mà không ai trả lời → run treo mãi. (Có nút Stop sẵn; xem "Hết giờ chờ" bên dưới.)
- "Fix script" ghi đè region case do tester sửa tay, hoặc làm hỏng script khi gen lại.
- Bug bị mất hoặc trùng: một step lỗi chỉ ra **một** bug.

## Bối cảnh kỹ thuật (đã có sẵn)
- Runner (`server/runs/runner.js`) chạy wdio với `LIVE_STEPS` (live.jsonl), `PAUSE_FILE` (tạm dừng giữa case bằng file), ảnh live `screen.jpg`; sự kiện realtime qua `emit('run', …)` → `useEvents` ở `web/src/pages/RunView.jsx`.
- Script AI gen dùng bước chung `k` (`server/apps/template/src/runner/steps.js`, chép vào mỗi workspace): `k.tap`, `k.nav`, `k.enter`, `k.alert`, `k.gone`, `k.shown`, `k.text`… Lỗi chặn luồng đều đi qua đây: `k.nav` ("Không tới được màn X: không thấy …"), `k.tap/enter` (không thấy phần tử), `k.alert`, `k.gone`.
- Mọi lời gọi `k` có `step`, `screen` (tên màn theo Excel), `target` → biết row trong test case (`case.rows`).
- Report (skill `test-report`, `.claude/skills/test-report/`) dựng bug từ result JSON; bug chặn luồng từ câu lỗi + `seen` (màn đang hiện, từ `screenSummary()`).

## Cách làm (đã quyết)
1. **Chỗ chặn:** trong `k`, các bước chặn luồng (`tap`, `enter`, `nav`, `alert`, `gone`) bọc bằng một hàm chung: khi lỗi và chế độ bật (`env MANUAL_FIX=1`) → hỏi tester thay vì ném lỗi ngay. Chế độ tắt → ném lỗi như cũ.
2. **Hỏi – đáp qua file** (cùng kiểu `PAUSE_FILE`): worker ghi `help.json` (case, step, row, screen, target, câu lỗi, đường dẫn ảnh, danh sách phần tử + locator, gợi ý) vào thư mục run, ghi 1 dòng `{type:'help'}` vào live.jsonl, rồi chờ file `answer.json`. Server phát sự kiện cho giao diện; API `POST /runs/:id/answer` ghi `answer.json`. Worker đọc, xoá cả hai file, làm theo.
3. **Use element / Fix script:** `k` thực hiện lại thao tác với locator tester chọn. "Fix script" lưu vào **bảng sửa locator của workspace** (file riêng, vd `locators/overrides.json`, khoá theo `màn Excel + target`); `k` tra bảng này **trước** locator trong script ở các lần chạy sau. Không sửa region script → không đụng code tester sửa tay, gen lại không mất.
4. **Bug:** step được xử lý bằng Skip / Use element ghi một "bug chặn luồng nhưng đã cho chạy tiếp" vào kết quả case (câu lỗi gốc + `seen` lúc lỗi + ảnh), report viết như bug chặn luồng hiện nay. Case vẫn chạy tiếp → các điểm kiểm sau đó ra bug bình thường. Fix script → không ghi bug. Trạng thái case: có bug → Failed (không còn Blocked vì đã đi hết).
5. **Mặc định khi không ai trả lời:** chờ không giới hạn (run đã có nút Stop); Stop khi đang hỏi = Block case đó rồi dừng run.

## Quyết định thêm sau review (người viết tự quyết — người yêu cầu xem lại)
- **Bảng sửa locator ↔ Locator map:** "Fix script" lưu vào `locators/overrides.json` của workspace (khoá: màn Excel + target), thắng locator trong script. Trang Locator map có thêm mục **"Đã sửa khi chạy"** liệt kê các dòng này, xoá được (hoàn tác). Sửa phần tử trong Locator map không tự xoá dòng sửa tay — muốn dùng lại map thì xoá dòng ở mục đó. Gen script không cần thấy bảng này (`k` áp lúc chạy).
- **Lựa chọn theo loại bước:**
  - `tap` / `enter`: đủ 5 lựa chọn; Use element / Fix = làm lại thao tác trên phần tử được chọn.
  - `nav` (không tới màn): đủ 5; Use element / Fix = coi phần tử được chọn là dấu hiệu của màn đích (đang hiện → đi tiếp). Khoá override: màn Excel + `(screen)`.
  - `gone` (màn không sang bước) và `alert` (hộp thoại hệ thống, không có trong page source): chỉ **Block / Skip / Retry**.
- **Cùng lỗi ở nhiều case trong một run:** run nhớ lựa chọn Use element theo màn Excel + target và tự áp ở các case sau (không hỏi lại); mỗi lần áp vẫn ghi bug, report gộp như quy tắc gộp bug hiện có (cùng màn + cùng điểm → 1 bug).
- **Report:** dạng kết quả mới (case Failed có bug "chặn luồng nhưng đã cho chạy tiếp") thêm vào skill `test-report` (`assets/src/`), cài lại cho mọi project. Bug này đi vào Excel write-back và form Asana giống bug chặn luồng hiện nay — cùng câu chữ, cùng cách tính Severity.
- **Stop khi đang hỏi:** ghi câu trả lời Block trước rồi mới dừng run. Retry lại lỗi → hỏi lại. `steps.js` mới chép vào các workspace đã có.

## Để người làm tự quyết
- Gợi ý "Có phải ý bạn là…": thuật toán so gần giống (vd so chữ / tên phần tử với target).
- Bố cục hộp thoại (theo phong cách màn Run hiện có), cách vẽ khung phần tử trên ảnh.
- Định dạng chính xác `help.json` / `answer.json` / `overrides.json`.
- Script cũ không dùng `k` (viết trước khi có `k`) → không có chế độ này; chạy như cũ.

## Kiểm tra
- Test đơn vị: `k` khi bật/tắt chế độ; hỏi–đáp qua file (5 lựa chọn); bảng sửa locator; report ra đúng bug cho Skip / Use element và không ra bug cho Fix script.
- Thử thật: TC_ONB_001 trên Tastory 1.0.4 (step 6 màn Awesome không có "Show me how" → Use element để đi tiếp).

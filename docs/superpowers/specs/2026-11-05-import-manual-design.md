# Import test case manual → script tự động (thiết kế)

Ngày: 2026-11-05 · Trạng thái: chờ duyệt

## Vì sao làm

Hiện nay muốn có script, người dùng phải chạy skill `select-automation-testcases` ngoài tool để đổi file manual của QA thành file "automation v2" (như `recime/data/testcases/onboarding-v1-0-4-automation.xlsx`), rồi mới import vào tool để gen script. Luồng dài, hai nơi, và người dùng phải nhớ chạy đúng skill.

Mục tiêu: ở trang **Test Cases** của tool, import thẳng file manual và đi tới script gen xong, giống cách core-automation-framework "đưa yêu cầu là ra script".

## Mục tiêu / không phải mục tiêu / điều tránh

**Mục tiêu**
- Nút Import có hai kiểu do người dùng **chọn**: **File manual** (mới) và **File automation** (như hiện tại, giữ nguyên hành vi).
- Với file manual: tool lọc case, chuyển thành dòng Keyword theo bộ quy tắc của skill, kiểm tra, import, rồi gen script — không cần chạy skill riêng.
- Lọc có minh bạch: người dùng thấy case nào được automate, case nào để manual (kèm lý do) và sửa được trước khi đi tiếp.

**Không phải mục tiêu (đợt này)**
- Không đính kèm tài liệu nguồn (PRD, Q&A, Figma): file manual phải đủ rõ. Tool dò "điểm mờ" thay cho việc bổ sung nguồn.
- Không biên dịch trực tiếp dòng Keyword → code không qua AI (để sau).
- Không đổi cách gen script, cách chạy, hay file automation hiện có.

**Điều tránh**
- Lọc sai âm thầm làm mất case mà không ai biết.
- Chuyển đổi chiếm khóa thiết bị (nó không dùng thiết bị).
- Hai bản bộ quy tắc lệch nhau (một trong skill, một trong tool).

## Quyết định của người dùng (đã chốt)

1. Import manual nằm ở trang Test Cases, kèm lựa chọn kiểu file (manual / automation).
2. Lọc đúng như skill: tool dùng `extract.mjs`, AI tách case để manual kèm lý do; hiện hai danh sách; người dùng chuyển qua lại được trước khi đi tiếp.
3. Không cần thêm nguồn tài liệu; người dùng đảm bảo file manual chuẩn.
4. Chuyển đổi theo bộ quy tắc của skill, `write.mjs` kiểm tra, sai thì AI sửa lại vài lần.
5. Các tối ưu: lọc bằng code trước AI; chuyển theo nhóm chạy song song; import lại chỉ chuyển phần đổi; đối chiếu Target với Locator map.
6. Điểm cần review (chữ giả định, `contains`, target mô tả…) hiện thành một danh sách riêng, không hỏi từng câu như skill.
7. Tool dò "điểm mờ" trong file manual lúc import và báo trước khi chuyển đổi.

## Thiết kế

### Đầu vào
- File manual: định dạng kit v2, sheet nào có cột `Test Case #` (các cột như `extract.mjs` đọc: Test Case #, Module/Group test, Test Type, Platform, Test Scenario, Test Cases Description, Pre-condition, Steps, Expected Result, Priority). Sheet RTM bị bỏ qua.
- Chọn kiểu file là bắt buộc. Tool kiểm tra lại: chọn "manual" mà file không có sheet `Test Case #` (hoặc chọn "automation" mà file là manual) → báo lỗi rõ, không chạy tiếp. Ví dụ thực tế: trong Downloads/Desktop chỉ `onboarding-v1-0-4.xlsx` đúng định dạng (102 case, 93 được chọn); các file `*_testcase.xlsx` khác cho 0 case.

### Các bước (chuyển đổi chạy như tác vụ nền có tiến độ, giống gen script; không lấy khóa thiết bị)
1. **Trích xuất.** Chạy `extract.mjs` (copy của skill đặt trong `vendor/`). Quy tắc chọn cố định: High + Medium lấy hết, Low chỉ lấy Positive. Không lọc lại bằng tay hay bằng AI.
2. **Dò điểm mờ.** Code kiểm từng case được chọn: Expected không có chữ trong dấu ngoặc kép, Pre-condition trống, bước chứa cụm kiểu "hợp lệ", "đúng"… Kết quả là danh sách theo case, hiện cho người dùng trước khi chuyển đổi. Case chưa sửa vẫn chuyển được và được đánh "giả định" trong danh sách review.
3. **Lọc để manual.** Code lọc trước theo từ khóa (đăng nhập Google/Apple, mua hàng IAP, tắt mạng trên iOS, Settings hệ thống, màu/animation…); AI chỉ xét các case còn mơ hồ, trả về lý do cho từng case để manual (danh mục lý do theo skill). Màn hình hiện hai danh sách "sẽ automate" và "để manual (lý do)"; người dùng chuyển case qua lại rồi bấm tiếp. Danh sách này mở lại được từ trang Test Cases bất cứ lúc nào sau đó; đổi lựa chọn thì chỉ sheet và nhóm có case bị đổi được chuyển đổi lại (xem quyết định 3 và 4 bên dưới).
4. **Chuyển đổi.** Theo từng sheet chức năng, chia thành nhóm chạy (tối đa 10 case, đúng quy tắc skill), mỗi nhóm một lần gọi AI, chạy song song tối đa 3 nhóm. Bộ quy tắc của skill đặt cố định ở system prompt (được cache). AI trả `plan.json` (testcases theo thứ tự chạy, `fresh`, flows, manual). Case bị chuyển qua lại ở bước 3 được tôn trọng.
5. **Kiểm tra.** Chạy `write.mjs` (của skill) để kiểm tra và ghi file `<sheet>-automation.xlsx`. Lỗi → đưa lại cho AI sửa, tối đa 3 lần (đề xuất); vẫn lỗi → case/nhóm đó báo lỗi và phần còn lại vẫn đi tiếp.
6. **Đối chiếu Locator map** (nếu app đã có): Target/Value không có trong map hoặc lệch chữ thật của app → cảnh báo trong danh sách review.
7. **Import + gen.** File kết quả được import bằng đường import automation hiện có (vào workspace của app), rồi gen script như hiện tại. Gen có thể tự chạy sau import hoặc để người dùng bấm (đề xuất: tự chạy cho case mới/đổi, vì đó là mục tiêu "ra script luôn").

### Import lại
Hash nội dung case manual (title, pre, steps, expected). Import lại file manual đã sửa chỉ chuyển đổi các case có hash đổi; case không đổi giữ nguyên dòng Keyword và script (cùng nguyên tắc `hash(tc)` của import automation hiện có).

### Kết quả hiển thị
- Số case: được automate / để manual (lý do) / có điểm mờ / cần review.
- Danh sách review gồm: chữ giả định, `contains`, target mô tả, case Thiếu keyword, Target chưa có trong Locator map.
- File kết quả `.xlsx` mở xem/sửa tay được trong workspace (QA có thể chỉnh rồi import lại ở kiểu "File automation").

### Nơi đặt code (lựa chọn của mình)
- `vendor/select-automation/`: bản copy của skill (`SKILL.md`, `scripts/extract.mjs`, `scripts/write.mjs`), lấy từ bản mới nhất (thư mục "testcase-v2-kit 2", sửa 3/11). Ghi ngày/phiên bản và thêm kiểm tra lệch bản như `sync-report` đang làm cho `test-report`.
- `server/testcases/convert/…`: các bước 1–6. Route mới cho import manual, tiến độ đẩy qua cơ chế sự kiện hiện có.
- `server/ai/prompts/`: prompt lọc và prompt chuyển đổi (dùng nội dung SKILL.md làm quy tắc, đọc lúc chạy để sửa prompt không cần khởi động lại, như `gen-case.md`).
- `web/src/pages/TestCases.jsx`: nút Import có chọn kiểu file; màn hai danh sách; danh sách điểm mờ và review.
- Thêm `Wait until enabled` vào `server/ai/prompts/k-table-v2.md` (trình chạy đã hỗ trợ, bảng chưa liệt kê).

## Ràng buộc đã biết
- Tool đã đọc được sheet `Flows` và keyword `Run flow` (loader template `data/loaders/testcase-v2.js`); 56 keyword của skill đều có chỗ chạy.
- `extract.mjs`/`write.mjs` chạy độc lập bằng Node và `exceljs`, nhận file qua tham số, không tương tác.
- Chữ chính xác phụ thuộc hoàn toàn vào file manual; không có nguồn khác trong đợt này.
- Skill gốc hỏi người dùng từng điểm mở bằng hộp thoại; tool thay bằng danh sách review.
- File manual không có cột hay sheet Q&A riêng; Q&A chỉ xuất hiện trong nội dung ô (ví dụ "Q&A #3" trong tiêu đề case; file mẫu `onboarding-v1-0-4.xlsx` có 31 ô như vậy). Chỉ nhắc "Q&A #n" thì chưa biết đã chốt hay chưa, nên **không** coi là bị chặn. Case chỉ để manual vì Q&A khi nội dung ô có dấu hiệu rõ là chưa chốt ("chưa chốt", "TBD", "pending", "open"); còn lại vẫn automate và đưa vào danh sách review.

## Các quyết định của người viết thiết kế (đã đối chiếu với code, người dùng chưa duyệt từng mục)

1. **Gọi AI qua đâu.** Dùng `runClaude` hiện có ([server/ai/claude.js](../../../server/ai/claude.js)): chạy `claude -p` ngầm, không tool, một lượt, kèm `--system-prompt` cố định (được cache) và `--json-schema`; phần gen script đã chạy song song tối đa 3 theo cách này. Chuyển đổi dùng đúng cơ chế đó, không thêm API key hay tầng mới.
2. **Chia nhóm và ngữ cảnh chung.** Chuyển đổi chạy theo hai pha cho mỗi sheet: (a) **một lần gọi lập khung** cho cả sheet — đầu vào gọn (ID, title, Pre-condition, màn của từng case) — trả về thứ tự chạy, `fresh`, các nhóm chạy (tối đa 10 case), và tên + nội dung các `flows` dùng chung; (b) **gọi viết dòng Keyword theo từng nhóm**, song song tối đa 3, mỗi lần nhận khung ở pha (a). Code ghép kết quả các nhóm theo đúng thứ tự khung thành một `plan.json` cho sheet và chạy `write.mjs` **một lần cho cả sheet**. Flows chỉ khai báo ở pha (a), nên không bị trùng giữa các nhóm.
3. **Chuyển case giữa hai danh sách.** Chuyển một case từ "manual" sang "automate" hoặc ngược lại làm lập khung chạy lại cho sheet đó (rẻ vì đầu vào gọn); các nhóm có case đổi thì viết lại, nhóm khác giữ nguyên. Nếu case chuyển sang manual là case mà các case sau dựa vào trạng thái, khung tự xếp lại (case sau có thể thành `fresh` hoặc có flow đường đi) — kết quả nêu trong danh sách review.
4. **Lưu lựa chọn của người dùng.** Lựa chọn automate/manual theo TC ID được lưu cùng app, giữ qua các lần import lại; chỉ case có hash manual đổi mới được xét lại từ đầu (và người dùng thấy rõ trong danh sách).
5. **Import lại và sửa tay.** Mỗi case sinh từ manual lưu hash manual và hash của dòng Keyword đã ghi. Import lại manual: case hash manual không đổi → giữ nguyên (kể cả bản sửa tay của QA trong file automation); case hash manual đổi → chuyển đổi lại, nhưng nếu dòng Keyword của case đó đã bị sửa tay (hash lệch hash đã ghi) thì **không ghi đè âm thầm**: hiện trong danh sách xung đột để người dùng chọn giữ bản sửa tay hay chuyển lại. Case biến mất khỏi file manual → hiện trong danh sách, xóa theo cách import automation hiện làm (có xác nhận), không xóa im lặng.
6. **Gen script không cần khóa thiết bị.** Gen script chỉ gọi AI không tool ([server/scripts/generate.js](../../../server/scripts/generate.js)) và ghi file, không dùng thiết bị; nên tự gen sau import không cần khóa và không bị treo khi thiết bị bận.
7. **Đầu vào quá mờ.** Chỉ cảnh báo, không chặn: case chưa sửa vẫn chuyển, đánh "giả định" và đếm trong tóm tắt. Không có ngưỡng chặn trong đợt này.

## Để người làm quyết định
- Số lần AI sửa plan khi `write.mjs` từ chối (đề xuất 3), và kích thước nhóm khi một sheet quá lớn.
- Danh sách từ khóa lọc bằng code và danh mục cụm "điểm mờ".
- Mô hình AI cho lọc (nhẹ) và chuyển đổi (mạnh hơn); thời gian tối đa mỗi lần gọi.
- Cách hiển thị tiến độ và cách chuyển case giữa hai danh sách trong giao diện.
- Có tự gen script ngay sau import hay không (đề xuất: có).

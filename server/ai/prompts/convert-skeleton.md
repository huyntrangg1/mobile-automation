Bạn lập KHUNG chạy cho một sheet chức năng của file test case manual, để chuyển sang test automation v2 (WebdriverIO + Appium).

Đầu vào có id, module, tên kịch bản, Pre-condition và Steps của từng case; nếu có phần APP THẬT (locator map + sơ đồ màn) ở cuối, luồng PHẢI dùng đúng tên phần tử trong đó và bấm đúng nút chuyển màn như sơ đồ (vd chọn một lựa chọn rồi bấm "Continue" nếu màn cần Continue). Trả JSON:
- `order`: MỌI id của sheet theo thứ tự chạy (theo thứ tự màn hình của app), mỗi phần tử `{ id, fresh }`. `fresh: true` chỉ khi case cần cài lại app theo quy tắc bên dưới; case đầu tiên của sheet luôn `fresh: true`.
- `groups`: chia `order` thành các nhóm chạy liền nhau, mỗi nhóm tối đa 10 case, theo quy tắc "Keep failures local" bên dưới. Mỗi id nằm trong đúng một nhóm.
- `flows`: các luồng đường đi dùng lại (tên dạng `Welcome → Login`), mỗi luồng là mảng dòng `{ step, screen, kind, keyword, target?, value?, compare?, label? }` đúng định dạng trong phần quy tắc. Chỉ khai báo luồng cho case `fresh` cần đi từ màn đầu tới màn của nó; không có thì `{}`.

Quy tắc thêm: phần "Hành vi đã thấy trên app thật" (nếu có) là hành vi ĐÃ QUAN SÁT trên app, thắng mọi suy đoán từ tài liệu. Bấm phần tử ghi "tự sang" màn khác thì KHÔNG thêm "Tap Continue" / nút đi tiếp sau đó (màn mới cũng có nút đó → bấm thừa sẽ nhảy quá 2 màn); dòng kế tiếp là Nav tới màn mới.

Quy tắc xếp thứ tự và chạy (trích từ skill):

Quy tắc thêm: case kiểm TRẠNG THÁI BAN ĐẦU của màn (chưa chọn gì, nút đang khoá / disabled, màn trống, lần đầu vào) phải `fresh: true` — case trước có thể đã chọn / nhập và app giữ lại trạng thái đó khi quay lại màn.

Quy tắc thêm: Pre-condition của case chỉ là chữ, runner KHÔNG chạy. Case tiếp nối (`fresh: false`) mang nguyên trạng thái case trước để lại (mục đã chọn, chữ đã nhập, màn đang mở). Nếu Pre-condition của case có thao tác (Tap / Bỏ chọn / Back…) để đưa app về trạng thái khác case trước, hoặc case kiểm trạng thái ban đầu của phần tử mà case trước vừa bấm, thì hoặc để case `fresh: true`, hoặc xếp sao cho bước viết dòng thêm được dòng Action ở Step 0 đưa app về đúng trạng thái.

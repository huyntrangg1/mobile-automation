Bạn lập KHUNG chạy cho một sheet chức năng của file test case manual, để chuyển sang test automation v2 (WebdriverIO + Appium).

Đầu vào chỉ có id, module, tên kịch bản và Pre-condition của từng case (chưa có bước chi tiết). Trả JSON:
- `order`: MỌI id của sheet theo thứ tự chạy (theo thứ tự màn hình của app), mỗi phần tử `{ id, fresh }`. `fresh: true` chỉ khi case cần cài lại app theo quy tắc bên dưới; case đầu tiên của sheet luôn `fresh: true`.
- `groups`: chia `order` thành các nhóm chạy liền nhau, mỗi nhóm tối đa 10 case, theo quy tắc "Keep failures local" bên dưới. Mỗi id nằm trong đúng một nhóm.
- `flows`: các luồng đường đi dùng lại (tên dạng `Welcome → Login`), mỗi luồng là mảng dòng `{ step, screen, kind, keyword, target?, value?, compare?, label? }` đúng định dạng trong phần quy tắc. Chỉ khai báo luồng cho case `fresh` cần đi từ màn đầu tới màn của nó; không có thì `{}`.

Quy tắc xếp thứ tự và chạy (trích từ skill):

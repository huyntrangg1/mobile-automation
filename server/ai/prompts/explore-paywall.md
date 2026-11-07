Bạn đang khám phá app {{platform}} "{{appName}}" để lấy locator. Màn hiện tại là một PAYWALL / màn mua / quảng cáo toàn màn và tool chưa tự đóng được. Hãy tự mò cách thoát khỏi nó để đi tiếp (KHÔNG mua).

Ảnh màn hình hiện tại: {{shot}} — dùng công cụ Read để xem ảnh trước khi chọn.
Phần tử trong cây (có thể thiếu nút X vì vẽ bằng ảnh):
{{elements}}
Đã thử ở màn này: {{tried}}

TUYỆT ĐỐI không bấm: Subscribe, Buy, Start free trial, Try free, Continue / Get premium khi đó là nút mua, bất kỳ nút nào có giá. Được làm mọi thứ khác để thoát:
- "tapPoint": chạm theo toạ độ trên ảnh, "x" "y" là phần trăm 0–100 của chiều rộng / cao màn hình. Tìm nút X / Close nhỏ (thường góc trên trái hoặc trên phải, đôi khi mờ nhạt), chữ "Skip", "Not now", "Maybe later", "No thanks", "Continue with limited version", mũi tên quay lại.
- "tap": bấm phần tử có trong danh sách ("locator" chép nguyên văn sau dấu →).
- "swipe": vuốt, "text" là up | down | left | right (nhiều paywall dạng tờ đóng được bằng vuốt xuống; có paywall nhiều trang cần vuốt sang trang cuối mới có nút đóng).
- "wait": chờ vài giây (nút X của nhiều paywall chỉ hiện sau 3–6 giây).
- "back": quay lại.
- "relaunch": mở lại app (khi đã thử hết).
- "giveUp": thật sự không có cách nào ngoài mua.
"reason": một câu lý do. Mỗi lần chỉ một thao tác.

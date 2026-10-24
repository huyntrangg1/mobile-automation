Bạn đang điều khiển app {{platform}} "{{appName}}" trên {{device}} để khám phá càng nhiều màn khác nhau càng tốt, nhằm lấy locator cho automation test.

Màn hiện tại (mỗi dòng một phần tử: loại "tên" … → locator):
{{elements}}

Các màn đã ghi: {{knownScreens}}
Thao tác đã thử ở màn này: {{tried}}
Dữ liệu gợi ý được phép nhập: {{hints}}
Bước {{step}}/{{maxSteps}}.

Chọn MỘT thao tác tiếp theo:
- "tap": bấm một phần tử chưa thử, ưu tiên phần tử dẫn tới màn mới (nút tiếp tục, link, tab). Tránh nút đăng nhập Google/Apple, link web, nút xoá tài khoản / đăng xuất.
- "type": nhập "text" vào ô nhập (dùng dữ liệu gợi ý nếu hợp).
- "back": quay lại màn trước (khi màn này đã khám phá hết).
- "relaunch": mở lại app từ đầu (khi kẹt).
- "done": khi không còn màn mới đáng khám phá.

"locator" PHẢI chép nguyên văn một locator trong danh sách trên (sau dấu →). "screenName" là tên ngắn cho màn hiện tại theo tiêu đề / mục đích (vd "Log In", "Sex", "Height"), dùng tên đã có nếu đây là màn đã ghi.

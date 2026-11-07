Bạn đang điều khiển app {{platform}} "{{appName}}" trên {{device}} để khám phá càng nhiều màn khác nhau càng tốt, nhằm lấy locator cho automation test.

Màn hiện tại (mỗi dòng một phần tử: loại "tên" … → locator):
{{elements}}

Các màn đã ghi: {{knownScreens}}
Thao tác đã thử ở màn này: {{tried}}
Dữ liệu gợi ý được phép nhập: {{hints}}
Bước {{step}}/{{maxSteps}}.

Chọn MỘT thao tác tiếp theo:
- "tap": bấm một phần tử chưa thử, ưu tiên phần tử dẫn tới màn mới (nút tiếp tục, link, tab). Tránh nút đăng nhập Google/Apple, link web, nút xoá tài khoản / đăng xuất.
  Được bấm mọi nút để khám phá, kể cả "Continue", "Start free trial", "Subscribe" ở màn giới thiệu gói / paywall (để biết luồng đi đâu và ghi locator). Tool KHÔNG BAO GIỜ xác nhận thanh toán: tờ thanh toán / hộp xác nhận mua hiện ra sẽ bị tool tự huỷ. Bạn không cần (và không được) bấm nút xác nhận trong tờ thanh toán của store.
  Ưu tiên đi tiếp luồng: màn giới thiệu gói (vd "See what Unlimited features", bảng Free vs Pro) bấm "Continue". Ở paywall có giá, sau khi đã thử nút mua một lần (tờ thanh toán bị huỷ, quay lại paywall) thì tìm nút đóng (X, Close, Not now, Maybe later, Skip) hoặc "back" để đi tiếp; không có thì "relaunch".
- "type": nhập "text" vào ô nhập (dùng dữ liệu gợi ý nếu hợp).
- "back": quay lại màn trước (khi màn này đã khám phá hết).
- "relaunch": mở lại app từ đầu (khi kẹt).
- "done": khi không còn màn mới đáng khám phá.

"locator" PHẢI chép nguyên văn một locator trong danh sách trên (sau dấu →). "screenName" là tên ngắn cho màn hiện tại theo tiêu đề / mục đích (vd "Log In", "Sex", "Height"), dùng tên đã có nếu đây là màn đã ghi.

"next": thêm tối đa 5 thao tác tap / type KHÁC đáng thử trên CHÍNH màn này (ưu tiên giảm dần, cùng quy tắc tránh như trên, locator chép nguyên văn). Lần sau quay lại màn này tool làm tiếp theo danh sách mà không hỏi lại — bỏ trống nếu không còn gì đáng thử.

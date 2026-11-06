Bạn đang điều khiển app {{platform}} "{{appName}}" trên {{device}} để ĐI TỚI một màn cụ thể (chỉ điều hướng, không khám phá).

Màn đích: "{{targetName}}". Dấu hiệu nhận ra màn đích (chữ / nút có trên màn đó):
{{targetHints}}

Màn hiện tại (mỗi dòng một phần tử: loại "tên" … → locator):
{{elements}}

Các màn đã biết trong app: {{knownScreens}}
Thao tác đã thử trên đường đi: {{tried}}
Dữ liệu gợi ý được phép nhập: {{hints}}
Bước {{step}}/{{maxSteps}}.

LƯU Ý: chỉ cần tới ĐÚNG MÀN (theo tiêu đề / mục đích), KHÔNG cần khớp dữ liệu như thiết kế. Thiết kế có thể hiện ngày, số liệu, trạng thái có dữ liệu; app đang test có thể trống hoặc dữ liệu khác — vẫn tính là tới nơi. Đừng cố chọn ngày / khoảng thời gian / nhập số cho giống thiết kế. Thấy màn có tiêu đề đúng thì dừng điều hướng.

Chọn MỘT thao tác tiếp theo để tới gần màn đích nhất:
- "tap": bấm phần tử (chép nguyên văn locator trong danh sách trên, sau dấu →). Đi theo luồng hợp lý của app (onboarding → màn chính → mục con…).
- "type": nhập "text" vào ô nhập (dùng dữ liệu gợi ý nếu hợp).
- "back": quay lại màn trước.
- "relaunch": mở lại app từ đầu (khi đi lạc / kẹt).
- "arrived": màn HIỆN TẠI chính là màn đích (đúng tiêu đề / mục đích, dù dữ liệu khác thiết kế). Chọn khi đã tới nơi, đừng bấm thêm.
- "giveup": không còn cách nào tới được màn đích (KHÔNG dùng khi đã tới nơi — dùng "arrived").

TUYỆT ĐỐI không bấm nút mua / đăng ký / dùng thử (Subscribe, Buy, Start free trial…). Gặp paywall / quảng cáo: chọn nút đóng hoặc "back". Tránh đăng nhập Google/Apple, link web, xoá tài khoản / đăng xuất.
"screenName" là tên ngắn của màn HIỆN TẠI; "reason" nói ngắn vì sao chọn thao tác này.

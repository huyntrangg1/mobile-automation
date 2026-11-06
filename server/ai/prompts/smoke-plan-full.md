CHẾ ĐỘ KIỂM MỞ RỘNG (thay cho quy tắc "chỉ luồng chính" bên dưới ở các điểm sau): ngoài các luồng chính, rút thêm luồng SÂU, tối đa 16 luồng tổng. Mỗi luồng vẫn là một hành trình ngắn, một mục tiêu. Luồng chính xếp trước, luồng sâu sau. Chỉ thêm luồng sâu khi PRD / Figma có nói tới; KHÔNG bịa quy tắc nghiệp vụ.
Các nhóm luồng sâu (mỗi nhóm một hoặc vài luồng, tuỳ nguồn có nói):
- Validation: nút bị disable khi chưa nhập / chưa chọn đủ, thông báo lỗi, trường bắt buộc.
- Đổi đơn vị / chế độ hiển thị (vd mg/dL ↔ mmol/L, 7 ngày ↔ 30 ngày): giá trị hiển thị đúng sau khi đổi.
- Ranh giới giá trị: dùng ĐÚNG các mốc PRD ghi (vd ngưỡng phân loại 35, 50, 80, 150, 180, 280, 380): nhập giá trị sát hai bên mốc và xem phân loại / màu / chữ trạng thái. Mốc PRD ghi [Cần xác nhận] hoặc không rõ nằm trong / ngoài thì đưa vào "unclear", KHÔNG kết luận đúng sai.
- Chặn thao tác lặp: bấm liên tục (chặn tap liên tục) nút Save / Log / Add, chỉ được ghi một lần.
- Empty state: màn khi chưa có dữ liệu (chữ hướng dẫn, nút hành động).
- Đối chiếu giao diện với Figma của các màn chính (nếu có Figma).
Với luồng sâu, "expected" ghi cụ thể giá trị / mốc cần thử và kết quả mong đợi theo nguồn.

Kỹ thuật thiết kế test (lấy từ skill mobile-testing, áp dụng cho luồng sâu):
- ECP (lớp tương đương): mỗi lớp giá trị hợp lệ / không hợp lệ chọn một đại diện. BVA (giá trị biên): thử đúng mốc, một đơn vị dưới và trên mốc. Bảng quyết định: khi kết quả phụ thuộc nhiều điều kiện (vd State × giá trị × đơn vị). Chuyển trạng thái: các bước đổi trạng thái màn / dữ liệu và quay lại.
- Bổ sung riêng cho mobile, chỉ thêm khi liên quan tính năng và làm được trên máy ảo: Dark mode, cỡ chữ lớn (Dynamic Type), ngôn ngữ app hỗ trợ, popup đánh giá / cập nhật / khuyến mãi không được chặn luồng chính, dữ liệu còn sau khi thoát và mở lại app.
- Mỗi luồng sâu gắn một nhóm kỹ thuật ở trên vào "goal" (vd "BVA: ranh giới 80 mg/dL").

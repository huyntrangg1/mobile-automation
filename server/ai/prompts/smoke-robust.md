KIỂM BỀN VỮNG (chưng cất từ skill mobile-testing: vòng đời app, hiển thị) — chỉ áp dụng cho luồng "Kiểm bền vững"

Mục tiêu: sau khi các luồng chính chạy xong, thử vài tình huống gián đoạn thường gặp và xem app có giữ nguyên trạng thái không. Làm lần lượt, mỗi việc một lần, ở một màn có nội dung / dữ liệu do các luồng trước tạo ra (nếu có). Chọn màn có dữ liệu hoặc ô đã nhập thì kết luận mới có căn cứ.

1. Xuống nền rồi mở lại: dùng "background" (text = số giây, khoảng 5). Mở lại phải về ĐÚNG màn đó với dữ liệu và ô đã nhập giữ nguyên. App khởi động lại từ đầu, về màn khác, hoặc mất dữ liệu đang nhập là điểm lệch (kind "robust").
2. Mở lại app (kill rồi mở): dùng "relaunch". Dữ liệu đã lưu (lịch sử, giá trị đã ghi, cài đặt) phải còn sau khi mở lại. Về màn chính / màn đầu sau khi mở lại là bình thường, không phải lỗi. Dữ liệu đã lưu mất là điểm lệch (kind "robust").
3. Xoay màn hình: dùng "rotate" (text "landscape" rồi "portrait"). Nếu tool báo không xoay được thì app khóa hướng dọc theo thiết kế: BỎ QUA, không ghi lệch. Nếu xoay được: nội dung, giá trị đã nhập và vị trí cuộn phải còn, không bị cắt hay chồng lên nhau (nếu app không khóa hướng).
4. Mỗi thử nghiệm xong, về lại trạng thái bình thường (portrait, app ở màn hình trước đó) rồi mới thử việc tiếp theo.

Cách kết luận: ghi "finding" kind "robust" cho từng điều thật sự lệch, nêu rõ làm gì và thấy gì (vd "Sau khi xuống nền 5 giây rồi mở lại, giá trị 96 đã nhập mất"). Giữ nguyên hết thì kết thúc "done" với flowStatus "ok". Không ghi lại điều đã ghi ở luồng trước. Không thử mất mạng, push, deep link: tool chưa hỗ trợ trên Simulator.

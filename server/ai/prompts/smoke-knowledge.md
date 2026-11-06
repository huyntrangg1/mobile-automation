KIẾN THỨC TEST APP MOBILE (chưng cất từ skill mobile-testing — chỉ phần dùng cho smoke test)

Nguyên tắc chung
- Smoke test chỉ kiểm luồng chính chạy được và đúng tài liệu. Không đào sâu trường hợp biên, dữ liệu lạ, lỗi hiếm.
- Thao tác bằng locator có trong danh sách phần tử của màn hiện tại; không bịa locator. Phần tử không có trong danh sách (nút X vẽ bằng ảnh) thì dùng tapPoint theo toạ độ nhìn thấy trên ảnh.
- Mỗi thao tác xong, màn cần thời gian đứng yên. Thấy màn đang tải (vòng xoay, chữ "Loading…", màn trống) thì chọn "wait", không bấm lung tung.
- Tác vụ chạy lâu (AI sinh nội dung, tải chương, tải dữ liệu) có thể mất 30–120 giây: chờ, đừng kết luận lỗi sớm.

Popup và gián đoạn thường gặp (không phải lỗi của luồng đang test)
- Hộp xin quyền hệ thống (Health, thông báo, vị trí, ảnh, camera, micro…): CHO PHÉP (Allow / Allow While Using App / Turn On All) vì tính năng cần quyền đó mới chạy; từ chối làm tính năng hỏng và báo lệch giả. Chỉ từ chối hộp xin THEO DÕI quảng cáo ("Ask App Not to Track"). Trừ khi chính luồng đang test là kiểm hành vi khi bị từ chối quyền.
- Màn onboarding, chọn ngôn ngữ, giới thiệu lần đầu: đi qua bằng nút tiếp tục / bỏ qua, đây là phần của luồng khởi đầu.
- Popup đánh giá app, cập nhật phiên bản, khuyến mãi: đóng lại (X, Close, Not now, Maybe later, Skip). Chúng không được chặn luồng chính; nếu chặn không đóng được thì đó là điểm đáng ghi.
- Quảng cáo (toàn màn, mở app, có thưởng): chờ nút đóng hiện ra rồi đóng. Không bấm vào quảng cáo.
- Paywall / mua hàng / đăng ký / dùng thử: TUYỆT ĐỐI không bấm mua, đăng ký, dùng thử, Continue ở paywall. Chỉ đóng. Ghi nhận màn paywall xuất hiện ở đâu nếu PRD có nói.
- Nút đóng (X) của quảng cáo / paywall thường là ảnh, không có trong danh sách phần tử: xem ảnh màn hình rồi dùng "tapPoint" bấm đúng vị trí nút X (thường góc trên trái hoặc trên phải). Có paywall hiện lại mỗi lần mở app là bình thường: đóng rồi đi tiếp.
- Bàn phím che phần tử: ẩn bàn phím rồi bấm tiếp. Nhập chữ có dấu tiếng Việt bằng thao tác "type" (nhập cả chuỗi).

Hành vi cần biết khi di chuyển
- Giữa các luồng app KHÔNG bị mở lại: luồng bắt đầu từ màn đang hiện. Nếu đang ở màn con hoặc có popup, dùng back hoặc tab dưới để về màn gốc của luồng trước khi làm.
- "back": trên Android là nút Back phần cứng, trên iOS là nút Back/Close trong app. Back phải về đúng màn trước theo luồng PRD; quay về sai màn hoặc thoát app là điểm đáng ghi.
- "relaunch" (mở lại app) chỉ dùng khi kẹt hẳn. Dữ liệu đã lưu (lịch sử, cài đặt) phải còn sau khi mở lại, nếu PRD nói vậy.
- Danh sách phần tử CHỈ gồm phần đang hiện trên màn. Màn dài (vd Health có nhiều khối xếp dọc) còn nhiều khối phía dưới, và một lần "swipe" lên chỉ cuộn khoảng nửa màn. Trước khi kết luận một khối / nút "không có" hay "thiếu", PHẢI kiểm CẢ HAI đầu màn: vuốt xuống liên tục tới khi màn không đổi (đầu màn), rồi vuốt lên liên tục tới khi màn không đổi (đáy màn), vừa vuốt vừa tìm. Cuộn xuống đáy sẽ đẩy khối ở ĐẦU màn ra ngoài tầm nhìn, nên đừng kết luận "không có" khi mới thấy một đầu. Tool sẽ từ chối kết luận "không có" nếu bạn chưa kiểm cả hai đầu.
- Nội dung động (giờ, ngày, tên người dùng, số liệu, quảng cáo, biến thể A/B) khác với Figma là bình thường, không phải lệch. Số liệu, ngày, đơn vị, tên và chữ trạng thái trong Figma (vd 96 mg/dL, Mon 9, 42.8) chỉ là dữ liệu MINH HỌA: KHÔNG ghi lệch vì khác con số hay khác chữ dữ liệu. Chỉ ghi lệch về cấu trúc: thiếu hoặc thừa một khối / nút / nhãn giao diện, sai luồng, sai màn đích.

Cách kết luận một màn
- Lệch rõ: thiếu hoặc thừa phần tử, sai chữ, sai thứ tự, sai màn đích sau khi bấm, nút không phản hồi, app treo hoặc văng.
- Không phải lệch: sai số điểm ảnh, font render khác nhẹ, dữ liệu mẫu khác Figma, hiệu ứng chuyển cảnh.
- Điều PRD ghi là chưa rõ ([Cần xác nhận]) hoặc PRD và Figma nói khác nhau: ghi nhận đúng loại (unclear / conflict) và ĐI TIẾP, không dừng, không tự chọn bên nào đúng.
- Thao tác không làm được vì màn không có phần tử cần thiết: thử swipe, thử back về màn trước rồi vào lại; vẫn không được thì kết thúc luồng bằng "unreachable" hoặc "unverifiable" kèm lý do cụ thể.

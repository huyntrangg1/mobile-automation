Bạn đang chuẩn bị một lượt smoke test cho app mobile. Việc của bạn: rút ra tối đa {{maxFlows}} luồng CHÍNH cần kiểm từ các nguồn bên dưới.

Nguồn:
{{prdSection}}
{{figmaSection}}
- Ghi chú thêm của người test: {{notes}}

{{depthSection}}
Smoke test = chỉ các luồng chính app phải làm được: mở app và vào màn chính, hành động cốt lõi của tính năng, đi qua các entry point chính. Bỏ qua trường hợp biên, dữ liệu lạ, lỗi hiếm. Onboarding, popup quyền, paywall KHÔNG phải luồng cần kiểm (tool tự xử lý trước khi chạy luồng).

Với mỗi luồng trả về:
- "id": mã ngắn (f1, f2…); "name": tên luồng; "goal": một câu mô tả luồng làm gì.
- "prdQuote": trích NGUYÊN VĂN một đoạn PRD mô tả luồng này (không diễn giải). Không có PRD thì để chuỗi rỗng "".
- "expected": 2–6 điều phải thấy hoặc phải xảy ra. Có PRD: lấy từ PRD. Không có PRD: suy từ thiết kế Figma và thông lệ app mobile, KHÔNG bịa chi tiết nghiệp vụ mà nguồn không nói.
- "frames": các frame Figma (nodeId + name, đúng như nguồn Figma ở trên cung cấp) ứng với các màn của luồng, theo thứ tự đi. Không có Figma thì [].
- "unclear": những chỗ nguồn tự ghi `[Cần xác nhận]` hoặc mâu thuẫn / mơ hồ liên quan luồng này. KHÔNG tự đoán thay tài liệu.

Điền "sources": với mỗi nguồn ở trên, "read" nếu đã đọc được, "failed" nếu không đọc được (không có quyền, link sai, chưa đăng nhập), "none" nếu không được cung cấp. Nếu BẤT KỲ nguồn nào được cung cấp mà không đọc được: đặt "failed" cho nguồn đó, ghi lý do cụ thể vào "problem", và KHÔNG suy luồng từ nguồn đã failed (không bịa từ tên tính năng hay thông lệ). Không đọc được nguồn nào cả thì trả "flows": [].

# AI Smoke Test (theo PRD + Figma) — thiết kế

> **Quyết định của Trang:** chức năng này tên **AI Smoke Test**, là **một chức năng mới thay thế "AI kiểm UI"**. "AI kiểm UI" (nút ở tab Frame Figma, trang `/ui-ai/:id`, `server/routes/uiAi.js`, `server/ui/aiCheck.js` và test của nó) được gỡ bỏ. Thứ tự làm: dựng AI Smoke Test xong và chạy được trước, rồi mới gỡ AI kiểm UI. Phần dùng lại được của AI kiểm UI (đi tới màn, chụp, so ảnh với frame Figma) chuyển sang AI Smoke Test. Dữ liệu lần chạy cũ trong `data/uiai` giữ nguyên trên đĩa, không xóa.

Ngày: 2026-11-05 · Trạng thái: **bản nháp chờ duyệt** · Người yêu cầu: Trang (QA)

## 1. Ý định và lý do

QA Pipeline hiện có hai thứ: **Run** (chạy test case từ Excel, lặp lại được, không dùng AI khi chạy) và **UI Testing** (so app với luồng Figma, không dùng AI). Chưa có cách nào để nhanh chóng biết "build này có sống không và có đúng tài liệu không" mà không phải viết test case trước.

Chế độ mới **AI Test** cho phép: đưa PRD + Figma của một app, bấm một nút, AI tự mò app trên thiết bị theo các luồng chính, rồi ra **một report ngắn** liệt kê điểm lệch với PRD hoặc Figma.

Lý do chọn tách riêng khỏi Run: kết quả của AI Test không ổn định giữa các lần chạy và tốn token; Run phải giữ được tính lặp lại. Tiền lệ trong tool: UI Testing cũng đã tách khỏi Run.

## 2. Mục tiêu / Không phải mục tiêu / Điều phải tránh

**Mục tiêu**
- Smoke test các **luồng chính** suy ra từ PRD + Figma, không cần test case.
- AI **tự mò**: không dừng lại chờ người, không bị chặn khi PRD và Figma mâu thuẫn nhau.
- Report ngắn: chỉ nêu điểm lệch so với PRD hoặc Figma.

**Không phải mục tiêu**
- Không sinh test case, không ghi vào Excel, không đụng luồng Run / UI Testing hiện có.
- Không kiểm trường hợp biên, dữ liệu lạ, lỗi hiếm.
- Không thay thế Run cho kiểm thử hồi quy.

**Điều phải tránh (anti-goal)**
- AI "đạt" sai: kết luận đạt mà thực ra không kiểm. Mỗi kết luận phải có căn cứ xem lại được (ảnh app, ảnh Figma, đoạn PRD).
- AI bị kẹt vô hạn hoặc chạy quá lâu: phải có giới hạn số bước và thời gian.
- Report dài như report đầy đủ hiện nay.

## 3. Hành vi (theo lời QA)

1. Người dùng vào mục **AI Smoke Test**, chọn app, chọn thiết bị, dán link **PRD (begamob) và / hoặc Figma — cần ít nhất một** (xem mục 8). Figma đọc thẳng từ link qua Figma MCP, không dùng dữ liệu Figma đã nhập trong tool.
2. AI đọc PRD + các frame Figma, tự rút ra danh sách luồng chính cần smoke.
3. AI bấm app theo từng luồng. Gặp popup hệ thống, quảng cáo, màn chờ thì tự xử lý theo kiến thức từ skill mobile-testing.
4. Khi PRD và Figma mâu thuẫn, **AI không dừng và không chọn bên nào làm chuẩn**: nó cứ đi tiếp và ghi nhận mâu thuẫn đó là một điểm lệch.
5. Kết thúc, tool tạo report ngắn.

**Nội dung report:** với mỗi điểm lệch: mô tả một dòng, nguồn lệch (PRD / Figma / cả hai mâu thuẫn), ảnh app, ảnh Figma nếu có, đoạn PRD trích dẫn. Đầu report: tổng số luồng, số luồng đi hết được, số điểm lệch. Luồng AI không đi được cũng được liệt kê, ghi lý do. Điểm lệch được nêu cho cả ba trường hợp đã nói: lệch PRD, lệch Figma, PRD với Figma mâu thuẫn.

## 4. Ràng buộc và cách làm đã quyết

- Là **chức năng riêng biệt, không nằm trong UI Testing**: có mục **AI Smoke Test** riêng ở menu bên trái (ngang hàng với UI Testing, không phải tab hay nút bên trong nó), trang riêng `/apps/:appId/smoke` và trang kết quả riêng. Không dùng chung giao diện, route hay dữ liệu lưu trữ với UI Testing. Chỉ dùng chung hạ tầng ở tầng thấp (thiết bị, phiên Appium, khóa thiết bị, dữ liệu Figma đã nhập).
- Dùng lại: chọn thiết bị, phiên Appium, khóa thiết bị (một job một lúc). Report là bộ vẽ riêng trong tool (không dùng skill `test-report`).
- AI gọi qua `claude -p` như phần còn lại của tool (`server/ai/claude.js`); không cần API key.
- Kiến thức mobile (popup quyền, chờ màn tải, ads/IAP, deep link, chống flaky) lấy từ skill `mobile-testing` và đưa vào prompt của AI. Skill gốc viết cho Java/Cucumber; **chỉ dùng phần kiến thức chung**, không mang step Java sang.
- Báo cáo bằng tiếng Việt như phần còn lại của tool.

## 5. Để người xây quyết

- Giới hạn cụ thể (số bước, số phút mỗi luồng và cả lần chạy). Gợi ý: dựa theo chế độ "Tự khám phá" hiện có (tối đa 20 phút).
- Định dạng báo cáo ngắn chi tiết, trong khung ở mục 3.
- Cách tool nạp nội dung skill mobile-testing vào prompt (nhúng sẵn hay đọc từ file).
- Cách AI ghép luồng trong PRD với frame Figma.

## 6. Các quyết định do người viết tài liệu tự đặt (Trang kiểm lại)

Đây là **lựa chọn của tôi**, không phải điều Trang đã nói. Sai chỗ nào thì sửa.

- **Luồng chính:** AI tự rút từ PRD + Figma. Danh sách gợi ý của Trang (mở app, vào màn chính, hành động cốt lõi, thanh toán/ads không làm app đứng) chỉ là mồi cho AI, không phải checklist cố định. Người dùng có thể thêm ghi chú tự do trước khi chạy.
- **"Đạt" nghĩa là gì:** AI so ảnh màn thật với frame Figma và đối chiếu hành vi với PRD. Chỉ tính là lệch khi thấy rõ: thiếu/thừa phần tử, sai chữ, sai luồng, không tới được màn. Không tính sai số điểm ảnh, quảng cáo, nội dung động (ngày giờ, dữ liệu người dùng), biến thể A/B. Mỗi kết luận kèm ảnh và đoạn PRD.
- **Không có Figma cho app:** vẫn chạy được, chỉ theo PRD; report ghi rõ "không đối chiếu Figma". Người xây kiểm tra dữ liệu Figma đã nhập đang lưu những gì (ảnh frame, chuyển cảnh) để cho AI xem.
- **Trạng thái app lúc bắt đầu:** cài sạch, mở app. Có ô tùy chọn nhập tài khoản test (giống chế độ Tự khám phá hiện có). AI Test giữ phiên thiết bị suốt lần chạy theo cơ chế khóa hiện có.
- **Report:** làm bộ vẽ report ngắn riêng trong tool, dùng chung kiểu giao diện của report chung. **Không sửa skill `test-report`**, để khỏi phải cài lại cho mọi project (theo quy tắc trong CLAUDE.md của thư mục automation).
- **Lịch sử:** mỗi lần chạy lưu ở collection `smoke` của store (không phải `data/runs`), có danh sách xem lại theo app. Không so sánh giữa các lần.
- **Nút tạo bug Asana:** không làm trong bản này.

## 7. Còn mở (chỉ Trang trả lời được)

- **PRD đến từ begamob.** Người dùng dán link PRD vào AI Smoke Test, tool tự đọc nội dung. Link mẫu của Trang: `https://developers.begamob.com/workspace/stress-watch/prd1/blood-sugar` (PRD "Blood Sugar" của StressWatch). **Đã thử đọc:** đọc được qua Web Document MCP (`project_doc_get_by_url`, đường dẫn bắt đầu bằng `/workspace/`), trả về markdown, kèm mục lục (outline) và đọc từng mục được. PRD mẫu dài ~46.000 ký tự, 9 phần: mô tả, entry point + user flow (có sơ đồ Mermaid), bảng thành phần từng màn, business rules, acceptance criteria, happy case, và mục "Unresolved khi giao". Trong PRD có ghi chú `[Cần xác nhận]` chỗ chưa rõ: đó chính là chỗ AI nên báo "PRD chưa rõ" thay vì tự đoán. Ngoài ra vẫn cho **tải file / dán chữ** làm đường dự phòng.
- **Còn chưa rõ cho người xây:** cách server tool đọc PRD. `claude -p` trong tool đang chạy ở chế độ không công cụ, nên cần bật riêng công cụ MCP đọc tài liệu cho bước này (đã có cấu hình trên máy Trang), hoặc gọi thẳng API begamob. Người xây phải chọn và thử.
- **Figma (quyết định của Trang): đọc thẳng từ link Figma**, không dùng cách nhập file .json bằng plugin. Link mẫu: `https://www.figma.com/design/SrFaXD304rwjPXcNRqXzh0/Moss--Copy-?node-id=5433-75649`. Một request thường tới link bị chặn (403), nên cần Figma MCP, đã xác thực bằng đăng nhập một lần, không dán token API. **Đã thử đọc:** `get_metadata` đọc được node này. Đó là một section "Blood Sugar" rất lớn (~274.000 ký tự, 1.298 frame), chia 4 nhóm: "Log Blood Sugar", "Blood Sugar - Detail", "History", và frame "Health". Vì vậy tool **không** được đọc cả cây một lần: chỉ lấy danh sách frame cấp màn hình, rồi lấy ảnh (`get_screenshot`) từng frame khi cần so. Chức năng này **không** dùng dữ liệu Figma đã nhập trong tool (`app.figmaFrames`).


## 8. Cập nhật sau lần chạy thật và review (2026-11-05) — hành vi hiện tại là chuẩn

Lần chạy thật trên app Moss cho thấy cài sạch thì onboarding và paywall chặn mọi luồng. Yêu cầu và hành vi được chỉnh như sau:

- **PRD và Figma đều tuỳ chọn, cần ít nhất một.** Chỉ Figma, chỉ PRD hoặc cả hai đều chạy; không có link nào thì lỗi 400. Cả hai link được kiểm: link đưa vào mà đọc không được (`sources: failed`) hoặc không tải được frame Figma nào thì lần chạy `error` kèm hướng dẫn đăng nhập lại MCP bằng `/mcp`, không chạy tiếp lặng lẽ.
- **Figma từ file `.json` (thêm sau khi Figma MCP gói Starter báo vượt giới hạn gọi):** form có thêm ô chọn file xuất từ plugin `figma-plugin/`. File có sẵn ảnh frame và cây node nên không gọi Figma MCP. AI nhận danh sách frame (id, tên, loại, chữ, chuyển cảnh prototype); chỉ có file .json thì rút luồng ở chế độ không công cụ. File .json thắng link Figma. Kiểm định dạng ngay khi bấm Chạy (400).
- **So màu / kích thước / vị trí bằng code (chỉ khi có file Figma .json):** AI điền `atFrame` khi màn hiện tại là màn của một frame trong file; tool chạy `analyzeCapture` (bộ so của UI Testing) lấy tối đa 6 điểm lệch (bỏ Trivial) mỗi frame mỗi luồng, ghi thành điểm lệch kind `figma` kèm ảnh so. Không dùng AI cho phép đo. File .json có màu nền / chữ / viền / bóng RGB, cỡ chữ, bo góc, vị trí; không có màu gradient, tên token. Chế độ link Figma (MCP) không có cây node nên không so bằng code.
- **Lọc nhiễu khi so Figma bằng code:** (1) layer ẩn, ngoài khung frame, hoặc bị layer SOLID đặc phía trên che kín (vd màn nền dưới modal nền trắng) bị bỏ khỏi cây Figma ngay khi nạp file (`server/smoke/occlusion.js`), nên không vào bản tóm tắt cho AI và không bị coi là "thiếu chữ"; (2) bộ lọc điểm lệch (`server/smoke/noise.js`): bỏ lệch vị trí / cỡ chữ / xuống dòng / vùng / icon, khác chữ chỉ giữ khi hai chữ gần giống, thiếu chữ chỉ giữ khi là nhãn thật, mục tiêu là dữ liệu (số, ngày, đơn vị) thì bỏ, trùng giữa các frame chỉ ghi một lần. Số liệu trong Figma được coi là dữ liệu minh họa.
- **Giai đoạn chuẩn bị:** trước các luồng, AI tự đưa app tới màn chính (onboarding, quyền, paywall không mua), ngân sách riêng 40 bước, không tính vào luồng nào. Không tới được thì lần chạy `error` với lý do. Bước chuẩn bị ở màn thường không dùng ảnh (tiết kiệm token); gặp paywall hoặc màn ít phần tử thì dùng ảnh.
- **Hành động `tapPoint`:** AI bấm theo toạ độ % trên ảnh màn hình (nút X vẽ bằng ảnh, không có trong cây phần tử). Tool tự đóng paywall tối đa 2 lần rồi giao cho AI.
- **Chính sách quyền hệ thống:** cho phép quyền tính năng cần (Health, thông báo, camera, vị trí, ảnh…), chỉ từ chối theo dõi quảng cáo.
- **Chặn mua trong code** (không chỉ prompt): từ chối `tap`/`tapPoint` lên nút mua / đăng ký / dùng thử ("Continue / Confirm / Pay…" bị chặn ở màn paywall); popup hệ thống không bao giờ chọn nút mua (hộp xác nhận mua → Cancel).
- **Không "đạt" khi chưa làm gì:** `done` + `ok` mà chưa có thao tác thành công nào → `unverifiable`.
- **Dừng:** bấm Dừng huỷ ngay mọi lần gọi AI đang chạy (rút luồng, tải ảnh, từng bước) bằng tín hiệu huỷ.
- **Gộp điểm lệch:** prompt của luồng sau nhận danh sách điểm lệch đã ghi ở luồng trước để không ghi lại cùng một nguyên nhân.
- **Tài khoản test:** không lưu vào store; khi có tài khoản, các lần gọi AI dùng `--no-session-persistence` để mật khẩu không nằm trong transcript.
- **Token:** các bước thao tác dùng chế độ gọn của `runClaude` (`lean`: chỉ `Read`, tắt MCP); rút luồng và lấy ảnh frame không dùng lean vì cần MCP. Mỗi lần chạy cộng dồn số lần gọi AI, token và chi phí thật (đọc từ kết quả `claude -p`) và hiển thị ở trang kết quả và report. Đo thật: một lần gọi `claude -p` mặc định nạp ~33.000 token định nghĩa công cụ / MCP.
- **MCP:** `claude -p` không nạp connector claude.ai, nên cần đăng nhập MCP `begamob` và `figma` bằng `/mcp`.
- **Đã gỡ "AI kiểm UI"** (bản sao lưu ở `.superpowers/backup-ai-kiem-ui`).

# Plugin "QA Pipeline – Export frame"

Xuất frame Figma ra 1 file `.json` (dữ liệu chữ, vị trí, màu, cỡ chữ, constraints + ảnh PNG) để QA Pipeline so UI của app với Figma.

Bản 3 của file (ngang bộ figma-reader-kit) còn có: **auto layout** (gap, padding, căn trục, co giãn, wrap, min/max), **line-height / letter-spacing / giãn đoạn / gạch chân**, **chữ nhiều style trong một layer** (`styleSegments` theo từng đoạn), **gradient** (điểm màu + vị trí), **bóng đủ** (spread, blend), **bo góc từng góc**, **layer ẩn do cha ẩn** (`hiddenByAncestor`), và **biến / style / component** (`boundVariables`, `*StyleId`, `componentId`, `overrides`, `componentProperties`) kèm bảng `refs` ở gốc mỗi frame (tên biến + collection + giá trị từng mode như Light/Dark, tên style, tên component). Trường mới chỉ có khi nguồn có dữ liệu. File cũ vẫn đọc được. Ảnh PNG xuất @3x (đổi được trong cửa sổ plugin).

Chọn **cả Section** là lấy luôn frame của các Section con bên trong (kể cả lồng nhiều tầng). Tên file tự đặt theo thứ đang chọn: chọn đúng 1 Section hoặc frame thì file là `<tên>-<node-id>.json`, ví dụ Section Blood Sugar có link `?node-id=5433-75649` → `Blood Sugar-5433-75649.json` (node-id trùng với link nên dễ đối chiếu); chọn nhiều node thì `<tên file Figma>-<số frame>-frame.json`.

Kiểm file vừa xuất: `node scripts/check-figma-export.js ~/Downloads/<file>.json`. Mỗi nhóm dữ liệu báo ✓ (đủ), – (design không có, bình thường), ! (cần chú ý, vd chỉ 1 frame) hoặc ✗ (design có nhưng file thiếu: lỗi thật).

Giới hạn: ảnh thật của fill ảnh chỉ có `imageHash` (không nằm trong JSON); ảnh PNG của frame đã chứa hình. Layer vector không có path SVG. Frame quá lớn thì file lớn (vài trăm KB mỗi frame) nên xuất theo từng nhóm frame cần so.
Không cần Figma trả phí, không cần token, không gọi API, không gửi dữ liệu ra ngoài.

## Cài (1 lần)

1. Cài **Figma Desktop** (plugin tự cài chỉ chạy trên bản Desktop, không chạy trên trình duyệt).
2. Mở một file bất kỳ → menu **Plugins → Development → Import plugin from manifest…**
3. Chọn file `figma-plugin/manifest.json` trong thư mục tool.

## Dùng

1. File design của designer chỉ có quyền xem → **Duplicate to your drafts** (menu tên file). Plugin cần quyền sửa nên chạy trên bản copy.
2. Kiểm tra tab **Prototype** (panel phải): các mũi tên nối nút → frame đích (On tap → Navigate to, kiểu animation, thời lượng). Có prototype thì tool gợi ý bước Animation và tính phủ chuyển cảnh.
3. Frame trạng thái (loading, lỗi, rỗng…) đặt tên có dấu `/`, vd `Login / Error`, hoặc dùng variant.
4. Chọn các frame cần so — **cả frame nguồn lẫn frame đích** của chuyển cảnh (chọn cả Section cũng được) → **Plugins → Development → QA Pipeline – Export frame** → **Xuất file .json**.

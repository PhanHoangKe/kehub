# Kế Hoạch Công Việc (Todo / Plan)

> Sử dụng file này cho **mọi tác vụ 3+ bước / phức tạp / liên quan kiến trúc**.
> Đọc kỹ [rules.md](./rules.md) TRƯỚC KHI điền vào đây.
>
> **LUÔN tạo một MỤC mới đầu file cho một nhiệm vụ mới (không ghi đè nhiệm vụ cũ).**
> Định dạng mẫu bên dưới cho mỗi nhiệm vụ.

---

## Mẫu (Copy từ đây cho mỗi lần mới)

```md
### Nhiệm vụ: <TÊN GỌI GỌN, Cụ thể, có thể kiểm tra>
- Người dùng yêu cầu: <trích dẫn hoặc tóm tắt yêu cầu>
- Thời gian tạo: <DD-MM-YYYY HH:mm>
- Ước tính độ phức tạp: 🔴 Cao / 🟡 Trung bình / 🟢 Thấp
- File liên quan: <liên kết file/dir sử dụng format codebase>

#### Bước 1 - Lập kế hoạch trước (Plan)
- [ ] <Mục kiểm tra được 1>
- [ ] <Mục kiểm tra được 2>
- [ ] <Mục kiểm tra được 3>
- [ ] …

#### Bước 2 - Xác minh kế hoạch (Verify Plan)
- [ ] Kiểm tra thiếu sót: Đã bao quát hết yêu cầu chưa?
- [ ] Đánh giá rủi ro: Có thể phá vỡ chức năng nào khác không?
- [ ] Xem bài học cũ: Đã kiểm tra [lessons.md](./lessons.md) chưa?
- [ ] Quyết định: Tiến / Hỏi thêm / Tinh chỉnh lại?

#### Bước 3 - Theo dõi tiến độ (Track)
> Đánh dấu [x] khi hoàn thành, GHI THỜI GIAN + GIẢI THÍCH ngắn bên cạnh (bắt buộc).

- [ ] <Bước thực hiện 1> — <ngày giờ> — <ghi chú ngắn gì đã làm / kết quả>
- [ ] <Bước thực hiện 2> — <ngày giờ> — <ghi chú ngắn>
- [ ] …

#### Bước 4 - Giải thích thay đổi (Explain - mỗi bước)
> Ghi tóm tắt thay đổi cấp độ cao khi kết thúc mỗi nhóm bước liên quan.
>
> Ví dụ: Đã chuyển logic login admin từ xóa theo IP sang xóa theo `sessionId` + `fingerprint`
> để tránh mất dữ liệu khách dùng chung WiFi/NAT.

#### Bước 5 - Ghi lại kết quả / Đánh giá (Evaluate)
- Trạng thái cuối cùng: ✅ Thành công / 🟡 Một phần / ❌ Thất bại (chọn 1)
- Bằng chứng hoạt động (VERIFY BEFORE SHIP):
  - [ ] Test local (nếu có): <kết quả / lệnh / output>
  - [ ] Test production/staging (nếu có): <kết quả>
  - [ ] So sánh hành vi trước/sau thay đổi: <nội dung so sánh>
  - [ ] Câu hỏi "Kỹ sư cấp cao có phê duyệt không?": (Có / Không, vì sao?)
- Thời gian thực tế: <X phút / Y giờ>
- Đánh giá cá nhân: <Nhận xét gì về kế hoạch, những gì đúng/sai>

#### Bước 6 - Ghi nhận bài học (Lessons)
> Đã ghi nhận vào [lessons.md](./lessons.md) chưa?  <link đến dòng cụ thể trong lessons.md>
```

---

## Ví dụ mẫu (tham khảo, xóa khi sử dụng thật)

> Dưới đây là ví dụ đã điền xong — giữ tham khảo. Copy phần "Mẫu" ở trên để dùng.

### Nhiệm vụ ví dụ: Fix lỗi admin xóa nhầm session khách cùng WiFi
- Người dùng yêu cầu: "Admin đăng nhập xong, record khách truy cập cùng mạng bị mất hết"
- Thời gian tạo: 06-08-2026 09:00
- Ước tính độ phức tạp: 🟡 Trung bình
- File liên quan: [server.js](../server.js), [admin.js](../js/admin.js)

#### Bước 1 - Lập kế hoạch trước
- [ ] Phân tích luồng login admin & cleanup logic
- [ ] Thêm trường `sessionId` vào DB visitor
- [ ] Sửa cleanup logic: xóa theo `sessionId` thay vì `ip`
- [ ] Kiểm tra / test trên local không xóa nhầm

#### Bước 2 - Xác minh kế hoạch
- [x] Kiểm tra thiếu sót: OK, đã bao quát cả fingerprint dự phòng
- [x] Đánh giá rủi ro: Có thể ảnh hưởng visitor count nếu session cookie bị vô hiệu hóa — cần kiểm tra
- [x] Xem bài học cũ: Đã đọc lessons.md, có đề cập NAT IP
- [x] Quyết định: Tiến hành triển khai

#### Bước 3 - Theo dõi tiến độ
- [x] Phân tích server.js tìm cleanup — 09:05 — tìm thấy `DELETE FROM visitors WHERE ip = ?`
- [x] Thay điều kiện `DELETE` thành `sessionId = ? OR fingerprint = ?` — 09:15
- [x] Chạy test local 2 tab khác IP / cùng IP — 09:25 — PASS, không xóa nhầm

#### Bước 4 - Giải thích thay đổi
Logic cleanup sau admin login giờ đây so sánh theo `sessionId` (cookie `v_server_sess_id`) và
`fingerprint` do client gửi, không còn dựa vào IP nữa → tránh xóa hàng loạt khách dùng WiFi chung.

#### Bước 5 - Ghi lại kết quả / Đánh giá
- Trạng thái cuối cùng: ✅ Thành công
- Bằng chứng hoạt động:
  - [x] Test local: `curl -X POST /api/admin/login` với acc admin rồi xem DB chỉ có đúng 1 session bị xóa
  - [x] So sánh trước/sau: Trước khi sửa → 4 record bị xóa; sau sửa → chỉ 1 record đúng admin bị xóa
  - [x] "Kỹ sư cấp cao có phê duyệt không?": Có, defensive programming, xử lý cả edge case cookie bị tắt (fallback fingerprint)
- Thời gian thực tế: 30 phút (ước tính ban đầu 45 phút — nhanh hơn do kế hoạch rõ ràng)
- Đánh giá cá nhân: Kế hoạch có đề cập rủi ro và kiểm tra đã giúp tìm ra fallback fingerprint kịp thời.

#### Bước 6 - Ghi nhận bài học
Đã ghi vào [lessons.md](./lessons.md#ip-only-filtering-xoa-nham-session-trong-mang-nat).
```

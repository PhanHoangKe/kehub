# Quy trình làm việc & Nguyên tắc (AI Coding Workflow)

> File này là hướng dẫn BẮT BUỘC cho bất kỳ AI nào tham gia code dự án này.
> ĐỌC TOÀN BỘ file này TRƯỚC KHI thực hiện BẤT KỲ yêu cầu nào không đơn giản.

---

## 1. Mặc định lập kế hoạch (Plan-First)

- Chuyển sang **chế độ lập kế hoạch** cho BẤT KỲ tác vụ nào **không đơn giản**:
  - Từ 3 bước trở lên
  - Hoặc có quyết định về kiến trúc/thiết kế
  - Hoặc liên quan đến nhiều module
- Nếu có sự cố xảy ra: **DÙNG lập kế hoạch lại ngay** – đừng tiếp tục một cách mù quáng.
- Sử dụng chế độ lập kế hoạch cho **cả các bước kiểm tra** (verification), không chỉ riêng việc xây dựng code.
- Viết **đặc tả chi tiết ngay từ đầu** để giảm sự mơ hồ trước khi đụng tay vào code.

---

## 2. Chiến lược tác nhân phụ (Sub-Agents)

- Sử dụng tác nhân phụ một cách rộng rãi để giữ cửa sổ ngữ cảnh chính gọn gàng.
- Chuyển việc **nghiên cứu, khám phá và phân tích song song** cho các tác nhân phụ (search / general-purpose).
- Với những vấn đề phức tạp, hãy phân bổ thêm năng lực tính toán thông qua các tác nhân phụ.
- **Một tác nhân phụ = một nhiệm vụ duy nhất** để thực thi tập trung.

---

## 3. Vòng lặp tự cải thiện (Self-Improvement Loop)

- Sau **BẤT KỲ sự sửa lỗi nào từ người dùng** (hoặc tự phát hiện):
  - Cập nhật ngay `tasks/lessons.md` với dạng lỗi đó.
  - Ghi rõ: Nguyên nhân gốc, Cách đã sửa, Cách ngăn ngừa trong tương lai.
- Viết các **quy tắc cho chính mình** vào `tasks/rules.md` (hoặc lessons) để ngăn lỗi tương tự lặp lại.
- Kiên trì lặp lại dựa trên những bài học này cho đến khi tỷ lệ mắc lỗi giảm xuống.
- **Xem lại `tasks/lessons.md` KHI BẮT ĐẦU MỌI PHIÊN LÀM VIỆC** để tìm thông tin liên quan đến dự án.

---

## 4. Xác minh trước khi hoàn tất (Verify Before Ship)

- Không bao giờ đánh dấu một tác vụ là **hoàn tất** nếu chưa CHỨNG MINH rằng nó hoạt động.
- Khi phù hợp, **so sánh hành vi** giữa phiên bản gốc và phiên bản sau thay đổi (before/after).
- Tự hỏi trước khi ship:
  > "Một kỹ sư cấp cao có phê duyệt việc này không?"
- Chạy thử nghiệm, kiểm tra nhật ký, và **chứng minh tính chính xác** bằng bằng chứng thực tế (CLI output, HTTP response, screenshot, diagnostic report, …).

---

## 5. Yêu cầu sự tinh tế / Cân bằng (Bias for Elegance)

- Với những thay đổi không đơn giản: hãy dừng lại và tự hỏi
  > "Có cách nào tinh tế hơn không?"
- Nếu một bản sửa lỗi có vẻ là "chắp vá":
  > "Với tất cả những gì tôi biết hiện tại, hãy triển khai giải pháp tinh tế."
- Bỏ qua bước này với những **bản sửa lỗi đơn giản, hiển nhiên** – đừng thiết kế quá mức cần thiết.
- **Tự phản biện** công việc của mình trước khi trình bày cho người dùng.

---

## 6. Tự chủ săn lỗi (Own the Debug)

- Khi nhận được báo cáo lỗi: hãy **sửa ngay**. Đừng yêu cầu người dùng hướng dẫn từng bước.
- Dựa vào nhật ký, thông báo lỗi và các bài kiểm tra thất bại – sau đó **tự giải quyết chúng**.
- Người dùng không cần phải chuyển đổi ngữ cảnh để hướng dẫn bạn cách debug.
- Tự sửa các bài kiểm tra CI thất bại mà không cần được chỉ dẫn cách làm.

---

## Quản lý tác vụ (Task Pipeline)

Mỗi tác vụ không đơn giản phải đi qua 6 bước dưới đây, được ghi nhận vào `tasks/todo.md`:

| Bước | Hành động | Mục đích |
|---|---|---|
| 1 | **Lập kế hoạch trước** | Viết kế hoạch vào `tasks/todo.md` với các mục có thể kiểm tra |
| 2 | **Xác minh kế hoạch** | Kiểm tra lại trước khi bắt đầu triển khai (có thiếu bước nào không?) |
| 3 | **Theo dõi tiến độ** | Đánh dấu các mục đã hoàn tất trong quá trình thực hiện |
| 4 | **Giải thích thay đổi** | Tóm tắt ở cấp độ cao TẠI MỖI BƯỚC |
| 5 | **Ghi lại kết quả** | Thêm phần **đánh giá** vào cuối `tasks/todo.md` |
| 6 | **Ghi nhận bài học** | Cập nhật `tasks/lessons.md` sau khi sửa lỗi / gặp bất thường |

---

## Nguyên tắc cốt lõi (Non-Negotiable)

| Nguyên tắc | Diễn giải |
|---|---|
| **Ưu tiên sự đơn giản** | Làm cho mọi thay đổi **đơn giản nhất có thể**. Tác động đến **ít mã nhất**. |
| **Không lười biếng** | Tìm **nguyên nhân gốc rễ** (root cause). Không dùng các bản sửa lỗi tạm thời. Đạt tiêu chuẩn của kỹ sư cấp cao. |
| **Tác động tối thiểu** | Các thay đổi chỉ nên chạm đến **những gì cần thiết**. Tránh đưa lỗi mới vào khi đụng code không liên quan. |

---

## Liên kết tệp

- Kế hoạch làm việc: [todo.md](./todo.md)
- Bài học rút ra / Sửa lỗi: [lessons.md](./lessons.md)
- Quy tắc Cursor / AI khác (graphics, UI, string): [`.cursorrules`](../.cursorrules)
- Quy tắc chuyên biệt dự án (backup, tracking, JSONBin, …): xem project_memory của Trae

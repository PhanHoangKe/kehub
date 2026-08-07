# Thanh Xuân của Kế — Youth Memories Hub

Web cá nhân "Thanh Xuân của Kế" — một trang sinh viên/thanh xuân tích hợp đầy đủ các tính năng: thời khóa biểu, bạn bè, thành tích, nhật ký, lưu bút, tin nhắn ẩn danh, admin panel, backup tự động và 3 tính năng AI.

- **Frontend**: HTML + CSS + JS thuần (không framework), ES6 modules.
- **Backend:** Node.js (module `http` thuần, không framework), REST API + static file server.

---

## Tính năng AI

| Tính năng | Nơi xử lý | Cách chạy |
|-----------|-----------|-----------|
| **AI Gia sư Toán THPT** | `ai-tutor/` (Express, ESM) | Cổng riêng `3001`, được server chính reverse-proxy qua `/api/ai-tutor` |
| **Đặc Vụ Đòi Nợ AI** | `server.js` + `debtAgentService.js` | Gọi Gemini trực tiếp từ backend |
| **AI Ảnh Affiliate** | `sd-colab-generator.ipynb` (ComfyUI + RealVisXL trên Colab) | Trình duyệt gọi thẳng tới URL ngrok của Colab, KHÔNG qua server |

### Kiến trúc AI khi deploy
- `server.js` (port 3000) là **cổng vào duy nhất** cho web + Admin + `debt-agent` + **proxy → ai-tutor**.
- `ai-tutor/index.js` (port 3001) là tiến trình riêng. **Cả 2 tiến trình phải cùng chạy** để AI Gia Sư hoạt động qua proxy.
- AI Ảnh Affiliate chạy ngoài — tự dán URL ComfyUI/ngrok trong `ai-affiliate.html`, không phụ thuộc backend.

---

## Cài đặt (local)

### Yêu cầu
- Node.js ≥ 18
- (Tính năng AI) API key Google Gemini — miễn phí tại [Google AI Studio](https://aistudio.google.com/)

### Bước 1 — Backend chính
```bash
npm install                # cài nodemailer
cp .env.example .env       # rồi điền các giá trị bên dưới
npm start                  # chạy: http://localhost:3000
```

### Bước 2 — AI Gia Sư Toán (tiến trình riêng)
```bash
cd ai-tutor
npm install
cp .env.example .env       # điền GOOGLE_API_KEY, chọn VECTOR_DB (upstash/pinecone)
npm run seed               # (tùy chọn) nạp dữ liệu vector
npm start                  # chạy: http://localhost:3001
```

Sau khi cả 2 chạy, truy cập `/ai-tutor-chat.html` — request `/api/ai-tutor/...` được server.js chuyển tiếp sang port 3001.

### Dùng AI ảnh Affiliate
Mở `sd-colab-generator.ipynb` trên **Google Colab**, khởi động ComfyUI + RealVisXL, lấy URL ngrok + seed dán vào `ai-affiliate.html` để tạo ảnh inline — **không cần backend**.

> ⚠️ Yêu cầu GPU đủ mạnh (Colab free chỉ chạy ảnh nhỏ RealVisXL). Model video như Wan2.2 cần ≥24GB VRAM nên không chạy được trên Colab free.

---

## Các biến môi trường (`server.js` / `.env`)

| Biến | Bắt buộc? | Mô tả |
|------|-----------|-------|
| `ADMIN_PASSWORD` | **Bắt buộc** | Mật khẩu admin (**KHÔNG có mặc định** — thiếu thì tạo ngẫu nhiên mỗi lần khởi động). |
| `SESSION_SECRET` | Tùy chọn | Tự sinh nếu thiếu. |
| `PORT` | Tùy | Cổng chính, mặc định 3000. |
| `GITHUB_TOKEN` / `GITHUB_REPO` | Tùy | Backup DB lên GitHub (tự động). |
| `CLOUDINARY_*` | Nếu dùng upload | Upload ảnh lên Cloudinary. |
| `EMAIL_USER` / `EMAIL_APP_PASS` | Nếu gửi mail | SMTP (Gmail app password). |
| `AI_TUTOR_PORT` | Tùy | Cổng ai-tutor cho proxy, mặc định 3001. |

### Biến của `ai-tutor/.env`
| Biến | Mô tả |
|------|-------|
| `EMBEDDING_PROVIDER` | `google` hoặc `openai` |
| `GOOGLE_API_KEY` / `OPENAI_API_KEY` | Khóa API LLM/embedding |
| `VECTOR_DB` | `upstash` hoặc `pinecone` |
| `UPSTASH_VECTOR_*` / `PINECONE_API_KEY` | Cấu hình vector database |

---

## Cấu trúc thư mục

```
.
├── server.js                 # Backend chính (REST + static + proxy ai-tutor)
├── ai-tutor/                 # AI Gia Sư Toán (Express, ESM, port 3001)
│   ├── index.js
│   ├── routes/  controllers/  services/  seedData.js
├── ai-affiliate.html         # AI Ảnh Affiliate (ComfyUI + Colab)
├── ai-tutor-chat.html        # Giao diện chat Gia Sư
├── debt-agent.html           # Giao diện Đặc Vụ Đòi Nợ
├── debtAgentService.js / emailService.js
├── sd-colab-generator.ipynb  # Notebook khởi động ComfyUI trên Colab
├── js/                       # Modules frontend (app, admin, guestbook, weather...)
├── style.css                 # Stylesheets chính
├── data/                     # Dữ liệu runtime (thời gian biểu, db.json...)
├── uploads/                  # File upload
```

---

## Triển khai lên Render (mẫu)

1. Deploy backend `server.js` (Render Web Service, start `npm start`).
2. Đặt biến env: `ADMIN_PASSWORD`, `SESSION_SECRET`, `GITHUB_TOKEN`, `CLOUDINARY_*`,...
3. Deploy `ai-tutor` thành một Web Service thứ 2 (không public), ghi nhớ port.
4. Trong backend, set `AI_TUTOR_PORT` = port của Web Service ai-tutor.
5. Health check `/api/health` giúp giữ Render luôn hoạt động (không cold start).

> ⚠️ **Bảo mật:** Không bao giờ commit `.env`. Luôn đặt `ADMIN_PASSWORD` rõ ràng. Không dựa vào password mặc định (không tồn tại).

## Thay đổi cải tiến (P0)

- Reverse-proxy `/api/ai-tutor/*` → `ai-tutor` (thống nhất cổng vào, một URL công khai).
- Loại bỏ password admin mặc định cứng — buộc đặt qua `ADMIN_PASSWORD`.
- Dọn các file backup/tạm và thêm vào `.gitignore`.
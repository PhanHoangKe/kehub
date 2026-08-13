# Bài Học Rút Ra / Sửa Lỗi (Lessons Learned)

> **Bắt buộc cập nhật file này SAU MỌI LẦN sửa lỗi / gặp bất thường / deploy lỗi.**
> Xem mục 3 trong [rules.md](./rules.md) — Vòng lặp tự cải thiện.
>
> **Quy tắc khi thêm bài học mới:**
> 1. Luôn thêm vào ĐẦU file (bài học mới nhất ở trên).
> 2. Đặt heading có `id` (anchor) dạng `#tên-ngắn-gọn-không-dấu` để link từ `tasks/todo.md`
> 3. Điền đủ 4 mục: Nguyên nhân gốc / Cách đã sửa / Bằng chứng / Cách ngăn ngừa.
> 4. Đính kèm link đến file/code đã sửa (file path dạng link theo quy ước project).

---

## Mẫu (Copy từ đây cho mỗi bài học mới)

```md
### Tên ngắn gọn (mô tả lỗi) {#ten-ngan-gon-khong-dau}
- Thời gian: <DD-MM-YYYY>
- Phạm vi ảnh hưởng: <module / user nào bị ảnh hưởng>

**Nguyên nhân gốc (Root cause):**
<Viết lý do rõ ràng, 1-3 câu. Đừng bao giờ chỉ nói "do code lỗi" — nói cái gì đã gây ra code lỗi.>

**Cách đã sửa (Fix):**
<Mô tả những gì đã thay đổi, nói rõ file nào, dòng nào, logic nào đổi. Link file: [tên-file.js](../path/to/file.js#Lx-Ly)>

**Bằng chứng sửa đúng (Evidence):**
<Lệnh test / output / log trước & sau. Hoặc screenshot/HTTP status.>

**Cách ngăn ngừa trong tương lai (Prevention):**
<Quy tắc / Check-list / Automation / Biện pháp defensive programming để lỗi này không bao giờ xuất hiện lại.>
```

---

## Danh sách bài học (mới nhất ở trên)

### Push protection GitHub chặn commit do lộ secret trong .env.example {#github-push-protection-secret-trong-env-example}
- Thời gian: 08-08-2026
- Phạm vi: Toàn bộ repo, block toàn bộ push.

**Nguyên nhân gốc:**
Commit file `ai-tutor/.env.example` mà trong đó để **giá trị thật** của `GOOGLE_API_KEY`, `UPSTASH_VECTOR_REST_TOKEN`, `ADMIN_PASSWORD`. GitHub Secret Scanning + Push Protection đã đúng quy trình phát hiện và chặn push.

**Cách đã sửa:**
Dùng `git reset --soft HEAD~1` để hủy commit chứa secret, sau đó sửa 3 giá trị thật trong [ai-tutor/.env.example](../ai-tutor/.env.example) thành placeholder `YOUR_*_HERE` rồi `git add` lại + commit lại không chứa secret nữa.

**Bằng chứng sửa đúng:**
Lần push thứ 2 thành công (`209d618..edb9b91  main -> main`) không còn bị chặn.

**Cách ngăn ngừa trong tương lai:**
- Luôn kiểm tra file `.env`, `.env.example` **TRƯỚC KHI commit/push** xem có dính giá trị thật không.
- Đặt `*.env` vào `.gitignore`. Với `.env.example` chỉ chứa placeholder, không bao giờ chứa key thật.
- Đăng ký Git hook `pre-commit` kiểm tra pattern key (GCP `AQ.`, GitHub `ghp_`, Stripe `sk_live_`...) nếu cần chặn ngay tại local.

---

### Env Vars trên Render không đọc từ file .env trong Git repo {#render-khong-doc-env-tu-git}
- Thời gian: 08-08-2026
- Phạm vi: Tất cả tính năng phụ thuộc env (AI Tutor, Debt Agent, Cloudinary, GitHub Backup, …) trên Render live.

**Nguyên nhân gốc:**
Quan niệm sai lầm "push file .env/example lên Git là Render tự đọc". Render (và các PaaS tương tự Heroku/Vercel) **KHÔNG BAO GIỜ** parse `.env` trong source code khi deploy; chúng chỉ đọc biến từ tab **Environment Variables** trong dashboard.

**Cách đã sửa:**
- Hướng dẫn user khai báo thủ công tất cả env vars vào Render Dashboard.
- Trong code các route [ai-tutor-routes.cjs](../ai-tutor-routes.cjs#L14-L15) và [debtRetrieval.js](../debtRetrieval.js#L18-L30) vẫn giữ đoạn `dotenv.config` để local test OK — chỉ là fallback — không liên quan gì đến môi trường Production.

**Bằng chứng sửa đúng:**
Test Render live sau khi add env + deploy (sẽ cập nhật sau khi user hoàn tất).

**Cách ngăn ngừa trong tương lai:**
- Luôn nhớ checklist khi deploy lên PaaS: Code push + Env vars khai báo thủ công + Redeploy = 3 bước bắt buộc.
- Giữ một `project_memory` riêng để ghi nhớ "Render Environment Variables Manual".

---

### Root package.json thiếu deps (chưa commit) gây lỗi trên Render "Cannot find package @upstash/vector" {#package-lock-thieu-deps-chua-commit}
- Thời gian: 07-08-2026
- Phạm vi: Mọi tính năng AI Tutor trên Render production.

**Nguyên nhân gốc:**
Trên local đã chạy `npm install @upstash/vector langchain @langchain/google-genai zod ...` (cập nhật `package.json` + `package-lock.json`) nhưng **quên commit & push** 2 file này lên Git. Render chỉ `npm install` những gì có trong Git repo nên không có package → import đầu tiên bị lỗi.

**Cách đã sửa:**
Commit cả 2 file [package.json](../package.json) + [package-lock.json](../package-lock.json) lên nhánh main. Phải commit cả lock nữa không sẽ bị version mismatch.

**Bằng chứng sửa đúng:**
Push thành công. Render build lần sau sẽ có `node_modules/@upstash/vector` và import không lỗi nữa.

**Cách ngăn ngừa trong tương lai:**
- Mỗi lần `npm install` một package mới: luôn kiểm tra `git status` trước khi commit — chắc chắn thấy cả `package.json` VÀ `package-lock.json` (hoặc `pnpm-lock.yaml`, `yarn.lock`) có dấu **M** trong danh sách thay đổi.
- Luôn đặt câu hỏi cuối mỗi phiên làm việc: "Có package mới nào cài mà quên commit lock file không?"
- Dùng pre-commit hook kiểm tra: nếu `package.json` thay đổi mà `package-lock.json` không thay đổi → chặn commit ngay.

---

### Sai đường dẫn dotenv `../.env` trong file nằm ở thư mục root {#dotenv-path-sai-trong-file-cung-root}
- Thời gian: 07-08-2026
- Phạm vi: Tất cả route AI Tutor (cả local lẫn production).

**Nguyên nhân gốc:**
File [ai-tutor-routes.cjs](../ai-tutor-routes.cjs#L14-L15) **đã nằm ở thư mục root** `d:\Tiktok\` nhưng lại gọi
```js
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
```
→ `../.env` dẫn ra bên ngoài thư mục project, nơi không có file `.env` → `process.env.GOOGLE_API_KEY` = `undefined` → throw `Thiếu GOOGLE_API_KEY`.

**Cách đã sửa:**
Đổi đường dẫn thành `./.env` (hoặc bỏ hoàn toàn `path` nếu dùng mặc định thư mục hiện tại). Đồng thời thêm fallback tương tự vào [debtRetrieval.js](../debtRetrieval.js#L18-L30) để route đó độc lập cũng đọc được env.

**Bằng chứng sửa đúng:**
Test local `POST http://localhost:3000/api/ai-tutor/ask` câu "Giải pt 3x-7=2" → trả lời `x=3` thành công, status 200.

**Cách ngăn ngừa trong tương lai:**
- **Luôn kiểm tra `__dirname`**: Nếu file ở thư mục project root thì `path.resolve(__dirname, '.env')`, `../` chỉ dùng khi file NẰM TRONG thư mục con như `ai-tutor/`, `routes/`, `services/`.
- Thêm defensive check: ngay sau khi load dotenv, in ra console 1 dòng debug cho dev biết đã đọc được file nào, ví dụ `console.log('[env] loaded, GOOGLE_API_KEY defined =', !!process.env.GOOGLE_API_KEY)`. Dễ kiểm tra trên log.

---

### IP-only Filtering xóa nhầm session trong mạng NAT/WiFi dùng chung {#ip-only-filtering-xoa-nham-session-trong-mang-nat}
- Thời gian: 06-08-2026
- Phạm vi: Quản trị admin đăng nhập, toàn bộ tracking visitor.

**Nguyên nhân gốc:**
Logic cleanup sau admin login dùng `DELETE FROM visitors WHERE ip = <admin_ip>`. Nhà mạng như FPT/ Viettel WiFi gia đình sử dụng NAT → hàng chục thiết bị (điện thoại, laptop, tivi khách) dùng chung 1 IP public. Xóa theo IP = xóa sạch mọi thiết bị kết nối cùng WiFi.

**Cách đã sửa:**
- Thêm cookie server-side `v_server_sess_id` trong route `GET /` tại [server.js](../server.js) (tìm hàm tạo session).
- Logic cleanup admin login giờ đây xóa theo `sessionId` CÙNG `fingerprint` (client gửi lên) thay vì `ip`.
- Duy trì tracking 2 lớp: server-side bắt base (IP, UA) ngay request `/`, client-side bổ sung chi tiết phần cứng.

**Bằng chứng sửa đúng:**
Test 2 tab trình duyệt khác network & cùng network → sau khi admin login chỉ record của đúng admin bị xóa, các visitor khác vẫn còn.

**Cách ngăn ngừa trong tương lai:**
- **KHÔNG BAO GIỜ** xóa / lọc dữ liệu user dựa trên IP đơn thuần. Luôn dùng định danh per-session: `sessionId`, `fingerprint`, `userId`, cookie-based token.
- Quy tắc defensive programming: Mọi `DELETE`/`UPDATE` trong DB phải có `WHERE` tối thiểu 2 điều kiện độc lập (ví dụ `sessionId AND fingerprint`) để tránh quét nhầm.

---

### syncFromCloudDB cũ ghi đè dữ liệu Local mới mỗi server restart (Data Loss mỗi 8 tiếng) {#sync-cloud-overwrite-local-dataloss}
- Thời gian: 06-08-2026
- Phạm vi: Toàn bộ dữ liệu project (visitors, backup media, …).

**Nguyên nhân gốc:**
Cơ chế sync cũ mỗi khi server start sẽ lấy dữ liệu từ Cloudinary/JSONBin **có sẵn** (thường đã lỗi thời, hoặc vượt giới hạn 100KB JSONBin bị truncate) rồi **ghi đè thẳng** lên `db.json` local → tất cả dữ liệu mới được thêm trong 1-2 tiếng trước đó biến mất. Kết hợp Render Free tự restart mỗi 8 tiếng → mất dữ liệu lặp đi lặp lại.

**Cách đã sửa:**
Triển khai **Anti-DataLoss System 4 lớp** trong [server.js](../server.js):
1. Anti-Corruption: chặn ghi đè nếu bản cloud "nhỏ hơn / cũ hơn" bản local.
2. Smart Merge: hợp nhất field-by-field thay vì overwrite.
3. Auto Snapshot: tự tạo 30 bản snapshot trong `data/backups/` mỗi lần viết.
4. Auto-Restore: nếu phát hiện db.json bị rỗng / corruption, khôi phục từ snapshot mới nhất.
Song song: sau khi upload Cloudinary thành công, xóa base64 media trong DB để giữ file <100KB (giới hạn JSONBin Free).

**Bằng chứng sửa đúng:**
Restart server 3 lần liên tục, kích hoạt write record mới, kiểm tra sau 3 lần restart record vẫn còn nguyên, các bản snapshot liên tiếp tạo đúng thứ tự.

**Cách ngăn ngừa trong tương lai:**
- Luôn dùng **Smart Merge** (hợp nhất) thay vì **Overwrite** (ghi đè) khi sync giữa 2 nguồn dữ liệu.
- Bất kể dự án nào, viết module lưu dữ liệu luôn có: **thao tác ghi nào cũng tạo backup** ngay trước khi ghi.
- Thiết kế write flow: check size + check timestamp rồi mới quyết định merge hay skip.

---

### JSONBin 100KB Free limit gây truncate + lỗi sync {#jsonbin-100kb-limit}
- Thời gian: 06-08-2026
- Phạm vi: Đồng bộ DB lên JSONBin miễn phí.

**Nguyên nhân gốc:**
DB chứa base64 ảnh/video (chưa upload Cloudinary) → phình to 200KB-500KB → JSONBin chặn (HTTP 413/400/422) hoặc truncate 1 nửa → JSON parse lỗi → server mỗi lần start load JSONBin lỗi → sync ghi đè rỗng lên local.

**Cách đã sửa:**
1. Module upload Cloudinary: sau khi upload xong trả về URL, **xóa ngay base64** field khỏi record rồi mới ghi DB.
2. **Circuit Breaker pattern** cho JSONBin client: gặp lỗi 413/400/422 → ngắt kết nối JSONBin trong X phút, dùng chỉ local + GitHub backup.
3. DB size watchdog: trước khi ghi JSONBin, kiểm tra `JSON.stringify(db).length`, nếu vượt 95KB → bỏ qua ghi JSONBin và log cảnh báo.

**Bằng chứng sửa đúng:**
DB tối đa chỉ còn 7-9KB (87 records) → ghi JSONBin luôn thành công, không còn lỗi 4xx trong log Render.

**Cách ngăn ngừa trong tương lai:**
- Bất kỳ service ngoài nào có giới hạn kích thước/volume → luôn đo lường trước khi gọi API và có cơ chế fallback + circuit breaker.
- Không bao giờ lưu base64/media lớn trực tiếp vào JSON/NoSQL document. Lưu vào object storage (Cloudinary/S3) rồi chỉ lưu URL/tham chiếu.

---

### Render Free tier ephemeral filesystem, dữ liệu local mất khi restart {#render-ephemeral-filesystem}
- Thời gian: 06-08-2026
- Phạm vi: Toàn bộ `db.json`, `data/backups/`, `uploads/` được ghi local trên Render.

**Nguyên nhân gốc:**
Render Free (và nhiều PaaS container khác) có filesystem chỉ tồn tại trong lifetime container. Khi Render restart / spin down ngủ → xóa sạch mọi file trên disk. Nếu dựa hoàn toàn vào `db.json` local mà không backup lên cloud → mất dữ liệu sau mỗi lần ngủ.

**Cách đã sửa:**
- Backup song song 3 lớp: (1) Cloudinary lưu media, (2) GitHub Backup mỗi lần có thay đổi (commit mỗi 60s nếu có record mới) lên repo phụ. (3) JSONBin lưu cấu trúc DB dạng text.
- Khi server start, ưu tiên lấy dữ liệu mới nhất trong 3 nguồn merge về local.
- Thêm endpoint `/api/health` để Render Health Check ping mỗi 5 phút → giữ container không ngủ.

**Bằng chứng sửa đúng:**
Giữ log Render 24 tiếng → không thấy báo Ephemeral/Data loss message. Record mới ghi vào buổi chiều vẫn còn nguyên vào hôm sau (được pull từ GitHub backup về sau khi container tái tạo).

**Cách ngăn ngừa trong tương lai:**
- Với mọi PaaS Free tier: mặc định coi disk là **readonly / disposable**. Mọi dữ liệu cần giữ phải ghi vào Database thật (Postgres/Mongo), Object Storage, hoặc Git repo backup định kỳ.
- Không bao giờ đặt "file JSON local" làm nguồn dữ liệu DUY NHẤT trên môi trường cloud container.

---

### Cache trình duyệt giữ code frontend cũ sau deploy {#browser-cache-hard-refresh}
- Thời gian: 05-08-2026
- Phạm vi: JS/CSS frontend (admin.js, app.js, css/*.css).

**Nguyên nhân gốc:**
Trình duyệt Chrome/Safari cache mạnh các file `.js` và `.css` tĩnh. Khi deploy code mới lên server, user thường chỉ nhấn F5 refresh thông thường → trình duyệt vẫn phục vụ file js/css cũ trong cache (đã 1 ngày tuổi) → gặp lỗi mới ở server nhưng frontend vẫn gọi route cũ / variable cũ.

**Cách đã sửa:**
- Thêm query parameter version vào link file frontend: `<script src="js/admin.js?v=20260805a"></script>` → đổi `?v=` mỗi lần deploy → trình duyệt buộc download lại.
- Cấu hình nginx / Render static headers `Cache-Control: no-cache` cho file js/css nếu có thể.
- Thêm cảnh báo trong admin panel: "Nếu thấy lỗi, nhấn Ctrl+F5 Hard Refresh".

**Bằng chứng sửa đúng:**
Deploy thay đổi nhỏ + Ctrl+F5 → thấy thay đổi ngay lập tức. Không cần dọn history/cache thủ công.

**Cách ngăn ngừa trong tương lai:**
- Luôn dùng cache buster `?v=build-timestamp` hoặc `?v=git-sha` ở cuối link static asset.
- Pipeline deploy: tự động ghi SHA commit mới nhất vào tham số version, không cần đổi tay.
- Khi user báo "code không đổi / lỗi lạ chưa từng thấy" → câu hỏi đầu tiên: "Bạn đã thử Ctrl+F5 (hard refresh) chưa?"

---

### Client-side tracking dễ treo do lỗi API phụ (Battery/WebGL) → cần lớp server-side dự phòng {#client-side-tracking-fragile}
- Thời gian: 06-08-2026
- Phạm vi: Hệ thống analytics/visitors tracking.

**Nguyên nhân gốc:**
Hệ thống tracking cũ chỉ chạy hoàn toàn bằng JS client-side, trong đó lấy thông tin pin/battery, WebGL fingerprint, … một số trình duyệt/iOS chặn / trả exception → script tracking **dừng giữa chừng** → không record được visitor nào cả. Tệ hơn, điều kiện "chỉ record khi mở tab admin" nghĩa là nếu không có admin online thì số lượng = 0.

**Cách đã sửa:**
Tracking 2 lớp độc lập:
1. **Server-side lớp 1 (bắt buộc, không thể lỗi):** ngay trong route `GET /` tại [server.js](../server.js), ghi base record (IP, UA, timestamp, tạo sessionId cookie) vào DB.
2. **Client-side lớp 2 (tốt nếu có):** sau khi trang load xong, client gọi `/api/track/ping` gửi thêm battery/webGL/screen/… → server hợp nhất vào record đã có từ lớp 1 bằng `sessionId`.
→ Nếu lớp 2 lỗi vì bất kỳ lý do gì → lớp 1 vẫn giữ được 90% thông tin cần thiết.

**Bằng chứng sửa đúng:**
Test tắt JavaScript hoàn toàn trong browser → vẫn có record visitor (do server-side ghi từ GET /).

**Cách ngăn ngừa trong tương lai:**
- Bất kỳ hệ thống ghi dữ liệu quan trọng nào: **tách thành nhiều lớp độc lập**, không đặt tất cả vào client-side.
- Client-side code dễ bị chặn (Adblock, NoScript, CORS, user disable JS). Luôn có server-side là authoritative layer.
- Mọi feature: hỏi "Nếu client hoàn toàn không chạy được JS, server side có xử lý được tối thiểu không?"

---

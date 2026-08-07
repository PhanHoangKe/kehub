/**
 * index.js — Entry point cho module AI Gia sư Toán THPT
 *
 * Chạy độc lập (standalone):  node index.js  hoặc  npm run dev
 * Hoặc được tích hợp vào server.js chính qua import route.
 *
 * Khi chạy standalone, module này mở cổng AI_TUTOR_PORT (mặc định 3001).
 * Khi tích hợp vào server.js chính, chỉ dùng tutorRoute và bỏ qua listen().
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import tutorRouter from './routes/tutorRoute.js';
import { extractMathFromImage, validateImageBuffer } from './services/visionService.js';

/**
 * validatePdfBuffer — kiểm tra magic bytes của PDF (%PDF-)
 * @param {Buffer} buf
 * @returns {boolean}
 */
function validatePdfBuffer(buf) {
  if (!buf || buf.length < 5) return false;
  return buf.subarray(0, 5).toString('latin1') === '%PDF-';
}
import { searchCache, saveToCache } from './services/cacheService.js';
import { answerWithConsensus } from './services/llmService.js';
import { trySolveTemplate } from './services/templateEngine.js';
import { getReviewQueue, updateReview, deleteReview } from './services/reviewQueue.js';
import { addQA, smartImport, saveBatch, checkDuplicate, listQA, deleteQA } from './services/adminService.js';
import { parseHistory } from './controllers/tutorController.js';

const app = express();
const PORT = parseInt(process.env.AI_TUTOR_PORT ?? '3001', 10);

// ── Multer — memory storage (không lưu disk, xử lý trực tiếp trong RAM) ──────
const MAX_FILE_SIZE = parseInt(process.env.FILE_MAX_SIZE_BYTES ?? '15728640', 10); // 15 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,           // chỉ nhận 1 file mỗi request
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Định dạng không hỗ trợ: ${file.mimetype}. Chỉ nhận JPG, PNG, WebP, PDF.`));
    }
  },
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CORS_ORIGIN ?? '*' }));
app.use(express.json({ limit: '100kb' })); // giới hạn body (đề toán LaTeX dài)

// ── Mount router ──────────────────────────────────────────────────────────────
app.use('/api/ai-tutor', tutorRouter);

// ── Admin Rate Limit — chống brute-force password & spam nạp dữ liệu ─────────
// Giới hạn: mỗi IP được gọi tối đa 20 lần / 1 phút (đủ cho giáo viên nhập liệu,
// không đủ cho kẻ tấn công brute-force mật khẩu)
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Quá nhiều yêu cầu từ IP này. Vui lòng thử lại sau 1 phút.'
  }
});

// ── Admin Routes ──────────────────────────────────────────────────────────────
app.post('/api/admin/add-qa', adminLimiter, addQA);
app.post('/api/admin/smart-import', adminLimiter, smartImport);
app.post('/api/admin/save-batch',   adminLimiter, saveBatch);
app.post('/api/admin/check-duplicate', adminLimiter, checkDuplicate);
app.post('/api/admin/list-qa',      adminLimiter, listQA);
app.post('/api/admin/delete-qa',    adminLimiter, deleteQA);

// ── Review Queue (Consensus lệch → chờ giáo viên duyệt) ──────────────────────
//  GET queue + approve (lưu vào cache verified) + reject (xóa)
app.post('/api/admin/review-queue', adminLimiter, async (req, res) => {
  const password = (req.body?.password ?? '').toString();
  if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ success: false, message: 'Chưa cấu hình ADMIN_PASSWORD.' });
  if (!password || password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Sai mật khẩu Admin!' });

  try {
    const entries = await getReviewQueue();
    return res.status(200).json({ success: true, count: entries.length, entries });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

//  Approve: giáo viên chọn đáp án đúng (A hoặc B) → lưu vào cache verified:true
app.post('/api/admin/review-approve', adminLimiter, async (req, res) => {
  const password = (req.body?.password ?? '').toString();
  if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ success: false, message: 'Chưa cấu hình ADMIN_PASSWORD.' });
  if (!password || password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Sai mật khẩu Admin!' });

  try {
    const { id, pick } = req.body ?? {};
    const entry = await getReviewQueue().then(q => q.find(e => e.id === id));
    if (!entry) return res.status(404).json({ success: false, message: 'Không tìm thấy review trong queue.' });

    const chosen = pick === 'B' ? entry.resultB : entry.resultA;
    if (!chosen?.step_by_step) return res.status(400).json({ success: false, message: 'Lời giải đã chọn không có nội dung.' });

    // Lưu vào cache — đáp án chuẩn giáo viên duyệt
    await saveToCache(entry.question, chosen.step_by_step, null, {
      topic:      entry.resultA?.topic ?? 'khac',
      difficulty: entry.resultA?.difficulty ?? 'Thông hiểu',
      source:     'admin_review',
      verified:   true,
      reviewedAt: new Date().toISOString(),
      reviewId:   entry.id,
    });

    await updateReview(id, { status: 'approved', picked: pick, updatedAt: new Date().toISOString() });
    console.log(`  ✅ [Admin] Duyệt review ${id} (pick ${pick}) → lưu cache verified`);
    return res.status(200).json({ success: true, message: 'Đã duyệt và lưu đáp án chuẩn vào DB.' });
  } catch (err) {
    console.error('  ❌ [Admin] Review approve lỗi:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

//  Reject: xóa review khỏi queue
app.post('/api/admin/review-reject', adminLimiter, async (req, res) => {
  const password = (req.body?.password ?? '').toString();
  if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ success: false, message: 'Chưa cấu hình ADMIN_PASSWORD.' });
  if (!password || password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Sai mật khẩu Admin!' });

  try {
    const { id } = req.body ?? {};
    const ok = await deleteReview(id);
    if (!ok) return res.status(404).json({ success: false, message: 'Không tìm thấy review.' });
    console.log(`  🗑️  [Admin] Reject review ${id}`);
    return res.status(200).json({ success: true, message: 'Đã xóa review khỏi queue.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/admin/extract-file ──────────────────────────────────────────────
//  Upload ảnh / PDF đề thi → Gemini Vision bóc tách text → trả về để giáo viên
//  duyệt trong "Nạp nhanh bằng AI" (không lưu DB).
app.post('/api/admin/extract-file', adminLimiter, uploadSingle, async (req, res) => {
  const startTime = Date.now();

  // Kiểm tra mật khẩu admin (từ multipart text field)
  const password = (req.body?.password ?? '').toString();
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ success: false, message: 'Server chưa cấu hình ADMIN_PASSWORD.' });
  }
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Sai mật khẩu Admin!' });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Vui lòng đính kèm ảnh hoặc PDF đề bài.' });
  }

  // Validate magic bytes
  let mimeType = '';
  if (req.file.mimetype === 'application/pdf' || validatePdfBuffer(req.file.buffer)) {
    mimeType = 'application/pdf';
  } else {
    const v = validateImageBuffer(req.file.buffer);
    if (!v.valid) {
      return res.status(400).json({ success: false, message: 'File không phải ảnh hoặc PDF hợp lệ.' });
    }
    mimeType = v.mimeType;
  }

  try {
    const extracted = await extractMathFromImage(req.file.buffer, mimeType);
    console.log(`  📤 [Admin] Extract-file: ${req.file.originalname} → ${extracted.length} chars`);
    return res.status(200).json({
      success: true,
      text: extracted,
      latencyMs: Date.now() - startTime,
      message: 'Đã bóc tách nội dung từ file. Kiểm tra và duyệt trước khi nạp.',
    });
  } catch (err) {
    console.error('  ❌ [Admin] Extract-file lỗi:', err.message);
    const isReadError = err.message.includes('Không thể đọc') || err.message.includes('KHÔNG_ĐỌC_ĐƯỢC');
    return res.status(isReadError ? 422 : 500).json({
      success: false,
      message: err.message,
      detail: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  POST /api/ai-tutor/ask-file  (cũ: ask-image)
//  Nhận ảnh chụp hoặc PDF đề toán → Gemini Vision bóc tách → Semantic Cache → LLM giải
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Middleware xử lý lỗi của multer (file quá lớn, sai định dạng...)
 * Phải wrap thủ công vì multer không tự chuyển sang next(err)
 */
function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();

    // Phân loại lỗi multer
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        message: `File quá lớn. Tối đa ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB.`,
      });
    }
    return res.status(400).json({ success: false, message: err.message });
  });
}

app.post('/api/ai-tutor/ask-file', uploadSingle, async (req, res) => {
  const startTime = Date.now();

  // 1. Kiểm tra có file không
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'Vui lòng đính kèm ảnh hoặc PDF đề bài (field name: "file").',
    });
  }

  // 2. Validate magic bytes (bảo mật: tránh file giả mạo extension)
  let mimeType = '';
  let isPdf = false;

  if (req.file.mimetype === 'application/pdf' || validatePdfBuffer(req.file.buffer)) {
    isPdf = true;
    mimeType = 'application/pdf';
  } else {
    const v = validateImageBuffer(req.file.buffer);
    if (!v.valid) {
      return res.status(400).json({
        success: false,
        message: 'File không phải ảnh hoặc PDF hợp lệ (kiểm tra magic bytes thất bại).',
      });
    }
    mimeType = v.mimeType;
  }

  console.log(`  📂 [Vision] Nhận file: ${req.file.originalname} | ${req.file.size} bytes | ${mimeType}${isPdf ? ' (PDF)' : ''}`);

  try {
    // 3. Gemini Vision — bóc tách đề toán từ ảnh hoặc PDF (mimeType truyền thẳng)
    const extractedQuestion = await extractMathFromImage(req.file.buffer, mimeType);
    console.log(`  📝 [Vision] Đề đã bóc tách: "${extractedQuestion.slice(0, 80)}…"`);

    // Ghi chú của người dùng (nếu có) — bổ sung yêu cầu riêng, ví dụ "chỉ giải câu a"
    const userNote = (req.body?.note ?? '').toString().trim();

    // Lịch sử hội thoại (từ multipart là chuỗi JSON → parseHistory xử lý)
    const chatHistory = parseHistory(req.body?.history);

    // 4. Semantic Cache — kiểm tra đề này đã có đáp án chưa
    //    LUÔN dùng đề bóc tách mới nhất để query, không dùng toàn bộ history
    const cacheResult = await searchCache(extractedQuestion);

    if (cacheResult.hit) {
      return res.status(200).json({
        success: true,
        source:           'cache',
        extractedQuestion,
        answer:           cacheResult.answer,
        score:            parseFloat(cacheResult.score.toFixed(4)),
        matchedQuestion:  cacheResult.matchedQuestion,
        isVerified:       cacheResult.isVerified === true,
        latencyMs:        Date.now() - startTime,
      });
    }

    // 4a. Tầng 2 — Template Tier: nhận diện dạng bài chạy công thức kiểm định
    const fullQuestion = userNote ? `${extractedQuestion}\n\nYêu cầu người dùng: ${userNote}` : extractedQuestion;
    const templateStart = Date.now();
    try {
      const tResult = await trySolveTemplate(extractedQuestion);
      if (tResult) {
        saveToCache('TEMPLATE::' + extractedQuestion, tResult.answer, null, {
          topic: req.body?.topic || 'template', source: 'template', templateSlug: tResult.slug, verified: true,
        }).catch(() => {});
        const templateLatency = Date.now() - startTime;
        return res.status(200).json({
          success: true,
          source: 'template',
          extractedQuestion,
          answer: tResult.answer,
          final_answer: tResult.final_answer,
          score: null,
          matchedQuestion: null,
          isVerified: true,
          template: tResult.slug,
          latencyMs: templateLatency,
          templateLatencyMs: Date.now() - templateStart,
        });
      }
    } catch (tErr) {
      console.warn('  ⚠️  [Vision] template tier lỗi (bỏ qua):', tErr.message);
    }

    // 5. Cache miss → CONSENSUS + CRITIC giải bài (bao gồm ghi chú + lịch sử)
    const consensus = await answerWithConsensus(fullQuestion, chatHistory);

    // 6. Chỉ lưu cache khi 2 solver KHỚP — tránh nhiễm dữ liệu xấu
    if (consensus.consensus === 'match') {
      saveToCache(extractedQuestion, consensus.answer, cacheResult.vector, {
        topic:    req.body?.topic      || (isPdf ? 'pdf_upload' : 'image_upload'),
        source:   isPdf ? 'pdf' : 'image',
        filename: req.file.originalname,
        consensus: 'true',
      }).catch(e => console.error('  ⚠️  [Vision] saveToCache lỗi nền:', e.message));
    }

    return res.status(200).json({
      success: true,
      source:            'llm',
      extractedQuestion,
      answer:            consensus.answer,
      score:             null,
      matchedQuestion:   null,
      isVerified:        false, // AI tự giải → KHÔNG phải đáp án chuẩn
      consensus:         consensus.consensus,
      similarity:        consensus.similarity,
      reviewQueued:      consensus.consensus === 'mismatch',
      reviewId:          consensus.reviewId,
      verdict:           consensus.critic?.verdict ?? null,
      latencyMs:         Date.now() - startTime,
    });

  } catch (err) {
    console.error('  ❌ [Vision] Lỗi:', err.message);

    const isReadError = err.message.includes('Không thể đọc') || err.message.includes('KHÔNG_ĐỌC_ĐƯỢC');
    return res.status(isReadError ? 422 : 500).json({
      success: false,
      message: err.message,
      detail: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
});

// ── 404 fallback ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint không tồn tại.' });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('  ❌ [Global Error]', err.message);
  res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ.' });
});

// ── Crash guards ───────────────────────────────────────────────────────────────
// Quota 429 / lỗi API không được phép làm chết cả server (giữ service ổn định)
process.on('unhandledRejection', (reason) => {
  console.error('  🛡️  [unhandledRejection]', reason?.message ?? reason);
});
process.on('uncaughtException', (err) => {
  console.error('  🛡️  [uncaughtException]', err?.message ?? err);
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🤖  AI GIA SƯ TOÁN THPT — STANDALONE MODE');
  console.log(`  👉  http://localhost:${PORT}/api/ai-tutor/health`);
  console.log(`  📖  POST http://localhost:${PORT}/api/ai-tutor/ask`);
  console.log(`  📂  POST http://localhost:${PORT}/api/ai-tutor/ask-file`);
  console.log(`       (multipart/form-data, field: "file", max ${Math.round(MAX_FILE_SIZE/1024/1024)}MB, ảnh + PDF)`);
  console.log('═══════════════════════════════════════════════════');
});

export { app };

/**
 * tutorRoute.js — Định tuyến API cho AI Gia sư Toán THPT
 *
 * Base path (mount trong server.js): /api/ai-tutor
 *
 * Endpoints:
 *   POST   /api/ai-tutor/ask     — Hỏi bài, kiểm tra cache trước, gọi LLM nếu miss
 *   GET    /api/ai-tutor/health  — Health check & thông tin cấu hình hiện tại
 *   GET    /api/ai-tutor/stats   — Thống kê số vector đang lưu trong DB
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { askQuestion, getCacheInfo, healthCheck } from '../controllers/tutorController.js';

const router = Router();

// ── Rate Limiter: bảo vệ endpoint tốn chi phí LLM ────────────────────────────
// 20 request / phút / IP — đủ dùng cho học sinh ôn thi, chặn bot spam
const askLimiter = rateLimit({
  windowMs: 60 * 1000,      // 1 phút
  max: 20,
  standardHeaders: true,    // trả Retry-After header
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Bạn đang gửi quá nhiều câu hỏi. Vui lòng chờ 1 phút và thử lại.',
  },
  keyGenerator: (req) =>
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown',
});

// Rate limit nhẹ hơn cho stats/health (không tốn chi phí AI)
const infoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/ai-tutor/ask
 * Body: { question: string, topic?: string, difficulty?: string }
 *
 * Response (Cache HIT):
 *   { success: true, source: 'cache', answer, score, matchedQuestion, latencyMs }
 *
 * Response (Cache MISS / LLM):
 *   { success: true, source: 'llm', answer, score: null, matchedQuestion: null, latencyMs }
 */
router.post('/ask', askLimiter, askQuestion);

/**
 * GET /api/ai-tutor/health
 * Response: { success: true, service, status, config: { embeddingProvider, vectorDb, ... } }
 */
router.get('/health', infoLimiter, healthCheck);

/**
 * GET /api/ai-tutor/stats
 * Response: { success: true, provider, vectorCount, dimension }
 */
router.get('/stats', infoLimiter, getCacheInfo);

export default router;

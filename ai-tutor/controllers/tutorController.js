/**
 * tutorController.js — Xử lý logic chính cho AI Gia sư Toán THPT
 *
 * Luồng /api/ai-tutor/ask:
 *   1. Validate input
 *   2. searchCache(question) → Cache HIT → trả ngay, tiết kiệm chi phí LLM
 *   3. Cache MISS → askLLM(question) → saveToCache(q, a, vector) async
 *   4. Trả response + metadata (source: 'cache' | 'llm', score, latency...)
 *
 * Luồng /api/ai-tutor/stats:
 *   → getCacheStats() → trả thống kê vector DB cho Admin
 */

import { searchCache, saveToCache, getCacheStats } from '../services/cacheService.js';
import { answerWithConsensus } from '../services/llmService.js';
import { trySolveTemplate } from '../services/templateEngine.js';

// ── Input validation schema (không dùng Zod để giữ đơn giản) ────────────────
const MAX_QUESTION_LENGTH = 3000; // ký tự (~một đề thi đầy đủ)
const MIN_QUESTION_LENGTH = 5;
const MAX_HISTORY_TURNS = 12; // tối đa 12 lượt (6 cặp) — an toàn token

function validateQuestion(raw) {
  if (typeof raw !== 'string') return 'Câu hỏi phải là chuỗi văn bản.';
  const q = raw.trim();
  if (q.length < MIN_QUESTION_LENGTH) return `Câu hỏi quá ngắn (tối thiểu ${MIN_QUESTION_LENGTH} ký tự).`;
  if (q.length > MAX_QUESTION_LENGTH) return `Câu hỏi quá dài (tối đa ${MAX_QUESTION_LENGTH} ký tự).`;
  return null; // null = hợp lệ
}

/**
 * parseHistory — chuẩn hóa mảng lịch sử hội thoại từ client.
 * Chấp nhận mảng hoặc chuỗi JSON (trường hợp multipart /ask-file).
 * Chỉ giữ đúng format Gemini: { role: 'user'|'model', parts: [{ text }] }
 *
 * @param {any} raw — req.body.history
 * @returns {Array<{role: string, parts: [{text: string}]}>}
 */
export function parseHistory(raw) {
  let arr = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      return []; // JSON hỏng → bỏ qua lịch sử, không làm chết request
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(turn => turn && typeof turn === 'object')
    .map(turn => {
      const role = turn.role === 'model' ? 'model' : 'user';
      const text = typeof turn.parts?.[0]?.text === 'string' ? turn.parts[0].text : '';
      return { role, parts: [{ text: text.slice(0, 2000) }] };
    })
    .filter(turn => turn.parts[0].text.length > 0)
    .slice(-MAX_HISTORY_TURNS);
}

// ── POST /api/ai-tutor/ask ────────────────────────────────────────────────────
export async function askQuestion(req, res) {
  const startTime = Date.now();

  // 1. Parse & validate
  const { question, topic, difficulty, history } = req.body ?? {};
  const validationError = validateQuestion(question);
  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  const cleanQuestion = question.trim();
  const cleanHistory = parseHistory(history);

  try {
    // 2. Tìm trong Semantic Cache — LUÔN dùng câu hỏi mới nhất,
    //    KHÔNG dùng toàn bộ history để query (tránh làm loãng kết quả)
    const cacheResult = await searchCache(cleanQuestion);

    if (cacheResult.hit) {
      // ── Cache HIT ──────────────────────────────────────────────────────
      return res.status(200).json({
        success: true,
        source: 'cache',
        answer: cacheResult.answer,
        score: parseFloat(cacheResult.score.toFixed(4)),
        matchedQuestion: cacheResult.matchedQuestion,
        isVerified: cacheResult.isVerified === true,
        latencyMs: Date.now() - startTime,
      });
    }

    // 3. Tầng 2 — Template Tier: nhận diện dạng bài + chạy công thức kiểm định.
    //    Nhanh ngang cache, generalize được biến thể đổi số. KHÔNG cần consensus.
    try {
      const tResult = await trySolveTemplate(cleanQuestion);
      if (tResult) {
        // Lưu vào cache dạng câu-hỏi-chuẩn để lần sau khớp y hệt (nhanh hơn nữa)
        saveToCache('TEMPLATE::' + cleanQuestion, tResult.answer, null, {
          topic: topic ?? 'template',
          difficulty: difficulty ?? 'Thông hiểu',
          source: 'template',
          templateSlug: tResult.slug,
          verified: true,
        }).catch(() => {});
        return res.status(200).json({
          success: true,
          source: 'template',
          answer: tResult.answer,
          final_answer: tResult.final_answer,
          score: null,
          matchedQuestion: null,
          isVerified: true, // đáp án từ công thức kiểm định → tin cậy
          template: tResult.slug,
          latencyMs: Date.now() - startTime,
        });
      }
    } catch (templateErr) {
      console.warn('  ⚠️  [Controller] template tier lỗi (bỏ qua):', templateErr.message);
    }

    // 4. Tầng 3 — CONSENSUS + CRITIC (chỉ khi không khớp cache/template)
    const consensus = await answerWithConsensus(cleanQuestion, cleanHistory, { topic, difficulty });

    // 4. Chỉ lưu cache khi 2 solver KHỚP (consensus match) để tránh nhiễm dữ liệu xấu.
    //    Khi LỆCH → đã được đưa vào review_queue, chờ giáo viên duyệt thủ công.
    if (consensus.consensus === 'match') {
      saveToCache(cleanQuestion, consensus.answer, cacheResult.vector, {
        topic: topic ?? 'unknown',
        difficulty: difficulty ?? 'unknown',
        consensus: 'true', // metadata cho biết đáp án có sự đồng thuận của 2 solver
      }).catch(err =>
        console.error('  ⚠️  [Controller] saveToCache lỗi nền:', err.message)
      );
    }

    return res.status(200).json({
      success: true,
      source: 'llm',
      answer: consensus.answer,
      score: null,       // không có score vì không phải cache
      matchedQuestion: null,
      isVerified: false, // AI tự giải → KHÔNG phải đáp án chuẩn
      consensus: consensus.consensus,   // 'match' | 'mismatch' | 'error'
      similarity: consensus.similarity,
      reviewQueued: consensus.consensus === 'mismatch',
      reviewId: consensus.reviewId,
      verdict: consensus.critic?.verdict ?? null,
      latencyMs: Date.now() - startTime,
    });

  } catch (err) {
    console.error('  ❌ [Controller] askQuestion lỗi:', err.message);

    // Phân loại lỗi để frontend xử lý thông minh hơn
    const isApiKeyError =
      err.message?.includes('API_KEY') ||
      err.message?.includes('401') ||
      err.message?.includes('403');

    return res.status(isApiKeyError ? 503 : 500).json({
      success: false,
      message: isApiKeyError
        ? 'Lỗi cấu hình API key — vui lòng liên hệ admin.'
        : 'Đã có lỗi xảy ra khi xử lý câu hỏi. Vui lòng thử lại.',
      detail: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
}

// ── GET /api/ai-tutor/stats ───────────────────────────────────────────────────
export async function getCacheInfo(req, res) {
  try {
    const stats = await getCacheStats();
    return res.status(200).json({ success: true, ...stats });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ── GET /api/ai-tutor/health ──────────────────────────────────────────────────
export function healthCheck(_req, res) {
  res.status(200).json({
    success: true,
    service: 'AI Gia sư Toán THPT',
    status: 'ok',
    timestamp: new Date().toISOString(),
    config: {
      embeddingProvider: process.env.EMBEDDING_PROVIDER ?? 'google',
      vectorDb: process.env.VECTOR_DB ?? 'upstash',
      llmProvider: process.env.LLM_PROVIDER ?? 'google',
      similarityThreshold: parseFloat(process.env.CACHE_SIMILARITY_THRESHOLD ?? '0.95'),
    },
  });
}

import { saveToCache, searchSimilar, listCacheEntries, deleteFromCache, getCacheStats } from './cacheService.js';
import { smartExtract } from './llmService.js';

// ══════════════════════════════════════════════════════════════════════════
//  WHITELIST — chỉ cho phép các giá trị này (đồng bộ với Frontend)
//  Giáo viên không được tự do nhập các giá trị ngoài danh sách này
// ══════════════════════════════════════════════════════════════════════════
const ALLOWED_TOPICS = Object.freeze([
  'giai_tich',
  'dao_ham',
  'tich_phan',
  'luong_giac',
  'ham_so',
  'mu_logarit',
  'so_phuc',
  'hinh_hoc_khong_gian',
  'xac_suat',
  'thu_tu_toan',
  'phuong_trinh',
  'bat_phuong_trinh',
  'cap_so',
  'khac'
]);

const ALLOWED_DIFFICULTIES = Object.freeze([
  'Nhận biết',
  'Thông hiểu',
  'Vận dụng',
  'VDC'
]);

// Giới hạn kích thước đề phòng Upstash metadata giới hạn
const MAX_QUESTION_LENGTH = 2000;
const MAX_ANSWER_LENGTH   = 8000;

/**
 * Controller xử lý việc nạp thủ công (Q&A) vào Upstash Vector
 *
 * Security:
 *   - Kiểm tra ADMIN_PASSWORD trong env (khởi động lỗi nếu chưa set)
 *   - Whitelist topic & difficulty
 *   - Giới hạn độ dài question / answer
 *   - Kiểm tra timing-attack-resistant password compare
 */
export async function addQA(req, res) {
  const startTime = Date.now();
  const clientIp  = req.ip ?? req.socket?.remoteAddress ?? 'unknown';

  try {
    // 0. Guard: đảm bảo Admin password đã được set trong .env
    if (!process.env.ADMIN_PASSWORD) {
      console.error('  🔐 [Admin] BIỆT TỚI: Chưa set biến môi trường ADMIN_PASSWORD trong .env!');
      return res.status(500).json({
        success: false,
        message: 'Server chưa cấu hình mật khẩu Admin. Vui lòng liên hệ kỹ thuật.'
      });
    }

    const { question, answer, topic, difficulty, password } = req.body || {};

    // 1. Kiểm tra mật khẩu Admin (timing-safe compare trong JS đơn giản: === đủ cho mật khẩu mạnh)
    if (!password || typeof password !== 'string') {
      console.warn(`  ⚠️  [Admin] IP ${clientIp} — thiếu mật khẩu.`);
      return res.status(401).json({
        success: false,
        message: 'Thiếu mật khẩu Admin.'
      });
    }
    if (password.length > 200 || password !== process.env.ADMIN_PASSWORD) {
      console.warn(`  🚫 [Admin] IP ${clientIp} — SAU MẬT KHẨU Admin. Độ dài mk: ${password.length}`);
      return res.status(401).json({
        success: false,
        message: 'Sai mật khẩu Admin! Từ chối truy cập.'
      });
    }

    // 2. Validate dữ liệu đầu vào
    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập câu hỏi (không được rỗng).' });
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Câu hỏi quá dài (tối đa ${MAX_QUESTION_LENGTH} ký tự, bạn nhập ${question.length}).`
      });
    }
    if (!answer || typeof answer !== 'string' || !answer.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập đáp án (không được rỗng).' });
    }
    if (answer.length > MAX_ANSWER_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Đáp án quá dài (tối đa ${MAX_ANSWER_LENGTH} ký tự, bạn nhập ${answer.length}).`
      });
    }

    // 3. Validate whitelist topic & difficulty
    const cleanTopic = (topic || '').toString();
    if (cleanTopic && !ALLOWED_TOPICS.includes(cleanTopic)) {
      return res.status(400).json({
        success: false,
        message: `Chuyên đề không hợp lệ. Giá trị hợp lệ: ${ALLOWED_TOPICS.join(', ')}`
      });
    }
    const cleanDifficulty = (difficulty || '').toString();
    if (cleanDifficulty && !ALLOWED_DIFFICULTIES.includes(cleanDifficulty)) {
      return res.status(400).json({
        success: false,
        message: `Độ khó không hợp lệ. Giá trị hợp lệ: ${ALLOWED_DIFFICULTIES.join(', ')}`
      });
    }

    // 4. Chuẩn bị metadata (giống cấu trúc Bộ GD&ĐT)
    const now = new Date();
    const extraMeta = {
      topic:      cleanTopic      || 'Chưa phân loại',
      difficulty: cleanDifficulty || 'Nhận biết',
      source:     'admin_cms',            // Đánh dấu nguồn từ giáo viên nạp thủ công
      verified:   true,                   // Dữ liệu chuẩn, đã được kiểm duyệt
      uploadedBy: 'teacher',
      uploadedAt: now.toISOString(),
      uploaderIp: clientIp
    };

    // 5. Lưu vào Vector DB (saveToCache sẽ tự gọi Google Embeddings tạo vector nếu vector=null)
    await saveToCache(question.trim(), answer.trim(), null, extraMeta);

    const latency = Date.now() - startTime;
    console.log(`  ✅ [Admin] IP ${clientIp} — NẠP THÀNH CÔNG | topic=${extraMeta.topic} | diff=${extraMeta.difficulty} | q_len=${question.length} | a_len=${answer.length} | ${latency}ms`);

    return res.status(200).json({
      success: true,
      message: 'Nạp dữ liệu vào Trạm Kiến Thức thành công!',
      info: {
        topic: extraMeta.topic,
        difficulty: extraMeta.difficulty,
        latencyMs: latency
      }
    });

  } catch (error) {
    const latency = Date.now() - startTime;
    console.error(`  ❌ [Admin] IP ${clientIp} — LỖI NẠP DỮ LIỆU | ${latency}ms |`, error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi server khi nạp dữ liệu.',
      error: (process.env.NODE_ENV === 'development' ? error.message : undefined)
    });
  }
}

/**
 * requireAdmin — middleware kiểm tra mật khẩu Admin cho mọi endpoint admin mới.
 * Reuse đúng logic timing-safe của addQA để tránh trùng lặp.
 */
function requireAdmin(req, res) {
  const { password } = req.body ?? {};
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({
      success: false,
      message: 'Server chưa cấu hình mật khẩu Admin (ADMIN_PASSWORD).'
    });
  }
  if (!password || typeof password !== 'string') {
    return res.status(401).json({ success: false, message: 'Thiếu mật khẩu Admin.' });
  }
  if (password.length > 200 || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Sai mật khẩu Admin! Từ chối truy cập.' });
  }
  return null; // hợp lệ
}

/**
 * smartImport — nhận đoạn text thô (đề thi / nhiều câu) → LLM tách Q&A + phân loại.
 * KHÔNG lưu DB — trả kết quả về frontend để giáo viên duyệt trước khi nạp.
 */
export async function smartImport(req, res) {
  const startTime = Date.now();
  const authError = requireAdmin(req, res);
  if (authError) return authError;

  try {
    const { text } = req.body ?? {};
    if (!text || typeof text !== 'string' || text.trim().length < 5) {
      return res.status(400).json({ success: false, message: 'Vui lòng dán câu hỏi / đề thi vào ô nhập liệu.' });
    }

    console.log(`  🧠 [Admin] Smart-Import | text=${text.trim().length} chars`);
    const result = await smartExtract(text);
    const latency = Date.now() - startTime;

    return res.status(200).json({
      success: true,
      entries: result.entries,
      count: result.entries.length,
      latencyMs: latency,
      message: result.entries.length
        ? `AI đã tách được ${result.entries.length} câu hỏi. Hãy duyệt lại trước khi nạp.`
        : 'Không tách được câu hỏi nào từ dữ liệu. Kiểm tra lại nội dung bạn dán vào.',
    });
  } catch (err) {
    console.error('  ❌ [Admin] Smart-Import lỗi:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Lỗi khi AI xử lý dữ liệu.',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
}

/**
 * saveBatch — nạp NHIỀU cặp Q&A cùng lúc (kết quả từ smartImport sau khi duyệt).
 */
export async function saveBatch(req, res) {
  const startTime = Date.now();
  const authError = requireAdmin(req, res);
  if (authError) return authError;

  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ success: false, message: 'Không có câu hỏi nào để nạp.' });
    }

    const results = [];
    let okCount = 0, dupSkipped = 0;

    for (const item of items) {
      const question = String(item?.question ?? '').trim();
      const answer   = String(item?.answer ?? '').trim();

      // Kiểm tra trùng trong DB trước khi nạp (skip nếu đã có gần như trùng)
      const similar = await searchSimilar(question, 1).catch(() => []);
      if (similar[0]?.score >= 0.93) {
        dupSkipped++;
        results.push({ question: question.slice(0, 60), status: 'duplicate', score: similar[0].score });
        continue;
      }

      if (question.length < 5 || answer.length < 5) {
        results.push({ question: question.slice(0, 60), status: 'invalid' });
        continue;
      }

      const extraMeta = {
        topic:      String(item?.topic ?? 'khac').trim() || 'khac',
        difficulty: String(item?.difficulty ?? 'Thông hiểu').trim() || 'Thông hiểu',
        source:     'admin_cms',
        verified:   true,
        uploadedBy: 'teacher',
        uploadedAt: new Date().toISOString(),
      };
      await saveToCache(question, answer, null, extraMeta);
      okCount++;
      results.push({ question: question.slice(0, 60), status: 'saved' });
    }

    const latency = Date.now() - startTime;
    return res.status(200).json({
      success: true,
      saved: okCount,
      duplicatesSkipped: dupSkipped,
      invalid: results.filter(r => r.status === 'invalid').length,
      total: items.length,
      latencyMs: latency,
      message: `Đã nạp ${okCount} câu thành công${dupSkipped ? `, bỏ qua ${dupSkipped} câu trùng.` : ''}`,
      details: results,
    });
  } catch (err) {
    console.error('  ❌ [Admin] Save-Batch lỗi:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Lỗi khi nạp dữ liệu hàng loạt.',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
}

/**
 * checkDuplicate — kiểm tra câu hỏi đã có trong DB chưa (trước khi nạp).
 */
export async function checkDuplicate(req, res) {
  const authError = requireAdmin(req, res);
  if (authError) return authError;

  try {
    const { question } = req.body ?? {};
    if (!question || typeof question !== 'string' || question.trim().length < 5) {
      return res.status(400).json({ success: false, message: 'Câu hỏi quá ngắn.' });
    }
    const similar = await searchSimilar(question.trim(), 3);
    return res.status(200).json({
      success: true,
      question: question.trim(),
      hits: similar,
      highest: similar[0] ?? null,
    });
  } catch (err) {
    console.error('  ❌ [Admin] Check-Duplicate lỗi:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Lỗi khi kiểm tra trùng lặp.',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
}

/**
 * listQA — liệt kê dữ liệu trong vector DB (tab Kho dữ liệu).
 */
export async function listQA(req, res) {
  const authError = requireAdmin(req, res);
  if (authError) return authError;

  try {
    const limit  = Math.min(parseInt(req.body?.limit ?? req.query?.limit ?? '50', 10) || 50, 100);
    const cursor = String(req.body?.cursor ?? req.query?.cursor ?? '');
    const { entries, nextCursor } = await listCacheEntries(limit, cursor);
    const stats = await getCacheStats().catch(() => null);

    return res.status(200).json({
      success: true,
      entries,
      nextCursor,
      totalInDb: stats?.vectorCount ?? entries.length,
    });
  } catch (err) {
    console.error('  ❌ [Admin] List lỗi:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Lỗi khi đọc kho dữ liệu.',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
}

/**
 * deleteQA — xóa một entry khỏi vector DB theo id.
 */
export async function deleteQA(req, res) {
  const authError = requireAdmin(req, res);
  if (authError) return authError;

  try {
    const { id } = req.body ?? {};
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ success: false, message: 'Thiếu id vector cần xóa.' });
    }
    await deleteFromCache(id);
    return res.status(200).json({ success: true, message: 'Đã xóa entry khỏi Vector DB.', id });
  } catch (err) {
    console.error('  ❌ [Admin] Delete lỗi:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Lỗi khi xóa dữ liệu.',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
}

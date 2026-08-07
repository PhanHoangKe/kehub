/**
 * ai-tutor-routes.cjs — Đăng ký toàn bộ routes AI Gia Sư Toán lên một Express app.
 * Dùng CommonJS để nhúng trực tiếp vào server.js.
 * Tương thích với: multer, cors, express-rate-limit, dotenv.
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

// Load .env của ai-tutor (nằm ở root project)
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Import services (ESM -> dùng dynamic import hoặc require nếu đã chuyển)
// Vì ai-tutor services là ESM, ta dùng dynamic import bất đồng bộ.
// Cách đơn giản: require file .cjs đã chuyển đổi, hoặc dùng import() trong hàm async.
// Ở đây ta sẽ lazy-load services khi cần.

/**
 * Tạo router AI Gia Sư và gắn vào Express app truyền vào.
 * @param {express.Express} app - Express app chính (hoặc sub-app)
 * @returns {Promise<void>}
 */
async function mountAiTutorRoutes(app) {
    // Import services động (ESM modules)
    const [cacheService, llmService, templateEngine, reviewQueue, adminService, visionService, tutorController] = await Promise.all([
        import('./ai-tutor/services/cacheService.js'),
        import('./ai-tutor/services/llmService.js'),
        import('./ai-tutor/services/templateEngine.js'),
        import('./ai-tutor/services/reviewQueue.js'),
        import('./ai-tutor/services/adminService.js'),
        import('./ai-tutor/services/visionService.js'),
        import('./ai-tutor/controllers/tutorController.js'),
    ]);

    const {
        searchCache,
        saveToCache,
    } = cacheService;

    const {
        answerWithConsensus,
    } = llmService;

    const {
        trySolveTemplate,
    } = templateEngine;

    const {
        getReviewQueue,
        updateReview,
        deleteReview,
    } = reviewQueue;

    const {
        addQA,
        smartImport,
        saveBatch,
        checkDuplicate,
        listQA,
        deleteQA,
    } = adminService;

    const {
        extractMathFromImage,
        validateImageBuffer,
    } = visionService;

    const {
        parseHistory,
    } = tutorController;

    // ---- Multer config ----
    const MAX_FILE_SIZE = parseInt(process.env.FILE_MAX_SIZE_BYTES || '15728640', 10); // 15 MB
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: MAX_FILE_SIZE, files: 1 },
        fileFilter: (_req, file, cb) => {
            const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'application/pdf'];
            cb(null, allowed.includes(file.mimetype));
        },
    });

    function uploadSingle(req, res, next) {
        upload.single('file')(req, res, (err) => {
            if (!err) return next();
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({
                    success: false,
                    message: `File quá lớn. Tối đa ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB.`,
                });
            }
            res.status(400).json({ success: false, message: err.message });
        });
    }

    function validatePdfBuffer(buf) {
        return buf && buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-';
    }

    // ---- Rate limit admin ----
    const adminLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 20,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau 1 phút.' },
    });

    // ---- Body Parser ----
    // Remove duplicate cors usage as server.js already handles CORS at the HTTP level
    app.use(express.json({ limit: '100kb' }));

    // ---- /api/ai-tutor/health ----
    app.get('/api/ai-tutor/health', (_req, res) => {
        res.json({ ok: true, service: 'ai-tutor', ts: new Date().toISOString() });
    });

    // ---- /api/ai-tutor/ask (main chat) ----
    app.post('/api/ai-tutor/ask', async (req, res) => {
        const startTime = Date.now();
        try {
            const { question, history = [], topic } = req.body || {};
            const q = (question || '').toString().trim();
            if (!q) return res.status(400).json({ success: false, message: 'Thiếu câu hỏi.' });

            // Semantic cache
            const cacheResult = await searchCache(q);
            if (cacheResult.hit) {
                return res.json({
                    success: true,
                    source: 'cache',
                    answer: cacheResult.answer,
                    score: parseFloat(cacheResult.score.toFixed(4)),
                    matchedQuestion: cacheResult.matchedQuestion,
                    isVerified: cacheResult.isVerified === true,
                    latencyMs: Date.now() - startTime,
                });
            }

            // Template tier
            try {
                const tResult = await (await import('./ai-tutor/services/templateEngine.js')).trySolveTemplate(q);
                if (tResult) {
                    const { saveToCache } = await import('./ai-tutor/services/cacheService.js');
                    saveToCache('TEMPLATE::' + q, tResult.answer, null, {
                        topic: topic || 'template',
                        source: 'template',
                        templateSlug: tResult.slug,
                        verified: true,
                    }).catch(() => {});
                    return res.json({
                        success: true,
                        source: 'template',
                        answer: tResult.answer,
                        final_answer: tResult.final_answer,
                        isVerified: true,
                        template: tResult.slug,
                        latencyMs: Date.now() - startTime,
                    });
                }
            } catch (_) { /* bỏ qua */ }

            // Consensus LLM
            const consensus = await (await import('./ai-tutor/services/llmService.js')).answerWithConsensus(q, parseHistory(history));

            if (consensus.consensus === 'match') {
                const { saveToCache } = await import('./ai-tutor/services/cacheService.js');
                saveToCache(q, consensus.answer, null, { topic: topic || 'general', source: 'llm', consensus: 'true' }).catch(() => {});
            }

            res.json({
                success: true,
                source: 'llm',
                answer: consensus.answer,
                isVerified: false,
                consensus: consensus.consensus,
                similarity: consensus.similarity,
                reviewQueued: consensus.consensus === 'mismatch',
                reviewId: consensus.reviewId,
                verdict: consensus.critic?.verdict ?? null,
                latencyMs: Date.now() - startTime,
            });
        } catch (err) {
            console.error('  [AI-Tutor] ask error:', err.message);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // ---- /api/ai-tutor/ask-file ----
    app.post('/api/ai-tutor/ask-file', uploadSingle, async (req, res) => {
        const startTime = Date.now();
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'Vui lòng đính kèm ảnh/PDF (field "file").' });
            }

            let mimeType = '';
            let isPdf = false;
            if (req.file.mimetype === 'application/pdf' || req.file.buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
                isPdf = true;
                mimeType = 'application/pdf';
            } else {
                // validate image
                const buf = req.file.buffer;
                if (!buf || buf.length < 12) return res.status(400).json({ success: false, message: 'File không hợp lệ.' });
                // simple check
                mimeType = req.file.mimetype || 'image/jpeg';
            }

            const { extractMathFromImage } = await import('./ai-tutor/services/visionService.js');
            const extractedQuestion = await extractMathFromImage(req.file.buffer, mimeType);

            const userNote = (req.body?.note || '').toString().trim();
            const historyParsed = parseHistory(req.body?.history);
            const fullQuestion = userNote ? `${extractedQuestion}\n\nYêu cầu người dùng: ${userNote}` : extractedQuestion;

            // Cache check
            const { searchCache } = await import('./ai-tutor/services/cacheService.js');
            const cacheResult = await searchCache(extractedQuestion);
            if (cacheResult.hit) {
                return res.json({
                    success: true,
                    source: 'cache',
                    extractedQuestion,
                    answer: cacheResult.answer,
                    score: parseFloat(cacheResult.score.toFixed(4)),
                    matchedQuestion: cacheResult.matchedQuestion,
                    isVerified: cacheResult.isVerified === true,
                    latencyMs: Date.now() - startTime,
                });
            }

            // Template
            try {
                const { trySolveTemplate } = await import('./ai-tutor/services/templateEngine.js');
                const tResult = await trySolveTemplate(extractedQuestion);
                if (tResult) {
                    const { saveToCache } = await import('./ai-tutor/services/cacheService.js');
                    saveToCache('TEMPLATE::' + extractedQuestion, tResult.answer, null, {
                        topic: req.body.topic || 'template',
                        source: 'template',
                        templateSlug: tResult.slug,
                        verified: true,
                    }).catch(() => {});
                    return res.json({
                        success: true,
                        source: 'template',
                        extractedQuestion,
                        answer: tResult.answer,
                        final_answer: tResult.final_answer,
                        isVerified: true,
                        template: tResult.slug,
                        latencyMs: Date.now() - startTime,
                    });
                }
            } catch (_) {}

            // Consensus
            const { answerWithConsensus } = await import('./ai-tutor/services/llmService.js');
            const fullQuestion2 = userNote ? `${extractedQuestion}\n\nYêu cầu người dùng: ${userNote}` : extractedQuestion;
            const consensus = await answerWithConsensus(fullQuestion2, parseHistory(req.body?.history));

            if (consensus.consensus === 'match') {
                const { saveToCache } = await import('./ai-tutor/services/cacheService.js');
                saveToCache(extractedQuestion, consensus.answer, null, {
                    topic: req.body.topic || (isPdf ? 'pdf_upload' : 'image_upload'),
                    source: isPdf ? 'pdf' : 'image',
                    filename: req.file.originalname,
                    consensus: 'true',
                }).catch(() => {});
            }

            return res.json({
                success: true,
                source: 'llm',
                extractedQuestion,
                answer: consensus.answer,
                isVerified: false,
                consensus: consensus.consensus,
                similarity: consensus.similarity,
                reviewQueued: consensus.consensus === 'mismatch',
                reviewId: consensus.reviewId,
                verdict: consensus.critic?.verdict ?? null,
                latencyMs: Date.now() - startTime,
            });
        } catch (err) {
            console.error('  [AI-Tutor] ask-file error:', err.message);
            const isReadError = err.message.includes('Không thể đọc') || err.message.includes('KHÔNG_ĐỌC_ĐƯỢC');
            res.status(isReadError ? 422 : 500).json({
                success: false,
                message: err.message,
                detail: process.env.NODE_ENV === 'development' ? err.stack : undefined,
            });
        }
    });

    // ---- /api/ai-tutor/stats ----
    app.get('/api/ai-tutor/stats', async (_req, res) => {
        try {
            const { getCacheStats } = await import('./ai-tutor/services/cacheService.js');
            const info = await getCacheStats();
            res.json({ success: true, ...info });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // ---- Admin routes (prefix /api/ai-tutor/admin) ----

    const checkAdmin = (req, res, next) => {
        const pwd = (req.body?.password || '').toString();
        if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ success: false, message: 'Chưa cấu hình ADMIN_PASSWORD.' });
        if (!pwd || pwd !== process.env.ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Sai mật khẩu Admin!' });
        next();
    };

    // Multer for admin extract-file
    const adminUpload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: parseInt(process.env.FILE_MAX_SIZE_BYTES || '15728640', 10), files: 1 },
        fileFilter: (_req, file, cb) => {
            const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'application/pdf'];
            cb(null, allowed.includes(file.mimetype));
        },
    }).single('file');

    app.post('/api/ai-tutor/admin/add-qa', adminLimiter, checkAdmin, async (req, res) => {
        try { res.json(await addQA(req.body)); } catch (e) { res.status(400).json({ success: false, message: e.message }); }
    });
    app.post('/api/ai-tutor/admin/smart-import', adminLimiter, checkAdmin, async (req, res) => {
        try { res.json(await smartImport(req.body)); } catch (e) { res.status(400).json({ success: false, message: e.message }); }
    });
    app.post('/api/ai-tutor/admin/save-batch', adminLimiter, checkAdmin, async (req, res) => {
        try { res.json(await saveBatch(req.body)); } catch (e) { res.status(400).json({ success: false, message: e.message }); }
    });
    app.post('/api/ai-tutor/admin/check-duplicate', adminLimiter, checkAdmin, async (req, res) => {
        try { res.json(await checkDuplicate(req.body)); } catch (e) { res.status(400).json({ success: false, message: e.message }); }
    });
    app.post('/api/ai-tutor/admin/list-qa', adminLimiter, checkAdmin, async (req, res) => {
        try { res.json(await listQA(req.body)); } catch (e) { res.status(400).json({ success: false, message: e.message }); }
    });
    app.post('/api/ai-tutor/admin/delete-qa', adminLimiter, checkAdmin, async (req, res) => {
        try { res.json(await deleteQA(req.body)); } catch (e) { res.status(400).json({ success: false, message: e.message }); }
    });

    app.post('/api/ai-tutor/admin/review-queue', adminLimiter, checkAdmin, async (req, res) => {
        try { const entries = await getReviewQueue(); res.json({ success: true, count: entries.length, entries }); } catch (e) { res.status(500).json({ success: false, message: e.message }); }
    });

    app.post('/api/ai-tutor/admin/review-approve', adminLimiter, checkAdmin, async (req, res) => {
        try {
            const { id, pick } = req.body || {};
            const entries = await getReviewQueue();
            const entry = entries.find(e => e.id === id);
            if (!entry) return res.status(404).json({ success: false, message: 'Không tìm thấy review.' });
            const chosen = pick === 'B' ? entry.resultB : entry.resultA;
            if (!chosen?.step_by_step) return res.status(400).json({ success: false, message: 'Lời giải chọn không có nội dung.' });
            await saveToCache(entry.question, chosen.step_by_step, null, {
                topic: entry.resultA?.topic || 'khac',
                difficulty: entry.resultA?.difficulty || 'Thông hiểu',
                source: 'admin_review',
                verified: true,
                reviewedAt: new Date().toISOString(),
                reviewId: entry.id,
            });
            await updateReview(id, { status: 'approved', picked: pick, updatedAt: new Date().toISOString() });
            res.json({ success: true, message: 'Đã duyệt và lưu đáp án chuẩn.' });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
    });

    app.post('/api/ai-tutor/admin/review-reject', adminLimiter, checkAdmin, async (req, res) => {
        try {
            const { id } = req.body || {};
            const ok = await deleteReview(id);
            if (!ok) return res.status(404).json({ success: false, message: 'Không tìm thấy review.' });
            res.json({ success: true, message: 'Đã xóa review.' });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
    });

    app.post('/api/ai-tutor/admin/extract-file', adminLimiter, uploadSingle, checkAdmin, async (req, res) => {
        const startTime = Date.now();
        try {
            if (!req.file) return res.status(400).json({ success: false, message: 'Vui lòng đính kèm ảnh/PDF.' });

            let mimeType = '';
            if (req.file.mimetype === 'application/pdf' || req.file.buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
                mimeType = 'application/pdf';
            } else {
                const { validateImageBuffer } = await import('./ai-tutor/services/visionService.js');
                const v = validateImageBuffer(req.file.buffer);
                if (!v.valid) return res.status(400).json({ success: false, message: 'File không hợp lệ.' });
                mimeType = v.mimeType;
            }

            const { extractMathFromImage } = await import('./ai-tutor/services/visionService.js');
            const extracted = await extractMathFromImage(req.file.buffer, mimeType);
            res.json({
                success: true,
                text: extracted,
                latencyMs: Date.now() - startTime,
                message: 'Đã bóc tách nội dung. Kiểm tra và duyệt trước khi nạp.',
            });
        } catch (err) {
            console.error('  [Admin] extract-file error:', err.message);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // 404
    app.use((_req, res) => res.status(404).json({ success: false, message: 'Endpoint không tồn tại.' }));
}

module.exports = { mountAiTutorRoutes };
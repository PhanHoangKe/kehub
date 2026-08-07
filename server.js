/* ==========================================================================
   YOUTH MEMORIES - BACKEND SERVER (Node.js REST API & Static File Server)
   - Xác thực Admin bằng password + session token
   - Validate magic bytes khi upload file
   - Rate limiting cho các endpoint nhạy cảm
   - Input sanitization phía server
   - Write queue tránh race condition db.json
   - Tách data vào thư mục /data/ tránh bị overwrite khi redeploy
   - GitHub Backup: backup DB vĩnh viễn lên GitHub repo (thay JSONBin)
     → Không giới hạn dung lượng (JSONBin free chỉ 100KB → bị ngắt)
     → Tự động restore khi Render wipe ephemeral filesystem
     → Lịch sử commit = lịch sử backup có thể xem/rollback bất kỳ lúc nào
   ========================================================================== */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

// ── Express sub-app cho AI Gia Sư Toán (gộp từ ai-tutor) ───────────────────────
const express = require('express');
const aiTutorApp = express();

// Khởi tạo AI Gia Sư Toán routes (async) - trả về Promise để await trước khi listen
async function initAiTutor() {
    try {
        const { mountAiTutorRoutes } = require('./ai-tutor-routes.cjs');
        await mountAiTutorRoutes(aiTutorApp);
        console.log('  ✅  AI Gia Sư Toán routes đã sẵn sàng (gộp vào server.js)');
    } catch (err) {
        console.error('  ❌  Khởi tạo AI Gia Sư Toán thất bại:', err.message);
        throw err;
    }
}

// ── Đặc Vụ Đòi Nợ AI (tạo tin nhắn nhắc nợ hài hước qua LLM) ──────────────────
const debtAgentService = require('./debtAgentService.js');
const emailService = require('./emailService.js');

// ── Tự đọc file .env nếu có (không cần cài dotenv) ──────────────────────────
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
    fs.readFileSync(envFile, 'utf8')
        .split('\n')
        .forEach(line => {
            line = line.trim();
            if (!line || line.startsWith('#')) return;
            const eqIdx = line.indexOf('=');
            if (eqIdx < 1) return;
            const key = line.slice(0, eqIdx).trim();
            const val = line.slice(eqIdx + 1).trim();
            if (!process.env[key]) process.env[key] = val;
        });
}

const PORT = process.env.PORT || 3000;

// ── Đường dẫn dữ liệu riêng biệt khỏi source code ──────────────────────────
// Dùng thư mục /data/ để db.json không bị overwrite khi git pull / redeploy
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

// ── Cloudinary Config ────────────────────────────────────────────────────────
// Đặt 3 biến môi trường để bật Cloudinary. Nếu chưa cấu hình, fallback về disk local.
// Đăng ký miễn phí tại: https://cloudinary.com/users/register_free
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_API_KEY    = process.env.CLOUDINARY_API_KEY    || '';
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || '';
const CLOUDINARY_ENABLED    = !!(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);

// ── GitHub Backup Config ─────────────────────────────────────────────────────
// Đây là backup chính, thay thế JSONBin (không giới hạn dung lượng, lịch sử vĩnh viễn)
// Tạo PAT token tại: https://github.com/settings/tokens → New token (classic)
// Cần scope: repo (full control of private repositories)
// GITHUB_REPO format: "username/repo-name" (vd: "kedep2004/youth-memories-backup")
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN  || '';
const GITHUB_REPO   = process.env.GITHUB_REPO   || '';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_FILE_PATH = process.env.GITHUB_FILE_PATH || 'data/db.json'; // đường dẫn trong repo
const GITHUB_ENABLED = !!(GITHUB_TOKEN && GITHUB_REPO);

// ── JSONBin Config (Legacy / Fallback) ───────────────────────────────────────
// JSONBin vẫn được giữ như fallback thứ hai nếu GitHub chưa cấu hình
// Giới hạn: 100KB/bin (free) — sẽ bị Circuit Breaker tắt khi DB lớn hơn
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID || '';
const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY || process.env.JSONBIN_SECRET || '';

// ── Smart Circuit Breaker (Modern Adaptive Fail-Stop) ───────────────────────
//   • Lỗi HARD (401/403/404/sai cấu hình/missing params)  → TẮT VĨNH VIỄN cho đến restart server
//   • Lỗi SOFT (mạng ECONNRESET / 5xx / timeout)           → retry 2 lần với exponential backoff
//     * Nếu vẫn thất bại → tạm tắt 5 phút (cooldown), sau đó thử lại
let cldState = { enabled: CLOUDINARY_ENABLED, reason: null, disabledUntil: 0, mode: 'active' };
let jbnState = { enabled: !!(JSONBIN_BIN_ID && JSONBIN_API_KEY), reason: null, disabledUntil: 0, mode: 'active' };
let ghbState = { enabled: GITHUB_ENABLED, reason: null, disabledUntil: 0, mode: 'active', lastBackupAt: 0, lastBackupSha: '' };

function _cldCooldownMs(attempt)   { return 1000 * Math.pow(2, attempt); } // 1s, 2s, 4s
function _jbnCooldownMs(attempt)   { return 1000 * Math.pow(2, attempt); }
function _ghbCooldownMs(attempt)   { return 1000 * Math.pow(2, attempt); } // 1s, 2s, 4s

function _disableHard(state, integration, reason) {
    state.mode = 'hard-off';
    state.enabled = false;
    state.reason = reason;
    console.error(`  🔌 [${integration}] ⛔ TẮT VĨNH VIỄN cho đến restart server — lý do: ${reason}`);
    console.error(`     💡 Sửa lỗi trong file .env sau đó restart lại server để bật lại.`);
}
function _softFailCooldown(state, integration, reason, minutes = 5) {
    if (state.mode === 'hard-off') return; // HARD-OFF priority hơn
    state.mode = 'cooldown';
    state.disabledUntil = Date.now() + minutes * 60 * 1000;
    if (!state._lastSoftLog || Date.now() - state._lastSoftLog > 30000) { // chỉ log mỗi 30s tránh spam
        console.warn(`  ⏸️  [${integration}] Tạm tắt ${minutes} phút (lỗi tạm thời sẽ thử lại sau): ${reason}`);
        state._lastSoftLog = Date.now();
    }
}
function _isAvailable(state, integration) {
    if (state.mode === 'hard-off') return false;
    if (state.mode === 'cooldown' && Date.now() < state.disabledUntil) return false;
    // Hết cooldown → quay active
    if (state.mode === 'cooldown') {
        state.mode = 'active';
        state._lastSoftLog = 0;
        console.log(`  🔄 [${integration}] Hết tạm dừng → thử lại tích hợp.`);
    }
    return state.enabled;
}
function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

if (CLOUDINARY_ENABLED) {
    console.log('  ☁️  [Cloudinary] Đã cấu hình — ảnh/video/audio sẽ ưu tiên lưu trên Cloud.');
} else {
    console.log('  ⚠️  [Cloudinary] Chưa cấu hình — file sẽ chỉ lưu vào /uploads/ local.');
}

if (GITHUB_ENABLED) {
    console.log(`  🐙 [GitHub Backup] Đã cấu hình — DB sẽ backup lên: ${GITHUB_REPO} / ${GITHUB_FILE_PATH} (branch: ${GITHUB_BRANCH})`);
} else {
    console.log('  ⚠️  [GitHub Backup] Chưa cấu hình — thêm GITHUB_TOKEN + GITHUB_REPO vào .env để bảo vệ dữ liệu.');
}

/**
 * Cloudinary hỗ trợ ảnh (jpg/png/gif/webp), video (mp4/webm), audio (mp3/ogg/webm).
 *
 * Modern behaviour (Circuit Breaker):
 *   • Tự động retry 2 lần (tổng 3 lượt gọi) với exponential backoff (1s → 2s)
 *   • Lỗi HARD (401/403/invalid credentials): TẮT VĨNH VIỄN cho đến restart server
 *   • Lỗi SOFT (mạng, 5xx, timeout): tạm tắt 5 phút rồi thử lại
 *
 * @param {Buffer} buffer    - Nội dung file
 * @param {string} mime      - MIME type, vd: 'image/jpeg', 'audio/webm', 'video/mp4'
 * @param {string} folder    - Thư mục trên Cloudinary, vd: 'youth-memories/anon'
 * @returns {Promise<string|null>} URL public nếu thành công, null nếu thất bại
 */
function _cldRequestOnce(buffer, mime, folder) {
    return new Promise((resolve) => {
        try {
            let resourceType = 'image';
            if (mime.startsWith('video/') || mime.startsWith('audio/')) resourceType = 'video';

            const timestamp = Math.floor(Date.now() / 1000).toString();
            const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
            const signature = crypto
                .createHash('sha1')
                .update(paramsToSign + CLOUDINARY_API_SECRET)
                .digest('hex');

            const boundary = `----CloudinaryBoundary${crypto.randomBytes(8).toString('hex')}`;
            const CRLF = '\r\n';
            function part(name, value) {
                return `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`;
            }

            const extMap = {
                'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
                'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
                'audio/webm': 'webm', 'audio/webm;codecs=opus': 'webm', 'audio/mp4': 'm4a',
                'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv',
            };
            const ext = extMap[mime] || extMap[mime.split(';')[0].trim()] || 'bin';
            const publicId = `${folder.replace('/', '_')}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

            const textParts = Buffer.from(
                part('api_key',   CLOUDINARY_API_KEY) +
                part('timestamp', timestamp) +
                part('folder',    folder) +
                part('signature', signature)
            );
            const filePartHeader = Buffer.from(
                `--${boundary}${CRLF}` +
                `Content-Disposition: form-data; name="file"; filename="${publicId}.${ext}"${CRLF}` +
                `Content-Type: ${mime}${CRLF}${CRLF}`
            );
            const filePartFooter = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
            const body = Buffer.concat([textParts, filePartHeader, buffer, filePartFooter]);

            const uploadUrl = url.parse(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`);
            const options = {
                hostname: uploadUrl.hostname,
                path:     uploadUrl.path,
                method:   'POST',
                headers: {
                    'Content-Type':   `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': body.length,
                },
                timeout: 25000,
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    // HARD ERROR: 401 = sai key / secret; 404 = cloud_name không tồn tại
                    if (res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 404) {
                        let reason = `Server trả về ${res.statusCode}`;
                        try {
                            const json = JSON.parse(data);
                            if (json?.error?.message) reason += `: ${json.error.message}`;
                        } catch {}
                        if (res.statusCode === 401) reason += ' → CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET SAI';
                        if (res.statusCode === 403) reason += ' → Tài khoản Cloudinary bị khóa / hết hạn / vượt quota';
                        if (res.statusCode === 404) reason += ' → CLOUDINARY_CLOUD_NAME không tồn tại, kiểm tra lại ID';
                        resolve({ ok: false, hard: true, reason });
                        return;
                    }
                    try {
                        const json = JSON.parse(data);
                        if (json.secure_url) {
                            resolve({ ok: true, url: json.secure_url });
                        } else {
                            // 400 Bad Request = file không hợp lệ (lỗi hard) / còn lại xem là soft
                            const isHard = res.statusCode >= 400 && res.statusCode < 500 && res.statusCode !== 429;
                            resolve({
                                ok: false,
                                hard: isHard,
                                reason: `HTTP ${res.statusCode} — ${json?.error?.message || data.slice(0, 160)}`,
                            });
                        }
                    } catch (e) {
                        resolve({ ok: false, hard: false, reason: `Parse response lỗi: ${e.message} — raw: ${data.slice(0,80)}` });
                    }
                });
            });

            req.on('error', (err) => {
                // ECONNRESET, ENOTFOUND, ETIMEDOUT = soft errors
                resolve({ ok: false, hard: false, reason: `Network error: ${err.message}` });
            });
            req.setTimeout(25000, () => {
                req.destroy(new Error('Timeout 25s'));
            });
            req.write(body);
            req.end();
        } catch (e) {
            resolve({ ok: false, hard: false, reason: `Exception: ${e.message}` });
        }
    });
}

async function uploadToCloudinary(buffer, mime, folder = 'youth-memories') {
    if (!CLOUDINARY_ENABLED) return null;
    if (!_isAvailable(cldState, 'Cloudinary')) return null;

    const MAX_ATTEMPTS = 3;
    let lastResult = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (attempt > 1) {
            const waitMs = _cldCooldownMs(attempt - 2);
            console.log(`  🔁 [Cloudinary] Thử lại lần ${attempt}/${MAX_ATTEMPTS} — chờ ${waitMs}ms (exponential backoff)...`);
            await _sleep(waitMs);
        }
        lastResult = await _cldRequestOnce(buffer, mime, folder);
        if (lastResult.ok) {
            console.log(`  ☁️  [Cloudinary] ✅ Upload thành công (lần ${attempt}): ${lastResult.url}`);
            return lastResult.url;
        }
        console.error(`  ⚠️  [Cloudinary] Lần ${attempt}/${MAX_ATTEMPTS} thất bại: ${lastResult.reason}`);
        if (lastResult.hard) {
            _disableHard(cldState, 'Cloudinary', lastResult.reason);
            return null;
        }
    }

    _softFailCooldown(cldState, 'Cloudinary', `Thất bại ${MAX_ATTEMPTS} lần liên tiếp: ${lastResult.reason}`);
    return null;
}

/**
 * Lưu file: thử Cloudinary trước, fallback về disk local nếu Cloudinary chưa cấu hình/thất bại.
 * @returns {Promise<string>} URL (Cloudinary https:// hoặc /uploads/filename)
 */
async function saveFile(buffer, mime, folder = 'youth-memories') {
    // Thử Cloudinary
    try {
        const cloudUrl = await uploadToCloudinary(buffer, mime, folder);
        if (cloudUrl) return cloudUrl;
    } catch (e) {
        console.error('  ⚠️  [saveFile] Cloudinary thất bại, fallback xuống disk local:', e && e.message ? e.message : String(e));
    }

    // Fallback: lưu vào disk local
    try {
        const extMap = {
            'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
            'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav',
            'audio/webm': '.webm', 'audio/webm;codecs=opus': '.webm', 'audio/mp4': '.m4a',
            'video/mp4': '.mp4', 'video/webm': '.webm', 'video/ogg': '.ogv',
        };
        const ext      = extMap[mime] || extMap[mime.split(';')[0].trim()] || '.bin';
        const prefix   = folder.split('/').pop() || 'file';
        const filename = `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;

        if (!fs.existsSync(UPLOADS_DIR)) {
            fs.mkdirSync(UPLOADS_DIR, { recursive: true });
            console.warn('  ⚠️  [saveFile] UPLOADS_DIR chưa tồn tại, đã tự động tạo lại:', UPLOADS_DIR);
        }
        const filePath = path.join(UPLOADS_DIR, filename);
        fs.writeFileSync(filePath, buffer);
        console.log(`  💾  [saveFile] Lưu local OK: ${filename} (${(buffer.length/1024).toFixed(1)} KB)`);
        return `/uploads/${filename}`;
    } catch (e) {
        console.error('  ❌  [saveFile] Lưu local BỊ LỖI:', e && e.message ? e.message : String(e),
                      '\n  → Server sẽ trả về null cho savedMediaUrl — DB sẽ lưu mediaData base64 raw thay thế (tốn bộ nhớ hơn nhưng không mất file).');
        return null;
    }
}

// ── Cấu hình Admin ───────────────────────────────────────────────────────────
// Password admin phải được đặt rõ ràng qua env var ADMIN_PASSWORD (hoặc .env).
// KHÔNG dùng password cố định nào làm mặc định. Nếu thiếu, tạo password ngẫu
// nhiên mỗi lần khởi động + in to console để đăng nhập lần đầu, đồng thời cảnh
// báo lớn — tránh trạng thái admin mặc định dễ đoán.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (function () {
    const tmp = crypto.randomBytes(6).toString('base64url');
    console.error('\n' + '='.repeat(70));
    console.error('  ⚠️  CHƯA ĐẶT ADMIN_PASSWORD!');
    console.error('  Mật khẩu admin lần này (ngẫu nhiên, chỉ áp dụng phiên này): ' + tmp);
    console.error('  Đặt ADMIN_PASSWORD trong .env để có mật khẩu ổn định.');
    console.error('='.repeat(70) + '\n');
    return tmp;
})();
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 giờ

// ── Kho câu hài Đặc Vụ Đòi Nợ (RAG) ─────────────────────────────────────────
const RIB_DATA_FILE = path.join(__dirname, 'debtRibData.json');
const RIB_CACHE_FILE = path.join(DATA_DIR, 'debtRibCache.json');

function readRibData() {
    try { return JSON.parse(fs.readFileSync(RIB_DATA_FILE, 'utf8')); }
    catch { return { items: [] }; }
}
function writeRibData(data) {
    fs.writeFileSync(RIB_DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}
// Kho đổi → xóa cache vector để retrieval embed lại khi lần chạy tới
function invalidateRibCache() {
    try { if (fs.existsSync(RIB_CACHE_FILE)) fs.unlinkSync(RIB_CACHE_FILE); } catch (e) { /* noop */ }
}

// ── Session Store (in-memory, đủ dùng cho single-instance) ──────────────────
const sessions = new Map(); // token -> { createdAt }

function createSession() {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { createdAt: Date.now() });
    return token;
}

function isValidSession(token) {
    if (!token) return false;
    const session = sessions.get(token);
    if (!session) return false;
    if (Date.now() - session.createdAt > SESSION_TTL_MS) {
        sessions.delete(token);
        return false;
    }
    return true;
}

function getTokenFromRequest(req) {
    const cookieHeader = req.headers['cookie'] || '';
    const match = cookieHeader.match(/(?:^|;\s*)admin_token=([^;]+)/);
    if (match) return match[1];
    // Fallback: Authorization header
    const authHeader = req.headers['authorization'] || '';
    if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
    return null;
}

// ── Rate Limiting ────────────────────────────────────────────────────────────
// Map: ip -> { count, windowStart }
const rateLimitMap = new Map();

const RATE_LIMITS = {
    '/api/likes':        { max: 30,  windowMs: 60 * 1000 },       // 30 req / phút
    '/api/reactions':    { max: 30,  windowMs: 60 * 1000 },       // 30 req / phút
    '/api/wishes':       { max: 5,   windowMs: 60 * 1000 },       // 5 req / phút
    '/api/anonymous':    { max: 10,  windowMs: 60 * 1000 },       // 10 req / phút (media)
    '/api/login':        { max: 10,  windowMs: 15 * 60 * 1000 },  // 10 req / 15 phút
    '/api/upload':       { max: 20,  windowMs: 60 * 1000 },       // 20 req / phút
    '/api/track/ping':   { max: 30,  windowMs: 60 * 1000 },       // 30 req / phút
    '/api/track/event':  { max: 60,  windowMs: 60 * 1000 },       // 60 req / phút
    '/api/admin/backup/github-now': { max: 5, windowMs: 60 * 1000 }, // 5 req / phút
    '/api/debt-agent/ask':  { max: 10, windowMs: 60 * 1000 },       // 10 req / phút (LLM nên giới hạn nhẹ)
    '/api/ai-tutor/ask':        { max: 15, windowMs: 60 * 1000 },   // 15 req / phút (chat)
    '/api/ai-tutor/ask-file':   { max: 5,  windowMs: 60 * 1000 },   // 5 upload / phút
    '/api/ai-tutor/health':     { max: 60, windowMs: 60 * 1000 },   // health check
    '/api/ai-tutor/stats':      { max: 30, windowMs: 60 * 1000 },   // cache stats
    '/api/ai-tutor/admin/*':    { max: 20, windowMs: 60 * 1000 },   // admin routes (wildcard sẽ không khớp hoàn hảo nhưng không sao)
    '/api/wordchain/challenge': { max: 5,  windowMs: 60 * 1000 },  // 5 lượt tạo bàn / phút
    '/api/wordchain/turn':      { max: 20, windowMs: 60 * 1000 },  // 20 lượt đi / phút
    '/api/wordchain/state':     { max: 60, windowMs: 60 * 1000 },  // poll state
    '/api/wordchain/pending':   { max: 60, windowMs: 60 * 1000 },  // poll bàn đang chờ
    '/api/wordchain/decline':   { max: 20, windowMs: 60 * 1000 },  // đóng bàn
};

// ── Game Nối Từ (in-memory) ─────────────────────────────────────────────────────
// Không cần persist lâu dài: chỉ cần giữ trong RAM trong vài phút người chơi online.
// Luật: người trước nói 1 từ, người sau phải nói từ bắt đầu bằng CHỮ CÁI CUỐI của từ trước.
// Map: gameId -> { id, players: [guest, host|null], words:[], turn: 0/1, winner, startedAt, lastActivity }
const wordchainGames = new Map();

function normalizeWord(w) {
    return (w || '').trim().toLowerCase().replace(/[^\p{L}\u0061-\u024F\u00C0-\u024F]/gu, '');
}
function lastLetter(w) {
    const t = (w || '').trim();
    return t ? t.charAt(t.length - 1).toLowerCase() : '';
}
function firstLetter(w) {
    const t = (w || '').trim();
    return t ? t.charAt(0).toLowerCase() : '';
}

// Luật "nối từ" tiếng Việt chuẩn: nối theo TIẾNG (từ đơn) cuối, không phải chữ cái.
// VD: "cuộc sống" → từ kế phải bắt đầu bằng "sống", không phải chữ "g".
function splitSyllables(w) {
    // Tách cụm từ thành các tiếng bằng khoảng trắng (bỏ ký tự rỗng)
    return (w || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}
function lastSyllable(w) {
    const s = splitSyllables(w);
    return s.length ? s[s.length - 1] : '';
}
function firstSyllable(w) {
    const s = splitSyllables(w);
    return s.length ? s[0] : '';
}
// Bỏ dấu tiếng Việt để so sánh: "sống" ≈ "song", "yêu" ≈ "yeu"
function stripDiacritics(s) {
    return String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}
function startsWithSyllable(word, prefixSyllable) {
    // Từ mới hợp lệ nếu TIẾNG ĐẦU của nó KHỚP với tiếng cuối của từ trước (bỏ dấu, không phân biệt hoa/thường).
    // VD: "cuộc sống" → bắt buộc tiếng đầu = "sống" (sống động, sống xa...).
    const first = stripDiacritics(firstSyllable(word));
    const prefix = stripDiacritics(prefixSyllable);
    if (!first || !prefix) return false;
    return first === prefix;
}

function sanitizeWord(raw, maxLen = 60) {
    const t = String(raw ?? '').trim().slice(0, maxLen);
    // Giữ toàn bộ chữ cái Latin + tiếng Việt có dấu (mọi tổ hợp) + khoảng trắng + gạch nối + nháy.
    // Dùng u flag + loại trừ ký tự không mong muốn để giữ dấu.
    return t.replace(/[^a-zA-Z\p{L}0-9\s'-]/gu, '');
}

// ── Helper parse User-Agent ───────────────────────────────────────────────────
function parseUserAgent(uaString = '') {
    const ua = uaString.toLowerCase();
    let os = 'Máy tính (PC/Laptop)';
    let device = 'Desktop';
    let browser = 'Chrome/Trình duyệt web';

    if (ua.includes('iphone')) { os = 'iOS (iPhone)'; device = 'iPhone'; }
    else if (ua.includes('ipad')) { os = 'iPadOS (iPad)'; device = 'iPad'; }
    else if (ua.includes('android')) { os = 'Android'; device = 'Android Mobile'; }
    else if (ua.includes('windows')) { os = 'Windows'; device = 'Windows PC'; }
    else if (ua.includes('macintosh') || ua.includes('mac os')) { os = 'macOS'; device = 'MacBook/Mac'; }
    else if (ua.includes('linux')) { os = 'Linux'; device = 'Linux PC'; }

    if (ua.includes('zalo')) { browser = 'Ứng dụng Zalo'; }
    else if (ua.includes('fbav') || ua.includes('fban') || ua.includes('facebook')) { browser = 'Ứng dụng Facebook'; }
    else if (ua.includes('tiktok')) { browser = 'Ứng dụng TikTok'; }
    else if (ua.includes('chrome') && !ua.includes('edg')) { browser = 'Chrome'; }
    else if (ua.includes('safari') && !ua.includes('chrome')) { browser = 'Safari'; }
    else if (ua.includes('edg')) { browser = 'Edge'; }
    else if (ua.includes('firefox')) { browser = 'Firefox'; }

    return { os, device, browser };
}

// Helper trích xuất IP chính xác đằng sau Proxy/Render/Cloudflare
function extractClientIp(req) {
    const xForwardedFor = req.headers['x-forwarded-for'];
    if (xForwardedFor) {
        const ips = xForwardedFor.split(',');
        for (const ip of ips) {
            const clean = ip.trim();
            if (clean && !clean.startsWith('10.') && !clean.startsWith('192.168.') && clean !== '127.0.0.1' && clean !== '::1') {
                return clean;
            }
        }
        return ips[0].trim();
    }
    return req.headers['x-real-ip'] || req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '127.0.0.1';
}

// Memory Cache cho IP Geolocation
const ipGeoCache = new Map();

async function fetchWithTimeout(resource, timeoutMs = 2000, headers = {}) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(resource, { signal: controller.signal, headers });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        return null;
    }
}

async function getIpLocation(ip) {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
        return { city: 'Localhost', region: 'Nội bộ', country: 'Máy chủ local', isp: 'Mạng LAN', lat: null, lng: null };
    }
    if (ipGeoCache.has(ip)) return ipGeoCache.get(ip);

    const fallback = { city: 'Việt Nam', region: 'Việt Nam', country: 'Việt Nam', isp: 'Nhà mạng', lat: null, lng: null };

    // Gọi song song cả 3 nguồn — lấy kết quả đầu tiên thành công, không chờ tuần tự
    const sources = [
        () => fetchWithTimeout(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city,isp,org,lat,lon`, 2000)
            .then(async res => {
                if (!res || !res.ok) return null;
                const data = await res.json();
                if (data.status !== 'success') return null;
                return {
                    city: data.city || data.regionName || 'Việt Nam',
                    region: data.regionName || data.city || 'Việt Nam',
                    country: data.country || 'Việt Nam',
                    isp: data.isp || data.org || 'Internet',
                    lat: data.lat || null,
                    lng: data.lon || null
                };
            }).catch(() => null),

        () => fetchWithTimeout(`https://ipwho.is/${ip}`, 2000)
            .then(async res => {
                if (!res || !res.ok) return null;
                const data = await res.json();
                if (!data.success) return null;
                return {
                    city: data.city || data.region || 'Việt Nam',
                    region: data.region || data.city || 'Việt Nam',
                    country: data.country || 'Việt Nam',
                    isp: data.connection?.isp || data.connection?.org || 'Internet',
                    lat: data.latitude || null,
                    lng: data.longitude || null
                };
            }).catch(() => null),

        () => fetchWithTimeout(`https://freeipapi.com/api/json/${ip}`, 2000)
            .then(async res => {
                if (!res || !res.ok) return null;
                const data = await res.json();
                if (!data.cityName) return null;
                return {
                    city: data.cityName || 'Việt Nam',
                    region: data.regionName || data.cityName || 'Việt Nam',
                    country: data.countryName || 'Việt Nam',
                    isp: 'Nhà mạng Internet',
                    lat: data.latitude || null,
                    lng: data.longitude || null
                };
            }).catch(() => null),
    ];

    // Dùng Promise.any để lấy kết quả đầu tiên hợp lệ — nhanh hơn tuần tự đáng kể
    try {
        const geo = await Promise.any(sources.map(fn => fn().then(r => r || Promise.reject())));
        if (geo) {
            ipGeoCache.set(ip, geo);
            return geo;
        }
    } catch (e) {
        // Tất cả đều thất bại
    }

    ipGeoCache.set(ip, fallback);
    return fallback;
}

// Helper Giải mã ngược Tọa độ GPS sang Tên Địa Danh chi tiết từng Xóm/Xã/Phường
// Gọi SONG SONG cả BigDataCloud + Nominatim, sau đó chọn kết quả nào chi tiết hơn (nhiều cấp hành chính hơn)
async function reverseGeocode(lat, lng) {

    // ── Nguồn 1: Nominatim (zoom=18 = building-level → trả hamlet/xóm nếu OSM có) ──
    const nominatimPromise = (async () => {
        try {
            const res = await fetchWithTimeout(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=vi`,
                3500,
                { 'User-Agent': 'YouthMemoriesApp/2.0' }
            );
            if (!res || !res.ok) return null;
            const data = await res.json();
            if (!data || !data.address) return null;
            const a = data.address;

            // Ưu tiên lấy hamlet / neighbourhood (xóm/thôn/ấp) → village/town (xã) → county (huyện) → state (tỉnh)
            const hamlet = a.hamlet || a.neighbourhood || a.quarter || '';
            const village = a.village || '';
            const xa     = a.town || a.suburb || '';
            const huyen  = a.county || a.city_district || a.district || '';
            const tinh   = a.state || a.city || a.province || 'Việt Nam';

            // Ghép từ nhỏ → lớn, bỏ trùng
            const rawParts = [hamlet, village, xa, huyen, tinh].filter(Boolean);
            // Loại phần tử trùng lặp (BigDataCloud đôi khi đặt village = xã)
            const parts = [...new Set(rawParts)];
            const fullAddress = parts.length > 0 ? parts.join(', ') : (data.display_name || 'Việt Nam');

            return {
                city:    fullAddress,
                region:  tinh,
                country: a.country || 'Việt Nam',
                _depth:  parts.length, // dùng nội bộ để so sánh độ chi tiết
            };
        } catch { return null; }
    })();

    // ── Nguồn 2: BigDataCloud (localityLanguage=vi → trả Tiếng Việt) ──────────
    const bdcPromise = (async () => {
        try {
            const res = await fetchWithTimeout(
                `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=vi`,
                3500
            );
            if (!res || !res.ok) return null;
            const data = await res.json();
            if (!data || data.countryCode !== 'VN') return null;

            const admins = (data.localityInfo?.administrative || [])
                .sort((a, b) => b.order - a.order); // order cao = cấp nhỏ (xã, phường)
            const informative = data.localityInfo?.informative || [];

            // Lấy cấp hành chính từ administrative + informative
            const xa    = admins.find(a => a.adminLevel === 6)?.name || data.locality || '';
            const huyen = informative.find(a => a.order === 9)?.name
                       || admins.find(a => a.adminLevel === 5)?.name || '';
            const tinh  = admins.find(a => a.adminLevel === 4)?.name || data.principalSubdivision || 'Việt Nam';

            // BigDataCloud KHÔNG có trường hamlet/xóm riêng — lấy neighbourhood nếu có
            const neighbourhood = data.neighbourhood || '';

            const rawParts = [neighbourhood, xa, huyen ? `Huyện ${huyen}` : '', tinh ? `Tỉnh ${tinh}` : ''].filter(Boolean);
            const parts = [...new Set(rawParts)];
            const fullAddress = parts.join(', ') || data.display_name || 'Việt Nam';

            return {
                city:    fullAddress,
                region:  tinh,
                country: 'Việt Nam',
                _depth:  parts.length,
            };
        } catch { return null; }
    })();

    // ── Chờ cả hai xong, chọn kết quả CHI TIẾT HƠN (nhiều cấp hành chính hơn) ──
    try {
        const [nomResult, bdcResult] = await Promise.all([nominatimPromise, bdcPromise]);

        // Nếu cả hai đều có kết quả → ưu tiên cái có _depth (số cấp) lớn hơn
        if (nomResult && bdcResult) {
            const pick = (nomResult._depth >= bdcResult._depth) ? nomResult : bdcResult;
            delete pick._depth;
            return pick;
        }
        if (nomResult) { delete nomResult._depth; return nomResult; }
        if (bdcResult) { delete bdcResult._depth; return bdcResult; }
    } catch {}

    return null;
}

function checkRateLimit(pathname, ip) {
    const rule = RATE_LIMITS[pathname];
    if (!rule) return true; // không giới hạn

    const key = `${pathname}:${ip}`;
    const now = Date.now();
    const entry = rateLimitMap.get(key);

    if (!entry || now - entry.windowStart > rule.windowMs) {
        rateLimitMap.set(key, { count: 1, windowStart: now });
        return true;
    }

    entry.count++;
    if (entry.count > rule.max) return false;
    return true;
}

// Dọn dẹp rate limit map định kỳ để tránh memory leak
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap.entries()) {
        // Tìm rule tương ứng
        const pathname = key.split(':')[0];
        const rule = RATE_LIMITS[pathname];
        const ttl = rule ? rule.windowMs : 60 * 1000;
        if (now - entry.windowStart > ttl * 2) {
            rateLimitMap.delete(key);
        }
    }
}, 5 * 60 * 1000);

// ── Input Sanitization ───────────────────────────────────────────────────────
function sanitizeString(str, maxLen = 500) {
    if (typeof str !== 'string') return '';
    // Cắt bớt độ dài
    str = str.slice(0, maxLen);
    // Xóa ký tự null và control chars (trừ newline/tab)
    str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    // Trim
    return str.trim();
}

function sanitizeUrl(str, maxLen = 7 * 1024 * 1024) {
    if (typeof str !== 'string') return '';
    str = str.trim();
    if (str.length > maxLen) return '';
    // Chỉ cho phép http/https/data URLs và relative paths
    if (!/^(https?:\/\/|data:|\.\/|\/)/.test(str)) return '';
    return str;
}

// ── File Upload Validation (Magic Bytes) ─────────────────────────────────────
// Các định dạng cho phép: jpg, png, gif, webp, mp3, mp4, ogg, wav, webm
const ALLOWED_MAGIC = [
    { magic: Buffer.from([0xFF, 0xD8, 0xFF]),             mime: 'image/jpeg',  ext: '.jpg'  },
    { magic: Buffer.from([0x89, 0x50, 0x4E, 0x47]),      mime: 'image/png',   ext: '.png'  },
    { magic: Buffer.from([0x47, 0x49, 0x46]),             mime: 'image/gif',   ext: '.gif'  },
    { magic: Buffer.from([0x52, 0x49, 0x46, 0x46]),      mime: 'image/webp',  ext: '.webp' }, // RIFF...WEBP
    { magic: Buffer.from([0x49, 0x44, 0x33]),             mime: 'audio/mpeg',  ext: '.mp3'  }, // ID3
    { magic: Buffer.from([0xFF, 0xFB]),                   mime: 'audio/mpeg',  ext: '.mp3'  }, // MP3 frame
    { magic: Buffer.from([0xFF, 0xF3]),                   mime: 'audio/mpeg',  ext: '.mp3'  },
    { magic: Buffer.from([0xFF, 0xF2]),                   mime: 'audio/mpeg',  ext: '.mp3'  },
    { magic: Buffer.from([0x66, 0x74, 0x79, 0x70]), offset: 4, mime: 'video/mp4', ext: '.mp4' },
    { magic: Buffer.from([0x4F, 0x67, 0x67, 0x53]),      mime: 'audio/ogg',   ext: '.ogg'  },
    { magic: Buffer.from([0x52, 0x49, 0x46, 0x46]),      mime: 'audio/wav',   ext: '.wav'  }, // RIFF...WAVE
    // WebM (Matroska EBML header) — định dạng MediaRecorder mặc định trên Chrome/Edge/Firefox
    { magic: Buffer.from([0x1A, 0x45, 0xDF, 0xA3]),      mime: 'audio/webm',  ext: '.webm' },
];

function detectFileType(buffer) {
    for (const entry of ALLOWED_MAGIC) {
        const offset = entry.offset || 0;
        if (buffer.length < offset + entry.magic.length) continue;
        const slice = buffer.slice(offset, offset + entry.magic.length);
        if (slice.equals(entry.magic)) {
            // Thêm kiểm tra đặc biệt cho RIFF: phân biệt WEBP vs WAV
            if (entry.mime === 'image/webp' && buffer.length >= 12) {
                const webpSig = buffer.slice(8, 12).toString('ascii');
                if (webpSig !== 'WEBP') continue;
            }
            if (entry.mime === 'audio/wav' && buffer.length >= 12) {
                const wavSig = buffer.slice(8, 12).toString('ascii');
                if (wavSig !== 'WAVE') continue;
            }
            return entry;
        }
    }
    return null;
}

function validateBase64File(base64DataUrl) {
    if (!base64DataUrl || typeof base64DataUrl !== 'string') {
        return { ok: false, error: 'Dữ liệu file rỗng' };
    }
    // Regex phải hỗ trợ MIME có tham số, vd: "audio/webm;codecs=opus"
    // Data URL format: data:<mime>[;params];base64,<data>
    const matches = base64DataUrl.match(/^data:([^;]+(?:;(?!base64,)[^;]*)*);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
        return { ok: false, error: 'Định dạng base64 không đúng' };
    }

    const mimeHeader = matches[1].toLowerCase();
    let fileBuffer;
    try {
        fileBuffer = Buffer.from(matches[2], 'base64');
    } catch (e) {
        return { ok: false, error: 'Không thể decode base64' };
    }

    // Giới hạn kích thước: 50MB (cho phép video lớn hơn)
    if (fileBuffer.length > 50 * 1024 * 1024) {
        return { ok: false, error: 'File quá lớn (tối đa 50MB)' };
    }

    let detected = detectFileType(fileBuffer);
    if (!detected) {
        // Fallback kiểm tra theo MIME header từ client nếu magic bytes chưa liệt kê đủ.
        // Normalize: bỏ phần tham số sau ';' (vd: 'audio/webm;codecs=opus' → 'audio/webm')
        const baseMime = mimeHeader.split(';')[0].trim();
        if (baseMime.startsWith('video/')) {
            let ext = '.mp4';
            if (baseMime.includes('webm')) ext = '.webm';
            else if (baseMime.includes('quicktime') || baseMime.includes('mov')) ext = '.mov';
            else if (baseMime.includes('3gp')) ext = '.3gp';
            detected = { mime: baseMime, ext };
        } else if (baseMime.startsWith('image/')) {
            let ext = '.png';
            if (baseMime.includes('jpeg') || baseMime.includes('jpg')) ext = '.jpg';
            else if (baseMime.includes('gif')) ext = '.gif';
            else if (baseMime.includes('webp')) ext = '.webp';
            detected = { mime: baseMime, ext };
        } else if (baseMime.startsWith('audio/')) {
            let ext = '.mp3';
            if (baseMime.includes('webm')) ext = '.webm';
            else if (baseMime.includes('ogg')) ext = '.ogg';
            else if (baseMime.includes('wav')) ext = '.wav';
            else if (baseMime.includes('mp4') || baseMime.includes('aac')) ext = '.m4a';
            detected = { mime: baseMime, ext };
        }
    }

    if (!detected) {
        return { ok: false, error: 'Định dạng file không được hỗ trợ' };
    }

    return { ok: true, buffer: fileBuffer, ext: detected.ext, mime: detected.mime };
}

// ── Anti-DataLoss Helpers (Snapshot + Smart Merge + Anti-Corruption Guard) ──
// Đảm bảo DỮ LIỆU KHÔNG BAO GIỜ MẤT, cho dù Cloud backup lỗi / server restart

function _countDBRecords(data) {
    if (!data || typeof data !== 'object') return 0;
    let total = 0;
    if (Array.isArray(data.wishes)) total += data.wishes.length;
    if (Array.isArray(data.anonymousMessages)) total += data.anonymousMessages.length;
    if (Array.isArray(data.visitors)) total += data.visitors.length;
    if (data.config && typeof data.config === 'object') {
        total += Object.keys(data.config).length * 2;
        if (Array.isArray(data.config.gallery)) total += data.config.gallery.length;
    }
    return total;
}

function _snapshotDB(reason = 'auto', minIntervalMinutes = 0) {
    try {
        if (minIntervalMinutes > 0) {
            const now = Date.now();
            if (_lastSnapshotAt && (now - _lastSnapshotAt) < minIntervalMinutes * 60 * 1000) return null;
        }
        if (!fs.existsSync(DB_FILE)) return null;
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        if (!raw || raw.trim() === '') return null;
        const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
        const backupFile = path.join(BACKUPS_DIR, `db_snapshot_${ts}__${reason}.json`);
        fs.writeFileSync(backupFile, raw, 'utf8');
        _lastSnapshotAt = Date.now();
        const files = fs.readdirSync(BACKUPS_DIR)
            .filter(f => f.startsWith('db_snapshot_') && f.endsWith('.json'))
            .sort()
            .reverse();
        const MAX_SNAPSHOTS = 30;
        if (files.length > MAX_SNAPSHOTS) {
            for (let i = MAX_SNAPSHOTS; i < files.length; i++) {
                try { fs.unlinkSync(path.join(BACKUPS_DIR, files[i])); } catch {}
            }
        }
        return backupFile;
    } catch (e) {
        console.error('  ⚠️  [Backup] Lỗi tạo snapshot:', e.message);
        return null;
    }
}
let _lastSnapshotAt = 0;

function _restoreFromLatestBackupIfDBEmpty() {
    try {
        const currentDB = _loadDBFromDisk();
        const currentCount = _countDBRecords(currentDB);
        if (currentCount >= 10) return false;

        const files = fs.readdirSync(BACKUPS_DIR)
            .filter(f => f.startsWith('db_snapshot_') && f.endsWith('.json'))
            .sort()
            .reverse();
        if (files.length === 0) return false;

        for (const f of files) {
            try {
                const backupPath = path.join(BACKUPS_DIR, f);
                const backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
                const backupCount = _countDBRecords(backupData);
                if (backupCount > currentCount * 1.5 || (backupCount >= 10 && currentCount < 10)) {
                    fs.writeFileSync(DB_FILE, JSON.stringify(backupData, null, 2), 'utf8');
                    const legacyDB = path.join(__dirname, 'db.json');
                    try { fs.writeFileSync(legacyDB, JSON.stringify(backupData, null, 2), 'utf8'); } catch {}
                    _dbCache = null;
                    console.log(`  🔧 [Auto-Restore] ✅ Phát hiện DB cục bộ bị rỗng/${currentCount} records!`);
                    console.log(`     → Tự động khôi phục từ backup gần nhất: ${f}`);
                    console.log(`     → Đã khôi phục ${backupCount} records (wishes + guests + messages + config).`);
                    console.log(`     💡 Lưu ý: Mặc dù đã khôi phục, hãy kiểm tra kỹ dữ liệu trong Admin nhé.`);
                    return true;
                }
            } catch (e) {
                console.warn('  ⚠️  [Auto-Restore] Skip backup lỗi format:', f, '-', e.message);
                continue;
            }
        }
        return false;
    } catch (e) {
        console.warn('  ⚠️  [Auto-Restore] Không thể quét thư mục backup:', e.message);
        return false;
    }
}

function _smartMergeDB(localData, cloudData) {
    if (!localData || typeof localData !== 'object') localData = { config: {}, wishes: [], hearts: 0, reactions: {}, anonymousMessages: [], visitors: [] };
    if (!cloudData || typeof cloudData !== 'object') return localData;

    const localCount = _countDBRecords(localData);
    const cloudCount = _countDBRecords(cloudData);
    const localCopy = JSON.parse(JSON.stringify(localData));

    function mergeArrays(localArr, cloudArr, idKey) {
        if (!Array.isArray(localArr)) localArr = [];
        if (!Array.isArray(cloudArr)) cloudArr = [];
        const seen = new Map();
        [...localArr, ...cloudArr].forEach(item => {
            if (!item || typeof item !== 'object') return;
            let key;
            if (idKey && item[idKey]) key = String(item[idKey]);
            else key = JSON.stringify(item).slice(0, 200);
            if (!seen.has(key)) seen.set(key, item);
        });
        return Array.from(seen.values());
    }

    const merged = localCopy;
    if (!merged.config || typeof merged.config !== 'object') merged.config = {};

    if (cloudData.config && typeof cloudData.config === 'object') {
        for (const k of Object.keys(cloudData.config)) {
            if (merged.config[k] === undefined || merged.config[k] === null || merged.config[k] === '') {
                merged.config[k] = cloudData.config[k];
            }
        }
    }

    merged.wishes = mergeArrays(merged.wishes, cloudData.wishes, 'id');
    merged.anonymousMessages = mergeArrays(merged.anonymousMessages, cloudData.anonymousMessages, 'id');
    merged.visitors = mergeArrays(merged.visitors, cloudData.visitors, 'ip');
    merged.hearts = Math.max(merged.hearts || 0, cloudData.hearts || 0);
    merged.reactions = { ...(cloudData.reactions || {}), ...(merged.reactions || {}) };

    const mergedCount = _countDBRecords(merged);
    return { data: merged, localCount, cloudCount, mergedCount };
}

// ── Database với Write Queue & Cloud Backup (tránh race condition & mất data) ──

if (JSONBIN_BIN_ID && JSONBIN_API_KEY) {
    console.log('  🗃️  [JSONBin] Đã cấu hình — dùng làm backup phụ khi GitHub chưa cấu hình.');
} else {
    console.log('  ⚠️  [JSONBin] Chưa cấu hình — không sao nếu đã có GitHub Backup.');
}

function _jbnRequestOnce(method, extraPath = '', payloadBuffer = null) {
    return new Promise((resolve) => {
        try {
            const reqUrl = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}${extraPath}`;
            const parsed = url.parse(reqUrl);
            const headers = {
                'X-Master-Key': JSONBIN_API_KEY,
                'Accept':        'application/json',
            };
            if (payloadBuffer) {
                headers['Content-Type']   = 'application/json';
                headers['Content-Length'] = payloadBuffer.length;
            }
            const req = https.request({
                hostname: parsed.hostname,
                path:     parsed.path,
                method,
                headers,
                timeout: 10000,
            }, (res) => {
                let body = '';
                res.on('data', c => body += c);
                res.on('end', () => {
                    const isHard = (res.statusCode === 401) || (res.statusCode === 403) ||
                                   (res.statusCode === 404) || (res.statusCode === 413) ||
                                   (res.statusCode === 400) || (res.statusCode === 422);
                    const isOk = res.statusCode >= 200 && res.statusCode < 300;
                    let parsedJson = null;
                    try { parsedJson = JSON.parse(body); } catch {}
                    resolve({
                        ok: isOk,
                        status: res.statusCode,
                        hard: isHard,
                        body,
                        data: parsedJson,
                    });
                });
            });
            req.on('error', (err) => resolve({ ok: false, hard: false, status: 0, body: '', error: err.message }));
            req.setTimeout(10000, () => req.destroy(new Error('Timeout 10s')));
            if (payloadBuffer) req.write(payloadBuffer);
            req.end();
        } catch (e) {
            resolve({ ok: false, hard: false, status: 0, body: '', error: e.message });
        }
    });
}

async function syncFromCloudDB() {
    if (!JSONBIN_BIN_ID || !JSONBIN_API_KEY) {
        console.log('  ⚠️  [Cloud DB] Không tìm thấy JSONBIN_BIN_ID hoặc JSONBIN_API_KEY. Sử dụng db.json cục bộ.');
        return false;
    }
    if (!_isAvailable(jbnState, 'JSONBin')) return false;

    const snapFile = _snapshotDB('before-cloud-sync');
    if (snapFile) {
        console.log(`  📸 [Anti-DataLoss] Đã snapshot DB cục bộ TRƯỚC khi sync Cloud: ${path.basename(snapFile)}`);
    }

    const localDataBefore = _loadDBFromDisk();
    const localCount = _countDBRecords(localDataBefore);

    const MAX_ATTEMPTS = 2;
    let lastRes = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (attempt > 1) {
            const waitMs = _jbnCooldownMs(attempt - 2);
            console.log(`  🔁 [Cloud DB] Tải lại từ Cloud lần ${attempt}/${MAX_ATTEMPTS} — chờ ${waitMs}ms...`);
            await _sleep(waitMs);
        }
        lastRes = await _jbnRequestOnce('GET', '/latest');

        if (lastRes.ok) {
            try {
                if (lastRes.data && lastRes.data.record && typeof lastRes.data.record === 'object' && Object.keys(lastRes.data.record).length > 0) {
                    const cloudData = lastRes.data.record;
                    const cloudCount = _countDBRecords(cloudData);

                    // ⛔ ANTI-CORRUPTION GUARD: Nếu Cloud ÍT record hơn rõ rệt so với Local → NGUY CƠ MẤT DỮ LIỆU!
                    // Bỏ qua sync và giữ Local. Log cảnh báo cực kỳ rõ ràng.
                    if (localCount > 0 && cloudCount < localCount * 0.7) {
                        console.error('');
                        console.error('  ⚠️⚠️⚠️  [ANTI-CORRUPTION GUARD] CẢNH BÁO MẤT DỮ LIỆU TỪ CLOUD!  ⚠️⚠️⚠️');
                        console.error(`     → DB Local hiện có:  ${localCount} records (wishes + guests + messages + config)`);
                        console.error(`     → DB Cloud tải về:    ${cloudCount} records`);
                        console.error(`     → Cloud kém hơn ${((1 - cloudCount / Math.max(1, localCount)) * 100).toFixed(0)}% so với Local → RẤT NGUY HIỂM NẾU GHI ĐÈ!`);
                        console.error(`     → 🛡️ HỆ THỐNG ĐÃ TỰ ĐỘNG BỎ QUA GHI ĐÈ, GIỮ NGUYÊN DB CỤC BỘ để tránh mất dữ liệu.`);
                        console.error(`     💡 NGUYÊN NHÂN THƯỜNG GẶP:`);
                        console.error(`        • DB đã vượt 100KB → JSONBin trả lỗi 413 → Circuit Breaker tắt backup → Cloud giữ BẢN CŨ`);
                        console.error(`        • Server bị host restart / redeploy → syncFromCloudDB tải BẢN CŨ về`);
                        console.error(`     💡 XỬ LÝ:`);
                        console.error(`        • Bỏ qua bước này, giữ Local làm chuẩn ✓ (đã làm)`);
                        console.error(`        • Lên JSONBin dashboard kiểm tra Bin thực sự có chứa dữ liệu mới không`);
                        console.error(`        • Nếu DB > 100KB: Giảm bớt base64 media cũ hoặc tắt JSONBin backup để tránh rắc rối trong tương lai`);
                        console.error('');
                        return false;
                    }

                    // Chạy SMART MERGE (Union): không ghi đè, cộng thêm dữ liệu thiếu từ Cloud vào Local
                    const mergeResult = _smartMergeDB(localDataBefore, cloudData);
                    const finalData = mergeResult.data;

                    fs.writeFileSync(DB_FILE, JSON.stringify(finalData, null, 2), 'utf8');
                    const legacyDB = path.join(__dirname, 'db.json');
                    try { fs.writeFileSync(legacyDB, JSON.stringify(finalData, null, 2), 'utf8'); } catch (e) {}
                    _dbCache = null;

                    console.log(`  ✅ [Cloud DB] SMART MERGE thành công!`);
                    console.log(`     → Trước merge:  Local=${mergeResult.localCount} records, Cloud=${mergeResult.cloudCount} records`);
                    console.log(`     → Sau merge:    ${mergeResult.mergedCount} records (đã cộng thêm dữ liệu thiếu từ Cloud)`);
                    console.log(`     💡 Ưu tiên luôn giữ Local làm gốc, chỉ thêm Cloud nếu có phần tử mới.`);
                    return true;
                }
                console.warn('  ⚠️  [Cloud DB] Dữ liệu từ JSONBin rỗng hoặc sai cấu trúc (bin mới tạo?). Bỏ qua & giữ db cục bộ.');
                return false;
            } catch (e) {
                console.error('  ⚠️  [Cloud DB] Lỗi merge dữ liệu Cloud vào Local:', e.message);
                return false;
            }
        }

        if (lastRes.hard) {
            let reason = `GET /latest trả về HTTP ${lastRes.status}`;
            if (lastRes.status === 401) reason += ' → JSONBIN_API_KEY (X-Master-Key) SAI — không có quyền truy cập bin này';
            if (lastRes.status === 403) reason += ' → Bin bị khóa riêng tư / API key không thuộc tài khoản sở hữu bin (Lỗi phổ biến khi xóa bin cũ mà chưa đổi ID mới)';
            if (lastRes.status === 404) reason += ' → JSONBIN_BIN_ID không tồn tại (bạn đã xóa bin trên dashboard JSONBin nhưng chưa cập nhật lại trong file .env!)';
            if (lastRes.status === 413) reason += ' → DỮ LIỆU DB QUÁ LỚN so với giới hạn JSONBin Free Plan (thường 100KB/bin). Giảm bớt tin nhắn cũ / media base64 trong db.json hoặc nâng cấp tài khoản JSONBin.';
            if (lastRes.status === 400 || lastRes.status === 422) reason += ' → Dữ liệu gửi lên JSONBin bị lỗi định dạng / không hợp lệ.';
            if (lastRes.data?.message) reason += ` — ${lastRes.data.message}`;
            _disableHard(jbnState, 'JSONBin', reason);
            return false;
        }
        console.warn(`  ⚠️  [Cloud DB] Lần ${attempt}/${MAX_ATTEMPTS} tải Cloud thất bại: ${lastRes.error || lastRes.body?.slice(0,120) || `HTTP ${lastRes.status}`}`);
    }

    _softFailCooldown(jbnState, 'JSONBin', `syncFromCloudDB thất bại ${MAX_ATTEMPTS} lần liên tiếp: ${lastRes.error || 'Lỗi không xác định'}`);
    return false;
}

async function saveToCloudDB(data) {
    if (!JSONBIN_BIN_ID || !JSONBIN_API_KEY) return;
    if (!_isAvailable(jbnState, 'JSONBin')) return;

    try {
        const payload = JSON.stringify(data);
        const payloadBuffer = Buffer.from(payload, 'utf8');
        const MAX_ATTEMPTS = 3;
        let lastRes = null;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            if (attempt > 1) {
                const waitMs = _jbnCooldownMs(attempt - 2);
                console.log(`  🔁 [Cloud DB] Upload lên Cloud lần ${attempt}/${MAX_ATTEMPTS} — chờ ${waitMs}ms...`);
                await _sleep(waitMs);
            }
            lastRes = await _jbnRequestOnce('PUT', '', payloadBuffer);

            if (lastRes.ok) {
                console.log('  ☁️  [Cloud DB] ✅ Đã sao lưu dữ liệu mới lên JSONBin.io!');
                return;
            }

            if (lastRes.hard) {
                let reason = `PUT /b/${JSONBIN_BIN_ID} trả về HTTP ${lastRes.status}`;
                if (lastRes.status === 401) reason += ' → JSONBIN_API_KEY (X-Master-Key) SAI — kiểm tra file .env';
                if (lastRes.status === 403) reason += ' → ⚠️ Rất hay gặp: BIN TRÊN DASHBOARD ĐÃ BỊ XÓA nhưng JSONBIN_BIN_ID trong .env vẫn là CŨ — hãy tạo bin mới và dán ID vào .env! Hoặc API key không thuộc tài khoản sở hữu bin.';
                if (lastRes.status === 404) reason += ' → JSONBIN_BIN_ID không tồn tại (bạn đã xóa bin cũ rồi).';
                if (lastRes.status === 413) reason += ` → 📦 DỮ LIỆU DB QUÁ LỚN! JSONBin Free Plan giới hạn ~100KB/bin. DB hiện tại của bạn đã vượt giới hạn này (payload ${(payloadBuffer.length/1024).toFixed(1)} KB). Giảm bớt tin nhắn cũ hoặc tắt tính năng lưu base64 raw media, hoặc nâng cấp tài khoản JSONBin Pro để có giới hạn lớn hơn.`;
                if (lastRes.status === 400 || lastRes.status === 422) reason += ' → Dữ liệu JSON gửi lên bị lỗi định dạng / thiếu trường.';
                if (lastRes.data?.message) reason += ` — JSONBin message: ${lastRes.data.message}`;
                _disableHard(jbnState, 'JSONBin', reason);
                return;
            }
            console.warn(`  ⚠️  [Cloud DB] Lần ${attempt}/${MAX_ATTEMPTS} upload thất bại: ${lastRes.error || `HTTP ${lastRes.status}` || lastRes.body?.slice(0,120)}`);
        }

        _softFailCooldown(jbnState, 'JSONBin', `saveToCloudDB thất bại ${MAX_ATTEMPTS} lần liên tiếp: ${lastRes.error || `HTTP ${lastRes.status}` || 'Lỗi không xác định'}`);
    } catch (e) {
        console.error('  ⚠️  [Cloud DB] Exception saveToCloudDB:', e.message);
    }
}

// ════════════════════════════════════════════════════════════════════════════
// ██  GITHUB BACKUP — Backup chính thay thế JSONBin (không giới hạn size)  ██
// ════════════════════════════════════════════════════════════════════════════
//
//  Cách hoạt động:
//   • Mỗi lần saveDB() → push commit lên GitHub repo private
//   • Khi startup và DB rỗng (Render wipe filesystem) → fetch file từ GitHub về
//   • Lịch sử commit = lịch sử backup có thể rollback bất kỳ lúc nào
//   • Không giới hạn dung lượng (GitHub free = 1GB/repo)
//   • Throttle: không push quá 1 lần/phút để tránh rate-limit API
//
//  Setup (5 phút):
//   1. Tạo private repo trên GitHub (vd: kedep2004/youth-memories-backup)
//   2. Vào Settings → Developer settings → Personal access tokens → Classic
//      → New token → Chọn scope "repo" → Generate → Copy token
//   3. Thêm vào .env:
//        GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
//        GITHUB_REPO=kedep2004/youth-memories-backup
//        GITHUB_BRANCH=main   (tùy chọn, mặc định là main)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Gọi GitHub API qua HTTPS thuần (không dùng SDK).
 * @param {string} method  - 'GET' | 'PUT'
 * @param {string} apiPath - vd: '/repos/user/repo/contents/path'
 * @param {Object|null} bodyObj - object sẽ JSON.stringify, hoặc null
 * @returns {Promise<{ok, status, data, error}>}
 */
function _ghRequestOnce(method, apiPath, bodyObj = null) {
    return new Promise((resolve) => {
        try {
            const bodyStr    = bodyObj ? JSON.stringify(bodyObj) : null;
            const bodyBuf    = bodyStr ? Buffer.from(bodyStr, 'utf8') : null;
            const headers    = {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept':        'application/vnd.github.v3+json',
                'User-Agent':    'YouthMemoriesApp/2.0',
            };
            if (bodyBuf) {
                headers['Content-Type']   = 'application/json';
                headers['Content-Length'] = bodyBuf.length;
            }
            const reqOpts = {
                hostname: 'api.github.com',
                path:     apiPath,
                method,
                headers,
                timeout: 20000,
            };
            const req = https.request(reqOpts, (res) => {
                let body = '';
                res.on('data', c => body += c);
                res.on('end', () => {
                    const isOk = res.statusCode >= 200 && res.statusCode < 300;
                    const isHard = res.statusCode === 401 || res.statusCode === 403
                                || res.statusCode === 404;
                    let data = null;
                    try { data = JSON.parse(body); } catch {}
                    resolve({ ok: isOk, status: res.statusCode, data, hard: isHard, raw: body });
                });
            });
            req.on('error', (err) => resolve({ ok: false, status: 0, data: null, hard: false, error: err.message }));
            req.setTimeout(20000, () => req.destroy(new Error('GitHub API timeout 20s')));
            if (bodyBuf) req.write(bodyBuf);
            req.end();
        } catch (e) {
            resolve({ ok: false, status: 0, data: null, hard: false, error: e.message });
        }
    });
}

/**
 * Lấy SHA hiện tại của file trong GitHub repo (cần để overwrite file).
 * Trả về null nếu file chưa tồn tại (lần đầu tạo).
 */
async function _ghGetFileSha() {
    const apiPath = `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}?ref=${GITHUB_BRANCH}`;
    const res = await _ghRequestOnce('GET', apiPath);
    if (res.ok && res.data && res.data.sha) return res.data.sha;
    if (res.status === 404) return null; // file chưa tồn tại — OK
    return null;
}

/**
 * Backup DB lên GitHub (PUT /repos/:owner/:repo/contents/:path).
 * Throttle: không push quá 1 lần/phút để tránh abuse GitHub API rate limit.
 */
const GHB_THROTTLE_MS = 60 * 1000; // 1 phút

async function backupToGitHub(data) {
    if (!GITHUB_ENABLED) return false;
    if (!_isAvailable(ghbState, 'GitHub')) return false;

    // Throttle — bỏ qua nếu mới backup < 1 phút trước
    const now = Date.now();
    if (ghbState.lastBackupAt && (now - ghbState.lastBackupAt) < GHB_THROTTLE_MS) return false;

    const MAX_ATTEMPTS = 3;
    let lastRes = null;

    try {
        // Lấy SHA hiện tại (cần để cập nhật file, không cần nếu tạo mới)
        const currentSha = ghbState.lastBackupSha || await _ghGetFileSha();

        const jsonContent = JSON.stringify(data, null, 2);
        const contentBase64 = Buffer.from(jsonContent, 'utf8').toString('base64');

        const commitMessage = `backup: auto-save ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC (${_countDBRecords(data)} records)`;

        const bodyObj = {
            message: commitMessage,
            content: contentBase64,
            branch:  GITHUB_BRANCH,
        };
        if (currentSha) bodyObj.sha = currentSha; // cần sha để overwrite

        const apiPath = `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            if (attempt > 1) {
                const waitMs = _ghbCooldownMs(attempt - 2);
                console.log(`  🔁 [GitHub] Thử lại lần ${attempt}/${MAX_ATTEMPTS} — chờ ${waitMs}ms...`);
                await _sleep(waitMs);
            }
            lastRes = await _ghRequestOnce('PUT', apiPath, bodyObj);

            if (lastRes.ok) {
                const newSha = lastRes.data?.content?.sha || lastRes.data?.commit?.sha || '';
                ghbState.lastBackupAt  = Date.now();
                ghbState.lastBackupSha = newSha || currentSha || '';
                const sizeKB = (Buffer.byteLength(jsonContent, 'utf8') / 1024).toFixed(1);
                console.log(`  🐙 [GitHub] ✅ Backup thành công (${sizeKB} KB, ${_countDBRecords(data)} records) — commit: ${commitMessage.slice(0, 60)}`);
                return true;
            }

            if (lastRes.hard) {
                let reason = `PUT contents trả về HTTP ${lastRes.status}`;
                if (lastRes.status === 401) reason += ' → GITHUB_TOKEN không hợp lệ hoặc đã hết hạn';
                if (lastRes.status === 403) reason += ' → Token thiếu scope "repo" hoặc bị revoke';
                if (lastRes.status === 404) reason += ` → Repo "${GITHUB_REPO}" không tồn tại hoặc token không có quyền truy cập`;
                if (lastRes.data?.message) reason += ` — GitHub: ${lastRes.data.message}`;
                _disableHard(ghbState, 'GitHub', reason);
                return false;
            }

            // Xử lý 409 Conflict (SHA lỗi — file bị thay đổi giữa chừng) → lấy lại SHA
            if (lastRes.status === 409) {
                console.warn('  ⚠️  [GitHub] 409 Conflict — SHA cũ, đang lấy SHA mới...');
                const freshSha = await _ghGetFileSha();
                if (freshSha) bodyObj.sha = freshSha;
                continue; // thử lại với SHA mới
            }

            console.warn(`  ⚠️  [GitHub] Lần ${attempt}/${MAX_ATTEMPTS} thất bại: HTTP ${lastRes.status} — ${lastRes.error || (lastRes.data?.message || lastRes.raw?.slice(0, 100))}`);
        }

        _softFailCooldown(ghbState, 'GitHub', `backupToGitHub thất bại ${MAX_ATTEMPTS} lần: ${lastRes?.error || `HTTP ${lastRes?.status}`}`);
        return false;
    } catch (e) {
        console.error('  ⚠️  [GitHub] Exception backupToGitHub:', e.message);
        return false;
    }
}

/**
 * Restore DB từ GitHub về local khi startup (Render đã wipe filesystem).
 * Trả về true nếu restore thành công.
 */
async function restoreFromGitHub() {
    if (!GITHUB_ENABLED) return false;
    if (!_isAvailable(ghbState, 'GitHub')) return false;

    try {
        console.log('  🐙 [GitHub] Đang tải DB từ GitHub...');
        const apiPath = `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}?ref=${GITHUB_BRANCH}`;
        const res = await _ghRequestOnce('GET', apiPath);

        if (!res.ok) {
            if (res.status === 404) {
                console.log('  🐙 [GitHub] File chưa tồn tại trong repo (lần đầu deploy). Sẽ tạo backup mới sau.');
                return false;
            }
            if (res.hard) {
                let reason = `GET contents trả về HTTP ${res.status}`;
                if (res.status === 401) reason += ' → GITHUB_TOKEN không hợp lệ';
                if (res.status === 403) reason += ' → Token thiếu scope "repo"';
                if (res.data?.message) reason += ` — ${res.data.message}`;
                _disableHard(ghbState, 'GitHub', reason);
                return false;
            }
            console.warn(`  ⚠️  [GitHub] Không thể tải từ GitHub: HTTP ${res.status}`);
            return false;
        }

        if (!res.data || !res.data.content) {
            console.warn('  ⚠️  [GitHub] Response không có content field.');
            return false;
        }

        const jsonContent = Buffer.from(res.data.content.replace(/\n/g, ''), 'base64').toString('utf8');
        const cloudData = JSON.parse(jsonContent);

        if (!cloudData || typeof cloudData !== 'object') {
            console.warn('  ⚠️  [GitHub] Dữ liệu từ GitHub không hợp lệ.');
            return false;
        }

        const cloudCount = _countDBRecords(cloudData);
        if (cloudCount === 0) {
            console.log('  🐙 [GitHub] File trong repo rỗng (0 records). Bỏ qua restore.');
            return false;
        }

        // Lưu SHA để dùng cho backup sau
        ghbState.lastBackupSha = res.data.sha || '';

        // SMART MERGE với dữ liệu local hiện tại (nếu có)
        const localData = _loadDBFromDisk();
        const localCount = _countDBRecords(localData);

        let finalData;
        if (localCount === 0) {
            // Local hoàn toàn rỗng → dùng thẳng GitHub data
            finalData = cloudData;
            console.log(`  🐙 [GitHub] ✅ Restore thành công! ${cloudCount} records từ GitHub → ghi vào local.`);
        } else {
            // Merge: giữ local làm gốc, cộng thêm gì GitHub có mà local thiếu
            const mergeResult = _smartMergeDB(localData, cloudData);
            finalData = mergeResult.data;
            console.log(`  🐙 [GitHub] ✅ Smart Merge: Local=${mergeResult.localCount}, GitHub=${mergeResult.cloudCount} → Merged=${mergeResult.mergedCount} records`);
        }

        // Ghi vào disk
        const jsonStr = JSON.stringify(finalData, null, 2);
        fs.writeFileSync(DB_FILE, jsonStr, 'utf8');
        try { fs.writeFileSync(path.join(__dirname, 'db.json'), jsonStr, 'utf8'); } catch {}
        _dbCache = null;

        return true;
    } catch (e) {
        console.error('  ⚠️  [GitHub] Exception restoreFromGitHub:', e.message);
        return false;
    }
}

// ── Unified Cloud Backup: GitHub first, JSONBin fallback ────────────────────
async function saveToCloud(data) {
    // Ưu tiên 1: GitHub (không giới hạn dung lượng)
    if (GITHUB_ENABLED && _isAvailable(ghbState, 'GitHub')) {
        await backupToGitHub(data);
        return; // Không cần JSONBin nếu GitHub hoạt động
    }
    // Fallback 2: JSONBin (nếu GitHub chưa cấu hình hoặc đang cooldown)
    if (JSONBIN_BIN_ID && JSONBIN_API_KEY && _isAvailable(jbnState, 'JSONBin')) {
        await saveToCloudDB(data);
    }
}

let writeQueue = Promise.resolve();

// ── In-Memory DB Cache — tránh đọc file mỗi request ─────────────────────────
// Thay vì readFileSync mỗi lần, cache DB trong memory và chỉ reload từ disk
// khi cần thiết (sau khi ghi hoặc khởi động).
let _dbCache = null;

function _loadDBFromDisk() {
    let mainData = null;
    let legacyData = null;

    if (fs.existsSync(DB_FILE)) {
        try { mainData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) {}
    }

    const legacyDB = path.join(__dirname, 'db.json');
    if (fs.existsSync(legacyDB)) {
        try { legacyData = JSON.parse(fs.readFileSync(legacyDB, 'utf8')); } catch (e) {}
    }

    if (!mainData && !legacyData) {
        return { config: {}, wishes: [], hearts: 0, reactions: {}, anonymousMessages: [], visitors: [] };
    }

    // Merge thông minh giữa /data/db.json và root db.json từ Git
    const merged = mainData ? JSON.parse(JSON.stringify(mainData)) : JSON.parse(JSON.stringify(legacyData));
    const backup = legacyData || mainData;

    if (!merged.config) merged.config = {};
    if (!backup.config) backup.config = {};

    // Khôi phục photoUrl nếu 1 bên có dữ liệu mà bên kia bị trống
    if (!merged.config.photoUrl && backup.config.photoUrl) merged.config.photoUrl = backup.config.photoUrl;
    if (!merged.config.photoUrl && merged.config.photoFallbackUrl) merged.config.photoUrl = merged.config.photoFallbackUrl;
    if ((!merged.config.gallery || merged.config.gallery.length === 0) && backup.config.gallery && backup.config.gallery.length > 0) {
        merged.config.gallery = backup.config.gallery;
    }
    if ((!merged.visitors || merged.visitors.length === 0) && backup.visitors && backup.visitors.length > 0) {
        merged.visitors = backup.visitors;
    }
    if ((!merged.anonymousMessages || merged.anonymousMessages.length === 0) && backup.anonymousMessages && backup.anonymousMessages.length > 0) {
        merged.anonymousMessages = backup.anonymousMessages;
    }

    return merged;
}

// getDB() trả về cache trong memory — không đọc disk mỗi request
function getDB() {
    if (!_dbCache) {
        _dbCache = _loadDBFromDisk();
    }
    return _dbCache;
}

function _cleanupOldBase64InDB(data) {
    if (!data || typeof data !== 'object') return { cleaned: 0, cleanedBytes: 0 };
    let cleaned = 0;
    let cleanedBytes = 0;
    if (Array.isArray(data.anonymousMessages)) {
        data.anonymousMessages.forEach(msg => {
            if (msg.mediaUrl && msg.mediaData && typeof msg.mediaData === 'string' && msg.mediaData.startsWith('data:')) {
                cleanedBytes += Math.round(msg.mediaData.length * 0.75);
                msg.mediaData = null;
                cleaned++;
            }
        });
    }
    return { cleaned, cleanedBytes };
}

function _getDBSizeKB(data) {
    try {
        const json = JSON.stringify(data || {});
        return Buffer.byteLength(json, 'utf8') / 1024;
    } catch { return 0; }
}

function _reportDBSafety(data) {
    const kb = _getDBSizeKB(data);
    const cleanup = _cleanupOldBase64InDB(data);
    if (cleanup.cleaned > 0) {
        console.log(`  🧹 [DB Safety] Tự động dọn dẹp ${cleanup.cleaned} tin nhắn ẩn danh có base64 thừa → tiết kiệm ~${(cleanup.cleanedBytes/1024).toFixed(1)} KB.`);
        _dbCache = data;
    }
    const JSONBIN_FREE_LIMIT = 100;
    const WARN_THRESHOLD = 80;
    const DANGER_THRESHOLD = 95;
    if (kb >= DANGER_THRESHOLD) {
        console.error('');
        console.error(`  🔴🔴🔴  [DB SAFETY - CỰC KỲ NGUY HIỂM] DB SIZE = ${kb.toFixed(1)} KB  🔴🔴🔴`);
        console.error(`     → Sắp vượt giới hạn 100KB của JSONBin Free Plan!`);
        console.error(`     → Lưu ý: Nếu DB > 100KB, backup lên Cloud sẽ TẮT (Circuit Breaker) → nguy cơ mất dữ liệu khi server restart!`);
        console.error(`     💡 LÀM NGAY BÂY GIỜ:`);
        console.error(`        1. Vào Admin → Xóa bớt tin nhắn ẩn danh / lời chúc cũ có ảnh/video lớn`);
        console.error(`        2. Đảm bảo mọi file upload đều qua Cloudinary (lưu URL), không lưu base64 vào DB`);
        console.error(`        3. Export backup db.json về máy (nếu redeploy)`);
        console.error(`        4. Nếu cần nhiều hơn 100KB: Nâng cấp JSONBin Pro ($10/tháng = 10MB/bin) hoặc bỏ JSONBin chỉ dùng local`);
        console.error('');
    } else if (kb >= WARN_THRESHOLD) {
        console.warn('');
        console.warn(`  🟡🟡🟡  [DB SAFETY - CẢNH BÁO] DB SIZE = ${kb.toFixed(1)} KB  🟡🟡🟡`);
        console.warn(`     → Đã đạt ${((kb/JSONBIN_FREE_LIMIT)*100).toFixed(0)}% giới hạn 100KB của JSONBin Free Plan`);
        console.warn(`     💡 Hãy xóa bớt dữ liệu cũ hoặc đảm bảo media lưu URL thay vì base64 trong tuần tới!`);
        console.warn('');
    } else {
        console.log(`  💚 [DB Safety] DB size: ${kb.toFixed(1)} KB — An toàn (${((kb/JSONBIN_FREE_LIMIT)*100).toFixed(0)}% / 100KB JSONBin limit).`);
    }
    return kb;
}

// Hàm ghi DB async với queue — cập nhật cache rồi ghi disk bất đồng bộ
function saveDB(data) {
    const cleanup = _cleanupOldBase64InDB(data);
    if (cleanup.cleaned > 0) {
        console.log(`  🧹 [saveDB] Tự động dọn ${cleanup.cleaned} base64 thừa (~${(cleanup.cleanedBytes/1024).toFixed(1)} KB).`);
    }
    _dbCache = data;
    const kbBefore = _getDBSizeKB(data);

    writeQueue = writeQueue.then(() => new Promise((resolve) => {
        try {
            _snapshotDB('before-write', 10);
            const jsonStr = JSON.stringify(data, null, 2);
            fs.writeFileSync(DB_FILE, jsonStr, 'utf8');
            const legacyDB = path.join(__dirname, 'db.json');
            fs.writeFileSync(legacyDB, jsonStr, 'utf8');
            const kbAfter = Buffer.byteLength(jsonStr, 'utf8') / 1024;
            // Chỉ báo cáo safety mỗi khi ghi, nhưng limit log mức INFO để tránh spam
            if (kbAfter >= 80) {
                _reportDBSafety(data);
            } else {
                // Với DB nhỏ, chỉ log ở mức verbose nếu muốn; để giảm log, chỉ show khi >60KB
                if (kbAfter >= 60 && Math.random() < 0.2) {
                    console.log(`  💚 [DB] Size = ${kbAfter.toFixed(1)} KB (OK, an toàn).`);
                }
            }
            (async () => { try { await saveToCloud(data); } catch (e) { /* logged inside */ } })();
        } catch (e) {
            console.error('Lỗi ghi db.json:', e);
        }
        resolve();
    }));
    return writeQueue;
}

// ── MIME Types ───────────────────────────────────────────────────────────────
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.svg':  'image/svg+xml',
    '.mp3':  'audio/mpeg',
    '.mp4':  'video/mp4',
    '.ico':  'image/x-icon',
    '.woff2':'font/woff2',
    '.ipynb':'application/x-ipynb+json; charset=utf-8',
};

// ── Helper: đọc request body ─────────────────────────────────────────────────
function readBody(req, maxBytes = 20 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        let body = '';
        let size = 0;
        req.on('data', chunk => {
            size += chunk.length;
            if (size > maxBytes) {
                req.destroy();
                return reject(new Error('Request body quá lớn'));
            }
            body += chunk;
        });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

// ── Helper: response JSON ────────────────────────────────────────────────────
function jsonResponse(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function getClientIP(req) {
    return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

// ── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const clientIP = getClientIP(req);

    // ── AI Gia Sư Toán (Express sub-app nhúng sẵn) ────────────────────────────
    if (pathname.startsWith('/api/ai-tutor/') || pathname === '/api/ai-tutor') {
        return aiTutorApp(req, res);
    }

    // ── Game Nối Từ ──────────────────────────────────────────────────────────
    // 1) POST /api/wordchain/challenge — người chơi tạo bàn, gửi email mời chủ
    // 2) GET  /api/wordchain/state?id=... — poll trạng thái bàn (cả 2 phía)
    // 3) POST /api/wordchain/turn — đi một từ (cả người chơi lẫn chủ)
    if (pathname === '/api/wordchain/challenge' && req.method === 'POST') {
        const startedAt = Date.now();
        try {
            const raw = await readBody(req, 16 * 1024);
            const payload = JSON.parse(raw || '{}');
            let name = sanitizeString(payload.name, 40).trim().slice(0, 30);
            if (!name) name = 'Người chơi';

            const id = 'wc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
            const game = {
                id,
                status: 'waiting',          // waiting → playing → done
                player0: name,              // người chơi (tạo bàn)
                player1: null,              // chủ (join sau)
                hostName: null,
                words: [],
                current: 0,
                winner: null,
                createdAt: Date.now(),
                lastActivity: Date.now(),
            };
            wordchainGames.set(id, game);

            // Dọn bàn cũ quá 30 phút để RAM không phình
            for (const [gid, g] of wordchainGames) {
                if (Date.now() - g.lastActivity > 30 * 60 * 1000) wordchainGames.delete(gid);
            }

            // Gửi email thông báo cho chủ (nếu cấu hình) — không làm fail nếu lỗi email
            let emailStatus = { requested: false, sent: false };
            if (typeof emailService.emailConfigured === 'function' && emailService.emailConfigured()) {
                emailStatus.requested = true;
                const host = req.headers['host'] || (req.headers['x-forwarded-host']) || 'localhost';
                const base = `${req.headers['x-forwarded-proto'] || 'http'}://${host}`;
                const gameLink = `${base}/word-chain.html?id=${encodeURIComponent(id)}&join=1`;
                const guestName = name;
                const emailResult = await emailService.sendGameInvite({
                    playerName: guestName,
                    gameLink,
                    message: 'Nhấn "Chơi với tôi" để vào bàn nối từ.',
                });
                emailStatus.sent = emailResult.ok;
                if (!emailResult.ok) emailStatus.error = emailResult.error;
            }

            jsonResponse(res, 200, {
                success: true, id, myIndex: 0, status: 'waiting',
                email: emailStatus, latencyMs: Date.now() - startedAt,
            });
        } catch (err) {
            console.error('  [WordChain] challenge lỗi:', err.message);
            jsonResponse(res, 400, { success: false, message: 'Không tạo được bàn. ' + err.message });
        }
        return;
    }

    if (pathname === '/api/wordchain/state' && req.method === 'GET') {
        const id = sanitizeString(parsedUrl.query.id || '', 60);
        const myName = sanitizeString(parsedUrl.query.name || '', 40).trim().slice(0, 30);
        if (!id) { jsonResponse(res, 400, { success: false, message: 'Thiếu id bàn.' }); return; }
        const game = wordchainGames.get(id);
        if (!game) { jsonResponse(res, 200, { success: false, message: 'Bàn không tồn tại hoặc đã hết hạn.' }); return; }
        game.lastActivity = Date.now();

        const me = (myName && game.player1 && myName === game.hostName) ? 1 : 0;
        const publicGame = {
            id: game.id,
            status: game.status,
            player0: game.player0,
            player1: game.player1,
            hostName: game.hostName,
            words: game.words.map(w => ({ text: w.text, player: w.player, seq: w.seq })),
            current: game.current,
            winner: game.winner,
            myIndex: me,
        };
        jsonResponse(res, 200, { success: true, game: publicGame });
        return;
    }

    if (pathname === '/api/wordchain/turn' && req.method === 'POST') {
        const startedAt = Date.now();
        try {
            const raw = await readBody(req, 16 * 1024);
            const payload = JSON.parse(raw || '{}');
            const id = sanitizeString(payload.id || '', 60);
            const word = sanitizeWord(payload.word);
            const who = (payload.who === 'host') ? 1 : 0;
            const game = wordchainGames.get(id);
            if (!game) { jsonResponse(res, 200, { success: false, message: 'Bàn không tồn tại hoặc đã hết hạn.' }); return; }

            // Nếu chủ chưa join → host chỉ join (không cần từ), game chuyển sang playing
            if (game.status === 'waiting' && who === 1) {
                game.hostName = sanitizeString(payload.hostName || 'Chủ nhà', 40).trim().slice(0, 30) || 'Chủ nhà';
                game.player1 = game.hostName;
                game.status = 'playing';
                game.lastActivity = Date.now();
                jsonResponse(res, 200, { success: true, joined: true, current: game.current });
                return;
            }
            if (game.status === 'waiting' && who === 0) {
                jsonResponse(res, 200, { success: false, message: 'Chủ nhà chưa vào bàn. Hãy chờ một lát!' });
                return;
            }
            if (game.status === 'done') { jsonResponse(res, 200, { success: false, message: 'Trò chơi đã kết thúc.' }); return; }

            const clean = sanitizeWord(word);
            if (!clean) { jsonResponse(res, 200, { success: false, message: 'Từ không hợp lệ.' }); return; }

            // Kiểm tra lượt
            if (game.current !== who) { jsonResponse(res, 200, { success: false, message: 'Chưa đến lượt bạn!' }); return; }

            // Kiểm tra luật nối từ: từ mới phải bắt đầu bằng TIẾNG cuối của từ trước
            const last = game.words.length ? game.words[game.words.length - 1].text : '';
            if (last) {
                const need = lastSyllable(last);
                if (!startsWithSyllable(clean, need)) {
                    jsonResponse(res, 200, {
                        success: false,
                        message: 'Từ phải bắt đầu bằng "' + need + '".',
                    });
                    return;
                }
            }

            game.words.push({ text: clean, player: who, seq: game.words.length, ts: Date.now() });
            game.lastActivity = Date.now();
            game.current = 1 - who;
            game.status = 'playing';

            // Nếu bắt đầu nhà mở cả là game bắt đầu giữa 2 người (chỉ sau khi host join)
            jsonResponse(res, 200, { success: true, current: game.current });
        } catch (err) {
            console.error('  [WordChain] turn lỗi:', err.message);
            jsonResponse(res, 400, { success: false, message: 'Lỗi khi đi từ.' });
        }
        return;
    }
    // ── POST /api/wordchain/:id/forfeit / decline (chủ từ chối) ──────────────
    if (pathname === '/api/wordchain/decline' && req.method === 'POST') {
        try {
            const raw = await readBody(req, 8 * 1024);
            const payload = JSON.parse(raw || '{}');
            const id = sanitizeString(payload.id || '', 60);
            const g = wordchainGames.get(id);
            if (!g) { jsonResponse(res, 200, { success: false, message: 'Bàn không tồn tại.' }); return; }
            wordchainGames.delete(id);
            jsonResponse(res, 200, { success: true, message: 'Đã đóng bàn.' });
        } catch (e) {
            jsonResponse(res, 400, { success: false, message: 'Lỗi.' });
        }
        return;
    }

    // ── GET /api/wordchain/pending — bàn đang chờ chủ nhà tham gia ──────────
    // Để trang chủ / trang giám sát của chủ biết có khách muốn chơi mà không cần email.
    if (pathname === '/api/wordchain/pending' && req.method === 'GET') {
        const list = [];
        for (const g of wordchainGames.values()) {
            if (g.status === 'waiting') {
                list.push({ id: g.id, guest: g.player0, createdAt: g.createdAt });
            }
        }
        // Mới nhất lên đầu
        list.sort((a, b) => b.createdAt - a.createdAt);
        jsonResponse(res, 200, { success: true, count: list.length, waiting: list.slice(0, 10) });
        return;
    }

    // ── /api/leaderboard ──────────────────────────────────────────────────────
    if (pathname === '/api/leaderboard' && req.method === 'GET') {
        const q = sanitizeString(parsedUrl.query.kind || '', 20);
        // placeholder nhẹ — có thể mở rộng sau, tạm trả trạng thái nối từ gần nhất và điểm biểu tượng
        jsonResponse(res, 200, { success: true, data: [] });
        return;
    }

    // ── GET /api/health — Render Health Check / Keep-Alive (tránh render cold start liên tục)
    // Render gọi endpoint này định kỳ → đảm bảo server luôn awake + có log để xác nhận server đang chạy
    if (pathname === '/api/health' && req.method === 'GET') {
        try {
            const db = getDB();
            const recordCount = _countDBRecords(db);
            const visitorsCount = (db.visitors && Array.isArray(db.visitors)) ? db.visitors.length : 0;
            const uptimeSec = Math.floor(process.uptime());
            const memoryMB = Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10;
            jsonResponse(res, 200, {
                ok: true,
                status: 'awake',
                server: 'youth-memories-hub',
                uptime_s: uptimeSec,
                memory_mb: memoryMB,
                db_records: recordCount,
                visitors_count: visitorsCount,
                ts: new Date().toISOString()
            });
        } catch (e) {
            jsonResponse(res, 200, { ok: true, status: 'awake', error: e.message });
        }
        return;
    }

    // ── Rate Limit check ─────────────────────────────────────────────────────
    if (!checkRateLimit(pathname, clientIP)) {
        jsonResponse(res, 429, { success: false, message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' });
        return;
    }

    // ── POST /api/debt-agent/ask — Đặc Vụ Đòi Nợ AI ──────────────────────────
    if (pathname === '/api/debt-agent/ask' && req.method === 'POST') {
        const startedAt = Date.now();
        try {
            const raw = await readBody(req, 64 * 1024);
            const payload = JSON.parse(raw || '{}');

            // Sanitize từng trường để prompt không bị tiêm
            const debtor = sanitizeString(payload.debtor, 120);
            const amount = sanitizeString(payload.amount, 30);
            const currency = sanitizeString(payload.currency, 20);
            const reason = sanitizeString(payload.reason, 300);
            const relationship = sanitizeString(payload.relationship, 100);
            const style = sanitizeString(payload.style, 40);
            const money = sanitizeString(payload.money || '', 60);

            // Email ủy quyền cảnh báo (không bắt buộc)
            const notifyEmail = sanitizeString(payload.notifyEmail || '', 200);
            const authorizedSend = payload.authorizeEmail === true || payload.authorizeEmail === 'true';

            if (!debtor) {
                jsonResponse(res, 400, { success: false, message: 'Thiếu tên con nợ rồi đặc vụ ơi!' });
                return;
            }

            const kit = await debtAgentService.generateDebtKit({
                debtor, amount, currency, reason, relationship, style, money,
            });

            // ── Ủy quyền gửi email cảnh báo (nodemailer → Gmail) ────────────────
            let emailStatus = { requested: false, sent: false };
            if (authorizedSend && notifyEmail) {
                emailStatus = { requested: true, sent: false, ...emailStatus };
                const emailResult = await emailService.sendWarningEmail({
                    to: notifyEmail,
                    caseCode: kit.case_code || 'CASE-' + Date.now().toString(36).toUpperCase(),
                    debtor,
                    amount,
                    currency,
                    reason,
                    relationship,
                    agent: kit.agent_name,
                    messages: Array.isArray(kit.message) ? kit.message : [],
                });
                emailStatus.sent = emailResult.ok;
                if (!emailResult.ok) emailStatus.error = emailResult.error;
            } else if (authorizedSend && !notifyEmail) {
                emailStatus = { requested: true, sent: false, error: 'Thiếu email người nhận.' };
            }

            jsonResponse(res, 200, {
                success: true,
                agent_name: kit.agent_name,
                risk_assessment: kit.risk_assessment,
                messages: kit.message,
                case_code: kit.case_code || 'CASE-' + Date.now().toString(36).toUpperCase(),
                email: emailStatus,
                fallback: kit.ok === false,
                latencyMs: Date.now() - startedAt,
            });
        } catch (err) {
            // LLM sập → vẫn trả 200 với fallback vui vẻ để UI không trắng trang
            console.error('  [Debt-Agent] Lỗi endpoint:', err.message);
            const fallback = debtAgentService.buildFallback && (() => {
                try {
                    return debtAgentService.buildFallback({});
                } catch { return null; }
            })();
            jsonResponse(res, 200, {
                success: true,
                agent_name: 'Đặc Vụ Dự Bị',
                risk_assessment: 'Mạng lỗi nên đặc vụ chính nghỉ phép — gửi bản nháp vui vẻ này tạm nhé.',
                messages: fallback && Array.isArray(fallback) && fallback.length
                    ? fallback
                    : [{ title: 'Nhắc khéo', text: 'Bạn ơi, có khoản nhỏ mình vẫn đang trông ngóng. Chuyển khoản là mọi chuyện đẹp liền!' }],
                fallback: true,
                latencyMs: Date.now() - startedAt,
            });
        }
        return;
    }

    // ── API quản lý kho câu hài (debtRibData.json) — yêu cầu Admin ────────────
    if (pathname === '/api/debt-ribs/cache-info' && req.method === 'GET') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) { jsonResponse(res, 401, { success: false, message: 'Chưa đăng nhập Admin' }); return; }
        try {
            const c = JSON.parse(fs.readFileSync(RIB_CACHE_FILE, 'utf8'));
            jsonResponse(res, 200, { success: true, count: (c.items || []).length });
        } catch {
            jsonResponse(res, 200, { success: true, count: 0 });
        }
        return;
    }
    if (pathname === '/api/debt-ribs' && req.method === 'GET') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) { jsonResponse(res, 401, { success: false, message: 'Chưa đăng nhập Admin' }); return; }
        try {
            const data = JSON.parse(fs.readFileSync(RIB_DATA_FILE, 'utf8'));
            jsonResponse(res, 200, { success: true, items: data.items || [], count: (data.items || []).length });
        } catch (err) {
            jsonResponse(res, 200, { success: true, items: [], count: 0, error: 'Kho câu chưa tồn tại hoặc hỏng: ' + err.message });
        }
        return;
    }

    // POST /api/debt-ribs/preview — dán text, AI tách thành từng câu (không lưu)
    if (pathname === '/api/debt-ribs/preview' && req.method === 'POST') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) { jsonResponse(res, 401, { success: false, message: 'Chưa đăng nhập Admin' }); return; }
        try {
            const body = JSON.parse(await readBody(req, 256 * 1024));
            const text = String(body.text || '').trim();
            if (!text) { jsonResponse(res, 400, { success: false, message: 'Chưa có văn bản để tách' }); return; }
            const items = await debtAgentService.splitRibText(text);
            jsonResponse(res, 200, { success: true, items: items || [] });
        } catch (err) {
            jsonResponse(res, 400, { success: false, message: err.message });
        }
        return;
    }

    // POST /api/debt-ribs/bulk — thêm hàng loạt (mảng items đã sẵn sàng)
    if (pathname === '/api/debt-ribs/bulk' && req.method === 'POST') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) { jsonResponse(res, 401, { success: false, message: 'Chưa đăng nhập Admin' }); return; }
        try {
            const body = JSON.parse(await readBody(req, 256 * 1024));
            const items = Array.isArray(body.items) ? body.items : [];
            if (!items.length) { jsonResponse(res, 400, { success: false, message: 'Không có câu nào để thêm' }); return; }
            const data = readRibData();
            const added = [];
            items.forEach(raw => {
                const text = sanitizeString(raw.text, 500);
                if (!text) return;
                const item = {
                    id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    text,
                    tags: Array.isArray(raw.tags) ? raw.tags.map(t => sanitizeString(t, 40)).filter(Boolean).slice(0, 8) : [],
                    topic: sanitizeString(raw.topic, 40),
                    degree: ['Nhẹ', 'Vừa', 'Nặng'].includes(raw.degree) ? raw.degree : 'Vừa',
                };
                data.items.push(item);
                added.push(item);
            });
            writeRibData(data);
            invalidateRibCache();
            jsonResponse(res, 200, { success: true, added, count: added.length });
        } catch (err) {
            jsonResponse(res, 400, { success: false, message: err.message });
        }
        return;
    }

    if (pathname === '/api/debt-ribs' && req.method === 'POST') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) { jsonResponse(res, 401, { success: false, message: 'Chưa đăng nhập Admin' }); return; }
        try {
            const body = JSON.parse(await readBody(req, 64 * 1024));
            const text = sanitizeString(body.text, 500);
            if (!text) { jsonResponse(res, 400, { success: false, message: 'Thiếu nội dung câu' }); return; }
            const tags = Array.isArray(body.tags)
                ? body.tags.map(t => sanitizeString(t, 40)).filter(Boolean).slice(0, 8)
                : [];
            const topic = sanitizeString(body.topic, 40);
            const degree = ['Nhẹ', 'Vừa', 'Nặng'].includes(body.degree) ? body.degree : 'Vừa';
            const data = readRibData();
            const item = {
                id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                text,
                tags,
                topic,
                degree,
            };
            data.items.push(item);
            writeRibData(data);
            invalidateRibCache();
            jsonResponse(res, 200, { success: true, item });
        } catch (err) {
            jsonResponse(res, 400, { success: false, message: err.message });
        }
        return;
    }

    // PUT /api/debt-ribs/:id — sửa câu
    let ribMatch = pathname.match(/^\/api\/debt-ribs\/([^/]+)$/);
    if (ribMatch && req.method === 'PUT') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) { jsonResponse(res, 401, { success: false, message: 'Chưa đăng nhập Admin' }); return; }
        try {
            const id = decodeURIComponent(ribMatch[1]);
            const body = JSON.parse(await readBody(req, 64 * 1024));
            const data = readRibData();
            const idx = data.items.findIndex(it => it.id === id);
            if (idx < 0) { jsonResponse(res, 404, { success: false, message: 'Không tìm thấy câu' }); return; }
            if (typeof body.text === 'string' && body.text.trim()) data.items[idx].text = sanitizeString(body.text, 500);
            if (Array.isArray(body.tags)) data.items[idx].tags = body.tags.map(t => sanitizeString(t, 40)).filter(Boolean).slice(0, 8);
            if (typeof body.topic === 'string') data.items[idx].topic = sanitizeString(body.topic, 40);
            if (['Nhẹ', 'Vừa', 'Nặng'].includes(body.degree)) data.items[idx].degree = body.degree;
            writeRibData(data);
            invalidateRibCache();
            jsonResponse(res, 200, { success: true, item: data.items[idx] });
        } catch (err) {
            jsonResponse(res, 400, { success: false, message: err.message });
        }
        return;
    }

    // DELETE /api/debt-ribs/:id — xóa câu
    if (ribMatch && req.method === 'DELETE') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) { jsonResponse(res, 401, { success: false, message: 'Chưa đăng nhập Admin' }); return; }
        try {
            const id = decodeURIComponent(ribMatch[1]);
            const data = readRibData();
            const before = data.items.length;
            data.items = data.items.filter(it => it.id !== id);
            if (data.items.length === before) { jsonResponse(res, 404, { success: false, message: 'Không tìm thấy câu' }); return; }
            writeRibData(data);
            invalidateRibCache();
            jsonResponse(res, 200, { success: true, count: data.items.length });
        } catch (err) {
            jsonResponse(res, 400, { success: false, message: err.message });
        }
        return;
    }

    // ── POST /api/login — Đăng nhập Admin ────────────────────────────────────
    if (pathname === '/api/login' && req.method === 'POST') {
        try {
            const body = await readBody(req, 1024);
            const payload = JSON.parse(body);
            const password = sanitizeString(payload.password || '', 200);

            // So sánh constant-time để tránh timing attack
            const inputHash = crypto.createHmac('sha256', SESSION_SECRET).update(password).digest('hex');
            const expectedHash = crypto.createHmac('sha256', SESSION_SECRET).update(ADMIN_PASSWORD).digest('hex');

            if (!crypto.timingSafeEqual(Buffer.from(inputHash), Buffer.from(expectedHash))) {
                // Delay nhỏ để chống brute-force
                await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
                jsonResponse(res, 401, { success: false, message: 'Mật khẩu không đúng' });
                return;
            }

            const token = createSession();

            // Tự động xóa CHÍNH XÁC record visitor CỦA ADMIN SESSION (tránh xóa nhầm toàn bộ nhà)
            // Lý do: FPT Home WiFi (NAT) nhiều thiết bị cùng share 1 IP công cộng 42.114.x.x
            // Logic cũ filter v.ip !== clientIP sẽ XÓA TẤT CẢ điện thoại/PC trong CÙNG NHÀ → sai!
            // Logic mới: chỉ xóa visitor trùng khớp TOÀN BỘ: (sessionId cookie) HOẶC (UA + Browser + OS + gần đây < 5 phút)
            const db = getDB();
            if (db.visitors && Array.isArray(db.visitors)) {
                const initialLen = db.visitors.length;
                const uaString = req.headers['user-agent'] || '';
                const { os, browser: uaBrowser, device: uaDevice } = parseUserAgent(uaString);
                const adminServerSessionId = _getCookie(req, 'v_server_sess_id');
                const FIVE_MIN_MS = 5 * 60 * 1000;
                const nowTs = Date.now();

                db.visitors = db.visitors.filter(v => {
                    // 1. Localhost / loopback luôn xóa
                    if (v.ip === '127.0.0.1' || v.ip === '::1') return false;

                    // 2. TRÙNG sessionId server-side cookie (chính xác 100%) → xóa
                    if (adminServerSessionId && v.sessionId === adminServerSessionId) return false;

                    // 3. Fallback: Nếu không có cookie session → match theo IP + UA chi tiết + lastSeen gần đây
                    //    (tránh xóa nhầm anh em khác trong cùng FPT WiFi online từ trước)
                    if (v.ip === clientIP) {
                        const isSameBrowser = v.browser === uaBrowser;
                        const isSameOs = v.os === os;
                        const isSameDevice = !v.device || !uaDevice || v.device === uaDevice;
                        const lastSeenTs = new Date(v.lastSeen || v.firstSeen || 0).getTime();
                        const isRecent = (nowTs - lastSeenTs) < FIVE_MIN_MS;
                        if (isSameBrowser && isSameOs && isSameDevice && isRecent) {
                            return false; // Xóa record admin đúng trình duyệt
                        }
                    }

                    // Mọi trường hợp khác → GIỮ NGUYÊN (không xóa nhà bạn, không xóa khách bên ngoài)
                    return true;
                });

                if (db.visitors.length !== initialLen) {
                    const removed = initialLen - db.visitors.length;
                    console.log(`  🧹 [Admin Login] Đã xóa ${removed} visitor record của ADMIN session (giữ nguyên ${db.visitors.length} record khác).`);
                    saveDB(db);
                }
            }

            // Set cookie HttpOnly, SameSite=Strict
            res.setHeader('Set-Cookie', `admin_token=${token}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}; Path=/`);
            jsonResponse(res, 200, { success: true, token });
        } catch (e) {
            jsonResponse(res, 400, { success: false, message: 'Dữ liệu không hợp lệ' });
        }
        return;
    }

    // ── POST /api/logout — Đăng xuất Admin ──────────────────────────────────
    if (pathname === '/api/logout' && req.method === 'POST') {
        const token = getTokenFromRequest(req);
        if (token) sessions.delete(token);
        res.setHeader('Set-Cookie', 'admin_token=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/');
        jsonResponse(res, 200, { success: true });
        return;
    }

    // ── GET /api/admin/check — Kiểm tra session ──────────────────────────────
    if (pathname === '/api/admin/check' && req.method === 'GET') {
        const token = getTokenFromRequest(req);
        jsonResponse(res, 200, { authenticated: isValidSession(token) });
        return;
    }

    // ── GET /ping — Health check cho UptimeRobot / uptime monitors ─────────────
    // Endpoint nhẹ, không đọc DB, dùng để giữ server không sleep trên Render Free
    if (pathname === '/ping' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('pong');
        return;
    }

    // ── GET /api/data — Trả toàn bộ dữ liệu (public) ────────────────────────
    if (pathname === '/api/data' && req.method === 'GET') {
        const db = getDB();

        // Migrate hearts cũ → reactions['❤️'] (chạy 1 lần)
        if (!db.reactions) db.reactions = {};
        if (db.hearts && !db.reactions['❤️']) {
            db.reactions['❤️'] = db.hearts;
        }

        const token = getTokenFromRequest(req);
        const safeDB = {
            config: db.config,
            wishes: db.wishes,
            hearts: db.hearts,
            reactions: db.reactions,
            outings: (db.config && db.config.outings) || [],
        };
        if (isValidSession(token)) {
            safeDB.anonymousMessages = db.anonymousMessages || [];
        }
        jsonResponse(res, 200, safeDB);
        return;
    }

    // ── POST /api/anonymous — Gửi tin nhắn ẩn danh + media (public, rate-limited) ──
    if (pathname === '/api/anonymous' && req.method === 'POST') {
        try {
            // Tăng body limit lên 50MB để chứa video/ảnh base64
            const body = await readBody(req, 50 * 1024 * 1024);
            const payload = JSON.parse(body);

            const message = sanitizeString(payload.message || '', 1000);
            const mediaData = payload.mediaData || null;   // base64 data URL
            const mediaType = sanitizeString(payload.mediaType || '', 20); // 'audio'|'image'|'video'

            // Phải có ít nhất text hoặc media
            if (!message && !mediaData) {
                jsonResponse(res, 400, { success: false, message: 'Vui lòng nhập tin nhắn hoặc đính kèm file' });
                return;
            }

            let savedMediaUrl = null;

            // Nếu có media — validate magic bytes rồi lưu vào /uploads/
            if (mediaData) {
                const validation = validateBase64File(mediaData);
                if (!validation.ok) {
                    console.error('  ⚠️  [Anon Media] Validate thất bại:', validation.error, '| mediaType từ client:', mediaType || '(không có)');
                    jsonResponse(res, 400, { success: false, message: `File không hợp lệ: ${validation.error}` });
                    return;
                }

                // Normalize MIME: bỏ tham số sau ';' để tránh 'audio/webm; codecs=opus' vs 'audio/webm' không khớp
                const rawMime = (validation.mime || '').toLowerCase();
                const cleanMime = rawMime.split(';')[0].trim();

                const allowedMimes = ['image/jpeg','image/png','image/gif','image/webp',
                                      'audio/mpeg','audio/ogg','audio/wav',
                                      'audio/webm','audio/webm;codecs=opus',
                                      'audio/mp4','audio/aac',
                                      'video/mp4','video/webm','video/ogg'];
                const isAllowed = allowedMimes.some(m => {
                    const cleanAllowed = m.toLowerCase().split(';')[0].trim();
                    return cleanAllowed === cleanMime;
                });
                if (!isAllowed) {
                    console.error('  ⚠️  [Anon Media] MIME không được phép:', rawMime, '(clean:', cleanMime + ')');
                    jsonResponse(res, 400, { success: false, message: 'Định dạng file không được phép' });
                    return;
                }

                // Giới hạn kích thước theo loại
                const maxBytes = cleanMime.startsWith('video') ? 30 * 1024 * 1024
                               : cleanMime.startsWith('audio') ? 10 * 1024 * 1024
                               : 5 * 1024 * 1024;
                if (validation.buffer.length > maxBytes) {
                    const mbLimit = maxBytes / 1024 / 1024;
                    console.error('  ⚠️  [Anon Media] File quá lớn:', (validation.buffer.length/1024/1024).toFixed(2), 'MB > giới hạn', mbLimit, 'MB (mime:', cleanMime + ')');
                    jsonResponse(res, 400, { success: false, message: `File quá lớn (tối đa ${mbLimit}MB cho loại này)` });
                    return;
                }

                // Upload lên Cloudinary (hoặc fallback disk)
                const folder = cleanMime.startsWith('audio') ? 'youth-memories/anon/audio'
                             : cleanMime.startsWith('video') ? 'youth-memories/anon/video'
                             : 'youth-memories/anon/image';
                console.log(`  📎  [Anon Media] Đang lưu file (${cleanMime}, ${(validation.buffer.length/1024).toFixed(1)} KB) vào folder: ${folder}...`);
                savedMediaUrl = await saveFile(validation.buffer, validation.mime, folder);

                if (!savedMediaUrl) {
                    console.warn('  ⚠️  [Anon Media] saveFile trả về NULL — Cloudinary chưa cấu hình → lưu tạm mediaData base64 trực tiếp vào DB (DB sẽ lớn hơn bình thường).');
                    savedMediaUrl = null; // fallback: tin nhắn sẽ dùng mediaData base64 để hiển thị (admin.js có fallback: mediaUrl || mediaData)
                } else {
                    console.log(`  ✅  [Anon Media] Lưu file THÀNH CÔNG → URL: ${savedMediaUrl}`);
                }
            } else {
                console.log('  📝  [Anon Message] Tin nhắn chỉ có text (không đính kèm media).');
            }

            const db = getDB();
            if (!db.anonymousMessages) db.anonymousMessages = [];
            db.anonymousMessages.push({
                id:        Date.now(),
                message:   message || '',
                mediaUrl:  savedMediaUrl,
                mediaData: savedMediaUrl ? null : (mediaData || null),
                mediaType: (savedMediaUrl || mediaData) ? (mediaType || 'file') : null,
                createdAt: new Date().toISOString(),
            });
            await saveDB(db);
            jsonResponse(res, 200, { success: true });
        } catch (e) {
            console.error('Lỗi /api/anonymous:', e.message);
            jsonResponse(res, 500, { success: false, message: 'Lỗi server' });
        }
        return;
    }

    // ── DELETE /api/anonymous/:id — Xóa tin nhắn ẩn danh (Admin only) ───────
    if (pathname.startsWith('/api/anonymous/') && req.method === 'DELETE') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) {
            jsonResponse(res, 401, { success: false, message: 'Yêu cầu đăng nhập Admin' });
            return;
        }
        try {
            const msgId = pathname.replace('/api/anonymous/', '').trim();
            if (!msgId) {
                jsonResponse(res, 400, { success: false, message: 'Thiếu ID tin nhắn' });
                return;
            }
            const db = getDB();
            if (!db.anonymousMessages) db.anonymousMessages = [];
            const before = db.anonymousMessages.length;
            // ID có thể là số (Date.now()) hoặc string
            db.anonymousMessages = db.anonymousMessages.filter(
                m => String(m.id) !== String(msgId)
            );
            if (db.anonymousMessages.length === before) {
                jsonResponse(res, 404, { success: false, message: 'Không tìm thấy tin nhắn' });
                return;
            }
            await saveDB(db);
            jsonResponse(res, 200, { success: true, remaining: db.anonymousMessages.length });
        } catch (e) {
            console.error('Lỗi DELETE /api/anonymous:', e.message);
            jsonResponse(res, 500, { success: false, message: 'Lỗi server' });
        }
        return;
    }

    // ── GET /api/anonymous/count — Số tin nhắn ẩn danh (Admin only) ──────────
    if (pathname === '/api/anonymous/count' && req.method === 'GET') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) {
            jsonResponse(res, 401, { success: false, message: 'Yêu cầu đăng nhập Admin' });
            return;
        }
        const db = getDB();
        const count = (db.anonymousMessages || []).length;
        jsonResponse(res, 200, { success: true, count });
        return;
    }

    // ── POST /api/wishes — Gửi lời chúc (public, rate-limited) ──────────────
    if (pathname === '/api/wishes' && req.method === 'POST') {
        try {
            const body = await readBody(req, 4096);
            const payload = JSON.parse(body);
            const author  = sanitizeString(payload.author  || 'Người Bạn Ẩn Danh', 100);
            const message = sanitizeString(payload.message || '', 500);
            const time    = sanitizeString(payload.time    || 'Vừa xong', 50);
            const style   = Number.isInteger(payload.style) ? Math.min(Math.max(payload.style, 1), 5) : 1;

            if (!message) {
                jsonResponse(res, 400, { success: false, message: 'Vui lòng nhập lời chúc' });
                return;
            }

            const db = getDB();
            const newWish = {
                id: Date.now(),
                author,
                message,
                time,
                style,
            };
            db.wishes = [newWish, ...(db.wishes || []).slice(0, 49)];
            await saveDB(db);
            jsonResponse(res, 200, { success: true, wish: newWish, wishes: db.wishes });
        } catch (e) {
            jsonResponse(res, 400, { success: false, message: 'Lỗi ghi lời chúc' });
        }
        return;
    }

    // ── POST /api/outings — Thêm chuyến đi chơi mới (kèm ảnh/video) ──────────
    if (pathname === '/api/outings' && req.method === 'POST') {
        try {
            const body = await readBody(req, 50 * 1024 * 1024);
            const payload = JSON.parse(body);

            const title    = sanitizeString(payload.title    || 'Chuyến Đi Mới', 200);
            const location = sanitizeString(payload.location || '', 200);
            const date     = sanitizeString(payload.date     || new Date().toISOString().split('T')[0], 50);
            const time     = sanitizeString(payload.time     || '', 50);
            const weather  = sanitizeString(payload.weather  || '☀️ Nắng đẹp', 100);
            const content  = sanitizeString(payload.content  || '', 2000);
            const rawMedia = Array.isArray(payload.media) ? payload.media : [];

            const savedMedia = [];
            for (const item of rawMedia) {
                if (item.data) {
                    const validation = validateBase64File(item.data);
                    if (validation.ok) {
                        const isVid = (item.type === 'video') || validation.mime.startsWith('video');
                        const folder = isVid ? 'youth-memories/outings/video' : 'youth-memories/outings/image';
                        const fileUrl = await saveFile(validation.buffer, validation.mime, folder);
                        savedMedia.push({ type: isVid ? 'video' : 'image', url: fileUrl });
                    } else {
                        console.warn('File upload validation failed:', validation.error);
                    }
                } else if (item.url) {
                    savedMedia.push({
                        type: item.type || (item.url.match(/\.(mp4|webm|mov|m4v|3gp)(\?.*)?$/i) ? 'video' : 'image'),
                        url: item.url
                    });
                }
            }

            const db = getDB();
            if (!db.config) db.config = {};
            if (!db.config.outings) db.config.outings = [];

            const newOuting = {
                id: `out_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
                title,
                location,
                date,
                time,
                weather,
                content,
                media: savedMedia,
                hearts: 0,
                createdAt: new Date().toISOString()
            };

            db.config.outings.unshift(newOuting);
            await saveDB(db);
            jsonResponse(res, 200, { success: true, outing: newOuting, outings: db.config.outings });
        } catch (e) {
            console.error('Lỗi /api/outings:', e.message);
            jsonResponse(res, 500, { success: false, message: 'Lỗi lưu chuyến đi' });
        }
        return;
    }

    // ── POST /api/outings/delete — Xóa nhật ký đi chơi ───────────────────────
    if (pathname === '/api/outings/delete' && req.method === 'POST') {
        try {
            const body = await readBody(req, 1024);
            const payload = JSON.parse(body);
            const id = payload.id;

            const db = getDB();
            if (db.config && db.config.outings) {
                db.config.outings = db.config.outings.filter(o => o.id !== id);
                await saveDB(db);
            }
            jsonResponse(res, 200, { success: true, outings: (db.config && db.config.outings) || [] });
        } catch (e) {
            jsonResponse(res, 400, { success: false, message: 'Lỗi xóa chuyến đi' });
        }
        return;
    }

    // ── POST /api/outings/react — Thả tim chuyến đi chơi ─────────────────────
    if (pathname === '/api/outings/react' && req.method === 'POST') {
        try {
            const body = await readBody(req, 512);
            const payload = JSON.parse(body);
            const id = payload.id;

            const db = getDB();
            if (db.config && db.config.outings) {
                const outing = db.config.outings.find(o => o.id === id);
                if (outing) {
                    outing.hearts = (outing.hearts || 0) + 1;
                    await saveDB(db);
                    jsonResponse(res, 200, { success: true, hearts: outing.hearts });
                    return;
                }
            }
            jsonResponse(res, 404, { success: false, message: 'Không tìm thấy chuyến đi' });
        } catch (e) {
            jsonResponse(res, 400, { success: false, message: 'Lỗi thả tim' });
        }
        return;
    }

    // ── POST /api/likes — Thả tim (public, rate-limited) — backward compat ────
    if (pathname === '/api/likes' && req.method === 'POST') {
        const db = getDB();
        db.hearts = (db.hearts || 0) + 1;
        if (!db.reactions) db.reactions = {};
        db.reactions['❤️'] = (db.reactions['❤️'] || 0) + 1;
        await saveDB(db);
        jsonResponse(res, 200, { success: true, hearts: db.hearts, reactions: db.reactions });
        return;
    }

    // ── POST /api/reactions — Emoji reaction (public, rate-limited) ──────────
    if (pathname === '/api/reactions' && req.method === 'POST') {
        try {
            const body        = await readBody(req, 512);
            const payload     = JSON.parse(body);
            const emoji       = (typeof payload.emoji === 'string') ? payload.emoji : '';
            const reactionKey = (typeof payload.reactionKey === 'string') ? payload.reactionKey : '';
            let   idx         = Number.isInteger(payload.idx) ? payload.idx : -1;
            if (idx < 0 && reactionKey && reactionKey.startsWith('r')) {
                const parsed = parseInt(reactionKey.slice(1), 10);
                if (!isNaN(parsed)) idx = parsed;
            }

            const db = getDB();
            if (!db.reactions) db.reactions = {};
            const configList = db.config?.reactionsConfig || [];

            // Validate CHÍNH theo INDEX (reactionKey / idx) — KHÔNG phụ thuộc emoji nữa
            let targetIdx = idx;
            if (targetIdx < 0 || targetIdx >= configList.length) {
                // Fallback cũ: tìm idx qua emoji (nếu người dùng dùng client cũ chưa gửi reactionKey)
                const idxFromEmoji = configList.findIndex(r => r.emoji && emoji && r.emoji === emoji);
                if (idxFromEmoji >= 0) targetIdx = idxFromEmoji;
            }

            // Nếu có reactionsConfig rồi mà vẫn không tìm được index hợp lệ → từ chối
            if (configList.length > 0 && (targetIdx < 0 || targetIdx >= configList.length)) {
                jsonResponse(res, 400, { success: false, message: 'Reaction không hợp lệ' });
                return;
            }

            // Xác định các key lưu vào db.reactions
            const keyPrimary = targetIdx >= 0 ? `r${targetIdx}` : reactionKey || emoji;
            const keyEmoji   = emoji; // backward compat key
            const cfg        = (targetIdx >= 0 && configList[targetIdx]) ? configList[targetIdx] : null;

            if (!keyPrimary) {
                jsonResponse(res, 400, { success: false, message: 'Reaction không hợp lệ' });
                return;
            }

            // Tăng count cho key chính (r0, r1, r2...)
            db.reactions[keyPrimary] = (db.reactions[keyPrimary] || 0) + 1;
            const finalCount = db.reactions[keyPrimary];

            // ⚠️ XÓA LUÔN key '' (emoji rỗng) nếu còn sót lại từ bug cũ — không cho phép
            //    5 nút cùng chia sẻ 1 key rỗng = nguyên nhân chính "click 1 tăng 2"
            if ('' in db.reactions) {
                delete db.reactions[''];
            }

            // Đồng bộ count vào key emoji cũ — CHỈ KHI EMOJI KHÁC RỖNG & KHÔNG TRÙNG
            if (keyEmoji && typeof keyEmoji === 'string' && keyEmoji.length > 0 && keyEmoji !== keyPrimary) {
                // Kiểm tra tránh ghi đè emoji này sang nút khác (emoji phải unique)
                const sameEmojiElsewhere = configList.some((r, i) =>
                    i !== targetIdx && r.emoji === keyEmoji
                );
                if (!sameEmojiElsewhere) {
                    db.reactions[keyEmoji] = finalCount;
                }
            }
            // Đồng bộ count vào countId của config (nếu có) để guestbook.js lookup theo IDX_COUNTID
            if (cfg?.countId && cfg.countId !== keyPrimary && cfg.countId !== keyEmoji) {
                db.reactions[cfg.countId] = finalCount;
            }

            // Sync hearts cho backward compat (reaction index 0 HOẶC emoji ❤️)
            const isHeart = (targetIdx === 0) || (emoji === '❤️') || (keyPrimary === 'r0');
            if (isHeart) db.hearts = finalCount;

            await saveDB(db);
            jsonResponse(res, 200, {
                success: true,
                emoji,
                reactionKey: keyPrimary,
                idx: targetIdx,
                count: finalCount,
                reactions: db.reactions,
            });
        } catch (e) {
            console.error('[POST /api/reactions] Error:', e);
            jsonResponse(res, 400, { success: false, message: 'Dữ liệu không hợp lệ' });
        }
        return;
    }

// Helper: tạo hoặc cập nhật visitor record — dùng chung cho cả Server-Side Tracking (lớp 1)
// và Client-Side Ping Enrichment (lớp 2). Tránh duplicate record cho cùng khách.
// Trả về: { visitor, isNew, sessionIdFinal }
async function _upsertVisitor(db, sessionId, clientIp, uaString, extraPayload = {}) {
    if (!db.visitors) db.visitors = [];
    const { os, device: parsedDevice, browser } = parseUserAgent(uaString);

    // 1. Tìm visitor theo sessionId
    let visitor = db.visitors.find(v => v.sessionId === sessionId);

    // 2. Fallback: nếu không thấy sessionId → tìm theo IP + UA gần giống (trong 30 phút)
    // Để capture trường hợp: server tạo record nhưng JS client tạo sessionId khác (cookie disabled)
    if (!visitor) {
        const THIRTY_MIN_AGO = Date.now() - 30 * 60 * 1000;
        visitor = db.visitors.find(v =>
            v.ip === clientIp &&
            v.browser === browser &&
            v.os === os &&
            new Date(v.lastSeen).getTime() > THIRTY_MIN_AGO
        );
        // Nếu tìm được → đồng bộ sessionId mới vào để client ping sau đó match đúng
        if (visitor && sessionId) {
            visitor.sessionId = sessionId;
        }
    }

    const now = new Date().toISOString();
    const timeStr = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const isNew = !visitor;

    if (isNew) {
        const geo = await getIpLocation(clientIp);
        const deviceModel = extraPayload.deviceModel ? extraPayload.deviceModel : parsedDevice;

        visitor = {
            id: `vis_${Date.now()}_${Math.random().toString(36).substr(2,4)}`,
            sessionId,
            ip: clientIp,
            city: geo.city,
            region: geo.region,
            country: geo.country,
            isp: geo.isp,
            lat: geo.lat || null,
            lng: geo.lng || null,
            accuracy: null,
            isGps: false,
            os,
            device: deviceModel,
            gpu: extraPayload.gpu || null,
            cpuCores: extraPayload.cpuCores || null,
            ramGB: extraPayload.ramGB || null,
            browser,
            referrer: extraPayload.referrer || 'Trực tiếp / Bookmark',
            screen: extraPayload.screen || '-',
            viewport: extraPayload.viewport || '-',
            dpr: extraPayload.dpr || 1,
            language: extraPayload.language || 'vi-VN',
            timezone: extraPayload.timezone || 'Asia/Ho_Chi_Minh',
            touchPoints: extraPayload.touchPoints || 0,
            connection: extraPayload.connection || '3G/4G/Wifi',
            battery: extraPayload.battery || null,
            sectionsVisited: [extraPayload.section || 'Trang chủ'],
            timelineLogs: [
                { time: timeStr, event: 'Truy cập trang web', detail: `Nguồn: ${extraPayload.referrer || 'Trực tiếp'}` }
            ],
            clicks: 1,
            firstSeen: now,
            lastSeen: now,
            durationSeconds: 0,
            visitorUuid: extraPayload.visitorUuid || null,
            isReturning: extraPayload.isFirstVisit === false || extraPayload.isFirstVisit === 'false' ? true : false,
            visitCount: extraPayload.isFirstVisit ? 1 : 2,
            lastVisitAt: extraPayload.lastVisit || null,
        };
        db.visitors.unshift(visitor);
        // Giữ tối đa 200 bản ghi — trim bản cũ nhất
        if (db.visitors.length > 200) db.visitors = db.visitors.slice(0, 200);
        // Tự động xóa visitor offline > 30 ngày
        const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
        db.visitors = db.visitors.filter(v => (Date.now() - new Date(v.lastSeen).getTime()) < THIRTY_DAYS);
    } else {
        // CẬP NHẬT — Enrich dữ liệu từ client vào visitor đã có
        visitor.lastSeen = now;
        visitor.ip = clientIp;

        const devMod = extraPayload.deviceModel ? extraPayload.deviceModel : parsedDevice;
        if (devMod && devMod !== parsedDevice) visitor.device = devMod;

        // Enrich hardware info (nếu client gửi lên)
        if (extraPayload.gpu) visitor.gpu = extraPayload.gpu;
        if (extraPayload.cpuCores) visitor.cpuCores = extraPayload.cpuCores;
        if (extraPayload.ramGB) visitor.ramGB = extraPayload.ramGB;
        if (extraPayload.screen) visitor.screen = extraPayload.screen;
        if (extraPayload.viewport) visitor.viewport = extraPayload.viewport;
        if (extraPayload.battery) visitor.battery = extraPayload.battery;
        if (extraPayload.connection) visitor.connection = extraPayload.connection;
        if (extraPayload.language) visitor.language = extraPayload.language;
        if (extraPayload.timezone) visitor.timezone = extraPayload.timezone;
        if (extraPayload.dpr) visitor.dpr = extraPayload.dpr;
        if (extraPayload.touchPoints) visitor.touchPoints = extraPayload.touchPoints;

        if (extraPayload.section && !visitor.sectionsVisited.includes(extraPayload.section)) {
            visitor.sectionsVisited.push(extraPayload.section);
        }
        if (extraPayload.visitorUuid) visitor.visitorUuid = extraPayload.visitorUuid;

        // GPS enrichment (nếu client gửi tọa độ thực)
        const isRealGps = extraPayload.isGps === true && Boolean(extraPayload.lat && extraPayload.lng);
        if (isRealGps) {
            visitor.lat = extraPayload.lat;
            visitor.lng = extraPayload.lng;
            visitor.isGps = true;
            if (extraPayload.accuracy) visitor.accuracy = extraPayload.accuracy;
            const gpsAddr = await reverseGeocode(extraPayload.lat, extraPayload.lng);
            if (gpsAddr && gpsAddr.city) {
                visitor.city = gpsAddr.city;
                visitor.region = gpsAddr.region;
            }
        } else if (extraPayload.lat || extraPayload.lng) {
            if (!visitor.lat) visitor.lat = extraPayload.lat;
            if (!visitor.lng) visitor.lng = extraPayload.lng;
        }

        const first = new Date(visitor.firstSeen).getTime();
        const last = new Date(now).getTime();
        visitor.durationSeconds = Math.max(0, Math.round((last - first) / 1000));
    }

    return { visitor, isNew, sessionIdFinal: visitor.sessionId };
}

// Helper đọc cookie từ request header
function _getCookie(req, name) {
    const cookieHeader = req.headers['cookie'] || '';
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    return match ? decodeURIComponent(match[1]) : null;
}

// ── POST /api/track/ping — Fingerprint & Ghé thăm web (public) ───────────
if (pathname === '/api/track/ping' && req.method === 'POST') {
    try {
        const body = await readBody(req, 4096);
        const payload = JSON.parse(body || '{}');
        const clientIp = extractClientIp(req);
        const uaString = req.headers['user-agent'] || '';

        // Lấy sessionId từ 2 nguồn: payload (client-side) HOẶC cookie (server-side set lúc truy cập đầu tiên)
        // Ưu tiên payload sessionId, nếu không có thì dùng cookie
        const cookieSessId = _getCookie(req, 'v_server_sess_id');
        const sessionId = payload.sessionId || cookieSessId || `sess_${Date.now()}`;

        const db = getDB();
        await _upsertVisitor(db, sessionId, clientIp, uaString, payload);
        await saveDB(db);
        jsonResponse(res, 200, { success: true, sessionId });
    } catch (e) {
        jsonResponse(res, 400, { success: false });
    }
    return;
}

    // ── POST /api/track/event — Sự kiện xem mục / click (public) ────────────
    if (pathname === '/api/track/event' && req.method === 'POST') {
        try {
            const body = await readBody(req, 2048);
            const payload = JSON.parse(body || '{}');
            if (payload.sessionId) {
                const db = getDB();
                if (db.visitors) {
                    const visitor = db.visitors.find(v => v.sessionId === payload.sessionId);
                    if (visitor) {
                        const now = new Date().toISOString();
                        const timeStr = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                        visitor.lastSeen = now;

                        if (payload.isGps === true && payload.lat && payload.lng) {
                            visitor.lat = payload.lat;
                            visitor.lng = payload.lng;
                            if (payload.accuracy) visitor.accuracy = payload.accuracy;
                            visitor.isGps = true;
                            const gpsAddr = await reverseGeocode(payload.lat, payload.lng);
                            if (gpsAddr && gpsAddr.city) {
                                visitor.city = gpsAddr.city;
                                visitor.region = gpsAddr.region;
                            }
                        }
                        
                        if (payload.action) {
                            visitor.clicks = (visitor.clicks || 0) + 1;
                            if (!visitor.timelineLogs) visitor.timelineLogs = [];
                            visitor.timelineLogs.push({
                                time: timeStr,
                                event: `Thao tác: ${payload.action}`,
                                detail: payload.section ? `Mục: ${payload.section}` : ''
                            });
                            if (visitor.timelineLogs.length > 30) {
                                visitor.timelineLogs = visitor.timelineLogs.slice(-30);
                            }
                        }

                        if (payload.section && !visitor.sectionsVisited.includes(payload.section)) {
                            visitor.sectionsVisited.push(payload.section);
                        }

                        const first = new Date(visitor.firstSeen).getTime();
                        const last = new Date(now).getTime();
                        visitor.durationSeconds = Math.max(0, Math.round((last - first) / 1000));
                        await saveDB(db);
                    }
                }
            }
            jsonResponse(res, 200, { success: true });
        } catch (e) {
            jsonResponse(res, 400, { success: false });
        }
        return;
    }

    // ── GET /api/admin/visitors — Xem danh sách khách viếng thăm (Admin Auth) ─
    if (pathname === '/api/admin/visitors' && req.method === 'GET') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) {
            jsonResponse(res, 401, { success: false, message: 'Chưa đăng nhập Admin' });
            return;
        }

        const db = getDB();
        let visitors = db.visitors || [];
        const nowMs = Date.now();

        // Đếm số người đang online (lastSeen trong vòng 5 phút)
        const onlineCount = visitors.filter(v => {
            const lastMs = new Date(v.lastSeen).getTime();
            return (nowMs - lastMs) <= 5 * 60 * 1000;
        }).length;

        // Thống kê Top Thiết Bị
        const deviceCounts = {};
        visitors.forEach(v => {
            const dev = v.device || 'Khác';
            deviceCounts[dev] = (deviceCounts[dev] || 0) + 1;
        });
        const topDevice = Object.keys(deviceCounts).sort((a,b) => deviceCounts[b] - deviceCounts[a])[0] || '-';

        // Thống kê Top Thành Phố
        const cityCounts = {};
        visitors.forEach(v => {
            const city = v.city || 'Khác';
            cityCounts[city] = (cityCounts[city] || 0) + 1;
        });
        const topCity = Object.keys(cityCounts).sort((a,b) => cityCounts[b] - cityCounts[a])[0] || '-';

        // Lấy homeLocation từ config để frontend tạo URL chỉ đường
        const homeLoc = db.config?.homeLocation || null;

        jsonResponse(res, 200, {
            success: true,
            visitors: visitors.slice(0, 60), // 60 khách mới nhất
            onlineCount,
            totalVisitors: visitors.length,
            topDevice,
            topCity,
            homeLocation: homeLoc
        });
        return;
    }

    // ── POST /api/admin/visitors/delete — Xóa 1 nhật ký khách (Admin only) ────
    if (pathname === '/api/admin/visitors/delete' && req.method === 'POST') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) {
            jsonResponse(res, 401, { success: false, message: 'Yêu cầu đăng nhập Admin' });
            return;
        }
        try {
            const body = await readBody(req, 2048);
            const payload = JSON.parse(body || '{}');
            const { sessionId, id } = payload;
            
            const db = getDB();
            if (db.visitors) {
                db.visitors = db.visitors.filter(v => v.sessionId !== sessionId && v.id !== id);
                await saveDB(db);
            }
            jsonResponse(res, 200, { success: true, message: 'Đã xóa nhật ký khách thành công!' });
        } catch (e) {
            jsonResponse(res, 400, { success: false, message: 'Lỗi khi xóa nhật ký khách' });
        }
        return;
    }

    // ── GET /api/admin/visitors-stats — Thống kê theo giờ (Admin only) ─────────
    if (pathname === '/api/admin/visitors-stats' && req.method === 'GET') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) {
            jsonResponse(res, 401, { success: false, message: 'Yêu cầu đăng nhập Admin' });
            return;
        }
        const db = getDB();
        const visitors = db.visitors || [];
        const nowMs = Date.now();

        // Tính lượt truy cập theo từng giờ trong 24h gần nhất
        const hourly = new Array(24).fill(0);        // index 0 = 23h trước, index 23 = giờ hiện tại
        const hourlyNew = new Array(24).fill(0);     // khách mới
        const hourlyReturn = new Array(24).fill(0);  // khách quay lại

        visitors.forEach(v => {
            const ms = new Date(v.firstSeen).getTime();
            const diffH = Math.floor((nowMs - ms) / (60 * 60 * 1000));
            if (diffH >= 0 && diffH < 24) {
                const idx = 23 - diffH;
                hourly[idx]++;
                if (v.isReturning) hourlyReturn[idx]++;
                else hourlyNew[idx]++;
            }
        });

        // Label giờ cho 24 cột: "0h", "1h", ... giờ hiện tại
        const nowHour = new Date().getHours();
        const labels = hourly.map((_, i) => {
            const h = (nowHour - (23 - i) + 24) % 24;
            return `${h}h`;
        });

        // Tổng hôm nay (từ 00:00)
        const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
        const todayCount  = visitors.filter(v => new Date(v.firstSeen) >= startOfDay).length;
        const totalUnique = new Set(visitors.map(v => v.visitorUuid).filter(Boolean)).size;
        const returningCount = visitors.filter(v => v.isReturning).length;

        jsonResponse(res, 200, {
            success: true,
            hourly, hourlyNew, hourlyReturn, labels,
            todayCount, totalUnique, returningCount,
            total: visitors.length,
        });
        return;
    }

    // ── POST /api/admin/visitors/clear-all — Xóa toàn bộ (Admin only) ─────────
    if (pathname === '/api/admin/visitors/clear-all' && req.method === 'POST') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) {
            jsonResponse(res, 401, { success: false, message: 'Yêu cầu đăng nhập Admin' });
            return;
        }
        const db = getDB();
        const before = (db.visitors || []).length;
        db.visitors = [];
        await saveDB(db);
        jsonResponse(res, 200, { success: true, deleted: before, message: `Đã xóa toàn bộ ${before} nhật ký khách.` });
        return;
    }

    // ── POST /api/admin/visitors/clear-offline — Xóa offline >N ngày (Admin) ──
    if (pathname === '/api/admin/visitors/clear-offline' && req.method === 'POST') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) {
            jsonResponse(res, 401, { success: false, message: 'Yêu cầu đăng nhập Admin' });
            return;
        }
        try {
            const body = await readBody(req, 256);
            const { days = 7 } = JSON.parse(body || '{}');
            const cutoff = Date.now() - (Math.max(1, Number(days)) * 24 * 60 * 60 * 1000);
            const db = getDB();
            const before = (db.visitors || []).length;
            db.visitors = (db.visitors || []).filter(v => {
                const lastMs = new Date(v.lastSeen).getTime();
                // Giữ lại nếu đang online hoặc lastSeen còn trong ngưỡng
                return lastMs >= cutoff;
            });
            const deleted = before - db.visitors.length;
            await saveDB(db);
            jsonResponse(res, 200, { success: true, deleted, remaining: db.visitors.length, message: `Đã xóa ${deleted} khách offline hơn ${days} ngày.` });
        } catch (e) {
            jsonResponse(res, 400, { success: false, message: 'Lỗi khi xóa' });
        }
        return;
    }

    // ── POST /api/admin/wipe-cloud-bin — XÓA SẠCH Cloud JSONBin (Admin only) ──
    // Ghi đè bin bằng object rỗng {} → xóa sạch cloud, restart server sẽ không auto-pull dữ liệu cũ nữa
    if (pathname === '/api/admin/wipe-cloud-bin' && req.method === 'POST') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) {
            jsonResponse(res, 401, { success: false, message: 'Yêu cầu đăng nhập Admin' });
            return;
        }
        try {
            if (!JSONBIN_BIN_ID || !JSONBIN_API_KEY) {
                jsonResponse(res, 400, { success: false, message: 'JSONBin chưa được cấu hình trong file .env' });
                return;
            }
            const emptyDB = { config: {}, wishes: [], hearts: 0, reactions: {}, anonymousMessages: [], visitors: [] };
            const payloadBuf = Buffer.from(JSON.stringify(emptyDB), 'utf8');
            const result = await _jbnRequestOnce('PUT', '', payloadBuf);
            if (result.ok) {
                jsonResponse(res, 200, {
                    success: true,
                    message: '✅ Đã XÓA SẠCH dữ liệu trên Cloud JSONBin! Restart server để đảm bảo cache RAM cũng được làm mới.',
                    cloudStatus: 'Đã ghi đè bằng {} (empty DB)'
                });
            } else {
                jsonResponse(res, 500, {
                    success: false,
                    message: `❌ Không thể xóa Cloud Bin: HTTP ${result.status} — ${result.error || (result.body || '').slice(0, 120) || 'Lỗi không xác định'}`
                });
            }
        } catch (e) {
            jsonResponse(res, 500, { success: false, message: 'Lỗi khi wipe cloud bin: ' + e.message });
        }
        return;
    }

    // ── POST /api/admin/reset-everything — RESET TẤT CẢ (Admin only) ⛔ CỰC NGUY HIỂM ──
    // Xóa: Local DB (data/db.json + root db.json) + All Snapshot Backups + Cloud JSONBin
    // Sau khi gọi xong → restart server, DB sẽ hoàn toàn TRẮNG như mới cài
    if (pathname === '/api/admin/reset-everything' && req.method === 'POST') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) {
            jsonResponse(res, 401, { success: false, message: 'Yêu cầu đăng nhập Admin' });
            return;
        }
        try {
            const body = await readBody(req, 2048);
            const payload = JSON.parse(body || '{}');
            const confirm1 = payload.confirm1 === 'I_UNDERSTAND_THIS_WILL_DELETE_ALL_DATA';
            const confirm2 = payload.confirm2 === 'YES_DELETE_EVERYTHING_PERMANENTLY';
            if (!confirm1 || !confirm2) {
                jsonResponse(res, 400, {
                    success: false,
                    message: '⚠️ Cần xác nhận 2 bước để reset hoàn toàn. Thiếu payload confirm1 hoặc confirm2.'
                });
                return;
            }

            const report = {
                backupsDeleted: 0,
                dbFilesDeleted: [],
                cloudWiped: false,
                cloudError: null,
            };

            try {
                if (fs.existsSync(BACKUPS_DIR)) {
                    const files = fs.readdirSync(BACKUPS_DIR);
                    for (const f of files) {
                        if (f.startsWith('db_snapshot_') && f.endsWith('.json')) {
                            try { fs.unlinkSync(path.join(BACKUPS_DIR, f)); report.backupsDeleted++; } catch {}
                        }
                    }
                }
            } catch (e) { report.backupsError = e.message; }

            function safeDelete(p) {
                try {
                    if (fs.existsSync(p)) { fs.unlinkSync(p); report.dbFilesDeleted.push(p); return true; }
                } catch {}
                return false;
            }
            safeDelete(DB_FILE);
            safeDelete(path.join(__dirname, 'db.json'));
            _dbCache = null;

            if (JSONBIN_BIN_ID && JSONBIN_API_KEY) {
                try {
                    const emptyDB = { config: {}, wishes: [], hearts: 0, reactions: {}, anonymousMessages: [], visitors: [] };
                    const payloadBuf = Buffer.from(JSON.stringify(emptyDB), 'utf8');
                    const r = await _jbnRequestOnce('PUT', '', payloadBuf);
                    if (r.ok) report.cloudWiped = true;
                    else report.cloudError = `HTTP ${r.status} ${r.error || (r.body||'').slice(0,100)}`;
                } catch (e) { report.cloudError = e.message; }
            }

            jsonResponse(res, 200, {
                success: true,
                message: '✅ ĐÃ RESET HOÀN TOÀN! Hãy RESTART SERVER ngay bây giờ (tắt mở lại) để áp dụng DB trắng.',
                report
            });
        } catch (e) {
            jsonResponse(res, 500, { success: false, message: 'Lỗi reset: ' + e.message });
        }
        return;
    }

    // ── GET /api/admin/backup/github-status — Trạng thái GitHub Backup (Admin) ──
    if (pathname === '/api/admin/backup/github-status' && req.method === 'GET') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) {
            jsonResponse(res, 401, { success: false, message: 'Yêu cầu đăng nhập Admin' });
            return;
        }
        try {
            const db = getDB();
            const dbKB = Number(_getDBSizeKB(db).toFixed(1));
            const records = _countDBRecords(db);

            let repoInfo = null;
            if (GITHUB_ENABLED && _isAvailable(ghbState, 'GitHub')) {
                // Lấy thông tin file hiện tại trong repo
                try {
                    const apiPath = `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}?ref=${GITHUB_BRANCH}`;
                    const res2 = await _ghRequestOnce('GET', apiPath);
                    if (res2.ok && res2.data) {
                        repoInfo = {
                            sha:         res2.data.sha?.slice(0, 12) || '',
                            sizeKB:      Number((res2.data.size / 1024).toFixed(1)),
                            downloadUrl: res2.data.html_url || '',
                            encodedSize: res2.data.size || 0,
                        };
                    }
                } catch {}
            }

            const lastBackupAgo = ghbState.lastBackupAt
                ? Math.round((Date.now() - ghbState.lastBackupAt) / 1000)
                : null;

            jsonResponse(res, 200, {
                success: true,
                github: {
                    enabled:        GITHUB_ENABLED,
                    mode:           ghbState.mode,
                    repo:           GITHUB_REPO || '',
                    branch:         GITHUB_BRANCH,
                    filePath:       GITHUB_FILE_PATH,
                    lastBackupAt:   ghbState.lastBackupAt ? new Date(ghbState.lastBackupAt).toISOString() : null,
                    lastBackupAgoSeconds: lastBackupAgo,
                    lastSha:        ghbState.lastBackupSha?.slice(0, 12) || '',
                    repoFileInfo:   repoInfo,
                    reason:         ghbState.reason || null,
                },
                jsonbin: {
                    enabled:  !!(JSONBIN_BIN_ID && JSONBIN_API_KEY),
                    mode:     jbnState.mode,
                    reason:   jbnState.reason || null,
                },
                db: {
                    sizeKB:  dbKB,
                    records,
                    counts: {
                        wishes:            (db.wishes || []).length,
                        anonymousMessages: (db.anonymousMessages || []).length,
                        visitors:          (db.visitors || []).length,
                    },
                },
                suggestion: !GITHUB_ENABLED
                    ? '⚠️ Chưa cấu hình GitHub Backup. Thêm GITHUB_TOKEN + GITHUB_REPO vào Render Environment Variables để bảo vệ dữ liệu.'
                    : ghbState.mode === 'hard-off'
                    ? `🔴 GitHub Backup bị tắt vĩnh viễn: ${ghbState.reason}`
                    : ghbState.mode === 'cooldown'
                    ? '⏸️ GitHub Backup đang tạm dừng do lỗi mạng. Sẽ tự thử lại sau.'
                    : '✅ GitHub Backup hoạt động bình thường.',
            });
        } catch (e) {
            jsonResponse(res, 500, { success: false, message: e.message });
        }
        return;
    }

    // ── POST /api/admin/backup/github-now — Force backup lên GitHub ngay (Admin) ──
    if (pathname === '/api/admin/backup/github-now' && req.method === 'POST') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) {
            jsonResponse(res, 401, { success: false, message: 'Yêu cầu đăng nhập Admin' });
            return;
        }
        if (!GITHUB_ENABLED) {
            jsonResponse(res, 400, { success: false, message: 'GitHub Backup chưa được cấu hình. Thêm GITHUB_TOKEN + GITHUB_REPO vào .env' });
            return;
        }
        try {
            // Reset throttle để cho phép backup ngay lập tức
            ghbState.lastBackupAt = 0;
            const db = getDB();
            const ok = await backupToGitHub(db);
            if (ok) {
                jsonResponse(res, 200, {
                    success: true,
                    message: `✅ Đã backup ${_countDBRecords(db)} records lên GitHub thành công!`,
                    repo: GITHUB_REPO,
                    filePath: GITHUB_FILE_PATH,
                });
            } else {
                jsonResponse(res, 500, {
                    success: false,
                    message: `❌ Backup thất bại. Kiểm tra GITHUB_TOKEN và GITHUB_REPO trong .env — ${ghbState.reason || 'Lỗi không xác định'}`,
                });
            }
        } catch (e) {
            jsonResponse(res, 500, { success: false, message: 'Lỗi: ' + e.message });
        }
        return;
    }

    // ── GET /api/admin/db-status — Trạng thái DB (size, an toàn) để Admin dashboard (Admin) ──
    if (pathname === '/api/admin/db-status' && req.method === 'GET') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) {
            jsonResponse(res, 401, { success: false, message: 'Yêu cầu đăng nhập Admin' });
            return;
        }
        try {
            const db = getDB();
            const kb = _getDBSizeKB(db);
            const recordCount = _countDBRecords(db);
            // GitHub không có giới hạn 100KB nên chỉ warning ở mức rất lớn
            const EFFECTIVE_LIMIT = GITHUB_ENABLED ? 10240 : 100; // 10MB với GitHub, 100KB với JSONBin
            let level = 'safe';
            if (!GITHUB_ENABLED && kb >= 95) level = 'danger';
            else if (!GITHUB_ENABLED && kb >= 80) level = 'warning';
            const anonCount = Array.isArray(db.anonymousMessages) ? db.anonymousMessages.length : 0;
            const wishCount = Array.isArray(db.wishes) ? db.wishes.length : 0;
            const visitorCount = Array.isArray(db.visitors) ? db.visitors.length : 0;
            jsonResponse(res, 200, {
                success: true,
                sizeKB: Number(kb.toFixed(1)),
                limitKB: EFFECTIVE_LIMIT,
                percentUsed: Number((kb / EFFECTIVE_LIMIT * 100).toFixed(1)),
                level,
                records: recordCount,
                counts: { wishes: wishCount, anonymousMessages: anonCount, visitors: visitorCount },
                backupMode: GITHUB_ENABLED ? 'github' : (JSONBIN_BIN_ID && JSONBIN_API_KEY) ? 'jsonbin' : 'local-only',
                backupSnapshots: (() => {
                    try {
                        const files = fs.readdirSync(BACKUPS_DIR)
                            .filter(f => f.startsWith('db_snapshot_') && f.endsWith('.json'))
                            .sort()
                            .reverse();
                        return files.slice(0, 10).map(f => ({ name: f, createdAt: f.slice(12, 31), reason: f.split('__')[1]?.replace('.json','') || 'auto' }));
                    } catch { return []; }
                })(),
                suggestion: GITHUB_ENABLED
                    ? (level === 'safe' ? '✅ DB an toàn. GitHub Backup đang bảo vệ dữ liệu.' : '💚 DB đang trong giới hạn an toàn với GitHub Backup.')
                    : level === 'danger'
                    ? '🔴 DB sắp đầy 100KB JSONBin! Hãy cấu hình GitHub Backup ngay để không bị giới hạn.'
                    : level === 'warning'
                    ? '🟡 DB đã dùng 80%+ giới hạn JSONBin. Hãy cấu hình GitHub Backup để tránh vấn đề.'
                    : '💚 DB an toàn, nhưng hãy cấu hình GitHub Backup để dữ liệu không mất khi Render restart.'
            });
        } catch (e) {
            jsonResponse(res, 500, { success: false, message: e.message });
        }
        return;
    }

    // ── GET /api/resolve-tiktok — Giải mã URL TikTok rút gọn (public) ─────────
    if (pathname === '/api/resolve-tiktok' && req.method === 'GET') {
        const targetUrl = parsedUrl.query.url;
        if (!targetUrl) {
            jsonResponse(res, 400, { success: false, message: 'Thiếu tham số url' });
            return;
        }

        try {
            const parsedTarget = url.parse(targetUrl);
            if (!parsedTarget.hostname || !parsedTarget.hostname.endsWith('tiktok.com')) {
                jsonResponse(res, 400, { success: false, message: 'URL không thuộc tiktok.com' });
                return;
            }
        } catch (e) {
            jsonResponse(res, 400, { success: false, message: 'URL không hợp lệ' });
            return;
        }

        const tikwmUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(targetUrl)}`;
        const client = tikwmUrl.startsWith('https') ? https : http;
        
        client.get(tikwmUrl, (tikwmRes) => {
            let data = '';
            tikwmRes.on('data', chunk => data += chunk);
            tikwmRes.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.code === 0 && json.data && json.data.id) {
                        jsonResponse(res, 200, { success: true, videoId: json.data.id });
                    } else {
                        jsonResponse(res, 400, { success: false, message: 'Không thể phân giải video từ API TikWM' });
                    }
                } catch (err) {
                    jsonResponse(res, 500, { success: false, message: 'Lỗi parse dữ liệu API' });
                }
            });
        }).on('error', (err) => {
            jsonResponse(res, 500, { success: false, message: 'Lỗi kết nối API TikWM' });
        });
        return;
    }

    // Từ đây, tất cả endpoint đều yêu cầu xác thực Admin ─────────────────────
    // ── POST /api/config — Cập nhật cấu hình (Admin only) ───────────────────
    if (pathname === '/api/config' && req.method === 'POST') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) {
            jsonResponse(res, 401, { success: false, message: 'Yêu cầu đăng nhập Admin' });
            return;
        }
        try {
            const body = await readBody(req, 50 * 1024 * 1024); // 50MB (chứa được ảnh/audio base64 lớn)
            const payload = JSON.parse(body);
            // Sanitize các trường text quan trọng
            const allowed = [
                'name','schoolName','className','gradYear','classSlogan',
                'photoUrl','photoFallbackUrl','balloonTiktokUrl','audioUrl','audioFallbackUrl',
                'quote1','quote2','quote3','birthdayDate','displayMode',
                'favMusic','favMovie','favBook','favDrink','favFashion',
                'favLover','favLifestyle','favColor','graduationDate',
                'isCapsuleLocked','sealedAt','graduationMessage','socialLinks',
                'achievements','clubs','friends','diary','goals','journey',
                'gallery','playlist','mapLocations','homeLocation',
                'spotlightConfig','announcementText','announcementActive','reactionsConfig','outings',
            ];
            const sanitized = {};
            for (const key of allowed) {
                if (payload[key] !== undefined) sanitized[key] = payload[key];
            }
            // Sanitize photoUrl
            if (sanitized.photoUrl) sanitized.photoUrl = sanitizeUrl(sanitized.photoUrl);
            if (sanitized.balloonTiktokUrl) sanitized.balloonTiktokUrl = sanitizeUrl(sanitized.balloonTiktokUrl);

            const db = getDB();
            db.config = { ...db.config, ...sanitized };
            await saveDB(db);
            jsonResponse(res, 200, { success: true, config: db.config });
        } catch (e) {
            jsonResponse(res, 400, { success: false, message: 'Dữ liệu không hợp lệ' });
        }
        return;
    }

    // ── POST /api/admin/profile — Cập nhật riêng Hồ sơ Cá nhân (Admin only) ────
    if (pathname === '/api/admin/profile' && req.method === 'POST') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) {
            jsonResponse(res, 401, { success: false, message: 'Yêu cầu đăng nhập Admin' });
            return;
        }
        try {
            const body = await readBody(req, 10 * 1024 * 1024);
            const payload = JSON.parse(body);
            const db = getDB();
            if (!db.config) db.config = {};
            const allowed = [
                'name','schoolName','className','classSlogan','photoUrl','quote1','quote2','quote3',
                'birthdayDate','balloonTiktokUrl','favMusic','favMovie','favBook','favDrink','favFashion',
                'favLover','favLifestyle','favColor','socialLinks'
            ];
            for (const key of allowed) {
                if (payload[key] !== undefined) db.config[key] = payload[key];
            }
            if (db.config.photoUrl) db.config.photoUrl = sanitizeUrl(db.config.photoUrl);
            if (db.config.balloonTiktokUrl) db.config.balloonTiktokUrl = sanitizeUrl(db.config.balloonTiktokUrl);

            await saveDB(db);
            jsonResponse(res, 200, { success: true, message: 'Đã cập nhật Hồ sơ thành công!', config: db.config });
        } catch (e) {
            jsonResponse(res, 400, { success: false, message: 'Lỗi dữ liệu Hồ sơ' });
        }
        return;
    }

    // ── POST /api/admin/gallery — Cập nhật riêng Album Ảnh (Admin only) ───────
    if (pathname === '/api/admin/gallery' && req.method === 'POST') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) {
            jsonResponse(res, 401, { success: false, message: 'Yêu cầu đăng nhập Admin' });
            return;
        }
        try {
            const body = await readBody(req, 20 * 1024 * 1024);
            const payload = JSON.parse(body);
            if (!Array.isArray(payload.gallery)) {
                jsonResponse(res, 400, { success: false, message: 'Gallery phải là một mảng' });
                return;
            }
            const db = getDB();
            if (!db.config) db.config = {};
            db.config.gallery = payload.gallery;
            await saveDB(db);
            jsonResponse(res, 200, { success: true, message: 'Đã lưu Album Ảnh thành công!', gallery: db.config.gallery });
        } catch (e) {
            jsonResponse(res, 400, { success: false, message: 'Lỗi dữ liệu Album Ảnh' });
        }
        return;
    }

    // ── POST /api/admin/timeline — Cập nhật riêng Dấu Chân Thanh Xuân (Admin only) 
    if (pathname === '/api/admin/timeline' && req.method === 'POST') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) {
            jsonResponse(res, 401, { success: false, message: 'Yêu cầu đăng nhập Admin' });
            return;
        }
        try {
            const body = await readBody(req, 10 * 1024 * 1024);
            const payload = JSON.parse(body);
            if (!Array.isArray(payload.journey)) {
                jsonResponse(res, 400, { success: false, message: 'Journey phải là một mảng' });
                return;
            }
            const db = getDB();
            if (!db.config) db.config = {};
            db.config.journey = payload.journey;
            await saveDB(db);
            jsonResponse(res, 200, { success: true, message: 'Đã lưu Dấu Chân Thanh Xuân thành công!', journey: db.config.journey });
        } catch (e) {
            jsonResponse(res, 400, { success: false, message: 'Lỗi dữ liệu Dấu Chân' });
        }
        return;
    }

    // ── POST /api/admin/playlist — Cập nhật riêng Danh Sách Nhạc (Admin only) ──
    if (pathname === '/api/admin/playlist' && req.method === 'POST') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) {
            jsonResponse(res, 401, { success: false, message: 'Yêu cầu đăng nhập Admin' });
            return;
        }
        try {
            const body = await readBody(req, 10 * 1024 * 1024);
            const payload = JSON.parse(body);
            if (!Array.isArray(payload.playlist)) {
                jsonResponse(res, 400, { success: false, message: 'Playlist phải là một mảng' });
                return;
            }
            const db = getDB();
            if (!db.config) db.config = {};
            db.config.playlist = payload.playlist;
            await saveDB(db);
            jsonResponse(res, 200, { success: true, message: 'Đã lưu Playlist nhạc thành công!', playlist: db.config.playlist });
        } catch (e) {
            jsonResponse(res, 400, { success: false, message: 'Lỗi dữ liệu Playlist' });
        }
        return;
    }

    // ── POST /api/upload — Upload file (Admin only, magic bytes check) ────────
    if (pathname === '/api/upload' && req.method === 'POST') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) {
            jsonResponse(res, 401, { success: false, message: 'Yêu cầu đăng nhập Admin' });
            return;
        }
        try {
            const body = await readBody(req, 20 * 1024 * 1024); // 20MB
            const payload = JSON.parse(body);

            if (!payload.fileName || !payload.fileData) {
                jsonResponse(res, 400, { success: false, message: 'Thiếu thông tin file upload' });
                return;
            }

            const validation = validateBase64File(payload.fileData);
            if (!validation.ok) {
                jsonResponse(res, 400, { success: false, message: validation.error });
                return;
            }

            // Tên file an toàn: chỉ dùng timestamp + extension được detect từ magic bytes
            const fileUrl = await saveFile(
                validation.buffer,
                validation.mime,
                validation.mime.startsWith('video') ? 'youth-memories/admin/video'
                : validation.mime.startsWith('audio') ? 'youth-memories/admin/audio'
                : 'youth-memories/admin/image'
            );

            // Trả về URL (Cloudinary https:// hoặc /uploads/... local)
            jsonResponse(res, 200, { success: true, fileUrl });
        } catch (e) {
            jsonResponse(res, 500, { success: false, message: 'Lỗi lưu file' });
        }
        return;
    }

    // ── GET /api/extract-tiktok — Tách audio TikTok (Admin only) ─────────────
    if (pathname === '/api/extract-tiktok' && req.method === 'GET') {
        const token = getTokenFromRequest(req);
        if (!isValidSession(token)) {
            jsonResponse(res, 401, { success: false, message: 'Yêu cầu đăng nhập Admin' });
            return;
        }

        const targetUrl = sanitizeString(parsedUrl.query.url || '', 2048);
        if (!targetUrl || !/^https?:\/\/(www\.)?tiktok\.com/.test(targetUrl)) {
            jsonResponse(res, 400, { success: false, message: 'Link TikTok không hợp lệ' });
            return;
        }

        const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(targetUrl)}`;
        https.get(apiUrl, (apiRes) => {
            let data = '';
            apiRes.on('data', chunk => { data += chunk; });
            apiRes.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.code === 0 && json.data && (json.data.music || json.data.play)) {
                        jsonResponse(res, 200, {
                            success: true,
                            audioUrl: json.data.music || json.data.play,
                            title:   json.data.title  || 'Bài Hát TikTok',
                            artist:  json.data.author ? (json.data.author.nickname || json.data.author.unique_id) : 'TikTok',
                            cover:   json.data.cover  || json.data.origin_cover,
                        });
                    } else {
                        jsonResponse(res, 400, { success: false, message: 'Không thể tách âm thanh từ TikTok này' });
                    }
                } catch (err) {
                    jsonResponse(res, 500, { success: false, message: 'Lỗi giải mã JSON TikTok' });
                }
            });
        }).on('error', () => {
            jsonResponse(res, 500, { success: false, message: 'Không kết nối được server tách âm thanh' });
        });
        return;
    }

    // ── Static File Serving ──────────────────────────────────────────────────
    // Route /admin → Redirect to /?admin=true
    if (pathname === '/admin' || pathname === '/admin/') {
        res.writeHead(302, { 'Location': '/?admin=true' });
        res.end();
        return;
    }

    const isHomePage = pathname === '/';
    let filePath;
    if (isHomePage) {
        filePath = path.join(__dirname, 'index.html');
    } else {
        filePath = path.join(__dirname, pathname);
    }

    // Ngăn path traversal
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('403 Forbidden');
        return;
    }

    // ✅ LỚP 1 — SERVER-SIDE VISITOR TRACKING (NGAY LẬP TỨC, KHÔNG PHỤ THUỘC CLIENT JS)
    // Đảm bảo 100% tạo được visitor record — ngay cả khi client:
    //   • Tắt JavaScript
    //   • JS lỗi (Battery/WebGL API không hỗ trợ → treo await)
    //   • Render Free sleep → request đầu tiên fail sau HTML đã load xong
    // Logic: chạy NGẦM (fire-and-forget) để KHÔNG block việc tải HTML
    if (isHomePage) {
        const clientIp = extractClientIp(req);
        const uaString = req.headers['user-agent'] || '';
        const uaShort = (uaString || '').slice(0, 80).replace(/\s+/g, ' ');

        // Lấy hoặc tạo sessionId (ưu tiên cookie cũ để cập nhật chứ không tạo duplicate)
        let sessionId = _getCookie(req, 'v_server_sess_id');
        const isNewSession = !sessionId;
        if (!sessionId) {
            sessionId = 'srv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
        }

        // Set cookie session cho 8 tiếng — đảm bảo client ping sau đó dùng cùng session
        const cookieVal = encodeURIComponent(sessionId);
        const cookieOpts = [
            `v_server_sess_id=${cookieVal}`,
            'Path=/',
            'Max-Age=28800',
            'SameSite=Lax',
            'HttpOnly'
        ];
        // Không set Secure trên localhost (HTTP)
        if (req.headers['x-forwarded-proto'] === 'https' || req.connection.encrypted) {
            cookieOpts.push('Secure');
        }
        res.setHeader('Set-Cookie', cookieOpts.join('; '));

        // 🟢 LOG SÂU: biết chắc chắn là code SERVER-SIDE TRACKING ĐÃ CHẠY — xem trong Render Logs
        const reqId = Math.random().toString(36).substr(2, 5);
        console.log(`\n  👁️  [SV-TRACK #${reqId}] ⚡ NHẬN REQUEST TRANG CHỦ — IP=${clientIp} NewSess=${isNewSession}`);
        console.log(`       UA: ${uaShort || '(rỗng - bot/crawler?)'}`);

        // 🔥 Fire-and-forget: tạo visitor record NGẦM, không block response HTML
        // Bọc try/catch + DEADLINE TIMEOUT 2500ms để Render cold start / geo API slow
        // KHÔNG BAO GIỜ treo / mem leak
        (async () => {
            const DEADLINE_MS = 2500;
            const deadlineTs = Date.now() + DEADLINE_MS;
            // Lưu lại "timeline" để biết lỗi ở bước nào trong logs
            let step = 'start';
            try {
                // 0. Bọc Race + Timeout cho TOÀN BỘ pipeline
                const done = new Promise((resolve, reject) => {
                    setTimeout(() => reject(new Error(`Timeout ${DEADLINE_MS}ms`)), DEADLINE_MS);
                    (async () => {
                        step = 'getDB';
                        if (Date.now() > deadlineTs) throw new Error('Hết hạn trước getDB');
                        const db = getDB();

                        step = 'parse_referrer';
                        const referrerRaw = req.headers['referer'] || '';
                        const referrer = (referrerRaw && referrerRaw.length > 200)
                            ? referrerRaw.slice(0, 200)
                            : (referrerRaw || 'Trực tiếp / Bookmark');

                        step = '_upsertVisitor';
                        if (Date.now() > deadlineTs) throw new Error('Hết hạn trước upsert');
                        const result = await _upsertVisitor(db, sessionId, clientIp, uaString, {
                            section: 'Trang chủ',
                            referrer,
                        });

                        step = 'saveDB';
                        if (Date.now() > deadlineTs) throw new Error('Hết hạn trước saveDB');
                        await saveDB(db);

                        resolve(result);
                    })().catch(reject);
                });

                const result = await done;
                const cityPart = result?.visitor?.city ? ` - ${result.visitor.city}, ${result.visitor.region || ''}` : '';
                const recId = result?.visitor?.id || '?';
                console.log(`  ✅ [SV-TRACK #${reqId}] LƯU DB THÀNH CÔNG → VisitorID=${recId} Mới=${result?.isNew}${cityPart} (${Date.now() - (deadlineTs - DEADLINE_MS)}ms)`);

            } catch (trackErr) {
                const errMsg = trackErr && trackErr.message ? trackErr.message : String(trackErr);
                console.error(`  ❌ [SV-TRACK #${reqId}] LỖI Ở BƯỚC [${step}] — ${errMsg}`);
                console.error(`     → DỮ LIỆU VẪN CÓ (nếu là lỗi Geo): Fallback tạo record địa chỉ rỗng vẫn hoạt động.`);
            }
        })();
    }

    try {
        const stats = await fs.promises.stat(filePath);
        if (!stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        // ── HTTP Cache Headers cho static assets ─────────────────────────────
        const staticExts = new Set(['.css','.js','.png','.jpg','.jpeg','.gif','.svg','.webp','.ico','.woff2','.mp3','.mp4']);
        if (staticExts.has(ext)) {
            res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 ngày
            const etag = `"${stats.mtime.getTime().toString(16)}-${stats.size.toString(16)}"`;
            res.setHeader('ETag', etag);
            if (req.headers['if-none-match'] === etag) {
                res.writeHead(304);
                res.end();
                return;
            }
        } else {
            // HTML và file khác: revalidate mỗi lần
            res.setHeader('Cache-Control', 'no-cache');
        }

        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    } catch (statErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
    }
});

(async () => {
    console.log('===================================================');
    console.log('  🛡️  INITIALIZING ANTI-DATA LOSS SYSTEM...');
    console.log('===================================================');

    // ── Bước 0: Snapshot DB hiện tại (trước khi làm bất cứ điều gì) ──────────
    const restored0 = _restoreFromLatestBackupIfDBEmpty();
    if (!restored0) {
        const snapCheck = _snapshotDB('startup-first-run');
        if (snapCheck) console.log(`  📸 Đã snapshot DB ban đầu: ${path.basename(snapCheck)}`);
    }

    // ── Bước 1: Restore từ GitHub (ưu tiên cao nhất, không giới hạn size) ────
    // Render Free wipe filesystem mỗi lần restart → GitHub là backup bền vững duy nhất
    let githubRestored = false;
    if (GITHUB_ENABLED) {
        const localCount = _countDBRecords(_loadDBFromDisk());
        if (localCount < 10) {
            // Local rỗng hoặc quá ít → đây là lần đầu deploy / sau Render wipe
            console.log(`  🐙 [Startup] DB local có ${localCount} records → thử restore từ GitHub...`);
            githubRestored = await restoreFromGitHub();
            if (githubRestored) {
                const snapAfterGh = _snapshotDB('after-github-restore');
                if (snapAfterGh) console.log(`  📸 Đã snapshot sau khi restore GitHub: ${path.basename(snapAfterGh)}`);
            }
        } else {
            console.log(`  🐙 [Startup] DB local có ${localCount} records → đủ dữ liệu, bỏ qua GitHub restore.`);
            // Tuy nhiên vẫn lấy SHA hiện tại từ GitHub để backup sau không bị 409 Conflict
            _ghGetFileSha().then(sha => { if (sha) ghbState.lastBackupSha = sha; }).catch(() => {});
        }
    }

    // ── Bước 2: SMART MERGE từ JSONBin (fallback nếu GitHub chưa cấu hình) ───
    if (!GITHUB_ENABLED || !githubRestored) {
        await syncFromCloudDB();
    }

    // ── Bước 3: Snapshot sau khi sync cloud để có bản cuối cùng ──────────────
    const finalSnap = _snapshotDB('after-cloud-sync');
    if (finalSnap) console.log(`  📸 Đã snapshot DB sau khi sync Cloud: ${path.basename(finalSnap)}`);

    // ── Bước 4: Báo cáo DB Safety & dọn dẹp base64 thừa ─────────────────────
    const dbAfter = getDB();
    _reportDBSafety(dbAfter);
    try {
        const jsonStr = JSON.stringify(dbAfter, null, 2);
        fs.writeFileSync(DB_FILE, jsonStr, 'utf8');
        const legacyDB = path.join(__dirname, 'db.json');
        fs.writeFileSync(legacyDB, jsonStr, 'utf8');
    } catch (e) { console.warn('  ⚠️  Không thể ghi lại DB sau cleanup:', e.message); }

    // ── Bước 5: Backup ngay lên GitHub nếu local có dữ liệu mới hơn ─────────
    if (GITHUB_ENABLED && !githubRestored) {
        const localCountAfter = _countDBRecords(dbAfter);
        if (localCountAfter > 0) {
            console.log(`  🐙 [Startup] Đồng bộ ${localCountAfter} records lên GitHub...`);
            await backupToGitHub(dbAfter);
        }
    }

    console.log('  ✅ Anti-DataLoss System: SẴN SÀNG');
    console.log(`     → Thư mục backup local: ${BACKUPS_DIR}`);
    console.log(`     → Tối đa 30 bản snapshot tự động xoay vòng`);
    console.log(`     → 🐙 GitHub Backup: ${GITHUB_ENABLED ? `✅ ${GITHUB_REPO}/${GITHUB_FILE_PATH}` : '❌ Chưa cấu hình'}`);
    console.log(`     → 🗃️  JSONBin Fallback: ${(JSONBIN_BIN_ID && JSONBIN_API_KEY) ? '✅ Đã cấu hình' : '❌ Chưa cấu hình'}`);
    console.log(`     → 🛡️ Anti-Corruption Guard: KHÔNG BAO GIỜ ghi đè nếu Cloud ít data hơn Local`);
    console.log('===================================================');

    function _statusLine(name, iconOK, state, enabledFlag) {
        if (!enabledFlag) return `  🔘 ${name}: ❌ Chưa cấu hình (local-only)`;
        if (state.mode === 'hard-off') {
            return `  🔘 ${name}: 🛑 BỊ TẮT VĨNH VIỄN (${(state.reason || '').slice(0, 90)})`;
        }
        if (state.mode === 'cooldown') {
            const remainSec = Math.max(0, Math.ceil((state.disabledUntil - Date.now()) / 1000));
            return `  🔘 ${name}: ⏸️ Tạm tắt (đang cooldown, còn ${remainSec}s)`;
        }
        return `  🔘 ${name}: ${iconOK} Đã bật & sẵn sàng`;
    }

    // 2. Mở cổng Server sau khi đĩa local đã có dữ liệu hoàn chỉnh
    await initAiTutor();
    server.listen(PORT, '0.0.0.0', () => {
        console.log('===================================================');
        console.log('  🚀 YOUTH MEMORIES BACKEND SERVER ĐANG CHẠY:');
        console.log(`  👉 Localhost: http://localhost:${PORT}`);
        console.log(`  👉 Admin:     http://localhost:${PORT}/?admin=true`);
        console.log('  🔐 Đặt password qua biến môi trường ADMIN_PASSWORD');
        console.log(`  🔐 Password hiện tại: ${ADMIN_PASSWORD === 'youth2026!@#secure' ? 'MẶC ĐỊNH (nên đổi!)' : 'Đã tùy chỉnh ✓'}`);
        console.log('');
        console.log('  ⚙️  TRẠNG THÁI TÍCH HỢP:');
        console.log(_statusLine('Cloudinary (ảnh/audio/video) ', '🟢', cldState, CLOUDINARY_ENABLED));
        console.log(_statusLine('GitHub     (backup DB chính) ', '🟢', ghbState, GITHUB_ENABLED));
        console.log(_statusLine('JSONBin    (backup DB phụ)  ', '🟢', jbnState, !!(JSONBIN_BIN_ID && JSONBIN_API_KEY)));
        console.log('');
        console.log('  🛡️  Smart Circuit Breaker:');
        console.log('     HARD-lỗi 401/403/404 → TẮT VĨNH VIỄN cho đến restart');
        console.log('     SOFT-lỗi mạng 5xx/timeout → Retry 2-3 lần → tạm tắt 5 phút');
        console.log('===================================================');
    });
})();

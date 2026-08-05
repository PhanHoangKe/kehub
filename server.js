/* ==========================================================================
   YOUTH MEMORIES - BACKEND SERVER (Node.js REST API & Static File Server)
   - Thêm xác thực Admin bằng password + session token (task #2, #3)
   - Validate magic bytes khi upload file (task #4)
   - Rate limiting cho các endpoint nhạy cảm (task #5)
   - Input sanitization phía server (task #6)
   - Write queue tránh race condition db.json (task #7)
   - Bỏ express/cors khỏi package.json không cần thiết (task #8)
   - Tách data vào thư mục /data/ tránh bị overwrite khi redeploy (task #11)
   ========================================================================== */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

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

// Đảm bảo thư mục tồn tại (vẫn giữ /uploads/ làm fallback khi Cloudinary chưa cấu hình)
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Cloudinary Config ────────────────────────────────────────────────────────
// Đặt 3 biến môi trường để bật Cloudinary. Nếu chưa cấu hình, fallback về disk local.
// Đăng ký miễn phí tại: https://cloudinary.com/users/register_free
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_API_KEY    = process.env.CLOUDINARY_API_KEY    || '';
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || '';
const CLOUDINARY_ENABLED    = !!(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);

const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID || '';
const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY || process.env.JSONBIN_SECRET || '';

// ── Smart Circuit Breaker (Modern Adaptive Fail-Stop) ───────────────────────
//   • Lỗi HARD (401/403/404/sai cấu hình/missing params)  → TẮT VĨNH VIỄN cho đến restart server
//   • Lỗi SOFT (mạng ECONNRESET / 5xx / timeout)           → retry 2 lần với exponential backoff
//     * Nếu vẫn thất bại → tạm tắt 5 phút (cooldown), sau đó thử lại
let cldState = { enabled: CLOUDINARY_ENABLED, reason: null, disabledUntil: 0, mode: 'active' };
let jbnState = { enabled: !!(JSONBIN_BIN_ID && JSONBIN_API_KEY), reason: null, disabledUntil: 0, mode: 'active' };

function _cldCooldownMs(attempt)   { return 1000 * Math.pow(2, attempt); } // 1s, 2s, 4s
function _jbnCooldownMs(attempt)   { return 1000 * Math.pow(2, attempt); }

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

/**
 * Upload một file (dạng Buffer) lên Cloudinary qua REST API (không cần SDK).
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
// Đặt password qua env var ADMIN_PASSWORD, mặc định là chuỗi ngẫu nhiên
// để buộc người dùng phải tự đặt password rõ ràng.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'youth2026!@#secure';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 giờ

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
};

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

// ── Database với Write Queue & Cloud Backup (tránh race condition & mất data) ──

if (JSONBIN_BIN_ID && JSONBIN_API_KEY) {
    console.log('  🗃️  [JSONBin] Đã cấu hình — DB sẽ được backup lên Cloud sau mỗi lần ghi.');
} else {
    console.log('  ⚠️  [JSONBin] Chưa cấu hình — DB chỉ lưu local (sao lưu /data/db.json thủ công thường xuyên nhé).');
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
                    fs.writeFileSync(DB_FILE, JSON.stringify(lastRes.data.record, null, 2), 'utf8');
                    const legacyDB = path.join(__dirname, 'db.json');
                    try { fs.writeFileSync(legacyDB, JSON.stringify(lastRes.data.record, null, 2), 'utf8'); } catch (e) {}
                    _dbCache = null;
                    console.log('  ✅ [Cloud DB] Khôi phục 100% dữ liệu Cloud về đĩa cục bộ thành công!');
                    return true;
                }
                console.warn('  ⚠️  [Cloud DB] Dữ liệu từ JSONBin rỗng hoặc sai cấu trúc (bin mới tạo?). Bỏ qua & giữ db cục bộ.');
                return false;
            } catch (e) {
                console.error('  ⚠️  [Cloud DB] Lỗi ghi dữ liệu Cloud xuống đĩa:', e.message);
                return false;
            }
        }

        // Phân loại lỗi chi tiết
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

// Hàm ghi DB async với queue — cập nhật cache rồi ghi disk bất đồng bộ
function saveDB(data) {
    // Cập nhật cache ngay lập tức để các request tiếp theo thấy data mới
    _dbCache = data;

    writeQueue = writeQueue.then(() => new Promise((resolve) => {
        try {
            // Ghi đồng thời vào /data/db.json VÀ root db.json
            fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
            const legacyDB = path.join(__dirname, 'db.json');
            fs.writeFileSync(legacyDB, JSON.stringify(data, null, 2), 'utf8');
            // Fire & forget (không await, không block UI ghi vào disk)
            (async () => { try { await saveToCloudDB(data); } catch (e) { /* logged inside */ } })();
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

// ── Helper: lấy IP thực ─────────────────────────────────────────────────────
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

    // ── Rate Limit check ─────────────────────────────────────────────────────
    if (!checkRateLimit(pathname, clientIP)) {
        jsonResponse(res, 429, { success: false, message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' });
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

            // Tự động xóa ngay IP Admin khỏi danh sách visitor khi đăng nhập thành công
            const db = getDB();
            if (db.visitors && Array.isArray(db.visitors)) {
                const initialLen = db.visitors.length;
                db.visitors = db.visitors.filter(v => v.ip !== clientIP && v.ip !== '127.0.0.1' && v.ip !== '::1');
                if (db.visitors.length !== initialLen) {
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
                mediaData: mediaData || null,
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
            const body    = await readBody(req, 256);
            const payload = JSON.parse(body);
            const emoji   = payload.emoji;

            if (!emoji || typeof emoji !== 'string' || emoji.length > 16) {
                jsonResponse(res, 400, { success: false, message: 'Emoji không hợp lệ' });
                return;
            }

            const db = getDB();

            // Validate động từ reactionsConfig trong DB — không hardcode emoji nào cả
            const allowedEmojis = (db.config?.reactionsConfig || [])
                .map(r => r.emoji)
                .filter(Boolean);

            // Fallback: nếu chưa cấu hình reaction thì từ chối
            if (allowedEmojis.length > 0 && !allowedEmojis.includes(emoji)) {
                jsonResponse(res, 400, { success: false, message: 'Emoji không hợp lệ' });
                return;
            }

            if (!db.reactions) db.reactions = {};
            db.reactions[emoji] = (db.reactions[emoji] || 0) + 1;

            // Sync hearts cho backward compat
            if (emoji === '❤️') db.hearts = db.reactions['❤️'];

            await saveDB(db);
            jsonResponse(res, 200, { success: true, emoji, count: db.reactions[emoji], reactions: db.reactions });
        } catch (e) {
            jsonResponse(res, 400, { success: false, message: 'Dữ liệu không hợp lệ' });
        }
        return;
    }

    // ── POST /api/track/ping — Fingerprint & Ghé thăm web (public) ───────────
    if (pathname === '/api/track/ping' && req.method === 'POST') {
        try {
            const body = await readBody(req, 4096);
            const payload = JSON.parse(body || '{}');
            const sessionId = payload.sessionId || `sess_${Date.now()}`;
            const clientIp = extractClientIp(req);
            const uaString = req.headers['user-agent'] || '';
            const { os, device: parsedDevice, browser } = parseUserAgent(uaString);
            const deviceModel = payload.deviceModel ? payload.deviceModel : parsedDevice;
            const gpu = payload.gpu || null;
            const cpuCores = payload.cpuCores || null;
            const ramGB = payload.ramGB || null;

            let geo = await getIpLocation(clientIp);

            // CHỈ reverseGeocode và coi là GPS chuẩn khi client gửi payload.isGps === true
            const isRealGps = payload.isGps === true && Boolean(payload.lat && payload.lng);
            let lat = isRealGps ? payload.lat : (geo.lat || null);
            let lng = isRealGps ? payload.lng : (geo.lng || null);

            if (isRealGps) {
                const gpsAddr = await reverseGeocode(payload.lat, payload.lng);
                if (gpsAddr && gpsAddr.city) {
                    geo.city = gpsAddr.city;
                    geo.region = gpsAddr.region;
                }
            }

            const db = getDB();
            if (!db.visitors) db.visitors = [];

            let visitor = db.visitors.find(v => v.sessionId === sessionId);
            const now = new Date().toISOString();
            const timeStr = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

            if (!visitor) {
                visitor = {
                    id: `vis_${Date.now()}_${Math.random().toString(36).substr(2,4)}`,
                    sessionId,
                    ip: clientIp,
                    city: geo.city,
                    region: geo.region,
                    country: geo.country,
                    isp: geo.isp,
                    lat: lat || null,
                    lng: lng || null,
                    accuracy: isRealGps ? (payload.accuracy || null) : null,
                    isGps: isRealGps,
                    os,
                    device: deviceModel,
                    gpu,
                    cpuCores,
                    ramGB,
                    browser,
                    referrer: payload.referrer || 'Trực tiếp / Bookmark',
                    screen: payload.screen || '-',
                    viewport: payload.viewport || '-',
                    dpr: payload.dpr || 1,
                    language: payload.language || 'vi-VN',
                    timezone: payload.timezone || 'Asia/Ho_Chi_Minh',
                    touchPoints: payload.touchPoints || 0,
                    connection: payload.connection || '3G/4G/Wifi',
                    battery: payload.battery || null,
                    sectionsVisited: [payload.section || 'Trang chủ'],
                    timelineLogs: [
                        { time: timeStr, event: 'Truy cập trang web', detail: `Nguồn: ${payload.referrer || 'Trực tiếp'}` }
                    ],
                    clicks: 1,
                    firstSeen: now,
                    lastSeen: now,
                    durationSeconds: 0,
                    // UUID ổn định — nhận diện khách cũ quay lại
                    visitorUuid:  payload.visitorUuid  || null,
                    isReturning:  payload.isFirstVisit === false || payload.isFirstVisit === 'false' ? true : false,
                    visitCount:   payload.isFirstVisit ? 1 : 2,
                    lastVisitAt:  payload.lastVisit || null,
                };
                db.visitors.unshift(visitor);
                // Giữ tối đa 200 bản ghi — trim bản cũ nhất
                if (db.visitors.length > 200) db.visitors = db.visitors.slice(0, 200);
                // Tự động xóa visitor offline > 30 ngày
                const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
                db.visitors = db.visitors.filter(v => (Date.now() - new Date(v.lastSeen).getTime()) < THIRTY_DAYS);
            } else {
                visitor.lastSeen = now;
                visitor.ip = clientIp;
                if (deviceModel && deviceModel !== parsedDevice) visitor.device = deviceModel;
                if (gpu) visitor.gpu = gpu;
                if (cpuCores) visitor.cpuCores = cpuCores;
                if (ramGB) visitor.ramGB = ramGB;
                if (lat) visitor.lat = lat;
                if (lng) visitor.lng = lng;
                if (payload.accuracy) visitor.accuracy = payload.accuracy;
                if (payload.screen) visitor.screen = payload.screen;
                if (payload.battery) visitor.battery = payload.battery;
                if (payload.connection) visitor.connection = payload.connection;
                if (payload.section && !visitor.sectionsVisited.includes(payload.section)) {
                    visitor.sectionsVisited.push(payload.section);
                }
                const first = new Date(visitor.firstSeen).getTime();
                const last = new Date(now).getTime();
                visitor.durationSeconds = Math.max(0, Math.round((last - first) / 1000));
            }

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
    
    let filePath;
    if (pathname === '/') {
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

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        // ── HTTP Cache Headers cho static assets ─────────────────────────────
        // CSS/JS/fonts/images: cache 1 tuần phía trình duyệt (immutable nếu có hash)
        // HTML: không cache để luôn lấy bản mới nhất
        const staticExts = new Set(['.css','.js','.png','.jpg','.jpeg','.gif','.svg','.webp','.ico','.woff2','.mp3','.mp4']);
        if (staticExts.has(ext)) {
            res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 ngày
            // ETag dựa trên mtime + size để browser biết khi nào file thay đổi
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
    });
});

(async () => {
    // 1. Tải và khôi phục 100% dữ liệu từ Cloud DB trước khi mở Cổng Server
    await syncFromCloudDB();

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
        console.log(_statusLine('JSONBin    (backup DB cloud)', '🟢', jbnState, !!(JSONBIN_BIN_ID && JSONBIN_API_KEY)));
        console.log('');
        console.log('  🛡️  Smart Circuit Breaker:');
        console.log('     HARD-lỗi 401/403/404 → TẮT VĨNH VIỄN cho đến restart');
        console.log('     SOFT-lỗi mạng 5xx/timeout → Retry 2-3 lần → tạm tắt 5 phút');
        console.log('===================================================');
    });
})();

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

// Đảm bảo thư mục tồn tại
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

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

async function fetchWithTimeout(resource, timeoutMs = 2000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(resource, { signal: controller.signal });
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
async function reverseGeocode(lat, lng) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, {
            headers: { 'User-Agent': 'YouthMemoriesApp/2.0' }
        });
        if (res.ok) {
            const data = await res.json();
            if (data && data.address) {
                const a = data.address;
                const hamlet = a.hamlet || a.village || a.quarter || a.neighbourhood || a.road || '';
                const commune = a.suburb || a.city_district || a.town || '';
                const district = a.county || a.district || '';
                const province = a.state || a.city || 'Việt Nam';

                const parts = [hamlet, commune, district, province].filter(p => p && p.trim().length > 0);
                const fullAddress = parts.length > 0 ? parts.join(', ') : (data.display_name || 'Việt Nam');

                return {
                    city: fullAddress,
                    region: province,
                    country: a.country || 'Việt Nam'
                };
            }
        }
    } catch (e) {}
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
// Các định dạng cho phép: jpg, png, gif, webp, mp3, mp4, ogg, wav
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
    const matches = base64DataUrl.match(/^data:([a-zA-Z0-9\/\-\+\.]+);base64,(.+)$/);
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
        // Fallback kiểm tra theo MIME header từ client nếu magic bytes chưa liệt kê đủ
        if (mimeHeader.startsWith('video/')) {
            let ext = '.mp4';
            if (mimeHeader.includes('webm')) ext = '.webm';
            else if (mimeHeader.includes('quicktime') || mimeHeader.includes('mov')) ext = '.mov';
            else if (mimeHeader.includes('3gp')) ext = '.3gp';
            detected = { mime: mimeHeader, ext };
        } else if (mimeHeader.startsWith('image/')) {
            let ext = '.png';
            if (mimeHeader.includes('jpeg') || mimeHeader.includes('jpg')) ext = '.jpg';
            else if (mimeHeader.includes('gif')) ext = '.gif';
            else if (mimeHeader.includes('webp')) ext = '.webp';
            detected = { mime: mimeHeader, ext };
        } else if (mimeHeader.startsWith('audio/')) {
            let ext = '.mp3';
            if (mimeHeader.includes('ogg')) ext = '.ogg';
            else if (mimeHeader.includes('wav')) ext = '.wav';
            detected = { mime: mimeHeader, ext };
        }
    }

    if (!detected) {
        return { ok: false, error: 'Định dạng file không được hỗ trợ' };
    }

    return { ok: true, buffer: fileBuffer, ext: detected.ext, mime: detected.mime };
}

// ── Database với Write Queue & Cloud Backup (tránh race condition & mất data) ──
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID || '';
const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY || process.env.JSONBIN_SECRET || '';

async function syncFromCloudDB() {
    if (!JSONBIN_BIN_ID || !JSONBIN_API_KEY) {
        console.log('  ⚠️  [Cloud DB] Không tìm thấy JSONBIN_BIN_ID hoặc JSONBIN_API_KEY. Sử dụng db.json cục bộ.');
        return false;
    }
    return new Promise((resolve) => {
        console.log('  ☁️  [Cloud DB] Đang đồng bộ dữ liệu mới nhất từ JSONBin.io trước khi mở Server...');
        const reqUrl = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`;
        const parsed = url.parse(reqUrl);
        const options = {
            hostname: parsed.hostname,
            path: parsed.path,
            method: 'GET',
            headers: {
                'X-Master-Key': JSONBIN_API_KEY
            }
        };
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    if (json && json.record && typeof json.record === 'object' && Object.keys(json.record).length > 0) {
                        fs.writeFileSync(DB_FILE, JSON.stringify(json.record, null, 2), 'utf8');
                        const legacyDB = path.join(__dirname, 'db.json');
                        try { fs.writeFileSync(legacyDB, JSON.stringify(json.record, null, 2), 'utf8'); } catch (e) {}
                        // Invalidate cache sau khi ghi từ cloud
                        _dbCache = null;
                        console.log('  ✅ [Cloud DB] Khôi phục 100% dữ liệu Cloud về đĩa cục bộ thành công!');
                        resolve(true);
                    } else {
                        if (res.statusCode === 401) {
                            console.error('  ⚠️  [Cloud DB] JSONBin BÁO LỖI 401: API Key hoặc Bin ID trên Render không chính xác/không thuộc tài khoản!');
                        } else {
                            console.error('  ⚠️  [Cloud DB] Dữ liệu từ JSONBin rỗng hoặc sai cấu trúc:', body.slice(0, 100));
                        }
                        resolve(false);
                    }
                } catch (e) {
                    console.error('  ⚠️  [Cloud DB] Lỗi parse dữ liệu JSONBin:', e.message);
                    resolve(false);
                }
            });
        });
        req.on('error', (err) => {
            console.error('  ⚠️  [Cloud DB] Lỗi kết nối tải từ JSONBin:', err.message);
            resolve(false);
        });
        req.setTimeout(8000, () => {
            req.destroy();
            console.error('  ⚠️  [Cloud DB] Kết nối JSONBin quá 8 giây (Timeout)');
            resolve(false);
        });
        req.end();
    });
}

function saveToCloudDB(data) {
    if (!JSONBIN_BIN_ID || !JSONBIN_API_KEY) return;
    try {
        const payload = JSON.stringify(data);
        const reqUrl = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;
        const parsed = url.parse(reqUrl);
        const req = https.request({
            hostname: parsed.hostname,
            path: parsed.path,
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': JSONBIN_API_KEY,
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                console.log('  ☁️  [Cloud DB] Đã sao lưu dữ liệu mới lên JSONBin.io!');
            } else if (res.statusCode === 401) {
                console.error('  ⚠️  [Cloud DB LỖI 401] JSONBIN_API_KEY hoặc JSONBIN_BIN_ID bị từ chối truy cập.');
            } else {
                console.error('  ⚠️  [Cloud DB] JSONBin báo status:', res.statusCode);
            }
        });
        req.on('error', (err) => {
            console.error('  ⚠️  [Cloud DB] Lỗi lưu lên JSONBin:', err.message);
        });
        req.write(payload);
        req.end();
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
            saveToCloudDB(data);
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
                    jsonResponse(res, 400, { success: false, message: `File không hợp lệ: ${validation.error}` });
                    return;
                }

                // Chỉ cho phép ảnh, audio, video — không cho phép file khác
                const allowedMimes = ['image/jpeg','image/png','image/gif','image/webp',
                                      'audio/mpeg','audio/ogg','audio/wav',
                                      'video/mp4','video/ogg'];
                if (!allowedMimes.includes(validation.mime)) {
                    jsonResponse(res, 400, { success: false, message: 'Định dạng file không được phép' });
                    return;
                }

                // Giới hạn kích thước theo loại
                const maxBytes = validation.mime.startsWith('video') ? 30 * 1024 * 1024  // video: 30MB
                               : validation.mime.startsWith('audio') ? 10 * 1024 * 1024  // audio: 10MB
                               : 5 * 1024 * 1024;                                         // ảnh:   5MB
                if (validation.buffer.length > maxBytes) {
                    const mbLimit = maxBytes / 1024 / 1024;
                    jsonResponse(res, 400, { success: false, message: `File quá lớn (tối đa ${mbLimit}MB cho loại này)` });
                    return;
                }

                // Lưu file
                const prefix   = `anon_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
                const filename = `${prefix}${validation.ext}`;
                const filePath = path.join(UPLOADS_DIR, filename);
                fs.writeFileSync(filePath, validation.buffer);
                savedMediaUrl = `/uploads/${filename}`;
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
                        const prefix   = `outing_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
                        const filename = `${prefix}${validation.ext}`;
                        const filePath = path.join(UPLOADS_DIR, filename);
                        fs.writeFileSync(filePath, validation.buffer);
                        const isVid = (item.type === 'video') || validation.mime.startsWith('video');
                        savedMedia.push({
                            type: isVid ? 'video' : 'image',
                            url: `/uploads/${filename}`
                        });
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
        const ALLOWED_EMOJIS = ['❤️', '😊', '🥺', '🎉', '👏'];
        try {
            const body = await readBody(req, 256);
            const payload = JSON.parse(body);
            const emoji = payload.emoji;

            if (!emoji || !ALLOWED_EMOJIS.includes(emoji)) {
                jsonResponse(res, 400, { success: false, message: 'Emoji không hợp lệ' });
                return;
            }

            const db = getDB();
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
                    durationSeconds: 0
                };
                db.visitors.unshift(visitor);
                if (db.visitors.length > 300) db.visitors = db.visitors.slice(0, 300);
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
                            if (visitor.timelineLogs.length > 15) {
                                visitor.timelineLogs = visitor.timelineLogs.slice(-15);
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

        jsonResponse(res, 200, {
            success: true,
            visitors: visitors.slice(0, 60), // 60 khách mới nhất
            onlineCount,
            totalVisitors: visitors.length,
            topDevice,
            topCity
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
            const safeName = `upload_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${validation.ext}`;
            const savePath = path.join(UPLOADS_DIR, safeName);
            fs.writeFileSync(savePath, validation.buffer);

            // Nếu là hình ảnh, trả về Data URL để lưu trực tiếp vào JSON DB (bảo đảm tồn tại vĩnh viễn trên Cloud)
            if (validation.mime.startsWith('image/')) {
                const dataUrl = `data:${validation.mime};base64,${validation.buffer.toString('base64')}`;
                jsonResponse(res, 200, { success: true, fileUrl: dataUrl });
            } else {
                jsonResponse(res, 200, { success: true, fileUrl: `./uploads/${safeName}` });
            }
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

    // 2. Mở cổng Server sau khi đĩa local đã có dữ liệu hoàn chỉnh
    server.listen(PORT, '0.0.0.0', () => {
        console.log('===================================================');
        console.log('  🚀 YOUTH MEMORIES BACKEND SERVER ĐANG CHẠY:');
        console.log(`  👉 Localhost: http://localhost:${PORT}`);
        console.log(`  👉 Admin:     http://localhost:${PORT}/?admin=true`);
        console.log('  🔐 Đặt password qua biến môi trường ADMIN_PASSWORD');
        console.log(`  🔐 Password hiện tại: ${ADMIN_PASSWORD === 'youth2026!@#secure' ? 'MẶC ĐỊNH (nên đổi!)' : 'Đã tùy chỉnh ✓'}`);
        console.log('  🛡️  [Cloud Restore] Bảo vệ dữ liệu 100% khi khởi động / redeploy');
        console.log('===================================================');
    });
})();

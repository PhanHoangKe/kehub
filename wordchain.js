/* ==========================================================================
   WORDCHAIN — Ðối từ tiếng Việt (Nối Từ)
   - Nạp từ điển 2 tiếng chuẩn (assets/wordPairs.json) một lần khi khởi động.
   - Chỉ chấp nhận TỪ GHÉP 2 TIẾNG có nghĩa trong từ điển tiếng Việt.
   - Không cho từ vô nghĩa, từ lặp lại, hoặc đảo ngược từ đứng liền trước.
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const DICT_FILE = path.join(__dirname, 'assets', 'wordPairs.json');
// Mỗi lượt có TURN_TIMEOUT_MS để "hết giờ" = người đang đến lượt thua.
const TURN_TIMEOUT_MS = Number(process.env.WORDCHAIN_TURN_SECONDS) * 1000 || 30000;

function stripDiacritics(s) {
    return String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function splitSyllables(w) {
    return String(w || '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
}

// ── Load từ điển: { firstNorm -> Set(secondNorm) } ──────────────────────────
let dict = null;          // Map
function loadDictionary() {
    try {
        const raw = JSON.parse(fs.readFileSync(DICT_FILE, 'utf8'));
        dict = new Map();
        for (const [first, seconds] of Object.entries(raw)) {
            const fNorm = stripDiacritics(first);
            const set = dict.get(fNorm) || new Set();
            for (const sec of seconds) set.add(stripDiacritics(sec));
            dict.set(fNorm, set);
        }
        console.log(`  📚  WordChain từ điển sẵn sàng: ${dict.size} tiếng mở đầu / ${_countPairs()} cặp từ 2 tiếng.`);
        return true;
    } catch (err) {
        console.error('  ❌  Không tải được từ điển Nối Từ:', err.message);
        dict = new Map();
        return false;
    }
}
function _countPairs() {
    let n = 0;
    for (const set of dict.values()) n += set.size;
    return n;
}

/** Kiểm tra một cụm từ có phải là TỪ GHÉP 2 TIẾNG có nghĩa trong từ điển không. */
function isValidCompound(rawWord) {
    const syls = splitSyllables(rawWord);
    if (syls.length !== 2) return { valid: false, reason: 'phai_2_tieng' };
    const set = dict.get(stripDiacritics(syls[0]));
    if (!set || !set.has(stripDiacritics(syls[1]))) {
        return { valid: false, reason: 'vo_nghia' };
    }
    return { valid: true, first: syls[0], last: syls[1] };
}

function lastSyllable(w) {
    const s = splitSyllables(w);
    return s.length ? s[s.length - 1] : '';
}

function dictionaryReady() {
    return !!dict && dict.size > 0;
}

module.exports = {
    TURN_TIMEOUT_MS,
    loadDictionary,
    dictionaryReady,
    isValidCompound,
    lastSyllable,
    splitSyllables,
    stripDiacritics,
};
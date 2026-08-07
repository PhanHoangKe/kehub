/**
 * debtAgentService.js — Backend cho tính năng "Đặc Vụ Đòi Nợ AI"
 *
 * Nhận thông tin người dùng, nhồi vào system prompt "chuyên viên nhắc nợ",
 * gọi Gemini để tạo ra JSON hồ sơ + 3 kịch bản tin nhắn.
 *
 * Cam kết an toàn: prompt tuyệt đối cấm bạo lực / xúc phạm / pháp luật.
 * Nếu AI lỗi (quota, timeout, JSON hỏng) → trả fallback vui vẻ, không crash.
 */

const path = require('path');
const fs = require('fs');
const debtRetrieval = require('./debtRetrieval.js');

// ── Load .env (không cần dotenv) ─────────────────────────────────────────────
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
    fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
        line = line.trim();
        if (!line || line.startsWith('#')) return;
        const eq = line.indexOf('=');
        if (eq < 1) return;
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim();
        if (!process.env[key]) process.env[key] = val;
    });
}

// ── System Prompt "Đặc vụ nhắc nợ" — hài hước sắc cạnh, có "sát thương" ───────
// Điểm mấu chốt: model nhỏ (flash / flash-lite) bám ví dụ cụ thể tốt hơn nhiều
// so với mô tả trừu tượng ("chơi chữ", "vibe GenZ"...). Mỗi phong cách dưới đây
// có 1 câu mẫu thật để model bắt chước đúng "giọng", không lạc qua chung chung.
function buildSystemPrompt() {
    return `Bạn là "Đặc Vụ Thu Hồi Vốn" — bậc thầy soạn tin nhắc nợ kiểu Việt Nam: đòn chí mạng, châm chích đúng chỗ, chữ nghĩa có gai nhưng vẫn bá đạo dễ thương.

SỨ MỆNH:
Nhận hồ sơ một "đối tượng nợ tiền" mà người dùng (chủ nợ) cung cấp, rồi soạn ra 3 kịch bản tin nhắn nhắc nợ theo 3 cấp độ tăng dần: Nhắc khéo → Thâm thúy → Chốt hạ.

GIỚI HẠN ĐỎ (bắt buộc, KHÔNG vượt):
- CẤM tuyệt đối: bạo lực, đe dọa tính mạng/tài sản, lăng mạ, miệt thị, sỉ nhục, nhục mạ, gợi ý làm hại.
- CẤM ép buộc về thể chất, xúi vi phạm pháp luật.
- Mọi câu đả kích phải trong khuôn "chọc ghẹo bạn bè" — độc miệng nhưng không gây thù hằn, người đọc phải bật cười chứ không nổi giận.

CÁC CẤP ĐỘ (escalate rõ rệt, "sát thương" tăng dần):
- "Nhắc khéo": nhẹ nhàng, ngọt ngào, giả vờ quên lãng. Một câu châm chích nhẹ ẩn trong lớp lụa.
- "Thâm thúy": sâu cay, mỉa mai đúng chỗ, dùng phép ẩn dụ "nói lơ nói lóng". Đòn chí mạng giữa dòng.
- "Chốt": chốt deadline rõ ràng, mềm dẻo nhưng cứng cáp, câu cuối phải "đánh dấu vùng nguy hiểm" theo kiểu hài hước.

VÍ DỤ MẪU THEO PHONG CÁCH (bám sát GIỌNG này, không copy nguyên văn — hồ sơ khác thì chi tiết phải khác):
- Cà khịa (mẫu "Thâm thúy"): "Tuấn ơi, 2 triệu mượn mua đồ sinh nhật crush hồi tháng 3, giờ crush đá rồi mà nợ vẫn còn bám dai như đỉa. Trả đi cho nhẹ cả lòng lẫn túi."
- Văn vở (mẫu "Nhắc khéo"): "Người ơi, có những khoản vay như cơn gió thoảng qua đời nhau — 500k của em hôm ấy, giờ đã hoá thành nỗi nhớ khôn nguôi. Ghé về đi anh, để tình ta trọn vẹn."
- GenZ (mẫu "Chốt"): "Bro deadline nợ là thứ 6 này nha, không phải trend đâu mà lướt qua được. Còn 1 triệu thôi mà bro làm em phải nhắc 3 lần rồi, hơi cap á."
- Ngọt ngào (mẫu "Nhắc khéo"): "Chị iu ơi, hôm bữa em cho chị mượn 300k mua sữa cho bé, chắc chị bận quá quên hen. Rảnh chị gửi lại em nha, em thương chị lắm luôn á."
- Lịch sự (mẫu "Chốt"): "Kính gửi anh Long, khoản vay 5 triệu ngày 10/6 hiện đã quá hạn 2 tuần. Rất mong anh sắp xếp hoàn trả trước thứ Sáu tới. Em xin cảm ơn anh rất nhiều ạ."
- Ngẫu hứng: tự chọn gu phù hợp hồ sơ, được trộn phong cách nếu hợp lý, miễn giữ đúng độ "sát thương" của từng cấp độ.

MẸO ĐỂ "SÁT THƯƠNG" (áp dụng bất kể style nào):
- Dùng chi tiết cụ thể từ hồ sơ (tên, lý do nợ, mối quan hệ, số tiền) để trêu chọc đúng người đúng bệnh — như các ví dụ trên đều gắn lý do nợ vào câu chuyện, không nói chung chung.
- Chơi chữ, đồng âm, thành ngữ/tục ngữ Việt biến tấu.
- Đả kích "hành vi quên nợ" chứ không đả kích con người.
- Câu ngắn, nhịp nhanh, có điểm dừng gây cười ở cuối.
- Chèn tình huống giả tưởng hài (vd: "con nợ mất tích cùng chiếc xe", "sếp của tiền đang khóc").

YÊU CẦU VĂN:
- Mỗi kịch bản 2-4 câu, tự nhiên như người thật nhắn tin, gọi tên con nợ.
- Lồng lý do nợ + mối quan hệ vào câu chuyện — đây là phần quan trọng nhất để câu không bị nhạt.
- Chữ nghĩa sắc bén, TUYỆT ĐỐI không dùng khuôn mẫu chung chung như "bạn ơi nhớ trả nợ nhé", "mong bạn sớm hoàn trả".

ĐỊNH DẠNG TRẢ VỀ (bắt buộc JSON, KHÔNG thêm chữ):
{
  "agent_name": "tên bịa cho ngầu (vd: 'Đại Tá Khéo Léo' hoặc 'Cáo Già Hài Hước')",
  "risk_assessment": "một câu đánh giá mức nhây, có số % hoặc cấp độ, khéo léo (vd: Nhây độ 78 trên 100, cứng đầu nhưng dễ lay khi vào gu)",
  "messages": [
    { "title": "Nhắc khéo", "text": "..." },
    { "title": "Thâm thúy", "text": "..." },
    { "title": "Chốt", "text": "..." }
  ]
}

message.title nhận MỘT trong: "Nhắc khéo", "Thâm thúy", "Chốt". 
message.text là nội dung tin nhắn hoàn chỉnh mà chủ nợ copy đi gửi.`;
}

// ── Build user content từ hồ sơ người dùng + câu retrieval (RAG) ───────────
function buildUserText(p, ribs) {
    const lines = [
        'HỒ SƠ ĐỐI TƯỢNG CẦN THU HỒI:',
        `- Tên: ${p.debtor || 'chưa rõ'}`,
        `- Số tiền: ${p.money || `${p.amount || '?'} ${p.currency || ''}`}`,
        `- Lý do nợ: ${p.reason || 'không rõ'}`,
        `- Mối quan hệ: ${p.relationship || 'người quen'}`,
        `- Phong cách đòi: ${p.style || 'cà khịa'}`,
        '',
    ];
    if (Array.isArray(ribs) && ribs.length) {
        lines.push('KHO CÂU HÀI ĐÃ TRA CỨU (retrieval — dùng làm chất liệu "may đo", ĐỪNG bịa thêm từ hư vô):');
        ribs.forEach((r, i) => {
            lines.push(`  T${i + 1}. ${r.text} (tag: ${(r.tags || []).join(', ')}, chủ đề: ${r.topic || 'tổng hợp'})`);
        });
        lines.push('');
        lines.push('Nhiệm vụ của bạn: chọn/biến tấu 1-2 câu trong kho phù hợp nhất với phong cách + hồ sơ trên, khâu tên, số tiền, lý do nợ vào để thành tin nhắn "may đo". Nếu kho không có câu hợp, hãy dùng giọng điệu/cấu trúc của câu gần nhất rồi tự bịa thêm cho mướt.');
    } else {
        lines.push('Kho câu hài hiện trống — bạn tự sáng tác theo phong cách đã chọn, nhớ tuân các mẹo "sát thương" trong system prompt.');
    }
    return lines.join('\n');
}

// ── Gọi Gemini REST (JSON) ──────────────────────────────────────────────────
// Lưu ý: temperature/top_p/top_k đã bị Google đánh dấu deprecated cho các model
// Gemini 3.x đời mới — vẫn có thể còn hoạt động (back-compat) nhưng không đảm
// bảo lâu dài. thinking_level thay cho việc set độ "suy nghĩ sâu" của model;
// với task sáng tạo câu chữ ngắn thì để "low" là đủ, không cần reasoning sâu.
async function callLLM(systemPrompt, userText, temperature = 1.0, maxOutputTokens = 2048) {
    const key = process.env.GOOGLE_API_KEY;
    if (!key) throw new Error('Thiếu GOOGLE_API_KEY');
    // flash-lite là tier rẻ/nhanh nhất, không mạnh về sáng tạo văn phong tiếng Việt.
    // Dùng flash bản thường cho task này; có thể đổi lại flash-lite nếu cần tiết kiệm.
    const model = process.env.DEBT_AGENT_MODEL || process.env.GOOGLE_LLM_MODEL || 'gemini-3.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

    const body = {
        contents: [{ parts: [{ text: userText }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            temperature,
            maxOutputTokens,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingLevel: 'low' },
        },
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    // Quota 429 → retry 1 lần sau 25s
    if (res.status === 429) {
        const retryAfter = parseInt(res.headers?.get('retry-after') || '0', 10);
        const waitMs = Math.max(retryAfter * 1000 || 25000, 25000);
        console.warn(`  [Debt-Agent] Quota 429 — retry sau ${waitMs / 1000}s`);
        await new Promise(r => setTimeout(r, waitMs));
        const res2 = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data2 = await res2.json();
        if (!res2.ok) throw new Error(`Gemini lỗi ${res2.status}: ${data2?.error?.message || JSON.stringify(data2)}`);
        return extractText(data2);
    }

    const data = await res.json();
    if (!res.ok) throw new Error(`Gemini lỗi ${res.status}: ${data?.error?.message || JSON.stringify(data)}`);
    return extractText(data);
}

function extractText(data) {
    const parts = data?.candidates?.[0]?.content?.parts || [];
    return parts.map(p => p.text || '').join('').trim();
}

// ── Parse + validate schema (chịu khuyết, cho phép fallback per-field) ───────
function safeParseJson(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    // Cắt nếu LLM bọc trong ```json ... ```
    let s = raw.trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fence) s = fence[1].trim();
    try {
        return JSON.parse(s);
    } catch {
        // fallback: bóc cặp {} ngoài cùng
        const idx = s.indexOf('{');
        if (idx >= 0) {
            try {
                return JSON.parse(s.slice(idx));
            } catch { /* noop */ }
        }
        return null;
    }
}

function validateSchema(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const result = {
        agent_name: typeof obj.agent_name === 'string' ? obj.agent_name : null,
        risk_assessment: typeof obj.risk_assessment === 'string' ? obj.risk_assessment : null,
        message: [],
    };
    const list = Array.isArray(obj.messages) ? obj.messages : (Array.isArray(obj.message) ? obj.message : []);
    result.message = list.slice(0, 3).map(m => ({
        title: typeof m?.title === 'string' ? m.title : ['Nhắc khéo', 'Thâm thúy', 'Chốt'][list.indexOf(m)] || 'Nhắc khéo',
        text: typeof m?.text === 'string' ? m.text : '',
    })).filter(m => m.text);
    return result;
}

// ── Fallback bài (nếu LLM lỗi / JSON hỏng) — vẫn vui vẻ, cụ thể hơn bản gốc ──
function buildFallback(p) {
    const money = p.money || ((raw) => { const n = parseInt(String(raw ?? '').replace(/[^\d]/g, ''), 10); return n ? n.toLocaleString('vi-VN') + ' VNĐ' : (raw || '?'); })(p.amount);
    const who = p.debtor || 'bạn';
    const rel = p.relationship || 'người quen';
    const reason = p.reason ? ` (vụ ${p.reason} đó)` : '';
    return [
        { title: 'Nhắc khéo', text: `${who} ơi, mình giờ mới nhớ có ${money}${reason} đang lang thang trong túi ${rel} của mình. Bạn giúp mình nhớ lại xem sao nha!` },
        { title: 'Thâm thúy', text: `Nghe nói ${who} dạo này bận lắm nên chắc quên mất khoản ${money}${reason} rồi. Mình thì không bận, mình chỉ đang chờ thôi.` },
        { title: 'Chốt', text: `${who} ơi, chốt luôn cho mình: ${money}${reason} về nhà cuối tuần này nha. Trễ nữa là mình phải nhắc bằng caption story đó!` },
    ];
}

/**
 * generateDebtKit — API chính.
 * @param {object} p  — { debtor, amount, currency, reason, relationship, style }
 * @returns {Promise<{agent_name, risk_assessment, message: []}>}
 * KHÔNG THỂ throw — luôn trả về dữ liệu dùng được (fallback).
 */
// ── Mã hồ sơ ────────────────────────────────────────────────────────────────
function makeCaseCode() {
    const n = Date.now().toString(36).toUpperCase();
    return 'CASE-' + n.slice(-6);
}

async function generateDebtKit(p) {
    // RAG: tra cứu câu hài gần hồ sơ nhất (không để AI bịa từ hư vô)
    let ribs = [];
    try {
        ribs = await debtRetrieval.retrieve(p, 4);
    } catch (err) {
        console.warn('  [Debt-Agent] Retrieval lỗi, bỏ qua:', err.message);
    }
    const userText = buildUserText(p, ribs);
    const fallbackHint = buildFallback(p);

    try {
        const raw = await callLLM(buildSystemPrompt(), userText, 1.0, 2048);
        const parsed = safeParseJson(raw);
        const validated = validateSchema(parsed);

        // Nếu kịch bản thiếu → fill từ fallback
        validated.agent_name = validated.agent_name || `Đặc Vụ ${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        validated.risk_assessment = validated.risk_assessment || 'Nhây độ thẩm định: cỡ 7/10, ngại move.';
        validated.message = validated.message.length
            ? fillMissingMessages(validated.message, fallbackHint)
            : fallbackHint;

        return { ok: true, case_code: makeCaseCode(), ...validated };
    } catch (err) {
        console.error('  [d-Agent] LLM lỗi, dùng fallback:', err.message);
        return {
            ok: false,
            case_code: makeCaseCode(),
            agent_name: 'Đặc Vụ',
            risk_assessment: 'Nhây độ: không xác định vì mạng đi vắng. Cứ gửi vui vẻ thôi.',
            message: fallbackHint,
            error: err.message,
        };
    }
}

function fillMissingMessages(list, fallback) {
    const need = 3 - list.length;
    const existing = list.map(m => m.title);
    let fi = 0;
    while (need > 0 && fi < fallback.length) {
        if (!existing.includes(fallback[fi].title)) {
            list.push(fallback[fi]);
        }
        fi++;
    }
    return list;
}

module.exports = { generateDebtKit, buildSystemPrompt, buildFallback, splitRibText };

/**
 * splitRibText — Dán cả đống chữ (copy từ Google/mạng), AI tự tách thành từng
 * câu hài riêng lẻ kèm chủ đề, tag, độ sát thương để đưa vào kho RAG.
 * @param {string} text — văn bản thô (nhiều dòng/câu)
 * @returns {Promise<Array<{text, topic, degree, tags}>>} — KHÔNG throw (trả [] khi lỗi)
 */
async function splitRibText(text) {
    const input = String(text || '').trim();
    if (!input) return [];
    const system = `Bạn là người quản lý "kho câu hài nhắc nợ" cho một app Đặc Vụ Đòi Nợ AI.
Người dùng cung cấp một văn bản thô (thường copy từ Google, nhiều dòng, có thể lộn xộn, có giới thiệu, câu hỏi tu từ...).

Nhiệm vụ: TÁCH văn bản thành từng CÂU/CMT giữ lại được (câu hài, câu châm chích, câu nhắc nợ kiểu vui). Với mỗi câu, gắn metadata.

Câu nào KHÔNG phải nội dung hài nhắc nợ (vd câu giới thiệu bài viết, cảm thán rời rạc "ôm", "haha", câu hỏi của tác giả, lời quảng cáo) thì BỎ đi. Giữ câu nguyên văn, tối đa 60 từ, cắt gọn những chỗ rườm rà.

Xuất ra JSON array (bắt buộc, không kèm chữ):
[
  {
    "text": "nội dung câu hài (có thể gồm nhiều câu nhỏ nhưng là 1 cwomenh đề chọc)",
    "topic": "chủ đề/tình huống ngắn gọn (vd: bạn thân vay xe, nợ sang chương, tham ăn béo...)",
    "degree": "Nhẹ | Vừa | Nặng",
    "tags": ["tag1", "tag2", "tag3"]  // 2-4 tag mô tả: phong cách (cà khịa/văn vở/genz/ngọt/ngẫu hứng), đối tượng, chủ đề...
  }
]

Chỉ xuất JSON array hợp lệ. Nếu không tách được câu nào thì trả [].
degree' chấm điểm độ châm chích: Nhẹ (dễ thương), Vừa (cay nhẹ), Nặng (đòn chí mạng nhưng vẫn trong khuôn chọc ghẹo).`;

    try {
        const raw = await callLLM(system, input, 0.7, 8000);
        const arr = safeParseJson(raw);
        if (!Array.isArray(arr)) {
            // có thể LLM bọc {items:[...]}
            const wrap = safeParseJson(raw);
            const list = wrap && Array.isArray(wrap.items) ? wrap.items : null;
            return (list || []).map(normalize).filter(Boolean);
        }
        return arr.map(normalize).filter(Boolean);
    } catch (err) {
        console.error('  [Debt-Agent] splitRibText lỗi:', err.message);
        return null;
    }
}

function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const text = String(raw.text || '').trim();
    if (!text || text.length < 6) return null;
    const degree = ['Nhẹ', 'Vừa', 'Nặng'].includes(raw.degree) ? raw.degree : 'Vừa';
    const tags = Array.isArray(raw.tags)
        ? raw.tags.map(t => String(t).trim()).filter(t => t && t.length <= 40).slice(0, 6)
        : [];
    return { text, topic: String(raw.topic || '').trim().slice(0, 40), degree, tags };
}
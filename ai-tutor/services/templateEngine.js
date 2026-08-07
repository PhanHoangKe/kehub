/**
 * templateEngine.js — Tầng 2: "Cache công thức" (Template Tier)
 *
 * Khác với Tầng 1 (cache đáp án), tầng này:
 *   1. Gọi LLM MỘT LẦN với temp=0.0 để nhận diện "đây là dạng bài nào"
 *      (trong registry mathFormulas) + trích các tham số số học.
 *   2. Chạy solver JS đã kiểm định (KHÔNG để model tự viết công thức).
 *   3. Trả lời giải được build từ explain() — nhanh ngang cache hit,
 *      nhưng generalize cho mọi biến thể đổi số.
 *
 * KHÔNG throw khi không khớp template → trả null để rơi xuống consensus.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

import { TEMPLATES } from './mathFormulas.js';

// ── Prompt cho LLM: nhận diện dạng + trích tham số ────────────────────────────
function buildDetectPrompt(question) {
  const catalog = TEMPLATES.map((t, i) =>
    `DẠNG ${i + 1} (slug: ${t.slug}): ${t.name}\n` +
    `   Mô tả: ${t.description}\n` +
    `   Tham số cần trích: ${Object.entries(t.params).map(([k, v]) => `${k}=${v}`).join(', ')}`
  ).join('\n\n');

  return `Bạn là trợ lý nhận diện dạng bài Toán hình học không gian THPT Việt Nam.

ĐỀ BÀI:
---
${question}
---

DANH SÁCH CÁC DẠNG BÀI CÓ SẴN TRONG HỆ THỐNG:
${catalog}

NHIỆM VỤ:
1. Xác định đề bài thuộc dạng nào trong danh sách trên.
2. Nếu KHÔNG khớp rõ ràng bất kỳ dạng nào → trả {"matched": false}.
3. Nếu khớp → trích CHÍNH XÁC các tham số số học từ đề (đọc kỹ số liệu, có thể xuất hiện dạng "1,5 cm" hay "10,4 cm"). Mọi tham số đều là SỐ, viết dạng thập phân không dấu phẩy (dùng dấu chấm). Bỏ đơn vị.

⚠️ QUY TẮC BẮT BUỘC:
- Chỉ trả về JSON. Không thêm chữ nào ngoài JSON.
- Nếu thiếu tham số bắt buộc → trả matched=false (đừng bịa số).
- Nếu phân vân giữa 2 dạng → chọn dạng khớp nhất, hoặc matched=false nếu không rõ.

ĐỊNH DẠNG JSON:
${JSON.stringify({
  matched: true,
  slug: 'tên slug trong danh sách (ví dụ frustum_square_minus_cap)',
  params: { a: 10.4, b: 7.4, h: 1.5, R: 5.8, r: 3.5 },
  confidence: 'high|medium|low',
})}`;
}

function parseDetectJson(text) {
  let s = String(text ?? '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) s = fence[1].trim();
  const tryParse = (str) => { try { return JSON.parse(str); } catch { return null; } };
  const direct = tryParse(s);
  if (direct) return direct;
  // Cắt JSON đầu tiên
  const s0 = s.indexOf('{');
  if (s0 !== -1) {
    const s1 = s.lastIndexOf('}');
    if (s1 > s0) {
      const cut = tryParse(s.slice(s0, s1 + 1));
      if (cut) return cut;
    }
    // Gemini thỉnh thoảng cắt đuôi JSON (thiếu ')}}' cuối). Tự sửa bằng cách
    // đếm brace cần đóng và append vào cuối để cân bằng.
    let depth = 0, inStr = false, esc = false, end = s.length;
    for (let i = s0; i < s.length; i++) {
      const ch = s[i];
      if (esc) { esc = false; continue; }
      if (inStr) { if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth === 0) { end = i + 1; break; }
    }
    let candidate = s.slice(s0, end);
    for (let k = 0; k < 5; k++) { // đóng tối đa 5 brace
      const p = tryParse(candidate);
      if (p) return p;
      candidate += '}';
    }
  }
  return null;
}

/**
 * trySolveTemplate — điểm vào Tầng 2.
 * @param {string} question — đề bài (text/LaTeX đã bóc tách)
 * @returns {Promise<null | {source:'template', slug, name, answer, final_answer, params, latencyMs}>}
 */
export async function trySolveTemplate(question) {
  if (!process.env.GOOGLE_API_KEY) return null;
  const model = process.env.AI_TUTOR_MODEL || process.env.GOOGLE_LLM_MODEL || 'gemini-3.5-flash';
  const key = process.env.GOOGLE_API_KEY;

  const start = Date.now();
  let raw;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: question }] }],
          systemInstruction: { parts: [{ text: buildDetectPrompt(question) }] },
          generationConfig: { temperature: 0.0, maxOutputTokens: 2048, responseMimeType: 'application/json' },
        }),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(`Gemini lỗi ${res.status}: ${data?.error?.message ?? ''}`);
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    raw = parts.map(p => p.text ?? '').join('').trim();
  } catch (err) {
    console.warn('  ⚠️  [Template] detect lỗi, bỏ qua:', err.message);
    return null;
  }

  const parsed = parseDetectJson(raw);
  if (!parsed || parsed.matched !== true) return null;

  const template = TEMPLATES.find(t => t.slug === parsed.slug);
  if (!template) return null;

  const params = parsed.params && typeof parsed.params === 'object' ? parsed.params : {};
  // Giữ lại template nếu confidence quá thấp — an toàn hơn là tính sai
  if (parsed.confidence === 'low') {
    console.warn('  ⚠️  [Template] confidence low, bỏ qua để dùng consensus');
    return null;
  }

  // Chạy solver — KHÔNG thể sai nếu tham số đúng
  try {
    const result = template.solve(params);
    if (result == null || !Number.isFinite(result.V ?? result.value ?? NaN)) {
      console.warn('  ⚠️  [Template] solver trả NaN, bỏ qua');
      return null;
    }
    const answer = template.explain(params, result);
    return {
      source: 'template',
      slug: template.slug,
      name: template.name,
      answer,
      final_answer: String(result.V ?? result.value),
      params,
      result,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    console.warn('  ⚠️  [Template] solver/explain lỗi:', err.message);
    return null;
  }
}

// ── Self-test nhận diện: chỉ kiểm tra prompt/parse không crash ────────────────
export function detectPromptSmoke() {
  const p = buildDetectPrompt('Chóp cụt 10,4 7,4 1,5 chỏm cầu 5,8 3,5');
  return p.length > 50;
}

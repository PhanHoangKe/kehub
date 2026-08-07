/**
 * visionService.js — Gemini Vision: đọc ảnh đề bài Toán
 *
 * Luồng:
 *   1. Nhận buffer ảnh (jpg/png/webp) từ multer
 *   2. Gọi Gemini với HumanMessage chứa [image_url part + text prompt]
 *   3. Trả về chuỗi LaTeX/text đã bóc tách từ ảnh
 *   4. Controller dùng chuỗi này làm đầu vào cho searchCache → askLLM
 *
 * Không cần lưu ảnh xuống disk — xử lý hoàn toàn trong RAM (buffer).
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

// ── Prompt để bóc tách đề toán từ ảnh / PDF ──────────────────────────────────
const EXTRACT_PROMPT = `Bạn là chuyên gia nhận dạng đề bài Toán THPT Việt Nam từ hình ảnh hoặc tài liệu PDF.

Nhiệm vụ:
1. Đọc toàn bộ nội dung Toán học trong ảnh hoặc PDF.
2. Nếu là PDF nhiều trang, trích xuất nội dung các trang có đề bài (nếu là đề kiểm tra gồm nhiều trang).
3. Trả về văn bản thuần túy, viết lại công thức bằng LaTeX chuẩn (dùng $...$ inline, $$...$$ block).
4. Giữ nguyên cấu trúc: câu hỏi, các ý a/b/c, số liệu, điều kiện.
5. Nếu có nhiều câu, đánh số rõ ràng: Câu 1, Câu 2...
6. KHÔNG giải bài — chỉ bóc tách và viết lại nội dung đề.
7. Nếu nội dung không phải đề Toán hoặc không đọc được, trả về: "KHÔNG_ĐỌC_ĐƯỢC"

Chỉ trả về nội dung đề, không thêm lời giải thích.`;

/**
 * extractMathFromImage — bóc tách nội dung toán từ buffer ảnh hoặc PDF
 *
 * @param {Buffer} imageBuffer  — raw bytes của ảnh hoặc PDF
 * @param {string} mimeType     — 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'
 * @returns {Promise<string>}   — đề toán dạng text+LaTeX, hoặc throw nếu lỗi
 */
export async function extractMathFromImage(imageBuffer, mimeType = 'image/jpeg') {
  if (!process.env.GOOGLE_API_KEY) throw new Error('Thiếu GOOGLE_API_KEY');

  // Gemini Vision — gọi trực tiếp REST API (không qua LangChain)
  // để kiểm soát hoàn toàn cấu trúc multipart request
  const model = process.env.GOOGLE_VISION_MODEL || 'gemini-1.5-flash';
  const key   = process.env.GOOGLE_API_KEY;

  const base64Image = imageBuffer.toString('base64');

  const payload = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: mimeType,
            data: base64Image,
          },
        },
        {
          text: EXTRACT_PROMPT,
        },
      ],
    }],
    generationConfig: {
      temperature: 0.1,   // rất thấp → bóc tách chính xác, không sáng tạo
      maxOutputTokens: 1024,
    },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gemini Vision API lỗi ${res.status}: ${err?.error?.message ?? res.statusText}`);
  }

  const data = await res.json();

  // Lấy text từ response
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!text) throw new Error('Gemini Vision trả về response rỗng');

  const trimmed = text.trim();
  if (trimmed === 'KHÔNG_ĐỌC_ĐƯỢC') {
    throw new Error('Không thể đọc đề toán từ ảnh này. Vui lòng chụp rõ hơn hoặc nhập thủ công.');
  }

  return trimmed;
}

/**
 * validateImageBuffer — kiểm tra magic bytes để đảm bảo đúng định dạng ảnh
 * Tránh user upload file giả mạo extension
 *
 * @param {Buffer} buf
 * @returns {{ valid: boolean, mimeType: string }}
 */
export function validateImageBuffer(buf) {
  if (!buf || buf.length < 4) return { valid: false, mimeType: '' };

  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
    return { valid: true, mimeType: 'image/jpeg' };
  }
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
    return { valid: true, mimeType: 'image/png' };
  }
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
    return { valid: true, mimeType: 'image/webp' };
  }

  return { valid: false, mimeType: '' };
}

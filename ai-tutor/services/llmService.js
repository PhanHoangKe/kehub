/**
 * llmService.js — Gọi LLM khi cache miss
 *
 * Hỗ trợ:
 *   • Google Gemini (gemini-1.5-flash / gemini-1.5-pro)
 *   • OpenAI GPT (gpt-4o-mini / gpt-4o)
 *
 * System prompt được tối ưu cho bài toán Toán THPT tiếng Việt,
 * trả lời LaTeX chuẩn để frontend có thể render bằng KaTeX/MathJax.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

// ── System Prompt chuẩn cho Gia sư Toán THPT ────────────────────────────────
const MATH_SYSTEM_PROMPT = `Bạn là một gia sư Toán THPT chuyên nghiệp tại Việt Nam.
Nhiệm vụ của bạn là giải thích và giải các bài toán Toán THPT một cách rõ ràng, chính xác.

Quy tắc trả lời:
1. Luôn viết công thức toán học bằng LaTeX, đặt trong dấu $...$ (inline) hoặc $$...$$ (block).
2. Trình bày theo từng bước, đánh số rõ ràng (Bước 1, Bước 2...).
3. Giải thích lý do của từng bước biến đổi.
4. Nếu bài có nhiều cách giải, đề cập cách ngắn gọn nhất.
5. Kết thúc bằng một dòng tóm tắt kết quả, ví dụ: "Vậy đáp án là $x = 3$."
6. Trả lời bằng tiếng Việt, sử dụng ngôn ngữ gần gũi với học sinh.
7. Không bịa đặt đáp án nếu không chắc chắn — hãy nói thẳng.`;

// ── Singleton LLM ─────────────────────────────────────────────────────────────
let _llm = null;

/**
 * buildLLM — tạo instance LLM với cấu hình tùy chỉnh.
 * @param {object} opts
 * @param {number} opts.temperature         — 0..1, thấp = nhất quán hơn
 * @param {number} opts.maxOutputTokens     — giới hạn token phản hồi
 */
async function buildLLM({ temperature = 0.2, maxOutputTokens = 2048 } = {}) {
  const provider = (process.env.LLM_PROVIDER || 'google').toLowerCase();

  if (provider === 'openai') {
    const { ChatOpenAI } = await import('@langchain/openai');
    if (!process.env.OPENAI_API_KEY) throw new Error('Thiếu OPENAI_API_KEY');
    return new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_LLM_MODEL || 'gpt-4o-mini',
      temperature,
      maxTokens: maxOutputTokens,
    });
  }

  // Mặc định: Google Gemini
  const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
  if (!process.env.GOOGLE_API_KEY) throw new Error('Thiếu GOOGLE_API_KEY');
  return new ChatGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_API_KEY,
    model: process.env.AI_TUTOR_MODEL || process.env.GOOGLE_LLM_MODEL || 'gemini-3.5-flash',
    temperature,
    maxOutputTokens,
  });
}

async function getLLM() {
  if (!_llm) _llm = await buildLLM();
  return _llm;
}

/**
 * contentToText — trích xuất chuỗi text từ response.content của LangChain
 * (content có thể là string hoặc array of parts).
 */
function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === 'string' ? part : part?.text ?? ''))
      .join('');
  }
  return String(content ?? '');
}

/**
 * askLLM — gửi câu hỏi (kèm lịch sử hội thoại) đến LLM và nhận đáp án.
 *
 * @param {string} question  — câu hỏi mới nhất (dạng text hoặc LaTeX)
 * @param {Array<{role: 'user'|'model', parts: [{text: string}]}>} [history=[]]
 *                            — các lượt hội thoại trước đó (đã được parseHistory chuẩn hóa)
 * @returns {Promise<string>} — đáp án dạng Markdown + LaTeX
 */
export async function askLLM(question, history = []) {
  const llm = await getLLM();

  const { HumanMessage, AIMessage, SystemMessage } = await import('@langchain/core/messages');

  // Xây dựng mảng messages theo chuẩn LangChain:
  //   [System] + [lịch sử: Human/AI xen kẽ] + [Human (câu hỏi mới nhất)]
  const messages = [new SystemMessage(MATH_SYSTEM_PROMPT)];

  for (const turn of history ?? []) {
    if (turn?.role === 'model') {
      messages.push(new AIMessage(turn.parts?.[0]?.text ?? ''));
    } else {
      messages.push(new HumanMessage(turn.parts?.[0]?.text ?? ''));
    }
  }

  messages.push(new HumanMessage(question));

  const response = await llm.invoke(messages);

  // Chuẩn hóa: lấy text từ content (string hoặc array of parts)
  return contentToText(response.content);
}

// ══════════════════════════════════════════════════════════════════════════════
//  CONSENSUS + CRITIC — chặn "ảo giác" khi cache miss
// ══════════════════════════════════════════════════════════════════════════════

// ── Prompt cho SOLVER (Người giải) — tối ưu cho Đại số + Code + Hình học ────
// Nhiệm vụ: xử lý Đại số bằng Native Code Execution, Hình học linh hoạt, ÉP JSON.
const SOLVER_SYSTEM_PROMPT = `Bạn là một Giáo viên Toán THPT xuất sắc và tận tâm tại Việt Nam. Bạn xưng hô là "Thầy/Cô" và gọi người dùng là "em/học sinh". Nhiệm vụ của bạn là giải chi tiết các bài toán bám sát chương trình và barem chấm điểm của Bộ GD&ĐT Việt Nam.

⚠️ QUY TẮC ĐỊNH DẠNG BẮT BUỘC (CRITICAL):
Bạn PHẢI trả lời duy nhất bằng một đối tượng JSON hợp lệ, không chứa bất kỳ văn bản nào nằm ngoài JSON. Không dùng markdown bọc block code (không dùng \`\`\`json).
Cấu trúc JSON bắt buộc:
{
  "step_by_step": "Toàn bộ lời giải chi tiết, xưng hô Thầy/Cô, giải thích cặn kẽ từng bước. Sử dụng LaTeX chuẩn cho mọi công thức toán học ($ cho inline, $$ cho block).",
  "final_answer": "Chỉ chứa kết quả số học hoặc tập nghiệm cuối cùng cực kỳ ngắn gọn (vd: x = 2; m \\in [1; 3]; \\frac{a\\sqrt{3}}{2}). Chuẩn hóa không có dấu cách thừa để máy dễ so sánh."
}

Bạn có quyền và NÊN dùng công cụ Code Execution (chạy Python) để tính toán / kiểm chứng trước khi viết vào lời giải.

CHIẾN THUẬT GIẢI TOÁN:
1. ĐẠI SỐ & GIẢI TÍCH (Phương trình, Đạo hàm, Tích phân, Mũ/Logarit...):
   - TUYỆT ĐỐI KHÔNG TỰ NHẨM NGHIỆM. Gọi Code Execution để giải phương trình, tính toán số học, hoặc thử lại nghiệm trước khi viết vào step_by_step.
   - Trình bày rõ điều kiện xác định (ĐKXĐ) trước khi biến đổi.
2. HÌNH HỌC KHÔNG GIAN (Lớp 11, 12):
   - Nếu bài cơ bản (giải dưới 4 bước): dùng hình học không gian thuần túy (Pytago, Talet, hệ thức lượng, tỉ số thể tích). Tránh dùng Tọa độ hóa cho bài dễ.
   - Nếu bài phức tạp (khoảng cách 2 đường chéo nhau, góc giữa mặt phẳng, thể tích khối chóp khó): DÙNG PHƯƠNG PHÁP TỌA ĐỘ HÓA (Oxyz). Chọn gốc O hợp lý, trình bày rõ tọa độ các đỉnh, và dùng Code Execution tính tích có hướng, vô hướng, khoảng cách để đảm bảo không sai số.

Văn phong sư phạm, thân thiện, khuyến khích học sinh, không nói "dễ dàng thấy rằng".`;

// ── Prompt cho CRITIC (giám khảo phản biện 2 lời giải A/B) ──────────────────
const CRITIC_SYSTEM_PROMPT = `Bạn là Tổ trưởng Bộ môn Toán THPT, đóng vai Giám khảo (Critic) cực kỳ khắt khe và công tâm.
Hệ thống nhận được 1 bài toán và có 2 giáo viên (Giáo viên A và Giáo viên B) đưa ra lời giải có kết quả khác nhau.

Nhiệm vụ: đọc kỹ Đề bài, phân tích từng bước của Lời giải A và B để CHỈ RA LỖI SAI (sai công thức, sai logic, quên điều kiện, sai dấu, hoặc tính toán sai).

⚠️ QUY TẮC ĐỊNH DẠNG BẮT BUỘC:
Trả về DUY NHẤT một đối tượng JSON hợp lệ, không dùng markdown \`\`\`json.
Cấu trúc JSON bắt buộc:
{
  "verdict": "CHỈ được điền 1 trong 3 giá trị: 'A_CORRECT', 'B_CORRECT', hoặc 'BOTH_WRONG'",
  "critic_comment": "Nhận xét phân tích ngắn gọn, chỉ rõ điểm sai của lời giải bị loại (hoặc sai của cả hai). Giải thích lý do theo chuẩn Toán THPT."
}`;

/**
 * parseLLMJson — Parse JSON từ response của LLM, đề phòng LLM trả markdown ```json.
 * @param {string} text
 * @returns {object}
 */
export function parseLLMJson(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Phản hồi LLM rỗng, không thể parse JSON.');
  }
  let cleaned = text.trim();
  // Bỏ khối markdown ```json ... ``` nếu có
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    cleaned = fence[1].trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    // Lần cuối: cắt từ { đầu tiên đến } cuối cùng (trong trường hợp LLM thêm chữ)
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* fallthrough */
      }
    }
    throw new Error('LLM trả về không phải JSON hợp lệ.');
  }
}

/**
 * validateSolveSchema — kiểm tra object JSON của SOLVER đủ schema.
 * @param {object} obj
 * @returns {boolean}
 */
function validateSolveSchema(obj) {
  return !!obj && typeof obj === 'object' &&
    typeof obj.step_by_step === 'string' && obj.step_by_step.trim().length > 0 &&
    typeof obj.final_answer === 'string' && obj.final_answer.trim().length > 0;
}

/**
 * callGeminiRest — gọi thẳng Gemini REST API (bỏ wrapper LangChain).
 *
 * Lý do: @langchain/google-genai 0.1.8 KHÔNG hỗ trợ bật công cụ native
 * `{ codeExecution: {} }` (convertToGenerativeAITools chỉ xử lý functionDeclarations).
 * Muốn dùng Native Code Execution + ép JSON thì phải gọi REST như visionService.
 *
 * @param {object} opts
 * @param {string} opts.systemPrompt   — system instruction
 * @param {string} opts.userText       — nội dung lượt human (đã gộp history nếu cần)
 * @param {number} [opts.temperature]  — mặc định 0.2
 * @param {number} [opts.maxOutputTokens] — mặc định 4096
 * @param {boolean} [opts.codeExecution]  — bật Native Code Execution
 * @param {boolean} [opts.json]        — ép responseMimeType application/json
 * @returns {Promise<string>} — text thô từ model
 */
async function callGeminiRest({ systemPrompt, userText, temperature = 0.2, maxOutputTokens = 4096, codeExecution = false, json = true }) {
  if (!process.env.GOOGLE_API_KEY) throw new Error('Thiếu GOOGLE_API_KEY');
  const model = process.env.AI_TUTOR_MODEL || process.env.GOOGLE_LLM_MODEL || 'gemini-3.5-flash';
  const key   = process.env.GOOGLE_API_KEY;

  const body = {
    contents: [{ parts: [{ text: userText }] }],
    generationConfig: {
      temperature,
      maxOutputTokens,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }
  // Native Code Execution — Gemini tự chạy Python nội bộ
  if (codeExecution) {
    body.tools = [{ codeExecution: {} }];
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  // Quota 429 → retry tối đa 2 lần với backoff (30s, 60s) — không văng lỗi ngay
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers?.get('retry-after') ?? '0', 10);
    const waitMs = Math.max(retryAfter * 1000 || 30000, 30000);
    console.warn(`  ⚠️  [Gemini] Quota 429 — retry sau ${waitMs / 1000}s`);
    await new Promise(r => setTimeout(r, waitMs));
    const res2 = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    const data2 = await res2.json();
    if (!res2.ok) {
      throw new Error(`Gemini REST lỗi ${res2.status}: ${data2?.error?.message ?? JSON.stringify(data2)}`);
    }
    const parts2 = data2?.candidates?.[0]?.content?.parts ?? [];
    const text2 = parts2.map(p => p.text ?? '').join('');
    if (!text2.trim()) throw new Error('Gemini REST không trả về nội dung (retry): response rỗng');
    return text2.trim();
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Gemini REST lỗi ${res.status}: ${data?.error?.message ?? JSON.stringify(data)}`);
  }

  // Gộp mọi text part (codeExecution có thể xen kẽ) — lấy phần text cuối cùng
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map(p => p.text ?? '').join('');
  if (!text.trim()) throw new Error('Gemini REST không trả về nội dung: ' + (data?.error?.message ?? 'response rỗng'));
  return text.trim();
}

/**
 * invokeSolver — gọi 1 solver (REST trực tiếp, có Code Execution), trả JSON đã validate.
 * @param {string} question  — câu hỏi
 * @param {Array}  history   — lịch sử hội thoại
 * @param {number} temperature — 0..1, thấp = nhất quán hơn
 * @param {object} [ctx]     — { topic, difficulty } người dùng chọn trên UI
 * @returns {Promise<object>} — { step_by_step, final_answer }
 */
async function invokeSolver(question, history, temperature = 0.2, ctx = {}) {
  // Gộp lịch sử ngắn gọn vào đầu userText để giữ ngữ cảnh khi gọi REST 1 lượt
  const historyText = (history ?? [])
    .slice(-4)
    .map(t => {
      const who = t?.role === 'model' ? 'Thầy/Cô' : 'Học sinh';
      return `${who}: ${t?.parts?.[0]?.text ?? ''}`;
    })
    .join('\n');

  // Chèn ngữ cảnh chủ đề (topic/difficulty) — giúp solver định hướng đúng cách giải
  const ctxHint = [
    ctx?.topic ? `Chuyên đề: ${ctx.topic}` : '',
    ctx?.difficulty ? `Độ khó: ${ctx.difficulty}` : '',
  ].filter(Boolean).join(' · ');

  const userText = historyText
    ? `${historyText}\n\n---\n\n${ctxHint ? ctxHint + '\n' : ''}Câu hỏi mới:\n${question}`
    : (ctxHint ? ctxHint + '\n' : '') + question;

  const raw = await callGeminiRest({
    systemPrompt: SOLVER_SYSTEM_PROMPT,
    userText,
    temperature,
    maxOutputTokens: 4096,
    codeExecution: true,   // Native Code Execution bật cho SOLVER
    json: true,
  });

  const parsed = parseLLMJson(raw);
  if (!validateSolveSchema(parsed)) {
    throw new Error('Solver trả về JSON thiếu schema (step_by_step / final_answer).');
  }
  return parsed;
}

/**
 * solveWithConsensus — giải bài bằng 2 "solver" độc lập, chạy SONG SONG.
 * Dùng cùng 1 model nhưng khác temperature (0.1 = cẩn thận, 0.7 = sáng tạo).
 *
 * @param {string} question  — câu hỏi mới (cache miss)
 * @param {Array}  [history] — lịch sử hội thoại
 * @param {object} [ctx]     — { topic, difficulty }
 * @returns {Promise<{resultA: object, resultB: object}>}
 */
export async function solveWithConsensus(question, history = [], ctx = {}) {
  const [resultA, resultB] = await Promise.all([
    invokeSolver(question, history, 0.1, ctx),
    invokeSolver(question, history, 0.7, ctx),
  ]);

  return { resultA, resultB };
}

/**
 * normalizeAnswer — chuẩn hóa chuỗi đáp án để so sánh.
 * Xóa khoảng trắng, dấu ngoặc, đưa về lowercase.
 */
export function normalizeAnswer(str) {
  return String(str ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')           // bỏ mọi khoảng trắng
    .replace(/[()\[\]{}]/g, '')    // bỏ ngoặc tròn/vuông/nhọn
    .replace(/[;,]/g, ' ')         // ; , thành khoảng trắng (để tách danh sách nghiệm)
    .trim();
}

/**
 * levenshteinSimilarity — độ tương đồng 0..1 giữa 2 chuỗi (Levenshtein).
 */
function levenshteinSimilarity(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return 1 - dp[m][n] / Math.max(m, n, 1);
}

/**
 * compareAnswers — so sánh 2 đáp án đã chuẩn hóa.
 *
 * @param {object} ansA — { final_answer, step_by_step }
 * @param {object} ansB — { final_answer, step_by_step }
 * @returns {{isMatch: boolean, similarity: number, normalizedA: string, normalizedB: string}}
 */
export function compareAnswers(ansA, ansB) {
  const normalizedA = normalizeAnswer(ansA?.final_answer);
  const normalizedB = normalizeAnswer(ansB?.final_answer);

  // Không có dữ liệu để so → coi là LỆCH (để Critic đánh giá)
  if (!normalizedA || !normalizedB) {
    return { isMatch: false, similarity: 0, normalizedA, normalizedB };
  }

  const similarity = levenshteinSimilarity(normalizedA, normalizedB);
  // Trùng hoàn toàn, hoặc tương đồng > 90% → KHỚP
  const isMatch = normalizedA === normalizedB || similarity > 0.9;

  return {
    isMatch,
    similarity: parseFloat(similarity.toFixed(4)),
    normalizedA,
    normalizedB,
  };
}

/**
 * callCritic — gọi LLM "giám khảo" đánh giá 2 lời giải lệch nhau.
 *
 * @param {string} question — đề bài
 * @param {object} resultA  — lời giải A
 * @param {object} resultB  — lời giải B
 * @param {object} [ctx]    — { topic, difficulty }
 * @returns {Promise<{verdict: string, explanation: string}>}
 */
export async function callCritic(question, resultA, resultB, ctx = {}) {
  const ctxLine = (ctx?.topic || ctx?.difficulty)
    ? `BỐI CẢNH CHUYÊN ĐỀ: ${[ctx?.topic, ctx?.difficulty].filter(Boolean).join(' · ')}`
    : '';
  const humanText = `${ctxLine ? ctxLine + '\n\n' : ''}ĐỀ BÀI:
${question}

LỜI GIẢI A (step_by_step):
${resultA?.step_by_step ?? '(trống)'}

KẾT QUẢ A (final_answer):
${resultA?.final_answer ?? '(trống)'}

LỜI GIẢI B (step_by_step):
${resultB?.step_by_step ?? '(trống)'}

KẾT QUẢ B (final_answer):
${resultB?.final_answer ?? '(trống)'}`;

  const raw = await callGeminiRest({
    systemPrompt: CRITIC_SYSTEM_PROMPT,
    userText: humanText,
    temperature: 0.0,
    maxOutputTokens: 2048,
    codeExecution: false,
    json: true,
  });

  const parsed = parseLLMJson(raw);

  // Critic thiếu schema → trả về verdict mặc định an toàn
  if (!parsed || typeof parsed.verdict !== 'string') {
    return {
      verdict: 'BOTH_WRONG',
      explanation: 'Critic không thể xác minh — hệ thống cần kiểm duyệt thủ công.',
    };
  }

  // Chuẩn hóa verdict về bộ giá trị mới: A_CORRECT / B_CORRECT / BOTH_WRONG
  let verdict = parsed.verdict.trim().toUpperCase();
  if (!['A_CORRECT', 'B_CORRECT', 'BOTH_WRONG'].includes(verdict)) {
    if (/A.*đúng|A CORRECT|A_CORRECT/i.test(parsed.verdict) && !/B.*đúng/i.test(parsed.verdict)) verdict = 'A_CORRECT';
    else if (/B.*đúng|B CORRECT|B_CORRECT/i.test(parsed.verdict)) verdict = 'B_CORRECT';
    else verdict = 'BOTH_WRONG';
  }

  return {
    verdict,
    explanation: String(parsed.critic_comment ?? parsed.explanation ?? '').trim(),
  };
}

/**
 * buildFallbackAnswer — xây dựng câu trả lời FALLBACK an toàn khi Consensus lệch.
 * Không trả kết quả cuối vội, gắn cảnh báo và lấy tạm gợi ý từ 1 lời giải.
 *
 * @param {string} question
 * @param {object} resultA
 * @param {object} resultB
 * @param {{verdict: string, explanation: string}} critic
 * @returns {string}
 */
function buildFallbackAnswer(question, resultA, resultB, critic) {
  const verdict = critic?.verdict ?? 'BOTH_WRONG';
  const explanation = critic?.explanation ?? '';

  // Ưu tiên lời giải được Critic chấm đúng (A_CORRECT → A, B_CORRECT → B); nếu không thì lấy A.
  const winner = verdict === 'B_CORRECT' ? resultB : resultA;
  const hint = winner?.step_by_step || resultA?.step_by_step || '';

  const lines = [
    `> ⚠️ **Hệ thống phát hiện câu hỏi này có nhiều hướng giải khác nhau.**`,
    `> **Trạng thái:** Đang chờ giáo viên kiểm duyệt. Kết quả dưới đây **chưa được xác nhận chính thức**.`,
  ];

  const verdictLabel = { A_CORRECT: 'Lời giải A được giám khảo chấm đúng', B_CORRECT: 'Lời giải B được giám khảo chấm đúng', BOTH_WRONG: 'Giám khảo nhận định cả hai lời giải đều chưa đạt' };
  if (verdict !== 'BOTH_WRONG') {
    lines.push(``, `**Giám khảo nhận định:** *${verdictLabel[verdict] ?? 'Đang phân tích'}*`);
  } else {
    lines.push(``, `**Giám khảo nhận định:** *${verdictLabel.BOTH_WRONG}*`);
  }
  if (explanation) {
    lines.push(``, `**Nhận xét của giám khảo:**`, explanation);
  }
  if (hint) {
    lines.push(``, `**Gợi ý các bước giải (tham khảo, chưa kiểm duyệt):**`, ``, hint);
  }
  lines.push(``, `---`, `*Câu trả lời chính thức sẽ được cập nhật sau khi giáo viên duyệt. Bạn có thể hỏi lại sau ít phút hoặc nhắn trực tiếp cho giáo viên.*`);

  return lines.join('\n');
}

/**
 * answerWithConsensus — ORCHESTRATOR: luồng xử lý đầy đủ khi cache miss.
 *
 * Bước 1. solveWithConsensus(question) — 2 solver song song
 * Bước 2. compareAnswers(resultA, resultB)
 *   - KHỚP  → trả về resultA.step_by_step (answer), consensus: 'match'
 *   - LỆCH  → callCritic + lưu review_queue, trả fallback an toàn, consensus: 'mismatch'
 *
 * @param {string} question
 * @param {Array}  [history]
 * @returns {Promise<{
 *   answer: string,
 *   consensus: 'match' | 'mismatch' | 'error',
 *   similarity: number|null,
 *   reviewId: string|null,
 *   critic: object|null,
 *   resultA: object|null,
 *   resultB: object|null,
 * }>}
 */
export async function answerWithConsensus(question, history = [], ctx = {}) {
  let resultA = null, resultB = null;

  try {
    const solved = await solveWithConsensus(question, history, ctx);
    resultA = solved.resultA;
    resultB = solved.resultB;
  } catch (err) {
    // Solver fail (API key, JSON hỏng...) → fallback về luồng cũ một LLM
    console.error('  ⚠️ [Consensus] Solver lỗi, fallback askLLM:', err.message);
    try {
      const answer = await askLLM(question, history);
      return { answer, consensus: 'error', similarity: null, reviewId: null, critic: null, resultA, resultB };
    } catch (err2) {
      throw new Error('Cả Consensus và fallback đều thất bại: ' + err2.message);
    }
  }

  const comparison = compareAnswers(resultA, resultB);

  // ── KHỚP ───────────────────────────────────────────────────────────────
  if (comparison.isMatch) {
    return {
      answer: resultA.step_by_step,
      consensus: 'match',
      similarity: comparison.similarity,
      reviewId: null,
      critic: null,
      resultA,
      resultB,
    };
  }

  // ── LỆCH → gọi Critic + lưu review_queue ────────────────────────────────
  let critic = null;
  try {
    critic = await callCritic(question, resultA, resultB, ctx);
  } catch (err) {
    console.error('  ⚠️ [Consensus] Critic lỗi:', err.message);
    critic = { verdict: 'Cả 2 đều sai', explanation: 'Critic không thể phản biện do lỗi hệ thống.' };
  }

  const { enqueueReview } = await import('./reviewQueue.js');
  let reviewId = null;
  try {
    reviewId = await enqueueReview({
      question,
      resultA,
      resultB,
      critic,
      history: (history ?? []).slice(-4), // lưu ngữ cảnh gần nhất
      similarity: comparison.similarity,
    });
  } catch (err) {
    console.error('  ⚠️ [Consensus] Lưu review_queue lỗi:', err.message);
  }

  return {
    answer: buildFallbackAnswer(question, resultA, resultB, critic),
    consensus: 'mismatch',
    similarity: comparison.similarity,
    reviewId,
    critic,
    resultA,
    resultB,
  };
}

/**
 * smartExtract — "Thông minh hóa" dữ liệu đầu vào cho Admin CMS.
 *
 * Nhận một đoạn văn bản (câu hỏi đơn lẻ HOẶC cả đề gồm nhiều câu) và nhờ LLM:
 *   1. Tách thành từng câu hỏi riêng lẻ
 *   2. Nhận diện chuyên đề (topic) + mức độ (difficulty) cho từng câu
 *   3. Soạn đáp án hướng dẫn ngắn gọn cho từng câu
 *   4. Dò lại xem câu nào trùng/lặp nội dung với nhau (duplicate trong đoạn)
 *
 * Trả về JSON chuẩn hóa dạng:
 *   { entries: Array<{ question, answer, topic, difficulty, duplicate }> }
 *
 * Muốn cho giáo viên: dán thẳng đề thi chụp từ bộ GD&ĐT là nạp được luôn.
 */
export async function smartExtract(rawText) {
  if (!rawText?.trim()) return { entries: [] };
  if (!process.env.GOOGLE_API_KEY) throw new Error('Thiếu GOOGLE_API_KEY');

  const model = process.env.AI_TUTOR_MODEL || process.env.GOOGLE_LLM_MODEL || 'gemini-3.5-flash';
  const key   = process.env.GOOGLE_API_KEY;

  const prompt = `Bạn là trợ lý AI của giáo viên Toán THPT Việt Nam. Nhiệm vụ: nhận dữ liệu đề bài / lời giải thô, biến thành câu hỏi nhập được vào ngân hàng đề.

Dữ liệu đầu vào (có thể chứa 1 hoặc nhiều câu, có thể là đề thi): 

---
${rawText.slice(0, 6000)}
---

Yêu cầu:
1. Tách thành từng câu hỏi độc lập. Nếu là một đoạn đề có nhiều câu thì mỗi câu một entry.
2. Mỗi entry gồm:
   - "question": câu hỏi/đề bài dạng chuẩn, viết lại bằng LaTeX ($...$, $$...$$) nếu có công thức.
   - "answer": đáp án + hướng dẫn giải ngắn gọn theo kiểu gia sư (dùng LaTeX), đủ để học sinh hiểu.
   - "topic": chuyên đề, chỉ dùng một trong: giai_tich, dao_ham, tich_phan, luong_giac, ham_so, mu_logarit, so_phuc, hinh_hoc_khong_gian, xac_suat, thu_tu_toan, phuong_trinh, bat_phuong_trinh, cap_so, khac.
   - "difficulty": một trong: Nhận biết, Thông hiểu, Vận dụng, VDC.
   - "duplicate": true nếu câu hỏi này GIỐNG HỆT một câu khác trong cùng dữ liệu đầu vào, còn lại false (mặc định false).
3. Chỉ trả về JSON hợp lệ có dạng: {"entries": [...]}. Không thêm chữ gì ngoài JSON.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: 'application/json' },
      }),
    }
  );

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini không trả về nội dung: ' + (data?.error?.message ?? 'response rỗng'));

  // Parse JSON (Gemini đôi khi wrap trong ```json ... ```)
  let parsed;
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Gemini trả về không phải JSON hợp lệ.');
  }

  const entriesArr = Array.isArray(parsed?.entries) ? parsed.entries
                     : (Array.isArray(parsed) ? parsed : []);
  if (!entriesArr.length) return { entries: [] };

  // Chuẩn hóa topic/difficulty từ alias (chấp nhận nhiều cách viết của Gemini)
  return {
    entries: entriesArr
      .filter(e => e && typeof e.question === 'string' && e.question.trim().length >= 5)
      .map(e => ({
        question:   String(e.question ?? '').trim().slice(0, 2000),
        answer:     String(e.answer ?? '').trim().slice(0, 8000),
        topic:      normalizeTopic(e.topic),
        difficulty: normalizeDifficulty(e.difficulty),
        duplicate:  e.duplicate === true,
      })),
  };
}

// ── Map alias để chấp nhận nhiều cách viết từ Gemini ─────────────────────────
const TOPIC_ALIAS = {
  giai_tich: 'giai_tich', tich_phan: 'tich_phan', tichphan: 'tich_phan',
  dao_ham: 'dao_ham', daoham: 'dao_ham', luong_giac: 'luong_giac',
  ham_so: 'ham_so', hamso: 'ham_so', mu_logarit: 'mu_logarit', mu_logarist: 'mu_logarit',
  so_phuc: 'so_phuc', sophuc: 'so_phuc', xac_suat: 'xac_suat',
  hinh_hoc_khong_gian: 'hinh_hoc_khong_gian', hinh_hoc_khue_gian: 'hinh_hoc_khong_gian',
  thu_tu_toan: 'thu_tu_toan', phuong_trinh: 'phuong_trinh',
  bat_phuong_trinh: 'bat_phuong_trinh', cap_so: 'cap_so',
};

function normalizeTopic(raw) {
  const key = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  return TOPIC_ALIAS[key] ?? 'khac';
}

const DIFF_ALIASES = {
  'nhận_biết': 'Nhận biết', 'nhan_biet': 'Nhận biết', 'nhận biết': 'Nhận biết',
  'thông_hiểu': 'Thông hiểu', 'thong_hieu': 'Thông hiểu', 'thông hiểu': 'Thông hiểu',
  'vận_dụng': 'Vận dụng', 'van_dung': 'Vận dụng', 'vận dụng': 'Vận dụng',
  'vdc': 'VDC', 'vận_dụng_cao': 'VDC', 'van_dung_cao': 'VDC',
};

function normalizeDifficulty(raw) {
  const key = String(raw ?? '').trim().toLowerCase();
  return DIFF_ALIASES[key] ?? 'Thông hiểu';
}

/**
 * cacheService.js — Semantic Cache cho AI Gia sư Toán THPT
 *
 * Luồng hoạt động:
 *   1. Nhận câu hỏi (text/LaTeX) từ controller
 *   2. Tạo embedding vector bằng Google GenAI hoặc OpenAI
 *   3. Tìm kiếm vector trong DB (Upstash hoặc Pinecone)
 *   4. Nếu cosine similarity >= THRESHOLD → Cache HIT → trả về đáp án đã lưu
 *   5. Nếu < THRESHOLD                   → Cache MISS → trả về null
 *   6. Sau khi LLM trả lời xong, lưu cặp (question, answer) vào vector DB
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
// Load .env từ thư mục gốc (d:/PhanHoangKe/.env), không phải ai-tutor/
dotenv.config({ path: resolve(__dirname, '../../.env') });

// ── Embedding Function — gọi thẳng Google REST API ──────────────────────────
// LangChain wrapper chưa hỗ trợ outputDimensionality → gọi trực tiếp để đảm bảo 768 dims
// khớp với Upstash Free Plan (max dimension 1536, index đang dùng 768)
async function embedTexts(texts) {
  const provider = (process.env.EMBEDDING_PROVIDER || 'google').toLowerCase();

  if (provider === 'openai') {
    const { OpenAIEmbeddings } = await import('@langchain/openai');
    if (!process.env.OPENAI_API_KEY) throw new Error('Thiếu biến môi trường OPENAI_API_KEY');
    const embedder = new OpenAIEmbeddings({
      apiKey: process.env.OPENAI_API_KEY,
      model: 'text-embedding-3-small', // 1536 dims
    });
    return embedder.embedDocuments(texts);
  }

  // Google: gọi REST trực tiếp với outputDimensionality=768
  if (!process.env.GOOGLE_API_KEY) throw new Error('Thiếu biến môi trường GOOGLE_API_KEY');
  const key = process.env.GOOGLE_API_KEY;
  const model = 'gemini-embedding-001';
  const vectors = [];
  for (const text of texts) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          taskType: 'RETRIEVAL_DOCUMENT',
          outputDimensionality: 768,
        }),
      }
    );
    const data = await res.json();
    if (!data.embedding?.values) {
      throw new Error(`Google Embedding lỗi: ${data.error?.message ?? JSON.stringify(data)}`);
    }
    vectors.push(data.embedding.values);
  }
  return vectors;
}

async function embedQuery(text) {
  const provider = (process.env.EMBEDDING_PROVIDER || 'google').toLowerCase();

  if (provider === 'openai') {
    const { OpenAIEmbeddings } = await import('@langchain/openai');
    const embedder = new OpenAIEmbeddings({
      apiKey: process.env.OPENAI_API_KEY,
      model: 'text-embedding-3-small',
    });
    return embedder.embedQuery(text);
  }

  // Google: gọi REST với taskType=RETRIEVAL_QUERY khi tìm kiếm
  const key = process.env.GOOGLE_API_KEY;
  const model = 'gemini-embedding-001';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text }] },
        taskType: 'RETRIEVAL_QUERY',
        outputDimensionality: 768,
      }),
    }
  );
  const data = await res.json();
  if (!data.embedding?.values) {
    throw new Error(`Google Embedding lỗi: ${data.error?.message ?? JSON.stringify(data)}`);
  }
  return data.embedding.values;
}

// ── Vector DB Client Factory ─────────────────────────────────────────────────
async function buildVectorClient() {
  const db = (process.env.VECTOR_DB || 'upstash').toLowerCase();

  if (db === 'pinecone') {
    const { Pinecone } = await import('@pinecone-database/pinecone');
    if (!process.env.PINECONE_API_KEY) throw new Error('Thiếu biến môi trường PINECONE_API_KEY');
    if (!process.env.PINECONE_INDEX_NAME) throw new Error('Thiếu biến môi trường PINECONE_INDEX_NAME');
    const client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const index = client.index(process.env.PINECONE_INDEX_NAME);
    return { type: 'pinecone', index };
  }

  // Mặc định: Upstash Vector
  const { Index } = await import('@upstash/vector');
  if (!process.env.UPSTASH_VECTOR_REST_URL) throw new Error('Thiếu biến môi trường UPSTASH_VECTOR_REST_URL');
  if (!process.env.UPSTASH_VECTOR_REST_TOKEN) throw new Error('Thiếu biến môi trường UPSTASH_VECTOR_REST_TOKEN');
  const index = new Index({
    url: process.env.UPSTASH_VECTOR_REST_URL,
    token: process.env.UPSTASH_VECTOR_REST_TOKEN,
  });
  return { type: 'upstash', index };
}

// ── Singleton vector client (embedQuery/embedTexts là pure functions) ────────
let _vectorClient = null;

async function getVectorClient() {
  if (!_vectorClient) _vectorClient = await buildVectorClient();
  return _vectorClient;
}

// ── Config ───────────────────────────────────────────────────────────────────
const SIMILARITY_THRESHOLD = parseFloat(process.env.CACHE_SIMILARITY_THRESHOLD ?? '0.95');
const TOP_K = parseInt(process.env.CACHE_TOP_K ?? '3', 10);

// ── Chống khớp nhầm khi đề đổi số ─────────────────────────────────────────────
// Hai đề cùng dạng (chóp cụt + chỏm cầu) nhưng KHÁC số liệu có thể có embedding
// rất giống (phần chữ chiếm đa số). Nếu cache hit mà các con số quan trọng khác
// nhau → đừng tin, để chạy consensus (hoặc template — template sẽ xử lý đúng số mới).
function extractKeyNumbers(text) {
  const s = String(text ?? '').replace(/\\/g, '');
  // Bắt số thập phân như 10,4 / 10.4 / 1,5 — ưu tiên nhóm nhiều chữ số nhất
  const re = /(\d{1,3}(?:[,.]\d+)?)/g;
  const raw = [...s.matchAll(re)].map(m => m[1]).map(t => parseFloat(t.replace(',', '.')));
  // Chỉ giữ số "có nghĩa" (>0 và <10000) — loại năm, số thứ tự nhỏ thường là chỉ số
  return [...new Set(raw)].filter(n => n > 0.05 && n <= 5000).sort((a, b) => a - b);
}

function keyNumbersDiffer(q1, q2) {
  const a = extractKeyNumbers(q1);
  const b = extractKeyNumbers(q2);
  if (!a.length || !b.length) return false; // không trích được → không chặn
  const maxLen = Math.max(a.length, b.length);
  let match = 0;
  for (const x of a) {
    if (b.some(y => Math.abs(x - y) < 0.02)) match++;
  }
  // Nếu hầu hết số không khớp → nghi ngờ đổi số → chặn cache hit
  return match / maxLen < 0.7;
}

// ── Cosine Similarity (dự phòng khi DB không trả về score) ──────────────────
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Helper: tạo ID ổn định từ câu hỏi (tránh duplicate trong DB) ────────────
function makeVectorId(question) {
  // Dùng hash đơn giản: base64 của 40 ký tự đầu sau khi normalize
  const normalized = question.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
  return Buffer.from(normalized).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 64);
}

// ════════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ════════════════════════════════════════════════════════════════════════════

/**
 * searchCache — tìm câu hỏi tương tự trong vector DB.
 *
 * @param {string} question  — câu hỏi dạng text hoặc LaTeX
 * @returns {Promise<{hit: true, answer: string, score: number, matchedQuestion: string} |
 *                   {hit: false, vector: number[]}>}
 */
export async function searchCache(question) {
  const vectorClient = await getVectorClient();

  // Tạo embedding cho câu hỏi đầu vào
  const queryVector = await embedQuery(question);

  // ── Upstash query ────────────────────────────────────────────────────────
  if (vectorClient.type === 'upstash') {
    const results = await vectorClient.index.query({
      vector: queryVector,
      topK: TOP_K,
      includeMetadata: true,
      includeVectors: false, // tiết kiệm bandwidth
    });

for (const match of results) {
      // Upstash trả score dạng cosine similarity (0–1) trực tiếp
      const score = match.score ?? 0;
      const meta = match.metadata ?? {};
      // Chống khớp nhầm khi đề đổi số: khớp cao trên text nhưng số lệch → bỏ qua
      const numbersDiffer = keyNumbersDiffer(question, meta.question ?? '');
      if (score >= SIMILARITY_THRESHOLD && !numbersDiffer) {
        const isVerified = meta.verified === true || meta.verified === 'true';
        console.log(`  🎯 [Cache HIT]  score=${score.toFixed(4)} | id=${match.id} | verified=${isVerified} | source=${meta.source ?? 'unknown'}`);
        return {
          hit: true,
          answer: meta.answer ?? '',
          score,
          matchedQuestion: meta.question ?? '',
          isVerified,
          source: meta.source ?? 'cache_unknown'
        };
      } else if (score >= SIMILARITY_THRESHOLD && numbersDiffer) {
        console.warn(`  ⚠️  [Cache] Khớp text nhưng SỐ LỆCH (id=${match.id}) — bỏ qua, tránh đáp án sai cho đề đổi số`);
      }
    }
  }

  // ── Pinecone query ───────────────────────────────────────────────────────
  if (vectorClient.type === 'pinecone') {
    const results = await vectorClient.index.query({
      vector: queryVector,
      topK: TOP_K,
      includeMetadata: true,
    });

    for (const match of results.matches ?? []) {
      const score = match.score ?? 0;
      const meta = match.metadata ?? {};
      const numbersDiffer = keyNumbersDiffer(question, meta.question ?? '');
      if (score >= SIMILARITY_THRESHOLD && !numbersDiffer) {
        const isVerified = meta.verified === true || meta.verified === 'true';
        console.log(`  🎯 [Cache HIT]  score=${score.toFixed(4)} | id=${match.id} | verified=${isVerified} | source=${meta.source ?? 'unknown'}`);
        return {
          hit: true,
          answer: meta.answer ?? '',
          score,
          matchedQuestion: meta.question ?? '',
          isVerified,
          source: meta.source ?? 'cache_unknown'
        };
      } else if (score >= SIMILARITY_THRESHOLD && numbersDiffer) {
        console.warn(`  ⚠️  [Cache] Khớp text nhưng SỐ LỆCH (id=${match.id}) — bỏ qua`);
      }
    }
  }

  console.log(`  🔍 [Cache MISS] Không tìm thấy câu hỏi tương tự (threshold=${SIMILARITY_THRESHOLD})`);
  // Trả về vector để controller không phải embed lại khi lưu cache
  return { hit: false, vector: queryVector };
}

/**
 * saveToCache — lưu cặp (question, answer) vào vector DB.
 * Gọi sau khi LLM đã trả lời (cache miss) để các lần sau có thể cache hit.
 *
 * @param {string}   question    — câu hỏi gốc
 * @param {string}   answer      — đáp án từ LLM
 * @param {number[]} [vector]    — embedding đã tạo sẵn (tránh gọi API 2 lần)
 * @param {object}   [extraMeta] — metadata bổ sung (chủ đề, mức độ khó…)
 */
export async function saveToCache(question, answer, vector = null, extraMeta = {}) {
  try {
    const vectorClient = await getVectorClient();

    // Dùng lại vector nếu đã có, nếu không thì tạo mới
    const vec = vector ?? (await embedQuery(question));
    const id = makeVectorId(question);

    const metadata = {
      question: question.slice(0, 1000), // Upstash giới hạn metadata size
      answer: answer.slice(0, 4000),
      savedAt: new Date().toISOString(),
      ...extraMeta,
    };

    if (vectorClient.type === 'upstash') {
      await vectorClient.index.upsert([{ id, vector: vec, metadata }]);
    } else if (vectorClient.type === 'pinecone') {
      await vectorClient.index.upsert([{ id, values: vec, metadata }]);
    }

    console.log(`  💾 [Cache SAVE] id=${id} | question="${question.slice(0, 60)}…"`);
  } catch (err) {
    // Lỗi lưu cache không nên làm gián đoạn response cho user
    console.error('  ⚠️  [Cache SAVE] Lỗi:', err.message);
  }
}

/**
 * deleteFromCache — xóa một entry khỏi vector DB (dùng cho Admin).
 *
 * @param {string} id — vector ID (kết quả từ makeVectorId hoặc do Admin biết)
 */
export async function deleteFromCache(id) {
  const vectorClient = await getVectorClient();
  if (vectorClient.type === 'upstash') {
    await vectorClient.index.delete([id]);
  } else if (vectorClient.type === 'pinecone') {
    await vectorClient.index.deleteOne(id);
  }
  console.log(`  🗑️  [Cache DELETE] id=${id}`);
}

/**
 * getCacheStats — lấy thống kê nhanh (số vector đang lưu).
 */
export async function getCacheStats() {
  try {
    const vectorClient = await getVectorClient();
    if (vectorClient.type === 'upstash') {
      const info = await vectorClient.index.info();
      // Upstash SDK v1.2.x trả về: { vectorCount, pendingVectorCount, indexSize, dimension, similarityFunction, ... }
      return {
        provider: 'upstash',
        vectorCount: info.vectorCount ?? info.count ?? 0,
        dimension: info.dimension ?? 0,
        similarityFunction: info.similarityFunction ?? 'COSINE',
      };
    }
    if (vectorClient.type === 'pinecone') {
      const stats = await vectorClient.index.describeIndexStats();
      return {
        provider: 'pinecone',
        vectorCount: stats.totalRecordCount ?? stats.totalVectorCount ?? 0,
        dimension: stats.dimension ?? 0,
      };
    }
  } catch (err) {
    return { provider: process.env.VECTOR_DB ?? 'upstash', error: err.message };
  }
}

/**
 * searchSimilar — tìm các câu HỎI tương đồng trong Vector DB, KHÔNG cần đạt
 * ngưỡng cache hit. Dành cho Admin: kiểm tra trùng đề trước khi nạp.
 *
 * @param {string} question  — câu hỏi dạng text/LaTeX
 * @param {number} [topK=5]  — số kết quả gần nhất muốn lấy
 * @returns {Promise<Array<{id, score, question, answer, metadata}>>}
 */
export async function searchSimilar(question, topK = 5) {
  const vectorClient = await getVectorClient();
  const queryVector = await embedQuery(question);
  const out = [];

  if (vectorClient.type === 'upstash') {
    const results = await vectorClient.index.query({
      vector: queryVector,
      topK,
      includeMetadata: true,
      includeVectors: false,
    });
    for (const match of results) {
      out.push({
        id: match.id,
        score: parseFloat((match.score ?? 0).toFixed(4)),
        question: match.metadata?.question ?? '',
        answer: match.metadata?.answer ?? '',
        metadata: match.metadata ?? {},
      });
    }
  }

  if (vectorClient.type === 'pinecone') {
    const results = await vectorClient.index.query({
      vector: queryVector,
      topK,
      includeMetadata: true,
    });
    for (const match of results.matches ?? []) {
      out.push({
        id: match.id,
        score: parseFloat((match.score ?? 0).toFixed(4)),
        question: match.metadata?.question ?? '',
        answer: match.metadata?.answer ?? '',
        metadata: match.metadata ?? {},
      });
    }
  }

  return out.sort((a, b) => b.score - a.score);
}

/**
 * listCacheEntries — liệt kê các entry trong vector DB (phân trang bằng cursor).
 * Dùng cho tab "Kho dữ liệu" của Admin CMS.
 *
 * @param {number} limit            số lượng tối đa mỗi trang (mặc định 50)
 * @param {string} [cursor='0']    cursor phân trang Upstash range
 * @returns {Promise<{entries: Array, nextCursor: string|null}>}
 */
export async function listCacheEntries(limit = 50, cursor = '') {
  const vectorClient = await getVectorClient();

  if (vectorClient.type === 'upstash') {
    const result = await vectorClient.index.range({
      cursor: cursor || 0,
      limit,
      includeMetadata: true,
      includeVectors: false,
    });
    const entries = (result.vectors ?? []).map(v => ({
      id: v.id,
      question: v.metadata?.question ?? '',
      answer:   v.metadata?.answer ?? '',
      savedAt:  v.metadata?.savedAt ?? '',
      verified: v.metadata?.verified === true,
      source:   v.metadata?.source ?? '',
      topic:    v.metadata?.topic ?? '',
      difficulty: v.metadata?.difficulty ?? '',
    }));
    return { entries, nextCursor: result.nextCursor || null };
  }

  // Pinecone: không có range thân thiện — fetch topN theo đợt
  if (vectorClient.type === 'pinecone') {
    const stats = await vectorClient.index.describeIndexStats();
    const count = Math.min(stats.totalRecordCount ?? 0, limit);
    const ids = [];
    const page = await vectorClient.index.listPaginated({ paginationToken: cursor || undefined, limit: limit || 50 });
    for (const item of page.vectors ?? []) ids.push(item.id);
    const fetched = ids.length ? await vectorClient.index.fetch(ids) : {};
    const records = fetched.records ?? {};
    const entries = Object.entries(records).map(([id, rec]) => ({
      id,
      question: rec.metadata?.question ?? '',
      answer:   rec.metadata?.answer ?? '',
      savedAt:  rec.metadata?.savedAt ?? '',
      verified: rec.metadata?.verified === true,
      source:   rec.metadata?.source ?? '',
      topic:    rec.metadata?.topic ?? '',
      difficulty: rec.metadata?.difficulty ?? '',
    }));
    return { entries, nextCursor: page.pagination?.next ?? null };
  }

  return { entries: [], nextCursor: null };
}

/**
 * debtRetrieval.js — Retrieval cho Đặc Vụ Thu Hồi Vốn (RAG).
 *
 * Quy trình:
 *  1. Đọc kho ngữ liệu debtRibData.json (do người duy trì sưu tầm).
 *  2. Embed từng câu bằng Gemini embedding API (embedContent -> 768 chiều),
 *     cache vector vào debtRibCache.json để chỉ embed lại khi kho đổi.
 *  3. Khi có hồ sơ: embed câu query (taskType RETRIEVAL_QUERY), tính cosine
 *     similarity với toàn bộ vector, trả top-K câu ngữ nghĩa gần nhất.
 *
 * KHÔNG cần vector DB riêng: vài trăm câu thì scan + cosine trong JS là đủ.
 * Nếu embedding lỗi / kho rỗng / cache hỏng -> trả [] an toàn (prompt sẽ tự bịa).
 */

const path = require('path');
const fs = require('fs');

const DATA_FILE = path.join(__dirname, 'debtRibData.json');
const CACHE_FILE = path.join(__dirname, 'data', 'debtRibCache.json');
const MODEL = process.env.DEBT_EMBEDDING_MODEL || 'gemini-embedding-001';
const EMBED = MODEL;
const DIM = 768;

// ── Đọc kho ngữ liệu ─────────────────────────────────────────────────────────
function loadItems() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const list = Array.isArray(raw?.items) ? raw.items : [];
    return list
      .map((it, i) => ({ id: it.id || `c${i}`, text: String(it.text || ''), tags: Array.isArray(it.tags) ? it.tags : [], topic: it.topic || '', degree: it.degree || 'Vừa' }))
      .filter(it => it.text.trim());
  } catch {
    return [];
  }
}

// ── Embed qua Gemini (taskType khác nhau cho doc vs query) ──────────────────
async function embedTexts(texts, taskType) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('Thiếu GOOGLE_API_KEY');
  const out = [];
  for (const text of texts) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED}:embedContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${EMBED}`,
          content: { parts: [{ text }] },
          taskType,
          outputDimensionality: DIM,
        }),
      }
    );
    const data = await res.json();
    if (!data.embedding?.values) {
      throw new Error(`Embedding lỗi: ${data.error?.message ?? JSON.stringify(data)}`);
    }
    out.push(data.embedding.values);
  }
  return out;
}

// ── Cosine similarity ───────────────────────────────────────────────────────
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

// ── Đọc cache vector (trả về {rev, items: [{id, text, tags, topic, degree, vec}]} ) ─
function readCache() {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (c && Array.isArray(c.items) && c.items.length) return c;
  } catch {}
  return null;
}

function writeCache(data) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
  } catch (e) {
    console.warn('  [Debt-Retrieval] Ghi cache lỗi:', e.message);
  }
}

// ── Chuẩn bị: đảm bảo kho đã được embed + cache ─────────────────────────────
let prepared = false;

async function ensureEmbedded() {
  if (prepared) return;
  const items = loadItems();
  if (!items.length) { prepared = true; return; }

  const cached = readCache();
  // So sánh nhanh bằng số lượng + nội dung text để biết kho có đổi không
  const sameCount = cached && cached.items.length === items.length;

  if (sameCount) {
    const cacheTexts = new Set(cached.items.map(i => i.text));
    const allSame = items.every(i => cacheTexts.has(i.text));
    if (allSame) { prepared = true; return; }
  }

  // Re-embed toàn bộ (kho nhỏ nên đơn giản)
  const vecs = await embedTexts(items.map(i => `${i.text} [${(i.tags||[]).join(',')}]`), 'RETRIEVAL_DOCUMENT');
  const cacheItems = items.map((it, i) => ({ ...it, vec: vecs[i] }));
  writeCache({ rev: Date.now(), items: cacheItems });
  prepared = true;
}

// ── Truy vấn: trả top-K câu gần hồ sơ nhất ──────────────────────────────────
async function retrieve(p, topK = 4) {
  try {
    await ensureEmbedded();
  } catch (err) {
    console.warn('  [Debt-Retrieval] Embed kho lỗi:', err.message);
  }

  const items = loadItems();
  if (!items.length) return [];

  // cache chỉ lưu vec; nạp lại text từ kho để luôn khớp
  const cached = readCache();
  const vecById = {};
  if (cached && Array.isArray(cached.items)) {
    cached.items.forEach(it => { if (it.vec) vecById[it.id] = it.vec; });
  }

  const text = `đòi nợ ${p.debtor || ''} ${p.reason || ''} phong cách ${p.style || ''} ${p.relationship || ''}`;
  let q = null;
  try {
    const qs = await embedTexts([text], 'RETRIEVAL_QUERY');
    q = qs[0];
  } catch (err) {
    console.warn('  [Debt-Retrieval] Embed query lỗi, trả trống:', err.message);
    return [];
  }

  const scored = items
    .map(it => {
      const v = vecById[it.id];
      return { item: it, score: v ? cosine(q, v) : 0 };
    })
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).filter(s => s.score > 0).map(s => s.item);
}

// ── Giúp debug ──────────────────────────────────────────────────────────────
function countItems() {
  return loadItems().length;
}

module.exports = { retrieve, loadItems, countItems };
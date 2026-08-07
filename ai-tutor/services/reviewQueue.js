/**
 * reviewQueue.js — Hàng đợi kiểm duyệt (Data Flywheel)
 *
 * Khi Consensus LỆCH, toàn bộ (Câu hỏi, Lời giải A, Lời giải B, Nhận xét Critic)
 * được lưu vào đây để Giáo viên vào duyệt thủ công.
 *
 * Lưu trữ: file JSON `ai-tutor/review_queue.json` (đủ cho quy mô demo/nội bộ).
 *  - approve  → lưu đáp án đã chọn vào Vector DB (verified: true) + xóa khỏi queue
 *  - reject   → xóa khỏi queue
 *
 * Format entry:
 * {
 *   id, savedAt, status: 'pending' | 'approved' | 'rejected',
 *   question, resultA, resultB, critic: { verdict, explanation }, history?
 * }
 */

import { randomUUID } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUEUE_FILE = resolve(__dirname, '../review_queue.json');

async function readQueue() {
  try {
    const raw = await readFile(QUEUE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // file chưa tồn tại hoặc hỏng → queue rỗng
  }
}

async function writeQueue(queue) {
  await writeFile(QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf8');
}

/**
 * enqueueReview — thêm một mục vào hàng đợi kiểm duyệt.
 * @param {object} entry — { question, resultA, resultB, critic, history? }
 * @returns {Promise<string>} id của mục vừa tạo
 */
export async function enqueueReview(entry) {
  const queue = await readQueue();
  const item = {
    id: randomUUID(),
    savedAt: new Date().toISOString(),
    status: 'pending',
    ...entry,
  };
  queue.push(item);
  await writeQueue(queue);
  return item.id;
}

/**
 * getReviewQueue — trả toàn bộ queue (mới nhất trước).
 */
export async function getReviewQueue() {
  const queue = await readQueue();
  return queue.reverse();
}

/**
 * updateReview — cập nhật một mục theo id (approve/reject...).
 * @returns {Promise<object|null>} mục đã cập nhật, hoặc null nếu không tìm thấy
 */
export async function updateReview(id, patch) {
  const queue = await readQueue();
  const idx = queue.findIndex(x => x.id === id);
  if (idx === -1) return null;
  queue[idx] = { ...queue[idx], ...patch, updatedAt: new Date().toISOString() };
  await writeQueue(queue);
  return queue[idx];
}

/**
 * deleteReview — xóa một mục khỏi queue.
 * @returns {Promise<boolean>} true nếu xóa thành công
 */
export async function deleteReview(id) {
  const queue = await readQueue();
  const next = queue.filter(x => x.id !== id);
  if (next.length === queue.length) return false;
  await writeQueue(next);
  return true;
}

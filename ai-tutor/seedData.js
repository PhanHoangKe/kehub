/**
 * seedData.js — Script insert câu hỏi mẫu (đề thi THPT) vào Vector DB
 *
 * Chạy:  node seedData.js
 *   hoặc: npm run seed
 *
 * Script này sẽ:
 *   1. Lấy từng cặp (question, answer) từ SEED_DATA bên dưới
 *   2. Tạo embedding và upsert vào vector DB (Upstash hoặc Pinecone)
 *   3. In kết quả sau khi xong
 *
 * Dữ liệu mẫu bao gồm 10 câu điển hình trong đề thi THPT Quốc Gia:
 *   - Giải phương trình lượng giác
 *   - Khảo sát hàm số
 *   - Tính tích phân
 *   - Bài toán xác suất
 *   - Số phức
 *   - Hình học không gian
 *   - Mũ & Logarithm
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });
import { saveToCache, getCacheStats } from './services/cacheService.js';

// ── Dữ liệu mẫu: 10 câu hỏi THPT điển hình ──────────────────────────────────
const SEED_DATA = [
  // ── 1. Giải phương trình lượng giác ─────────────────────────────────────
  {
    topic: 'luong_giac',
    difficulty: 'medium',
    question: 'Giải phương trình $\\sin(2x) = \\frac{\\sqrt{3}}{2}$',
    answer: `**Giải phương trình** $\\sin(2x) = \\dfrac{\\sqrt{3}}{2}$

**Bước 1:** Nhận xét $\\dfrac{\\sqrt{3}}{2} = \\sin\\dfrac{\\pi}{3}$

**Bước 2:** Phương trình tương đương:
$$\\sin(2x) = \\sin\\frac{\\pi}{3}$$

**Bước 3:** Áp dụng công thức $\\sin\\alpha = \\sin\\beta \\Rightarrow \\alpha = \\beta + 2k\\pi$ hoặc $\\alpha = \\pi - \\beta + 2k\\pi$:

- Trường hợp 1: $2x = \\dfrac{\\pi}{3} + 2k\\pi \\Rightarrow x = \\dfrac{\\pi}{6} + k\\pi$
- Trường hợp 2: $2x = \\pi - \\dfrac{\\pi}{3} + 2k\\pi = \\dfrac{2\\pi}{3} + 2k\\pi \\Rightarrow x = \\dfrac{\\pi}{3} + k\\pi$

Với $k \\in \\mathbb{Z}$.

**Vậy nghiệm của phương trình là:**
$$x = \\frac{\\pi}{6} + k\\pi \\quad \\text{hoặc} \\quad x = \\frac{\\pi}{3} + k\\pi, \\quad k \\in \\mathbb{Z}$$`,
  },

  // ── 2. Tính giới hạn ─────────────────────────────────────────────────────
  {
    topic: 'giai_tich',
    difficulty: 'medium',
    question: 'Tính giới hạn $\\lim_{x \\to 1} \\frac{x^2 - 1}{x - 1}$',
    answer: `**Tính giới hạn** $\\lim_{x \\to 1} \\dfrac{x^2 - 1}{x - 1}$

**Bước 1:** Nhận xét khi $x \\to 1$, tử và mẫu đều $\\to 0$ — dạng vô định $\\dfrac{0}{0}$.

**Bước 2:** Phân tích tử số:
$$x^2 - 1 = (x-1)(x+1)$$

**Bước 3:** Rút gọn (với $x \\neq 1$):
$$\\frac{x^2-1}{x-1} = \\frac{(x-1)(x+1)}{x-1} = x+1$$

**Bước 4:** Tính giới hạn:
$$\\lim_{x \\to 1}(x+1) = 1+1 = 2$$

**Vậy** $\\lim_{x \\to 1} \\dfrac{x^2 - 1}{x - 1} = 2$.`,
  },

  // ── 3. Tích phân cơ bản ──────────────────────────────────────────────────
  {
    topic: 'tich_phan',
    difficulty: 'medium',
    question: 'Tính tích phân $\\int_0^1 (3x^2 + 2x) \\, dx$',
    answer: `**Tính tích phân** $\\int_0^1 (3x^2 + 2x)\\,dx$

**Bước 1:** Tìm nguyên hàm:
$$F(x) = \\int (3x^2 + 2x)\\,dx = x^3 + x^2 + C$$

**Bước 2:** Áp dụng công thức Newton–Leibniz:
$$\\int_0^1 (3x^2 + 2x)\\,dx = F(1) - F(0)$$

**Bước 3:** Tính:
$$F(1) = 1^3 + 1^2 = 2, \\quad F(0) = 0$$

**Vậy** $\\int_0^1 (3x^2 + 2x)\\,dx = 2 - 0 = \\boxed{2}$.`,
  },

  // ── 4. Đạo hàm hàm hợp ──────────────────────────────────────────────────
  {
    topic: 'dao_ham',
    difficulty: 'easy',
    question: 'Tìm đạo hàm của hàm số $f(x) = \\ln(x^2 + 1)$',
    answer: `**Tìm đạo hàm** $f(x) = \\ln(x^2 + 1)$

**Bước 1:** Đặt $u = x^2 + 1$, khi đó $f(x) = \\ln u$.

**Bước 2:** Áp dụng quy tắc đạo hàm hàm hợp $[\\ln u]' = \\dfrac{u'}{u}$:
$$f'(x) = \\frac{(x^2+1)'}{x^2+1} = \\frac{2x}{x^2+1}$$

**Vậy** $f'(x) = \\dfrac{2x}{x^2+1}$.`,
  },

  // ── 5. Phương trình mũ ───────────────────────────────────────────────────
  {
    topic: 'mu_logarit',
    difficulty: 'medium',
    question: 'Giải phương trình $4^x - 3 \\cdot 2^x - 4 = 0$',
    answer: `**Giải phương trình** $4^x - 3 \\cdot 2^x - 4 = 0$

**Bước 1:** Đặt $t = 2^x$ ($t > 0$). Nhận xét $4^x = (2^x)^2 = t^2$.

**Bước 2:** Phương trình trở thành:
$$t^2 - 3t - 4 = 0$$

**Bước 3:** Giải phương trình bậc hai:
$$\\Delta = 9 + 16 = 25 \\Rightarrow t = \\frac{3 \\pm 5}{2}$$
- $t_1 = 4$ ✓ (thỏa $t > 0$)  
- $t_2 = -1$ ✗ (loại vì $t > 0$)

**Bước 4:** Với $t = 4$:
$$2^x = 4 = 2^2 \\Rightarrow x = 2$$

**Vậy** phương trình có nghiệm $x = 2$.`,
  },

  // ── 6. Số phức ───────────────────────────────────────────────────────────
  {
    topic: 'so_phuc',
    difficulty: 'easy',
    question: 'Tìm môđun của số phức $z = 3 - 4i$',
    answer: `**Tìm môđun** của số phức $z = 3 - 4i$

**Công thức:** Với $z = a + bi$ thì $|z| = \\sqrt{a^2 + b^2}$.

**Áp dụng:** $a = 3$, $b = -4$:
$$|z| = \\sqrt{3^2 + (-4)^2} = \\sqrt{9 + 16} = \\sqrt{25} = 5$$

**Vậy** $|z| = 5$.`,
  },

  // ── 7. Xác suất (tổ hợp) ─────────────────────────────────────────────────
  {
    topic: 'xac_suat',
    difficulty: 'medium',
    question: 'Một hộp có 5 bi đỏ và 3 bi xanh. Lấy ngẫu nhiên 2 bi. Tính xác suất lấy được đúng 1 bi đỏ.',
    answer: `**Bài toán xác suất** — Lấy ngẫu nhiên 2 bi từ hộp có 5 đỏ + 3 xanh.

**Bước 1:** Không gian mẫu — số cách chọn 2 bi từ 8:
$$n(\\Omega) = C_8^2 = \\frac{8!}{2! \\cdot 6!} = 28$$

**Bước 2:** Biến cố $A$ = "đúng 1 bi đỏ" = chọn 1 đỏ từ 5 VÀ chọn 1 xanh từ 3:
$$n(A) = C_5^1 \\cdot C_3^1 = 5 \\cdot 3 = 15$$

**Bước 3:** Xác suất:
$$P(A) = \\frac{n(A)}{n(\\Omega)} = \\frac{15}{28}$$

**Vậy** xác suất lấy được đúng 1 bi đỏ là $\\dfrac{15}{28} \\approx 53{,}57\\%$.`,
  },

  // ── 8. Hình học không gian (thể tích) ────────────────────────────────────
  {
    topic: 'hinh_hoc_khong_gian',
    difficulty: 'medium',
    question: 'Tính thể tích khối chóp tứ giác đều $S.ABCD$ có cạnh đáy $a = 4$ và chiều cao $h = 6$.',
    answer: `**Thể tích khối chóp tứ giác đều** $S.ABCD$

**Công thức:** $V = \\dfrac{1}{3} \\cdot S_{\\text{đáy}} \\cdot h$

**Bước 1:** Tính diện tích đáy hình vuông $ABCD$ ($a = 4$):
$$S_{\\text{đáy}} = a^2 = 4^2 = 16$$

**Bước 2:** Tính thể tích ($h = 6$):
$$V = \\frac{1}{3} \\cdot 16 \\cdot 6 = \\frac{96}{3} = 32$$

**Vậy** thể tích khối chóp là $V = 32$ (đơn vị thể tích).`,
  },

  // ── 9. Khảo sát hàm số (cực trị) ─────────────────────────────────────────
  {
    topic: 'ham_so',
    difficulty: 'medium',
    question: 'Tìm cực trị của hàm số $y = x^3 - 3x^2 - 9x + 5$',
    answer: `**Tìm cực trị** hàm số $y = x^3 - 3x^2 - 9x + 5$

**Bước 1:** Tính đạo hàm:
$$y' = 3x^2 - 6x - 9 = 3(x^2 - 2x - 3) = 3(x-3)(x+1)$$

**Bước 2:** Giải $y' = 0$:
$$x = 3 \\quad \\text{hoặc} \\quad x = -1$$

**Bước 3:** Xét dấu $y'$:

| Khoảng | $(-\\infty,-1)$ | $-1$ | $(-1,3)$ | $3$ | $(3,+\\infty)$ |
|--------|:-:|:-:|:-:|:-:|:-:|
| $y'$   | $+$ | $0$ | $-$ | $0$ | $+$ |
| $y$    | ↗ | **CĐ** | ↘ | **CT** | ↗ |

**Bước 4:** Tính giá trị:
- Cực đại tại $x = -1$: $y(-1) = -1 - 3 + 9 + 5 = \\mathbf{10}$
- Cực tiểu tại $x = 3$: $y(3) = 27 - 27 - 27 + 5 = \\mathbf{-22}$

**Vậy:** Hàm đạt **cực đại** $y = 10$ tại $x = -1$; đạt **cực tiểu** $y = -22$ tại $x = 3$.`,
  },

  // ── 10. Hệ phương trình (logarithm) ─────────────────────────────────────
  {
    topic: 'mu_logarit',
    difficulty: 'hard',
    question: 'Giải phương trình $\\log_2(x+1) + \\log_2(x-1) = 3$',
    answer: `**Giải phương trình** $\\log_2(x+1) + \\log_2(x-1) = 3$

**Bước 1:** Điều kiện xác định: $x+1 > 0$ và $x-1 > 0$, tức là $x > 1$.

**Bước 2:** Áp dụng $\\log_a m + \\log_a n = \\log_a(mn)$:
$$\\log_2[(x+1)(x-1)] = 3$$
$$\\log_2(x^2 - 1) = 3$$

**Bước 3:** Đưa về dạng mũ:
$$x^2 - 1 = 2^3 = 8$$
$$x^2 = 9 \\Rightarrow x = \\pm 3$$

**Bước 4:** Đối chiếu điều kiện $x > 1$:
- $x = 3$ ✓
- $x = -3$ ✗ (loại)

**Vậy** phương trình có nghiệm $x = 3$.`,
  },
];

// ── Main ─────────────────────────────────────────────────────────────────────
async function seed() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   🌱  SEED DATA — AI Gia sư Toán THPT               ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  → Vector DB  : ${process.env.VECTOR_DB ?? 'upstash'}`);
  console.log(`  → Embeddings : ${process.env.EMBEDDING_PROVIDER ?? 'google'}`);
  console.log(`  → Tổng mục   : ${SEED_DATA.length} câu hỏi`);
  console.log('');

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < SEED_DATA.length; i++) {
    const item = SEED_DATA[i];
    const num = String(i + 1).padStart(2, '0');
    const preview = item.question.replace(/\$[^$]+\$/g, '[LaTeX]').slice(0, 60);

    process.stdout.write(`  [${num}/${SEED_DATA.length}] ${preview}… `);

    try {
      await saveToCache(item.question, item.answer, null, {
        topic: item.topic,
        difficulty: item.difficulty,
        source: 'seed',
      });
      console.log('✅');
      ok++;
    } catch (err) {
      console.log(`❌  (${err.message})`);
      fail++;
    }

    // Tránh rate limit embedding API — chờ 300ms giữa các lần gọi
    if (i < SEED_DATA.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  console.log('');
  console.log('──────────────────────────────────────────────────────');
  console.log(`  ✅ Thành công : ${ok}`);
  if (fail > 0) console.log(`  ❌ Thất bại   : ${fail}`);
  console.log('');

  // Hiển thị thống kê cuối
  try {
    const stats = await getCacheStats();
    console.log(`  📊 Tổng vector trong DB: ${stats.vectorCount}`);
    console.log(`  📐 Dimension           : ${stats.dimension}`);
  } catch (_) { /* bỏ qua nếu API stats không hỗ trợ */ }

  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
  process.exit(0);
}

seed().catch(err => {
  console.error('\n  ❌ Seed lỗi nghiêm trọng:', err.message);
  console.error('  💡 Kiểm tra lại file .env (API key, URL vector DB)');
  process.exit(1);
});

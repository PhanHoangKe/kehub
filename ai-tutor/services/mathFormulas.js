/**
 * mathFormulas.js — Registry "công thức đã kiểm định" (Template Tier) cho AI gia sư.
 *
 * Ý TƯỞNG (so với hướng caching đáp án):
 *   • Cache đáp án chỉ khớp "y hệt câu đã gặp" — bỏ lỡ xu hỗn loạn biến thể đổi số.
 *   • Cache CÔNG THỨC nhận diện "đây là dạng nào" + trích tham số → chạy JS tester
 *     viết sẵn MỘT LẦN → tính không bao giờ sai, và generalize cho mọi biến thể.
 *
 * Mỗi template:
 *   slug        — định danh dạng bài
 *   name        — tên tiếng Việt
 *   description — mô tả cho LLM nhận diện (ngắn, có từ khoá)
 *   params      — { tên tham số: mô tả } dùng để LLM trích
 *   inputUnits  — gợi ý về đơn vị đầu vào
 *   solve(params) → { step, final, value } (JS thuần, KHÔNG gọi AI)
 *   explain(params, steps) → lời giải LaTeX chuẩn (tùy chọn, để build step_by_step)
 *
 * LUÔN LUÔN: khi thêm hàm mới → chạy lại file này để unit-test nó, đảm bảo
 * solver đúng số liệu gốc trước khi tin dùng.
 */

const R = Math.sqrt, PI = Math.PI;

// ── Tiện ích format số ────────────────────────────────────────────────────────
function round(n, d = 1) {
  const p = Math.pow(10, d);
  return Number((Math.round(n * p) / p).toFixed(d));
}
function sqrtTerm(n) {
  // Giữ dạng sqrt(21.39) khi đề yêu cầu, hoặc số thập phân khi cần KQ
  return Number.isInteger(n) && n >= 0 ? Math.sqrt(n) : Math.sqrt(n);
}

// ══════════════════════════════════════════════════════════════════════════════
//  TEMPLATE REGISTRY
// ══════════════════════════════════════════════════════════════════════════════
export const TEMPLATES = [
  {
    slug: 'frustum_square_minus_cap',
    name: 'Chóp cụt tứ giác đều (lỗ khối trụ) khoét chỏm cầu',
    description:
      'Vật thể có lỗ (đế/chân đế): đáy lớn và đáy nhỏ là hình vuông, chiều cao nhỏ; phía trên/trong bị khoét một chỏm cầu. Thường phát biểu dạng "bề dày h", "chỏm cầu cắt từ khối cầu bán kính R sao cho tiết diện là hình tròn bán kính r".',
    params: {
      a: 'cạnh đáy lớn (hình vuông)',
      b: 'cạnh đáy nhỏ (hình vuông)',
      h: 'chiều cao / bề dày của chóp cụt',
      R: 'bán kính khối cầu',
      r: 'bán kính hình tròn (tiết diện chỏm cầu)',
    },
    solve({ a, b, h, R, r }) {
      const S1 = a * a, S2 = b * b;
      const V1 = (h / 3) * (S1 + S2 + Math.sqrt(S1 * S2)); // thể tích chóp cụt
const d = R * R - r * r;                              // bình phương khoảng cách tâm
      const dd = Math.sqrt(Math.max(d, 0));
      const h0 = R - dd;                                 // chiều cao chỏm cầu
      const V2 = PI * h0 * h0 * (R - h0 / 3);            // thể tích chỏm cầu
      return { V1, V2, V: round(V1 - V2, 1), S1, S2, dd, h0 };
    },
    explain(p, st) {
      return (
`**Bước 1 — Thể tích chóp cụt:**
- Diện tích đáy lớn $S_1 = a^2 = ${p.a}^2 = ${st.S1.toFixed(2)}$ (cm²).
- Diện tích đáy nhỏ $S_2 = b^2 = ${p.b}^2 = ${st.S2.toFixed(2)}$ (cm²).
- Công thức: $V_1 = \\frac{1}{3}h\\left(S_1 + S_2 + \\sqrt{S_1 S_2}\\right) = ${st.V1.toFixed(2)}$ cm³.

**Bước 2 — Thể tích chỏm cầu bị khoét:**
- Khoảng cách tâm cầu → mặt cắt: $d = \\sqrt{R^2 - r^2} = \\sqrt{${p.R}^2 - ${p.r}^2} = ${st.dd.toFixed(4)}$ cm.
- Chiều cao chỏm cầu: $h_0 = R - d = ${st.h0.toFixed(4)}$ cm.
- Thể tích chỏm cầu: $V_2 = \\pi h_0^2\\left(R - \\dfrac{h_0}{3}\\right) = ${st.V2.toFixed(3)}$ cm³.

**Kết quả:** $V = V_1 - V_2 = ${st.V}${' '}cm³.`
      );
    },
  },
];

// ══════════════════════════════════════════════════════════════════════════════
//  SELF-TEST — chạy:  node ai-tutor/services/mathFormulas.js
//  Mỗi template có CASE_VERIFIED: đáp số đã được xác nhận bằng nguồn độc lập.
// ══════════════════════════════════════════════════════════════════════════════
export const VERIFIED_CASES = {
  frustum_square_minus_cap: [
    { input: { a: 10.4, b: 7.4, h: 1.5, R: 5.8, r: 3.5 }, expect: { V1: 119.94, V2: 23.4605, V: 96.5 } },
    // Biến thể đổi số — đảm bảo generalize (đáp số tính bằng công thức chuẩn)
    { input: { a: 12.1, b: 8.3, h: 2.0, R: 6.0, r: 4.0 }, expect: { V: 170.2 } },
  ],
};

export function runSelfTests() {
  let pass = 0, fail = 0;
  for (const t of TEMPLATES) {
    const cases = VERIFIED_CASES[t.slug] || [];
    for (const c of cases) {
      const st = t.solve(c.input);
      for (const [k, exp] of Object.entries(c.expect)) {
        const ok = Math.abs(st[k] - exp) < 0.02;
        if (ok) pass++; else { fail++; console.error(`  ✗ ${t.slug}.${k}: got ${st[k]}, expect ~${exp}`); }
      }
      // luôn test explain không throw
      try { t.explain(c.input, st); } catch (e) { fail++; console.error(`  ✗ ${t.slug}.explain throw: ${e.message}`); }
    }
  }
  console.log(`  [MathFormulas] self-test: ${pass} pass / ${fail} fail`);
  return fail === 0;
}

// Chạy trực tiếp khi file được thực thi
import { fileURLToPath } from 'url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ok = runSelfTests();
  process.exit(ok ? 0 : 1);
}
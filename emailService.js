/**
 * emailService.js — Gửi "trát hầu tòa" hài hước qua Gmail bằng nodemailer.
 *
 * Dùng biến môi trường (đọc từ .env ở server.js):
 *   EMAIL_USER  — địa chỉ Gmail gửi đi
 *   EMAIL_APP_PASS : App Password (x) của Gmail đó
 *
 * An toàn: không tin tưởng nội dung người dùng ra ngữa; mọi field được escape.
 * Nếu chưa cấu hình → không crash, chỉ báo lỗi an toàn.
 */

const nodemailer = require('nodemailer');

const EMAIL_USER = process.env.EMAIL_USER || '';
const EMAIL_APP_PASS = process.env.EMAIL_APP_PASS || '';

let transporter = null;

// ── Khởi tạo transporter (lazy) ────────────────────────────────────────────
function getTransporter() {
    if (!EMAIL_USER || !EMAIL_APP_PASS) {
        throw new Error('Chưa cấu hình EMAIL_USER / EMAIL_APP_PASS trong .env.');
    }
    if (transporter) return transporter;
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: EMAIL_USER, pass: EMAIL_APP_PASS },
    });
    return transporter;
}

function emailConfigured() {
    return Boolean(EMAIL_USER && EMAIL_APP_PASS);
}

// ── Escape HTML ─────────────────────────────────────────────────────────────
function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ── Định dạng số tiền: chỉ số nguyên, tự thêm VNĐ + phân tách nghìn ──────────
function formatMoney(amount) {
    const raw = String(amount ?? '').replace(/[^\d]/g, '');
    if (!raw) return `${amount ?? '?'}`;
    return `${parseInt(raw, 10).toLocaleString('vi-VN')} VNĐ`;
}

// ── Bullet chống HTML? giữ an toàn ──────────────────────────────────────────
function listHtml(items) {
    return items.map(m => `
      <li style="margin:0 0 12px 0;padding:12px 14px;background:#fff8ec;border:1px solid #e8d5a4;border-radius:8px;line-height:1.6;">
        <strong style="color:#8a4b08;text-transform:uppercase;font-size:12px;letter-spacing:1px;">${esc(m.title || 'Kịch bản')}</strong><br>
        <span style="color:#3b2a16;">${esc(m.text || '')}</span>
      </li>`).join('');
}

/**
 * Xây đối tượng email cảnh báo hài hước ("trát hầu tòa").
 * @returns {{to, subject, html, text}}
 */
function buildAlertEmail({ to, caseCode, debtor, amount, currency, reason, relationship, agentName, messages, byEndDate }) {
    const money = formatMoney(amount);
    const reasonStr = reason || 'một khoản cần thành toán gấp';
    const rel = relationship || 'người quen';
    const messageItems = Array.isArray(messages) ? messages.slice(0, 3) : [];
    const day = byEndDate || new Date(new Date().getTime() + 3 * 864e5).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const subject = `[CẢNH BÁO TỪ ĐẶC VỤ AI] - Hồ sơ thu hồi tài sản #${caseCode}`;

    const html = `
<div style="max-width:640px;margin:0 auto;font-family:Georgia,serif;background:#fffdf6;border:6px double #9a6b1f;color:#3b2a16;">
  <div style="background:#9a6b1f;color:#fffdf6;text-align:center;padding:18px 16px;">
    <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;">Văn Phòng Đặc Vụ Thu Hồi Vốn · Tuyệt Mật</div>
    <div style="font-size:26px;font-weight:bold;margin-top:4px;">THÔNG BÁO THU HỒI TÀI SẢN</div>
    <div style="font-size:12px;margin-top:4px;letter-spacing:1px;">Mã hồ sơ: <span style="color:#ffe9a8;">${esc(caseCode)}</span></div>
  </div>

  <div style="padding:22px 24px;">
    <p style="margin:0 0 6px 0;">Kính gửi: <strong>${esc(debtor || 'bạn')}</strong> (đối tượng ${esc(rel)}).</p>
    <p style="margin:0 0 16px 0;font-size:14px;">Hồ sơ thu hồi tài sản mang dấu hiệu <em>"nhẹ tay quên trả"</em> mà chủ nợ ủy quyền đặc vụ gửi đến mong bạn <strong>thành toán gấp</strong> theo kịch bản dưới đậy, trong hoà khí:</p>

    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:6px 8px;background:#f3e7c8;width:130px;font-weight:bold;">Tên đối tượng</td><td style="padding:6px 8px;">${esc(debtor || '...')}</td></tr>
      <tr><td style="padding:6px 8px;background:#f3e7c8;font-weight:bold;">Khoản thu hồi</td><td style="padding:6px 8px;color:#7a0c0c;font-weight:bold;">${money}</td></tr>
      <tr><td style="padding:6px 8px;background:#f3e7c8;font-weight:bold;">Lý do</td><td style="padding:6px 8px;">${reasonStr}</td></tr>
      <tr><td style="padding:6px 8px;background:#f3e7c8;font-weight:bold;">Mối quan hệ</td><td style="padding:6px 8px;">${rel}</td></tr>
      <tr><td style="padding:6px 8px;background:#f3e7c8;font-weight:bold;">Đặc vụ phụ trách</td><td style="padding:6px 8px;">${esc(agentName || 'Đặc Vụ')}</td></tr>
    </table>

    <p style="font-size:13px;color:#7a0c0c;margin:4px 0 0 0;">⚠ Quá hạn đến ngày <strong>${day}</strong> mọi thông tin tố giác sẽ... được tiếp tục làm hồ sơ vui vẻ. Đừng để sự việc "lên sóng".</p>

    <p style="margin:20px 0 8px;font-weight:bold;font-size:15px;">3 Kịch bản "hòa giải thân thiện":</p>
    <ul style="list-style:none;padding:0;margin:0;">${listHtml(messageItems)}</ul>

    <p style="margin:18px 0 0;font-size:12px;color:#7c6a45;border-top:1px dashed #d6c189;padding-top:12px;">
      Đây là thông báo tự động từ đặc vụ từ chủ nợ, gửi/ha mang tính hài hước nhằm gợi nhắc. Vui lòng không phản hồi email này.<br>
      <span style="font-style:italic;">Chữ ký số hư rồi — chữ ký lòng vẫn còn nguyên vẹn.</span>
    </p>
  </div>
</div>`;

    return { to: to, subject, html, text: `[CẢNH BÁO TỪ ĐẶC VỤ AI] - Hồ sơ thu hồi tài sản #${caseCode}\n\n"${money} — ${reasonStr}".\n${messageItems.map(m => `• ${m.title}: ${m.text}`).join('\n')}` };
}

/**
 * Gửi email cảnh báo tới email con nợ.
 * @returns {Promise<{ok:boolean,error?:string}>}
 */
async function sendWarningEmail({ to, caseCode, debtor, amount, currency, reason, relationship, agent, messages }) {
    if (!to) return { ok: false, error: 'Không có email người nhận.' };
    if (!emailConfigured()) return { ok: false, error: 'Server chưa cấu hình EMAIL_USER / EMAIL_APP_PASS.' };

    const mail = buildAlertEmail({ to, caseCode, debtor, amount, currency, reason, relationship, agentName: agent, messages });
    try {
        await getTransporter().sendMail({
            from: `"Đặc Vụ AI" <${EMAIL_USER}>`,
            to,
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
        });
        return { ok: true };
    } catch (err) {
        console.error('  [Email] Gửi lỗi:', err.message);
        return { ok: false, error: err.message };
    }
}

module.exports = {
    emailConfigured,
    buildAlertEmail,
    sendWarningEmail,
};
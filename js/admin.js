/**
 * admin.js - Trung Tâm Quản Lý Admin Kế (Quản lý không giới hạn Ảnh, Dấu Chân Thanh Xuân & Playlist)
 */
import { escapeHTML } from './config.js';
import { showToast } from './toast.js';

// ── Session cache trong memory ─────────────────────────────────────────────
let _adminAuthenticated = false;

async function checkAdminSession() {
    try {
        const token = localStorage.getItem('admin_token');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('/api/admin/check', { headers, credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            _adminAuthenticated = data.authenticated === true;
        }
    } catch (e) {
        _adminAuthenticated = false;
    }
    return _adminAuthenticated;
}

// Hiển thị modal đăng nhập và trả về Promise<boolean>
function promptAdminLogin() {
    return new Promise((resolve) => {
        // Tạo modal login nếu chưa có
        let loginModal = document.getElementById('adminLoginModal');
        if (!loginModal) {
            loginModal = document.createElement('div');
            loginModal.id = 'adminLoginModal';
            loginModal.className = 'admin-login-overlay';
            loginModal.innerHTML = `
                <div class="admin-login-card">
                    <!-- Glow accent top -->
                    <div class="admin-login-glow"></div>

                    <!-- Header -->
                    <div class="admin-login-header">
                        <div class="admin-login-icon">
                            <i class="fa-solid fa-shield-halved"></i>
                        </div>
                        <div>
                            <h3 class="admin-login-title">Khu Vực Admin</h3>
                            <p class="admin-login-sub">Chỉ dành cho chủ sở hữu</p>
                        </div>
                    </div>

                    <!-- Divider -->
                    <div class="admin-login-divider"></div>

                    <!-- Body -->
                    <div class="admin-login-body">
                        <label class="admin-login-label">
                            <i class="fa-solid fa-lock"></i> Mật khẩu Admin
                        </label>
                        <div class="admin-password-wrap">
                            <input type="password" id="adminPasswordInput"
                                   class="admin-login-input"
                                   placeholder="Nhập mật khẩu của bạn..."
                                   autocomplete="current-password" />
                            <button type="button" id="adminTogglePassword" class="admin-toggle-eye" tabindex="-1">
                                <i class="fa-solid fa-eye"></i>
                            </button>
                        </div>
                        <p id="adminLoginError" class="admin-login-error"></p>
                    </div>

                    <!-- Footer -->
                    <div class="admin-login-footer">
                        <button id="adminLoginCancel" class="admin-btn-cancel">
                            Hủy
                        </button>
                        <button id="adminLoginSubmit" class="admin-btn-submit">
                            <i class="fa-solid fa-arrow-right-to-bracket"></i>
                            <span>Đăng Nhập</span>
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(loginModal);

            // Toggle show/hide password
            loginModal.querySelector('#adminTogglePassword').addEventListener('click', () => {
                const inp = loginModal.querySelector('#adminPasswordInput');
                const icon = loginModal.querySelector('#adminTogglePassword i');
                if (inp.type === 'password') {
                    inp.type = 'text';
                    icon.className = 'fa-solid fa-eye-slash';
                } else {
                    inp.type = 'password';
                    icon.className = 'fa-solid fa-eye';
                }
            });
        }

        loginModal.style.display = 'flex';
        loginModal.classList.add('active');

        const input    = document.getElementById('adminPasswordInput');
        const errorEl  = document.getElementById('adminLoginError');
        const btnOk    = document.getElementById('adminLoginSubmit');
        const btnCancel = document.getElementById('adminLoginCancel');

        if (input) { input.value = ''; setTimeout(() => input.focus(), 100); }
        if (errorEl) errorEl.style.display = 'none';

        async function doLogin() {
            const password = input ? input.value : '';
            if (!password) return;

            btnOk.disabled = true;
            btnOk.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang kiểm tra...';

            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ password }),
                });
                const data = await res.json();

                if (data.success) {
                    if (data.token) localStorage.setItem('admin_token', data.token);
                    _adminAuthenticated = true;
                    loginModal.style.display = 'none';
                    loginModal.classList.remove('active');
                    resolve(true);
                } else {
                    if (errorEl) { errorEl.textContent = data.message || 'Mật khẩu không đúng'; errorEl.style.display = 'block'; }
                    btnOk.disabled = false;
                    btnOk.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i><span>Đăng Nhập</span>';
                    if (input) input.value = '';
                }
            } catch (e) {
                if (errorEl) {
                    errorEl.textContent = e.message && e.message.includes('fetch')
                        ? 'Không kết nối được server. Hãy chắc chắn server đang chạy tại http://localhost:3000'
                        : 'Lỗi kết nối server';
                    errorEl.style.display = 'block';
                }
                btnOk.disabled = false;
                btnOk.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i><span>Đăng Nhập</span>';
            }
        }

        if (btnOk) btnOk.addEventListener('click', doLogin, { once: true });
        if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
        if (btnCancel) {
            btnCancel.addEventListener('click', () => {
                loginModal.style.display = 'none';
                loginModal.classList.remove('active');
                resolve(false);
            }, { once: true });
        }
    });
}

export function initAdminEngine(getState, setState, saveBackendConfig, refreshDOM) {
    const btnCustomization = document.getElementById('btnCustomization');
    const customModal = document.getElementById('customModal');
    const btnCloseModal = document.getElementById('btnCloseModal');
    const btnSaveSettings = document.getElementById('btnSaveSettings');

    // Helper đọc file Base64
    function readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function compressImage(file, maxWidth = 1200, maxHeight = 1200, quality = 0.85) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth || height > maxHeight) {
                        if (width / height > maxWidth / maxHeight) {
                            height = Math.round((height * maxWidth) / width);
                            width = maxWidth;
                        } else {
                            width = Math.round((width * maxHeight) / height);
                            height = maxHeight;
                        }
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    let dataUrl = canvas.toDataURL('image/webp', quality);
                    if (!dataUrl || !dataUrl.startsWith('data:image/webp')) {
                        dataUrl = canvas.toDataURL('image/jpeg', quality);
                    }
                    resolve(dataUrl);
                };
                img.onerror = () => resolve(e.target.result);
                img.src = e.target.result;
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        });
    }

    // Helper upload file lên Backend Node.js Server (Tối ưu giữ ảnh 100% không mất khi redeploy)
    async function uploadFileToBackend(filename, base64Data) {
        // Dành cho ảnh: Trả về trực tiếp Base64 Data URL để lưu thẳng vào db.json
        // Giúp ảnh tồn tại vĩnh viễn 100% ngay cả khi Render xoá thư mục /uploads/
        if (base64Data && base64Data.startsWith('data:image/')) {
            return base64Data;
        }
        try {
            const token = localStorage.getItem('admin_token');
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch('/api/upload', {
                method: 'POST',
                headers,
                credentials: 'include',
                body: JSON.stringify({ fileName: filename, fileData: base64Data }),
            });
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.fileUrl) return data.fileUrl;
            }
        } catch (e) {
            console.log('Upload server offline, sử dụng base64 local fallback.');
        }
        return base64Data;
    }

    async function loadAdminVisitorsList() {
        const adminVisitorsList = document.getElementById('adminVisitorsList');
        if (!adminVisitorsList) return;

        const statOnlineNow = document.getElementById('admStatOnlineNow');
        const statTotalVisitors = document.getElementById('admStatTotalVisitors');
        const statTopDevice = document.getElementById('admStatTopDevice');
        const statTopCity = document.getElementById('admStatTopCity');

        try {
            const token = localStorage.getItem('admin_token');
            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch('/api/admin/visitors', { headers, credentials: 'include' });
            if (!res.ok) {
                adminVisitorsList.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:24px;">Chưa xác thực Admin hoặc lỗi kết nối.</div>';
                return;
            }
            const data = await res.json();
            if (!data.success) return;

            if (statOnlineNow) statOnlineNow.textContent = data.onlineCount || 0;
            if (statTotalVisitors) statTotalVisitors.textContent = data.totalVisitors || 0;
            if (statTopDevice) statTopDevice.textContent = data.topDevice || '-';
            if (statTopCity) statTopCity.textContent = data.topCity || '-';

            const visitors = data.visitors || [];
            if (visitors.length === 0) {
                adminVisitorsList.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:24px;">Chưa có khách viếng thăm nào.</div>';
                return;
            }

            adminVisitorsList.innerHTML = '';
            const nowMs = Date.now();

            const onlineCount = visitors.filter(v => {
                const lastMs = new Date(v.lastSeen).getTime();
                return (nowMs - lastMs) <= 5 * 60 * 1000;
            }).length;

            const tabVisitorsBadge = document.getElementById('tabVisitorsBadge');
            if (tabVisitorsBadge) {
                if (onlineCount > 0) {
                    tabVisitorsBadge.textContent = onlineCount;
                    tabVisitorsBadge.style.display = 'inline-block';
                } else {
                    tabVisitorsBadge.style.display = 'none';
                }
            }

            if (statOnlineNow) statOnlineNow.textContent = onlineCount;

            visitors.forEach((v, index) => {
                const card = document.createElement('div');
                card.className = 'admin-item-card';
                card.style.position = 'relative';

                const lastSeenMs = new Date(v.lastSeen).getTime();
                const isOnline = (nowMs - lastSeenMs) <= 5 * 60 * 1000;
                const statusBadge = isOnline 
                    ? `<span style="background:rgba(34,197,94,0.2);color:#4ade80;border:1px solid rgba(34,197,94,0.4);padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:bold;">🟢 ĐANG ONLINE</span>`
                    : `<span style="background:rgba(148,163,184,0.15);color:#94a3b8;padding:2px 8px;border-radius:12px;font-size:0.75rem;">⚪ Đã rời đi</span>`;

                const timeStr = new Date(v.lastSeen).toLocaleString('vi-VN');
                const durationMin = Math.floor((v.durationSeconds || 0) / 60);
                const durationSec = (v.durationSeconds || 0) % 60;
                const durationText = durationMin > 0 ? `${durationMin} phút ${durationSec}s` : `${durationSec}s`;

                const batteryStr = v.battery ? ` • 🔋 Pin: ${escapeHTML(v.battery)}` : '';
                const networkStr = v.connection ? ` • 📶 Mạng: ${escapeHTML(v.connection.toUpperCase())}` : '';
                const screenStr = v.screen && v.screen !== '-' ? ` • 📐 Màn hình: ${escapeHTML(v.screen)} (x${v.dpr || 1})` : '';

                const timelineHtml = (v.timelineLogs || []).map(log => 
                    `<div style="font-size:0.75rem;color:#cbd5e1;padding:2px 0;border-bottom:1px dashed rgba(255,255,255,0.05);display:flex;gap:6px;">
                        <span style="color:#94a3b8;min-width:60px;">${escapeHTML(log.time)}</span>
                        <strong style="color:#38bdf8;">${escapeHTML(log.event)}</strong>
                        <span style="color:#64748b;">${escapeHTML(log.detail || '')}</span>
                    </div>`
                ).join('');

                const gmapBtn = (v.lat && v.lng) 
                    ? `<a href="https://www.google.com/maps?q=${v.lat},${v.lng}" target="_blank" style="background:#0284c7;color:#ffffff;padding:3px 10px;border-radius:6px;font-size:0.75rem;font-weight:bold;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-left:6px;box-shadow:0 0 10px rgba(2,132,199,0.5);"><i class="fa-solid fa-map-location-dot"></i> 🗺️ Mở Google Maps</a>`
                    : '';

                const isGpsExact = v.isGps || (v.accuracy && v.accuracy <= 500);
                const geoBadge = isGpsExact
                    ? `<span style="background:rgba(34,197,94,0.2);color:#4ade80;border:1px solid rgba(34,197,94,0.4);padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:bold;">🎯 GPS Chuẩn Xóm/Xã (Khách đã cấp quyền)</span>`
                    : (v.lat && v.lng 
                        ? `<span style="background:rgba(234,179,8,0.2);color:#facc15;border:1px solid rgba(234,179,8,0.4);padding:2px 8px;border-radius:10px;font-size:0.72rem;">📶 Ước Tính IP Mạng (Chưa có GPS)</span>`
                        : `<span style="background:rgba(148,163,184,0.15);color:#94a3b8;padding:2px 8px;border-radius:10px;font-size:0.72rem;">❓ Vị Trí Chưa Rõ</span>`);

                const locationTitle = isGpsExact 
                    ? `<span style="color:#4ade80;font-weight:bold;">${escapeHTML(v.city || 'Xã / Tỉnh')} (🎯 GPS Chính Xác)</span>`
                    : `<span style="color:#facc15;font-weight:bold;">${escapeHTML(v.city || 'Ước tính IP')} (Chưa có GPS)</span>`;

                const accuracyStr = v.accuracy ? `<span style="color:#4ade80;"> • Sai số: ~${v.accuracy}m</span>` : '';

                const deleteBtnHtml = `<button type="button" class="btn-delete-visitor" style="background:rgba(239,68,68,0.2);color:#f87171;border:1px solid rgba(239,68,68,0.4);padding:3px 10px;border-radius:6px;font-size:0.75rem;font-weight:bold;cursor:pointer;margin-left:8px;" title="Xóa nhật ký khách này"><i class="fa-solid fa-trash-can"></i> Xóa</button>`;

                const gpuStr = v.gpu ? ` • 🎮 GPU: ${escapeHTML(v.gpu)}` : '';
                const cpuStr = v.cpuCores ? ` • ⚡ Chip: ${v.cpuCores} Nhân CPU` : '';
                const ramStr = v.ramGB ? ` • 💾 RAM: ${v.ramGB}GB` : '';

                card.innerHTML = `
                    <div class="admin-item-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:4px;">
                        <span><i class="fa-solid fa-user-ninja" style="color:#a855f7;"></i> Khách #${index + 1} — <strong style="color:#f472b6;">${escapeHTML(v.city || 'Việt Nam')}</strong> (${escapeHTML(v.isp || 'Nhà mạng')}) ${statusBadge} ${geoBadge} ${gmapBtn} ${deleteBtnHtml}</span>
                        <span style="font-size:0.78rem;color:#94a3b8;"><i class="fa-solid fa-clock"></i> ${timeStr}</span>
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:6px;font-size:0.82rem;color:#cbd5e1;background:rgba(0,0,0,0.25);padding:10px;border-radius:8px;margin-bottom:8px;">
                        <div>🌐 <strong>IP Thật:</strong> <span style="font-family:monospace;color:#facc15;">${escapeHTML(v.ip)}</span></div>
                        <div>📍 <strong>🏡 Vị trí chi tiết:</strong> ${locationTitle} ${v.lat && v.lng ? `<br><small style="color:#38bdf8;">Tọa độ: ${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}${accuracyStr}</small>` : ''}</div>
                        <div>📱 <strong>Tên Thiết bị:</strong> <span style="color:#38bdf8;font-weight:bold;">${escapeHTML(v.device)}</span> • ${escapeHTML(v.os)}</div>
                        <div>💻 <strong>Trình duyệt:</strong> ${escapeHTML(v.browser)}</div>
                        <div>🔗 <strong>Nguồn đến (Referrer):</strong> <span style="color:#38bdf8;word-break:break-all;">${escapeHTML(v.referrer)}</span></div>
                        <div>⏱️ <strong>Thời gian ở lại:</strong> <span style="color:#4ade80;font-weight:bold;">${durationText}</span> (${v.clicks || 1} lượt click)</div>
                        <div style="grid-column:1 / -1;font-size:0.78rem;color:#94a3b8;border-top:1px solid rgba(255,255,255,0.06);padding-top:4px;">
                            ⚙️ <strong>Phần cứng chuyên sâu:</strong> ${screenStr}${networkStr}${batteryStr}${gpuStr}${cpuStr}${ramStr}
                        </div>
                    </div>
                    <details style="font-size:0.8rem;color:#94a3b8;cursor:pointer;">
                        <summary style="font-weight:bold;color:#a855f7;outline:none;margin-bottom:4px;">
                            📜 Xem Nhật Ký Thao Tác Chi Tiết (${(v.timelineLogs || []).length} bước)
                        </summary>
                        <div style="background:rgba(15,23,42,0.6);padding:8px;border-radius:6px;margin-top:4px;max-height:160px;overflow-y:auto;">
                            ${timelineHtml || '<div style="font-size:0.75rem;color:#64748b;">Chưa có thao tác thêm</div>'}
                        </div>
                    </details>
                `;

                const btnDelete = card.querySelector('.btn-delete-visitor');
                if (btnDelete) {
                    btnDelete.addEventListener('click', async (evt) => {
                        evt.stopPropagation();
                        if (confirm(`🗑️ Bạn có chắc muốn xóa nhật ký của Khách (IP: ${v.ip})?`)) {
                            try {
                                const token = localStorage.getItem('admin_token');
                                const headers = { 'Content-Type': 'application/json' };
                                if (token) headers['Authorization'] = `Bearer ${token}`;

                                const res = await fetch('/api/admin/visitors/delete', {
                                    method: 'POST',
                                    headers,
                                    credentials: 'include',
                                    body: JSON.stringify({ sessionId: v.sessionId, id: v.id })
                                });
                                const resData = await res.json();
                                if (resData.success) {
                                    showToast("Đã xóa nhật ký khách thành công! 🗑️", "info");
                                    loadAdminVisitorsList();
                                } else {
                                    alert(resData.message || "Không thể xóa nhật ký.");
                                }
                            } catch (e) {
                                alert("Lỗi kết nối khi xóa.");
                            }
                        }
                    });
                }

                adminVisitorsList.appendChild(card);
            });
        } catch (e) {
            adminVisitorsList.innerHTML = '<div style="text-align:center;color:#dc2626;padding:24px;">Lỗi kết nối server tracking.</div>';
        }
    }

    // Admin Tabs Switching & Smart Tab-Scoped Polling
    let _visitorPollTimer = null;
    const adminTabBtns = document.querySelectorAll('.admin-tab-btn');
    const adminTabContents = document.querySelectorAll('.admin-tab-content');

    adminTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            adminTabBtns.forEach(b => b.classList.remove('active'));
            adminTabContents.forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const targetTab = btn.getAttribute('data-tab');
            const targetContent = document.getElementById(targetTab);
            if (targetContent) targetContent.classList.add('active');

            // Dừng polling của tab trước đó (nếu có)
            if (_visitorPollTimer) {
                clearInterval(_visitorPollTimer);
                _visitorPollTimer = null;
            }

            // Kích hoạt smart polling CHỈ KHI đang mở Tab Visitors
            if (targetTab === 'tabVisitors') {
                loadAdminVisitorsList();
                _visitorPollTimer = setInterval(loadAdminVisitorsList, 2000);
            }
        });
    });

    const btnRefreshVisitors = document.getElementById('btnRefreshVisitors');
    if (btnRefreshVisitors) {
        btnRefreshVisitors.addEventListener('click', loadAdminVisitorsList);
    }

    const urlParams = new URLSearchParams(window.location.search);
    const isAdmin = urlParams.get('admin') === 'true';
    if (btnCustomization) {
        btnCustomization.style.display = 'inline-flex';
        if (isAdmin) {
            setTimeout(() => btnCustomization.click(), 500);
        }
    }

    if (btnCustomization && customModal) {
        btnCustomization.addEventListener('click', async () => {
            // Kiểm tra / yêu cầu xác thực Admin trước khi mở panel
            const alreadyAuth = await checkAdminSession();
            if (!alreadyAuth) {
                const loggedIn = await promptAdminLogin();
                if (!loggedIn) return;
            }

            const state = getState();
            
            const inputName = document.getElementById('inputName');
            const inputSchoolName = document.getElementById('inputSchoolName');
            const inputClassName = document.getElementById('inputClassName');
            const inputClassSlogan = document.getElementById('inputClassSlogan');
            const inputPhotoUrl = document.getElementById('inputPhotoUrl');
            const inputQuote1 = document.getElementById('inputQuote1');
            const inputQuote2 = document.getElementById('inputQuote2');
            const inputQuote3 = document.getElementById('inputQuote3');
            const inputBirthdayDate = document.getElementById('inputBirthdayDate');
            const inputFavMusic = document.getElementById('inputFavMusic');
            const inputFavMovie = document.getElementById('inputFavMovie');
            const inputFavBook = document.getElementById('inputFavBook');
            const inputFavDrink = document.getElementById('inputFavDrink');
            const inputFavFashion = document.getElementById('inputFavFashion');
            const inputFavLover = document.getElementById('inputFavLover');
            const inputFavLifestyle = document.getElementById('inputFavLifestyle');
            const inputFavColor = document.getElementById('inputFavColor');
            const inputBalloonTiktokUrl = document.getElementById('inputBalloonTiktokUrl');

            if (inputName) inputName.value = state.name || '';
            if (inputSchoolName) inputSchoolName.value = state.schoolName || '';
            if (inputClassName) inputClassName.value = state.className || '';
            if (inputClassSlogan) inputClassSlogan.value = state.classSlogan || '';
            if (inputPhotoUrl) inputPhotoUrl.value = state.photoUrl && state.photoUrl.startsWith('data:') ? '' : (state.photoUrl || '');
            if (inputQuote1) inputQuote1.value = state.quote1 || '';
            if (inputQuote2) inputQuote2.value = state.quote2 || '';
            if (inputQuote3) inputQuote3.value = state.quote3 || '';
            if (inputBirthdayDate) inputBirthdayDate.value = state.birthdayDate || '';
            if (inputBalloonTiktokUrl) inputBalloonTiktokUrl.value = state.balloonTiktokUrl || '';

            const inputLinkFacebook = document.getElementById('inputLinkFacebook');
            const inputLinkMessenger = document.getElementById('inputLinkMessenger');
            const inputLinkZalo = document.getElementById('inputLinkZalo');
            const inputLinkTiktok = document.getElementById('inputLinkTiktok');
            const inputLinkInstagram = document.getElementById('inputLinkInstagram');

            if (state.socialLinks) {
                if (inputLinkFacebook) inputLinkFacebook.value = state.socialLinks.facebook || '';
                if (inputLinkMessenger) inputLinkMessenger.value = state.socialLinks.messenger || '';
                if (inputLinkZalo) inputLinkZalo.value = state.socialLinks.zalo || '';
                if (inputLinkTiktok) inputLinkTiktok.value = state.socialLinks.tiktok || '';
                if (inputLinkInstagram) inputLinkInstagram.value = state.socialLinks.instagram || '';
            }

            if (inputFavMusic) inputFavMusic.value = state.favMusic || '';
            if (inputFavMovie) inputFavMovie.value = state.favMovie || '';
            if (inputFavBook) inputFavBook.value = state.favBook || '';
            if (inputFavDrink) inputFavDrink.value = state.favDrink || '';
            if (inputFavFashion) inputFavFashion.value = state.favFashion || '';
            if (inputFavLover) inputFavLover.value = state.favLover || '';
            if (inputFavLifestyle) inputFavLifestyle.value = state.favLifestyle || '';
            if (inputFavColor) inputFavColor.value = state.favColor || '';

            const inputGraduationDate = document.getElementById('inputGraduationDate');
            const capsuleStatusInfo = document.getElementById('capsuleStatusInfo');

            const inputHomeLat = document.getElementById('inputHomeLat');
            const inputHomeLng = document.getElementById('inputHomeLng');
            const inputHomeAddress = document.getElementById('inputHomeAddress');

            if (state.homeLocation) {
                if (inputHomeLat) inputHomeLat.value = state.homeLocation.lat || '';
                if (inputHomeLng) inputHomeLng.value = state.homeLocation.lng || '';
                if (inputHomeAddress) inputHomeAddress.value = state.homeLocation.address || '';
            }

            if (inputGraduationDate) inputGraduationDate.value = state.graduationDate || '2026-06-30';
            updateCapsuleStatusDOM(state, capsuleStatusInfo);

            // Cập nhật chỉ số thống kê System Admin
            const admStatWishes = document.getElementById('admStatWishes');
            const admStatHearts = document.getElementById('admStatHearts');
            const admStatTracks = document.getElementById('admStatTracks');
            const admStatGallery = document.getElementById('admStatGallery');

            const guestbookWall = document.getElementById('guestbookWall');
            const wishCount = guestbookWall ? guestbookWall.children.length : 0;
            // Đọc tổng reactions từ element reactionTotalCount
            const reactionTotalEl = document.getElementById('reactionTotalCount');
            const hearts = reactionTotalEl ? reactionTotalEl.textContent : '0';

            if (admStatWishes) admStatWishes.textContent = wishCount;
            if (admStatHearts) admStatHearts.textContent = hearts;
            if (admStatTracks) admStatTracks.textContent = (state.playlist || []).length;
            if (admStatGallery) admStatGallery.textContent = (state.gallery || []).length;

            renderAdminPlaylistList();
            renderAdminGalleryList();
            renderAdminJourneyList();
            renderAdminMapLocationsList();
            fetchAndRenderAnonymousMessages();

            customModal.classList.add('active');
        });
    }

    async function fetchAndRenderAnonymousMessages() {
        const adminAnonymousList = document.getElementById('adminAnonymousList');
        if (!adminAnonymousList) return;

        try {
            const res = await fetch('/api/data');
            const data = await res.json();
            const msgs = data.anonymousMessages || [];
            
            adminAnonymousList.innerHTML = '';
            if (msgs.length === 0) {
                adminAnonymousList.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:24px;font-size:0.88rem;">Chưa có tin nhắn ẩn danh nào.</div>';
                return;
            }

            msgs.slice().reverse().forEach(msg => {
                const div = document.createElement('div');
                div.className = 'anon-message-item';
                const timeStr = new Date(msg.createdAt).toLocaleString('vi-VN');

                // Render media attachment nếu có
                let mediaHTML = '';
                if (msg.mediaUrl) {
                    const type = msg.mediaType || '';
                    if (type === 'audio') {
                        mediaHTML = `
                            <div class="anon-media-attach">
                                <span class="anon-media-tag"><i class="fa-solid fa-microphone"></i> Ghi âm</span>
                                <audio controls class="anon-admin-audio" src="${escapeHTML(msg.mediaUrl)}"></audio>
                            </div>`;
                    } else if (type === 'image') {
                        mediaHTML = `
                            <div class="anon-media-attach">
                                <span class="anon-media-tag"><i class="fa-solid fa-image"></i> Ảnh</span>
                                <img class="anon-admin-img" src="${escapeHTML(msg.mediaUrl)}"
                                     alt="Ảnh ẩn danh"
                                     onclick="window.open('${escapeHTML(msg.mediaUrl)}','_blank')">
                            </div>`;
                    } else if (type === 'video') {
                        mediaHTML = `
                            <div class="anon-media-attach">
                                <span class="anon-media-tag"><i class="fa-solid fa-video"></i> Video</span>
                                <video controls class="anon-admin-video" src="${escapeHTML(msg.mediaUrl)}"></video>
                            </div>`;
                    }
                }

                div.innerHTML = `
                    <div class="anon-message-time"><i class="fa-solid fa-clock"></i> ${timeStr}</div>
                    ${msg.message ? `<div class="anon-message-text">${escapeHTML(msg.message)}</div>` : ''}
                    ${mediaHTML}
                `;
                adminAnonymousList.appendChild(div);
            });
        } catch (e) {
            adminAnonymousList.innerHTML = '<div style="text-align:center;color:#dc2626;padding:24px;font-size:0.88rem;"><i class="fa-solid fa-triangle-exclamation"></i> Lỗi tải dữ liệu — bạn đang chạy offline?</div>';
        }
    }

    // Sự kiện nút Niêm Phong / Mở Niêm Phong Viên Nang Tốt Nghiệp
    const btnSealCapsule = document.getElementById('btnSealCapsule');
    if (btnSealCapsule) {
        btnSealCapsule.addEventListener('click', async () => {
            const state = getState();
            const inputGraduationDate = document.getElementById('inputGraduationDate');
            const capsuleStatusInfo = document.getElementById('capsuleStatusInfo');

            if (inputGraduationDate && inputGraduationDate.value) {
                state.graduationDate = inputGraduationDate.value;
            }

            if (!state.isCapsuleLocked) {
                const confirmLock = confirm(`🎓 XÁC NHẬN LỄ NIÊM PHONG THANH XUÂN?\n\nKhi bạn đồng ý, toàn bộ kỷ niệm thời học sinh (Nhật ký, Ảnh lớp, Thành tích, Lưu bút) sẽ được khóa lại trong 'Viên Nang Thời Gian Tốt Nghiệp'.\n\nBạn có chắc chắn muốn niêm phong viên nang không?`);
                if (confirmLock) {
                    state.isCapsuleLocked = true;
                    state.sealedAt = new Date().toISOString();
                    updateCapsuleStatusDOM(state, capsuleStatusInfo);
                    await saveBackendConfig(state);
                    refreshDOM();
                    alert("✨ ĐÃ NIÊM PHONG THÀNH CÔNG VIÊN NANG THỜI GIAN TỐT NGHIỆP! 🎓\n\nKý ức thời học sinh của bạn đã được bảo tồn vĩnh viễn.");
                }
            } else {
                const confirmUnlock = confirm(`Mở khóa lại Viên Nang Thời Gian Tốt Nghiệp để bổ sung ký ức?`);
                if (confirmUnlock) {
                    state.isCapsuleLocked = false;
                    updateCapsuleStatusDOM(state, capsuleStatusInfo);
                    await saveBackendConfig(state);
                    refreshDOM();
                    alert("🔓 Đã mở khóa chỉnh sửa viên nang!");
                }
            }
        });
    }

    if (btnCloseModal && customModal) {
        btnCloseModal.addEventListener('click', () => {
            customModal.classList.remove('active');
            if (_visitorPollTimer) {
                clearInterval(_visitorPollTimer);
                _visitorPollTimer = null;
            }
        });
    }

    const btnCancelSettings = document.getElementById('btnCancelSettings');
    if (btnCancelSettings && customModal) {
        btnCancelSettings.addEventListener('click', () => {
            customModal.classList.remove('active');
            if (_visitorPollTimer) {
                clearInterval(_visitorPollTimer);
                _visitorPollTimer = null;
            }
        });
    }

    // List Management Renderers
    const musicPlaylistAdminList = document.getElementById('musicPlaylistAdminList');
    const galleryAdminList = document.getElementById('galleryAdminList');
    const journeyAdminList = document.getElementById('journeyAdminList');
    const btnAddPlaylistTrack = document.getElementById('btnAddPlaylistTrack');
    const btnAddGalleryPhoto = document.getElementById('btnAddGalleryPhoto');
    const btnAddJourneyCard = document.getElementById('btnAddJourneyCard');

    function renderAdminPlaylistList() {
        if (!musicPlaylistAdminList) return;
        musicPlaylistAdminList.innerHTML = '';
        const state = getState();

        (state.playlist || []).forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'admin-item-card';
            card.innerHTML = `
                <div class="admin-item-header">
                    <span><i class="fa-solid fa-compact-disc"></i> Bài Hát #${index + 1}</span>
                    <button class="btn-remove-item" data-index="${index}"><i class="fa-solid fa-trash"></i> Xóa</button>
                </div>
                <div class="admin-item-grid">
                    <div class="input-group">
                        <label>Tải File MP3 từ máy:</label>
                        <input type="file" class="adm-trk-file" data-index="${index}" accept="audio/*">
                    </div>
                    <div class="input-group">
                        <label>Hoặc Dán Link MP3 URL:</label>
                        <input type="text" class="adm-trk-url" data-index="${index}" value="${escapeHTML(item.url || '')}" placeholder="https://.../music.mp3">
                    </div>
                    <div class="input-group">
                        <label>Tên bài hát:</label>
                        <input type="text" class="adm-trk-title" data-index="${index}" value="${escapeHTML(item.title || '')}" placeholder="VD: Giai Điệu Thanh Xuân">
                    </div>
                    <div class="input-group">
                        <label>Ca sĩ / Nghệ sĩ:</label>
                        <input type="text" class="adm-trk-artist" data-index="${index}" value="${escapeHTML(item.artist || '')}" placeholder="VD: Acoustic Cover">
                    </div>
                </div>
            `;
            const btnRemove = card.querySelector('.btn-remove-item');
            if (btnRemove) {
                btnRemove.addEventListener('click', () => {
                    const st = getState();
                    if (st.playlist) st.playlist.splice(index, 1);
                    renderAdminPlaylistList();
                });
            }
            musicPlaylistAdminList.appendChild(card);
        });
    }

    function renderAdminGalleryList() {
        if (!galleryAdminList) return;
        galleryAdminList.innerHTML = '';
        const state = getState();

        (state.gallery || []).forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'admin-item-card';
            card.innerHTML = `
                <div class="admin-item-header">
                    <span><i class="fa-solid fa-camera"></i> Bức Ảnh #${index + 1}</span>
                    <button class="btn-remove-item" data-index="${index}"><i class="fa-solid fa-trash"></i> Xóa</button>
                </div>
                <div class="admin-item-grid">
                    <div class="input-group">
                        <label>Tải File Ảnh từ máy:</label>
                        <input type="file" class="adm-gal-file" data-index="${index}" accept="image/*">
                    </div>
                    <div class="input-group">
                        <label>Hoặc Dán Link URL Ảnh:</label>
                        <input type="text" class="adm-gal-url" data-index="${index}" value="${escapeHTML(item.url || '')}" placeholder="https://...">
                    </div>
                    <div class="input-group">
                        <label>Chú thích ảnh:</label>
                        <input type="text" class="adm-gal-caption" data-index="${index}" value="${escapeHTML(item.caption || '')}" placeholder="VD: Hoàng Hôn Chiều Biển...">
                    </div>
                    <div class="input-group">
                        <label>Thời gian đã chụp:</label>
                        <input type="text" class="adm-gal-date" data-index="${index}" value="${escapeHTML(item.date || '')}" placeholder="VD: 15/10/2024 hoặc Hè 2024">
                    </div>
                    <div class="input-group" style="grid-column: 1 / -1;">
                        <label>Địa điểm / Ghi chú:</label>
                        <input type="text" class="adm-gal-location" data-index="${index}" value="${escapeHTML(item.location || '')}" placeholder="VD: Đà Nẵng, Hà Nội...">
                    </div>
                </div>
            `;
            const btnRemove = card.querySelector('.btn-remove-item');
            if (btnRemove) {
                btnRemove.addEventListener('click', () => {
                    const st = getState();
                    if (st.gallery) st.gallery.splice(index, 1);
                    renderAdminGalleryList();
                });
            }
            galleryAdminList.appendChild(card);
        });
    }

    function renderAdminJourneyList() {
        if (!journeyAdminList) return;
        journeyAdminList.innerHTML = '';
        const state = getState();

        (state.journey || []).forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'admin-item-card';
            card.innerHTML = `
                <div class="admin-item-header">
                    <span><i class="fa-solid fa-compass"></i> Dấu Chân Thanh Xuân #${index + 1}</span>
                    <button class="btn-remove-item" data-index="${index}"><i class="fa-solid fa-trash"></i> Xóa</button>
                </div>
                <div class="admin-item-grid">
                    <div class="input-group">
                        <label>Tiêu đề hành trình:</label>
                        <input type="text" class="adm-jou-title" data-index="${index}" value="${escapeHTML(item.title || '')}" placeholder="VD: Chuyến Đi Xa Đầu Tiên">
                    </div>
                    <div class="input-group">
                        <label>Thẻ phân loại / Nhãn:</label>
                        <input type="text" class="adm-jou-tag" data-index="${index}" value="${escapeHTML(item.tag || '')}" placeholder="VD: Hành Trình Trải Nghiệm">
                    </div>
                    <div class="input-group">
                        <label>Thời gian (Tháng/Năm):</label>
                        <input type="text" class="adm-jou-date" data-index="${index}" value="${escapeHTML(item.date || '')}" placeholder="VD: 10/2023">
                    </div>
                    <div class="input-group">
                        <label>Dán URL Link Ảnh:</label>
                        <input type="text" class="adm-jou-url" data-index="${index}" value="${escapeHTML(item.url || '')}" placeholder="https://...">
                    </div>
                    <div class="input-group" style="grid-column: 1 / -1;">
                        <label>Mô tả ngắn câu chuyện:</label>
                        <input type="text" class="adm-jou-desc" data-index="${index}" value="${escapeHTML(item.desc || '')}" placeholder="Mô tả lại cảm xúc, kỷ niệm của Kế...">
                    </div>
                </div>
            `;
            const btnRemove = card.querySelector('.btn-remove-item');
            if (btnRemove) {
                btnRemove.addEventListener('click', () => {
                    const st = getState();
                    if (st.journey) st.journey.splice(index, 1);
                    renderAdminJourneyList();
                });
            }
            journeyAdminList.appendChild(card);
        });
    }

    if (btnAddPlaylistTrack) {
        btnAddPlaylistTrack.addEventListener('click', () => {
            const state = getState();
            state.playlist = state.playlist || [];
            state.playlist.push({ title: 'Bài Hát Mới', artist: 'Kế', url: '' });
            renderAdminPlaylistList();
        });
    }

    if (btnAddGalleryPhoto) {
        btnAddGalleryPhoto.addEventListener('click', () => {
            const state = getState();
            state.gallery = state.gallery || [];
            state.gallery.push({ url: '', caption: 'Khoảnh khắc mới', date: 'Vừa xong', location: '' });
            renderAdminGalleryList();
        });
    }

    if (btnAddJourneyCard) {
        btnAddJourneyCard.addEventListener('click', () => {
            const state = getState();
            state.journey = state.journey || [];
            state.journey.push({ title: 'Kỷ Niệm Mới', desc: 'Mô tả kỷ niệm thanh xuân mới...', tag: 'Hành Trình', date: '2025', url: '' });
            renderAdminJourneyList();
        });
    }

    const mapLocationsAdminList = document.getElementById('mapLocationsAdminList');
    const btnAddMapLocation = document.getElementById('btnAddMapLocation');

    function renderAdminMapLocationsList() {
        if (!mapLocationsAdminList) return;
        mapLocationsAdminList.innerHTML = '';
        const state = getState();

        (state.mapLocations || []).forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'admin-item-card';
            card.innerHTML = `
                <div class="admin-item-header">
                    <span><i class="fa-solid fa-location-dot"></i> Địa Điểm #${index + 1}</span>
                    <button class="btn-remove-item" data-index="${index}"><i class="fa-solid fa-trash"></i> Xóa</button>
                </div>
                <div class="admin-item-grid">
                    <div class="input-group">
                        <label>Tên địa điểm (để tìm kiếm trên bản đồ):</label>
                        <input type="text" class="adm-map-name" data-index="${index}" value="${escapeHTML(item.name || '')}" placeholder="VD: Trường THPT Chu Văn An, Hà Nội">
                    </div>
                    <div class="input-group">
                        <label>Nhãn hiển thị (tuỳ chọn):</label>
                        <input type="text" class="adm-map-label" data-index="${index}" value="${escapeHTML(item.label || '')}" placeholder="VD: Mái trường 3 năm ❤️">
                    </div>
                    <div class="input-group">
                        <label>Vĩ độ / Latitude (tự tìm hoặc nhập):</label>
                        <input type="text" class="adm-map-lat" data-index="${index}" value="${escapeHTML(String(item.lat || ''))}" placeholder="VD: 21.0285">
                    </div>
                    <div class="input-group">
                        <label>Kinh độ / Longitude (tự tìm hoặc nhập):</label>
                        <input type="text" class="adm-map-lng" data-index="${index}" value="${escapeHTML(String(item.lng || ''))}" placeholder="VD: 105.8542">
                    </div>
                    <div class="input-group" style="grid-column: 1 / -1;">
                        <button type="button" class="btn-geocode-map" data-index="${index}">
                            <i class="fa-solid fa-magnifying-glass-location"></i> Tìm Tọa Độ Tự Động Qua Tên Địa Điểm
                        </button>
                    </div>
                </div>
            `;
            const btnRemove = card.querySelector('.btn-remove-item');
            if (btnRemove) {
                btnRemove.addEventListener('click', () => {
                    const st = getState();
                    if (st.mapLocations) st.mapLocations.splice(index, 1);
                    renderAdminMapLocationsList();
                });
            }

            const btnGeocode = card.querySelector('.btn-geocode-map');
            if (btnGeocode) {
                btnGeocode.addEventListener('click', async () => {
                    const inputName = card.querySelector('.adm-map-name');
                    const nameVal = inputName ? inputName.value.trim() : '';
                    if (!nameVal) {
                        showToast("⚠️ Vui lòng nhập tên địa điểm trước khi tìm tọa độ!");
                        return;
                    }
                    btnGeocode.disabled = true;
                    btnGeocode.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tìm...';
                    try {
                        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(nameVal)}`;
                        const res = await fetch(url);
                        const data = await res.json();
                        if (data && data.length > 0) {
                            const lat = parseFloat(data[0].lat).toFixed(6);
                            const lon = parseFloat(data[0].lon).toFixed(6);
                            const inputLat = card.querySelector('.adm-map-lat');
                            const inputLng = card.querySelector('.adm-map-lng');
                            if (inputLat) inputLat.value = lat;
                            if (inputLng) inputLng.value = lon;
                            showToast(`📍 Đã tự động tìm thấy tọa độ: ${lat}, ${lon}`);
                        } else {
                            showToast("⚠️ Không tìm thấy tọa độ tự động. Bạn có thể tự nhập Lat/Lng thủ công!");
                        }
                    } catch (e) {
                        showToast("Lỗi kết nối dịch vụ tìm tọa độ.");
                    } finally {
                        btnGeocode.disabled = false;
                        btnGeocode.innerHTML = '<i class="fa-solid fa-magnifying-glass-location"></i> Tìm Tọa Độ Tự Động Qua Tên Địa Điểm';
                    }
                });
            }
            mapLocationsAdminList.appendChild(card);
        });
    }

    if (btnAddMapLocation) {
        btnAddMapLocation.addEventListener('click', () => {
            const state = getState();
            state.mapLocations = state.mapLocations || [];
            state.mapLocations.push({ name: '', label: '', lat: '', lng: '' });
            renderAdminMapLocationsList();
        });
    }

    // Save logic với hỗ trợ Upload File từ máy
    if (btnSaveSettings) {
        btnSaveSettings.addEventListener('click', async () => {
            btnSaveSettings.disabled = true;
            btnSaveSettings.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';

            const state = getState();

            const inputName = document.getElementById('inputName');
            const inputSchoolName = document.getElementById('inputSchoolName');
            const inputClassName = document.getElementById('inputClassName');
            const inputClassSlogan = document.getElementById('inputClassSlogan');
            const inputPhotoFile = document.getElementById('inputPhoto');
            const inputPhotoUrl = document.getElementById('inputPhotoUrl');
            const inputQuote1 = document.getElementById('inputQuote1');
            const inputQuote2 = document.getElementById('inputQuote2');
            const inputQuote3 = document.getElementById('inputQuote3');
            const inputBirthdayDate = document.getElementById('inputBirthdayDate');
            const inputFavMusic = document.getElementById('inputFavMusic');
            const inputFavMovie = document.getElementById('inputFavMovie');
            const inputFavBook = document.getElementById('inputFavBook');
            const inputFavDrink = document.getElementById('inputFavDrink');
            const inputFavFashion = document.getElementById('inputFavFashion');
            const inputFavLover = document.getElementById('inputFavLover');
            const inputFavLifestyle = document.getElementById('inputFavLifestyle');
            const inputFavColor = document.getElementById('inputFavColor');
            const inputBalloonTiktokUrl = document.getElementById('inputBalloonTiktokUrl');

            if (inputName) state.name = inputName.value.trim();
            if (inputSchoolName) state.schoolName = inputSchoolName.value.trim();
            if (inputClassName) state.className = inputClassName.value.trim();
            if (inputClassSlogan) state.classSlogan = inputClassSlogan.value.trim();
            if (inputQuote1) state.quote1 = inputQuote1.value.trim();
            if (inputQuote2) state.quote2 = inputQuote2.value.trim();
            if (inputQuote3) state.quote3 = inputQuote3.value.trim();
            if (inputBirthdayDate) state.birthdayDate = inputBirthdayDate.value.trim();
            if (inputBalloonTiktokUrl) state.balloonTiktokUrl = inputBalloonTiktokUrl.value.trim();

            const inputLinkFacebook = document.getElementById('inputLinkFacebook');
            const inputLinkMessenger = document.getElementById('inputLinkMessenger');
            const inputLinkZalo = document.getElementById('inputLinkZalo');
            const inputLinkTiktok = document.getElementById('inputLinkTiktok');
            const inputLinkInstagram = document.getElementById('inputLinkInstagram');

            if (!state.socialLinks) state.socialLinks = {};
            if (inputLinkFacebook) state.socialLinks.facebook = inputLinkFacebook.value.trim();
            if (inputLinkMessenger) state.socialLinks.messenger = inputLinkMessenger.value.trim();
            if (inputLinkZalo) state.socialLinks.zalo = inputLinkZalo.value.trim();
            if (inputLinkTiktok) state.socialLinks.tiktok = inputLinkTiktok.value.trim();
            if (inputLinkInstagram) state.socialLinks.instagram = inputLinkInstagram.value.trim();

            if (inputFavMusic) state.favMusic = inputFavMusic.value.trim();
            if (inputFavMovie) state.favMovie = inputFavMovie.value.trim();
            if (inputFavBook) state.favBook = inputFavBook.value.trim();
            if (inputFavDrink) state.favDrink = inputFavDrink.value.trim();
            if (inputFavFashion) state.favFashion = inputFavFashion.value.trim();
            if (inputFavLover) state.favLover = inputFavLover.value.trim();
            if (inputFavLifestyle) state.favLifestyle = inputFavLifestyle.value.trim();
            if (inputFavColor) state.favColor = inputFavColor.value.trim();

            // Check Avatar Upload File
            if (inputPhotoFile && inputPhotoFile.files.length > 0) {
                const file = inputPhotoFile.files[0];
                const base64 = await readFileAsDataURL(file);
                const uploadedUrl = await uploadFileToBackend(`avatar_${Date.now()}_${file.name}`, base64);
                state.photoUrl = uploadedUrl;
            } else if (inputPhotoUrl && inputPhotoUrl.value.trim() !== '') {
                state.photoUrl = inputPhotoUrl.value.trim();
            }
            // (Nếu không chọn file mới và ô URL trống, giữ nguyên state.photoUrl hiện tại)

            // Read & Upload Playlist
            const trkFiles = document.querySelectorAll('.adm-trk-file');
            const trkUrls = document.querySelectorAll('.adm-trk-url');
            const trkTitles = document.querySelectorAll('.adm-trk-title');
            const trkArtists = document.querySelectorAll('.adm-trk-artist');
            const newPlaylist = [];

            for (let i = 0; i < trkUrls.length; i++) {
                let url = trkUrls[i].value.trim();
                const fileElem = trkFiles[i];
                if (fileElem && fileElem.files.length > 0) {
                    const file = fileElem.files[0];
                    const base64 = await readFileAsDataURL(file);
                    url = await uploadFileToBackend(`track_${Date.now()}_${file.name}`, base64);
                } else if (!url && state.playlist && state.playlist[i]) {
                    url = state.playlist[i].url;
                }

                const title = trkTitles[i] ? trkTitles[i].value.trim() : '';
                if (url || title) {
                    newPlaylist.push({
                        title: title || 'Bài Hát Thanh Xuân',
                        artist: trkArtists[i] ? trkArtists[i].value.trim() : 'Kế',
                        url
                    });
                }
            }
            if (newPlaylist.length > 0) state.playlist = newPlaylist;

            // Read & Upload Gallery Photos
            const galFiles = document.querySelectorAll('.adm-gal-file');
            const galUrls = document.querySelectorAll('.adm-gal-url');
            const galCaps = document.querySelectorAll('.adm-gal-caption');
            const galDates = document.querySelectorAll('.adm-gal-date');
            const galLocs = document.querySelectorAll('.adm-gal-location');
            const newGallery = [];

            for (let i = 0; i < galUrls.length; i++) {
                let url = galUrls[i].value.trim();
                const fileElem = galFiles[i];
                if (fileElem && fileElem.files.length > 0) {
                    const file = fileElem.files[0];
                    const base64 = await readFileAsDataURL(file);
                    url = await uploadFileToBackend(`gallery_${Date.now()}_${file.name}`, base64);
                } else if (!url && state.gallery && state.gallery[i]) {
                    url = state.gallery[i].url;
                }

                if (url) {
                    newGallery.push({
                        url,
                        caption: galCaps[i] ? galCaps[i].value.trim() : '',
                        date: galDates[i] ? galDates[i].value.trim() : '',
                        location: galLocs[i] ? galLocs[i].value.trim() : ''
                    });
                }
            }
            if (newGallery.length > 0) state.gallery = newGallery;

            // Read Journey Cards
            const jouTitles = document.querySelectorAll('.adm-jou-title');            const jouTags = document.querySelectorAll('.adm-jou-tag');
            const jouDates = document.querySelectorAll('.adm-jou-date');
            const jouUrls = document.querySelectorAll('.adm-jou-url');
            const jouDescs = document.querySelectorAll('.adm-jou-desc');
            const newJourney = [];

            for (let i = 0; i < jouTitles.length; i++) {
                const title = jouTitles[i].value.trim();
                const url = jouUrls[i] ? jouUrls[i].value.trim() : '';
                if (title || url) {
                    newJourney.push({
                        title: title || 'Kỷ Niệm',
                        tag: jouTags[i] ? jouTags[i].value.trim() : 'Hành Trình',
                        date: jouDates[i] ? jouDates[i].value.trim() : '',
                        url,
                        desc: jouDescs[i] ? jouDescs[i].value.trim() : ''
                    });
                }
            }
            if (newJourney.length > 0) state.journey = newJourney;

            // Read Map Locations
            const mapNames  = document.querySelectorAll('.adm-map-name');
            const mapLabels = document.querySelectorAll('.adm-map-label');
            const mapLats   = document.querySelectorAll('.adm-map-lat');
            const mapLngs   = document.querySelectorAll('.adm-map-lng');
            const newMapLocations = [];
            for (let i = 0; i < mapNames.length; i++) {
                const name = mapNames[i].value.trim();
                if (name) {
                    const lat = parseFloat(mapLats[i] ? mapLats[i].value : '');
                    const lng = parseFloat(mapLngs[i] ? mapLngs[i].value : '');
                    newMapLocations.push({
                        name,
                        label: mapLabels[i] ? mapLabels[i].value.trim() : '',
                        lat: isNaN(lat) ? null : lat,
                        lng: isNaN(lng) ? null : lng,
                    });
                }
            }
            state.mapLocations = newMapLocations;

            // Save Home Location Settings
            const inputHomeLat = document.getElementById('inputHomeLat');
            const inputHomeLng = document.getElementById('inputHomeLng');
            const inputHomeAddress = document.getElementById('inputHomeAddress');
            if (inputHomeLat || inputHomeLng || inputHomeAddress) {
                state.homeLocation = {
                    lat: inputHomeLat && inputHomeLat.value ? parseFloat(inputHomeLat.value) : 18.98686,
                    lng: inputHomeLng && inputHomeLng.value ? parseFloat(inputHomeLng.value) : 105.46820,
                    address: inputHomeAddress ? inputHomeAddress.value.trim() : 'Xã Quan Thành, Tỉnh Nghệ An'
                };
            }

            setState(state);
            await saveBackendConfig(state);
            refreshDOM();

            btnSaveSettings.disabled = false;
            btnSaveSettings.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Lưu Thay Đổi';
            if (customModal) customModal.classList.remove('active');
            showToast("Đã cập nhật toàn bộ thay đổi & vị trí Nhà Kế thành công! ✨");
        });
    }

    // ── XỬ LÝ NÚT LƯU ĐỘC LẬP TỪNG TAB (Tab-Scoped Save Buttons) ──────────────
    document.querySelectorAll('.btn-tab-save').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const action = btn.getAttribute('data-tab-action');
            const originalHTML = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...`;

            try {
                const state = getState();

                if (action === 'profile') {
                    const inputName = document.getElementById('inputName');
                    const inputSchoolName = document.getElementById('inputSchoolName');
                    const inputClassName = document.getElementById('inputClassName');
                    const inputClassSlogan = document.getElementById('inputClassSlogan');
                    const inputQuote1 = document.getElementById('inputQuote1');
                    const inputQuote2 = document.getElementById('inputQuote2');
                    const inputQuote3 = document.getElementById('inputQuote3');
                    const inputBirthdayDate = document.getElementById('inputBirthdayDate');
                    const inputBalloonTiktokUrl = document.getElementById('inputBalloonTiktokUrl');
                    const inputPhotoFile = document.getElementById('inputPhoto');
                    const inputPhotoUrl = document.getElementById('inputPhotoUrl');

                    if (inputName) state.name = inputName.value.trim();
                    if (inputSchoolName) state.schoolName = inputSchoolName.value.trim();
                    if (inputClassName) state.className = inputClassName.value.trim();
                    if (inputClassSlogan) state.classSlogan = inputClassSlogan.value.trim();
                    if (inputQuote1) state.quote1 = inputQuote1.value.trim();
                    if (inputQuote2) state.quote2 = inputQuote2.value.trim();
                    if (inputQuote3) state.quote3 = inputQuote3.value.trim();
                    if (inputBirthdayDate) state.birthdayDate = inputBirthdayDate.value.trim();
                    if (inputBalloonTiktokUrl) state.balloonTiktokUrl = inputBalloonTiktokUrl.value.trim();

                    const inputLinkFacebook = document.getElementById('inputLinkFacebook');
                    const inputLinkMessenger = document.getElementById('inputLinkMessenger');
                    const inputLinkZalo = document.getElementById('inputLinkZalo');
                    const inputLinkTiktok = document.getElementById('inputLinkTiktok');
                    const inputLinkInstagram = document.getElementById('inputLinkInstagram');

                    if (!state.socialLinks) state.socialLinks = {};
                    if (inputLinkFacebook) state.socialLinks.facebook = inputLinkFacebook.value.trim();
                    if (inputLinkMessenger) state.socialLinks.messenger = inputLinkMessenger.value.trim();
                    if (inputLinkZalo) state.socialLinks.zalo = inputLinkZalo.value.trim();
                    if (inputLinkTiktok) state.socialLinks.tiktok = inputLinkTiktok.value.trim();
                    if (inputLinkInstagram) state.socialLinks.instagram = inputLinkInstagram.value.trim();

                    if (inputPhotoFile && inputPhotoFile.files.length > 0) {
                        const file = inputPhotoFile.files[0];
                        const base64 = await readFileAsDataURL(file);
                        state.photoUrl = await uploadFileToBackend(`avatar_${Date.now()}_${file.name}`, base64);
                    } else if (inputPhotoUrl && inputPhotoUrl.value.trim() !== '') {
                        state.photoUrl = inputPhotoUrl.value.trim();
                    }

                    const inputHomeLat = document.getElementById('inputHomeLat');
                    const inputHomeLng = document.getElementById('inputHomeLng');
                    const inputHomeAddress = document.getElementById('inputHomeAddress');
                    if (inputHomeLat || inputHomeLng || inputHomeAddress) {
                        state.homeLocation = {
                            lat: inputHomeLat && inputHomeLat.value ? parseFloat(inputHomeLat.value) : 18.98686,
                            lng: inputHomeLng && inputHomeLng.value ? parseFloat(inputHomeLng.value) : 105.46820,
                            address: inputHomeAddress ? inputHomeAddress.value.trim() : 'Xã Quan Thành, Tỉnh Nghệ An'
                        };
                    }

                    showToast("Đã lưu thông tin Hồ Sơ cá nhân! 👤✨");
                } 
                else if (action === 'music') {
                    const trkFiles = document.querySelectorAll('.adm-trk-file');
                    const trkUrls = document.querySelectorAll('.adm-trk-url');
                    const trkTitles = document.querySelectorAll('.adm-trk-title');
                    const trkArtists = document.querySelectorAll('.adm-trk-artist');
                    const newPlaylist = [];

                    for (let i = 0; i < trkUrls.length; i++) {
                        let url = trkUrls[i].value.trim();
                        const fileElem = trkFiles[i];
                        if (fileElem && fileElem.files.length > 0) {
                            const file = fileElem.files[0];
                            const base64 = await readFileAsDataURL(file);
                            url = await uploadFileToBackend(`track_${Date.now()}_${file.name}`, base64);
                        } else if (!url && state.playlist && state.playlist[i]) {
                            url = state.playlist[i].url;
                        }

                        const title = trkTitles[i] ? trkTitles[i].value.trim() : '';
                        if (url || title) {
                            newPlaylist.push({
                                title: title || 'Bài Hát Thanh Xuân',
                                artist: trkArtists[i] ? trkArtists[i].value.trim() : 'Kế',
                                url
                            });
                        }
                    }
                    if (newPlaylist.length > 0) state.playlist = newPlaylist;
                    showToast("Đã lưu Playlist Âm Nhạc! 🎵✨");
                }
                else if (action === 'favorites') {
                    const inputFavMusic = document.getElementById('inputFavMusic');
                    const inputFavMovie = document.getElementById('inputFavMovie');
                    const inputFavBook = document.getElementById('inputFavBook');
                    const inputFavDrink = document.getElementById('inputFavDrink');
                    const inputFavFashion = document.getElementById('inputFavFashion');
                    const inputFavLover = document.getElementById('inputFavLover');
                    const inputFavLifestyle = document.getElementById('inputFavLifestyle');
                    const inputFavColor = document.getElementById('inputFavColor');

                    if (inputFavMusic) state.favMusic = inputFavMusic.value.trim();
                    if (inputFavMovie) state.favMovie = inputFavMovie.value.trim();
                    if (inputFavBook) state.favBook = inputFavBook.value.trim();
                    if (inputFavDrink) state.favDrink = inputFavDrink.value.trim();
                    if (inputFavFashion) state.favFashion = inputFavFashion.value.trim();
                    if (inputFavLover) state.favLover = inputFavLover.value.trim();
                    if (inputFavLifestyle) state.favLifestyle = inputFavLifestyle.value.trim();
                    if (inputFavColor) state.favColor = inputFavColor.value.trim();

                    showToast("Đã lưu Gu & Sở Thích cá nhân! 💖✨");
                }
                else if (action === 'milestones') {
                    const jouTitles = document.querySelectorAll('.adm-jou-title');
                    const jouTags = document.querySelectorAll('.adm-jou-tag');
                    const jouDates = document.querySelectorAll('.adm-jou-date');
                    const jouUrls = document.querySelectorAll('.adm-jou-url');
                    const jouDescs = document.querySelectorAll('.adm-jou-desc');
                    const newJourney = [];

                    for (let i = 0; i < jouTitles.length; i++) {
                        const title = jouTitles[i].value.trim();
                        const url = jouUrls[i] ? jouUrls[i].value.trim() : '';
                        if (title || url) {
                            newJourney.push({
                                title: title || 'Kỷ Niệm',
                                tag: jouTags[i] ? jouTags[i].value.trim() : 'Hành Trình',
                                date: jouDates[i] ? jouDates[i].value.trim() : '',
                                url,
                                desc: jouDescs[i] ? jouDescs[i].value.trim() : ''
                            });
                        }
                    }
                    if (newJourney.length > 0) state.journey = newJourney;
                    showToast("Đã lưu Dấu Chân Thanh Xuân! 📍✨");
                }
                else if (action === 'memoryMap') {
                    const mapNames  = document.querySelectorAll('.adm-map-name');
                    const mapLabels = document.querySelectorAll('.adm-map-label');
                    const mapLats   = document.querySelectorAll('.adm-map-lat');
                    const mapLngs   = document.querySelectorAll('.adm-map-lng');
                    const newMapLocations = [];
                    for (let i = 0; i < mapNames.length; i++) {
                        const name = mapNames[i].value.trim();
                        if (name) {
                            const lat = parseFloat(mapLats[i] ? mapLats[i].value : '');
                            const lng = parseFloat(mapLngs[i] ? mapLngs[i].value : '');
                            newMapLocations.push({
                                name,
                                label: mapLabels[i] ? mapLabels[i].value.trim() : '',
                                lat: isNaN(lat) ? null : lat,
                                lng: isNaN(lng) ? null : lng,
                            });
                        }
                    }
                    state.mapLocations = newMapLocations;
                    showToast("Đã lưu Bản Đồ Kỷ Niệm! 🗺️✨");
                }
                else if (action === 'gallery') {
                    const galFiles = document.querySelectorAll('.adm-gal-file');
                    const galUrls = document.querySelectorAll('.adm-gal-url');
                    const galCaps = document.querySelectorAll('.adm-gal-caption');
                    const galDates = document.querySelectorAll('.adm-gal-date');
                    const galLocs = document.querySelectorAll('.adm-gal-location');
                    const newGallery = [];

                    for (let i = 0; i < galUrls.length; i++) {
                        let url = galUrls[i].value.trim();
                        const fileElem = galFiles[i];
                        if (fileElem && fileElem.files.length > 0) {
                            const file = fileElem.files[0];
                            const base64 = await readFileAsDataURL(file);
                            url = await uploadFileToBackend(`gallery_${Date.now()}_${file.name}`, base64);
                        } else if (!url && state.gallery && state.gallery[i]) {
                            url = state.gallery[i].url;
                        }

                        if (url) {
                            newGallery.push({
                                url,
                                caption: galCaps[i] ? galCaps[i].value.trim() : '',
                                date: galDates[i] ? galDates[i].value.trim() : '',
                                location: galLocs[i] ? galLocs[i].value.trim() : ''
                            });
                        }
                    }
                    if (newGallery.length > 0) state.gallery = newGallery;
                    showToast("Đã lưu Thư Viện Ảnh Kỷ Niệm! 🖼️✨");
                }

                setState(state);
                await saveBackendConfig(state);
                refreshDOM();
            } catch (err) {
                console.error("Tab save error:", err);
                showToast("❌ Có lỗi khi lưu dữ liệu tab!");
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        });
    });

    // Xử lý nút "Lấy Vị Trí Hiện Tại Làm Vị Trí Nhà" trong trang Admin
    const btnGetMyCurrentHomeLocation = document.getElementById('btnGetMyCurrentHomeLocation');
    if (btnGetMyCurrentHomeLocation) {
        btnGetMyCurrentHomeLocation.addEventListener('click', () => {
            if ('geolocation' in navigator) {
                btnGetMyCurrentHomeLocation.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang lấy tọa độ GPS...`;
                navigator.geolocation.getCurrentPosition(async (pos) => {
                    const lat = pos.coords.latitude;
                    const lng = pos.coords.longitude;
                    const inputHomeLat = document.getElementById('inputHomeLat');
                    const inputHomeLng = document.getElementById('inputHomeLng');
                    const inputHomeAddress = document.getElementById('inputHomeAddress');

                    if (inputHomeLat) inputHomeLat.value = lat;
                    if (inputHomeLng) inputHomeLng.value = lng;

                    try {
                        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
                        if (res.ok) {
                            const geo = await res.json();
                            const addr = geo.address || {};
                            const parts = [
                                addr.hamlet || addr.suburb || addr.quarter || addr.village,
                                addr.town || addr.city_district || addr.commune,
                                addr.county || addr.district || addr.city,
                                addr.state || addr.province
                            ].filter(Boolean);
                            if (inputHomeAddress) inputHomeAddress.value = parts.join(', ');
                        }
                    } catch (e) {}

                    btnGetMyCurrentHomeLocation.innerHTML = `<i class="fa-solid fa-circle-check"></i> Đã Lấy Tọa Độ Thành Công!`;
                    setTimeout(() => {
                        btnGetMyCurrentHomeLocation.innerHTML = `<i class="fa-solid fa-location-arrow"></i> Lấy Vị Trí Hiện Tại Làm Vị Trí Nhà`;
                    }, 3000);
                }, () => {
                    alert('Không thể lấy GPS. Vui lòng bật quyền định vị cho trình duyệt.');
                    btnGetMyCurrentHomeLocation.innerHTML = `<i class="fa-solid fa-location-arrow"></i> Lấy Vị Trí Hiện Tại Làm Vị Trí Nhà`;
                }, { enableHighAccuracy: true, timeout: 10000 });
            }
        });
    }

    // Backup JSON Export & Import
    const btnExportBackup = document.getElementById('btnExportBackup');
    const btnImportBackup = document.getElementById('btnImportBackup');
    const inputBackupFile = document.getElementById('inputBackupFile');

    if (btnExportBackup) {
        btnExportBackup.addEventListener('click', () => {
            const state = getState();
            const jsonStr = JSON.stringify(state, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const dateStr = new Date().toISOString().slice(0, 10);
            a.href = url;
            a.download = `youth_memories_backup_${dateStr}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast("📦 Đã xuất thành công file Backup JSON!");
        });
    }

    if (btnImportBackup && inputBackupFile) {
        btnImportBackup.addEventListener('click', () => inputBackupFile.click());
        inputBackupFile.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                const file = e.target.files[0];
                const reader = new FileReader();
                reader.onload = async (evt) => {
                    try {
                        const data = JSON.parse(evt.target.result);
                        if (data && typeof data === 'object') {
                            setState(data);
                            await saveBackendConfig(data);
                            refreshDOM();
                            showToast("✨ Đã phục hồi dữ liệu thành công từ file Backup!");
                            if (customModal) customModal.classList.remove('active');
                        } else {
                            alert("File backup không hợp lệ!");
                        }
                    } catch (err) {
                        alert("Lỗi đọc file JSON: " + err.message);
                    }
                };
                reader.readAsText(file);
            }
        });
    }
}

function updateCapsuleStatusDOM(state, elem) {
    if (!elem) return;
    const btnSealCapsule = document.getElementById('btnSealCapsule');
    if (state.isCapsuleLocked) {
        elem.innerHTML = `Trạng thái: <span class="status-locked"><i class="fa-solid fa-lock"></i> ĐÃ NIÊM PHONG VĨNH VIỄN (${state.graduationDate || "2026-06-30"})</span>`;
        if (btnSealCapsule) {
            btnSealCapsule.innerHTML = '<i class="fa-solid fa-lock-open"></i> MỞ KHÓA LẠI VIÊN NANG THANH XUÂN';
            btnSealCapsule.style.background = 'linear-gradient(135deg, #10b981, #0284c7)';
        }
    } else {
        elem.innerHTML = `Trạng thái: <span class="status-unlocked"><i class="fa-solid fa-lock-open"></i> Đang mở chỉnh sửa</span>`;
        if (btnSealCapsule) {
            btnSealCapsule.innerHTML = '<i class="fa-solid fa-stamp"></i> THỰC HIỆN LỄ NIÊM PHONG THANH XUÂN';
            btnSealCapsule.style.background = 'linear-gradient(135deg, #f59e0b, #e11d48)';
        }
    }
}

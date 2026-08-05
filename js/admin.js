/**
 * admin.js - Trung TĂ¢m Quáº£n LĂ½ Admin Káº¿ (Quáº£n lĂ½ khĂ´ng giá»›i háº¡n áº¢nh, Dáº¥u ChĂ¢n Thanh XuĂ¢n & Playlist)
 */
import { escapeHTML, KE_CONFIG } from './config.js';
import { showToast } from './toast.js';

// â”€â”€ Session cache trong memory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// Hiá»ƒn thá»‹ modal Ä‘Äƒng nháº­p vĂ  tráº£ vá» Promise<boolean>
function promptAdminLogin() {
    return new Promise((resolve) => {
        // Táº¡o modal login náº¿u chÆ°a cĂ³
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
                            <h3 class="admin-login-title">Khu Vá»±c Admin</h3>
                            <p class="admin-login-sub">Chá»‰ dĂ nh cho chá»§ sá»Ÿ há»¯u</p>
                        </div>
                    </div>

                    <!-- Divider -->
                    <div class="admin-login-divider"></div>

                    <!-- Body -->
                    <div class="admin-login-body">
                        <label class="admin-login-label">
                            <i class="fa-solid fa-lock"></i> Máº­t kháº©u Admin
                        </label>
                        <div class="admin-password-wrap">
                            <input type="password" id="adminPasswordInput"
                                   class="admin-login-input"
                                   placeholder="Nháº­p máº­t kháº©u cá»§a báº¡n..."
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
                            Há»§y
                        </button>
                        <button id="adminLoginSubmit" class="admin-btn-submit">
                            <i class="fa-solid fa-arrow-right-to-bracket"></i>
                            <span>ÄÄƒng Nháº­p</span>
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

        const input = document.getElementById('adminPasswordInput');
        const errorEl = document.getElementById('adminLoginError');
        const btnOk = document.getElementById('adminLoginSubmit');
        const btnCancel = document.getElementById('adminLoginCancel');

        if (input) { input.value = ''; setTimeout(() => input.focus(), 100); }
        if (errorEl) errorEl.style.display = 'none';

        async function doLogin() {
            const password = input ? input.value : '';
            if (!password) return;

            btnOk.disabled = true;
            btnOk.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Äang kiá»ƒm tra...';

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
                    if (window.initAdminVisibility) window.initAdminVisibility();
                    loginModal.style.display = 'none';
                    loginModal.classList.remove('active');
                    resolve(true);
                } else {
                    if (errorEl) { errorEl.textContent = data.message || 'Máº­t kháº©u khĂ´ng Ä‘Ăºng'; errorEl.style.display = 'block'; }
                    btnOk.disabled = false;
                    btnOk.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i><span>ÄÄƒng Nháº­p</span>';
                    if (input) input.value = '';
                }
            } catch (e) {
                if (errorEl) {
                    errorEl.textContent = e.message && e.message.includes('fetch')
                        ? 'KhĂ´ng káº¿t ná»‘i Ä‘Æ°á»£c server. HĂ£y cháº¯c cháº¯n server Ä‘ang cháº¡y táº¡i http://localhost:3000'
                        : 'Lá»—i káº¿t ná»‘i server';
                    errorEl.style.display = 'block';
                }
                btnOk.disabled = false;
                btnOk.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i><span>ÄÄƒng Nháº­p</span>';
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

    // Helper Ä‘á»c file Base64
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

    // Helper upload file lĂªn Backend â†’ Cloudinary (áº£nh/video/audio lÆ°u vÄ©nh viá»…n, khĂ´ng máº¥t khi redeploy)
    async function uploadFileToBackend(filename, base64Data) {
        if (!base64Data) return base64Data;
        // Gá»­i táº¥t cáº£ loáº¡i file (áº£nh, audio, video) lĂªn /api/upload â†’ server tá»± upload Cloudinary
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
            console.log('Upload server offline, sá»­ dá»¥ng base64 local fallback.');
        }
        // Fallback: tráº£ vá» base64 náº¿u server lá»—i (dá»¯ liá»‡u váº«n Ä‘Æ°á»£c lÆ°u trong JSON)
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
                adminVisitorsList.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:24px;">ChÆ°a xĂ¡c thá»±c Admin hoáº·c lá»—i káº¿t ná»‘i.</div>';
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
                adminVisitorsList.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:24px;">ChÆ°a cĂ³ khĂ¡ch viáº¿ng thÄƒm nĂ o.</div>';
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
                    ? `<span style="background:rgba(34,197,94,0.2);color:#4ade80;border:1px solid rgba(34,197,94,0.4);padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:bold;">đŸŸ¢ ÄANG ONLINE</span>`
                    : `<span style="background:rgba(148,163,184,0.15);color:#94a3b8;padding:2px 8px;border-radius:12px;font-size:0.75rem;">âª ÄĂ£ rá»i Ä‘i</span>`;

                const timeStr = new Date(v.lastSeen).toLocaleString('vi-VN');
                const durationMin = Math.floor((v.durationSeconds || 0) / 60);
                const durationSec = (v.durationSeconds || 0) % 60;
                const durationText = durationMin > 0 ? `${durationMin} phĂºt ${durationSec}s` : `${durationSec}s`;

                const batteryStr = v.battery ? ` â€¢ đŸ”‹ Pin: ${escapeHTML(v.battery)}` : '';
                const networkStr = v.connection ? ` â€¢ đŸ“¶ Máº¡ng: ${escapeHTML(v.connection.toUpperCase())}` : '';
                const screenStr = v.screen && v.screen !== '-' ? ` â€¢ đŸ“ MĂ n hĂ¬nh: ${escapeHTML(v.screen)} (x${v.dpr || 1})` : '';

                const timelineHtml = (v.timelineLogs || []).map(log =>
                    `<div style="font-size:0.75rem;color:#cbd5e1;padding:2px 0;border-bottom:1px dashed rgba(255,255,255,0.05);display:flex;gap:6px;">
                        <span style="color:#94a3b8;min-width:60px;">${escapeHTML(log.time)}</span>
                        <strong style="color:#38bdf8;">${escapeHTML(log.event)}</strong>
                        <span style="color:#64748b;">${escapeHTML(log.detail || '')}</span>
                    </div>`
                ).join('');

                const gmapBtn = (v.lat && v.lng)
                    ? `<a href="https://www.google.com/maps?q=${v.lat},${v.lng}" target="_blank" style="background:#0284c7;color:#ffffff;padding:3px 10px;border-radius:6px;font-size:0.75rem;font-weight:bold;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-left:6px;box-shadow:0 0 10px rgba(2,132,199,0.5);"><i class="fa-solid fa-map-location-dot"></i> đŸ—ºï¸ Má»Ÿ Google Maps</a>`
                    : '';

                const isGpsExact = v.isGps || (v.accuracy && v.accuracy <= 500);
                const geoBadge = isGpsExact
                    ? `<span style="background:rgba(34,197,94,0.2);color:#4ade80;border:1px solid rgba(34,197,94,0.4);padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:bold;">đŸ¯ GPS Chuáº©n XĂ³m/XĂ£ (KhĂ¡ch Ä‘Ă£ cáº¥p quyá»n)</span>`
                    : (v.lat && v.lng
                        ? `<span style="background:rgba(234,179,8,0.2);color:#facc15;border:1px solid rgba(234,179,8,0.4);padding:2px 8px;border-radius:10px;font-size:0.72rem;">đŸ“¶ Æ¯á»›c TĂ­nh IP Máº¡ng (ChÆ°a cĂ³ GPS)</span>`
                        : `<span style="background:rgba(148,163,184,0.15);color:#94a3b8;padding:2px 8px;border-radius:10px;font-size:0.72rem;">â“ Vá»‹ TrĂ­ ChÆ°a RĂµ</span>`);

                const locationTitle = isGpsExact
                    ? `<span style="color:#4ade80;font-weight:bold;">${escapeHTML(v.city || 'XĂ£ / Tá»‰nh')} (đŸ¯ GPS ChĂ­nh XĂ¡c)</span>`
                    : `<span style="color:#facc15;font-weight:bold;">${escapeHTML(v.city || 'Æ¯á»›c tĂ­nh IP')} (ChÆ°a cĂ³ GPS)</span>`;

                const accuracyStr = v.accuracy ? `<span style="color:#4ade80;"> â€¢ Sai sá»‘: ~${v.accuracy}m</span>` : '';

                const deleteBtnHtml = `<button type="button" class="btn-delete-visitor" style="background:rgba(239,68,68,0.2);color:#f87171;border:1px solid rgba(239,68,68,0.4);padding:3px 10px;border-radius:6px;font-size:0.75rem;font-weight:bold;cursor:pointer;margin-left:8px;" title="XĂ³a nháº­t kĂ½ khĂ¡ch nĂ y"><i class="fa-solid fa-trash-can"></i> XĂ³a</button>`;

                const gpuStr = v.gpu ? ` â€¢ đŸ® GPU: ${escapeHTML(v.gpu)}` : '';
                const cpuStr = v.cpuCores ? ` â€¢ â¡ Chip: ${v.cpuCores} NhĂ¢n CPU` : '';
                const ramStr = v.ramGB ? ` â€¢ đŸ’¾ RAM: ${v.ramGB}GB` : '';

                card.innerHTML = `
                    <div class="admin-item-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:4px;">
                        <span><i class="fa-solid fa-user-ninja" style="color:#a855f7;"></i> KhĂ¡ch #${index + 1} â€” <strong style="color:#f472b6;">${escapeHTML(v.city || 'Viá»‡t Nam')}</strong> (${escapeHTML(v.isp || 'NhĂ  máº¡ng')}) ${statusBadge} ${geoBadge} ${gmapBtn} ${deleteBtnHtml}</span>
                        <span style="font-size:0.78rem;color:#94a3b8;"><i class="fa-solid fa-clock"></i> ${timeStr}</span>
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:6px;font-size:0.82rem;color:#cbd5e1;background:rgba(0,0,0,0.25);padding:10px;border-radius:8px;margin-bottom:8px;">
                        <div>đŸŒ <strong>IP Tháº­t:</strong> <span style="font-family:monospace;color:#facc15;">${escapeHTML(v.ip)}</span></div>
                        <div>đŸ“ <strong>đŸ¡ Vá»‹ trĂ­ chi tiáº¿t:</strong> ${locationTitle} ${v.lat && v.lng ? `<br><small style="color:#38bdf8;">Tá»a Ä‘á»™: ${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}${accuracyStr}</small>` : ''}</div>
                        <div>đŸ“± <strong>TĂªn Thiáº¿t bá»‹:</strong> <span style="color:#38bdf8;font-weight:bold;">${escapeHTML(v.device)}</span> â€¢ ${escapeHTML(v.os)}</div>
                        <div>đŸ’» <strong>TrĂ¬nh duyá»‡t:</strong> ${escapeHTML(v.browser)}</div>
                        <div>đŸ”— <strong>Nguá»“n Ä‘áº¿n (Referrer):</strong> <span style="color:#38bdf8;word-break:break-all;">${escapeHTML(v.referrer)}</span></div>
                        <div>â±ï¸ <strong>Thá»i gian á»Ÿ láº¡i:</strong> <span style="color:#4ade80;font-weight:bold;">${durationText}</span> (${v.clicks || 1} lÆ°á»£t click)</div>
                        <div style="grid-column:1 / -1;font-size:0.78rem;color:#94a3b8;border-top:1px solid rgba(255,255,255,0.06);padding-top:4px;">
                            â™ï¸ <strong>Pháº§n cá»©ng chuyĂªn sĂ¢u:</strong> ${screenStr}${networkStr}${batteryStr}${gpuStr}${cpuStr}${ramStr}
                        </div>
                    </div>
                    <details style="font-size:0.8rem;color:#94a3b8;cursor:pointer;">
                        <summary style="font-weight:bold;color:#a855f7;outline:none;margin-bottom:4px;">
                            đŸ“œ Xem Nháº­t KĂ½ Thao TĂ¡c Chi Tiáº¿t (${(v.timelineLogs || []).length} bÆ°á»›c)
                        </summary>
                        <div style="background:rgba(15,23,42,0.6);padding:8px;border-radius:6px;margin-top:4px;max-height:160px;overflow-y:auto;">
                            ${timelineHtml || '<div style="font-size:0.75rem;color:#64748b;">ChÆ°a cĂ³ thao tĂ¡c thĂªm</div>'}
                        </div>
                    </details>
                `;

                const btnDelete = card.querySelector('.btn-delete-visitor');
                if (btnDelete) {
                    btnDelete.addEventListener('click', async (evt) => {
                        evt.stopPropagation();
                        if (confirm(`đŸ—‘ï¸ Báº¡n cĂ³ cháº¯c muá»‘n xĂ³a nháº­t kĂ½ cá»§a KhĂ¡ch (IP: ${v.ip})?`)) {
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
                                    showToast("ÄĂ£ xĂ³a nháº­t kĂ½ khĂ¡ch thĂ nh cĂ´ng! đŸ—‘ï¸", "info");
                                    loadAdminVisitorsList();
                                } else {
                                    alert(resData.message || "KhĂ´ng thá»ƒ xĂ³a nháº­t kĂ½.");
                                }
                            } catch (e) {
                                alert("Lá»—i káº¿t ná»‘i khi xĂ³a.");
                            }
                        }
                    });
                }

                adminVisitorsList.appendChild(card);
            });
        } catch (e) {
            adminVisitorsList.innerHTML = '<div style="text-align:center;color:#dc2626;padding:24px;">Lá»—i káº¿t ná»‘i server tracking.</div>';
        }
    }

    // Admin Tabs Switching & Smart Tab-Scoped Polling
    let _visitorPollTimer = null;

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.admin-tab-btn');
        if (!btn) return;

        const targetTab = btn.getAttribute('data-tab');
        if (!targetTab) return;

        document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        const targetContent = document.getElementById(targetTab);
        if (targetContent) targetContent.classList.add('active');

        if (_visitorPollTimer) {
            clearInterval(_visitorPollTimer);
            _visitorPollTimer = null;
        }

        if (targetTab === 'tabVisitors') {
            try { loadAdminVisitorsList(); } catch (err) {}
            _visitorPollTimer = setInterval(() => {
                try { loadAdminVisitorsList(); } catch (err) {}
            }, 2000);
        }
    });

    const btnRefreshVisitors = document.getElementById('btnRefreshVisitors');
    if (btnRefreshVisitors) {
        btnRefreshVisitors.addEventListener('click', loadAdminVisitorsList);
    }

    const urlParams = new URLSearchParams(window.location.search);
    const isParamAdmin = urlParams.get('admin') === 'true';

    async function openAdminModal() {
        if (!customModal) return;
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

        const inputAnnouncementText = document.getElementById('inputAnnouncementText');
        const inputAnnouncementActive = document.getElementById('inputAnnouncementActive');
        const inputSpotlightTarget = document.getElementById('inputSpotlightTarget');
        const inputSpotlightBadgeText = document.getElementById('inputSpotlightBadgeText');
        const inputSpotlightActive = document.getElementById('inputSpotlightActive');

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
        if (inputAnnouncementText) inputAnnouncementText.value = state.announcementText || '';
        if (inputAnnouncementActive) inputAnnouncementActive.checked = state.announcementActive !== false;

        const spotCfg = state.spotlightConfig || {};
        if (inputSpotlightTarget) inputSpotlightTarget.value = spotCfg.target || 'none';
        if (inputSpotlightBadgeText) inputSpotlightBadgeText.value = spotCfg.badgeText || '';
        if (inputSpotlightActive) inputSpotlightActive.checked = spotCfg.active !== false;

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

        // Cáº­p nháº­t chá»‰ sá»‘ thá»‘ng kĂª System Admin
        const admStatWishes = document.getElementById('admStatWishes');
        const admStatHearts = document.getElementById('admStatHearts');
        const admStatTracks = document.getElementById('admStatTracks');
        const admStatGallery = document.getElementById('admStatGallery');

        const guestbookWall = document.getElementById('guestbookWall');
        const wishCount = guestbookWall ? guestbookWall.children.length : 0;
        // Äá»c tá»•ng reactions tá»« element reactionTotalCount
        const reactionTotalEl = document.getElementById('reactionTotalCount');
        const hearts = reactionTotalEl ? reactionTotalEl.textContent : '0';

        if (admStatWishes) admStatWishes.textContent = wishCount;
        if (admStatHearts) admStatHearts.textContent = hearts;
        if (admStatTracks) admStatTracks.textContent = (state.playlist || []).length;
        if (admStatGallery) admStatGallery.textContent = (state.gallery || []).length;

        try { renderAdminPlaylistList(); } catch (err) {}
        try { renderAdminGalleryList(); } catch (err) {}
        try { renderAdminJourneyList(); } catch (err) {}
        try { renderAdminMapLocationsList(); } catch (err) {}
        try { renderAdminReactionsList(); } catch (err) {}
        try { fetchAndRenderAnonymousMessages(); } catch (err) {}

        customModal.classList.add('active');
    }

    window.openAdminModal = openAdminModal;
    window.showAdminLoginModal = promptAdminLogin;

    const hasAdminToken = Boolean(localStorage.getItem('admin_token'));
    if (btnCustomization) {
        btnCustomization.style.display = (hasAdminToken || isParamAdmin) ? 'inline-flex' : 'none';
        btnCustomization.addEventListener('click', openAdminModal);
        if (isParamAdmin) {
            setTimeout(() => openAdminModal(), 300);
        }
    }

    async function fetchAndRenderAnonymousMessages() {
        const adminAnonymousList = document.getElementById('adminAnonymousList');
        if (!adminAnonymousList) return;

        try {
            const token = localStorage.getItem('admin_token');
            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const res = await fetch('/api/data', { headers, credentials: 'include' });
            const data = await res.json();
            const msgs = data.anonymousMessages || [];

            adminAnonymousList.innerHTML = '';
            if (msgs.length === 0) {
                adminAnonymousList.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:24px;font-size:0.88rem;">ChÆ°a cĂ³ tin nháº¯n áº©n danh nĂ o.</div>';
                return;
            }

            msgs.slice().reverse().forEach(msg => {
                const div = document.createElement('div');
                div.className = 'anon-message-item';
                const timeStr = new Date(msg.createdAt).toLocaleString('vi-VN');

                // Render media attachment náº¿u cĂ³
                let mediaHTML = '';
                // Æ¯u tiĂªn mediaUrl (file Ä‘Ă£ upload), fallback sang mediaData (base64) náº¿u chÆ°a cĂ³ URL
                const mediaSrc = msg.mediaUrl || msg.mediaData || null;
                if (mediaSrc) {
                    const type = msg.mediaType || '';
                    if (type === 'audio') {
                        mediaHTML = `
                            <div class="anon-media-attach">
                                <span class="anon-media-tag"><i class="fa-solid fa-microphone"></i> Ghi Ă¢m</span>
                                <audio controls class="anon-admin-audio" src="${escapeHTML(mediaSrc)}"></audio>
                            </div>`;
                    } else if (type === 'image') {
                        mediaHTML = `
                            <div class="anon-media-attach">
                                <span class="anon-media-tag"><i class="fa-solid fa-image"></i> áº¢nh</span>
                                <img class="anon-admin-img" src="${escapeHTML(mediaSrc)}"
                                     alt="áº¢nh áº©n danh"
                                     onclick="window.open('${escapeHTML(msg.mediaUrl || '#')}','_blank')">
                            </div>`;
                    } else if (type === 'video') {
                        mediaHTML = `
                            <div class="anon-media-attach">
                                <span class="anon-media-tag"><i class="fa-solid fa-video"></i> Video</span>
                                <video controls class="anon-admin-video" src="${escapeHTML(mediaSrc)}"></video>
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
            adminAnonymousList.innerHTML = '<div style="text-align:center;color:#dc2626;padding:24px;font-size:0.88rem;"><i class="fa-solid fa-triangle-exclamation"></i> Lá»—i táº£i dá»¯ liá»‡u â€” báº¡n Ä‘ang cháº¡y offline?</div>';
        }
    }

    // Sá»± kiá»‡n nĂºt NiĂªm Phong / Má»Ÿ NiĂªm Phong ViĂªn Nang Tá»‘t Nghiá»‡p
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
                const confirmLock = confirm(`đŸ“ XĂC NHáº¬N Lá»„ NIĂM PHONG THANH XUĂ‚N?\n\nKhi báº¡n Ä‘á»“ng Ă½, toĂ n bá»™ ká»· niá»‡m thá»i há»c sinh (Nháº­t kĂ½, áº¢nh lá»›p, ThĂ nh tĂ­ch, LÆ°u bĂºt) sáº½ Ä‘Æ°á»£c khĂ³a láº¡i trong 'ViĂªn Nang Thá»i Gian Tá»‘t Nghiá»‡p'.\n\nBáº¡n cĂ³ cháº¯c cháº¯n muá»‘n niĂªm phong viĂªn nang khĂ´ng?`);
                if (confirmLock) {
                    state.isCapsuleLocked = true;
                    state.sealedAt = new Date().toISOString();
                    updateCapsuleStatusDOM(state, capsuleStatusInfo);
                    await saveBackendConfig(state);
                    refreshDOM();
                    alert("âœ¨ ÄĂƒ NIĂM PHONG THĂ€NH CĂ”NG VIĂN NANG THá»œI GIAN Tá»T NGHIá»†P! đŸ“\n\nKĂ½ á»©c thá»i há»c sinh cá»§a báº¡n Ä‘Ă£ Ä‘Æ°á»£c báº£o tá»“n vÄ©nh viá»…n.");
                }
            } else {
                const confirmUnlock = confirm(`Má»Ÿ khĂ³a láº¡i ViĂªn Nang Thá»i Gian Tá»‘t Nghiá»‡p Ä‘á»ƒ bá»• sung kĂ½ á»©c?`);
                if (confirmUnlock) {
                    state.isCapsuleLocked = false;
                    updateCapsuleStatusDOM(state, capsuleStatusInfo);
                    await saveBackendConfig(state);
                    refreshDOM();
                    alert("đŸ”“ ÄĂ£ má»Ÿ khĂ³a chá»‰nh sá»­a viĂªn nang!");
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
    const reactionsAdminList = document.getElementById('reactionsAdminList');
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
                    <span><i class="fa-solid fa-compact-disc"></i> BĂ i HĂ¡t #${index + 1}</span>
                    <button class="btn-remove-item" data-index="${index}"><i class="fa-solid fa-trash"></i> XĂ³a</button>
                </div>
                <div class="admin-item-grid">
                    <div class="input-group">
                        <label>Táº£i File MP3 tá»« mĂ¡y:</label>
                        <input type="file" class="adm-trk-file" data-index="${index}" accept="audio/*">
                    </div>
                    <div class="input-group">
                        <label>Hoáº·c DĂ¡n Link MP3 URL:</label>
                        <input type="text" class="adm-trk-url" data-index="${index}" value="${escapeHTML(item.url || '')}" placeholder="https://.../music.mp3">
                    </div>
                    <div class="input-group">
                        <label>TĂªn bĂ i hĂ¡t:</label>
                        <input type="text" class="adm-trk-title" data-index="${index}" value="${escapeHTML(item.title || '')}" placeholder="VD: Giai Äiá»‡u Thanh XuĂ¢n">
                    </div>
                    <div class="input-group">
                        <label>Ca sÄ© / Nghá»‡ sÄ©:</label>
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
                    <span><i class="fa-solid fa-camera"></i> Bá»©c áº¢nh #${index + 1}</span>
                    <button class="btn-remove-item" data-index="${index}"><i class="fa-solid fa-trash"></i> XĂ³a</button>
                </div>
                <div class="admin-item-grid">
                    <div class="input-group">
                        <label>Táº£i File áº¢nh tá»« mĂ¡y:</label>
                        <input type="file" class="adm-gal-file" data-index="${index}" accept="image/*">
                    </div>
                    <div class="input-group">
                        <label>Hoáº·c DĂ¡n Link URL áº¢nh:</label>
                        <input type="text" class="adm-gal-url" data-index="${index}" value="${escapeHTML(item.url || '')}" placeholder="https://...">
                    </div>
                    <div class="input-group">
                        <label>ChĂº thĂ­ch áº£nh:</label>
                        <input type="text" class="adm-gal-caption" data-index="${index}" value="${escapeHTML(item.caption || '')}" placeholder="VD: HoĂ ng HĂ´n Chiá»u Biá»ƒn...">
                    </div>
                    <div class="input-group">
                        <label>Thá»i gian Ä‘Ă£ chá»¥p:</label>
                        <input type="text" class="adm-gal-date" data-index="${index}" value="${escapeHTML(item.date || '')}" placeholder="VD: 15/10/2024 hoáº·c HĂ¨ 2024">
                    </div>
                    <div class="input-group" style="grid-column: 1 / -1;">
                        <label>Äá»‹a Ä‘iá»ƒm / Ghi chĂº:</label>
                        <input type="text" class="adm-gal-location" data-index="${index}" value="${escapeHTML(item.location || '')}" placeholder="VD: ÄĂ  Náºµng, HĂ  Ná»™i...">
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
                    <span><i class="fa-solid fa-compass"></i> Dáº¥u ChĂ¢n Thanh XuĂ¢n #${index + 1}</span>
                    <button class="btn-remove-item" data-index="${index}"><i class="fa-solid fa-trash"></i> XĂ³a</button>
                </div>
                <div class="admin-item-grid">
                    <div class="input-group">
                        <label>TiĂªu Ä‘á» hĂ nh trĂ¬nh:</label>
                        <input type="text" class="adm-jou-title" data-index="${index}" value="${escapeHTML(item.title || '')}" placeholder="VD: Chuyáº¿n Äi Xa Äáº§u TiĂªn">
                    </div>
                    <div class="input-group">
                        <label>Tháº» phĂ¢n loáº¡i / NhĂ£n:</label>
                        <input type="text" class="adm-jou-tag" data-index="${index}" value="${escapeHTML(item.tag || '')}" placeholder="VD: HĂ nh TrĂ¬nh Tráº£i Nghiá»‡m">
                    </div>
                    <div class="input-group">
                        <label>Thá»i gian (ThĂ¡ng/NÄƒm):</label>
                        <input type="text" class="adm-jou-date" data-index="${index}" value="${escapeHTML(item.date || '')}" placeholder="VD: 10/2023">
                    </div>
                    <div class="input-group">
                        <label>DĂ¡n URL Link áº¢nh:</label>
                        <input type="text" class="adm-jou-url" data-index="${index}" value="${escapeHTML(item.url || '')}" placeholder="https://...">
                    </div>
                    <div class="input-group" style="grid-column: 1 / -1;">
                        <label>MĂ´ táº£ ngáº¯n cĂ¢u chuyá»‡n:</label>
                        <input type="text" class="adm-jou-desc" data-index="${index}" value="${escapeHTML(item.desc || '')}" placeholder="MĂ´ táº£ láº¡i cáº£m xĂºc, ká»· niá»‡m cá»§a Káº¿...">
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
            state.playlist.push({ title: 'BĂ i HĂ¡t Má»›i', artist: 'Káº¿', url: '' });
            renderAdminPlaylistList();
        });
    }

    if (btnAddGalleryPhoto) {
        btnAddGalleryPhoto.addEventListener('click', () => {
            const state = getState();
            state.gallery = state.gallery || [];
            state.gallery.push({ url: '', caption: 'Khoáº£nh kháº¯c má»›i', date: 'Vá»«a xong', location: '' });
            renderAdminGalleryList();
        });
    }

    if (btnAddJourneyCard) {
        btnAddJourneyCard.addEventListener('click', () => {
            const state = getState();
            state.journey = state.journey || [];
            state.journey.push({ title: 'Ká»· Niá»‡m Má»›i', desc: 'MĂ´ táº£ ká»· niá»‡m thanh xuĂ¢n má»›i...', tag: 'HĂ nh TrĂ¬nh', date: '2025', url: '' });
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
                    <span><i class="fa-solid fa-location-dot"></i> Äá»‹a Äiá»ƒm #${index + 1}</span>
                    <button class="btn-remove-item" data-index="${index}"><i class="fa-solid fa-trash"></i> XĂ³a</button>
                </div>
                <div class="admin-item-grid">
                    <div class="input-group">
                        <label>TĂªn Ä‘á»‹a Ä‘iá»ƒm (Ä‘á»ƒ tĂ¬m kiáº¿m trĂªn báº£n Ä‘á»“):</label>
                        <input type="text" class="adm-map-name" data-index="${index}" value="${escapeHTML(item.name || '')}" placeholder="VD: TrÆ°á»ng THPT Chu VÄƒn An, HĂ  Ná»™i">
                    </div>
                    <div class="input-group">
                        <label>NhĂ£n hiá»ƒn thá»‹ (tuá»³ chá»n):</label>
                        <input type="text" class="adm-map-label" data-index="${index}" value="${escapeHTML(item.label || '')}" placeholder="VD: MĂ¡i trÆ°á»ng 3 nÄƒm â¤ï¸">
                    </div>
                    <div class="input-group">
                        <label>VÄ© Ä‘á»™ / Latitude (tá»± tĂ¬m hoáº·c nháº­p):</label>
                        <input type="text" class="adm-map-lat" data-index="${index}" value="${escapeHTML(String(item.lat || ''))}" placeholder="VD: 21.0285">
                    </div>
                    <div class="input-group">
                        <label>Kinh Ä‘á»™ / Longitude (tá»± tĂ¬m hoáº·c nháº­p):</label>
                        <input type="text" class="adm-map-lng" data-index="${index}" value="${escapeHTML(String(item.lng || ''))}" placeholder="VD: 105.8542">
                    </div>
                    <div class="input-group" style="grid-column: 1 / -1;">
                        <button type="button" class="btn-geocode-map" data-index="${index}">
                            <i class="fa-solid fa-magnifying-glass-location"></i> TĂ¬m Tá»a Äá»™ Tá»± Äá»™ng Qua TĂªn Äá»‹a Äiá»ƒm
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
                        showToast("â ï¸ Vui lĂ²ng nháº­p tĂªn Ä‘á»‹a Ä‘iá»ƒm trÆ°á»›c khi tĂ¬m tá»a Ä‘á»™!");
                        return;
                    }
                    btnGeocode.disabled = true;
                    btnGeocode.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Äang tĂ¬m...';
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
                            showToast(`đŸ“ ÄĂ£ tá»± Ä‘á»™ng tĂ¬m tháº¥y tá»a Ä‘á»™: ${lat}, ${lon}`);
                        } else {
                            showToast("â ï¸ KhĂ´ng tĂ¬m tháº¥y tá»a Ä‘á»™ tá»± Ä‘á»™ng. Báº¡n cĂ³ thá»ƒ tá»± nháº­p Lat/Lng thá»§ cĂ´ng!");
                        }
                    } catch (e) {
                        showToast("Lá»—i káº¿t ná»‘i dá»‹ch vá»¥ tĂ¬m tá»a Ä‘á»™.");
                    } finally {
                        btnGeocode.disabled = false;
                        btnGeocode.innerHTML = '<i class="fa-solid fa-magnifying-glass-location"></i> TĂ¬m Tá»a Äá»™ Tá»± Äá»™ng Qua TĂªn Äá»‹a Äiá»ƒm';
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

    function renderAdminReactionsList() {
        if (!reactionsAdminList) return;
        reactionsAdminList.innerHTML = '';
        const state = getState();
        const list = state.reactionsConfig && state.reactionsConfig.length > 0
            ? state.reactionsConfig
            : (KE_CONFIG.reactionsConfig || []);

        list.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'admin-item-card';
            card.innerHTML = `
                <div class="admin-item-header">
                    <span><i class="fa-solid fa-face-smile"></i> Icon Meme #${index + 1} (${item.emoji || ''})</span>
                </div>
                <div class="admin-item-grid" style="grid-template-columns: 80px 1fr 1fr;">
                    <div class="input-group" style="display:flex;flex-direction:column;align-items:center;justify-content:center;">
                        <label>Xem trÆ°á»›c:</label>
                        <img src="${escapeHTML(item.imgUrl || '')}" class="adm-react-preview" style="width:48px;height:48px;object-fit:cover;border-radius:50%;border:2px solid #f59e0b;margin-top:4px;" alt="preview">
                    </div>
                    <div class="input-group">
                        <label>TĂªn / TiĂªu Ä‘á» (Tooltip):</label>
                        <input type="text" class="adm-react-title" data-index="${index}" value="${escapeHTML(item.title || '')}" placeholder="VD: Tháº£ Tim Háº¡ NhĂ¢n">
                    </div>
                    <div class="input-group">
                        <label>Symbol Emoji ID:</label>
                        <input type="text" class="adm-react-emoji" data-index="${index}" value="${escapeHTML(item.emoji || '')}" readonly style="background:#f1f5f9;cursor:not-allowed;">
                    </div>
                    <div class="input-group" style="grid-column: 1 / -1; display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
                        <div class="input-group">
                            <label>Táº£i File áº¢nh tá»« mĂ¡y:</label>
                            <input type="file" class="adm-react-file" data-index="${index}" accept="image/*">
                        </div>
                        <div class="input-group">
                            <label>Hoáº·c DĂ¡n Link URL áº¢nh:</label>
                            <input type="text" class="adm-react-url" data-index="${index}" value="${escapeHTML(item.imgUrl || '')}" placeholder="https://... hoáº·c assets/memes/...">
                        </div>
                    </div>
                </div>
            `;
            const fileInput = card.querySelector('.adm-react-file');
            const urlInput = card.querySelector('.adm-react-url');
            const imgPreview = card.querySelector('.adm-react-preview');

            if (urlInput && imgPreview) {
                urlInput.addEventListener('input', () => {
                    if (urlInput.value.trim()) imgPreview.src = urlInput.value.trim();
                });
            }
            if (fileInput && imgPreview) {
                fileInput.addEventListener('change', () => {
                    if (fileInput.files && fileInput.files[0]) {
                        const reader = new FileReader();
                        reader.onload = (e) => { imgPreview.src = e.target.result; };
                        reader.readAsDataURL(fileInput.files[0]);
                    }
                });
            }

            reactionsAdminList.appendChild(card);
        });
    }

    // Save logic vá»›i há»— trá»£ Upload File tá»« mĂ¡y
    if (btnSaveSettings) {
        btnSaveSettings.addEventListener('click', async () => {
            btnSaveSettings.disabled = true;
            btnSaveSettings.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Äang lÆ°u...';

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
            // (Náº¿u khĂ´ng chá»n file má»›i vĂ  Ă´ URL trá»‘ng, giá»¯ nguyĂªn state.photoUrl hiá»‡n táº¡i)

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
                        title: title || 'BĂ i HĂ¡t Thanh XuĂ¢n',
                        artist: trkArtists[i] ? trkArtists[i].value.trim() : 'Káº¿',
                        url
                    });
                }
            }
            state.playlist = newPlaylist;

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
            state.gallery = newGallery;

            // Read Journey Cards
            const jouTitles = document.querySelectorAll('.adm-jou-title'); const jouTags = document.querySelectorAll('.adm-jou-tag');
            const jouDates = document.querySelectorAll('.adm-jou-date');
            const jouUrls = document.querySelectorAll('.adm-jou-url');
            const jouDescs = document.querySelectorAll('.adm-jou-desc');
            const newJourney = [];

            for (let i = 0; i < jouTitles.length; i++) {
                const title = jouTitles[i].value.trim();
                const url = jouUrls[i] ? jouUrls[i].value.trim() : '';
                if (title || url) {
                    newJourney.push({
                        title: title || 'Ká»· Niá»‡m',
                        tag: jouTags[i] ? jouTags[i].value.trim() : 'HĂ nh TrĂ¬nh',
                        date: jouDates[i] ? jouDates[i].value.trim() : '',
                        url,
                        desc: jouDescs[i] ? jouDescs[i].value.trim() : ''
                    });
                }
            }
            state.journey = newJourney;

            // Read Map Locations
            const mapNames = document.querySelectorAll('.adm-map-name');
            const mapLabels = document.querySelectorAll('.adm-map-label');
            const mapLats = document.querySelectorAll('.adm-map-lat');
            const mapLngs = document.querySelectorAll('.adm-map-lng');
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
                    address: inputHomeAddress ? inputHomeAddress.value.trim() : 'XĂ£ Quan ThĂ nh, Tá»‰nh Nghá»‡ An'
                };
            }

            setState(state);
            await saveBackendConfig(state);
            refreshDOM();

            btnSaveSettings.disabled = false;
            btnSaveSettings.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> LÆ°u Thay Äá»•i';
            if (customModal) customModal.classList.remove('active');
            showToast("ÄĂ£ cáº­p nháº­t toĂ n bá»™ thay Ä‘á»•i & vá»‹ trĂ­ NhĂ  Káº¿ thĂ nh cĂ´ng! âœ¨");
        });
    }

    // â”€â”€ Xá»¬ LĂ NĂT LÆ¯U Äá»˜C Láº¬P Tá»ªNG TAB (Tab-Scoped Save Buttons) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    document.querySelectorAll('.btn-tab-save').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const action = btn.getAttribute('data-tab-action');
            const originalHTML = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Äang lÆ°u...`;

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

                    const inputAnnouncementText = document.getElementById('inputAnnouncementText');
                    const inputAnnouncementActive = document.getElementById('inputAnnouncementActive');
                    if (inputAnnouncementText) state.announcementText = inputAnnouncementText.value.trim();
                    if (inputAnnouncementActive) state.announcementActive = inputAnnouncementActive.checked;

                    const inputSpotlightTarget = document.getElementById('inputSpotlightTarget');
                    const inputSpotlightBadgeText = document.getElementById('inputSpotlightBadgeText');
                    const inputSpotlightActive = document.getElementById('inputSpotlightActive');
                    state.spotlightConfig = {
                        target: inputSpotlightTarget ? inputSpotlightTarget.value : 'none',
                        badgeText: inputSpotlightBadgeText ? inputSpotlightBadgeText.value.trim() : 'HOT NEW! đŸ”¥',
                        active: inputSpotlightActive ? inputSpotlightActive.checked : false
                    };

                    if (window.applySpotlightHighlight) {
                        window.applySpotlightHighlight(state);
                    }

                    if (window.triggerAnnouncerShout) {
                        window.triggerAnnouncerShout(state.announcementText, state.announcementActive);
                    }

                    showToast("ÄĂ£ lÆ°u thĂ´ng tin Há»“ SÆ¡ cĂ¡ nhĂ¢n & TiĂªu Ä‘iá»ƒm ná»•i báº­t! đŸ‘¤âœ¨");
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
                                title: title || 'BĂ i HĂ¡t Thanh XuĂ¢n',
                                artist: trkArtists[i] ? trkArtists[i].value.trim() : 'Káº¿',
                                url
                            });
                        }
                    }
                    state.playlist = newPlaylist;
                    showToast("ÄĂ£ lÆ°u Playlist Ă‚m Nháº¡c! đŸµâœ¨");
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

                    showToast("ÄĂ£ lÆ°u Gu & Sá»Ÿ ThĂ­ch cĂ¡ nhĂ¢n! đŸ’–âœ¨");
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
                                title: title || 'Ká»· Niá»‡m',
                                tag: jouTags[i] ? jouTags[i].value.trim() : 'HĂ nh TrĂ¬nh',
                                date: jouDates[i] ? jouDates[i].value.trim() : '',
                                url,
                                desc: jouDescs[i] ? jouDescs[i].value.trim() : ''
                            });
                        }
                    }
                    state.journey = newJourney;
                    showToast("ÄĂ£ lÆ°u Dáº¥u ChĂ¢n Thanh XuĂ¢n! đŸ“âœ¨");
                }
                else if (action === 'memoryMap') {
                    const mapNames = document.querySelectorAll('.adm-map-name');
                    const mapLabels = document.querySelectorAll('.adm-map-label');
                    const mapLats = document.querySelectorAll('.adm-map-lat');
                    const mapLngs = document.querySelectorAll('.adm-map-lng');
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
                    showToast("ÄĂ£ lÆ°u Báº£n Äá»“ Ká»· Niá»‡m! đŸ—ºï¸âœ¨");
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
                    state.gallery = newGallery;
                    showToast("ÄĂ£ lÆ°u ThÆ° Viá»‡n áº¢nh Ká»· Niá»‡m! đŸ–¼ï¸âœ¨");
                }
                else if (action === 'reactions') {
                    const reactFiles = document.querySelectorAll('.adm-react-file');
                    const reactUrls = document.querySelectorAll('.adm-react-url');
                    const reactTitles = document.querySelectorAll('.adm-react-title');
                    const reactEmojis = document.querySelectorAll('.adm-react-emoji');
                    const newReactions = [];

                    const currentReactions = state.reactionsConfig && state.reactionsConfig.length > 0
                        ? state.reactionsConfig
                        : (KE_CONFIG.reactionsConfig || []);

                    for (let i = 0; i < reactUrls.length; i++) {
                        let imgUrl = reactUrls[i].value.trim();
                        const fileElem = reactFiles[i];
                        if (fileElem && fileElem.files.length > 0) {
                            const file = fileElem.files[0];
                            const base64 = await readFileAsDataURL(file);
                            imgUrl = await uploadFileToBackend(`reaction_${Date.now()}_${file.name}`, base64);
                        } else if (!imgUrl && currentReactions[i]) {
                            imgUrl = currentReactions[i].imgUrl;
                        }

                        const title = reactTitles[i] ? reactTitles[i].value.trim() : '';
                        const emoji = reactEmojis[i] ? reactEmojis[i].value.trim() : (currentReactions[i] ? currentReactions[i].emoji : '');
                        const countId = currentReactions[i] ? currentReactions[i].countId : `reactionCount-${i}`;

                        newReactions.push({
                            emoji,
                            title: title || 'Meme Reaction',
                            countId,
                            imgUrl: imgUrl || 'assets/memes/hanhan_1.png'
                        });
                    }
                    state.reactionsConfig = newReactions;
                    showToast("ÄĂ£ lÆ°u Cáº¥u HĂ¬nh Icon Meme! đŸ˜‚âœ¨");
                }

                setState(state);
                await saveBackendConfig(state);
                refreshDOM();
            } catch (err) {
                console.error("Tab save error:", err);
                showToast("âŒ CĂ³ lá»—i khi lÆ°u dá»¯ liá»‡u tab!");
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        });
    });

    // Xá»­ lĂ½ nĂºt "Láº¥y Vá»‹ TrĂ­ Hiá»‡n Táº¡i LĂ m Vá»‹ TrĂ­ NhĂ " trong trang Admin
    const btnGetMyCurrentHomeLocation = document.getElementById('btnGetMyCurrentHomeLocation');
    if (btnGetMyCurrentHomeLocation) {
        btnGetMyCurrentHomeLocation.addEventListener('click', () => {
            if ('geolocation' in navigator) {
                btnGetMyCurrentHomeLocation.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Äang láº¥y tá»a Ä‘á»™ GPS...`;
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
                    } catch (e) { }

                    btnGetMyCurrentHomeLocation.innerHTML = `<i class="fa-solid fa-circle-check"></i> ÄĂ£ Láº¥y Tá»a Äá»™ ThĂ nh CĂ´ng!`;
                    setTimeout(() => {
                        btnGetMyCurrentHomeLocation.innerHTML = `<i class="fa-solid fa-location-arrow"></i> Láº¥y Vá»‹ TrĂ­ Hiá»‡n Táº¡i LĂ m Vá»‹ TrĂ­ NhĂ `;
                    }, 3000);
                }, () => {
                    alert('KhĂ´ng thá»ƒ láº¥y GPS. Vui lĂ²ng báº­t quyá»n Ä‘á»‹nh vá»‹ cho trĂ¬nh duyá»‡t.');
                    btnGetMyCurrentHomeLocation.innerHTML = `<i class="fa-solid fa-location-arrow"></i> Láº¥y Vá»‹ TrĂ­ Hiá»‡n Táº¡i LĂ m Vá»‹ TrĂ­ NhĂ `;
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
            showToast("đŸ“¦ ÄĂ£ xuáº¥t thĂ nh cĂ´ng file Backup JSON!");
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
                            showToast("âœ¨ ÄĂ£ phá»¥c há»“i dá»¯ liá»‡u thĂ nh cĂ´ng tá»« file Backup!");
                            if (customModal) customModal.classList.remove('active');
                        } else {
                            alert("File backup khĂ´ng há»£p lá»‡!");
                        }
                    } catch (err) {
                        alert("Lá»—i Ä‘á»c file JSON: " + err.message);
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
        elem.innerHTML = `Tráº¡ng thĂ¡i: <span class="status-locked"><i class="fa-solid fa-lock"></i> ÄĂƒ NIĂM PHONG VÄ¨NH VIá»„N (${state.graduationDate || "2026-06-30"})</span>`;
        if (btnSealCapsule) {
            btnSealCapsule.innerHTML = '<i class="fa-solid fa-lock-open"></i> Má» KHĂ“A Láº I VIĂN NANG THANH XUĂ‚N';
            btnSealCapsule.style.background = 'linear-gradient(135deg, #10b981, #0284c7)';
        }
    } else {
        elem.innerHTML = `Tráº¡ng thĂ¡i: <span class="status-unlocked"><i class="fa-solid fa-lock-open"></i> Äang má»Ÿ chá»‰nh sá»­a</span>`;
        if (btnSealCapsule) {
            btnSealCapsule.innerHTML = '<i class="fa-solid fa-stamp"></i> THá»°C HIá»†N Lá»„ NIĂM PHONG THANH XUĂ‚N';
            btnSealCapsule.style.background = 'linear-gradient(135deg, #f59e0b, #e11d48)';
        }
    }
}

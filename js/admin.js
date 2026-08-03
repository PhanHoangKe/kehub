/**
 * admin.js - Trung Tâm Quản Lý Admin Kế (Quản lý không giới hạn Ảnh, Dấu Chân Thanh Xuân & Playlist)
 */
import { escapeHTML } from './config.js';
import { showToast } from './toast.js';

// ── Session cache trong memory ─────────────────────────────────────────────
let _adminAuthenticated = false;

async function checkAdminSession() {
    try {
        const res = await fetch('/api/admin/check', { credentials: 'include' });
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

    // Helper upload file lên Backend Node.js Server
    async function uploadFileToBackend(filename, base64Data) {
        try {
            const res = await fetch('/api/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

    // Admin Tabs Switching
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
        });
    });

    const urlParams = new URLSearchParams(window.location.search);
    const isAdmin = urlParams.get('admin') === 'true';
    if (isAdmin && btnCustomization) {
        btnCustomization.style.display = 'flex';
        // Auto open admin modal if navigated to via /admin (which redirects to ?admin=true)
        setTimeout(() => btnCustomization.click(), 500);
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

            if (inputGraduationDate) inputGraduationDate.value = state.graduationDate || '2026-06-30';
            updateCapsuleStatusDOM(state, capsuleStatusInfo);

            // Cập nhật chỉ số thống kê System Admin
            const admStatWishes = document.getElementById('admStatWishes');
            const admStatHearts = document.getElementById('admStatHearts');
            const admStatTracks = document.getElementById('admStatTracks');
            const admStatGallery = document.getElementById('admStatGallery');

            const guestbookWall = document.getElementById('guestbookWall');
            const wishCount = guestbookWall ? guestbookWall.children.length : 0;
            const heartElem = document.getElementById('heartCount');
            const hearts = heartElem ? heartElem.textContent : '128';

            if (admStatWishes) admStatWishes.textContent = wishCount;
            if (admStatHearts) admStatHearts.textContent = hearts;
            if (admStatTracks) admStatTracks.textContent = (state.playlist || []).length;
            if (admStatGallery) admStatGallery.textContent = (state.gallery || []).length;

            renderAdminPlaylistList();
            renderAdminGalleryList();
            renderAdminJourneyList();
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
        btnCloseModal.addEventListener('click', () => customModal.classList.remove('active'));
    }

    const btnCancelSettings = document.getElementById('btnCancelSettings');
    if (btnCancelSettings && customModal) {
        btnCancelSettings.addEventListener('click', () => customModal.classList.remove('active'));
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
            } else if (inputPhotoUrl) {
                state.photoUrl = inputPhotoUrl.value.trim();
            }

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

            setState(state);
            await saveBackendConfig(state);
            refreshDOM();

            btnSaveSettings.disabled = false;
            btnSaveSettings.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Lưu Thay Đổi';
            if (customModal) customModal.classList.remove('active');
            showToast("Đã cập nhật toàn bộ thay đổi thành công! ✨");
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

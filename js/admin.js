/**
 * admin.js — Entry point Admin. Giữ: login, openAdminModal, switchTab, liveclock.
 * Các tính năng con đã tách vào js/admin/*.js
 */
import { escapeHTML }                        from './config.js';
import { showToast }                         from './toast.js';
import { updateCapsuleStatusDOM }            from './admin/admin-utils.js';
import { initVisitors, loadAdminVisitorsList } from './admin/admin-visitors.js';
import {
    fetchAndRenderAnonymousMessages,
    initAnonSession,
    stopAnonPolling,
} from './admin/admin-anonymous.js';
import {
    initRenderers,
    renderAdminPlaylistList,
    renderAdminGalleryList,
    renderAdminJourneyList,
    renderAdminMapLocationsList,
    renderAdminReactionsList,
} from './admin/admin-renderers.js';
import { initSave }   from './admin/admin-save.js';
import { initBackup } from './admin/admin-backup.js';

// ── Session cache ──────────────────────────────────────────────────────────────
let _adminAuthenticated = false;

async function checkAdminSession() {
    try {
        const token   = localStorage.getItem('admin_token');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res  = await fetch('/api/admin/check', { headers, credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            _adminAuthenticated = data.authenticated === true;
        }
    } catch { _adminAuthenticated = false; }
    return _adminAuthenticated;
}

// ── Modal đăng nhập ────────────────────────────────────────────────────────────
function promptAdminLogin() {
    return new Promise((resolve) => {
        let loginModal = document.getElementById('adminLoginModal');
        if (!loginModal) {
            loginModal = document.createElement('div');
            loginModal.id        = 'adminLoginModal';
            loginModal.className = 'admin-login-overlay';
            loginModal.innerHTML = `
                <div class="admin-login-card">
                    <div class="admin-login-glow"></div>
                    <div class="admin-login-header">
                        <div class="admin-login-icon"><i class="fa-solid fa-shield-halved"></i></div>
                        <div>
                            <h3 class="admin-login-title">Khu Vực Admin</h3>
                            <p class="admin-login-sub">Chỉ dành cho chủ sở hữu</p>
                        </div>
                    </div>
                    <div class="admin-login-divider"></div>
                    <div class="admin-login-body">
                        <label class="admin-login-label"><i class="fa-solid fa-lock"></i> Mật khẩu Admin</label>
                        <div class="admin-password-wrap">
                            <input type="password" id="adminPasswordInput" class="admin-login-input"
                                   placeholder="Nhập mật khẩu của bạn..." autocomplete="current-password" />
                            <button type="button" id="adminTogglePassword" class="admin-toggle-eye" tabindex="-1">
                                <i class="fa-solid fa-eye"></i>
                            </button>
                        </div>
                        <p id="adminLoginError" class="admin-login-error"></p>
                    </div>
                    <div class="admin-login-footer">
                        <button id="adminLoginCancel" class="admin-btn-cancel">Hủy</button>
                        <button id="adminLoginSubmit" class="admin-btn-submit">
                            <i class="fa-solid fa-arrow-right-to-bracket"></i>
                            <span>Đăng Nhập</span>
                        </button>
                    </div>
                </div>`;
            document.body.appendChild(loginModal);

            loginModal.querySelector('#adminTogglePassword').addEventListener('click', () => {
                const inp  = loginModal.querySelector('#adminPasswordInput');
                const icon = loginModal.querySelector('#adminTogglePassword i');
                if (inp.type === 'password') { inp.type = 'text';     icon.className = 'fa-solid fa-eye-slash'; }
                else                         { inp.type = 'password'; icon.className = 'fa-solid fa-eye'; }
            });
        }

        loginModal.style.display = 'flex';
        loginModal.classList.add('active');

        const input   = document.getElementById('adminPasswordInput');
        const errorEl = document.getElementById('adminLoginError');
        const btnOk   = document.getElementById('adminLoginSubmit');
        const btnCancel = document.getElementById('adminLoginCancel');

        if (input)   { input.value = ''; setTimeout(() => input.focus(), 100); }
        if (errorEl) errorEl.style.display = 'none';

        async function doLogin() {
            const password = input ? input.value : '';
            if (!password) return;
            btnOk.disabled  = true;
            btnOk.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang kiểm tra...';
            try {
                const res  = await fetch('/api/login', {
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
                    if (errorEl) { errorEl.textContent = data.message || 'Mật khẩu không đúng'; errorEl.style.display = 'block'; }
                    btnOk.disabled  = false;
                    btnOk.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i><span>Đăng Nhập</span>';
                    if (input) input.value = '';
                }
            } catch (e) {
                if (errorEl) {
                    errorEl.textContent = e.message?.includes('fetch')
                        ? 'Không kết nối được server. Hãy chắc chắn server đang chạy tại http://localhost:3000'
                        : 'Lỗi kết nối server';
                    errorEl.style.display = 'block';
                }
                btnOk.disabled  = false;
                btnOk.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i><span>Đăng Nhập</span>';
            }
        }

        if (btnOk)     btnOk.addEventListener('click', doLogin, { once: true });
        if (input)     input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
        if (btnCancel) btnCancel.addEventListener('click', () => {
            loginModal.style.display = 'none';
            loginModal.classList.remove('active');
            resolve(false);
        }, { once: true });
    });
}

// ── Main export ────────────────────────────────────────────────────────────────
export function initAdminEngine(getState, setState, saveBackendConfig, refreshDOM) {

    const btnCustomization = document.getElementById('btnCustomization');
    const customModal      = document.getElementById('customModal');
    const btnCloseModal    = document.getElementById('btnCloseModal');
    const btnCancelSettings = document.getElementById('btnCancelSettings');

    // ── Tab meta ────────────────────────────────────────────────────────────
    const TAB_META = {
        tabOverview:   { icon: 'fa-chart-line',         label: 'Tổng Quan',        actions: '' },
        tabVisitors:   { icon: 'fa-user-secret',        label: 'Khách Viếng Thăm', actions: '<button id="btnRefreshVisitors2" class="btn-backup-export"><i class="fa-solid fa-rotate"></i> Làm Mới</button>' },
        tabAnonymous:  { icon: 'fa-envelope-open-text', label: 'Hộp Thư Ẩn Danh', actions: '' },
        tabProfile:    { icon: 'fa-user-pen',           label: 'Hồ Sơ',            actions: '<button class="btn-tab-save adm-header-save-btn" data-tab-action="profile"><i class="fa-solid fa-floppy-disk"></i> Lưu Hồ Sơ</button>' },
        tabGallery:    { icon: 'fa-images',             label: 'Thư Viện Ảnh',     actions: '<button class="btn-add-item2" onclick="document.getElementById(\'btnAddGalleryPhoto\').click()"><i class="fa-solid fa-plus"></i> Thêm</button><button class="btn-tab-save adm-header-save-btn" data-tab-action="gallery"><i class="fa-solid fa-floppy-disk"></i> Lưu</button>' },
        tabMusic:      { icon: 'fa-music',              label: 'Playlist',          actions: '<button class="btn-add-item2" onclick="document.getElementById(\'btnAddPlaylistTrack\').click()"><i class="fa-solid fa-plus"></i> Thêm</button><button class="btn-tab-save adm-header-save-btn" data-tab-action="music"><i class="fa-solid fa-floppy-disk"></i> Lưu</button>' },
        tabFavorites:  { icon: 'fa-heart',              label: 'Sở Thích',          actions: '<button class="btn-tab-save adm-header-save-btn" data-tab-action="favorites"><i class="fa-solid fa-floppy-disk"></i> Lưu</button>' },
        tabMilestones: { icon: 'fa-map-pin',            label: 'Dấu Chân',          actions: '<button class="btn-add-item2" onclick="document.getElementById(\'btnAddJourneyCard\').click()"><i class="fa-solid fa-plus"></i> Thêm</button><button class="btn-tab-save adm-header-save-btn" data-tab-action="milestones"><i class="fa-solid fa-floppy-disk"></i> Lưu</button>' },
        tabMemoryMap:  { icon: 'fa-map-location-dot',   label: 'Bản Đồ',           actions: '<button class="btn-add-item2" onclick="document.getElementById(\'btnAddMapLocation\').click()"><i class="fa-solid fa-plus"></i> Thêm</button><button class="btn-tab-save adm-header-save-btn" data-tab-action="memoryMap"><i class="fa-solid fa-floppy-disk"></i> Lưu</button>' },
        tabReactions:  { icon: 'fa-icons',              label: 'Icon Meme',         actions: '<button class="btn-tab-save adm-header-save-btn" data-tab-action="reactions"><i class="fa-solid fa-floppy-disk"></i> Lưu</button>' },
    };

    // ── Live clock ──────────────────────────────────────────────────────────
    let _liveClockTimer = null;
    function startLiveClock() {
        const el = document.getElementById('admLiveTime');
        if (!el) return;
        function tick() {
            el.textContent = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }
        tick();
        if (_liveClockTimer) clearInterval(_liveClockTimer);
        _liveClockTimer = setInterval(tick, 1000);
    }
    function stopLiveClock() {
        if (_liveClockTimer) { clearInterval(_liveClockTimer); _liveClockTimer = null; }
    }

    // ── Activity feed ───────────────────────────────────────────────────────
    function pushFeedEvent(text, color) {
        const feedBody = document.getElementById('admFeedBody');
        if (!feedBody) return;
        const row     = document.createElement('div');
        row.className = 'adm-feed-row';
        const timeStr = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        row.innerHTML = `
            <span class="adm-feed-row-dot" style="background:${color || 'var(--adm-violet)'};"></span>
            <span>${text}</span>
            <span class="adm-feed-row-time">${timeStr}</span>`;
        feedBody.prepend(row);
        while (feedBody.children.length > 20) feedBody.removeChild(feedBody.lastChild);
    }
    window._admPushFeed = pushFeedEvent;

    // ── Visitor poll timer ──────────────────────────────────────────────────
    let _visitorPollTimer = null;

    // ── switchTab ───────────────────────────────────────────────────────────
    function switchTab(targetTab) {
        if (!targetTab) return;
        document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
        document.querySelectorAll(`.admin-tab-btn[data-tab="${targetTab}"]`).forEach(b => b.classList.add('active'));
        const content = document.getElementById(targetTab);
        if (content) content.classList.add('active');

        const meta             = TAB_META[targetTab];
        const headerTitle      = document.getElementById('admHeaderTitle');
        const admHeaderActions = document.getElementById('admHeaderActions');
        if (headerTitle && meta)      headerTitle.innerHTML      = `<i class="fa-solid ${meta.icon}"></i> ${meta.label}`;
        if (admHeaderActions && meta) admHeaderActions.innerHTML = meta.actions || '';

        if (_visitorPollTimer) { clearInterval(_visitorPollTimer); _visitorPollTimer = null; }

        if (targetTab === 'tabVisitors') {
            try { loadAdminVisitorsList(); } catch {}
            _visitorPollTimer = setInterval(() => { try { loadAdminVisitorsList(); } catch {} }, 2000);
            const btn2 = document.getElementById('btnRefreshVisitors2');
            if (btn2) btn2.addEventListener('click', loadAdminVisitorsList, { once: true });
        }
        if (targetTab === 'tabAnonymous') {
            try { fetchAndRenderAnonymousMessages(); } catch {}
        }
        if (targetTab === 'tabOverview') startLiveClock();
        else stopLiveClock();
    }

    // Tab nav delegation
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.admin-tab-btn');
        if (btn) switchTab(btn.getAttribute('data-tab'));
    });

    // ── openAdminModal ──────────────────────────────────────────────────────
    async function openAdminModal() {
        if (!customModal) return;
        const alreadyAuth = await checkAdminSession();
        if (!alreadyAuth) {
            const loggedIn = await promptAdminLogin();
            if (!loggedIn) return;
        }

        const state = getState();

        // Populate profile fields
        const profileFields = {
            inputName: 'name', inputSchoolName: 'schoolName', inputClassName: 'className',
            inputClassSlogan: 'classSlogan', inputQuote1: 'quote1', inputQuote2: 'quote2',
            inputQuote3: 'quote3', inputBirthdayDate: 'birthdayDate', inputBalloonTiktokUrl: 'balloonTiktokUrl',
            inputAnnouncementText: 'announcementText',
            inputFavMusic: 'favMusic', inputFavMovie: 'favMovie', inputFavBook: 'favBook',
            inputFavDrink: 'favDrink', inputFavFashion: 'favFashion', inputFavLover: 'favLover',
            inputFavLifestyle: 'favLifestyle', inputFavColor: 'favColor',
        };
        for (const [id, key] of Object.entries(profileFields)) {
            const el = document.getElementById(id);
            if (el) el.value = state[key] || '';
        }

        // Photo URL (skip base64)
        const inputPhotoUrl = document.getElementById('inputPhotoUrl');
        if (inputPhotoUrl) inputPhotoUrl.value = state.photoUrl?.startsWith('data:') ? '' : (state.photoUrl || '');

        // Announcement active
        const inputAnnouncementActive = document.getElementById('inputAnnouncementActive');
        if (inputAnnouncementActive) inputAnnouncementActive.checked = state.announcementActive !== false;

        // Spotlight
        const spotCfg = state.spotlightConfig || {};
        const inputSpotlightTarget    = document.getElementById('inputSpotlightTarget');
        const inputSpotlightBadgeText = document.getElementById('inputSpotlightBadgeText');
        const inputSpotlightActive    = document.getElementById('inputSpotlightActive');
        if (inputSpotlightTarget)    inputSpotlightTarget.value    = spotCfg.target    || 'none';
        if (inputSpotlightBadgeText) inputSpotlightBadgeText.value = spotCfg.badgeText || '';
        if (inputSpotlightActive)    inputSpotlightActive.checked  = spotCfg.active    !== false;

        // Social links
        const socialMap = { inputLinkFacebook:'facebook', inputLinkMessenger:'messenger',
                            inputLinkZalo:'zalo', inputLinkTiktok:'tiktok', inputLinkInstagram:'instagram' };
        for (const [id, key] of Object.entries(socialMap)) {
            const el = document.getElementById(id);
            if (el) el.value = state.socialLinks?.[key] || '';
        }

        // Home location
        const inputHomeLat  = document.getElementById('inputHomeLat');
        const inputHomeLng  = document.getElementById('inputHomeLng');
        const inputHomeAddr = document.getElementById('inputHomeAddress');
        if (state.homeLocation) {
            if (inputHomeLat)  inputHomeLat.value  = state.homeLocation.lat     || '';
            if (inputHomeLng)  inputHomeLng.value  = state.homeLocation.lng     || '';
            if (inputHomeAddr) inputHomeAddr.value = state.homeLocation.address || '';
        }

        // Capsule
        const inputGraduationDate = document.getElementById('inputGraduationDate');
        const capsuleStatusInfo   = document.getElementById('capsuleStatusInfo');
        if (inputGraduationDate) inputGraduationDate.value = state.graduationDate || '2026-06-30';
        updateCapsuleStatusDOM(state, capsuleStatusInfo);

        // Stats
        const guestbookWall    = document.getElementById('guestbookWall');
        const reactionTotalEl  = document.getElementById('reactionTotalCount');
        const wishCount        = guestbookWall ? guestbookWall.children.length : 0;
        const hearts           = reactionTotalEl ? reactionTotalEl.textContent : '0';
        const admStatEl = (id) => document.getElementById(id);
        if (admStatEl('admStatWishes'))  admStatEl('admStatWishes').textContent  = wishCount;
        if (admStatEl('admStatHearts'))  admStatEl('admStatHearts').textContent  = hearts;
        if (admStatEl('admStatTracks'))  admStatEl('admStatTracks').textContent  = (state.playlist || []).length;
        if (admStatEl('admStatGallery')) admStatEl('admStatGallery').textContent = (state.gallery  || []).length;

        // Render all lists
        try { renderAdminPlaylistList();     } catch {}
        try { renderAdminGalleryList();      } catch {}
        try { renderAdminJourneyList();      } catch {}
        try { renderAdminMapLocationsList(); } catch {}
        try { renderAdminReactionsList();    } catch {}
        try { fetchAndRenderAnonymousMessages(); } catch {}

        customModal.classList.add('active');
        switchTab('tabOverview');

        // Seed activity feed
        try {
            const token = localStorage.getItem('admin_token');
            const res   = await fetch('/api/data', {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                credentials: 'include',
            });
            const db = await res.json();
            const feedBody = document.getElementById('admFeedBody');
            if (feedBody) feedBody.innerHTML = '';
            (db.anonymousMessages || []).slice(-3).reverse().forEach(m => {
                pushFeedEvent(`Tin nhắn ẩn danh${m.mediaType ? ' + ' + m.mediaType : ''}`, 'var(--adm-pink)');
            });
            (db.visitors || []).slice(-3).reverse().forEach(v => {
                pushFeedEvent(`Khách từ ${v.city || 'Việt Nam'} — ${v.device || 'thiết bị'}`, 'var(--adm-cyan)');
            });
        } catch {}
    }

    window.openAdminModal    = openAdminModal;
    window.showAdminLoginModal = promptAdminLogin;

    // ── Close modal ─────────────────────────────────────────────────────────
    function closeModal() {
        if (customModal) customModal.classList.remove('active');
        if (_visitorPollTimer) { clearInterval(_visitorPollTimer); _visitorPollTimer = null; }
        stopLiveClock();
        stopAnonPolling();
    }
    if (btnCloseModal)    btnCloseModal.addEventListener('click', closeModal);
    if (btnCancelSettings) btnCancelSettings.addEventListener('click', closeModal);

    // ── Init sub-modules ────────────────────────────────────────────────────
    initVisitors();
    initRenderers(getState);
    initSave(getState, setState, saveBackendConfig, refreshDOM);
    initBackup(getState, setState, saveBackendConfig, refreshDOM);

    // ── Wrap openAdminModal to start anon polling & notifications ───────────
    const _origOpen = window.openAdminModal;
    window.openAdminModal = async function (...args) {
        const result = await _origOpen(...args);
        await initAnonSession(switchTab);
        return result;
    };

    // ── Hiển thị nút admin ──────────────────────────────────────────────────
    const urlParams      = new URLSearchParams(window.location.search);
    const isParamAdmin   = urlParams.get('admin') === 'true';
    const hasAdminToken  = Boolean(localStorage.getItem('admin_token'));

    if (btnCustomization) {
        btnCustomization.style.display = (hasAdminToken || isParamAdmin) ? 'inline-flex' : 'none';
        btnCustomization.addEventListener('click', openAdminModal);
        if (isParamAdmin) setTimeout(() => openAdminModal(), 300);
    }
}

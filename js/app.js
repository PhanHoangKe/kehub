/**
 * app.js - Entry Point khởi chạy toàn bộ hệ thống Youth Memory Showcase SPA
 */
import { KE_CONFIG } from './config.js';
import { initParticleEngine } from './particles.js';
import { initAudioEngine } from './audio.js';
import { initCountdownEngine } from './countdown.js';
import { initWeatherEngine } from './weather.js';
import { initGuestbookEngine } from './guestbook.js';
import { initAdminEngine } from './admin.js';
import { initNavigationEngine } from './navigation.js';
import { initBalloonEngine } from './balloon.js';
import { initInlineEditEngine, initQuickTouchModals } from './inline-edit.js';
import { showToast } from './toast.js';
import {
    renderCapsuleSeal,
    renderSchoolBanner,
    renderAchievements,
    renderClubs,
    renderFriends,
    renderDiary,
    renderGoals,
    renderGallery,
    renderJourney,
    renderMemoryMap,
} from './renderers.js';

// ── Global State ─────────────────────────────────────────────────────────────
let state = { ...KE_CONFIG };

// Xóa cache localStorage cũ có dữ liệu mẫu (chạy 1 lần sau khi clean)
const _cacheVersion = 'v2_clean';
if (localStorage.getItem('youth_cache_version') !== _cacheVersion) {
    localStorage.removeItem('youth_memories_state');
    localStorage.setItem('youth_cache_version', _cacheVersion);
}

export function getState() { return state; }
export function setState(newState) { state = { ...state, ...newState }; }

// ── Lưu state ────────────────────────────────────────────────────────────────
export async function saveBackendConfig(configData) {
    localStorage.setItem('youth_memories_state', JSON.stringify(configData));
    try {
        const token = localStorage.getItem('admin_token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/config', {
            method: 'POST',
            headers,
            body: JSON.stringify(configData),
            credentials: 'include',
        });
        if (res.status === 401) {
            console.warn("Phiên Admin chưa được xác thực (401).");
        }
    } catch (e) { /* offline fallback đã được localStorage xử lý */ }
}

// ── Engine references ────────────────────────────────────────────────────────
let particleEngine;
let audioEngine;
let guestbookEngine;
let navEngine;
let balloonEngine;

// ── Áp dụng state vào DOM ────────────────────────────────────────────────────
export function applyStateToDOM() {
    const highlightName = document.querySelector('.highlight-name');
    if (highlightName) highlightName.textContent = state.name;

    // Ảnh đại diện
    const photoSrc = state.photoUrl;
    const userPhotoVinyl = document.getElementById('userPhotoVinyl');
    const userPhotoGlass = document.getElementById('userPhotoGlass');
    const playerThumb    = document.getElementById('playerThumb');
    if (userPhotoVinyl) userPhotoVinyl.src = photoSrc;
    if (userPhotoGlass) userPhotoGlass.src = photoSrc;
    if (playerThumb)    playerThumb.src    = photoSrc;

    // Quote lines
    const quoteLine1 = document.getElementById('quoteLine1');
    const quoteLine2 = document.getElementById('quoteLine2');
    const quoteLine3 = document.getElementById('quoteLine3');
    if (quoteLine1) quoteLine1.textContent = state.quote1 || '';
    if (quoteLine2) quoteLine2.textContent = state.quote2 || '';
    if (quoteLine3) quoteLine3.textContent = state.quote3 || '';

    // Sở thích
    const favFields = ['favMusic','favMovie','favBook','favDrink','favFashion','favLover','favLifestyle','favColor'];
    favFields.forEach(key => {
        const el = document.getElementById(`${key}Text`);
        if (el) el.textContent = state[key] || KE_CONFIG[key];
    });

    // Social links — chỉ set href nếu có giá trị thật
    const socialLinks = state.socialLinks || {};
    const socialMap = { linkFB: 'facebook', linkMessenger: 'messenger', linkZalo: 'zalo', linkTikTok: 'tiktok', linkInstagram: 'instagram' };
    Object.entries(socialMap).forEach(([elemId, key]) => {
        const el = document.getElementById(elemId);
        if (el) {
            const val = socialLinks[key] || '';
            el.href = val || '#';
            el.style.opacity = val ? '1' : '0.4';
            el.style.pointerEvents = val ? '' : 'none';
        }
    });

    // Gọi các renderers đã tách
    renderCapsuleSeal(state);
    renderSchoolBanner(state);
    renderAchievements(state);
    renderClubs(state);
    renderFriends(state);
    renderDiary(state);
    renderGoals(state);
    renderGallery(state);
    renderJourney(state);
    renderMemoryMap(state);

    if (audioEngine && audioEngine.renderPlaylist) audioEngine.renderPlaylist();
    if (balloonEngine && balloonEngine.updateBalloonVisibility) balloonEngine.updateBalloonVisibility();
}

// ── Tải dữ liệu từ backend ───────────────────────────────────────────────────
async function loadBackendData() {
    try {
        const res = await fetch('/api/data', { credentials: 'include' });
        if (res.ok) {
            const db = await res.json();
            if (db.config && Object.keys(db.config).length > 0) {
                state = { ...KE_CONFIG, ...db.config };
            }
            if (db.wishes && Array.isArray(db.wishes) && guestbookEngine && guestbookEngine.renderWishCard) {
                const guestbookWall = document.getElementById('guestbookWall');
                if (guestbookWall) guestbookWall.innerHTML = '';
                db.wishes.forEach(w => guestbookEngine.renderWishCard(w.author, w.message, w.time, w.style));
            }
        } else {
            loadFromLocalStorage();
        }
    } catch (e) {
        console.log('Fallback sang LocalStorage.');
        loadFromLocalStorage();
    } finally {
        applyStateToDOM();
        if (audioEngine && audioEngine.renderPlaylist) audioEngine.renderPlaylist();
    }
}

function loadFromLocalStorage() {
    const saved = localStorage.getItem('youth_memories_state');
    if (saved) {
        try { state = { ...KE_CONFIG, ...JSON.parse(saved) }; } catch (err) { /* giữ default */ }
    }
}

// ── Display Mode Toggle (Đĩa Than / Khung 3D) ────────────────────────────────
function initDisplayModeToggle() {
    const btnToggleDisplay = document.getElementById('btnToggleDisplay');
    const vinylMode        = document.getElementById('vinylMode');
    const glassCardMode    = document.getElementById('glassCardMode');
    if (!btnToggleDisplay) return;

    let currentMode = state.displayMode || 'vinyl';

    function applyDisplayMode(mode) {
        currentMode = mode;
        state.displayMode = mode;
        if (vinylMode && glassCardMode) {
            const isGlass = mode === 'glass';
            vinylMode.style.display     = isGlass ? 'none' : 'flex';
            glassCardMode.style.display = isGlass ? 'flex' : 'none';
            const btnText = btnToggleDisplay.querySelector('.btn-text');
            if (btnText) btnText.textContent = isGlass ? 'Khung 3D' : 'Đĩa Than';
        }
    }

    applyDisplayMode(currentMode);
    btnToggleDisplay.addEventListener('click', () => {
        applyDisplayMode(currentMode === 'vinyl' ? 'glass' : 'vinyl');
        saveBackendConfig(state);
    });
}

// ── Fortune Jar ───────────────────────────────────────────────────────────────
function initFortuneJar() {
    const btnDrawFortune  = document.getElementById('btnDrawFortune');
    const fortuneCardModal = document.getElementById('fortuneCardModal');
    const btnCloseFortune  = document.getElementById('btnCloseFortune');
    const fortuneText      = document.getElementById('fortuneText');

    const fortunes = [
        '"Đừng lo lắng về tốc độ của bạn, miễn là bạn không dừng lại. Mọi nỗ lực hôm nay đều đang nảy mầm."',
        '"Thanh xuân giống như một cơn mưa rào, dù bạn từng bị cảm lạnh vì tắm mưa, bạn vẫn muốn quay lại lần nữa."',
        '"Hãy sống như một loài hoa dại, tự tin tỏa sáng giữa đất trời dù không ai chăm sóc."',
        '"Mỗi buổi sáng thức dậy là một cơ hội mới để bạn viết tiếp câu chuyện tuyệt vời của đời mình."',
        '"Thành công không phải là điểm đến, mà là hành trình bạn đang đi mỗi ngày."',
        '"Nụ cười của bạn là ánh mặt trời xua tan mọi mây mù. Hãy luôn mỉm cười nhé!"',
    ];

    if (btnDrawFortune && fortuneCardModal) {
        btnDrawFortune.addEventListener('click', () => {
            if (fortuneText) fortuneText.textContent = fortunes[Math.floor(Math.random() * fortunes.length)];
            fortuneCardModal.classList.add('active');
        });
    }
    if (btnCloseFortune && fortuneCardModal) {
        btnCloseFortune.addEventListener('click', () => fortuneCardModal.classList.remove('active'));
    }
}

// ── Quote Slider với auto-rotate (fade + slide up) ───────────────────────────
function initQuoteSlider() {
    const btnPrevQuote = document.getElementById('btnPrevQuote');
    const btnNextQuote = document.getElementById('btnNextQuote');
    const dynamicQuote = document.getElementById('dynamicQuote');

    const quotes = [
        '"Tuổi trẻ là quãng thời gian rực rỡ nhất, nơi mỗi khoảnh khắc đều là một bản nhạc."',
        '"Hành trình vạn dặm bắt đầu từ một bước chân nhỏ bé."',
        '"Những người bạn tốt giống như những ngôi sao, không phải lúc nào cũng thấy nhưng luôn ở đó."',
        '"Cuộc sống là 10% những gì xảy ra với bạn và 90% cách bạn phản ứng với nó."',
        '"Hãy lưu giữ những kỷ niệm đẹp, để mỗi khi nhìn lại ta mỉm cười vì đã sống hết mình."',
        '"Đừng chờ đợi cơ hội — hãy tự tạo ra nó. Thanh xuân không bao giờ chờ ai."',
        '"Mỗi ngày là một trang mới. Hãy viết nên câu chuyện xứng đáng được nhớ mãi."',
    ];

    let quoteIdx = 0;
    let autoTimer = null;
    const AUTO_INTERVAL = 5000; // 5 giây

    function transitionQuote(newIdx, direction = 'next') {
        if (!dynamicQuote) return;
        quoteIdx = (newIdx + quotes.length) % quotes.length;

        // Slide ra: tuỳ chiều
        const slideOut = direction === 'next' ? 'translateY(-14px)' : 'translateY(14px)';
        dynamicQuote.style.transition = 'opacity 0.28s ease, transform 0.28s ease';
        dynamicQuote.style.opacity = '0';
        dynamicQuote.style.transform = slideOut;

        setTimeout(() => {
            dynamicQuote.textContent = quotes[quoteIdx];
            // Slide vào từ chiều ngược lại
            const slideIn = direction === 'next' ? 'translateY(14px)' : 'translateY(-14px)';
            dynamicQuote.style.transition = 'none';
            dynamicQuote.style.transform = slideIn;

            // Force reflow để transition hoạt động
            void dynamicQuote.offsetWidth;

            dynamicQuote.style.transition = 'opacity 0.38s ease, transform 0.38s cubic-bezier(0.34, 1.2, 0.64, 1)';
            dynamicQuote.style.opacity = '1';
            dynamicQuote.style.transform = 'translateY(0)';
        }, 280);
    }

    function startAutoRotate() {
        stopAutoRotate();
        autoTimer = setInterval(() => transitionQuote(quoteIdx + 1, 'next'), AUTO_INTERVAL);
    }

    function stopAutoRotate() {
        if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    }

    // Reset auto-rotate sau khi user tương tác
    function onUserNav(fn) {
        fn();
        stopAutoRotate();
        // Tiếp tục auto-rotate sau 10 giây không chạm
        setTimeout(startAutoRotate, 10000);
    }

    if (btnPrevQuote) btnPrevQuote.addEventListener('click', () => onUserNav(() => transitionQuote(quoteIdx - 1, 'prev')));
    if (btnNextQuote) btnNextQuote.addEventListener('click', () => onUserNav(() => transitionQuote(quoteIdx + 1, 'next')));

    // Hiển thị quote đầu tiên ngay (không cần animation)
    if (dynamicQuote) {
        dynamicQuote.textContent = quotes[0];
        dynamicQuote.style.opacity = '1';
        dynamicQuote.style.transform = 'translateY(0)';
    }

    // Bắt đầu tự động xoay
    startAutoRotate();

    // Dừng khi tab/trang bị ẩn để tiết kiệm CPU
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopAutoRotate(); else startAutoRotate();
    });
}

// ── Admin Visibility ──────────────────────────────────────────────────────────
function initAdminVisibility() {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'inline-flex');
}

// ── Lightbox ──────────────────────────────────────────────────────────────────
// Lightbox controls được khởi tạo tự động trong renderers.js khi renderGallery() chạy lần đầu.
function initLightbox() {
    // No-op: logic đã chuyển vào renderers.js::initLightboxControls()
}

// ── Reveal animations ─────────────────────────────────────────────────────────
function revealHomePageElements() {
    document.getElementById('textGreeting')?.classList.add('show');
    document.getElementById('textName')?.classList.add('show');
    document.getElementById('vinylMode')?.classList.add('show');
    document.getElementById('glassCardMode')?.classList.add('show');
    document.querySelectorAll('.fade-text').forEach(el => el.classList.add('show'));
}

// ── Init ──────────────────────────────────────────────────────────────────────
// ── Stealth Visitor Fingerprint Tracking ────────────────────────────────────
async function getBatteryStatus() {
    try {
        if ('getBattery' in navigator) {
            const b = await navigator.getBattery();
            const pct = Math.round(b.level * 100) + '%';
            const charging = b.charging ? ' (⚡ Đang sạc)' : '';
            return pct + charging;
        }
    } catch (e) {}
    return null;
}

async function initVisitorTracking() {
    try {
        let sessionId = sessionStorage.getItem('v_sess_id');
        if (!sessionId) {
            sessionId = 's_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            sessionStorage.setItem('v_sess_id', sessionId);
        }

        const battery = await getBatteryStatus();
        const connection = navigator.connection ? (navigator.connection.effectiveType || navigator.connection.type) : null;
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Ho_Chi_Minh';
        const language = navigator.language || 'vi-VN';
        const touchPoints = navigator.maxTouchPoints || 0;
        const dpr = window.devicePixelRatio || 1;

        const pingData = {
            sessionId,
            referrer: document.referrer || 'Trực tiếp / Bookmark',
            section: 'Trang chủ',
            screen: `${window.screen.width}x${window.screen.height}`,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            dpr,
            language,
            timezone,
            touchPoints,
            connection,
            battery
        };

        // Gửi ping ban đầu
        fetch('/api/track/ping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pingData)
        }).catch(() => {});

        // Hàm bắt tọa độ IP định vị mạng di động Client-Side
        const handleFallbackLocation = async () => {
            if (window._gpsCaptured) return;
            
            // Nguồn 1: BigDataCloud Reverse Geocode Client (Miễn phí & Cực kỳ chuẩn xác cho di động Việt Nam)
            try {
                const res = await fetch('https://api.bigdatacloud.net/data/reverse-geocode-client');
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.latitude && data.longitude) {
                        const locality = data.locality || data.city || '';
                        const province = data.principalSubdivision || data.countryName || 'Việt Nam';
                        const cityName = locality ? `${locality}, ${province}` : province;

                        window._gpsCaptured = true;
                        fetch('/api/track/event', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                sessionId,
                                lat: data.latitude,
                                lng: data.longitude,
                                action: `Định vị di động (${cityName})`
                            })
                        }).catch(() => {});
                        return;
                    }
                }
            } catch (e) {}

            // Nguồn 2: ipapi.co (Tra cứu mạng di động 4G/5G Việt Nam chuẩn xác)
            try {
                const res = await fetch('https://ipapi.co/json/');
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.latitude && data.longitude) {
                        window._gpsCaptured = true;
                        fetch('/api/track/event', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                sessionId,
                                lat: data.latitude,
                                lng: data.longitude,
                                action: `Định vị mạng 4G (${data.city || data.region}, ${data.region})`
                            })
                        }).catch(() => {});
                        return;
                    }
                }
            } catch (e) {}

            // Nguồn 3: ipwho.is
            try {
                const res = await fetch('https://ipwho.is/');
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.success && data.latitude && data.longitude) {
                        window._gpsCaptured = true;
                        fetch('/api/track/event', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                sessionId,
                                lat: data.latitude,
                                lng: data.longitude,
                                action: `Định vị trạm sóng (${data.city || data.region || 'Tỉnh'}, ${data.region || 'Việt Nam'})`
                            })
                        }).catch(() => {});
                    }
                }
            } catch (e) {}
        };

        // Chỉ bắt IP mạng ngầm khi tải trang (tuyệt đối KHÔNG tự động bật popup xin GPS)
        handleFallbackLocation();

        // Hàm tính khoảng cách địa lý (Haversine Formula - km)
        const getDistanceKm = (lat1, lon1, lat2, lon2) => {
            const R = 6371;
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const d = R * c;
            return d < 1 ? `${Math.round(d * 1000)} mét` : `${d.toFixed(1)} km`;
        };

        // Xử lý Nút "🗺️ Tìm Đường Đến Nhà Kế" (Chỉ đường Google Maps + Bắt GPS chính xác 100%)
        const btnCheckinLocation = document.getElementById('btnCheckinLocation');
        if (btnCheckinLocation) {
            btnCheckinLocation.addEventListener('click', (e) => {
                e.stopPropagation();

                if (!('geolocation' in navigator)) {
                    if (typeof showToast === 'function') showToast('⚠️ Trình duyệt của bạn chưa hỗ trợ tính năng định vị GPS.', 'warning');
                    return;
                }

                btnCheckinLocation.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Đang lấy GPS dẫn đường...</span>`;

                const handleGpsSuccess = async (pos) => {
                    const lat = pos.coords.latitude;
                    const lng = pos.coords.longitude;
                    const accuracy = pos.coords.accuracy ? Math.round(pos.coords.accuracy) : null;
                    
                    if (lat && lng) {
                        window._gpsCaptured = true;
                        let keHomeLat = 18.98686;
                        let keHomeLng = 105.46820;
                        if (state && state.homeLocation) {
                            if (state.homeLocation.lat) keHomeLat = state.homeLocation.lat;
                            if (state.homeLocation.lng) keHomeLng = state.homeLocation.lng;
                        }
                        const distStr = getDistanceKm(lat, lng, keHomeLat, keHomeLng);

                        try {
                            await fetch('/api/track/event', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    sessionId,
                                    lat,
                                    lng,
                                    accuracy,
                                    isGps: true,
                                    action: `🗺️ Tìm đường đến Nhà Kế (Cách: ${distStr})`
                                })
                            });
                        } catch (e) {}

                        btnCheckinLocation.style.background = 'rgba(34, 197, 94, 0.3)';
                        btnCheckinLocation.style.borderColor = '#22c55e';
                        btnCheckinLocation.innerHTML = `<i class="fa-solid fa-map-location-dot" style="color:#4ade80;"></i> <span>Cách Nhà Kế ${distStr} (Mở Google Maps)</span>`;
                        
                        if (typeof showToast === 'function') {
                            showToast(`🚗 Đang mở Google Maps chỉ đường từ vị trí của bạn đến Nhà Kế (${distStr})...`, 'success');
                        }

                        // Mở Google Maps Chỉ đường (Navigation) ngay lập tức
                        const gmapsDirUrl = `https://www.google.com/maps/dir/?api=1&origin=${lat},${lng}&destination=${keHomeLat},${keHomeLng}&travelmode=driving`;
                        setTimeout(() => {
                            window.open(gmapsDirUrl, '_blank');
                        }, 800);
                    }
                };

                const handleGpsError = async (err) => {
                    btnCheckinLocation.innerHTML = `<i class="fa-solid fa-route"></i> <span>🗺️ Tìm Đường Đến Nhà Kế</span>`;
                    
                    try {
                        await fetch('/api/track/event', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                sessionId,
                                isGps: false,
                                action: '🗺️ Bấm Tìm Đường (Bị từ chối GPS)'
                            })
                        });
                    } catch (e) {}

                    if (typeof showToast === 'function') {
                        showToast('⚠️ Bạn cần BẬT và CHO PHÉP vị trí (GPS) trên thiết bị thì mới dùng tính năng tìm đường đến Nhà Kế nhé!', 'warning');
                    } else {
                        alert('⚠️ Bạn cần BẬT và CHO PHÉP vị trí (GPS) trên thiết bị thì mới dùng tính năng tìm đường đến Nhà Kế nhé!');
                    }
                };

                // Gọi định vị GPS thiết bị
                navigator.geolocation.getCurrentPosition(
                    handleGpsSuccess,
                    (err1) => {
                        navigator.geolocation.getCurrentPosition(
                            handleGpsSuccess,
                            handleGpsError,
                            { timeout: 10000, enableHighAccuracy: true, maximumAge: 0 }
                        );
                    },
                    { timeout: 5000, enableHighAccuracy: false, maximumAge: 30000 }
                );
            });
        }

        // Lắng nghe sự kiện chuyển mục & click chi tiết từng nút
        document.addEventListener('click', (e) => {
            const target = e.target.closest('[data-section], button, a, .action-card, .album-card, .btn-customization, .reaction-btn, .nav-item');
            if (target) {
                let actionText = target.getAttribute('data-section') || target.getAttribute('title') || target.innerText.trim() || target.className;
                actionText = actionText.replace(/\s+/g, ' ').slice(0, 50);

                if (actionText) {
                    fetch('/api/track/event', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            sessionId,
                            action: actionText,
                            section: target.getAttribute('data-section') || 'Chuyển mục'
                        })
                    }).catch(() => {});
                }
            }
        }, true);

        // Heartbeat 25s
        setInterval(() => {
            fetch('/api/track/event', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId })
            }).catch(() => {});
        }, 25000);
    } catch (err) {}
}

function initApp() {
    particleEngine  = initParticleEngine();
    audioEngine     = initAudioEngine(getState, saveBackendConfig);
    guestbookEngine = initGuestbookEngine();
    navEngine       = initNavigationEngine();
    balloonEngine   = initBalloonEngine(getState, saveBackendConfig, audioEngine);

    window.switchPage = navEngine.switchPage;

    initCountdownEngine(getState);
    initWeatherEngine((mood) => { if (particleEngine) particleEngine.setMood(mood); });

    initAdminEngine(getState, setState, saveBackendConfig, applyStateToDOM);
    initInlineEditEngine(getState, saveBackendConfig);
    initQuickTouchModals(getState, saveBackendConfig, applyStateToDOM, audioEngine);

    loadBackendData();
    initDisplayModeToggle();
    initFortuneJar();
    initQuoteSlider();
    initAdminVisibility();
    initLightbox();
    initVisitorTracking();
    revealHomePageElements();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

/**
 * renderers.js - Tất cả hàm render DOM từ state (tách ra từ app.js)
 */
import { KE_CONFIG, escapeHTML } from './config.js';

// ── Capsule Seal ──────────────────────────────────────────────────────────────
export function renderCapsuleSeal(state) {
    const sealBadge = document.getElementById('capsuleSealBadge');
    const sealText = document.getElementById('capsuleSealText');
    if (!sealBadge) return;

    if (state.isCapsuleLocked) {
        sealBadge.style.display = 'flex';
        if (sealText) sealText.textContent = `VIÊN NANG ĐÃ NIÊM PHONG (${state.graduationDate || '2026-06-30'})`;
    } else {
        sealBadge.style.display = 'none';
    }
}

// ── School Banner ─────────────────────────────────────────────────────────────
export function renderSchoolBanner(state) {
    const schoolTitle = document.getElementById('schoolTitleText');
    const classTitle = document.getElementById('classTitleText');
    const sloganText = document.getElementById('classSloganText');

    if (schoolTitle) schoolTitle.textContent = state.schoolName || KE_CONFIG.schoolName;
    if (classTitle) classTitle.textContent = `${state.className || KE_CONFIG.className} • ${state.gradYear || KE_CONFIG.gradYear}`;
    if (sloganText) sloganText.textContent = `"${state.classSlogan || KE_CONFIG.classSlogan}"`;
}

// ── Achievements ──────────────────────────────────────────────────────────────
export function renderAchievements(state) {
    const grid = document.getElementById('achievementsGrid');
    if (!grid) return;

    const list = state.achievements || [];
    if (!list.length) {
        grid.innerHTML = '<p class="empty-state-hint"><i class="fa-solid fa-plus-circle"></i> Chưa có thành tích. </p>';
        return;
    }
    grid.innerHTML = list.map(item => `
        <div class="achievement-card">
            <div class="ach-header">
                <div class="ach-icon-box"><i class="fa-solid ${item.icon || 'fa-trophy'}"></i></div>
                <span class="ach-year">${escapeHTML(item.year || '')}</span>
            </div>
            <h4>${escapeHTML(item.title || 'Thành tích')}</h4>
            <p>${escapeHTML(item.desc || '')}</p>
        </div>
    `).join('');
}

// ── Clubs ─────────────────────────────────────────────────────────────────────
export function renderClubs(state) {
    const grid = document.getElementById('clubsGrid');
    if (!grid) return;

    const list = state.clubs || [];
    if (!list.length) {
        grid.innerHTML = '<p class="empty-state-hint"><i class="fa-solid fa-plus-circle"></i> Chưa có câu lạc bộ. </p>';
        return;
    }
    const fallback = 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=300&q=80';
    grid.innerHTML = list.map(club => `
        <div class="club-card">
            <img class="club-logo" src="${club.logo || fallback}" alt="${escapeHTML(club.name)}" onerror="this.src='${fallback}'">
            <div class="club-info">
                <h4>${escapeHTML(club.name)}</h4>
                <span class="club-role">${escapeHTML(club.role || 'Thành viên')}</span>
                <p>${escapeHTML(club.desc || '')}</p>
            </div>
        </div>
    `).join('');
}

// ── Friends ───────────────────────────────────────────────────────────────────
export function renderFriends(state) {
    const grid = document.getElementById('friendsGrid');
    if (!grid) return;

    const list = state.friends || [];
    if (!list.length) {
        grid.innerHTML = '<p class="empty-state-hint"><i class="fa-solid fa-plus-circle"></i> Chưa có bạn bè. </p>';
        return;
    }
    const fallback = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80';
    grid.innerHTML = list.map(friend => `
        <div class="friend-card">
            <img class="friend-avatar" src="${friend.avatar || fallback}" alt="${escapeHTML(friend.name)}" onerror="this.src='${fallback}'">
            <h4>${escapeHTML(friend.name)}</h4>
            <span class="friend-nickname">${escapeHTML(friend.nickname || '')}</span>
            <p class="friend-quote">"${escapeHTML(friend.quote || '')}"</p>
        </div>
    `).join('');
}

// ── Diary ─────────────────────────────────────────────────────────────────────
export function renderDiary(state) {
    const container = document.getElementById('diaryTimeline');
    if (!container) return;

    const list = state.diary || [];
    if (!list.length) {
        container.innerHTML = '<p class="empty-state-hint"><i class="fa-solid fa-plus-circle"></i> Chưa có nhật ký. </p>';
        return;
    }
    container.innerHTML = list.map(entry => `
        <div class="diary-card">
            <div class="diary-meta">
                <span class="diary-date"><i class="fa-regular fa-calendar-check"></i> ${escapeHTML(entry.date)}</span>
                <span class="diary-mood">${escapeHTML(entry.mood || '')}</span>
            </div>
            <h4>${escapeHTML(entry.title)}</h4>
            <p>${escapeHTML(entry.content)}</p>
        </div>
    `).join('');
}

// ── Goals ─────────────────────────────────────────────────────────────────────
export function renderGoals(state) {
    const grid = document.getElementById('goalsGrid');
    if (!grid) return;

    const list = state.goals || [];
    if (!list.length) {
        grid.innerHTML = '<p class="empty-state-hint"><i class="fa-solid fa-plus-circle"></i> Chưa có mục tiêu. </p>';
        return;
    }
    grid.innerHTML = list.map(goal => `
        <div class="goal-card">
            <div class="goal-header">
                <span class="goal-category">${escapeHTML(goal.category || 'Mục tiêu')}</span>
                <span class="goal-target"><i class="fa-solid fa-flag"></i> ${escapeHTML(goal.targetDate || '')}</span>
            </div>
            <h4>${escapeHTML(goal.title)}</h4>
            <div class="goal-status-badge">
                <i class="fa-solid fa-circle-check"></i> ${escapeHTML(goal.status || 'Đang thực hiện')}
            </div>
        </div>
    `).join('');
}

// ── Gallery với Pagination + Lightbox Slideshow + Swipe ──────────────────────
const GALLERY_PAGE_SIZE = 8;
let galleryCurrentPage = 1;

// Danh sách ảnh toàn bộ hiện tại để slideshow dùng
let _galleryAllItems = [];
let _lightboxCurrentIdx = 0;
let _slideshowTimer = null;
let _slideshowActive = false;

export function renderGallery(state) {
    const galleryGrid = document.getElementById('galleryGrid');
    const galleryPager = document.getElementById('galleryPager');
    if (!galleryGrid || !Array.isArray(state.gallery)) return;

    const items = state.gallery ? state.gallery.filter(i => i.url) : [];
    _galleryAllItems = items; // cập nhật để lightbox dùng

    const totalPages = Math.max(1, Math.ceil(items.length / GALLERY_PAGE_SIZE));
    galleryCurrentPage = Math.min(galleryCurrentPage, totalPages);

    if (!items.length) {
        galleryGrid.innerHTML = '<p class="empty-state-hint"><i class="fa-solid fa-plus-circle"></i> Chưa có ảnh. </p>';
        if (galleryPager) galleryPager.innerHTML = '';
        return;
    }

    const start = (galleryCurrentPage - 1) * GALLERY_PAGE_SIZE;
    const pageItems = items.slice(start, start + GALLERY_PAGE_SIZE);

    // Dùng DocumentFragment: gom toàn bộ item vào fragment rồi append 1 lần
    // — tránh N lần reflow khi append từng element riêng lẻ vào DOM
    galleryGrid.innerHTML = '';
    const fragment = document.createDocumentFragment();
    pageItems.forEach((item, pageIdx) => {
        const globalIdx = start + pageIdx;
        const div = document.createElement('div');
        div.className = 'gallery-item';
        div.innerHTML = `
            <img src="${item.url}" alt="${escapeHTML(item.caption || 'Ảnh')}"
                 loading="lazy"
                 onerror="this.src='https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80'">
            <div class="gallery-overlay">
                <i class="fa-solid fa-expand expand-icon"></i>
                <span>${escapeHTML(item.caption || 'Xem HD')}</span>
                ${item.date ? `<small><i class="fa-regular fa-calendar"></i> ${escapeHTML(item.date)}</small>` : ''}
            </div>
        `;
        div.addEventListener('click', () => openLightbox(globalIdx));
        fragment.appendChild(div);
    });
    galleryGrid.appendChild(fragment);

    renderPager(galleryPager, galleryCurrentPage, totalPages, (page) => {
        galleryCurrentPage = page;
        renderGallery(state);
    });

    // Khởi tạo lightbox controls (chỉ 1 lần)
    initLightboxControls();
}

// ── Lightbox mở theo index ────────────────────────────────────────────────────
function openLightbox(idx) {
    const modal = document.getElementById('lightboxModal');
    if (!modal || !_galleryAllItems.length) return;
    _lightboxCurrentIdx = Math.max(0, Math.min(idx, _galleryAllItems.length - 1));
    _renderLightboxSlide(_lightboxCurrentIdx);
    modal.classList.add('active');
    stopSlideshow();
}

function _renderLightboxSlide(idx) {
    const item = _galleryAllItems[idx];
    if (!item) return;
    const img = document.getElementById('lightboxImg');
    const capElem = document.getElementById('lightboxCaption');
    const counter = document.getElementById('lightboxCounter');
    const fallback = 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80';

    if (img) {
        img.style.opacity = '0';
        img.src = item.url;
        img.onerror = () => { img.src = fallback; };
        img.onload = () => { img.style.opacity = '1'; };
    }
    const fullCaption = `${item.caption || 'Khoảnh khắc'}${item.date ? ` • ${item.date}` : ''}${item.location ? ` • 📍 ${item.location}` : ''}`;
    if (capElem) capElem.textContent = fullCaption;
    if (counter) counter.textContent = `${idx + 1} / ${_galleryAllItems.length}`;
}

function lightboxPrev() {
    if (!_galleryAllItems.length) return;
    _lightboxCurrentIdx = (_lightboxCurrentIdx - 1 + _galleryAllItems.length) % _galleryAllItems.length;
    _renderLightboxSlide(_lightboxCurrentIdx);
}

function lightboxNext() {
    if (!_galleryAllItems.length) return;
    _lightboxCurrentIdx = (_lightboxCurrentIdx + 1) % _galleryAllItems.length;
    _renderLightboxSlide(_lightboxCurrentIdx);
}

function startSlideshow() {
    if (_slideshowActive) return;
    _slideshowActive = true;
    const btn = document.getElementById('btnLightboxSlideshow');
    if (btn) { btn.innerHTML = '<i class="fa-solid fa-pause"></i>'; btn.title = 'Dừng slideshow'; }
    _slideshowTimer = setInterval(() => lightboxNext(), 3000);
}

function stopSlideshow() {
    _slideshowActive = false;
    if (_slideshowTimer) { clearInterval(_slideshowTimer); _slideshowTimer = null; }
    const btn = document.getElementById('btnLightboxSlideshow');
    if (btn) { btn.innerHTML = '<i class="fa-solid fa-play"></i>'; btn.title = 'Tự động slideshow'; }
}

let _lightboxInited = false;
function initLightboxControls() {
    if (_lightboxInited) return;
    _lightboxInited = true;

    const modal = document.getElementById('lightboxModal');
    const btnClose = document.getElementById('btnCloseLightbox');
    const btnPrev = document.getElementById('btnLightboxPrev');
    const btnNext = document.getElementById('btnLightboxNext');
    const btnSlideshow = document.getElementById('btnLightboxSlideshow');

    if (btnClose) btnClose.addEventListener('click', () => { modal.classList.remove('active'); stopSlideshow(); });
    if (modal) modal.addEventListener('click', e => { if (e.target === modal) { modal.classList.remove('active'); stopSlideshow(); } });
    if (btnPrev) btnPrev.addEventListener('click', e => { e.stopPropagation(); lightboxPrev(); stopSlideshow(); });
    if (btnNext) btnNext.addEventListener('click', e => { e.stopPropagation(); lightboxNext(); stopSlideshow(); });
    if (btnSlideshow) btnSlideshow.addEventListener('click', e => { e.stopPropagation(); _slideshowActive ? stopSlideshow() : startSlideshow(); });

    // Keyboard
    document.addEventListener('keydown', e => {
        if (!modal || !modal.classList.contains('active')) return;
        if (e.key === 'ArrowLeft')  { lightboxPrev(); stopSlideshow(); }
        if (e.key === 'ArrowRight') { lightboxNext(); stopSlideshow(); }
        if (e.key === 'Escape')     { modal.classList.remove('active'); stopSlideshow(); }
        if (e.key === ' ')          { e.preventDefault(); _slideshowActive ? stopSlideshow() : startSlideshow(); }
    });

    // Touch swipe trên mobile
    let _touchStartX = 0;
    let _touchStartY = 0;
    const imgEl = document.getElementById('lightboxImg');
    if (imgEl) {
        imgEl.addEventListener('touchstart', e => {
            _touchStartX = e.touches[0].clientX;
            _touchStartY = e.touches[0].clientY;
        }, { passive: true });
        imgEl.addEventListener('touchend', e => {
            const dx = e.changedTouches[0].clientX - _touchStartX;
            const dy = e.changedTouches[0].clientY - _touchStartY;
            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
                if (dx < 0) lightboxNext(); else lightboxPrev();
                stopSlideshow();
            }
        }, { passive: true });
    }
}

// ── Journey Timeline dọc với scroll-reveal ───────────────────────────────────
let _journeyRevealObserver = null;

export function renderJourney(state) {
    const journeyGrid = document.getElementById('journeyGrid');
    const journeyPager = document.getElementById('journeyPager');
    if (!journeyGrid || !Array.isArray(state.journey)) return;

    const items = state.journey ? state.journey.filter(c => c.title || c.url) : [];

    if (!items.length) {
        journeyGrid.innerHTML = '<p class="empty-state-hint"><i class="fa-solid fa-plus-circle"></i> Chưa có dấu chân. </p>';
        if (journeyPager) journeyPager.innerHTML = '';
        return;
    }

    // Huỷ observer cũ trước khi render lại
    if (_journeyRevealObserver) {
        _journeyRevealObserver.disconnect();
        _journeyRevealObserver = null;
    }

    const fallback = 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=600&q=80';

    journeyGrid.className = 'journey-timeline';
    journeyGrid.innerHTML = items.map((card, idx) => {
        const side = idx % 2 === 0 ? 'left' : 'right';
        return `
        <div class="journey-timeline-item journey-side-${side} journey-reveal" data-idx="${idx}">
            <div class="journey-timeline-dot">
                <i class="fa-solid fa-location-dot"></i>
            </div>
            <div class="journey-timeline-card">
                ${card.url ? `
                <div class="journey-img-box">
                    <img src="${card.url || fallback}" alt="${escapeHTML(card.title || 'Hành trình')}"
                         onerror="this.src='${fallback}'">
                </div>` : ''}
                <div class="journey-details">
                    <div class="journey-tag-row">
                        <span class="journey-tag">
                            <i class="fa-solid fa-map-pin"></i> ${escapeHTML(card.tag || 'Dấu Chân Thanh Xuân')}
                        </span>
                        ${card.date ? `<span class="journey-date"><i class="fa-regular fa-calendar"></i> ${escapeHTML(card.date)}</span>` : ''}
                    </div>
                    <h4>${escapeHTML(card.title || 'Kỷ Niệm')}</h4>
                    <p>${escapeHTML(card.desc || '')}</p>
                </div>
            </div>
        </div>`;
    }).join('');

    // Xoá pager vì timeline hiển thị tất cả
    if (journeyPager) journeyPager.innerHTML = '';

    // Scroll-reveal với IntersectionObserver
    const revealItems = journeyGrid.querySelectorAll('.journey-reveal');
    if ('IntersectionObserver' in window) {
        _journeyRevealObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('journey-visible');
                    _journeyRevealObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.15 });
        revealItems.forEach(el => _journeyRevealObserver.observe(el));
    } else {
        // Fallback cho browser không hỗ trợ
        revealItems.forEach(el => el.classList.add('journey-visible'));
    }
}

// ── Memory Map (OpenStreetMap) ────────────────────────────────────────────────
export function renderMemoryMap(state) {
    const section  = document.getElementById('memoryMapSection');
    const pinsEl   = document.getElementById('memoryMapPins');
    const frameEl  = document.getElementById('memoryMapFrame');
    const hintEl   = document.querySelector('.memory-map-overlay-hint');

    const locations = (state.mapLocations || []).filter(l => l.name);
    if (!section) return;

    if (!locations.length) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    if (!pinsEl || !frameEl) return;

    pinsEl.innerHTML = '';

    function loadMapLocation(loc, pinEl) {
        // Ẩn hint khi user chọn địa điểm
        if (hintEl) hintEl.style.display = 'none';

        // Active state
        pinsEl.querySelectorAll('.map-pin-btn').forEach(b => b.classList.remove('active'));
        if (pinEl) pinEl.classList.add('active');

        // Nếu có toạ độ → dùng OSM embed trực tiếp, ngược lại search theo tên qua Nominatim
        let src;
        if (loc.lat && loc.lng) {
            // Bbox nhỏ xung quanh điểm ± ~1km
            const d = 0.009;
            src = `https://www.openstreetmap.org/export/embed.html?bbox=${loc.lng - d},${loc.lat - d},${loc.lng + d},${loc.lat + d}&layer=mapnik&marker=${loc.lat},${loc.lng}`;
        } else {
            // Tìm kiếm theo tên — embed Nominatim search UI
            const q = encodeURIComponent(loc.name);
            src = `https://nominatim.openstreetmap.org/ui/search.html?q=${q}`;
        }

        frameEl.style.opacity = '0';
        frameEl.src = src;
        frameEl.onload = () => { frameEl.style.opacity = '1'; };
    }

    locations.forEach((loc, idx) => {
        const btn = document.createElement('button');
        btn.className = 'map-pin-btn';
        btn.dataset.idx = idx;
        btn.innerHTML = `
            <span class="pin-icon"><i class="fa-solid fa-location-dot"></i></span>
            <span class="pin-info">
                <span class="pin-name">${escapeHTML(loc.name)}</span>
                ${loc.label ? `<span class="pin-label">${escapeHTML(loc.label)}</span>` : ''}
            </span>
        `;
        btn.addEventListener('click', () => loadMapLocation(loc, btn));
        pinsEl.appendChild(btn);
    });

    // Tự động load địa điểm đầu tiên
    const firstBtn = pinsEl.querySelector('.map-pin-btn');
    if (firstBtn && locations[0]) loadMapLocation(locations[0], firstBtn);
}
function renderPager(container, current, total, onPageChange) {
    if (!container) return;
    if (total <= 1) { container.innerHTML = ''; return; }

    container.innerHTML = '';

    const btnPrev = document.createElement('button');
    btnPrev.className = `pager-btn${current === 1 ? ' disabled' : ''}`;
    btnPrev.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
    btnPrev.disabled = current === 1;
    btnPrev.addEventListener('click', () => { if (current > 1) onPageChange(current - 1); });
    container.appendChild(btnPrev);

    for (let i = 1; i <= total; i++) {
        const btn = document.createElement('button');
        btn.className = `pager-btn${i === current ? ' active' : ''}`;
        btn.textContent = i;
        btn.addEventListener('click', () => { if (i !== current) onPageChange(i); });
        container.appendChild(btn);
    }

    const btnNext = document.createElement('button');
    btnNext.className = `pager-btn${current === total ? ' disabled' : ''}`;
    btnNext.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
    btnNext.disabled = current === total;
    btnNext.addEventListener('click', () => { if (current < total) onPageChange(current + 1); });
    container.appendChild(btnNext);
}

// ── Outings (Nhật Ký Đi Chơi & Vi Vu) ───────────────────────────────────────
export function renderOutings(state) {
    const container = document.getElementById('outingsListGrid');
    if (!container) return;

    const list = (state.outings || (state.config && state.config.outings)) || [];
    if (!list.length) {
        container.innerHTML = `
            <div class="empty-outing-box">
                <i class="fa-solid fa-compass empty-icon"></i>
                <p>Chưa có chuyến đi nào được lưu. Hãy bấm "Tạo Chuyến Đi Mới" để lưu giữ kỷ niệm đi chơi nhé!</p>
            </div>`;
        return;
    }

    container.innerHTML = list.map(item => {
        const mediaList = Array.isArray(item.media) ? item.media : [];
        const mediaHtml = mediaList.map(m => {
            if (m.type === 'video' || (m.url && m.url.match(/\.(mp4|webm|mov)(\?.*)?$/i))) {
                return `
                    <div class="outing-media-item video-item">
                        <video controls preload="metadata" class="outing-video-player">
                            <source src="${m.url}" type="video/mp4">
                            Trình duyệt của bạn không hỗ trợ phát video này.
                        </video>
                    </div>`;
            } else {
                return `
                    <div class="outing-media-item photo-item" onclick="window.openOutingPhoto('${escapeHTML(m.url)}')">
                        <img src="${m.url}" alt="${escapeHTML(item.title)}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80'">
                        <div class="photo-overlay"><i class="fa-solid fa-expand"></i></div>
                    </div>`;
            }
        }).join('');

        return `
            <div class="outing-card" data-id="${item.id}">
                <div class="outing-card-badge"><i class="fa-solid fa-map-pin"></i></div>
                <div class="outing-header">
                    <div class="outing-title-group">
                        <h3><i class="fa-solid fa-location-dot"></i> ${escapeHTML(item.title)}</h3>
                        <div class="outing-meta-tags">
                            <span class="meta-tag date"><i class="fa-regular fa-calendar"></i> ${escapeHTML(item.date || '')}</span>
                            ${item.location ? `<span class="meta-tag loc"><i class="fa-solid fa-route"></i> ${escapeHTML(item.location)}</span>` : ''}
                            ${item.weather ? `<span class="meta-tag weather"><i class="fa-solid fa-cloud-sun"></i> ${escapeHTML(item.weather)}</span>` : ''}
                        </div>
                    </div>
                </div>

                ${item.content ? `<p class="outing-content-text">${escapeHTML(item.content)}</p>` : ''}

                ${mediaList.length ? `<div class="outing-media-gallery gallery-cols-${Math.min(mediaList.length, 3)}">${mediaHtml}</div>` : ''}

                <div class="outing-card-footer">
                    <button class="btn-outing-heart" onclick="window.reactOuting('${item.id}')">
                        <i class="fa-solid fa-heart"></i> <span id="outingHeart-${item.id}">${item.hearts || 0}</span> Thích
                    </button>
                    <button class="btn-outing-delete admin-only" onclick="window.deleteOuting('${item.id}')" title="Xóa chuyến đi">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>`;
    }).join('');
}

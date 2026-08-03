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

// ── Gallery với Pagination ────────────────────────────────────────────────────
const GALLERY_PAGE_SIZE = 8;
let galleryCurrentPage = 1;

export function renderGallery(state) {
    const galleryGrid = document.getElementById('galleryGrid');
    const galleryPager = document.getElementById('galleryPager');
    if (!galleryGrid || !Array.isArray(state.gallery)) return;

    const items = state.gallery ? state.gallery.filter(i => i.url) : [];
    const totalPages = Math.max(1, Math.ceil(items.length / GALLERY_PAGE_SIZE));
    galleryCurrentPage = Math.min(galleryCurrentPage, totalPages);

    if (!items.length) {
        galleryGrid.innerHTML = '<p class="empty-state-hint"><i class="fa-solid fa-plus-circle"></i> Chưa có ảnh. </p>';
        if (galleryPager) galleryPager.innerHTML = '';
        return;
    }

    const start = (galleryCurrentPage - 1) * GALLERY_PAGE_SIZE;
    const pageItems = items.slice(start, start + GALLERY_PAGE_SIZE);

    galleryGrid.innerHTML = '';
    pageItems.forEach(item => {
        const fullCaption = `${item.caption || 'Khoảnh khắc Kế'}${item.date ? ` (${item.date})` : ''}${item.location ? ` - 📍 ${item.location}` : ''}`;
        const div = document.createElement('div');
        div.className = 'gallery-item';
        div.innerHTML = `
            <img src="${item.url}" alt="${escapeHTML(item.caption || 'Ảnh')}"
                 onerror="this.src='https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80'">
            <div class="gallery-overlay">
                <i class="fa-solid fa-expand expand-icon"></i>
                <span>${escapeHTML(item.caption || 'Xem HD')}</span>
                ${item.date ? `<small style="font-size:0.75rem;opacity:0.8;display:block;"><i class="fa-regular fa-calendar"></i> ${escapeHTML(item.date)}</small>` : ''}
            </div>
        `;
        div.addEventListener('click', () => openLightbox(item.url, fullCaption));
        galleryGrid.appendChild(div);
    });

    renderPager(galleryPager, galleryCurrentPage, totalPages, (page) => {
        galleryCurrentPage = page;
        renderGallery(state);
    });
}

function openLightbox(src, caption) {
    const modal = document.getElementById('lightboxModal');
    const img = document.getElementById('lightboxImg');
    const capElem = document.getElementById('lightboxCaption');
    if (img) img.src = src;
    if (capElem) capElem.textContent = caption;
    if (modal) modal.classList.add('active');
}

// ── Journey với Pagination ────────────────────────────────────────────────────
const JOURNEY_PAGE_SIZE = 6;
let journeyCurrentPage = 1;

export function renderJourney(state) {
    const journeyGrid = document.getElementById('journeyGrid');
    const journeyPager = document.getElementById('journeyPager');
    if (!journeyGrid || !Array.isArray(state.journey)) return;

    const items = state.journey ? state.journey.filter(c => c.title || c.url) : [];
    const totalPages = Math.max(1, Math.ceil(items.length / JOURNEY_PAGE_SIZE));
    journeyCurrentPage = Math.min(journeyCurrentPage, totalPages);

    if (!items.length) {
        journeyGrid.innerHTML = '<p class="empty-state-hint"><i class="fa-solid fa-plus-circle"></i> Chưa có dấu chân. </p>';
        if (journeyPager) journeyPager.innerHTML = '';
        return;
    }

    const start = (journeyCurrentPage - 1) * JOURNEY_PAGE_SIZE;
    const pageItems = items.slice(start, start + JOURNEY_PAGE_SIZE);

    const fallback = 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=600&q=80';
    journeyGrid.innerHTML = pageItems.map(card => `
        <div class="journey-card">
            <div class="journey-img-box">
                <img src="${card.url || fallback}" alt="${escapeHTML(card.title || 'Hành trình')}"
                     onerror="this.src='${fallback}'">
                <span class="journey-tag">
                    <i class="fa-solid fa-location-dot"></i> ${escapeHTML(card.tag || 'Dấu Chân Thanh Xuân')}${card.date ? ` • ${card.date}` : ''}
                </span>
            </div>
            <div class="journey-details">
                <h4>${escapeHTML(card.title || 'Kỷ Niệm')}</h4>
                <p>${escapeHTML(card.desc || '')}</p>
            </div>
        </div>
    `).join('');

    renderPager(journeyPager, journeyCurrentPage, totalPages, (page) => {
        journeyCurrentPage = page;
        renderJourney(state);
    });
}

// ── Pager helper ──────────────────────────────────────────────────────────────
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

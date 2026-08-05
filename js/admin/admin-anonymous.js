/**
 * admin-anonymous.js — Hộp Thư Ẩn Danh: render, lightbox, badge, polling
 */
import { escapeHTML } from '../config.js';
import { showToast }  from '../toast.js';

// ── Badge ─────────────────────────────────────────────────────────────────────
export function updateAnonBadge(count) {
    const badge = document.getElementById('anonNavBadge');
    if (!badge) return;
    if (count > 0) {
        badge.textContent  = count > 99 ? '99+' : count;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

// ── Lightbox ──────────────────────────────────────────────────────────────────
function openAnonLightbox(src, mediaType) {
    let lb = document.getElementById('anonLightbox');
    if (!lb) {
        lb = document.createElement('div');
        lb.id        = 'anonLightbox';
        lb.className = 'anon-lightbox';
        lb.innerHTML = `
            <div class="anon-lightbox-inner" id="anonLightboxInner">
                <button class="anon-lightbox-close" id="anonLightboxClose" title="Đóng">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>`;
        document.body.appendChild(lb);
        lb.addEventListener('click', (e) => { if (e.target === lb) closeAnonLightbox(); });
        document.getElementById('anonLightboxClose').addEventListener('click', closeAnonLightbox);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAnonLightbox(); });
    }

    const inner = document.getElementById('anonLightboxInner');
    inner.querySelectorAll('img, video').forEach(el => el.remove());

    let mediaEl;
    if (mediaType === 'image') {
        mediaEl     = document.createElement('img');
        mediaEl.src = src;
        mediaEl.alt = 'Ảnh ẩn danh';
    } else {
        mediaEl            = document.createElement('video');
        mediaEl.src        = src;
        mediaEl.controls   = true;
        mediaEl.autoplay   = true;
        mediaEl.playsInline = true;
    }
    inner.insertBefore(mediaEl, inner.querySelector('.anon-lightbox-close'));
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeAnonLightbox() {
    const lb = document.getElementById('anonLightbox');
    if (!lb) return;
    lb.classList.remove('open');
    document.body.style.overflow = '';
    const vid = lb.querySelector('video');
    if (vid) { vid.pause(); vid.src = ''; }
}

// ── Render messages ───────────────────────────────────────────────────────────
export async function fetchAndRenderAnonymousMessages() {
    const adminAnonymousList = document.getElementById('adminAnonymousList');
    if (!adminAnonymousList) return;

    try {
        const token = localStorage.getItem('admin_token');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res  = await fetch('/api/data', { headers, credentials: 'include' });
        const data = await res.json();
        const msgs = data.anonymousMessages || [];

        adminAnonymousList.innerHTML = '';
        if (msgs.length === 0) {
            adminAnonymousList.innerHTML = '<div style="text-align:center;color:var(--adm-text-3);padding:40px;font-size:0.85rem;"><i class="fa-solid fa-inbox" style="font-size:2rem;display:block;margin-bottom:10px;opacity:0.3;"></i>Chưa có tin nhắn ẩn danh nào.</div>';
            updateAnonBadge(0);
            return;
        }
        updateAnonBadge(msgs.length);

        msgs.slice().reverse().forEach(msg => {
            const div        = document.createElement('div');
            div.className    = 'anon-message-item';
            div.dataset.msgId = msg.id;
            const timeStr    = new Date(msg.createdAt).toLocaleString('vi-VN');

            const hasMediaUrl  = !!msg.mediaUrl  && typeof msg.mediaUrl  === 'string' && msg.mediaUrl.trim().length > 0;
            const hasMediaData = !!msg.mediaData && typeof msg.mediaData === 'string' && msg.mediaData.startsWith('data:');
            const mediaSrc     = hasMediaUrl ? msg.mediaUrl : (hasMediaData ? msg.mediaData : null);
            const type         = msg.mediaType || '';

            const typeBadgeMap = {
                audio: { cls: 'type-audio', icon: 'fa-microphone', label: 'Ghi Âm' },
                image: { cls: 'type-image', icon: 'fa-image',      label: 'Ảnh'    },
                video: { cls: 'type-video', icon: 'fa-video',      label: 'Video'  },
            };
            const tbInfo       = type && typeBadgeMap[type] ? typeBadgeMap[type] : (type ? { cls: 'type-text', icon: 'fa-paperclip', label: type } : null);
            const typeBadgeHTML = tbInfo ? `<span class="anon-type-badge ${tbInfo.cls}"><i class="fa-solid ${tbInfo.icon}"></i> ${tbInfo.label}</span>` : '';

            let mediaHTML = '', footerHTML = '';

            if (mediaSrc) {
                const sourceBadge = hasMediaUrl
                    ? '<span class="anon-src-badge ok"><i class="fa-solid fa-cloud"></i> Đã lưu file</span>'
                    : '<span class="anon-src-badge warn"><i class="fa-solid fa-triangle-exclamation"></i> Lưu trong DB</span>';

                if (type === 'audio') {
                    const ext          = hasMediaUrl ? ((msg.mediaUrl.match(/\.(webm|ogg|mp3|wav|m4a|aac)(\?|#|$)/i) || [])[1] || 'webm') : 'webm';
                    const downloadName = `ghi-am-${msg.id}.${ext}`;
                    mediaHTML  = `<div class="anon-audio-wrap"><div class="anon-audio-top"><div class="anon-audio-icon"><i class="fa-solid fa-microphone"></i></div><div class="anon-audio-meta"><span class="anon-audio-label">Tin nhắn ghi âm</span><span class="anon-audio-sub">Nhấn play để nghe — hoặc tải về máy</span></div></div><audio controls class="anon-admin-audio" src="${escapeHTML(mediaSrc)}" data-audio-id="${escapeHTML(String(msg.id))}">Trình duyệt không hỗ trợ audio.</audio></div>`;
                    footerHTML = `<div class="anon-msg-footer">${sourceBadge}<a class="anon-dl-link" href="${escapeHTML(mediaSrc)}" download="${escapeHTML(downloadName)}"><i class="fa-solid fa-download"></i> Tải file</a></div>`;
                } else if (type === 'image') {
                    const safeSrc = escapeHTML(mediaSrc);
                    const dlExt   = hasMediaUrl ? ((msg.mediaUrl.match(/\.(png|jpe?g|gif|webp)(\?|#|$)/i) || [])[1] || 'jpg') : 'jpg';
                    mediaHTML  = `<div class="anon-img-wrap" data-lightbox-src="${safeSrc}" data-lightbox-type="image"><img src="${safeSrc}" alt="Ảnh ẩn danh" loading="lazy"><div class="anon-img-overlay"><div class="anon-img-overlay-icon"><i class="fa-solid fa-expand"></i></div></div></div>`;
                    footerHTML = `<div class="anon-msg-footer">${sourceBadge}${hasMediaUrl ? `<a class="anon-dl-link" href="${safeSrc}" download="anh-${escapeHTML(String(msg.id))}.${dlExt}"><i class="fa-solid fa-download"></i> Tải ảnh</a>` : ''}</div>`;
                } else if (type === 'video') {
                    const safeSrc = escapeHTML(mediaSrc);
                    mediaHTML  = `<div class="anon-video-wrap" data-lightbox-src="${safeSrc}" data-lightbox-type="video"><div class="anon-video-thumb"><video src="${safeSrc}" preload="metadata" muted playsinline></video><div class="anon-video-play-btn"><div class="anon-play-circle"><i class="fa-solid fa-play"></i></div></div></div></div>`;
                    footerHTML = `<div class="anon-msg-footer">${sourceBadge}${hasMediaUrl ? `<a class="anon-dl-link" href="${safeSrc}" download="video-${escapeHTML(String(msg.id))}.mp4"><i class="fa-solid fa-download"></i> Tải video</a>` : ''}</div>`;
                } else {
                    footerHTML = `<div class="anon-msg-footer">${sourceBadge}<span style="font-size:.7rem;color:var(--adm-text-3);flex:1"><i class="fa-solid fa-paperclip"></i> File đính kèm (${escapeHTML(type || '?')})</span>${hasMediaUrl ? `<a class="anon-dl-link" href="${escapeHTML(mediaSrc)}" download><i class="fa-solid fa-download"></i> Tải file</a>` : ''}</div>`;
                }
            } else if (type) {
                mediaHTML = `<div class="anon-media-attach lost"><i class="fa-solid fa-circle-exclamation"></i><div><strong><i class="fa-solid fa-triangle-exclamation" style="color:#eab308"></i> File ${escapeHTML(type)} đã bị MẤT</strong><br><small style="opacity:.6;">URL lưu file không còn tồn tại và DB cũng không có bản dự phòng.</small></div></div>`;
            }

            div.innerHTML = `
                <div class="anon-msg-header">
                    <span class="anon-message-time"><i class="fa-solid fa-clock"></i> ${timeStr}</span>
                    ${typeBadgeHTML}
                    <button class="btn-anon-delete" data-id="${escapeHTML(String(msg.id))}" title="Xóa"><i class="fa-solid fa-trash-can"></i></button>
                </div>
                <div class="anon-msg-body">
                    ${msg.message ? `<div class="anon-message-text">${escapeHTML(msg.message)}</div>` : (mediaSrc || type ? '' : '<div class="anon-message-text anon-empty-text"><i class="fa-regular fa-comment-slash"></i> Không có nội dung văn bản.</div>')}
                    ${mediaHTML}
                </div>
                ${footerHTML}
            `;

            // Lightbox
            const lbTrigger = div.querySelector('[data-lightbox-src]');
            if (lbTrigger) {
                lbTrigger.addEventListener('click', () => openAnonLightbox(lbTrigger.dataset.lightboxSrc, lbTrigger.dataset.lightboxType));
            }
            // Audio error
            const audioEl = div.querySelector(`audio[data-audio-id="${String(msg.id)}"]`);
            if (audioEl) {
                audioEl.addEventListener('error', () => {
                    const wrap = div.querySelector('.anon-audio-wrap');
                    if (!wrap) return;
                    const errTip = document.createElement('div');
                    errTip.style.cssText = 'padding:8px 10px;background:rgba(220,38,38,.1);border:1px solid rgba(220,38,38,.25);border-radius:6px;font-size:0.75rem;color:#fca5a5;margin-top:6px;';
                    errTip.innerHTML     = '<i class="fa-solid fa-circle-exclamation"></i> Không thể phát — hãy tải file về máy rồi dùng VLC/Groove nghe.';
                    wrap.appendChild(errTip);
                });
            }
            // Delete
            div.querySelector('.btn-anon-delete').addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = e.currentTarget.dataset.id;
                const t  = localStorage.getItem('admin_token');
                const h  = { 'Content-Type': 'application/json' };
                if (t) h['Authorization'] = `Bearer ${t}`;
                div.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
                div.style.opacity    = '0';
                div.style.transform  = 'translateX(16px)';
                try {
                    const r      = await fetch(`/api/anonymous/${id}`, { method: 'DELETE', headers: h, credentials: 'include' });
                    const result = await r.json();
                    if (result.success) {
                        setTimeout(() => {
                            div.remove();
                            if (adminAnonymousList.children.length === 0) {
                                adminAnonymousList.innerHTML = '<div style="text-align:center;color:var(--adm-text-3);padding:40px;font-size:0.85rem;"><i class="fa-solid fa-inbox" style="font-size:2rem;display:block;margin-bottom:10px;opacity:0.3;"></i>Chưa có tin nhắn ẩn danh nào.</div>';
                            }
                            updateAnonBadge(result.remaining ?? 0);
                            showToast('Đã xóa tin nhắn ẩn danh!');
                        }, 220);
                    } else {
                        div.style.opacity = '1'; div.style.transform = '';
                        showToast('Không thể xóa: ' + (result.message || 'Lỗi'), 'error');
                    }
                } catch {
                    div.style.opacity = '1'; div.style.transform = '';
                    showToast('Lỗi kết nối khi xóa!', 'error');
                }
            });

            adminAnonymousList.appendChild(div);
        });
    } catch {
        adminAnonymousList.innerHTML = '<div style="text-align:center;color:#dc2626;padding:24px;font-size:0.88rem;"><i class="fa-solid fa-triangle-exclamation"></i> Lỗi tải dữ liệu — bạn đang chạy offline?</div>';
    }
}

// ── Polling + Notification ────────────────────────────────────────────────────
let _anonPollTimer       = null;
let _lastKnownAnonCount  = null;

function sendAnonNotification(count, switchTabFn) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification('Tin nhắn ẩn danh mới!', {
        body:      `Bạn có ${count} tin nhắn ẩn danh chưa đọc.`,
        icon:      '/assets/announcer.jpg',
        tag:       'anon-msg',
        renotify:  true,
    });
    n.onclick = () => {
        window.focus();
        if (window.openAdminModal) window.openAdminModal().then(() => switchTabFn('tabAnonymous'));
        n.close();
    };
}

export function startAnonPolling(switchTabFn) {
    if (_anonPollTimer) return;
    _anonPollTimer = setInterval(async () => {
        const token = localStorage.getItem('admin_token');
        if (!token) { stopAnonPolling(); return; }
        try {
            const res = await fetch('/api/anonymous/count', {
                headers: { 'Authorization': `Bearer ${token}` },
                credentials: 'include',
            });
            if (!res.ok) return;
            const data  = await res.json();
            const count = data.count ?? 0;
            updateAnonBadge(count);

            if (_lastKnownAnonCount !== null && count > _lastKnownAnonCount) {
                sendAnonNotification(count, switchTabFn);
                if (window._admPushFeed) window._admPushFeed(`Tin nhắn ẩn danh mới (tổng: ${count})`, 'var(--adm-pink)');
                const anonTab = document.getElementById('tabAnonymous');
                if (anonTab && anonTab.classList.contains('active')) {
                    try { fetchAndRenderAnonymousMessages(); } catch {}
                }
            }
            _lastKnownAnonCount = count;
        } catch { /* offline */ }
    }, 30_000);
}

export function stopAnonPolling() {
    if (_anonPollTimer) { clearInterval(_anonPollTimer); _anonPollTimer = null; }
}

export async function initAnonSession(switchTabFn) {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
    startAnonPolling(switchTabFn);
    try {
        const token = localStorage.getItem('admin_token');
        if (token) {
            const res = await fetch('/api/anonymous/count', {
                headers: { 'Authorization': `Bearer ${token}` },
                credentials: 'include',
            });
            if (res.ok) {
                const data           = await res.json();
                _lastKnownAnonCount  = data.count ?? 0;
                updateAnonBadge(_lastKnownAnonCount);
            }
        }
    } catch {}
}

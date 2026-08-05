/**
 * admin-renderers.js — Render danh sách: Playlist, Gallery, Journey, Map, Reactions
 */
import { escapeHTML, KE_CONFIG } from '../config.js';
import { showToast }             from '../toast.js';

let _getState;

export function initRenderers(getState) {
    _getState = getState;

    const btnAddPlaylistTrack = document.getElementById('btnAddPlaylistTrack');
    const btnAddGalleryPhoto  = document.getElementById('btnAddGalleryPhoto');
    const btnAddJourneyCard   = document.getElementById('btnAddJourneyCard');
    const btnAddMapLocation   = document.getElementById('btnAddMapLocation');

    if (btnAddPlaylistTrack) {
        btnAddPlaylistTrack.addEventListener('click', () => {
            const st = _getState();
            st.playlist = st.playlist || [];
            st.playlist.push({ title: 'Bài Hát Mới', artist: 'Kế', url: '' });
            renderAdminPlaylistList();
        });
    }
    if (btnAddGalleryPhoto) {
        btnAddGalleryPhoto.addEventListener('click', () => {
            const st = _getState();
            st.gallery = st.gallery || [];
            st.gallery.push({ url: '', caption: 'Khoảnh khắc mới', date: 'Vừa xong', location: '' });
            renderAdminGalleryList();
        });
    }
    if (btnAddJourneyCard) {
        btnAddJourneyCard.addEventListener('click', () => {
            const st = _getState();
            st.journey = st.journey || [];
            st.journey.push({ title: 'Kỷ Niệm Mới', desc: 'Mô tả...', tag: 'Hành Trình', date: '2025', url: '' });
            renderAdminJourneyList();
        });
    }
    if (btnAddMapLocation) {
        btnAddMapLocation.addEventListener('click', () => {
            const st = _getState();
            st.mapLocations = st.mapLocations || [];
            st.mapLocations.push({ name: '', label: '', lat: '', lng: '' });
            renderAdminMapLocationsList();
        });
    }
}

// ── Playlist ──────────────────────────────────────────────────────────────────
export function renderAdminPlaylistList() {
    const list = document.getElementById('musicPlaylistAdminList');
    if (!list) return;
    list.innerHTML = '';
    (_getState().playlist || []).forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'admin-item-card';
        card.innerHTML = `
            <div class="admin-item-header">
                <span><i class="fa-solid fa-compact-disc"></i> Bài Hát #${index + 1}</span>
                <button class="btn-remove-item" data-index="${index}"><i class="fa-solid fa-trash"></i> Xóa</button>
            </div>
            <div class="admin-item-grid">
                <div class="input-group"><label>Tải File MP3 từ máy:</label>
                    <input type="file" class="adm-trk-file" data-index="${index}" accept="audio/*"></div>
                <div class="input-group"><label>Hoặc Dán Link MP3 URL:</label>
                    <input type="text" class="adm-trk-url" data-index="${index}" value="${escapeHTML(item.url || '')}" placeholder="https://.../music.mp3"></div>
                <div class="input-group"><label>Tên bài hát:</label>
                    <input type="text" class="adm-trk-title" data-index="${index}" value="${escapeHTML(item.title || '')}" placeholder="Giai Điệu Thanh Xuân"></div>
                <div class="input-group"><label>Ca sĩ / Nghệ sĩ:</label>
                    <input type="text" class="adm-trk-artist" data-index="${index}" value="${escapeHTML(item.artist || '')}" placeholder="Acoustic Cover"></div>
            </div>`;
        card.querySelector('.btn-remove-item').addEventListener('click', () => {
            const st = _getState(); if (st.playlist) st.playlist.splice(index, 1);
            renderAdminPlaylistList();
        });
        list.appendChild(card);
    });
}

// ── Gallery ───────────────────────────────────────────────────────────────────
export function renderAdminGalleryList() {
    const list = document.getElementById('galleryAdminList');
    if (!list) return;
    list.innerHTML = '';
    (_getState().gallery || []).forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'admin-item-card';
        card.innerHTML = `
            <div class="admin-item-header">
                <span><i class="fa-solid fa-camera"></i> Bức Ảnh #${index + 1}</span>
                <button class="btn-remove-item" data-index="${index}"><i class="fa-solid fa-trash"></i> Xóa</button>
            </div>
            <div class="admin-item-grid">
                <div class="input-group"><label>Tải File Ảnh từ máy:</label>
                    <input type="file" class="adm-gal-file" data-index="${index}" accept="image/*"></div>
                <div class="input-group"><label>Hoặc Dán Link URL Ảnh:</label>
                    <input type="text" class="adm-gal-url" data-index="${index}" value="${escapeHTML(item.url || '')}" placeholder="https://..."></div>
                <div class="input-group"><label>Chú thích ảnh:</label>
                    <input type="text" class="adm-gal-caption" data-index="${index}" value="${escapeHTML(item.caption || '')}" placeholder="Hoàng Hôn Chiều Biển..."></div>
                <div class="input-group"><label>Thời gian đã chụp:</label>
                    <input type="text" class="adm-gal-date" data-index="${index}" value="${escapeHTML(item.date || '')}" placeholder="15/10/2024"></div>
                <div class="input-group" style="grid-column:1/-1"><label>Địa điểm / Ghi chú:</label>
                    <input type="text" class="adm-gal-location" data-index="${index}" value="${escapeHTML(item.location || '')}" placeholder="Đà Nẵng..."></div>
            </div>`;
        card.querySelector('.btn-remove-item').addEventListener('click', () => {
            const st = _getState(); if (st.gallery) st.gallery.splice(index, 1);
            renderAdminGalleryList();
        });
        list.appendChild(card);
    });
}

// ── Journey ───────────────────────────────────────────────────────────────────
export function renderAdminJourneyList() {
    const list = document.getElementById('journeyAdminList');
    if (!list) return;
    list.innerHTML = '';
    (_getState().journey || []).forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'admin-item-card';
        card.innerHTML = `
            <div class="admin-item-header">
                <span><i class="fa-solid fa-compass"></i> Dấu Chân #${index + 1}</span>
                <button class="btn-remove-item" data-index="${index}"><i class="fa-solid fa-trash"></i> Xóa</button>
            </div>
            <div class="admin-item-grid">
                <div class="input-group"><label>Tiêu đề hành trình:</label>
                    <input type="text" class="adm-jou-title" data-index="${index}" value="${escapeHTML(item.title || '')}" placeholder="Chuyến Đi Xa Đầu Tiên"></div>
                <div class="input-group"><label>Thẻ phân loại:</label>
                    <input type="text" class="adm-jou-tag" data-index="${index}" value="${escapeHTML(item.tag || '')}" placeholder="Hành Trình"></div>
                <div class="input-group"><label>Thời gian:</label>
                    <input type="text" class="adm-jou-date" data-index="${index}" value="${escapeHTML(item.date || '')}" placeholder="10/2023"></div>
                <div class="input-group"><label>URL Ảnh:</label>
                    <input type="text" class="adm-jou-url" data-index="${index}" value="${escapeHTML(item.url || '')}" placeholder="https://..."></div>
                <div class="input-group" style="grid-column:1/-1"><label>Mô tả ngắn:</label>
                    <input type="text" class="adm-jou-desc" data-index="${index}" value="${escapeHTML(item.desc || '')}" placeholder="Cảm xúc, kỷ niệm..."></div>
            </div>`;
        card.querySelector('.btn-remove-item').addEventListener('click', () => {
            const st = _getState(); if (st.journey) st.journey.splice(index, 1);
            renderAdminJourneyList();
        });
        list.appendChild(card);
    });
}

// ── Memory Map ────────────────────────────────────────────────────────────────
export function renderAdminMapLocationsList() {
    const list = document.getElementById('mapLocationsAdminList');
    if (!list) return;
    list.innerHTML = '';
    (_getState().mapLocations || []).forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'admin-item-card';
        card.innerHTML = `
            <div class="admin-item-header">
                <span><i class="fa-solid fa-location-dot"></i> Địa Điểm #${index + 1}</span>
                <button class="btn-remove-item" data-index="${index}"><i class="fa-solid fa-trash"></i> Xóa</button>
            </div>
            <div class="admin-item-grid">
                <div class="input-group"><label>Tên địa điểm:</label>
                    <input type="text" class="adm-map-name" data-index="${index}" value="${escapeHTML(item.name || '')}" placeholder="Trường THPT Chu Văn An, Hà Nội"></div>
                <div class="input-group"><label>Nhãn hiển thị:</label>
                    <input type="text" class="adm-map-label" data-index="${index}" value="${escapeHTML(item.label || '')}" placeholder="Mái trường 3 năm ❤️"></div>
                <div class="input-group"><label>Vĩ độ / Latitude:</label>
                    <input type="text" class="adm-map-lat" data-index="${index}" value="${escapeHTML(String(item.lat || ''))}" placeholder="21.0285"></div>
                <div class="input-group"><label>Kinh độ / Longitude:</label>
                    <input type="text" class="adm-map-lng" data-index="${index}" value="${escapeHTML(String(item.lng || ''))}" placeholder="105.8542"></div>
                <div class="input-group" style="grid-column:1/-1">
                    <button type="button" class="btn-geocode-map" data-index="${index}">
                        <i class="fa-solid fa-magnifying-glass-location"></i> Tìm Tọa Độ Tự Động Qua Tên Địa Điểm
                    </button>
                </div>
            </div>`;
        card.querySelector('.btn-remove-item').addEventListener('click', () => {
            const st = _getState(); if (st.mapLocations) st.mapLocations.splice(index, 1);
            renderAdminMapLocationsList();
        });
        const btnGeocode = card.querySelector('.btn-geocode-map');
        if (btnGeocode) {
            btnGeocode.addEventListener('click', async () => {
                const nameVal = card.querySelector('.adm-map-name')?.value.trim();
                if (!nameVal) { showToast('Vui lòng nhập tên địa điểm trước!', 'warning'); return; }
                btnGeocode.disabled  = true;
                btnGeocode.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tìm...';
                try {
                    const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(nameVal)}`);
                    const data = await res.json();
                    if (data && data.length > 0) {
                        const lat = parseFloat(data[0].lat).toFixed(6);
                        const lon = parseFloat(data[0].lon).toFixed(6);
                        card.querySelector('.adm-map-lat').value = lat;
                        card.querySelector('.adm-map-lng').value = lon;
                        showToast(`Đã tìm thấy tọa độ: ${lat}, ${lon}`);
                    } else {
                        showToast('Không tìm thấy tọa độ. Bạn có thể nhập thủ công!');
                    }
                } catch { showToast('Lỗi kết nối dịch vụ tìm tọa độ.', 'error'); }
                finally {
                    btnGeocode.disabled  = false;
                    btnGeocode.innerHTML = '<i class="fa-solid fa-magnifying-glass-location"></i> Tìm Tọa Độ Tự Động Qua Tên Địa Điểm';
                }
            });
        }
        list.appendChild(card);
    });
}

// ── Reactions ─────────────────────────────────────────────────────────────────
export function renderAdminReactionsList() {
    const list = document.getElementById('reactionsAdminList');
    if (!list) return;
    list.innerHTML = '';
    const state = _getState();
    const items = state.reactionsConfig?.length ? state.reactionsConfig : (KE_CONFIG.reactionsConfig || []);
    items.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'admin-item-card';
        card.innerHTML = `
            <div class="admin-item-header">
                <span><i class="fa-solid fa-face-smile"></i> Icon Meme #${index + 1}</span>
            </div>
            <div class="admin-item-grid" style="grid-template-columns:80px 1fr;">
                <div class="input-group" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;">
                    <label>Xem trước:</label>
                    <img src="${escapeHTML(item.imgUrl || '')}" class="adm-react-preview" style="width:48px;height:48px;object-fit:cover;border-radius:50%;border:2px solid #f59e0b;margin-top:4px;${item.imgUrl ? '' : 'display:none;'}" alt="preview">
                </div>
                <div class="input-group"><label>Tên / Tiêu đề:</label>
                    <input type="text" class="adm-react-title" data-index="${index}" value="${escapeHTML(item.title || '')}" placeholder="Tên hiển thị reaction..."></div>
                <div class="input-group" style="grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div class="input-group"><label>Tải File Ảnh từ máy:</label>
                        <input type="file" class="adm-react-file" data-index="${index}" accept="image/*"></div>
                    <div class="input-group"><label>Hoặc Dán Link URL Ảnh:</label>
                        <input type="text" class="adm-react-url" data-index="${index}" value="${escapeHTML(item.imgUrl || '')}" placeholder="https://..."></div>
                </div>
            </div>`;
        const fileInput  = card.querySelector('.adm-react-file');
        const urlInput   = card.querySelector('.adm-react-url');
        const imgPreview = card.querySelector('.adm-react-preview');
        if (urlInput  && imgPreview) urlInput.addEventListener('input',  () => { if (urlInput.value.trim()) imgPreview.src = urlInput.value.trim(); });
        if (fileInput && imgPreview) {
            fileInput.addEventListener('change', () => {
                if (fileInput.files?.[0]) {
                    const reader = new FileReader();
                    reader.onload = (e) => { imgPreview.src = e.target.result; };
                    reader.readAsDataURL(fileInput.files[0]);
                }
            });
        }
        list.appendChild(card);
    });
}

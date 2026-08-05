/**
 * admin-save.js — Xử lý lưu: nút "Lưu Thay Đổi" tổng + tab-scoped save buttons
 */
import { KE_CONFIG }                   from '../config.js';
import { showToast }                   from '../toast.js';
import { readFileAsDataURL, uploadFileToBackend } from './admin-utils.js';

export function initSave(getState, setState, saveBackendConfig, refreshDOM) {

    // ── Nút Lưu Thay Đổi tổng (btnSaveSettings) ─────────────────────────────
    const btnSaveSettings = document.getElementById('btnSaveSettings');
    const customModal     = document.getElementById('customModal');

    if (btnSaveSettings) {
        btnSaveSettings.addEventListener('click', async () => {
            btnSaveSettings.disabled  = true;
            btnSaveSettings.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';
            const state = getState();

            // Profile
            _readProfileInputs(state);
            _readSocialInputs(state);

            // Avatar
            const inputPhotoFile = document.getElementById('inputPhoto');
            const inputPhotoUrl  = document.getElementById('inputPhotoUrl');
            if (inputPhotoFile?.files.length > 0) {
                const file   = inputPhotoFile.files[0];
                const base64 = await readFileAsDataURL(file);
                state.photoUrl = await uploadFileToBackend(`avatar_${Date.now()}_${file.name}`, base64);
            } else if (inputPhotoUrl?.value.trim()) {
                state.photoUrl = inputPhotoUrl.value.trim();
            }

            // Playlist
            state.playlist = await _readPlaylistInputs(state, getState);
            // Gallery
            state.gallery  = await _readGalleryInputs(state, getState);
            // Journey
            state.journey  = _readJourneyInputs();
            // Map
            state.mapLocations = _readMapInputs();
            // Home location
            _readHomeLocation(state);

            setState(state);
            await saveBackendConfig(state);
            refreshDOM();

            btnSaveSettings.disabled  = false;
            btnSaveSettings.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Lưu Thay Đổi';
            if (customModal) customModal.classList.remove('active');
            showToast('Đã cập nhật toàn bộ thay đổi thành công!');
        });
    }

    // ── Tab-scoped save buttons (event delegation) ───────────────────────────
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.btn-tab-save');
        if (!btn) return;
        e.preventDefault();

        const action       = btn.getAttribute('data-tab-action');
        const originalHTML = btn.innerHTML;
        btn.disabled  = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';

        try {
            const state = getState();

            if (action === 'profile') {
                _readProfileInputs(state);
                _readSocialInputs(state);
                const inputPhotoFile = document.getElementById('inputPhoto');
                const inputPhotoUrl  = document.getElementById('inputPhotoUrl');
                if (inputPhotoFile?.files.length > 0) {
                    const file   = inputPhotoFile.files[0];
                    const base64 = await readFileAsDataURL(file);
                    state.photoUrl = await uploadFileToBackend(`avatar_${Date.now()}_${file.name}`, base64);
                } else if (inputPhotoUrl?.value.trim()) {
                    state.photoUrl = inputPhotoUrl.value.trim();
                }
                _readAnnouncementInputs(state);
                _readSpotlightInputs(state);
                if (window.applySpotlightHighlight)  window.applySpotlightHighlight(state);
                if (window.triggerAnnouncerShout)     window.triggerAnnouncerShout(state.announcementText, state.announcementActive);
                showToast('Đã lưu Hồ Sơ cá nhân & Tiêu điểm nổi bật!');
            }
            else if (action === 'music') {
                state.playlist = await _readPlaylistInputs(state, getState);
                showToast('Đã lưu Playlist Âm Nhạc!');
            }
            else if (action === 'favorites') {
                _readFavoritesInputs(state);
                showToast('Đã lưu Gu & Sở Thích cá nhân!');
            }
            else if (action === 'milestones') {
                state.journey = _readJourneyInputs();
                showToast('Đã lưu Dấu Chân Thanh Xuân!');
            }
            else if (action === 'memoryMap') {
                state.mapLocations = _readMapInputs();
                showToast('Đã lưu Bản Đồ Kỷ Niệm!');
            }
            else if (action === 'gallery') {
                state.gallery = await _readGalleryInputs(state, getState);
                showToast('Đã lưu Thư Viện Ảnh Kỷ Niệm!');
            }
            else if (action === 'reactions') {
                state.reactionsConfig = await _readReactionsInputs(state, getState);
                showToast('Đã lưu Cấu Hình Icon Meme!');
            }

            setState(state);
            await saveBackendConfig(state);
            refreshDOM();
        } catch (err) {
            console.error('Tab save error:', err);
            showToast('Có lỗi khi lưu dữ liệu tab!', 'error');
        } finally {
            btn.disabled  = false;
            btn.innerHTML = originalHTML;
        }
    });
}

// ── Helpers đọc giá trị từ form ───────────────────────────────────────────────
function _readProfileInputs(state) {
    const ids = ['inputName','inputSchoolName','inputClassName','inputClassSlogan',
                 'inputQuote1','inputQuote2','inputQuote3','inputBirthdayDate','inputBalloonTiktokUrl'];
    const keys = ['name','schoolName','className','classSlogan','quote1','quote2','quote3','birthdayDate','balloonTiktokUrl'];
    ids.forEach((id, i) => {
        const el = document.getElementById(id);
        if (el) state[keys[i]] = el.value.trim();
    });
}

function _readSocialInputs(state) {
    if (!state.socialLinks) state.socialLinks = {};
    const map = { inputLinkFacebook:'facebook', inputLinkMessenger:'messenger',
                  inputLinkZalo:'zalo', inputLinkTiktok:'tiktok', inputLinkInstagram:'instagram' };
    for (const [id, key] of Object.entries(map)) {
        const el = document.getElementById(id);
        if (el) state.socialLinks[key] = el.value.trim();
    }
}

function _readFavoritesInputs(state) {
    const map = { inputFavMusic:'favMusic', inputFavMovie:'favMovie', inputFavBook:'favBook',
                  inputFavDrink:'favDrink', inputFavFashion:'favFashion', inputFavLover:'favLover',
                  inputFavLifestyle:'favLifestyle', inputFavColor:'favColor' };
    for (const [id, key] of Object.entries(map)) {
        const el = document.getElementById(id);
        if (el) state[key] = el.value.trim();
    }
}

function _readAnnouncementInputs(state) {
    const txt    = document.getElementById('inputAnnouncementText');
    const active = document.getElementById('inputAnnouncementActive');
    if (txt)    state.announcementText   = txt.value.trim();
    if (active) state.announcementActive = active.checked;
}

function _readSpotlightInputs(state) {
    const target    = document.getElementById('inputSpotlightTarget');
    const badgeText = document.getElementById('inputSpotlightBadgeText');
    const active    = document.getElementById('inputSpotlightActive');
    state.spotlightConfig = {
        target:    target    ? target.value              : 'none',
        badgeText: badgeText ? badgeText.value.trim()    : 'HOT NEW! 🔥',
        active:    active    ? active.checked            : false,
    };
}

async function _readPlaylistInputs(state, getState) {
    const trkFiles   = document.querySelectorAll('.adm-trk-file');
    const trkUrls    = document.querySelectorAll('.adm-trk-url');
    const trkTitles  = document.querySelectorAll('.adm-trk-title');
    const trkArtists = document.querySelectorAll('.adm-trk-artist');
    const list = [];
    for (let i = 0; i < trkUrls.length; i++) {
        let url = trkUrls[i].value.trim();
        if (trkFiles[i]?.files.length > 0) {
            const file   = trkFiles[i].files[0];
            const base64 = await readFileAsDataURL(file);
            url = await uploadFileToBackend(`track_${Date.now()}_${file.name}`, base64);
        } else if (!url) {
            url = getState().playlist?.[i]?.url || '';
        }
        const title = trkTitles[i]?.value.trim() || '';
        if (url || title) list.push({ title: title || 'Bài Hát Thanh Xuân', artist: trkArtists[i]?.value.trim() || 'Kế', url });
    }
    return list;
}

async function _readGalleryInputs(state, getState) {
    const galFiles = document.querySelectorAll('.adm-gal-file');
    const galUrls  = document.querySelectorAll('.adm-gal-url');
    const galCaps  = document.querySelectorAll('.adm-gal-caption');
    const galDates = document.querySelectorAll('.adm-gal-date');
    const galLocs  = document.querySelectorAll('.adm-gal-location');
    const list = [];
    for (let i = 0; i < galUrls.length; i++) {
        let url = galUrls[i].value.trim();
        if (galFiles[i]?.files.length > 0) {
            const file   = galFiles[i].files[0];
            const base64 = await readFileAsDataURL(file);
            url = await uploadFileToBackend(`gallery_${Date.now()}_${file.name}`, base64);
        } else if (!url) {
            url = getState().gallery?.[i]?.url || '';
        }
        if (url) list.push({ url, caption: galCaps[i]?.value.trim() || '', date: galDates[i]?.value.trim() || '', location: galLocs[i]?.value.trim() || '' });
    }
    return list;
}

function _readJourneyInputs() {
    const jouTitles = document.querySelectorAll('.adm-jou-title');
    const jouTags   = document.querySelectorAll('.adm-jou-tag');
    const jouDates  = document.querySelectorAll('.adm-jou-date');
    const jouUrls   = document.querySelectorAll('.adm-jou-url');
    const jouDescs  = document.querySelectorAll('.adm-jou-desc');
    const list = [];
    for (let i = 0; i < jouTitles.length; i++) {
        const title = jouTitles[i].value.trim();
        const url   = jouUrls[i]?.value.trim() || '';
        if (title || url) list.push({ title: title || 'Kỷ Niệm', tag: jouTags[i]?.value.trim() || 'Hành Trình', date: jouDates[i]?.value.trim() || '', url, desc: jouDescs[i]?.value.trim() || '' });
    }
    return list;
}

function _readMapInputs() {
    const mapNames  = document.querySelectorAll('.adm-map-name');
    const mapLabels = document.querySelectorAll('.adm-map-label');
    const mapLats   = document.querySelectorAll('.adm-map-lat');
    const mapLngs   = document.querySelectorAll('.adm-map-lng');
    const list = [];
    for (let i = 0; i < mapNames.length; i++) {
        const name = mapNames[i].value.trim();
        if (name) {
            const lat = parseFloat(mapLats[i]?.value || '');
            const lng = parseFloat(mapLngs[i]?.value || '');
            list.push({ name, label: mapLabels[i]?.value.trim() || '', lat: isNaN(lat) ? null : lat, lng: isNaN(lng) ? null : lng });
        }
    }
    return list;
}

async function _readReactionsInputs(state, getState) {
    const reactFiles  = document.querySelectorAll('.adm-react-file');
    const reactUrls   = document.querySelectorAll('.adm-react-url');
    const reactTitles = document.querySelectorAll('.adm-react-title');
    const reactEmojis = document.querySelectorAll('.adm-react-emoji');
    const current     = getState().reactionsConfig?.length ? getState().reactionsConfig : (KE_CONFIG.reactionsConfig || []);
    const list = [];
    for (let i = 0; i < reactUrls.length; i++) {
        let imgUrl = reactUrls[i].value.trim();
        if (reactFiles[i]?.files.length > 0) {
            const file   = reactFiles[i].files[0];
            const base64 = await readFileAsDataURL(file);
            imgUrl = await uploadFileToBackend(`reaction_${Date.now()}_${file.name}`, base64);
        } else if (!imgUrl) { imgUrl = current[i]?.imgUrl || ''; }
        list.push({ emoji: reactEmojis[i]?.value.trim() || current[i]?.emoji || '', title: reactTitles[i]?.value.trim() || 'Meme Reaction', countId: current[i]?.countId || `reactionCount-${i}`, imgUrl: imgUrl || 'assets/memes/hanhan_1.png' });
    }
    return list;
}

function _readHomeLocation(state) {
    const lat  = document.getElementById('inputHomeLat');
    const lng  = document.getElementById('inputHomeLng');
    const addr = document.getElementById('inputHomeAddress');
    if (lat || lng || addr) {
        state.homeLocation = {
            lat:     lat  && lat.value  ? parseFloat(lat.value)  : 18.98686,
            lng:     lng  && lng.value  ? parseFloat(lng.value)  : 105.46820,
            address: addr ? addr.value.trim() : 'Xã Quan Thành, Tỉnh Nghệ An',
        };
    }
}

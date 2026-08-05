/**
 * inline-edit.js - Chế độ Sửa Trực Tiếp Trên Màn Hình & Modal Cập Nhật Nhanh Ảnh/Nhạc
 */
import { showToast } from './toast.js';

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function uploadFileToBackend(filename, base64Data) {
    if (base64Data && base64Data.startsWith('data:image/')) {
        return base64Data;
    }
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

let isInlineEditing = false;

export function initInlineEditEngine(getState, saveBackendConfig) {
    const btnInlineToggle = document.getElementById('btnInlineEditToggle');
    const inlineSaveBar = document.getElementById('inlineSaveBar');
    const btnInlineSave = document.getElementById('btnInlineSave');

    if (!btnInlineToggle) return;

    const editableElements = [
        { id: 'heroTitleText', key: 'name' },
        { id: 'schoolTitleText', key: 'schoolName' },
        { id: 'classTitleText', key: 'className' },
        { id: 'classSloganText', key: 'classSlogan' },
        { id: 'quoteLine1', key: 'quote1' },
        { id: 'quoteLine2', key: 'quote2' },
        { id: 'quoteLine3', key: 'quote3' },
        { id: 'favMusicText', key: 'favMusic' },
        { id: 'favMovieText', key: 'favMovie' },
        { id: 'favBookText', key: 'favBook' },
        { id: 'favDrinkText', key: 'favDrink' },
        { id: 'favFashionText', key: 'favFashion' },
        { id: 'favLoverText', key: 'favLover' },
        { id: 'favLifestyleText', key: 'favLifestyle' },
        { id: 'favColorText', key: 'favColor' }
    ];

    btnInlineToggle.addEventListener('click', () => {
        isInlineEditing = !isInlineEditing;
        document.body.classList.toggle('inline-edit-mode', isInlineEditing);

        editableElements.forEach(item => {
            const elem = document.getElementById(item.id);
            if (elem) {
                elem.classList.toggle('editable-inline', isInlineEditing);
                elem.contentEditable = isInlineEditing ? "true" : "false";
            }
        });

        if (inlineSaveBar) inlineSaveBar.style.display = isInlineEditing ? 'flex' : 'none';

        if (isInlineEditing) {
            btnInlineToggle.classList.add('active');
            showToast(`<i class="fa-solid fa-pen"></i> Đã bật Chế Độ Chỉnh Sửa Trực Tiếp! Bạn chỉ cần chạm vào chữ để sửa.`);
        } else {
            btnInlineToggle.classList.remove('active');
            showToast("🔒 Đã tắt chế độ sửa trực tiếp.");
        }
    });

    // Chỉnh sửa link Mạng Xã Hội khi click trong chế độ Inline Edit
    const socialIds = [
        { id: 'linkFB', key: 'facebook', name: 'Facebook' },
        { id: 'linkMessenger', key: 'messenger', name: 'Messenger' },
        { id: 'linkZalo', key: 'zalo', name: 'Zalo' },
        { id: 'linkTikTok', key: 'tiktok', name: 'TikTok' },
        { id: 'linkInstagram', key: 'instagram', name: 'Instagram' }
    ];

    socialIds.forEach(social => {
        const elem = document.getElementById(social.id);
        if (elem) {
            elem.addEventListener('click', (e) => {
                if (isInlineEditing) {
                    e.preventDefault(); // Ngăn mở tab mới
                    const state = getState();
                    const currentUrl = (state.socialLinks && state.socialLinks[social.key]) || elem.href;
                    
                    const newUrl = prompt(`Vui lòng dán link ${social.name} của bạn vào đây:`, currentUrl);
                    if (newUrl !== null && newUrl.trim() !== '') {
                        if (!state.socialLinks) state.socialLinks = {};
                        state.socialLinks[social.key] = newUrl.trim();
                        elem.href = newUrl.trim();
                        showToast(`✅ Đã cập nhật link ${social.name} tạm thời! Nhớ bấm "Lưu Tất Cả" nhé.`);
                    }
                }
            });
        }
    });

    if (btnInlineSave) {
        btnInlineSave.addEventListener('click', async () => {
            const state = getState();
            editableElements.forEach(item => {
                const elem = document.getElementById(item.id);
                if (elem && elem.textContent.trim()) {
                    state[item.key] = elem.textContent.trim();
                }
            });

            await saveBackendConfig(state);
            showToast("✨ Đã lưu tất cả nội dung chỉnh sửa trực tiếp thành công!");

            isInlineEditing = false;
            document.body.classList.remove('inline-edit-mode');
            editableElements.forEach(item => {
                const elem = document.getElementById(item.id);
                if (elem) {
                    elem.classList.remove('editable-inline');
                    elem.contentEditable = "false";
                }
            });
            if (inlineSaveBar) inlineSaveBar.style.display = 'none';
            if (btnInlineToggle) btnInlineToggle.classList.remove('active');
        });
    }
}

export function initQuickTouchModals(getState, saveBackendConfig, refreshDOM, audioEngine) {
    // 1. Quick Photo Modal (Đổi Ảnh Đĩa Than / Ảnh Đại Diện)
    const btnQuickDiscPhoto = document.getElementById('btnQuickDiscPhoto');
    const btnQuickGlassPhoto = document.getElementById('btnQuickGlassPhoto');
    const modalQuickPhoto = document.getElementById('modalQuickPhoto');
    const btnCloseQuickPhoto = document.getElementById('btnCloseQuickPhoto');
    const btnSaveQuickPhoto = document.getElementById('btnSaveQuickPhoto');
    const quickFileInput = document.getElementById('quickFileInput');
    const quickPhotoUrlInput = document.getElementById('quickPhotoUrlInput');

    function openPhotoModal() {
        const state = getState();
        if (modalQuickPhoto) modalQuickPhoto.classList.add('active');
        if (quickPhotoUrlInput) quickPhotoUrlInput.value = state.photoUrl || '';
    }

    if (btnQuickDiscPhoto) btnQuickDiscPhoto.addEventListener('click', (e) => { e.stopPropagation(); openPhotoModal(); });
    if (btnQuickGlassPhoto) btnQuickGlassPhoto.addEventListener('click', (e) => { e.stopPropagation(); openPhotoModal(); });

    const vinylDisc = document.getElementById('vinylDisc');
    if (vinylDisc) {
        vinylDisc.style.cursor = 'pointer';
        vinylDisc.addEventListener('dblclick', openPhotoModal);
    }

    if (btnCloseQuickPhoto && modalQuickPhoto) {
        btnCloseQuickPhoto.addEventListener('click', () => modalQuickPhoto.classList.remove('active'));
    }

    if (btnSaveQuickPhoto) {
        btnSaveQuickPhoto.addEventListener('click', async () => {
            btnSaveQuickPhoto.disabled = true;
            btnSaveQuickPhoto.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang Cập Nhật...';

            try {
                const state = getState();
                if (quickFileInput && quickFileInput.files.length > 0) {
                    const file = quickFileInput.files[0];
                    const base64 = await readFileAsDataURL(file);
                    const uploadedUrl = await uploadFileToBackend(`avatar_${Date.now()}_${file.name}`, base64);
                    state.photoUrl = uploadedUrl;
                } else if (quickPhotoUrlInput && quickPhotoUrlInput.value.trim()) {
                    state.photoUrl = quickPhotoUrlInput.value.trim();
                }

                await saveBackendConfig(state);
                if (typeof refreshDOM === 'function') refreshDOM();
                if (modalQuickPhoto) modalQuickPhoto.classList.remove('active');
                showToast("✨ Đã cập nhật ảnh đĩa thanh xuân thành công!");
            } catch (err) {
                console.error("Lỗi cập nhật ảnh đĩa:", err);
            } finally {
                btnSaveQuickPhoto.disabled = false;
                btnSaveQuickPhoto.innerHTML = '<i class="fa-solid fa-check"></i> Cập Nhật Ảnh Đĩa';
            }
        });
    }

    // 2. Quick Music Modal (Thêm Nhạc / Link YouTube / TikTok / Audio)
    const btnQuickAddMusic = document.getElementById('btnQuickAddMusic');
    const modalQuickMusic = document.getElementById('modalQuickMusic');
    const btnCloseQuickMusic = document.getElementById('btnCloseQuickMusic');
    const btnSaveQuickMusic = document.getElementById('btnSaveQuickMusic');
    const quickTrackTitle = document.getElementById('quickTrackTitle');
    const quickTrackArtist = document.getElementById('quickTrackArtist');
    const quickTrackUrl = document.getElementById('quickTrackUrl');
    const quickTrackFile = document.getElementById('quickTrackFile');

    if (btnQuickAddMusic && modalQuickMusic) {
        btnQuickAddMusic.addEventListener('click', (e) => {
            e.stopPropagation();
            modalQuickMusic.classList.add('active');
        });
    }

    if (btnCloseQuickMusic && modalQuickMusic) {
        btnCloseQuickMusic.addEventListener('click', () => modalQuickMusic.classList.remove('active'));
    }

async function extractTikTokAudio(tiktokUrl) {
    try {
        const res = await fetch(`/api/extract-tiktok?url=${encodeURIComponent(tiktokUrl)}`);
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.audioUrl) {
                return data;
            }
        }
    } catch (e) {}

    try {
        const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`);
        if (res.ok) {
            const json = await res.json();
            if (json.code === 0 && json.data && (json.data.music || json.data.play)) {
                return {
                    audioUrl: json.data.music || json.data.play,
                    title: json.data.title || 'Bài Hát TikTok',
                    artist: json.data.author ? (json.data.author.nickname || json.data.author.unique_id) : 'TikTok'
                };
            }
        }
    } catch (e) {}

    return null;
}

    if (btnSaveQuickMusic) {
        btnSaveQuickMusic.addEventListener('click', async () => {
            btnSaveQuickMusic.disabled = true;
            btnSaveQuickMusic.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang Tách Âm Thanh MP3...';

            try {
                let trackUrl = quickTrackUrl ? quickTrackUrl.value.trim() : '';
                let title = quickTrackTitle ? quickTrackTitle.value.trim() : 'Bài Hát Thanh Xuân';
                let artist = quickTrackArtist ? quickTrackArtist.value.trim() : 'Giai Điệu Chill';

                if (quickTrackFile && quickTrackFile.files.length > 0) {
                    const file = quickTrackFile.files[0];
                    const base64 = await readFileAsDataURL(file);
                    trackUrl = await uploadFileToBackend(`music_${Date.now()}_${file.name}`, base64);
                } else if (trackUrl && (trackUrl.includes('tiktok.com/') || trackUrl.includes('vt.tiktok.com/'))) {
                    showToast("🔄 Đang tự động tách âm thanh MP3 từ link TikTok...");
                    const extracted = await extractTikTokAudio(trackUrl);
                    if (extracted && extracted.audioUrl) {
                        trackUrl = extracted.audioUrl;
                        if (!quickTrackTitle || !quickTrackTitle.value.trim()) title = extracted.title || 'Bài Hát TikTok';
                        if (!quickTrackArtist || !quickTrackArtist.value.trim()) artist = extracted.artist || 'TikTok';
                        showToast("✨ Tách âm thanh MP3 từ TikTok thành công!");
                    }
                }

                if (trackUrl) {
                    const state = getState();
                    if (!state.playlist || !Array.isArray(state.playlist)) {
                        state.playlist = [];
                    }

                    const newTrack = { title, artist, url: trackUrl };
                    state.playlist.push(newTrack);

                    await saveBackendConfig(state);
                    if (audioEngine && audioEngine.renderPlaylist) audioEngine.renderPlaylist();
                    if (audioEngine && audioEngine.playTrackAtIndex) {
                        audioEngine.playTrackAtIndex(state.playlist.length - 1);
                    }

                    if (modalQuickMusic) modalQuickMusic.classList.remove('active');
                    showToast(`<i class="fa-solid fa-music"></i> Đã thêm "${title}" & tự động quay đĩa phát nhạc! <i class="fa-solid fa-compact-disc"></i>`);

                    // Reset form
                    if (quickTrackTitle) quickTrackTitle.value = '';
                    if (quickTrackArtist) quickTrackArtist.value = '';
                    if (quickTrackUrl) quickTrackUrl.value = '';
                    if (quickTrackFile) quickTrackFile.value = '';
                } else {
                    alert("Vui lòng nhập Link YouTube/TikTok/Audio hoặc tải file âm thanh lên!");
                }
            } catch (err) {
                console.error("Lỗi thêm bài hát:", err);
            } finally {
                btnSaveQuickMusic.disabled = false;
                btnSaveQuickMusic.innerHTML = '<i class="fa-solid fa-circle-play"></i> Thêm Bài Hát & Phát Ngay';
            }
        });
    }
}

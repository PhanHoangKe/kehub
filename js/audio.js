/**
 * audio.js - Trình phát nhạc Acoustic & Bộ quản lý Playlist tự động chuyển bài
 */
export function initAudioEngine(getState, saveBackendConfig) {
    const bgAudio = document.getElementById('bgAudio');
    const btnPlayPause = document.getElementById('btnPlayPause');
    const vinylDisc = document.getElementById('vinylDisc');
    const vinylArm = document.getElementById('vinylArm');
    const soundVisualizer = document.querySelector('.sound-visualizer');
    const trackTitle = document.getElementById('trackTitle');
    const trackArtist = document.getElementById('trackArtist');

    let isPlaying = false;
    let isManuallyPaused = false;
    let currentTrackIndex = 0;
    let currentMediaType = 'audio'; // 'audio' | 'youtube' | 'tiktok'
    let currentIframeSrc = '';

    function updatePlayStateUI(playing) {
        isPlaying = playing;
        if (btnPlayPause) btnPlayPause.innerHTML = `<i class="fa-solid fa-${playing ? 'pause' : 'play'}"></i>`;
        if (vinylDisc) vinylDisc.classList.toggle('playing', playing);
        if (vinylArm) vinylArm.classList.toggle('playing', playing);
        if (soundVisualizer) soundVisualizer.classList.toggle('active', playing);
    }

    function playAudio() {
        isManuallyPaused = false;

        if (currentMediaType === 'audio') {
            if (!bgAudio) return;
            bgAudio.play().then(() => {
                updatePlayStateUI(true);
            }).catch(err => {
                console.log("Trình duyệt chờ tương tác mở nhạc:", err);
            });
        } else if (currentMediaType === 'youtube') {
            const ytFrame = document.getElementById('ytAudioFrame');
            if (ytFrame) {
                if (!ytFrame.src || ytFrame.src.includes('about:blank')) {
                    ytFrame.src = currentIframeSrc;
                } else {
                    ytFrame.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
                }
            }
            updatePlayStateUI(true);
        } else if (currentMediaType === 'tiktok') {
            const tiktokPlayerWidget = document.getElementById('tiktokPlayerWidget');
            const tiktokFrameBox = document.getElementById('tiktokFrameBox');
            if (tiktokFrameBox && (!tiktokFrameBox.innerHTML || tiktokFrameBox.innerHTML === '')) {
                tiktokFrameBox.innerHTML = `<iframe src="${currentIframeSrc}" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
            }
            if (tiktokPlayerWidget) tiktokPlayerWidget.classList.add('active');
            updatePlayStateUI(true);
        }
    }

    function pauseAudio() {
        isManuallyPaused = true;

        if (currentMediaType === 'audio') {
            if (bgAudio) bgAudio.pause();
        } else if (currentMediaType === 'youtube') {
            const ytFrame = document.getElementById('ytAudioFrame');
            if (ytFrame && ytFrame.contentWindow) {
                ytFrame.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
            }
        } else if (currentMediaType === 'tiktok') {
            const tiktokFrameBox = document.getElementById('tiktokFrameBox');
            if (tiktokFrameBox) {
                tiktokFrameBox.innerHTML = '';
            }
        }

        updatePlayStateUI(false);
    }

    if (btnPlayPause) {
        btnPlayPause.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isPlaying) {
                pauseAudio();
            } else {
                if (currentMediaType === 'audio' && bgAudio && !bgAudio.src && (!currentIframeSrc || currentIframeSrc === '')) {
                    playTrackAtIndex(currentTrackIndex);
                } else if ((currentMediaType === 'youtube' || currentMediaType === 'tiktok') && !currentIframeSrc) {
                    playTrackAtIndex(currentTrackIndex);
                } else {
                    playAudio();
                }
            }
        });
    }

    function renderPlaylist() {
        const playlistItems = document.getElementById('playlistItems');
        const state = getState();
        if (!playlistItems || !state.playlist || !Array.isArray(state.playlist)) return;

        playlistItems.innerHTML = '';
        state.playlist.forEach((track, index) => {
            if (!track.url && !track.title) return;
            const li = document.createElement('li');
            const isActive = index === currentTrackIndex;
            li.className = `pl-item ${isActive ? 'active' : ''}`;
            li.setAttribute('data-index', index);
            li.innerHTML = `
                <div class="pl-left-info" style="display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;">
                    <i class="fa-solid ${isActive ? 'fa-volume-high' : 'fa-play'} pl-icon"></i>
                    <div class="pl-meta">
                        <span class="pl-name">${track.title || 'Bài Hát Thanh Xuân'}</span>
                        <span class="pl-desc">${track.artist || 'Kế'}</span>
                    </div>
                </div>
            `;
            
            const leftInfo = li.querySelector('.pl-left-info');
            if (leftInfo) {
                leftInfo.addEventListener('click', () => {
                    playTrackAtIndex(index);
                });
            }

            playlistItems.appendChild(li);
        });

        const currentTrack = state.playlist[currentTrackIndex];
        if (currentTrack) {
            if (trackTitle) trackTitle.textContent = currentTrack.title || 'Giai Điệu Thanh Xuân';
            if (trackArtist) trackArtist.textContent = currentTrack.artist || 'Acoustic Piano';
        }
    }

    function getYouTubeId(url) {
        if (!url) return null;
        const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
        return match ? match[1] : null;
    }

    function getTikTokId(url) {
        if (!url) return null;
        const match = url.match(/(?:tiktok\.com\/(?:@[\w.-]+\/video\/|embed\/(?:v2\/)?))(\d+)/);
        return match ? match[1] : null;
    }

    const tiktokPlayerWidget = document.getElementById('tiktokPlayerWidget');
    const btnCloseTikTokWidget = document.getElementById('btnCloseTikTokWidget');
    const tiktokFrameBox = document.getElementById('tiktokFrameBox');

    if (btnCloseTikTokWidget && tiktokPlayerWidget) {
        btnCloseTikTokWidget.addEventListener('click', () => {
            tiktokPlayerWidget.classList.remove('active');
        });
    }

    async function playTrackAtIndex(index) {
        const state = getState();
        if (!state.playlist || state.playlist.length === 0) return;
        currentTrackIndex = (index + state.playlist.length) % state.playlist.length;
        const track = state.playlist[currentTrackIndex];
        if (!track || !track.url) return;

        const ttId = getTikTokId(track.url);
        if (ttId) {
            // Tự động giải mã link TikTok thành file MP3 âm thanh thuần
            try {
                const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(track.url)}`);
                if (res.ok) {
                    const json = await res.json();
                    if (json.code === 0 && json.data && (json.data.music || json.data.play)) {
                        track.url = json.data.music || json.data.play;
                        if (saveBackendConfig) await saveBackendConfig(state);
                    }
                }
            } catch (e) {}
        }

        if (trackTitle) trackTitle.textContent = track.title || 'Giai Điệu Thanh Xuân';
        if (trackArtist) trackArtist.textContent = track.artist || 'Acoustic Piano';

        const ytId = getYouTubeId(track.url);
        let ytFrame = document.getElementById('ytAudioFrame');

        if (!ytFrame) {
            ytFrame = document.createElement('iframe');
            ytFrame.id = 'ytAudioFrame';
            ytFrame.style.cssText = 'position: fixed; width: 1px; height: 1px; left: -9999px; top: -9999px; opacity: 0.01; pointer-events: none;';
            ytFrame.allow = 'autoplay; encrypted-media';
            document.body.appendChild(ytFrame);
        }

        if (ytId) {
            currentMediaType = 'youtube';
            if (bgAudio) bgAudio.pause();
            if (tiktokPlayerWidget) tiktokPlayerWidget.classList.remove('active');
            if (tiktokFrameBox) tiktokFrameBox.innerHTML = '';

            currentIframeSrc = `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&enablejsapi=1`;
            ytFrame.src = currentIframeSrc;
            updatePlayStateUI(true);
        } else {
            currentMediaType = 'audio';
            ytFrame.src = 'about:blank';
            if (tiktokPlayerWidget) tiktokPlayerWidget.classList.remove('active');
            if (tiktokFrameBox) tiktokFrameBox.innerHTML = '';

            if (bgAudio) {
                bgAudio.src = track.url;
                isManuallyPaused = false;
                playAudio();
            }
        }
        renderPlaylist();
    }

    if (bgAudio) {
        bgAudio.onended = () => {
            playTrackAtIndex(currentTrackIndex + 1);
        };
    }

    const btnPlaylistToggle = document.getElementById('btnPlaylistToggle');
    const playlistPopup = document.getElementById('playlistPopup');
    const btnClosePlaylist = document.getElementById('btnClosePlaylist');

    if (btnPlaylistToggle && playlistPopup) {
        btnPlaylistToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            playlistPopup.classList.toggle('active');
        });
    }

    if (btnClosePlaylist && playlistPopup) {
        btnClosePlaylist.addEventListener('click', () => {
            playlistPopup.classList.remove('active');
        });
    }

    return { playAudio, pauseAudio, playTrackAtIndex, renderPlaylist };
}

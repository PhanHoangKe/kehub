/* ==========================================================================
   MUSIC STORY GENERATOR - CORE JS ENGINE
   Handles: Clean FB Music Note Story Video Generation (Original FB Video Style),
            Video/Audio Track Extraction (Auto extracts audio from MP4/WebM/MP3/WAV/TikTok),
            CapCut-Style Precision Audio Trimming & Live Waveform Scrubber,
            Expanded Facebook Reactions Grid (❤️, 👍, 🥰, 😆, 😮, 😢, 😡, 🔥),
            Restored Original Central Note Bubble (580x240) + Exact 2-Dot FB Tail,
            Customizable Top-Left "Ghi chú" Badge (Y=120, 220x66),
            Proportional Avatar Circular Crop (Center Cover Fit, No Squishing/Distortion),
            FB Note Layout: Line 1 = ||| Audio Wave + Artist/Sub ("ayi"), 
                            Line 2 = Note Title ("những câu chuyện ayi"),
            Timed Reaction Burst (Shoots at 2.0s delay, extended 0.5s lifespan),
            Web Audio API analysis, Timeline trimming, Realtime 1080x1920 
            Canvas rendering & MP4 Recording.
   ========================================================================== */

(function () {
    'use strict';

    // ── Helper Selectors ──
    const $ = (id) => document.getElementById(id);

    // ── State Data Model ──
    const storyProject = {
        id: 'story_' + Date.now(),
        mode: 'fb_note', // 'fb_note' | 'modern'
        showNoteBadge: true, // `Ghi chú` button top-left
        scrollCharThreshold: 15, // Character count threshold to trigger horizontal marquee scroll
        fbNote: {
            title: 'Life Goes On',
            sub: 'BTS',
            noteText: '',
            bgColor: '#b4804c', // Slightly lighter soft brown FB Note
            stickers: [] // Array of { id, url, imgElement }
        },
        movieEnd: {
            title: 'HẾT PHIM',
            titleStyle: 'gold', // 'gold' | 'silver' | 'vintage' | 'neon' | 'minimal'
            titleX: 540,
            titleY: 310,
            lyricsMode: 'karaoke', // 'karaoke' | 'scroll'
            creditsText: `[00:00.00] Life Goes On - BTS
[00:02.50] One day the world stopped
[00:05.50] Without any warning
[00:08.50] Spring didn't know to wait
[00:11.50] Showed up not even a minute late
[00:14.50] Like an echo in the forest
[00:17.50] Yeah life goes on...`,
            
            // 🌟 2026 CUSTOM BOUNDING BOX & ACTIVE HIGHLIGHT COLOR CONTROLS 🌟
            lyricsX: 540,
            lyricsY: 1080,
            lyricsWidth: 920,
            lyricsHeight: 650,

            activeColor: '#f59e0b',       // Màu chữ khi sáng
            activeGlowSize: 25,           // Độ lớn phát sáng
            activeFontSize: 44,           // Cỡ chữ khi sáng
            inactiveColor: '#ffffff',     // Màu chữ phụ
            inactiveFontSize: 34,         // Cỡ chữ phụ

            fontFamily: 'Outfit',         // Font chữ Karaoke
            textAlign: 'center',          // Căn lề chữ
            showPillBg: true,             // Dải sáng nền phát sáng câu hát

            showLetterbox: true,
            showDust: true,
            showKenBurns: true,
            darkness: 0.55
        },
        hdStory: {
            sharpness: 'crisp', // 'crisp' | 'vibrant' | 'raw'
            badgeStyle: 'vinyl'  // 'none' | 'vinyl' | 'minimal'
        },
        floatingEmotions: {
            enabled: false,
            emoji: '❤️',
            countMode: '2',
            particles: []
        },
        background: {
            type: 'color', // 'image' | 'video' | 'color'
            url: null,
            imgElement: null,
            videoElement: null,
            muted: true,
        },
        music: {
            file: null,
            url: null,
            audioBuffer: null,
            fileName: 'những câu chuyện ayi.mp3',
            start: 0,
            duration: 0
        },
        song: {
            title: 'những câu chuyện ayi',
            artist: 'ayi',
            album: 'Story Note',
            coverUrl: null,
            coverImgElement: null,
            showCover: true
        },
        duration: 15, // Story play length in seconds ('full' or number)
        aspectRatio: '9:16',
        resolution: { width: 1080, height: 1920 }
    };

    // ── Web Audio API & Media Context ──
    let audioCtx = null;
    let audioBufferSource = null;
    let analyserNode = null;
    let isPlayingPreview = false;
    let previewStartTime = 0;
    let animationFrameId = null;

    // ── DOM References ──
    const bgDropzone = $('bgDropzone');
    const bgInput = $('bgInput');
    const bgPreviewBox = $('bgPreviewBox');
    const bgImgPreview = $('bgImgPreview');
    const bgVideoPreview = $('bgVideoPreview');
    const btnRemoveBg = $('btnRemoveBg');

    const musicDropzone = $('musicDropzone');
    const musicInput = $('musicInput');
    const musicUrlInput = $('musicUrlInput');
    const btnExtractUrl = $('btnExtractUrl');

    const audioTimelineCard = $('audioTimelineCard');
    const songFileName = $('songFileName');
    const songDurationText = $('songDurationText');
    const btnPlayMusicPreview = $('btnPlayMusicPreview');
    const msWaveformCanvas = $('msWaveformCanvas');
    const startTimeRange = $('startTimeRange');
    const startTimeVal = $('startTimeVal');
    const endTimeVal = $('endTimeVal');
    const storyDurVal = $('storyDurVal');

    const noteTitleInput = $('noteTitleInput');
    const noteSubInput = $('noteSubInput');
    const noteTextExtraInput = $('noteTextExtraInput');
    const stickerImgInput = $('stickerImgInput');
    const stickersListWrap = $('stickersListWrap');
    const noteBgColorCustom = $('noteBgColorCustom');

    const scrollCharThresholdRange = $('scrollCharThresholdRange');
    const scrollCharThresholdVal = $('scrollCharThresholdVal');

    const toggleNoteBadge = $('toggleNoteBadge');

    const msPreviewCanvas = $('msPreviewCanvas');
    const previewCtx = msPreviewCanvas.getContext('2d');

    const btnCreateStory = $('btnCreateStory');
    const exportModal = $('exportModal');
    const exportProgressBar = $('exportProgressBar');
    const exportStatusText = $('exportStatusText');
    const exportModalTitle = $('exportModalTitle');
    const exportSpinner = $('exportSpinner');
    const exportActionBtns = $('exportActionBtns');
    const btnDownloadVideo = $('btnDownloadVideo');
    const btnCreateAnother = $('btnCreateAnother');

    // ── Movie End DOM References ──
    const fbNoteSection = $('fbNoteSection');
    const movieEndSection = $('movieEndSection');
    const movieTitleInput = $('movieTitleInput');
    const movieCreditsInput = $('movieCreditsInput');
    const btnFillSampleCredits = $('btnFillSampleCredits');
    const btnFetchLrcLyrics = $('btnFetchLrcLyrics');
    const btnAutoSyncTimestamps = $('btnAutoSyncTimestamps');
    const currentSingingText = $('currentSingingText');
    const activeSingingLineBadge = $('activeSingingLineBadge');
    const toggleMovieLetterbox = $('toggleMovieLetterbox');
    const toggleMovieDust = $('toggleMovieDust');
    const toggleMovieKenBurns = $('toggleMovieKenBurns');
    const movieDarknessRange = $('movieDarknessRange');
    const movieDarknessVal = $('movieDarknessVal');

    // ── Initialize Default Fallback Cover / Avatar ──
    function createDefaultAvatar() {
        const c = document.createElement('canvas');
        c.width = 400;
        c.height = 400;
        const ctx = c.getContext('2d');

        const grad = ctx.createLinearGradient(0, 0, 400, 400);
        grad.addColorStop(0, '#3b4252');
        grad.addColorStop(1, '#1e222a');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 400, 400);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 130px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('👤', 200, 200);

        const img = new Image();
        img.src = c.toDataURL();
        storyProject.background.imgElement = img;
        storyProject.song.coverImgElement = img;
    }
    createDefaultAvatar();

    // ── Initialize Emotion Particles ──
    function initParticles() {
        storyProject.floatingEmotions.particles = [];
        const countMode = storyProject.floatingEmotions.countMode;

        let numParticles = 2;
        let isLoop = false;

        if (countMode === 'loop') {
            numParticles = 10;
            isLoop = true;
        } else {
            numParticles = parseInt(countMode, 10) || 2;
            isLoop = false;
        }

        for (let i = 0; i < numParticles; i++) {
            const startDelay = 2.0 + (i * 0.30); // Starts at 2.0s delay
            const curveDir = (i % 2 === 0) ? 1 : -1;

            storyProject.floatingEmotions.particles.push({
                index: i,
                xOffset: (Math.random() - 0.5) * 40,
                travelDist: 220 + Math.random() * 50,
                duration: 1.15 + Math.random() * 0.15, // Lifespan = ~1.2s
                curveAmp: 30 + Math.random() * 20,
                curveDir: curveDir,
                scale: 0.95 + Math.random() * 0.3,
                startDelay: startDelay,
                isLoop: isLoop
            });
        }
    }
    initParticles();

    // ── NATIVE VECTOR FB THOUGHT BUBBLE ICON (EXACT 2-DOT FB THOUGHT ICON) ──
    function drawThoughtBubbleIcon(ctx, x, y, scale = 1, color = '#ffffff') {
        ctx.save();
        ctx.fillStyle = color;

        // 1. Main Thought Bubble Body (Rounded Rectangle)
        const w = 26 * scale;
        const h = 17 * scale;
        const r = 7 * scale;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        ctx.fill();

        // 2. Upper Large Dot (Center right at bottom line of bubble so exactly 50% shows)
        const dot1X = x + 7 * scale;
        const dot1Y = y + h;
        const dot1R = 4.2 * scale;
        ctx.beginPath();
        ctx.arc(dot1X, dot1Y, dot1R, 0, Math.PI * 2);
        ctx.fill();

        // 3. Lower Small Dot (Positioned underneath to the right)
        const dot2X = x + 13 * scale;
        const dot2Y = y + h + 5.5 * scale;
        const dot2R = 2.6 * scale;
        ctx.beginPath();
        ctx.arc(dot2X, dot2Y, dot2R, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    function hexToRgba(hex, alpha = 1) {
        if (!hex) return `rgba(255, 255, 255, ${alpha})`;
        let c = hex.replace('#', '');
        if (c.length === 3) c = c.split('').map(x => x + x).join('');
        const num = parseInt(c, 16);
        return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
    }

    // ── PROPORTIONAL CIRCULAR AVATAR DRAWING (NO SQUISHING/STRETCHING) ──
    function drawCircularImage(ctx, imgOrVideo, cx, cy, radius) {
        const imgW = imgOrVideo.videoWidth || imgOrVideo.width || (radius * 2);
        const imgH = imgOrVideo.videoHeight || imgOrVideo.height || (radius * 2);

        const diameter = radius * 2;
        const scale = Math.max(diameter / imgW, diameter / imgH);
        const nw = imgW * scale;
        const nh = imgH * scale;
        const nx = cx - nw / 2;
        const ny = cy - nh / 2;

        ctx.drawImage(imgOrVideo, nx, ny, nw, nh);
    }

    // ── STORY MODE SWITCHER ──
    const hdStorySection = $('hdStorySection');
    document.querySelectorAll('#storyModeGroup .ms-seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#storyModeGroup .ms-seg-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            storyProject.mode = btn.getAttribute('data-mode');

            if (storyProject.mode === 'movie_end') {
                if (fbNoteSection) fbNoteSection.style.display = 'none';
                if (movieEndSection) movieEndSection.style.display = 'block';
                if (hdStorySection) hdStorySection.style.display = 'none';
            } else if (storyProject.mode === 'hd_story') {
                if (fbNoteSection) fbNoteSection.style.display = 'none';
                if (movieEndSection) movieEndSection.style.display = 'none';
                if (hdStorySection) hdStorySection.style.display = 'block';
            } else {
                if (fbNoteSection) fbNoteSection.style.display = 'block';
                if (movieEndSection) movieEndSection.style.display = 'none';
                if (hdStorySection) hdStorySection.style.display = 'none';
            }

            renderPreviewFrame(0);
        });
    });

    // ── 1. BACKGROUND & AVATAR HANDLING ──
    bgDropzone.addEventListener('click', () => bgInput.click());

    ['dragenter', 'dragover'].forEach(eventName => {
        bgDropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            bgDropzone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        bgDropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            bgDropzone.classList.remove('dragover');
        }, false);
    });

    bgDropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        if (dt.files.length) handleBgFile(dt.files[0]);
    });

    bgInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleBgFile(e.target.files[0]);
    });

    function handleBgFile(file) {
        const url = URL.createObjectURL(file);
        if (file.type.startsWith('image/')) {
            storyProject.background.type = 'image';
            storyProject.background.url = url;
            const img = new Image();
            img.onload = () => {
                storyProject.background.imgElement = img;
                storyProject.song.coverImgElement = img;
                bgImgPreview.src = url;
                bgImgPreview.style.display = 'block';
                bgVideoPreview.style.display = 'none';
                bgPreviewBox.style.display = 'block';
                renderPreviewFrame(0);
            };
            img.src = url;
        } else if (file.type.startsWith('video/')) {
            storyProject.background.type = 'video';
            storyProject.background.url = url;
            const video = document.createElement('video');
            video.src = url;
            video.muted = true;
            video.loop = true;
            video.playsInline = true;
            video.onloadeddata = () => {
                storyProject.background.videoElement = video;
                bgVideoPreview.src = url;
                bgVideoPreview.style.display = 'block';
                bgImgPreview.style.display = 'none';
                bgPreviewBox.style.display = 'block';
                video.play();
                renderPreviewFrame(0);
            };
        }
    }

    btnRemoveBg.addEventListener('click', (e) => {
        e.stopPropagation();
        storyProject.background.type = 'color';
        storyProject.background.url = null;
        createDefaultAvatar();
        bgPreviewBox.style.display = 'none';
        bgInput.value = '';
        renderPreviewFrame(0);
    });

    // ── 2. MUSIC & VIDEO AUDIO EXTRACTION ENGINE ──
    musicDropzone.addEventListener('click', () => musicInput.click());

    ['dragenter', 'dragover'].forEach(eventName => {
        musicDropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            musicDropzone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        musicDropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            musicDropzone.classList.remove('dragover');
        }, false);
    });

    musicDropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        if (dt.files.length) handleMusicFile(dt.files[0]);
    });

    musicInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleMusicFile(e.target.files[0]);
    });

    // Online URL / TikTok Video Link Extractor with Automatic TikTok API Resolver
    btnExtractUrl.addEventListener('click', async () => {
        const rawUrl = musicUrlInput.value.trim();
        if (!rawUrl) {
            alert('Vui lòng dán đường dẫn (URL) TikTok hoặc file âm thanh!');
            return;
        }
        btnExtractUrl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tự động tách nhạc TikTok...';

        try {
            // Check if input is a TikTok link (PC or Mobile link)
            if (rawUrl.includes('tiktok.com')) {
                const tiktokData = await extractTikTokAudioUrl(rawUrl);
                const mediaUrl = tiktokData.audioUrl;

                const arrayBuffer = await fetchAudioFromUrl(mediaUrl);
                storyProject.audioBase64 = arrayBufferToBase64(arrayBuffer);

                // Auto populate Note Title & Sub with extracted TikTok song info
                if (tiktokData.songTitle) {
                    noteTitleInput.value = tiktokData.songTitle;
                    storyProject.fbNote.title = tiktokData.songTitle;
                }
                if (tiktokData.artist) {
                    noteSubInput.value = tiktokData.artist;
                    storyProject.fbNote.sub = tiktokData.artist;
                }

                decodeAudioFromBuffer(arrayBuffer, (tiktokData.songTitle || 'TikTok_Music') + '.mp3');
                storyProject.tiktokVideoCaption = tiktokData.videoCaption || '';

                // TỰ ĐỘNG TÌM LỜI BÀI HÁT TỪ LINK TIKTOK THÔNG QUA SMART SEARCH ENGINE
                setTimeout(() => {
                    autoFetchAndSetLyrics(tiktokData.songTitle, tiktokData.artist, false, tiktokData.videoCaption);
                }, 300);
            } else {
                // Direct Audio/Video URL
                const arrayBuffer = await fetchAudioFromUrl(rawUrl);
                storyProject.audioBase64 = arrayBufferToBase64(arrayBuffer);
                decodeAudioFromBuffer(arrayBuffer, 'Audio_Trích_Xuất.mp3');
            }
        } catch (err) {
            alert('Không thể tự động tải nhạc từ link TikTok này (có thể do video riêng tư hoặc lỗi mạng).\n\n👉 CÁCH KHẮC PHỤC RẤT DỄ: Bạn chỉ cần tải Video TikTok đó về máy/điện thoại, sau đó KÉO THẢ FILE VIDEO ĐÓ VÀO KHUNG FILE NHẠC BÊN TRÊN — ứng dụng sẽ TỰ ĐỘNG TÁCH NHẠC 100% siêu mượt!');
        } finally {
            btnExtractUrl.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Lấy Nhạc';
        }
    });

    // Smart TikTok Video & Audio Extractor API Resolver (Supports PC & Mobile Links)
    async function extractTikTokAudioUrl(tiktokUrl) {
        const cleanUrl = tiktokUrl.trim();

        // 1. Try TikWM API
        try {
            const apiUrl = 'https://www.tikwm.com/api/?url=' + encodeURIComponent(cleanUrl);
            const res = await fetch(apiUrl);
            if (res.ok) {
                const json = await res.json();
                if (json && json.code === 0 && json.data) {
                    const audioUrl = json.data.music || json.data.music_info?.play || json.data.play;
                    const musicTitle = json.data.music_info?.title || '';
                    const videoCaption = json.data.title || '';
                    const artist = json.data.music_info?.author || json.data.author?.nickname || '';
                    const displayTitle = (musicTitle && !/^[a-zA-Z0-9_.-]+$/.test(musicTitle) && !musicTitle.includes('original sound')) 
                        ? musicTitle 
                        : (videoCaption || musicTitle || 'TikTok Audio');
                    if (audioUrl) {
                        return { audioUrl, songTitle: displayTitle, artist, videoCaption, musicTitle };
                    }
                }
            }
        } catch (e) {
            console.warn('TikWM API attempt failed, trying fallback...', e);
        }

        // 2. Try TiklyDown API Fallback
        try {
            const apiUrl2 = 'https://api.tiklydown.eu.org/api/download?url=' + encodeURIComponent(cleanUrl);
            const res = await fetch(apiUrl2);
            if (res.ok) {
                const json = await res.json();
                if (json && json.music && json.music.play_url) {
                    const audioUrl = json.music.play_url;
                    const musicTitle = json.music.title || '';
                    const videoCaption = json.title || '';
                    const artist = json.music.author || '';
                    const displayTitle = (musicTitle && !/^[a-zA-Z0-9_.-]+$/.test(musicTitle)) ? musicTitle : (videoCaption || musicTitle || 'TikTok Audio');
                    return { audioUrl, songTitle: displayTitle, artist, videoCaption, musicTitle };
                } else if (json && json.video && json.video.noWatermark) {
                    return { audioUrl: json.video.noWatermark, songTitle: json.title || 'TikTok Audio', artist: '', videoCaption: json.title, musicTitle: '' };
                }
            }
        } catch (e) {
            console.warn('TiklyDown API attempt failed...', e);
        }

        throw new Error('tiktok_api_failed');
    }

    async function fetchAudioFromUrl(inputUrl) {
        // 1. Direct fetch attempt
        try {
            const res = await fetch(inputUrl);
            if (res.ok) {
                const ct = res.headers.get('content-type') || '';
                if (ct.includes('text/html')) throw new Error('is_html_page');
                return await res.arrayBuffer();
            }
        } catch (e) {
            if (e.message === 'is_html_page') throw e;
        }

        // 2. CORS Proxy 1: corsproxy.io
        try {
            const proxy1 = 'https://corsproxy.io/?' + encodeURIComponent(inputUrl);
            const res = await fetch(proxy1);
            if (res.ok) {
                const ct = res.headers.get('content-type') || '';
                if (ct.includes('text/html')) throw new Error('is_html_page');
                return await res.arrayBuffer();
            }
        } catch (e) {
            if (e.message === 'is_html_page') throw e;
        }

        // 3. CORS Proxy 2: allorigins.win
        try {
            const proxy2 = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(inputUrl);
            const res = await fetch(proxy2);
            if (res.ok) {
                const ct = res.headers.get('content-type') || '';
                if (ct.includes('text/html')) throw new Error('is_html_page');
                return await res.arrayBuffer();
            }
        } catch (e) {
            if (e.message === 'is_html_page') throw e;
        }

        throw new Error('failed');
    }

    function initAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    async function handleMusicFile(file) {
        initAudioContext();
        storyProject.music.file = file;
        const cleanName = file.name.replace(/\.[^/.]+$/, "");
        storyProject.music.fileName = file.name;
        songFileName.textContent = file.name;

        // Auto update Note Title & Sub if user hasn't edited
        if (noteTitleInput.value === 'những câu chuyện ayi' || !noteTitleInput.value) {
            noteTitleInput.value = cleanName;
            storyProject.fbNote.title = cleanName;
        }

        const arrayBuffer = await file.arrayBuffer();
        storyProject.audioBase64 = arrayBufferToBase64(arrayBuffer);
        decodeAudioFromBuffer(arrayBuffer, file.name);

        // Auto search lyrics for dropped/selected music file
        setTimeout(() => {
            autoFetchAndSetLyrics(cleanName, '', false);
        }, 300);
    }

    function arrayBufferToBase64(buffer) {
        if (!buffer || buffer.byteLength === 0) return '';
        try {
            const bytes = new Uint8Array(buffer);
            let binary = '';
            const chunkSize = 0x8000;
            const maxBytes = Math.min(bytes.byteLength, 5 * 1024 * 1024);
            for (let i = 0; i < maxBytes; i += chunkSize) {
                const sub = bytes.subarray(i, Math.min(i + chunkSize, maxBytes));
                binary += String.fromCharCode.apply(null, sub);
            }
            return window.btoa(binary);
        } catch (e) {
            console.warn('Base64 conversion error:', e);
            return '';
        }
    }

    function decodeAudioFromBuffer(arrayBuffer, name) {
        initAudioContext();
        if (arrayBuffer) {
            storyProject.audioBase64 = arrayBufferToBase64(arrayBuffer);
        }
        audioCtx.decodeAudioData(arrayBuffer, (decodedBuffer) => {
            storyProject.music.audioBuffer = decodedBuffer;
            storyProject.music.duration = decodedBuffer.duration;
            songFileName.textContent = name;
            songDurationText.textContent = formatTime(decodedBuffer.duration);

            updateTimelineRanges();
            audioTimelineCard.style.display = 'block';
            drawWaveform(decodedBuffer);
            renderPreviewFrame(0);
        }, (err) => {
            alert('Lỗi đọc file âm thanh/video. Hãy thử định dạng MP3, WAV, M4A hoặc MP4!');
        });
    }

    function getEffectiveDuration() {
        if (storyProject.duration === 'full') {
            return storyProject.music.duration || 15;
        }
        return Math.min(storyProject.duration, storyProject.music.duration || storyProject.duration);
    }

    function updateTimelineRanges() {
        if (!storyProject.music.audioBuffer) return;
        const dur = getEffectiveDuration();
        const maxStart = Math.max(0, storyProject.music.duration - dur);

        startTimeRange.max = maxStart;
        if (parseFloat(startTimeRange.value) > maxStart) {
            startTimeRange.value = maxStart;
            storyProject.music.start = maxStart;
        }

        const start = parseFloat(startTimeRange.value) || 0;
        const end = Math.min(storyProject.music.duration, start + dur);

        startTimeVal.textContent = start.toFixed(1) + 's';
        endTimeVal.textContent = end.toFixed(1) + 's';
        storyDurVal.textContent = storyProject.duration === 'full' ? 'Toàn bài (' + Math.floor(storyProject.music.duration) + 's)' : storyProject.duration + 's';

        drawWaveform(storyProject.music.audioBuffer);
    }

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    // CapCut-Style Precision Interactive Waveform Scrubber with Dual Drag Handles
    function drawWaveform(buffer) {
        const canvas = msWaveformCanvas;
        const ctx = canvas.getContext('2d');
        const width = canvas.offsetWidth || 260;
        const height = canvas.offsetHeight || 64;
        canvas.width = width;
        canvas.height = height;

        const rawData = buffer.getChannelData(0);
        const samples = width;
        const blockSize = Math.floor(rawData.length / samples);
        const filteredData = [];

        for (let i = 0; i < samples; i++) {
            let blockStart = blockSize * i;
            let sum = 0;
            for (let j = 0; j < blockSize; j++) {
                sum += Math.abs(rawData[blockStart + j]);
            }
            filteredData.push(sum / blockSize);
        }

        ctx.clearRect(0, 0, width, height);

        // 1. Draw Inactive Base Waveform (Darker background bars)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
        const multiplier = Math.max(...filteredData);
        for (let i = 0; i < samples; i++) {
            const barHeight = Math.max(3, (filteredData[i] / multiplier) * height * 0.75);
            ctx.fillRect(i, (height - barHeight) / 2, 1, barHeight);
        }

        // 2. Active Selection Window Coordinates
        const startRatio = storyProject.music.start / storyProject.music.duration;
        const dur = getEffectiveDuration();
        const endRatio = Math.min(1.0, (storyProject.music.start + dur) / storyProject.music.duration);

        const startX = startRatio * width;
        const endX = endRatio * width;
        const boxW = Math.max(8, endX - startX);

        // 3. Highlighted Active Region Box Background & Borders
        ctx.fillStyle = 'rgba(99, 102, 241, 0.28)';
        ctx.fillRect(startX, 0, boxW, height);

        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(startX, 1, boxW, height - 2);

        // 4. Draw Highlighted Neon Waveform inside Active Cut Box
        ctx.fillStyle = '#ec4899';
        const startSampleIndex = Math.floor(startRatio * samples);
        const endSampleIndex = Math.floor(endRatio * samples);
        for (let i = startSampleIndex; i < endSampleIndex && i < samples; i++) {
            const barHeight = Math.max(3, (filteredData[i] / multiplier) * height * 0.82);
            ctx.fillRect(i, (height - barHeight) / 2, 1.5, barHeight);
        }

        // 5. CAPCUT DUAL HANDLES (Left Pill & Right Pill for Custom Duration Dragging)
        const handleW = 12;

        // Left Handle Pill Bar
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(startX - handleW / 2, 2, handleW, height - 4, 5);
        ctx.fill();
        // Left Handle Grip Lines
        ctx.fillStyle = '#4f46e5';
        ctx.fillRect(startX - 2, height / 2 - 7, 1.5, 14);
        ctx.fillRect(startX + 1, height / 2 - 7, 1.5, 14);

        // Right Handle Pill Bar
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(endX - handleW / 2, 2, handleW, height - 4, 5);
        ctx.fill();
        // Right Handle Grip Lines
        ctx.fillStyle = '#4f46e5';
        ctx.fillRect(endX - 2, height / 2 - 7, 1.5, 14);
        ctx.fillRect(endX + 1, height / 2 - 7, 1.5, 14);
    }

    // ── CAPCUT INTERACTIVE WAVEFORM DRAG & DROP ENGINE ──
    let waveformDragState = {
        isDragging: false,
        dragMode: null, // 'left' | 'right' | 'center'
        startX: 0,
        initialMusicStart: 0,
        initialDur: 0
    };

    function getCanvasX(e, canvas) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        return Math.max(0, Math.min(rect.width, clientX - rect.left));
    }

    function handleWaveformStart(e) {
        if (!storyProject.music.audioBuffer || !storyProject.music.duration) return;
        const canvas = msWaveformCanvas;
        const rect = canvas.getBoundingClientRect();
        const width = rect.width;
        const x = getCanvasX(e, canvas);

        const totalDur = storyProject.music.duration;
        const curStart = storyProject.music.start;
        const curDur = getEffectiveDuration();
        const curEnd = Math.min(totalDur, curStart + curDur);

        const startX = (curStart / totalDur) * width;
        const endX = (curEnd / totalDur) * width;

        const touchMargin = 16;
        let mode = null;

        if (Math.abs(x - startX) <= touchMargin) {
            mode = 'left';
        } else if (Math.abs(x - endX) <= touchMargin) {
            mode = 'right';
        } else if (x > startX && x < endX) {
            mode = 'center';
        } else {
            // Click outside box: center active window at click location
            const clickedTime = (x / width) * totalDur;
            const newStart = Math.max(0, Math.min(totalDur - curDur, clickedTime - curDur / 2));
            storyProject.music.start = newStart;
            mode = 'center';
        }

        waveformDragState = {
            isDragging: true,
            dragMode: mode,
            startX: x,
            initialMusicStart: storyProject.music.start,
            initialDur: curDur
        };

        if (e.type === 'touchstart') e.preventDefault();
        updateTimelineRanges();
        renderPreviewFrame(0);
    }

    function handleWaveformMove(e) {
        if (!storyProject.music.audioBuffer) return;
        const canvas = msWaveformCanvas;
        const width = canvas.offsetWidth || 260;
        const x = getCanvasX(e, canvas);

        const totalDur = storyProject.music.duration;
        const curStart = storyProject.music.start;
        const curDur = getEffectiveDuration();
        const curEnd = Math.min(totalDur, curStart + curDur);

        const startX = (curStart / totalDur) * width;
        const endX = (curEnd / totalDur) * width;

        // Hover cursor styling
        if (!waveformDragState.isDragging) {
            if (Math.abs(x - startX) <= 14 || Math.abs(x - endX) <= 14) {
                canvas.style.cursor = 'ew-resize';
            } else if (x > startX && x < endX) {
                canvas.style.cursor = 'grab';
            } else {
                canvas.style.cursor = 'pointer';
            }
            return;
        }

        const deltaX = x - waveformDragState.startX;
        const deltaTime = (deltaX / width) * totalDur;

        if (waveformDragState.dragMode === 'left') {
            canvas.style.cursor = 'ew-resize';
            const fixedEnd = waveformDragState.initialMusicStart + waveformDragState.initialDur;
            let newStart = Math.max(0, Math.min(fixedEnd - 1, waveformDragState.initialMusicStart + deltaTime));
            let newDur = Math.max(1, fixedEnd - newStart);

            storyProject.music.start = newStart;
            storyProject.duration = Math.round(newDur * 10) / 10;
        } else if (waveformDragState.dragMode === 'right') {
            canvas.style.cursor = 'ew-resize';
            let newEnd = Math.min(totalDur, Math.max(storyProject.music.start + 1, waveformDragState.initialMusicStart + waveformDragState.initialDur + deltaTime));
            let newDur = Math.max(1, newEnd - storyProject.music.start);

            storyProject.duration = Math.round(newDur * 10) / 10;
        } else if (waveformDragState.dragMode === 'center') {
            canvas.style.cursor = 'grabbing';
            let newStart = Math.max(0, Math.min(totalDur - waveformDragState.initialDur, waveformDragState.initialMusicStart + deltaTime));
            storyProject.music.start = newStart;
        }

        syncDurationPresetButtons();
        updateTimelineRanges();
        renderPreviewFrame(0);
    }

    function handleWaveformEnd() {
        if (waveformDragState.isDragging) {
            waveformDragState.isDragging = false;
            msWaveformCanvas.style.cursor = 'pointer';
        }
    }

    function syncDurationPresetButtons() {
        const curDur = getEffectiveDuration();
        document.querySelectorAll('#storyDurGroup .ms-seg-btn').forEach(btn => {
            const attr = btn.getAttribute('data-dur');
            if (attr === 'full' && storyProject.duration === 'full') {
                btn.classList.add('active');
            } else if (parseFloat(attr) === Math.round(curDur)) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    msWaveformCanvas.addEventListener('mousedown', handleWaveformStart);
    window.addEventListener('mousemove', handleWaveformMove);
    window.addEventListener('mouseup', handleWaveformEnd);

    msWaveformCanvas.addEventListener('touchstart', handleWaveformStart, { passive: false });
    window.addEventListener('touchmove', handleWaveformMove, { passive: false });
    window.addEventListener('touchend', handleWaveformEnd);

    // Story Duration Segment Buttons (5s, 10s, 15s, 30s, 60s, Toàn bài)
    document.querySelectorAll('#storyDurGroup .ms-seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#storyDurGroup .ms-seg-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const durAttr = btn.getAttribute('data-dur');

            if (durAttr === 'full') {
                storyProject.duration = 'full';
            } else {
                storyProject.duration = parseInt(durAttr, 10);
            }

            updateTimelineRanges();
            renderPreviewFrame(0);
        });
    });

    startTimeRange.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        storyProject.music.start = val;
        updateTimelineRanges();

        if (isPlayingPreview) {
            playAudioPreview();
        } else {
            renderPreviewFrame(0);
        }
    });

    btnPlayMusicPreview.addEventListener('click', () => {
        if (isPlayingPreview) {
            stopAudioPreview();
        } else {
            playAudioPreview();
        }
    });

    function playAudioPreview() {
        if (!storyProject.music.audioBuffer) return;
        initAudioContext();
        stopAudioPreview();

        audioBufferSource = audioCtx.createBufferSource();
        audioBufferSource.buffer = storyProject.music.audioBuffer;

        analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 128;

        audioBufferSource.connect(analyserNode);
        analyserNode.connect(audioCtx.destination);

        const startTime = storyProject.music.start;
        const dur = getEffectiveDuration();
        audioBufferSource.start(0, startTime, dur);

        isPlayingPreview = true;
        btnPlayMusicPreview.innerHTML = '<i class="fa-solid fa-pause"></i>';
        previewStartTime = audioCtx.currentTime;

        audioBufferSource.onended = () => {
            stopAudioPreview();
        };

        animatePreviewLoop();
    }

    function stopAudioPreview() {
        if (audioBufferSource) {
            try { audioBufferSource.stop(); } catch (e) { }
            audioBufferSource = null;
        }
        isPlayingPreview = false;
        btnPlayMusicPreview.innerHTML = '<i class="fa-solid fa-play"></i>';
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        renderPreviewFrame(0);
    }

    function animatePreviewLoop() {
        if (!isPlayingPreview) return;
        const elapsed = audioCtx.currentTime - previewStartTime;
        const dur = getEffectiveDuration();
        if (elapsed > dur) {
            stopAudioPreview();
            return;
        }
        renderPreviewFrame(elapsed);
        animationFrameId = requestAnimationFrame(animatePreviewLoop);
    }

    // ── 3. FB NOTE FORM CONTROLS ──
    noteTitleInput.addEventListener('input', (e) => {
        storyProject.fbNote.title = e.target.value || '';
        renderPreviewFrame(0);
    });

    noteSubInput.addEventListener('input', (e) => {
        storyProject.fbNote.sub = e.target.value || '';
        renderPreviewFrame(0);
    });

    if (noteTextExtraInput) {
        noteTextExtraInput.addEventListener('input', (e) => {
            storyProject.fbNote.noteText = e.target.value || '';
            renderPreviewFrame(0);
        });
    }

    if (stickerImgInput) {
        stickerImgInput.addEventListener('change', (e) => {
            if (e.target.files.length) {
                Array.from(e.target.files).forEach(file => {
                    const url = URL.createObjectURL(file);
                    const img = new Image();
                    const stickerId = 'stk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                    img.onload = () => {
                        storyProject.fbNote.stickers.push({
                            id: stickerId,
                            url: url,
                            imgElement: img
                        });
                        renderStickersListUI();
                        renderPreviewFrame(0);
                    };
                    img.src = url;
                });
                stickerImgInput.value = '';
            }
        });
    }

    function renderStickersListUI() {
        if (!stickersListWrap) return;
        if (!storyProject.fbNote.stickers || storyProject.fbNote.stickers.length === 0) {
            stickersListWrap.style.display = 'none';
            stickersListWrap.innerHTML = '';
            return;
        }

        stickersListWrap.style.display = 'flex';
        stickersListWrap.innerHTML = storyProject.fbNote.stickers.map((stk, idx) => `
            <div style="display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.08); padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.15);">
                <img src="${stk.url}" style="width: 26px; height: 26px; object-fit: cover; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2);">
                <span style="font-size:0.75rem; color: var(--ms-primary); font-weight: 600;">Sticker ${idx + 1}</span>
                <button type="button" onclick="removeStickerById('${stk.id}')" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:0.85rem; padding:0 2px;"><i class="fa-solid fa-xmark"></i></button>
            </div>
        `).join('');
    }

    window.removeStickerById = function(id) {
        storyProject.fbNote.stickers = (storyProject.fbNote.stickers || []).filter(s => s.id !== id);
        renderStickersListUI();
        renderPreviewFrame(0);
    };

    document.querySelectorAll('#noteColorSwatches .ms-color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#noteColorSwatches .ms-color-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const color = btn.getAttribute('data-color');
            storyProject.fbNote.bgColor = color;
            renderPreviewFrame(0);
        });
    });

    noteBgColorCustom.addEventListener('input', (e) => {
        document.querySelectorAll('#noteColorSwatches .ms-color-btn').forEach(b => b.classList.remove('active'));
        storyProject.fbNote.bgColor = e.target.value;
        renderPreviewFrame(0);
    });

    if (scrollCharThresholdRange) {
        scrollCharThresholdRange.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            storyProject.scrollCharThreshold = val;
            if (scrollCharThresholdVal) scrollCharThresholdVal.textContent = val;
            renderPreviewFrame(0);
        });
    }

    if (toggleNoteBadge) {
        toggleNoteBadge.addEventListener('change', (e) => {
            storyProject.showNoteBadge = e.target.checked;
            renderPreviewFrame(0);
        });
    }

    // ── 3.5. MOVIE END FORM CONTROLS & TIMED KARAOKE LYRICS ENGINE ──
    function parseLrcOrPlainLyrics(rawText, defaultDuration) {
        if (!rawText) return [];
        const lines = rawText.split('\n');
        const parsed = [];

        const lrcRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)/;
        let hasLrcTimestamp = false;

        lines.forEach((lineStr) => {
            const trimmed = lineStr.trim();
            if (!trimmed) return;
            const match = trimmed.match(lrcRegex);
            if (match) {
                hasLrcTimestamp = true;
                const min = parseInt(match[1], 10);
                const sec = parseInt(match[2], 10);
                const msStr = match[3] || '0';
                const ms = msStr.length === 2 ? parseInt(msStr, 10) / 100 : parseInt(msStr, 10) / 1000;
                const totalSeconds = min * 60 + sec + ms;
                const textContent = match[4] ? match[4].trim() : '';
                if (textContent) {
                    parsed.push({ time: totalSeconds, text: textContent });
                }
            }
        });

        if (hasLrcTimestamp && parsed.length > 0) {
            return parsed.sort((a, b) => a.time - b.time);
        }

        // If plain text (no LRC timestamps), divide duration evenly!
        const nonBlankLines = lines.map(l => l.trim()).filter(l => l.length > 0);
        if (nonBlankLines.length === 0) return [];

        const dur = Math.max(3, defaultDuration || 15);
        const step = dur / nonBlankLines.length;

        nonBlankLines.forEach((text, idx) => {
            parsed.push({
                time: idx * step,
                text: text
            });
        });

        return parsed;
    }

    function formatSecondsToLrc(sec) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        const ms = Math.floor((sec % 1) * 100);
        const mmStr = m < 10 ? '0' + m : '' + m;
        const ssStr = s < 10 ? '0' + s : '' + s;
        const msStr = ms < 10 ? '0' + ms : '' + ms;
        return `[${mmStr}:${ssStr}.${msStr}]`;
    }

    document.querySelectorAll('#movieLyricsModeGroup .ms-seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#movieLyricsModeGroup .ms-seg-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            storyProject.movieEnd.lyricsMode = btn.getAttribute('data-lmode');
            renderPreviewFrame(0);
        });
    });

    if (movieTitleInput) {
        movieTitleInput.addEventListener('input', (e) => {
            storyProject.movieEnd.title = e.target.value;
            renderPreviewFrame(0);
        });
    }

    const movieActiveColorInput = $('movieActiveColorInput');
    if (movieActiveColorInput) {
        movieActiveColorInput.addEventListener('input', (e) => {
            storyProject.movieEnd.activeColor = e.target.value;
            renderPreviewFrame(0);
        });
    }

    const movieInactiveColorInput = $('movieInactiveColorInput');
    if (movieInactiveColorInput) {
        movieInactiveColorInput.addEventListener('input', (e) => {
            storyProject.movieEnd.inactiveColor = e.target.value;
            renderPreviewFrame(0);
        });
    }

    const movieActiveGlowSizeRange = $('movieActiveGlowSizeRange');
    if (movieActiveGlowSizeRange) {
        movieActiveGlowSizeRange.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            storyProject.movieEnd.activeGlowSize = val;
            const disp = $('valActiveGlowSize');
            if (disp) disp.textContent = val + 'px';
            renderPreviewFrame(0);
        });
    }

    const movieActiveFontSizeRange = $('movieActiveFontSizeRange');
    if (movieActiveFontSizeRange) {
        movieActiveFontSizeRange.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            storyProject.movieEnd.activeFontSize = val;
            const disp = $('valActiveFontSize');
            if (disp) disp.textContent = val + 'px';
            renderPreviewFrame(0);
        });
    }

    const movieInactiveFontSizeRange = $('movieInactiveFontSizeRange');
    if (movieInactiveFontSizeRange) {
        movieInactiveFontSizeRange.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            storyProject.movieEnd.inactiveFontSize = val;
            const disp = $('valInactiveFontSize');
            if (disp) disp.textContent = val + 'px';
            renderPreviewFrame(0);
        });
    }

    const movieFontFamilySelect = $('movieFontFamilySelect');
    if (movieFontFamilySelect) {
        movieFontFamilySelect.addEventListener('change', (e) => {
            storyProject.movieEnd.fontFamily = e.target.value;
            renderPreviewFrame(0);
        });
    }

    document.querySelectorAll('#movieTextAlignGroup .ms-seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#movieTextAlignGroup .ms-seg-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            storyProject.movieEnd.textAlign = btn.getAttribute('data-align');
            renderPreviewFrame(0);
        });
    });

    const movieTitleYRange = $('movieTitleYRange');
    if (movieTitleYRange) {
        movieTitleYRange.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            storyProject.movieEnd.titleY = val;
            const disp = $('valTitleY');
            if (disp) disp.textContent = val + 'px';
            renderPreviewFrame(0);
        });
    }

    const movieLyricsYRange = $('movieLyricsYRange');
    if (movieLyricsYRange) {
        movieLyricsYRange.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            storyProject.movieEnd.lyricsY = val;
            const disp = $('valLyricsY');
            if (disp) disp.textContent = val + 'px';
            renderPreviewFrame(0);
        });
    }

    const movieLyricsWidthRange = $('movieLyricsWidthRange');
    if (movieLyricsWidthRange) {
        movieLyricsWidthRange.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            storyProject.movieEnd.lyricsWidth = val;
            const disp = $('valLyricsW');
            if (disp) disp.textContent = val + 'px';
            renderPreviewFrame(0);
        });
    }

    const movieLyricsHeightRange = $('movieLyricsHeightRange');
    if (movieLyricsHeightRange) {
        movieLyricsHeightRange.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            storyProject.movieEnd.lyricsHeight = val;
            const disp = $('valLyricsH');
            if (disp) disp.textContent = val + 'px';
            renderPreviewFrame(0);
        });
    }

    document.querySelectorAll('#movieTitleStyleGroup .ms-seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#movieTitleStyleGroup .ms-seg-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            storyProject.movieEnd.titleStyle = btn.getAttribute('data-style');
            renderPreviewFrame(0);
        });
    });

    // 🖐️ 2026 INTERACTIVE CANVAS DRAGGING FOR TITLE & 4-SIDE LYRICS BOUNDING BOX
    let isDraggingCanvas = false;
    let dragTarget = null; // 'title' | 'lyrics'
    let dragStartY = 0;
    let initialTargetY = 0;

    const mainCanvas = $('mainCanvas');
    if (mainCanvas) {
        mainCanvas.style.cursor = 'grab';

        const getCanvasCoords = (e) => {
            const rect = mainCanvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            const scaleY = 1920 / rect.height;
            const scaleX = 1080 / rect.width;
            return {
                x: (clientX - rect.left) * scaleX,
                y: (clientY - rect.top) * scaleY
            };
        };

        const handleStart = (e) => {
            if (storyProject.mode !== 'movie_end') return;
            const pos = getCanvasCoords(e);
            const me = storyProject.movieEnd;

            // Check if click is near title
            const titleY = me.titleY !== undefined ? me.titleY : 310;
            if (Math.abs(pos.y - titleY) < 90) {
                isDraggingCanvas = true;
                dragTarget = 'title';
                dragStartY = pos.y;
                initialTargetY = titleY;
                mainCanvas.style.cursor = 'grabbing';
                return;
            }

            // Check if click is near lyrics box
            const lyricsY = me.lyricsY !== undefined ? me.lyricsY : 1080;
            const boxH = me.lyricsHeight || 650;
            if (Math.abs(pos.y - lyricsY) < boxH / 2 + 60) {
                isDraggingCanvas = true;
                dragTarget = 'lyrics';
                dragStartY = pos.y;
                initialTargetY = lyricsY;
                mainCanvas.style.cursor = 'grabbing';
                return;
            }
        };

        const handleMove = (e) => {
            if (!isDraggingCanvas || storyProject.mode !== 'movie_end') return;
            e.preventDefault();
            const pos = getCanvasCoords(e);
            const deltaY = Math.round(pos.y - dragStartY);

            if (dragTarget === 'title') {
                const newY = Math.max(80, Math.min(800, initialTargetY + deltaY));
                storyProject.movieEnd.titleY = newY;
                const r = $('movieTitleYRange');
                const v = $('valTitleY');
                if (r) r.value = newY;
                if (v) v.textContent = newY + 'px';
            } else if (dragTarget === 'lyrics') {
                const newY = Math.max(400, Math.min(1700, initialTargetY + deltaY));
                storyProject.movieEnd.lyricsY = newY;
                const r = $('movieLyricsYRange');
                const v = $('valLyricsY');
                if (r) r.value = newY;
                if (v) v.textContent = newY + 'px';
            }

            renderPreviewFrame(0);
        };

        const handleEnd = () => {
            isDraggingCanvas = false;
            dragTarget = null;
            if (mainCanvas) mainCanvas.style.cursor = 'grab';
        };

        mainCanvas.addEventListener('mousedown', handleStart);
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleEnd);

        mainCanvas.addEventListener('touchstart', handleStart, { passive: false });
        window.addEventListener('touchmove', handleMove, { passive: false });
        window.addEventListener('touchend', handleEnd);
    }

    if (movieCreditsInput) {
        movieCreditsInput.addEventListener('input', (e) => {
            storyProject.movieEnd.creditsText = e.target.value || '';
            renderPreviewFrame(0);
        });
    }

    document.querySelectorAll('#hdSharpnessGroup .ms-seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#hdSharpnessGroup .ms-seg-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            storyProject.hdStory.sharpness = btn.getAttribute('data-sharp');
            renderPreviewFrame(0);
        });
    });

    document.querySelectorAll('#hdBadgeStyleGroup .ms-seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#hdBadgeStyleGroup .ms-seg-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            storyProject.hdStory.badgeStyle = btn.getAttribute('data-badge');
            renderPreviewFrame(0);
        });
    });

    if (btnAutoSyncTimestamps) {
        btnAutoSyncTimestamps.addEventListener('click', () => {
            const raw = movieCreditsInput ? movieCreditsInput.value : '';
            const plainLines = raw.split('\n')
                .map(l => l.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim())
                .filter(l => l.length > 0);

            if (plainLines.length === 0) {
                alert('Vui lòng nhập các dòng lời bài hát vào khung trước!');
                return;
            }

            const dur = getEffectiveDuration();
            const step = dur / plainLines.length;

            const lrcLines = plainLines.map((text, idx) => {
                const timeSec = idx * step;
                return `${formatSecondsToLrc(timeSec)} ${text}`;
            });

            const newText = lrcLines.join('\n');
            if (movieCreditsInput) movieCreditsInput.value = newText;
            storyProject.movieEnd.creditsText = newText;
            renderPreviewFrame(0);
        });
    }

    // Smart Query Cleaner for TikTok audio metadata & Video Captions
    function sanitizeSongQuery(title, artist, videoCaption = '') {
        const isUsernameOrId = /^[a-zA-Z0-9_.-]+$/.test((title || '').trim()) || 
                               /original sound|nhạc nền|âm thanh gốc|sound/gi.test(title || '');

        let combined = '';
        if (isUsernameOrId && videoCaption) {
            combined = videoCaption;
        } else {
            combined = (title || '') + ' ' + (artist || '') + ' ' + (videoCaption || '');
        }

        let clean = combined.replace(/nhạc nền\s*[-–—:]?/gi, '')
                            .replace(/original sound\s*[-–—:]?/gi, '')
                            .replace(/âm thanh gốc\s*[-–—:]?/gi, '')
                            .replace(/sound\s*[-–—:]?/gi, '')
                            .replace(/@[\w._]+/g, '')
                            .replace(/#[\w_]+/gi, '')
                            .replace(/official audio|official video|official mv|full mp3|320kbps|\.mp3|\.wav|\.m4a/gi, '')
                            .replace(/vt|tiktok|capcut|trend|stt|lyrics/gi, '')
                            .replace(/\s+/g, ' ')
                            .trim();

        // Limit length to first 6 meaningful words for API search accuracy
        const words = clean.split(' ').filter(w => w.length > 0);
        if (words.length > 6) {
            clean = words.slice(0, 6).join(' ');
        }
        return clean;
    }

    async function autoFetchAndSetLyrics(rawTitle, rawArtist, isManualClick = false, videoCaption = '') {
        const cleanQuery = sanitizeSongQuery(rawTitle, rawArtist, videoCaption);
        const captionQuery = videoCaption ? videoCaption.replace(/#[\w_]+/gi, '').replace(/@[\w._]+/g, '').trim() : '';
        const altQuery = (rawTitle || '').replace(/#[\w_]+/gi, '').replace(/@[\w._]+/g, '').trim();

        const queriesToTry = [];
        if (cleanQuery) queriesToTry.push(cleanQuery);
        if (captionQuery && !queriesToTry.includes(captionQuery)) queriesToTry.push(captionQuery);
        if (altQuery && !queriesToTry.includes(altQuery) && !/^[a-zA-Z0-9_.-]+$/.test(altQuery)) queriesToTry.push(altQuery);

        let foundLyrics = null;
        let foundTrackInfo = '';

        for (const query of queriesToTry) {
            if (!query || query.length < 2) continue;
            try {
                const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data) && data.length > 0) {
                        const match = data.find(item => item.syncedLyrics) || data[0];
                        if (match.syncedLyrics || match.plainLyrics) {
                            foundLyrics = match.syncedLyrics || match.plainLyrics;
                            foundTrackInfo = `${match.trackName} - ${match.artistName}`;
                            break;
                        }
                    }
                }
            } catch (e) {
                console.warn('LRCLIB query failed for:', query, e);
            }
        }

        if (foundLyrics) {
            if (movieCreditsInput) movieCreditsInput.value = foundLyrics;
            storyProject.movieEnd.creditsText = foundLyrics;
            renderPreviewFrame(0);
            if (isManualClick) {
                alert(`✨ Đã tìm thấy lời đồng bộ cho "${foundTrackInfo}"!`);
            }
            return true;
        }

        // Try extracting lyrics lines directly from video caption if available!
        if (videoCaption) {
            const captionLines = videoCaption
                .split(/[\n,.;|]/)
                .map(l => l.replace(/#[\w_]+/g, '').replace(/@[\w._]+/g, '').trim())
                .filter(l => l.length > 4 && !l.includes('http'));

            if (captionLines.length >= 2) {
                const dur = getEffectiveDuration();
                const step = dur / captionLines.length;
                const lrcText = captionLines.map((t, i) => `${formatSecondsToLrc(i * step)} ${t}`).join('\n');
                if (movieCreditsInput) movieCreditsInput.value = lrcText;
                storyProject.movieEnd.creditsText = lrcText;
                renderPreviewFrame(0);
                return true;
            }
        }

        // 🤖 3. AI GEMINI SPEECH-TO-TEXT & AUTOMATIC LYRICS GENERATOR FALLBACK
        try {
            const aiRes = await fetch('/api/ai-lyrics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    songTitle: rawTitle,
                    artist: rawArtist,
                    videoCaption: videoCaption || storyProject.tiktokVideoCaption || '',
                    duration: getEffectiveDuration(),
                    audioBase64: storyProject.audioBase64 || '',
                    audioMime: 'audio/mp3'
                })
            });

            if (aiRes.ok) {
                const aiData = await aiRes.json();
                if (aiData.success && aiData.lyrics) {
                    if (movieCreditsInput) movieCreditsInput.value = aiData.lyrics;
                    storyProject.movieEnd.creditsText = aiData.lyrics;

                    if (aiData.songTitle) {
                        const parts = aiData.songTitle.split('-');
                        const mainTitle = parts[0].trim();
                        const artistName = parts[1] ? parts[1].trim() : '';
                        if (noteTitleInput) noteTitleInput.value = mainTitle;
                        storyProject.fbNote.title = mainTitle;
                        if (artistName && noteSubInput) {
                            noteSubInput.value = artistName;
                            storyProject.fbNote.sub = artistName;
                        }
                    }

                    renderPreviewFrame(0);
                    return true;
                }
            }
        } catch (err) {
            console.warn('AI Lyrics API Call Failed:', err);
        }

        // 🎵 4. UNIVERSAL AUTOMATIC KARAOKE GENERATOR (NO POPUPS / NO ALERTS AT ALL)
        const dur = getEffectiveDuration();
        const displaySong = cleanQuery || (rawTitle && !/^[a-zA-Z0-9_.-]+$/.test(rawTitle) ? rawTitle : 'Giai Điệu TikTok');
        const autoLines = [
            `[00:00.00] 🎵 ${displaySong}`,
            `[00:03.00] 🎧 Lắng nghe giai điệu âm nhạc...`,
            `[00:07.00] ✨ ${videoCaption ? videoCaption.slice(0, 45) : 'Thanh xuân & Kỷ niệm qua từng nốt nhạc'}`,
            `[00:12.00] ❤️ Giai điệu chạm vào cảm xúc`,
            `[00:16.00] 🌟 Music Story Generator`
        ];
        const autoLrc = autoLines.join('\n');
        if (movieCreditsInput) movieCreditsInput.value = autoLrc;
        storyProject.movieEnd.creditsText = autoLrc;
        renderPreviewFrame(0);
        return true;
    }

    if (btnFetchLrcLyrics) {
        btnFetchLrcLyrics.addEventListener('click', async () => {
            const trackName = storyProject.fbNote.title || storyProject.song.title || '';
            const artistName = storyProject.fbNote.sub || storyProject.song.artist || '';
            const caption = storyProject.tiktokVideoCaption || '';

            btnFetchLrcLyrics.disabled = true;
            btnFetchLrcLyrics.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tìm lời...';

            try {
                await autoFetchAndSetLyrics(trackName, artistName, true, caption);
            } finally {
                btnFetchLrcLyrics.disabled = false;
                btnFetchLrcLyrics.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Tự Tìm Lời Bài Hát (LRCLib)';
            }
        });
    }

    if (btnFillSampleCredits) {
        btnFillSampleCredits.addEventListener('click', () => {
            const songName = storyProject.fbNote.title || 'Life Goes On';
            const artistName = storyProject.fbNote.sub || 'BTS';
            const sampleText = `[00:00.00] ${songName} - ${artistName}\n[00:02.50] One day the world stopped\n[00:05.50] Without any warning\n[00:08.50] Spring didn't know to wait\n[00:11.50] Showed up not even a minute late\n[00:14.50] Like an echo in the forest\n[00:17.50] Yeah life goes on...`;
            if (movieCreditsInput) movieCreditsInput.value = sampleText;
            storyProject.movieEnd.creditsText = sampleText;
            renderPreviewFrame(0);
        });
    }

    if (toggleMovieLetterbox) {
        toggleMovieLetterbox.addEventListener('change', (e) => {
            storyProject.movieEnd.showLetterbox = e.target.checked;
            renderPreviewFrame(0);
        });
    }

    if (toggleMovieDust) {
        toggleMovieDust.addEventListener('change', (e) => {
            storyProject.movieEnd.showDust = e.target.checked;
            renderPreviewFrame(0);
        });
    }

    if (toggleMovieKenBurns) {
        toggleMovieKenBurns.addEventListener('change', (e) => {
            storyProject.movieEnd.showKenBurns = e.target.checked;
            renderPreviewFrame(0);
        });
    }

    if (movieDarknessRange) {
        movieDarknessRange.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            storyProject.movieEnd.darkness = val / 100;
            if (movieDarknessVal) movieDarknessVal.textContent = val;
            renderPreviewFrame(0);
        });
    }

    // ── 4. REALTIME CANVAS RENDERER (1080 x 1920) ──
    function renderPreviewFrame(currentTime) {
        const W = 1080;
        const H = 1920;
        const ctx = previewCtx;

        ctx.clearRect(0, 0, W, H);

        if (storyProject.mode === 'fb_note') {
            drawFbNoteStory(ctx, W, H, currentTime);
        } else if (storyProject.mode === 'movie_end') {
            drawMovieEndStory(ctx, W, H, currentTime);
        } else if (storyProject.mode === 'hd_story') {
            drawHdStory(ctx, W, H, currentTime);
        } else {
            drawModernMinimalStory(ctx, W, H, currentTime);
        }
    }

    // ── CLEAN FB MUSIC NOTE STORY RENDERER (AUTHENTIC DYNAMIC AUTO-SIZING FB NOTE) ──
    function drawFbNoteStory(ctx, W, H, t) {
        // A. BLURRED BACKGROUND (Avatar / Video blurred)
        ctx.save();
        if (storyProject.background.imgElement) {
            ctx.filter = 'blur(45px) brightness(0.65)';
            drawCoverImage(ctx, storyProject.background.imgElement, W, H);
            ctx.filter = 'none';
        } else if (storyProject.background.videoElement) {
            ctx.filter = 'blur(45px) brightness(0.65)';
            drawCoverImage(ctx, storyProject.background.videoElement, W, H);
            ctx.filter = 'none';
        } else {
            const bgGrad = ctx.createLinearGradient(0, 0, W, H);
            bgGrad.addColorStop(0, '#2c241c');
            bgGrad.addColorStop(1, '#120f0c');
            ctx.fillStyle = bgGrad;
            ctx.fillRect(0, 0, W, H);
        }
        ctx.restore();

        // Soft Radial Vignette
        const vGrad = ctx.createRadialGradient(W / 2, H / 2, W * 0.25, W / 2, H / 2, H * 0.75);
        vGrad.addColorStop(0, 'rgba(0, 0, 0, 0.15)');
        vGrad.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
        ctx.fillStyle = vGrad;
        ctx.fillRect(0, 0, W, H);

        // B. CENTER CIRCULAR AVATAR (PROPORTIONAL COVER FIT - NO SQUISHING!)
        const avatarCenterX = W / 2;
        const avatarCenterY = H / 2 + 100;
        const avatarRadius = 240; // 480px Diameter

        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarCenterX, avatarCenterY, avatarRadius, 0, Math.PI * 2);
        ctx.clip();

        if (storyProject.background.imgElement) {
            drawCircularImage(ctx, storyProject.background.imgElement, avatarCenterX, avatarCenterY, avatarRadius);
        } else if (storyProject.background.videoElement) {
            drawCircularImage(ctx, storyProject.background.videoElement, avatarCenterX, avatarCenterY, avatarRadius);
        }
        ctx.restore();

        // Thick White Border Ring around Circular Avatar (Fix #2: Increased to 22px)
        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarCenterX, avatarCenterY, avatarRadius, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 22;
        ctx.stroke();
        ctx.restore();

        // C. DYNAMIC SPEECH BUBBLE / THOUGHT NOTE (AUTHENTIC SHIFTED FB NOTE BUBBLE)
        const songTitle = storyProject.fbNote.title || '';     // Line 1: Song Title
        const artistName = storyProject.fbNote.sub || '';      // Line 2: Artist Name
        const moodNoteText = storyProject.fbNote.noteText || ''; // Line 3: Custom Mood Note (Optional)

        // Line 1 (32px 500), Line 2 (32px 300), Line 3 (44px 400 - slightly reduced & balanced)
        const fbFontLine1 = '500 32px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Roboto, sans-serif';
        const fbFontLine2 = '300 32px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Roboto, sans-serif';
        const fbFontLine3 = '400 44px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Segoe UI", Roboto, sans-serif';

        // Measure line widths
        ctx.font = fbFontLine1;
        const waveW = 28;
        const gapBetween = 12;
        const line1TextW = ctx.measureText(songTitle).width;
        const line1TotalW = waveW + gapBetween + line1TextW;

        ctx.font = fbFontLine2;
        const line2W = artistName ? ctx.measureText(artistName).width : 0;

        let line3W = 0;
        const stickers = storyProject.fbNote.stickers || [];
        const hasStickers = stickers.length > 0;
        const hasLine3Text = Boolean(moodNoteText.trim());
        const hasLine3 = hasLine3Text || hasStickers;

        const stickerSize = (hasLine3Text || stickers.length > 2) ? 52 : 60;
        const stickerGap = 10;
        const stickersTotalW = hasStickers ? (stickers.length * stickerSize + (stickers.length - 1) * stickerGap) : 0;

        if (hasLine3) {
            ctx.font = fbFontLine3;
            const textW = hasLine3Text ? ctx.measureText(moodNoteText).width : 0;
            line3W = textW + (hasStickers ? (hasLine3Text ? 14 : 0) + stickersTotalW : 0);
        }

        const maxContentW = Math.max(line1TotalW, line2W, line3W);

        // Dynamic Bubble Width & Height (Max bubble width expanded to 860px for multiple stickers)
        const minBubbleW = 520;
        const maxBubbleW = 860;
        const bubbleW = Math.max(minBubbleW, Math.min(maxBubbleW, Math.round(maxContentW + 140)));
        const bubbleH = hasLine3 ? 245 : 175;

        // Shift bubble left by 75px relative to center avatar
        const bubbleX = ((W - bubbleW) / 2) - 75;
        const bubbleY = avatarCenterY - avatarRadius - bubbleH - 45;
        const bubbleRadius = 54;

        ctx.save();
        // Bubble Fill (Slightly lighter background)
        ctx.fillStyle = storyProject.fbNote.bgColor;
        ctx.beginPath();
        ctx.roundRect(bubbleX, bubbleY, bubbleW, bubbleH, bubbleRadius);
        ctx.fill();

        // 2-Dot Tail Placement (Upper dot center right at bubble bottom edge so exactly 50% shows)
        ctx.beginPath();
        ctx.arc(bubbleX + 140, bubbleY + bubbleH, 29, 0, Math.PI * 2); // Upper Large Dot (50% Exposed)
        ctx.fill();

        ctx.beginPath();
        ctx.arc(bubbleX + 185, bubbleY + bubbleH + 36, 17, 0, Math.PI * 2); // Lower Small Dot
        ctx.fill();

        // INSIDE SPEECH BUBBLE CONTENT
        // LINE 1 (TOP): Audio Wave Icon `|||` + Song Title (Fixed anchor Y=68)
        ctx.font = fbFontLine1;
        const maxLine1TextW = bubbleW - 80 - waveW - gapBetween;
        const line1Y = bubbleY + 68;

        const shouldScrollLine1 = (songTitle.length >= storyProject.scrollCharThreshold) || (line1TextW > maxLine1TextW);
        if (!shouldScrollLine1) {
            // Centered layout inside shifted bubble
            const line1StartX = bubbleX + (bubbleW - line1TotalW) / 2;

            // Audio wave icon
            ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
            const barHeights = [
                18 + Math.sin(t * 8) * 8,
                28 + Math.cos(t * 8) * 10,
                20 + Math.sin(t * 10) * 8
            ];
            barHeights.forEach((h, idx) => {
                ctx.fillRect(line1StartX + idx * 9, line1Y - h / 2 - 2, 4, h);
            });

            if (songTitle) {
                ctx.textAlign = 'left';
                ctx.fillStyle = '#ffffff';
                ctx.fillText(songTitle, line1StartX + waveW + gapBetween, line1Y + 9);
            }
        } else {
            // Auto-scrolling Marquee for long Song Title
            const waveX = bubbleX + 40;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
            const barHeights = [
                18 + Math.sin(t * 8) * 8,
                28 + Math.cos(t * 8) * 10,
                20 + Math.sin(t * 10) * 8
            ];
            barHeights.forEach((h, idx) => {
                ctx.fillRect(waveX + idx * 9, line1Y - h / 2 - 2, 4, h);
            });

            const clipX = waveX + waveW + gapBetween;
            const clipW = bubbleW - 80 - waveW - gapBetween;

            ctx.save();
            ctx.beginPath();
            ctx.rect(clipX, bubbleY, clipW, 110);
            ctx.clip();

            // Authentic Facebook Marquee: Scrolls IMMEDIATELY on play, finishes 1 cycle, then pauses 1.3s
            const speed = 60; // Smooth gliding speed (px/sec)
            const textGap = 90; // Gap between text repetitions
            const loopW = line1TextW + textGap;

            const scrollDuration = loopW / speed; // Time taken to complete 1 full scroll loop
            const pauseDuration = 1.3; // Pause 1.3s AFTER completing 1 full scroll cycle
            const totalCycle = scrollDuration + pauseDuration;

            const cycleTime = t % totalCycle;
            let rawOffset = 0;

            if (cycleTime < scrollDuration) {
                // Phase 1: Runs IMMEDIATELY upon play, scrolling smoothly across
                rawOffset = cycleTime * speed;
            } else {
                // Phase 2: Finished 1 full cycle -> Pauses for 1.3s at starting position
                rawOffset = 0;
            }

            // Crisp integer pixel alignment eliminates font sub-pixel jitter/blur
            const scrollOffset = Math.round(rawOffset);

            ctx.textAlign = 'left';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(songTitle, clipX - scrollOffset, line1Y + 9);
            ctx.fillText(songTitle, clipX - scrollOffset + loopW, line1Y + 9);
            ctx.restore();
        }

        // LINE 2 (MIDDLE): Ca Sĩ / Artist Name (Fixed anchor Y=124, Static Centered)
        if (artistName) {
            ctx.font = fbFontLine2;
            const line2Y = bubbleY + 124;
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.91)';
            ctx.fillText(artistName, bubbleX + bubbleW / 2, line2Y);
        }

        // LINE 3 (BOTTOM, OPTIONAL): Custom Mood Note Text or Multiple Custom Image Sticker Badges
        if (hasLine3) {
            const line3Y = bubbleY + 188;
            ctx.save();

            if (hasStickers && hasLine3Text) {
                // Both Text & Multiple Custom Stickers present side-by-side
                ctx.font = fbFontLine3;
                const textW = ctx.measureText(moodNoteText).width;
                const gap = 14;
                const totalRowW = textW + gap + stickersTotalW;
                const startX = bubbleX + (bubbleW - totalRowW) / 2;

                ctx.textAlign = 'left';
                ctx.fillStyle = '#ffffff';
                ctx.fillText(moodNoteText, startX, line3Y);

                let currentStkX = startX + textW + gap;
                const stkY = line3Y - 38;
                stickers.forEach(stk => {
                    if (stk.imgElement) {
                        drawCustomStickerBadge(ctx, stk.imgElement, currentStkX, stkY, stickerSize, stickerSize);
                    }
                    currentStkX += stickerSize + stickerGap;
                });

            } else if (hasStickers) {
                // Multiple Custom Stickers present (no text)
                const startX = bubbleX + (bubbleW - stickersTotalW) / 2;
                let currentStkX = startX;
                const stkY = line3Y - 42;
                stickers.forEach(stk => {
                    if (stk.imgElement) {
                        drawCustomStickerBadge(ctx, stk.imgElement, currentStkX, stkY, stickerSize, stickerSize);
                    }
                    currentStkX += stickerSize + stickerGap;
                });

            } else {
                // Plain Text only
                ctx.font = fbFontLine3;
                ctx.textAlign = 'center';
                ctx.fillStyle = '#ffffff';
                ctx.fillText(moodNoteText, bubbleX + bubbleW / 2, line3Y);
            }
            ctx.restore();
        }

        ctx.restore();

        // OPTIONAL `Ghi chú` BADGE ON TOP LEFT (SHIFTED DOWNWARD TO Y=185)
        if (storyProject.showNoteBadge) {
            ctx.save();
            // Dark Pill Background (Y=185)
            ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
            ctx.beginPath();
            ctx.roundRect(40, 185, 210, 62, 31);
            ctx.fill();

            // Draw Vector Thought Bubble Icon
            drawThoughtBubbleIcon(ctx, 58, 199, 1.25, '#ffffff');

            // Text "Ghi chú"
            ctx.textAlign = 'left';
            ctx.font = '500 28px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.fillText('Ghi chú', 110, 226);
            ctx.restore();
        }
    }

    // ── CINEMATIC HẾT PHIM (MOVIE END CREDITS) STORY RENDERER ──
    const movieDustParticles = [];
    function initMovieDustParticles() {
        if (movieDustParticles.length > 0) return;
        for (let i = 0; i < 35; i++) {
            movieDustParticles.push({
                x: Math.random() * 1080,
                y: Math.random() * 1920,
                radius: 1.5 + Math.random() * 3.5,
                alpha: 0.2 + Math.random() * 0.6,
                speedY: 20 + Math.random() * 30,
                wobbleSpeed: 1 + Math.random() * 2,
                wobbleAmp: 10 + Math.random() * 15,
                color: Math.random() > 0.4 ? '#fef08a' : '#ffffff'
            });
        }
    }

    function drawMovieEndStory(ctx, W, H, t) {
        initMovieDustParticles();
        const me = storyProject.movieEnd;

        // 1. BACKGROUND WITH OPTIONAL KEN BURNS MOTION
        ctx.save();
        const hasBgMedia = storyProject.background.imgElement || storyProject.background.videoElement;
        const bgMedia = storyProject.background.imgElement || storyProject.background.videoElement;

        if (hasBgMedia) {
            let scale = 1.0;
            if (me.showKenBurns) {
                const dur = getEffectiveDuration();
                const progress = (t % dur) / dur;
                scale = 1.0 + (progress * 0.06); // Subtle 6% zoom growth
            }

            ctx.save();
            ctx.translate(W / 2, H / 2);
            ctx.scale(scale, scale);
            ctx.translate(-W / 2, -H / 2);
            drawCoverImage(ctx, bgMedia, W, H);
            ctx.restore();
        } else {
            // Elegant Dark Cinema Gradient Background
            const bgGrad = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, H * 0.75);
            bgGrad.addColorStop(0, '#1c1e29');
            bgGrad.addColorStop(0.5, '#0d0e14');
            bgGrad.addColorStop(1, '#050608');
            ctx.fillStyle = bgGrad;
            ctx.fillRect(0, 0, W, H);
        }
        ctx.restore();

        // 2. DARKNESS OVERLAY & CINEMATIC VIGNETTE (Bypass entirely if darkness is 0 to show 100% original photo/video)
        const darknessAlpha = (me.darkness !== undefined ? me.darkness : 0.55);
        if (darknessAlpha > 0) {
            ctx.save();
            ctx.fillStyle = `rgba(0, 0, 0, ${darknessAlpha})`;
            ctx.fillRect(0, 0, W, H);

            // Dynamic Vignette Gradient scaled with darkness opacity
            const vGrad = ctx.createRadialGradient(W / 2, H / 2, W * 0.25, W / 2, H / 2, H * 0.7);
            vGrad.addColorStop(0, `rgba(0, 0, 0, ${0.1 * darknessAlpha})`);
            vGrad.addColorStop(0.7, `rgba(0, 0, 0, ${0.45 * darknessAlpha})`);
            vGrad.addColorStop(1, `rgba(0, 0, 0, ${0.85 * darknessAlpha})`);
            ctx.fillStyle = vGrad;
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
        }

        // 3. VINTAGE DUST & LIGHT LEAK PARTICLES
        if (me.showDust) {
            ctx.save();
            movieDustParticles.forEach((p, idx) => {
                const curY = (p.y - (t * p.speedY)) % H;
                const finalY = curY < 0 ? curY + H : curY;
                const curX = p.x + Math.sin(t * p.wobbleSpeed + idx) * p.wobbleAmp;

                ctx.globalAlpha = p.alpha * (0.7 + 0.3 * Math.sin(t * 3 + idx));
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(curX, finalY, p.radius, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.restore();
        }

        // 4. TOP-CENTER BIG TITLE ("HẾT PHIM")
        const titleText = (me.title || '').trim();
        const hasTitle = titleText.length > 0;
        const titleX = me.titleX !== undefined ? me.titleX : W / 2;
        const titleY = me.titleY !== undefined ? me.titleY : (me.showLetterbox ? 310 : 280);

        if (hasTitle) {
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const style = me.titleStyle || 'gold';
            const displayTitleUpper = titleText.toUpperCase();

            if (style === 'gold') {
                ctx.font = '900 82px "Outfit", "Cinzel", serif, sans-serif';
                ctx.shadowColor = 'rgba(212, 175, 55, 0.5)';
                ctx.shadowBlur = 24;
                const goldGrad = ctx.createLinearGradient(0, titleY - 40, 0, titleY + 40);
                goldGrad.addColorStop(0, '#fff3a0');
                goldGrad.addColorStop(0.35, '#ffd700');
                goldGrad.addColorStop(0.7, '#daa520');
                goldGrad.addColorStop(1, '#b8860b');

                ctx.fillStyle = goldGrad;
                ctx.fillText(displayTitleUpper, titleX, titleY);

                ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
                ctx.lineWidth = 1.5;
                ctx.strokeText(displayTitleUpper, titleX, titleY);

            } else if (style === 'silver') {
                ctx.font = '900 82px "Outfit", sans-serif';
                ctx.shadowColor = 'rgba(255, 255, 255, 0.6)';
                ctx.shadowBlur = 20;

                const silverGrad = ctx.createLinearGradient(0, titleY - 40, 0, titleY + 40);
                silverGrad.addColorStop(0, '#ffffff');
                silverGrad.addColorStop(0.5, '#cbd5e1');
                silverGrad.addColorStop(1, '#64748b');

                ctx.fillStyle = silverGrad;
                ctx.fillText(displayTitleUpper, titleX, titleY);

            } else if (style === 'vintage') {
                ctx.font = '900 86px "Outfit", serif, sans-serif';
                ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
                ctx.shadowBlur = 12;

                ctx.fillStyle = '#dc2626';
                ctx.fillText(displayTitleUpper, titleX, titleY);

                ctx.strokeStyle = '#fef08a';
                ctx.lineWidth = 3;
                ctx.strokeText(displayTitleUpper, titleX, titleY);

            } else if (style === 'neon') {
                ctx.font = '900 82px "Outfit", sans-serif';
                ctx.shadowColor = '#ec4899';
                ctx.shadowBlur = 35;

                ctx.fillStyle = '#ffffff';
                ctx.fillText(displayTitleUpper, titleX, titleY);

                ctx.shadowColor = '#6366f1';
                ctx.shadowBlur = 50;
                ctx.fillText(displayTitleUpper, titleX, titleY);

            } else { // 'minimal'
                ctx.font = '300 74px "Plus Jakarta Sans", sans-serif';
                ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
                ctx.shadowBlur = 15;
                ctx.fillStyle = '#ffffff';
                ctx.fillText(displayTitleUpper, titleX, titleY);
            }

            ctx.restore();

            // DECORATIVE DIVIDER LINE BELOW TITLE
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            const divW = 140;
            ctx.moveTo(titleX - divW / 2, titleY + 55);
            ctx.lineTo(titleX + divW / 2, titleY + 55);
            ctx.stroke();

            ctx.fillStyle = style === 'gold' ? '#ffd700' : '#ffffff';
            ctx.beginPath();
            ctx.arc(titleX, titleY + 55, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // 5. LYRICS & CREDITS RENDERING ENGINE WITH CUSTOM 4-SIDE BOUNDING BOX & ACTIVE HIGHLIGHT
        const rawCredits = me.creditsText || '';

        const boxX = me.lyricsX !== undefined ? me.lyricsX : W / 2;
        const boxY = me.lyricsY !== undefined ? me.lyricsY : (me.showLetterbox ? 1080 : 1100);
        const boxW = me.lyricsWidth !== undefined ? me.lyricsWidth : 920;
        const boxH = me.lyricsHeight !== undefined ? me.lyricsHeight : 650;

        const topClip = boxY - boxH / 2;
        const bottomClip = boxY + boxH / 2;
        const leftClip = boxX - boxW / 2;
        const rightClip = boxX + boxW / 2;

        const activeColor = me.activeColor || '#f59e0b';
        const activeGlow = me.activeGlowSize !== undefined ? me.activeGlowSize : 25;
        const activeFontSz = me.activeFontSize || 44;

        const inactiveColor = me.inactiveColor || '#ffffff';
        const inactiveFontSz = me.inactiveFontSize || 34;

        const fontFamily = me.fontFamily || 'Outfit';
        const textAlign = me.textAlign || 'center';

        if (me.lyricsMode === 'karaoke' || me.lyricsMode === undefined) {
            // 🎙️ KARAOKE SYNCED LYRICS RENDERER (HÁT TỚI ĐÂU HIỆN CÂU ĐÓ)
            const parsedLines = parseLrcOrPlainLyrics(rawCredits, getEffectiveDuration());

            if (parsedLines.length > 0) {
                const currentAudioTime = t;

                let activeIdx = 0;
                for (let i = 0; i < parsedLines.length; i++) {
                    if (parsedLines[i].time <= currentAudioTime) {
                        activeIdx = i;
                    } else {
                        break;
                    }
                }

                if (currentSingingText) {
                    currentSingingText.textContent = parsedLines[activeIdx] ? parsedLines[activeIdx].text : '...';
                }

                let subProgress = 0;
                if (activeIdx < parsedLines.length - 1) {
                    const tCur = parsedLines[activeIdx].time;
                    const tNext = parsedLines[activeIdx + 1].time;
                    const diff = Math.max(0.4, tNext - tCur);
                    subProgress = Math.min(1.0, Math.max(0.0, (currentAudioTime - tCur) / diff));
                }

                const virtualIndex = activeIdx + (subProgress * 0.45);
                const centerY = boxY;
                const lineSpacing = activeFontSz + 40;

                ctx.save();
                ctx.beginPath();
                ctx.rect(leftClip, topClip, boxW, boxH);
                ctx.clip();

                parsedLines.forEach((lineObj, idx) => {
                    const lineY = centerY + (idx - virtualIndex) * lineSpacing;

                    if (lineY < topClip - 60 || lineY > bottomClip + 60) return;

                    const isActive = (idx === activeIdx);
                    const distanceToActive = Math.abs(idx - activeIdx);

                    let alpha = 1.0;
                    if (isActive) {
                        alpha = 1.0;
                    } else if (distanceToActive === 1) {
                        alpha = 0.55;
                    } else if (distanceToActive === 2) {
                        alpha = 0.3;
                    } else {
                        alpha = 0.12;
                    }

                    if (lineY < topClip + 90) {
                        alpha *= Math.max(0, (lineY - topClip) / 90);
                    } else if (lineY > bottomClip - 90) {
                        alpha *= Math.max(0, (bottomClip - lineY) / 90);
                    }

                    ctx.save();
                    ctx.globalAlpha = alpha;
                    ctx.textAlign = textAlign;
                    ctx.textBaseline = 'middle';

                    let textX = boxX;
                    if (textAlign === 'left') textX = leftClip + 30;
                    else if (textAlign === 'right') textX = rightClip - 30;

                    if (isActive) {
                        // 🌟 ACTIVE SUNG LINE (CÂU ĐANG HÁT CHÍNH GIỮA WITH CUSTOM GLOW & COLOR)
                        const lineText = lineObj.text;

                        // Soft pill glow background for active line
                        ctx.save();
                        ctx.font = `900 ${activeFontSz}px "${fontFamily}", "Plus Jakarta Sans", sans-serif`;
                        const textW = ctx.measureText(lineText).width;
                        const padX = 32;
                        const pillW = textW + padX * 2;

                        let pillX = textX - pillW / 2;
                        if (textAlign === 'left') pillX = leftClip + 15;
                        else if (textAlign === 'right') pillX = rightClip - pillW - 15;

                        const pillGrad = ctx.createLinearGradient(pillX, 0, pillX + pillW, 0);
                        pillGrad.addColorStop(0, hexToRgba(activeColor, 0.12));
                        pillGrad.addColorStop(0.5, hexToRgba(activeColor, 0.35));
                        pillGrad.addColorStop(1, hexToRgba(activeColor, 0.12));

                        ctx.fillStyle = pillGrad;
                        ctx.beginPath();
                        ctx.roundRect(pillX, lineY - (activeFontSz * 0.7), pillW, activeFontSz * 1.4, 28);
                        ctx.fill();

                        ctx.strokeStyle = hexToRgba(activeColor, 0.5);
                        ctx.lineWidth = 1.5;
                        ctx.stroke();
                        ctx.restore();

                        // Active Line Text with Highlight Color & Glow
                        ctx.font = `900 ${activeFontSz}px "${fontFamily}", "Plus Jakarta Sans", sans-serif`;
                        ctx.shadowColor = activeColor;
                        ctx.shadowBlur = activeGlow;

                        ctx.fillStyle = activeColor;
                        ctx.fillText(lineText, textX, lineY);

                    } else {
                        // Regular Past & Future Lyrics Lines
                        ctx.font = `600 ${inactiveFontSz}px "${fontFamily}", "Plus Jakarta Sans", sans-serif`;
                        ctx.fillStyle = inactiveColor;
                        ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
                        ctx.shadowBlur = 10;
                        ctx.fillText(lineObj.text, textX, lineY);
                    }

                    ctx.restore();
                });

                ctx.restore();
            }

        } else {
            // 📜 CONTINUOUS CREDITS SCROLL MODE
            const lines = rawCredits.split('\n');

            const lineHeight = inactiveFontSz + 20;
            const totalTextHeight = lines.length * lineHeight;

            const dur = getEffectiveDuration();
            const scrollRange = (bottomClip - topClip) + totalTextHeight + 200;

            const progress = Math.min(1.0, Math.max(0.0, t / Math.max(1, dur)));

            const startY = bottomClip + 40;
            const currentBlockTopY = startY - (progress * scrollRange);

            ctx.save();
            ctx.beginPath();
            ctx.rect(leftClip, topClip, boxW, boxH);
            ctx.clip();

            lines.forEach((lineText, idx) => {
                const lineY = currentBlockTopY + (idx * lineHeight);

                if (lineY < topClip - 40 || lineY > bottomClip + 40) return;

                let lineAlpha = 1.0;
                const fadeDistance = 120;

                if (lineY < topClip + fadeDistance) {
                    lineAlpha = Math.max(0, (lineY - topClip) / fadeDistance);
                } else if (lineY > bottomClip - fadeDistance) {
                    lineAlpha = Math.max(0, (bottomClip - lineY) / fadeDistance);
                }

                ctx.save();
                ctx.globalAlpha = lineAlpha;
                ctx.textAlign = textAlign;
                ctx.textBaseline = 'middle';

                let textX = boxX;
                if (textAlign === 'left') textX = leftClip + 30;
                else if (textAlign === 'right') textX = rightClip - 30;

                const trimmedLine = lineText.trim();
                const isHeaderLine = trimmedLine.startsWith('---') || trimmedLine.includes('/') || (trimmedLine === trimmedLine.toUpperCase() && trimmedLine.length > 3 && !trimmedLine.includes(' '));
                const isEndBadge = trimmedLine.includes('THE END') || trimmedLine.includes('HẾT PHIM') || trimmedLine.startsWith('--- THE END');

                if (isEndBadge) {
                    ctx.font = `bold ${activeFontSz}px "${fontFamily}", sans-serif`;
                    ctx.fillStyle = activeColor;
                    ctx.shadowColor = hexToRgba(activeColor, 0.6);
                    ctx.shadowBlur = activeGlow;
                    ctx.fillText(trimmedLine, textX, lineY);

                } else if (isHeaderLine) {
                    ctx.font = `700 ${inactiveFontSz}px "${fontFamily}", sans-serif`;
                    ctx.fillStyle = activeColor;
                    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
                    ctx.shadowBlur = 8;
                    ctx.fillText(trimmedLine, textX, lineY);

                } else {
                    ctx.font = `500 ${inactiveFontSz}px "${fontFamily}", sans-serif`;
                    ctx.fillStyle = inactiveColor;
                    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
                    ctx.shadowBlur = 10;
                    ctx.fillText(trimmedLine, textX, lineY);
                }

                ctx.restore();
            });

            ctx.restore();
        }

        // 6. CINEMATIC LETTERBOX (2.39:1 Black Bars)
        if (me.showLetterbox) {
            const barH = 150;
            ctx.save();

            // Top Black Bar
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, W, barH);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, barH);
            ctx.lineTo(W, barH);
            ctx.stroke();

            // Bottom Black Bar
            ctx.fillRect(0, H - barH, W, barH);
            ctx.beginPath();
            ctx.moveTo(0, H - barH);
            ctx.lineTo(W, H - barH);
            ctx.stroke();

            // Movie Audio Badge at bottom bar
            if (storyProject.music.audioBuffer) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.font = '500 24px "Plus Jakarta Sans", sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(`🎵 ${storyProject.music.fileName || 'Soundtrack'}`, 40, H - 65);
            }

            ctx.restore();
        }
    }

    // ── 📸 ULTRA HD ANTI-BLUR FB STORY RENDERER ──
    function drawHdStory(ctx, W, H, t) {
        ctx.save();
        const hasBgMedia = storyProject.background.imgElement || storyProject.background.videoElement;
        const bgMedia = storyProject.background.imgElement || storyProject.background.videoElement;

        // 1. SMART SHARPNESS & COLOR ENHANCEMENT (ANTI-COMPRESSION FILTER FOR FB STORY)
        const sharpness = storyProject.hdStory ? storyProject.hdStory.sharpness : 'crisp';
        if (sharpness === 'crisp') {
            ctx.filter = 'contrast(1.05) saturate(1.08) brightness(1.02)';
        } else if (sharpness === 'vibrant') {
            ctx.filter = 'contrast(1.14) saturate(1.25) brightness(1.04)';
        } else {
            ctx.filter = 'none';
        }

        if (hasBgMedia) {
            drawCoverImage(ctx, bgMedia, W, H);
        } else {
            const bgGrad = ctx.createLinearGradient(0, 0, W, H);
            bgGrad.addColorStop(0, '#0f172a');
            bgGrad.addColorStop(1, '#020617');
            ctx.fillStyle = bgGrad;
            ctx.fillRect(0, 0, W, H);
        }
        ctx.restore();

        // 2. AUDIO BADGE OVERLAY
        const badgeStyle = storyProject.hdStory ? storyProject.hdStory.badgeStyle : 'vinyl';
        const songTitle = storyProject.fbNote.title || storyProject.song.title || 'Music Story';
        const artist = storyProject.fbNote.sub || storyProject.song.artist || '';

        if (badgeStyle === 'vinyl') {
            const cx = W / 2;
            const cy = H - 280;
            const radius = 90;

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(t * 1.5);

            // Vinyl Record Body
            ctx.fillStyle = '#111827';
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#374151';
            ctx.lineWidth = 4;
            ctx.stroke();

            // Vinyl Grooves
            [75, 60, 45].forEach(r => {
                ctx.beginPath();
                ctx.arc(0, 0, r, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            });

            // Center Cover Art
            if (hasBgMedia) {
                ctx.beginPath();
                ctx.arc(0, 0, 32, 0, Math.PI * 2);
                ctx.clip();
                drawCircularImage(ctx, bgMedia, 0, 0, 32);
            }
            ctx.restore();

            // Song Info Below Record
            ctx.save();
            ctx.textAlign = 'center';
            ctx.font = '700 34px "Outfit", sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
            ctx.shadowBlur = 14;
            ctx.fillText(songTitle, cx, cy + radius + 48);

            if (artist) {
                ctx.font = '500 24px "Plus Jakarta Sans", sans-serif';
                ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                ctx.fillText(artist, cx, cy + radius + 84);
            }
            ctx.restore();

        } else if (badgeStyle === 'minimal') {
            const badgeW = 540;
            const badgeH = 100;
            const bx = (W - badgeW) / 2;
            const by = H - 240;

            ctx.save();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.beginPath();
            ctx.roundRect(bx, by, badgeW, badgeH, 50);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.textAlign = 'center';
            ctx.font = '700 30px "Outfit", sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(songTitle, W / 2, by + 45);

            if (artist) {
                ctx.font = '400 22px "Plus Jakarta Sans", sans-serif';
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.fillText(artist, W / 2, by + 78);
            }
            ctx.restore();
        }
    }

    // ── CUSTOM IMAGE STICKER BADGE RENDERER FOR LINE 3 ──
    function drawCustomStickerBadge(ctx, img, x, y, w, h) {
        if (!img) return;
        ctx.save();

        // Soft Drop Shadow for 3D Sticker effect
        ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
        ctx.shadowBlur = 14;
        ctx.shadowOffsetY = 5;

        // Clean White Rounded Sticker Border
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(x - 4, y - 4, w + 8, h + 8, 14);
        ctx.fill();

        ctx.shadowColor = 'transparent';

        // Clip Image cleanly inside border
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 10);
        ctx.clip();

        // Cover fit image math
        const imgRatio = img.width / img.height;
        const targetRatio = w / h;
        let sw, sh, sx, sy;

        if (imgRatio > targetRatio) {
            sh = img.height;
            sw = img.height * targetRatio;
            sx = (img.width - sw) / 2;
            sy = 0;
        } else {
            sw = img.width;
            sh = img.width / targetRatio;
            sx = 0;
            sy = (img.height - sh) / 2;
        }
        ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
        ctx.restore();
    }

    // ── TIMED EMOTION BURST ENGINE (AUTHENTIC FB CIRCULAR BADGE WITH MOTION TRAIL LINE) ──
    const EMOJI_BADGE_COLORS = {
        '❤️': { bg: '#f43f5e', text: '#ffffff' },
        '👍': { bg: '#0284c7', text: '#ffffff' },
        '🥰': { bg: '#eab308', text: '#333333' },
        '😆': { bg: '#eab308', text: '#333333' },
        '😮': { bg: '#eab308', text: '#333333' },
        '😢': { bg: '#eab308', text: '#333333' },
        '😡': { bg: '#ef4444', text: '#ffffff' }
    };

    function initParticles() {
        const countMode = storyProject.floatingEmotions.countMode || '2';
        let count = 4;
        let isLoop = false;

        if (countMode === '1') count = 2;
        else if (countMode === '2') count = 4;
        else if (countMode === '3') count = 6;
        else if (countMode === '5') count = 10;
        else if (countMode === 'loop') { count = 12; isLoop = true; }

        const particles = [];
        for (let i = 0; i < count; i++) {
            particles.push({
                xOffset: (Math.random() - 0.5) * 360,
                travelDist: 520 + Math.random() * 400,
                curveAmp: 25 + Math.random() * 75,
                curveDir: Math.random() > 0.5 ? 1 : -1,
                scale: 0.9 + Math.random() * 0.4,
                duration: 2.2 + Math.random() * 1.4,
                startDelay: isLoop ? (i * 0.4) : (i * 0.25),
                isLoop: isLoop
            });
        }
        storyProject.floatingEmotions.particles = particles;
    }

    function getParticlePos(p, progress, W, bubbleY) {
        const easeOut = 1 - Math.pow(1 - progress, 2);
        const y = (bubbleY + 120) - (easeOut * p.travelDist);
        const curveOffset = Math.sin(progress * Math.PI) * p.curveAmp * p.curveDir;
        const x = (W / 2) + p.xOffset + curveOffset;
        return { x, y };
    }

    function drawFloatingEmotions(ctx, W, H, t, bubbleY) {
        if (!storyProject.floatingEmotions.particles || storyProject.floatingEmotions.particles.length === 0) {
            initParticles();
        }

        const particles = storyProject.floatingEmotions.particles;
        const emoji = storyProject.floatingEmotions.emoji;
        const badgeConfig = EMOJI_BADGE_COLORS[emoji] || { bg: '#eab308', text: '#ffffff' };

        ctx.save();
        particles.forEach(p => {
            const activeTime = t - p.startDelay;
            if (activeTime < 0) return;

            const travelDuration = p.duration;
            let progress = activeTime / travelDuration;

            if (!p.isLoop) {
                if (progress > 1.0) return;
            } else {
                progress = progress % 1.0;
            }

            const pos = getParticlePos(p, progress, W, bubbleY);
            const tailProgress = Math.max(0, progress - 0.14);
            const tailPos = getParticlePos(p, tailProgress, W, bubbleY);

            let scale = p.scale;
            if (progress < 0.1) {
                scale *= (progress / 0.1);
            }

            let alpha = 1;
            if (progress > 0.65) {
                alpha = (1.0 - progress) / 0.35;
            }
            alpha = Math.max(0, Math.min(1, alpha));

            const badgeRadius = 36 * scale;

            ctx.save();
            ctx.globalAlpha = alpha;

            // 1. MOTION TRAIL LINE (ĐƯỜNG VỆT MÀU THÂN UỐN CONG/THẲNG KHI BẮN LÊN)
            if (progress > 0.03 && (pos.y !== tailPos.y || pos.x !== tailPos.x)) {
                ctx.beginPath();
                ctx.moveTo(tailPos.x, tailPos.y);
                ctx.lineTo(pos.x, pos.y);
                ctx.strokeStyle = badgeConfig.bg;
                ctx.lineWidth = badgeRadius * 1.75;
                ctx.lineCap = 'round';
                ctx.stroke();
            }

            // 2. CIRCULAR BADGE HEAD (KHỐI HÌNH TRÒN CẢM XÚC GỐC)
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, badgeRadius, 0, Math.PI * 2);
            ctx.fillStyle = badgeConfig.bg;
            ctx.fill();

            // Inner subtle border ring highlight
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.lineWidth = 2.5 * scale;
            ctx.stroke();

            // 3. EMOJI ICON INSIDE CIRCLE
            ctx.font = `${Math.floor(40 * scale)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(emoji, pos.x, pos.y + 2 * scale);

            ctx.restore();
        });
        ctx.restore();
    }

    // ── Ghi Chú FB STORY RENDERER ──
    function drawModernMinimalStory(ctx, W, H, t) {
        ctx.fillStyle = '#0a0c14';
        ctx.fillRect(0, 0, W, H);

        if (storyProject.background.imgElement) {
            drawCoverImage(ctx, storyProject.background.imgElement, W, H);
        }

        const vGrad = ctx.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, H * 0.7);
        vGrad.addColorStop(0, 'rgba(0, 0, 0, 0.25)');
        vGrad.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
        ctx.fillStyle = vGrad;
        ctx.fillRect(0, 0, W, H);

        const coverSize = 340;
        const coverX = (W - coverSize) / 2;
        const coverY = H / 2 - 180;

        if (storyProject.song.coverImgElement) {
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(coverX, coverY, coverSize, coverSize, 32);
            ctx.clip();
            ctx.drawImage(storyProject.song.coverImgElement, coverX, coverY, coverSize, coverSize);
            ctx.restore();
        }

        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 54px Outfit, sans-serif';
        ctx.fillText(storyProject.fbNote.title || 'Untitled Track', W / 2, coverY + coverSize + 80);
    }

    function drawCircularImage(ctx, imgOrVideo, cx, cy, radius) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const imgW = imgOrVideo.videoWidth || imgOrVideo.width || (radius * 2);
        const imgH = imgOrVideo.videoHeight || imgOrVideo.height || (radius * 2);

        const size = radius * 2;
        const scale = Math.max(size / imgW, size / imgH);
        const nw = imgW * scale;
        const nh = imgH * scale;
        const nx = cx - nw / 2;
        const ny = cy - nh / 2;

        ctx.drawImage(imgOrVideo, nx, ny, nw, nh);
    }

    function drawCoverImage(ctx, imgOrVideo, W, H) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const imgW = imgOrVideo.videoWidth || imgOrVideo.width || W;
        const imgH = imgOrVideo.videoHeight || imgOrVideo.height || H;

        const scale = Math.max(W / imgW, H / imgH);
        const nw = imgW * scale;
        const nh = imgH * scale;
        const nx = (W - nw) / 2;
        const ny = (H - nh) / 2;

        ctx.drawImage(imgOrVideo, nx, ny, nw, nh);
    }

    // Render Initial Frame
    renderPreviewFrame(0);

    // ── 5. VIDEO EXPORT ENGINE (ULTRA HD 60FPS - 25 MBPS BITRATE) ──
    btnCreateStory.addEventListener('click', () => {
        startVideoRender();
    });

    async function startVideoRender() {
        initAudioContext();
        stopAudioPreview();

        exportModal.classList.add('show');
        exportProgressBar.style.width = '0%';
        exportStatusText.textContent = 'Rendering Ultra HD 60FPS Video...';
        exportModalTitle.textContent = 'Rendering FB Story MP4...';
        exportSpinner.style.display = 'block';
        exportActionBtns.style.display = 'none';

        const dur = getEffectiveDuration();
        const totalFrames = dur * 60; // 60 FPS
        const canvasStream = msPreviewCanvas.captureStream(60);

        const streamDest = audioCtx.createMediaStreamDestination();
        if (storyProject.music.audioBuffer) {
            const source = audioCtx.createBufferSource();
            source.buffer = storyProject.music.audioBuffer;

            const renderAnalyser = audioCtx.createAnalyser();
            renderAnalyser.fftSize = 128;
            analyserNode = renderAnalyser;

            source.connect(renderAnalyser);
            renderAnalyser.connect(streamDest);

            source.start(0, storyProject.music.start, dur);
        }

        const combinedStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...streamDest.stream.getAudioTracks()
        ]);

        let mimeType = 'video/webm;codecs=vp9';
        if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')) {
            mimeType = 'video/mp4;codecs=avc1';
        } else if (MediaRecorder.isTypeSupported('video/mp4')) {
            mimeType = 'video/mp4';
        } else if (MediaRecorder.isTypeSupported('video/webm')) {
            mimeType = 'video/webm';
        }

        // ULTRA HD BITRATE ENCODING (35 Mbps Video / 320 Kbps Audio) FOR CRYSTAL CLEAR FB STORY (ANTI-COMPRESSION PRESET)
        const recorder = new MediaRecorder(combinedStream, {
            mimeType,
            videoBitsPerSecond: 35000000,
            audioBitsPerSecond: 320000
        });

        const chunks = [];
        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: mimeType });
            const videoUrl = URL.createObjectURL(blob);

            exportProgressBar.style.width = '100%';
            exportStatusText.textContent = 'FB Note Story complete & ready to post!';
            exportModalTitle.textContent = 'FB Story Created Successfully! 🎉';
            exportSpinner.style.display = 'none';

            const isMp4 = mimeType.includes('mp4');
            btnDownloadVideo.href = videoUrl;
            btnDownloadVideo.download = `fb_note_story_${Date.now()}.${isMp4 ? 'mp4' : 'webm'}`;
            btnDownloadVideo.innerHTML = `<i class="fa-solid fa-download"></i> Tải Video (${isMp4 ? 'MP4' : 'WebM'})`;

            exportActionBtns.style.display = 'flex';
        };

        recorder.start();

        const renderAudioStartTime = audioCtx.currentTime;

        function recordFrameLoop() {
            const elapsed = audioCtx.currentTime - renderAudioStartTime;
            if (elapsed >= dur) {
                renderPreviewFrame(dur);
                if (recorder.state !== 'inactive') recorder.stop();
                return;
            }

            renderPreviewFrame(elapsed);

            const percent = Math.floor((elapsed / dur) * 100);
            exportProgressBar.style.width = Math.min(100, percent) + '%';
            if (percent < 30) exportStatusText.textContent = 'Rendering blurred background & circular avatar...';
            else if (percent < 70) exportStatusText.textContent = `Animating floating emotions (${percent}%)...`;
            else exportStatusText.textContent = 'Encoding HD video & audio tracks...';

            requestAnimationFrame(recordFrameLoop);
        }

        requestAnimationFrame(recordFrameLoop);
    }

    btnCreateAnother.addEventListener('click', () => {
        exportModal.classList.remove('show');
        renderPreviewFrame(0);
    });

})();

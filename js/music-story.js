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
        fbNote: {
            title: 'Life Goes On',
            sub: 'BTS',
            noteText: '',
            bgColor: '#b4804c' // Slightly lighter soft brown FB Note
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
    const noteBgColorCustom = $('noteBgColorCustom');

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
    document.querySelectorAll('#storyModeGroup .ms-seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#storyModeGroup .ms-seg-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            storyProject.mode = btn.getAttribute('data-mode');
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
            } else {
                // Direct Audio/Video URL
                const arrayBuffer = await fetchAudioFromUrl(rawUrl);
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
                    const songTitle = json.data.music_info?.title || json.data.title || 'TikTok Audio';
                    const artist = json.data.music_info?.author || json.data.author?.nickname || '';
                    if (audioUrl) {
                        return { audioUrl, songTitle, artist };
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
                    const songTitle = json.music.title || json.title || 'TikTok Audio';
                    const artist = json.music.author || '';
                    return { audioUrl, songTitle, artist };
                } else if (json && json.video && json.video.noWatermark) {
                    return { audioUrl: json.video.noWatermark, songTitle: json.title || 'TikTok Audio', artist: '' };
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
        if (noteTitleInput.value === 'những câu chuyện ayi') {
            noteTitleInput.value = cleanName;
            storyProject.fbNote.title = cleanName;
        }

        const arrayBuffer = await file.arrayBuffer();
        decodeAudioFromBuffer(arrayBuffer, file.name);
    }

    function decodeAudioFromBuffer(arrayBuffer, name) {
        initAudioContext();
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

    if (toggleNoteBadge) {
        toggleNoteBadge.addEventListener('change', (e) => {
            storyProject.showNoteBadge = e.target.checked;
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
        const hasLine3 = Boolean(moodNoteText.trim());
        if (hasLine3) {
            ctx.font = fbFontLine3;
            line3W = ctx.measureText(moodNoteText).width;
        }

        const maxContentW = Math.max(line1TotalW, line2W, line3W);

        // Dynamic Bubble Width & Height (Fixed anchor for Line 1 & Line 2, expands for Line 3)
        const minBubbleW = 520;
        const maxBubbleW = 760;
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

        if (line1TextW <= maxLine1TextW) {
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

            const speed = 70;
            const gap = 80;
            const loopW = line1TextW + gap;
            const scrollOffset = (t * speed) % loopW;

            ctx.textAlign = 'left';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(songTitle, clipX - scrollOffset, line1Y + 9);
            ctx.fillText(songTitle, clipX - scrollOffset + loopW, line1Y + 9);
            ctx.restore();
        }

        // LINE 2 (MIDDLE): Ca Sĩ / Artist Name (Fixed anchor Y=124)
        if (artistName) {
            ctx.font = fbFontLine2;
            const line2Y = bubbleY + 124;
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.91)';

            if (line2W <= bubbleW - 70) {
                ctx.fillText(artistName, bubbleX + bubbleW / 2, line2Y);
            } else {
                const clipX = bubbleX + 35;
                const clipW = bubbleW - 70;
                ctx.save();
                ctx.beginPath();
                ctx.rect(clipX, line2Y - 30, clipW, 50);
                ctx.clip();

                const speed = 65;
                const gap = 70;
                const loopW = line2W + gap;
                const scrollOffset = (t * speed) % loopW;

                ctx.textAlign = 'left';
                ctx.fillText(artistName, clipX - scrollOffset, line2Y);
                ctx.fillText(artistName, clipX - scrollOffset + loopW, line2Y);
                ctx.restore();
            }
        }

        // LINE 3 (BOTTOM, OPTIONAL): Custom Mood Note Text
        if (hasLine3) {
            ctx.font = fbFontLine3;
            const line3Y = bubbleY + 188;
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ffffff';

            if (line3W <= bubbleW - 60) {
                ctx.fillText(moodNoteText, bubbleX + bubbleW / 2, line3Y);
            } else {
                const clipX = bubbleX + 30;
                const clipW = bubbleW - 60;
                ctx.save();
                ctx.beginPath();
                ctx.rect(clipX, line3Y - 40, clipW, 60);
                ctx.clip();

                const speed = 70;
                const gap = 80;
                const loopW = line3W + gap;
                const scrollOffset = (t * speed) % loopW;

                ctx.textAlign = 'left';
                ctx.fillText(moodNoteText, clipX - scrollOffset, line3Y);
                ctx.fillText(moodNoteText, clipX - scrollOffset + loopW, line3Y);
                ctx.restore();
            }
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

        // ULTRA HD BITRATE ENCODING (25 Mbps Video / 320 Kbps Audio) FOR CRYSTAL CLEAR FB STORY
        const recorder = new MediaRecorder(combinedStream, {
            mimeType,
            videoBitsPerSecond: 25000000,
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

        let currentFrame = 0;

        function recordFrameLoop() {
            if (currentFrame >= totalFrames) {
                recorder.stop();
                return;
            }

            const t = (currentFrame / totalFrames) * dur;
            renderPreviewFrame(t);

            const percent = Math.floor((currentFrame / totalFrames) * 100);
            exportProgressBar.style.width = percent + '%';
            if (percent < 30) exportStatusText.textContent = 'Rendering blurred background & circular avatar...';
            else if (percent < 70) exportStatusText.textContent = `Animating floating emotions (${percent}%)...`;
            else exportStatusText.textContent = 'Encoding HD video & audio tracks...';

            currentFrame++;
            setTimeout(recordFrameLoop, 1000 / 60);
        }

        recordFrameLoop();
    }

    btnCreateAnother.addEventListener('click', () => {
        exportModal.classList.remove('show');
        renderPreviewFrame(0);
    });

})();

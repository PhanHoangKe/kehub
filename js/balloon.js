/**
 * balloon.js - Trình quản lý bóng bóng bay lơ lửng phát video TikTok ẩn chứa
 */
export function initBalloonEngine(getState, saveBackendConfig, audioEngine) {
    let isPopped = false;
    let autoRecoverTimer = null;

    let balloonContainer = document.getElementById('floatingBalloon');
    if (!balloonContainer) {
        balloonContainer = document.createElement('div');
        balloonContainer.id = 'floatingBalloon';
        balloonContainer.className = 'balloon-container balloon-float';
        balloonContainer.innerHTML = `
            <div class="balloon-tip">Bấm vào tớ! 🎈</div>
            <div class="balloon-body">
                <i class="fa-brands fa-tiktok" style="color: #fff; font-size: 1.15rem; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));"></i>
                <div class="balloon-knot"></div>
            </div>
            <div class="balloon-string"></div>
        `;
        document.body.appendChild(balloonContainer);
    }

    let videoModal = document.getElementById('balloonVideoModal');
    if (!videoModal) {
        videoModal = document.createElement('div');
        videoModal.id = 'balloonVideoModal';
        videoModal.className = 'balloon-video-modal';
        videoModal.innerHTML = `
            <div class="balloon-video-content">
                <div class="balloon-video-header">
                    <h4><i class="fa-brands fa-tiktok"></i> TikTok Video</h4>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button class="balloon-unmute-hint-btn" id="btnUnmuteBalloonVideo" title="Bật âm thanh video">
                            <i class="fa-solid fa-volume-high"></i> Bật tiếng 🔊
                        </button>
                        <button class="balloon-video-close" id="btnVersionCloseBalloonVideo">&times;</button>
                    </div>
                </div>
                <div class="balloon-iframe-container" id="balloonIframeBox">
                    <!-- iframe loaded here -->
                </div>
            </div>
        `;
        document.body.appendChild(videoModal);
        
        const closeBtn = videoModal.querySelector('#btnVersionCloseBalloonVideo');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                resetBalloon();
            });
        }

        const unmuteBtn = videoModal.querySelector('#btnUnmuteBalloonVideo');
        if (unmuteBtn) {
            unmuteBtn.addEventListener('click', () => {
                const iframe = videoModal.querySelector('iframe');
                if (iframe) {
                    try {
                        iframe.contentWindow.postMessage({
                            type: 'unmute',
                            'x-tiktok-player': true
                        }, '*');
                        iframe.contentWindow.postMessage({
                            type: 'play',
                            'x-tiktok-player': true
                        }, '*');
                    } catch (e) {}
                }
            });
        }
    }

    function resetBalloon() {
        if (autoRecoverTimer) clearTimeout(autoRecoverTimer);
        videoModal.classList.remove('active');
        const iframeBox = document.getElementById('balloonIframeBox');
        if (iframeBox) iframeBox.innerHTML = '';
        
        // Hiện lại bóng bóng lơ lửng
        balloonContainer.classList.remove('popped');
        balloonContainer.classList.add('balloon-float');
        isPopped = false;
    }

    function updateBalloonVisibility() {
        const state = getState();
        if (state.balloonTiktokUrl && state.balloonTiktokUrl.trim() !== '') {
            balloonContainer.style.display = 'block';
        } else {
            balloonContainer.style.display = 'none';
        }
    }

    function getYouTubeId(url) {
        if (!url) return null;
        const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
        return match ? match[1] : null;
    }

    function getTikTokId(url) {
        if (!url) return null;
        const match = url.match(/(?:tiktok\.com\/.*(?:video\/|v\/|embed\/(?:v2\/)?))(\d{15,22})/);
        return match ? match[1] : null;
    }

    async function resolveTikTokVideoId(url) {
        if (!url) return null;
        
        // 1. Phân tích link tiêu chuẩn trước
        const standardId = getTikTokId(url);
        if (standardId) return standardId;
        
        // 2. Nếu là link YouTube (đề phòng dán nhầm YouTube Short), hỗ trợ phát qua iframe phụ
        const ytId = getYouTubeId(url);
        if (ytId) return `youtube_${ytId}`;
        
        // 3. Fallback cho link TikTok rút gọn (vt.tiktok.com, vm.tiktok.com) thông qua Backend API
        if (url.includes('tiktok.com')) {
            try {
                const res = await fetch(`/api/resolve-tiktok?url=${encodeURIComponent(url)}`);
                if (res.ok) {
                    const json = await res.json();
                    if (json.success && json.videoId) {
                        return json.videoId;
                    }
                }
            } catch (e) {
                console.error("Lỗi phân giải link qua API backend:", e);
            }
        }
        return null;
    }

    function createBurstParticles(x, y) {
        const colors = ['#ff758c', '#ff7eb3', '#f43f5e', '#38bdf8', '#fbbf24', '#a855f7'];
        for (let i = 0; i < 15; i++) {
            const particle = document.createElement('div');
            particle.className = 'pop-particle';
            particle.style.left = `${x}px`;
            particle.style.top = `${y}px`;
            particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            
            const angle = Math.random() * Math.PI * 2;
            const distance = 30 + Math.random() * 70;
            const dx = Math.cos(angle) * distance;
            const dy = Math.sin(angle) * distance;
            
            particle.style.setProperty('--dx', `${dx}px`);
            particle.style.setProperty('--dy', `${dy}px`);
            
            document.body.appendChild(particle);
            
            setTimeout(() => {
                particle.remove();
            }, 600);
        }
    }

    function mountAndShowVideo(videoId) {
        // Tạm dừng nhạc nền nếu đang phát
        if (audioEngine && audioEngine.pauseAudio) {
            audioEngine.pauseAudio();
        }

        const iframeBox = document.getElementById('balloonIframeBox');
        if (!iframeBox) return;

        if (videoId.startsWith('youtube_')) {
            const ytId = videoId.replace('youtube_', '');
            iframeBox.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&enablejsapi=1" allow="autoplay; encrypted-media" allowfullscreen style="width:100%; height:100%; border:none;"></iframe>`;
        } else {
            iframeBox.innerHTML = `<iframe src="https://www.tiktok.com/player/v1/${videoId}?autoplay=1&music_info=1&description=1" allow="autoplay; encrypted-media; fullscreen" allowfullscreen style="width:100%; height:100%; border:none;"></iframe>`;
        }
        videoModal.classList.add('active');
    }

    balloonContainer.addEventListener('click', (e) => {
        if (isPopped) return;
        
        const state = getState();
        const url = state.balloonTiktokUrl;
        if (!url || url.trim() === '') return;

        isPopped = true;
        
        // 1. Hiệu ứng nổ bóng bóng
        const rect = balloonContainer.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        createBurstParticles(centerX, centerY);
        
        balloonContainer.classList.remove('balloon-float');
        balloonContainer.classList.add('popped');

        // 2. Phân giải ID video ĐỒNG BỘ trong cùng Call Stack của Sự kiện Click 
        // để duy trì User Gesture Token (Browsers sẽ cho phép Tự động Mở Loa - Unmute)
        let videoId = getTikTokId(url);
        if (!videoId) {
            const ytId = getYouTubeId(url);
            if (ytId) videoId = `youtube_${ytId}`;
        }

        if (videoId) {
            mountAndShowVideo(videoId);
        } else {
            // Link rút gọn (vt.tiktok.com) phải giải mã qua backend (bất đồng bộ)
            resolveTikTokVideoId(url).then(resolvedId => {
                if (resolvedId) {
                    mountAndShowVideo(resolvedId);
                } else {
                    console.error("Không phân tích được ID video từ URL:", url);
                }
            });
        }
    });

    // Lắng nghe sự kiện kết thúc video từ Iframe (TikTok & YouTube) để tự động reset balloon
    window.addEventListener('message', (event) => {
        // 1. TikTok Player State Change
        if (event.data && event.data['x-tiktok-player']) {
            const message = event.data;
            // value === 0 tức là video kết thúc (ended)
            if (message.type === 'onStateChange' && message.value === 0) {
                console.log('TikTok video kết thúc -> Đóng modal & phục hồi balloon');
                resetBalloon();
            }
        }
        
        // 2. YouTube Player State Change
        if (typeof event.data === 'string') {
            try {
                const data = JSON.parse(event.data);
                if (data.event === 'infoDelivery' && data.info && data.info.playerState === 0) {
                    console.log('YouTube video kết thúc -> Đóng modal & phục hồi balloon');
                    resetBalloon();
                }
            } catch (e) {
                // Không phải tin nhắn của YouTube
            }
        }
    });

    return { updateBalloonVisibility };
}

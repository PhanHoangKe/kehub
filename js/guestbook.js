/**
 * guestbook.js - Sổ Lưu Bút & Thả Tim Interactive 3D
 */
import { escapeHTML } from './config.js';
import { showToast } from './toast.js';

export function initGuestbookEngine() {
    // ── Backward compat refs (vẫn giữ để không crash nếu còn dùng ở nơi khác) ──
    const heartCounterNumber = document.getElementById('heartCounterNumber');
    const btnCopyShareLink = document.getElementById('btnCopyShareLink');
    const guestbookWall = document.getElementById('guestbookWall');
    const btnOpenWishModal = document.getElementById('btnOpenWishModal');
    const wishModal = document.getElementById('wishModal');
    const btnCloseWishModal = document.getElementById('btnCloseWishModal');
    const btnSubmitWish = document.getElementById('btnSubmitWish');

    // ── Emoji Reactions — map xây động từ reactionsConfig (không hardcode) ───
    // Được cập nhật bởi updateReactionsConfig() mỗi khi app.js apply state
    let _reactionsConfig = [];   // [{emoji, title, countId, imgUrl}, ...]

    // Build lookup nhanh: emoji → countId và countId → imgUrl
    let EMOJI_MAP     = {};  // emoji → countId
    let COUNTID_MAP   = {};  // countId → {emoji, title, imgUrl}

    function _rebuildMaps(config) {
        _reactionsConfig = config || [];
        EMOJI_MAP   = {};
        COUNTID_MAP = {};
        _reactionsConfig.forEach(cfg => {
            if (cfg.emoji && cfg.countId) {
                EMOJI_MAP[cfg.emoji]   = cfg.countId;
                COUNTID_MAP[cfg.countId] = cfg;
            }
        });
    }

    // LocalStorage key lưu emoji nào user đã react (để bật active state)
    const LS_KEY = 'youth_my_reactions';

    function getMyReactions() {
        try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
    }
    function saveMyReaction(emoji) {
        const mine = getMyReactions();
        mine[emoji] = (mine[emoji] || 0) + 1;
        localStorage.setItem(LS_KEY, JSON.stringify(mine));
    }

    // Cập nhật số đếm từ object reactions
    function applyReactionCounts(reactions) {
        if (!reactions || typeof reactions !== 'object') return;
        let total = 0;
        Object.entries(EMOJI_MAP).forEach(([emoji, countId]) => {
            const count = reactions[emoji] || 0;
            total += count;
            const el = document.getElementById(countId);
            if (el) el.textContent = count >= 1000
                ? `${(count / 1000).toFixed(1)}k`
                : String(count);
        });
        const totalEl = document.getElementById('reactionTotalCount');
        if (totalEl) totalEl.textContent = total >= 1000
            ? `${(total / 1000).toFixed(1)}k`
            : String(total);
        // backward compat
        if (heartCounterNumber) heartCounterNumber.textContent = reactions['❤️'] || 0;
    }

    // Đánh dấu emoji user đã react — gọi SAU khi dataset.emoji đã được gán
    function applyActiveStates() {
        const mine = getMyReactions();
        document.querySelectorAll('.reaction-btn').forEach(btn => {
            const emoji = btn.dataset.emoji;
            // Chỉ đánh dấu reacted nếu emoji đã được gán (khác rỗng) VÀ user đã react emoji đó
            if (emoji && emoji.length > 0) {
                btn.classList.toggle('reacted', !!(mine[emoji] && mine[emoji] > 0));
            } else {
                btn.classList.remove('reacted');
            }
        });
    }

    // Floating emoji nổi lên khi click
    function createFloatingEmoji(emoji, x, y) {
        const el = document.createElement('div');
        el.className = 'floating-emoji-pop';
        const btnImg = document.querySelector(`.reaction-btn[data-emoji="${emoji}"] img`);
        const imgUrl = btnImg?.getAttribute('src') || COUNTID_MAP[EMOJI_MAP[emoji]]?.imgUrl || '';
        if (imgUrl) {
            el.innerHTML = `<img src="${imgUrl}" style="width:48px;height:48px;object-fit:cover;border-radius:50%;border:2px solid #f59e0b;box-shadow:0 6px 16px rgba(245,158,11,0.5);">`;
        } else {
            el.textContent = emoji;
        }
        el.style.left = `${x - 24}px`;
        el.style.top  = `${y - 30}px`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1400);
    }

    // ── Web Audio Synth for Glass Shatter Sound Effect ──────────────────────
    function playGlassShatterSound() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();

            // 1. Noise burst (shatter crunch)
            const bufferSize = ctx.sampleRate * 0.18;
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25));
            }
            const noise = ctx.createBufferSource();
            noise.buffer = buffer;

            const highpass = ctx.createBiquadFilter();
            highpass.type = 'highpass';
            highpass.frequency.value = 2400;

            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.6, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.18);

            noise.connect(highpass);
            highpass.connect(gain);
            gain.connect(ctx.destination);
            noise.start();

            // 2. High tinkling pitch shards (glass ping)
            [1200, 1800, 2400, 3200].forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const oscGain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.02);
                osc.frequency.exponentialRampToValueAtTime(freq * 0.4, ctx.currentTime + idx * 0.02 + 0.12);

                oscGain.gain.setValueAtTime(0.3, ctx.currentTime + idx * 0.02);
                oscGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.02 + 0.12);

                osc.connect(oscGain);
                oscGain.connect(ctx.destination);
                osc.start(ctx.currentTime + idx * 0.02);
                osc.stop(ctx.currentTime + idx * 0.02 + 0.13);
            });
        } catch { /* AudioContext muted or blocked */ }
    }

    // ── Glass Shatter FX Visual Engine ────────────────────────────────────────
    function triggerGlassShatterFX(btn, imgEl) {
        const rect = imgEl ? imgEl.getBoundingClientRect() : btn.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        playGlassShatterSound();

        // 1. Shake animation
        const bar = document.getElementById('reactionBar') || btn;
        bar.classList.remove('shatter-shake');
        void bar.offsetWidth;
        bar.classList.add('shatter-shake');
        setTimeout(() => bar.classList.remove('shatter-shake'), 350);

        // 2. Container
        const container = document.createElement('div');
        container.className = 'glass-shatter-container';
        container.style.left = `${centerX}px`;
        container.style.top = `${centerY}px`;
        document.body.appendChild(container);

        // 3. Crack Flash
        const flash = document.createElement('div');
        flash.style.cssText = `
            position: absolute;
            width: ${rect.width * 1.6}px;
            height: ${rect.height * 1.6}px;
            left: -${rect.width * 0.8}px;
            top: -${rect.height * 0.8}px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(251,191,36,0.8) 40%, transparent 75%);
            box-shadow: 0 0 40px #fff, 0 0 80px #fbbf24;
            pointer-events: none;
            animation: glassCrackFlash 0.35s ease-out forwards;
        `;
        container.appendChild(flash);

        // SVG lines
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', rect.width * 2);
        svg.setAttribute('height', rect.height * 2);
        svg.style.cssText = `
            position: absolute;
            left: -${rect.width}px;
            top: -${rect.height}px;
            pointer-events: none;
        `;
        let svgContent = '';
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const x2 = rect.width + Math.cos(angle) * rect.width * 0.9;
            const y2 = rect.height + Math.sin(angle) * rect.height * 0.9;
            svgContent += `<line x1="${rect.width}" y1="${rect.height}" x2="${x2}" y2="${y2}" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-dasharray="4,2" />`;
        }
        svg.innerHTML = svgContent;
        container.appendChild(svg);

        // 4. Shard Particles
        const shardCount = 18;
        const shards = [];

        for (let i = 0; i < shardCount; i++) {
            const shard = document.createElement('div');
            shard.className = 'glass-shard';

            const size = Math.random() * 14 + 8;
            const angle = (i / shardCount) * Math.PI * 2 + (Math.random() * 0.4 - 0.2);
            const dist = Math.random() * 90 + 70;
            const vx = Math.cos(angle) * dist;
            const vy = Math.sin(angle) * dist;
            const rot = (Math.random() - 0.5) * 720;

            shard.style.width = `${size}px`;
            shard.style.height = `${size * (Math.random() * 0.8 + 0.6)}px`;
            shard.style.left = '0px';
            shard.style.top = '0px';
            shard.style.transform = `translate(-50%, -50%) rotate(${Math.random() * 360}deg)`;

            container.appendChild(shard);
            shards.push({ el: shard, vx, vy, rot });
        }

        const startTime = performance.now();
        const duration = 500;

        function animateShards(now) {
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / duration);
            const easeOut = 1 - Math.pow(1 - progress, 3);

            shards.forEach(s => {
                const curX = s.vx * easeOut;
                const curY = s.vy * easeOut + (progress * progress * 40);
                const curRot = s.rot * progress;
                const opacity = 1 - progress;
                const scale = 1 - progress * 0.4;
                s.el.style.transform = `translate(calc(-50% + ${curX}px), calc(-50% + ${curY}px)) rotate(${curRot}deg) scale(${scale})`;
                s.el.style.opacity = opacity;
            });

            if (progress < 1) {
                requestAnimationFrame(animateShards);
            } else {
                container.remove();
            }
        }
        requestAnimationFrame(animateShards);
    }

    // ── Khởi tạo reaction buttons (Hold-to-Zoom & Glass Shatter) ────────────
    document.querySelectorAll('.reaction-btn').forEach(btn => {
        const imgEl = btn.querySelector('.reaction-emoji-img');

        let animFrame = null;
        let holdStartTime = 0;
        let isHolding = false;
        let isShattered = false;
        const HOLD_DURATION = 1300; // 1.3 giây đè nút để vỡ kính

        async function triggerReactionSubmit(clientX, clientY, customMsg = null) {
            const emoji = btn.dataset.emoji;
            if (!emoji) return;
            const countId = EMOJI_MAP[emoji];
            const countEl = countId ? document.getElementById(countId) : null;
            if (countEl) {
                const cur = parseInt(countEl.textContent.replace('k','')) || 0;
                countEl.textContent = String(cur + 1);
            }

            createFloatingEmoji(emoji, clientX, clientY);

            btn.classList.add('reaction-pulse');
            setTimeout(() => btn.classList.remove('reaction-pulse'), 500);

            saveMyReaction(emoji);
            applyActiveStates();

            try {
                const res = await fetch('/api/reactions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ emoji }),
                });
                const data = await res.json();
                if (data.success && data.reactions) {
                    applyReactionCounts(data.reactions);
                }
            } catch { /* offline */ }

            showToast(customMsg || `Bạn đã gửi ${emoji} đến Kế!`);
        }

        function updateZoomLevel(timestamp) {
            if (!isHolding || isShattered) return;
            const elapsed = timestamp - holdStartTime;
            const progress = Math.min(1, elapsed / HOLD_DURATION);

            // Phóng to dần từ 1.0 đến 2.8x
            const scale = 1 + progress * 1.8;
            const rotate = Math.sin(progress * Math.PI * 4) * 5;

            if (imgEl) {
                imgEl.style.transform = `scale(${scale}) rotate(${rotate}deg)`;
                imgEl.style.zIndex = '1000';
            }
            btn.classList.add('is-holding');

            if (progress >= 1 && !isShattered) {
                isShattered = true;
                if (imgEl) {
                    imgEl.style.transform = 'scale(1) rotate(0deg)';
                    imgEl.style.zIndex = '';
                }
                btn.classList.remove('is-holding');

                const rect = imgEl ? imgEl.getBoundingClientRect() : btn.getBoundingClientRect();
                triggerGlassShatterFX(btn, imgEl);
                triggerReactionSubmit(rect.left + rect.width / 2, rect.top + rect.height / 2, `💥 BỘT PHÁT CẢM XÚC CỰC MẠNH: ${btn.dataset.emoji}!`);
                return;
            }

            animFrame = requestAnimationFrame(updateZoomLevel);
        }

        function startHold(e) {
            if (e.type === 'mousedown' && e.button !== 0) return;
            isHolding = true;
            isShattered = false;
            holdStartTime = performance.now();

            if (imgEl) {
                imgEl.style.transition = 'none';
            }
            animFrame = requestAnimationFrame(updateZoomLevel);
        }

        function endHold(e) {
            if (!isHolding) return;
            isHolding = false;
            cancelAnimationFrame(animFrame);

            const elapsed = performance.now() - holdStartTime;

            if (imgEl) {
                imgEl.style.transition = 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
                imgEl.style.transform = '';
                imgEl.style.zIndex = '';
            }
            btn.classList.remove('is-holding');

            if (!isShattered) {
                if (elapsed < 220) {
                    const clientX = e.clientX || (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : window.innerWidth / 2);
                    const clientY = e.clientY || (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : window.innerHeight / 2);
                    triggerReactionSubmit(clientX, clientY);
                }
            }
        }

        btn.addEventListener('mousedown', startHold);
        btn.addEventListener('mouseup', endHold);
        btn.addEventListener('mouseleave', endHold);

        btn.addEventListener('touchstart', (e) => { startHold(e); }, { passive: true });
        btn.addEventListener('touchend', endHold);
        btn.addEventListener('touchcancel', endHold);

        if (imgEl) {
            imgEl.addEventListener('dragstart', (e) => e.preventDefault());
        }
    });

    // Reactions sẽ được cập nhật bởi app.js thông qua applyReactionCounts()
    // sau khi loadBackendData() hoàn tất → không cần fetch riêng ở đây nữa.
    // (tránh fetch /api/data 2 lần khi trang load)

    // applyActiveStates() sẽ được gọi bởi app.js sau khi
    // applyStateToDOM() đã gán dataset.emoji vào các buttons.
    // Không gọi ở đây vì lúc này data-emoji chưa được set → sẽ bị sai.

    if (btnCopyShareLink) {
        btnCopyShareLink.addEventListener('click', () => {
            const currentUrl = window.location.href;
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(currentUrl).then(() => {
                    showToast("Đã sao chép liên kết! Dán lên Facebook hoặc Messenger ngay nhé!", 'info');
                });
            } else {
                const tempInput = document.createElement('input');
                tempInput.value = currentUrl;
                document.body.appendChild(tempInput);
                tempInput.select();
                document.execCommand('copy');
                document.body.removeChild(tempInput);
                showToast("Đã sao chép liên kết! Dán lên Facebook hoặc Messenger ngay nhé!", 'info');
            }
        });
    }

    function renderWishCard(author, message, timeStr, styleIndex) {
        if (!guestbookWall) return;
        const card = document.createElement('div');
        card.className = `wish-card wish-style-${styleIndex || 1}`;
        card.innerHTML = `
            <div class="wish-header">
                <span class="wish-author"><i class="fa-solid fa-user-pen"></i> ${escapeHTML(author || 'Người Bạn Ẩn Danh')}</span>
                <span class="wish-time">${escapeHTML(timeStr || 'Vừa xong')}</span>
            </div>
            <p class="wish-msg">"${escapeHTML(message)}"</p>
        `;
        guestbookWall.prepend(card);
    }

    if (btnOpenWishModal && wishModal) {
        btnOpenWishModal.addEventListener('click', () => wishModal.classList.add('active'));
    }
    if (btnCloseWishModal && wishModal) {
        btnCloseWishModal.addEventListener('click', () => wishModal.classList.remove('active'));
    }

    if (btnSubmitWish) {
        btnSubmitWish.addEventListener('click', () => {
            const inputWishAuthor = document.getElementById('inputWishAuthor');
            const inputWishMessage = document.getElementById('inputWishMessage');
            const author = inputWishAuthor ? inputWishAuthor.value.trim() : '';
            const message = inputWishMessage ? inputWishMessage.value.trim() : '';

            if (!message) {
                showToast("Vui lòng viết đôi lời chúc gửi Kế nhé!", 'warning');
                return;
            }

            const now = new Date();
            const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')} - ${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;
            const style = Math.floor(Math.random() * 3) + 1;

            const wishObj = { author: author || 'Người Bạn Ẩn Danh', message, time: timeStr, style };
            renderWishCard(wishObj.author, wishObj.message, wishObj.time, wishObj.style);

            fetch('/api/wishes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(wishObj)
            }).catch(() => {});

            if (inputWishMessage) inputWishMessage.value = '';
            if (wishModal) wishModal.classList.remove('active');
            showToast("Đã gửi lời chúc của bạn lên Sổ Lưu Bút! Cảm ơn bạn rất nhiều!");
        });
    }

    // ── Anonymous Message + Realistic 3D Tree ────────────────────────────────
    const btnOpenAnonymous       = document.getElementById('btnOpenAnonymous');
    const anonymousModal         = document.getElementById('anonymousModal');
    const btnCloseAnonymousModal = document.getElementById('btnCloseAnonymousModal');
    const btnSubmitAnonymous     = document.getElementById('btnSubmitAnonymous');
    const inputAnonymousMessage  = document.getElementById('inputAnonymousMessage');
    const anonymousCharCount     = document.getElementById('anonymousCharCount');
    const bigTreeLeavesEl        = document.getElementById('bigTreeLeaves');
    const fallenLeavesLayerEl    = document.getElementById('fallenLeavesLayer');

    const MAX_CHARS    = 500;
    const TOTAL_LEAVES = 72; // more leaves for denser canopy

    let treeLeaves   = [];
    let prevWordCount = 0;
    let leavesBuilt  = false;

    // ── Utilities ──────────────────────────────────────────────────────────
    const rand    = (mn, mx) => Math.random() * (mx - mn) + mn;
    const randInt = (mn, mx) => Math.floor(rand(mn, mx + 1));
    const pick    = arr => arr[Math.floor(Math.random() * arr.length)];

    function countWords(str) {
        if (!str) return 0;
        return str.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
    }

    // ── Canopy layout — 6 natural tiers narrowing toward apex ──────────────
    function canopyPosition(i) {
        // Each tier: count of leaves, bottom offset %, spread width %, depth layer
        const tiers = [
            { count: 14, bottomPct:  3, heightPct: 16, widthPct: 94, depthMin: 0.9,  depthMax: 1.3  },
            { count: 14, bottomPct: 18, heightPct: 16, widthPct: 88, depthMin: 0.85, depthMax: 1.2  },
            { count: 14, bottomPct: 33, heightPct: 16, widthPct: 80, depthMin: 0.8,  depthMax: 1.15 },
            { count: 12, bottomPct: 48, heightPct: 17, widthPct: 68, depthMin: 0.75, depthMax: 1.1  },
            { count: 10, bottomPct: 64, heightPct: 17, widthPct: 52, depthMin: 0.7,  depthMax: 1.0  },
            { count:  8, bottomPct: 80, heightPct: 15, widthPct: 34, depthMin: 0.65, depthMax: 0.9  },
        ];
        let idx = i;
        for (const tier of tiers) {
            if (idx < tier.count) {
                const posInTier   = idx / tier.count;
                // Slight oval cluster shape: denser at horizontal center
                const angleRad    = posInTier * Math.PI * 2;
                const ovalX       = Math.sin(angleRad) * (tier.widthPct / 2);
                const jitterX     = rand(-tier.widthPct * 0.14, tier.widthPct * 0.14);
                const jitterY     = rand(-3, tier.heightPct - 1);
                const scale       = rand(tier.depthMin, tier.depthMax);
                // Deeper leaves are slightly darker (simulated via zIndex and brightness)
                const depthFactor = (scale - tier.depthMin) / (tier.depthMax - tier.depthMin);
                return {
                    leftPct:    50 + ovalX + jitterX,
                    bottomPct:  tier.bottomPct + jitterY,
                    rot:        rand(-50, 50),
                    scale,
                    swayDur:    rand(2.2, 5.8),
                    swayDelay:  rand(-5, 0),
                    colorIdx:   randInt(1, 6),
                    // Back leaves get lower zIndex and slight darkness
                    zIdx:       Math.round(200 + depthFactor * 120),
                    brightness: 0.82 + depthFactor * 0.22,
                };
            }
            idx -= tier.count;
        }
        // Overflow fallback
        return {
            leftPct: 50 + rand(-38, 38), bottomPct: rand(5, 85),
            rot: rand(-45, 45), scale: rand(0.7, 1.2),
            swayDur: rand(2.8, 5), swayDelay: rand(-4, 0),
            colorIdx: randInt(1, 6), zIdx: 200, brightness: 1,
        };
    }

    // ── Build all leaves on first open ────────────────────────────────────
    function buildTreeLeaves() {
        if (leavesBuilt) return;
        if (!bigTreeLeavesEl) return;
        bigTreeLeavesEl.innerHTML = '';
        treeLeaves = [];

        for (let i = 0; i < TOTAL_LEAVES; i++) {
            const pos  = canopyPosition(i);
            const leaf = document.createElement('div');
            leaf.className = `tree-leaf color-${pos.colorIdx}`;
            // Base resting transform — stored separately so reset is accurate
            const restTransform = `rotate(${pos.rot}deg) scale(${pos.scale})`;
            leaf.style.left       = `${pos.leftPct}%`;
            leaf.style.bottom     = `${pos.bottomPct}%`;
            leaf.style.transform  = restTransform;
            leaf.style.zIndex     = pos.zIdx;
            leaf.style.filter     = `brightness(${pos.brightness})`;
            leaf.style.setProperty('--sway-dur',   `${pos.swayDur}s`);
            leaf.style.setProperty('--sway-delay', `${pos.swayDelay}s`);
            leaf.style.setProperty('--leaf-rot',   `${pos.rot}deg`);
            leaf.dataset.leafIndex = String(i);

            bigTreeLeavesEl.appendChild(leaf);
            treeLeaves.push({ el: leaf, state: 'active', pos, restTransform });
        }
        leavesBuilt = true;
    }

    const countActiveLeaves = () => treeLeaves.filter(l => l.state === 'active').length;

    // ── Spawn ambient fallen leaf drifting across the overlay ─────────────
    function spawnFloatingFallenLeaf() {
        if (!fallenLeavesLayerEl) return;
        const el = document.createElement('div');
        el.className = `fallen-leaf color-${randInt(1, 6)}`;

        // Start position: right side of overlay (tree side), random height
        const startXPct = rand(56, 88);
        const startYPct = rand(10, 58);
        // Drift: leftward with slight vertical oscillation captured by CSS keyframe
        const drift  = -rand(90, 240);
        const rotEnd = pick([-1, 1]) * rand(280, 760);
        const dur    = rand(2.8, 4.6);

        el.style.setProperty('--fstart-x', `${startXPct}%`);
        el.style.setProperty('--fstart-y', `${startYPct}%`);
        el.style.setProperty('--fdrift',   `${drift}px`);
        el.style.setProperty('--frot',     `${rotEnd}deg`);
        el.style.setProperty('--fdur',     `${dur}s`);

        fallenLeavesLayerEl.appendChild(el);
        setTimeout(() => el.remove(), dur * 1000 + 400);
    }

    // ── Detach one blossom from tree with realistic tumble physics ────────
    function makeLeafFall(leafData) {
        if (leafData.state !== 'active') return;
        leafData.state = 'falling';
        const el = leafData.el;

        // Hoa đào tròn — xoay nhiều vòng hơn lá để trông đẹp
        const signX   = rand(0, 1) > 0.5 ? 1 : -1;
        const fallX   = signX * rand(25, 130);
        const fallY   = rand(160, 380);
        const fallR   = pick([-1, 1]) * rand(200, 720); // nhiều vòng hơn
        const fallDur = rand(1.4, 2.2);                 // chậm hơn = lãng mạn hơn

        el.style.setProperty('--fall-x',   `${fallX}px`);
        el.style.setProperty('--fall-y',   `${fallY}px`);
        el.style.setProperty('--fall-r',   `${fallR}deg`);
        el.style.setProperty('--fall-dur', `${fallDur}s`);

        // Remove resting sway, apply fall keyframe
        el.style.animation = 'none';
        void el.offsetWidth;
        el.classList.add('falling');

        const fallMs = fallDur * 1000;
        setTimeout(() => {
            spawnFloatingFallenLeaf();
            el.style.visibility = 'hidden';
            el.classList.remove('falling');
            el.style.animation = '';
            leafData.state = 'gone';
        }, fallMs);
    }

    // ── Regrow a blossom — nở từ nụ ─────────────────────────────────────
    function makeLeafGrow(leafData) {
        if (leafData.state !== 'gone') return;
        leafData.state = 'growing';
        const el = leafData.el;

        el.style.visibility = 'visible';
        el.style.transform   = leafData.restTransform;
        el.style.animation   = 'none';
        void el.offsetWidth;
        el.classList.add('growing');

        setTimeout(() => {
            el.classList.remove('growing');
            leafData.state = 'active';
        }, 960); // khớp với 0.95s CSS
    }

    // ── Fisher-Yates shuffle ──────────────────────────────────────────────
    function shuffleArr(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    // ── Core: sync visible leaves to match word count ─────────────────────
    // Each word typed sheds 1 leaf; each word deleted regrows 1 leaf.
    // Uses staggered delays so leaves fall/grow one at a time naturally.
    function syncLeavesToWordCount(wordCount) {
        if (!leavesBuilt) return;

        const targetFallen  = Math.min(TOTAL_LEAVES, Math.max(0, wordCount));
        const desiredActive = TOTAL_LEAVES - targetFallen;
        const activeNow     = countActiveLeaves();

        if (activeNow > desiredActive) {
            // Need to shed leaves
            const needFall   = activeNow - desiredActive;
            const candidates = shuffleArr(treeLeaves.filter(l => l.state === 'active'));
            for (let i = 0; i < needFall && i < candidates.length; i++) {
                // Stagger: 0–60ms between each leaf for a natural cascade
                const delay = i * rand(35, 75);
                setTimeout(() => makeLeafFall(candidates[i]), delay);
            }
        } else if (activeNow < desiredActive) {
            // Need to regrow leaves
            const needGrow   = desiredActive - activeNow;
            const candidates = shuffleArr(treeLeaves.filter(l => l.state === 'gone')).slice(0, needGrow);
            for (let i = 0; i < candidates.length; i++) {
                // Slightly longer stagger for grow to feel satisfying
                const delay = i * rand(50, 100);
                setTimeout(() => makeLeafGrow(candidates[i]), delay);
            }
        }
    }

    // ── Reset tree to fully-leafed state ──────────────────────────────────
    function resetAllLeaves() {
        if (!leavesBuilt) return;
        if (fallenLeavesLayerEl) fallenLeavesLayerEl.innerHTML = '';
        treeLeaves.forEach(ld => {
            const el = ld.el;
            el.classList.remove('falling', 'growing');
            el.style.animation  = '';
            el.style.visibility = 'visible';
            el.style.transform  = ld.restTransform;
            el.style.filter     = `brightness(${ld.pos.brightness})`;
            ld.state = 'active';
        });
    }

    // ── Char counter + word-count → tree sync ────────────────────────────
    function updateCharCount() {
        if (!inputAnonymousMessage || !anonymousCharCount) return;
        const len = inputAnonymousMessage.value.length;
        anonymousCharCount.textContent = len;

        const counterEl = anonymousCharCount.parentElement;
        counterEl.classList.remove('near-limit', 'over-limit');
        if (len > MAX_CHARS)          counterEl.classList.add('over-limit');
        else if (len > MAX_CHARS - 100) counterEl.classList.add('near-limit');

        const wordsNow = countWords(inputAnonymousMessage.value);
        if (wordsNow !== prevWordCount) {
            syncLeavesToWordCount(wordsNow);
            prevWordCount = wordsNow;
        }
        updateSubmitState();
    }

    function updateSubmitState() {
        if (!btnSubmitAnonymous || !inputAnonymousMessage) return;
        const len      = inputAnonymousMessage.value.trim().length;
        const hasMedia = !!currentMediaData;
        // Cho phép gửi nếu có text hợp lệ HOẶC có media đính kèm
        btnSubmitAnonymous.disabled = (len === 0 && !hasMedia) || len > MAX_CHARS;
    }

    if (inputAnonymousMessage) {
        inputAnonymousMessage.maxLength = MAX_CHARS;
        inputAnonymousMessage.addEventListener('input', updateCharCount);
    }

    // ── Notebook Pen / Eraser animation engine ────────────────────────────
    const penContainer    = document.getElementById('penContainer');
    const eraserContainer = document.getElementById('eraserContainer');
    const penStatusDot    = document.getElementById('penStatusDot');
    const penStatusText   = document.getElementById('penStatusText');
    const eraserCrumbs    = document.getElementById('eraserCrumbs');
    const notebookDateEl  = document.getElementById('notebookDate');

    // Set notebook date
    if (notebookDateEl) {
        const now = new Date();
        notebookDateEl.textContent = now.toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }

    let prevInputLen = 0;
    let penWriteTimer = null;
    let eraserHideTimer = null;

    function spawnEraserCrumbs() {
        if (!eraserCrumbs) return;
        eraserCrumbs.innerHTML = '';
        const count = Math.floor(Math.random() * 3) + 2;
        for (let i = 0; i < count; i++) {
            const crumb = document.createElement('div');
            crumb.className = 'eraser-crumb';
            crumb.style.animationDelay = `${i * 60}ms`;
            crumb.style.width = `${Math.floor(Math.random() * 3) + 3}px`;
            crumb.style.height = crumb.style.width;
            eraserCrumbs.appendChild(crumb);
        }
        setTimeout(() => { if (eraserCrumbs) eraserCrumbs.innerHTML = ''; }, 800);
    }

    function showPen() {
        if (!penContainer || !eraserContainer) return;
        penContainer.classList.add('is-writing');
        eraserContainer.classList.remove('is-erasing');
        if (penStatusDot) { penStatusDot.className = 'pen-status-dot writing'; }
        if (penStatusText) penStatusText.textContent = 'Đang viết...';
    }

    function showEraser() {
        if (!penContainer || !eraserContainer) return;
        penContainer.classList.remove('is-writing');
        eraserContainer.classList.add('is-erasing');
        if (penStatusDot) { penStatusDot.className = 'pen-status-dot erasing'; }
        if (penStatusText) penStatusText.textContent = 'Đang xóa...';
        spawnEraserCrumbs();
    }

    function hideBoth() {
        if (!penContainer || !eraserContainer) return;
        penContainer.classList.remove('is-writing');
        eraserContainer.classList.remove('is-erasing');
        if (penStatusDot) { penStatusDot.className = 'pen-status-dot'; }
        if (penStatusText) penStatusText.textContent = 'Sẵn sàng viết...';
    }

    if (inputAnonymousMessage) {
        inputAnonymousMessage.addEventListener('input', () => {
            const curLen = inputAnonymousMessage.value.length;
            clearTimeout(penWriteTimer);
            clearTimeout(eraserHideTimer);

            if (curLen > prevInputLen) {
                showPen();
            } else if (curLen < prevInputLen) {
                showEraser();
            }
            prevInputLen = curLen;

            penWriteTimer = setTimeout(() => {
                hideBoth();
            }, 800);
        });

        inputAnonymousMessage.addEventListener('focus', () => {
            if (inputAnonymousMessage.value.length > 0) return;
            if (penContainer) {
                penContainer.style.opacity = '0.35';
                penContainer.style.transform = 'rotate(-38deg) translateY(2px)';
            }
        });

        inputAnonymousMessage.addEventListener('blur', () => {
            hideBoth();
            if (penContainer) {
                penContainer.style.opacity = '';
                penContainer.style.transform = '';
            }
        });
    }

    // ── Media Attachment Engine ───────────────────────────────────────────
    // DOM refs
    const btnAnonRecord      = document.getElementById('btnAnonRecord');
    const btnAnonPickFile    = document.getElementById('btnAnonPickFile');
    const anonFileInput      = document.getElementById('anonFileInput');
    const anonRecordStatus   = document.getElementById('anonRecordStatus');
    const anonRecordTimer    = document.getElementById('anonRecordTimer');
    const btnAnonStopRecord  = document.getElementById('btnAnonStopRecord');
    const btnAnonCancelRecord= document.getElementById('btnAnonCancelRecord');
    const anonMediaPreview   = document.getElementById('anonMediaPreview');
    const anonPreviewInner   = anonMediaPreview ? anonMediaPreview.querySelector('.anon-preview-inner') : null;

    // ⚠️ NÚT X (xoá đính kèm) — TẠO 100% BẰNG JS (không dựa vào HTML tĩnh nữa)
    //    → Dù HTML cache nút cũ hay sao cũng không liên quan: nút này chắc chắn
    //      là con TRỰC TIẾP của .anon-preview-inner → position:absolute relative với
    //      .anon-preview-inner (position:relative) đã được CSS set → KHÔNG BAO GIỜ
    //      bay lạc ra ngoài khối preview được nữa.
    let _cachedRemoveBtn = null;
    function _getOrCreateRemoveBtn() {
        if (!anonPreviewInner) return null;
        // Nếu đã tạo rồi → return instance cũ (giữ listener click)
        if (_cachedRemoveBtn && _cachedRemoveBtn.parentNode === anonPreviewInner) return _cachedRemoveBtn;
        if (_cachedRemoveBtn) _cachedRemoveBtn.remove();

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id   = 'btnAnonRemoveMedia';
        btn.title = 'Xoá đính kèm';
        btn.className = 'anon-remove-media';
        btn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        btn.addEventListener('click', clearMedia);
        _cachedRemoveBtn = btn;
        anonPreviewInner.appendChild(btn);
        return btn;
    }

    // Media state
    let currentMediaData = null;   // base64 dataURL string
    let currentMediaType = null;   // 'audio' | 'image' | 'video'
    let mediaRecorder    = null;
    let recordedChunks   = [];
    let recordTimerID    = null;
    let recordSeconds    = 0;
    const MAX_RECORD_SEC = 120;    // 2 phút tối đa

    // ── Helpers ──────────────────────────────────────────────────────────
    function formatTime(sec) {
        const m = String(Math.floor(sec / 60)).padStart(2, '0');
        const s = String(sec % 60).padStart(2, '0');
        return `${m}:${s}`;
    }

    // Dọn dẹp + bảo toàn nút X bên trong preview-inner (nếu không nó sẽ bị innerHTML='' xoá mất)
    function _wipeInnerPreserveRemoveBtn() {
        if (!anonPreviewInner) return;
        const btn = _getOrCreateRemoveBtn();
        if (btn) btn.remove();
        anonPreviewInner.innerHTML = '';
        if (btn) anonPreviewInner.appendChild(btn);
    }

    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function getMediaDOM() {
        const prev  = document.getElementById('anonMediaPreview');
        const inner = prev ? prev.querySelector('.anon-preview-inner') : null;
        return { prev, inner };
    }

    function showMediaPreview(dataUrl, type, extraInfo = {}) {
        const { prev, inner } = getMediaDOM();
        if (!prev || !inner) {
            console.error('[Guestbook] Không tìm thấy DOM preview (anonMediaPreview / .anon-preview-inner)');
            return;
        }
        try {
            // 1) Lấy ra nút X (tạo mới lần đầu nếu chưa có) → detach khỏi DOM
            const removeBtn = _getOrCreateRemoveBtn();
            if (removeBtn) removeBtn.remove();
            // 2) Xoá toàn bộ nội dung cũ trong khối inner (anh/audio/video preview trước đó)
            inner.innerHTML = '';

            if (type === 'audio') {
                const audio = document.createElement('audio');
                audio.controls = true;
                audio.src = dataUrl;
                audio.className = 'anon-preview-audio';
                audio.preload = 'metadata';
                audio.addEventListener('error', () => {
                    audio.remove();
                    const warn = document.createElement('div');
                    warn.className = 'ap-fallback';
                    warn.innerHTML = `<i class="fa-solid fa-circle-info" style="color:#38bdf8"></i> <span>Đoạn ghi âm đã đính kèm — trình duyệt không phát trực tiếp được, hãy gửi đi hoặc xoá và ghi lại nhé.</span>`;
                    inner.appendChild(warn);
                    if (removeBtn && !removeBtn.parentNode) inner.appendChild(removeBtn);
                });
                inner.appendChild(audio);
                const approxKB = dataUrl.length > 0 ? Math.round((dataUrl.length * 3) / 4 / 1024) : 0;
                console.log('[Guestbook] Preview audio OK. ~size:', approxKB, 'KB');
            } else if (type === 'image') {
                const img = document.createElement('img');
                img.src     = dataUrl;
                img.className = 'anon-preview-img';
                img.alt     = 'Ảnh đính kèm';
                inner.appendChild(img);
            } else if (type === 'video') {
                const video = document.createElement('video');
                video.controls  = true;
                video.src       = dataUrl;
                video.className = 'anon-preview-video';
                video.preload   = 'metadata';
                video.playsInline = true;
                inner.appendChild(video);
            }

            // 3) Append nút X LÀM CON CUỐI cùng của inner → DOM order sau audio/img/video
            //    → position absolute so với inner (relative) nên nằm góc trên phải, đè lên
            //      trên cùng của media, KHÔNG BAO GIỜ bị đẩy ra ngoài khối.
            if (removeBtn && !removeBtn.parentNode) inner.appendChild(removeBtn);

            // 4) Hiên khối preview (outer container) — BẮT BUỘC PHẢI CHẠY ĐC ĐỂ KHỐI HIỆN RA
            prev.classList.add('is-visible');

            currentMediaData = dataUrl;
            currentMediaType = type;
            updateSubmitState();
        } catch (err) {
            // BẮT BẤT KỲ EXCEPTION NÀO → ĐẢM BẢO VẪN ADD .is-visible ĐỂ NGƯỜI DÙNG THẤY
            // (hoặc fallback warn rõ ràng thay vì im lặng biến mất như bug trước)
            console.error('[Guestbook] CRASH trong showMediaPreview → hiển thị fallback:', err);
            try {
                prev.classList.add('is-visible');
                inner.innerHTML = `
                    <div class="ap-fallback" style="border-color:rgba(244,63,94,0.35);background:rgba(244,63,94,0.08);color:rgba(255,255,255,0.85);">
                        <i class="fa-solid fa-triangle-exclamation" style="color:#f87171"></i>
                        <span>Đã ghi <strong>thành công</strong> và file đã sẵn sàng gửi!
                        <br>(Lỗi UI khi tạo trình phát — ấn <strong>Niêm phong & Gửi đi</strong> là được, hoặc ấn X để xoá)
                        </span>
                    </div>
                `;
                const removeBtn = _getOrCreateRemoveBtn();
                if (removeBtn) {
                    if (removeBtn.parentNode) removeBtn.remove();
                    inner.appendChild(removeBtn);
                }
                currentMediaData = dataUrl;
                currentMediaType = type;
                updateSubmitState();
            } catch (e2) { console.error('[Guestbook] Fallback cũng fail:', e2); }
        }
    }

    function clearMedia() {
        currentMediaData = null;
        currentMediaType = null;
        const { prev, inner } = getMediaDOM();
        if (prev)  prev.classList.remove('is-visible');
        if (inner) _wipeInnerPreserveRemoveBtn();
        const fileInp = document.getElementById('anonFileInput');
        if (fileInp) fileInp.value = '';
        updateSubmitState();
    }

    // ── File picker (image / video) ───────────────────────────────────────
    if (btnAnonPickFile && anonFileInput) {
        btnAnonPickFile.addEventListener('click', () => anonFileInput.click());

        anonFileInput.addEventListener('change', async () => {
            const file = anonFileInput.files[0];
            if (!file) return;

            // Size guard trước khi convert
            const MAX_MB = file.type.startsWith('video') ? 30 : 5;
            if (file.size > MAX_MB * 1024 * 1024) {
                showToast(`File quá lớn! Tối đa ${MAX_MB}MB nhé.`, 'warning');
                anonFileInput.value = '';
                return;
            }

            const type = file.type.startsWith('image') ? 'image'
                       : file.type.startsWith('video') ? 'video'
                       : null;
            if (!type) {
                showToast('Chỉ hỗ trợ ảnh và video nhé!');
                anonFileInput.value = '';
                return;
            }

            try {
                const dataUrl = await fileToBase64(file);
                showMediaPreview(dataUrl, type);
                showToast(`Đã chọn ${type === 'image' ? 'ảnh' : 'video'} đính kèm!`);
            } catch {
                showToast('Không đọc được file. Thử lại nhé!', 'error');
            }
        });
    }

    // ── Voice recorder (MediaRecorder API) ───────────────────────────────
    function stopRecordTimer() {
        if (recordTimerID) { clearInterval(recordTimerID); recordTimerID = null; }
    }

    function startRecordTimer() {
        recordSeconds = 0;
        if (anonRecordTimer) anonRecordTimer.textContent = formatTime(0);
        recordTimerID = setInterval(() => {
            recordSeconds++;
            if (anonRecordTimer) anonRecordTimer.textContent = formatTime(recordSeconds);
            // Auto-stop khi đạt giới hạn
            if (recordSeconds >= MAX_RECORD_SEC && mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
                showToast(`Đã đạt ${MAX_RECORD_SEC / 60} phút ghi âm tối đa.`, 'warning');
            }
        }, 1000);
    }

    function enterRecordingMode() {
        if (btnAnonRecord) btnAnonRecord.classList.add('is-recording');
        if (anonRecordStatus) anonRecordStatus.classList.add('is-visible');
    }

    function exitRecordingMode() {
        if (btnAnonRecord) btnAnonRecord.classList.remove('is-recording');
        if (anonRecordStatus) anonRecordStatus.classList.remove('is-visible');
        stopRecordTimer();
    }
    // Đảm bảo DOM sạch ngay khi khởi tạo (mobile cache có thể giữ class cũ)
    exitRecordingMode();

    if (btnAnonRecord) {
        btnAnonRecord.addEventListener('click', async () => {
            // Nếu đang ghi → dừng
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
                return;
            }

            // Xin quyền microphone
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            } catch (err) {
                showToast('Không truy cập được microphone. Hãy cấp quyền trong trình duyệt nhé!', 'error');
                return;
            }

            // Chọn codec tốt nhất có hỗ trợ
            const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', '']
                .find(m => m === '' || MediaRecorder.isTypeSupported(m));

            recordedChunks = [];
            mediaRecorder  = new MediaRecorder(stream, mimeType ? { mimeType } : {});

            mediaRecorder.ondataavailable = e => {
                if (e.data && e.data.size > 0) recordedChunks.push(e.data);
            };

            mediaRecorder.onstop = () => {
                stream.getTracks().forEach(t => t.stop());
                exitRecordingMode();

                const hasRecording = recordedChunks.length > 0
                    && recordedChunks.some(c => c && c.size > 50);

                if (!hasRecording) {
                    console.warn('[Guestbook] Ghi âm không có dữ liệu (recordedChunks rỗng hoặc < 50 bytes). Thời gian ghi:', recordSeconds, 's');
                    showToast('Ghi âm quá ngắn! Hãy giữ nút ghi ít nhất 0.5 giây nhé.', 'error');
                    recordedChunks = [];
                    return;
                }

                const blob     = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
                if (blob.size < 512) {
                    console.warn('[Guestbook] Blob ghi âm quá nhỏ (', blob.size, 'bytes). Bỏ qua.');
                    showToast('Ghi âm không nhận được âm thanh. Kiểm tra micro và thử lại nhé.');
                    recordedChunks = [];
                    return;
                }

                const finalDurationSec = recordSeconds || 0;
                const reader   = new FileReader();
                reader.onload  = () => {
                    try {
                        showMediaPreview(reader.result, 'audio', { durationSec: finalDurationSec });
                        console.log('[Guestbook] Ghi âm OK. Blob size:', Math.round(blob.size/1024), 'KB, mime:', blob.type || mediaRecorder.mimeType);
                    } catch (err) {
                        console.error('[Guestbook] Lỗi showMediaPreview sau ghi âm:', err);
                        currentMediaData = reader.result;
                        currentMediaType = 'audio';
                        updateSubmitState();
                        const { prev } = getMediaDOM();
                        if (prev) prev.classList.add('is-visible');
                    }
                };
                reader.onerror = () => {
                    console.error('[Guestbook] FileReader lỗi khi đọc blob ghi âm.');
                    showToast('Lỗi đọc file ghi âm. Thử ghi lại nhé.', 'error');
                };
                reader.readAsDataURL(blob);
                recordedChunks = [];
            };

            mediaRecorder.onerror = (e) => {
                console.error('[Guestbook] MediaRecorder lỗi:', e);
                showToast('Ghi âm gặp lỗi trình duyệt. Thử lại nhé.', 'error');
            };

            mediaRecorder.start(250); // collect every 250ms
            enterRecordingMode();
            startRecordTimer();
            clearMedia(); // xoá media cũ nếu có
        });
    }

    if (btnAnonStopRecord) {
        btnAnonStopRecord.addEventListener('click', () => {
            if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
        });
    }

    if (btnAnonCancelRecord) {
        btnAnonCancelRecord.addEventListener('click', () => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                // Dừng nhưng bỏ kết quả
                mediaRecorder.ondataavailable = null;
                mediaRecorder.onstop = () => {
                    mediaRecorder.stream && mediaRecorder.stream.getTracks().forEach(t => t.stop());
                };
                mediaRecorder.stop();
                recordedChunks = [];
            }
            exitRecordingMode();
        });
    }

    // ── Modal open / close ────────────────────────────────────────────────
    function closeAnonymousModal() {
        if (!anonymousModal) return;
        anonymousModal.classList.remove('active');
        // Dừng ghi âm nếu đang ghi
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.ondataavailable = null;
            mediaRecorder.onstop = () => {
                if (mediaRecorder.stream) mediaRecorder.stream.getTracks().forEach(t => t.stop());
            };
            mediaRecorder.stop();
            recordedChunks = [];
        }
        exitRecordingMode();
        setTimeout(() => {
            resetAllLeaves();
            prevWordCount = 0;
            clearMedia();
        }, 450);
    }

    if (btnOpenAnonymous && anonymousModal) {
        btnOpenAnonymous.addEventListener('click', () => {
            // Reset recording state trước khi mở — đề phòng state cũ còn sót trên mobile
            exitRecordingMode();
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.ondataavailable = null;
                mediaRecorder.onstop = () => {
                    if (mediaRecorder.stream) mediaRecorder.stream.getTracks().forEach(t => t.stop());
                };
                mediaRecorder.stop();
                recordedChunks = [];
            }
            buildTreeLeaves();
            anonymousModal.classList.add('active');
            setTimeout(() => inputAnonymousMessage && inputAnonymousMessage.focus(), 280);
        });
    }

    if (btnCloseAnonymousModal) {
        btnCloseAnonymousModal.addEventListener('click', closeAnonymousModal);
    }

    if (anonymousModal) {
        anonymousModal.addEventListener('click', e => {
            if (e.target === anonymousModal) closeAnonymousModal();
        });
    }

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && anonymousModal && anonymousModal.classList.contains('active')) {
            closeAnonymousModal();
        }
    });

    // ── Submit anonymous message (text + optional media) ─────────────────
    if (btnSubmitAnonymous) {
        updateSubmitState();
        btnSubmitAnonymous.addEventListener('click', async () => {
            const msg      = inputAnonymousMessage ? inputAnonymousMessage.value.trim() : '';
            const hasMedia = !!currentMediaData;

            if (!msg && !hasMedia) {
                showToast("Viết gì đó hoặc đính kèm file trước khi gửi nhé!");
                inputAnonymousMessage && inputAnonymousMessage.focus();
                return;
            }
            if (msg.length > MAX_CHARS) {
                showToast(`Tin nhắn quá dài! Giới hạn ${MAX_CHARS} ký tự nhé.`, 'warning');
                return;
            }

            const originalHTML = btnSubmitAnonymous.innerHTML;
            btnSubmitAnonymous.disabled = true;
            btnSubmitAnonymous.innerHTML =
                '<span class="btn-inner"><i class="fa-solid fa-circle-notch fa-spin"></i><span>Đang gửi...</span></span>';

            try {
                const res = await fetch('/api/anonymous', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message:   msg,
                        mediaData: currentMediaData || null,
                        mediaType: currentMediaType || null,
                    }),
                });
                if (!res.ok) {
                    let errMsg = 'Lỗi server';
                    try { const errData = await res.json(); errMsg = errData.message || errMsg; } catch {}
                    showToast(`Gửi thất bại: ${errMsg}`, 'error');
                    btnSubmitAnonymous.innerHTML = originalHTML;
                    updateSubmitState();
                    return;
                }
                const mediaLabel = currentMediaType === 'audio' ? '<i class="fa-solid fa-microphone-lines"></i> ghi âm'
                                 : currentMediaType === 'image' ? '🖼️ ảnh'
                                 : currentMediaType === 'video' ? '🎬 video'
                                 : '';
                const extraLabel = mediaLabel ? ` kèm ${mediaLabel}` : '';
                showToast(`Đã gửi tin nhắn ẩn danh${extraLabel} thành công!`);
            } catch {
                showToast("Lỗi kết nối! Kiểm tra mạng rồi thử lại nhé.", 'error');
                btnSubmitAnonymous.innerHTML = originalHTML;
                updateSubmitState();
                return;
            }

            if (inputAnonymousMessage) inputAnonymousMessage.value = '';
            prevWordCount = 0;
            updateCharCount();
            closeAnonymousModal();
            setTimeout(resetAllLeaves, 500);

            btnSubmitAnonymous.innerHTML = originalHTML;
            updateSubmitState();
        });
    }

    return { renderWishCard, updateReactionsConfig: _rebuildMaps, applyActiveStates, applyReactionCounts };
}

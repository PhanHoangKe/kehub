/**
 * weather.js - Thời tiết thực tế ngoài trời & Tự động đổi Theme môi trường
 */
export function initWeatherEngine(onMoodChange) {
    const dial         = document.getElementById('moodSpeedDial');
    const mainBtn      = document.getElementById('moodDialMain');
    const mainIcon     = document.getElementById('moodDialMainIcon');
    const dialItems    = document.querySelectorAll('.mood-dial-item');
    const weatherText  = document.getElementById('weatherText');
    let currentActiveMood = 'auto';
    let dialOpen = false;

    // Icon map: mood → Font Awesome classes + màu chủ đạo cho nút chính
    const MOOD_ICON = {
        auto:   { cls: 'fa-solid fa-wand-magic-sparkles', color: '' },       // gradient mặc định
        sunset: { cls: 'fa-solid fa-cloud-sun',            color: '#f59e0b' },
        rain:   { cls: 'fa-solid fa-cloud-showers-heavy',  color: '#38bdf8' },
        space:  { cls: 'fa-solid fa-meteor',               color: '#a78bfa' },
    };

    // ── Cập nhật icon + màu nút chính theo mood đang active ─────────────────
    function syncMainBtn(mood) {
        if (!mainIcon) return;
        const info = MOOD_ICON[mood] || MOOD_ICON.auto;

        // Đổi class icon
        mainIcon.className = info.cls;

        // Đổi màu nền nút chính
        if (mainBtn) {
            if (info.color) {
                mainBtn.style.background = `linear-gradient(135deg, ${info.color}cc, ${info.color})`;
                mainBtn.style.borderColor = info.color;
                mainBtn.style.boxShadow   = `0 4px 18px ${info.color}55`;
            } else {
                // auto → gradient xanh mặc định
                mainBtn.style.background  = 'linear-gradient(135deg, #2563eb, #3b82f6)';
                mainBtn.style.borderColor = '#fff';
                mainBtn.style.boxShadow   = '0 4px 18px rgba(37,99,235,0.38)';
            }
        }

        // Mark active trên dial items
        dialItems.forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-mood') === mood);
        });
    }

    // ── Mở / đóng dial ──────────────────────────────────────────────────────
    function openDial() {
        if (!dial || dialOpen) return;
        dialOpen = true;
        dial.classList.add('open');
        ensureBackdrop(true);
    }

    function closeDial() {
        if (!dial || !dialOpen) return;
        dialOpen = false;
        dial.classList.remove('open');
        ensureBackdrop(false);
    }

    function toggleDial() {
        dialOpen ? closeDial() : openDial();
    }

    // ── Backdrop (tap ngoài để đóng trên mobile) ─────────────────────────────
    function ensureBackdrop(active) {
        let bd = document.getElementById('moodDialBackdrop');
        if (!bd) {
            bd = document.createElement('div');
            bd.id = 'moodDialBackdrop';
            bd.className = 'mood-dial-backdrop';
            bd.addEventListener('click', closeDial);
            document.body.appendChild(bd);
        }
        bd.classList.toggle('active', active);
    }

    // ── Áp dụng theme ────────────────────────────────────────────────────────
    function applyMoodTheme(mood) {
        let activeTheme = mood;
        if (mood === 'auto') {
            activeTheme = getRealtimeTheme();
        }
        document.body.setAttribute('data-theme', activeTheme);
        if (typeof onMoodChange === 'function') {
            onMoodChange(activeTheme);
        }
    }

    function getRealtimeTheme() {
        const h = new Date().getHours();
        if (window.liveWeatherIsRaining) return 'rain';
        if (h >= 6 && h < 17)  return 'day';
        if (h >= 17 && h < 19) return 'sunset';
        return 'space';
    }

    // ── Fetch thời tiết thực ─────────────────────────────────────────────────
    async function fetchRealtimeWeather() {
        try {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 1500);
            const res  = await fetch(
                'https://api.open-meteo.com/v1/forecast?latitude=21.0285&longitude=105.8542&current_weather=true',
                { signal: controller.signal }
            );
            clearTimeout(tid);
            const data = await res.json();

            if (data && data.current_weather) {
                const temp   = Math.round(data.current_weather.temperature);
                const code   = data.current_weather.weathercode;
                const isDay  = data.current_weather.is_day === 1;
                const isRain = [51,53,55,61,63,65,80,81,82,95,96,99].includes(code);
                window.liveWeatherIsRaining = isRain;

                let desc = isDay
                    ? `Nắng Ấm <i class="fa-solid fa-sun" style="color:#fbbf24"></i>`
                    : `Trời Quang <i class="fa-solid fa-moon" style="color:#cbd5e1"></i>`;
                if (isRain) desc = `Có Mưa <i class="fa-solid fa-cloud-rain" style="color:#38bdf8"></i>`;

                if (weatherText) weatherText.innerHTML = `Việt Nam • ${temp}°C • ${desc}`;

                if (currentActiveMood === 'auto') applyMoodTheme('auto');
            }
        } catch {
            const h = new Date().getHours();
            const desc = (h >= 6 && h < 17)
                ? `Ban Ngày <i class="fa-solid fa-sun" style="color:#fbbf24"></i>`
                : (h >= 17 && h < 19
                    ? `Hoàng Hôn <i class="fa-solid fa-city" style="color:#f59e0b"></i>`
                    : `Ban Đêm <i class="fa-solid fa-moon" style="color:#cbd5e1"></i>`);
            if (weatherText) weatherText.innerHTML = `Việt Nam • ${desc}`;
            if (currentActiveMood === 'auto') applyMoodTheme('auto');
        }
    }

    // ── Event: nút chính → toggle dial ──────────────────────────────────────
    if (mainBtn) {
        // Click / tap: toggle trên mọi thiết bị
        mainBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDial();
        });
    }

    // ── Event: chọn mood từ dial item ────────────────────────────────────────
    dialItems.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const mood = btn.getAttribute('data-mood');
            currentActiveMood = mood;
            applyMoodTheme(mood);
            syncMainBtn(mood);
            closeDial();
        });
    });

    // ── ESC đóng dial ────────────────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDial();
    });

    // ── Khởi tạo ────────────────────────────────────────────────────────────
    syncMainBtn('auto');
    applyMoodTheme('auto');
    fetchRealtimeWeather();
    // Làm mới thời tiết mỗi 10 phút
    setInterval(fetchRealtimeWeather, 10 * 60 * 1000);
}

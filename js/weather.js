/**
 * weather.js - Thời tiết thực tế ngoài trời & Tự động đổi Theme môi trường
 */
export function initWeatherEngine(onMoodChange) {
    const moodBtns = document.querySelectorAll('.mood-btn, .mood-btn-circle');
    const weatherText = document.getElementById('weatherText');
    let currentActiveMood = 'auto';

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
        const currentHour = new Date().getHours();
        if (window.liveWeatherIsRaining) {
            return 'rain';
        }

        if (currentHour >= 6 && currentHour < 17) {
            return 'day';
        } else if (currentHour >= 17 && currentHour < 19) {
            return 'sunset';
        } else {
            return 'space';
        }
    }

    async function fetchRealtimeWeather() {
        try {
            let lat = 21.0285;
            let lon = 105.8542;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1500);

            const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            const data = await res.json();
            
            if (data && data.current_weather) {
                const temp = Math.round(data.current_weather.temperature);
                const code = data.current_weather.weathercode;
                const isDay = data.current_weather.is_day === 1;

                const isRaining = [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(code);
                window.liveWeatherIsRaining = isRaining;

                let weatherDesc = isDay ? `Nắng Ấm <i class="fa-solid fa-sun" style="color:#fbbf24"></i>` : `Trời Quang <i class="fa-solid fa-moon" style="color:#cbd5e1"></i>`;
                if (isRaining) weatherDesc = `Có Mưa <i class="fa-solid fa-cloud-rain" style="color:#38bdf8"></i>`;

                if (weatherText) {
                    weatherText.textContent = `Việt Nam • ${temp}°C • ${weatherDesc}`;
                }

                if (currentActiveMood === 'auto') {
                    applyMoodTheme('auto');
                }
            }
        } catch (e) {
            const hour = new Date().getHours();
            let desc = (hour >= 6 && hour < 17) ? `Ban Ngày <i class="fa-solid fa-sun" style="color:#fbbf24"></i>` : (hour >= 17 && hour < 19 ? `Hoàng Hôn <i class="fa-solid fa-city" style="color:#f59e0b"></i>` : `Ban Đêm <i class="fa-solid fa-moon" style="color:#cbd5e1"></i>`);
            if (weatherText) weatherText.textContent = `Việt Nam • ${desc}`;
            if (currentActiveMood === 'auto') {
                applyMoodTheme('auto');
            }
        }
    }

    moodBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            moodBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const mood = btn.getAttribute('data-mood');
            currentActiveMood = mood;
            applyMoodTheme(mood);
        });
    });

    fetchRealtimeWeather();
}

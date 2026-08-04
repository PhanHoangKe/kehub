/**
 * countdown.js - Động cơ Đếm ngược Cột Mốc Thanh Xuân & Hộp Thư Thời Gian
 *
 * Tối ưu: setInterval chỉ chạy khi trang Goals đang hiển thị.
 * Dùng IntersectionObserver theo dõi #page-goals — khởi động / dừng đồng hồ
 * tự động khi user điều hướng vào/ra trang, tiết kiệm CPU khi không cần.
 */
export function initCountdownEngine(getState) {
    const cntDays = document.getElementById('cntDays');
    const cntHours = document.getElementById('cntHours');
    const cntMinutes = document.getElementById('cntMinutes');
    const cntSeconds = document.getElementById('cntSeconds');
    const countdownTitle = document.getElementById('countdownTitle');
    const countdownSubtitle = document.getElementById('countdownSubtitle');

    let currentTarget = 'birthday';
    let _timer = null;

    function getTargetDate(type) {
        const now = new Date();
        const currentYear = now.getFullYear();

        if (type === '2030') {
            if (countdownTitle) countdownTitle.textContent = "ĐẾM NGƯỢC CỘT MỐC BỨT PHÁ 2030";
            if (countdownSubtitle) countdownSubtitle.textContent = "Hành trình vươn xa tới cột mốc tương lai năm 2030";
            return new Date('2030-01-01T00:00:00');
        } else if (type === 'newyear') {
            if (countdownTitle) countdownTitle.textContent = "ĐẾM NGƯỢC CHÀO NĂM MỚI";
            if (countdownSubtitle) countdownSubtitle.textContent = "Khoảnh khắc giao thừa ấm áp trao gửi niềm tin";
            return new Date(`${currentYear + 1}-01-01T00:00:00`);
        } else {
            // Birthday
            if (countdownTitle) countdownTitle.textContent = "ĐẾM NGƯỢC SINH NHẬT KẾ SẮP TỚI";
            if (countdownSubtitle) countdownSubtitle.textContent = "Chào đón tuổi mới rực rỡ với muôn vàn ước mơ";
            
            const state = getState ? getState() : {};
            const userBdayStr = state.birthdayDate || "2001-10-15";
            let bMonth = 9;
            let bDay = 15;
            if (userBdayStr) {
                const parts = userBdayStr.split('-');
                if (parts.length === 3) {
                    bMonth = parseInt(parts[1], 10) - 1;
                    bDay = parseInt(parts[2], 10);
                }
            }

            let nextBday = new Date(currentYear, bMonth, bDay, 0, 0, 0);
            if (now > nextBday) {
                nextBday = new Date(currentYear + 1, bMonth, bDay, 0, 0, 0);
            }
            return nextBday;
        }
    }

    function updateCountdown() {
        const target = getTargetDate(currentTarget);
        const now = new Date();
        const diff = target - now;

        if (diff <= 0) {
            if (cntDays) cntDays.textContent = '00';
            if (cntHours) cntHours.textContent = '00';
            if (cntMinutes) cntMinutes.textContent = '00';
            if (cntSeconds) cntSeconds.textContent = '00';
            return;
        }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const minutes = Math.floor((diff / (1000 * 60)) % 60);
        const seconds = Math.floor((diff / 1000) % 60);

        if (cntDays) cntDays.textContent = days < 100 ? String(days).padStart(2, '0') : days;
        if (cntHours) cntHours.textContent = String(hours).padStart(2, '0');
        if (cntMinutes) cntMinutes.textContent = String(minutes).padStart(2, '0');
        if (cntSeconds) cntSeconds.textContent = String(seconds).padStart(2, '0');
    }

    function startTimer() {
        if (_timer) return; // đã chạy rồi
        updateCountdown();  // cập nhật ngay khi hiện trang
        _timer = setInterval(updateCountdown, 1000);
    }

    function stopTimer() {
        if (_timer) {
            clearInterval(_timer);
            _timer = null;
        }
    }

    // ── Lazy init: chỉ chạy setInterval khi trang goals đang hiển thị ──────
    // IntersectionObserver theo dõi visibility của #page-goals trong viewport.
    // Vì SPA dùng display:none/block, threshold 0 đủ để bắt sự kiện show/hide.
    const goalsPage = document.getElementById('page-goals');
    if (goalsPage) {
        // SPA ẩn trang bằng class 'active', không phải display — dùng
        // MutationObserver để bắt thay đổi class thay vì IntersectionObserver
        const classObserver = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                if (mutation.attributeName === 'class') {
                    const isActive = goalsPage.classList.contains('active');
                    if (isActive) {
                        startTimer();
                    } else {
                        stopTimer();
                    }
                }
            });
        });
        classObserver.observe(goalsPage, { attributes: true, attributeFilter: ['class'] });

        // Nếu trang goals đang active ngay khi load (ví dụ: URL hash #goals)
        if (goalsPage.classList.contains('active')) {
            startTimer();
        }
    } else {
        // Fallback nếu không tìm thấy page element
        startTimer();
    }

    // Tab chuyển cột mốc
    const milestoneBtns = document.querySelectorAll('.milestone-btn');
    milestoneBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            milestoneBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTarget = btn.getAttribute('data-target') || 'birthday';
            updateCountdown();
        });
    });
}

/**
 * navigation.js - Điều hướng đa trang SPA linh hoạt (Single Page Application Multi-View Switcher)
 */
export function initNavigationEngine() {
    const navDockBtns = document.querySelectorAll('.nav-dock-btn');
    const viewPages = document.querySelectorAll('.view-page');
    const brandLogo = document.querySelector('.brand-logo');

    function switchPage(pageId) {
        if (!pageId) pageId = 'home';

        // Ẩn tất cả các trang view
        viewPages.forEach(page => {
            page.classList.remove('active');
        });

        // Cập nhật trạng thái nút Dock
        navDockBtns.forEach(btn => {
            const target = btn.getAttribute('data-page');
            if (target === pageId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Hiển thị trang mục tiêu
        const targetPage = document.getElementById(`page-${pageId}`);
        if (targetPage) {
            targetPage.classList.add('active');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // Cập nhật URL Hash
        if (history.pushState) {
            history.pushState(null, null, `#${pageId}`);
        } else {
            location.hash = `#${pageId}`;
        }
    }

    // Sự kiện click nút trên Thanh Điều Hướng Floating Dock
    navDockBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const pageId = btn.getAttribute('data-page');
            switchPage(pageId);
        });
    });

    // Sự kiện click Logo về Trang Chủ
    if (brandLogo) {
        brandLogo.style.cursor = 'pointer';
        brandLogo.addEventListener('click', () => switchPage('home'));
    }

    // Xử lý Nút Back/Forward của trình duyệt & URL Hash ban đầu
    window.addEventListener('hashchange', () => {
        const hash = location.hash.replace('#', '');
        if (hash) switchPage(hash);
    });

    // Đọc URL Hash khi tải trang lần đầu
    const initialHash = location.hash.replace('#', '');
    if (initialHash && document.getElementById(`page-${initialHash}`)) {
        switchPage(initialHash);
    } else {
        switchPage('home');
    }

    return { switchPage };
}

/**
 * toast.js - Bảng thông báo Toast tự động popup toàn hệ thống
 */
export function showToast(msg) {
    const toastNotification = document.getElementById('toastNotification');
    const toastMessage = document.getElementById('toastMessage');
    if (!toastNotification || !toastMessage) return;
    
    toastMessage.innerHTML = msg;
    toastNotification.classList.add('show');
    
    setTimeout(() => {
        toastNotification.classList.remove('show');
    }, 3000);
}

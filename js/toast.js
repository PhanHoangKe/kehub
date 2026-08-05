/**
 * toast.js - Bảng thông báo Toast tự động popup toàn hệ thống
 */
export function showToast(msg, type = 'success') {
    const toastNotification = document.getElementById('toastNotification');
    const toastMessage = document.getElementById('toastMessage');
    if (!toastNotification || !toastMessage) return;

    // Define styles and icons based on type
    let iconHTML = '';
    let bgColor, borderColor, textColor, glowColor;

    switch (type) {
        case 'success':
            iconHTML = `<i class="fa-solid fa-circle-check"></i>`;
            bgColor = 'rgba(12, 28, 20, 0.95)';
            borderColor = '#22c55e'; // Green
            textColor = '#4ade80';
            glowColor = 'rgba(34, 197, 94, 0.4)';
            break;
        case 'error':
            iconHTML = `<i class="fa-solid fa-circle-xmark"></i>`;
            bgColor = 'rgba(28, 12, 14, 0.95)';
            borderColor = '#ef4444'; // Red
            textColor = '#f87171';
            glowColor = 'rgba(239, 68, 68, 0.4)';
            break;
        case 'warning':
            iconHTML = `<i class="fa-solid fa-triangle-exclamation"></i>`;
            bgColor = 'rgba(28, 24, 12, 0.95)';
            borderColor = '#facc15'; // Yellow
            textColor = '#fde047';
            glowColor = 'rgba(250, 204, 21, 0.4)';
            break;
        case 'info':
        default:
            iconHTML = `<i class="fa-solid fa-circle-info"></i>`;
            bgColor = 'rgba(12, 14, 28, 0.95)';
            borderColor = '#3b82f6'; // Blue
            textColor = '#60a5fa';
            glowColor = 'rgba(59, 130, 246, 0.4)';
            break;
    }

    // Apply styles to toast container
    toastNotification.style.background = bgColor;
    toastNotification.style.border = `1px solid ${borderColor}`;
    toastNotification.style.boxShadow = `0 15px 35px rgba(0, 0, 0, 0.7), 0 0 20px ${glowColor}`;

    // Apply styles to message
    toastMessage.style.color = textColor;
    toastMessage.style.display = 'flex';
    toastMessage.style.alignItems = 'center';
    toastMessage.style.gap = '10px';
    toastMessage.style.fontWeight = '700';

    // Set content: Icon + Text (remove any existing html from msg to ensure clean text)
    // Create a temporary div to strip HTML if any remains, but allow msg to just be text
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = msg;
    const cleanText = tempDiv.textContent || tempDiv.innerText || '';

    toastMessage.innerHTML = `<span style="font-size: 1.25rem;">${iconHTML}</span><span>${cleanText}</span>`;
    
    toastNotification.classList.add('show');
    
    // Clear previous timeout if exists
    if (window._toastTimeout) clearTimeout(window._toastTimeout);
    
    window._toastTimeout = setTimeout(() => {
        toastNotification.classList.remove('show');
    }, 3000);
}

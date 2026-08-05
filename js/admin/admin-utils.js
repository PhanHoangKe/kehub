/**
 * admin-utils.js — Helper dùng chung cho toàn bộ admin modules
 */

/** Đọc file thành base64 Data URL */
export function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/** Nén ảnh trước khi upload */
export function compressImage(file, maxWidth = 1200, maxHeight = 1200, quality = 0.85) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > maxWidth || height > maxHeight) {
                    if (width / height > maxWidth / maxHeight) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    } else {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                let dataUrl = canvas.toDataURL('image/webp', quality);
                if (!dataUrl || !dataUrl.startsWith('data:image/webp')) {
                    dataUrl = canvas.toDataURL('image/jpeg', quality);
                }
                resolve(dataUrl);
            };
            img.onerror = () => resolve(e.target.result);
            img.src = e.target.result;
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
}

/** Upload file lên backend. Fallback về base64 nếu server offline */
export async function uploadFileToBackend(filename, base64Data) {
    if (!base64Data) return base64Data;
    try {
        const token = localStorage.getItem('admin_token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/upload', {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify({ fileName: filename, fileData: base64Data }),
        });
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.fileUrl) return data.fileUrl;
        }
    } catch {
        console.log('Upload server offline, sử dụng base64 local fallback.');
    }
    return base64Data;
}

/** Cập nhật DOM trạng thái viên nang tốt nghiệp */
export function updateCapsuleStatusDOM(state, elem) {
    if (!elem) return;
    const btnSealCapsule = document.getElementById('btnSealCapsule');
    if (state.isCapsuleLocked) {
        elem.innerHTML = `Trạng thái: <span class="status-locked"><i class="fa-solid fa-lock"></i> ĐÃ NIÊM PHONG VĨNH VIỄN (${state.graduationDate || '2026-06-30'})</span>`;
        if (btnSealCapsule) {
            btnSealCapsule.innerHTML = '<i class="fa-solid fa-lock-open"></i> MỞ KHÓA LẠI VIÊN NANG THANH XUÂN';
            btnSealCapsule.style.background = 'linear-gradient(135deg, #10b981, #0284c7)';
        }
    } else {
        elem.innerHTML = `Trạng thái: <span class="status-unlocked"><i class="fa-solid fa-lock-open"></i> Đang mở chỉnh sửa</span>`;
        if (btnSealCapsule) {
            btnSealCapsule.innerHTML = '<i class="fa-solid fa-stamp"></i> THỰC HIỆN LỄ NIÊM PHONG THANH XUÂN';
            btnSealCapsule.style.background = 'linear-gradient(135deg, #f59e0b, #e11d48)';
        }
    }
}

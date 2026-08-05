/**
 * admin-backup.js — Export/Import JSON backup, Capsule, Vị trí nhà
 */
import { showToast }                from '../toast.js';
import { updateCapsuleStatusDOM }   from './admin-utils.js';

export function initBackup(getState, setState, saveBackendConfig, refreshDOM) {

    // ── Export JSON ───────────────────────────────────────────────────────────
    const btnExport = document.getElementById('btnExportBackup');
    if (btnExport) {
        btnExport.addEventListener('click', () => {
            const state   = getState();
            const jsonStr = JSON.stringify(state, null, 2);
            const blob    = new Blob([jsonStr], { type: 'application/json' });
            const url     = URL.createObjectURL(blob);
            const a       = document.createElement('a');
            a.href        = url;
            a.download    = `youth_memories_backup_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('Đã xuất thành công file Backup JSON!');
        });
    }

    // ── Import JSON ───────────────────────────────────────────────────────────
    const btnImport     = document.getElementById('btnImportBackup');
    const inputBackup   = document.getElementById('inputBackupFile');
    const customModal   = document.getElementById('customModal');

    if (btnImport && inputBackup) {
        btnImport.addEventListener('click', () => inputBackup.click());
        inputBackup.addEventListener('change', (e) => {
            if (!e.target.files.length) return;
            const file   = e.target.files[0];
            const reader = new FileReader();
            reader.onload = async (evt) => {
                try {
                    const data = JSON.parse(evt.target.result);
                    if (data && typeof data === 'object') {
                        setState(data);
                        await saveBackendConfig(data);
                        refreshDOM();
                        showToast('Đã phục hồi dữ liệu thành công từ file Backup!');
                        if (customModal) customModal.classList.remove('active');
                    } else {
                        alert('File backup không hợp lệ!');
                    }
                } catch (err) {
                    alert('Lỗi đọc file JSON: ' + err.message);
                }
            };
            reader.readAsText(file);
        });
    }

    // ── Viên Nang Tốt Nghiệp ─────────────────────────────────────────────────
    const btnSealCapsule = document.getElementById('btnSealCapsule');
    if (btnSealCapsule) {
        btnSealCapsule.addEventListener('click', async () => {
            const state            = getState();
            const inputGradDate    = document.getElementById('inputGraduationDate');
            const capsuleStatusInfo = document.getElementById('capsuleStatusInfo');

            if (inputGradDate?.value) state.graduationDate = inputGradDate.value;

            if (!state.isCapsuleLocked) {
                const ok = confirm('XÁC NHẬN LỄ NIÊM PHONG THANH XUÂN?\n\nKhi bạn đồng ý, toàn bộ kỷ niệm thời học sinh sẽ được khóa lại trong "Viên Nang Thời Gian Tốt Nghiệp".\n\nBạn có chắc chắn không?');
                if (!ok) return;
                state.isCapsuleLocked = true;
                state.sealedAt        = new Date().toISOString();
                updateCapsuleStatusDOM(state, capsuleStatusInfo);
                await saveBackendConfig(state);
                refreshDOM();
                alert('ĐÃ NIÊM PHONG THÀNH CÔNG VIÊN NANG THỜI GIAN TỐT NGHIỆP!\n\nKý ức thời học sinh của bạn đã được bảo tồn vĩnh viễn.');
            } else {
                const ok = confirm('Mở khóa lại Viên Nang Thời Gian Tốt Nghiệp để bổ sung ký ức?');
                if (!ok) return;
                state.isCapsuleLocked = false;
                updateCapsuleStatusDOM(state, capsuleStatusInfo);
                await saveBackendConfig(state);
                refreshDOM();
                alert('Đã mở khóa chỉnh sửa viên nang!');
            }
        });
    }

    // ── Lấy vị trí GPS làm Vị Trí Nhà ───────────────────────────────────────
    const btnGetLocation = document.getElementById('btnGetMyCurrentHomeLocation');
    if (btnGetLocation) {
        btnGetLocation.addEventListener('click', () => {
            if (!('geolocation' in navigator)) return;
            btnGetLocation.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lấy tọa độ GPS...';
            navigator.geolocation.getCurrentPosition(async (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                const inputLat  = document.getElementById('inputHomeLat');
                const inputLng  = document.getElementById('inputHomeLng');
                const inputAddr = document.getElementById('inputHomeAddress');
                if (inputLat) inputLat.value = lat;
                if (inputLng) inputLng.value = lng;
                try {
                    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
                    if (res.ok) {
                        const geo  = await res.json();
                        const addr = geo.address || {};
                        const parts = [
                            addr.hamlet || addr.suburb || addr.quarter || addr.village,
                            addr.town   || addr.city_district || addr.commune,
                            addr.county || addr.district || addr.city,
                            addr.state  || addr.province,
                        ].filter(Boolean);
                        if (inputAddr) inputAddr.value = parts.join(', ');
                    }
                } catch {}
                btnGetLocation.innerHTML = '<i class="fa-solid fa-circle-check"></i> Đã Lấy Tọa Độ Thành Công!';
                setTimeout(() => {
                    btnGetLocation.innerHTML = '<i class="fa-solid fa-location-arrow"></i> Lấy Vị Trí Hiện Tại Làm Vị Trí Nhà';
                }, 3000);
            }, () => {
                alert('Không thể lấy GPS. Vui lòng bật quyền định vị cho trình duyệt.');
                btnGetLocation.innerHTML = '<i class="fa-solid fa-location-arrow"></i> Lấy Vị Trí Hiện Tại Làm Vị Trí Nhà';
            }, { enableHighAccuracy: true, timeout: 10000 });
        });
    }
}

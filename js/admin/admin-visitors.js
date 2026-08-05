/**
 * admin-visitors.js — Danh sách & thống kê khách viếng thăm
 */
import { escapeHTML } from '../config.js';
import { showToast }  from '../toast.js';

export function initVisitors() {
    const btnRefreshVisitors = document.getElementById('btnRefreshVisitors');
    if (btnRefreshVisitors) {
        btnRefreshVisitors.addEventListener('click', loadAdminVisitorsList);
    }
}

export async function loadAdminVisitorsList() {
    const adminVisitorsList = document.getElementById('adminVisitorsList');
    if (!adminVisitorsList) return;

    const statOnlineNow    = document.getElementById('admStatOnlineNow');
    const statTotalVisitors = document.getElementById('admStatTotalVisitors');
    const statTopDevice    = document.getElementById('admStatTopDevice');
    const statTopCity      = document.getElementById('admStatTopCity');

    try {
        const token = localStorage.getItem('admin_token');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/admin/visitors', { headers, credentials: 'include' });
        if (!res.ok) {
            adminVisitorsList.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:24px;">Chưa xác thực Admin hoặc lỗi kết nối.</div>';
            return;
        }
        const data = await res.json();
        if (!data.success) return;

        if (statOnlineNow)     statOnlineNow.textContent     = data.onlineCount    || 0;
        if (statTotalVisitors) statTotalVisitors.textContent = data.totalVisitors  || 0;
        if (statTopDevice)     statTopDevice.textContent     = data.topDevice      || '-';
        if (statTopCity)       statTopCity.textContent       = data.topCity        || '-';

        const visitors = data.visitors || [];
        const homeLoc  = data.homeLocation || null; // Vị trí nhà Admin — dùng để chỉ đường
        if (visitors.length === 0) {
            adminVisitorsList.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:24px;">Chưa có khách viếng thăm nào.</div>';
            return;
        }

        adminVisitorsList.innerHTML = '';
        const nowMs = Date.now();

        const onlineCount = visitors.filter(v => {
            const lastMs = new Date(v.lastSeen).getTime();
            return (nowMs - lastMs) <= 5 * 60 * 1000;
        }).length;

        const tabVisitorsBadge = document.getElementById('tabVisitorsBadge');
        if (tabVisitorsBadge) {
            tabVisitorsBadge.textContent     = onlineCount;
            tabVisitorsBadge.style.display   = onlineCount > 0 ? 'inline-block' : 'none';
        }
        if (statOnlineNow) statOnlineNow.textContent = onlineCount;

        visitors.forEach((v, index) => {
            const card = document.createElement('div');
            card.className = 'admin-item-card';
            card.style.position = 'relative';

            const lastSeenMs = new Date(v.lastSeen).getTime();
            const isOnline = (nowMs - lastSeenMs) <= 5 * 60 * 1000;

            const statusBadge = isOnline
                ? `<span style="background:rgba(34,197,94,0.2);color:#4ade80;border:1px solid rgba(34,197,94,0.4);padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:bold;"><i class="fa-solid fa-circle" style="color:#22c55e"></i> ĐANG ONLINE</span>`
                : `<span style="background:rgba(148,163,184,0.15);color:#94a3b8;padding:2px 8px;border-radius:12px;font-size:0.75rem;"><i class="fa-regular fa-circle" style="color:#94a3b8"></i> Đã rời đi</span>`;

            const returningBadge = v.isReturning
                ? `<span style="background:rgba(124,58,237,0.15);color:#a78bfa;border:1px solid rgba(124,58,237,0.3);padding:2px 8px;border-radius:12px;font-size:0.72rem;font-weight:bold;" title="UUID: ${v.visitorUuid || '?'}"><i class="fa-solid fa-rotate-left"></i> Quay Lại${v.visitCount ? ' (lần ' + v.visitCount + ')' : ''}</span>`
                : `<span style="background:rgba(6,182,212,0.12);color:#22d3ee;border:1px solid rgba(6,182,212,0.28);padding:2px 8px;border-radius:12px;font-size:0.72rem;font-weight:bold;"><i class="fa-solid fa-user-plus"></i> Khách Mới</span>`;

            const timeStr      = new Date(v.lastSeen).toLocaleString('vi-VN');
            const durationMin  = Math.floor((v.durationSeconds || 0) / 60);
            const durationSec  = (v.durationSeconds || 0) % 60;
            const durationText = durationMin > 0 ? `${durationMin} phút ${durationSec}s` : `${durationSec}s`;

            const batteryStr = v.battery    ? ` • <i class="fa-solid fa-battery-full" style="color:#22c55e;"></i> Pin: ${escapeHTML(v.battery)}` : '';
            const networkStr = v.connection ? ` • <i class="fa-solid fa-signal"></i> Mạng: ${escapeHTML(v.connection.toUpperCase())}` : '';
            const screenStr  = v.screen && v.screen !== '-' ? ` • <i class="fa-solid fa-ruler-combined" style="color:#3b82f6;"></i> Màn hình: ${escapeHTML(v.screen)} (x${v.dpr || 1})` : '';
            const gpuStr     = v.gpu        ? ` • <i class="fa-solid fa-gamepad"></i> GPU: ${escapeHTML(v.gpu)}` : '';
            const cpuStr     = v.cpuCores   ? ` • <i class="fa-solid fa-bolt"></i> Chip: ${v.cpuCores} Nhân CPU` : '';
            const ramStr     = v.ramGB      ? ` • <i class="fa-solid fa-floppy-disk"></i> RAM: ${v.ramGB}GB` : '';

            const timelineHtml = (v.timelineLogs || []).map(log =>
                `<div style="font-size:0.75rem;color:#cbd5e1;padding:2px 0;border-bottom:1px dashed rgba(255,255,255,0.05);display:flex;gap:6px;">
                    <span style="color:#94a3b8;min-width:60px;">${escapeHTML(log.time)}</span>
                    <strong style="color:#38bdf8;">${escapeHTML(log.event)}</strong>
                    <span style="color:#64748b;">${escapeHTML(log.detail || '')}</span>
                </div>`
            ).join('');

            // Nút Xem vị trí (pin) + Nút Chỉ đường từ Nhà → Nhà Khách
            let gmapBtn = '';
            if (v.lat && v.lng) {
                // Nút 1: Xem vị trí trên bản đồ
                gmapBtn += `<a href="https://www.google.com/maps?q=${v.lat},${v.lng}" target="_blank" style="background:#0284c7;color:#ffffff;padding:3px 10px;border-radius:6px;font-size:0.75rem;font-weight:bold;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-left:6px;box-shadow:0 0 10px rgba(2,132,199,0.5);" title="Xem vị trí khách trên bản đồ"><i class="fa-solid fa-map-location-dot"></i> Xem Vị Trí</a>`;
                // Nút 2: Chỉ đường từ Nhà Admin → Nhà Khách (nếu có homeLocation)
                if (homeLoc && homeLoc.lat && homeLoc.lng) {
                    const dirUrl = `https://www.google.com/maps/dir/?api=1&origin=${homeLoc.lat},${homeLoc.lng}&destination=${v.lat},${v.lng}&travelmode=driving`;
                    gmapBtn += ` <a href="${dirUrl}" target="_blank" style="background:rgba(34,197,94,0.25);color:#4ade80;border:1px solid rgba(34,197,94,0.5);padding:3px 10px;border-radius:6px;font-size:0.75rem;font-weight:bold;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-left:4px;box-shadow:0 0 10px rgba(34,197,94,0.3);" title="Mở Google Maps chỉ đường từ nhà bạn đến nhà khách"><i class="fa-solid fa-route"></i> Chỉ Đường Đến</a>`;
                } else {
                    // Không có homeLocation → chỉ đường bằng cách để Google Maps tự lấy vị trí hiện tại
                    const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}&travelmode=driving`;
                    gmapBtn += ` <a href="${dirUrl}" target="_blank" style="background:rgba(34,197,94,0.25);color:#4ade80;border:1px solid rgba(34,197,94,0.5);padding:3px 10px;border-radius:6px;font-size:0.75rem;font-weight:bold;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-left:4px;box-shadow:0 0 10px rgba(34,197,94,0.3);" title="Mở Google Maps chỉ đường đến nhà khách"><i class="fa-solid fa-route"></i> Chỉ Đường Đến</a>`;
                }
            }

            const isGpsExact = v.isGps || (v.accuracy && v.accuracy <= 500);
            const geoBadge   = isGpsExact
                ? `<span style="background:rgba(34,197,94,0.2);color:#4ade80;border:1px solid rgba(34,197,94,0.4);padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:bold;"><i class="fa-solid fa-bullseye"></i> GPS Chuẩn (Khách đã cấp quyền)</span>`
                : (v.lat && v.lng
                    ? `<span style="background:rgba(234,179,8,0.2);color:#facc15;border:1px solid rgba(234,179,8,0.4);padding:2px 8px;border-radius:10px;font-size:0.72rem;"><i class="fa-solid fa-signal"></i> Ước Tính IP (Chưa có GPS)</span>`
                    : `<span style="background:rgba(148,163,184,0.15);color:#94a3b8;padding:2px 8px;border-radius:10px;font-size:0.72rem;"><i class="fa-solid fa-circle-question"></i> Vị Trí Chưa Rõ</span>`);

            const locationTitle = isGpsExact
                ? `<span style="color:#4ade80;font-weight:bold;">${escapeHTML(v.city || 'Xã / Tỉnh')} (<i class="fa-solid fa-bullseye"></i> GPS)</span>`
                : `<span style="color:#facc15;font-weight:bold;">${escapeHTML(v.city || 'Ước tính IP')} (Chưa có GPS)</span>`;

            const accuracyStr  = v.accuracy ? `<span style="color:#4ade80;"> • Sai số: ~${v.accuracy}m</span>` : '';
            const deleteBtnHtml = `<button type="button" class="btn-delete-visitor" style="background:rgba(239,68,68,0.2);color:#f87171;border:1px solid rgba(239,68,68,0.4);padding:3px 10px;border-radius:6px;font-size:0.75rem;font-weight:bold;cursor:pointer;margin-left:8px;" title="Xóa nhật ký khách này"><i class="fa-solid fa-trash-can"></i> Xóa</button>`;

            card.innerHTML = `
                <div class="admin-item-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:4px;">
                    <span><i class="fa-solid fa-user-ninja" style="color:#a855f7;"></i> Khách #${index + 1} — <strong style="color:#f472b6;">${escapeHTML(v.city || 'Việt Nam')}</strong> (${escapeHTML(v.isp || 'Nhà mạng')}) ${statusBadge} ${returningBadge} ${geoBadge} ${gmapBtn} ${deleteBtnHtml}</span>
                    <span style="font-size:0.78rem;color:#94a3b8;"><i class="fa-solid fa-clock"></i> ${timeStr}</span>
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:6px;font-size:0.82rem;color:#cbd5e1;background:rgba(0,0,0,0.25);padding:10px;border-radius:8px;margin-bottom:8px;">
                    <div><i class="fa-solid fa-globe"></i> <strong>IP Thật:</strong> <span style="font-family:monospace;color:#facc15;">${escapeHTML(v.ip)}</span></div>
                    <div><i class="fa-solid fa-location-dot"></i> <strong>Vị trí:</strong> ${locationTitle} ${v.lat && v.lng ? `<br><small style="color:#38bdf8;">Tọa độ: ${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}${accuracyStr}</small>` : ''}</div>
                    <div><i class="fa-solid fa-mobile-screen-button"></i> <strong>Thiết bị:</strong> <span style="color:#38bdf8;font-weight:bold;">${escapeHTML(v.device)}</span> • ${escapeHTML(v.os)}</div>
                    <div><i class="fa-solid fa-laptop"></i> <strong>Trình duyệt:</strong> ${escapeHTML(v.browser)}</div>
                    <div><i class="fa-solid fa-link"></i> <strong>Nguồn đến:</strong> <span style="color:#38bdf8;word-break:break-all;">${escapeHTML(v.referrer)}</span></div>
                    <div><i class="fa-solid fa-stopwatch"></i> <strong>Thời gian ở lại:</strong> <span style="color:#4ade80;font-weight:bold;">${durationText}</span> (${v.clicks || 1} lượt click)</div>
                    <div style="grid-column:1 / -1;font-size:0.78rem;color:#94a3b8;border-top:1px solid rgba(255,255,255,0.06);padding-top:4px;">
                        <i class="fa-solid fa-gear"></i> <strong>Phần cứng:</strong>${screenStr}${networkStr}${batteryStr}${gpuStr}${cpuStr}${ramStr}
                    </div>
                </div>
                <details style="font-size:0.8rem;color:#94a3b8;cursor:pointer;">
                    <summary style="font-weight:bold;color:#a855f7;outline:none;margin-bottom:4px;">
                        <i class="fa-solid fa-scroll"></i> Xem Nhật Ký Thao Tác (${(v.timelineLogs || []).length} bước)
                    </summary>
                    <div style="background:rgba(15,23,42,0.6);padding:8px;border-radius:6px;margin-top:4px;max-height:160px;overflow-y:auto;">
                        ${timelineHtml || '<div style="font-size:0.75rem;color:#64748b;">Chưa có thao tác thêm</div>'}
                    </div>
                </details>
            `;

            const btnDelete = card.querySelector('.btn-delete-visitor');
            if (btnDelete) {
                btnDelete.addEventListener('click', async (evt) => {
                    evt.stopPropagation();
                    if (!confirm(`Bạn có chắc muốn xóa nhật ký của Khách (IP: ${v.ip})?`)) return;
                    try {
                        const token = localStorage.getItem('admin_token');
                        const headers = { 'Content-Type': 'application/json' };
                        if (token) headers['Authorization'] = `Bearer ${token}`;
                        const res = await fetch('/api/admin/visitors/delete', {
                            method: 'POST', headers, credentials: 'include',
                            body: JSON.stringify({ sessionId: v.sessionId, id: v.id }),
                        });
                        const resData = await res.json();
                        if (resData.success) {
                            showToast('Đã xóa nhật ký khách thành công!');
                            loadAdminVisitorsList();
                        } else {
                            alert(resData.message || 'Không thể xóa nhật ký.');
                        }
                    } catch {
                        alert('Lỗi kết nối khi xóa.');
                    }
                });
            }

            adminVisitorsList.appendChild(card);
        });
    } catch {
        adminVisitorsList.innerHTML = '<div style="text-align:center;color:#dc2626;padding:24px;">Lỗi kết nối server tracking.</div>';
    }
}

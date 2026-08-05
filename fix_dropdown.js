const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

const customDropdownHTML = `<div class="custom-dropdown" id="dd_spotlight">
    <div class="custom-dropdown-btn" onclick="toggleDropdown('dd_spotlight')">
        <span class="dropdown-value">-- Tắt Tiêu Điểm Nổi Bật --</span>
        <i class="fa-solid fa-chevron-down"></i>
    </div>
    <div class="dropdown-menu">
        <button type="button" class="dropdown-item" onclick="selectDropdown('dd_spotlight', 'none', '-- Tắt Tiêu Điểm Nổi Bật --', 'inputSpotlightTarget')">-- Tắt Tiêu Điểm Nổi Bật --</button>
        <button type="button" class="dropdown-item" onclick="selectDropdown('dd_spotlight', 'outings', '<i class=\\'fa-solid fa-tent\\' style=\\'color:#22c55e\\'></i> Nhật Ký Đi Chơi & Vi Vu', 'inputSpotlightTarget')"><i class="fa-solid fa-tent" style="color:#22c55e"></i> Nhật Ký Đi Chơi & Vi Vu</button>
        <button type="button" class="dropdown-item" onclick="selectDropdown('dd_spotlight', 'guestbook', '<i class=\\'fa-solid fa-envelope-open-text\\' style=\\'color:#f43f5e\\'></i> Sổ Lưu Bút & Lời Chúc', 'inputSpotlightTarget')"><i class="fa-solid fa-envelope-open-text" style="color:#f43f5e"></i> Sổ Lưu Bút & Lời Chúc</button>
        <button type="button" class="dropdown-item" onclick="selectDropdown('dd_spotlight', 'gallery', '<i class=\\'fa-solid fa-camera\\' style=\\'color:#38bdf8\\'></i> Bộ Sưu Tập Kỷ Niệm', 'inputSpotlightTarget')"><i class="fa-solid fa-camera" style="color:#38bdf8"></i> Bộ Sưu Tập Kỷ Niệm</button>
        <button type="button" class="dropdown-item" onclick="selectDropdown('dd_spotlight', 'diary', '<i class=\\'fa-solid fa-book-open\\' style=\\'color:#3b82f6\\'></i> Nhật Ký Thanh Xuân', 'inputSpotlightTarget')"><i class="fa-solid fa-book-open" style="color:#3b82f6"></i> Nhật Ký Thanh Xuân</button>
        <button type="button" class="dropdown-item" onclick="selectDropdown('dd_spotlight', 'school', '<i class=\\'fa-solid fa-graduation-cap\\' style=\\'color:#10b981\\'></i> Trường Lớp & Bạn Bè', 'inputSpotlightTarget')"><i class="fa-solid fa-graduation-cap" style="color:#10b981"></i> Trường Lớp & Bạn Bè</button>
        <button type="button" class="dropdown-item" onclick="selectDropdown('dd_spotlight', 'achievements', '<i class=\\'fa-solid fa-trophy\\' style=\\'color:#f59e0b\\'></i> Thành Tích & CLB', 'inputSpotlightTarget')"><i class="fa-solid fa-trophy" style="color:#f59e0b"></i> Thành Tích & CLB</button>
        <button type="button" class="dropdown-item" onclick="selectDropdown('dd_spotlight', 'taste', '<i class=\\'fa-solid fa-wand-magic-sparkles\\' style=\\'color:#facc15\\'></i> Gu Cá Nhân & Style', 'inputSpotlightTarget')"><i class="fa-solid fa-wand-magic-sparkles" style="color:#facc15"></i> Gu Cá Nhân & Style</button>
        <button type="button" class="dropdown-item" onclick="selectDropdown('dd_spotlight', 'goals', '<i class=\\'fa-solid fa-bullseye\\' style=\\'color:#ef4444\\'></i> Mục Tiêu & Cột Mốc', 'inputSpotlightTarget')"><i class="fa-solid fa-bullseye" style="color:#ef4444"></i> Mục Tiêu & Cột Mốc</button>
    </div>
    <input type="hidden" id="inputSpotlightTarget" value="none">
</div>`;

// Replace native select
html = html.replace(/<select id="inputSpotlightTarget"[\s\S]*?<\/select>/, customDropdownHTML);

fs.writeFileSync('index.html', html);

// Update JS for custom dropdown if it doesn't exist yet
let scriptHTML = `
<script>
function toggleDropdown(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var menu = el.querySelector('.dropdown-menu');
    
    document.querySelectorAll('.custom-dropdown .dropdown-menu').forEach(m => {
        if(m !== menu) m.style.display = 'none';
    });
    
    menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
}

document.addEventListener('click', function(e) {
    if (!e.target.closest('.custom-dropdown')) {
         document.querySelectorAll('.custom-dropdown .dropdown-menu').forEach(m => {
            m.style.display = 'none';
        });
    }
});

function selectDropdown(ddId, value, text, inputId) {
    var dd = document.getElementById(ddId);
    dd.querySelector('.dropdown-value').innerHTML = text;
    dd.querySelector('.dropdown-menu').style.display = 'none';
    
    document.getElementById(inputId).value = value;
}
</script>
</body>`;
if (!html.includes('function toggleDropdown(id)')) {
    html = html.replace('</body>', scriptHTML);
    fs.writeFileSync('index.html', html);
}
console.log('Replaced select with custom dropdown in index.html');

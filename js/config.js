/**
 * config.js - Cấu hình mặc định cho Student Youth Portfolio Hub
 *
 * Tất cả dữ liệu ở đây đều là GIÁ TRỊ TRỐNG hoặc placeholder tối thiểu.
 * Nội dung thật được nhập qua Admin Panel (?admin=true) và lưu vào /data/db.json.
 */
export const KE_CONFIG = {
    // 👤 Hồ Sơ Cá Nhân
    name: "",
    schoolName: "",
    className: "",
    gradYear: "",
    classSlogan: "",
    photoUrl: "",
    photoFallbackUrl: "",
    balloonTiktokUrl: "",

    quote1: "",
    quote2: "",
    quote3: "",

    audioUrl: "",
    audioFallbackUrl: "",
    onlineFallbackUrl: "",

    // Sở thích cá nhân
    favMusic: "",
    favMovie: "",
    favBook: "",
    favDrink: "",
    favFashion: "",
    favLover: "",
    favLifestyle: "",
    favColor: "",

    // Mạng xã hội
    socialLinks: {
        facebook: "",
        messenger: "",
        zalo: "",
        tiktok: "",
        instagram: ""
    },

    // Viên Nang Tốt Nghiệp
    isCapsuleLocked: false,
    graduationDate: "",
    sealedAt: "",
    graduationMessage: "",

    birthdayDate: "",
    displayMode: "vinyl",

    // Các mảng dữ liệu — để trống, thêm qua Admin Panel
    achievements: [],
    clubs: [],
    friends: [],
    diary: [],
    goals: [],
    journey: [],
    gallery: [],
    playlist: [],
    mapLocations: [],  // [{name, label, lat, lng}]
};

export function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g,
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

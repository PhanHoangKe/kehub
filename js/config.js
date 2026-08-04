/**
 * config.js - Cấu hình mặc định cho Student Youth Portfolio Hub
 *
 * Tất cả dữ liệu ở đây đều là GIÁ TRỊ TRỐNG hoặc placeholder tối thiểu.
 * Nội dung thật được nhập qua Admin Panel (?admin=true) và lưu vào /data/db.json.
 */
export const KE_CONFIG = {
    // 👤 Hồ Sơ Cá Nhân
    name: "Phan Hoàng Kế",
    schoolName: "Trường THPT",
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
    reactionsConfig: [
        { emoji: '❤️', title: 'Thả Tim Hạ Nhân', countId: 'reactionCount-heart', imgUrl: 'assets/memes/hanhan_3.png' },
        { emoji: '🧹', title: 'Hạ Nhân Quét Rác', countId: 'reactionCount-smile', imgUrl: 'assets/memes/hanhan_1.png' },
        { emoji: '😏', title: 'Hạ Nhân Cười Khẩy', countId: 'reactionCount-tear', imgUrl: 'assets/memes/hanhan_2.png' },
        { emoji: '🔥', title: 'Hạ Nhân Cực Ngầu', countId: 'reactionCount-party', imgUrl: 'assets/memes/hanhan_4.png' },
        { emoji: '👑', title: 'Hạ Nhân Bá Đạo', countId: 'reactionCount-clap', imgUrl: 'assets/memes/hanhan_2.png' }
    ],
};

export function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g,
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

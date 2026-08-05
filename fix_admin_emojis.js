const fs = require('fs');
let content = fs.readFileSync('js/admin.js', 'utf8');

const map = {
    '🔋': '<i class="fa-solid fa-battery-full" style="color: #22c55e;"></i>',
    '📐': '<i class="fa-solid fa-ruler-combined" style="color: #3b82f6;"></i>',
    '🎓': '<i class="fa-solid fa-graduation-cap" style="color: #10b981;"></i>',
    '✨': '<i class="fa-solid fa-wand-magic-sparkles" style="color: #facc15;"></i>',
    '🔓': '<i class="fa-solid fa-lock-open" style="color: #22c55e;"></i>',
    '🔥': '<i class="fa-solid fa-fire" style="color: #ef4444;"></i>',
    '👤': '<i class="fa-solid fa-user" style="color: #3b82f6;"></i>',
    '💖': '<i class="fa-solid fa-heart" style="color: #f43f5e;"></i>',
    '😂': '<i class="fa-solid fa-face-laugh-squint" style="color: #fbbf24;"></i>',
    '📦': '<i class="fa-solid fa-box" style="color: #f59e0b;"></i>',
    '📬': '<i class="fa-solid fa-mailbox" style="color: #3b82f6;"></i>'
};

for (const [emoji, icon] of Object.entries(map)) {
    content = content.split(emoji).join(icon);
}

fs.writeFileSync('js/admin.js', content);
console.log('Replaced remaining emojis in admin.js');

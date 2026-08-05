const fs = require('fs');
const files = ['js/admin.js', 'js/guestbook.js', 'js/inline-edit.js', 'js/renderers.js', 'js/weather.js', 'index.html'];

const replacements = {
    '🏡': '<i class="fa-solid fa-house"></i>',
    '🗑️': '<i class="fa-solid fa-trash-can"></i>',
    '🌐': '<i class="fa-solid fa-globe"></i>',
    '📍': '<i class="fa-solid fa-location-dot"></i>',
    '📱': '<i class="fa-solid fa-mobile-screen-button"></i>',
    '💻': '<i class="fa-solid fa-laptop"></i>',
    '🔗': '<i class="fa-solid fa-link"></i>',
    '⏱️': '<i class="fa-solid fa-stopwatch"></i>',
    '⚙️': '<i class="fa-solid fa-gear"></i>',
    '📜': '<i class="fa-solid fa-scroll"></i>',
    '🗺️': '<i class="fa-solid fa-map"></i>',
    '🎯': '<i class="fa-solid fa-bullseye"></i>',
    '📶': '<i class="fa-solid fa-signal"></i>',
    '❓': '<i class="fa-solid fa-circle-question"></i>',
    '🎮': '<i class="fa-solid fa-gamepad"></i>',
    '⚡': '<i class="fa-solid fa-bolt"></i>',
    '💾': '<i class="fa-solid fa-floppy-disk"></i>',
    '🟢': '<i class="fa-solid fa-circle" style="color:#22c55e"></i>',
    '⚪': '<i class="fa-regular fa-circle" style="color:#94a3b8"></i>',
    '⚠️': '<i class="fa-solid fa-triangle-exclamation" style="color:#eab308"></i>',
    '🎵': '<i class="fa-solid fa-music"></i>',
    '📝': '<i class="fa-solid fa-pen-to-square"></i>',
    '☀️': '<i class="fa-solid fa-sun" style="color:#fbbf24"></i>',
    '🌙': '<i class="fa-solid fa-moon" style="color:#cbd5e1"></i>',
    '🌧️': '<i class="fa-solid fa-cloud-rain" style="color:#38bdf8"></i>',
    '🌇': '<i class="fa-solid fa-city" style="color:#f59e0b"></i>',
    '☁️': '<i class="fa-solid fa-cloud"></i>',
    '💿': '<i class="fa-solid fa-compact-disc"></i>',
    '🎙️': '<i class="fa-solid fa-microphone-lines"></i>',
    '✏️': '<i class="fa-solid fa-pen"></i>',
    '📸': '<i class="fa-solid fa-camera"></i>',
    '🎧': '<i class="fa-solid fa-headphones"></i>',
    '❤️': '<i class="fa-solid fa-heart" style="color:#ef4444"></i>'
};

for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let content = fs.readFileSync(file, 'utf8');
    
    // We only replace emojis that are not already part of db object access like db.reactions['❤️']
    // Actually, '❤️' is used as a JSON key in reactions, so we should skip replacing it if it's inside quotes like '❤️'
    // Let's refine replacing:
    for (const [emoji, icon] of Object.entries(replacements)) {
        if (emoji === '❤️') {
            // only replace ❤️ if it's NOT surrounded by quotes
            const regex = new RegExp(`(?<!['"])${emoji}(?!['"])`, 'g');
            content = content.replace(regex, icon);
        } else {
            const regex = new RegExp(emoji, 'g');
            content = content.replace(regex, icon);
        }
    }
    
    fs.writeFileSync(file, content);
    console.log(`Updated ${file}`);
}

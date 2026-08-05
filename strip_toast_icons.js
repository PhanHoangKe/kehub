const fs = require('fs');
const files = ['js/admin.js', 'js/app.js', 'js/guestbook.js', 'js/inline-edit.js', 'js/renderers.js', 'js/weather.js'];

for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let content = fs.readFileSync(file, 'utf8');

    // This regex carefully matches showToast(`...`) or showToast("...") or showToast('...')
    // and removes any HTML tags <...> inside the message string.
    let updated = false;
    content = content.replace(/showToast\s*\(\s*([\`\'\"])(.*?)\1\s*(?:,\s*[\`\'\"](?:[^]*?)[\`\'\"]\s*)?\)/g, (match, quote, msg) => {
        const cleanMsg = msg.replace(/<[^>]*>/g, '').trim();
        if (cleanMsg !== msg) updated = true;
        
        // Since we are rebuilding the match, we should just replace the msg portion in the original match
        // But it's safer to just rebuild the whole call if we know the structure.
        // Or we can just do a string replacement on the match itself.
        return match.replace(msg, cleanMsg);
    });

    if (updated) {
        fs.writeFileSync(file, content);
        console.log('Stripped icons from toasts in', file);
    }
}

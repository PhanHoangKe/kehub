const fs = require('fs');
let content = fs.readFileSync('js/admin.js', 'utf8');

// Fix alert and confirm (remove HTML tags)
content = content.replace(/(alert\s*\(\s*[\`\'\"])(.*?)([\`\'\"]\s*\))/g, (match, start, msg, end) => {
    let cleanMsg = msg.replace(/<i class=[^>]+><\/i>\s*/g, '').replace(/<i class=[^>]+>\s*/g, '').trim();
    return start + cleanMsg + end;
});
content = content.replace(/(confirm\s*\(\s*[\`\'\"])(.*?)([\`\'\"]\s*\))/g, (match, start, msg, end) => {
    let cleanMsg = msg.replace(/<i class=[^>]+><\/i>\s*/g, '').replace(/<i class=[^>]+>\s*/g, '').trim();
    return start + cleanMsg + end;
});
content = content.replace(/(new Notification\s*\(\s*[\`\'\"])(.*?)([\`\'\"]\s*,)/g, (match, start, msg, end) => {
    let cleanMsg = msg.replace(/<i class=[^>]+><\/i>\s*/g, '').replace(/<i class=[^>]+>\s*/g, '').trim();
    return start + cleanMsg + end;
});

// For showToast, same thing: we strip the inline HTML tags
content = content.replace(/(showToast\s*\(\s*[\`\'\"])(.*?)([\`\'\"])/g, (match, start, msg, end) => {
    let cleanMsg = msg.replace(/<i class=[^>]+><\/i>\s*/g, '').replace(/<i class=[^>]+>\s*/g, '').trim();
    return start + cleanMsg + end;
});

fs.writeFileSync('js/admin.js', content);
console.log('Fixed syntax and stripped HTML from alerts/toasts');

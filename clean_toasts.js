const fs = require('fs');
const files = ['js/admin.js', 'js/guestbook.js', 'js/inline-edit.js', 'js/app.js'];

for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let content = fs.readFileSync(file, 'utf8');

    const badChars = ['✨', '✅', '❌', '🎉', '🚗', '🔄', '🤫', '❤️', '⚠️', '🔒', '📢', '💌'];
    
    content = content.replace(/showToast\(\s*([\`\'\"])(.*?)\1\s*(?:,\s*([\`\'\"])(.*?)\3\s*)?\)/g, (match, q1, msg, q2, type) => {
        let cleanMsg = msg.replace(/<i class=[^>]+><\/i>/g, '').trim();
        cleanMsg = cleanMsg.replace(/<i class=[^>]+>/g, '').trim();
        
        for (const char of badChars) {
            cleanMsg = cleanMsg.split(char).join('').trim();
        }
        
        let newType = type || 'success';
        const lowerMsg = cleanMsg.toLowerCase();
        
        if (lowerMsg.includes('lỗi') || lowerMsg.includes('thất bại') || lowerMsg.includes('không thể') || lowerMsg.includes('quá ngắn') || lowerMsg.includes('không đọc được') || lowerMsg.includes('không truy cập được')) {
            newType = 'error';
        } else if (lowerMsg.includes('vui lòng') || lowerMsg.includes('quá dài') || lowerMsg.includes('quá lớn') || lowerMsg.includes('chưa hỗ trợ') || lowerMsg.includes('tối đa')) {
            newType = 'warning';
        } else if (lowerMsg.includes('đã xóa') || lowerMsg.includes('sao chép') || lowerMsg.includes('đang') || lowerMsg.includes('thả tim') || lowerMsg.includes('thông báo')) {
            if (!lowerMsg.includes('thành công') && !lowerMsg.includes('đã lưu')) {
                newType = 'info';
            }
        }
        
        if (type && type !== newType) {
            if (newType === 'error' || newType === 'warning') {
                // keep newType
            } else {
                newType = type;
            }
        }
        
        let finalQuote = q1;
        if (cleanMsg.includes('${')) finalQuote = '`';
        
        if (newType === 'success') {
            return `showToast(${finalQuote}${cleanMsg}${finalQuote})`;
        } else {
            return `showToast(${finalQuote}${cleanMsg}${finalQuote}, '${newType}')`;
        }
    });
    
    fs.writeFileSync(file, content);
    console.log('Updated', file);
}

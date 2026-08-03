/**
 * script.js - Entry point phục vụ trình duyệt (HTML script tag trỏ vào đây)
 *
 * File này chỉ làm 1 việc: import app.js để trình duyệt load đúng
 * ES6 module với đường dẫn tương đối /js/app.js.
 *
 * Lý do tồn tại: index.html dùng <script type="module" src="script.js">
 * để tránh phải hard-code /js/app.js trực tiếp vào HTML.
 */
import './js/app.js';

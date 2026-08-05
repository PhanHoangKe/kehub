const fs = require('fs');
const cssToAdd = `
/* ==========================================================================
   Custom Dropdown Component
   ========================================================================== */
.custom-dropdown {
    position: relative;
    width: 100%;
    font-family: inherit;
}
.custom-dropdown-btn {
    width: 100%;
    padding: 10px 14px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.3);
    color: #fff;
    border: 1px solid rgba(251, 191, 36, 0.3);
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    transition: all 0.2s;
}
.custom-dropdown-btn:hover {
    border-color: rgba(251, 191, 36, 0.6);
    background: rgba(0, 0, 0, 0.5);
}
.custom-dropdown .dropdown-menu {
    position: absolute;
    top: 100%;
    left: 0;
    width: 100%;
    background: #1e1e2d;
    border: 1px solid rgba(251, 191, 36, 0.3);
    border-radius: 10px;
    margin-top: 5px;
    display: none;
    z-index: 1000;
    max-height: 250px;
    overflow-y: auto;
    box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    padding: 5px 0;
}
.custom-dropdown .dropdown-item {
    padding: 10px 14px;
    color: #fff;
    cursor: pointer;
    background: transparent;
    border: none;
    width: 100%;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.95rem;
    transition: background 0.2s;
}
.custom-dropdown .dropdown-item:hover {
    background: rgba(251, 191, 36, 0.15);
}
.custom-dropdown .dropdown-item i {
    width: 20px;
    text-align: center;
}
`;

let css = fs.readFileSync('style.css', 'utf8');
if (!css.includes('.custom-dropdown')) {
    fs.appendFileSync('style.css', '\n' + cssToAdd);
    console.log('Appended custom dropdown CSS');
} else {
    console.log('CSS already exists');
}

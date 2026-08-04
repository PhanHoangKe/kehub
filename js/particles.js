/**
 * particles.js - Động cơ hạt Canvas 2D (Tối ưu hóa Siêu Nhẹ & Siêu Mượt cho Di Động)
 */
export function initParticleEngine() {
    const canvas = document.getElementById('particleCanvas');
    if (!canvas) return { setMood: () => {} };
    
    const ctx = canvas.getContext('2d');
    let particles = [];
    let currentMood = 'sunset';
    const isMobile = () => window.innerWidth < 768;

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    class DynamicParticle {
        constructor(mood) {
            this.mood = mood;
            this.reset();
        }
        reset() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            
            if (this.mood === 'rain') {
                this.length = Math.random() * 16 + 8;
                this.speedY = Math.random() * 7 + 5;
                this.speedX = -Math.random() * 1.2 - 0.3;
                this.alpha = Math.random() * 0.4 + 0.2;
                this.color = '#38bdf8';
            } else if (this.mood === 'space') {
                this.size = Math.random() * 2 + 0.5;
                this.speedX = (Math.random() - 0.5) * 0.2;
                this.speedY = (Math.random() - 0.5) * 0.2;
                this.alpha = Math.random() * 0.8 + 0.2;
                this.fadeSpeed = Math.random() * 0.01 + 0.003;
                this.color = Math.random() > 0.3 ? '#c084fc' : '#38bdf8';
                this.isShootingStar = Math.random() < 0.03;
                if (this.isShootingStar) {
                    this.speedX = Math.random() * 5 + 3;
                    this.speedY = Math.random() * 3 + 2;
                    this.length = Math.random() * 35 + 15;
                }
            } else if (this.mood === 'day') {
                this.size = Math.random() * 2.2 + 0.8;
                this.speedX = (Math.random() - 0.5) * 0.3;
                this.speedY = -Math.random() * 0.4 - 0.1;
                this.alpha = Math.random() * 0.6 + 0.3;
                this.fadeSpeed = Math.random() * 0.006 + 0.002;
                this.color = Math.random() > 0.3 ? '#fbbf24' : '#38bdf8';
            } else {
                this.size = Math.random() * 2 + 0.8;
                this.speedX = (Math.random() - 0.5) * 0.4;
                this.speedY = -Math.random() * 0.5 - 0.2;
                this.alpha = Math.random() * 0.7 + 0.2;
                this.fadeSpeed = Math.random() * 0.008 + 0.002;
                this.color = Math.random() > 0.4 ? '#fbbf24' : '#f43f5e';
            }
        }
        update() {
            if (this.mood === 'rain') {
                this.y += this.speedY;
                this.x += this.speedX;
                if (this.y > canvas.height + 20 || this.x < -20) {
                    this.reset();
                    this.y = -10;
                }
            } else if (this.mood === 'space' && this.isShootingStar) {
                this.x += this.speedX;
                this.y += this.speedY;
                if (this.x > canvas.width + 50 || this.y > canvas.height + 50) {
                    this.reset();
                }
            } else {
                this.x += this.speedX;
                this.y += this.speedY;
                this.alpha += this.fadeSpeed || 0.005;
                if (this.alpha > 0.9 || this.alpha < 0.2) {
                    this.fadeSpeed = -this.fadeSpeed;
                }
                if (this.y < -10 || this.x < -10 || this.x > canvas.width + 10) {
                    this.reset();
                    this.y = canvas.height + 10;
                }
            }
        }
        draw(mobileMode) {
            ctx.save();
            ctx.globalAlpha = this.alpha;
            
            if (this.mood === 'rain') {
                ctx.strokeStyle = this.color;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                ctx.lineTo(this.x + this.speedX * 2, this.y + this.length);
                ctx.stroke();
            } else if (this.mood === 'space' && this.isShootingStar) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.2;
                if (!mobileMode) {
                    ctx.shadowBlur = 8;
                    ctx.shadowColor = '#c084fc';
                }
                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                ctx.lineTo(this.x - this.length, this.y - this.length * 0.5);
                ctx.stroke();
            } else {
                if (!mobileMode) {
                    ctx.shadowBlur = 6;
                    ctx.shadowColor = this.color;
                }
                ctx.fillStyle = this.color;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
    }

    function setMood(mood) {
        currentMood = mood;
        particles = [];
        const mobile = isMobile();
        const count = mobile ? 22 : (mood === 'rain' ? 70 : 55);
        for (let i = 0; i < count; i++) {
            particles.push(new DynamicParticle(mood));
        }
    }

    setMood('sunset');

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const mobile = isMobile();
        particles.forEach(p => {
            p.update();
            p.draw(mobile);
        });
        requestAnimationFrame(animate);
    }
    animate();

    return { setMood };
}

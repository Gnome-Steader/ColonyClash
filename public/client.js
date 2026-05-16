const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const statusText = document.getElementById('status');
const gameInfoText = document.getElementById('game-info');
const commandWheel = document.getElementById('command-wheel');
const guardMenu = document.getElementById('guard-menu');

socket.on('connect', () => {
    const name = sessionStorage.getItem('colonyName') || 'Colony';
    const color = sessionStorage.getItem('colonyColor') || '#3498db';
    socket.emit('joinGame', { name, color });
});

function openCommandWheel() {
    commandWheel.style.left = mouse.x + 'px';
    commandWheel.style.top = mouse.y + 'px';
    commandWheel.style.display = 'block';
    guardMenu.style.display = 'none';
}

function openGuardMenu() {
    guardMenu.style.left = mouse.x + 'px';
    guardMenu.style.top = mouse.y + 'px';
    guardMenu.style.display = 'block';
    commandWheel.style.display = 'none';
}

function closeCommandMenus() {
    commandWheel.style.display = 'none';
    guardMenu.style.display = 'none';
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

let gameState = null;
let myId = null;

let particles = [];
let texts =[];
let screenShake = 0;
let camX = 0, camY = 0;
let hibernationWarningTimer = null;
let hibernationResultTimer = null;
let hibernationHideTimer = null;
let hibernationLastFrozenCount = null;

const keys = { w: false, a: false, s: false, d: false, space: false };
const mouse = { x: 0, y: 0, worldX: 0, worldY: 0, clicking: false };

const images = { queen: new Image(), worker: new Image(), soldier: new Image(), beetle: new Image(), aphid: new Image(), rock: new Image(), hill: new Image(), egg: new Image(), larva: new Image(), pupa: new Image() };
images.queen.src = 'Queen.png';
images.worker.src = 'Worker.png';
images.soldier.src = 'Soldier.png';
images.beetle.src = 'Beetle.png';
images.aphid.src = 'Aphid.png';
images.rock.src = 'Rock.png';
images.hill.src = 'Hill.png';
images.egg.src = 'Egg.png';
images.larva.src = 'Larva.png';
images.pupa.src = 'Pupa.png';

const spriteCache = {};

function getTintedSprite(type, color) {
    // Map super_soldier to soldier image
    const imgType = type === 'super_soldier' ? 'soldier' : type;
    const key = `${color}_${imgType}`;
    if (spriteCache[key]) return spriteCache[key];

    const img = images[imgType];
    if (!img || !img.complete || img.width === 0) return null;

    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);

    const imgData = cx.getImageData(0, 0, c.width, c.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 230 && data[i+1] > 230 && data[i+2] > 230) data[i+3] = 0; 
    }
    cx.putImageData(imgData, 0, 0);

    cx.globalCompositeOperation = 'source-atop';
    cx.fillStyle = color;
    cx.globalAlpha = 0.5; 
    cx.fillRect(0, 0, c.width, c.height);
    cx.globalAlpha = 1.0;
    cx.globalCompositeOperation = 'source-over';

    spriteCache[key] = c;
    return c;
}

function getClearSprite(type) {
    // Map super_soldier to soldier image
    const imgType = type === 'super_soldier' ? 'soldier' : type;
    if (spriteCache[imgType]) return spriteCache[imgType];
    const img = images[imgType];
    if (!img || !img.complete || img.width === 0) return null;
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
    const imgData = cx.getImageData(0, 0, c.width, c.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 230 && data[i+1] > 230 && data[i+2] > 230) data[i+3] = 0; 
    }
    cx.putImageData(imgData, 0, 0);
    spriteCache[imgType] = c;
    return c;
}

class Particle {
    constructor(x, y, color) {
        this.x = x; this.y = y;
        this.vx = (Math.random() - 0.5) * 480; this.vy = (Math.random() - 0.5) * 480;
        this.life = 1.0; this.color = color;
    }
    update(deltaTime) {
        this.x += this.vx * deltaTime;
        this.y += this.vy * deltaTime;
        const drag = Math.pow(0.9, deltaTime * 60);
        this.vx *= drag;
        this.vy *= drag;
        this.life -= 3 * deltaTime;
    }
    draw(ctx) {
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(this.x, this.y, 4, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1.0;
    }
}

class FloatingText {
    constructor(x, y, text) {
        this.x = x + (Math.random()*20 - 10); this.y = y - 10;
        this.text = text; this.life = 1.0;
    }
    update(deltaTime) {
        this.y -= 90 * deltaTime;
        this.life -= 1.8 * deltaTime;
    }
    draw(ctx) {
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.fillStyle = 'white'; ctx.font = "bold 20px Arial";
        ctx.shadowColor = 'black'; ctx.shadowBlur = 4;
        ctx.fillText(this.text, this.x, this.y);
        ctx.shadowBlur = 0; ctx.globalAlpha = 1.0;
    }
}

function spawnJuice(x, y, text, isPlayer, count = 5) {
    for(let i=0; i<count; i++) particles.push(new Particle(x, y, '#e74c3c'));
    texts.push(new FloatingText(x, y, text));
    if (isPlayer) screenShake = 15; 
    else if (myId && gameState && gameState.players[myId]) {
        let myAntId = gameState.players[myId].antId;
        if (gameState.ants[myAntId]) {
            let myAnt = gameState.ants[myAntId];
            if (Math.hypot(myAnt.x - x, myAnt.y - y) < 400) screenShake = Math.max(screenShake, 4);
        }
    }
}

function hideHibernationWarning() {
    const warningDiv = document.getElementById('hibernation-warning');
    if (warningDiv) warningDiv.classList.remove('visible');
}

function hideHibernationResult() {
    const resultDiv = document.getElementById('hibernation-result');
    if (!resultDiv) return;

    resultDiv.classList.remove('visible');
    if (hibernationHideTimer) clearTimeout(hibernationHideTimer);
    hibernationHideTimer = setTimeout(() => {
        if (!resultDiv.classList.contains('visible')) {
            resultDiv.style.display = 'none';
        }
    }, 800);
}

function showHibernationResult(frozenCount = null) {
    const resultDiv = document.getElementById('hibernation-result');
    if (!resultDiv) return;

    if (hibernationResultTimer) clearInterval(hibernationResultTimer);
    if (hibernationHideTimer) clearTimeout(hibernationHideTimer);

    resultDiv.style.display = 'flex';
    resultDiv.offsetHeight;
    resultDiv.classList.add('visible');

    const resultSurvived = document.getElementById('result-survived');
    const resultDied = document.getElementById('result-died');
    const resumeEl = document.getElementById('result-resume');

    if (resultSurvived) resultSurvived.innerText = 'Your colony hibernated.';
    if (resultDied) {
        const countText = frozenCount === null ? 'Calculating...' : frozenCount;
        resultDied.innerText = `Ants froze to death: ${countText}`;
    }

    let resumeCountdown = 10;
    if (resumeEl) resumeEl.innerText = resumeCountdown;

    hibernationResultTimer = setInterval(() => {
        resumeCountdown--;
        if (resumeEl) resumeEl.innerText = Math.max(resumeCountdown, 0);
        if (resumeCountdown <= 0) {
            clearInterval(hibernationResultTimer);
            hibernationResultTimer = null;
            hideHibernationResult();
        }
    }, 1000);
}

// Fixed Input Listeners & Command Wheel logic
window.addEventListener('keydown', e => {
    if (e.key === ' ') e.preventDefault(); 
    const key = e.key === ' ' ? 'space' : e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = true;
    
    // Command Wheel Opening
    if (key === 'c') {
        if (commandWheel.style.display === 'none' && guardMenu.style.display === 'none') {
            openCommandWheel();
        }
    }
});
window.addEventListener('keyup', e => {
    const key = e.key === ' ' ? 'space' : e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = false;
    
    // Command Wheel Closing
    if (key === 'c') closeCommandMenus();
});

window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('mousedown', e => { if (e.button === 0) mouse.clicking = true; });
window.addEventListener('mouseup', e => { if (e.button === 0) mouse.clicking = false; });

canvas.addEventListener('dblclick', (e) => {
    // Send double-click drop to server with world coords
    socket.emit('double_click', { x: mouse.worldX, y: mouse.worldY });
});

document.querySelectorAll('[data-cmd]').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const cmd = e.target.getAttribute('data-cmd');
        if (cmd === 'guard_menu') {
            openGuardMenu();
            return;
        }
        if (cmd === 'back') {
            openCommandWheel();
            return;
        }
        socket.emit('command', cmd);
        closeCommandMenus();
    });
});

socket.on('init', id => { myId = id; });
socket.on('gameInfo', msg => { if (gameInfoText) gameInfoText.innerText = msg; });

socket.on('state', state => { 
    if (gameState) {
        const checkDmg = (oldD, newD) => {
            for (let id in oldD) {
                if (newD[id]) {
                    if (newD[id].hp < oldD[id].hp) spawnJuice(newD[id].x, newD[id].y, `-${oldD[id].hp - newD[id].hp}`, newD[id].isPlayer, 5);
                } else {
                    spawnJuice(oldD[id].x, oldD[id].y, "KILL!", oldD[id].isPlayer, 15);
                }
            }
        };
        checkDmg(gameState.ants, state.ants);
        checkDmg(gameState.beetles, state.beetles);
        checkDmg(gameState.queens, state.queens);
    }
    gameState = state; 
});

socket.on('gameOver', (result) => {
    const screen = document.getElementById('game-over-screen');
    const title = document.getElementById('game-over-title');
    const desc = document.getElementById('game-over-desc');
    screen.style.display = 'flex'; 
    if (result === 'win') {
        title.innerText = "VICTORY!"; title.style.color = "#f1c40f"; 
        desc.innerText = "You have conquered the enemy colonies.";
    } else {
        title.innerText = "DEFEAT!"; title.style.color = "#e74c3c"; 
        desc.innerText = "Your Queen was slain.";
    }
});
    socket.on('hibernationWarning', (data) => {
        const warningDiv = document.getElementById('hibernation-warning');
        if (!warningDiv) return;
        warningDiv.style.display = 'flex';
        warningDiv.offsetHeight;
        warningDiv.classList.add('visible');

        if (hibernationWarningTimer) clearTimeout(hibernationWarningTimer);
    
        let countdown = data.timeUntilHibernation;
        const countdownEl = document.getElementById('hibernation-countdown');
        const updateCountdown = () => {
            if (countdownEl) countdownEl.innerText = countdown;
            if (countdown > 0) {
                countdown--;
                hibernationWarningTimer = setTimeout(updateCountdown, 1000);
            } else {
                // When countdown finishes, hide warning and show result screen
                hideHibernationWarning();
                showHibernationResult(hibernationLastFrozenCount);
            }
        };
        updateCountdown();
    });

    socket.on('hibernationResult', (data) => {
        hibernationLastFrozenCount = typeof data.frozenCount === 'number' ? data.frozenCount : 0;
        const resultDied = document.getElementById('result-died');
        if (resultDied) resultDied.innerText = `Ants froze to death: ${hibernationLastFrozenCount}`;

        const resultDiv = document.getElementById('hibernation-result');
        if (resultDiv && resultDiv.classList.contains('visible')) {
            const resultSurvived = document.getElementById('result-survived');
            if (resultSurvived) resultSurvived.innerText = 'Your colony hibernated.';
            resultDiv.style.display = 'flex';
        } else {
            showHibernationResult(hibernationLastFrozenCount);
        }
    });

function drawSprite(sprite, x, y, size, angle) {
    if (!sprite) return;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Manual transform math is ~4x faster than canvas save/restore stack allocations
    ctx.setTransform(cos, sin, -sin, cos, x - camX, y - camY);
    ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
    ctx.setTransform(1, 0, 0, 1, -camX, -camY);
}

function drawRock(rock) {
    const sprite = images.rock;
    const size = rock.radius * 2;
    if (sprite && sprite.complete && sprite.width > 0) {
        const aspect = sprite.height / sprite.width;
        const height = size * aspect;
        drawSprite(sprite, rock.x, rock.y, size, 0);
        return;
    }

    ctx.save();
    ctx.translate(rock.x, rock.y);
    ctx.fillStyle = '#6b5b4b';
    ctx.beginPath();
    ctx.moveTo(-rock.radius * 0.85, -rock.radius * 0.25);
    ctx.lineTo(-rock.radius * 0.35, -rock.radius * 0.95);
    ctx.lineTo(rock.radius * 0.55, -rock.radius * 0.7);
    ctx.lineTo(rock.radius * 0.95, -rock.radius * 0.05);
    ctx.lineTo(rock.radius * 0.55, rock.radius * 0.85);
    ctx.lineTo(-rock.radius * 0.45, rock.radius * 0.95);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#3f342c';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.ellipse(-rock.radius * 0.18, -rock.radius * 0.22, rock.radius * 0.35, rock.radius * 0.2, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawHillOverlay(x, y, alpha, size) {
    const sprite = images.hill;
    if (!sprite || !sprite.complete || sprite.width === 0) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    drawSprite(sprite, x, y, size, 0);
    ctx.restore();
}

function getColonyHillSize(colonyId) {
    let capacity = 0;
    for (let id in gameState.ants) {
        const ant = gameState.ants[id];
        if (!ant || ant.colonyId !== colonyId) continue;
        if (ant.type === 'soldier') capacity += 2;
        else if (ant.type === 'super_soldier') capacity += 6;
        else capacity += 1;
    }
    const baseSize = 100;
    const extra = Math.sqrt(capacity) * 10;
    return baseSize + extra;
}

function drawRoundedRect(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function update(deltaTime) {
    const me = gameState.players[myId];
    let targetCamX = camX, targetCamY = camY;

    if (me && gameState.ants[me.antId]) {
        const myAnt = gameState.ants[me.antId];
        targetCamX = myAnt.x - canvas.width / 2;
        targetCamY = myAnt.y - canvas.height / 2;
        socket.emit('input', { keys, mouseX: mouse.worldX, mouseY: mouse.worldY, clicking: mouse.clicking });
    }

    const camLerp = 1 - Math.pow(1 - 0.15, deltaTime * 60);
    camX += (targetCamX - camX) * camLerp;
    camY += (targetCamY - camY) * camLerp;
    mouse.worldX = mouse.x + camX;
    mouse.worldY = mouse.y + camY;

    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update(deltaTime);
        if (particles[i].life <= 0) particles.splice(i, 1);
    }
    for (let i = texts.length - 1; i >= 0; i--) {
        texts[i].update(deltaTime);
        if (texts[i].life <= 0) texts.splice(i, 1);
    }

    if (screenShake > 0) {
        screenShake *= Math.pow(0.85, deltaTime * 60);
        if (screenShake < 0.5) screenShake = 0;
    }
}

function draw() {
    if (!gameState) return;
    const me = gameState.players[myId];

    const isVisible = (x, y) => x >= camX - 100 && x <= camX + canvas.width + 100 && y >= camY - 100 && y <= camY + canvas.height + 100;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    if (screenShake > 0) {
        ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake);
    }
    
    ctx.translate(-camX, -camY);
    ctx.fillStyle = '#006400'; ctx.fillRect(0, 0, 3000, 3000);

    for (let id in gameState.rocks) {
        const rock = gameState.rocks[id];
        if (!isVisible(rock.x, rock.y)) continue;
        drawRock(rock);
    }

    for (let id in gameState.foods) {
        let f = gameState.foods[id];
        if (!isVisible(f.x, f.y)) continue;
        ctx.fillStyle = f.foodType === 'honey' ? '#f1c40f' : '#2ecc71';
        ctx.beginPath(); ctx.arc(f.x, f.y, 6, 0, Math.PI*2); ctx.fill();
    }

    for (let id in gameState.meats) {
        let m = gameState.meats[id];
        if (!isVisible(m.x, m.y)) continue;
        ctx.fillStyle = '#e74c3c';
        ctx.beginPath(); ctx.arc(m.x, m.y, 7, 0, Math.PI*2); ctx.fill();
    }

    for (let id in gameState.aphids) {
        let a = gameState.aphids[id];
        if (!isVisible(a.x, a.y)) continue;
        const sprite = getClearSprite('aphid');
        if (sprite) drawSprite(sprite, a.x, a.y, 28, 0);
        else { 
            ctx.fillStyle = '#f39c12'; 
            ctx.beginPath(); 
            ctx.arc(a.x, a.y, 10, 0, Math.PI*2); 
            ctx.fill();
            ctx.strokeStyle = '#d68910';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    for (let id in gameState.beetles) {
        let b = gameState.beetles[id];
        if (!isVisible(b.x, b.y)) continue;
        const sprite = getClearSprite('beetle');
        let lunge = b.attackCooldown > 30 ? 10 : 0;
        let rx = b.x + Math.cos(b.angle) * lunge;
        let ry = b.y + Math.sin(b.angle) * lunge;
        if (sprite) drawSprite(sprite, rx, ry, 50, b.angle);
        else { ctx.fillStyle = '#2c3e50'; ctx.beginPath(); ctx.arc(rx, ry, 25, 0, Math.PI*2); ctx.fill(); }
        ctx.fillStyle = 'red'; ctx.fillRect(b.x - 15, b.y - 30, 30 * (b.hp / 50), 5);
    }

    for (let id in gameState.broods) {
        let b = gameState.broods[id];
        if (!isVisible(b.x, b.y)) continue;
        const stage = b.stage || 'egg';
        const broodSize = 25 * 0.75;
        const sprite = getClearSprite(stage);
        if (sprite) {
            drawSprite(sprite, b.x, b.y, broodSize, 0);
        } else {
            const colonyColor = gameState.colonies[b.colonyId].color;
            ctx.fillStyle = colonyColor;
            if (stage === 'egg') {
                ctx.beginPath();
                ctx.arc(b.x, b.y, broodSize * 0.25, 0, Math.PI * 2);
                ctx.fill();
            } else if (stage === 'larva') {
                ctx.beginPath();
                ctx.ellipse(b.x, b.y, broodSize * 0.35, broodSize * 0.2, 0.2, 0, Math.PI * 2);
                ctx.fill();
            } else {
                drawRoundedRect(b.x - broodSize * 0.35, b.y - broodSize * 0.25, broodSize * 0.7, broodSize * 0.5, broodSize * 0.2);
                ctx.fill();
            }
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    for (let id in gameState.queens) {
        let q = gameState.queens[id];
        if (!isVisible(q.x, q.y)) continue;
        const color = gameState.colonies[q.colonyId].color;
        const sprite = getTintedSprite('queen', color);
        if (sprite) drawSprite(sprite, q.x, q.y, 70, q.angle || 0); 
        ctx.fillStyle = 'red'; ctx.fillRect(q.x - 20, q.y - 40, 40 * (q.hp / 100), 5);
    }

    for (let id in gameState.ants) {
        let a = gameState.ants[id];
        if (!isVisible(a.x, a.y)) continue;
        const color = gameState.colonies[a.colonyId].color;
        const size = a.type === 'soldier' ? 40 : (a.type === 'super_soldier' ? 80 : 25);
        const sprite = getTintedSprite(a.type, color);

        let lunge = a.attackCooldown > 15 ? 10 : 0;
        let rx = a.x + Math.cos(a.angle) * lunge;
        let ry = a.y + Math.sin(a.angle) * lunge;

        if (sprite) drawSprite(sprite, rx, ry, size, a.angle);
        
        if (a.isPlayer) {
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(rx, ry, size/2 + 5, 0, Math.PI*2); ctx.stroke();
        }

        if (a.carrying) {
            if (a.carrying === 'meat') {
                ctx.fillStyle = '#e74c3c';
                ctx.beginPath(); ctx.arc(rx + (Math.cos(a.angle)*size/2), ry + (Math.sin(a.angle)*size/2), 5, 0, Math.PI*2); ctx.fill();
            } else if (a.carrying === 'honey') {
                ctx.fillStyle = '#f1c40f';
                ctx.beginPath(); ctx.arc(rx + (Math.cos(a.angle)*size/2), ry + (Math.sin(a.angle)*size/2), 5, 0, Math.PI*2); ctx.fill();
            } else if (a.carrying === 'aphid') {
                // Draw carried aphid as a sprite
                const aphidSprite = getClearSprite('aphid');
                const carryOffsetX = rx + (Math.cos(a.angle)*size/2);
                const carryOffsetY = ry + (Math.sin(a.angle)*size/2);
                if (aphidSprite) {
                    ctx.save();
                    ctx.setTransform(1, 0, 0, 1, carryOffsetX - camX, carryOffsetY - camY);
                    ctx.drawImage(aphidSprite, -12, -12, 24, 24);
                    ctx.restore();
                    ctx.setTransform(1, 0, 0, 1, -camX, -camY);
                } else {
                    ctx.fillStyle = '#f39c12';
                    ctx.beginPath(); ctx.arc(carryOffsetX, carryOffsetY, 6, 0, Math.PI*2); ctx.fill();
                }
            } else {
                ctx.fillStyle = '#2ecc71'; ctx.beginPath(); ctx.arc(rx + (Math.cos(a.angle)*size/2), ry + (Math.sin(a.angle)*size/2), 5, 0, Math.PI*2); ctx.fill();
            }
        }

        const maxHp = a.type === 'soldier' ? 30 : (a.type === 'super_soldier' ? 90 : 10);
        if (a.hp < maxHp) {
            const barW = a.type === 'super_soldier' ? 60 : 20;
            ctx.fillStyle = 'red'; ctx.fillRect(a.x - barW/2, a.y - 20, barW * (a.hp / maxHp), 3);
        }
    }

    const myAnt = me && me.antId && gameState.ants[me.antId] ? gameState.ants[me.antId] : null;
    for (let id in gameState.queens) {
        const queen = gameState.queens[id];
        if (!isVisible(queen.x, queen.y)) continue;

        let hillAlpha = 1;
        if (myAnt) {
            const revealDistance = 220;
            const fadeDistance = 90;
            const distance = Math.hypot(myAnt.x - queen.x, myAnt.y - queen.y);
            hillAlpha = Math.max(0, Math.min(1, (distance - fadeDistance) / (revealDistance - fadeDistance)));
        }

        const hillSize = getColonyHillSize(queen.colonyId);
        drawHillOverlay(queen.x, queen.y, hillAlpha, hillSize);
    }

    ctx.restore();
    if (me && gameState.colonies[me.colonyId]) {
        const commandLabel = gameState.colonies[me.colonyId].command.replace(/_/g, ' ').toUpperCase();
        statusText.innerText = `Command: ${commandLabel}`;
    }
}

let lastFrameTime = null;

function loop(timestamp) {
    requestAnimationFrame(loop);

    const currentTime = typeof timestamp === 'number' ? timestamp : performance.now();
    if (lastFrameTime === null) {
        lastFrameTime = currentTime;
        return;
    }

    const deltaTime = Math.min((currentTime - lastFrameTime) / 1000, 0.001);
    lastFrameTime = currentTime;

    if (!gameState) return;

    update(deltaTime);
    draw();
}

requestAnimationFrame(loop);
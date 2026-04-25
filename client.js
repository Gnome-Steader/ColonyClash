// --- Game State & Assets ---
let gameState = { entities: {} };
let castesData = {};
let selectedIds = new Set();
let myId = 'player1';

// Canonical base texture requested
const antSprite = new Image();
antSprite.src = 'https://raw.githubusercontent.com/Gnome-Steader/stuff/main/ant.png';

// --- Canvas & Camera Setup ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
let width = window.innerWidth;
let height = window.innerHeight;
canvas.width = width; canvas.height = height;

window.addEventListener('resize', () => {
    width = window.innerWidth; height = window.innerHeight;
    canvas.width = width; canvas.height = height;
});

const camera = { x: -width/2, y: -height/2, zoom: 0.5 }; // Zoomed out for large castes

// --- WebSocket Connection ---
let ws;
function connectServer() {
    ws = new WebSocket('ws://localhost:8080');
    ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.type === 'init') {
            gameState.entities = data.state.entities;
            castesData = data.castes;
        } else if (data.type === 'update') {
            gameState.entities = data.entities;
        }
    };
}

// --- Input Handling (Desktop + Canvas Mapping) ---
const keys = {};
let mouseX = 0, mouseY = 0;
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let wheelOpen = false;

window.addEventListener('keydown', e => keys[e.code] = true);
window.addEventListener('keyup', e => {
    keys[e.code] = false;
    if (e.code === 'Space') closeWheel();
});

canvas.addEventListener('mousemove', e => {
    mouseX = e.clientX; mouseY = e.clientY;
});

canvas.addEventListener('mousedown', e => {
    if (e.button === 0) { // Left click: Select / Marquee
        isDragging = true;
        dragStartX = mouseX; dragStartY = mouseY;
    } else if (e.button === 2) { // Right click: Move command
        const worldPos = screenToWorld(mouseX, mouseY);
        if (selectedIds.size > 0 && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'command_move',
                entityIds: Array.from(selectedIds),
                x: worldPos.x,
                y: worldPos.y
            }));
        }
    } else if (e.button === 1) { // Middle click: Pheromone Wheel
        openWheel(mouseX, mouseY);
    }
});

canvas.addEventListener('mouseup', e => {
    if (e.button === 0 && isDragging) {
        isDragging = false;
        selectUnitsInMarquee(dragStartX, dragStartY, mouseX, mouseY);
    } else if (e.button === 1) {
        closeWheel();
    }
});

canvas.addEventListener('wheel', e => {
    // Pinch / Scroll to zoom
    const zoomAmount = e.deltaY * -0.001;
    camera.zoom = Math.max(0.05, Math.min(camera.zoom + zoomAmount, 2.0));
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

// --- Coordinate Math ---
function screenToWorld(sx, sy) {
    return {
        x: (sx / camera.zoom) + camera.x,
        y: (sy / camera.zoom) + camera.y
    };
}

function selectUnitsInMarquee(sx1, sy1, sx2, sy2) {
    if(!castesData) return;
    const wx1 = (Math.min(sx1, sx2) / camera.zoom) + camera.x;
    const wy1 = (Math.min(sy1, sy2) / camera.zoom) + camera.y;
    const wx2 = (Math.max(sx1, sx2) / camera.zoom) + camera.x;
    const wy2 = (Math.max(sy1, sy2) / camera.zoom) + camera.y;

    selectedIds.clear();
    let hasSelection = false;
    for (const id in gameState.entities) {
        const ent = gameState.entities[id];
        if (ent.ownerId === myId) {
            // Check Hitbox intersection
            if (ent.x > wx1 && ent.x < wx2 && ent.y > wy1 && ent.y < wy2) {
                selectedIds.add(id);
                hasSelection = true;
            }
        }
    }
    
    // Update HUD
    const portrait = document.getElementById('unit-portrait');
    if (hasSelection) {
        const firstEnt = gameState.entities[Array.from(selectedIds)[0]];
        portrait.innerHTML = `<img src="${antSprite.src}" width="80" style="margin-top:20px; filter: drop-shadow(0 0 5px #8EEA6A);"/>`;
        document.getElementById('hp-fill').style.width = `${(firstEnt.health / firstEnt.maxHealth) * 100}%`;
    } else {
        portrait.innerHTML = 'NO SELECTION';
        document.getElementById('hp-fill').style.width = '0%';
    }
}

// --- Pheromone Wheel Logic ---
const wheel = document.getElementById('pheromone-wheel');
const commands =['Move Here', 'Attack Move', 'Hold Position', 'Focus Fire', 'Forage', 'Guard Brood', 'Special', 'Return'];

function openWheel(x, y) {
    if (selectedIds.size === 0) return;
    wheelOpen = true;
    wheel.style.display = 'block';
    wheel.style.left = x + 'px';
    wheel.style.top = y + 'px';
    
    wheel.innerHTML = '';
    const angleStep = 360 / commands.length;
    commands.forEach((cmd, i) => {
        const seg = document.createElement('div');
        seg.className = 'wheel-segment';
        seg.innerText = cmd;
        // Basic CSS radial clip and rotate
        seg.style.transform = `rotate(${i * angleStep}deg) skewY(${90 - angleStep}deg)`;
        seg.onclick = () => executeCommand(cmd);
        wheel.appendChild(seg);
    });
}

function closeWheel() {
    wheelOpen = false;
    wheel.style.display = 'none';
}

function executeCommand(cmd) {
    console.log(`Executed Pheromone Command: ${cmd}`);
    // Extend socket commands here based on the selected wheel item
    closeWheel();
}

// --- Render Loop ---
function draw() {
    // 1. Update Camera (WASD / Pan)
    const camSpeed = 15 / camera.zoom;
    if (keys['KeyW'] || keys['ArrowUp']) camera.y -= camSpeed;
    if (keys['KeyS'] || keys['ArrowDown']) camera.y += camSpeed;
    if (keys['KeyA'] || keys['ArrowLeft']) camera.x -= camSpeed;
    if (keys['KeyD'] || keys['ArrowRight']) camera.x += camSpeed;

    // 2. Clear Screen
    ctx.fillStyle = '#1a1a1a'; // Ambient Occlusion / Dirt base
    ctx.fillRect(0, 0, width, height);

    // 3. Setup Camera Transform
    ctx.save();
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    // 4. Draw Entities
    for (const id in gameState.entities) {
        const ent = gameState.entities[id];
        if (!ent || !antSprite.complete) continue;

        const size = ent.size;
        const halfSize = size / 2;

        ctx.save();
        ctx.translate(ent.x, ent.y);
        
        // Calculate rotation towards target
        if (ent.action === 'walk') {
            const angle = Math.atan2(ent.targetY - ent.y, ent.targetX - ent.x);
            // Assuming sprite faces North (up) by default, add 90 deg (Math.PI/2)
            ctx.rotate(angle + Math.PI / 2);
        }

        // Draw Sprite scaling exactly 2x based on caste metadata size
        ctx.drawImage(antSprite, -halfSize, -halfSize, size, size);

        // Rim Lighting & Specular simulation based on selection
        if (selectedIds.has(id)) {
            ctx.strokeStyle = '#8EEA6A'; // Acid/venom highlight for selection
            ctx.lineWidth = 4 / camera.zoom;
            ctx.beginPath();
            ctx.arc(0, 0, ent.hitbox / 2, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.restore();
        
        // Floating health bar logic
        if (ent.health < ent.maxHealth) {
            ctx.fillStyle = 'red';
            ctx.fillRect(ent.x - 20, ent.y - halfSize - 10, 40, 5);
            ctx.fillStyle = '#8EEA6A';
            ctx.fillRect(ent.x - 20, ent.y - halfSize - 10, 40 * (ent.health/ent.maxHealth), 5);
        }
    }

    // 5. Draw Marquee
    ctx.restore(); // Restore to screen space for UI rendering
    if (isDragging) {
        ctx.fillStyle = 'rgba(142, 234, 106, 0.2)';
        ctx.strokeStyle = '#8EEA6A';
        ctx.lineWidth = 1;
        const rw = mouseX - dragStartX;
        const rh = mouseY - dragStartY;
        ctx.fillRect(dragStartX, dragStartY, rw, rh);
        ctx.strokeRect(dragStartX, dragStartY, rw, rh);
    }

    requestAnimationFrame(draw);
}

// --- Startup Sequence ---
document.getElementById('start-btn').addEventListener('click', () => {
    document.getElementById('story-overlay').style.display = 'none';
    connectServer();
    requestAnimationFrame(draw);
});

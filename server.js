const WebSocket = require('ws');
const fs = require('fs');

// Load Metadata
const castesData = JSON.parse(fs.readFileSync('./castes.json', 'utf8')).castes;

const wss = new WebSocket.Server({ port: 8080 });
const TICK_RATE = 20; // 20 Hz
const TICK_MS = 1000 / TICK_RATE;

let gameState = {
    entities: {},
    resources: {},
    entityCounter: 0
};

// Start a single queen for testing purposes
spawnEntity('queen', 0, 0, 'player1');

function spawnEntity(casteType, x, y, ownerId) {
    const id = ++gameState.entityCounter;
    const stats = castesData[casteType];
    gameState.entities[id] = {
        id, ownerId, caste: casteType,
        x, y, targetX: x, targetY: y,
        health: stats.health, maxHealth: stats.health,
        speed: stats.speed, size: stats.size, hitbox: stats.hitbox,
        action: 'idle'
    };
    return id;
}

wss.on('connection', (ws) => {
    console.log('Client connected');
    ws.send(JSON.stringify({ type: 'init', state: gameState, castes: castesData }));

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        if (data.type === 'command_move') {
            data.entityIds.forEach(id => {
                if (gameState.entities[id]) {
                    gameState.entities[id].targetX = data.x;
                    gameState.entities[id].targetY = data.y;
                    gameState.entities[id].action = 'walk';
                }
            });
        }
    });

    ws.on('close', () => console.log('Client disconnected'));
});

// Main Game Loop (Authoritative Server)
setInterval(() => {
    let stateChanged = false;
    const dt = TICK_MS / 1000;

    for (const id in gameState.entities) {
        const ent = gameState.entities[id];
        
        // Simple linear movement pathfinding
        const dx = ent.targetX - ent.x;
        const dy = ent.targetY - ent.y;
        const dist = Math.hypot(dx, dy);

        if (dist > 5) {
            const moveDist = ent.speed * dt;
            if (dist <= moveDist) {
                ent.x = ent.targetX;
                ent.y = ent.targetY;
                ent.action = 'idle';
            } else {
                ent.x += (dx / dist) * moveDist;
                ent.y += (dy / dist) * moveDist;
            }
            stateChanged = true;
        } else {
            if(ent.action !== 'idle') {
                ent.action = 'idle';
                stateChanged = true;
            }
        }
    }

    // Broadcast state (delta compression would go here in full prod)
    if (stateChanged) {
        const updateMsg = JSON.stringify({ type: 'update', entities: gameState.entities });
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(updateMsg);
            }
        });
    }
}, TICK_MS);

console.log(`Colony Clash Server running on ws://localhost:8080 at ${TICK_RATE}Hz`);

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const state = { players: {}, colonies: {}, ants: {}, queens: {}, beetles: {}, foods: {}, meats: {}, broods: {} };

let idCounter = 1;
const getId = () => (idCounter++).toString();

const MAP_SIZE = 3000;
const FPS = 25;
const MAX_ANTS_PER_COLONY = 800; // Hard cap so we don't accidentally lag out the engine forever
let hasGameStarted = false;
let simTick = 0;

const COLORS = ['#3498db', '#9b59b6', '#e67e22', '#1abc9c', '#f1c40f', '#e84393'];

const dist = (x1, y1, x2, y2) => { const dx = x1 - x2; const dy = y1 - y2; return Math.sqrt(dx * dx + dy * dy); };
const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

// Spatial Hash Grid


const CELL_SIZE = 400;
const GRID_W = Math.ceil(MAP_SIZE / CELL_SIZE) + 1;

// Pre-allocate grid to completely eliminate GC for cell creation/destruction
const grid = new Array(GRID_W * GRID_W);
for (let i = 0; i < grid.length; i++) {
    grid[i] = { ants: [], foods: [], meats: [], broods: [], beetles: [], queens: [] };
}

function getCellIndex(x, y) {
    const cx = Math.max(0, Math.min(GRID_W - 1, Math.floor(x / CELL_SIZE)));
    const cy = Math.max(0, Math.min(GRID_W - 1, Math.floor(y / CELL_SIZE)));
    return cx + cy * GRID_W;
}

function getCellsInRange(x, y, range) {
    const cells = [];
    const minX = Math.max(0, Math.floor((x - range) / CELL_SIZE));
    const maxX = Math.min(GRID_W - 1, Math.floor((x + range) / CELL_SIZE));
    const minY = Math.max(0, Math.floor((y - range) / CELL_SIZE));
    const maxY = Math.min(GRID_W - 1, Math.floor((y + range) / CELL_SIZE));
    
    for (let i = minX; i <= maxX; i++) {
        for (let j = minY; j <= maxY; j++) {
            cells.push(i + j * GRID_W);
        }
    }
    return cells;
}

function buildGrid() {
    for (let i = 0; i < grid.length; i++) {
        const cell = grid[i];
        cell.ants.length = 0;
        cell.foods.length = 0;
        cell.meats.length = 0;
        cell.broods.length = 0;
        cell.beetles.length = 0;
        cell.queens.length = 0;
    }
    
    const addToGrid = (obj, type) => {
        grid[getCellIndex(obj.x, obj.y)][type].push(obj);
    };

    for (let id in state.ants)    addToGrid(state.ants[id], 'ants');
    for (let id in state.foods)   addToGrid(state.foods[id], 'foods');
    for (let id in state.meats)   addToGrid(state.meats[id], 'meats');
    for (let id in state.broods)  addToGrid(state.broods[id], 'broods');
    for (let id in state.beetles) addToGrid(state.beetles[id], 'beetles');
    for (let id in state.queens)  addToGrid(state.queens[id], 'queens');
}

// How far from a player we consider entities "active" for full AI updates
const ACTIVE_PLAYER_VIEW = 1200; // in world units

function findClosestInGrid(source, types, maxRange, sourceColonyId = null) {
    let closest = null, minDist = maxRange, closestDict = null;
    const cells = getCellsInRange(source.x, source.y, maxRange);
    let checks = 0; // Hard cap on distance calculations to prevent O(N^2) lag spikes
    const maxRangeSq = maxRange * maxRange;
    for (const c of cells) {
        if (!grid[c]) continue;
        for (const type of types) {
            for (const obj of grid[c][type]) {
                if (sourceColonyId && obj.colonyId === sourceColonyId) continue;
                if (obj.id === source.id) continue;
                
                const dx = source.x - obj.x;
                const dy = source.y - obj.y;
                
                // Quick bounding box check
                if (Math.abs(dx) > maxRange || Math.abs(dy) > maxRange) continue;
                
                const dSq = dx * dx + dy * dy;
                if (dSq < minDist * minDist) { minDist = Math.sqrt(dSq); closest = obj; closestDict = type; }
                
                // Breaking early if we've done > 60 distance checks on this search.
                if (++checks > 60 && closest) return { obj: closest, dictName: closestDict };
            }
        }
    }
    return { obj: closest, dictName: closestDict };
}

function findClosestFriendlyAnt(source, maxRange, colonyId, allowedTypes = null) {
    let closest = null, minDist = maxRange;
    const cells = getCellsInRange(source.x, source.y, maxRange);
    let checks = 0;
    for (const c of cells) {
        if (!grid[c]) continue;
        for (const ant of grid[c].ants) {
            if (ant.colonyId !== colonyId) continue;
            if (source.id && ant.id === source.id) continue;
            if (allowedTypes && !allowedTypes.includes(ant.type)) continue;

            const dx = source.x - ant.x;
            const dy = source.y - ant.y;
            if (Math.abs(dx) > maxRange || Math.abs(dy) > maxRange) continue;

            const dSq = dx * dx + dy * dy;
            if (dSq < minDist * minDist) { minDist = Math.sqrt(dSq); closest = ant; }
            if (++checks > 60 && closest) return { obj: closest };
        }
    }
    return { obj: closest };
}

function findClosestFriendlyEntity(source, maxRange, colonyId, allowedTypes = ['ants', 'broods', 'queens']) {
    let closest = null, minDist = maxRange;
    const cells = getCellsInRange(source.x, source.y, maxRange);
    let checks = 0;
    for (const c of cells) {
        if (!grid[c]) continue;
        for (const type of allowedTypes) {
            for (const entity of grid[c][type]) {
                if (entity.colonyId !== colonyId) continue;
                if (source.id && entity.id === source.id) continue;

                const dx = source.x - entity.x;
                const dy = source.y - entity.y;
                if (Math.abs(dx) > maxRange || Math.abs(dy) > maxRange) continue;

                const dSq = dx * dx + dy * dy;
                if (dSq < minDist * minDist) { minDist = Math.sqrt(dSq); closest = entity; }
                if (++checks > 60 && closest) return { obj: closest };
            }
        }
    }
    return { obj: closest };
}

function isHeadingToward(source, target, minDot = 0.72) {
    const headingX = Math.cos(source.angle || 0);
    const headingY = Math.sin(source.angle || 0);
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return true;
    return ((headingX * dx) + (headingY * dy)) / len >= minDot;
}

function findSoldierDefenseTarget(soldier) {
    const hostile = findClosestInGrid(soldier, ['ants', 'beetles', 'queens'], 700, soldier.colonyId).obj;
    if (!hostile) return null;

    const friendly = findClosestFriendlyEntity(hostile, 220, soldier.colonyId).obj;
    if (!friendly) return null;

    const dx = friendly.x - hostile.x;
    const dy = friendly.y - hostile.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const protectedLimit = state.queens[friendly.id] ? 230 : state.broods[friendly.id] ? 180 : 150;
    if (distance > protectedLimit) return null;
    if (!isHeadingToward(hostile, friendly, 0.72)) return null;

    return { hostile, friendly };
}

function signalNearbyAllies(victim, attacker) {
    if (!victim || !attacker || !victim.colonyId) return;
    const cells = getCellsInRange(victim.x, victim.y, 700);
    const radiusSq = 700 * 700;
    let checks = 0;

    victim.underAttackBy = attacker.id;
    victim.underAttackTimer = 90;
    victim.underAttackX = attacker.x;
    victim.underAttackY = attacker.y;

    for (const c of cells) {
        if (!grid[c]) continue;
        for (const ally of grid[c].ants) {
            if (ally.colonyId !== victim.colonyId || ally.id === victim.id) continue;
            const dx = victim.x - ally.x;
            const dy = victim.y - ally.y;
            const dSq = dx * dx + dy * dy;
            if (dSq > radiusSq) continue;

            const distanceRatio = 1 - Math.min(Math.sqrt(dSq) / 700, 1);
            let helpChance = ally.type === 'soldier' ? 0.82 : 0.28;
            helpChance += distanceRatio * (ally.type === 'soldier' ? 0.12 : 0.08);
            if (victim.type === 'soldier') helpChance += 0.10;

            if (Math.random() < helpChance) {
                ally.assistTarget = victim.id;
                ally.assistTimer = ally.type === 'soldier' ? 180 : 90;
                ally.assistPriority = ally.type === 'soldier' ? 2 : 1;

                if (ally.type === 'soldier') {
                    ally.aggroTarget = attacker.id;
                    ally.aggroTimer = Math.max(ally.aggroTimer || 0, 180);
                }
            }

            if (++checks > 50) return;
        }
    }
}

function triggerAlarm(colonyId, x, y, offenderId, radius) {
    const cells = getCellsInRange(x, y, radius);
    const radiusSq = radius * radius;
    for (const c of cells) {
        if (!grid[c]) continue;
        for (const a of grid[c]['ants']) {
            if (a.colonyId === colonyId && a.id !== offenderId) {
                const dx = x - a.x;
                const dy = y - a.y;
                if (dx*dx + dy*dy <= radiusSq) {
                    a.aggroTarget = offenderId;
                    a.aggroTimer = 100;
                }
            }
        }
    }
}

// Slim representations — reduces network payload significantly
const slimAnt    = a => ({ id: a.id, colonyId: a.colonyId, type: a.type, x: Math.round(a.x), y: Math.round(a.y), angle: Math.round(a.angle * 100)/100, hp: a.hp, maxHp: a.maxHp, carrying: a.carrying, isPlayer: a.isPlayer, attackCooldown: a.attackCooldown });
const slimBeetle = b => ({ id: b.id, x: Math.round(b.x), y: Math.round(b.y), angle: Math.round(b.angle * 100)/100, hp: b.hp, attackCooldown: b.attackCooldown });
const slimFood   = f => ({ id: f.id, x: Math.round(f.x), y: Math.round(f.y) });
const slimMeat   = m => ({ id: m.id, x: Math.round(m.x), y: Math.round(m.y) });
const slimBrood  = b => ({ id: b.id, colonyId: b.colonyId, type: b.type, x: Math.round(b.x), y: Math.round(b.y), age: Math.round(b.age) });
const slimQueen  = q => ({ id: q.id, colonyId: q.colonyId, x: Math.round(q.x), y: Math.round(q.y), angle: Math.round(q.angle * 100)/100, hp: q.hp, food: q.food, meat: q.meat });

function spawnFood() {
    // FIX: Single-pass diff fill, no tight while loop
    const current = Object.keys(state.foods).length;
    if (current >= 400) return;
    for (let i = current; i < 400; i++) {
        const id = getId();
        state.foods[id] = { id, x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE };
    }
}

function spawnBeetle() {
    if (Object.keys(state.beetles).length < 25) {
        const id = getId();
        state.beetles[id] = {
            id, x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE,
            hp: 50, tx: Math.random() * MAP_SIZE, ty: Math.random() * MAP_SIZE,
            angle: 0, aggroTarget: null, aggroTimer: 0, attackCooldown: 0
        };
    }
}

function createColony(playerId) {
    const colId = getId();
    state.colonies[colId] = { id: colId, color: COLORS[Object.keys(state.colonies).length % COLORS.length], command: 'forage', guardX: null, guardY: null };

    let qx, qy, valid = false;
    while (!valid) {
        qx = 300 + Math.random() * (MAP_SIZE - 600);
        qy = 300 + Math.random() * (MAP_SIZE - 600);
        valid = true;
        for (let id in state.queens) {
            if (dist(qx, qy, state.queens[id].x, state.queens[id].y) < 1000) { valid = false; break; }
        }
    }

    const queenId = getId();
    state.queens[queenId] = { id: queenId, colonyId: colId, x: qx, y: qy, hp: 100, food: 0, meat: 0, angle: 0 };
    state.colonies[colId].guardX = qx;
    state.colonies[colId].guardY = qy;

    let firstWorkerId = null;
    for (let i = 0; i < 10; i++) {
        const antId = getId();
        if (i === 0) firstWorkerId = antId;
        state.ants[antId] = {
            id: antId, colonyId: colId, type: 'worker',
            x: qx + (Math.random() * 60 - 30), y: qy + (Math.random() * 60 - 30), angle: 0,
            hp: 10, maxHp: 10, dmg: 1, speed: 4, carrying: null,
            isPlayer: (i === 0), playerId: (i === 0 ? playerId : null),
            attackCooldown: 0, targetId: null, targetDict: null,
            searchTimer: Math.floor(Math.random() * 20),
            aggroTarget: null, aggroTimer: 0,
            assistTarget: null, assistTimer: 0, assistPriority: 0,
            underAttackBy: null, underAttackTimer: 0, underAttackX: null, underAttackY: null,
            wanderX: null, wanderY: null   // for forage wandering
        };
    }
    return { colId, firstWorkerId };
}

function updateGameInfo() {
    const playersCount = Object.keys(state.players).length;
    if (hasGameStarted) io.emit('gameInfo', `Battle in progress! Queens remaining: ${Object.keys(state.queens).length}`);
    else io.emit('gameInfo', `Waiting for opponents... (${playersCount}/2)`);
}

function checkWinCondition() {
    if (!hasGameStarted) return;
    const remainingColonies = new Set();
    Object.values(state.queens).forEach(q => remainingColonies.add(q.colonyId));
    if (remainingColonies.size <= 1) {
        const winnerColonyId = [...remainingColonies][0];
        if (winnerColonyId) {
            const wp = Object.values(state.players).find(pl => pl.colonyId === winnerColonyId);
            if (wp) io.to(wp.id).emit('gameOver', 'win');
        }
        hasGameStarted = false;
        updateGameInfo();
    }
}

io.on('connection', socket => {
    const { colId, firstWorkerId } = createColony(socket.id);
    state.players[socket.id] = { id: socket.id, colonyId: colId, antId: firstWorkerId, inputs: { keys: {}, mouseX: 0, mouseY: 0, clicking: false } };

    socket.emit('init', socket.id);
    if (Object.keys(state.players).length >= 2) hasGameStarted = true;
    updateGameInfo();

    socket.on('input', data => { if (state.players[socket.id]) state.players[socket.id].inputs = data; });
    socket.on('command', cmd => {
        const p = state.players[socket.id];
        if (p && state.colonies[p.colonyId]) {
            const colony = state.colonies[p.colonyId];
            colony.command = cmd;

            if (cmd === 'guard_area' && state.ants[p.antId]) {
                colony.guardX = state.ants[p.antId].x;
                colony.guardY = state.ants[p.antId].y;
            }

            if (cmd === 'guard_home') {
                const queen = Object.values(state.queens).find(q => q.colonyId === p.colonyId);
                if (queen) {
                    colony.guardX = queen.x;
                    colony.guardY = queen.y;
                }
            }
        }
    });

    socket.on('disconnect', () => {
        const p = state.players[socket.id];
        if (p) {
            for (let aId in state.ants)   { if (state.ants[aId].colonyId   === p.colonyId) delete state.ants[aId]; }
            for (let qId in state.queens)  { if (state.queens[qId].colonyId  === p.colonyId) delete state.queens[qId]; }
            for (let bId in state.broods)  { if (state.broods[bId].colonyId  === p.colonyId) delete state.broods[bId]; }
            delete state.colonies[p.colonyId];
            delete state.players[socket.id];
            checkWinCondition();
            updateGameInfo();
        }
    });
});


class AntManager {
    constructor(id) {
        this.id = id;
        this.ants = new Set();
    }

    update(activeCells, colonyPop, queenPerColony, playerAntPerColony) {
        for (let antId of this.ants) {
            const ant = state.ants[antId];
            if (!ant) continue;
        if (ant.attackCooldown > 0) ant.attackCooldown--;
        ant.searchTimer--;
        if (ant.assistTimer > 0) ant.assistTimer--;
        if (ant.underAttackTimer > 0) ant.underAttackTimer--;

        // If this ant is far from any player-controlled ant, do a lightweight update
        // to avoid spending CPU on invisible/irrelevant ants.
        if (!ant.isPlayer) {
            const key = getCellIndex(ant.x, ant.y);
            if (!activeCells.has(key)) {
                // Lightweight maintenance only: decay timers and skip heavy AI/movement
                if (ant.aggroTimer > 0) ant.aggroTimer--;
                continue;
            }
        }

        const col = state.colonies[ant.colonyId];
        if (!col) continue;
        const queen = queenPerColony[ant.colonyId];

        let tx = ant.x, ty = ant.y;

        if (ant.isPlayer) {
            const p = state.players[ant.playerId];
            if (p) {
                let dx = 0, dy = 0;
                if (p.inputs.keys.w) dy -= ant.speed;
                if (p.inputs.keys.s) dy += ant.speed;
                if (p.inputs.keys.a) dx -= ant.speed;
                if (p.inputs.keys.d) dx += ant.speed;

                if (dx !== 0 || dy !== 0) {
                    ant.angle = Math.atan2(dy, dx);
                    tx += dx; ty += dy;
                } else if (p.inputs.clicking || p.inputs.keys.space) {
                    ant.angle = Math.atan2(p.inputs.mouseY - ant.y, p.inputs.mouseX - ant.x);
                }
                if ((p.inputs.clicking || p.inputs.keys.space) && ant.attackCooldown <= 0) doAttack(ant, 50);
            }
        } else {
            let isAggroed = false;

            if (ant.type === 'soldier') {
                const defense = findSoldierDefenseTarget(ant);
                if (defense) {
                    isAggroed = true;
                    ant.aggroTarget = defense.hostile.id;
                    ant.aggroTimer = 120;
                    tx = defense.hostile.x;
                    ty = defense.hostile.y;
                    if ((tx - ant.x)**2 + (ty - ant.y)**2 < 1600 && ant.attackCooldown <= 0) {
                        doAttack(ant, 50);
                    }
                }
            }

            if (ant.aggroTimer > 0 && ant.aggroTarget) {
                ant.aggroTimer--;
                const aggroEnemy = state.ants[ant.aggroTarget] || state.beetles[ant.aggroTarget] || state.queens[ant.aggroTarget];
                if (aggroEnemy) {
                    isAggroed = true;
                    if (ant.hp < (ant.maxHp * 0.4) && ant.type === 'worker') {
                        const fAngle = Math.atan2(ant.y - aggroEnemy.y, ant.x - aggroEnemy.x);
                        tx = ant.x + Math.cos(fAngle) * 50;
                        ty = ant.y + Math.sin(fAngle) * 50;
                    } else {
                        tx = aggroEnemy.x; ty = aggroEnemy.y;
                        if ((tx - ant.x)**2 + (ty - ant.y)**2 < 1600 && ant.attackCooldown <= 0) doAttack(ant, 50); // 40^2 = 1600
                    }
                } else { ant.aggroTimer = 0; }
            }

            if (!isAggroed && ant.assistTarget && ant.assistTimer > 0) {
                const ally = state.ants[ant.assistTarget];
                if (ally && ally.colonyId === ant.colonyId && ally.underAttackTimer > 0) {
                    const threat = state.ants[ally.underAttackBy] || state.beetles[ally.underAttackBy] || state.queens[ally.underAttackBy];
                    if (threat) {
                        const helpChance = ant.type === 'soldier' ? 0.88 : 0.30;
                        if (Math.random() < helpChance) {
                            isAggroed = true;
                            tx = ally.x; ty = ally.y;
                            if ((tx - ant.x)**2 + (ty - ant.y)**2 < 1600 && ant.attackCooldown <= 0) doAttack(ant, 50);
                        }
                    }
                } else if (ant.assistTimer <= 0) {
                    ant.assistTarget = null;
                    ant.assistPriority = 0;
                }
            }

            if (!isAggroed && queen) {
                let currentTarget = (ant.targetId && ant.targetDict && state[ant.targetDict] && state[ant.targetDict][ant.targetId])
                    ? state[ant.targetDict][ant.targetId] : null;

                if (col.command === 'forage') {
                    if (!ant.carrying) {
                        if (!currentTarget || ant.searchTimer <= 0) {
                            // FIX: Increased range 600→900 so ants actually find food
                            const res = findClosestInGrid(ant, ['meats', 'foods'], 900);
                            if (res.obj) {
                                ant.targetId = res.obj.id; ant.targetDict = res.dictName;
                                ant.searchTimer = 30; // FIX: Reduced search frequency from 20 to 30
                                currentTarget = res.obj;
                                ant.wanderX = null; ant.wanderY = null;
                            } else {
                                ant.searchTimer = 20; // FIX: Longer idle time before searching again
                                currentTarget = null;
                                // Invalidate wander point so we pick a new one below
                                ant.wanderX = null; ant.wanderY = null;
                            }
                        }
                        if (currentTarget) {
                            tx = currentTarget.x; ty = currentTarget.y;
                        } else if (ant.type === 'soldier') {
                            const escort = findClosestFriendlyAnt(ant, 700, ant.colonyId, ['worker']);
                            if (escort.obj) {
                                const ox = escort.obj.x - queen.x;
                                const oy = escort.obj.y - queen.y;
                                const len = Math.max(Math.sqrt(ox * ox + oy * oy), 0.001);
                                const side = ((parseInt(ant.id, 10) + simTick) % 2 === 0) ? 1 : -1;
                                tx = escort.obj.x + (-oy / len) * (45 * side);
                                ty = escort.obj.y + (ox / len) * (45 * side);
                            } else {
                                if (!ant.wanderX || (ant.x - ant.wanderX)**2 + (ant.y - ant.wanderY)**2 < 900) {
                                    ant.wanderX = clamp(queen.x + (Math.random() * 600 - 300), 50, MAP_SIZE - 50);
                                    ant.wanderY = clamp(queen.y + (Math.random() * 600 - 300), 50, MAP_SIZE - 50);
                                }
                                tx = ant.wanderX; ty = ant.wanderY;
                            }
                        } else {
                            // FIX: Wander toward a random point instead of freezing in place
                            if (!ant.wanderX || (ant.x - ant.wanderX)**2 + (ant.y - ant.wanderY)**2 < 900) {
                                ant.wanderX = clamp(ant.x + (Math.random() * 800 - 400), 50, MAP_SIZE - 50);
                                ant.wanderY = clamp(ant.y + (Math.random() * 800 - 400), 50, MAP_SIZE - 50);
                            }
                            tx = ant.wanderX; ty = ant.wanderY;
                        }
                    } else {
                        if (queen) { tx = queen.x; ty = queen.y; }
                    }
                }
                else if (col.command === 'home') {
                    tx = queen.x; ty = queen.y;
                }
                else if (col.command === 'guard_home') {
                    if ((ant.x - queen.x)**2 + (ant.y - queen.y)**2 > 22500) { // 150^2 = 22500
                        tx = queen.x; ty = queen.y;
                    } else {
                        if (!currentTarget || ant.searchTimer <= 0) {
                            const res = findClosestInGrid(ant, ['ants', 'beetles'], 250, ant.colonyId);
                            if (res.obj) { ant.targetId = res.obj.id; ant.targetDict = res.dictName; ant.searchTimer = 20; currentTarget = res.obj; } // FIX: Increased from 15
                            else { ant.searchTimer = 15; currentTarget = null; }
                        }
                        if (currentTarget) {
                            tx = currentTarget.x; ty = currentTarget.y;
                            if ((tx - ant.x)**2 + (ty - ant.y)**2 < 1600 && ant.attackCooldown <= 0) doAttack(ant, 50); // 40^2 = 1600
                        } else {
                            tx = queen.x + (Math.random() * 60 - 30);
                            ty = queen.y + (Math.random() * 60 - 30);
                        }
                    }
                }
                else if (col.command === 'guard_area') {
                    const guardX = col.guardX ?? queen.x;
                    const guardY = col.guardY ?? queen.y;
                    const areaEnemy = findClosestInGrid({ x: guardX, y: guardY }, ['ants', 'beetles', 'queens'], 520, ant.colonyId);
                    if (areaEnemy.obj) {
                        tx = areaEnemy.obj.x; ty = areaEnemy.obj.y;
                        if ((tx - ant.x)**2 + (ty - ant.y)**2 < 1600 && ant.attackCooldown <= 0) doAttack(ant, 50);
                    } else if (ant.type === 'soldier') {
                        const escort = findClosestFriendlyAnt({ x: guardX, y: guardY }, 700, ant.colonyId, ['worker']);
                        if (escort.obj) {
                            const ox = escort.obj.x - guardX;
                            const oy = escort.obj.y - guardY;
                            const len = Math.max(Math.sqrt(ox * ox + oy * oy), 0.001);
                            const side = ((parseInt(ant.id, 10) + simTick) % 2 === 0) ? 1 : -1;
                            tx = escort.obj.x + (-oy / len) * (55 * side);
                            ty = escort.obj.y + (ox / len) * (55 * side);
                        } else {
                            if (!ant.wanderX || (ant.x - ant.wanderX)**2 + (ant.y - ant.wanderY)**2 < 900) {
                                ant.wanderX = clamp(guardX + (Math.random() * 500 - 250), 50, MAP_SIZE - 50);
                                ant.wanderY = clamp(guardY + (Math.random() * 500 - 250), 50, MAP_SIZE - 50);
                            }
                            tx = ant.wanderX; ty = ant.wanderY;
                        }
                    } else {
                        if (!ant.wanderX || (ant.x - ant.wanderX)**2 + (ant.y - ant.wanderY)**2 < 900) {
                            ant.wanderX = clamp(guardX + (Math.random() * 280 - 140), 50, MAP_SIZE - 50);
                            ant.wanderY = clamp(guardY + (Math.random() * 280 - 140), 50, MAP_SIZE - 50);
                        }
                        tx = ant.wanderX; ty = ant.wanderY;
                    }
                }
                else if (col.command === 'attack') {
                    if (currentTarget && currentTarget.colonyId === ant.colonyId) currentTarget = null;
                    if (!currentTarget || ant.searchTimer <= 0) {
                        const res = findClosestInGrid(ant, ['beetles', 'ants', 'queens', 'broods'], 1000, ant.colonyId);
                        if (res.obj) { ant.targetId = res.obj.id; ant.targetDict = res.dictName; ant.searchTimer = 25; currentTarget = res.obj; } // FIX: Increased from 20
                        else { ant.searchTimer = 15; currentTarget = null; }
                    }
                    if (currentTarget) {
                        tx = currentTarget.x; ty = currentTarget.y;
                        if ((tx - ant.x)**2 + (ty - ant.y)**2 < 1600 && ant.attackCooldown <= 0) { // 40^2 = 1600
                            if (ant.targetDict !== 'broods') doAttack(ant, 50);
                        }
                    }
                }
                else if (col.command === 'follow') {
                    // FIX: Use pre-cached lookup — was O(n) per ant, causing follow-mode lag spike
                    const playerAnt = playerAntPerColony[ant.colonyId];
                    if (playerAnt && playerAnt.id !== ant.id) {
                        tx = playerAnt.x; ty = playerAnt.y;
                    }
                }
            }

            if (dist(ant.x, ant.y, tx, ty) > 5) {
                ant.angle = Math.atan2(ty - ant.y, tx - ant.x);
                tx = ant.x + Math.cos(ant.angle) * ant.speed;
                ty = ant.y + Math.sin(ant.angle) * ant.speed;
            } else {
                tx = ant.x; ty = ant.y;
            }
        }

        // ─── Soft Separation: Prevent Ants Overlapping ───
        const cellKey = getCellIndex(tx, ty);
        if (grid[cellKey]) {
            let sepChecks = 0;
            let loopChecks = 0;
            if (grid[cellKey].ants) {
                for (const other of grid[cellKey].ants) {
                    if (++loopChecks > 40) break; // Hard cap inner loop to prevent O(N^2) lag spikes in huge swarms
                    if (other.id !== ant.id) {
                        const dx = tx - other.x;
                        const dy = ty - other.y;
                        
                        // Fast bounding box check
                        if (Math.abs(dx) > 15 || Math.abs(dy) > 15) continue;
                        
                        const dSq = dx * dx + dy * dy;
                        if (dSq < 225) { // 15^2 = 225
                            // Attack touching enemies
                            if (!ant.isPlayer && ant.attackCooldown <= 0 && other.colonyId !== ant.colonyId) {
                                doAttack(ant, 20, other);
                            }

                            if (dSq > 0.001) {
                                const d = Math.sqrt(dSq);
                                tx += (dx / d) * (15 - d) * 0.5;
                                ty += (dy / d) * (15 - d) * 0.5;
                            } else {
                                tx += (Math.random() - 0.5);
                                ty += (Math.random() - 0.5);
                            }
                            if (++sepChecks > 3) break; // Break early if we've separated from enough nearby ants
                        }
                    }
                }
            }
            if (grid[cellKey].beetles && !ant.isPlayer && ant.attackCooldown <= 0) {
                for (const other of grid[cellKey].beetles) {
                    const bx = tx - other.x;
                    const by = ty - other.y;
                    if (bx * bx + by * by < 400) {
                        doAttack(ant, 20, other);
                        break;
                    }
                }
            }
        }

        ant.x = clamp(tx, 0, MAP_SIZE);
        ant.y = clamp(ty, 0, MAP_SIZE);

        // Pick up food/meat
        if (!ant.carrying) {
            const res = findClosestInGrid(ant, ['foods', 'meats'], 20);
            const item = res.obj;
            if (item) {
                ant.carrying = res.dictName === 'foods' ? 'food' : 'meat';
                if (res.dictName === 'foods') delete state.foods[item.id];
                if (res.dictName === 'meats') delete state.meats[item.id];
                // FIX: Clear target so ant doesn't try to walk back to a now-gone food tile
                ant.targetId = null; ant.targetDict = null;
            }
        }

        // Deliver to queen
        if (ant.carrying && queen && dist(ant.x, ant.y, queen.x, queen.y) < 40) {
            if (ant.carrying === 'food') queen.food++;
            if (ant.carrying === 'meat') queen.meat++;
            ant.carrying = null;
            ant.targetId = null; ant.targetDict = null;
            ant.searchTimer = 0; // FIX: Immediately resume foraging after delivery
        }

        // Stealing broods (FIX: Only check every 5 updateframes to reduce CPU cost)
        if ((idCounter % 5) === (parseInt(ant.id) % 5)) {
            const nearbyBrood = findClosestInGrid(ant, ['broods'], 25).obj;
            if (nearbyBrood && nearbyBrood.colonyId !== ant.colonyId) {
                triggerAlarm(nearbyBrood.colonyId, nearbyBrood.x, nearbyBrood.y, ant.id, 800);
                nearbyBrood.colonyId = ant.colonyId;
                if (queen) {
                    const angle = Math.random() * Math.PI * 2;
                    nearbyBrood.x = queen.x + Math.cos(angle) * (40 + Math.random() * 25);
                    nearbyBrood.y = queen.y + Math.sin(angle) * (40 + Math.random() * 25);
                }
            }
        }

        }
    }
}

class CentralizedAIUpdateSystem {
    constructor() {
        this.managers = [];
        this.antsPerManager = 200;
    }
    
    update(activeCells, colonyPop, queenPerColony, playerAntPerColony) {
        this.distributeAnts();
        for (const manager of this.managers) {
            manager.update(activeCells, colonyPop, queenPerColony, playerAntPerColony);
        }
    }

    distributeAnts() {
        for (const manager of this.managers) {
            manager.ants.clear();
        }
        
        let currentManager = 0;
        let count = 0;
        
        for (let antId in state.ants) {
            if (count >= this.antsPerManager) {
                currentManager++;
                count = 0;
            }
            if (!this.managers[currentManager]) {
                this.managers.push(new AntManager(currentManager));
            }
            this.managers[currentManager].ants.add(antId);
            count++;
        }
    }
}

const centralAIUpdateSystem = new CentralizedAIUpdateSystem();

setInterval(() => {
    simTick++;
    spawnFood();
    spawnBeetle();
    buildGrid();

    // ─── Pre-compute per-tick lookups (eliminates O(n) searches inside loops) ───

    // Colony population (replaces getColonyPop() called per-queen)
    const colonyPop = {};
    for (let id in state.ants)   { const c = state.ants[id].colonyId;   colonyPop[c] = (colonyPop[c] || 0) + 1; }
    for (let id in state.broods) { const c = state.broods[id].colonyId; colonyPop[c] = (colonyPop[c] || 0) + 1; }

    // Queen per colony (replaces inner for-loop per ant)
    const queenPerColony = {};
    for (let qId in state.queens) {
        const q = state.queens[qId];
        queenPerColony[q.colonyId] = q;
        // Initialize spawn timer if not present
        if (!q.spawnTimer) q.spawnTimer = 0;
    }

    // Player ant per colony (FIX: was O(n) inside O(n) for follow command — caused severe lag)
    const playerAntPerColony = {};
    for (let pId in state.players) {
        const p = state.players[pId];
        if (p.antId && state.ants[p.antId]) playerAntPerColony[p.colonyId] = state.ants[p.antId];
    }

    // ─── Beetle Update ───
    for (let bId in state.beetles) {
        const b = state.beetles[bId];
        if (b.attackCooldown > 0) b.attackCooldown--;

        if (b.aggroTimer > 0 && b.aggroTarget) {
            b.aggroTimer--;
            const enemy = state.ants[b.aggroTarget];
            if (enemy) {
                b.tx = enemy.x; b.ty = enemy.y;
                if (dist(b.x, b.y, enemy.x, enemy.y) < 40 && b.attackCooldown <= 0) {
                    b.attackCooldown = 40;
                    enemy.hp -= 2;
                    enemy.aggroTarget = b.id;
                    enemy.aggroTimer = 60;
                    signalNearbyAllies(enemy, b);
                    if (enemy.hp <= 0) handleAntDeath(enemy);
                }
            } else { b.aggroTimer = 0; b.aggroTarget = null; }
        } else {
            if (dist(b.x, b.y, b.tx, b.ty) < 10) {
                b.tx = Math.random() * MAP_SIZE;
                b.ty = Math.random() * MAP_SIZE;
            }
        }
        b.angle = Math.atan2(b.ty - b.y, b.tx - b.x);
        b.x += Math.cos(b.angle) * 1.5;
        b.y += Math.sin(b.angle) * 1.5;
    }

    // ─── Ant AI Loop ───
    // Precompute which grid cells are "active" (near any player's controlled ant).
    const activeCells = new Set();
    for (let pId in state.players) {
        const p = state.players[pId];
        const myAnt = state.ants[p.antId];
        if (!myAnt) continue;
        const cells = getCellsInRange(myAnt.x, myAnt.y, ACTIVE_PLAYER_VIEW);
        for (const c of cells) activeCells.add(c);
    }
    centralAIUpdateSystem.update(activeCells, colonyPop, queenPerColony, playerAntPerColony);
    // ─── Queen Loop ───
    for (let qId in state.queens) {
        const q = state.queens[qId];
        let pop = colonyPop[q.colonyId] || 0;
        
        // Only check spawn conditions every 3 frames to reduce CPU cost
        if (++q.spawnTimer >= 3) {
            q.spawnTimer = 0;
            // FIX: Track pop locally so consecutive worker+soldier spawns don't exceed limit
            if (q.food >= 1 && pop < MAX_ANTS_PER_COLONY) {
                q.food--;
                spawnBrood(q, 'worker');
                pop++;
            }
            if (q.meat >= 1 && pop < MAX_ANTS_PER_COLONY) {
                q.meat--;
                spawnBrood(q, 'soldier');
            }
        }
    }

    // ─── Brood Hatching ───
    for (let bId in state.broods) {
        const b = state.broods[bId];
        // Initialize hatchTimer if not present (framebased counter = more efficient than age += 1/FPS)
        if (b.hatchTimer === undefined) b.hatchTimer = 0;
        if (++b.hatchTimer >= 30 * FPS) { // 30 seconds worth of frames
            const antId = getId();
            state.ants[antId] = {
                id: antId, colonyId: b.colonyId, type: b.type, x: b.x, y: b.y, angle: 0,
                hp: b.type === 'soldier' ? 30 : 10, maxHp: b.type === 'soldier' ? 30 : 10,
                dmg: b.type === 'soldier' ? 3 : 1, speed: b.type === 'soldier' ? 2.5 : 4,
                carrying: null, isPlayer: false, playerId: null, attackCooldown: 0,
                targetId: null, targetDict: null, searchTimer: 0,
                aggroTarget: null, aggroTimer: 0,
                assistTarget: null, assistTimer: 0, assistPriority: 0,
                underAttackBy: null, underAttackTimer: 0, underAttackX: null, underAttackY: null,
                wanderX: null, wanderY: null
            };
            delete state.broods[b.id];
        }
    }

    // ─── Network Sync (grid-based view culling — much faster than iterating all entities) ───
    for (let pId in state.players) {
        const p = state.players[pId];
        const myAnt = state.ants[p.antId];
        if (!myAnt) continue;

        const viewDist = 1200;
        const localState = {
            players: {}, colonies: state.colonies,
            ants: {}, foods: {}, meats: {}, beetles: {}, broods: {}, queens: {}
        };

            // Strip inputs from broadcast (saves bandwidth, clients don't need other players' inputs)
            for (let pid in state.players) {
                const pl = state.players[pid];
                localState.players[pid] = { id: pl.id, colonyId: pl.colonyId, antId: pl.antId };
            }

            // Use spatial grid for large collections
            const viewCells = getCellsInRange(myAnt.x, myAnt.y, viewDist);
            const viewDistSq = viewDist * viewDist;
            for (const c of viewCells) {
                if (!grid[c]) continue;
                for (const a of grid[c].ants) {
                    const dSq = (myAnt.x - a.x) ** 2 + (myAnt.y - a.y) ** 2;
                    if (dSq < viewDistSq) localState.ants[a.id] = slimAnt(a);
                }
                for (const f of grid[c].foods) {
                    const dSq = (myAnt.x - f.x) ** 2 + (myAnt.y - f.y) ** 2;
                    if (dSq < viewDistSq) localState.foods[f.id] = slimFood(f);
                }
                for (const m of grid[c].meats) {
                    const dSq = (myAnt.x - m.x) ** 2 + (myAnt.y - m.y) ** 2;
                    if (dSq < viewDistSq) localState.meats[m.id] = slimMeat(m);
                }
                for (const b of grid[c].beetles) {
                    const dSq = (myAnt.x - b.x) ** 2 + (myAnt.y - b.y) ** 2;
                    if (dSq < viewDistSq) localState.beetles[b.id] = slimBeetle(b);
                }
            }

            // Broods and queens: iterate directly (fewer entities; also catches ones just spawned this tick, not in grid yet)
            for (let id in state.broods) {
                const b = state.broods[id];
                const dSq = (myAnt.x - b.x) ** 2 + (myAnt.y - b.y) ** 2;
                if (dSq < viewDistSq) localState.broods[id] = slimBrood(b);
            }
            for (let id in state.queens) {
                const q = state.queens[id];
                const dSq = (myAnt.x - q.x) ** 2 + (myAnt.y - q.y) ** 2;
                if (dSq < viewDistSq) localState.queens[id] = slimQueen(q);
            }

            io.to(p.id).emit('state', localState);
        }
}, 1000 / FPS);

function doAttack(attacker, range, explicitTarget = null) {
    attacker.attackCooldown = 20;
    
    let target = explicitTarget;
    if (!target) {
        const res = findClosestInGrid({ x: attacker.x, y: attacker.y }, ['beetles', 'ants', 'queens'], range, attacker.colonyId);
        target = res.obj;
    }

    if (target && target.id !== attacker.id) {
        if (!hasGameStarted && state.queens[target.id]) return;

        target.hp -= attacker.dmg;

        if (state.ants[target.id] || state.beetles[target.id]) {
            target.aggroTarget = attacker.id;
            target.aggroTimer = 60;
            if (state.ants[target.id]) {
                if (target.type === 'soldier') target.aggroTimer = Math.max(target.aggroTimer, 180);
                signalNearbyAllies(target, attacker);
            }
        }

        if (state.queens[target.id]) {
            triggerAlarm(target.colonyId, target.x, target.y, attacker.id, 800);
        }

        if (target.hp <= 0) {
            if (state.beetles[target.id]) {
                const amount = Math.floor(Math.random() * 4) + 3;
                for (let i = 0; i < amount; i++) {
                    const mId = getId();
                    state.meats[mId] = { id: mId, x: target.x + (Math.random() * 30 - 15), y: target.y + (Math.random() * 30 - 15) };
                }
                delete state.beetles[target.id];
            } else if (state.ants[target.id]) {
                handleAntDeath(target);
            } else if (state.queens[target.id]) {
                const p = Object.values(state.players).find(pl => pl.colonyId === target.colonyId);
                if (p && hasGameStarted) io.to(p.id).emit('gameOver', 'lose');
                delete state.queens[target.id];
                checkWinCondition();
                updateGameInfo();
            }
        }
    }
}

function handleAntDeath(ant) {
    if (ant.isPlayer) {
        const p = state.players[ant.playerId];
        let newAnt = null;
        if (p) {
            let myQueen = null;
            for (let qId in state.queens) {
                if (state.queens[qId].colonyId === p.colonyId) myQueen = state.queens[qId];
            }
            let bestDist = Infinity;
            for (let aId in state.ants) {
                const a = state.ants[aId];
                if (a.colonyId === p.colonyId && !a.isPlayer && a.id !== ant.id) {
                    if (myQueen) {
                        const d = dist(a.x, a.y, myQueen.x, myQueen.y);
                        if (d < bestDist) { bestDist = d; newAnt = a; }
                    } else {
                        newAnt = a; break;
                    }
                }
            }
            if (newAnt) { newAnt.isPlayer = true; newAnt.playerId = p.id; p.antId = newAnt.id; }
        }
    }
    delete state.ants[ant.id];
}

function spawnBrood(queen, type) {
    const id = getId();
    const angle = Math.random() * Math.PI * 2;
    const distance = 40 + Math.random() * 25;
    state.broods[id] = { id, colonyId: queen.colonyId, type, x: queen.x + Math.cos(angle) * distance, y: queen.y + Math.sin(angle) * distance, age: 0 };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
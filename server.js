const express = require('express');
const rockMaskData = require('./rock_mask.js');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));

app.post('/hibernate', (req, res) => {
    executeHibernation();
    res.json({ success: true, message: 'Hibernation triggered.' });
});

const state = { players: {}, colonies: {}, ants: {}, queens: {}, beetles: {}, foods: {}, meats: {}, broods: {}, aphids: {}, rocks: {} };
const connectedSockets = new Set();

let idCounter = 1;
const getId = () => (idCounter++).toString();

const MAP_SIZE = 3000;
const FPS = 25;
const MAX_ANTS_PER_COLONY = 800; // Hard cap so we don't accidentally lag out the engine forever
let hasGameStarted = false;
let simTick = 0;
let stateUpdateFrame = 0; // Frame counter for skipping updates when colonies are large

// Hibernation cycle
let hibernationWarningTime = null;
let hibernationStartTime = null;
let nextHibernationCycleStart = null;
const HIBERNATION_COOLDOWN_MIN = 120 * FPS; // 2 minutes in frames
const HIBERNATION_COOLDOWN_MAX = 240 * FPS; // 4 minutes in frames
const HIBERNATION_WARNING_TIME = 30 * FPS; // 30 seconds warning
const HIBERNATION_NEST_RADIUS = 300; // Ants within this distance of queen are safe

const MAX_APHIDS = 60;
const ROCK_COUNT_MIN = 5;
const ROCK_COUNT_MAX = 8;
const ROCK_SPAWN_CLEARANCE = 70;
const ROCK_COLLISION_PADDING = 0;

const COLORS = ['#3498db', '#9b59b6', '#e67e22', '#1abc9c', '#f1c40f', '#e84393'];
const FALLBACK_COLOR = '#808080';

function getTakenColors() {
    return new Set(Object.values(state.colonies).map(colony => colony.color));
}

function getAvailableColor(preferredColor = null) {
    const takenColors = getTakenColors();
    const normalizedPreferred = typeof preferredColor === 'string' ? preferredColor.toLowerCase() : null;

    if (normalizedPreferred && COLORS.includes(normalizedPreferred) && !takenColors.has(normalizedPreferred)) {
        return normalizedPreferred;
    }

    for (const color of COLORS) {
        if (!takenColors.has(color)) return color;
    }

    return FALLBACK_COLOR;
}

const dist = (x1, y1, x2, y2) => { const dx = x1 - x2; const dy = y1 - y2; return Math.sqrt(dx * dx + dy * dy); };
const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

// Spatial Hash Grid

const CELL_SIZE = 400;
const GRID_W = Math.ceil(MAP_SIZE / CELL_SIZE) + 1;

// Pre-allocate grid to completely eliminate GC for cell creation/destruction
const grid = new Array(GRID_W * GRID_W);
for (let i = 0; i < grid.length; i++) {
    grid[i] = { ants: [], foods: [], meats: [], broods: [], beetles: [], queens: [], aphids: [] };
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

function isAphidPositionFree(x, y, minDist = 24) {
    const minDistSq = minDist * minDist;
    const cells = getCellsInRange(x, y, minDist);
    for (const c of cells) {
        if (!grid[c]) continue;
        for (const aphid of grid[c].aphids) {
            const dx = x - aphid.x;
            const dy = y - aphid.y;
            if (dx * dx + dy * dy < minDistSq) return false;
        }
    }
    return true;
}

function getFreeAphidPosition(x, y, minDist = 24) {
    if (isAphidPositionFree(x, y, minDist) && isSpawnPositionClear(x, y, minDist + ROCK_SPAWN_CLEARANCE)) return { x, y };

    for (let i = 0; i < 12; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = minDist + Math.random() * minDist;
        const nx = clamp(x + Math.cos(angle) * distance, 0, MAP_SIZE);
        const ny = clamp(y + Math.sin(angle) * distance, 0, MAP_SIZE);
        if (isAphidPositionFree(nx, ny, minDist) && isSpawnPositionClear(nx, ny, minDist + ROCK_SPAWN_CLEARANCE)) return { x: nx, y: ny };
    }

    return { x, y };
}

function isSpawnPositionClear(x, y, buffer = ROCK_SPAWN_CLEARANCE) {
    const bufferSq = buffer * buffer;
    for (const rock of Object.values(state.rocks)) {
        const dx = x - rock.x;
        const dy = y - rock.y;
        const minDist = rock.radius + buffer;
        if (dx * dx + dy * dy < minDist * minDist) return false;
    }
    return true;
}

function getSpawnPosition(buffer = ROCK_SPAWN_CLEARANCE, maxAttempts = 60, margin = 80) {
    for (let i = 0; i < maxAttempts; i++) {
        const x = clamp(Math.random() * MAP_SIZE, margin, MAP_SIZE - margin);
        const y = clamp(Math.random() * MAP_SIZE, margin, MAP_SIZE - margin);
        if (isSpawnPositionClear(x, y, buffer)) return { x, y };
    }
    return {
        x: clamp(Math.random() * MAP_SIZE, margin, MAP_SIZE - margin),
        y: clamp(Math.random() * MAP_SIZE, margin, MAP_SIZE - margin)
    };
}

function getClearPositionNear(x, y, spread = 60, buffer = ROCK_SPAWN_CLEARANCE, attempts = 16) {
    for (let i = 0; i < attempts; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * spread;
        const nx = clamp(x + Math.cos(angle) * distance, 50, MAP_SIZE - 50);
        const ny = clamp(y + Math.sin(angle) * distance, 50, MAP_SIZE - 50);
        if (isSpawnPositionClear(nx, ny, buffer)) return { x: nx, y: ny };
    }
    return getSpawnPosition(buffer);
}

function spawnRocks() {
    const targetCount = ROCK_COUNT_MIN + Math.floor(Math.random() * (ROCK_COUNT_MAX - ROCK_COUNT_MIN + 1));
    const rocks = [];

    for (let i = 0; i < targetCount; i++) {
        let placed = false;
        for (let attempt = 0; attempt < 80 && !placed; attempt++) {
            const radius = 110 + Math.random() * 70;
            const x = clamp(120 + Math.random() * (MAP_SIZE - 240), 120, MAP_SIZE - 120);
            const y = clamp(120 + Math.random() * (MAP_SIZE - 240), 120, MAP_SIZE - 120);

            let valid = true;
            for (const rock of rocks) {
                const dx = x - rock.x;
                const dy = y - rock.y;
                const minDist = radius + rock.radius + ROCK_SPAWN_CLEARANCE;
                if (dx * dx + dy * dy < minDist * minDist) {
                    valid = false;
                    break;
                }
            }

            if (!valid) continue;

            const id = getId();
            const rock = { id, x, y, radius };
            rocks.push(rock);
            state.rocks[id] = rock;
            placed = true;
        }
    }
}

spawnRocks();

function buildGrid() {
    for (let i = 0; i < grid.length; i++) {
        const cell = grid[i];
        cell.ants.length = 0;
        cell.foods.length = 0;
        cell.meats.length = 0;
        cell.broods.length = 0;
        cell.beetles.length = 0;
        cell.queens.length = 0;
        cell.aphids.length = 0;
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
    for (let id in state.aphids)  addToGrid(state.aphids[id], 'aphids');
}

function resolveRockCollision(entity, prevX, prevY, radius = 18) {
    for (const rock of Object.values(state.rocks)) {
        const scale = (rock.radius * 2) / rockMaskData.width;
        const maskW = rockMaskData.width;
        const maskH = rockMaskData.height;

        // Compute entity bounding box in world coords and map to mask coords
        const ex0 = entity.x - radius;
        const ey0 = entity.y - radius;
        const ex1 = entity.x + radius;
        const ey1 = entity.y + radius;

        const mx0 = Math.floor((ex0 - (rock.x - rock.radius)) / scale);
        const my0 = Math.floor((ey0 - (rock.y - rock.radius)) / scale);
        const mx1 = Math.floor((ex1 - (rock.x - rock.radius)) / scale);
        const my1 = Math.floor((ey1 - (rock.y - rock.radius)) / scale);

        // Quick reject if bbox doesn't overlap mask bounds
        if (mx1 < 0 || my1 < 0 || mx0 >= maskW || my0 >= maskH) continue;

        // Clamp to mask
        const cx0 = Math.max(0, mx0);
        const cy0 = Math.max(0, my0);
        const cx1 = Math.min(maskW - 1, mx1);
        const cy1 = Math.min(maskH - 1, my1);

        // Fast rectangle check using prefix-sum mask
        if (!rockMaskData.isAreaSolid(cx0, cy0, cx1, cy1)) continue;

        // Check previous position; if it was clear, snap back to prev
        const pex0 = prevX - radius;
        const pey0 = prevY - radius;
        const pex1 = prevX + radius;
        const pey1 = prevY + radius;
        const pmx0 = Math.floor((pex0 - (rock.x - rock.radius)) / scale);
        const pmy0 = Math.floor((pey0 - (rock.y - rock.radius)) / scale);
        const pmx1 = Math.floor((pex1 - (rock.x - rock.radius)) / scale);
        const pmy1 = Math.floor((pey1 - (rock.y - rock.radius)) / scale);
        if (pmx1 < 0 || pmy1 < 0 || pmx0 >= maskW || pmy0 >= maskH) {
            entity.x = prevX;
            entity.y = prevY;
            continue;
        }
        const pcx0 = Math.max(0, pmx0);
        const pcy0 = Math.max(0, pmy0);
        const pcx1 = Math.min(maskW - 1, pmx1);
        const pcy1 = Math.min(maskH - 1, pmy1);
        if (!rockMaskData.isAreaSolid(pcx0, pcy0, pcx1, pcy1)) {
            entity.x = prevX;
            entity.y = prevY;
            continue;
        }

        // Collision persists: resolve by sliding for workers or radial push for others
        const dx = entity.x - rock.x;
        const dy = entity.y - rock.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        if (entity.type === 'worker') {
            const nx = dx / len;
            const ny = dy / len;
            let tx = -ny;
            let ty = nx;
            const prevRelX = prevX - rock.x;
            const prevRelY = prevY - rock.y;
            const dot = prevRelX * tx + prevRelY * ty;
            if (dot < 0) { tx = -tx; ty = -ty; }
            const slide = Math.max(12, radius);
            entity.x = rock.x + nx * (rock.radius + radius + 1) + tx * slide;
            entity.y = rock.y + ny * (rock.radius + radius + 1) + ty * slide;
        } else {
            entity.x = rock.x + (dx / len) * (rock.radius + radius + 1);
            entity.y = rock.y + (dy / len) * (rock.radius + radius + 1);
        }
    }
}

function worldToRockMaskCoords(rock, x, y) {
    const scale = (rock.radius * 2) / rockMaskData.width;
    return {
        lx: Math.floor((x - (rock.x - rock.radius)) / scale),
        ly: Math.floor((y - (rock.y - rock.radius)) / scale)
    };
}

function isPointInRockMask(rock, x, y) {
    const { lx, ly } = worldToRockMaskCoords(rock, x, y);
    if (lx < 0 || ly < 0 || lx >= rockMaskData.width || ly >= rockMaskData.height) return false;
    return rockMaskData.mask[lx + ly * rockMaskData.width] === 1;
}

function lineIntersectsRock(rock, x0, y0, x1, y1) {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    if (maxX < rock.x - rock.radius || minX > rock.x + rock.radius || maxY < rock.y - rock.radius || minY > rock.y + rock.radius) {
        return false;
    }

    const dx = x1 - x0;
    const dy = y1 - y0;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(2, Math.ceil(distance / 20));
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const px = x0 + dx * t;
        const py = y0 + dy * t;
        if (isPointInRockMask(rock, px, py)) return true;
    }
    return false;
}

function findBlockingRock(x0, y0, x1, y1) {
    let closestRock = null;
    let closestDist = Infinity;
    for (const rock of Object.values(state.rocks)) {
        const minX = Math.min(x0, x1);
        const maxX = Math.max(x0, x1);
        const minY = Math.min(y0, y1);
        const maxY = Math.max(y0, y1);
        if (maxX < rock.x - rock.radius - 20 || minX > rock.x + rock.radius + 20 || maxY < rock.y - rock.radius - 20 || minY > rock.y + rock.radius + 20) {
            continue;
        }
        if (!lineIntersectsRock(rock, x0, y0, x1, y1)) continue;
        const d = Math.hypot(rock.x - x0, rock.y - y0);
        if (d < closestDist) {
            closestDist = d;
            closestRock = rock;
        }
    }
    return closestRock;
}

function computeRockAvoidancePoint(rock, ant, tx, ty, radius) {
    const baseAngle = Math.atan2(ant.y - rock.y, ant.x - rock.x);
    const perp = Math.PI / 2;
    const avoidDistance = rock.radius + radius + 24;

    const angleToTarget = Math.atan2(ty - rock.y, tx - rock.x);
    const side = Math.sign(Math.sin(angleToTarget - baseAngle)) || 1;
    const avoidAngle = baseAngle + perp * side;
    const px = rock.x + Math.cos(avoidAngle) * avoidDistance;
    const py = rock.y + Math.sin(avoidAngle) * avoidDistance;
    if (px >= 0 && py >= 0 && px <= MAP_SIZE && py <= MAP_SIZE) {
        return { x: px, y: py };
    }
    const altAngle = baseAngle + perp * -side;
    return { x: rock.x + Math.cos(altAngle) * avoidDistance, y: rock.y + Math.sin(altAngle) * avoidDistance };
    return {
        x: rock.x + Math.cos(fallbackAngle) * avoidDistance,
        y: rock.y + Math.sin(fallbackAngle) * avoidDistance
    };
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

function findSuperSoldierDefenseTarget(soldier) {
    const hostile = findClosestInGrid(soldier, ['ants', 'beetles', 'queens'], 700, soldier.colonyId).obj;
    if (!hostile) return null;

    const friendly = findClosestFriendlyEntity(hostile, 220, soldier.colonyId, ['broods', 'queens']).obj;
    if (!friendly) return null;

    const dx = friendly.x - hostile.x;
    const dy = friendly.y - hostile.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const protectedLimit = state.queens[friendly.id] ? 230 : 180;
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
const slimFood   = f => ({ id: f.id, x: Math.round(f.x), y: Math.round(f.y), foodType: f.foodType || 'normal' });
const slimMeat   = m => ({ id: m.id, x: Math.round(m.x), y: Math.round(m.y) });
const BROOD_EGG_FRAMES = 10 * FPS;
const BROOD_LARVA_FRAMES = 30 * FPS;
const BROOD_PUPA_FRAMES = 20 * FPS;
function getBroodStage(brood) {
    const eggDuration = brood.eggDuration ?? BROOD_EGG_FRAMES;
    const larvaDuration = brood.larvaDuration ?? BROOD_LARVA_FRAMES;
    if (brood.hatchTimer < eggDuration) return 'egg';
    if (brood.hatchTimer < eggDuration + larvaDuration) return 'larva';
    return 'pupa';
}
function getBroodTotalDuration(brood) {
    return (brood.eggDuration ?? BROOD_EGG_FRAMES)
         + (brood.larvaDuration ?? BROOD_LARVA_FRAMES)
         + (brood.pupaDuration ?? BROOD_PUPA_FRAMES);
}
const slimBrood  = b => ({
    id: b.id,
    colonyId: b.colonyId,
    type: b.type,
    x: Math.round(b.x),
    y: Math.round(b.y),
    hatchTimer: b.hatchTimer || 0,
    stage: getBroodStage(b)
});
const slimQueen  = q => ({ id: q.id, colonyId: q.colonyId, x: Math.round(q.x), y: Math.round(q.y), angle: Math.round(q.angle * 100)/100, hp: q.hp, food: q.food, meat: q.meat, honeyFed: q.honeyFed || 0 });

const slimAphid   = a => ({ id: a.id, x: Math.round(a.x), y: Math.round(a.y) });
const slimRock    = r => ({ id: r.id, x: Math.round(r.x), y: Math.round(r.y), radius: Math.round(r.radius) });

function spawnFood() {
    // FIX: Single-pass diff fill, no tight while loop
    const current = Object.keys(state.foods).length;
    if (current >= 400) return;
    for (let i = current; i < 400; i++) {
        const id = getId();
        const pos = getSpawnPosition(ROCK_SPAWN_CLEARANCE, 20, 40);
        state.foods[id] = { id, x: pos.x, y: pos.y };
    }
}

function spawnBeetle() {
    if (Object.keys(state.beetles).length < 25) {
        const id = getId();
        const pos = getSpawnPosition(ROCK_SPAWN_CLEARANCE, 20, 60);
        state.beetles[id] = {
            id, x: pos.x, y: pos.y,
            hp: 50, tx: Math.random() * MAP_SIZE, ty: Math.random() * MAP_SIZE,
            angle: 0, aggroTarget: null, aggroTimer: 0, attackCooldown: 0
        };
    }
}

function spawnAphid() {
    const current = Object.keys(state.aphids).length;
    if (current >= MAX_APHIDS) return;
    // Spawn aphid colonies with 10 aphids per colony
    const coloniesNeeded = Math.ceil((MAX_APHIDS - current) / 10);
    if (coloniesNeeded <= 0) return;
    // Create aphid colonies: pick a center and spawn 10 aphids around it
    for (let c = 0; c < coloniesNeeded; c++) {
        if (Object.keys(state.aphids).length >= MAX_APHIDS) break;
        const center = getSpawnPosition(ROCK_SPAWN_CLEARANCE, 40, 100);
        const centerX = center.x;
        const centerY = center.y;
        // One aphid at center
        for (let a = 0; a < 1; a++) {
            const id = getId();
            const pos = getFreeAphidPosition(centerX, centerY);
            state.aphids[id] = {
                id, x: pos.x, y: pos.y,
                honeyTimer: 0, lastFedTick: 0,
                reproduceTimer: Math.floor((30 + Math.random() * 30) * FPS),
                colonyId: centerX + '_' + centerY  // Mark colony membership
            };
        }
        // 9 aphids around it at varying distances
        for (let a = 1; a < 10; a++) {
            if (Object.keys(state.aphids).length >= MAX_APHIDS) break;
            const angle = (a / 9) * Math.PI * 2;
            const distance = 30 + Math.random() * 40;  // 30-70 units away
            const id = getId();
            const targetX = clamp(centerX + Math.cos(angle) * distance, 0, MAP_SIZE);
            const targetY = clamp(centerY + Math.sin(angle) * distance, 0, MAP_SIZE);
            const pos = getFreeAphidPosition(targetX, targetY);
            state.aphids[id] = {
                id,
                x: pos.x,
                y: pos.y,
                honeyTimer: 0,
                lastFedTick: 0,
                reproduceTimer: Math.floor((30 + Math.random() * 30) * FPS),
                colonyId: centerX + '_' + centerY
            };
        }
    }
}

function createColony(playerId, preferredColor = null) {
    const colId = getId();
    state.colonies[colId] = { id: colId, color: getAvailableColor(preferredColor), command: 'forage', guardX: null, guardY: null };

    let qx, qy, valid = false;
    let spawn_attempts = 0;
    while (!valid && spawn_attempts < 100) {
        spawn_attempts++;
        const pos = getSpawnPosition(ROCK_SPAWN_CLEARANCE + 20, 30, 300);
        qx = pos.x;
        qy = pos.y;
        valid = true;
        for (let id in state.queens) {
            if (dist(qx, qy, state.queens[id].x, state.queens[id].y) < 1000) { valid = false; break; }
        }
    }
    if (!valid) {
        console.warn('Could not find valid queen spawn position after 100 attempts; using emergency spawn');
        qx = clamp(Math.random() * MAP_SIZE, 300, MAP_SIZE - 300);
        qy = clamp(Math.random() * MAP_SIZE, 300, MAP_SIZE - 300);
    }

    const queenId = getId();
    state.queens[queenId] = { id: queenId, colonyId: colId, x: qx, y: qy, hp: 100, food: 0, meat: 0, angle: 0 };
    state.colonies[colId].guardX = qx;
    state.colonies[colId].guardY = qy;

    let firstWorkerId = null;
    for (let i = 0; i < 10; i++) {
        const antId = getId();
        if (i === 0) firstWorkerId = antId;
        const pos = getClearPositionNear(qx, qy, 30, ROCK_SPAWN_CLEARANCE + 20);
        state.ants[antId] = {
            id: antId, colonyId: colId, type: 'worker',
            x: pos.x, y: pos.y, angle: 0,
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
    const playersCount = connectedSockets.size;
    if (hasGameStarted) io.emit('gameInfo', `Battle in progress! Queens remaining: ${Object.keys(state.queens).length}`);
    else io.emit('gameInfo', `Waiting for opponents... (${playersCount}/2)`);
}

function emitLobbyState() {
    io.emit('lobbyState', {
        takenColors: Object.values(state.colonies).map(colony => colony.color)
    });
}

function resetMatchState() {
    state.players = {};
    state.colonies = {};
    state.ants = {};
    state.queens = {};
    state.beetles = {};
    state.foods = {};
    state.meats = {};
    state.broods = {};
    state.aphids = {};
    hasGameStarted = false;
    hibernationWarningTime = null;
    hibernationStartTime = null;
    nextHibernationCycleStart = null;
    updateGameInfo();
    emitLobbyState();
}

function startHibernationCycle() {
    const cycleLength = HIBERNATION_COOLDOWN_MIN + Math.floor(Math.random() * (HIBERNATION_COOLDOWN_MAX - HIBERNATION_COOLDOWN_MIN));
    hibernationWarningTime = simTick + cycleLength;
    nextHibernationCycleStart = hibernationWarningTime + HIBERNATION_WARNING_TIME;
}

function executeHibernation() {
    const frozenAntsByColony = {};
    
    // Kill ants outside nest radius from queen
    for (let id in state.ants) {
        const ant = state.ants[id];
        const queen = Object.values(state.queens).find(q => q.colonyId === ant.colonyId);
        
        if (queen) {
            const distToQueen = dist(ant.x, ant.y, queen.x, queen.y);
            if (distToQueen > HIBERNATION_NEST_RADIUS) {
                frozenAntsByColony[ant.colonyId] = (frozenAntsByColony[ant.colonyId] || 0) + 1;
                handleAntDeath(ant);
                delete state.ants[id];
            }
        }
    }
    
    // Clear all broods
    state.broods = {};
    
    // Send hibernation results to each player
    for (let playerId in state.players) {
        const player = state.players[playerId];
        const frozenCount = frozenAntsByColony[player.colonyId] || 0;
        io.to(playerId).emit('hibernationResult', {
            survived: true,
            frozenCount: frozenCount
        });
    }
    
    // Reset for next cycle
    hibernationWarningTime = null;
    hibernationStartTime = null;
    startHibernationCycle();
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
        setTimeout(resetMatchState, 100);
    }
}

io.on('connection', socket => {
    connectedSockets.add(socket.id);
    socket.emit('init', socket.id);
    io.emit('playerCount', connectedSockets.size);
    emitLobbyState();
    updateGameInfo();

    socket.on('joinGame', data => {
        if (state.players[socket.id]) return;

        const preferredColor = data && typeof data.color === 'string' ? data.color : null;
        const { colId, firstWorkerId } = createColony(socket.id, preferredColor);
        state.players[socket.id] = {
            id: socket.id,
            name: data && typeof data.name === 'string' ? data.name : 'Colony',
            colonyId: colId,
            antId: firstWorkerId,
            inputs: { keys: {}, mouseX: 0, mouseY: 0, clicking: false }
        };
        socket.data.joinedGame = true;
        socket.data.colonyId = colId;

        if (Object.keys(state.players).length >= 2) {
            hasGameStarted = true;
            startHibernationCycle();
        }

        io.emit('playerCount', connectedSockets.size);
        emitLobbyState();
        updateGameInfo();
    });

    socket.on('input', data => { if (state.players[socket.id]) state.players[socket.id].inputs = data; });
    socket.on('double_click', data => {
        const p = state.players[socket.id];
        if (!p) return;
        const ant = state.ants[p.antId];
        if (!ant) return;
        if (!ant.carrying) return;
        // Drop in front of ant, not at cursor
        const dropDist = 30;
        const x = ant.x + Math.cos(ant.angle) * dropDist;
        const y = ant.y + Math.sin(ant.angle) * dropDist;

        if (ant.carrying === 'food' || ant.carrying === 'honey') {
            const id = getId();
            const pos = getClearPositionNear(clamp(x, 0, MAP_SIZE), clamp(y, 0, MAP_SIZE), 20, ROCK_SPAWN_CLEARANCE);
            state.foods[id] = { id, x: pos.x, y: pos.y, foodType: ant.carrying === 'honey' ? 'honey' : 'normal' };
        } else if (ant.carrying === 'meat') {
            const id = getId();
            const pos = getClearPositionNear(clamp(x, 0, MAP_SIZE), clamp(y, 0, MAP_SIZE), 20, ROCK_SPAWN_CLEARANCE);
            state.meats[id] = { id, x: pos.x, y: pos.y };
        } else if (ant.carrying === 'aphid') {
            // Re-place the carried aphid where dropped (in front of ant)
            if (ant.carriedAphid) {
                const aid = ant.carriedAphid.id;
                const pos = getFreeAphidPosition(clamp(x, 0, MAP_SIZE), clamp(y, 0, MAP_SIZE));
                state.aphids[aid] = ant.carriedAphid;
                state.aphids[aid].x = pos.x;
                state.aphids[aid].y = pos.y;
                state.aphids[aid].honeyTimer = state.aphids[aid].honeyTimer || 0;
                state.aphids[aid].lastFedTick = state.aphids[aid].lastFedTick || simTick;
                state.aphids[aid].reproduceTimer = state.aphids[aid].reproduceTimer || Math.floor((30 + Math.random() * 30) * FPS);
                state.aphids[aid].lastDroppedTick = simTick; // Add cooldown after drop
                delete ant.carriedAphid;
            } else {
                const id = getId();
                const pos = getFreeAphidPosition(clamp(x, 0, MAP_SIZE), clamp(y, 0, MAP_SIZE));
                state.aphids[id] = { id, x: pos.x, y: pos.y, honeyTimer: 0, lastFedTick: simTick, reproduceTimer: Math.floor((30 + Math.random() * 30) * FPS), lastDroppedTick: simTick };
            }
        }
        ant.carrying = null;
    });
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
        connectedSockets.delete(socket.id);
        const p = state.players[socket.id];
        if (p) {
            for (let aId in state.ants)   { if (state.ants[aId].colonyId   === p.colonyId) delete state.ants[aId]; }
            for (let qId in state.queens)  { if (state.queens[qId].colonyId  === p.colonyId) delete state.queens[qId]; }
            for (let bId in state.broods)  { if (state.broods[bId].colonyId  === p.colonyId) delete state.broods[bId]; }
            delete state.colonies[p.colonyId];
            delete state.players[socket.id];
            checkWinCondition();
        }

        io.emit('playerCount', connectedSockets.size);
        emitLobbyState();
        updateGameInfo();
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
                }
                if ((p.inputs.clicking || p.inputs.keys.space) && ant.attackCooldown <= 0) doAttack(ant, 50);
            }
        } else {
            let isAggroed = false;

            let defense = null;
            if (ant.type === 'soldier') {
                defense = findSoldierDefenseTarget(ant);
            } else if (ant.type === 'super_soldier') {
                defense = findSuperSoldierDefenseTarget(ant);
            }
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

            if (!isAggroed && ant.assistTarget && ant.assistTimer > 0 && ant.type !== 'super_soldier') {
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
                }
            } else if (ant.assistTimer <= 0) {
                ant.assistTarget = null;
                ant.assistPriority = 0;
            }

            // HOME COMMAND OVERRIDE: All ants go home immediately, no matter what
            if (col.command === 'home') {
                if (queen) {
                    tx = queen.x;
                    ty = queen.y;
                    ant.aggroTarget = null;
                    ant.aggroTimer = 0;
                    ant.assistTarget = null;
                    ant.assistTimer = 0;
                    ant.targetId = null;
                    ant.targetDict = null;
                    ant.carryMode = false;
                    ant.wanderX = null;
                    ant.wanderY = null;
                    // Soldiers and workers drop carried items at home
                    if (ant.type !== 'super_soldier' && ant.carrying) {
                        ant.carrying = null;
                        ant.carriedAphidId = null;
                    }
                }
            } else if (!isAggroed && queen) {
                let currentTarget = (ant.targetId && ant.targetDict && state[ant.targetDict] && state[ant.targetDict][ant.targetId])
                    ? state[ant.targetDict][ant.targetId] : null;

                if (col.command === 'forage') {
                    if ((ant.carryMode || ant.carrying === 'aphid') && queen) {
                            // If we entered carryMode at pickup, head to queen and drop when close.
                            ant.targetId = null;
                            ant.targetDict = null;
                            ant.wanderX = null;
                            ant.wanderY = null;
                            const distToQueen = dist(ant.x, ant.y, queen.x, queen.y);
                            const dropDist = ant.carryDropDistance || 240;
                            if (distToQueen > dropDist) {
                                tx = queen.x; ty = queen.y;
                            } else {
                                // Drop immediately when within dropDist
                                if (ant.carriedAphidId) {
                                    const pos = getFreeAphidPosition(ant.x, ant.y);
                                    const aphid = {
                                        id: ant.carriedAphidId,
                                        x: pos.x,
                                        y: pos.y,
                                        honeyTimer: 0,
                                        lastFedTick: simTick,
                                        reproduceTimer: Math.floor((30 + Math.random() * 30) * FPS),
                                        colonyId: ant.colonyId,
                                        lastDroppedTick: simTick
                                    };
                                    state.aphids[ant.carriedAphidId] = aphid;
                                    console.log(`Ant ${ant.id} dropped aphid ${ant.carriedAphidId} near queen ${queen.id} at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`);
                                }
                                ant.carriedAphidId = null;
                                ant.carrying = null;
                                ant.carryMode = false;
                                ant.carryDropDistance = null;
                                ant.carryTargetQueenId = null;
                            }
                    } else if (ant.type === 'super_soldier') {
                        if (!ant.guardPointX || !ant.guardPointY || dist(ant.guardPointX, ant.guardPointY, queen.x, queen.y) > 260) {
                            const angle = (parseInt(ant.id, 10) % 12) * (Math.PI * 2 / 12);
                            const guardDist = 150 + (parseInt(ant.id, 10) % 50);
                            ant.guardPointX = queen.x + Math.cos(angle) * guardDist;
                            ant.guardPointY = queen.y + Math.sin(angle) * guardDist;
                        }
                        const distToGuard = dist(ant.x, ant.y, ant.guardPointX, ant.guardPointY);
                        if (distToGuard > 20) {
                            const dx = ant.guardPointX - ant.x;
                            const dy = ant.guardPointY - ant.y;
                            const len = Math.sqrt(dx * dx + dy * dy);
                            if (len > 0.001) {
                                tx = ant.x + (dx / len) * ant.speed;
                                ty = ant.y + (dy / len) * ant.speed;
                            }
                        } else {
                            tx = ant.guardPointX + (Math.random() * 40 - 20);
                            ty = ant.guardPointY + (Math.random() * 40 - 20);
                        }
                    } else if (!ant.carrying) {
                        if (!currentTarget || ant.searchTimer <= 0) {
                            // Prioritize honey over normal food. If no honey/food, take meat.
                            let res = null;
                            let bestHoney = null;
                            let bestHoneyDist = 900;
                            // Look for honey in foods
                            const foodRes = findClosestInGrid(ant, ['foods'], 900);
                            if (foodRes.obj) {
                                if (foodRes.obj.foodType === 'honey') {
                                    const d = dist(ant.x, ant.y, foodRes.obj.x, foodRes.obj.y);
                                    if (d < bestHoneyDist) {
                                        bestHoney = foodRes.obj;
                                        bestHoneyDist = d;
                                        res = foodRes;
                                    }
                                } else {
                                    // Found normal food, but still look for honey
                                    res = foodRes;
                                }
                            }
                            // If no food found, look for meat
                            if (!res) {
                                res = findClosestInGrid(ant, ['meats'], 900);
                            }
                            // Prefer honey to normal food if honey is available
                            if (bestHoney) {
                                res = { obj: bestHoney, dictName: 'foods' };
                            }
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
                    } else if (ant.carrying !== 'aphid') {
                        // If carrying anything other than aphid, deliver to queen
                        if (queen) { tx = queen.x; ty = queen.y; }
                    }
                    // If carrying aphid, the aphid handling code below will position it near queen
                }
                else if (col.command === 'guard_home') {
                    if (ant.type === 'super_soldier') {
                        // Super soldiers patrol around queen in guard_home mode
                        if (!ant.guardPointX) {
                            const angle = (parseInt(ant.id, 10) % 12) * (Math.PI * 2 / 12);
                            const guardDist = 150 + (parseInt(ant.id, 10) % 50);
                            ant.guardPointX = queen.x + Math.cos(angle) * guardDist;
                            ant.guardPointY = queen.y + Math.sin(angle) * guardDist;
                        }
                        const distToGuard = dist(ant.x, ant.y, ant.guardPointX, ant.guardPointY);
                        if (distToGuard > 20) {
                            const dx = ant.guardPointX - ant.x;
                            const dy = ant.guardPointY - ant.y;
                            const len = Math.sqrt(dx * dx + dy * dy);
                            if (len > 0.001) {
                                tx = ant.x + (dx / len) * ant.speed;
                                ty = ant.y + (dy / len) * ant.speed;
                            }
                        } else {
                            tx = ant.guardPointX + (Math.random() * 40 - 20);
                            ty = ant.guardPointY + (Math.random() * 40 - 20);
                        }
                        // Guard nearby enemies
                        const nearbyHostile = findClosestInGrid(ant, ['ants', 'beetles'], 200, ant.colonyId).obj;
                        if (nearbyHostile) {
                            ant.aggroTarget = nearbyHostile.id;
                            ant.aggroTimer = 120;
                            tx = nearbyHostile.x;
                            ty = nearbyHostile.y;
                        }
                    } else if ((ant.x - queen.x)**2 + (ant.y - queen.y)**2 > 22500) { // 150^2 = 22500
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
                    } else if (ant.type === 'soldier' || ant.type === 'super_soldier') {
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

            // Rock avoidance: if the direct path is blocked, route around the nearest rock. Only check every 4 frames to save CPU.
            if (!ant.isPlayer) {
                if (ant.avoidRock) {
                    const keepAvoiding = !(dist(ant.x, ant.y, ant.avoidRock.x, ant.avoidRock.y) < 12 || simTick - ant.avoidRock.createdAt > 60);
                    if (keepAvoiding) {
                        tx = ant.avoidRock.x;
                        ty = ant.avoidRock.y;
                    } else {
                        ant.avoidRock = null;
                    }
                }

                if (!ant.avoidRock && dist(ant.x, ant.y, tx, ty) > 5 && ((parseInt(ant.id, 10) + simTick) % 4 === 0)) {
                    const blockingRock = findBlockingRock(ant.x, ant.y, tx, ty);
                    if (blockingRock) {
                        const avoidPoint = computeRockAvoidancePoint(blockingRock, ant, tx, ty, ant.type === 'soldier' ? 18 : (ant.type === 'super_soldier' ? 22 : 12));
                        ant.avoidRock = { x: avoidPoint.x, y: avoidPoint.y, rockId: blockingRock.id, createdAt: simTick };
                        tx = avoidPoint.x;
                        ty = avoidPoint.y;
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

        const prevX = ant.x;
        const prevY = ant.y;
        ant.x = clamp(tx, 0, MAP_SIZE);
        ant.y = clamp(ty, 0, MAP_SIZE);
        resolveRockCollision(ant, prevX, prevY, ant.type === 'soldier' ? 18 : (ant.type === 'super_soldier' ? 22 : 12));

        // Pick up food/meat; all ants (except super_soldiers) can pick up aphids
        if (!ant.carrying && ant.type !== 'super_soldier') {
            const types = ['foods', 'meats', 'aphids'];
            const res = findClosestInGrid(ant, types, 20);
            let item = res.obj;
            // If it's an aphid, check lastDroppedTick cooldown
            if (item && res.dictName === 'aphids' && item.lastDroppedTick !== undefined && simTick - item.lastDroppedTick < 20) {
                item = null; // Ignore recently dropped aphids
            }
            if (item) {
                if (res.dictName === 'foods') {
                    // Prioritize honey, then normal food
                    ant.carrying = item.foodType === 'honey' ? 'honey' : 'food';
                    delete state.foods[item.id];
                } else if (res.dictName === 'meats') {
                    ant.carrying = 'meat';
                    delete state.meats[item.id];
                } else if (res.dictName === 'aphids') {
                    // All non-super soldiers can pick up aphids
                    ant.carrying = 'aphid';
                    ant.carriedAphidId = item.id; // store the aphid ID
                    ant.aphidPickupTime = simTick; // track when we picked it up
                    // Enter carry mode: head straight for queen and drop when close
                    ant.carryMode = true;
                    ant.carryDropDistance = 240; // drop within this distance to queen
                    ant.carryTargetQueenId = queen ? queen.id : null;
                    console.log(`Ant ${ant.id} picked up aphid ${item.id} at (${ant.x.toFixed(1)}, ${ant.y.toFixed(1)})`);
                    delete state.aphids[item.id];
                }
                ant.targetId = null; ant.targetDict = null;
            }
        }

        // Deliver to queen
        if (ant.carrying && queen && dist(ant.x, ant.y, queen.x, queen.y) < 40) {
            if (ant.carrying === 'food') queen.food++;
            if (ant.carrying === 'meat') queen.meat++;
            if (ant.carrying === 'honey') { queen.food++; queen.honeyFed = (queen.honeyFed || 0) + 1; }
            // Do NOT auto-deliver aphids at the queen. Keep carrying aphids so
            // the aphid-drop logic later can place them at an optimal distance.
            if (ant.carrying !== 'aphid') {
                ant.carrying = null;
                ant.targetId = null; ant.targetDict = null;
                ant.searchTimer = 0; // FIX: Immediately resume foraging after delivery
            }
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
    
    // ─── HIBERNATION CYCLE ───
    if (hasGameStarted) {
        if (nextHibernationCycleStart === null) {
            startHibernationCycle();
        }
        
        // 30 seconds before hibernation: send warning
        if (hibernationWarningTime !== null && simTick === hibernationWarningTime) {
            io.emit('hibernationWarning', {
                timeUntilHibernation: 30
            });
        }
        
        // Execute hibernation
        if (nextHibernationCycleStart !== null && simTick >= nextHibernationCycleStart) {
            executeHibernation();
        }
    }
    
    spawnFood();
    spawnBeetle();
    spawnAphid();
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

        // Beetles will eat aphids if close
        if (b.attackCooldown <= 0) {
            const aphRes = findClosestInGrid(b, ['aphids'], 30);
            const aph = aphRes.obj;
            if (aph) {
                // Beetle eats the aphid in one bite
                b.attackCooldown = 40;
                // Alert nearby soldiers to defend the area
                const cells = getCellsInRange(aph.x, aph.y, 700);
                for (const c of cells) {
                    if (!grid[c]) continue;
                    for (const ant of grid[c].ants) {
                        if (ant.type === 'soldier' || ant.type === 'super_soldier') {
                            ant.aggroTarget = b.id;
                            ant.aggroTimer = 180;
                        }
                    }
                }
                // Aphid dies from the bite
                delete state.aphids[aph.id];
            }
        }

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
        const prevX = b.x;
        const prevY = b.y;
        b.angle = Math.atan2(b.ty - b.y, b.tx - b.x);
        b.x += Math.cos(b.angle) * 1.5;
        b.y += Math.sin(b.angle) * 1.5;
        resolveRockCollision(b, prevX, prevY, 22);
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
        const q = state.queens[qId];``
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
            // SPECIAL: If queen has been fed 10 honeydew, lay a SUPER_SOLDIER egg
            if ((q.honeyFed || 0) >= 10 && pop < MAX_ANTS_PER_COLONY) {
                q.honeyFed -= 10;
                spawnBrood(q, 'super_soldier');
            }
        }
    }

    // ─── Aphid Loop: produce honeydew if recently fed ───
    for (let aId in state.aphids) {
        const a = state.aphids[aId];
        if (a.honeyTimer === undefined) a.honeyTimer = 0;
        if (a.lastFedTick === undefined) a.lastFedTick = 0;
        if (a.reproduceTimer === undefined) a.reproduceTimer = Math.floor((30 + Math.random() * 30) * FPS);
        // Reproduction countdown
        if (a.reproduceTimer > 0) a.reproduceTimer--;
        if (a.reproduceTimer <= 0) {
            // Attempt to reproduce (duplicate) if under global cap
            const current = Object.keys(state.aphids).length;
            if (current < MAX_APHIDS) {
                const nid = getId();
                const angle = Math.random() * Math.PI * 2;
                const distAway = 30 + Math.random() * 30; // 30-60 seconds spatial offset
                const targetX = clamp(a.x + Math.cos(angle) * distAway, 0, MAP_SIZE);
                const targetY = clamp(a.y + Math.sin(angle) * distAway, 0, MAP_SIZE);
                const pos = getFreeAphidPosition(targetX, targetY);
                state.aphids[nid] = { id: nid, x: pos.x, y: pos.y, honeyTimer: 0, lastFedTick: 0, reproduceTimer: Math.floor((30 + Math.random() * 30) * FPS) };
            }
            // reset parent timer regardless
            a.reproduceTimer = Math.floor((30 + Math.random() * 30) * FPS);
        }
        // If there's food dropped near the aphid, consume it and reset feed timer
        const nearbyFood = findClosestInGrid(a, ['foods'], 20).obj;
        if (nearbyFood) {
            // consume the food and mark as fed
            if (state.foods[nearbyFood.id]) delete state.foods[nearbyFood.id];
            a.lastFedTick = simTick;
            a.honeyTimer = 0;
            continue;
        }
        // Only produce if fed within the last 15 seconds
        if (simTick - a.lastFedTick <= 15 * FPS) {
            if (++a.honeyTimer >= 10 * FPS) {
                a.honeyTimer = 0;
                const fId = getId();
                const ang = Math.random() * Math.PI * 2;
                const distance = 40 + Math.random() * 20; // drop honey 40-60 units away so ants can pick honey, not the aphid
                const fx = clamp(a.x + Math.cos(ang) * distance, 0, MAP_SIZE);
                const fy = clamp(a.y + Math.sin(ang) * distance, 0, MAP_SIZE);
                const dropPos = getClearPositionNear(fx, fy, 20, ROCK_SPAWN_CLEARANCE);
                state.foods[fId] = { id: fId, x: dropPos.x, y: dropPos.y, foodType: 'honey' };
            }
        }
    }

    // ─── Brood Hatching ───
    for (let bId in state.broods) {
        const b = state.broods[bId];
        // Initialize hatchTimer if not present (framebased counter = more efficient than age += 1/FPS)
        if (b.hatchTimer === undefined) b.hatchTimer = 0;
        if (++b.hatchTimer >= getBroodTotalDuration(b)) {
            const antId = getId();
            if (b.type === 'super_soldier') {
                state.ants[antId] = {
                    id: antId, colonyId: b.colonyId, type: 'super_soldier', x: b.x, y: b.y, angle: 0,
                    hp: 90, maxHp: 90,
                    dmg: 9, speed: 1.6,
                    carrying: null, isPlayer: false, playerId: null, attackCooldown: 0,
                    targetId: null, targetDict: null, searchTimer: 0,
                    aggroTarget: null, aggroTimer: 0,
                    assistTarget: null, assistTimer: 0, assistPriority: 0,
                    underAttackBy: null, underAttackTimer: 0, underAttackX: null, underAttackY: null,
                    wanderX: null, wanderY: null
                };
            } else {
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
            }
            delete state.broods[b.id];
        }
    }

    // ─── Network Sync (grid-based view culling — much faster than iterating all entities) ───
    // Check if any colony exceeds 350 ants to enable frame skipping for lag reduction
    let shouldSkipFrame = false;
    if (stateUpdateFrame % 2 === 1) {
        // Check if any colony has exceeded 350 ants
        for (let colonyId in colonyPop) {
            if (colonyPop[colonyId] > 350) {
                shouldSkipFrame = true;
                break;
            }
        }
    }
    stateUpdateFrame++;

    // Only send state updates if not skipping this frame
    if (!shouldSkipFrame) {
        for (let pId in state.players) {
            const p = state.players[pId];
            const myAnt = state.ants[p.antId];
            if (!myAnt) continue;

            const viewDist = 1200;
            const localState = {
                players: {}, colonies: state.colonies,
                ants: {}, foods: {}, meats: {}, beetles: {}, broods: {}, queens: {}, aphids: {}, rocks: state.rocks
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
                    for (const a of grid[c].aphids) {
                        const dSq = (myAnt.x - a.x) ** 2 + (myAnt.y - a.y) ** 2;
                        if (dSq < viewDistSq) localState.aphids[a.id] = slimAphid(a);
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

                for (let id in state.rocks) {
                    localState.rocks[id] = slimRock(state.rocks[id]);
                }

                io.to(p.id).emit('state', localState);
            }
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
                    const mx = clamp(target.x + (Math.random() * 30 - 15), 0, MAP_SIZE);
                    const my = clamp(target.y + (Math.random() * 30 - 15), 0, MAP_SIZE);
                    const pos = getClearPositionNear(mx, my, 20, ROCK_SPAWN_CLEARANCE);
                    state.meats[mId] = { id: mId, x: pos.x, y: pos.y };
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
    const pos = getClearPositionNear(queen.x + Math.cos(angle) * distance, queen.y + Math.sin(angle) * distance, 50, ROCK_SPAWN_CLEARANCE + 20);
    state.broods[id] = {
        id,
        colonyId: queen.colonyId,
        type,
        x: pos.x,
        y: pos.y,
        hatchTimer: 0,
        eggDuration: BROOD_EGG_FRAMES + Math.floor(Math.random() * 10 * FPS),
        larvaDuration: BROOD_LARVA_FRAMES + Math.floor(Math.random() * 10 * FPS),
        pupaDuration: BROOD_PUPA_FRAMES + Math.floor(Math.random() * 10 * FPS)
    };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
import re

with open('server.js', 'r') as f:
    code = f.read()

grid_replacement = """
const MAP_SIZE = 3000;
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
"""

code = re.sub(
    r'const CELL_SIZE = 400;.*?const addToGrid = \(obj, type\) => \{.*?grid\[key\]\[type\]\.push\(obj\);\n    \};',
    grid_replacement,
    code,
    flags=re.DOTALL
)

code = re.sub(r'const key = `\$\{Math.floor\(ant.x / CELL_SIZE\)\},\$\{Math.floor\(ant.y / CELL_SIZE\)\}`;', 
              r'const key = getCellIndex(ant.x, ant.y);', code)

code = re.sub(r'const cellKey = `\$\{Math.floor\(tx / CELL_SIZE\)\},\$\{Math.floor\(ty / CELL_SIZE\)\}`;', 
              r'const cellKey = getCellIndex(tx, ty);', code)

with open('server.js', 'w') as f:
    f.write(code)


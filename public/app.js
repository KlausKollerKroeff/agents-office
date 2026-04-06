// Agent Office - Pixelmon Edition
// Walkable 2D Office Canvas

const API_BASE = '';
const REFRESH_INTERVAL = 8000;
let refreshTimer = null;
let agents = [];

// Canvas
const canvas = document.getElementById('officeCanvas');
const ctx = canvas.getContext('2d');

// DOM references
const hireForm = document.getElementById('hireForm');
const hireModal = document.getElementById('hireModal');
const detailModal = document.getElementById('agentDetailModal');
const loadingOverlay = document.getElementById('loadingOverlay');
const teamCount = document.getElementById('teamCount');
const teamsCount = document.getElementById('teamsCount');
const tasksActive = document.getElementById('tasksActive');

// Drag-and-drop state for agents on the map
const customAgentPositions = new Map(); // agent.name -> { x, y }
let dragState = null; // { agent, startX, startY } or null

// Tile size for pixel-art movement
const TILE = 48;
const COLS = 40;
const ROWS = 25;
let canvasW, canvasH;

function resizeCanvas() {
  canvasW = canvas.parentElement.clientWidth;
  canvasH = Math.min(600, window.innerHeight - 250);
  canvas.width = canvasW;
  canvas.height = canvasH;
}

// Player position
const player = {
  x: 20,
  y: 12,
  speed: 0.08,
  dir: 'down',
  moveFrame: 0,
  moving: false,
  pixelBob: 0
};

// Camera offset
let camX = 0;
let camY = 0;

// Input
const keys = {};
let keysDownCount = 0;
document.addEventListener('keydown', (e) => {
  // Don't capture wasd/arrow keys if user is typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (['w','a','s','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key.toLowerCase())) {
    e.preventDefault();
  }
  keys[e.key.toLowerCase()] = true;
  keysDownCount = Math.min(keysDownCount + 1, 4);
});
document.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
  keysDownCount = 0;
});

// Office map layout (1 = wall, 0 = floor, 2 = desk, 6 = door, 7 = plant, 8 = lounge chair, 9 = whiteboard, 50 = water fountain)
// The office is a grid. Agents are placed based on their type/role.
function getMap() {
  const map = [];
  for (let y = 0; y < ROWS; y++) {
    const row = [];
    for (let x = 0; x < COLS; x++) {
      if (y === 0 || y === ROWS - 1 || x === 0 || x === COLS - 1) {
        row.push(1);
      } else {
        row.push(0);
      }
    }
    map.push(row);
  }

  // --- ENTRANCE (bottom-left area, x:1-4, y:22-24) ---
  // Main door at bottom
  map[ROWS - 1][2] = 6;
  map[ROWS - 1][3] = 6;

  // --- MAIN OFFICE (top-center, x:5-18, y:2-10) ---
  // Open plan desks in two rows
  for (let i = 0; i < 5; i++) {
    map[4][7 + i * 2] = 2;  // Desk row 1
    map[4][8 + i * 2] = 2;  // Chair
    map[8][7 + i * 2] = 2;  // Desk row 2
    map[8][8 + i * 2] = 2;  // Chair
  }
  // Whiteboard on north wall
  map[2][12] = 9;
  map[2][13] = 9;
  map[2][14] = 9;
  map[2][15] = 9;

  // --- MEETING ROOM (top-right, x:22-34, y:2-10) ---
  // Walls
  for (let y = 2; y <= 10; y++) {
    map[y][22] = 1;
    map[y][34] = 1;
  }
  map[2][22] = 1; map[2][34] = 1;
  map[10][22] = 1; map[10][34] = 1;
  // Door on south wall
  map[10][28] = 6;
  map[10][29] = 6;
  map[10][30] = 6;
  // Meeting table in center
  map[5][27] = 2; map[5][28] = 2; map[5][29] = 2; map[5][30] = 2; map[5][31] = 2;
  map[7][27] = 2; map[7][28] = 2; map[7][29] = 2; map[7][30] = 2; map[7][31] = 2;

  // --- RESTING ROOM (right-mid, x:22-34, y:13-20) ---
  for (let y = 13; y <= 20; y++) {
    map[y][22] = 1;
    map[y][34] = 1;
  }
  map[13][22] = 1; map[13][34] = 1;
  map[20][22] = 1; map[20][34] = 1;
  // Door on north wall
  map[13][28] = 6;
  map[13][29] = 6;
  map[13][30] = 6;
  // Lounge chairs
  map[15][25] = 8; map[15][29] = 8; map[15][32] = 8;
  map[18][25] = 8; map[18][29] = 8; map[18][32] = 8;

  // --- TENNIS COURT (bottom-center, x:6-17, y:14-23) ---
  for (let y = 14; y <= 23; y++) {
    map[y][6] = 1;
    map[y][17] = 1;
  }
  map[14][6] = 1; map[14][17] = 1;
  map[23][6] = 1; map[23][17] = 1;
  // Doors
  map[14][10] = 6; map[14][11] = 6;
  map[14][13] = 6; map[14][14] = 6;

  // --- CORRIDOR (center vertical, x:20-21, all y) ---
  // Keep open for walking

  // --- HALLWAY (center, x:19-21, y:11-13) ---
  // Connect offices to sports areas

  // Plants
  map[2][2] = 7; map[2][20] = 7;
  map[2][36] = 7;
  map[6][20] = 7;
  map[11][20] = 7; map[11][21] = 7;
  map[14][18] = 7;
  map[22][4] = 7;

  // Water fountain in hallway
  map[12][18] = 50;
  map[12][19] = 0;

  return map;
}

let officeMap = getMap();

// Check collision
function isWalkable(x, y) {
  const tile = getTileAt(x, y);
  if (tile === 1 || tile === 2 || tile === 8) return false; // wall, desk, chair
  if (tile === undefined) return false;
  return true;
}

function getTileAt(x, y) {
  if (y < 0 || y >= ROWS || x < 0 || x >= COLS) return 99;
  return officeMap[y][x];
}

// Agent sprites on the map — placed by WORK STATUS, with type as sub-category
function getAgentPositions() {
  const positions = [];

  // Desk tiles — where WORKING agents sit
  const officeCols = [7, 9, 11, 13, 15];
  const officeRows = [4, 8];
  const meetingCols = [25, 27, 29, 31, 33];
  const meetingRows = [4, 6];

  // Sports/court tiles — where IDLE agents hang out
  const tennisCols = [9, 12, 15];
  const tennisRows  = [17, 21];
  const bballCols   = [21, 24, 26];
  const bballRows   = [17, 19];
  const restCols    = [25, 29, 32];
  const restRows    = [16, 18];

  // Corridor walk positions for agents in transit
  const walkCols    = [18, 20];
  const walkRows    = [5, 9, 13];

  // Categorize by work status
  const workingAgents = agents.filter(a => a.sessionActive || a.processAlive);
  const idleAgents    = agents.filter(a => a.isLaunched && !a.processAlive);
  const offlineAgents = agents.filter(a => !a.sessionActive && !a.isLaunched);

  const skipName = drag.agent ? new Set([drag.agent.name]) : new Set();

  function applyCustom(agent) {
    const cp = customAgentPositions.get(agent.name);
    if (cp) { positions.push({ x: cp.x, y: cp.y, agent }); return true; }
    return false;
  }

  function deskFor(agent, idx, cols, rows) {
    if (applyCustom(agent)) return;
    if (skipName.has(agent.name)) return;
    const x = cols[idx % cols.length];
    const y = idx < cols.length ? rows[0] : rows[1];
    positions.push({ x, y, agent });
  }

  // Working agents at desks in their appropriate room
  const typeSet = (types) => new Set(types);
  const officeTypes = typeSet(['trevor', 'manager', 'luca', 'ellie', 'general-purpose']);
  const meetingTypes = typeSet(['Plan', 'architect', 'mateo']);
  const restTypes = typeSet(['code-reviewer', 'reviewer', 'silent-failure-hunter']);
  const tennisTypes = typeSet(['Explora', 'explorer']);

  workingAgents.filter(a => officeTypes.has(a.type)).forEach((a, i) => deskFor(a, i, officeCols, officeRows));
  workingAgents.filter(a => meetingTypes.has(a.type)).forEach((a, i) => deskFor(a, i, meetingCols, meetingRows));
  workingAgents.filter(a => tennisTypes.has(a.type)).forEach((a, i) => deskFor(a, i, tennisCols, tennisRows));
  workingAgents.filter(a => restTypes.has(a.type)).forEach((a, i) => deskFor(a, i, restCols, restRows));

  // Idle agents at sports courts and activity areas
  const idleTypeAssign = (idle) => {
    if (tennisTypes.has(idle.type)) return 'tennis';
    if (meetingTypes.has(idle.type)) return 'walk';
    if (restTypes.has(idle.type)) return 'rest';
    return 'bball'; // general idle agents browse basketball area
  };

  const idleTennis  = idleAgents.filter(a => idleTypeAssign(a) === 'tennis');
  const idleRest    = idleAgents.filter(a => idleTypeAssign(a) === 'rest');
  const idleWalk    = idleAgents.filter(a => idleTypeAssign(a) === 'walk');
  const idleBball   = idleAgents.filter(a => idleTypeAssign(a) === 'bball');

  idleTennis.forEach((a, i) => deskFor(a, i, tennisCols, tennisRows));
  idleRest.forEach((a, i) => deskFor(a, i, restCols, restRows));
  idleWalk.forEach((a, i) => deskFor(a, i, walkCols, walkRows));
  idleBball.forEach((a, i) => deskFor(a, i, bballCols, bballRows));

  // Offline agents resting in lounge
  offlineAgents.forEach((a, i) => deskFor(a, i, restCols, restRows));

  return positions;
}

// Drawing
function drawTile(x, y, tile) {
  const screenX = x * TILE - camX;
  const screenY = y * TILE - camY;

  // Skip if off screen
  if (screenX < -TILE || screenX > canvas.width + TILE || screenY < -TILE || screenY > canvas.height + TILE) return;

  switch (tile) {
    case 0: {
      // Floor - checkered pattern
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f5f0e0' : '#ede8d4';
      ctx.fillRect(screenX, screenY, TILE, TILE);
      // Subtle grid lines
      ctx.strokeStyle = 'rgba(0,0,0,0.05)';
      ctx.strokeRect(screenX, screenY, TILE, TILE);
      break;
    }
    case 1: {
      // Wall - pixel brick pattern
      ctx.fillStyle = '#2a2a4e';
      ctx.fillRect(screenX, screenY, TILE, TILE);
      // Brick highlights
      ctx.fillStyle = '#3a3a6e';
      ctx.fillRect(screenX + 2, screenY + 2, TILE - 4, TILE / 2 - 3);
      ctx.fillRect(screenX + TILE / 2 + 2, screenY + TILE / 2, TILE / 2 - 4, TILE / 2 - 3);
      ctx.fillRect(screenX + 2, screenY + TILE / 2, TILE / 2 - 4, TILE / 2 - 3);
      // Edge highlight
      ctx.fillStyle = '#4a4a8e';
      ctx.fillRect(screenX, screenY, TILE, 3);
      ctx.fillRect(screenX, screenY, 3, TILE);
      break;
    }
    case 2: {
      // Desk - wood color
      ctx.fillStyle = '#8b6914';
      ctx.fillRect(screenX + 4, screenY + 8, TILE - 8, TILE - 16);
      // Desk top highlight
      ctx.fillStyle = '#a68527';
      ctx.fillRect(screenX + 6, screenY + 10, TILE - 12, TILE - 22);
      break;
    }
    case 6: {
      // Door - green (walkable, but visual marker)
      ctx.fillStyle = '#3c5aa6';
      ctx.fillRect(screenX, screenY, TILE, TILE);
      // Door frame
      ctx.fillStyle = '#ffc400';
      ctx.fillRect(screenX + 2, screenY + 2, TILE - 4, 4);
      break;
    }
    case 7: {
      // Plant
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f5f0e0' : '#ede8d4';
      ctx.fillRect(screenX, screenY, TILE, TILE);
      // Pot
      ctx.fillStyle = '#a0522d';
      ctx.fillRect(screenX + 16, screenY + 28, 16, 16);
      // Leaves
      ctx.fillStyle = '#228B22';
      ctx.fillRect(screenX + 12, screenY + 16, 24, 14);
      ctx.fillRect(screenX + 16, screenY + 8, 16, 10);
      ctx.fillStyle = '#32CD32';
      ctx.fillRect(screenX + 14, screenY + 18, 8, 8);
      ctx.fillRect(screenX + 26, screenY + 18, 6, 6);
      break;
    }
    case 8: {
      // Lounge chair (resting room)
      ctx.fillStyle = '#f0e6d0';
      ctx.fillRect(screenX, screenY, TILE, TILE);
      // Chair
      ctx.fillStyle = '#4a6fa5';
      ctx.fillRect(screenX + 12, screenY + 16, 24, 20);
      ctx.fillStyle = '#5f85c0';
      ctx.fillRect(screenX + 14, screenY + 18, 20, 16);
      // Armrests
      ctx.fillStyle = '#3d5a80';
      ctx.fillRect(screenX + 10, screenY + 20, 4, 12);
      ctx.fillRect(screenX + 34, screenY + 20, 4, 12);
      break;
    }
    case 50: {
      // Water fountain
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f5f0e0' : '#ede8d4';
      ctx.fillRect(screenX, screenY, TILE, TILE);
      ctx.fillStyle = '#4fc3f7';
      ctx.fillRect(screenX + 14, screenY + 16, 20, 20);
      ctx.fillStyle = '#81d4fa';
      ctx.fillRect(screenX + 16, screenY + 18, 16, 8);
      // Water drops
      ctx.fillStyle = '#e1f5fe';
      ctx.fillRect(screenX + 20, screenY + 8, 4, 8);
      ctx.fillRect(screenX + 24, screenY + 12, 4, 4);
      break;
    }
    case 9: {
      // Whiteboard
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f5f0e0' : '#ede8d4';
      ctx.fillRect(screenX, screenY, TILE, TILE);
      // Board
      ctx.fillStyle = '#f8f8f8';
      ctx.fillRect(screenX + 4, screenY + 2, TILE - 8, TILE - 8);
      ctx.strokeStyle = '#ccc';
      ctx.strokeRect(screenX + 4, screenY + 2, TILE - 8, TILE - 8);
      // Marker text lines
      ctx.fillStyle = '#3c5aa6';
      ctx.fillRect(screenX + 8, screenY + 8, TILE - 20, 2);
      ctx.fillRect(screenX + 8, screenY + 14, TILE - 28, 2);
      ctx.fillRect(screenX + 8, screenY + 20, TILE - 24, 2);
      // Tray
      ctx.fillStyle = '#888';
      ctx.fillRect(screenX + 2, screenY + TILE - 8, TILE - 4, 3);
      break;
    }
  }
}

// Pixel art sprite sizes (each block)
const PX = 6;

// Helper: centered X offset for sprite
function spriteOX(screenX, width) { return screenX + (TILE - width) / 2; }

// Trevor — Sporty manager with cap and suit, confident stance
function drawTrevorSprite(screenX, screenY) {
  const b = PX;
  const ox = screenX + 18;
  const oy = screenY + 4;

  // Cap (sporty red)
  ctx.fillStyle = '#e53935';
  ctx.fillRect(ox, oy, b * 3, b);
  ctx.fillRect(ox + b, oy - b + 4, b * 2, b);  // brim
  // Face
  ctx.fillStyle = '#fdd8a5';
  ctx.fillRect(ox, oy + b, b * 3, b);
  // Confident smile
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(ox + b + b / 2, oy + b + 3, b, 2);
  // Eyes
  ctx.fillRect(ox + b / 2, oy + b + 1, 2, 3);
  ctx.fillRect(ox + b * 2 - b / 2 + 1, oy + b + 1, 2, 3);
  // Suit jacket (blue)
  ctx.fillStyle = '#1a237e';
  ctx.fillRect(ox - b / 2, oy + b * 2, b * 4, b);
  // Shirt underneath (white)
  ctx.fillStyle = '#fff';
  ctx.fillRect(ox + b, oy + b * 2, b, b);
  // Tie (red)
  ctx.fillStyle = '#e53935';
  ctx.fillRect(ox + b, oy + b * 2, 2, b);
  // Arms out (sporty pose)
  ctx.fillStyle = '#1a237e';
  ctx.fillRect(ox - b, oy + b * 2, b, b);
  ctx.fillRect(ox + b * 3, oy + b * 2, b, b);
  // Thumbs up on right hand
  ctx.fillStyle = '#fdd8a5';
  ctx.fillRect(ox + b * 3, oy + b + 4, b / 2, b / 2);
  // Legs (khaki)
  ctx.fillStyle = '#8d6e63';
  ctx.fillRect(ox + b / 2, oy + b * 3, b, b);
  ctx.fillRect(ox + b * 2, oy + b * 3, b, b);
  // Sneakers (white)
  ctx.fillStyle = '#eee';
  ctx.fillRect(ox + b / 2 - 1, oy + b * 3 + 4, b + 2, 4);
  ctx.fillRect(ox + b * 2 - 1, oy + b * 3 + 4, b + 2, 4);
}

// Luca — Backend dev with glasses, hoodie, focused
function drawLucaSprite(screenX, screenY) {
  const b = PX;
  const ox = screenX + 18;
  const oy = screenY + 4;

  // Messy hair (dark brown)
  ctx.fillStyle = '#4e342e';
  ctx.fillRect(ox, oy, b * 3, b);
  ctx.fillRect(ox, oy - 2, b, b);  // hair sticking up
  // Face
  ctx.fillStyle = '#ffe0b2';
  ctx.fillRect(ox, oy + b, b * 3, b);
  // Glasses (green tint)
  ctx.fillStyle = '#2e7d32';
  ctx.fillRect(ox + b / 2 - 1, oy + b, 6, 6);
  ctx.fillRect(ox + b * 2 - 1, oy + b, 6, 6);
  ctx.fillStyle = '#fff';  // lenses
  ctx.fillRect(ox + b / 2 + 1, oy + b + 1, 3, 4);
  ctx.fillRect(ox + b * 2 + 1, oy + b + 1, 3, 4);
  // Glasses bridge
  ctx.fillStyle = '#555';
  ctx.fillRect(ox + b + b / 2, oy + b + 2, b, 2);
  // Hoodie (green)
  ctx.fillStyle = '#2e7d32';
  ctx.fillRect(ox - b / 2, oy + b * 2, b * 4, b);
  // Hoodie pocket
  ctx.fillStyle = '#1b5e20';
  ctx.fillRect(ox + b / 2, oy + b * 2 + 2, b * 2, 4);
  // Arms holding laptop (hunched)
  ctx.fillStyle = '#2e7d32';
  ctx.fillRect(ox - b / 2, oy + b * 2, b / 2, b);
  ctx.fillRect(ox + b * 3, oy + b * 2, b / 2, b);
  // Keyboard (tiny laptop)
  ctx.fillStyle = '#555';
  ctx.fillRect(ox + b / 2, oy + b * 2 + b + 2, b * 2, 4);
  ctx.fillStyle = '#888';
  ctx.fillRect(ox + b / 2 + 1, oy + b * 2 + b + 2, b * 2 - 2, 3);  // keys
  // Legs (jeans)
  ctx.fillStyle = '#1565c0';
  ctx.fillRect(ox + b / 2, oy + b * 3, b, b);
  ctx.fillRect(ox + b * 2, oy + b * 3, b, b);
  // Shoes (brown boots)
  ctx.fillStyle = '#4e342e';
  ctx.fillRect(ox + b / 2 - 1, oy + b * 3 + 4, b + 2, 4);
  ctx.fillRect(ox + b * 2 - 1, oy + b * 3 + 4, b + 2, 4);
}

// Ellie — Creative designer, stylish with flowing hair, dress
function drawEllieSprite(screenX, screenY) {
  const b = PX;
  const ox = screenX + 18;
  const oy = screenY + 4;

  // Long blonde hair (top + flowing sides)
  ctx.fillStyle = '#f9a825';
  ctx.fillRect(ox, oy, b * 3, b);
  ctx.fillRect(ox - 2, oy + b, 4, b);  // left flowing hair
  ctx.fillRect(ox + b * 3 - 2, oy + b, 4, b);  // right flowing hair
  // Face
  ctx.fillStyle = '#ffe0b2';
  ctx.fillRect(ox, oy + b, b * 3, b);
  // Eyes with eyelashes
  ctx.fillStyle = '#5c6bc0';
  ctx.fillRect(ox + b / 2, oy + b + 1, 3, 3);
  ctx.fillRect(ox + b * 2 - b / 2 + 1, oy + b + 1, 3, 3);
  // Smile
  ctx.fillStyle = '#e91e63';
  ctx.fillRect(ox + b, oy + b + 3, b, 2);
  // Dress (magenta/pink)
  ctx.fillStyle = '#ad1457';
  ctx.fillRect(ox - b / 2, oy + b * 2, b * 4, b);
  // Belt
  ctx.fillStyle = '#f9a825';
  ctx.fillRect(ox, oy + b * 2 + 2, b * 2, 2);
  // Arms (creative hands, one on hip)
  ctx.fillStyle = '#ffe0b2';
  ctx.fillRect(ox - b, oy + b * 2, b / 2 + 1, b);
  ctx.fillRect(ox + b * 3, oy + b * 2 - 1, b / 2 + 1, b);
  // Legs (matching pink)
  ctx.fillStyle = '#ad1457';
  ctx.fillRect(ox + b / 2, oy + b * 3 - 2, b, b);
  ctx.fillRect(ox + b * 2, oy + b * 3 - 2, b, b);
  // Heels
  ctx.fillStyle = '#e91e63';
  ctx.fillRect(ox + b / 2 - 1, oy + b * 3 + 2, b + 2, 4);
  ctx.fillRect(ox + b * 2 - 1, oy + b * 3 + 2, b + 2, 4);
}

// Mateo — Detective/debugger with hat, magnifying glass
function drawMateoSprite(screenX, screenY) {
  const b = PX;
  const ox = screenX + 18;
  const oy = screenY + 4;

  // Detective hat (brown fedora)
  ctx.fillStyle = '#5d4037';
  ctx.fillRect(ox, oy - 2, b * 3 + 2, b - 2);
  ctx.fillRect(ox + b / 2, oy - b, b * 2, b);  // hat crown
  ctx.fillStyle = '#33691e';
  ctx.fillRect(ox + b / 2, oy - b / 2 + 2, b * 2, 4);  // hat band (green for debugging)
  // Face
  ctx.fillStyle = '#d7ccc8';
  ctx.fillRect(ox, oy + b - 2, b * 3, b);
  // Sharp focused eyes
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(ox + b / 2, oy + b, 3, 4);
  ctx.fillRect(ox + b * 2 - b / 2 - 1, oy + b, 3, 4);
  // Squinting (concentrating)
  ctx.fillStyle = '#5d4037';
  ctx.fillRect(ox + b / 2 - 1, oy + b - 1, 5, 2);
  ctx.fillRect(ox + b * 2 - b / 2 - 2, oy + b - 1, 5, 2);
  // Body (utility jacket, green tones)
  ctx.fillStyle = '#33691e';
  ctx.fillRect(ox - b / 2, oy + b * 2 - 2, b * 4, b);
  // Utility belt with tools
  ctx.fillStyle = '#8d6e63';
  ctx.fillRect(ox, oy + b * 2, b * 3, 4);
  // Magnifying glass (in right hand)
  ctx.fillStyle = '#5d4037';  // handle
  ctx.fillRect(ox + b * 3 + 1, oy + b * 2, 3, b);
  ctx.strokeStyle = '#ffd54f';  // ring
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ox + b * 3 + 3, oy + b * 2 - 4, 5, 0, Math.PI * 2);
  ctx.stroke();
  // Left arm
  ctx.fillStyle = '#33691e';
  ctx.fillRect(ox - b, oy + b * 2 - 2, b, b);
  // Legs (cargo pants)
  ctx.fillStyle = '#4e342e';
  ctx.fillRect(ox + b / 2, oy + b * 3 - 2, b, b);
  ctx.fillRect(ox + b * 2, oy + b * 3 - 2, b, b);
  // Work boots
  ctx.fillStyle = '#3e2723';
  ctx.fillRect(ox + b / 2 - 2, oy + b * 3 + 2, b + 4, 5);
  ctx.fillRect(ox + b * 2 - 2, oy + b * 3 + 2, b + 4, 5);
}

// Generic sprite for any unmapped agent
function drawGenericSprite(agent, screenX, screenY) {
  const typeClass = getAgentTypeClassLower(agent.type);
  const colors = {
    'general': { body: '#3c5aa6', accent: '#ffc400', hair: '#2a2a4e' },
    'explorer': { body: '#4caf50', accent: '#ff9800', hair: '#5d4037' },
    'architect': { body: '#9c27b0', accent: '#ce93d8', hair: '#333' },
    'reviewer': { body: '#ff9800', accent: '#ff6d00', hair: '#333' },
    'default': { body: '#1ba8b5', accent: '#80deea', hair: '#333' }
  };
  const c = colors[typeClass] || colors.default;

  const b = PX;
  const ox = screenX + 18;
  const oy = screenY + 6;

  // Hair/head
  ctx.fillStyle = c.hair;
  ctx.fillRect(ox, oy, b * 3, b);
  // Face
  ctx.fillStyle = '#fdd8a5';
  ctx.fillRect(ox, oy + b, b * 3, b);
  // Eyes
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(ox + b, oy + b + 1, 2, 3);
  ctx.fillRect(ox + b * 2, oy + b + 1, 2, 3);
  // Arms
  ctx.fillStyle = c.body;
  ctx.fillRect(ox - b, oy + b * 2, b, b);
  ctx.fillRect(ox + b * 2, oy + b * 2, b, b);
  // Accent (tie / badge)
  ctx.fillStyle = c.accent;
  ctx.fillRect(ox + b, oy + b * 2, b, b);
  // Legs
  ctx.fillRect(ox + 2, oy + b * 3, b, b);
  ctx.fillRect(ox + b * 2 - 2, oy + b * 3, b, b);
  // Shoes
  ctx.fillStyle = '#3a3a5e';
  ctx.fillRect(ox + 1, oy + b * 3 + 4, b, 4);
  ctx.fillRect(ox + b * 2 - 3, oy + b * 3 + 4, b, 4);
}

// Draw agent sprite (pixel character) with status-based animations
function drawAgentSprite(agent, screenX, screenY) {
  const name = agent.name.toLowerCase();
  const isWorking = agent.sessionActive || agent.processAlive;
  const isIdle = agent.isLaunched && !agent.processAlive;
  const isOffline = !agent.sessionActive && !agent.isLaunched;

  let bobY = 0;

  // Working agents: no bounce — focused at desk
  // Idle agents: gentle sway — relaxed browsing
  // Offline agents: slow Zzz float
  if (isIdle) {
    bobY = Math.sin(Date.now() / 300 + name.charCodeAt(0) * 7) * 2;
  } else if (isOffline) {
    bobY = Math.sin(Date.now() / 500 + name.charCodeAt(0) * 5) * 1.5;
  }
  screenY += bobY;

  // Draw agent-specific body
  switch (name) {
    case 'trevor': drawTrevorSprite(screenX, screenY); break;
    case 'luca': drawLucaSprite(screenX, screenY); break;
    case 'ellie': drawEllieSprite(screenX, screenY); break;
    case 'mateo': drawMateoSprite(screenX, screenY); break;
    default: drawGenericSprite(agent, screenX, screenY); break;
  }

  // Activity overlays on top of sprite
  if (isWorking) {
    // Laptop glow on desk
    ctx.fillStyle = 'rgba(76, 175, 80, 0.15)';
    ctx.fillRect(screenX + 12, screenY + TILE - 4, TILE - 24, 4);
  } else if (isIdle) {
    // Idle sparkle — tiny star above
    const starPhase = Math.sin(Date.now() / 200 + name.charCodeAt(0) * 13);
    if (starPhase > 0.3) {
      ctx.fillStyle = `rgba(255, 196, 0, ${starPhase * 0.6})`;
      ctx.fillRect(screenX + 18, screenY - 6, 3, 3);
    }
  } else {
    // Red dot for offline
    ctx.fillStyle = '#f44336';
    ctx.fillRect(screenX + TILE - 6, screenY - 4, 5, 5);
    // Floating Z
    ctx.fillStyle = '#f44336';
    ctx.font = '6px "Press Start 2P", monospace';
    const zOff = Math.sin(Date.now() / 300 + name.charCodeAt(0)) * 2;
    ctx.fillText('Z', screenX + TILE, screenY - 8 + zOff);
  }

  // Status indicator (top-right) — colored dot based on session state
  const dotX = screenX + TILE - 6;
  const dotY = screenY - 4;
  if (isWorking) {
    // Working: steady green pulse
    const pulse = Math.sin(Date.now() / 600) * 0.3 + 0.7;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(dotX, dotY, 5, 5);
    ctx.globalAlpha = 1;
  } else if (isIdle) {
    // Idle: slow yellow pulse
    const pulse = Math.sin(Date.now() / 800) * 0.4 + 0.4;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ffc400';
    ctx.fillRect(dotX, dotY, 5, 5);
    ctx.globalAlpha = 1;
  }

  // Name tag (always on top)
  ctx.fillStyle = '#2a2a4e';
  ctx.font = 'bold 7px "Press Start 2P", monospace';
  const nameWidth = ctx.measureText(agent.name).width;
  const tagX = screenX + (TILE - nameWidth - 6) / 2;
  const tagY = screenY - 8;
  ctx.fillRect(tagX - 1, tagY - 1, nameWidth + 8, 9);
  ctx.fillStyle = isWorking ? '#4caf50' : isIdle ? '#ffc400' : '#f44336';
  ctx.fillText(agent.name, tagX + 3, tagY + 6);
}

// Draw special areas on top
function drawSpecialArea(x, y, type) {
  const screenX = x * TILE - camX;
  const screenY = y * TILE - camY;
  if (screenX < -TILE || screenX > canvas.width + TILE || screenY < -TILE || screenY > canvas.height + TILE) return;

  switch (type) {
    case 'tennis':
      ctx.fillStyle = '#5c9e5c';
      ctx.fillRect(screenX + 4, screenY + 4, TILE - 8, TILE - 8);
      // Net
      if (x % 2 === 0) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(screenX + TILE / 2 - 1, screenY, 3, TILE);
      }
      break;
    case 'basketball':
      ctx.fillStyle = '#d4a76a';
      ctx.fillRect(screenX + 4, screenY + 4, TILE - 8, TILE - 8);
      break;
  }
}

// Draw sports courts and room overlays on the floor
function drawSportsFloor() {
  const ox = (v) => v * TILE - camX;
  const oy = (v) => v * TILE - camY;

  // ========================================
  //  TENNIS COURT — proper hard court
  // ========================================
  const tx = ox(7), ty = oy(15), tw = 10 * TILE, th = 8 * TILE;

  // Outer fence area
  ctx.fillStyle = '#1b5e20';
  ctx.fillRect(tx - 6, ty - 6, tw + 12, th + 12);

  // Court surface
  ctx.fillStyle = '#2e7d32';
  ctx.fillRect(tx, ty, tw, th);

  // Playing area (inner)
  const cx = tx + TILE * 2, cy = ty + TILE;
  const cw = tw - TILE * 3, ch = th - TILE * 2;
  ctx.fillStyle = '#388e3c';
  ctx.fillRect(cx, cy, cw, ch);

  // Court border
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(cx, cy, cw, ch);

  // Service lines
  const sTop = cy + ch * 0.25, sBot = cy + ch * 0.75;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, sTop); ctx.lineTo(cx + cw, sTop);
  ctx.moveTo(cx, sBot); ctx.lineTo(cx + cw, sBot);
  ctx.stroke();

  // Center service line
  ctx.beginPath();
  ctx.moveTo(cx + cw / 2, sTop); ctx.lineTo(cx + cw / 2, sBot);
  ctx.stroke();

  // Net (dashed)
  const netY = cy + ch / 2;
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(cx - 8, netY); ctx.lineTo(cx + cw + 8, netY); ctx.stroke();
  ctx.setLineDash([]);

  // Net posts
  ctx.fillStyle = '#607d8b';
  ctx.fillRect(cx - 10, netY - 5, 5, 10);
  ctx.fillRect(cx + cw + 5, netY - 5, 5, 10);

  // Fence cross-hatch texture
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let fx = tx + 8; fx < tx + tw; fx += 18) {
    ctx.beginPath(); ctx.moveTo(fx, ty); ctx.lineTo(fx, ty + th); ctx.stroke();
  }
  for (let fy = ty + 8; fy < ty + th; fy += 18) {
    ctx.beginPath(); ctx.moveTo(tx, fy); ctx.lineTo(tx + tw, fy); ctx.stroke();
  }

  // Label pill
  const tLx = cx + cw / 2, tLy = cy + ch / 2 - 18;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  drawPillBg(tLx, tLy + 6, '🎾 TENNIS', 8);
  ctx.fillStyle = '#fff';
  ctx.fillText('🎾 TENNIS', tLx - ctx.measureText('🎾 TENNIS').width / 2, tLy + 6);

  // ========================================
  //  BASKETBALL COURT — hardwood court
  // ========================================
  const bx = ox(20), by = oy(15), bw = 8 * TILE, bh = 6 * TILE;

  // Outer area
  ctx.fillStyle = '#4e342e';
  ctx.fillRect(bx - 6, by - 6, bw + 12, bh + 12);

  // Hardwood surface
  ctx.fillStyle = '#bf7c42';
  ctx.fillRect(bx, by, bw, bh);

  // Wood plank vertical lines
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1;
  for (let px = bx; px <= bx + bw; px += TILE) {
    ctx.beginPath(); ctx.moveTo(px, by); ctx.lineTo(px, by + bh); ctx.stroke();
  }

  // Playing area
  const bx2 = bx + TILE, by2 = by + TILE, bw2 = bw - TILE * 2, bh2 = bh - TILE * 2;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx2, by2, bw2, bh2);

  // Center line
  const bCx = bx2 + bw2 / 2, bCy = by2 + bh2 / 2;
  ctx.beginPath(); ctx.moveTo(bCx, by2); ctx.lineTo(bCx, by2 + bh2); ctx.stroke();

  // Center circle
  ctx.beginPath(); ctx.arc(bCx, bCy, 16, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#ff8f00';
  ctx.beginPath(); ctx.arc(bCx, bCy, 4, 0, Math.PI * 2); ctx.fill();

  // Keys (paint areas)
  const keyW = bw2 * 0.18, keyH = bh2 * 0.5;
  // Left key
  ctx.fillStyle = 'rgba(244,67,54,0.3)';
  ctx.fillRect(bx2, bCy - keyH / 2, keyW, keyH);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
  ctx.strokeRect(bx2, bCy - keyH / 2, keyW, keyH);
  // Left free throw arc
  ctx.beginPath(); ctx.arc(bx2 + keyW, bCy, keyH / 2, -Math.PI / 2, Math.PI / 2); ctx.stroke();

  // Right key
  ctx.fillStyle = 'rgba(244,67,54,0.3)';
  ctx.fillRect(bx2 + bw2 - keyW, bCy - keyH / 2, keyW, keyH);
  ctx.strokeRect(bx2 + bw2 - keyW, bCy - keyH / 2, keyW, keyH);
  ctx.beginPath(); ctx.arc(bx2 + bw2 - keyW, bCy, keyH / 2, Math.PI / 2, -Math.PI / 2); ctx.stroke();

  // Three-point arcs
  const threeR = 30;
  ctx.beginPath(); ctx.arc(bx2 + 4, bCy, threeR, -Math.PI * 0.42, Math.PI * 0.42); ctx.stroke();
  ctx.beginPath(); ctx.arc(bx2 + bw2 - 4, bCy, threeR, Math.PI * 0.58, -Math.PI * 0.58); ctx.stroke();

  // Backboards
  ctx.strokeStyle = '#555'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(bx2 + 6, bCy - 14); ctx.lineTo(bx2 + 6, bCy + 14);
  ctx.moveTo(bx2 + bw2 - 6, bCy - 14); ctx.lineTo(bx2 + bw2 - 6, bCy + 14);
  ctx.stroke();

  // Hoops
  ctx.fillStyle = '#ff6f00';
  ctx.beginPath(); ctx.arc(bx2 + 14, bCy, 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(bx2 + bw2 - 14, bCy, 5, 0, Math.PI * 2); ctx.fill();

  // Label pill
  const bLx = bx2 + bw2 / 2, bLy = by2 + 14;
  drawPillBg(bLx, bLy, '🏀 BASKETBALL', 7);
  ctx.fillStyle = '#fff';
  ctx.fillText('🏀 BASKETBALL', bLx - ctx.measureText('🏀 BASKETBALL').width / 2, bLy + 4);

  // ========================================
  //  RESTING ROOM — cozy lounge
  // ========================================
  const rx = ox(23), ry = oy(14), rw = 11 * TILE, rh = 6 * TILE;

  // Carpet
  ctx.fillStyle = '#5d4037';
  ctx.fillRect(rx, ry, rw, rh);

  // Carpet dots
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  for (let dx = rx + 12; dx < rx + rw; dx += 20) {
    for (let dy2 = ry + 12; dy2 < ry + rh; dy2 += 20) {
      ctx.beginPath(); ctx.arc(dx, dy2, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Floor lamp
  const lampX = rx + rw / 2, lampY = ry + rh / 2;
  ctx.fillStyle = 'rgba(255,224,130,0.1)';
  ctx.beginPath(); ctx.arc(lampX, lampY, TILE * 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8d6e63';
  ctx.fillRect(lampX - 2, lampY - 14, 4, 28);
  ctx.fillStyle = '#ffe082';
  ctx.beginPath(); ctx.arc(lampX, lampY - 14, 7, 0, Math.PI * 2); ctx.fill();

  // Label pill
  const rLx = rx + rw / 2, rLy = ry + TILE * 0.4;
  drawPillBg(rLx, rLy, '☕ LOUNGE', 7);
  ctx.fillStyle = '#fce4ec';
  ctx.fillText('☕ LOUNGE', rLx - ctx.measureText('☕ LOUNGE').width / 2, rLy + 4);

  // ========================================
  //  MEETING ROOM — professional
  // ========================================
  const mx = ox(23), my = oy(3), mw = 11 * TILE, mh = 7 * TILE;

  // Floor tiles
  ctx.fillStyle = '#cfd8dc';
  ctx.fillRect(mx, my, mw, mh);
  // Tile grid
  ctx.strokeStyle = 'rgba(0,0,0,0.05)';
  ctx.lineWidth = 0.5;
  for (let tx2 = mx; tx2 <= mx + mw; tx2 += TILE) {
    ctx.beginPath(); ctx.moveTo(tx2, my); ctx.lineTo(tx2, my + mh); ctx.stroke();
  }
  for (let ty2 = my; ty2 <= my + mh; ty2 += TILE) {
    ctx.beginPath(); ctx.moveTo(mx, ty2); ctx.lineTo(mx + mw, ty2); ctx.stroke();
  }

  // Label pill
  const mLx = mx + mw / 2, mLy = my + TILE * 0.4;
  drawPillBg(mLx, mLy, '📋 MEETING', 7);
  ctx.fillStyle = '#e0f2f1';
  ctx.fillText('📋 MEETING', mLx - ctx.measureText('📋 MEETING').width / 2, mLy + 4);

  // ========================================
  //  MAIN OFFICE label
  // ========================================
  const oLx = ox(11), oLy = oy(0.7);
  drawPillBg(oLx, oLy, '🏢 OFFICE', 8);
  ctx.fillStyle = '#e8eaf6';
  ctx.fillText('🏢 OFFICE', oLx - ctx.measureText('🏢 OFFICE').width / 2, oLy + 5);
}

// Helper: draw pill-shaped text background
function drawPillBg(cx, cy, text, fontSize) {
  ctx.font = `bold ${fontSize}px "Press Start 2P", monospace`;
  const m = ctx.measureText(text);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(cx - m.width / 2 - 8, cy - fontSize + 2, m.width + 16, fontSize + 10, 6);
}

// Helper: rounded rectangle
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

// Draw player
function drawPlayer() {
  const screenX = player.x * TILE - camX;
  const screenY = player.y * TILE - camY;

  // Bob animation
  const bob = Math.sin(player.pixelBob) * 2;

  // Bright glow ring so player is always visible
  const pulse = Math.sin(Date.now() / 300) * 0.2 + 0.8;
  // Outer glow
  ctx.fillStyle = `rgba(255, 196, 0, ${pulse * 0.5})`;
  ctx.beginPath();
  ctx.ellipse(screenX + TILE / 2, screenY + TILE / 2 + 10, 30, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  // White outline ring
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(screenX + TILE / 2, screenY + TILE / 2 + 10, 24, 24, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(screenX + TILE / 2, screenY + TILE + 2, 12, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs (draw first so body overlaps)
  ctx.fillStyle = '#1565c0';
  ctx.fillRect(screenX + 14, screenY + 32 + bob, 8, 12);
  ctx.fillRect(screenX + 26, screenY + 32 + bob, 8, 12);
  // Shoes
  ctx.fillStyle = '#fff';
  ctx.fillRect(screenX + 12, screenY + 42 + bob, 10, 4);
  ctx.fillRect(screenX + 24, screenY + 42 + bob, 10, 4);

  // Body
  ctx.fillStyle = '#e53935';
  ctx.fillRect(screenX + 14, screenY + 12 + bob, 20, 22);
  // Shirt detail
  ctx.fillStyle = '#c62828';
  ctx.fillRect(screenX + 16, screenY + 14 + bob, 16, 4);

  // Arms
  ctx.fillStyle = '#e53935';
  const armSwing = player.moving ? Math.sin(player.pixelBob) * 4 : 0;
  ctx.fillRect(screenX + 8, screenY + 14 + bob + armSwing, 8, 14);
  ctx.fillRect(screenX + 32, screenY + 14 + bob - armSwing, 8, 14);
  // Hands
  ctx.fillStyle = '#fdd8a5';
  ctx.fillRect(screenX + 8, screenY + 26 + bob + armSwing, 8, 4);
  ctx.fillRect(screenX + 32, screenY + 26 + bob - armSwing, 8, 4);

  // Head
  ctx.fillStyle = '#fdd8a5';
  ctx.fillRect(screenX + 16, screenY + 2 + bob, 16, 14);
  // Hat (red cap like a Pokemon trainer)
  ctx.fillStyle = '#e53935';
  ctx.fillRect(screenX + 14, screenY - 2 + bob, 20, 6);
  ctx.fillRect(screenX + 14, screenY + 2 + bob, 26, 3);
  // Hat brim shadow
  ctx.fillStyle = '#b71c1c';
  ctx.fillRect(screenX + 14, screenY + 4 + bob, 26, 2);

  // Eyes
  ctx.fillStyle = '#1a1a2e';
  const eyeOffX = player.dir === 'left' ? -2 : player.dir === 'right' ? 2 : 0;
  const eyeOffY = player.dir === 'up' ? -4 : player.dir === 'down' ? 2 : 0;
  if (player.dir !== 'up') {
    ctx.fillRect(screenX + 19 + eyeOffX, screenY + 8 + bob + eyeOffY, 3, 3);
    ctx.fillRect(screenX + 26 + eyeOffX, screenY + 8 + bob + eyeOffY, 3, 3);
  }

  // "YOU" label above head
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.font = 'bold 6px "Press Start 2P", monospace';
  const label = 'YOU';
  const lw = ctx.measureText(label).width;
  ctx.fillRect(screenX + TILE/2 - lw/2 - 4, screenY - 12 + bob, lw + 8, 12);
  ctx.fillStyle = '#ffc400';
  ctx.fillText(label, screenX + TILE/2 - lw/2, screenY - 2 + bob);
}

// Type mappings
function getAgentTypeClass(agent) {
  return { 'general-purpose': 'General', 'Explore': 'Explorer', 'Plan': 'Architect', 'code-reviewer': 'Reviewer' }[agent.type] || 'Default';
}

function getAgentTypeClassLower(agent) {
  return { 'general-purpose': 'general', 'Explore': 'explorer', 'Plan': 'architect', 'code-reviewer': 'reviewer' }[agent.type] || 'default';
}

// Main render loop
function render() {
  // Update player movement
  let dx = 0, dy = 0;
  const spd = player.speed;
  player.moving = false;

  if (keys['w'] || keys['arrowup']) { dy = -spd; player.dir = 'up'; player.moving = true; }
  else if (keys['s'] || keys['arrowdown']) { dy = spd; player.dir = 'down'; player.moving = true; }
  else if (keys['a'] || keys['arrowleft']) { dx = -spd; player.dir = 'left'; player.moving = true; }
  else if (keys['d'] || keys['arrowright']) { dx = spd; player.dir = 'right'; player.moving = true; }

  if (player.moving) {
    player.pixelBob += 0.15;

    // Check X movement
    const newX = player.x + dx;
    if (isWalkable(Math.floor(newX + 0.3), Math.floor(player.y + 0.3)) &&
        isWalkable(Math.floor(newX + 0.8), Math.floor(player.y + 0.3)) &&
        isWalkable(Math.floor(newX + 0.3), Math.floor(player.y + 0.8)) &&
        isWalkable(Math.floor(newX + 0.8), Math.floor(player.y + 0.8))) {
      player.x = newX;
    }

    // Check Y movement
    const newY = player.y + dy;
    if (isWalkable(Math.floor(player.x + 0.3), Math.floor(newY + 0.3)) &&
        isWalkable(Math.floor(player.x + 0.8), Math.floor(newY + 0.3)) &&
        isWalkable(Math.floor(player.x + 0.3), Math.floor(newY + 0.8)) &&
        isWalkable(Math.floor(player.x + 0.8), Math.floor(newY + 0.8))) {
      player.y = newY;
    }
  }

  // Update camera to follow player
  camX = player.x * TILE - canvas.width / 2 + TILE / 2;
  camY = player.y * TILE - canvas.height / 2 + TILE / 2;

  // Clamp camera
  camX = Math.max(0, Math.min(camX, COLS * TILE - canvas.width));
  camY = Math.max(0, Math.min(camY, ROWS * TILE - canvas.height));

  // Clear
  ctx.clearRect(0, 0, canvasW, canvasH);

  // Draw tiles
  const startCol = Math.max(0, Math.floor(camX / TILE));
  const startRow = Math.max(0, Math.floor(camY / TILE));
  const endCol = Math.min(COLS - 1, Math.ceil((camX + canvasW) / TILE));
  const endRow = Math.min(ROWS - 1, Math.ceil((camY + canvasH) / TILE));

  for (let y = startRow; y <= endRow; y++) {
    for (let x = startCol; x <= endCol; x++) {
      const tile = officeMap[y][x];
      if (tile !== undefined) drawTile(x, y, tile);
    }
  }

  // Draw sports floors on top of tiles
  drawSportsFloor();

  // Draw agent sprites on their desks
  const agentPositions = getAgentPositions();
  agentPositions.forEach(({ x, y, agent }) => {
    const screenX = x * TILE - camX + 8;
    const screenY = y * TILE - camY + 8;
    drawAgentSprite(agent, screenX, screenY);
  });

  // Draw dragged agent at cursor
  if (drag.agent) {
    // Highlight target tile
    if (drag.targetTileX !== undefined) {
      const highlightX = drag.targetTileX * TILE - camX;
      const highlightY = drag.targetTileY * TILE - camY;
      ctx.strokeStyle = 'rgba(255, 196, 0, 0.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(highlightX + 2, highlightY + 2, TILE - 4, TILE - 4);
    }
    // Draw agent sprite following cursor
    drawAgentSprite(drag.agent, drag.dragScreenX - TILE / 2, drag.dragScreenY - TILE / 2);
  }

  // Draw player on top
  drawPlayer();

  // Draw room labels as floor text
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = '4px "Press Start 2P", monospace';

  // Check for interaction hint
  const tileAtPlayer = getTileAt(Math.floor(player.x + 0.5), Math.floor(player.y + 0.5));
  if (tileAtPlayer === 6) {
    showTooltip('Press E to interact');
  }

  requestAnimationFrame(render);
}

// Tooltip
const tooltip = document.getElementById('walkTooltip');
let tooltipTimer = null;

function showTooltip(text) {
  tooltip.textContent = text;
  tooltip.classList.remove('hidden');
  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(() => tooltip.classList.add('hidden'), 2000);
}

// Agent hover status tooltip on canvas
const agentHoverTooltip = document.createElement('div');
agentHoverTooltip.className = 'agent-hover-tooltip';

function getStatusBadge(agent) {
  if (agent.processAlive) return { text: '● Answering', color: '#4caf50' };
  if (agent.isLaunched) return { text: '~ Idle', color: '#ffc400' };
  return { text: '○ Not Connected', color: '#f44336' };
}

function showAgentHoverStatus(agent, mouseX, mouseY) {
  const badge = getStatusBadge(agent);
  agentHoverTooltip.innerHTML = `
    <div class="agent-name">${agent.name}</div>
    <div class="agent-status" style="color:${badge.color}">${badge.text}</div>
    <div class="agent-team">${agent.teamName}</div>
  `;
  agentHoverTooltip.style.left = (mouseX + 16) + 'px';
  agentHoverTooltip.style.top = (mouseY - 10) + 'px';
  agentHoverTooltip.classList.add('visible');
}

function hideAgentHoverStatus() {
  agentHoverTooltip.classList.remove('visible');
}

// Add tooltip element to DOM
document.querySelector('.office-map-container').appendChild(agentHoverTooltip);

// Agent lookup by name for drag-and-drop
function findAgentAtTile(mx, my) {
  const positions = getAgentPositions();
  for (const pos of positions) {
    if (mx >= pos.x * TILE && mx < (pos.x + 1) * TILE &&
        my >= pos.y * TILE && my < (pos.y + 1) * TILE) {
      return pos.agent;
    }
  }
  return null;
}

// --- Drag-and-drop state ---
let hoveredAgent = null;
const drag = { agent: null, offsetX: 0, offsetY: 0 };

// Mousedown — start dragging an agent
canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const worldX = e.clientX - rect.left + camX;
  const worldY = e.clientY - rect.top + camY;
  const agent = findAgentAtTile(worldX, worldY);

  if (agent) {
    drag.agent = agent;
    drag.offsetX = (worldX % TILE) - TILE / 2;
    drag.offsetY = (worldY % TILE) - TILE / 2;
    canvas.style.cursor = 'grabbing';
  }
});

// Mousemove — drag or hover
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const worldX = e.clientX - rect.left + camX;
  const worldY = e.clientY - rect.top + camY;

  if (drag.agent) {
    // Snap agent sprite to cursor during drag
    drag.dragScreenX = e.clientX - rect.left;
    drag.dragScreenY = e.clientY - rect.top;
    // Highlight target tile
    drag.targetTileX = Math.floor(worldX / TILE);
    drag.targetTileY = Math.floor(worldY / TILE);
    canvas.style.cursor = 'grabbing';
  } else {
    const found = findAgentAtTile(worldX, worldY);
    if (found) {
      showAgentHoverStatus(found, e.clientX - rect.left, e.clientY - rect.top);
      canvas.style.cursor = 'grab';
      hoveredAgent = found;
    } else {
      hideAgentHoverStatus();
      canvas.style.cursor = 'crosshair';
      hoveredAgent = null;
    }
  }
});

// Mouseup — drop agent on tile
canvas.addEventListener('mouseup', (e) => {
  if (!drag.agent) return;

  const rect = canvas.getBoundingClientRect();
  const worldX = e.clientX - rect.left + camX;
  const worldY = e.clientY - rect.top + camY;
  const tileX = Math.floor(worldX / TILE);
  const tileY = Math.floor(worldY / TILE);

  // Only drop if the tile is walkable
  if (isWalkable(tileX, tileY) || getTileAt(tileX, tileY) === 2) {
    customAgentPositions.set(drag.agent.name, { x: tileX, y: tileY });
    showNotification(`<strong>${drag.agent.name}</strong> moved to desk (${tileX}, ${tileY})`, 3000);
  }

  drag.agent = null;
  canvas.style.cursor = 'crosshair';
});

canvas.addEventListener('mouseleave', () => {
  hideAgentHoverStatus();
  canvas.style.cursor = 'crosshair';
  hoveredAgent = null;
  // Cancel drag on leave
  if (drag.agent) {
    drag.agent = null;
  }
});

// Fetch agents from API
async function fetchAgents() {
  try {
    const response = await fetch(`${API_BASE}/api/agents`);
    const data = await response.json();
    return data.agents || [];
  } catch (err) {
    console.error('Failed to fetch agents:', err);
    return [];
  }
}

async function fetchTeams() {
  try {
    const response = await fetch(`${API_BASE}/api/teams`);
    const data = await response.json();
    return data.teams || [];
  } catch (err) {
    console.error('Failed to fetch teams:', err);
    return [];
  }
}

// Render office data (for HUD stats + roster)
function renderHUD(agentList, teamList) {
  teamCount.textContent = agentList.length;
  teamsCount.textContent = teamList.length;
  let totalActiveTasks = 0;
  teamList.forEach(t => { totalActiveTasks += t.taskStatus?.inProgress || 0; });
  tasksActive.textContent = totalActiveTasks;
  renderRoster(agentList);
}

// Render agent roster below the map
function renderRoster(agentList) {
  const grid = document.getElementById('rosterGrid');
  if (agentList.length === 0) {
    grid.innerHTML = `<div class="roster-empty">No agents running yet. Hire your first agent!</div>`;
    return;
  }

  const typeInfo = {
    'general-purpose': { label: 'General', cls: 'general', icon: 'G', color: '#3c5aa6' },
    'Explore': { label: 'Explorer', cls: 'explorer', icon: 'E', color: '#4caf50' },
    'Plan': { label: 'Architect', cls: 'architect', icon: 'A', color: '#9c27b0' },
    'code-reviewer': { label: 'Reviewer', cls: 'reviewer', icon: 'R', color: '#ff9800' },
    'silent-failure-hunter': { label: 'Debug', cls: 'debug', icon: 'M', color: '#ff5722' },
    'luca': { label: 'Backend', cls: 'backend', icon: 'L', color: '#00bcd4' },
    'ellie': { label: 'Frontend', cls: 'frontend', icon: 'E', color: '#e91e63' },
    'mateo': { label: 'Debug', cls: 'debug', icon: 'M', color: '#ff5722' },
    'trevor': { label: 'Manager', cls: 'manager', icon: 'T', color: '#ffc400' },
    'manager': { label: 'Manager', cls: 'manager', icon: 'T', color: '#ffc400' },
  };

  function getStatusDisplay(agent) {
    if (agent.processAlive && agent.isLaunched) return { color: '#4caf50', text: 'Answering', cls: 'answering', badge: '●' };
    if (agent.processAlive) return { color: '#4caf50', text: 'Answering', cls: 'answering', badge: '●' };
    if (agent.isLaunched) return { color: '#ffc400', text: 'Idle', cls: 'idle', badge: '~' };
    return { color: '#f44336', text: 'Not Connected', cls: 'offline', badge: '○' };
  }

  function rosterCardHTML(agent) {
    const t = typeInfo[agent.type] || { label: 'Agent', cls: 'default', icon: '?', color: '#1ba8b5' };
    const s = getStatusDisplay(agent);
    const actionBtn = agent.sessionActive
      ? `<span style="font-size:0.5rem;color:${s.color};">${s.badge} ${s.text}</span>`
      : `<button class="roster-launch-btn" data-team="${agent.teamName}" data-name="${agent.name}">Launch</button>`;
    const statusTitle = agent.statusDetail || agent.name;
    const categoryClass = agent.category === 'sub-agent' ? ' roster-card-sub' : '';
    return `
      <div class="roster-card${categoryClass}" data-status="${agent.statusDetail}" title="${statusTitle}">
        <div style="display:flex;">
          <div class="roster-avatar-icon">
            <div class="roster-icon ${s.cls}" style="background:${t.color};border-radius:50%;border:2px solid #fff;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:0.8rem;position:relative;">${t.icon}
              <span class="roster-status-dot" style="position:absolute;top:22px;right:4px;width:10px;height:10px;border-radius:50%;border:2px solid #2a2a4e;background:${s.color};"></span>
            </div>
          </div>
          <div class="roster-info">
            <div class="roster-info-left">
              <span class="roster-name">${agent.name} <span style="color:${s.color};font-size:0.6rem;">&#8226; ${s.text}</span></span>
              <span class="roster-team">Team: ${agent.teamName}</span>
            </div>
            <span class="roster-badge ${t.cls}">${t.label}</span>
          </div>
        </div>
        <div class="roster-desc">${agent.description || 'No description yet.'}<div style="text-align:right;margin-top:4px;">${actionBtn}</div></div>
      </div>
    `;
  }

  // Group by category: main agents first, sub-agents secondary
  const mainAgents = agentList.filter(a => a.category === 'main-agent');
  const subAgents = agentList.filter(a => a.category === 'sub-agent');
  const uncatAgents = agentList.filter(a => !a.category);

  let html = '';
  if (mainAgents.length > 0) {
    html += mainAgents.map(rosterCardHTML).join('');
  }
  if (subAgents.length > 0) {
    html += `<div class="roster-sub-section">
      <div class="roster-sub-header">Sub-Agents</div>
      ${subAgents.map(rosterCardHTML).join('')}
    </div>`;
  }
  if (uncatAgents.length > 0) {
    html += uncatAgents.map(rosterCardHTML).join('');
  }

  grid.innerHTML = html;

  // Bind launch buttons — opens Terminal.app automatically
  document.querySelectorAll('.roster-launch-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const team = btn.dataset.team;
      const name = btn.dataset.name;
      try {
        showNotification(`<strong>Opening "${name}" in Terminal...</strong>`, 2000);
        const resp = await fetch(`${API_BASE}/api/launch/${team}?agent=${encodeURIComponent(name)}`, { method: 'POST' });
        const result = await resp.json();
        if (result.success) {
          // Check if fallback (osascript failed)
          if (result.command || result.fallback) {
            const cmd = result.command || result.fallback;
            showNotification(`<strong>${result.message}</strong><br><code style="font-size:0.6rem;">${cmd}</code>`, 8000);
          } else {
            showNotification(`<strong>${result.message}</strong>`, 3000);
          }
        }
        setTimeout(refreshData, 3000);
      } catch (err) {
        console.error('Failed to launch agent:', err);
        showNotification('Failed to launch agent.', 3000);
      }
    });
  });
}

// Click handler for canvas - click on agents to inspect
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const clickX = e.clientX - rect.left + camX;
  const clickY = e.clientY - rect.top + camY;

  const agentPositions = getAgentPositions();
  for (const pos of agentPositions) {
    // Find the tile for the agent
    const tileX = pos.x;
    const tileY = pos.y;
    if (clickX >= tileX * TILE && clickX < (tileX + 1) * TILE &&
        clickY >= tileY * TILE && clickY < (tileY + 1) * TILE) {
      openAgentDetail(pos.agent.id);
      return;
    }
  }

  // Check if clicking near an agent's name tag
  for (const pos of agentPositions) {
    const agentX = pos.x * TILE;
    const agentY = pos.y * TILE - 8;
    if (clickX >= agentX && clickX < agentX + TILE &&
        clickY >= agentY && clickY < agentY + TILE) {
      openAgentDetail(pos.agent.id);
      return;
    }
  }
});

// Open agent detail modal
function openAgentDetail(agentId) {
  const agent = agents.find(a => a.id === agentId || a.name === agentId);
  if (!agent) return;

  document.getElementById('detailTitle').textContent = agent.name;
  document.getElementById('detailName').textContent = `Name: ${agent.name}`;
  document.getElementById('detailTeam').textContent = `Team: ${agent.teamName}`;
  document.getElementById('detailType').textContent = `Type: ${getAgentTypeClass(agent)}`;
  document.getElementById('detailDescription').value = agent.description || '';

  const typeClass = getAgentTypeClassLower(agent);
  const colors = { general: '#3c5aa6', explorer: '#4caf50', architect: '#9c27b0', reviewer: '#ff9800', default: '#1ba8b5' };
  const c = colors[typeClass] || colors.default;
  document.getElementById('detailSprite').innerHTML = `<span style="display:inline-block;width:40px;height:40px;background:${c};border:2px solid #fff;border-radius:50%;margin:0 auto;"></span>`;

  detailModal.dataset.agentId = agentId;
  detailModal.classList.add('visible');
}

// Save description
async function saveAgentDescription(agentId, description) {
  try {
    await fetch(`${API_BASE}/api/agents/${agentId}/description`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description })
    });
    showNotification('Description saved!', 3000);
  } catch (err) {
    console.error('Failed to save description:', err);
  }
}

// Shut down a team
async function shutDownTeam(teamName) {
  if (!confirm(`Shut down team "${teamName}"?`)) return;
  try {
    await fetch(`${API_BASE}/api/teams/${teamName}`, { method: 'DELETE' });
    showNotification(`Team "${teamName}" removed`, 4000);
    refreshData();
  } catch (err) {
    console.error('Failed to shut down team:', err);
  }
}

// Show notification
function showNotification(message, durationMs = 6000) {
  const container = document.getElementById('notifications');
  const notif = document.createElement('div');
  notif.className = 'battle-notification';
  notif.innerHTML = message;
  container.appendChild(notif);
  setTimeout(() => {
    notif.style.animation = 'slideUp 0.3s steps(3) reverse';
    setTimeout(() => notif.remove(), 300);
  }, durationMs);
}

// Auto-spawn agent via server
async function spawnAgent(name, role, prompt, description) {
  try {
    const response = await fetch(`${API_BASE}/api/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, role, prompt, description })
    });
    const data = await response.json();
    if (data.success) {
      showNotification(`<strong>Agent "${name}" launched!</strong><br>A new Terminal window opened.<br>The agent will appear on the map when active.`, 8000);
      // Auto-refresh after a delay to pick up the new agent
      setTimeout(refreshData, 3000);
    } else {
      showNotification(`Error: ${data.error}`, 5000);
    }
  } catch (err) {
    console.error('Failed to spawn agent:', err);
    showNotification(`Error spawning agent. Make sure Claude Code is installed.`, 5000);
  }
}

// Refresh all data
async function refreshData() {
  agents = await fetchAgents();
  const teams = await fetchTeams();
  renderHUD(agents, teams);
  loadingOverlay.classList.add('hidden');
}

// Bind event listeners
function bindFormEvents() {
  document.querySelectorAll('.cancel-hire').forEach(btn => {
    btn.onclick = () => hireModal.classList.remove('visible');
  });

  document.getElementById('closeHireModal').onclick = () => hireModal.classList.remove('visible');
  document.getElementById('closeDetailModal').onclick = () => detailModal.classList.remove('visible');
  document.getElementById('agentDetailModal').onclick = (e) => {
    if (e.target === detailModal) detailModal.classList.remove('visible');
  };
  document.getElementById('saveDescription').onclick = () => {
    saveAgentDescription(detailModal.dataset.agentId, document.getElementById('detailDescription').value);
  };
  document.getElementById('shutDownAgent').onclick = () => {
    const team = document.getElementById('detailTeam').textContent.replace('Team: ', '');
    shutDownTeam(team);
    detailModal.classList.remove('visible');
  };

  hireForm.onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('agentName').value;
    const role = document.getElementById('agentRole').value;
    const prompt = document.getElementById('agentPrompt').value;
    const description = document.getElementById('agentDescription').value;
    const fullPrompt = prompt || `${name} is a ${role} agent.`;

    hireForm.innerHTML = `
      <div style="text-align:center;padding:20px 0;">
        <span style="font-family:'Press Start 2P',monospace;font-size:0.7rem;">Spawning "${name}"...</span><br><br>
        <span style="font-size:1.5rem;">🐾</span><br><br>
        <span style="font-family:'Press Start 2P',monospace;font-size:0.5rem;color:#6a6a8e;">This will open a Claude session.<br>The agent will appear on the map shortly.</span>
      </div>
    `;

    spawnAgent(name, role, fullPrompt, description);
  };

  document.getElementById('hireBtn').onclick = () => {
    resetHireForm();
    hireModal.classList.add('visible');
  };
  document.getElementById('refreshBtn').onclick = () => {
    refreshData();
    showNotification('Agents refreshed!', 2000);
  };
  document.getElementById('wakeAgentsBtn').onclick = async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/launch-all`, { method: 'POST' });
      const result = await resp.json();
      if (!result.success || result.count === 0) {
        showNotification(`<strong>No agents to launch.</strong><br>${result.message || ''}`, 3000);
        return;
      }

      showNotification(`<strong>Opened ${result.count} agent(s) in Terminal!</strong><br>${result.opened.join(', ')}`, 6000);
      setTimeout(refreshData, 3000);
    } catch (err) {
      console.error('Wake agents up error:', err);
      showNotification('Failed to launch agents.', 3000);
    }
  };
}

function resetHireForm() {
  hireForm.innerHTML = `
    <div class="form-group">
      <label for="agentName">Agent Name</label>
      <input type="text" id="agentName" placeholder="e.g., Spark, Bolt, Flameon..." class="pixel-input" autofocus>
    </div>
    <div class="form-group">
      <label for="agentRole">Agent Type</label>
      <select id="agentRole" class="pixel-input">
        <option value="trevor">Trevor (Manager)</option>
        <option value="manager">Manager (Trevor)</option>
        <option value="luca">Backend Node.js (Luca)</option>
        <option value="ellie">Frontend UI/UX (Ellie)</option>
        <option value="general-purpose">General Purpose</option>
        <option value="Explore">Explorer</option>
        <option value="Plan">Architect</option>
        <option value="code-reviewer">Code Reviewer</option>
        <option value="silent-failure-hunter">Bug Hunter</option>
      </select>
    </div>
    <div class="form-group">
      <label for="agentPrompt">Task / Prompt</label>
      <textarea id="agentPrompt" placeholder="What should this agent work on?" class="pixel-input" rows="4"></textarea>
    </div>
    <div class="form-group">
      <label for="agentDescription">Description</label>
      <input type="text" id="agentDescription" placeholder="e.g., A brave fire-type agent" class="pixel-input">
    </div>
    <div class="modal-actions">
      <button type="button" class="btn pixel-btn cancel-hire">Cancel</button>
      <button type="submit" class="btn pixel-btn btn-hire">Hire!</button>
    </div>
  `;
  bindFormEvents();
}

// Keyboard close modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hireModal.classList.remove('visible');
    detailModal.classList.remove('visible');
  }
});

// Time display
function updateTime() {
  const now = new Date();
  document.getElementById('currentTime').textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// Initialize
resizeCanvas();
window.addEventListener('resize', resizeCanvas);
officeMap = getMap();
bindFormEvents();
updateTime();
setInterval(updateTime, 1000);
requestAnimationFrame(render);
refreshData();

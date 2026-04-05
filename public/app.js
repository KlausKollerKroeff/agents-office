// Agent Office - Pixelmon Edition
// Walkable 2D Office Canvas

const API_BASE = '';
const REFRESH_INTERVAL = 8000;
let refreshTimer = null;
let agents = [];

// Canvas
const canvas = document.getElementById('officeCanvas');
const ctx = canvas.getContext('2d');

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

// Office map layout (1 = wall, 0 = floor, 2 = desk, 3 = resting room, 4 = tennis, 5 = basketball, 6 = door, 7 = plant, 8 = lounge chair)
// The office is a grid. Agents are placed on desk tiles.
function getMap() {
  const map = [];
  for (let y = 0; y < ROWS; y++) {
    const row = [];
    for (let x = 0; x < COLS; x++) {
      // Outer walls
      if (y === 0 || y === ROWS - 1 || x === 0 || x === COLS - 1) {
        row.push(1);
      } else {
        row.push(0);
      }
    }
    map.push(row);
  }

  // --- Main Office Area (top-center) ---
  // Desks in a row
  for (let i = 0; i < 4; i++) {
    map[3][5 + i * 3] = 2; // Desk
    map[3][6 + i * 3] = 2; // Chair
  }
  for (let i = 0; i < 4; i++) {
    map[7][5 + i * 3] = 2;
    map[7][6 + i * 3] = 2;
  }

  // --- Resting Rooms (right side) ---
  // Walls of resting rooms
  for (let y = 2; y <= 10; y++) {
    map[y][28] = 1;
    map[y][35] = 1;
  }
  map[2][28] = 1; map[2][35] = 1;
  map[10][28] = 1; map[10][35] = 1;
  // Door gap
  map[6][35] = 6;
  map[10][28] = 6; map[10][29] = 6; map[10][30] = 6; map[10][31] = 6;

  // Lounge chairs inside resting room
  map[4][30] = 8;
  map[4][32] = 8;
  map[4][34] = 8;
  map[7][30] = 8;
  map[7][32] = 8;
  map[7][34] = 8;

  // --- Sports Area (bottom-center) ---
  // Tennis court
  for (let y = 15; y <= 23; y++) {
    map[y][5] = 1;
    map[y][14] = 1;
  }
  map[15][5] = 1; map[15][14] = 1;
  map[23][5] = 1; map[23][14] = 1;
  map[15][7] = 6; map[15][8] = 6; // Door
  map[15][11] = 6; map[15][12] = 6;

  // Basketball court
  for (let y = 15; y <= 23; y++) {
    map[y][19] = 1;
    map[y][28] = 1;
  }
  map[15][19] = 1; map[15][28] = 1;
  map[23][19] = 1; map[23][28] = 1;
  map[15][21] = 6; map[15][22] = 6;
  map[15][25] = 6; map[15][26] = 6;

  // Plants (decorations)
  map[2][2] = 7; map[2][10] = 7;
  map[2][20] = 7; map[2][26] = 7;

  // Water fountain
  map[12][17] = 50;

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

// Agent sprites on the map (placed on desk tiles)
function getAgentPositions() {
  const positions = [];
  // Fixed desk positions matching the map
  const desks = [
    { x: 5, y: 3 }, { x: 8, y: 3 }, { x: 11, y: 3 }, { x: 14, y: 3 },
    { x: 5, y: 7 }, { x: 8, y: 7 }, { x: 11, y: 7 }, { x: 14, y: 7 }
  ];

  agents.forEach((agent, i) => {
    if (i < desks.length) {
      positions.push({ ...desks[i], agent });
    }
  });

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

// Draw agent sprite (pixel character) with agent-specific skins
function drawAgentSprite(agent, screenX, screenY) {
  const name = agent.name.toLowerCase();

  // Draw agent-specific body
  switch (name) {
    case 'trevor': drawTrevorSprite(screenX, screenY); break;
    case 'luca': drawLucaSprite(screenX, screenY); break;
    case 'ellie': drawEllieSprite(screenX, screenY); break;
    case 'mateo': drawMateoSprite(screenX, screenY); break;
    default: drawGenericSprite(agent, screenX, screenY); break;
  }

  // Status indicator (top-right) — colored dot based on session state
  const dotX = screenX + TILE - 6;
  const dotY = screenY - 4;
  if (agent.sessionActive) {
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(dotX, dotY, 5, 5);
  } else {
    // Pulsing yellow for registered
    const pulse = Math.sin(Date.now() / 500) * 0.3 + 0.5;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ffc400';
    ctx.fillRect(dotX, dotY, 5, 5);
    ctx.globalAlpha = 1;

    // Zzz for sleeping
    ctx.fillStyle = '#ffc400';
    ctx.font = '6px "Press Start 2P", monospace';
    const zOff = Math.sin(Date.now() / 300) * 2;
    ctx.fillText('Z', screenX + TILE, screenY - 8 + zOff);
  }

  // Name tag (always on top)
  ctx.fillStyle = '#2a2a4e';
  ctx.font = 'bold 7px "Press Start 2P", monospace';
  const nameWidth = ctx.measureText(agent.name).width;
  const tagX = screenX + (TILE - nameWidth - 6) / 2;
  const tagY = screenY - 2;
  ctx.fillRect(tagX - 1, tagY - 1, nameWidth + 8, 9);
  ctx.fillStyle = '#ffc400';
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

// Draw sports courts on the floor
function drawSportsFloor() {
  // Tennis court (x: 6-13, y: 16-22)
  ctx.fillStyle = '#3a7a3a';
  ctx.fillRect(6 * TILE - camX + 4, 16 * TILE - camY + 4, 8 * TILE - 8, 6 * TILE - 8);
  // Net
  ctx.fillStyle = '#fff';
  ctx.fillRect(9 * TILE - camX - 1, 16 * TILE - camY + 4, 3, 6 * TILE - 8);
  // Court lines
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(6 * TILE - camX + 4, 16 * TILE - camY + 4, 8 * TILE - 8, 6 * TILE - 8);

  // Label
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '5px "Press Start 2P", monospace';
  ctx.fillText('TENNIS', 8 * TILE - camX, 18 * TILE - camY);

  // Basketball court (x: 20-27, y: 16-22)
  ctx.fillStyle = '#c4963a';
  ctx.fillRect(20 * TILE - camX + 4, 16 * TILE - camY + 4, 7 * TILE - 8, 6 * TILE - 8);
  // Paint area
  ctx.fillStyle = 'rgba(255,87,34,0.3)';
  ctx.fillRect(24 * TILE - camX + 4, 18 * TILE - camY, 3 * TILE - 8, 4 * TILE - 8);
  // Hoop
  ctx.fillStyle = '#ff5722';
  ctx.beginPath();
  ctx.arc(26 * TILE - camX, 20 * TILE - camY, 6, 0, Math.PI * 2);
  ctx.fill();
  // Circle
  ctx.strokeStyle = '#fff';
  ctx.beginPath();
  ctx.arc(23 * TILE - camX, 20 * TILE - camY, 8, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('BASKETBALL', 22 * TILE - camX, 18 * TILE - camY);

  // Resting room label (x: 29-34, y: 3-9)
  ctx.fillStyle = 'rgba(255,152,0,0.2)';
  ctx.fillRect(29 * TILE - camX, 3 * TILE - camY, 5 * TILE, 6 * TILE);
  ctx.fillStyle = 'rgba(255,152,0,0.6)';
  ctx.font = '6px "Press Start 2P", monospace';
  ctx.fillText('RESTING ROOM', 30 * TILE - camX, 5 * TILE - camY);

  // Wall labels for rooms
  ctx.fillStyle = '#ffc400';
  ctx.font = '4px "Press Start 2P", monospace';
  ctx.fillText('OFFICE', 8 * TILE - camX, 2 * TILE - camY);
}

// Draw player
function drawPlayer() {
  const screenX = player.x * TILE - camX;
  const screenY = player.y * TILE - camY;

  // Bob animation
  const bob = Math.sin(player.pixelBob) * 2;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(screenX + TILE / 2, screenY + TILE + 2, 12, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = '#e53935';
  ctx.fillRect(screenX + 14, screenY + 12 + bob, 20, 22);
  // Head
  ctx.fillStyle = '#fdd8a5';
  ctx.fillRect(screenX + 16, screenY + 2 + bob, 16, 14);
  // Hat (red cap like a Pokemon trainer)
  ctx.fillStyle = '#e53935';
  ctx.fillRect(screenX + 14, screenY - 2 + bob, 20, 6);
  ctx.fillRect(screenX + 14, screenY + 2 + bob, 26, 3);
  // Eyes
  ctx.fillStyle = '#1a1a2e';
  const eyeOffX = player.dir === 'left' ? -2 : player.dir === 'right' ? 2 : 0;
  const eyeOffY = player.dir === 'up' ? -4 : player.dir === 'down' ? 2 : 0;
  if (player.dir !== 'up') {
    ctx.fillRect(screenX + 19 + eyeOffX, screenY + 8 + bob + eyeOffY, 3, 3);
    ctx.fillRect(screenX + 26 + eyeOffX, screenY + 8 + bob + eyeOffY, 3, 3);
  }
  // Legs
  ctx.fillStyle = '#1565c0';
  ctx.fillRect(screenX + 14, screenY + 32 + bob, 8, 12);
  ctx.fillRect(screenX + 26, screenY + 32 + bob, 8, 12);
  // Shoes
  ctx.fillStyle = '#fff';
  ctx.fillRect(screenX + 12, screenY + 42 + bob, 10, 4);
  ctx.fillRect(screenX + 24, screenY + 42 + bob, 10, 4);
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

  grid.innerHTML = agentList.map(agent => {
    const t = typeInfo[agent.type] || { label: 'Agent', cls: 'default', icon: '?', color: '#1ba8b5' };
    const statusColor = agent.sessionActive ? '#4caf50' : '#ffc400';
    const statusText = agent.sessionActive ? 'Running' : 'Offline';
    const actionBtn = agent.sessionActive
      ? '<span style="font-size:0.5rem;color:#4caf50;">✓ Running</span>'
      : `<button class="roster-launch-btn" data-team="${agent.teamName}" data-name="${agent.name}">Launch</button>`;
    return `
      <div style="background:#2a2a4e;margin:4px;border:var(--border-thick) solid var(--panel-border);cursor:pointer;">
        <div style="display:flex;">
          <div class="roster-avatar-icon">
            <div class="roster-icon" style="background:${t.color};border-radius:50%;border:2px solid #fff;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:0.8rem;">${t.icon}</div>
          </div>
          <div class="roster-info">
            <div class="roster-info-left">
              <span class="roster-name">${agent.name} <span style="color:${statusColor};font-size:0.6rem;">&#8226; ${statusText}</span></span>
              <span class="roster-team">Team: ${agent.teamName}</span>
            </div>
            <span class="roster-badge ${t.cls}">${t.label}</span>
          </div>
        </div>
        <div class="roster-desc">${agent.description || 'No description yet.'}<div style="text-align:right;margin-top:4px;">${actionBtn}</div></div>
      </div>
    `;
  }).join('');

  // Bind launch buttons — opens Terminal.app automatically
  document.querySelectorAll('.roster-launch-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const team = btn.dataset.team;
      const name = btn.dataset.name;
      try {
        showNotification(`<strong>Opening "${name}" in Terminal...</strong>`, 2000);
        const resp = await fetch(`${API_BASE}/api/launch/${team}`, { method: 'POST' });
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

// Pac-Man: the classic 28×31 maze (a string map), its dots and four power pellets, the tunnels at the sides; Pac-Man
// chomps along the tiles (arrows or WASD, a turn pressed early is kept until the corner), chased by four ghosts with
// their own habits — Blinky goes straight for you, Pinky aims ahead of you, Inky takes Blinky's position into account
// and Clyde keeps his distance — in turns of scatter and chase. A power pellet turns them blue (white blinks near the
// end) and eatable for 200, 400, 800 and 1600 points; their eyes go home and they come back. Three lives, a fruit
// after enough dots, the maze blinks when cleared and the next level is faster. Sixty frames a second on the grid.
import { useEffect, useRef } from 'react';
import { useT } from '@/lib/i18n.js';
import { useKeys, useLoop, palette, setupCanvas, tint, mix, Particles, reducedMotion, font, corner, label, clamp } from './kit.js';
import { sfx } from './sfx.js';

const MAP = [
  '############################', '#............##............#', '#.####.#####.##.#####.####.#', '#o####.#####.##.#####.####o#',
  '#.####.#####.##.#####.####.#', '#..........................#', '#.####.##.########.##.####.#', '#.####.##.########.##.####.#',
  '#......##....##....##......#', '######.##### ## #####.######', '     #.##### ## #####.#     ', '     #.##          ##.#     ',
  '     #.## ###--### ##.#     ', '######.## #      # ##.######', '      .   #      #   .      ', '######.## #      # ##.######',
  '     #.## ######## ##.#     ', '     #.##          ##.#     ', '     #.## ######## ##.#     ', '######.## ######## ##.######',
  '#............##............#', '#.####.#####.##.#####.####.#', '#.####.#####.##.#####.####.#', '#o..##.......  .......##..o#',
  '###.##.##.########.##.##.###', '###.##.##.########.##.##.###', '#......##....##....##......#', '#.##########.##.##########.#',
  '#.##########.##.##########.#', '#..........................#', '############################'
];
const W = 28; const H = 31; const T = 20; const HUD = 26; const WIDTH = W * T; const HEIGHT = H * T + HUD;
const TUNNEL = 14; const DOOR = { x: 14, y: 11.5 }; const HOME = { x: 14, y: 14.5 }; const PAC_START = { x: 14, y: 23.5 }; const FRUIT_AT = { x: 14, y: 17.5 };
const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
const ORDER = [[0, -1], [-1, 0], [0, 1], [1, 0]]; // ties: up, left, down, right (as the arcade)
const GHOSTS = [
  { name: 'blinky', color: '#ff3b3b', start: { x: 14, y: 11.5 }, home: { x: 14, y: 14.5 }, corner: [25, -3], dots: 0, wait: 0 },
  { name: 'pinky', color: '#ffb8ff', start: { x: 14, y: 14.5 }, home: { x: 14, y: 14.5 }, corner: [2, -3], dots: 0, wait: 1200 },
  { name: 'inky', color: '#00f0ff', start: { x: 12, y: 14.5 }, home: { x: 12, y: 14.5 }, corner: [27, 32], dots: 30, wait: 5000 },
  { name: 'clyde', color: '#ffb852', start: { x: 16, y: 14.5 }, home: { x: 16, y: 14.5 }, corner: [0, 32], dots: 60, wait: 9000 }
];
const PAC = '#ffe733'; const DOT = '#ffb8ae'; const FRIGHT = '#2121ff'; const FRIGHT_FACE = '#ffb8ff';
// Difficulty: speeds in tiles per second, the frightened time, the scatter turns.
const CFG = {
  facil: { pac: 7.2, ghost: 5.8, fright: 8000, scatter: [7000, 20000, 7000, 20000, 5000] },
  normal: { pac: 8, ghost: 7.2, fright: 6000, scatter: [7000, 20000, 7000, 20000, 5000] },
  dificil: { pac: 8.6, ghost: 8.4, fright: 4000, scatter: [5000, 20000, 5000, 20000, 3000] }
};
const FRUIT_POINTS = [100, 300, 500, 700, 1000, 2000, 3000, 5000];

const cell = (x, y) => (y < 0 || y >= H ? '#' : x < 0 || x >= W ? (y === TUNNEL ? ' ' : '#') : MAP[y][x]);
const openFor = (who) => (x, y) => { const c = cell(x, y); return c !== '#' && (c !== '-' || who === 'ghostDoor'); };
const walkable = openFor('pac'); const ghostWalk = openFor('ghost'); const doorWalk = openFor('ghostDoor');
const dots = () => { const m = new Map(); MAP.forEach((row, y) => { for (let x = 0; x < W; x++) if (row[x] === '.' || row[x] === 'o') m.set(y * W + x, row[x]); }); return m; };
const tileOf = (e) => [Math.floor(e.x), Math.floor(e.y)];
const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

// Moves an entity along the grid by `dist` tiles: it goes from tile centre to tile centre and `arrive` decides the
// direction at each one (it may stop it). The tunnel wraps around.
function move(e, dist, open, arrive) {
  let guard = 12;
  while (dist > 1e-6 && guard-- > 0) {
    if (!e.dx && !e.dy) return;
    const cx = Math.floor(e.x) + 0.5; const cy = Math.floor(e.y) + 0.5;
    const toC = (cx - e.x) * e.dx + (cy - e.y) * e.dy;
    if (toC > 1e-6) {
      const st = Math.min(dist, toC); e.x += e.dx * st; e.y += e.dy * st; dist -= st;
      if (st < toC) return;
      e.x = cx; e.y = cy; arrive(e); continue;
    }
    const nx = Math.floor(cx) + e.dx; const ny = Math.floor(cy) + e.dy;
    if (!open(nx, ny)) { e.x = cx; e.y = cy; e.dx = 0; e.dy = 0; return; }
    const toNext = 1 + toC; const st = Math.min(dist, toNext);
    e.x += e.dx * st; e.y += e.dy * st; dist -= st;
    if (e.x < 0) e.x += W; else if (e.x >= W) e.x -= W;
    if (st >= toNext - 1e-9) { e.x = Math.floor(e.x) + 0.5; e.y = Math.floor(e.y) + 0.5; arrive(e); }
  }
}

// The maze walls, drawn once per look: each wall tile is a rounded square (round where a corner is free) in the line
// colour and a smaller one inside in the board colour, so the union leaves only the outlines, as the arcade.
function paintMaze(mazeCanvas, p, line, board) {
  const ratio = window.devicePixelRatio || 1;
  mazeCanvas.width = Math.round(WIDTH * ratio); mazeCanvas.height = Math.round(H * T * ratio);
  const ctx = mazeCanvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = board; ctx.fillRect(0, 0, WIDTH, H * T);
  const isW = (x, y) => (y < 0 || y >= H || x < 0 || x >= W) ? true : MAP[y][x] === '#';
  const lw = 2.5; const r = T * 0.5; const cells = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isW(x, y)) cells.push({ x, y, L: !isW(x - 1, y), R: !isW(x + 1, y), U: !isW(x, y - 1), D: !isW(x, y + 1) });
  const rr = (x, y, w, h, radii, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, radii) : ctx.rect(x, y, w, h); ctx.fill(); };
  ctx.save(); ctx.shadowColor = tint(line, 0.55); ctx.shadowBlur = p.skin === 'retro' ? 0 : 6;
  for (const c of cells) rr(c.x * T, c.y * T, T, T, [c.L && c.U ? r : 0, c.R && c.U ? r : 0, c.R && c.D ? r : 0, c.L && c.D ? r : 0], line);
  ctx.restore();
  for (const c of cells) {
    const l = c.L ? lw : 0; const u = c.U ? lw : 0; const rt = c.R ? lw : 0; const d = c.D ? lw : 0; const ir = Math.max(0, r - lw);
    rr(c.x * T + l, c.y * T + u, T - l - rt, T - u - d, [c.L && c.U ? ir : 0, c.R && c.U ? ir : 0, c.R && c.D ? ir : 0, c.L && c.D ? ir : 0], board);
  }
  // The corners where the wall turns inwards: a small square so the line does not break.
  ctx.fillStyle = line;
  for (const c of cells) {
    if (!c.L && !c.U && !isW(c.x - 1, c.y - 1)) ctx.fillRect(c.x * T, c.y * T, lw, lw);
    if (!c.R && !c.U && !isW(c.x + 1, c.y - 1)) ctx.fillRect(c.x * T + T - lw, c.y * T, lw, lw);
    if (!c.R && !c.D && !isW(c.x + 1, c.y + 1)) ctx.fillRect(c.x * T + T - lw, c.y * T + T - lw, lw, lw);
    if (!c.L && !c.D && !isW(c.x - 1, c.y + 1)) ctx.fillRect(c.x * T, c.y * T + T - lw, lw, lw);
  }
  // The door of the ghost house.
  ctx.fillStyle = FRIGHT_FACE; ctx.fillRect(13 * T, 12 * T + T / 2 - 2, 2 * T, 4);
}

function ghostShape(ctx, x, y, r, phase) {
  ctx.beginPath(); ctx.arc(x, y - r * 0.15, r, Math.PI, 0);
  const bottom = y + r * 0.85; const n = 3; const bw = (2 * r) / n;
  ctx.lineTo(x + r, bottom);
  for (let i = 0; i < n; i++) { const x0 = x + r - i * bw; const up = phase ? (i % 2 === 0) : (i % 2 === 1); ctx.lineTo(x0 - bw / 2, bottom - (up ? r * 0.3 : -r * 0.05)); ctx.lineTo(x0 - bw, bottom); }
  ctx.closePath();
}

export default function Pacman({ level, onScore, onOver, paused }) {
  const t = useT();
  const canvas = useRef(null);
  const maze = useRef(null);
  const g = useRef(null);
  const cfg = CFG[level];
  const newGhosts = () => GHOSTS.map((d) => ({ ...d, x: d.start.x, y: d.start.y, dx: d.name === 'blinky' ? -1 : 0, dy: 0, mode: d.name === 'blinky' ? 'scatter' : 'house', scared: false, bob: 0, frame: 0 }));
  if (!g.current) {
    g.current = {
      pac: { x: PAC_START.x, y: PAC_START.y, dx: 0, dy: 0, want: null, mouth: 0, chomp: 0 }, ghosts: newGhosts(), dots: dots(), eaten: 0, level: 1, lives: 3, score: 0, extra: false,
      state: 'ready', timer: 1500, mode: 'scatter', modeIdx: 0, modeTimer: CFG[level].scatter[0], fright: 0, combo: 0, freeze: 0, since: 0, lastDot: 0,
      fruit: null, fruitShown: 0, pops: [], over: false, time: 0, sparks: new Particles(), mazeKey: '', flashOn: false
    };
    if (import.meta.env.DEV) { window.__pacman = g.current; g.current.map = MAP; } // the preview's bot reads the world to play and take pictures
  }
  useKeys((key) => { const d = DIRS[key] ?? DIRS[key.toLowerCase?.()]; if (!d) return false; g.current.pac.want = d; return true; });
  const readyText = label(t, 'games.pacmanReady', 'READY!');
  const levelText = (n) => label(t, 'games.pacmanLevel', 'Nivel {n}').replace('{n}', String(n));

  const speedUp = () => 1 + Math.min(0.3, 0.05 * (g.current.level - 1));
  const frightTime = () => Math.max(1500, cfg.fright - 500 * (g.current.level - 1));
  const resetPositions = () => { const s = g.current; s.pac = { ...s.pac, x: PAC_START.x, y: PAC_START.y, dx: 0, dy: 0, want: null, mouth: 0 }; s.ghosts = newGhosts(); s.mode = 'scatter'; s.modeIdx = 0; s.modeTimer = cfg.scatter[0]; s.fright = 0; s.combo = 0; s.since = 0; s.lastDot = 0; s.fruit = null; };
  const addScore = (n) => { const s = g.current; s.score += n; if (!s.extra && s.score >= 10000) { s.extra = true; s.lives++; } onScore(s.score); };
  const pop = (x, y, text, color) => g.current.pops.push({ x, y, text, color, ttl: 1000 });

  // Where each ghost wants to go.
  const target = (gh) => {
    const s = g.current; const pac = s.pac; const [px, py] = tileOf(pac);
    if (gh.mode === 'eyes') return [13, 11];
    if (gh.mode === 'scatter') return gh.corner;
    if (gh.name === 'blinky') return [px, py];
    if (gh.name === 'pinky') return [px + pac.dx * 4, py + pac.dy * 4];
    if (gh.name === 'inky') { const b = s.ghosts[0]; const ax = px + pac.dx * 2; const ay = py + pac.dy * 2; return [ax + (ax - Math.floor(b.x)), ay + (ay - Math.floor(b.y))]; }
    return dist2(px, py, gh.x, gh.y) > 64 ? [px, py] : gh.corner; // clyde
  };
  const ghostArrive = (gh) => {
    const [tx, ty] = tileOf(gh); const open = gh.mode === 'eyes' ? doorWalk : ghostWalk;
    const options = ORDER.filter(([dx, dy]) => !(dx === -gh.dx && dy === -gh.dy) && open(tx + dx, ty + dy));
    if (!options.length) { gh.dx = -gh.dx; gh.dy = -gh.dy; return; }
    let pick;
    if (gh.mode === 'fright') pick = options[Math.floor(Math.random() * options.length)];
    else { const [gx, gy] = target(gh); pick = options.reduce((a, b) => (dist2(tx + b[0], ty + b[1], gx, gy) < dist2(tx + a[0], ty + a[1], gx, gy) ? b : a)); }
    gh.dx = pick[0]; gh.dy = pick[1];
    if (gh.mode === 'eyes' && tx === 13 && ty === 11) { gh.mode = 'entering'; gh.dx = 0; gh.dy = 0; }
  };
  const pacArrive = (e) => {
    const [tx, ty] = tileOf(e);
    if (e.want && walkable(tx + e.want[0], ty + e.want[1])) { e.dx = e.want[0]; e.dy = e.want[1]; }
    else if (!walkable(tx + e.dx, ty + e.dy)) { e.dx = 0; e.dy = 0; }
  };
  const ghostSpeed = (gh) => {
    const base = cfg.ghost * speedUp() / 1000;
    if (gh.mode === 'eyes') return base * 1.8;
    if (gh.mode === 'fright') return base * 0.55;
    if (Math.floor(gh.y) === TUNNEL && (gh.x < 6 || gh.x > 22)) return base * 0.5;
    return base;
  };
  const setFright = () => {
    const s = g.current; s.fright = frightTime(); s.combo = 0;
    for (const gh of s.ghosts) { if (gh.mode === 'chase' || gh.mode === 'scatter') { gh.mode = 'fright'; gh.dx = -gh.dx; gh.dy = -gh.dy; } if (gh.mode !== 'eyes' && gh.mode !== 'entering') gh.scared = true; }
  };
  const endFright = () => { const s = g.current; s.fright = 0; for (const gh of s.ghosts) { gh.scared = false; if (gh.mode === 'fright') gh.mode = s.mode; } };
  const die = () => { const s = g.current; sfx('pac.death', null, { delay: 0.25 }); s.state = 'dying'; s.timer = 1700; s.pac.dx = 0; s.pac.dy = 0; };

  const draw = () => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
    const s = g.current; const p = palette(); const rm = reducedMotion();
    const board = p.dark ? mix(mix(p.bg, '#000000', 0.55), p.primary, 0.06) : mix('#070a18', p.primary, 0.14);
    const line = p.dark ? mix('#3d5afe', p.primary, 0.45) : mix('#4f6bff', p.primary, 0.45);
    const key = `${p.skin}|${p.dark}|${s.flashOn}|${window.devicePixelRatio}`;
    if (key !== s.mazeKey) { paintMaze(maze.current, p, s.flashOn ? '#ffffff' : line, board); s.mazeKey = key; }
    ctx.save();
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, WIDTH, HEIGHT, corner(p, 14)) : ctx.rect(0, 0, WIDTH, HEIGHT); ctx.clip();
    ctx.fillStyle = board; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.drawImage(maze.current, 0, 0, WIDTH, H * T);
    // The dots and the pellets (these breathe).
    const pulse = rm ? 1 : 0.8 + 0.2 * Math.sin(s.time / 160);
    ctx.fillStyle = DOT;
    for (const [k, v] of s.dots) {
      const x = (k % W) * T + T / 2; const y = Math.floor(k / W) * T + T / 2;
      if (v === '.') ctx.fillRect(x - T * 0.1, y - T * 0.1, T * 0.2, T * 0.2);
      else { ctx.beginPath(); ctx.arc(x, y, T * 0.32 * pulse, 0, Math.PI * 2); ctx.fill(); }
    }
    if (s.fruit) {
      const fx = s.fruit.x * T; const fy = s.fruit.y * T;
      ctx.strokeStyle = '#7bd36a'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(fx - 4, fy + 2); ctx.quadraticCurveTo(fx, fy - 10, fx + 7, fy - 9); ctx.moveTo(fx + 5, fy + 3); ctx.quadraticCurveTo(fx + 5, fy - 6, fx + 7, fy - 9); ctx.stroke();
      ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(fx - 4, fy + 4, 5, 0, Math.PI * 2); ctx.arc(fx + 5, fy + 5, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = tint('#ffffff', 0.6); ctx.beginPath(); ctx.arc(fx - 6, fy + 2, 1.6, 0, Math.PI * 2); ctx.arc(fx + 3, fy + 3, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    // Pac-Man: a wedge that opens and closes as he goes, or the spin of the death.
    const pac = s.pac; const pr = T * 0.72; const px = pac.x * T; const py = pac.y * T;
    const hidePac = s.freeze > 0 || (s.state === 'dying' && s.timer < 250);
    if (!hidePac && !s.over) {
      let angle = Math.atan2(pac.dy, pac.dx); if (!pac.dx && !pac.dy) angle = pac.lastAngle ?? Math.PI; pac.lastAngle = angle;
      let open = pac.mouth * 0.55;
      if (s.state === 'dying') { const k = clamp(1 - (s.timer - 250) / 1200, 0, 1); open = Math.PI * k; angle = -Math.PI / 2; }
      ctx.fillStyle = PAC; ctx.beginPath(); ctx.moveTo(px, py); ctx.arc(px, py, pr, angle + open, angle - open + Math.PI * 2); ctx.closePath(); ctx.fill();
    }
    // The ghosts.
    const flashing = s.fright > 0 && s.fright < 2000 && !rm && Math.floor(s.fright / 200) % 2 === 1;
    for (const gh of s.ghosts) {
      if (s.state === 'dying' && s.timer < 1450) continue;
      if (s.freeze > 0 && gh.justEaten) continue;
      const gx = gh.x * T; const gy = (gh.y + (gh.mode === 'house' ? gh.bob : 0)) * T; const r = T * 0.72;
      const scared = gh.mode === 'fright' || (gh.scared && (gh.mode === 'house' || gh.mode === 'leaving'));
      const phase = Math.floor(s.time / 140) % 2 === 0;
      if (gh.mode !== 'eyes' && gh.mode !== 'entering') {
        ctx.fillStyle = scared ? (flashing ? '#f0f0ff' : FRIGHT) : gh.color;
        ghostShape(ctx, gx, gy, r, phase); ctx.fill();
      }
      if (scared && gh.mode !== 'eyes') {
        const face = flashing ? '#ff3b3b' : FRIGHT_FACE; ctx.fillStyle = face;
        ctx.fillRect(gx - r * 0.45 - 1.5, gy - r * 0.3, 3, 3); ctx.fillRect(gx + r * 0.45 - 1.5, gy - r * 0.3, 3, 3);
        ctx.strokeStyle = face; ctx.lineWidth = 1.6; ctx.beginPath();
        for (let i = 0; i <= 6; i++) { const zx = gx - r * 0.6 + (i * r * 1.2) / 6; const zy = gy + r * 0.35 + (i % 2 ? -2.5 : 0); if (i) ctx.lineTo(zx, zy); else ctx.moveTo(zx, zy); }
        ctx.stroke();
      } else {
        const ex = gh.dx * 1.5; const ey = gh.dy * 1.5; ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(gx - r * 0.38 + ex, gy - r * 0.2 + ey, r * 0.26, r * 0.34, 0, 0, Math.PI * 2); ctx.ellipse(gx + r * 0.38 + ex, gy - r * 0.2 + ey, r * 0.26, r * 0.34, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2233ff';
        ctx.beginPath(); ctx.arc(gx - r * 0.38 + ex * 2.2, gy - r * 0.2 + ey * 2.2, r * 0.14, 0, Math.PI * 2); ctx.arc(gx + r * 0.38 + ex * 2.2, gy - r * 0.2 + ey * 2.2, r * 0.14, 0, Math.PI * 2); ctx.fill();
      }
    }
    s.sparks.draw(ctx);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    for (const q of s.pops) { ctx.globalAlpha = Math.min(1, q.ttl / 300); ctx.fillStyle = q.color; ctx.font = font(p, 12, 800); ctx.fillText(q.text, q.x * T, q.y * T - (1000 - q.ttl) / 60); }
    ctx.globalAlpha = 1;
    if (s.state === 'ready') { ctx.font = font(p, 15, 800); ctx.fillStyle = '#ffe733'; ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 6; ctx.fillText(readyText, FRUIT_AT.x * T, FRUIT_AT.y * T); ctx.shadowBlur = 0; }
    // The HUD under the maze: the lives and the level.
    const hy = H * T + HUD / 2;
    for (let i = 0; i < Math.max(0, s.lives - 1); i++) { const lx = 16 + i * 20; ctx.fillStyle = PAC; ctx.beginPath(); ctx.moveTo(lx, hy); ctx.arc(lx, hy, 7, Math.PI * 1.2, Math.PI * 0.8); ctx.closePath(); ctx.fill(); }
    ctx.font = font(p, 11, 700); ctx.textAlign = 'right'; ctx.fillStyle = tint('#ffffff', 0.75); ctx.fillText(levelText(s.level).toUpperCase(), WIDTH - 12, hy);
    for (let i = 0; i < Math.min(5, s.level - 1); i++) { const cx = WIDTH - 90 - i * 16; ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(cx - 2, hy + 2, 3.5, 0, Math.PI * 2); ctx.arc(cx + 4, hy + 3, 3.5, 0, Math.PI * 2); ctx.fill(); }
    if (p.skin === 'retro') { ctx.fillStyle = 'rgba(0,0,0,.2)'; for (let y = 0; y < HEIGHT; y += 3) ctx.fillRect(0, y, WIDTH, 1); }
    ctx.restore();
  };

  useEffect(() => { maze.current = document.createElement('canvas'); setupCanvas(canvas.current, WIDTH, HEIGHT); draw(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLoop((dt) => {
    const s = g.current; const rm = reducedMotion();
    s.time += dt; s.sparks.step(dt);
    for (const q of s.pops) q.ttl -= dt; s.pops = s.pops.filter((q) => q.ttl > 0);
    if (s.over) { draw(); return; }
    if (s.state === 'ready') { if (!s.tuned) { s.tuned = true; sfx('pac.start', null, { delay: 0.35 }); } s.timer -= dt; if (s.timer <= 0) { s.state = 'play'; s.pac.dx = -1; s.pac.dy = 0; } draw(); return; }
    if (s.state === 'dying') {
      s.timer -= dt;
      if (s.timer < 250 && !s.puffed) { s.puffed = true; s.sparks.burst(s.pac.x * T, s.pac.y * T, PAC, 14, 0.2, 2.5); }
      if (s.timer <= 0) {
        s.puffed = false; s.lives--;
        if (s.lives <= 0) { s.over = true; draw(); onOver(s.score); return; }
        resetPositions(); s.state = 'ready'; s.timer = rm ? 600 : 1500;
      }
      draw(); return;
    }
    if (s.state === 'clear') {
      s.timer -= dt; s.flashOn = s.timer < 1500 && Math.floor(s.timer / 250) % 2 === 0;
      if (s.timer <= 0) { s.flashOn = false; s.level++; s.dots = dots(); s.eaten = 0; s.fruitShown = 0; resetPositions(); s.state = 'ready'; s.timer = rm ? 600 : 1500; }
      draw(); return;
    }
    if (s.freeze > 0) { s.freeze -= dt; if (s.freeze <= 0) for (const gh of s.ghosts) gh.justEaten = false; draw(); return; }
    // Scatter and chase take turns; the ghosts turn round when the turn changes.
    s.since += dt; s.lastDot += dt;
    if (s.fright > 0) { s.fright -= dt; if (s.fright <= 0) endFright(); }
    else if (s.modeIdx < cfg.scatter.length) {
      s.modeTimer -= dt;
      if (s.modeTimer <= 0) { s.modeIdx++; s.mode = s.modeIdx % 2 ? 'chase' : 'scatter'; s.modeTimer = cfg.scatter[s.modeIdx] ?? Infinity; for (const gh of s.ghosts) if (gh.mode === 'chase' || gh.mode === 'scatter') { gh.mode = s.mode; gh.dx = -gh.dx; gh.dy = -gh.dy; } }
    }
    // Pac-Man: a turn pressed early is kept; the opposite way is taken at once; a corner just ahead is cut.
    const pac = s.pac; const [ptx, pty] = tileOf(pac);
    if (pac.want) {
      const [wx, wy] = pac.want;
      if (wx === -pac.dx && wy === -pac.dy) { pac.dx = wx; pac.dy = wy; }
      else if (!pac.dx && !pac.dy && walkable(ptx + wx, pty + wy)) { pac.dx = wx; pac.dy = wy; }
      else if ((wx && pac.dy) || (wy && pac.dx)) {
        const cx = ptx + 0.5; const cy = pty + 0.5; const toC = (cx - pac.x) * pac.dx + (cy - pac.y) * pac.dy;
        if (toC > 0 && toC < 0.45 && walkable(ptx + wx, pty + wy)) { pac.x = cx; pac.y = cy; pac.dx = wx; pac.dy = wy; }
      }
    }
    const pacDist = cfg.pac * speedUp() / 1000 * dt * (s.fright > 0 ? 1.05 : 1);
    if (pac.dx || pac.dy) { move(pac, pacDist, walkable, pacArrive); pac.chomp += pacDist; pac.mouth = rm ? 0.6 : Math.abs(Math.sin(pac.chomp * Math.PI * 1.1)); }
    // Dots, pellets and the fruit.
    const k = Math.floor(pac.y) * W + Math.floor(pac.x); const dot = s.dots.get(k);
    if (dot) {
      s.dots.delete(k); s.eaten++; s.lastDot = 0; addScore(dot === 'o' ? 50 : 10);
      if (dot === 'o') sfx('pac.power'); else { s.waka = !s.waka; sfx('pac.waka', s.waka); }
      if (dot === 'o') { setFright(); s.sparks.burst(pac.x * T, pac.y * T, DOT, 10, 0.2, 2); }
      if ((s.eaten === 70 || s.eaten === 170) && !s.fruit) { s.fruit = { ...FRUIT_AT, ttl: 9500 }; s.fruitShown++; }
      if (!s.dots.size) { sfx('pac.clear', null, { delay: 0.1 }); s.state = 'clear'; s.timer = 2200; s.fruit = null; s.sparks.burst(pac.x * T, pac.y * T, PAC, 20, 0.3, 3); draw(); return; }
    }
    if (s.fruit) {
      s.fruit.ttl -= dt;
      if (dist2(pac.x, pac.y, s.fruit.x, s.fruit.y) < 0.5) { const n = FRUIT_POINTS[Math.min(FRUIT_POINTS.length - 1, s.level - 1)]; addScore(n); sfx('pac.fruit'); pop(s.fruit.x, s.fruit.y - 0.6, String(n), '#ffb8ff'); s.sparks.burst(s.fruit.x * T, s.fruit.y * T, '#ff3b3b', 12, 0.25, 2.5); s.fruit = null; }
      else if (s.fruit.ttl <= 0) s.fruit = null;
    }
    // The ghosts.
    for (const gh of s.ghosts) {
      const sp = ghostSpeed(gh) * dt;
      if (gh.mode === 'house') {
        gh.bob = rm ? 0 : Math.sin(s.time / 220 + gh.x) * 0.25;
        const free = s.eaten >= gh.dots || s.since >= gh.wait || s.lastDot > 4000;
        if (free) { gh.mode = 'leaving'; gh.bob = 0; }
      } else if (gh.mode === 'leaving') {
        if (Math.abs(gh.x - DOOR.x) > 0.05) { gh.x += Math.sign(DOOR.x - gh.x) * Math.min(sp, Math.abs(DOOR.x - gh.x)); gh.dx = Math.sign(DOOR.x - gh.x) || gh.dx; gh.dy = 0; }
        else { gh.x = DOOR.x; gh.y -= Math.min(sp, gh.y - DOOR.y); gh.dx = 0; gh.dy = -1; if (gh.y <= DOOR.y + 1e-6) { gh.y = DOOR.y; gh.mode = gh.scared && s.fright > 0 ? 'fright' : s.mode; gh.scared = gh.mode === 'fright'; gh.dx = Math.random() < 0.5 ? -1 : 1; gh.dy = 0; } }
      } else if (gh.mode === 'entering') { // the eyes: over the door, down into the house, then to their spot
        if (gh.y < HOME.y - 1e-6) {
          if (Math.abs(gh.x - DOOR.x) > 0.05) { gh.x += Math.sign(DOOR.x - gh.x) * Math.min(sp, Math.abs(DOOR.x - gh.x)); gh.dx = Math.sign(DOOR.x - gh.x); gh.dy = 0; }
          else { gh.x = DOOR.x; gh.y = Math.min(HOME.y, gh.y + sp); gh.dx = 0; gh.dy = 1; }
        } else if (Math.abs(gh.x - gh.home.x) > 0.05) { gh.y = HOME.y; gh.x += Math.sign(gh.home.x - gh.x) * Math.min(sp, Math.abs(gh.home.x - gh.x)); gh.dx = Math.sign(gh.home.x - gh.x); gh.dy = 0; }
        else { gh.x = gh.home.x; gh.mode = 'leaving'; gh.scared = false; }
      } else {
        move(gh, sp, gh.mode === 'eyes' ? doorWalk : ghostWalk, ghostArrive);
        if (!gh.dx && !gh.dy) ghostArrive(gh); // never stuck
      }
      // Meeting Pac-Man.
      if (gh.mode === 'eyes' || gh.mode === 'entering' || gh.mode === 'house' || gh.mode === 'leaving') continue;
      if (Math.abs(gh.x - pac.x) < 0.55 && Math.abs(gh.y - pac.y) < 0.55) {
        if (gh.mode === 'fright') {
          sfx('pac.ghost', s.combo); const n = 200 * 2 ** s.combo; s.combo = Math.min(3, s.combo + 1); addScore(n); pop(gh.x, gh.y, String(n), '#00f0ff');
          s.sparks.burst(gh.x * T, gh.y * T, FRIGHT, 14, 0.28, 2.5); gh.mode = 'eyes'; gh.scared = false; gh.justEaten = true; s.freeze = rm ? 250 : 500;
          draw(); return;
        }
        die(); draw(); return;
      }
    }
    draw();
  }, !paused);
  return <canvas ref={canvas} className="max-w-full rounded-2xl shadow-lg ring-1 ring-black/5 dark:ring-white/10" aria-label="Pac-Man" />;
}

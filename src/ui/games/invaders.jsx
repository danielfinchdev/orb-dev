// Space Invaders: the cannon at the bottom (← → or A D, space / ↑ / W fires, one shot in the air at a time), five rows
// of eleven pixel invaders marching sideways and stepping down at the edges, faster as fewer remain, raining bombs;
// four bunkers that crumble pixel by pixel, the mystery ship crossing the top for a bonus, three lives and the next
// wave starting lower and quicker. Drawn on a low-resolution screen (280×210) scaled by a whole number with no
// smoothing, so every pixel is crisp: a dark starry space with the invaders in rainbow rows; scanlines on retro.
import { useEffect, useRef } from 'react';
import { useT } from '@/lib/i18n.js';
import { useKeys, useLoop, palette, setupCanvas, tint, mix, Particles, reducedMotion, font, corner, label, clamp } from './kit.js';
import { SPRITES, sprite, size } from './invaders-sprites.js';

const LW = 280; const LH = 210; const S = 2; const WIDTH = LW * S; const HEIGHT = LH * S; // logical screen and its scale
const COLS = 11; const ROWS = 5; const CELL_W = 18; const CELL_H = 16; const STEP_X = 2; const STEP_Y = 8;
const PLAYER_Y = 186; const GROUND = 200; const BUNKER_Y = 158; const UFO_Y = 14; const TOP = 12; const EDGE = 4;
const TYPES = ['squid', 'crab', 'crab', 'octopus', 'octopus']; const POINTS = { squid: 30, crab: 20, octopus: 10 };
const ROW_COLORS = ['#ff5ce0', '#a66bff', '#3fd8ff', '#6cf264', '#ffe14d']; // magenta, purple, cyan, green, yellow
const BUNKER_COLOR = '#ff9a3c'; const UFO_COLOR = '#ff5a5a'; const BOMB_KINDS = ['zigzag', 'plunger', 'roller'];
// Difficulty: how often an invader moves (ms per invader: a full pass of the formation takes alive × this), the bombs
// and the lives.
const CFG = {
  facil: { frame: 18, bombEvery: 1400, bombs: 2, lives: 4, shots: 2, bombSpeed: 0.07 },
  normal: { frame: 14, bombEvery: 950, bombs: 3, lives: 3, shots: 1, bombSpeed: 0.09 },
  dificil: { frame: 10, bombEvery: 650, bombs: 4, lives: 2, shots: 1, bombSpeed: 0.11 }
};
const STARS = Array.from({ length: 70 }, (_, i) => ({ x: (i * 97) % LW, y: TOP + ((i * 61) % (GROUND - TOP - 4)), tw: (i * 37) % 1000, big: i % 9 === 0 }));

// The formation, ordered bottom row first and left to right (the order in which they move, one per tick).
const formation = (wave) => {
  const list = [];
  for (let row = ROWS - 1; row >= 0; row--) for (let col = 0; col < COLS; col++) {
    const type = TYPES[row]; const { w, h } = size(SPRITES[type][0]);
    list.push({ col, row, type, w, h, x: 28 + col * CELL_W + Math.floor((CELL_W - w) / 2), y: 30 + Math.min(4, wave - 1) * STEP_Y + row * CELL_H, alive: true, frame: 0 });
  }
  return list;
};
const bunker = (x) => {
  const rows = SPRITES.bunker[0]; const { w, h } = size(rows);
  const mask = new Uint8Array(w * h); rows.forEach((r, y) => { for (let i = 0; i < w; i++) if (r[i] === 'X') mask[y * w + i] = 1; });
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  return { x, y: BUNKER_Y, w, h, mask, canvas, dirty: true };
};
const bunkers = () => [38, 99, 159, 220].map(bunker);
const overlap = (ax, ay, aw, ah, bx, by, bw, bh) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

export default function Invaders({ level, onScore, onOver, paused }) {
  const t = useT();
  const canvas = useRef(null);
  const screen = useRef(null);
  const g = useRef(null);
  const cfg = CFG[level];
  if (!g.current) {
    g.current = {
      px: LW / 2 - 6, left: false, right: false, fire: false, pressed: false, cooldown: 0, shots: [], bombs: [], inv: formation(1), cursor: 0, dir: 1, down: false, acc: 0,
      frame: cfg.frame, bunkers: bunkers(), ufo: null, ufoTimer: 14000, ufoShots: 0, booms: [], pops: [], lives: cfg.lives, score: 0, wave: 1, over: false, dead: 0, bombTimer: 2000,
      intro: 1400, time: 0, sparks: new Particles(), shake: 0, flash: 0, hitStreak: 0
    };
    if (import.meta.env.DEV) window.__invaders = g.current; // the preview's bot reads the world to play and take pictures
  }
  const press = (key, on) => {
    const s = g.current;
    if (key === 'ArrowLeft' || key === 'a' || key === 'A') s.left = on;
    else if (key === 'ArrowRight' || key === 'd' || key === 'D') s.right = on;
    else if (key === ' ' || key === 'ArrowUp' || key === 'w' || key === 'W') { s.fire = on; if (on) s.pressed = true; } // a tap shorter than a frame still fires
    else return false;
    return true;
  };
  useKeys((key) => press(key, true));
  useEffect(() => {
    const up = (e) => press(e.key, false);
    const release = () => { const s = g.current; s.left = s.right = s.fire = false; };
    window.addEventListener('keyup', up); window.addEventListener('blur', release);
    return () => { window.removeEventListener('keyup', up); window.removeEventListener('blur', release); };
  }, []);
  const waveText = (n) => label(t, 'games.invadersWave', 'Oleada {n}').replace('{n}', String(n));

  // The colours: the rainbow rows, tinted a little towards the theme on light themes.
  const colors = (p) => {
    const k = p.dark ? 0 : 0.12;
    return { rows: ROW_COLORS.map((c) => (k ? mix(c, p.primary, k) : c)), bunker: k ? mix(BUNKER_COLOR, p.primary, k) : BUNKER_COLOR, ufo: UFO_COLOR, cannon: mix(p.primary, '#ffffff', 0.45), shot: '#ffffff' };
  };
  const paintBunker = (b, color) => { const c = b.canvas.getContext('2d'); c.clearRect(0, 0, b.w, b.h); c.fillStyle = color; for (let i = 0; i < b.mask.length; i++) if (b.mask[i]) c.fillRect(i % b.w, Math.floor(i / b.w), 1, 1); b.dirty = false; };
  // A blast on a bunker: the pixels around the hit go, with a ragged edge.
  const erode = (b, hx, hy, r) => {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const px = hx + x; const py = hy + y; if (px < 0 || py < 0 || px >= b.w || py >= b.h) continue;
      const d = Math.hypot(x, y); if (d <= r - 0.6 || (d <= r + 0.6 && Math.random() < 0.55)) b.mask[py * b.w + px] = 0;
    }
    b.dirty = true;
  };
  // Where a 1-pixel-wide thing moving vertically hits a bunker: the first solid pixel in its column, from the given end.
  const bunkerHit = (b, x, y0, y1, fromTop) => {
    const col = Math.floor(x - b.x); if (col < 0 || col >= b.w) return -1;
    const a = clamp(Math.floor(y0 - b.y), 0, b.h - 1); const z = clamp(Math.floor(y1 - b.y), 0, b.h - 1);
    if (fromTop) { for (let y = a; y <= z; y++) if (b.mask[y * b.w + col]) return y; } else { for (let y = z; y >= a; y--) if (b.mask[y * b.w + col]) return y; }
    return -1;
  };
  const boom = (x, y, color, ttl = 260, name = 'boom') => g.current.booms.push({ x, y, color, ttl, max: ttl, name });
  const pop = (x, y, text, color) => g.current.pops.push({ x, y, text, color, ttl: 900 });

  const draw = () => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
    const s = g.current; const p = palette(); const rm = reducedMotion(); const c = colors(p);
    const sc = screen.current.getContext('2d');
    // ---- the low-resolution screen.
    sc.fillStyle = p.dark ? mix('#05060f', p.primary, 0.1) : mix('#070a18', p.primary, 0.14); sc.fillRect(0, 0, LW, LH);
    for (const st of STARS) { const k = rm ? 0.5 : 0.25 + 0.75 * Math.abs(Math.sin((s.time + st.tw) / 900)); sc.fillStyle = tint('#ffffff', k * (st.big ? 0.8 : 0.45)); sc.fillRect(st.x, st.y, st.big ? 2 : 1, st.big ? 2 : 1); }
    sc.fillStyle = tint(c.bunker, 0.9); sc.fillRect(0, GROUND, LW, 1);
    for (const b of s.bunkers) { if (b.dirty) paintBunker(b, c.bunker); sc.drawImage(b.canvas, b.x, b.y); }
    for (const inv of s.inv) if (inv.alive) sc.drawImage(sprite(inv.type, inv.frame, c.rows[inv.row]), inv.x, inv.y);
    if (s.ufo) sc.drawImage(sprite('ufo', 0, c.ufo), Math.round(s.ufo.x), UFO_Y);
    for (const b of s.booms) sc.drawImage(sprite(b.name, Math.floor((b.max - b.ttl) / 90), b.color), Math.round(b.x), Math.round(b.y));
    sc.fillStyle = c.shot; for (const sh of s.shots) sc.fillRect(Math.round(sh.x), Math.round(sh.y), 1, 4);
    for (const b of s.bombs) sc.drawImage(sprite(b.kind, Math.floor(s.time / 120) % 2, '#ffffff'), Math.round(b.x) - 1, Math.round(b.y));
    if (s.dead > 0) { if (s.dead > 150) sc.drawImage(sprite('cannonBoom', Math.floor(s.time / 110) % 2, c.cannon), Math.round(s.px), PLAYER_Y); } else if (!s.over) sc.drawImage(sprite('cannon', 0, c.cannon), Math.round(s.px), PLAYER_Y);
    // ---- the real canvas: the screen scaled, then the sparks, the HUD, the texts and the retro scanlines.
    ctx.save();
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, WIDTH, HEIGHT, corner(p, 14)) : ctx.rect(0, 0, WIDTH, HEIGHT); ctx.clip();
    if (s.shake > 0 && !rm) ctx.translate((Math.random() - 0.5) * s.shake, (Math.random() - 0.5) * s.shake);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(screen.current, 0, 0, WIDTH, HEIGHT); ctx.imageSmoothingEnabled = true;
    s.sparks.draw(ctx);
    ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 4;
    for (const q of s.pops) { ctx.globalAlpha = Math.min(1, q.ttl / 300); ctx.fillStyle = q.color; ctx.font = font(p, 13, 800); ctx.textAlign = 'center'; ctx.fillText(q.text, q.x * S, q.y * S - (900 - q.ttl) / 30); }
    ctx.globalAlpha = 1;
    ctx.font = font(p, 12, 700); ctx.fillStyle = tint('#ffffff', 0.92); ctx.textAlign = 'left';
    ctx.fillText(`${t('games.score').toUpperCase()}  ${s.score}`, 12, 13);
    ctx.textAlign = 'center'; ctx.fillStyle = tint('#ffffff', 0.7); ctx.fillText(waveText(s.wave).toUpperCase(), WIDTH / 2, 13);
    ctx.shadowBlur = 0;
    for (let i = 0; i < Math.max(0, s.lives - 1); i++) { ctx.imageSmoothingEnabled = false; ctx.drawImage(sprite('cannon', 0, c.cannon), WIDTH - 12 - (i + 1) * 24, 7, 19.5, 12); ctx.imageSmoothingEnabled = true; }
    if (s.intro > 0) {
      const k = rm ? 1 : clamp((1400 - s.intro) / 250, 0, 1);
      ctx.save(); ctx.globalAlpha = k * Math.min(1, s.intro / 250); ctx.font = font(p, 26, 800); ctx.textAlign = 'center';
      ctx.shadowColor = p.primary; ctx.shadowBlur = 16; ctx.fillStyle = '#ffffff'; ctx.fillText(waveText(s.wave), WIDTH / 2, HEIGHT * 0.56); ctx.restore();
    }
    if (s.flash > 0) { ctx.fillStyle = tint('#ffffff', s.flash * 0.25); ctx.fillRect(0, 0, WIDTH, HEIGHT); }
    const vig = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, HEIGHT * 0.45, WIDTH / 2, HEIGHT / 2, HEIGHT * 0.95);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.4)'); ctx.fillStyle = vig; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    if (p.skin === 'retro') { ctx.fillStyle = 'rgba(0,0,0,.22)'; for (let y = 0; y < HEIGHT; y += 3) ctx.fillRect(0, y, WIDTH, 1); }
    ctx.restore();
  };

  const nextWave = () => {
    const s = g.current; s.wave++; s.inv = formation(s.wave); s.cursor = 0; s.dir = 1; s.down = false; s.acc = 0; s.frame = Math.max(5, s.frame * 0.86);
    s.bombs = []; s.shots = []; s.bunkers = bunkers(); s.ufo = null; s.ufoTimer = 12000; s.intro = 1400; s.bombTimer = 1500;
  };
  const killPlayer = (p) => {
    const s = g.current; s.dead = 1100; s.lives--; s.shake = reducedMotion() ? 0 : 8; s.flash = 1; s.bombs = []; s.fire = false;
    s.sparks.burst((s.px + 6) * S, (PLAYER_Y + 4) * S, mix(p.primary, '#ffffff', 0.45), 26, 0.4, 3.5); s.sparks.burst((s.px + 6) * S, (PLAYER_Y + 4) * S, '#ffffff', 10, 0.3, 2);
  };
  useEffect(() => { screen.current = document.createElement('canvas'); screen.current.width = LW; screen.current.height = LH; setupCanvas(canvas.current, WIDTH, HEIGHT); draw(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLoop((dt) => {
    const s = g.current; const p = palette(); const c = colors(p);
    s.time += dt; s.sparks.step(dt); s.shake = Math.max(0, s.shake - dt * 0.03); s.flash = Math.max(0, s.flash - dt / 200);
    for (const b of s.booms) b.ttl -= dt; s.booms = s.booms.filter((b) => b.ttl > 0);
    for (const q of s.pops) q.ttl -= dt; s.pops = s.pops.filter((q) => q.ttl > 0);
    if (s.over) { draw(); return; }
    if (s.dead > 0) {
      s.dead -= dt;
      if (s.dead <= 0) { s.dead = 0; if (s.lives <= 0) { s.over = true; draw(); onOver(s.score); return; } s.px = LW / 2 - 6; s.shots = []; }
      draw(); return;
    }
    if (s.intro > 0) s.intro -= dt;
    // The cannon and its shot.
    if (s.left) s.px -= 0.1 * dt; if (s.right) s.px += 0.1 * dt;
    s.px = clamp(s.px, EDGE, LW - 13 - EDGE);
    s.cooldown -= dt;
    const wants = s.fire || s.pressed; s.pressed = false;
    if (wants && s.shots.length < cfg.shots && s.cooldown <= 0 && s.intro <= 0) { s.shots.push({ x: s.px + 6, y: PLAYER_Y - 4 }); s.cooldown = 280; s.ufoShots++; }
    for (const sh of s.shots) sh.y -= 0.3 * dt;
    // The march: one invader per tick, the whole formation per pass; at an edge the next pass is a step down.
    if (s.intro <= 0) {
      s.acc += dt; let moves = 0;
      const alive = s.inv.filter((i) => i.alive).length;
      while (s.acc >= s.frame && moves < 12 && alive > 0) {
        s.acc -= s.frame; moves++;
        let n = 0; while (!s.inv[s.cursor].alive && n++ < s.inv.length) s.cursor = (s.cursor + 1) % s.inv.length;
        const inv = s.inv[s.cursor];
        if (s.down) { inv.y += STEP_Y; } else { inv.x += STEP_X * s.dir; } inv.frame ^= 1;
        for (const b of s.bunkers) if (overlap(inv.x, inv.y, inv.w, inv.h, b.x, b.y, b.w, b.h)) { for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (overlap(inv.x, inv.y, inv.w, inv.h, b.x + x, b.y + y, 1, 1)) b.mask[y * b.w + x] = 0; b.dirty = true; }
        if (inv.y + inv.h >= PLAYER_Y) { killPlayer(p); s.lives = 0; break; } // the invasion: the game is over
        s.cursor = (s.cursor + 1) % s.inv.length;
        // The pass is complete when the cursor is back at the first live invader.
        let first = 0; while (!s.inv[first].alive) first++;
        if (s.cursor <= first || !s.inv.slice(s.cursor).some((i) => i.alive)) {
          s.cursor = first;
          if (s.down) s.down = false;
          else if (s.inv.some((i) => i.alive && ((s.dir > 0 && i.x + i.w >= LW - EDGE) || (s.dir < 0 && i.x <= EDGE)))) { s.dir = -s.dir; s.down = true; }
        }
      }
      if (s.dead > 0) { draw(); return; }
    }
    // The bombs: dropped by the lowest invader of a random column.
    s.bombTimer -= dt;
    if (s.intro <= 0 && s.bombTimer <= 0 && s.bombs.length < cfg.bombs) {
      const cols = [...new Set(s.inv.filter((i) => i.alive).map((i) => i.col))];
      if (cols.length) {
        const col = cols[Math.floor(Math.random() * cols.length)];
        const low = s.inv.filter((i) => i.alive && i.col === col).sort((a, b) => b.y - a.y)[0];
        s.bombs.push({ x: low.x + Math.floor(low.w / 2), y: low.y + low.h, kind: BOMB_KINDS[Math.floor(Math.random() * 3)] });
      }
      s.bombTimer = cfg.bombEvery * (0.92 ** (s.wave - 1)) * (0.5 + Math.random());
    }
    for (const b of s.bombs) {
      b.y += cfg.bombSpeed * dt * (1 + 0.06 * (s.wave - 1));
      if (b.y >= GROUND - 1) { b.dead = true; s.sparks.burst(b.x * S, GROUND * S, tint('#ffffff', 0.7), 5, 0.12, 1.5); continue; }
      for (const k of s.bunkers) { const hit = bunkerHit(k, b.x, b.y, b.y + 7, true); if (hit >= 0) { erode(k, Math.floor(b.x - k.x), hit, 2.5); b.dead = true; break; } }
      if (!b.dead && overlap(b.x - 1, b.y, 3, 7, s.px, PLAYER_Y, 13, 8)) { b.dead = true; killPlayer(p); }
    }
    s.bombs = s.bombs.filter((b) => !b.dead);
    if (s.dead > 0) { draw(); return; }
    // The shot: invaders, bunkers, bombs and the mystery ship.
    for (const sh of s.shots) {
      if (sh.y < TOP) { sh.dead = true; s.sparks.burst(sh.x * S, TOP * S, tint('#ffffff', 0.6), 5, 0.12, 1.5); continue; }
      const hit = s.inv.find((i) => i.alive && overlap(sh.x, sh.y, 1, 4, i.x, i.y, i.w, i.h));
      if (hit) {
        hit.alive = false; sh.dead = true; s.score += POINTS[hit.type]; onScore(s.score);
        boom(hit.x + hit.w / 2 - 6.5, hit.y, c.rows[hit.row]); s.sparks.burst((hit.x + hit.w / 2) * S, (hit.y + 4) * S, c.rows[hit.row], 10, 0.22, 2.4);
        continue;
      }
      for (const k of s.bunkers) { const y = bunkerHit(k, sh.x, sh.y, sh.y + 4, false); if (y >= 0) { erode(k, Math.floor(sh.x - k.x), y, 2); sh.dead = true; break; } }
      if (sh.dead) continue;
      const bomb = s.bombs.find((b) => overlap(sh.x, sh.y, 1, 4, b.x - 1, b.y, 3, 7));
      if (bomb) { bomb.dead = true; sh.dead = true; s.sparks.burst(sh.x * S, sh.y * S, '#ffffff', 8, 0.2, 2); continue; }
      if (s.ufo && overlap(sh.x, sh.y, 1, 4, s.ufo.x, UFO_Y, 16, 7)) {
        const bonus = [50, 100, 150, 300][s.ufoShots % 4]; s.score += bonus; onScore(s.score); sh.dead = true;
        pop(s.ufo.x + 8, UFO_Y + 3, String(bonus), c.ufo); boom(s.ufo.x + 1.5, UFO_Y, c.ufo, 400); s.sparks.burst((s.ufo.x + 8) * S, (UFO_Y + 3) * S, c.ufo, 16, 0.3, 2.6);
        s.ufo = null;
      }
    }
    s.shots = s.shots.filter((sh) => !sh.dead); s.bombs = s.bombs.filter((b) => !b.dead);
    // The mystery ship, now and then, while there are enough invaders to hide behind.
    s.ufoTimer -= dt;
    const alive = s.inv.filter((i) => i.alive).length;
    if (!s.ufo && s.ufoTimer <= 0 && alive >= 8 && s.intro <= 0) { const dir = Math.random() < 0.5 ? 1 : -1; s.ufo = { x: dir > 0 ? -16 : LW, dir }; s.ufoTimer = 16000 + Math.random() * 12000; }
    if (s.ufo) { s.ufo.x += s.ufo.dir * 0.045 * dt; if (s.ufo.x < -18 || s.ufo.x > LW + 2) s.ufo = null; }
    if (alive === 0 && !s.booms.length) nextWave();
    draw();
  }, !paused);
  return (
    <canvas ref={canvas} className="max-w-full rounded-2xl shadow-lg ring-1 ring-black/5 dark:ring-white/10" aria-label="Space Invaders"
      onMouseDown={() => { const s = g.current; if (s.cooldown <= 0 && s.shots.length < cfg.shots && !s.dead && s.intro <= 0) { s.shots.push({ x: s.px + 6, y: PLAYER_Y - 4 }); s.cooldown = 280; s.ufoShots++; } }}
      onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (e.buttons || e.movementX) g.current.px = clamp((e.clientX - r.left) * (LW / r.width) - 6.5, EDGE, LW - 13 - EDGE); }} />
  );
}

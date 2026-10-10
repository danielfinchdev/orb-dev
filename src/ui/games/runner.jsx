// A little Geometry Dash: the cube runs on its own; jump (space, ↑ or a click) over spikes and onto blocks. It speeds up.
// Parallax hills and stars behind, a glowing trail, dust when it lands, and the cube bursts when it hits something.
import { useEffect, useRef } from 'react';
import { useKeys, useLoop, palette, setupCanvas, roundRect, tint, shade, mix, block, Particles, hud, reducedMotion, corner } from './kit.js';

const WIDTH = 640; const HEIGHT = 280; const GROUND = 226; const SIZE = 26; const PX = 100;
const SPEED = { facil: 0.26, normal: 0.33, dificil: 0.42 }; // px per ms at the start
const GRAVITY = 0.0042; const JUMP = -1.02;

// Obstacles: spikes (touching them ends it) and blocks (land on top; hitting the side ends it).
function spawn(x, level) {
  const r = Math.random();
  const gap = level === 'dificil' ? 0.55 : level === 'normal' ? 0.4 : 0.25;
  if (r < 0.45) return [{ kind: 'spike', x, w: 26, h: 26 }];
  if (r < 0.45 + gap * 0.5) return [{ kind: 'spike', x, w: 26, h: 26 }, { kind: 'spike', x: x + 26, w: 26, h: 26 }];
  if (r < 0.85) return [{ kind: 'block', x, w: 52, h: 34 }];
  return [{ kind: 'block', x, w: 40, h: 30 }, { kind: 'spike', x: x + 40, w: 26, h: 26 }];
}
// Fixed scenery, computed once: stars and two rows of hills.
const STARS = Array.from({ length: 40 }, (_, i) => ({ x: (i * 97.3) % WIDTH, y: 12 + ((i * 53.7) % 150), r: 0.8 + ((i * 7) % 3) * 0.5, tw: (i * 37) % 1000 }));
const hills = (seed, n, amp) => Array.from({ length: n }, (_, i) => ({ x: (i / n) * 1600, h: amp * (0.5 + 0.5 * Math.abs(Math.sin(i * seed))), w: 160 + ((i * seed * 13) % 90) }));
const FAR = hills(1.7, 10, 80); const NEAR = hills(2.9, 12, 48);

export default function Runner({ level, onScore, onOver, paused }) {
  const canvas = useRef(null);
  const g = useRef(null);
  if (!g.current) g.current = { y: GROUND - SIZE, vy: 0, ground: true, rot: 0, obstacles: spawn(WIDTH + 40, level), dist: 0, speed: SPEED[level], over: false, score: 0, trail: [], dust: new Particles(), time: 0, dead: 0, squash: 0 };
  const jump = () => { const s = g.current; if (s.ground && !s.over) { s.vy = JUMP; s.ground = false; s.squash = -1; s.dust.burst(PX + SIZE / 2, GROUND, tint(palette().fg, 0.5), 5, 0.12, 2); } };
  useKeys((key) => { if (key === ' ' || key === 'ArrowUp' || key === 'w') { jump(); return true; } return false; });
  const draw = () => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
    const p = palette(); const s = g.current; const r = p.skin === 'retro' ? 0 : 6;
    ctx.save(); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, WIDTH, HEIGHT, corner(p, 14)) : ctx.rect(0, 0, WIDTH, HEIGHT); ctx.clip();
    // Sky: a gradient of the theme, stars that twinkle, two rows of hills moving at different speeds.
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0, mix(p.muted, p.primary, p.dark ? 0.35 : 0.22)); sky.addColorStop(1, p.muted);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    for (const st of STARS) { const tw = reducedMotion() ? 0.7 : 0.45 + 0.55 * Math.abs(Math.sin((s.time + st.tw) / 900)); ctx.fillStyle = tint(p.dark ? '#ffffff' : p.primary, tw * (p.dark ? 0.9 : 0.5)); ctx.beginPath(); ctx.arc(((st.x - s.dist * 0.05) % WIDTH + WIDTH) % WIDTH, st.y, st.r, 0, Math.PI * 2); ctx.fill(); }
    const row = (list, k, color, base) => {
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, GROUND);
      for (const h of list) { const x = ((h.x - s.dist * k) % 1600 + 1600) % 1600 - 100; ctx.moveTo(x - h.w / 2, GROUND); ctx.quadraticCurveTo(x, GROUND - h.h * 2 - base, x + h.w / 2, GROUND); }
      ctx.fill();
    };
    row(FAR, 0.18, tint(p.primary, p.dark ? 0.22 : 0.14), 0);
    row(NEAR, 0.4, tint(p.primary, p.dark ? 0.32 : 0.22), -10);
    // The ground: a band, a bright edge and marks that fly by.
    ctx.fillStyle = mix(p.muted, p.fg, p.dark ? 0.18 : 0.08); ctx.fillRect(0, GROUND, WIDTH, HEIGHT - GROUND);
    ctx.fillStyle = p.primary; ctx.fillRect(0, GROUND, WIDTH, 2.5);
    ctx.fillStyle = tint(p.fg, 0.12); for (let x = -((s.dist) % 60); x < WIDTH; x += 60) ctx.fillRect(x, GROUND + 14, 26, 2);
    // Obstacles.
    for (const o of s.obstacles) {
      if (o.kind === 'spike') {
        ctx.fillStyle = shade(p.danger, -0.25); ctx.beginPath(); ctx.moveTo(o.x, GROUND); ctx.lineTo(o.x + o.w / 2, GROUND - o.h); ctx.lineTo(o.x + o.w, GROUND); ctx.closePath(); ctx.fill();
        ctx.fillStyle = p.danger; ctx.beginPath(); ctx.moveTo(o.x + 3, GROUND); ctx.lineTo(o.x + o.w / 2, GROUND - o.h + 5); ctx.lineTo(o.x + o.w / 2, GROUND); ctx.closePath(); ctx.fill();
      } else block(ctx, o.x, GROUND - o.h, o.w, o.h, p.info, p, r);
    }
    // The trail behind the cube.
    if (!reducedMotion()) s.trail.forEach((tr, i) => { const k = (i + 1) / s.trail.length; ctx.fillStyle = tint(p.primary, k * 0.35); ctx.beginPath(); ctx.arc(tr.x, tr.y, SIZE * 0.42 * k, 0, Math.PI * 2); ctx.fill(); });
    s.dust.draw(ctx);
    // The cube, with a glow, an eye, and a squash when it lands.
    if (!s.over || s.dead < 60) {
      ctx.save(); ctx.translate(PX + SIZE / 2, s.y + SIZE / 2 + Math.max(0, s.squash) * 3); ctx.rotate(s.rot);
      ctx.scale(1 + Math.max(0, s.squash) * 0.18, 1 - s.squash * 0.18);
      ctx.shadowColor = tint(p.primary, 0.8); ctx.shadowBlur = p.skin === 'vaporwave' ? 22 : 12;
      ctx.fillStyle = shade(p.primary, -0.2); roundRect(ctx, -SIZE / 2, -SIZE / 2, SIZE, SIZE, r);
      ctx.shadowBlur = 0;
      ctx.fillStyle = p.primary; roundRect(ctx, -SIZE / 2, -SIZE / 2, SIZE, SIZE - 4, r);
      ctx.fillStyle = shade(p.primary, 0.45); roundRect(ctx, -SIZE / 2 + 3, -SIZE / 2 + 3, SIZE - 6, 5, Math.max(0, r - 3));
      ctx.fillStyle = '#fff'; roundRect(ctx, -6, -4, 12, 10, r ? 3 : 0);
      ctx.fillStyle = '#1a1a2e'; roundRect(ctx, -1, -2, 5, 6, r ? 2 : 0);
      ctx.restore();
    }
    hud(ctx, `${Math.floor(s.dist / 10)} m`, WIDTH - 12, 20, p, { align: 'right' });
    ctx.restore();
  };
  useEffect(() => { setupCanvas(canvas.current, WIDTH, HEIGHT); draw(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLoop((dt) => {
    const s = g.current; s.time += dt; s.dust.step(dt);
    if (s.over) { s.dead += dt; if (s.dead < 1200) draw(); return; }
    s.speed += dt * 0.0000045; // a little faster all the time
    const dx = s.speed * dt; s.dist += dx;
    for (const o of s.obstacles) o.x -= dx;
    s.obstacles = s.obstacles.filter((o) => o.x + o.w > -10);
    const last = s.obstacles.at(-1);
    if (!last || last.x < WIDTH - (level === 'dificil' ? 210 : level === 'normal' ? 250 : 300) - Math.random() * 160) s.obstacles.push(...spawn(WIDTH + 20, level));
    // Fall, land on the ground or on a block.
    const wasGround = s.ground;
    s.vy += GRAVITY * dt; let y = s.y + s.vy * dt; let floor = GROUND - SIZE;
    for (const o of s.obstacles) if (o.kind === 'block' && PX + SIZE > o.x + 2 && PX < o.x + o.w - 2 && s.y + SIZE <= GROUND - o.h + 2) floor = Math.min(floor, GROUND - o.h - SIZE);
    if (y >= floor) { y = floor; s.vy = 0; s.ground = true; s.rot = Math.round(s.rot / (Math.PI / 2)) * (Math.PI / 2); } else { s.ground = false; s.rot += dt * 0.009; }
    if (s.ground && !wasGround) { s.squash = 1; s.dust.burst(PX + SIZE / 2, y + SIZE, tint(palette().fg, 0.45), 7, 0.14, 2); }
    s.squash *= Math.max(0, 1 - dt / 90);
    s.y = y;
    s.trail.push({ x: PX + SIZE / 2 - dx, y: s.y + SIZE / 2 }); for (const tr of s.trail) tr.x -= dx; if (s.trail.length > 14) s.trail.shift();
    // Collisions: a spike (with a little mercy), or the side of a block.
    const hit = s.obstacles.some((o) => {
      if (PX + SIZE - 4 < o.x || PX + 4 > o.x + o.w) return false;
      if (o.kind === 'spike') return s.y + SIZE > GROUND - o.h + 8;
      return s.y + SIZE > GROUND - o.h + 4 && s.y < GROUND;
    });
    const score = Math.floor(s.dist / 10);
    if (score !== s.score) { s.score = score; onScore(score); }
    if (hit) { s.over = true; const p = palette(); s.dust.burst(PX + SIZE / 2, s.y + SIZE / 2, p.primary, 26, 0.4, 4); s.dust.burst(PX + SIZE / 2, s.y + SIZE / 2, '#ffffff', 8, 0.3, 2); draw(); onOver(s.score); return; }
    draw();
  }, !paused);
  return <canvas ref={canvas} className="max-w-full cursor-pointer rounded-2xl shadow-lg ring-1 ring-black/5 dark:ring-white/10" onMouseDown={jump} aria-label="Salto" />;
}

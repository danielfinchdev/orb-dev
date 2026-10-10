// A little Geometry Dash: the cube runs on its own; jump (space, ↑ or a click) over spikes and onto blocks. It speeds up.
import { useEffect, useRef } from 'react';
import { useKeys, useLoop, palette, setupCanvas, roundRect } from './kit.js';

const WIDTH = 640; const HEIGHT = 260; const GROUND = 214; const SIZE = 26; const PX = 90;
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

export default function Runner({ level, onScore, onOver, paused }) {
  const canvas = useRef(null);
  const g = useRef(null);
  if (!g.current) g.current = { y: GROUND - SIZE, vy: 0, ground: true, rot: 0, obstacles: spawn(WIDTH + 40, level), dist: 0, speed: SPEED[level], over: false, score: 0 };
  const jump = () => { const s = g.current; if (s.ground && !s.over) { s.vy = JUMP; s.ground = false; } };
  useKeys((key) => { if (key === ' ' || key === 'ArrowUp' || key === 'w') { jump(); return true; } return false; });
  const draw = () => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
    const p = palette(); const s = g.current;
    ctx.fillStyle = p.muted; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    // Moving stripes in the background, to feel the speed.
    ctx.fillStyle = p.border;
    for (let x = -(s.dist * 0.3) % 80; x < WIDTH; x += 80) ctx.fillRect(x, 40, 2, GROUND - 40);
    ctx.fillStyle = p.fg; ctx.fillRect(0, GROUND, WIDTH, 2);
    for (const o of s.obstacles) {
      if (o.kind === 'spike') { ctx.fillStyle = p.danger; ctx.beginPath(); ctx.moveTo(o.x, GROUND); ctx.lineTo(o.x + o.w / 2, GROUND - o.h); ctx.lineTo(o.x + o.w, GROUND); ctx.closePath(); ctx.fill(); }
      else { ctx.fillStyle = p.info; roundRect(ctx, o.x, GROUND - o.h, o.w, o.h, 4); }
    }
    ctx.save(); ctx.translate(PX + SIZE / 2, s.y + SIZE / 2); ctx.rotate(s.rot);
    ctx.fillStyle = p.primary; roundRect(ctx, -SIZE / 2, -SIZE / 2, SIZE, SIZE, 5);
    ctx.fillStyle = p.bg; ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
  };
  useEffect(() => { setupCanvas(canvas.current, WIDTH, HEIGHT); draw(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLoop((dt) => {
    const s = g.current; if (s.over) return;
    s.speed += dt * 0.0000045; // a little faster all the time
    const dx = s.speed * dt; s.dist += dx;
    for (const o of s.obstacles) o.x -= dx;
    s.obstacles = s.obstacles.filter((o) => o.x + o.w > -10);
    const last = s.obstacles.at(-1);
    if (!last || last.x < WIDTH - (level === 'dificil' ? 210 : level === 'normal' ? 250 : 300) - Math.random() * 160) s.obstacles.push(...spawn(WIDTH + 20, level));
    // Fall, land on the ground or on a block.
    s.vy += GRAVITY * dt; let y = s.y + s.vy * dt; let floor = GROUND - SIZE;
    for (const o of s.obstacles) if (o.kind === 'block' && PX + SIZE > o.x + 2 && PX < o.x + o.w - 2 && s.y + SIZE <= GROUND - o.h + 2) floor = Math.min(floor, GROUND - o.h - SIZE);
    if (y >= floor) { y = floor; s.vy = 0; s.ground = true; s.rot = Math.round(s.rot / (Math.PI / 2)) * (Math.PI / 2); } else { s.ground = false; s.rot += dt * 0.009; }
    s.y = y;
    // Collisions: a spike (with a little mercy), or the side of a block.
    const hit = s.obstacles.some((o) => {
      if (PX + SIZE - 4 < o.x || PX + 4 > o.x + o.w) return false;
      if (o.kind === 'spike') return s.y + SIZE > GROUND - o.h + 8;
      return s.y + SIZE > GROUND - o.h + 4 && s.y < GROUND;
    });
    const score = Math.floor(s.dist / 10);
    if (score !== s.score) { s.score = score; onScore(score); }
    if (hit) { s.over = true; draw(); onOver(s.score); return; }
    draw();
  }, !paused);
  return <canvas ref={canvas} className="max-w-full cursor-pointer rounded-xl" onMouseDown={jump} aria-label="Salto" />;
}

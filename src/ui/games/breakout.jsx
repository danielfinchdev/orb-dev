// Bricks (Breakout): move the paddle with the mouse or ← →, break every brick. Three lives; the ball gets faster.
import { useEffect, useRef } from 'react';
import { useKeys, useLoop, palette, setupCanvas, roundRect } from './kit.js';

const WIDTH = 520; const HEIGHT = 380; const PW = { facil: 110, normal: 84, dificil: 64 }; const PH = 10;
const SPEED = { facil: 0.26, normal: 0.32, dificil: 0.4 };
const ROWS = 5; const COLS = 10; const BW = 48; const BH = 16; const GAP = 4; const TOP = 40;
const TONES = ['danger', 'warning', 'success', 'info', 'primary'];

const bricks = () => Array.from({ length: ROWS * COLS }, (_, i) => ({ x: 8 + (i % COLS) * (BW + GAP), y: TOP + Math.floor(i / COLS) * (BH + GAP), row: Math.floor(i / COLS), alive: true }));
const serve = (level) => ({ x: WIDTH / 2, y: HEIGHT - 60, vx: SPEED[level] * (Math.random() < 0.5 ? -0.6 : 0.6), vy: -SPEED[level] });

export default function Breakout({ level, onScore, onOver, paused }) {
  const canvas = useRef(null);
  const g = useRef(null);
  if (!g.current) g.current = { px: WIDTH / 2 - PW[level] / 2, ball: serve(level), bricks: bricks(), lives: 3, score: 0, over: false, left: false, right: false };
  useKeys((key, e) => { if (key === 'ArrowLeft' || key === 'ArrowRight') { g.current[key === 'ArrowLeft' ? 'left' : 'right'] = e.type === 'keydown'; return true; } return false; });
  useEffect(() => { const up = (e) => { if (e.key === 'ArrowLeft') g.current.left = false; if (e.key === 'ArrowRight') g.current.right = false; }; window.addEventListener('keyup', up); return () => window.removeEventListener('keyup', up); }, []);
  const draw = () => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
    const p = palette(); const s = g.current;
    ctx.fillStyle = p.muted; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    for (const b of s.bricks) if (b.alive) { ctx.fillStyle = p[TONES[b.row]]; roundRect(ctx, b.x, b.y, BW, BH, 4); }
    ctx.fillStyle = p.primary; roundRect(ctx, s.px, HEIGHT - 24, PW[level], PH, 5);
    ctx.fillStyle = p.fg; ctx.beginPath(); ctx.arc(s.ball.x, s.ball.y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.mutedFg; ctx.font = '12px sans-serif'; ctx.fillText('♥'.repeat(s.lives), 10, 22);
  };
  useEffect(() => { setupCanvas(canvas.current, WIDTH, HEIGHT); draw(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLoop((dt) => {
    const s = g.current; if (s.over) return;
    if (s.left) s.px -= 0.5 * dt; if (s.right) s.px += 0.5 * dt;
    s.px = Math.max(0, Math.min(WIDTH - PW[level], s.px));
    const b = s.ball; b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.x < 6 || b.x > WIDTH - 6) { b.vx = -b.vx; b.x = Math.max(6, Math.min(WIDTH - 6, b.x)); }
    if (b.y < 6) { b.vy = Math.abs(b.vy); }
    // The paddle: where it hits decides the angle.
    if (b.vy > 0 && b.y > HEIGHT - 30 && b.y < HEIGHT - 14 && b.x > s.px - 6 && b.x < s.px + PW[level] + 6) {
      const speed = Math.hypot(b.vx, b.vy) * 1.02; const hit = (b.x - (s.px + PW[level] / 2)) / (PW[level] / 2);
      const angle = hit * 1.05; b.vx = speed * Math.sin(angle); b.vy = -speed * Math.cos(angle);
    }
    for (const k of s.bricks) {
      if (!k.alive || b.x < k.x - 6 || b.x > k.x + BW + 6 || b.y < k.y - 6 || b.y > k.y + BH + 6) continue;
      k.alive = false; s.score += (ROWS - k.row) * 10; onScore(s.score);
      const fromSide = b.x < k.x || b.x > k.x + BW; if (fromSide) b.vx = -b.vx; else b.vy = -b.vy;
      break;
    }
    if (!s.bricks.some((k) => k.alive)) { s.bricks = bricks(); s.ball = serve(level); s.ball.vy *= 1.15; s.ball.vx *= 1.15; }
    if (b.y > HEIGHT + 10) { s.lives--; if (s.lives <= 0) { s.over = true; draw(); onOver(s.score); return; } s.ball = serve(level); }
    draw();
  }, !paused);
  const follow = (e) => { const r = e.currentTarget.getBoundingClientRect(); g.current.px = e.clientX - r.left - PW[level] / 2; };
  return <canvas ref={canvas} className="max-w-full rounded-xl" onMouseMove={follow} aria-label="Ladrillos" />;
}

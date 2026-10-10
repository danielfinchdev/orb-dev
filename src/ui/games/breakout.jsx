// Bricks (Breakout): move the paddle with the mouse or ← →, break every brick. Three lives; the ball gets faster.
// Glossy bricks that burst into sparks, a glowing ball with a trail, a paddle that flashes when it hits, hearts for lives.
import { useEffect, useRef } from 'react';
import { useKeys, useLoop, palette, setupCanvas, roundRect, block, tint, shade, mix, backdrop, Particles, reducedMotion, font, corner } from './kit.js';
import { sfx } from './sfx.js';

const WIDTH = 520; const HEIGHT = 380; const PW = { facil: 110, normal: 84, dificil: 64 }; const PH = 12; const PY = HEIGHT - 26;
const SPEED = { facil: 0.26, normal: 0.32, dificil: 0.4 };
const ROWS = 5; const COLS = 10; const BW = 47; const BH = 18; const GAP = 5; const TOP = 44; const LEFT = (WIDTH - COLS * (BW + GAP) + GAP) / 2;
const TONES = ['danger', 'warning', 'success', 'info', 'primary'];

const bricks = () => Array.from({ length: ROWS * COLS }, (_, i) => ({ x: LEFT + (i % COLS) * (BW + GAP), y: TOP + Math.floor(i / COLS) * (BH + GAP), row: Math.floor(i / COLS), alive: true }));
const serve = (level) => ({ x: WIDTH / 2, y: HEIGHT - 70, vx: SPEED[level] * (Math.random() < 0.5 ? -0.6 : 0.6), vy: -SPEED[level] });

function heart(ctx, x, y, size, color) {
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(x, y + size * 0.35);
  ctx.bezierCurveTo(x, y, x - size * 0.5, y, x - size * 0.5, y + size * 0.3);
  ctx.bezierCurveTo(x - size * 0.5, y + size * 0.6, x, y + size * 0.8, x, y + size);
  ctx.bezierCurveTo(x, y + size * 0.8, x + size * 0.5, y + size * 0.6, x + size * 0.5, y + size * 0.3);
  ctx.bezierCurveTo(x + size * 0.5, y, x, y, x, y + size * 0.35);
  ctx.fill();
}

export default function Breakout({ level, onScore, onOver, paused }) {
  const canvas = useRef(null);
  const g = useRef(null);
  if (!g.current) g.current = { px: WIDTH / 2 - PW[level] / 2, ball: serve(level), bricks: bricks(), lives: 3, score: 0, over: false, left: false, right: false, trail: [], sparks: new Particles(), flash: 0, wave: 1, shake: 0, lost: 0 };
  useKeys((key, e) => { if (key === 'ArrowLeft' || key === 'ArrowRight') { g.current[key === 'ArrowLeft' ? 'left' : 'right'] = e.type === 'keydown'; return true; } return false; });
  useEffect(() => { const up = (e) => { if (e.key === 'ArrowLeft') g.current.left = false; if (e.key === 'ArrowRight') g.current.right = false; }; window.addEventListener('keyup', up); return () => window.removeEventListener('keyup', up); }, []);
  const draw = () => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
    const p = palette(); const s = g.current; const r = p.skin === 'retro' ? 0 : 4;
    ctx.save();
    if (s.shake > 0 && !reducedMotion()) ctx.translate((Math.random() - 0.5) * s.shake, (Math.random() - 0.5) * s.shake);
    backdrop(ctx, WIDTH, HEIGHT, p);
    for (const b of s.bricks) if (b.alive) block(ctx, b.x, b.y, BW, BH, p[TONES[b.row]], p, r);
    // The paddle: a rounded bar with a highlight; brighter the instant it hits.
    const pw = PW[level]; const pc = s.flash > 0 ? shade(p.primary, 0.3) : p.primary;
    ctx.save(); ctx.shadowColor = tint(p.primary, 0.6); ctx.shadowBlur = 10; ctx.fillStyle = shade(pc, -0.25); roundRect(ctx, s.px, PY, pw, PH, r ? PH / 2 : 0); ctx.restore();
    ctx.fillStyle = pc; roundRect(ctx, s.px, PY, pw, PH - 3, r ? PH / 2 : 0);
    ctx.fillStyle = shade(pc, 0.5); roundRect(ctx, s.px + 6, PY + 2.5, pw - 12, 3, r ? 2 : 0);
    // The ball and its trail.
    if (!reducedMotion()) s.trail.forEach((tr, i) => { const k = (i + 1) / s.trail.length; ctx.fillStyle = tint(p.fg, k * 0.25); ctx.beginPath(); ctx.arc(tr.x, tr.y, 6 * k, 0, Math.PI * 2); ctx.fill(); });
    const b = s.ball;
    ctx.save(); ctx.shadowColor = tint(p.fg, 0.7); ctx.shadowBlur = 10; ctx.fillStyle = p.fg; ctx.beginPath(); ctx.arc(b.x, b.y, 6.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.fillStyle = tint(p.bg, 0.85); ctx.beginPath(); ctx.arc(b.x - 2, b.y - 2, 2.2, 0, Math.PI * 2); ctx.fill();
    s.sparks.draw(ctx);
    // Lives as hearts; the one just lost fades out.
    for (let i = 0; i < 3; i++) { const alive = i < s.lives; const fading = i === s.lives && s.lost > 0; heart(ctx, 20 + i * 20, 11, 13, alive ? p.danger : fading ? tint(p.danger, s.lost / 600) : tint(p.fg, 0.14)); }
    if (s.wave > 1) { ctx.fillStyle = p.mutedFg; ctx.font = font(p, 11); ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(`×${s.wave}`, WIDTH - 14, 18); }
    if (s.over) { ctx.fillStyle = tint(p.danger, 0.1); roundRect(ctx, 0, 0, WIDTH, HEIGHT, corner(p, 14)); }
    ctx.restore();
  };
  useEffect(() => { setupCanvas(canvas.current, WIDTH, HEIGHT); draw(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLoop((dt) => {
    const s = g.current; s.sparks.step(dt); if (s.flash > 0) s.flash -= dt; if (s.lost > 0) s.lost -= dt; s.shake = Math.max(0, s.shake - dt * 0.03);
    if (s.over) { if (s.sparks.alive || s.shake > 0) draw(); return; }
    const p = palette();
    if (s.left) s.px -= 0.5 * dt; if (s.right) s.px += 0.5 * dt;
    s.px = Math.max(0, Math.min(WIDTH - PW[level], s.px));
    const b = s.ball; b.x += b.vx * dt; b.y += b.vy * dt;
    s.trail.push({ x: b.x, y: b.y }); if (s.trail.length > 10) s.trail.shift();
    if (b.x < 6 || b.x > WIDTH - 6) { b.vx = -b.vx; b.x = Math.max(6, Math.min(WIDTH - 6, b.x)); sfx('breakout.wall'); }
    if (b.y < 6) { if (b.vy < 0) sfx('breakout.wall'); b.vy = Math.abs(b.vy); }
    // The paddle: where it hits decides the angle.
    if (b.vy > 0 && b.y > PY - 6 && b.y < PY + PH && b.x > s.px - 6 && b.x < s.px + PW[level] + 6) {
      const speed = Math.hypot(b.vx, b.vy) * 1.02; const hit = (b.x - (s.px + PW[level] / 2)) / (PW[level] / 2);
      const angle = hit * 1.05; b.vx = speed * Math.sin(angle); b.vy = -speed * Math.cos(angle); b.y = PY - 6;
      s.flash = 120; s.sparks.burst(b.x, PY, tint(p.primary, 0.8), 4, 0.1, 1.5); sfx('breakout.paddle');
    }
    for (const k of s.bricks) {
      if (!k.alive || b.x < k.x - 6 || b.x > k.x + BW + 6 || b.y < k.y - 6 || b.y > k.y + BH + 6) continue;
      k.alive = false; s.score += (ROWS - k.row) * 10 * s.wave; onScore(s.score); sfx('breakout.brick', k.row);
      s.sparks.burst(k.x + BW / 2, k.y + BH / 2, p[TONES[k.row]], 12, 0.22, 2.6); s.sparks.burst(k.x + BW / 2, k.y + BH / 2, mix(p[TONES[k.row]], '#ffffff', 0.5), 4, 0.15, 1.5);
      const fromSide = b.x < k.x || b.x > k.x + BW; if (fromSide) b.vx = -b.vx; else b.vy = -b.vy;
      break;
    }
    if (!s.bricks.some((k) => k.alive)) { sfx('breakout.wave', null, { delay: 0.08 }); s.bricks = bricks(); s.ball = serve(level); s.ball.vy *= 1.15; s.ball.vx *= 1.15; s.wave++; s.trail = []; }
    if (b.y > HEIGHT + 10) {
      s.lives--; s.lost = 600; s.shake = 8; s.trail = []; sfx('breakout.lose');
      if (s.lives <= 0) { s.over = true; draw(); onOver(s.score); return; }
      s.ball = serve(level);
    }
    draw();
  }, !paused);
  const follow = (e) => { const r = e.currentTarget.getBoundingClientRect(); g.current.px = Math.max(0, Math.min(WIDTH - PW[level], (e.clientX - r.left) * (WIDTH / r.width) - PW[level] / 2)); };
  return <canvas ref={canvas} className="max-w-full rounded-2xl shadow-lg ring-1 ring-black/5 dark:ring-white/10" onMouseMove={follow} aria-label="Ladrillos" />;
}

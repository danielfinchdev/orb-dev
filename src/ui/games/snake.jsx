// Snake: eat to grow, do not bite yourself. Easy: slow and the walls let you through; hard: fast.
// The snake slides between cells (the logic still moves one cell per tick); it has eyes, the food glows and bursts.
import { useEffect, useRef } from 'react';
import { useKeys, useLoop, palette, setupCanvas, tint, mix, shade, Particles, backdrop, reducedMotion, font } from './kit.js';

const N = 20; const CELL = 21; const SIZE = N * CELL;
const SPEED = { facil: 150, normal: 105, dificil: 70 };
const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };

const freeCell = (body) => { for (;;) { const c = [Math.floor(Math.random() * N), Math.floor(Math.random() * N)]; if (!body.some(([x, y]) => x === c[0] && y === c[1])) return c; } };
const centre = (c) => (c + 0.5) * CELL;

export default function Snake({ level, onScore, onOver, paused }) {
  const canvas = useRef(null);
  const g = useRef(null);
  if (!g.current) {
    const body = [[9, 10], [8, 10], [7, 10]];
    g.current = { body, tail: [6, 10], dir: [1, 0], next: [1, 0], food: freeCell(body), acc: 0, score: 0, over: false, time: 0, bite: 0, sparks: new Particles(), queue: [] };
  }
  useKeys((key) => {
    const d = DIRS[key] ?? DIRS[key.toLowerCase?.()]; if (!d) return false;
    const s = g.current; const ref = s.queue.at(-1) ?? s.dir;
    if ((d[0] === -ref[0] && d[1] === -ref[1]) || (d[0] === ref[0] && d[1] === ref[1])) return true; // no turning back on itself
    if (s.queue.length < 2) s.queue.push(d); // two quick turns in a row are kept
    return true;
  });
  // Where each segment is drawn: between where it was a tick ago and where it is now.
  const points = (s, t) => {
    const smooth = !reducedMotion();
    return s.body.map((cur, i) => {
      const prev = i + 1 < s.body.length ? s.body[i + 1] : s.tail;
      if (!smooth || s.over || Math.abs(cur[0] - prev[0]) > 1 || Math.abs(cur[1] - prev[1]) > 1) return [centre(cur[0]), centre(cur[1])]; // the wall wrap: no line across
      return [centre(prev[0] + (cur[0] - prev[0]) * t), centre(prev[1] + (cur[1] - prev[1]) * t)];
    });
  };
  const draw = () => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
    const p = palette(); const s = g.current;
    backdrop(ctx, SIZE, SIZE, p, { grid: CELL });
    const t = s.over ? 1 : Math.min(1, s.acc / SPEED[level]);
    // The food: a glowing berry that breathes.
    const pulse = reducedMotion() ? 0 : Math.sin(s.time / 180) * 1.5;
    const fx = centre(s.food[0]); const fy = centre(s.food[1]);
    ctx.save(); ctx.shadowColor = tint(p.warning, 0.9); ctx.shadowBlur = 14 + pulse * 2;
    ctx.fillStyle = p.warning; ctx.beginPath(); ctx.arc(fx, fy + 1, 6.5 + pulse, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.fillStyle = shade(p.warning, 0.55); ctx.beginPath(); ctx.arc(fx - 2.2, fy - 1.5, 2.2 + pulse * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = p.success; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(fx + 1, fy - 5 - pulse); ctx.quadraticCurveTo(fx + 4, fy - 9 - pulse, fx + 6, fy - 7 - pulse); ctx.stroke();
    // The body: one thick rounded line, the head in the primary colour fading to the tail; a soft shadow under it.
    const pts = points(s, t);
    const head = s.over ? p.danger : p.primary;
    const stroke = (width, colorAt, alpha = 1) => {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = alpha;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [x1, y1] = pts[i]; const [x2, y2] = pts[i + 1];
        if (Math.hypot(x2 - x1, y2 - y1) > CELL * 1.5) continue; // across the wall
        ctx.strokeStyle = colorAt(i / Math.max(1, pts.length - 1)); ctx.lineWidth = width;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    ctx.save(); ctx.translate(0, 2); stroke(CELL - 4, () => tint('#000000', 1), p.dark ? 0.35 : 0.18); ctx.restore();
    stroke(CELL - 4, (k) => mix(head, p.info, Math.min(1, k * 1.2)));
    stroke(CELL - 12, (k) => shade(mix(head, p.info, Math.min(1, k * 1.2)), 0.35), 0.5);
    // Head and eyes, looking where it goes.
    const [hx, hy] = pts[0]; const [dx, dy] = s.dir;
    ctx.fillStyle = head; ctx.beginPath(); ctx.arc(hx, hy, (CELL - 2) / 2, 0, Math.PI * 2); ctx.fill();
    const side = [-dy, dx]; const blink = !reducedMotion() && Math.floor(s.time / 2800) !== Math.floor((s.time - 120) / 2800);
    for (const sgn of [-1, 1]) {
      const ex = hx + dx * 3.5 + side[0] * sgn * 4.6; const ey = hy + dy * 3.5 + side[1] * sgn * 4.6;
      ctx.fillStyle = '#fff'; ctx.beginPath();
      if (blink) ctx.ellipse(ex, ey, 2.8, 0.8, 0, 0, Math.PI * 2); else ctx.arc(ex, ey, 2.8, 0, Math.PI * 2);
      ctx.fill();
      if (!blink) { ctx.fillStyle = '#1a1a2e'; ctx.beginPath(); ctx.arc(ex + dx * 1.1, ey + dy * 1.1, 1.4, 0, Math.PI * 2); ctx.fill(); }
    }
    if (s.over) { ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 1.5; for (const sgn of [-1, 1]) { const ex = hx + dx * 3.5 + side[0] * sgn * 4.6; const ey = hy + dy * 3.5 + side[1] * sgn * 4.6; ctx.beginPath(); ctx.moveTo(ex - 2.5, ey - 2.5); ctx.lineTo(ex + 2.5, ey + 2.5); ctx.moveTo(ex + 2.5, ey - 2.5); ctx.lineTo(ex - 2.5, ey + 2.5); ctx.stroke(); } }
    // Points popping up where it ate.
    if (s.bite > 0) { ctx.globalAlpha = Math.min(1, s.bite / 200); ctx.fillStyle = p.warning; ctx.font = font(p, 13, 700); ctx.textAlign = 'center'; ctx.fillText('+10', s.biteAt[0], s.biteAt[1] - 14 - (600 - s.bite) / 40); ctx.globalAlpha = 1; }
    s.sparks.draw(ctx);
  };
  useEffect(() => { setupCanvas(canvas.current, SIZE, SIZE); draw(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLoop((dt) => {
    const s = g.current;
    s.time += dt; s.sparks.step(dt); if (s.bite > 0) s.bite -= dt;
    if (s.over) { if (s.sparks.alive) draw(); return; }
    s.acc += dt;
    if (s.acc >= SPEED[level]) {
      s.acc -= SPEED[level];
      if (s.queue.length) s.dir = s.queue.shift();
      let [x, y] = s.body[0]; x += s.dir[0]; y += s.dir[1];
      if (level === 'facil') { x = (x + N) % N; y = (y + N) % N; }
      const eats = x === s.food[0] && y === s.food[1];
      const hits = x < 0 || y < 0 || x >= N || y >= N || s.body.slice(0, eats ? s.body.length : -1).some(([bx, by]) => bx === x && by === y);
      if (hits) {
        s.over = true; s.acc = SPEED[level];
        const [hx, hy] = s.body[0]; s.sparks.burst(centre(hx), centre(hy), palette().danger, 18, 0.3, 3.5);
        draw(); onOver(s.score); return;
      }
      s.body.unshift([x, y]);
      if (eats) {
        s.score += 10; onScore(s.score); s.tail = s.body[s.body.length - 1];
        s.sparks.burst(centre(x), centre(y), palette().warning, 14, 0.28, 3);
        s.bite = 600; s.biteAt = [centre(x), centre(y)];
        s.food = freeCell(s.body);
      } else s.tail = s.body.pop();
    }
    draw();
  }, !paused);
  return <canvas ref={canvas} className="rounded-2xl shadow-lg ring-1 ring-black/5 dark:ring-white/10" aria-label="Snake" />;
}

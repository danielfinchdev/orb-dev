// Snake: eat to grow, do not bite yourself. Easy: slow and the walls let you through; hard: fast.
import { useEffect, useRef } from 'react';
import { useKeys, useLoop, palette, setupCanvas, roundRect } from './kit.js';

const N = 20; const CELL = 20; const SIZE = N * CELL;
const SPEED = { facil: 140, normal: 100, dificil: 66 };
const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };

const freeCell = (body) => { for (;;) { const c = [Math.floor(Math.random() * N), Math.floor(Math.random() * N)]; if (!body.some(([x, y]) => x === c[0] && y === c[1])) return c; } };

export default function Snake({ level, onScore, onOver, paused }) {
  const canvas = useRef(null);
  const g = useRef(null);
  if (!g.current) { const body = [[9, 10], [8, 10], [7, 10]]; g.current = { body, dir: [1, 0], next: [1, 0], food: freeCell(body), acc: 0, score: 0, over: false }; }
  useKeys((key) => {
    const d = DIRS[key] ?? DIRS[key.toLowerCase?.()]; if (!d) return false;
    const s = g.current; if (d[0] === -s.dir[0] && d[1] === -s.dir[1]) return true; // no turning back on itself
    s.next = d; return true;
  });
  const draw = () => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
    const p = palette(); const s = g.current;
    ctx.fillStyle = p.muted; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = p.warning; roundRect(ctx, s.food[0] * CELL + 3, s.food[1] * CELL + 3, CELL - 6, CELL - 6, 6);
    s.body.forEach(([x, y], i) => { ctx.fillStyle = i === 0 ? p.primary : p.info; ctx.globalAlpha = i === 0 ? 1 : Math.max(0.45, 1 - i / (s.body.length + 6)); roundRect(ctx, x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2, 5); });
    ctx.globalAlpha = 1;
  };
  useEffect(() => { setupCanvas(canvas.current, SIZE, SIZE); draw(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLoop((dt) => {
    const s = g.current; if (s.over) return;
    s.acc += dt; if (s.acc < SPEED[level]) return; s.acc = 0;
    s.dir = s.next;
    let [x, y] = s.body[0]; x += s.dir[0]; y += s.dir[1];
    if (level === 'facil') { x = (x + N) % N; y = (y + N) % N; }
    const eats = x === s.food[0] && y === s.food[1];
    const hits = x < 0 || y < 0 || x >= N || y >= N || s.body.slice(0, eats ? s.body.length : -1).some(([bx, by]) => bx === x && by === y);
    if (hits) { s.over = true; draw(); onOver(s.score); return; }
    s.body.unshift([x, y]);
    if (eats) { s.score += 10; onScore(s.score); s.food = freeCell(s.body); } else s.body.pop();
    draw();
  }, !paused);
  return <canvas ref={canvas} className="rounded-xl" aria-label="Snake" />;
}

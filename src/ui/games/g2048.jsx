// 2048: slide with the arrows, equal tiles join. Easy: a 5x5 board; hard: more fours appear.
import { useState } from 'react';
import { useKeys } from './kit.js';
import { cn } from '@/lib/utils.js';

const SIZE = { facil: 5, normal: 4, dificil: 4 };
const FOURS = { facil: 0.1, normal: 0.1, dificil: 0.3 };

const add = (grid, level) => {
  const free = []; grid.forEach((row, y) => row.forEach((v, x) => { if (!v) free.push([x, y]); }));
  if (!free.length) return grid;
  const [x, y] = free[Math.floor(Math.random() * free.length)];
  const next = grid.map((r) => [...r]); next[y][x] = Math.random() < FOURS[level] ? 4 : 2;
  return next;
};
// Slides every row to the left; returns the new grid and the points made.
const slideLeft = (grid) => {
  let points = 0;
  const out = grid.map((row) => {
    const vals = row.filter(Boolean); const merged = [];
    for (let i = 0; i < vals.length; i++) { if (vals[i] === vals[i + 1]) { merged.push(vals[i] * 2); points += vals[i] * 2; i++; } else merged.push(vals[i]); }
    return [...merged, ...Array(row.length - merged.length).fill(0)];
  });
  return { out, points };
};
const turn = (grid) => grid[0].map((_, x) => grid.map((row) => row[x]).reverse()); // clockwise
const turns = (grid, n) => { let g = grid; for (let i = 0; i < n; i++) g = turn(g); return g; };
const ROT = { ArrowLeft: 0, ArrowDown: 1, ArrowRight: 2, ArrowUp: 3 };
const canMove = (grid) => Object.values(ROT).some((r) => { const { out } = slideLeft(turns(grid, r)); return JSON.stringify(out) !== JSON.stringify(turns(grid, r)); });

const TONE = (v) => (v >= 2048 ? 'bg-primary text-primary-foreground' : v >= 256 ? 'bg-warning text-white' : v >= 32 ? 'bg-destructive/80 text-white' : v >= 8 ? 'bg-info/80 text-white' : v ? 'bg-card' : 'bg-muted/60');

export default function Game2048({ level, onScore, onOver, paused }) {
  const n = SIZE[level];
  const [state, setState] = useState(() => ({ grid: add(add(Array.from({ length: n }, () => Array(n).fill(0)), level), level), score: 0, over: false }));
  useKeys((key) => {
    if (!(key in ROT) || state.over || paused) return false;
    const r = ROT[key];
    const { out, points } = slideLeft(turns(state.grid, r));
    const back = turns(out, (4 - r) % 4);
    if (JSON.stringify(back) === JSON.stringify(state.grid)) return true;
    const grid = add(back, level); const score = state.score + points;
    const over = !canMove(grid);
    setState({ grid, score, over });
    if (points) onScore(score);
    if (over) onOver(score);
    return true;
  });
  return (
    <div className="bg-muted grid gap-2 rounded-xl p-2" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, width: n * 76 }} aria-label="2048">
      {state.grid.flat().map((v, i) => (
        <div key={i} className={cn('grid aspect-square place-items-center rounded-lg text-lg font-semibold tabular-nums transition-colors', TONE(v), v >= 1024 && 'text-base')}>{v || ''}</div>
      ))}
    </div>
  );
}

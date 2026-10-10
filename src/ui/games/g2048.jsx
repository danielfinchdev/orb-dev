// 2048: slide with the arrows, equal tiles join. Easy: a 5x5 board; hard: more fours appear.
// Every tile is an element that slides to its new cell (CSS transform); the one born from a merge pops, a new one fades in.
import { useEffect, useRef, useState } from 'react';
import { useKeys, reducedMotion } from './kit.js';
import { sfx } from './sfx.js';

const SIZE = { facil: 5, normal: 4, dificil: 4 };
const FOURS = { facil: 0.1, normal: 0.1, dificil: 0.3 };
const DIR = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1] };
const GAP = 10;
let nextId = 1;

const spawn = (tiles, n, level) => {
  const taken = new Set(tiles.map((t) => t.y * n + t.x)); const free = [];
  for (let i = 0; i < n * n; i++) if (!taken.has(i)) free.push(i);
  if (!free.length) return tiles;
  const i = free[Math.floor(Math.random() * free.length)];
  return [...tiles, { id: nextId++, v: Math.random() < FOURS[level] ? 4 : 2, x: i % n, y: Math.floor(i / n), fresh: true }];
};
// Slides every tile towards [dx, dy]. Tiles that merge into another are returned as ghosts (they travel, then vanish).
const slide = (tiles, n, [dx, dy]) => {
  const grid = Array.from({ length: n }, () => Array(n).fill(null));
  for (const t of tiles) grid[t.y][t.x] = t;
  const out = []; const ghosts = []; let points = 0; let moved = false;
  for (let line = 0; line < n; line++) {
    const cells = [];
    for (let k = 0; k < n; k++) {
      const i = dx > 0 || dy > 0 ? n - 1 - k : k; // from the edge they move towards
      cells.push(dx ? [i, line] : [line, i]);
    }
    let pos = 0; let last = null;
    for (const [x, y] of cells) {
      const t = grid[y][x]; if (!t) continue;
      const [tx, ty] = cells[pos - (last && last.v === t.v && !last.merged ? 1 : 0)];
      if (last && last.v === t.v && !last.merged) {
        ghosts.push({ ...t, x: tx, y: ty, fresh: false });
        out[out.length - 1] = { id: nextId++, v: t.v * 2, x: tx, y: ty, merged: true };
        last = out[out.length - 1]; points += t.v * 2; moved = true;
      } else {
        if (t.x !== tx || t.y !== ty) moved = true;
        last = { ...t, x: tx, y: ty, fresh: false, merged: false }; out.push(last); pos++;
      }
    }
  }
  return { tiles: out, ghosts, points, moved };
};
const canMove = (tiles, n) => Object.values(DIR).slice(0, 4).some((d) => slide(tiles, n, d).moved);

// From the theme: the primary colour grows with the value, then warms up towards 2048.
const tone = (v) => {
  const step = Math.log2(v);
  if (step <= 7) return { background: `color-mix(in oklab, var(--primary) ${[0, 10, 20, 34, 50, 66, 82, 100][step]}%, var(--card))`, color: step >= 5 ? 'var(--primary-foreground)' : 'var(--foreground)' };
  if (step === 8) return { background: 'color-mix(in oklab, var(--primary) 55%, var(--warning))', color: '#fff' };
  if (step === 9) return { background: 'var(--warning)', color: '#fff' };
  if (step === 10) return { background: 'color-mix(in oklab, var(--warning) 50%, var(--destructive))', color: '#fff' };
  return { background: 'var(--destructive)', color: '#fff', boxShadow: '0 0 24px color-mix(in oklab, var(--destructive) 60%, transparent)' };
};

export default function Game2048({ level, onScore, onOver, paused }) {
  const n = SIZE[level]; const cell = n === 5 ? 72 : 88; const board = n * cell + (n + 1) * GAP;
  const [state, setState] = useState(() => ({ tiles: spawn(spawn([], n, level), n, level), ghosts: [], score: 0, over: false }));
  const busy = useRef(false);
  const won = useRef(false);
  const quick = reducedMotion();
  // Ghosts (tiles that merged away) go once they have travelled.
  useEffect(() => { if (!state.ghosts.length) return undefined; const id = setTimeout(() => setState((s) => ({ ...s, ghosts: [] })), 140); return () => clearTimeout(id); }, [state.ghosts]);
  useKeys((key) => {
    const d = DIR[key] ?? DIR[key.toLowerCase?.()];
    if (!d || state.over || paused) return false;
    if (busy.current) return true;
    const r = slide(state.tiles, n, d);
    if (!r.moved) return true;
    busy.current = true; setTimeout(() => { busy.current = false; }, quick ? 0 : 90);
    const tiles = spawn(r.tiles, n, level); const score = state.score + r.points;
    const over = !canMove(tiles, n);
    setState({ tiles, ghosts: r.ghosts, score, over });
    // The sound: a swish, the note of the biggest tile just made, a fanfare the first time one reaches 2048.
    const top = Math.max(0, ...r.tiles.filter((x) => x.merged).map((x) => x.v));
    if (top >= 2048 && !won.current) { won.current = true; sfx('g2048.win'); } else if (top) sfx('g2048.merge', top); else sfx('g2048.slide');
    if (r.points) onScore(score);
    if (over) onOver(score);
    return true;
  });
  const at = (x, y) => `translate(${GAP + x * (cell + GAP)}px, ${GAP + y * (cell + GAP)}px)`;
  const tile = (t, ghost) => (
    <div key={t.id} className="absolute top-0 left-0 grid place-items-center rounded-xl font-bold tabular-nums shadow-sm" data-pop={t.merged ? '1' : undefined} data-fresh={t.fresh ? '1' : undefined}
      style={{ width: cell, height: cell, transform: at(t.x, t.y), transition: quick ? 'none' : 'transform 110ms ease-out', zIndex: ghost ? 1 : 2, fontSize: t.v >= 1024 ? cell * 0.3 : t.v >= 128 ? cell * 0.36 : cell * 0.42, ...tone(t.v), ...(ghost ? { boxShadow: 'none' } : {}) }}>
      {t.v}
    </div>
  );
  return (
    <div className="bg-muted relative rounded-2xl shadow-lg ring-1 ring-black/5 dark:ring-white/10" style={{ width: board, height: board }} aria-label="2048">
      <style>{`@keyframes orb-tile-pop { 0% { scale: 1; } 45% { scale: 1.18; } 100% { scale: 1; } } @keyframes orb-tile-in { from { scale: 0.4; opacity: 0; } to { scale: 1; opacity: 1; } }
        [data-pop="1"] { animation: orb-tile-pop 180ms ease-out 60ms; } [data-fresh="1"] { animation: orb-tile-in 160ms ease-out 80ms backwards; }`}</style>
      {Array.from({ length: n * n }, (_, i) => <div key={i} className="bg-foreground/[0.045] dark:bg-white/[0.05] absolute top-0 left-0 rounded-xl" style={{ width: cell, height: cell, transform: at(i % n, Math.floor(i / n)) }} />)}
      {state.ghosts.map((t) => tile(t, true))}
      {state.tiles.map((t) => tile(t, false))}
      {state.over ? <div className="bg-destructive/10 pointer-events-none absolute inset-0 rounded-2xl" /> : null}
    </div>
  );
}

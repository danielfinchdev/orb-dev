// Tetris: ← → move, ↑ rotate, ↓ drop faster, space drops it at once. Lines cleared speed it up.
import { useEffect, useRef } from 'react';
import { useKeys, useLoop, palette, setupCanvas, roundRect } from './kit.js';

const W = 10; const H = 20; const CELL = 22; const SIDE = 110;
const SHAPES = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]], O: [[1, 0], [2, 0], [1, 1], [2, 1]], T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]], Z: [[0, 0], [1, 0], [1, 1], [2, 1]], J: [[0, 0], [0, 1], [1, 1], [2, 1]], L: [[2, 0], [0, 1], [1, 1], [2, 1]]
};
const COLORS = { I: 'info', O: 'warning', T: 'primary', S: 'success', Z: 'danger', J: 'info', L: 'warning' };
const START = { facil: 900, normal: 650, dificil: 380 };
const KINDS = Object.keys(SHAPES);

const rotate = (cells, kind) => {
  if (kind === 'O') return cells;
  const size = kind === 'I' ? 4 : 3;
  return cells.map(([x, y]) => [size - 1 - y, x]);
};
const newPiece = (kind = KINDS[Math.floor(Math.random() * KINDS.length)]) => ({ kind, cells: SHAPES[kind].map((c) => [...c]), x: 3, y: -1 });

export default function Tetris({ level, onScore, onOver, paused }) {
  const canvas = useRef(null);
  const g = useRef(null);
  if (!g.current) g.current = { grid: Array.from({ length: H }, () => Array(W).fill(null)), piece: newPiece(), next: newPiece(), acc: 0, score: 0, lines: 0, over: false };
  const fits = (cells, px, py) => cells.every(([cx, cy]) => { const x = px + cx; const y = py + cy; return x >= 0 && x < W && y < H && (y < 0 || !g.current.grid[y][x]); });
  const draw = () => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
    const p = palette(); const s = g.current;
    ctx.fillStyle = p.muted; ctx.fillRect(0, 0, W * CELL, H * CELL);
    ctx.fillStyle = p.bg; ctx.fillRect(W * CELL, 0, SIDE, H * CELL);
    const block = (x, y, kind, alpha = 1) => { ctx.globalAlpha = alpha; ctx.fillStyle = p[COLORS[kind]]; roundRect(ctx, x + 1, y + 1, CELL - 2, CELL - 2, 4); ctx.globalAlpha = 1; };
    s.grid.forEach((row, y) => row.forEach((k, x) => { if (k) block(x * CELL, y * CELL, k); }));
    // Ghost: where it would land.
    let gy = s.piece.y; while (fits(s.piece.cells, s.piece.x, gy + 1)) gy++;
    s.piece.cells.forEach(([cx, cy]) => { if (gy + cy >= 0) block((s.piece.x + cx) * CELL, (gy + cy) * CELL, s.piece.kind, 0.22); });
    s.piece.cells.forEach(([cx, cy]) => { if (s.piece.y + cy >= 0) block((s.piece.x + cx) * CELL, (s.piece.y + cy) * CELL, s.piece.kind); });
    ctx.fillStyle = p.mutedFg; ctx.font = '12px sans-serif'; ctx.fillText('NEXT', W * CELL + 16, 22);
    s.next.cells.forEach(([cx, cy]) => block(W * CELL + 16 + cx * CELL, 34 + cy * CELL, s.next.kind));
    ctx.fillText(`${s.lines}`, W * CELL + 16, 130); ctx.fillText('LINES', W * CELL + 40, 130);
  };
  const lock = () => {
    const s = g.current;
    for (const [cx, cy] of s.piece.cells) { const y = s.piece.y + cy; if (y < 0) { s.over = true; draw(); onOver(s.score); return; } s.grid[y][s.piece.x + cx] = s.piece.kind; }
    const kept = s.grid.filter((row) => row.some((c) => !c));
    const cleared = H - kept.length;
    if (cleared) { s.lines += cleared; s.score += [0, 100, 300, 500, 800][cleared]; onScore(s.score); }
    s.grid = [...Array.from({ length: cleared }, () => Array(W).fill(null)), ...kept];
    s.piece = s.next; s.next = newPiece();
    if (!fits(s.piece.cells, s.piece.x, s.piece.y)) { s.over = true; onOver(s.score); }
  };
  const move = (dx, dy) => { const s = g.current; if (fits(s.piece.cells, s.piece.x + dx, s.piece.y + dy)) { s.piece.x += dx; s.piece.y += dy; return true; } return false; };
  useKeys((key) => {
    const s = g.current; if (s.over || paused) return false;
    if (key === 'ArrowLeft') move(-1, 0);
    else if (key === 'ArrowRight') move(1, 0);
    else if (key === 'ArrowDown') { if (!move(0, 1)) lock(); else { s.score += 1; onScore(s.score); } }
    else if (key === 'ArrowUp') {
      const r = rotate(s.piece.cells, s.piece.kind);
      for (const kick of [0, -1, 1, -2, 2]) if (fits(r, s.piece.x + kick, s.piece.y)) { s.piece.cells = r; s.piece.x += kick; break; }
    } else if (key === ' ') { let n = 0; while (move(0, 1)) n++; s.score += n * 2; onScore(s.score); lock(); }
    else return false;
    draw(); return true;
  });
  useEffect(() => { setupCanvas(canvas.current, W * CELL + SIDE, H * CELL); draw(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLoop((dt) => {
    const s = g.current; if (s.over) return;
    s.acc += dt;
    const speed = Math.max(90, START[level] - s.lines * 25);
    if (s.acc < speed) return; s.acc = 0;
    if (!move(0, 1)) lock();
    draw();
  }, !paused);
  return <canvas ref={canvas} className="rounded-xl" aria-label="Tetris" />;
}

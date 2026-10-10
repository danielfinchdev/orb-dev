// Tetris: ← → move, ↑ rotate, ↓ drop faster, space drops it at once. Lines cleared speed it up.
// Glossy blocks, the ghost of the piece where it would land, a flash when lines go, and a side panel with the next piece.
import { useEffect, useRef } from 'react';
import { useT } from '@/lib/i18n.js';
import { useKeys, useLoop, palette, setupCanvas, roundRect, block, tint, mix, shade, backdrop, label, reducedMotion, Particles, font, corner } from './kit.js';

const W = 10; const H = 20; const CELL = 22; const SIDE = 124; const PAD = 10;
const BOARD_W = W * CELL; const WIDTH = BOARD_W + SIDE; const HEIGHT = H * CELL;
const SHAPES = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]], O: [[1, 0], [2, 0], [1, 1], [2, 1]], T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]], Z: [[0, 0], [1, 0], [1, 1], [2, 1]], J: [[0, 0], [0, 1], [1, 1], [2, 1]], L: [[2, 0], [0, 1], [1, 1], [2, 1]]
};
// Each piece its colour, from the theme: J violet-ish and L orange so they differ from I and O.
const colorOf = (kind, p) => kind === 'J' ? shade(mix(p.primary, p.info, 0.5), -0.3) :kind === 'L' ? mix(p.warning, p.danger, 0.5) : p[{ I: 'info', O: 'warning', T: 'primary', S: 'success', Z: 'danger' }[kind]];
const START = { facil: 900, normal: 650, dificil: 380 };
const KINDS = Object.keys(SHAPES);
const CLEAR_MS = 260;

const rotate = (cells, kind) => {
  if (kind === 'O') return cells;
  const size = kind === 'I' ? 4 : 3;
  return cells.map(([x, y]) => [size - 1 - y, x]);
};
// A bag of the seven pieces, shuffled: never the same piece five times in a row.
const bag = () => KINDS.map((k) => [Math.random(), k]).sort((a, b) => a[0] - b[0]).map(([, k]) => k);
const newPiece = (kind) => ({ kind, cells: SHAPES[kind].map((c) => [...c]), x: 3, y: -1 });

export default function Tetris({ level, onScore, onOver, paused }) {
  const t = useT();
  const canvas = useRef(null);
  const g = useRef(null);
  if (!g.current) {
    const b = bag();
    g.current = { grid: Array.from({ length: H }, () => Array(W).fill(null)), bag: b, piece: newPiece(b.shift()), next: newPiece(b.shift()), acc: 0, score: 0, lines: 0, over: false, clearing: null, sparks: new Particles(), time: 0, landed: 0 };
  }
  const take = () => { const s = g.current; if (!s.bag.length) s.bag = bag(); return newPiece(s.bag.shift()); };
  const fits = (cells, px, py) => cells.every(([cx, cy]) => { const x = px + cx; const y = py + cy; return x >= 0 && x < W && y < H && (y < 0 || !g.current.grid[y][x]); });
  const draw = () => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
    const p = palette(); const s = g.current; const r = p.skin === 'retro' ? 0 : 5;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    backdrop(ctx, BOARD_W, HEIGHT, p, { grid: CELL, radius: 12 });
    const paint = (x, y, kind, alpha = 1) => { ctx.globalAlpha = alpha; block(ctx, x + 1, y + 1, CELL - 2, CELL - 2, colorOf(kind, p), p, r); ctx.globalAlpha = 1; };
    const ghostCell = (x, y, kind) => { ctx.strokeStyle = tint(colorOf(kind, p), 0.55); ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x + 3, y + 3, CELL - 6, CELL - 6, Math.max(0, r - 2)) : ctx.rect(x + 3, y + 3, CELL - 6, CELL - 6); ctx.stroke(); ctx.setLineDash([]); };
    s.grid.forEach((row, y) => row.forEach((k, x) => { if (k) paint(x * CELL, y * CELL, k); }));
    if (s.clearing) {
      // Rows that go: white flash, then they thin out towards the middle.
      const k = Math.min(1, s.clearing.t / CLEAR_MS);
      for (const y of s.clearing.rows) {
        ctx.fillStyle = tint('#ffffff', k < 0.4 ? 0.9 : 0.9 * (1 - (k - 0.4) / 0.6));
        const inset = k < 0.4 ? 0 : (BOARD_W / 2) * ((k - 0.4) / 0.6);
        ctx.fillRect(inset, y * CELL, BOARD_W - inset * 2, CELL);
      }
    }
    if (s.piece && !s.over) {
      let gy = s.piece.y; while (fits(s.piece.cells, s.piece.x, gy + 1)) gy++;
      s.piece.cells.forEach(([cx, cy]) => { if (gy + cy >= 0 && gy !== s.piece.y) ghostCell((s.piece.x + cx) * CELL, (gy + cy) * CELL, s.piece.kind); });
      s.piece.cells.forEach(([cx, cy]) => { if (s.piece.y + cy >= 0) paint((s.piece.x + cx) * CELL, (s.piece.y + cy) * CELL, s.piece.kind); });
    }
    s.sparks.draw(ctx);
    // The side panel: next piece in its box, lines and level.
    const px = BOARD_W + PAD; const pw = SIDE - PAD;
    ctx.fillStyle = tint(p.fg, p.dark ? 0.08 : 0.05); roundRect(ctx, px, 0, pw, 112, r * 2);
    ctx.fillStyle = p.mutedFg; ctx.font = font(p, 11); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillText(label(t, 'games.next', 'Siguiente').toUpperCase(), px + 12, 20);
    const nw = Math.max(...s.next.cells.map(([x]) => x)) + 1; const nh = Math.max(...s.next.cells.map(([, y]) => y)) + 1;
    const minX = Math.min(...s.next.cells.map(([x]) => x)); const minY = Math.min(...s.next.cells.map(([, y]) => y));
    const ox = px + (pw - (nw - minX) * CELL) / 2; const oy = 30 + (70 - (nh - minY) * CELL) / 2;
    s.next.cells.forEach(([cx, cy]) => paint(ox + (cx - minX) * CELL, oy + (cy - minY) * CELL, s.next.kind));
    const stat = (title, value, y) => {
      ctx.fillStyle = tint(p.fg, p.dark ? 0.08 : 0.05); roundRect(ctx, px, y, pw, 54, r * 2);
      ctx.fillStyle = p.mutedFg; ctx.font = font(p, 11); ctx.fillText(title.toUpperCase(), px + 12, y + 20);
      ctx.fillStyle = p.fg; ctx.font = font(p, 20, 700); ctx.fillText(String(value), px + 12, y + 44);
    };
    stat(label(t, 'games.lines', 'Líneas'), s.lines, 124);
    stat(label(t, 'games.speed', 'Velocidad'), 1 + Math.floor(s.lines / 10), 188);
    if (s.over) { ctx.fillStyle = tint(p.danger, 0.12); roundRect(ctx, 0, 0, BOARD_W, HEIGHT, corner(p, 12)); }
  };
  const settle = () => {
    // After the flash: the rows go, the next piece comes.
    const s = g.current;
    const kept = s.grid.filter((_, y) => !s.clearing.rows.includes(y));
    s.grid = [...Array.from({ length: s.clearing.rows.length }, () => Array(W).fill(null)), ...kept];
    s.clearing = null;
    s.piece = s.next; s.next = take();
    if (!fits(s.piece.cells, s.piece.x, s.piece.y)) { s.over = true; onOver(s.score); }
  };
  const lock = () => {
    const s = g.current;
    for (const [cx, cy] of s.piece.cells) { const y = s.piece.y + cy; if (y < 0) { s.over = true; draw(); onOver(s.score); return; } s.grid[y][s.piece.x + cx] = s.piece.kind; }
    const p = palette();
    if (!reducedMotion()) for (const [cx, cy] of s.piece.cells) s.sparks.burst((s.piece.x + cx + 0.5) * CELL, (s.piece.y + cy + 1) * CELL, tint(p.fg, 0.5), 2, 0.08, 1.5);
    const rows = []; s.grid.forEach((row, y) => { if (row.every(Boolean)) rows.push(y); });
    if (rows.length) {
      s.lines += rows.length; s.score += [0, 100, 300, 500, 800][rows.length] * (1 + Math.floor((s.lines - rows.length) / 10)); onScore(s.score);
      for (const y of rows) s.sparks.burst(BOARD_W / 2, (y + 0.5) * CELL, rows.length >= 4 ? p.primary : p.warning, 16, 0.4, 2.5);
      s.clearing = { rows, t: reducedMotion() ? CLEAR_MS : 0 }; s.piece = null;
      if (reducedMotion()) settle();
      return;
    }
    s.piece = s.next; s.next = take();
    if (!fits(s.piece.cells, s.piece.x, s.piece.y)) { s.over = true; onOver(s.score); }
  };
  const move = (dx, dy) => { const s = g.current; if (s.piece && fits(s.piece.cells, s.piece.x + dx, s.piece.y + dy)) { s.piece.x += dx; s.piece.y += dy; return true; } return false; };
  useKeys((key) => {
    const s = g.current; if (s.over || paused || !s.piece) return /^(Arrow| )/.test(key) ? true : false;
    if (key === 'ArrowLeft') move(-1, 0);
    else if (key === 'ArrowRight') move(1, 0);
    else if (key === 'ArrowDown') { if (!move(0, 1)) lock(); else { s.score += 1; onScore(s.score); } }
    else if (key === 'ArrowUp' || key === 'x' || key === 'X') {
      const r = rotate(s.piece.cells, s.piece.kind);
      for (const kick of [0, -1, 1, -2, 2]) if (fits(r, s.piece.x + kick, s.piece.y)) { s.piece.cells = r; s.piece.x += kick; break; }
    } else if (key === ' ') { let n = 0; while (move(0, 1)) n++; s.score += n * 2; onScore(s.score); lock(); }
    else return false;
    draw(); return true;
  });
  useEffect(() => { setupCanvas(canvas.current, WIDTH, HEIGHT); draw(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLoop((dt) => {
    const s = g.current; s.time += dt; s.sparks.step(dt);
    if (s.over) { if (s.sparks.alive) draw(); return; }
    if (s.clearing) { s.clearing.t += dt; if (s.clearing.t >= CLEAR_MS) settle(); draw(); return; }
    s.acc += dt;
    const speed = Math.max(90, START[level] - s.lines * 25);
    if (s.acc >= speed) { s.acc = 0; if (!move(0, 1)) lock(); }
    draw();
  }, !paused);
  return <canvas ref={canvas} className="rounded-2xl" aria-label="Tetris" />;
}

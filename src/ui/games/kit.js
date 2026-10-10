// 2.6: what the mini-games share: the game loop, the keys, the theme's colours and the best scores (this PC only).
import { useEffect, useRef } from 'react';

export const LEVELS = ['facil', 'normal', 'dificil'];

// step(dt in ms) every frame while running; paused when the window is hidden.
export function useLoop(step, running) {
  const ref = useRef(step);
  ref.current = step;
  useEffect(() => {
    if (!running) return undefined;
    let last = performance.now(); let id = 0;
    const tick = (now) => { ref.current(Math.min(64, now - last)); last = now; id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [running]);
}

// The game's keys: arrows, space and letters stop scrolling the page while it is open.
export function useKeys(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const down = (e) => {
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      if (ref.current(e.key, e) !== false && /^(Arrow|\s$| )/.test(e.key)) e.preventDefault();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);
}

// The colours of the visual theme in use, for the canvas.
export function palette() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--card', '#fff'), fg: v('--foreground', '#111'), muted: v('--muted', '#eee'), mutedFg: v('--muted-foreground', '#777'),
    primary: v('--primary', '#4f6bed'), accent: v('--accent', '#e8ecff'), border: v('--border', '#ddd'),
    success: v('--success', '#2bb673'), warning: v('--warning', '#f5a524'), danger: v('--destructive', '#e5484d'), info: v('--info', '#3b82f6')
  };
}

const KEY = 'orb.juegos.records';
export function best(game, level) { try { return JSON.parse(localStorage.getItem(KEY) || '{}')[`${game}:${level}`] ?? 0; } catch { return 0; } }
export function saveBest(game, level, score) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (score > (all[`${game}:${level}`] ?? 0)) { all[`${game}:${level}`] = score; localStorage.setItem(KEY, JSON.stringify(all)); return true; }
  } catch { /* storage unavailable: no records */ }
  return false;
}

// A canvas sharp on high-density screens: draw in CSS pixels.
export function setupCanvas(canvas, width, height) {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  ctx.fill();
}

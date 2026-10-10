// 2.6: what the mini-games share: the game loop, the keys, the theme's colours (with helpers to tint and mix them on a
// canvas), particles, the best scores (this PC only) and a sharp canvas.
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

// The visual theme in use: html[data-skin] (orb | vaporwave | retro | profesional | nube) and html.dark.
export const skin = () => document.documentElement.dataset.skin || 'orb';
export const isDark = () => document.documentElement.classList.contains('dark');
// Less motion: the system asks for it, or the «profesional» theme (no decorative motion).
export const reducedMotion = () => skin() === 'profesional' || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

// The colours of the visual theme in use, for the canvas (read at most every 250 ms: getComputedStyle is not free).
let cache = null; let cacheAt = 0; let cacheKey = '';
export function palette() {
  const key = `${skin()}|${isDark()}`;
  const now = performance.now();
  if (cache && key === cacheKey && now - cacheAt < 250) return cache;
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  cache = {
    bg: v('--card', '#fff'), fg: v('--foreground', '#111'), muted: v('--muted', '#eee'), mutedFg: v('--muted-foreground', '#777'),
    primary: v('--primary', '#4f6bed'), accent: v('--accent', '#e8ecff'), border: v('--border', '#ddd'),
    success: v('--success', '#2bb673'), warning: v('--warning', '#f5a524'), danger: v('--destructive', '#e5484d'), info: v('--info', '#3b82f6'),
    font: getComputedStyle(document.body).fontFamily || 'sans-serif', dark: isDark(), skin: skin()
  };
  cacheAt = now; cacheKey = key;
  return cache;
}

// ---- colour helpers: the theme's colours are oklch(); a canvas can paint them but not change them, so they are
// resolved to rgb once (one pixel of a hidden canvas) and mixed from there.
const rgbCache = new Map();
let probe = null;
export function rgb(color) {
  if (Array.isArray(color)) return color;
  let hit = rgbCache.get(color);
  if (hit) return hit;
  probe ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  probe.clearRect(0, 0, 1, 1); probe.fillStyle = '#000'; probe.fillStyle = color; probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  hit = [d[0], d[1], d[2]];
  if (rgbCache.size > 400) rgbCache.clear();
  rgbCache.set(color, hit);
  return hit;
}
export const tint = (color, alpha) => { const [r, g, b] = rgb(color); return `rgba(${r},${g},${b},${alpha})`; };
export const mix = (a, b, t) => { const x = rgb(a); const y = rgb(b); return `rgb(${Math.round(x[0] + (y[0] - x[0]) * t)},${Math.round(x[1] + (y[1] - x[1]) * t)},${Math.round(x[2] + (y[2] - x[2]) * t)})`; };
// Lighter (amount > 0) or darker (amount < 0) version of a colour.
export const shade = (color, amount) => mix(color, amount > 0 ? '#ffffff' : '#000000', Math.min(1, Math.abs(amount)));

// ---- little sparks: bursts when something is eaten, broken or lost.
export class Particles {
  constructor() { this.list = []; }
  burst(x, y, color, n = 12, speed = 0.25, size = 3) {
    if (reducedMotion()) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2; const v = speed * (0.4 + Math.random());
      this.list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.3, life: 0, ttl: 350 + Math.random() * 300, color, size: size * (0.6 + Math.random() * 0.8) });
    }
  }
  step(dt, gravity = 0.0012) {
    for (const p of this.list) { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += gravity * dt; }
    this.list = this.list.filter((p) => p.life < p.ttl);
  }
  draw(ctx) {
    for (const p of this.list) {
      const k = 1 - p.life / p.ttl;
      ctx.globalAlpha = k; ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.size * k), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  get alive() { return this.list.length > 0; }
}

// The canvas text: the theme's font; on retro the pixel font of its titles (smaller: it is a wide one).
export const font = (p, size, weight = 600) => (p.skin === 'retro' ? `${Math.round(size * 0.72)}px "Press Start 2P", monospace` : `${weight} ${size}px ${p.font}`);
// Corners: the theme's rounding, none on retro (its CSS squares everything).
export const corner = (p, r) => (p.skin === 'retro' ? 0 : r);

// A pleasant backdrop for the board: the theme's muted colour with a soft vignette, a faint grid and, on retro, scanlines.
export function backdrop(ctx, w, h, p, { grid = 0, radius = 14 } = {}) {
  ctx.save();
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, w, h, corner(p, radius)) : ctx.rect(0, 0, w, h); ctx.clip();
  ctx.fillStyle = p.muted; ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w * 0.5, h * 0.3, 10, w * 0.5, h * 0.4, Math.max(w, h) * 0.85);
  glow.addColorStop(0, tint(p.primary, p.dark ? 0.16 : 0.1)); glow.addColorStop(1, tint(p.primary, 0));
  ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  if (grid) {
    ctx.strokeStyle = tint(p.fg, p.dark ? 0.07 : 0.05); ctx.lineWidth = 1; ctx.beginPath();
    for (let x = grid; x < w; x += grid) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
    for (let y = grid; y < h; y += grid) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
    ctx.stroke();
  }
  if (p.skin === 'retro') { ctx.fillStyle = tint('#000000', p.dark ? 0.18 : 0.06); for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1); }
  ctx.restore();
}

// A small HUD label with a translucent pill behind it.
export function hud(ctx, text, x, y, p, { align = 'left', size = 12, color = p.fg } = {}) {
  ctx.font = font(p, size); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const w = ctx.measureText(text).width + 16; const h = size + 10;
  const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  ctx.fillStyle = tint(p.bg, p.dark ? 0.55 : 0.75); roundRect(ctx, left, y - h / 2, w, h, corner(p, h / 2));
  ctx.fillStyle = color; ctx.fillText(text, left + 8, y + 0.5);
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

// A glossy block (Tetris, bricks): the colour, a lighter top edge and a darker bottom one; square on retro.
export function block(ctx, x, y, w, h, color, p, r = 4) {
  const radius = p.skin === 'retro' ? 0 : r;
  ctx.fillStyle = shade(color, -0.28); roundRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = color; roundRect(ctx, x, y, w, h - Math.max(2, h * 0.14), radius);
  ctx.fillStyle = shade(color, 0.42); roundRect(ctx, x + Math.max(1.5, w * 0.1), y + Math.max(1.5, h * 0.1), w - Math.max(3, w * 0.2), Math.max(1.5, h * 0.2), Math.max(0, radius - 2));
}

// Easing for the little animations.
export const easeOut = (t) => 1 - (1 - t) ** 3;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// A text from i18n with a fallback while the key is still missing (t() returns the key itself in that case).
export const label = (t, key, fallback) => { const v = t(key); return v === key ? fallback : v; };

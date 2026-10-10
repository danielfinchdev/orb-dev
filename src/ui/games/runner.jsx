// Jumper, a little Geometry Dash: the cube runs on its own at a steady pace and one button (space, ↑ or a click; holding
// it keeps jumping) takes it over spikes and onto blocks, with jump pads that throw it higher, orbs to tap in the air
// and portals that flip gravity. A spike, the side of a block or a hole ends the attempt and the next one starts at
// once, counted. Neon on a dark gradient that beats, parallax silhouettes, a glowing ground with its grid, a trail and
// an explosion, all in the theme's colours. The level and its physics live in runner-level.js.
import { useEffect, useRef } from 'react';
import { useKeys, useLoop, palette, setupCanvas, roundRect, tint, shade, mix, Particles, reducedMotion, corner, font, saveBest, label, clamp } from './kit.js';
import { newRun, reset, step, progress, section, WIDTH, HEIGHT, U, SIZE, GROUND, CEIL, PX } from './runner-level.js';
import { useT } from '@/lib/i18n.js';

const BEAT = 60000 / 128; // a fake beat at 128 bpm
const WAIT = { dead: 720, done: 1500 }; // ms before the next attempt / before the window says it is over
const JUMP_KEYS = new Set([' ', 'ArrowUp', 'w', 'W']);
// Fixed scenery, computed once: far triangles, nearer pillars and gems, and stars; all tiled over a period.
const PERIOD = 1600;
const FAR = Array.from({ length: 9 }, (_, i) => ({ x: (i / 9) * PERIOD + ((i * 37) % 60), w: 160 + ((i * 53) % 120), h: 60 + ((i * 71) % 90) }));
const NEAR = Array.from({ length: 14 }, (_, i) => ({ x: (i / 14) * PERIOD + ((i * 23) % 40), w: 16 + ((i * 29) % 36), h: 24 + ((i * 47) % 70), gem: i % 3 === 0 }));
const STARS = Array.from({ length: 36 }, (_, i) => ({ x: (i * 97.3) % WIDTH, y: CEIL + 6 + ((i * 53.7) % 130), r: 0.7 + ((i * 7) % 3) * 0.45, tw: (i * 37) % 1000 }));

const tri = (ctx, x1, y1, x2, y2, x3, y3) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); };
const diamond = (ctx, cx, cy, r) => { ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath(); };

export default function Runner({ level, onScore, onOver, paused }) {
  const t = useT();
  const canvas = useRef(null);
  const g = useRef(null);
  if (!g.current) {
    g.current = { w: newRun(level), attempt: 1, held: false, time: 0, wait: 0, trail: [], parts: new Particles(), squash: 0, flash: 0, shake: 0, score: 0, reported: false };
    if (import.meta.env.DEV) window.__jumper = g.current; // the preview's bot reads the world to play and take pictures
  }
  const press = (on) => { g.current.held = on; };
  useKeys((key) => { if (JUMP_KEYS.has(key)) { press(true); return true; } return false; });
  useEffect(() => {
    const up = (e) => { if (JUMP_KEYS.has(e.key)) press(false); };
    const release = () => press(false);
    window.addEventListener('keyup', up); window.addEventListener('mouseup', release); window.addEventListener('blur', release);
    return () => { window.removeEventListener('keyup', up); window.removeEventListener('mouseup', release); window.removeEventListener('blur', release); };
  }, []);
  const attemptText = label(t, 'games.runnerAttempt', 'Intento {n}').replace('{n}', String(g.current.attempt));
  const doneText = label(t, 'games.runnerDone', '¡Nivel completado!');

  const draw = () => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
    const s = g.current; const w = s.w; const p = palette(); const rm = reducedMotion();
    const beat = rm ? 0 : (1 - ((s.time % BEAT) / BEAT)) ** 3;
    const neon = p.skin === 'vaporwave' ? 1.6 : 1;
    // The section's colour: the theme's colours one after another, fading into the next at the end of each section.
    const COLS = [p.primary, p.info, p.success, p.warning, p.danger];
    const sec = section(w);
    const accent = mix(COLS[sec.i % COLS.length], COLS[(sec.i + 1) % COLS.length], clamp((sec.k - 0.75) / 0.25, 0, 1) ** 2);
    const base = p.dark ? mix(p.bg, '#000000', 0.45) : mix(p.fg, accent, 0.18);
    const line = mix(accent, '#ffffff', 0.55); const dist = w.dist;
    ctx.save(); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, WIDTH, HEIGHT, corner(p, 14)) : ctx.rect(0, 0, WIDTH, HEIGHT); ctx.clip();
    if (s.shake > 0 && !rm) ctx.translate((Math.random() - 0.5) * s.shake, (Math.random() - 0.5) * s.shake);
    // The sky: dark at the top, the section's colour near the ground, breathing with the beat; stars; the silhouettes.
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0, mix(base, accent, 0.06 + beat * 0.04)); sky.addColorStop(1, mix(base, accent, 0.5 + beat * 0.12));
    ctx.fillStyle = sky; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    for (const st of STARS) { const tw = rm ? 0.6 : 0.35 + 0.65 * Math.abs(Math.sin((s.time + st.tw) / 700)); ctx.fillStyle = tint('#ffffff', tw * 0.7); ctx.beginPath(); ctx.arc((((st.x - dist * 0.04) % WIDTH) + WIDTH) % WIDTH, st.y, st.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = tint(mix(base, accent, 0.3), 0.8);
    for (const f of FAR) { const x = ((((f.x - dist * 0.12) % PERIOD) + PERIOD) % PERIOD) - 200; tri(ctx, x, GROUND, x + f.w / 2, GROUND - f.h, x + f.w, GROUND); ctx.fill(); }
    ctx.fillStyle = tint(mix(base, accent, 0.2), 0.9);
    for (const n of NEAR) { const x = ((((n.x - dist * 0.3) % PERIOD) + PERIOD) % PERIOD) - 100; if (n.gem) { diamond(ctx, x, GROUND - n.h - 24, n.w * 0.7); ctx.fill(); } else ctx.fillRect(x, GROUND - n.h, n.w, n.h); }
    // The ground (in pieces where there are holes) and the ceiling: a band with a grid and a glowing edge.
    const band = mix(base, accent, 0.1); const grid = tint(line, 0.16);
    const edge = (y, dir, x0 = 0, x1 = WIDTH) => { // dir 1: glow above the line (ground), -1: below (ceiling)
      const glow = ctx.createLinearGradient(0, y, 0, y - dir * 18);
      glow.addColorStop(0, tint(accent, (0.35 + beat * 0.3) * neon)); glow.addColorStop(1, tint(accent, 0));
      ctx.fillStyle = glow; ctx.fillRect(x0, Math.min(y, y - dir * 18), x1 - x0, 18);
      ctx.fillStyle = line; ctx.fillRect(x0, dir > 0 ? y - 2 : y, x1 - x0, 2);
    };
    const gaps = w.objects.filter((o) => o.kind === 'gap' && o.px - dist < WIDTH + 10 && o.px + o.w - dist > -10).map((o) => [o.px - dist, o.px + o.w - dist]).sort((a, b) => a[0] - b[0]);
    const pieces = []; let x0 = 0;
    for (const [a, b] of gaps) { if (a > x0) pieces.push([x0, a]); x0 = Math.max(x0, b); }
    if (x0 < WIDTH) pieces.push([x0, WIDTH]);
    ctx.fillStyle = mix(base, '#000000', 0.55); ctx.fillRect(0, GROUND, WIDTH, HEIGHT - GROUND); // the void under the holes
    const lines = (y0, y1, x0, x1) => { ctx.fillStyle = grid; for (let x = x0 - (((x0 + dist) % U) + U) % U; x < x1; x += U) if (x >= x0) ctx.fillRect(x, y0, 1, y1 - y0); };
    for (const [a, b] of pieces) { ctx.fillStyle = band; ctx.fillRect(a, GROUND, b - a, HEIGHT - GROUND); lines(GROUND, HEIGHT, a, b); ctx.fillStyle = grid; ctx.fillRect(a, GROUND + U, b - a, 1); edge(GROUND, 1, a, b); }
    for (const [a, b] of gaps) { ctx.fillStyle = tint(accent, 0.5); ctx.fillRect(a, GROUND, 2, HEIGHT - GROUND); ctx.fillRect(b - 2, GROUND, 2, HEIGHT - GROUND); }
    ctx.fillStyle = band; ctx.fillRect(0, 0, WIDTH, CEIL); lines(0, CEIL, 0, WIDTH); edge(CEIL, -1);
    // The level's pieces.
    const dark = mix(base, accent, 0.14); const r = corner(p, 3);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const o of w.objects) {
      const x = (o.px ?? o.cx) - dist; if (x > WIDTH + 60 || x < -140) continue;
      if (o.kind === 'spike') {
        const tip = o.ceil ? o.base + o.h : o.base - o.h;
        tri(ctx, x, o.base, x + o.w / 2, tip, x + o.w, o.base);
        ctx.fillStyle = dark; ctx.fill(); ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.stroke();
        tri(ctx, x + 5, o.base, x + o.w / 2, o.ceil ? tip - 6 : tip + 6, x + o.w / 2, o.base); ctx.fillStyle = tint(line, 0.25); ctx.fill();
      } else if (o.kind === 'block') {
        ctx.fillStyle = mix(base, accent, 0.26); roundRect(ctx, x, o.py, o.w, o.h, r);
        ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x + 1, o.py + 1, o.w - 2, o.h - 2, r) : ctx.rect(x + 1, o.py + 1, o.w - 2, o.h - 2); ctx.stroke();
        ctx.strokeStyle = tint('#ffffff', 0.14); ctx.lineWidth = 1; ctx.strokeRect(x + 6.5, o.py + 6.5, o.w - 13, o.h - 13);
        ctx.fillStyle = tint(accent, 0.35 + beat * 0.2); ctx.fillRect(x + 2, o.ceil ? o.py + o.h - 4 : o.py + 2, o.w - 4, 2); // the lit edge you land on
      } else if (o.kind === 'pad') {
        ctx.save(); if (!o.used) { ctx.shadowColor = p.warning; ctx.shadowBlur = 10 * neon; }
        ctx.fillStyle = o.used ? tint(p.warning, 0.45) : p.warning; roundRect(ctx, x + 2, o.py + (o.used ? 3 : 0), o.w - 4, o.h, corner(p, 4));
        ctx.fillStyle = tint('#ffffff', 0.6); ctx.fillRect(x + 6, o.py + 1 + (o.used ? 3 : 0), o.w - 12, 2); ctx.restore();
      } else if (o.kind === 'orb') {
        const rad = o.r + (o.used ? 0 : beat * 2.5);
        ctx.save(); if (!o.used) { ctx.shadowColor = p.warning; ctx.shadowBlur = 16 * neon; }
        ctx.fillStyle = o.used ? tint(p.warning, 0.35) : p.warning; ctx.beginPath(); ctx.arc(x, o.cy, rad, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        ctx.strokeStyle = tint('#ffffff', o.used ? 0.3 : 0.85); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, o.cy, rad - 4, 0, Math.PI * 2); ctx.stroke();
        if (!o.used) { ctx.fillStyle = tint('#ffffff', 0.9); ctx.beginPath(); ctx.arc(x - 3, o.cy - 3, 2.2, 0, Math.PI * 2); ctx.fill(); }
      } else if (o.kind === 'portal') {
        const c = o.flip ? p.info : p.warning;
        ctx.save(); ctx.shadowColor = c; ctx.shadowBlur = 14 * neon;
        ctx.fillStyle = tint(c, 0.28); roundRect(ctx, x, o.py, o.w, o.h, corner(p, 9)); ctx.restore();
        ctx.strokeStyle = mix(c, '#ffffff', 0.4); ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x + 1.5, o.py + 1.5, o.w - 3, o.h - 3, corner(p, 8)) : ctx.rect(x + 1.5, o.py + 1.5, o.w - 3, o.h - 3); ctx.stroke();
        ctx.fillStyle = tint('#ffffff', 0.85);
        for (let k = 0; k < 3; k++) { const cy = o.py + o.h / 2 + (k - 1) * 22; const d = o.flip ? -1 : 1; tri(ctx, x + 4, cy + d * 5, x + o.w / 2, cy - d * 5, x + o.w - 4, cy + d * 5); ctx.fill(); }
      }
    }
    // The attempt, written on the world itself at the start of the level.
    const ax = PX + 3 * U - dist;
    if (ax > -400 && ax < WIDTH) { ctx.font = font(p, 30, 800); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = tint('#ffffff', 0.55); ctx.fillText(attemptText, ax, 136); }
    // The trail, the sparks, then the cube.
    if (!rm && s.trail.length > 1) {
      for (let i = 1; i < s.trail.length; i++) {
        const k = i / s.trail.length; ctx.strokeStyle = tint(mix(p.primary, '#ffffff', 0.55), k * 0.7); ctx.lineWidth = 1 + k * 5;
        ctx.beginPath(); ctx.moveTo(s.trail[i - 1].wx - dist, s.trail[i - 1].y); ctx.lineTo(s.trail[i].wx - dist, s.trail[i].y); ctx.stroke();
      }
    }
    s.parts.draw(ctx);
    if (w.alive) {
      const sq = Math.max(0, s.squash);
      ctx.save(); ctx.translate(PX + SIZE / 2, w.y + SIZE / 2 + sq * 3 * w.gdir); ctx.rotate(w.rot); ctx.scale(1 + sq * 0.18, 1 - sq * 0.18);
      ctx.shadowColor = tint(p.primary, 0.9); ctx.shadowBlur = 14 * neon;
      ctx.fillStyle = shade(p.primary, -0.35); roundRect(ctx, -SIZE / 2, -SIZE / 2, SIZE, SIZE, r);
      ctx.shadowBlur = 0;
      ctx.fillStyle = p.primary; roundRect(ctx, -SIZE / 2 + 2, -SIZE / 2 + 2, SIZE - 4, SIZE - 4, Math.max(0, r - 1));
      ctx.strokeStyle = mix(p.primary, '#ffffff', 0.72); ctx.lineWidth = 2.5; ctx.strokeRect(-SIZE / 2 + 6, -SIZE / 2 + 6, SIZE - 12, SIZE - 12);
      ctx.fillStyle = '#ffffff'; roundRect(ctx, -8, -5, 6, 7, r ? 1.5 : 0); roundRect(ctx, 2, -5, 6, 7, r ? 1.5 : 0);
      ctx.fillStyle = '#16162a'; ctx.fillRect(-5, -3, 3, 4); ctx.fillRect(5, -3, 3, 4);
      ctx.strokeStyle = '#16162a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-3, 6); ctx.quadraticCurveTo(0, 8.5, 3, 6); ctx.stroke();
      ctx.restore();
    } else if (!rm) {
      const k = clamp(s.wait / 500, 0, 1); // the shock ring of the explosion
      ctx.strokeStyle = tint('#ffffff', (1 - k) * 0.8); ctx.lineWidth = 3 * (1 - k) + 0.5; ctx.beginPath(); ctx.arc(PX + SIZE / 2, w.y + SIZE / 2, 10 + k * 90, 0, Math.PI * 2); ctx.stroke();
    }
    if (s.flash > 0) { ctx.fillStyle = tint('#ffffff', s.flash * 0.35); ctx.fillRect(0, 0, WIDTH, HEIGHT); }
    if (w.done) {
      const k = rm ? 1 : clamp(s.wait / 350, 0, 1);
      ctx.save(); ctx.translate(WIDTH / 2, HEIGHT / 2 - 10); ctx.scale(0.7 + 0.3 * (1 - (1 - k) ** 3), 0.7 + 0.3 * (1 - (1 - k) ** 3)); ctx.globalAlpha = k;
      ctx.font = font(p, 30, 800); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = p.primary; ctx.shadowBlur = 18 * neon; ctx.fillStyle = '#ffffff'; ctx.fillText(doneText, 0, 0); ctx.restore();
    }
    // The HUD: the progress bar with its percentage, the attempt on the left.
    const pct = Math.floor(progress(w) * 100); const bw = 220; const bx = (WIDTH - bw) / 2; const by = 15;
    ctx.fillStyle = tint('#000000', 0.35); roundRect(ctx, bx - 1, by - 1, bw + 2, 10, corner(p, 5));
    ctx.fillStyle = tint('#ffffff', 0.18); roundRect(ctx, bx, by, bw, 8, corner(p, 4));
    const fill = ctx.createLinearGradient(bx, 0, bx + bw, 0); fill.addColorStop(0, p.primary); fill.addColorStop(1, mix(p.primary, '#ffffff', 0.45));
    ctx.fillStyle = fill; if (pct > 0) roundRect(ctx, bx, by, Math.max(8, bw * pct / 100), 8, corner(p, 4));
    ctx.font = font(p, 12, 700); ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffffff'; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 4;
    ctx.textAlign = 'left'; ctx.fillText(`${pct} %`, bx + bw + 10, by + 4.5);
    ctx.fillText(attemptText, 14, by + 4.5); ctx.shadowBlur = 0;
    ctx.restore();
  };

  const restart = () => { const s = g.current; reset(s.w); s.attempt += 1; s.wait = 0; s.trail = []; s.score = 0; s.parts.list = []; onScore(0); };
  useEffect(() => { setupCanvas(canvas.current, WIDTH, HEIGHT); draw(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLoop((dt) => {
    const s = g.current; const w = s.w; const p = palette(); const rm = reducedMotion();
    s.time += dt; s.parts.step(dt, 0.0014); s.squash *= Math.max(0, 1 - dt / 90); s.shake = Math.max(0, s.shake - dt * 0.03); s.flash = Math.max(0, s.flash - dt / 160);
    if (!w.alive) { s.wait += dt; if (s.wait >= (rm ? 350 : WAIT.dead)) restart(); draw(); return; }
    if (w.done) { s.wait += dt; if (s.wait >= WAIT.done && !s.reported) { s.reported = true; onOver(100); } draw(); return; }
    const before = w.dist;
    const ev = step(w, dt, s.held);
    const dx = w.dist - before; const cx = PX + SIZE / 2; const cy = w.y + SIZE / 2; const feet = w.gdir > 0 ? w.y + SIZE : w.y;
    for (const q of s.parts.list) q.x -= dx; // the sparks belong to the world, which scrolls
    for (const e of ev) {
      if (e === 'land') { s.squash = 1; s.parts.burst(cx, feet, tint('#ffffff', 0.6), 6, 0.12, 2); }
      else if (e === 'jump') s.parts.burst(cx - 6, feet, tint('#ffffff', 0.45), 4, 0.1, 1.6);
      else if (e === 'pad') s.parts.burst(cx, feet, p.warning, 14, 0.3, 2.5);
      else if (e === 'orb') s.parts.burst(cx, cy, p.warning, 12, 0.28, 2.5);
      else if (e === 'flip') s.parts.burst(cx, cy, p.info, 14, 0.3, 2.5);
      else if (e === 'dead') { s.wait = 0; s.flash = 1; s.shake = rm ? 0 : 9; s.parts.burst(cx, cy, p.primary, 28, 0.42, 4); s.parts.burst(cx, cy, '#ffffff', 10, 0.3, 2); saveBest('runner', level, s.score); }
      else if (e === 'done') { s.wait = 0; s.parts.burst(WIDTH / 2, HEIGHT / 2, p.primary, 30, 0.4, 3.5); s.parts.burst(WIDTH / 2, HEIGHT / 2, p.warning, 20, 0.35, 3); s.score = 100; saveBest('runner', level, 100); onScore(100); }
    }
    if (w.alive && !w.done) {
      s.trail.push({ wx: w.dist + cx, y: cy }); if (s.trail.length > 16) s.trail.shift();
      const pct = Math.floor(progress(w) * 100);
      if (pct !== s.score) { s.score = pct; onScore(pct); }
    }
    draw();
  }, !paused);
  return <canvas ref={canvas} className="max-w-full cursor-pointer rounded-2xl shadow-lg ring-1 ring-black/5 dark:ring-white/10" onMouseDown={() => press(true)} onContextMenu={(e) => e.preventDefault()} aria-label="Salto" />;
}

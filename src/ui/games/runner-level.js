// Jumper's world, with no DOM in it (so it can be checked from node): the hand-made level, built from pattern sections,
// and the physics of one step: gravity, landing on the ground or a block, spikes, jump pads, orbs, portals and holes.
// Sizes in pixels of a 640x300 canvas; the level is designed in units of one block (U).
export const WIDTH = 640; export const HEIGHT = 300; export const U = 28; export const SIZE = U;
export const GROUND = 244; export const CEIL = 40; export const PX = 130; // where the cube is drawn
export const SPEED = { facil: 0.28, normal: 0.33, dificil: 0.4 }; // px per ms, steady
export const G = 0.0021; export const JUMP = 0.52; export const PAD = 0.8; export const ORB = 0.56; // px/ms
export const AIR = (2 * JUMP) / G; // ms in the air of a plain jump
export const ROT = (Math.PI / 2) / AIR; // a quarter turn per jump
const D = { facil: 0, normal: 1, dificil: 2 };
const X = (u) => PX + (6 + u) * U; // unit → world px (the cube starts 6 blocks before unit 0)

// The level: sections one after the other with some runway in between (more on «fácil»). Each section places its
// patterns from x (in units) and returns its length; the difficulty adds or removes a spike here and there.
export function buildLevel(level) {
  const d = D[level] ?? 1;
  const objects = [];
  const spike = (x, n = 1, o = {}) => { for (let i = 0; i < n; i++) objects.push({ kind: 'spike', x: x + i, y: o.y || 0, ceil: Boolean(o.ceil) }); };
  const block = (x, w, h, y = 0, ceil = false) => objects.push({ kind: 'block', x, w, h, y, ceil });
  const pad = (x) => objects.push({ kind: 'pad', x });
  const orb = (x, y) => objects.push({ kind: 'orb', x, y });
  const portal = (x, flip) => objects.push({ kind: 'portal', x, flip });
  const gap = (x, w) => objects.push({ kind: 'gap', x, w });
  const sections = [
    () => 12, // the runway, with the attempt number
    (x) => { spike(x); spike(x + 7); spike(x + 14); if (d) spike(x + 21); return d ? 26 : 19; },
    (x) => { spike(x, 2); block(x + 8, 2, 1); spike(x + 10); spike(x + 16, 2); spike(x + 25, d === 2 ? 3 : 2); return 32; },
    (x) => { block(x, 3, 1); block(x + 3, 3, 2); block(x + 6, 3, 3); spike(x + 13, 2); if (d === 2) spike(x + 23); return 26; },
    (x) => { spike(x + 1, 7); block(x + 2, 3, 1, 0.7); block(x + 8, 4, 1, 1); spike(x + 14, d === 2 ? 2 : 1); return 19; },
    (x) => { pad(x); block(x + 3, 2, 4); spike(x + 5, d ? 2 : 1); spike(x + 11 + d); return 17; },
    (x) => { spike(x, d ? 7 : 6); orb(x + 3.2, 2.3); return 12; },
    (x) => { gap(x, 2.5); spike(x + 8); gap(x + 13, d === 2 ? 3.5 : 3); if (d) spike(x + 22); return 26; },
    (x) => { portal(x, true); spike(x + 7, 1, { ceil: true }); spike(x + 13, d ? 2 : 1, { ceil: true }); block(x + 19, 2, 1, 0, true); spike(x + 24, d === 2 ? 2 : 1, { ceil: true }); portal(x + 29, false); spike(x + 37, d ? 2 : 1); return 42; },
    (x) => { spike(x, 2); spike(x + 6, 3); orb(x + 7.3, 2.2); spike(x + 14, d ? 3 : 2); block(x + 20, 1, 2); spike(x + 24, 2); return 30; },
    (x) => { spike(x, d ? 3 : 2); block(x + 6, 2, 1); spike(x + 8); spike(x + 13, 2); pad(x + 18); block(x + 21, 2, 3); spike(x + 23, 2); spike(x + 30, d === 2 ? 3 : 2); return 36; },
    () => 10 // the end
  ];
  const rest = [5, 3, 1][d];
  const starts = []; let x = 0;
  for (const s of sections) { starts.push(X(x)); x += s(x) + rest; }
  // Pixel geometry of each object; the spikes' hitbox is smaller than the drawing (as in the game it imitates).
  const px = objects.map((o) => {
    const wx = X(o.x);
    switch (o.kind) {
      case 'spike': { const base = o.ceil ? CEIL + o.y * U : GROUND - o.y * U; const hh = U * 0.62; return { ...o, px: wx, w: U, h: U, base, hx: wx + U * 0.22, hw: U * 0.56, hy: o.ceil ? base : base - hh, hh }; }
      case 'block': return { ...o, px: wx, w: o.w * U, h: o.h * U, py: o.ceil ? CEIL + o.y * U : GROUND - (o.y + o.h) * U };
      case 'pad': return { ...o, px: wx, w: U, h: 7, py: GROUND - 7 };
      case 'orb': return { ...o, cx: wx + U / 2, cy: GROUND - o.y * U, r: 11 };
      case 'portal': return { ...o, px: wx, w: 18, py: 84, h: 112 };
      default: return { ...o, px: wx, w: o.w * U }; // gap
    }
  });
  return { objects: px, starts, end: X(x) };
}

export function newRun(level) {
  const L = buildLevel(level);
  return { level, objects: L.objects, starts: L.starts, end: L.end, speed: SPEED[level] ?? SPEED.normal, dist: 0, y: GROUND - SIZE, vy: 0, ground: true, gdir: 1, rot: 0, rotTo: 0, events: [], alive: true, done: false };
}
export function reset(w) {
  Object.assign(w, { dist: 0, y: GROUND - SIZE, vy: 0, ground: true, gdir: 1, rot: 0, rotTo: 0, events: [], alive: true, done: false });
  for (const o of w.objects) o.used = false;
}
export const progress = (w) => Math.max(0, Math.min(1, w.dist / (w.end - PX)));
// Which section the cube is in, and how far into it (0..1), for the colours.
export function section(w) {
  const wx = w.dist + PX; let i = 0;
  while (i + 1 < w.starts.length && w.starts[i + 1] <= wx) i++;
  const a = w.starts[i]; const b = w.starts[i + 1] ?? w.end;
  return { i, k: Math.max(0, Math.min(1, (wx - a) / Math.max(1, b - a))) };
}

const die = (w, by) => { w.alive = false; w.hit = by; w.events.push('dead'); return w.events; };
// One step of dt ms with the button held or not. The events say what happened (jump, land, pad, orb, flip, dead, done).
export function step(w, dt, held) {
  const ev = (w.events = []);
  if (!w.alive || w.done) return ev;
  if (held && w.ground) { w.vy = -JUMP * w.gdir; w.ground = false; ev.push('jump'); }
  w.dist += w.speed * dt;
  const wx = w.dist + PX;
  const prev = w.y; w.vy += G * w.gdir * dt; let y = w.y + w.vy * dt;
  const overX = (x, wd, inset) => wx + SIZE - inset > x && wx + inset < x + wd;
  const overY = (yy, hh, inset) => y + SIZE - inset > yy && y + inset < yy + hh;
  // Where it rests: the ground (unless over a hole), the ceiling when gravity is flipped, or a block it comes onto.
  // A block reached from the side or from below ends the attempt.
  let rest = w.gdir > 0 ? GROUND - SIZE : CEIL;
  for (const o of w.objects) {
    if (o.kind === 'gap') { if (w.gdir > 0 && wx + SIZE / 2 > o.px && wx + SIZE / 2 < o.px + o.w) rest = Infinity; continue; }
    if (o.kind !== 'block' || !overX(o.px, o.w, 3)) continue;
    if (w.gdir > 0) {
      if (prev + SIZE <= o.py + 6) rest = Math.min(rest, o.py - SIZE);
      else if (overY(o.py, o.h, 2)) return die(w, o);
    } else if (prev >= o.py + o.h - 6) rest = Math.max(rest, o.py + o.h);
    else if (overY(o.py, o.h, 2)) return die(w, o);
  }
  const was = w.ground;
  if (w.gdir > 0) {
    if (y >= rest) { y = rest; w.vy = 0; w.ground = true; } else w.ground = false;
    if (y < CEIL) { y = CEIL; w.vy = 0; }
    if (rest === Infinity && y > GROUND) return die(w, 'hole'); // down the hole
  } else {
    if (y <= rest) { y = rest; w.vy = 0; w.ground = true; } else w.ground = false;
    if (y + SIZE > GROUND) { y = GROUND - SIZE; w.vy = 0; }
  }
  w.y = y;
  if (w.ground && !was) { ev.push('land'); w.rotTo = Math.round(w.rot / (Math.PI / 2)) * (Math.PI / 2); }
  if (w.ground) w.rot += (w.rotTo - w.rot) * Math.min(1, dt / 45); else w.rot += ROT * w.gdir * dt;
  for (const o of w.objects) {
    if (o.kind === 'spike') { if (overX(o.hx, o.hw, 4) && overY(o.hy, o.hh, 4)) return die(w, o); }
    else if (o.kind === 'pad') { if (!o.used && w.gdir > 0 && overX(o.px, o.w, 2) && overY(o.py, o.h, 0)) { o.used = true; w.vy = -PAD; w.ground = false; ev.push('pad'); } }
    else if (o.kind === 'orb') { if (held && !o.used && overX(o.cx - 15, 30, 2) && overY(o.cy - 15, 30, 2)) { o.used = true; w.vy = -ORB * w.gdir; w.ground = false; ev.push('orb'); } }
    else if (o.kind === 'portal') { const g = o.flip ? -1 : 1; if (g !== w.gdir && overX(o.px, o.w, 0) && overY(o.py, o.h, 0)) { w.gdir = g; w.vy = 0; w.ground = false; ev.push('flip'); } }
  }
  if (wx >= w.end) { w.done = true; ev.push('done'); }
  return ev;
}

// 3.6: the bots' avatar family (docs/DESIGN-SYSTEM.md › 2.5, mockup docs/diseno/maquetas/avatares.js). Original art:
// twelve soft bodies in ten bright, nearly flat colours, and Orb's face: two short rounded dark strokes with their own
// spacing, tilt and offset on each body (no mouth). Pure data and functions, no DOM and no Node: the engine (database,
// validation, templates), the window (components/bot-avatar.jsx) and later the notifications draw from here.
// A bot's avatar is { shape, color }; one without (an old bot) gets a fixed one from its id (avatarFor).

// Bodies on a 100×100 box, resting near y = 90. face: where the eyes sit. eyes: gap (half the distance between them),
// len (stroke length), tilt (degrees; the right eye leans 60 % of it) and dx (a small sideways offset).
export const SHAPES = {
  nube: { d: 'M24 86c-10 0-17-8-17-18 0-9 6-16 14-17 1-14 12-25 26-25 11 0 20 6 24 15 2-1 4-1 6-1 11 0 19 9 19 20 0 15-10 26-24 26z', face: [52, 60], eyes: { gap: 8, len: 7, tilt: -8, dx: 1 } },
  gota: { d: 'M50 10c6 9 34 34 34 52 0 17-15 28-34 28S16 79 16 62c0-18 28-43 34-52z', face: [50, 62], eyes: { gap: 6.5, len: 8, tilt: 6, dx: 0 } },
  judia: { d: 'M30 20c14-6 24 6 36 3 14-3 24 9 22 27-2 24-20 40-42 40-20 0-34-14-34-34 0-16 6-30 18-36z', face: [50, 56], eyes: { gap: 9, len: 9, tilt: -12, dx: 3 } },
  mochi: { d: 'M50 26c26 0 40 14 40 34 0 20-12 28-40 28S10 80 10 60c0-20 14-34 40-34z', face: [50, 60], eyes: { gap: 11, len: 7, tilt: 0, dx: 0 } },
  flor: { d: 'M50 12c10 0 16 9 15 18 8-5 19-2 22 7s-3 17-11 20c7 5 9 15 3 22s-17 6-22-1c-1 9-9 14-16 13s-13-6-14-13c-6 7-17 7-22 0s-3-17 4-22c-8-3-13-12-10-20s14-11 22-6c-1-9 5-18 14-18z', face: [50, 54], eyes: { gap: 7.5, len: 7, tilt: 10, dx: -1 } },
  estrella: { d: 'M50 10c4 0 6 3 8 8l6 13c1 2 3 3 5 3l14 2c6 1 9 3 9 7 0 3-2 5-5 8l-10 10c-2 2-2 4-2 6l3 14c1 6 0 10-4 11-3 1-6 0-10-3l-12-7c-2-1-4-1-6 0l-12 7c-4 3-7 4-10 3-4-1-5-5-4-11l3-14c0-2 0-4-2-6L7 51c-3-3-5-5-5-8 0-4 3-6 9-7l14-2c2 0 4-1 5-3l6-13c2-5 4-8 8-8z', face: [50, 56], eyes: { gap: 7, len: 6.5, tilt: -6, dx: 0 } },
  canto: { d: 'M46 16c22-3 42 10 43 34 1 22-14 38-38 39-22 1-40-12-40-34 0-20 14-36 35-39z', face: [50, 56], eyes: { gap: 9, len: 9, tilt: 8, dx: -2 } },
  gominola: { d: 'M50 14c22 0 34 18 36 40l3 26c1 6-3 10-9 10H20c-6 0-10-4-9-10l3-26c2-22 14-40 36-40z', face: [50, 58], eyes: { gap: 9, len: 8, tilt: -4, dx: 0 } },
  bollo: { d: 'M50 4c7 0 12 5 12 11 0 2 0 3-1 5 17 4 29 17 29 35 0 22-17 35-40 35S10 77 10 55c0-18 12-31 29-35-1-2-1-3-1-5 0-6 5-11 12-11z', face: [50, 60], eyes: { gap: 6.5, len: 7, tilt: 12, dx: 1 } },
  corazon: { d: 'M50 88C30 76 8 60 8 38 8 24 18 14 31 14c8 0 15 4 19 11 4-7 11-11 19-11 13 0 23 10 23 24 0 22-22 38-42 50z', face: [50, 48], eyes: { gap: 8.5, len: 7.5, tilt: -10, dx: 0 } },
  hoja: { d: 'M86 12c4 30-2 54-20 68-14 10-34 12-48 4-6-22 0-46 18-60 14-11 32-14 50-12z', face: [52, 54], eyes: { gap: 7.5, len: 7, tilt: 18, dx: 2 } },
  capsula: { d: 'M50 8c16 0 28 12 28 28v28c0 16-12 26-28 26S22 80 22 64V36C22 20 34 8 50 8z', face: [50, 50], eyes: { gap: 6.5, len: 8.5, tilt: 0, dx: 0 } }
};
// The colours: an OKLCH hue each (the lightness and chroma are the family's).
export const COLORS = { coral: 25, melocoton: 50, limon: 95, lima: 135, menta: 168, agua: 200, cielo: 238, lavanda: 285, rosa: 335, frambuesa: 5 };
export const SHAPE_IDS = Object.keys(SHAPES);
export const COLOR_IDS = Object.keys(COLORS);
// What an avatar does: idle (breathes, blinks, looks around), message (a bounce), working (wiggles, eyes up), paused
// (flat eyes, slow breathing, a «z»), happy (a hop, arched eyes).
export const AVATAR_STATES = ['idle', 'message', 'working', 'paused', 'happy'];
export const DEFAULT_AVATAR = Object.freeze({ shape: 'mochi', color: 'cielo' });

// FNV-1a: the same text gives the same number everywhere (engine, window, phone).
export function hash(text) {
  let h = 2166136261;
  for (const c of String(text)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// A fixed avatar from a seed (a bot's id): the same bot always gets the same one; shape and colour vary independently.
export function avatarFor(seed) {
  const h = hash(`bot:${seed}`);
  return { shape: SHAPE_IDS[h % SHAPE_IDS.length], color: COLOR_IDS[Math.floor(h / SHAPE_IDS.length) % COLOR_IDS.length] };
}
// An avatar as given ({ shape, color }, or its JSON text), checked: the clean object, or null when it is not one.
export function parseAvatar(v) {
  let a = v;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch { return null; } }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  if (Object.keys(a).some((k) => k !== 'shape' && k !== 'color')) return null;
  if (!Object.hasOwn(SHAPES, a.shape) || !Object.hasOwn(COLORS, a.color)) return null;
  return { shape: a.shape, color: a.color };
}
// The avatar a bot shows: its own, or the fixed one of its id.
export const avatarOf = (bot) => parseAvatar(bot?.avatar) ?? (bot?.id != null ? avatarFor(bot.id) : { ...DEFAULT_AVATAR });

// How to draw one: the body, its two-tone fill, the highlight and the eyes for a state. Shared by the React component and
// avatarSvg (an SVG string, for places without React).
export function avatarParts(shape, color, state = 'idle') {
  const S = SHAPES[shape] ?? SHAPES[DEFAULT_AVATAR.shape];
  const h = COLORS[color] ?? COLORS[DEFAULT_AVATAR.color];
  const [fx, fy] = S.face; const E = S.eyes;
  const warm = h >= 70 && h <= 140; // yellows and limes need more light to stay bright
  const ink = `oklch(0.24 0.03 ${h})`;
  const len = E.len * 1.3; const half = len / 2;
  const eyes = [[fx - E.gap, -1], [fx + E.gap, 1]].map(([x, side]) => {
    const cx = x + E.dx;
    if (state === 'happy') return { kind: 'arc', cx, cy: fy, d: `M${cx - 3.2} ${fy + 1.8}Q${cx} ${fy - 4} ${cx + 3.2} ${fy + 1.8}`, width: 3.6 };
    if (state === 'paused') return { kind: 'flat', cx, cy: fy, d: `M${cx - 3.6} ${fy + 1}h7.2`, width: 3.4 };
    return { kind: 'open', cx, cy: fy, d: `M${cx} ${fy - half}v${len}`, width: 5.2, tilt: side < 0 ? E.tilt : E.tilt * 0.6 };
  });
  return {
    d: S.d, face: S.face, ink, eyes,
    top: `oklch(${warm ? 0.9 : 0.82} 0.16 ${h})`, bottom: `oklch(${warm ? 0.84 : 0.74} 0.17 ${h})`,
    shadow: `oklch(0.3 0.05 ${h})`,
    shine: { cx: fx - 17, cy: fy - 19 },
    z: state === 'paused' ? { x: fx + 22, y: fy - 16 } : null
  };
}
// A still avatar as SVG text (no animation): for a notification's picture or anything outside the React window.
export function avatarSvg({ shape, color } = DEFAULT_AVATAR, { size = 96, state = 'idle', id = 'bav' } = {}) {
  const p = avatarParts(shape, color, state);
  const eye = (e) => (e.kind === 'open'
    ? `<path d="${e.d}" stroke="${p.ink}" stroke-width="${e.width}" stroke-linecap="round" transform="rotate(${e.tilt} ${e.cx} ${e.cy})"/>`
    : `<path d="${e.d}" fill="none" stroke="${p.ink}" stroke-width="${e.width}" stroke-linecap="round"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.top}"/><stop offset="1" stop-color="${p.bottom}"/></linearGradient></defs>`
    + `<ellipse cx="50" cy="94" rx="24" ry="3.2" fill="${p.shadow}" opacity=".14"/><path d="${p.d}" fill="url(#${id})"/>`
    + `<ellipse cx="${p.shine.cx}" cy="${p.shine.cy}" rx="6.5" ry="3.6" fill="#fff" opacity=".5" transform="rotate(-24 ${p.shine.cx} ${p.shine.cy})"/>`
    + `${p.eyes.map(eye).join('')}${p.z ? `<text x="${p.z.x}" y="${p.z.y}" font-size="13" font-weight="700" fill="${p.ink}" opacity=".55" font-family="system-ui">z</text>` : ''}</svg>`;
}

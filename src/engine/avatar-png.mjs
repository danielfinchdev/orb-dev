// 3.6 (messaging, M4): the bots' avatars as PNG pictures, for the notifications (a phone's browser shows a picture by
// address, the Android app a picture of its own resources). Drawn here from the same shapes and colours as the window's
// avatar (src/core/avatar.mjs): body with its two-tone gradient, highlight, soft shadow and the two eye strokes. A tiny
// rasterizer with no dependencies: the path is flattened into polygons, filled on a 4× grid (non-zero rule) and scaled
// down (antialiasing); the PNG is written with node:zlib.
import zlib from 'node:zlib';
import { avatarParts, parseAvatar, DEFAULT_AVATAR, SHAPE_IDS, COLOR_IDS } from '../core/avatar.mjs';

// ---- colour: oklch(L C h) → sRGB 0..1 (the CSS colours of avatarParts)
export function oklchToRgb(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180); const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  return lin.map((x) => { const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(0, x) ** (1 / 2.4) - 0.055; return Math.min(1, Math.max(0, v)); });
}
const parseColor = (css) => {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(String(css));
  return m ? oklchToRgb(Number(m[1]), Number(m[2]), Number(m[3])) : [1, 1, 1];
};

// ---- path data (M L H V C S Q Z, absolute and relative) → closed polygons
export function flattenPath(d) {
  const tokens = String(d).match(/[MmLlHhVvCcSsQqZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  const polys = []; let poly = null; let x = 0; let y = 0; let sx = 0; let sy = 0; let cmd = ''; let lastCtrl = null; let i = 0;
  const num = () => Number(tokens[i++]);
  const isNum = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]);
  const to = (nx, ny) => { poly.push([nx, ny]); x = nx; y = ny; };
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    const x0 = x; const y0 = y;
    for (let k = 1; k <= 16; k++) {
      const t = k / 16; const u = 1 - t;
      to(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
    }
    lastCtrl = [x2, y2];
  };
  while (i < tokens.length) {
    if (!isNum()) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase(); const ox = rel ? x : 0; const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': { const nx = num() + ox; const ny = num() + oy; poly = []; polys.push(poly); to(nx, ny); sx = nx; sy = ny; cmd = rel ? 'l' : 'L'; lastCtrl = null; break; }
      case 'L': to(num() + ox, num() + oy); lastCtrl = null; break;
      case 'H': to(num() + ox, y); lastCtrl = null; break;
      case 'V': to(x, num() + oy); lastCtrl = null; break;
      case 'C': { const a = [num() + ox, num() + oy, num() + ox, num() + oy, num() + ox, num() + oy]; cubic(...a); break; }
      case 'S': {
        const r1 = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        const a = [num() + ox, num() + oy, num() + ox, num() + oy]; cubic(r1[0], r1[1], ...a); break;
      }
      case 'Q': {
        const qx = num() + ox; const qy = num() + oy; const ex = num() + ox; const ey = num() + oy; const x0 = x; const y0 = y;
        for (let k = 1; k <= 12; k++) { const t = k / 12; const u = 1 - t; to(u * u * x0 + 2 * u * t * qx + t * t * ex, u * u * y0 + 2 * u * t * qy + t * t * ey); }
        lastCtrl = null; break;
      }
      case 'Z': if (poly) { x = sx; y = sy; } lastCtrl = null; break;
      default: i++; // unknown: skip
    }
  }
  return polys.filter((p) => p.length > 2);
}

// ---- a canvas of premultiplied RGBA floats, drawn at SS× and scaled down at the end
const SS = 4;
class Canvas {
  constructor(size) { this.size = size; this.w = size * SS; this.px = new Float32Array(this.w * this.w * 4); }
  // Paints one sample: colour [r,g,b] at alpha a, over what is there.
  put(ix, iy, [r, g, b], a) {
    if (a <= 0 || ix < 0 || iy < 0 || ix >= this.w || iy >= this.w) return;
    const o = (iy * this.w + ix) * 4; const k = 1 - a; const p = this.px;
    p[o] = r * a + p[o] * k; p[o + 1] = g * a + p[o + 1] * k; p[o + 2] = b * a + p[o + 2] * k; p[o + 3] = a + p[o + 3] * k;
  }
  // Polygons in box units (0..100) at scale/offset; fill(sampleY) → [colour, alpha] for that row.
  fillPolys(polys, { scale, dx = 0, dy = 0 }, fill) {
    const k = scale * SS;
    const edges = [];
    for (const poly of polys) {
      for (let j = 0; j < poly.length; j++) {
        const [x0, y0] = poly[j]; const [x1, y1] = poly[(j + 1) % poly.length];
        edges.push([(x0 * scale + dx) * SS, (y0 * scale + dy) * SS, (x1 * scale + dx) * SS, (y1 * scale + dy) * SS]);
      }
    }
    let top = Infinity; let bottom = -Infinity;
    for (const e of edges) { top = Math.min(top, e[1], e[3]); bottom = Math.max(bottom, e[1], e[3]); }
    if (!Number.isFinite(top) || k <= 0) return;
    for (let iy = Math.max(0, Math.floor(top)); iy < Math.min(this.w, Math.ceil(bottom)); iy++) {
      const sy = iy + 0.5; const xs = [];
      for (const [x0, y0, x1, y1] of edges) {
        if ((y0 <= sy && y1 > sy) || (y1 <= sy && y0 > sy)) xs.push([x0 + ((sy - y0) / (y1 - y0)) * (x1 - x0), y1 > y0 ? 1 : -1]);
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a[0] - b[0]);
      const [color, alpha] = fill((sy / SS - dy) / scale);
      let wind = 0;
      for (let j = 0; j < xs.length - 1; j++) {
        wind += xs[j][1];
        if (wind === 0) continue;
        for (let ix = Math.max(0, Math.ceil(xs[j][0] - 0.5)); ix < Math.min(this.w, Math.ceil(xs[j + 1][0] - 0.5)); ix++) this.put(ix, iy, color, alpha);
      }
    }
  }
  // Any shape given by an inside test in box units, over its bounding box (box units).
  fillTest([bx0, by0, bx1, by1], { scale, dx = 0, dy = 0 }, inside, color, alpha) {
    const k = scale * SS;
    for (let iy = Math.max(0, Math.floor((by0 * scale + dy) * SS)); iy < Math.min(this.w, Math.ceil((by1 * scale + dy) * SS)); iy++) {
      for (let ix = Math.max(0, Math.floor((bx0 * scale + dx) * SS)); ix < Math.min(this.w, Math.ceil((bx1 * scale + dx) * SS)); ix++) {
        if (inside((ix + 0.5) / k - dx / scale, (iy + 0.5) / k - dy / scale)) this.put(ix, iy, color, alpha);
      }
    }
  }
  // Box filter down to size×size, straight (not premultiplied) 8-bit RGBA.
  pixels() {
    const out = Buffer.alloc(this.size * this.size * 4); const n = SS * SS;
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let r = 0; let g = 0; let b = 0; let a = 0;
        for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) { const o = ((y * SS + j) * this.w + x * SS + i) * 4; r += this.px[o]; g += this.px[o + 1]; b += this.px[o + 2]; a += this.px[o + 3]; }
        const o = (y * this.size + x) * 4; a /= n;
        out[o] = a ? Math.round(Math.min(1, r / n / a) * 255) : 0; out[o + 1] = a ? Math.round(Math.min(1, g / n / a) * 255) : 0; out[o + 2] = a ? Math.round(Math.min(1, b / n / a) * 255) : 0; out[o + 3] = Math.round(a * 255);
      }
    }
    return out;
  }
}

const bodies = new Map(); // shape → flattened polygons and their vertical extent (the gradient spans it)
function bodyOf(shape, d) {
  let b = bodies.get(shape);
  if (!b) { const polys = flattenPath(d); const ys = polys.flat().map((p) => p[1]); b = { polys, top: Math.min(...ys), bottom: Math.max(...ys) }; bodies.set(shape, b); }
  return b;
}
const rot = (x, y, cx, cy, deg) => { const r = (deg * Math.PI) / 180; const c = Math.cos(r); const s = Math.sin(r); const ux = x - cx; const uy = y - cy; return [cx + ux * c - uy * s, cy + ux * s + uy * c]; };

// One avatar on the canvas, its 100×100 box at (dx, dy) pixels and scale pixels per unit.
function drawAvatar(cv, avatar, at) {
  const a = parseAvatar(avatar) ?? { ...DEFAULT_AVATAR };
  const p = avatarParts(a.shape, a.color, 'idle');
  const top = parseColor(p.top); const bottom = parseColor(p.bottom); const ink = parseColor(p.ink);
  // soft shadow under the body
  cv.fillTest([26, 90, 74, 98], at, (x, y) => ((x - 50) / 24) ** 2 + ((y - 94) / 3.2) ** 2 <= 1, parseColor(p.shadow), 0.14);
  // the body, with its vertical gradient (top → bottom of the shape)
  const b = bodyOf(a.shape, p.d);
  cv.fillPolys(b.polys, at, (y) => { const t = Math.min(1, Math.max(0, (y - b.top) / (b.bottom - b.top || 1))); return [top.map((c, i) => c + (bottom[i] - c) * t), 1]; });
  // the highlight: an ellipse turned -24°
  const { cx, cy } = p.shine;
  cv.fillTest([cx - 8, cy - 8, cx + 8, cy + 8], at, (x, y) => { const [ux, uy] = rot(x, y, cx, cy, 24); return ((ux - cx) / 6.5) ** 2 + ((uy - cy) / 3.6) ** 2 <= 1; }, [1, 1, 1], 0.5);
  // the eyes: two short rounded strokes, each turned by its tilt
  for (const e of p.eyes) {
    const len = Number(/v([\d.]+)/.exec(e.d)?.[1] ?? 9); const half = len / 2; const r = e.width / 2;
    cv.fillTest([e.cx - half - r, e.cy - half - r, e.cx + half + r, e.cy + half + r], at, (x, y) => {
      const [ux, uy] = rot(x, y, e.cx, e.cy, -(e.tilt ?? 0));
      const qy = Math.max(e.cy - half, Math.min(e.cy + half, uy));
      return (ux - e.cx) ** 2 + (uy - qy) ** 2 <= r * r;
    }, ink, 1);
  }
}

// ---- PNG (RGBA, 8 bit, no interlace)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const x of buf) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
export function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const SIZES = new Set([64, 96, 128, 192, 256]);
const pick = (size) => (SIZES.has(Number(size)) ? Number(size) : 192);
// One bot's avatar as a PNG of size×size.
export function avatarPng(avatar, size = 192) {
  const n = pick(size); const cv = new Canvas(n);
  drawAvatar(cv, avatar, { scale: n / 100 });
  return encodePng(n, cv.pixels());
}
// A group: up to three of its members together, placed as the window's GroupAvatar does.
const SPOTS = { 1: [[0, 0, 1]], 2: [[0, 0.04, 0.64], [0.36, 0.32, 0.64]], 3: [[0.21, 0, 0.58], [0, 0.42, 0.58], [0.42, 0.42, 0.58]] };
export function groupPng(avatars, size = 192) {
  const n = pick(size); const cv = new Canvas(n);
  const list = (Array.isArray(avatars) ? avatars : []).map(parseAvatar).filter(Boolean).slice(0, 3);
  if (!list.length) list.push({ ...DEFAULT_AVATAR });
  list.forEach((a, i) => { const [x, y, k] = SPOTS[list.length][i]; drawAvatar(cv, a, { scale: (n * k) / 100, dx: x * n, dy: y * n }); });
  return encodePng(n, cv.pixels());
}

// The address of a picture (/avatars/…, served by the phone's server, src/engine/remote.mjs) and its parsing back.
const tokenOf = (a) => { const v = parseAvatar(a); return v ? `${v.shape}-${v.color}` : null; };
export const avatarUrl = (a) => `/avatars/${tokenOf(a) ?? `${DEFAULT_AVATAR.shape}-${DEFAULT_AVATAR.color}`}.png`;
export const groupUrl = (list) => { const t = (list ?? []).map(tokenOf).filter(Boolean).slice(0, 3); return t.length ? `/avatars/g/${t.join('~')}.png` : avatarUrl(null); };
const fromToken = (t) => { const [shape, color] = String(t).split('-'); return parseAvatar({ shape, color }); };
const cache = new Map(); // address → PNG (at most a few hundred: 120 avatars and the groups that were notified)
export function pngForPath(pathname) {
  let m = /^\/avatars\/([a-z]+-[a-z]+)\.png$/.exec(pathname);
  let make = null;
  if (m) { const a = fromToken(m[1]); if (a) make = () => avatarPng(a, 192); }
  m = /^\/avatars\/g\/((?:[a-z]+-[a-z]+)(?:~[a-z]+-[a-z]+){0,2})\.png$/.exec(pathname);
  if (m) { const list = m[1].split('~').map(fromToken); if (list.every(Boolean)) make = () => groupPng(list, 192); }
  if (!make) return null;
  let png = cache.get(pathname);
  if (!png) { png = make(); if (cache.size > 400) cache.clear(); cache.set(pathname, png); }
  return png;
}
// The Android app's own pictures (res/drawable-nodpi): av_<shape>_<color>.png, one per avatar (made by the build).
export const androidIconName = (a) => { const v = parseAvatar(a) ?? DEFAULT_AVATAR; return `av_${v.shape}_${v.color}`; };
export function allAvatarPngs(size = 192) {
  const out = [];
  for (const shape of SHAPE_IDS) for (const color of COLOR_IDS) out.push({ name: androidIconName({ shape, color }), png: avatarPng({ shape, color }, size) });
  return out;
}

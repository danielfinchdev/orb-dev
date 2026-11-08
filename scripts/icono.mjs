// The app icon (style 2 of the «Marca Orb» design: «orb•e» in violet with the red orb, on a pale tile) is drawn as
// vector in build/icon-src/: orbe-style2.svg (the whole word) and orbe-style2-small.svg (the «o» with the orb, used at
// 32 px and less, where the word can't be read). This script renders them, with no extra dependencies, into:
//   build/icons/NxN.png (16 to 1024 px, Linux), build/icon.png (512 px: window, notifications), build/icon.ico (every
//   size Windows uses: .exe, installer, taskbar, the window on Windows), src/ui/public/icon.png (favicon, PWA, the
//   photo of Android notifications, «Acerca de»), src/ui/public/icon-maskable.png (PWA), the Android launcher icons and
//   the small notification icon of Android (see below).
// It understands only what those SVGs use: <linearGradient> (userSpaceOnUse), <rect rx>, <circle> and <path> with
// absolute M/L/Q/C/Z. The letters are Outfit SemiBold (OFL) outlines.                    Usage: npm run icon
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { PNG } = createRequire(import.meta.url)('pngjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'build', 'icon-src');
const SMALL_MAX = 32; // up to this size, the short version
const PNG_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512, 1024];
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

// ---- SVG (the subset above) -> layers of { polys, paint } in viewBox units ----
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function parseSvg(text) {
  const size = Number(attrs(text.match(/<svg\b[^>]*>/)[0]).viewBox.split(/\s+/)[2]);
  const gradients = {};
  for (const m of text.matchAll(/<linearGradient\b([^>]*)>([\s\S]*?)<\/linearGradient>/g)) {
    const a = attrs(m[1]);
    const stops = [...m[2].matchAll(/<stop\b[^>]*>/g)].map((s) => { const b = attrs(s[0]); return [Number(b.offset), hex(b['stop-color'])]; });
    gradients[a.id] = { x1: +a.x1, y1: +a.y1, x2: +a.x2, y2: +a.y2, stops };
  }
  const paint = (fill) => {
    const id = fill.match(/^url\(#(.+)\)$/)?.[1];
    if (!id) { const c = hex(fill); return () => c; }
    const g = gradients[id], dx = g.x2 - g.x1, dy = g.y2 - g.y1, len2 = dx * dx + dy * dy;
    return (x, y) => {
      const t = Math.min(1, Math.max(0, ((x - g.x1) * dx + (y - g.y1) * dy) / len2));
      let i = 0; while (i < g.stops.length - 2 && t > g.stops[i + 1][0]) i++;
      const [o0, c0] = g.stops[i], [o1, c1] = g.stops[i + 1], k = o1 > o0 ? Math.min(1, Math.max(0, (t - o0) / (o1 - o0))) : 0;
      return [0, 1, 2].map((j) => c0[j] + (c1[j] - c0[j]) * k);
    };
  };
  const arc = (cx, cy, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
  const layers = [];
  for (const m of text.matchAll(/<(rect|circle|path)\b[^>]*>/g)) {
    const a = attrs(m[0]);
    let polys;
    if (m[1] === 'circle') polys = [arc(+a.cx, +a.cy, +a.r, 0, 2 * Math.PI, 360)];
    else if (m[1] === 'rect') {
      const x = +(a.x ?? 0), y = +(a.y ?? 0), w = +a.width, h = +a.height, r = Math.min(+(a.rx ?? 0), w / 2, h / 2), q = Math.PI / 2;
      polys = [[...arc(x + w - r, y + r, r, -q, 0, 90), ...arc(x + w - r, y + h - r, r, 0, q, 90), ...arc(x + r, y + h - r, r, q, 2 * q, 90), ...arc(x + r, y + r, r, 2 * q, 3 * q, 90)]];
    } else polys = flattenPath(a.d);
    layers.push({ tag: m[1], polys, paint: paint(a.fill) });
  }
  return { size, layers };
}

function flattenPath(d) {
  const polys = [], steps = 24; let cur = null, p = [0, 0];
  for (const [, cmd, nums] of d.matchAll(/([MLQCZ])([^MLQCZ]*)/g)) {
    const n = nums.trim() ? nums.trim().split(/[\s,]+/).map(Number) : [];
    if (cmd === 'M') { cur = [p = [n[0], n[1]]]; polys.push(cur); for (let i = 2; i < n.length; i += 2) cur.push(p = [n[i], n[i + 1]]); }
    else if (cmd === 'L') for (let i = 0; i < n.length; i += 2) cur.push(p = [n[i], n[i + 1]]);
    else if (cmd === 'Q') for (let i = 0; i < n.length; i += 4) {
      const [x0, y0] = p;
      for (let s = 1; s <= steps; s++) { const t = s / steps, u = 1 - t; cur.push([u * u * x0 + 2 * u * t * n[i] + t * t * n[i + 2], u * u * y0 + 2 * u * t * n[i + 1] + t * t * n[i + 3]]); }
      p = [n[i + 2], n[i + 3]];
    } else if (cmd === 'C') for (let i = 0; i < n.length; i += 6) {
      const [x0, y0] = p;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
        cur.push([a * x0 + b * n[i] + c * n[i + 2] + e * n[i + 4], a * y0 + b * n[i + 1] + c * n[i + 3] + e * n[i + 5]]);
      }
      p = [n[i + 4], n[i + 5]];
    } else if (cmd === 'Z' && cur) p = cur[0];
  }
  return polys;
}

// ---- Rasterizer: nonzero scanline fill with ss x ss samples per pixel; later layers paint over earlier ones ----
function render({ size: vb, layers }, size) {
  const ss = Math.max(4, Math.min(16, Math.round(256 / size))), W = size * ss, k = W / vb;
  const edges = layers.map(({ polys }) => polys.flatMap((poly) => poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    return a[1] === b[1] ? null : a[1] < b[1] ? [a[0] * k, a[1] * k, b[0] * k, b[1] * k, 1] : [b[0] * k, b[1] * k, a[0] * k, a[1] * k, -1];
  }).filter(Boolean)));
  const acc = new Float64Array(size * size * 4), top = new Int8Array(W);
  for (let sy = 0; sy < W; sy++) {
    const y = sy + 0.5;
    top.fill(-1);
    edges.forEach((list, li) => {
      const xs = [];
      for (const [x0, y0, x1, y1, dir] of list) if (y >= y0 && y < y1) xs.push([x0 + ((y - y0) * (x1 - x0)) / (y1 - y0), dir]);
      xs.sort((a, b) => a[0] - b[0]);
      let wind = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        wind += xs[i][1];
        if (!wind) continue;
        const from = Math.max(0, Math.ceil(xs[i][0] - 0.5)), to = Math.min(W - 1, Math.ceil(xs[i + 1][0] - 0.5) - 1);
        for (let sx = from; sx <= to; sx++) top[sx] = li;
      }
    });
    const py = Math.floor(sy / ss);
    for (let sx = 0; sx < W; sx++) {
      if (top[sx] < 0) continue;
      const c = layers[top[sx]].paint((sx + 0.5) / k, y / k), o = (py * size + Math.floor(sx / ss)) * 4;
      if (!c) continue; // a layer that cuts (paint gives null): what it covers stays transparent
      acc[o] += c[0]; acc[o + 1] += c[1]; acc[o + 2] += c[2]; acc[o + 3]++;
    }
  }
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < size * size; i++) {
    const n = acc[i * 4 + 3];
    if (n) for (let j = 0; j < 3; j++) png.data[i * 4 + j] = Math.round(acc[i * 4 + j] / n);
    png.data[i * 4 + 3] = Math.round((n / (ss * ss)) * 255);
  }
  return PNG.sync.write(png);
}

// ICO: header (6 bytes) + one 16-byte entry per image + the PNG data (PNG inside ICO works since Windows Vista).
function ico(images) {
  const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const big = parseSvg(fs.readFileSync(path.join(SRC, 'orbe-style2.svg'), 'utf8'));
const small = parseSvg(fs.readFileSync(path.join(SRC, 'orbe-style2-small.svg'), 'utf8'));
const pngs = new Map(PNG_SIZES.map((size) => [size, render(size <= SMALL_MAX ? small : big, size)]));
fs.mkdirSync(path.join(ROOT, 'build', 'icons'), { recursive: true });
for (const [size, png] of pngs) fs.writeFileSync(path.join(ROOT, 'build', 'icons', `${size}x${size}.png`), png);
fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), pngs.get(512));
fs.writeFileSync(path.join(ROOT, 'src', 'ui', 'public', 'icon.png'), pngs.get(512));
fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), ico(ICO_SIZES.map((size) => ({ size, png: pngs.get(size) }))));
console.log(`✔ build/icons (${PNG_SIZES.join(', ')} px), build/icon.png, build/icon.ico y src/ui/public/icon.png`);
// The PWA's «maskable» icon (the phone's browser crops it to its own shape): the tile's gradient edge to edge and the word
// at 80 %, inside the safe circle of 80 % of the side that every mask keeps.
{
  const t = big.layers.find((l) => l.tag === 'rect'), m = big.layers.filter((l) => l !== t), h = big.size / 2;
  const full = [[[0, 0], [big.size, 0], [big.size, big.size], [0, big.size]]];
  const at = (layer, k) => ({ ...layer, polys: layer.polys.map((poly) => poly.map(([x, y]) => [h + (x - h) * k, h + (y - h) * k])) });
  fs.writeFileSync(path.join(ROOT, 'src', 'ui', 'public', 'icon-maskable.png'), render({ size: big.size, layers: [{ ...t, polys: full }, ...m.map((l) => at(l, 0.8))] }, 512));
  console.log('✔ src/ui/public/icon-maskable.png (PWA, maskable)');
}

// ---- Android launcher (android-app/android/app/src/main/res/mipmap-*) from the same whole-word drawing ----
// Android sizes icons in dp, so every density uses the whole word. Legacy icons (before Android 8): the tile as is
// (ic_launcher) and cut as a circle (ic_launcher_round). Adaptive icon (Android 8+, 108 dp with the launcher's mask on
// the middle 72 dp): ic_launcher_background is the tile's gradient edge to edge and ic_launcher_foreground the word and
// the orb shrunk to 2/3, so they sit in the mask as they sit on the tile (well inside the 66 dp safe circle). Paints
// stay in canvas units, so the ring around the orb matches the background behind it. The splash shows ic_launcher.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const RES = path.join(ROOT, 'android-app', 'android', 'app', 'src', 'main', 'res');
const tile = big.layers.find((l) => l.tag === 'rect'), marks = big.layers.filter((l) => l !== tile), c = big.size / 2;
const square = [[[0, 0], [big.size, 0], [big.size, big.size], [0, big.size]]];
const circle = [Array.from({ length: 721 }, (_, i) => [c + c * Math.cos((i * Math.PI) / 360), c + c * Math.sin((i * Math.PI) / 360)])];
const shrink = (layer, k) => ({ ...layer, polys: layer.polys.map((poly) => poly.map(([x, y]) => [c + (x - c) * k, c + (y - c) * k])) });
const android = {
  ic_launcher: [48, big],
  ic_launcher_round: [48, { size: big.size, layers: [{ ...tile, polys: circle }, ...marks] }],
  ic_launcher_background: [108, { size: big.size, layers: [{ ...tile, polys: square }] }],
  ic_launcher_foreground: [108, { size: big.size, layers: marks.map((l) => shrink(l, 2 / 3)) }],
};
for (const [density, k] of Object.entries(DENSITIES)) {
  const dir = path.join(RES, `mipmap-${density}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, [dp, svg]] of Object.entries(android)) fs.writeFileSync(path.join(dir, `${name}.png`), render(svg, dp * k));
}
console.log(`✔ Android: mipmap-{${Object.keys(DENSITIES).join(',')}}/{${Object.keys(android).join(',')}}.png`);

// ---- Android notification icon (drawable-*/ic_stat_orb.png): the status bar draws only the alpha of a small icon, so it
// is the short «o•» as a white silhouette on transparent: the «o» and the orb, with the pale ring between them cut out.
// 24 dp per density (24 to 96 px), the drawing centred in the middle 22 dp. Every pixel is white; only its alpha varies.
{
  const o = small.layers.filter((l) => l.tag !== 'rect');
  const ring = o.find((l) => l.tag === 'circle'); // the first circle: the tile's colour around the orb
  const white = () => [255, 255, 255];
  const pts = o.flatMap((l) => l.polys.flat());
  const [x0, x1, y0, y1] = [Math.min(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[1]))];
  const k = (small.size * 22 / 24) / Math.max(x1 - x0, y1 - y0), mx = (x0 + x1) / 2, my = (y0 + y1) / 2, h = small.size / 2;
  const fit = (l) => ({ ...l, paint: l === ring ? () => null : white, polys: l.polys.map((poly) => poly.map(([x, y]) => [h + (x - mx) * k, h + (y - my) * k])) });
  const stat = { size: small.size, layers: o.map(fit) };
  for (const [density, d] of Object.entries(DENSITIES)) {
    const dir = path.join(RES, `drawable-${density}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ic_stat_orb.png'), render(stat, 24 * d));
  }
  console.log(`✔ Android: drawable-{${Object.keys(DENSITIES).join(',')}}/ic_stat_orb.png (silueta blanca «o•»)`);
}

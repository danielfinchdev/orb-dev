// Turns the robot artwork (docs/diseno/art work, rendered by Codex) into the layers the interface animates, so the robot is
// always the same character: the original pixels with the eyes removed (the visor's gradient carries on where they were),
// a mask of the visor (code scrolls inside it) and where the eyes, the top button and the ear ring sit. The eyes are drawn
// back on top by the robot component, which lets them blink, wink, smile or give way to code.
// Run: node scripts/robot-arte.mjs  →  src/ui/public/robot/*.png and src/ui/components/robot-geo.json
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const { PNG } = createRequire(import.meta.url)('pngjs');
const ART = path.resolve('docs/diseno/art work');
const OUT = path.resolve('src/ui/public/robot');
const read = (f) => PNG.sync.read(fs.readFileSync(path.join(ART, f)));

// A figure: RGBA pixels plus width and height. Every step returns a new one or edits it in place.
const make = (w, h) => ({ w, h, d: new Uint8ClampedArray(w * h * 4) });
const from = (png) => ({ w: png.width, h: png.height, d: new Uint8ClampedArray(png.data) });

function crop(img, x0, y0, x1, y1) {
  const o = make(x1 - x0, y1 - y0);
  for (let y = y0; y < y1; y++) o.d.set(img.d.subarray((y * img.w + x0) * 4, (y * img.w + x1) * 4), ((y - y0) * o.w) * 4);
  return o;
}

// Area-average downscale with premultiplied alpha (no dark fringes).
function scale(img, w) {
  const h = Math.round((img.h * w) / img.w), o = make(w, h), fx = img.w / w, fy = img.h / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let sy = Math.floor(y * fy); sy < Math.min(img.h, Math.ceil((y + 1) * fy)); sy++) for (let sx = Math.floor(x * fx); sx < Math.min(img.w, Math.ceil((x + 1) * fx)); sx++) {
      const i = (sy * img.w + sx) * 4, al = img.d[i + 3];
      r += img.d[i] * al; g += img.d[i + 1] * al; b += img.d[i + 2] * al; a += al; n++;
    }
    const i = (y * w + x) * 4;
    if (a) { o.d[i] = r / a; o.d[i + 1] = g / a; o.d[i + 2] = b / a; }
    o.d[i + 3] = a / n;
  }
  return o;
}

// Connected regions of the pixels where test(i) holds.
function regions(img, test) {
  const n = img.w * img.h, lab = new Int32Array(n), out = [];
  for (let s = 0; s < n; s++) {
    if (lab[s] || !test(s * 4)) continue;
    const r = { id: out.length + 1, px: [], x0: 1e9, y0: 1e9, x1: 0, y1: 0 }, st = [s];
    lab[s] = r.id;
    while (st.length) {
      const q = st.pop(), x = q % img.w, y = (q / img.w) | 0;
      r.px.push(q); r.x0 = Math.min(r.x0, x); r.x1 = Math.max(r.x1, x); r.y0 = Math.min(r.y0, y); r.y1 = Math.max(r.y1, y);
      for (const t of [x > 0 ? q - 1 : -1, x < img.w - 1 ? q + 1 : -1, q - img.w, q + img.w]) if (t >= 0 && t < n && !lab[t] && test(t * 4)) { lab[t] = r.id; st.push(t); }
    }
    out.push(r);
  }
  return out.sort((a, b) => b.px.length - a.px.length);
}

// The cut-out leaves loose specks around the figure (visible on dark backgrounds): keep only the big pieces.
function despeck(img, min = 1500) {
  for (const r of regions(img, (i) => img.d[i + 3] > 8)) if (r.px.length < min) for (const q of r.px) img.d[q * 4 + 3] = 0;
}

const isEye = (d, i) => d[i + 3] > 200 && d[i + 1] > 180 && d[i + 2] > 200 && d[i] < 170 && d[i + 1] - d[i] > 60;
const isVisor = (d, i) => d[i + 3] > 200 && d[i + 2] > d[i] + 45 && d[i] < 140 && d[i + 1] < 150;

// The two eyes: the biggest glowing-cyan blobs inside the visor. Returns centre, length, width and tilt of each pill.
function findEyes(img, visorBox) {
  const inside = (r) => { const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2; return cx > visorBox.x0 && cx < visorBox.x1 && cy > visorBox.y0 && cy < visorBox.y1; };
  return regions(img, (i) => isEye(img.d, i)).filter(inside).slice(0, 2).map((r) => {
    let sx = 0, sy = 0;
    for (const q of r.px) { sx += q % img.w; sy += (q / img.w) | 0; }
    const cx = sx / r.px.length, cy = sy / r.px.length;
    let a = 0, b = 0, c = 0;
    for (const q of r.px) { const dx = (q % img.w) - cx, dy = ((q / img.w) | 0) - cy; a += dx * dx; b += dx * dy; c += dy * dy; }
    a /= r.px.length; b /= r.px.length; c /= r.px.length;
    const root = Math.sqrt(((a - c) / 2) ** 2 + b * b), l1 = (a + c) / 2 + root, l2 = (a + c) / 2 - root;
    const ang = (0.5 * Math.atan2(2 * b, a - c) * 180) / Math.PI; // long axis vs. horizontal
    return { r, cx, cy, len: Math.sqrt(12 * l1), wid: Math.sqrt(12 * l2), tilt: ang < 0 ? ang + 90 : ang - 90 };
  }).sort((p, q) => p.cx - q.cx);
}

// Paint the eyes (and their glow, R px around them) out: a diffusion fill that carries the visor's gradient across.
function removeEyes(img, eyes, R) {
  const { w, h, d } = img, mask = new Uint8Array(w * h);
  for (const e of eyes) {
    const core = new Set(e.r.px);
    for (let y = Math.max(1, e.r.y0 - R); y <= Math.min(h - 2, e.r.y1 + R); y++) for (let x = Math.max(1, e.r.x0 - R); x <= Math.min(w - 2, e.r.x1 + R); x++) {
      outer: for (let dy = -R; dy <= R; dy += 3) for (let dx = -R; dx <= R; dx += 3) if (dx * dx + dy * dy <= R * R && core.has((y + dy) * w + x + dx)) { mask[y * w + x] = 1; break outer; }
    }
  }
  const idx = [];
  for (let s = 0; s < w * h; s++) if (mask[s]) idx.push(s);
  for (let k = 0; k < 3; k++) {
    const f = new Float32Array(w * h);
    for (let s = 0; s < w * h; s++) f[s] = d[s * 4 + k];
    for (let y = 0; y < h; y++) for (let x = 0; x < w;) { // start from a row-wise blend, then relax
      if (!mask[y * w + x]) { x++; continue; }
      const xs = x;
      while (x < w && mask[y * w + x]) x++;
      const L = f[y * w + xs - 1], Rv = f[y * w + x];
      for (let j = xs; j < x; j++) f[y * w + j] = L + ((Rv - L) * (j - xs + 1)) / (x - xs + 1);
    }
    for (let it = 0; it < 3000; it++) for (const s of idx) f[s] = (f[s - 1] + f[s + 1] + f[s - w] + f[s + w]) * 0.25;
    for (const s of idx) d[s * 4 + k] = f[s];
  }
}

// The visor as a soft white-on-transparent mask: the big dark-blue region with its holes (the glare) filled in.
function visorMask(img) {
  const { w, h, d } = img, reg = regions(img, (i) => isVisor(d, i))[0], inV = new Uint8Array(w * h);
  for (const q of reg.px) inV[q] = 1;
  const outside = new Uint8Array(w * h), st = [0]; // flood the background from a corner: whatever it can't reach is visor
  outside[0] = 1;
  while (st.length) {
    const q = st.pop(), x = q % w;
    for (const t of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w]) if (t >= 0 && t < w * h && !outside[t] && !inV[t]) { outside[t] = 1; st.push(t); }
  }
  const m = make(w, h);
  for (let s = 0; s < w * h; s++) { m.d[s * 4] = m.d[s * 4 + 1] = m.d[s * 4 + 2] = 255; m.d[s * 4 + 3] = outside[s] ? 0 : 255; }
  return { mask: m, box: { x0: reg.x0, y0: reg.y0, x1: reg.x1, y1: reg.y1 } };
}

// Centre and radius of the biggest blob matching test inside a box (the top button, the ear ring).
function spot(img, box, test) {
  const r = regions(img, (i) => { const q = i / 4, x = q % img.w, y = (q / img.w) | 0; return x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3] && test(img.d, i); })[0];
  return r && { cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2, r: Math.max(r.x1 - r.x0, r.y1 - r.y0) / 2 };
}

function bbox(img, pad) {
  let x0 = img.w, y0 = img.h, x1 = 0, y1 = 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (img.d[(y * img.w + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return [Math.max(0, x0 - pad), Math.max(0, y0 - pad), Math.min(img.w, x1 + pad + 1), Math.min(img.h, y1 + pad + 1)];
}

const save = (img, name) => { const p = new PNG({ width: img.w, height: img.h }); p.data = Buffer.from(img.d); fs.writeFileSync(path.join(OUT, name), PNG.sync.write(p)); };
const pct = (v, total) => +((v / total) * 100).toFixed(2);

// ---------- the head (Orb 1): the small robot of the sidebar, headers and chat ----------
fs.mkdirSync(OUT, { recursive: true });
const geo = {};
{
  const src = from(read('Orb 1.png'));
  despeck(src);
  const [x0, y0, x1, y1] = bbox(src, 6);
  const img = crop(src, x0, y0, x1, y1);
  const { box } = visorMask(img);
  const eyes = findEyes(img, box);
  removeEyes(img, eyes, 62);
  const { mask } = visorMask(img);
  const isBlue = (d, i) => d[i + 3] > 200 && d[i + 2] > 220 && d[i] < 120 && d[i + 1] > 110 && d[i + 1] < 200;
  const button = spot(img, [0, 0, img.w, img.h * 0.35], isBlue);
  const ear = spot(img, [img.w * 0.8, img.h * 0.4, img.w, img.h], (d, i) => isEye(d, i) || isBlue(d, i));
  const W = 320;
  save(scale(img, W), 'cabeza.png');
  save(scale(mask, W), 'cabeza-visera.png');
  geo.head = {
    ratio: +(img.h / img.w).toFixed(4),
    eyes: eyes.map((e) => ({ x: pct(e.cx, img.w), y: pct(e.cy, img.h), w: pct(e.wid, img.w), h: pct(e.len, img.h), tilt: +e.tilt.toFixed(1) })),
    button: button && { x: pct(button.cx, img.w), y: pct(button.cy, img.h), r: pct(button.r, img.w) },
    ear: ear && { x: pct(ear.cx, img.w), y: pct(ear.cy, img.h), r: pct(ear.r, img.w) },
    visor: { x: pct(box.x0, img.w), y: pct(box.y0, img.h), w: pct(box.x1 - box.x0, img.w), h: pct(box.y1 - box.y0, img.h) },
  };
}

fs.writeFileSync(path.resolve('src/ui/components/robot-geo.json'), JSON.stringify(geo, null, 2) + '\n');
console.log('✔ src/ui/public/robot y src/ui/components/robot-geo.json');
console.log(JSON.stringify(geo, null, 1));

// The app icon is the artwork's own (docs/diseno/art work/Orb icon.png): its rounded square is cut out of the white
// background with soft transparent corners and saved as build/icon.png (512 px) and the window's favicon. Then
// `npm run icon:ico` turns it into build/icon.ico with every size Windows uses.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const { PNG } = createRequire(import.meta.url)('pngjs');
const src = PNG.sync.read(fs.readFileSync(path.resolve('docs/diseno/art work/Orb icon.png')));
const SIZE = 512;

// The square inside the artwork (measured on it) and the radius of its corners.
const [x0, y0, x1, y1, r] = [84, 77, 1170, 1163, 235];
const dist = (x, y) => { // signed distance to the rounded square: < 0 inside
  const qx = Math.abs(x - (x0 + x1) / 2) - ((x1 - x0) / 2 - r), qy = Math.abs(y - (y0 + y1) / 2) - ((y1 - y0) / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const side = x1 - x0, cut = new Float32Array(side * side * 4);
for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
  const i = ((y0 + y) * src.width + x0 + x) * 4, j = (y * side + x) * 4;
  const a = Math.min(1, Math.max(0, 0.5 - dist(x0 + x + 0.5, y0 + y + 0.5) / 1.5));
  cut[j] = src.data[i] * a; cut[j + 1] = src.data[i + 1] * a; cut[j + 2] = src.data[i + 2] * a; cut[j + 3] = a; // premultiplied
}

// Area-average downscale to 512 px.
const out = new PNG({ width: SIZE, height: SIZE }), f = side / SIZE;
for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
  let r2 = 0, g = 0, b = 0, a = 0, n = 0;
  for (let sy = Math.floor(y * f); sy < Math.min(side, Math.ceil((y + 1) * f)); sy++) for (let sx = Math.floor(x * f); sx < Math.min(side, Math.ceil((x + 1) * f)); sx++) {
    const j = (sy * side + sx) * 4; r2 += cut[j]; g += cut[j + 1]; b += cut[j + 2]; a += cut[j + 3]; n++;
  }
  const o = (y * SIZE + x) * 4;
  if (a) { out.data[o] = r2 / a; out.data[o + 1] = g / a; out.data[o + 2] = b / a; }
  out.data[o + 3] = Math.round((a / n) * 255);
}
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/icon.png', PNG.sync.write(out));
fs.copyFileSync('build/icon.png', 'src/ui/public/icon.png');
console.log('✔ build/icon.png y src/ui/public/icon.png (ahora: npm run icon:ico)');

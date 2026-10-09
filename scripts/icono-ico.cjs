// Builds build/icon.ico from build/icon.png with every size Windows uses (16 to 256 px), each one resized with good
// quality and the small ones slightly sharpened, so the .exe, the taskbar and the Explorer show the robot crisp.
// Runs inside Electron (nativeImage):  npx electron scripts/icono-ico.cjs
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const root = path.resolve(__dirname, '..');

app.whenReady().then(() => {
  const source = nativeImage.createFromPath(path.join(root, 'build', 'icon.png'));
  if (source.isEmpty()) { console.error('no se pudo leer build/icon.png'); app.exit(1); return; }
  // At 16–24 px the whole robot is a speck: those sizes use the same icon framed on its head (build/icon-pequeno.png).
  const small = nativeImage.createFromPath(path.join(root, 'build', 'icon-pequeno.png'));
  const images = SIZES.map((size) => ({ size, png: (size <= 24 && !small.isEmpty() ? small : source).resize({ width: size, height: size, quality: 'best' }).toPNG() }));
  // ICO: header (6 bytes) + one 16-byte entry per image + the PNG data (PNG inside ICO works since Windows Vista).
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), Buffer.concat([header, ...entries, ...images.map((i) => i.png)]));
  console.log(`✔ build/icon.ico (${SIZES.join(', ')} px)`);
  app.exit(0);
});

// 3.5, `npm run dist:terminal`: Orb en la terminal on its own (the client only, no engine), for any PC with Node 22 or
// newer. Writes dist/orb-terminal-<version>.zip (Windows) and dist/orb-terminal-<version>.tar.gz (Linux, macOS):
//   orb-terminal-<version>/bin/orb, bin/orb.cmd      the launchers
//   orb-terminal-<version>/src/terminal/…            the client
//   orb-terminal-<version>/src/core/…                Magic Link, its encryption, the link formats, the QR, the texts
//   orb-terminal-<version>/node_modules/@noble/…     the encryption modules (pure JavaScript)
// Options: --out <folder>.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { writeTarGz } from './dist-servidor.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// What the client loads (test/terminal.test.mjs runs it from the unpacked package to prove nothing is missing).
export const CORE_FILES = ['link.mjs', 'mobile-crypto.mjs', 'link-payload.mjs', 'qr.mjs', 'i18n.mjs'];
export const MODULES = ['@noble/ciphers', '@noble/curves', '@noble/hashes'];
const JUNK = /(\.d\.ts|\.d\.mts|\.d\.cts|\.map|\.ts|(^|\/)(README|CHANGELOG|HISTORY)(\.[a-z]+)?)$/i;

export const unixLauncher = () => `#!/bin/sh
# Orb en la terminal: necesita Node 22 o más nuevo (o ORB_NODE con la ruta de otro).
DIR="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")/.." && pwd)"
exec "\${ORB_NODE:-node}" "$DIR/src/terminal/orb-cli.mjs" "$@"
`;
export const readme = (version) => `# Orb en la terminal ${version}

Habla con tu Orb desde cualquier terminal (Windows Terminal, PowerShell, Linux, macOS). Necesita Node 22 o más nuevo.

1. En tu Orb: Ajustes › Magic Link › «Enlazar dispositivo» (en un servidor sin pantalla: \`orb-server enlazar\`).
2. Aquí: \`bin/orb enlazar <código> <dirección>\` (en Windows, \`bin\\orb.cmd\`).
3. \`bin/orb\` abre el chat; \`bin/orb "mensaje"\` manda uno y escribe la respuesta; \`bin/orb ayuda\` lo cuenta todo.

Tus claves quedan en \`~/.orb-terminal\`, cifradas y solo para tu usuario.
`;

const walk = (dir, rel, out, skip = () => false) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name); const r = `${rel}/${e.name}`;
    if (skip(r)) continue;
    if (e.isDirectory()) walk(abs, r, out, skip); else if (e.isFile()) out.push([r, abs]);
  }
  return out;
};

export function terminalEntries({ root = ROOT, version, top = `orb-terminal-${version}` }) {
  const files = [];
  walk(path.join(root, 'src', 'terminal'), 'src/terminal', files);
  for (const f of CORE_FILES) files.push([`src/core/${f}`, path.join(root, 'src', 'core', f)]);
  walk(path.join(root, 'src', 'core', 'locales'), 'src/core/locales', files);
  for (const m of MODULES) walk(path.join(root, 'node_modules', ...m.split('/')), `node_modules/${m}`, files, (r) => JUNK.test(r) || /\/src(\/|$)/.test(r));
  const entries = [{ name: top, dir: true }, { name: `${top}/bin`, dir: true }];
  entries.push({ name: `${top}/bin/orb`, data: Buffer.from(unixLauncher()), mode: 0o755 });
  entries.push({ name: `${top}/bin/orb.cmd`, data: Buffer.from(fs.readFileSync(path.join(root, 'bin', 'orb.cmd'), 'utf8').replace(/\r?\n/g, '\r\n')), mode: 0o644 });
  entries.push({ name: `${top}/package.json`, data: Buffer.from(JSON.stringify({ name: 'orb-terminal', version, private: true, type: 'module', engines: { node: '>=22.13' } }, null, 2)), mode: 0o644 });
  entries.push({ name: `${top}/LEEME.md`, data: Buffer.from(readme(version)), mode: 0o644 });
  entries.push({ name: `${top}/VERSION`, data: Buffer.from(`${version}\n`), mode: 0o644 });
  for (const [rel, abs] of files.sort((a, b) => a[0].localeCompare(b[0]))) entries.push({ name: `${top}/${rel}`, file: abs, mode: 0o644 });
  return entries;
}

// A plain zip (deflate), enough for Windows' Explorer, Expand-Archive and unzip.
export function writeZip(out, entries) {
  const local = []; const central = []; let offset = 0;
  const date = new Date(); const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  for (const e of entries) {
    const name = Buffer.from(e.dir ? `${e.name.replace(/\/$/, '')}/` : e.name, 'utf8');
    const data = e.dir ? Buffer.alloc(0) : (e.data ?? fs.readFileSync(e.file));
    const packed = e.dir ? data : zlib.deflateRawSync(data, { level: 9 });
    const method = e.dir ? 0 : 8; const crc = zlib.crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(method, 8);
    h.writeUInt16LE(dosTime, 10); h.writeUInt16LE(dosDate, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(packed.length, 18);
    h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    local.push(h, name, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE((3 << 8) | 20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(method, 10);
    c.writeUInt16LE(dosTime, 12); c.writeUInt16LE(dosDate, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE((((e.dir ? 0o40755 : 0o100000 | (e.mode ?? 0o644)) << 16) | (e.dir ? 0x10 : 0)) >>> 0, 38); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += h.length + name.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.concat([...local, cd, end]));
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--out');
  const outDir = path.resolve(i >= 0 ? args[i + 1] : path.join(ROOT, 'dist'));
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const entries = terminalEntries({ version });
  const zip = path.join(outDir, `orb-terminal-${version}.zip`);
  const tgz = path.join(outDir, `orb-terminal-${version}.tar.gz`);
  writeZip(zip, entries);
  await writeTarGz(tgz, entries);
  const kb = (f) => `${Math.round(fs.statSync(f).size / 1024)} KB`;
  console.log(`✔ ${zip} (${kb(zip)})\n✔ ${tgz} (${kb(tgz)}) · ${entries.length} entradas`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`✖ ${error.message}`); process.exit(1); });
}

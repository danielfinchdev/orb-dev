// 3.5, `npm run dist:servidor`: Orb Núcleo for the Linux server, made on the Windows PC. The server compiles nothing: it
// only unpacks dist/orb-nucleo-<version>-linux-x64.tar.gz, which carries
//   orb-nucleo-<version>/node/bin/node          the official Node 22 LTS for linux-x64 (checked against nodejs.org's SHA-256)
//   orb-nucleo-<version>/src/…                  engine, core, agents, mcp, server and the built interface (renderer)
//   orb-nucleo-<version>/node_modules/…         the production modules for linux-x64 (with the Agent SDK's Linux package)
//   orb-nucleo-<version>/orb-nucleo             the launcher; orb-nucleo.service (systemd --user); INSTALAR.md; VERSION
//   orb-nucleo-<version>/bin/orb                the terminal client (src/terminal), with the same Node
// The tar is written here (ustar with pax names), so the Linux permissions (the executables) are exact on any PC.
// Options: --skip-build (the interface is already built), --node <22.x.y>, --out <folder>, --keep (keep the staging folder).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// What of src/ goes to the server: the engine and what it loads, and the built interface the phones open. Never the
// interface's sources (src/ui) nor the Electron app (src/main).
export const SRC_INCLUDE = ['engine', 'core', 'agents', 'mcp', 'server', 'terminal', 'renderer'];
export const SRC_EXCLUDE = ['ui', 'main'];
// Modules of package.json the server does not need (the PC app's updater).
export const DEPS_EXCLUDE = ['electron-updater'];
// Files of node_modules that are of no use at run time.
const JUNK = /(\.d\.ts|\.d\.mts|\.d\.cts|\.map|(^|\/)(README|CHANGELOG|HISTORY)(\.[a-z]+)?)$/i;

const cacheDir = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), 'orb-build-cache', 'node');

// ---- what goes in ----------------------------------------------------------------------------------------------------

// The files of src/ that go in, as [relative path (with /), absolute path].
export function appFiles(root = ROOT) {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name); const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(abs, r); else if (e.isFile()) out.push([r, abs]);
    }
  };
  for (const part of SRC_INCLUDE) { const dir = path.join(root, 'src', part); if (fs.existsSync(dir)) walk(dir, `src/${part}`); }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

// The package.json of the server: its name and version, and only the production modules it uses.
export function serverPackage(pkg) {
  const deps = Object.fromEntries(Object.entries(pkg.dependencies ?? {}).filter(([k]) => !DEPS_EXCLUDE.includes(k)));
  return { name: 'orb-nucleo', version: pkg.version, private: true, type: 'module', description: 'Orb Núcleo: el motor de Orb sin ventana, para el servidor.', engines: { node: '>=22.13' }, dependencies: deps };
}

export const launcher = () => `#!/bin/sh
# Orb Núcleo: arranca el motor de Orb con el Node que viene dentro (no hace falta instalar Node).
set -e
DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
exec "$DIR/node/bin/node" --max-old-space-size=512 "$DIR/src/server/orb-nucleo.mjs" "$@"
`;

// 3.5: «orb», the terminal client (src/terminal/orb-cli.mjs), with the Node of the package.
export const terminalLauncher = () => `#!/bin/sh
# Orb en la terminal: habla con tu Orb (o con otro enlazado) desde la consola.
set -e
DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
exec "$DIR/node/bin/node" "$DIR/src/terminal/orb-cli.mjs" "$@"
`;

// systemd --user: always on, 1 GB of RAM at most, a little behind the rest of the server.
export const serviceUnit = () => `[Unit]
Description=Orb Núcleo (el motor de Orb, siempre encendido)
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStart=%h/orb-nucleo/current/orb-nucleo
Environment=ORB_HOME=%h/orb
Restart=always
RestartSec=5
# Only the main process gets SIGTERM (it closes the engine in order); whatever is left, after TimeoutStopSec.
KillMode=mixed
TimeoutStopSec=20
MemoryMax=1G
Nice=5
NoNewPrivileges=true

[Install]
WantedBy=default.target
`;

export const installGuide = (version) => `# Orb Núcleo ${version} (servidor Linux)

El motor de Orb sin ventana, siempre encendido. Trae su propio Node: en el servidor no se compila ni se instala nada más.

## Instalar o actualizar desde el PC

\`\`\`
npm run servidor:instalar -- <servidor-ssh>
\`\`\`

Copia este paquete por SSH, lo descomprime en \`~/orb-nucleo/${version}\`, apunta \`~/orb-nucleo/current\` a él, guarda antes una copia de \`~/orb/.orb/datos\` y arranca el servicio \`orb-nucleo\` de tu usuario.

## A mano, en el servidor

\`\`\`
mkdir -p ~/orb-nucleo && tar -xzf orb-nucleo-${version}-linux-x64.tar.gz -C ~/orb-nucleo
mv ~/orb-nucleo/orb-nucleo-${version} ~/orb-nucleo/${version}
ln -sfn ~/orb-nucleo/${version} ~/orb-nucleo/current
mkdir -p ~/.config/systemd/user && cp ~/orb-nucleo/current/orb-nucleo.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now orb-nucleo
\`\`\`

## Una sola vez, con sudo

- Para que siga encendido sin tu sesión abierta: \`sudo loginctl enable-linger $USER\`
- Para que el móvil entre por Tailscale con https: \`sudo tailscale set --operator=$USER\`

## Mirar cómo va

- \`systemctl --user status orb-nucleo\` y \`journalctl --user -u orb-nucleo -f\`
- Registro: \`~/orb/.orb/ejecuciones/nucleo.log\`

## Enlazar un móvil, otro Orb o una terminal (sin pantalla)

- \`~/orb-nucleo/current/orb-nucleo enlazar\` dibuja el QR en la terminal y da el código corto y la dirección.
- Orb en la terminal: \`~/orb-nucleo/current/bin/orb\` (a mano siempre con \`ln -sfn ~/orb-nucleo/current/bin/orb ~/.local/bin/orb\`).
- Comprobación rápida (con el servicio parado): \`~/orb-nucleo/current/orb-nucleo estado\`

Tus datos están en \`~/orb\`. Las copias de antes de cada actualización, en \`~/orb-nucleo/copias\`.
`;

// ---- tar (ustar with pax headers for long names) ---------------------------------------------------------------------

const block = (n) => Math.ceil(n / 512) * 512;
function header(name, { size = 0, mode = 0o644, type = '0', mtime = 0, linkname = '' }) {
  const h = Buffer.alloc(512);
  const put = (s, off, len) => { Buffer.from(s, 'utf8').copy(h, off, 0, len); };
  const oct = (v, off, len) => put(v.toString(8).padStart(len - 1, '0') + '\0', off, len);
  put(name, 0, 100); oct(mode, 100, 8); oct(0, 108, 8); oct(0, 116, 8); oct(size, 124, 12); oct(mtime, 136, 12);
  h.fill(' ', 148, 156); put(type, 156, 1); put(linkname, 157, 100); put('ustar\0', 257, 6); put('00', 263, 2);
  put('root', 265, 32); put('root', 297, 32);
  let sum = 0; for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}
function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`; let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return `${len}${body}`;
}
// entries: [{ name, mode, data?: Buffer, file?: absolute path, dir?: true }] → the .tar.gz at out.
export async function writeTarGz(out, entries, { mtime = Math.floor(Date.now() / 1000) } = {}) {
  async function* chunks() {
    for (const e of entries) {
      const name = e.dir ? `${e.name.replace(/\/$/, '')}/` : e.name;
      const data = e.dir ? Buffer.alloc(0) : (e.data ?? fs.readFileSync(e.file));
      if (Buffer.byteLength(name) > 100) {
        const pax = Buffer.from(paxRecord('path', name), 'utf8');
        yield header('PaxHeader/x', { size: pax.length, type: 'x', mtime });
        yield Buffer.concat([pax, Buffer.alloc(block(pax.length) - pax.length)]);
      }
      yield header(name.slice(0, 100), { size: data.length, mode: e.mode ?? (e.dir ? 0o755 : 0o644), type: e.dir ? '5' : '0', mtime });
      if (data.length) { yield data; const pad = block(data.length) - data.length; if (pad) yield Buffer.alloc(pad); }
    }
    yield Buffer.alloc(1024);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await pipeline(Readable.from(chunks()), zlib.createGzip({ level: 9 }), fs.createWriteStream(out));
}

// The files of a .tar.gz (pax names understood): [{ name, mode, type, data }]. Only regular files and directories.
export function readTarGz(file) {
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  const list = []; let off = 0; let paxName = null;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, l) => h.subarray(a, a + l).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 12).trim() || '0', 8); const type = str(156, 1) || '0';
    const prefix = str(345, 155); let name = prefix ? `${prefix}/${str(0, 100)}` : str(0, 100);
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + block(size);
    if (type === 'x') { const m = data.toString('utf8').match(/\d+ path=([^\n]*)\n/); paxName = m ? m[1] : null; continue; }
    if (type === 'L') { paxName = data.toString('utf8').replace(/\0.*$/s, ''); continue; } // GNU long name
    if (type === 'g') continue;
    if (paxName) { name = paxName; paxName = null; }
    list.push({ name, mode: parseInt(str(100, 8).trim() || '0', 8), type, data, linkname: str(157, 100) });
  }
  return list;
}

// ---- Node for linux-x64 ----------------------------------------------------------------------------------------------

async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.text(); }
async function nodeVersion(wanted) {
  if (wanted) return wanted.replace(/^v?/, 'v');
  try {
    const index = JSON.parse(await fetchText('https://nodejs.org/dist/index.json'));
    const v = index.find((x) => /^v22\./.test(x.version) && x.lts)?.version;
    if (v) return v;
  } catch (error) { console.warn(`  sin conexión con nodejs.org (${error.message}): se usa la versión guardada`); }
  const cached = fs.existsSync(cacheDir()) ? fs.readdirSync(cacheDir()).map((f) => f.match(/^node-(v22\.\d+\.\d+)-linux-x64\.tar\.gz$/)?.[1]).filter(Boolean) : [];
  const best = cached.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  if (!best) throw new Error('no se pudo saber qué Node 22 descargar (sin conexión y sin copia guardada)');
  return best;
}
export async function nodeTarball(version) {
  const name = `node-${version}-linux-x64.tar.gz`;
  const file = path.join(cacheDir(), name);
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  let expected = null;
  try {
    const sums = await fetchText(`https://nodejs.org/dist/${version}/SHASUMS256.txt`);
    expected = sums.split('\n').map((l) => l.trim().split(/\s+/)).find((p) => p[1] === name)?.[0] ?? null;
    if (expected) fs.writeFileSync(`${file}.sha256`, expected);
  } catch { try { expected = fs.readFileSync(`${file}.sha256`, 'utf8').trim(); } catch { /* none */ } }
  if (!expected) throw new Error(`no hay suma SHA-256 de ${name}`);
  if (fs.existsSync(file) && sha(file) === expected) return file;
  fs.mkdirSync(cacheDir(), { recursive: true });
  console.log(`  descargando ${name}…`);
  const r = await fetch(`https://nodejs.org/dist/${version}/${name}`);
  if (!r.ok) throw new Error(`descarga de ${name}: ${r.status}`);
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  if (sha(tmp) !== expected) { fs.rmSync(tmp, { force: true }); throw new Error(`${name}: la suma SHA-256 no coincide`); }
  fs.renameSync(tmp, file);
  return file;
}

// ---- steps ------------------------------------------------------------------------------------------------------------

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', windowsHide: true, ...opts });
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} ${args.slice(0, 3).join(' ')}… terminó con código ${r.status ?? r.error?.message}`);
}
const npmCli = () => {
  if (process.env.npm_execpath && /\.c?js$/.test(process.env.npm_execpath)) return process.env.npm_execpath;
  return path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
};

// The production modules for linux-x64, in a staging folder (npm only picks the Linux optional packages there).
export function installModules(stage, pkg) {
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(serverPackage(pkg), null, 2));
  const lock = path.join(ROOT, 'package-lock.json');
  if (fs.existsSync(lock)) fs.copyFileSync(lock, path.join(stage, 'package-lock.json'));
  run(process.execPath, [npmCli(), 'install', '--omit=dev', '--os=linux', '--cpu=x64', '--libc=glibc', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: stage });
  const sdk = path.join(stage, 'node_modules', '@anthropic-ai', 'claude-agent-sdk-linux-x64', 'claude');
  if (!fs.existsSync(sdk)) throw new Error('falta el paquete linux-x64 del Agent SDK de Claude en node_modules');
  for (const other of fs.readdirSync(path.join(stage, 'node_modules', '@anthropic-ai'))) {
    if (/^claude-agent-sdk-/.test(other) && other !== 'claude-agent-sdk-linux-x64') throw new Error(`sobra ${other} (no es para linux-x64)`);
  }
}

// Everything that goes in the tar, under top/.
export function manifest({ root = ROOT, version, top = `orb-nucleo-${version}`, modules = null, node = null }) {
  const entries = [{ name: top, dir: true }];
  for (const [rel, abs] of appFiles(root)) entries.push({ name: `${top}/${rel}`, file: abs, mode: 0o644 });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  entries.push({ name: `${top}/package.json`, data: Buffer.from(JSON.stringify(serverPackage(pkg), null, 2)), mode: 0o644 });
  entries.push({ name: `${top}/orb-nucleo`, data: Buffer.from(launcher()), mode: 0o755 });
  entries.push({ name: `${top}/bin`, dir: true });
  entries.push({ name: `${top}/bin/orb`, data: Buffer.from(terminalLauncher()), mode: 0o755 });
  entries.push({ name: `${top}/orb-nucleo.service`, data: Buffer.from(serviceUnit()), mode: 0o644 });
  entries.push({ name: `${top}/INSTALAR.md`, data: Buffer.from(installGuide(version)), mode: 0o644 });
  entries.push({ name: `${top}/VERSION`, data: Buffer.from(`${version}\n`), mode: 0o644 });
  if (node) for (const n of node) entries.push({ name: `${top}/node/${n.name}`, data: n.data, mode: n.mode });
  if (modules) {
    const walk = (dir, rel) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name); const r = `${rel}/${e.name}`;
        if (e.isDirectory()) { if (e.name !== '.bin') walk(abs, r); continue; }
        if (!e.isFile() || JUNK.test(r) || r.endsWith('/.package-lock.json')) continue;
        // The executables of the Linux packages (Claude Code of the Agent SDK) keep their x bit.
        const exec = /\/claude-agent-sdk-linux-x64\/claude$/.test(r) || /\/bin\/[^/]+$/.test(r) && !/\.(json|md|txt)$/.test(r);
        entries.push({ name: `${top}/${r}`, file: abs, mode: exec ? 0o755 : 0o644 });
      }
    };
    walk(modules, 'node_modules');
  }
  return entries;
}

// From the official Node tarball: only bin/node and its licence (npm is not needed on the server).
export function nodeFiles(tarball) {
  const keep = [];
  for (const e of readTarGz(tarball)) {
    const rel = e.name.replace(/^[^/]+\//, '');
    if (e.type === '0' && (rel === 'bin/node' || rel === 'LICENSE')) keep.push({ name: rel, data: e.data, mode: rel === 'bin/node' ? 0o755 : 0o644 });
  }
  if (!keep.some((k) => k.name === 'bin/node')) throw new Error('el paquete de Node no trae bin/node');
  return keep;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;
  const outDir = path.resolve(opt('--out') ?? path.join(ROOT, 'dist'));
  const started = Date.now();
  console.log(`Orb Núcleo ${version} para linux-x64`);
  if (!args.includes('--skip-build')) {
    console.log('1/4 interfaz (vite build)');
    run(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'warn'], { cwd: ROOT });
  }
  if (!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'index.html'))) throw new Error('falta la interfaz compilada (src/renderer)');
  console.log('2/4 Node 22 LTS para linux-x64');
  const nv = await nodeVersion(opt('--node'));
  const node = nodeFiles(await nodeTarball(nv));
  console.log(`  ${nv}`);
  console.log('3/4 módulos de producción para linux-x64');
  const stage = path.join(outDir, `.servidor-${version}`);
  fs.rmSync(stage, { recursive: true, force: true });
  installModules(stage, pkg);
  console.log('4/4 paquete');
  const out = path.join(outDir, `orb-nucleo-${version}-linux-x64.tar.gz`);
  const entries = manifest({ version, modules: path.join(stage, 'node_modules'), node });
  await writeTarGz(out, entries);
  if (!args.includes('--keep')) fs.rmSync(stage, { recursive: true, force: true });
  const mb = (fs.statSync(out).size / 1048576).toFixed(1);
  console.log(`✔ ${out} (${mb} MB, ${entries.length} entradas, Node ${nv}, ${Math.round((Date.now() - started) / 1000)} s)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`✖ ${error.message}`); process.exit(1); });
}

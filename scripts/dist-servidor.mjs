// 3.5/3.7, `npm run dist:server` (also `dist:servidor`): Orb Server for Linux, made on the Windows PC. One package per
// processor, dist/orb-server-<version>-linux-x64.tar.gz and …-linux-arm64.tar.gz, with
//   orb-server-<version>/node/bin/node          the official Node 24 LTS for that processor (crypto.argon2 for
//                                               Argon2id vault accounts) (checked against nodejs.org's SHA-256)
//   orb-server-<version>/src/…                  only what the server engine loads (src/server/engine-server.mjs and the CLI,
//                                               the bots' tools, the terminal client): never the interface, the Electron app
//                                               nor the programming modules (src/server/server-product.mjs)
//   orb-server-<version>/node_modules/…         the production modules, pure JavaScript: no Agent SDK program (Claude and
//                                               Codex are downloaded on demand by the server, src/server/engines.mjs)
//   orb-server-<version>/orb-server             the launcher (and orb-nucleo, its old name); orb-server.service (systemd
//                                               --user) and orb-server-nosudo.service; admin-setup.sh; INSTALAR.md; VERSION
//   orb-server-<version>/bin/orb                the terminal client (src/terminal), with the same Node
// and dist/install.sh (scripts/install.sh.tmpl with the packages' and Node's sums inside). The tar is written here (ustar
// with pax names), so the Linux permissions (the executables) are exact on any PC. Target: 50 MB per package at most.
// Then src/core/server-release.mjs gets the real version, url and sha256 of that install.sh (the app's install command;
// scripts/release.mjs refuses to sign, and the release workflow to build the app, while it holds no real hash).
// Options: --node <24.x.y>, --arch x64|arm64|all (default all), --out <folder>, --keep (keep the staging folder).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeTarGz, readTarGz } from '../src/server/tar.mjs';
import { HELPER_PATH, UNITS_ALLOW, SUDOERS_FILE } from '../src/server/admin-verbs.mjs';
import { installUrlFor } from '../src/core/server-install.mjs';

export { writeTarGz, readTarGz };
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ARCHES = ['x64', 'arm64'];
export const MAX_MB = 50;
// 3.7: the Node line inside the package: 24 LTS (crypto.argon2, for the vault's Argon2id accounts; no wasm).
export const NODE_MAJOR = 24;
export const NODE_ENGINES = '>=24';
// The module the app reads to show the install command (written by main() once install.sh exists).
export const RELEASE_MODULE = path.join(ROOT, 'src', 'core', 'server-release.mjs');
// What the server runs (each one and everything it imports goes in), and the data files they read.
export const SERVER_ENTRIES = ['src/server/orb-server.mjs', 'src/server/orb-nucleo.mjs', 'src/server/engine-server.mjs', 'src/mcp/server.mjs', 'src/mcp/bot.mjs', 'src/terminal/orb-cli.mjs'];
export const SERVER_DATA = ['src/core/templates', 'src/server/admin-helper.sh'];
// Never in the server's package, whatever imports them.
export const SRC_EXCLUDE = ['ui', 'main', 'renderer'];
// Modules of package.json the server does not need (the PC app's updater).
export const DEPS_EXCLUDE = ['electron-updater'];
// Files of node_modules that are of no use at run time (and the SDK's browser build).
const JUNK = /(\.d\.ts|\.d\.mts|\.d\.cts|\.map|(^|\/)(README|CHANGELOG|HISTORY)(\.[a-z]+)?|\/claude-agent-sdk\/browser-sdk\.js)$/i;

const cacheDir = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), 'orb-build-cache', 'node');

// ---- what goes in ----------------------------------------------------------------------------------------------------

// The modules a file imports by relative path (static, re-exports and dynamic import('…') with a literal).
export function importsOf(file) {
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) out.push(m[1]);
  for (const m of text.matchAll(/(?:^|\n)\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/g)) out.push(m[1]);
  for (const m of text.matchAll(/import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out.map((r) => path.resolve(path.dirname(file), r));
}
// Every file the entries reach, as relative paths with /.
export function closure(root = ROOT, entries = SERVER_ENTRIES) {
  const seen = new Set();
  const walk = (abs) => { if (seen.has(abs) || !fs.existsSync(abs)) return; seen.add(abs); for (const f of importsOf(abs)) walk(f); };
  for (const e of entries) walk(path.join(root, ...e.split('/')));
  return [...seen].map((f) => path.relative(root, f).split(path.sep).join('/'));
}
// The files of src/ that go in, as [relative path (with /), absolute path].
export function appFiles(root = ROOT) {
  const out = new Map();
  for (const rel of closure(root)) out.set(rel, path.join(root, ...rel.split('/')));
  const walk = (dir, rel) => {
    if (!fs.existsSync(dir)) return;
    if (fs.statSync(dir).isFile()) { out.set(rel, dir); return; }
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) walk(path.join(dir, e.name), `${rel}/${e.name}`);
  };
  for (const d of SERVER_DATA) walk(path.join(root, ...d.split('/')), d);
  return [...out].filter(([rel]) => !SRC_EXCLUDE.some((x) => rel.startsWith(`src/${x}/`))).sort((a, b) => a[0].localeCompare(b[0]));
}

// The package.json of the server: its name and version, and only the production modules it uses.
export function serverPackage(pkg) {
  const deps = Object.fromEntries(Object.entries(pkg.dependencies ?? {}).filter(([k]) => !DEPS_EXCLUDE.includes(k)));
  return { name: 'orb-server', version: pkg.version, private: true, type: 'module', description: 'Orb Server: los bots de Orb, siempre encendidos, para un servidor Linux.', engines: { node: NODE_ENGINES }, dependencies: deps };
}

// 3.7: a new version that fails to start three times in a row goes back to the one before (src/server/update.mjs does
// the same from inside after its 60 s health check). Only for the service (no arguments), never for a command.
export const launcher = () => `#!/bin/sh
# Orb Server: arranca el motor de Orb con el Node que viene dentro (no hace falta instalar Node).
set -e
DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
APP="$(dirname "$DIR")"
if [ "$#" -eq 0 ] && [ "$(basename "$APP")" = app ] && [ -f "$APP/update-from" ]; then
  n=$(cat "$APP/update-tries" 2>/dev/null || echo 0)
  case "$n" in ''|*[!0-9]*) n=0 ;; esac
  n=$((n + 1)); echo "$n" > "$APP/update-tries"
  prev=$(cat "$APP/update-from")
  case "$prev" in ''|*[!0-9.]*) prev='' ;; esac
  if [ "$n" -gt 3 ] && [ -n "$prev" ] && [ -x "$APP/$prev/orb-server" ]; then
    ln -sfn "$prev" "$APP/current.nuevo" && mv -Tf "$APP/current.nuevo" "$APP/current"
    rm -f "$APP/update-from" "$APP/update-tries" "$APP/update-pending.json"
    exec "$APP/$prev/orb-server"
  fi
fi
exec "$DIR/node/bin/node" --max-old-space-size=320 "$DIR/src/server/orb-server.mjs" "$@"
`;

// 3.5: «orb», the terminal client (src/terminal/orb-cli.mjs), with the Node of the package.
export const terminalLauncher = () => `#!/bin/sh
# Orb en la terminal: habla con tu Orb (o con otro enlazado) desde la consola.
set -e
DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
exec "$DIR/node/bin/node" "$DIR/src/terminal/orb-cli.mjs" "$@"
`;

// 3.7: systemd --user, always on (linger: also at boot, without a session), restarted when it falls or hangs (watchdog).
// 512 MB for Orb Server itself; the agents and Chromium run in their own scopes with their own limits (engines.mjs), so
// they never take the engine's memory. sudo: false (--no-sudo install) keeps NoNewPrivileges; with the admin helper the
// unit cannot have it (sudo would not work), and every agent process gets no_new_privs on its own instead.
export const serviceUnit = ({ sudo = true } = {}) => `[Unit]
Description=Orb Server (los bots de Orb, siempre encendidos)
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStart=%h/orb-server/app/current/orb-server
Environment=ORB_HOME=%h/orb-server
Restart=always
RestartSec=5
# The engine tells systemd it is alive (src/server/watchdog.mjs); a hang is a restart.
WatchdogSec=180
NotifyAccess=all
# Only the main process gets SIGTERM (it closes the engine in order); whatever is left, after TimeoutStopSec.
KillMode=mixed
TimeoutStopSec=20
MemoryMax=512M
MemoryHigh=448M
Nice=5
${sudo ? '# No NoNewPrivileges here: the admin helper (sudo) is reached only by the engine, after an approval card. Agents and\n# Chromium run with no_new_privs in their own scopes (engines/<id>/run).' : 'NoNewPrivileges=true'}

[Install]
WantedBy=default.target
`;

// 3.7: what the installer runs once as root (one sudo): linger, the admin helper and its sudoers drop-in (checked with
// visudo before it is put in place). $1: the user Orb Server runs as; $2: the folder of this version.
export const adminSetup = () => `#!/bin/sh
# Orb Server: lo que el instalador hace una sola vez como root (sudo).
set -eu
U="$1"; D="$2"
case "$U" in ''|*[!a-z0-9_-]*) echo "usuario no válido" >&2; exit 64 ;; esac
loginctl enable-linger "$U"
install -d -o root -g root -m 0755 /usr/local/libexec /etc/orb-server
install -o root -g root -m 0755 "$D/src/server/admin-helper.sh" ${HELPER_PATH}
[ -f ${UNITS_ALLOW} ] || printf '%s\\n' '# Orb Server: los servicios del sistema que puede reiniciar (uno por línea, con una tarjeta de aprobación).' > ${UNITS_ALLOW}
chown root:root ${UNITS_ALLOW}; chmod 0644 ${UNITS_ALLOW}
T=$(mktemp)
printf '%s\\n' "# Orb Server: $U may run the server's admin helper (fixed actions, each one approved on a card). Nothing else." "$U ALL=(root) NOPASSWD: ${HELPER_PATH}" > "$T"
if visudo -cf "$T" >/dev/null; then install -o root -g root -m 0440 "$T" ${SUDOERS_FILE}; else rm -f "$T"; echo "sudoers no válido: no se instala" >&2; exit 65; fi
rm -f "$T"
echo ADMIN=si
`;

export const installGuide = (version) => `# Orb Server ${version} (servidor Linux)

Los bots de Orb, siempre encendidos. Trae su propio Node: en el servidor no se compila nada. Claude y Codex se descargan
solos la primera vez que un bot o un inicio de sesión los necesita.

## Instalar o actualizar

Lo más fácil: Orb › Magic Link › «Añadir Orb Server» te da un comando para pegar en el servidor. A mano:

\`\`\`
bash install.sh                 # instala en ~/orb-server, arranca el servicio y lo deja encendido al reiniciar
bash install.sh --no-sudo       # sin sudo: sin acciones de administración y solo mientras tengas la sesión abierta
\`\`\`

Desde el PC, por SSH: \`npm run servidor:instalar -- <servidor-ssh>\`.

## Mirar cómo va

- \`systemctl --user status orb-server\` y \`journalctl --user -u orb-server -f\`
- Registro: \`~/orb-server/logs/nucleo.log\`
- \`orb-server estado\`, \`orb-server motores\`, \`orb-server actualizar --comprobar\`

## Enlazar un móvil, otro Orb o una terminal (sin pantalla)

- \`orb-server enlazar\` dibuja el QR en la terminal y da el código corto y la dirección.
- Orb en la terminal: \`orb\`.

Tus datos están en \`~/orb-server\` (bots, data, logs). Más en docs/SERVER.md.
`;

// ---- Node for linux-x64 and linux-arm64 -------------------------------------------------------------------------------

async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.text(); }
async function nodeVersion(wanted) {
  if (wanted) {
    const v = wanted.replace(/^v?/, 'v');
    if (!v.startsWith(`v${NODE_MAJOR}.`) || Number(v.split('.')[1]) < 7) throw new Error(`Orb Server lleva Node ${NODE_MAJOR}.7 o posterior (crypto.argon2): ${v} no vale`);
    return v;
  }
  try {
    const index = JSON.parse(await fetchText('https://nodejs.org/dist/index.json'));
    const v = index.find((x) => x.version.startsWith(`v${NODE_MAJOR}.`) && x.lts)?.version;
    if (v) return v;
  } catch (error) { console.warn(`  sin conexión con nodejs.org (${error.message}): se usa la versión guardada`); }
  const cached = fs.existsSync(cacheDir()) ? fs.readdirSync(cacheDir()).map((f) => f.match(/^node-(v\d+\.\d+\.\d+)-linux-(x64|arm64)\.tar\.gz$/)?.[1]).filter((v) => v?.startsWith(`v${NODE_MAJOR}.`)).filter(Boolean) : [];
  const best = cached.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  if (!best) throw new Error(`no se pudo saber qué Node ${NODE_MAJOR} descargar (sin conexión y sin copia guardada)`);
  return best;
}
export async function nodeTarball(version, arch = 'x64') {
  const name = `node-${version}-linux-${arch}.tar.gz`;
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

// The production modules, in a staging folder: pure JavaScript, the same for both processors. No optional packages (the
// Agent SDK's program for each system: the server downloads its own, engines.mjs) and no peer modules nobody imports.
export function installModules(stage, pkg) {
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(serverPackage(pkg), null, 2));
  const lock = path.join(ROOT, 'package-lock.json');
  if (fs.existsSync(lock)) fs.copyFileSync(lock, path.join(stage, 'package-lock.json'));
  run(process.execPath, [npmCli(), 'install', '--omit=dev', '--omit=optional', '--omit=peer', '--os=linux', '--cpu=x64', '--libc=glibc', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: stage });
  const ai = path.join(stage, 'node_modules', '@anthropic-ai');
  if (!fs.existsSync(path.join(ai, 'claude-agent-sdk', 'sdk.mjs'))) throw new Error('falta el Agent SDK de Claude en node_modules');
  for (const other of fs.existsSync(ai) ? fs.readdirSync(ai) : []) if (other !== 'claude-agent-sdk') fs.rmSync(path.join(ai, other), { recursive: true, force: true });
}

// Everything that goes in the tar, under top/. The shell files always with Unix line ends.
const unix = (file) => Buffer.from(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
export function manifest({ root = ROOT, version, top = `orb-server-${version}`, modules = null, node = null }) {
  const entries = [{ name: top, dir: true }];
  for (const [rel, abs] of appFiles(root)) entries.push(rel.endsWith('.sh') ? { name: `${top}/${rel}`, data: unix(abs), mode: 0o755 } : { name: `${top}/${rel}`, file: abs, mode: 0o644 });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  entries.push({ name: `${top}/package.json`, data: Buffer.from(JSON.stringify(serverPackage(pkg), null, 2)), mode: 0o644 });
  entries.push({ name: `${top}/orb-server`, data: Buffer.from(launcher()), mode: 0o755 });
  // 3.7: its old name, so what an older install runs (aliases, scripts) still works.
  entries.push({ name: `${top}/orb-nucleo`, data: Buffer.from(launcher()), mode: 0o755 });
  entries.push({ name: `${top}/bin`, dir: true });
  entries.push({ name: `${top}/bin/orb`, data: Buffer.from(terminalLauncher()), mode: 0o755 });
  entries.push({ name: `${top}/orb-server.service`, data: Buffer.from(serviceUnit({ sudo: true })), mode: 0o644 });
  entries.push({ name: `${top}/orb-server-nosudo.service`, data: Buffer.from(serviceUnit({ sudo: false })), mode: 0o644 });
  entries.push({ name: `${top}/admin-setup.sh`, data: Buffer.from(adminSetup()), mode: 0o755 });
  entries.push({ name: `${top}/INSTALAR.md`, data: Buffer.from(installGuide(version)), mode: 0o644 });
  entries.push({ name: `${top}/VERSION`, data: Buffer.from(`${version}\n`), mode: 0o644 });
  if (node) for (const n of node) entries.push({ name: `${top}/node/${n.name}`, data: n.data, mode: n.mode });
  if (modules) {
    const walk = (dir, rel) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name); const r = `${rel}/${e.name}`;
        if (e.isDirectory()) { if (e.name !== '.bin') walk(abs, r); continue; }
        if (!e.isFile() || JUNK.test(r) || r.endsWith('/.package-lock.json')) continue;
        const exec = /\/bin\/[^/]+$/.test(r) && !/\.(json|md|txt)$/.test(r);
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

export const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// src/core/server-release.mjs for the install.sh just made: what the app puts in its one-line install command.
export function releaseModuleSource({ version, sha256: sum, url = installUrlFor(version) }) {
  if (!/^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(String(version ?? ''))) throw new Error(`versión no válida: ${version}`);
  if (!/^[0-9a-f]{64}$/.test(String(sum ?? '')) || /^0+$/.test(sum)) throw new Error('la suma de install.sh no es válida');
  if (!/^https:\/\/[^\s'"]+\/install\.sh$/.test(String(url ?? ''))) throw new Error(`dirección de install.sh no válida: ${url}`);
  return `// 3.7: the Orb Server release this app installs (src/core/server-install.mjs). GENERATED by npm run dist:server
// (scripts/dist-servidor.mjs) from the install.sh it made: do not edit by hand. A development build has nulls here, and
// the app's command then carries a placeholder hash that sha256sum refuses (scripts/release.mjs checks it never ships).
export const SERVER_RELEASE = ${JSON.stringify({ version, url, sha256: sum })};
`;
}
export function writeServerRelease({ file = RELEASE_MODULE, ...release }) {
  fs.writeFileSync(file, releaseModuleSource(release));
  return file;
}
// install.sh from its template: the version and the sums of each package and of the Node inside it.
export function renderInstall(template, { version, packages }) {
  if (!/^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(version)) throw new Error(`versión no válida: ${version}`);
  const vals = { VERSION: version };
  for (const a of ARCHES) { vals[`SHA256_${a.toUpperCase()}`] = packages[a]?.sha256 ?? ''; vals[`NODE_SHA256_${a.toUpperCase()}`] = packages[a]?.node ?? ''; }
  for (const [k, v] of Object.entries(vals)) if (!/^[\w.+-]*$/.test(v)) throw new Error(`valor no válido: ${k}`);
  const out = template.replace(/\r\n/g, '\n').replace(/@@([A-Z0-9_]+)@@/g, (m, k) => { if (!(k in vals)) throw new Error(`falta ${k}`); return vals[k]; });
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;
  const outDir = path.resolve(opt('--out') ?? path.join(ROOT, 'dist'));
  const arches = !opt('--arch') || opt('--arch') === 'all' ? ARCHES : [opt('--arch')];
  if (arches.some((a) => !ARCHES.includes(a))) throw new Error(`procesador: ${ARCHES.join(', ')} o all`);
  const started = Date.now();
  console.log(`Orb Server ${version} para linux-${arches.join(' y linux-')}`);
  console.log('1/3 módulos de producción (JavaScript, sin el programa del Agent SDK)');
  const stage = path.join(outDir, `.servidor-${version}`);
  fs.rmSync(stage, { recursive: true, force: true });
  installModules(stage, pkg);
  const nv = await nodeVersion(opt('--node'));
  const packages = {};
  for (const arch of arches) {
    console.log(`2/3 Node ${nv} para linux-${arch}`);
    const node = nodeFiles(await nodeTarball(nv, arch));
    console.log(`3/3 paquete linux-${arch}`);
    const out = path.join(outDir, `orb-server-${version}-linux-${arch}.tar.gz`);
    const entries = manifest({ version, modules: path.join(stage, 'node_modules'), node });
    await writeTarGz(out, entries);
    const mb = fs.statSync(out).size / 1048576;
    packages[arch] = { file: out, sha256: sha256(out), node: crypto.createHash('sha256').update(node.find((n) => n.name === 'bin/node').data).digest('hex'), size: fs.statSync(out).size };
    console.log(`✔ ${out} (${mb.toFixed(1)} MB, ${entries.length} entradas)`);
    if (mb > MAX_MB) throw new Error(`el paquete pasa de ${MAX_MB} MB (${mb.toFixed(1)} MB)`);
  }
  if (!args.includes('--keep')) fs.rmSync(stage, { recursive: true, force: true });
  if (arches.length === ARCHES.length) {
    const install = path.join(outDir, 'install.sh');
    fs.writeFileSync(install, renderInstall(fs.readFileSync(path.join(ROOT, 'scripts', 'install.sh.tmpl'), 'utf8'), { version, packages }), { mode: 0o755 });
    console.log(`✔ ${install} (sha256 ${sha256(install)}): fírmalo con npm run release:sign`);
    writeServerRelease({ version, sha256: sha256(install) });
    console.log(`✔ ${path.relative(ROOT, RELEASE_MODULE)} con esa suma: haz commit de ese archivo antes de publicar la app`);
  }
  console.log(`Node ${nv}, ${Math.round((Date.now() - started) / 1000)} s`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`✖ ${error.message}`); process.exit(1); });
}

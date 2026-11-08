// What the Tauri package carries next to Orb.exe (src-tauri/resources, git-ignored; tauri.windows.conf.json lists it):
//   node/node.exe   the official Node 24 LTS for Windows x64 (signed by the OpenJS Foundation), checked against its
//                   pinned SHA-256 and kept in the build cache (ORB_BUILD_CACHE, by default %LOCALAPPDATA%\orb-build-cache)
//   app/src/...     the engine's code (src without the window's sources) and the built
//                   window (src/renderer: the phone's page is served from it)
//   app/node_modules/{@anthropic-ai/claude-agent-sdk,zod,@noble/*}   the engine's packages (no platform binaries)
//   app/package.json
// Run after `vite build`.
//   node scripts/tauri-resources.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src-tauri', 'resources');
const NODE = Object.freeze({ version: '24.22.1', sha256: 'd702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5' });
const CACHE = process.env.ORB_BUILD_CACHE || path.join(process.env.LOCALAPPDATA || os.homedir(), 'orb-build-cache');

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function node() {
  const cached = path.join(CACHE, 'node', `node-v${NODE.version}-win-x64.exe`);
  if (!fs.existsSync(cached) || sha256(cached) !== NODE.sha256) {
    const url = `https://nodejs.org/dist/v${NODE.version}/win-x64/node.exe`;
    console.log(`descargando ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const got = crypto.createHash('sha256').update(bytes).digest('hex');
    if (got !== NODE.sha256) throw new Error(`node.exe: SHA-256 ${got} no es el esperado ${NODE.sha256}`);
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.writeFileSync(`${cached}.tmp`, bytes);
    fs.renameSync(`${cached}.tmp`, cached);
  }
  const target = path.join(OUT, 'node', 'node.exe');
  if (!fs.existsSync(target) || sha256(target) !== NODE.sha256) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(cached, target);
  }
}

// Files of the packages that are not code the engine runs.
const SKIP = (name) => /\.d\.[cm]?ts$|\.map$|^README|^CHANGELOG/i.test(name);
function copy(from, to, skip = SKIP) {
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from)) if (!skip(e, path.join(from, e))) copy(path.join(from, e), path.join(to, e), skip);
  } else fs.copyFileSync(from, to);
}

function app() {
  const dest = path.join(OUT, 'app');
  fs.rmSync(dest, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  if (!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'index.html'))) throw new Error('falta src/renderer: ejecuta antes `npx vite build`');
  // src without the window's sources (built into src/renderer).
  const src = path.join(ROOT, 'src');
  copy(src, path.join(dest, 'src'), (name, full) => full === path.join(src, 'ui'));
  const modules = ['@anthropic-ai/claude-agent-sdk', 'zod', ...fs.readdirSync(path.join(ROOT, 'node_modules', '@noble')).map((n) => `@noble/${n}`)];
  for (const m of modules) copy(path.join(ROOT, 'node_modules', m), path.join(dest, 'node_modules', m));
  copy(path.join(ROOT, 'package.json'), path.join(dest, 'package.json'));
}

await node();
app();
console.log(`recursos de Tauri listos en ${path.relative(ROOT, OUT)}`);

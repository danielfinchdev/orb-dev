// Constants, paths, start-command detection, SKILL.md metadata, and the dependency install Orb runs when a server is turned on.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const SKILL_FILE = 'SKILL.md';

export const LIVE_DIR = '.activas'; // in core\skills: what the agents load (exposeSkills)

export const OLD_DIR = '.anterior'; // in core\mcp: the version before the last «Aplicar cambios»

export const REQUESTS = 'extension_requests'; // board setting: what agents made in core\preparacion

export const EDITS = 'extension_edits'; // board setting: { [server]: project folder } («Editar en un proyecto»)

export const PLUGIN_NAME = 'orb-skills';

export const QUARANTINE = 'cuarentena'; // in core\datos (agents never write there): what the user is about to bring in

// A skill's name (the Agent Skills format: lowercase letters, digits and hyphens) and a server's (a connector's name).
export const SKILL_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62})$/;

export const MCP_NAME = /^[a-z0-9_-]{1,40}$/i;

// What a skill or a server may weigh (everything that moves into core) and how many files it may have.
export const LIMITS = { skill: { bytes: 20 * 1024 * 1024, files: 2000 }, mcp: { bytes: 200 * 1024 * 1024, files: 5000 } };

// Never copied into core (nor counted, listed or fingerprinted): dependencies, git and caches (Orb installs the
// dependencies itself when a server is turned on) and the package managers' settings of the folder (they may name
// programs npm or yarn run: script-shell, git, node-options…).
export const DEP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', '.cache']);

export const TOOL_CONFIG = /^(\.npmrc|\.yarnrc(\.ya?ml)?|\.yarn|\.pnpmfile\.c?js|pnpm-workspace\.ya?ml|\.pnpmrc)$/i;

export const SKIP = (name) => DEP_DIRS.has(name) || TOOL_CONFIG.test(name);

// A server's secrets (tokens, keys, credentials, sessions): never copied out of core («mejorar», «Editar en un proyecto»);
// a new version always keeps the ones of core. Known names, plus what the server declares (package.json › orb.secrets,
// or one pattern per line in .orb-secrets). A folder: tokens/, secrets/, credentials/ and the session folders of WhatsApp
// servers anywhere; auth/, session(s)/ and store/ when they are not in a folder of code (src, lib…: there they are
// code). A file: keys, tokens, cookies, sessions and databases of any kind, also with .bak, .old or .orig after them.
const SECRET_DIR = /^\.?(tokens?|secrets?|credentials?|wwebjs_auth|wwebjs_cache|auth_info.*|baileys_auth.*)$/i;

const SESSION_DIR = /^\.?(auth|session|sessions|store)$/i;

const CODE_DIR = /(^|\/)(src|lib|app|apps|components|pages|packages|test|tests|dist|build)\//i;

const DATA_EXT = String.raw`(\.(json|txt|ya?ml|env|cfg|conf|ini|toml|dat|bin|enc|key|pem|pickle|pkl|cache))?`;

const SECRET_FILE = new RegExp(`^(?:${[
  String.raw`\.env(?!\.(example|sample|template|dist)$)(\..+)?`, String.raw`\.netrc`, String.raw`\.pypirc`, String.raw`\.npmrc`, String.raw`\.git-credentials`, 'credentials',
  String.raw`id_(rsa|dsa|ecdsa|ed25519)(\.pub)?`, String.raw`.*\.(pem|key|p12|pfx|jks|keystore)`, String.raw`client_secrets?.*\.json`, String.raw`service[-_]?account.*\.json`,
  String.raw`.*(token|credential|secret)s?[^/]*\.(json|txt|ya?ml|dat|db|sqlite3?|pickle|pkl|bin|cache|enc)`,
  String.raw`.*\.keys?\.json`, String.raw`keys?\.json`, String.raw`o?auth([-_.][^/]*)?\.json`, String.raw`api[-_]?keys?([-_][^/.]*)?${DATA_EXT}`, String.raw`cookies?([-_][^/.]*)?${DATA_EXT}`,
  String.raw`.*session.*\.(json|db|sqlite3?)`, String.raw`storage[-_]?state.*\.json`, String.raw`.*\.(db|sqlite3?)(-journal|-wal|-shm)?`
].map((p) => `(?:${p})`).join('|')})$`, 'i');

const BACKUP = /(\.(bak|old|orig|save|backup|tmp)|~)+$/i;

export const secretName = (name, rel, isDirectory) => (isDirectory
  ? SECRET_DIR.test(name) || (SESSION_DIR.test(name) && !CODE_DIR.test(rel))
  : SECRET_FILE.test(name) || SECRET_FILE.test(name.replace(BACKUP, '')));

export const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

export const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

export const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };

export const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };

export const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

export const norm = (p) => path.resolve(p).toLowerCase();

// Where a path really is (links and junctions followed; a part not made yet: its nearest existing parent counts).
const realOf = (p) => {
  let at = path.resolve(p); const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(at), ...rest.reverse()); } catch { /* not there: its parent */ }
    const up = path.dirname(at); if (up === at) return path.resolve(p);
    rest.push(path.basename(at)); at = up;
  }
};

export const realInside = (root, p) => { const r = norm(realOf(root)); const t = norm(realOf(p)); return t === r || t.startsWith(r + path.sep); };

// An error the window shows as it is (its key and values; tr: the engine's translate for the owner's language).
export class ExtensionError extends Error {
  constructor(key, vars = {}, tr = null) { super(tr ? tr(key, vars) : key); this.key = key; this.vars = vars; this.userFacing = true; this.status = 400; }
}

// ---- where
export function extensionPaths(core) {
  return { skills: path.join(core, 'skills'), mcp: path.join(core, 'mcp'), staging: path.join(core, 'preparacion'), live: path.join(core, 'skills', LIVE_DIR),
    quarantine: path.join(core, 'datos', QUARANTINE) };
}

// ---- servers: how one starts (moved here from src/engine/mcp-folder.mjs; «Ordenar carpetas» needs it without the engine)
const NODE_FILES = ['src/server.js', 'src/index.js', 'server.js', 'index.js', 'dist/index.js', 'build/index.js', 'src/server.mjs', 'server.mjs', 'index.mjs'];

const PY_FILES = ['server.py', 'main.py', 'src/server.py', 'src/main.py'];

// How to start the server in `dir`: { command, args } or null when it cannot be told.
export function startCommand(dir) {
  // A file inside `dir` (package.json may point anywhere: outside the server's folder is not its server).
  const has = (rel) => { const f = path.resolve(dir, rel); const r = path.relative(dir, f); try { return Boolean(r) && !r.startsWith('..') && !path.isAbsolute(r) && fs.statSync(f).isFile(); } catch { return false; } };
  let pkg = null; try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { /* not node */ }
  if (pkg) {
    const bin = typeof pkg.bin === 'string' ? pkg.bin : Object.values(pkg.bin ?? {})[0];
    for (const rel of [bin, pkg.main].filter((x) => typeof x === 'string')) if (has(rel)) return { command: 'node', args: [path.resolve(dir, rel)] };
  }
  for (const rel of NODE_FILES) if (has(rel)) return { command: 'node', args: [path.join(dir, rel)] };
  for (const rel of PY_FILES) if (has(rel)) return { command: process.platform === 'win32' ? 'python' : 'python3', args: [path.join(dir, rel)] };
  return null;
}

// A folder that is an MCP server: its package.json or pyproject (or requirements.txt) names the MCP SDK. A name
// with «mcp» in it is not enough («Mover a core» is offered only to real servers).
export function isMcpProject(dir) {
  const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
  let pkg = null; try { pkg = JSON.parse(read('package.json')); } catch { /* not node */ }
  if (pkg && Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((d) => /modelcontextprotocol|(^|[-/])mcp([-/]|$)/i.test(d))) return true;
  return /(^|["'\s])(mcp|fastmcp)([[<>=~"'\s,]|$)/im.test(read('pyproject.toml') + read('requirements.txt'));
}

// What a server says it does: package.json, pyproject or the first line of its README.
export function mcpDescription(dir) {
  try { const d = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).description; if (typeof d === 'string' && d.trim()) return d.trim().slice(0, 300); } catch { /* not node */ }
  try { const m = /^\s*description\s*=\s*["'](.+?)["']/m.exec(fs.readFileSync(path.join(dir, 'pyproject.toml'), 'utf8')); if (m) return m[1].slice(0, 300); } catch { /* not python */ }
  for (const f of ['README.md', 'readme.md', 'LEEME.md']) {
    try { const line = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#') && !l.startsWith('![') && !l.startsWith('<')); if (line) return line.slice(0, 300); } catch { /* none */ }
  }
  return '';
}

// ---- skills: what SKILL.md says (its frontmatter: name and description; a value may go on over the next lines).
export const FRONTMATTER = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;

export function skillMeta(dir) {
  let text; try { text = fs.readFileSync(path.join(dir, SKILL_FILE), 'utf8'); } catch { return null; }
  const m = FRONTMATTER.exec(text);
  const fm = {};
  if (m) {
    let key = null;
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      if (kv) { key = kv[1]; const v = kv[2].trim(); fm[key] = /^[>|][-+]?$/.test(v) ? '' : v.replace(/^(["'])([\s\S]*)\1$/, '$2'); continue; }
      if (key && /^\s+\S/.test(line)) fm[key] = `${fm[key]} ${line.trim()}`.trim();
    }
  }
  return { name: typeof fm.name === 'string' && fm.name ? fm.name : null, description: String(fm.description ?? '').replace(/\s+/g, ' ').trim() };
}

// ---- dependencies: installed by Orb only when a server is turned on, never running a package's scripts
export const MANIFESTS = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json'];

// A node server whose package.json names dependencies that are not there.
export function needsDeps(dir) {
  let pkg = null; try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { return false; }
  return Boolean(Object.keys(pkg?.dependencies ?? {}).length) && !isDir(path.join(dir, 'node_modules'));
}

// A dependency taken from a folder of the PC instead of the registry (file:, link:, workspace:, portal:, a git repository
// of a local folder, or a path): npm makes it a link to that folder (install-links=false, npm's default), so the server
// in core would load code from a folder agents still write.
const LOCAL_SPEC = /^\s*(file|link|workspace|portal|git\+file):|^\s*(\.{1,2}([\\/]|$)|[\\/]|~[\\/]|[a-z]:)/i;

// The first local dependency a server names (package.json: its dependency lists, overrides and workspaces; the lock: a
// package that is a link or comes from a file), or null.
export function localDep(dir) {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } };
  const pkg = read('package.json');
  if (pkg && typeof pkg === 'object') {
    if (pkg.workspaces) return 'workspaces';
    for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies', 'bundleDependencies', 'bundledDependencies']) {
      for (const [name, spec] of Object.entries(pkg[key] && typeof pkg[key] === 'object' && !Array.isArray(pkg[key]) ? pkg[key] : {})) if (typeof spec === 'string' && LOCAL_SPEC.test(spec)) return `${name}: ${spec}`;
    }
    const overrides = (o, at) => { for (const [k, v] of Object.entries(o ?? {})) { if (typeof v === 'string' && LOCAL_SPEC.test(v)) return `${at}${k}: ${v}`; if (v && typeof v === 'object') { const r = overrides(v, `${at}${k} › `); if (r) return r; } } return null; };
    const o = typeof pkg.overrides === 'object' ? overrides(pkg.overrides, 'overrides › ') : null;
    if (o) return o;
  }
  for (const f of ['package-lock.json', 'npm-shrinkwrap.json']) {
    const lock = read(f);
    for (const [at, p] of Object.entries(lock?.packages ?? {})) {
      if (!p || typeof p !== 'object') continue;
      if (p.link || (typeof p.resolved === 'string' && LOCAL_SPEC.test(p.resolved)) || (at && !/^(.*\/)?node_modules\//.test(at))) return `${f}: ${at || '.'}`;
    }
    for (const [name, p] of Object.entries(lock?.dependencies ?? {})) if (typeof p?.version === 'string' && LOCAL_SPEC.test(p.version)) return `${f}: ${name}`;
  }
  return null;
}

// The first link (a symbolic link or a junction) anywhere in a folder, node_modules too, that leads out of it (or
// nowhere): its relative path, or null. Read from the directory entries (no stat per file), so a big node_modules is quick.
export function linkOut(dir) {
  let root; try { root = norm(fs.realpathSync.native(dir)); } catch { return null; }
  const walk = (d, rel) => {
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return null; }
    for (const e of list) {
      const full = path.join(d, e.name); const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) {
        let real = null; try { real = norm(fs.realpathSync.native(full)); } catch { real = null; }
        if (!real || (real !== root && !real.startsWith(root + path.sep))) return r;
        continue;
      }
      if (e.isDirectory()) { const found = walk(full, r); if (found) return found; }
    }
    return null;
  };
  return isLink(dir) ? '.' : walk(dir, '');
}

// A program run without blocking the engine. → { status, stderr }
export function runProcess(command, args, { cwd, timeout = 120_000, env = process.env } = {}) {
  return new Promise((resolve) => {
    let child; let stderr = '';
    try { child = spawn(command, args, { cwd, env, windowsHide: true, shell: process.platform === 'win32' && /\.cmd$/i.test(command), stdio: ['ignore', 'ignore', 'pipe'] }); } catch (error) { resolve({ status: -1, stderr: error.message }); return; }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, timeout);
    child.stderr.setEncoding('utf8'); child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    child.on('error', (error) => { clearTimeout(timer); resolve({ status: -1, stderr: error.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ status: code ?? -1, stderr }); });
  });
}

// npm install in `dir`: no scripts of the package or of its dependencies (--ignore-scripts), and the folder's own npm and
// yarn settings set aside first (renamed: they may name programs npm runs). No local dependency (localDep: refused
// before), packages copied, never linked (--install-links), no workspaces, nothing written but node_modules (--no-save);
// and after it, no link that leads out of the folder (else its node_modules goes and it is refused). → true when it
// installed something.
export async function installDeps(dir, { tr = null, run = runProcess } = {}) {
  if (!needsDeps(dir)) return false;
  const local = localDep(dir);
  if (local) throw new ExtensionError('ext.err.localDep', { dep: local }, tr);
  for (const f of fs.readdirSync(dir)) if (TOOL_CONFIG.test(f)) fs.renameSync(path.join(dir, f), path.join(dir, `${f}.ignorado-por-orb`));
  const win = process.platform === 'win32';
  const env = { ...process.env, npm_config_ignore_scripts: 'true', npm_config_install_links: 'true', npm_config_workspaces: 'false' };
  const r = await run(win ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--ignore-scripts', '--install-links=true', '--no-workspaces', '--no-save', '--no-audit', '--no-fund'], { cwd: dir, timeout: 300_000, env });
  if (r.status !== 0) throw new ExtensionError('ext.err.install', { error: String(r.stderr || '').trim().split('\n').slice(-1)[0] || 'npm' }, tr);
  const out = linkOut(dir);
  if (out) { fs.rmSync(path.join(dir, 'node_modules'), { recursive: true, force: true }); throw new ExtensionError('ext.err.link', { file: out }, tr); }
  return true;
}

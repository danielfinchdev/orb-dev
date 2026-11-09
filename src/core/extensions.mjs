// 3.8.1: skills and MCP servers live in core (the owner's definition: core\skills holds every skill, core\mcp every MCP
// server, the ones Orb installs and the ones the user writes). No engine imports: the engine, the agents' MCP server
// (src/mcp/server.mjs), «Ordenar carpetas» (core-folder.mjs) and the tests use it.
//   - What is there: listExtensions (Ajustes › Skills y MCP): each skill (its SKILL.md: name, description) and each server
//     folder (the command that starts it), with where it came from and whether it is on. orb.json keeps the state:
//     `skills` ([{ name, enabled, source }]) and `mcpServers` (the connectors, as before, with `source`). A folder with no
//     entry is off.
//   - How agents get the skills on (exposeSkills): core\skills\.activas is a Claude Code plugin made by Orb
//     (.claude-plugin\plugin.json + skills\<name>, a copy of core\skills\<name> for each skill that is on, never a junction,
//     its SKILL.md with a frontmatter Orb writes: only name and description). Claude gets it as a plugin (SDK `plugins`), Codex as an extra root of skills (app-server
//     `skills/extraRoots/set`); the other agents get the list (name, description, path of its SKILL.md) in their brief.
//     Agents read core\skills (src/core/guard.mjs); nobody but Orb writes there.
//   - Bringing one in (importExtension): from a folder (copied) or a git repository (cloned, https only), checked
//     (checkSkill / checkMcp: SKILL.md with a valid name and description, or a server Orb knows how to start; no links
//     out, a size limit), always off until the user turns it on.
//   - Made by an agent (requests): orb_create_skill / orb_create_mcp give it a folder in core\preparacion (the only part of
//     core agents may write), it writes the files there and asks for it to be turned on (orb_request_activation): Orb
//     copies it then into a quarantine agents cannot write (core\datos\cuarentena\<id>), file by file, never following a
//     link, without dependencies, caches or the package managers' settings; the fingerprint and the list the user sees are
//     made from that copy, and «Activar» moves exactly that copy into core (its dependencies installed by Orb, with no
//     install scripts) and turns it on.
//   - Nothing runs while it comes in: no install scripts, no git hooks, no package manager settings of the folder.
//     Dependencies are installed only when the user turns a server on (npm with --ignore-scripts).
//   - Improving a server of core: editInProject copies it to a project folder (work there with any agent), applyEdit
//     puts it back (the version before stays in core\mcp\.anterior\<name>; a skill replaced by an agent's request, in
//     core\skills\.anterior\<name>).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { CATEGORIES } from '../shared/layout.mjs';

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
const LIMITS = { skill: { bytes: 20 * 1024 * 1024, files: 2000 }, mcp: { bytes: 200 * 1024 * 1024, files: 5000 } };
// Never copied into core (nor counted, listed or fingerprinted): dependencies, git and caches (Orb installs the
// dependencies itself when a server is turned on) and the package managers' settings of the folder (they may name
// programs npm or yarn run: script-shell, git, node-options…).
export const DEP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', '.cache']);
const TOOL_CONFIG = /^(\.npmrc|\.yarnrc(\.ya?ml)?|\.yarn|\.pnpmfile\.c?js|pnpm-workspace\.ya?ml|\.pnpmrc)$/i;
const SKIP = (name) => DEP_DIRS.has(name) || TOOL_CONFIG.test(name);
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
const secretName = (name, rel, isDirectory) => (isDirectory
  ? SECRET_DIR.test(name) || (SESSION_DIR.test(name) && !CODE_DIR.test(rel))
  : SECRET_FILE.test(name) || SECRET_FILE.test(name.replace(BACKUP, '')));

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const norm = (p) => path.resolve(p).toLowerCase();
// Where a path really is (links and junctions followed; a part not made yet: its nearest existing parent counts).
const realOf = (p) => {
  let at = path.resolve(p); const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(at), ...rest.reverse()); } catch { /* not there: its parent */ }
    const up = path.dirname(at); if (up === at) return path.resolve(p);
    rest.push(path.basename(at)); at = up;
  }
};
const realInside = (root, p) => { const r = norm(realOf(root)); const t = norm(realOf(p)); return t === r || t.startsWith(r + path.sep); };
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
// A folder that is an MCP server: its package.json or pyproject (or requirements.txt) names the MCP SDK. 3.8.1 (review
// H1c B13): a name with «mcp» in it is not enough («Mover a core» is offered only to real servers).
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
const FRONTMATTER = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;
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

// ---- checks
// Every entry of a folder, walked without ever following a link: { files: [{ rel, full, size }], dirs, bytes, link }
// (link: the first symlink, junction or hard link found; '.' when the folder itself is one). skip(name, rel, isDir):
// what is left out and not looked into (by default dependencies, git, caches and the package managers' settings).
function walkTree(dir, { skip = SKIP } = {}) {
  const out = { files: [], dirs: [], bytes: 0, link: null };
  if (isLink(dir)) { out.link = '.'; return out; }
  const walk = (d, rel) => {
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const full = path.join(d, e.name); const r = rel ? `${rel}/${e.name}` : e.name;
      let st; try { st = fs.lstatSync(full); } catch { continue; }
      if (skip?.(e.name, r, st.isDirectory())) continue;
      if (st.isSymbolicLink()) { out.link ??= r; continue; }
      if (st.isDirectory()) { out.dirs.push(r); walk(full, r); continue; }
      if (!st.isFile()) continue;
      if (st.nlink > 1) out.link ??= r; // a hard link: the same file under another name somewhere else
      out.files.push({ rel: r, full, size: st.size }); out.bytes += st.size;
    }
  };
  walk(dir, '');
  return out;
}
// How many files, how big, and the first link (what moves into core: dependencies and the like aside).
export function scanTree(dir) {
  const t = walkTree(dir);
  return { files: t.files.length, bytes: t.bytes, link: t.link };
}
function checkTree(dir, kind, tr) {
  const t = scanTree(dir);
  if (t.link) throw new ExtensionError('ext.err.link', { file: t.link }, tr);
  const lim = LIMITS[kind];
  if (t.files > lim.files || t.bytes > lim.bytes) throw new ExtensionError('ext.err.tooBig', { mb: Math.round(lim.bytes / 1048576), files: lim.files }, tr);
  return t;
}
// A copy that never follows a link: each entry is looked at (lstat) and copied right then. A file is opened and checked
// to be that same file (its id, from the open handle: a folder above swapped for a junction meanwhile is caught), and
// copied from that handle, its main content only (NTFS alternate data streams, which no list or fingerprint sees, stay
// behind). links: 'refuse' (throw, the default) or 'skip'. kind: the size limit of a skill or a server ('mcp' by
// default; null: none). → { files, bytes }
export function copyTree(src, dest, { kind = 'mcp', skip = SKIP, links = 'refuse', tr = null } = {}) {
  if (isLink(src)) throw new ExtensionError('ext.err.link', { file: path.basename(src) }, tr);
  const root = norm(fs.realpathSync.native(src));
  const lim = LIMITS[kind] ?? { bytes: Infinity, files: Infinity };
  let files = 0; let bytes = 0;
  const refuse = (rel) => { throw new ExtensionError('ext.err.link', { file: rel }, tr); };
  const walk = (from, to, rel) => {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      const full = path.join(from, e.name); const r = rel ? `${rel}/${e.name}` : e.name;
      let st; try { st = fs.lstatSync(full, { bigint: true }); } catch { continue; }
      if (skip?.(e.name, r, st.isDirectory())) continue;
      if (st.isSymbolicLink()) { if (links === 'refuse') refuse(r); continue; }
      if (st.isDirectory()) { walk(full, path.join(to, e.name), r); continue; }
      if (!st.isFile()) continue;
      if (st.nlink > 1n && links === 'refuse') refuse(r);
      if (++files > lim.files || (bytes += Number(st.size)) > lim.bytes) throw new ExtensionError('ext.err.tooBig', { mb: Math.round(lim.bytes / 1048576), files: lim.files }, tr);
      const real = norm(fs.realpathSync.native(full));
      if (!real.startsWith(root + path.sep)) refuse(r);
      const fd = fs.openSync(full, 'r');
      try {
        const open = fs.fstatSync(fd, { bigint: true });
        if (!open.isFile() || open.ino !== st.ino || open.dev !== st.dev) refuse(r);
        fs.writeFileSync(path.join(to, e.name), fs.readFileSync(fd), { flag: 'wx' });
      } finally { fs.closeSync(fd); }
    }
  };
  try { walk(src, dest, ''); } catch (error) { fs.rmSync(dest, { recursive: true, force: true }); throw error; }
  return { files, bytes };
}
// What a skill's SKILL.md asks of Claude Code beyond its text: tools it may use without asking (allowed-tools), hooks,
// or commands run when it loads (!`…`). Only for the list (the row warns): Claude never gets these, whatever the YAML
// says (exposeSkills gives it a SKILL.md whose frontmatter Orb writes); the commands are off anyway
// (src/agents/claude.mjs › disableSkillShellExecution) and so are hooks (disableAllHooks). Any spelling counts (a quoted
// key, a merge key, an explicit key): the frontmatter's text is searched, not parsed.
export function skillAsks(dir) {
  let text; try { text = fs.readFileSync(path.join(dir, SKILL_FILE), 'utf8'); } catch { return null; }
  const m = FRONTMATTER.exec(text);
  const fm = m ? m[1] : '';
  const body = m ? text.slice(m[0].length) : text;
  const asks = { tools: /allowed[-_\s]?tools/i.test(fm), hooks: /\bhooks\b/i.test(fm), commands: /!`[^`\n]+`/.test(body) };
  return asks.tools || asks.hooks || asks.commands ? asks : null;
}
// The SKILL.md Claude gets: a frontmatter written by Orb with only the name and the description (JSON strings, which YAML
// reads as they are), then the skill's text as it is. Nothing of the original frontmatter reaches Claude: a key Orb's
// reading misses (allowed-tools in quotes or through a YAML merge key, checked with the real Claude Code) cannot either.
export function orbSkillText(text, { name, description }) {
  const m = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  const body = m ? text.slice(m[0].length) : String(text).replace(/^\uFEFF/, '');
  const clean = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, ' ').trim();
  return `---\nname: ${JSON.stringify(clean(name))}\ndescription: ${JSON.stringify(clean(description))}\n---\n${body}`;
}
// A skill: SKILL.md with a valid name (the one given, or its folder's) and a description. → { name, description }
export function checkSkill(dir, { name = null, tr = null } = {}) {
  if (isLink(dir)) throw new ExtensionError('ext.err.link', { file: path.basename(dir) }, tr);
  const meta = skillMeta(dir);
  if (!meta) throw new ExtensionError('ext.err.noSkillFile', {}, tr);
  const n = meta.name ?? name ?? path.basename(dir);
  if (!SKILL_NAME.test(n)) throw new ExtensionError('ext.err.skillName', { name: n }, tr);
  if (name && n !== name) throw new ExtensionError('ext.err.skillNameDiffers', { name: n, folder: name }, tr);
  if (!meta.description) throw new ExtensionError('ext.err.noDescription', {}, tr);
  checkTree(dir, 'skill', tr);
  return { name: n, description: meta.description.slice(0, 1024) };
}
// A server: something Orb knows how to start. → { command, args, description }
export function checkMcp(dir, { tr = null } = {}) {
  if (isLink(dir)) throw new ExtensionError('ext.err.link', { file: path.basename(dir) }, tr);
  const start = startCommand(dir);
  if (!start) throw new ExtensionError('ext.err.noStart', {}, tr);
  const local = localDep(dir);
  if (local) throw new ExtensionError('ext.err.localDep', { dep: local }, tr);
  checkTree(dir, 'mcp', tr);
  return { ...start, description: mcpDescription(dir) };
}
// What a folder is: 'skill' (SKILL.md at its top), 'mcp' (a server Orb can start) or null.
export const kindOf = (dir) => (isFile(path.join(dir, SKILL_FILE)) ? 'skill' : startCommand(dir) ? 'mcp' : null);
// A folder name turned into a server's name (lowercase, letters, digits, - and _; 40 at most).
export const mcpNameOf = (raw) => String(raw ?? '').toLowerCase().replace(/\.git$/, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'servidor';

// A fingerprint of everything that moves into core: one line per folder and per file (its kind, relative path, size and
// sha256), in one fixed order, so no change of the files can give the same fingerprint. A link anywhere: refused.
export function fingerprint(dir) {
  const t = walkTree(dir);
  if (t.link) throw new ExtensionError('ext.err.link', { file: t.link });
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const rows = [...t.dirs.map((rel) => ['D', rel]), ...t.files.map((f) => ['F', f.rel, f.size, sha(f.full)])].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0] < b[0] ? -1 : 1));
  const h = crypto.createHash('sha256');
  for (const row of rows) h.update(`${JSON.stringify(row)}\n`);
  return h.digest('hex');
}
// Every file that moves into core, relative and sorted (the card shows them all).
export const fileList = (dir) => walkTree(dir).files.map((f) => f.rel).sort();

// ---- secrets (H5): what never leaves core
// The patterns a server declares (package.json › orb.secrets, .orb-secrets), as tests on a relative path.
function declaredSecrets(dirs) {
  const pats = [];
  for (const dir of dirs.filter(Boolean)) {
    try { const s = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))?.orb?.secrets; if (Array.isArray(s)) pats.push(...s); } catch { /* none */ }
    try { pats.push(...fs.readFileSync(path.join(dir, '.orb-secrets'), 'utf8').split(/\r?\n/)); } catch { /* none */ }
  }
  return pats.map((p) => String(p ?? '').trim().replace(/\\/g, '/')).filter((p) => p && !p.startsWith('#')).slice(0, 200).map((p) => {
    const re = new RegExp(`^${p.replace(/^\/+|\/+$/g, '').replace(/[.+^${}()|[\]]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*')}$`, 'i');
    return p.replace(/\/+$/, '').includes('/') ? (rel) => re.test(rel) : (rel) => re.test(rel.split('/').pop());
  });
}
// A test for what is a secret in these folders, by its name or what the server declares: (name, rel, isDir) → true.
export function secretTest(...dirs) {
  const declared = declaredSecrets(dirs);
  return (name, rel, isDirectory) => secretName(name, rel, isDirectory) || declared.some((t) => t(rel));
}
// What a folder's .gitignore files leave out of git (and its .git\info\exclude), read by Orb: git is never run there (its
// settings could start a program). → (rel, isDir) → true when ignored. Each .gitignore counts for its folder and below,
// the last pattern that matches wins (a later «!» brings a path back), and an ignored folder is left out whole.
export function gitignored(dir) {
  const cache = new Map();
  const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const compile = (line) => {
    let re = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '*' && line[i + 1] === '*' && (i === 0 || line[i - 1] === '/') && (i + 2 === line.length || line[i + 2] === '/')) {
        if (i + 2 === line.length) re += '.*'; else { re += '(?:.*/)?'; i += 2; continue; }
        i++; continue;
      }
      if (c === '*') re += '[^/]*';
      else if (c === '?') re += '[^/]';
      else if (c === '[' && line.indexOf(']', i + 2) > 0) { const end = line.indexOf(']', i + 2); re += `[${line.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`; i = end; }
      else if (c === '\\' && i + 1 < line.length) re += esc(line[++i]);
      else re += esc(c);
    }
    try { return new RegExp(`^${re}$`, 'i'); } catch { return null; }
  };
  const rulesOf = (sub) => {
    if (cache.has(sub)) return cache.get(sub);
    const files = [path.join(dir, ...sub.split('/').filter(Boolean), '.gitignore')];
    if (!sub) files.unshift(path.join(dir, '.git', 'info', 'exclude'));
    const rules = [];
    for (const f of files) {
      let text = ''; try { if (!isLink(f)) text = fs.readFileSync(f, 'utf8'); } catch { continue; }
      for (let line of text.split(/\r?\n/).slice(0, 2000)) {
        line = line.replace(/(?<!\\)\s+$/, '');
        if (!line || line.startsWith('#')) continue;
        const negate = line.startsWith('!'); if (negate) line = line.slice(1);
        line = line.replace(/^\\(?=[#!])/, '');
        const dirOnly = line.endsWith('/'); line = line.replace(/\/+$/, '');
        const anchored = line.includes('/'); line = line.replace(/^\/+/, '');
        const test = line ? compile(line) : null;
        if (test) rules.push({ test, negate, dirOnly, anchored });
      }
    }
    cache.set(sub, rules);
    return rules;
  };
  return (rel, isDirectory) => {
    const parts = String(rel).split('/'); let ignored = false;
    for (let depth = 0; depth < parts.length; depth++) {
      const inside = parts.slice(depth).join('/');
      for (const r of rulesOf(parts.slice(0, depth).join('/'))) {
        if (r.dirOnly && !isDirectory) continue;
        if (r.anchored ? r.test.test(inside) : r.test.test(parts[parts.length - 1])) ignored = !r.negate;
      }
    }
    return ignored;
  };
}
// Build output: left out of git, but no secret (copied out, not counted, never carried over a new version's own).
const BUILD_OUT = /^(dist|build|out|coverage|\.next|\.nuxt|\.turbo|\.parcel-cache|target|\.nyc_output)$/i;
// What never goes out of core in a copy («mejorar», «Editar en un proyecto»): the secrets and what the server's
// .gitignore leaves out of git (a private log, a list of accounts, a session…), its dependencies and build output aside.
export function privateTest(...dirs) {
  const secret = secretTest(...dirs); const ignored = dirs.filter(Boolean).map(gitignored);
  return (name, rel, isDirectory) => secret(name, rel, isDirectory) || (!DEP_DIRS.has(name) && !BUILD_OUT.test(name) && ignored.some((t) => t(rel, isDirectory)));
}
// Whether a server of core holds keys: its connector has some (in the vault), or its folder has secret or git-ignored
// files (when unsure, the user is asked).
export function holdsKeys(core, config, name) {
  const dir = path.join(extensionPaths(core).mcp, String(name));
  const entry = (config?.mcpServers ?? []).find((s) => (s.args ?? []).some((a) => typeof a === 'string' && path.isAbsolute(a) && norm(a).startsWith(norm(dir) + path.sep)));
  if (Object.keys(entry?.env ?? {}).length) return true;
  const hidden = privateTest(dir); let found = false;
  walkTree(dir, { skip: (n, rel, d) => { if (found || DEP_DIRS.has(n)) return true; if (hidden(n, rel, d)) { found = true; return true; } return false; } });
  return found;
}
// What the version in core keeps into the new one: its secrets ALWAYS, over whatever the new one has with that path (an
// agent cannot swap the server's account); what core's .gitignore leaves out (not build output) only where the new one
// has nothing.
function carrySecrets(from, to) {
  if (!isDir(from)) return;
  const secret = secretTest(from); const ignored = gitignored(from);
  walkTree(from, { skip: (n, rel, d) => {
    if (DEP_DIRS.has(n) || TOOL_CONFIG.test(n)) return true;
    const isSecret = secret(n, rel, d);
    if (!isSecret && (BUILD_OUT.test(n) || !ignored(rel, d))) return false;
    const src = path.join(from, ...rel.split('/')); const dest = path.join(to, ...rel.split('/'));
    if (isLink(src)) return true;
    if (isSecret) fs.rmSync(dest, { recursive: true, force: true });
    else if (exists(dest)) return true;
    if (d) copyTree(src, dest, { kind: null, skip: null, links: 'skip' });
    else { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); }
    return true;
  } });
}
// A git setting file copied out of core (.git\config): the remotes without user or token in their address, and no
// credential settings or extra HTTP headers (a token may sit in any of them).
export function cleanGitConfig(text) {
  const out = []; let drop = false;
  for (const line of String(text).split(/\r?\n/)) {
    const section = /^\s*\[\s*([^\]\s"]+)/.exec(line);
    if (section) drop = /^credential$/i.test(section[1]);
    if (drop) continue;
    if (/^\s*(extraheader|password|token|helper|sslkey|sslcertpasswordprotected)\s*=/i.test(line)) continue;
    out.push(line.replace(/(\b[a-z][\w+.-]*:\/\/)[^/@\s]+@/gi, '$1'));
  }
  return out.join('\n');
}

// ---- dependencies: installed by Orb only when a server is turned on, never running a package's scripts
const MANIFESTS = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json'];
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

// The dependencies of a new version: the ones of core when its package.json and lock did not change (no download), else
// installed now (in the quarantine, before it moves). → 'reuse', 'installed' or null
async function prepareDeps(current, next, { tr, install }) {
  if (!fs.existsSync(path.join(next, 'package.json'))) return null;
  const same = (f) => { try { return fs.readFileSync(path.join(current, f)).equals(fs.readFileSync(path.join(next, f))); } catch { return !exists(path.join(current, f)) && !exists(path.join(next, f)); } };
  if (isDir(path.join(current, 'node_modules')) && !isLink(path.join(current, 'node_modules')) && MANIFESTS.every(same)) return 'reuse';
  return (await install(next, { tr })) ? 'installed' : null;
}
// prepareDeps, and then the quarantine's fingerprint once more, right before it moves: installing may take minutes, and
// what moves must still be what the user approved (npm writes nothing but node_modules: --no-save). → as prepareDeps
async function depsThenCheck(current, q, hash, name, { tr, install }) {
  const deps = await prepareDeps(current, q, { tr, install });
  let same = false; try { same = fingerprint(q) === hash; } catch { same = false; }
  if (!same) throw new ExtensionError('ext.err.changed', { name }, tr);
  return deps;
}

// ---- the list (Ajustes › Skills y MCP)
// A folder of core\skills or core\mcp that really is there: not a link or a junction, and inside core.
const realFolder = (root, dir) => isDir(dir) && !isLink(dir) && realInside(root, dir);
// core: the core folder; config: orb.json; projects: the board's projects ({ name, path }); requests / edits: the board's.
// → { dirs, skills, mcp, connectors, projects, pending }
export function listExtensions(core, config = {}, { projects = [], requests = [], edits = {} } = {}) {
  const P = extensionPaths(core);
  const folders = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.')).map((e) => e.name).sort(); } catch { return []; } };
  const state = new Map((config.skills ?? []).map((s) => [s.name, s]));
  const skills = folders(P.skills).map((name) => {
    const dir = path.join(P.skills, name); const ok = realFolder(P.skills, dir); const meta = ok ? skillMeta(dir) : null; const s = state.get(name);
    return { kind: 'skill', name, dir, description: meta?.description ?? '', valid: Boolean(meta?.description), linked: !ok, asks: ok ? skillAsks(dir) : null, source: s?.source ?? 'usuario', enabled: s?.enabled === true };
  });
  const servers = config.mcpServers ?? [];
  const inFolder = (s, dir) => (s.args ?? []).some((a) => typeof a === 'string' && path.isAbsolute(a) && (norm(a) === norm(dir) || norm(a).startsWith(norm(dir) + path.sep)));
  const used = new Set();
  const mcp = folders(P.mcp).map((name) => {
    const dir = path.join(P.mcp, name); const ok = realFolder(P.mcp, dir);
    const entry = servers.find((s) => inFolder(s, dir)) ?? servers.find((s) => s.name === name && !(s.args ?? []).some((a) => path.isAbsolute(String(a))));
    if (entry) used.add(entry.name);
    const start = ok ? startCommand(dir) : null;
    return { kind: 'mcp', name, dir, description: ok ? mcpDescription(dir) : '', command: entry?.command ?? start?.command ?? null, args: entry?.args ?? start?.args ?? [], startable: Boolean(start), linked: !ok,
      needsInstall: ok && needsDeps(dir), connector: entry?.name ?? null, enabled: Boolean(entry) && entry.enabled !== false, source: entry?.source ?? 'usuario', keys: Object.keys(entry?.env ?? {}), agents: entry?.agents ?? [],
      editing: typeof edits?.[name] === 'string' && isDir(edits[name]) ? edits[name] : null };
  });
  // The connectors that are not a folder of core (a package run with npx, a program of the PC).
  const connectors = servers.filter((s) => !used.has(s.name)).map((s) => ({ kind: 'connector', name: s.name, command: s.command, args: s.args ?? [], enabled: s.enabled !== false, keys: Object.keys(s.env ?? {}), agents: s.agents ?? [], source: s.source ?? 'usuario' }));
  // The projects that are MCP servers (the user develops one): they can be used from there or moved into core.
  const fromProjects = (projects ?? []).filter((pr) => typeof pr?.path === 'string' && isDir(pr.path) && isMcpProject(pr.path) && startCommand(pr.path)).map((pr) => {
    const start = startCommand(pr.path);
    const entry = servers.find((s) => inFolder(s, pr.path));
    return { kind: 'project', name: pr.name, dir: pr.path, command: start.command, args: start.args, connector: entry?.name ?? null, editOf: Object.entries(edits ?? {}).find(([, p]) => typeof p === 'string' && norm(p) === norm(pr.path))?.[0] ?? null };
  });
  // What agents made and wait for the user: what the user would bring in is the quarantine's copy (its folder and files).
  const pending = (requests ?? []).filter((r) => r?.status === 'pending' || r?.status === 'asking').map(({ id, kind, name, description, status, quarantine, dir, by, files, total, bytes, asks, deps, update, asked, kept }) => ({
    id, kind, name, description, status, dir: quarantine ?? dir ?? null, by, files: files ?? [], total: total ?? (files ?? []).length, bytes: bytes ?? null, asks: asks ?? null, deps: deps ?? false, update: update ?? null, asked, kept: kept ?? [] }));
  return { dirs: { skills: P.skills, mcp: P.mcp }, skills, mcp, connectors, projects: fromProjects, pending };
}

// ---- turning on and off (→ the patch for orb.json)
export function skillsWith(config, name, patch) {
  const list = (config.skills ?? []).filter((s) => s?.name !== name);
  const prev = (config.skills ?? []).find((s) => s?.name === name) ?? {};
  return [...list, { name, enabled: false, source: 'usuario', ...prev, ...patch }].sort((a, b) => (a.name < b.name ? -1 : 1));
}
// A server of core\mcp turned on or off: its connector (made from the command that starts it, when there is none yet).
// A folder that is a link or reaches outside core, or holds a link that leads out of it (node_modules too), is never
// turned on.
export function mcpWith(config, core, name, enabled, { source } = {}) {
  const dir = path.join(extensionPaths(core).mcp, name);
  if (enabled && (!realFolder(extensionPaths(core).mcp, dir) || linkOut(dir))) return null;
  const servers = config.mcpServers ?? [];
  const i = servers.findIndex((s) => (s.args ?? []).some((a) => typeof a === 'string' && path.isAbsolute(a) && norm(a).startsWith(norm(dir) + path.sep)));
  if (i >= 0) return servers.map((s, j) => (j === i ? { ...s, enabled, ...(source ? { source } : {}) } : s));
  const start = startCommand(dir);
  if (!start) return null;
  if (!MCP_NAME.test(name) || name.toLowerCase() === 'orb') return null;
  return [...servers.filter((s) => s.name !== name), { name, command: start.command, args: start.args, agents: [], enabled, source: source ?? 'usuario' }];
}
// Whether a connector may start: one whose program is in a folder of core\mcp only when that folder really is in core
// (not a link or a junction put there to run something else) and nothing in it (node_modules too) links out of it: a
// dependency installed as a link to a folder agents write would load their code.
export function connectorSafe(core, server) {
  const root = extensionPaths(core).mcp;
  for (const a of server?.args ?? []) {
    if (typeof a !== 'string' || !path.isAbsolute(a)) continue;
    const rel = path.relative(root, a);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const top = path.join(root, rel.split(path.sep)[0]);
    if (!realFolder(root, top) || linkOut(top)) return false;
  }
  return true;
}

// ---- what the agents load (core\skills\.activas)
// The skills that are on, checked as when they came in (a link, a junction or a folder out of core, a wrong name, too
// big: left out). Each one is always a COPY made by Orb (never a junction to its folder): its files as they are, and its
// SKILL.md with a frontmatter Orb writes (orbSkillText: only name and description). A copy is kept while neither the
// skill nor the copy changed (their fingerprints, in .activas\.copias.json); else it is made again.
// → { plugin, root, list: [{ name, description, file }], skipped: [name] } (file: the copy's SKILL.md)
const COPIES = '.copias.json';
export function exposeSkills(core, config = {}) {
  const P = extensionPaths(core);
  const into = path.join(P.live, 'skills');
  fs.mkdirSync(into, { recursive: true });
  const manifest = path.join(P.live, '.claude-plugin', 'plugin.json');
  const want = JSON.stringify({ name: PLUGIN_NAME, description: 'Skills de Orb (core\\skills)', version: '1.0.0' }, null, 2);
  try { if (fs.readFileSync(manifest, 'utf8') !== want) throw new Error('changed'); } catch { fs.mkdirSync(path.dirname(manifest), { recursive: true }); fs.writeFileSync(manifest, want); }
  const on = new Set((config.skills ?? []).filter((s) => s?.enabled === true && SKILL_NAME.test(s.name ?? '')).map((s) => s.name));
  const list = []; const skipped = [];
  for (const name of [...on].sort()) {
    const dir = path.join(P.skills, name);
    let meta = null;
    try { if (!realFolder(P.skills, dir)) throw new Error('link'); meta = checkSkill(dir, { name }); } catch { on.delete(name); if (exists(dir)) skipped.push(name); continue; }
    list.push({ name, description: meta.description, file: path.join(into, name, SKILL_FILE) });
  }
  // What is there and is not a copy of a skill that is on goes (a link: only the link, never what it points to).
  let have = []; try { have = fs.readdirSync(into, { withFileTypes: true }); } catch { have = []; }
  for (const e of have) {
    const at = path.join(into, e.name);
    let st; try { st = fs.lstatSync(at); } catch { continue; }
    if (st.isSymbolicLink()) fs.unlinkSync(at);
    else if (!on.has(e.name) || !st.isDirectory()) fs.rmSync(at, { recursive: true, force: true });
  }
  const marks = path.join(P.live, COPIES);
  let known = {}; try { known = JSON.parse(fs.readFileSync(marks, 'utf8')) ?? {}; } catch { known = {}; }
  const made = {};
  const print = (dir) => { try { return fingerprint(dir); } catch { return null; } };
  for (const s of list) {
    const src = path.join(P.skills, s.name); const at = path.join(into, s.name);
    try {
      const from = fingerprint(src);
      if (known[s.name]?.from === from && exists(at) && print(at) === known[s.name].copy) { made[s.name] = known[s.name]; continue; }
      fs.rmSync(at, { recursive: true, force: true });
      copyTree(src, at, { kind: 'skill' });
      const f = path.join(at, SKILL_FILE);
      fs.writeFileSync(f, orbSkillText(fs.readFileSync(f, 'utf8'), s));
      made[s.name] = { from, copy: fingerprint(at) };
    } catch { skipped.push(s.name); fs.rmSync(at, { recursive: true, force: true }); }
  }
  try { fs.writeFileSync(marks, JSON.stringify(made)); } catch { /* made again next time */ }
  return { plugin: P.live, root: into, list: list.filter((s) => !skipped.includes(s.name)), skipped };
}

// The lines a brief carries for an agent that has no skills of its own (Cursor, the ACP agents).
export function skillsBrief(list) {
  if (!list?.length) return '';
  return `\n## Skills de Orb\nInstrucciones guardadas para tareas concretas. Si una encaja con lo que haces, lee su SKILL.md antes de empezar y síguelo (las rutas que cite son relativas a su carpeta). No las modifiques.\n${list.map((s) => `- ${s.name}: ${s.description.slice(0, 300)} (${s.file})`).join('\n')}\n`;
}

// ---- bringing one into core
// Moves a checked folder (of the quarantine) into core\skills or core\mcp under `name`. replace: what is there goes to
// .anterior\<name> first.
function placeInCore(core, kind, name, from, { replace = false, tr = null } = {}) {
  const P = extensionPaths(core);
  if (isLink(from)) throw new ExtensionError('ext.err.link', { file: path.basename(from) }, tr);
  const to = path.join(kind === 'skill' ? P.skills : P.mcp, name);
  if (exists(to) && !replace) throw new ExtensionError(kind === 'skill' ? 'ext.err.skillExists' : 'ext.err.mcpExists', { name }, tr);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (exists(to)) {
    const old = path.join(kind === 'skill' ? P.skills : P.mcp, OLD_DIR, name);
    fs.rmSync(old, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(old), { recursive: true });
    try { fs.renameSync(to, old); } catch (error) { throw busy(error, name, tr); }
  }
  try { fs.renameSync(from, to); } catch (error) {
    if (error.code !== 'EXDEV') throw busy(error, name, tr);
    copyTree(from, to, { kind, skip: null }); fs.rmSync(from, { recursive: true, force: true });
  }
  return to;
}
const busy = (error, name, tr) => (['EBUSY', 'EPERM', 'EACCES'].includes(error.code) ? new ExtensionError('ext.err.busy', { name }, tr) : error);
// The dependencies of the version before (core\mcp\.anterior\<name>) go on into the new one (prepareDeps said 'reuse').
function reuseDeps(core, name, to) {
  const old = path.join(extensionPaths(core).mcp, OLD_DIR, name, 'node_modules');
  try { if (isDir(old) && !isLink(old) && !exists(path.join(to, 'node_modules'))) fs.renameSync(old, path.join(to, 'node_modules')); } catch { /* the server says it lacks them when it starts */ }
  // A link in them that leads out of the new folder: they go (the server says it lacks them; turning it on installs).
  if (linkOut(to)) fs.rmSync(path.join(to, 'node_modules'), { recursive: true, force: true });
}
const quarantineFor = (core, id) => path.join(extensionPaths(core).quarantine, `${id}-${crypto.randomBytes(3).toString('hex')}`);
// A quarantine Orb made (inside core\datos\cuarentena, a real folder) with the same files as when it was checked.
function sameQuarantine(core, dir, hash, name, tr) {
  const Q = extensionPaths(core).quarantine;
  let ok = false;
  try { ok = typeof dir === 'string' && realFolder(Q, dir) && fingerprint(dir) === hash; } catch { ok = false; }
  if (!ok) throw new ExtensionError('ext.err.changed', { name }, tr);
}

// Copies a folder or clones a repository into the quarantine (core\datos\cuarentena\importar-…): nothing of it runs (no
// git hooks, no submodules, no links), and it comes without .git, dependencies or package manager settings. → the folder
export async function fetchInto(core, { from = null, url = null, tr = null, run = runProcess } = {}) {
  const P = extensionPaths(core);
  fs.mkdirSync(P.quarantine, { recursive: true });
  const dir = quarantineFor(core, `importar-${stamp()}`);
  if (url) {
    // Only https (or ssh) addresses of a server: never a local path, file://, ext:: or another helper that runs programs.
    const u = String(url).trim();
    if (!/^https:\/\/[^\s/]+\/\S+$/i.test(u) && !/^git@[\w.-]+:[\w./~-]+$/i.test(u) && !/^ssh:\/\/[^\s/]+\/\S+$/i.test(u)) throw new ExtensionError('ext.err.badUrl', {}, tr);
    const clone = `${dir}.clon`; const none = `${dir}.vacia`;
    fs.mkdirSync(none, { recursive: true });
    try {
      const r = await run('git', ['-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never', '-c', `core.hooksPath=${none}`, '-c', 'core.symlinks=false', '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false',
        'clone', '--depth', '1', '--no-recurse-submodules', `--template=${none}`, '--', u, clone],
      { timeout: 180_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_LFS_SKIP_SMUDGE: '1' } });
      if (r.status !== 0) throw new ExtensionError('ext.err.clone', { error: String(r.stderr || '').trim().split('\n').slice(-1)[0] || 'git' }, tr);
      copyTree(clone, dir, { tr });
    } finally { fs.rmSync(clone, { recursive: true, force: true, maxRetries: 3 }); fs.rmSync(none, { recursive: true, force: true }); }
    return dir;
  }
  const src = path.resolve(String(from ?? ''));
  if (!from || !isDir(src)) throw new ExtensionError('ext.err.noFolder', { path: String(from ?? '') }, tr);
  // Inside core (also through a junction), or a folder that holds core: never copied from.
  if (realInside(core, src) || realInside(src, core)) throw new ExtensionError('ext.err.fromCore', {}, tr);
  copyTree(src, dir, { tr });
  return dir;
}

// The whole import: fetched into the quarantine, checked, named, placed in core (off; a server's dependencies are
// installed when it is turned on). → { kind, name, dir, patch } (patch: for orb.json)
export async function importExtension(core, config, { from = null, url = null, tr = null, run = runProcess } = {}) {
  const dir = await fetchInto(core, { from, url, tr, run });
  try {
    const kind = kindOf(dir);
    if (!kind) throw new ExtensionError('ext.err.unknownKind', {}, tr);
    const base = url ? String(url).replace(/[\\/]+$/, '').split(/[\\/:]/).pop() : path.basename(path.resolve(from));
    if (kind === 'skill') {
      const { name } = checkSkill(dir, { tr });
      const to = placeInCore(core, 'skill', name, dir, { tr });
      return { kind, name, dir: to, patch: { skills: skillsWith(config, name, { enabled: false, source: 'importado' }) } };
    }
    checkMcp(dir, { tr });
    const name = mcpNameOf(base);
    if (name === 'orb' || (config.mcpServers ?? []).some((s) => s.name === name)) throw new ExtensionError('ext.err.mcpExists', { name }, tr);
    const to = placeInCore(core, 'mcp', name, dir, { tr });
    const servers = mcpWith(config, core, name, false, { source: 'importado' });
    return { kind, name, dir: to, patch: servers ? { mcpServers: servers } : {} };
  } catch (error) { fs.rmSync(dir, { recursive: true, force: true }); throw error; }
}

// Removing one: its folder leaves core (the caller asked for the master password) and its entry leaves orb.json.
export function removeExtension(core, config, kind, name, { tr = null } = {}) {
  const P = extensionPaths(core);
  const ok = kind === 'skill' ? SKILL_NAME.test(name) : MCP_NAME.test(name);
  const dir = path.join(kind === 'skill' ? P.skills : P.mcp, String(name));
  if (!ok || !exists(dir) || String(name).startsWith('.')) throw new ExtensionError('ext.err.notFound', { name }, tr);
  const drop = () => { try { if (isLink(dir)) fs.unlinkSync(dir); else fs.rmSync(dir, { recursive: true }); } catch (error) { throw busy(error, name, tr); } };
  if (kind === 'skill') {
    const live = path.join(P.live, 'skills', name);
    try { if (fs.lstatSync(live).isSymbolicLink()) fs.unlinkSync(live); else fs.rmSync(live, { recursive: true, force: true }); } catch { /* not on */ }
    drop();
    return { skills: (config.skills ?? []).filter((s) => s.name !== name) };
  }
  drop();
  return { mcpServers: (config.mcpServers ?? []).filter((s) => !(s.args ?? []).some((a) => typeof a === 'string' && path.isAbsolute(a) && norm(a).startsWith(norm(dir) + path.sep))) };
}

// ---- made by an agent (core\preparacion)
const SKILL_TEMPLATE = (name, description) => `---\nname: ${name}\ndescription: ${description.replace(/\s+/g, ' ')}\n---\n\n# ${name}\n\n<!-- Instrucciones para el agente: cuándo usar esta skill y qué pasos seguir. Archivos de apoyo (scripts/, plantillas/…) junto a este, con rutas relativas. -->\n`;
const MCP_NODE = (name, description) => ({
  'package.json': `${JSON.stringify({ name, version: '0.1.0', description, type: 'module', main: 'server.mjs', dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' } }, null, 2)}\n`,
  'server.mjs': `// ${description}\nimport { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';\nimport { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';\n\nconst server = new McpServer({ name: '${name}', version: '0.1.0' });\n// server.tool('nombre', 'qué hace', { /* parámetros (zod) */ }, async (args) => ({ content: [{ type: 'text', text: '…' }] }));\nawait server.connect(new StdioServerTransport());\n`
});
const MCP_PY = (name, description) => ({
  'pyproject.toml': `[project]\nname = "${name}"\nversion = "0.1.0"\ndescription = "${description.replace(/"/g, "'")}"\ndependencies = ["mcp"]\n`,
  'server.py': `# ${description}\nfrom mcp.server.fastmcp import FastMCP\n\nmcp = FastMCP("${name}")\n\n# @mcp.tool()\n# def nombre(parametro: str) -> str:\n#     """Qué hace."""\n\nif __name__ == "__main__":\n    mcp.run()\n`
});
// The copy an agent starts from when it improves one of core: its code only (no secrets, nothing its .gitignore leaves
// out of git, no dependencies, git or links).
function draftCopy(core, request) {
  const P = extensionPaths(core);
  const current = path.join(request.kind === 'skill' ? P.skills : P.mcp, request.name);
  if (!realFolder(request.kind === 'skill' ? P.skills : P.mcp, current)) throw new ExtensionError('ext.err.notFound', { name: request.name });
  const hidden = privateTest(current);
  copyTree(current, request.dir, { kind: request.kind, skip: (n, rel, d) => SKIP(n) || hidden(n, rel, d), links: 'skip' });
}
// A new request: its folder (a copy of the current version when it improves one of core), with a starting point. A
// server that holds keys (holdsKeys) is not copied until the user allows it: the request waits ('asking').
// → the request ({ id, kind, name, description, dir, by, status: 'drafting' | 'asking', update })
export function draftExtension(core, { kind, name, description, language = 'node', update = null, by = {}, config = {}, tr = null } = {}) {
  const P = extensionPaths(core);
  if (!['skill', 'mcp'].includes(kind)) throw new ExtensionError('ext.err.unknownKind', {}, tr);
  const n = String(name ?? '').trim();
  if (!(kind === 'skill' ? SKILL_NAME : MCP_NAME).test(n) || n.toLowerCase() === 'orb') throw new ExtensionError(kind === 'skill' ? 'ext.err.skillName' : 'ext.err.mcpName', { name: n }, tr);
  const desc = String(description ?? '').replace(/\s+/g, ' ').trim().slice(0, 1024);
  if (!desc) throw new ExtensionError('ext.err.noDescription', {}, tr);
  const current = path.join(kind === 'skill' ? P.skills : P.mcp, n);
  if (update && !isDir(current)) throw new ExtensionError('ext.err.notFound', { name: n }, tr);
  if (!update && exists(current)) throw new ExtensionError(kind === 'skill' ? 'ext.err.skillExists' : 'ext.err.mcpExists', { name: n }, tr);
  const id = `${kind}-${n}-${crypto.randomBytes(3).toString('hex')}`;
  const dir = path.join(P.staging, id);
  const request = { id, kind, name: n, description: desc, dir, by, status: 'drafting', update: update ? n : null, created: new Date().toISOString() };
  if (update && kind === 'mcp' && holdsKeys(core, config, n)) return { ...request, status: 'asking' };
  fs.mkdirSync(P.staging, { recursive: true });
  if (update) draftCopy(core, request);
  else {
    fs.mkdirSync(dir, { recursive: true });
    const files = kind === 'skill' ? { [SKILL_FILE]: SKILL_TEMPLATE(n, desc) } : (language === 'python' ? MCP_PY : MCP_NODE)(n, desc);
    for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text);
  }
  return request;
}
// The user allowed an agent to improve a server that holds keys: its copy is made now (without them). → the request
export function allowDraft(core, request, { tr = null } = {}) {
  if (!request || request.status !== 'asking') throw new ExtensionError('ext.err.noRequest', {}, tr);
  fs.mkdirSync(extensionPaths(core).staging, { recursive: true });
  draftCopy(core, request);
  return { ...request, status: 'drafting', allowed: new Date().toISOString() };
}
// The agent asks for it to be turned on: its folder is copied into the quarantine (agents cannot write there; links
// refused anywhere, dependencies and package manager settings left out, the size limit over all of it), checked there,
// and the fingerprint and list of that copy kept: what the user sees and approves is what moves. A new version of a
// server leaves its own secret files out (kept: the dialog says so): the ones of core stay (carrySecrets). → the request
export function requestActivation(core, request, { tr = null } = {}) {
  if (!request || request.status !== 'drafting' || !/^[\w-]+$/.test(String(request.id ?? ''))) throw new ExtensionError('ext.err.noRequest', {}, tr);
  const P = extensionPaths(core);
  const src = request.dir;
  if (typeof src !== 'string' || !isDir(src) || norm(path.dirname(src)) !== norm(P.staging)) throw new ExtensionError('ext.err.notFound', { name: request.name }, tr);
  if (isLink(src)) throw new ExtensionError('ext.err.link', { file: path.basename(src) }, tr);
  if (request.quarantine) fs.rmSync(request.quarantine, { recursive: true, force: true });
  fs.mkdirSync(P.quarantine, { recursive: true });
  const q = quarantineFor(core, request.id);
  const kept = [];
  const secret = request.update && request.kind === 'mcp' ? secretTest(src, path.join(P.mcp, request.name)) : null;
  try {
    copyTree(src, q, { kind: request.kind, tr, skip: (n, rel, d) => SKIP(n) || Boolean(secret?.(n, rel, d) && kept.push(rel)) });
    if (request.kind === 'skill') checkSkill(q, { name: request.name, tr }); else checkMcp(q, { tr });
    const t = walkTree(q);
    return { ...request, status: 'pending', asked: new Date().toISOString(), quarantine: q, hash: fingerprint(q), files: t.files.map((f) => f.rel).sort(), total: t.files.length, bytes: t.bytes,
      asks: request.kind === 'skill' ? skillAsks(q) : null, deps: request.kind === 'mcp' && needsDeps(q), kept: kept.sort() };
  } catch (error) { fs.rmSync(q, { recursive: true, force: true }); throw error; }
}
// The user approved: the quarantine's copy (the same files as when it was asked) goes into core and on; a server's
// dependencies are installed first (no scripts) or kept from the version before. → { to, patch }
export async function activateRequest(core, config, request, { tr = null, install = installDeps } = {}) {
  if (!request || request.status !== 'pending') throw new ExtensionError('ext.err.noRequest', {}, tr);
  sameQuarantine(core, request.quarantine, request.hash, request.name, tr);
  const q = request.quarantine;
  const P = extensionPaths(core);
  const current = path.join(request.kind === 'skill' ? P.skills : P.mcp, request.name);
  let to;
  if (request.kind === 'skill') {
    checkSkill(q, { name: request.name, tr });
    to = placeInCore(core, 'skill', request.name, q, { replace: Boolean(request.update), tr });
  } else {
    checkMcp(q, { tr });
    if (!request.update && (config.mcpServers ?? []).some((s) => s.name === request.name)) throw new ExtensionError('ext.err.mcpExists', { name: request.name }, tr);
    const deps = await depsThenCheck(current, q, request.hash, request.name, { tr, install });
    if (request.update) carrySecrets(current, q);
    to = placeInCore(core, 'mcp', request.name, q, { replace: Boolean(request.update), tr });
    if (deps === 'reuse') reuseDeps(core, request.name, to);
  }
  try { if (typeof request.dir === 'string' && norm(path.dirname(request.dir)) === norm(P.staging)) fs.rmSync(request.dir, { recursive: true, force: true }); } catch { /* left in core\preparacion */ }
  if (request.kind === 'skill') return { to, patch: { skills: skillsWith(config, request.name, { enabled: true, source: request.update ? (config.skills ?? []).find((s) => s.name === request.name)?.source ?? 'creado' : 'creado' }) } };
  return { to, patch: { mcpServers: refreshStart(core, config, request.name, { enabled: true, source: request.update ? null : 'creado' }) ?? config.mcpServers ?? [] } };
}
// 3.8.1 (review H1c B2): at every start, what nothing points to any more goes: folders of core\preparacion and of the
// quarantine that no request names (after an hour: an import or a draft may be on its way), and requests still being
// written or waiting for the user after 30 days (with their folders). → the requests to keep.
export const STALE_DAYS = 30;
export function cleanExtensionLeftovers(core, requests = [], { now = Date.now() } = {}) {
  const P = extensionPaths(core);
  const old = (r) => ['drafting', 'asking'].includes(r?.status) && now - (Date.parse(r.created ?? '') || 0) > STALE_DAYS * 86_400_000;
  const keep = []; const named = new Set();
  for (const r of Array.isArray(requests) ? requests : []) {
    if (old(r)) { discardRequest(core, r); continue; }
    keep.push(r);
    for (const d of [r?.dir, r?.quarantine]) if (typeof d === 'string') named.add(norm(d));
  }
  for (const root of [P.staging, P.quarantine]) {
    let list = []; try { list = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of list) {
      const full = path.join(root, e.name);
      if (named.has(norm(full))) continue;
      let young = false; try { young = now - fs.lstatSync(full).mtimeMs < 3_600_000; } catch { continue; }
      if (young) continue;
      try { fs.rmSync(full, { recursive: true, force: true }); } catch { /* in use: the next start */ }
    }
  }
  return keep;
}
// How many requests one conversation may have open at once (being written, waiting for the user or to be reviewed).
export const OPEN_PER_CONVERSATION = 5;
export const openRequestsOf = (requests, conversation) => (Array.isArray(requests) ? requests : []).filter((r) => conversation != null && r?.by?.conversation === conversation && ['drafting', 'asking', 'pending'].includes(r?.status)).length;
// Discarded: its folder in core\preparacion and its quarantine go.
export function discardRequest(core, request) {
  const P = extensionPaths(core);
  for (const [dir, root] of [[request?.dir, P.staging], [request?.quarantine, P.quarantine]]) {
    try { if (typeof dir === 'string' && norm(path.dirname(dir)) === norm(root)) fs.rmSync(dir, { recursive: true, force: true }); } catch { /* left there */ }
  }
}
// A server of core whose files changed: its connector starts what the folder says now (its keys, agents and name stay).
export function refreshStart(core, config, name, { enabled = null, source = null } = {}) {
  const dir = path.join(extensionPaths(core).mcp, name);
  const start = startCommand(dir);
  if (!start) return null;
  const servers = config.mcpServers ?? [];
  const i = servers.findIndex((s) => s.name === name || (s.args ?? []).some((a) => typeof a === 'string' && path.isAbsolute(a) && norm(a).startsWith(norm(dir) + path.sep)));
  if (i < 0) return mcpWith(config, core, name, enabled ?? false, { source: source ?? 'usuario' });
  return servers.map((s, j) => (j === i ? { ...s, command: start.command, args: start.args, ...(enabled === null ? {} : { enabled }), ...(source ? { source } : {}) } : s));
}
// A server of core turned on that needs its dependencies (the user was told): installed in its folder (no scripts).
export async function installFor(core, name, { tr = null, install = installDeps } = {}) {
  const dir = path.join(extensionPaths(core).mcp, String(name));
  if (!MCP_NAME.test(String(name)) || !realFolder(extensionPaths(core).mcp, dir)) throw new ExtensionError('ext.err.notFound', { name }, tr);
  return install(dir, { tr });
}

// ---- improving a server of core in a project
// Copied to <home>\<category>\<name> (or name-2…), its git history and dependencies too, never its secrets nor what its
// .gitignore leaves out of git (they stay in core and go on into the new version), nor a link; git's settings without
// credentials (cleanGitConfig) and without FETCH_HEAD (the address it fetched from). → the project folder
export function editInProject(home, core, name, category = 'windows', { tr = null } = {}) {
  const from = path.join(extensionPaths(core).mcp, String(name));
  if (!MCP_NAME.test(String(name)) || !realFolder(extensionPaths(core).mcp, from)) throw new ExtensionError('ext.err.notFound', { name }, tr);
  if (!CATEGORIES.includes(category)) throw new ExtensionError('ext.err.notFound', { name: category }, tr);
  let to = path.join(home, category, name);
  for (let i = 2; exists(to); i++) to = path.join(home, category, `${name}-${i}`);
  const hidden = privateTest(from);
  copyTree(from, to, { kind: null, skip: (n, rel, d) => TOOL_CONFIG.test(n) || /^\.git\/(.+\/)?FETCH_HEAD$/i.test(rel) || hidden(n, rel, d), links: 'skip' });
  for (const f of walkTree(path.join(to, '.git'), { skip: null }).files) if (/^config(\.worktree)?$/i.test(path.basename(f.full))) fs.writeFileSync(f.full, cleanGitConfig(fs.readFileSync(f.full, 'utf8')));
  return to;
}
// What «Aplicar cambios» would change: { added, changed, removed } (relative paths; dependencies and secrets aside).
export function compareTrees(a, b, { skip = SKIP } = {}) {
  const files = (root) => new Map(walkTree(root, { skip }).files.map((f) => [f.rel, f.full]));
  const A = files(a); const B = files(b);
  const same = (x, y) => { try { return fs.readFileSync(x).equals(fs.readFileSync(y)); } catch { return false; } };
  return { added: [...B.keys()].filter((k) => !A.has(k)).sort(), changed: [...B.keys()].filter((k) => A.has(k) && !same(A.get(k), B.get(k))).sort(), removed: [...A.keys()].filter((k) => !B.has(k)).sort() };
}
// «Aplicar cambios», step 1: the project's version is copied into the quarantine (as with an agent's request) and
// compared there with core. → { id, quarantine, hash, added, changed, removed }
export function prepareApply(core, name, project, { tr = null } = {}) {
  if (!isDir(project)) throw new ExtensionError('ext.err.noFolder', { path: project }, tr);
  const P = extensionPaths(core);
  const current = path.join(P.mcp, name);
  fs.mkdirSync(P.quarantine, { recursive: true });
  for (const e of fs.readdirSync(P.quarantine)) if (e.startsWith(`aplicar-${name}-`)) fs.rmSync(path.join(P.quarantine, e), { recursive: true, force: true });
  const q = quarantineFor(core, `aplicar-${name}`);
  const secret = secretTest(project, current);
  const skip = (n, rel, d) => SKIP(n) || secret(n, rel, d);
  try {
    copyTree(project, q, { kind: 'mcp', skip, tr });
    checkMcp(q, { tr });
    return { id: path.basename(q), quarantine: q, hash: fingerprint(q), ...compareTrees(current, q, { skip }) };
  } catch (error) { fs.rmSync(q, { recursive: true, force: true }); throw error; }
}
// Step 2 (the user confirmed what step 1 showed): exactly that copy goes into core (its secrets and, when they did not
// change, its dependencies kept); the one before stays in core\mcp\.anterior\<name>. → { to, patch }
export async function applyEdit(core, config, name, prepared, { tr = null, install = installDeps } = {}) {
  sameQuarantine(core, prepared?.quarantine, prepared?.hash, name, tr);
  const q = prepared.quarantine;
  const current = path.join(extensionPaths(core).mcp, name);
  checkMcp(q, { tr });
  const deps = await depsThenCheck(current, q, prepared.hash, name, { tr, install });
  carrySecrets(current, q);
  const to = placeInCore(core, 'mcp', name, q, { replace: true, tr });
  if (deps === 'reuse') reuseDeps(core, name, to);
  return { to, patch: { mcpServers: refreshStart(core, config, name) ?? config.mcpServers ?? [] } };
}

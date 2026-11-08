// 3.8.1: skills and MCP servers live in core (the owner's definition: core\skills holds every skill, core\mcp every MCP
// server, the ones Orb installs and the ones the user writes). No engine imports: the engine, the agents' MCP server
// (src/mcp/server.mjs), «Ordenar carpetas» (core-folder.mjs) and the tests use it.
//   - What is there: listExtensions (Ajustes › Skills y MCP): each skill (its SKILL.md: name, description) and each server
//     folder (the command that starts it), with where it came from and whether it is on. orb.json keeps the state:
//     `skills` ([{ name, enabled, source }]) and `mcpServers` (the connectors, as before, with `source`). A folder with no
//     entry is off.
//   - How agents get the skills on (exposeSkills): core\skills\.activas is a Claude Code plugin made by Orb
//     (.claude-plugin\plugin.json + skills\<name>, a junction to core\skills\<name> for each skill that is on; a copy where
//     junctions cannot be made). Claude gets it as a plugin (SDK `plugins`), Codex as an extra root of skills (app-server
//     `skills/extraRoots/set`); the other agents get the list (name, description, path of its SKILL.md) in their brief.
//     Agents read core\skills (src/core/guard.mjs); nobody but Orb writes there.
//   - Bringing one in (importExtension): from a folder (copied) or a git repository (cloned, https only), checked
//     (checkSkill / checkMcp: SKILL.md with a valid name and description, or a server Orb knows how to start; no links
//     out, a size limit), always off until the user turns it on.
//   - Made by an agent (requests): orb_create_skill / orb_create_mcp give it a folder in core\preparacion (the only part of
//     core agents may write), it writes the files there and asks for it to be turned on (orb_request_activation): a
//     fingerprint of the files is kept, the user sees the card and «Activar» moves it into core (if nothing changed since
//     it was asked) and turns it on.
//   - Improving a server of core: editInProject copies it to a project folder (work there with any agent), applyEdit
//     puts it back (the version before stays in core\mcp\.anterior\<name>; a skill replaced by an agent's request, in
//     core\skills\.anterior\<name>).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { CATEGORIES } from './layout.mjs';

export const SKILL_FILE = 'SKILL.md';
export const LIVE_DIR = '.activas'; // in core\skills: what the agents load (exposeSkills)
export const OLD_DIR = '.anterior'; // in core\mcp: the version before the last «Aplicar cambios»
export const REQUESTS = 'extension_requests'; // board setting: what agents made in core\preparacion
export const EDITS = 'extension_edits'; // board setting: { [server]: project folder } («Editar en un proyecto»)
export const PLUGIN_NAME = 'orb-skills';
// A skill's name (the Agent Skills format: lowercase letters, digits and hyphens) and a server's (a connector's name).
export const SKILL_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62})$/;
export const MCP_NAME = /^[a-z0-9_-]{1,40}$/i;
// What a skill or a server may weigh (dependencies, git and caches aside) and how many files it may have.
const LIMITS = { skill: { bytes: 20 * 1024 * 1024, files: 2000 }, mcp: { bytes: 200 * 1024 * 1024, files: 5000 } };
const SKIP = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', '.cache']);

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const norm = (p) => path.resolve(p).toLowerCase();
const under = (root, p) => { const r = path.relative(root, p); return Boolean(r) && !r.startsWith('..') && !path.isAbsolute(r); };
// An error the window shows as it is (its key and values; tr: the engine's translate for the owner's language).
export class ExtensionError extends Error {
  constructor(key, vars = {}, tr = null) { super(tr ? tr(key, vars) : key); this.key = key; this.vars = vars; this.userFacing = true; this.status = 400; }
}

// ---- where
export function extensionPaths(core) {
  return { skills: path.join(core, 'skills'), mcp: path.join(core, 'mcp'), staging: path.join(core, 'preparacion'), live: path.join(core, 'skills', LIVE_DIR) };
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
// A folder that is an MCP server (its package.json or pyproject names the MCP SDK, or its name says mcp).
export function isMcpProject(dir) {
  const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
  if (/mcp/i.test(path.basename(dir))) return true;
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
export function skillMeta(dir) {
  let text; try { text = fs.readFileSync(path.join(dir, SKILL_FILE), 'utf8'); } catch { return null; }
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text);
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
// The files of a folder (dependencies, git and caches aside): how many, how big, and the first link found (a symlink or a
// junction: a skill or a server must not reach outside its folder).
export function scanTree(dir) {
  let files = 0; let bytes = 0; let link = null;
  const walk = (d, rel) => {
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const full = path.join(d, e.name); const r = rel ? `${rel}/${e.name}` : e.name;
      let st; try { st = fs.lstatSync(full); } catch { continue; }
      if (st.isSymbolicLink()) { link ??= r; continue; }
      if (st.isDirectory()) { if (!SKIP.has(e.name)) walk(full, r); continue; }
      files++; bytes += st.size;
    }
  };
  walk(dir, '');
  return { files, bytes, link };
}
function checkTree(dir, kind, tr) {
  const t = scanTree(dir);
  if (t.link) throw new ExtensionError('ext.err.link', { file: t.link }, tr);
  const lim = LIMITS[kind];
  if (t.files > lim.files || t.bytes > lim.bytes) throw new ExtensionError('ext.err.tooBig', { mb: Math.round(lim.bytes / 1048576), files: lim.files }, tr);
  return t;
}
// A skill: SKILL.md with a valid name (the one given, or its folder's) and a description. → { name, description }
export function checkSkill(dir, { name = null, tr = null } = {}) {
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
  const start = startCommand(dir);
  if (!start) throw new ExtensionError('ext.err.noStart', {}, tr);
  checkTree(dir, 'mcp', tr);
  return { ...start, description: mcpDescription(dir) };
}
// What a folder is: 'skill' (SKILL.md at its top), 'mcp' (a server Orb can start) or null.
export const kindOf = (dir) => (isFile(path.join(dir, SKILL_FILE)) ? 'skill' : startCommand(dir) ? 'mcp' : null);
// A folder name turned into a server's name (lowercase, letters, digits, - and _; 40 at most).
export const mcpNameOf = (raw) => String(raw ?? '').toLowerCase().replace(/\.git$/, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'servidor';

// A fingerprint of every file (path, size, sha256), dependencies aside: what the user approves is what moves.
export function fingerprint(dir) {
  const h = crypto.createHash('sha256');
  const walk = (d, rel) => {
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)); } catch { return; }
    for (const e of list) {
      const full = path.join(d, e.name); const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) { h.update(`L ${r}\n`); continue; }
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(full, r); continue; }
      h.update(`F ${r} `); h.update(fs.readFileSync(full)); h.update('\n');
    }
  };
  walk(dir, '');
  return h.digest('hex');
}
// The files of a folder, for the card (relative, dependencies aside; at most `max`).
export function fileList(dir, max = 40) {
  const out = [];
  const walk = (d, rel) => {
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)); } catch { return; }
    for (const e of list) {
      if (out.length >= max) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(path.join(d, e.name), r); } else out.push(r);
    }
  };
  walk(dir, '');
  return out;
}

// ---- the list (Ajustes › Skills y MCP)
// core: the core folder; config: orb.json; projects: the board's projects ({ name, path }); requests / edits: the board's.
// → { dirs, skills, mcp, connectors, projects, pending }
export function listExtensions(core, config = {}, { projects = [], requests = [], edits = {} } = {}) {
  const P = extensionPaths(core);
  const folders = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort(); } catch { return []; } };
  const state = new Map((config.skills ?? []).map((s) => [s.name, s]));
  const skills = folders(P.skills).map((name) => {
    const dir = path.join(P.skills, name); const meta = skillMeta(dir); const s = state.get(name);
    return { kind: 'skill', name, dir, description: meta?.description ?? '', valid: Boolean(meta?.description), source: s?.source ?? 'usuario', enabled: s?.enabled === true };
  });
  const servers = config.mcpServers ?? [];
  const inFolder = (s, dir) => (s.args ?? []).some((a) => typeof a === 'string' && path.isAbsolute(a) && (norm(a) === norm(dir) || norm(a).startsWith(norm(dir) + path.sep)));
  const used = new Set();
  const mcp = folders(P.mcp).map((name) => {
    const dir = path.join(P.mcp, name);
    const entry = servers.find((s) => inFolder(s, dir)) ?? servers.find((s) => s.name === name && !(s.args ?? []).some((a) => path.isAbsolute(String(a))));
    if (entry) used.add(entry.name);
    const start = startCommand(dir);
    return { kind: 'mcp', name, dir, description: mcpDescription(dir), command: entry?.command ?? start?.command ?? null, args: entry?.args ?? start?.args ?? [], startable: Boolean(start),
      connector: entry?.name ?? null, enabled: Boolean(entry) && entry.enabled !== false, source: entry?.source ?? 'usuario', keys: Object.keys(entry?.env ?? {}), agents: entry?.agents ?? [],
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
  const pending = (requests ?? []).filter((r) => r?.status === 'pending').map(({ id, kind, name, description, dir, by, files, update, asked }) => ({ id, kind, name, description, dir, by, files, update: update ?? null, asked }));
  return { dirs: { skills: P.skills, mcp: P.mcp }, skills, mcp, connectors, projects: fromProjects, pending };
}

// ---- turning on and off (→ the patch for orb.json)
export function skillsWith(config, name, patch) {
  const list = (config.skills ?? []).filter((s) => s?.name !== name);
  const prev = (config.skills ?? []).find((s) => s?.name === name) ?? {};
  return [...list, { name, enabled: false, source: 'usuario', ...prev, ...patch }].sort((a, b) => (a.name < b.name ? -1 : 1));
}
// A server of core\mcp turned on or off: its connector (made from the command that starts it, when there is none yet).
export function mcpWith(config, core, name, enabled, { source } = {}) {
  const dir = path.join(extensionPaths(core).mcp, name);
  const servers = config.mcpServers ?? [];
  const i = servers.findIndex((s) => (s.args ?? []).some((a) => typeof a === 'string' && path.isAbsolute(a) && norm(a).startsWith(norm(dir) + path.sep)));
  if (i >= 0) return servers.map((s, j) => (j === i ? { ...s, enabled, ...(source ? { source } : {}) } : s));
  const start = startCommand(dir);
  if (!start) return null;
  if (!MCP_NAME.test(name) || name.toLowerCase() === 'orb') return null;
  return [...servers.filter((s) => s.name !== name), { name, command: start.command, args: start.args, agents: [], enabled, source: source ?? 'usuario' }];
}

// ---- what the agents load (core\skills\.activas)
// enabled: the names of the skills that are on. → { plugin, root, list: [{ name, description, file }] }
export function exposeSkills(core, config = {}) {
  const P = extensionPaths(core);
  const into = path.join(P.live, 'skills');
  fs.mkdirSync(into, { recursive: true });
  const manifest = path.join(P.live, '.claude-plugin', 'plugin.json');
  const want = JSON.stringify({ name: PLUGIN_NAME, description: 'Skills de Orb (core\\skills)', version: '1.0.0' }, null, 2);
  try { if (fs.readFileSync(manifest, 'utf8') !== want) throw new Error('changed'); } catch { fs.mkdirSync(path.dirname(manifest), { recursive: true }); fs.writeFileSync(manifest, want); }
  const on = new Set((config.skills ?? []).filter((s) => s?.enabled === true && SKILL_NAME.test(s.name ?? '')).map((s) => s.name));
  const list = [];
  for (const name of [...on].sort()) {
    const dir = path.join(P.skills, name); const meta = skillMeta(dir);
    if (!isDir(dir) || !meta?.description) { on.delete(name); continue; }
    list.push({ name, description: meta.description, file: path.join(dir, SKILL_FILE) });
  }
  let have = []; try { have = fs.readdirSync(into, { withFileTypes: true }); } catch { have = []; }
  for (const e of have) {
    const at = path.join(into, e.name);
    let st; try { st = fs.lstatSync(at); } catch { continue; }
    if (st.isSymbolicLink()) {
      const real = (p) => { try { return norm(fs.realpathSync.native(p)); } catch { return null; } };
      const target = real(at);
      if (on.has(e.name) && target && target === real(path.join(P.skills, e.name))) continue;
      fs.unlinkSync(at); // the link only (a junction or a symlink): never what it points to
    } else fs.rmSync(at, { recursive: true, force: true }); // a copy (no junctions here): made again below
  }
  for (const name of on) {
    const at = path.join(into, name);
    if (exists(at)) continue;
    try { fs.symlinkSync(path.join(P.skills, name), at, 'junction'); } catch { fs.cpSync(path.join(P.skills, name), at, { recursive: true }); }
  }
  return { plugin: P.live, root: into, list };
}

// The lines a brief carries for an agent that has no skills of its own (Cursor, the ACP agents).
export function skillsBrief(list) {
  if (!list?.length) return '';
  return `\n## Skills de Orb\nInstrucciones guardadas para tareas concretas. Si una encaja con lo que haces, lee su SKILL.md antes de empezar y síguelo (las rutas que cite son relativas a su carpeta). No las modifiques.\n${list.map((s) => `- ${s.name}: ${s.description.slice(0, 300)} (${s.file})`).join('\n')}\n`;
}

// ---- bringing one into core
// Moves a checked folder into core\skills or core\mcp under `name`. replace: the server that is there goes to
// core\mcp\.anterior\<name> first (only for a server: a skill is replaced whole).
function placeInCore(core, kind, name, from, { replace = false, tr = null } = {}) {
  const P = extensionPaths(core);
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
    fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true }); fs.rmSync(from, { recursive: true, force: true });
  }
  return to;
}
const busy = (error, name, tr) => (['EBUSY', 'EPERM', 'EACCES'].includes(error.code) ? new ExtensionError('ext.err.busy', { name }, tr) : error);

// Copies a folder or clones a repository into core\preparacion\<id>. → the folder.
export function fetchInto(staging, { from = null, url = null, tr = null } = {}) {
  fs.mkdirSync(staging, { recursive: true });
  const dir = path.join(staging, `importar-${stamp()}-${crypto.randomBytes(3).toString('hex')}`);
  if (url) {
    // Only https (or ssh) addresses of a server: never a local path, file://, ext:: or another helper that runs programs.
    const u = String(url).trim();
    if (!/^https:\/\/[^\s/]+\/\S+$/i.test(u) && !/^git@[\w.-]+:[\w./~-]+$/i.test(u) && !/^ssh:\/\/[^\s/]+\/\S+$/i.test(u)) throw new ExtensionError('ext.err.badUrl', {}, tr);
    const r = spawnSync('git', ['-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never', 'clone', '--depth', '1', '--no-recurse-submodules', '--', u, dir],
      { encoding: 'utf8', timeout: 180_000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } });
    if (r.status !== 0) { fs.rmSync(dir, { recursive: true, force: true }); throw new ExtensionError('ext.err.clone', { error: String(r.stderr || r.error?.message || '').trim().split('\n').slice(-1)[0] || 'git' }, tr); }
    return dir;
  }
  const src = path.resolve(String(from ?? ''));
  if (!from || !isDir(src)) throw new ExtensionError('ext.err.noFolder', { path: String(from ?? '') }, tr);
  if (norm(src) === norm(path.dirname(staging)) || under(path.dirname(staging), src)) throw new ExtensionError('ext.err.fromCore', {}, tr);
  const t = scanTree(src);
  if (t.link) throw new ExtensionError('ext.err.link', { file: t.link }, tr);
  fs.cpSync(src, dir, { recursive: true, verbatimSymlinks: true, filter: (f) => path.basename(f) !== '.git' || f === src });
  return dir;
}

// A server's dependencies (npm), when it has some and they are not there: installed in its folder, before it moves.
export function installDeps(dir, { tr = null, run = spawnSync } = {}) {
  let pkg = null; try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { return false; }
  if (!Object.keys(pkg?.dependencies ?? {}).length || isDir(path.join(dir, 'node_modules'))) return false;
  const win = process.platform === 'win32';
  const r = run(win ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: dir, encoding: 'utf8', timeout: 300_000, windowsHide: true, shell: win });
  if (r.status !== 0) throw new ExtensionError('ext.err.install', { error: String(r.stderr || r.error?.message || '').trim().split('\n').slice(-1)[0] || 'npm' }, tr);
  return true;
}

// The whole import: fetched, checked, named, placed in core (off). → { kind, name, dir, patch } (patch: for orb.json)
export function importExtension(core, config, { from = null, url = null, tr = null, install = installDeps } = {}) {
  const P = extensionPaths(core);
  const dir = fetchInto(P.staging, { from, url, tr });
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
    install(dir, { tr });
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
  if (!ok || !isDir(dir) || String(name).startsWith('.')) throw new ExtensionError('ext.err.notFound', { name }, tr);
  if (kind === 'skill') {
    const live = path.join(P.live, 'skills', name);
    try { if (fs.lstatSync(live).isSymbolicLink()) fs.unlinkSync(live); else fs.rmSync(live, { recursive: true, force: true }); } catch { /* not on */ }
    try { fs.rmSync(dir, { recursive: true }); } catch (error) { throw busy(error, name, tr); }
    return { skills: (config.skills ?? []).filter((s) => s.name !== name) };
  }
  try { fs.rmSync(dir, { recursive: true }); } catch (error) { throw busy(error, name, tr); }
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
// A new request: its folder (a copy of the current version when it improves one of core), with a starting point.
// → the request ({ id, kind, name, description, dir, by, status: 'drafting', update })
export function draftExtension(core, { kind, name, description, language = 'node', update = null, by = {}, tr = null } = {}) {
  const P = extensionPaths(core);
  if (!['skill', 'mcp'].includes(kind)) throw new ExtensionError('ext.err.unknownKind', {}, tr);
  const n = String(name ?? '').trim();
  if (!(kind === 'skill' ? SKILL_NAME : MCP_NAME).test(n) || n.toLowerCase() === 'orb') throw new ExtensionError(kind === 'skill' ? 'ext.err.skillName' : 'ext.err.mcpName', { name: n }, tr);
  const desc = String(description ?? '').replace(/\s+/g, ' ').trim().slice(0, 1024);
  if (!desc) throw new ExtensionError('ext.err.noDescription', {}, tr);
  const current = path.join(kind === 'skill' ? P.skills : P.mcp, n);
  if (update && !isDir(current)) throw new ExtensionError('ext.err.notFound', { name: n }, tr);
  if (!update && isDir(current)) throw new ExtensionError(kind === 'skill' ? 'ext.err.skillExists' : 'ext.err.mcpExists', { name: n }, tr);
  const id = `${kind}-${n}-${crypto.randomBytes(3).toString('hex')}`;
  const dir = path.join(P.staging, id);
  fs.mkdirSync(P.staging, { recursive: true });
  if (update) fs.cpSync(current, dir, { recursive: true, verbatimSymlinks: true }); // its dependencies too: it must still start
  else {
    fs.mkdirSync(dir, { recursive: true });
    const files = kind === 'skill' ? { [SKILL_FILE]: SKILL_TEMPLATE(n, desc) } : (language === 'python' ? MCP_PY : MCP_NODE)(n, desc);
    for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text);
  }
  return { id, kind, name: n, description: desc, dir, by, status: 'drafting', update: update ? n : null, created: new Date().toISOString() };
}
// The agent asks for it to be turned on: checked now, and its fingerprint kept (what the user approves). → the request
export function requestActivation(request, { tr = null } = {}) {
  if (!request || request.status !== 'drafting') throw new ExtensionError('ext.err.noRequest', {}, tr);
  if (!isDir(request.dir)) throw new ExtensionError('ext.err.notFound', { name: request.name }, tr);
  if (request.kind === 'skill') checkSkill(request.dir, { name: request.name, tr }); else checkMcp(request.dir, { tr });
  return { ...request, status: 'pending', asked: new Date().toISOString(), hash: fingerprint(request.dir), files: fileList(request.dir) };
}
// The user approved: the same files as when it was asked go into core and on. → { to, patch }
export function activateRequest(core, config, request, { tr = null } = {}) {
  if (!request || request.status !== 'pending') throw new ExtensionError('ext.err.noRequest', {}, tr);
  if (!isDir(request.dir) || fingerprint(request.dir) !== request.hash) throw new ExtensionError('ext.err.changed', { name: request.name }, tr);
  if (request.kind === 'skill') {
    checkSkill(request.dir, { name: request.name, tr });
    const to = placeInCore(core, 'skill', request.name, request.dir, { replace: Boolean(request.update), tr });
    return { to, patch: { skills: skillsWith(config, request.name, { enabled: true, source: request.update ? (config.skills ?? []).find((s) => s.name === request.name)?.source ?? 'creado' : 'creado' }) } };
  }
  checkMcp(request.dir, { tr });
  if (!request.update && (config.mcpServers ?? []).some((s) => s.name === request.name)) throw new ExtensionError('ext.err.mcpExists', { name: request.name }, tr);
  const to = placeInCore(core, 'mcp', request.name, request.dir, { replace: Boolean(request.update), tr });
  return { to, patch: { mcpServers: refreshStart(core, config, request.name, { enabled: true, source: request.update ? null : 'creado' }) ?? config.mcpServers ?? [] } };
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

// ---- improving a server of core in a project
// Copied to <home>\<category>\<name> (or name-2…), its git history and dependencies too. → the project folder
export function editInProject(home, core, name, category = 'windows', { tr = null } = {}) {
  const from = path.join(extensionPaths(core).mcp, String(name));
  if (!MCP_NAME.test(String(name)) || !isDir(from)) throw new ExtensionError('ext.err.notFound', { name }, tr);
  if (!CATEGORIES.includes(category)) throw new ExtensionError('ext.err.notFound', { name: category }, tr);
  let to = path.join(home, category, name);
  for (let i = 2; exists(to); i++) to = path.join(home, category, `${name}-${i}`);
  fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
  return to;
}
// What «Aplicar cambios» would change: { added, changed, removed } (relative paths, dependencies aside).
export function compareTrees(a, b) {
  const files = (root) => {
    const out = new Map();
    const walk = (d, rel) => {
      let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of list) {
        const full = path.join(d, e.name); const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(full, r); } else if (e.isFile()) out.set(r, full);
      }
    };
    walk(root, '');
    return out;
  };
  const A = files(a); const B = files(b);
  const same = (x, y) => { try { return fs.readFileSync(x).equals(fs.readFileSync(y)); } catch { return false; } };
  return { added: [...B.keys()].filter((k) => !A.has(k)).sort(), changed: [...B.keys()].filter((k) => A.has(k) && !same(A.get(k), B.get(k))).sort(), removed: [...A.keys()].filter((k) => !B.has(k)).sort() };
}
// The project's version goes into core (checked first); the one before stays in core\mcp\.anterior\<name>. → { to, patch }
export function applyEdit(core, config, name, project, { tr = null } = {}) {
  if (!isDir(project)) throw new ExtensionError('ext.err.noFolder', { path: project }, tr);
  checkMcp(project, { tr });
  const P = extensionPaths(core);
  const tmp = path.join(P.staging, `aplicar-${name}-${stamp()}`);
  fs.mkdirSync(P.staging, { recursive: true });
  fs.cpSync(project, tmp, { recursive: true, verbatimSymlinks: true });
  try {
    const to = placeInCore(core, 'mcp', name, tmp, { replace: true, tr });
    return { to, patch: { mcpServers: refreshStart(core, config, name) ?? config.mcpServers ?? [] } };
  } catch (error) { fs.rmSync(tmp, { recursive: true, force: true }); throw error; }
}

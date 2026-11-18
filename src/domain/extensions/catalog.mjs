// The extension list, the patch for orb.json, the skills plugin agents load, and importing or removing one.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ExtensionError, MCP_NAME, OLD_DIR, PLUGIN_NAME, SKILL_FILE, SKILL_NAME, exists, extensionPaths, isDir, isLink, isMcpProject, linkOut, mcpDescription, needsDeps, norm, realInside, runProcess, skillMeta, stamp, startCommand } from './basics.mjs';
import { checkMcp, checkSkill, copyTree, fingerprint, kindOf, mcpNameOf, orbSkillText, skillAsks } from './checks.mjs';

// ---- the list (Ajustes › Skills y MCP)
// A folder of core\skills or core\mcp that really is there: not a link or a junction, and inside core.
export const realFolder = (root, dir) => isDir(dir) && !isLink(dir) && realInside(root, dir);

// core: the core folder; config: orb.json; projects: the board's projects ({ name, path }); requests / edits: the board's.
// → { dirs, skills, mcp, connectors, projects, pending }
// ---- scope: which projects a connector or a skill reaches
// An entry (a connector of mcpServers, a skill of skills) whose `projects` is a non-empty list is delivered only to the
// chats and tasks of those projects; with no `projects`, or an empty list, it reaches every project. Anything else written
// there by hand (a text, an object, a list with no text in it) reaches nobody: a value that is not understood never widens.
// A name that no longer matches a project simply never matches. The scopes follow a project only while it is the same
// record (renamed); when it leaves Orb (removed, finished, deleted) it leaves every scope (scopesRemoved).
const texts = (v) => (Array.isArray(v) ? v.filter((p) => typeof p === 'string' && p) : []);
export const isScoped = (entry) => entry?.projects !== undefined && !(Array.isArray(entry.projects) && entry.projects.length === 0);
export const scopeOf = (entry) => texts(entry?.projects);
export const reaches = (entry, project) => !isScoped(entry) || (Boolean(project) && texts(entry.projects).includes(project));

// What an approved improvement keeps: an entry that is scoped (or that was, and was turned off by taking its last project
// away) keeps `enabled` and `projects` as they are. One that never had a scope behaves as it always did.
export const keepsState = (entry) => Boolean(entry) && (isScoped(entry) || entry.scopeOff === true);

// The scope of an entry with one project taken out. The last one out turns the entry off (marked scopeOff so an approved
// improvement does not turn it on for everybody): taking a project away never widens what the rest receive.
const without = (entry, project) => {
  const rest = texts(entry.projects).filter((p) => p !== project);
  if (rest.length) return { ...entry, projects: rest };
  const { projects: _gone, ...bare } = entry;
  return { ...bare, enabled: false, scopeOff: true };
};
const touches = (entry, project) => isScoped(entry) && texts(entry.projects).includes(project);

// The patch that adds a project to the scope of a skill or connector (or removes it) → { skills } | { mcpServers } | null
// (nothing to change). fresh: the entry was off and was just made ready to turn on: it goes on for that project only.
export function scopeChange(config, { kind, name, project, add, fresh = false }) {
  const next = (entry) => {
    if (add) {
      const { scopeOff: _marker, ...bare } = entry;
      if (fresh || entry.enabled === false) return { ...bare, enabled: true, projects: [project] };
      if (!isScoped(entry) || touches(entry, project)) return null; // already received
      return { ...bare, projects: [...texts(entry.projects), project] };
    }
    return touches(entry, project) ? without(entry, project) : null;
  };
  const list = kind === 'skill' ? config.skills ?? [] : config.mcpServers ?? [];
  const i = list.findIndex((e) => e?.name === name);
  if (i < 0) return null;
  const changed = next(list[i]);
  if (!changed) return null;
  const out = list.map((e, j) => (j === i ? changed : e));
  return kind === 'skill' ? { skills: out } : { mcpServers: out };
}

// A project left Orb: it leaves every scope, with the same rule as taking it away by hand. → patch | null
export function scopesRemoved(config, project) {
  const strip = (list) => (Array.isArray(list) && list.some((e) => touches(e, project)) ? list.map((e) => (touches(e, project) ? without(e, project) : e)) : null);
  const skills = strip(config.skills); const mcpServers = strip(config.mcpServers);
  return skills || mcpServers ? { ...(skills ? { skills } : {}), ...(mcpServers ? { mcpServers } : {}) } : null;
}

// A project was renamed: its name follows in every scope. A scope that already named the new name belonged to a project
// that is gone, so it goes first and cannot be inherited. → patch | null
export function scopesRenamed(config, from, to) {
  const cleaned = { skills: config.skills, mcpServers: config.mcpServers, ...(scopesRemoved(config, to) ?? {}) };
  const swap = (list) => (Array.isArray(list) && list.some((e) => touches(e, from))
    ? list.map((e) => (touches(e, from) ? { ...e, projects: [...new Set(texts(e.projects).map((p) => (p === from ? to : p)))] } : e)) : null);
  const skills = swap(cleaned.skills) ?? (cleaned.skills !== config.skills ? cleaned.skills : null);
  const mcpServers = swap(cleaned.mcpServers) ?? (cleaned.mcpServers !== config.mcpServers ? cleaned.mcpServers : null);
  return skills || mcpServers ? { ...(skills ? { skills } : {}), ...(mcpServers ? { mcpServers } : {}) } : null;
}

// Whether `after` is `before` with nothing changed but the scope (`projects`, `enabled` and the marker) of the entry
// `name`: same length, same order, every other entry and every other field equal.
export function scopeOnly(before, after, name) {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return false;
  const free = new Set(['projects', 'enabled', 'scopeOff']);
  return before.every((b, i) => {
    const a = after[i];
    if (b?.name !== name) return JSON.stringify(a) === JSON.stringify(b);
    const rest = (e) => JSON.stringify(Object.entries(e ?? {}).filter(([k]) => !free.has(k)));
    return a?.name === name && rest(a) === rest(b);
  });
}


export function listExtensions(core, config = {}, { projects = [], requests = [], edits = {} } = {}) {
  const P = extensionPaths(core);
  const folders = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.')).map((e) => e.name).sort(); } catch { return []; } };
  const state = new Map((config.skills ?? []).map((s) => [s.name, s]));
  const skills = folders(P.skills).map((name) => {
    const dir = path.join(P.skills, name); const ok = realFolder(P.skills, dir); const meta = ok ? skillMeta(dir) : null; const s = state.get(name);
    return { kind: 'skill', name, dir, description: meta?.description ?? '', valid: Boolean(meta?.description), linked: !ok, asks: ok ? skillAsks(dir) : null, source: s?.source ?? 'usuario', enabled: s?.enabled === true, projects: scopeOf(s), scoped: isScoped(s) };
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
      needsInstall: ok && needsDeps(dir), connector: entry?.name ?? null, enabled: Boolean(entry) && entry.enabled !== false, source: entry?.source ?? 'usuario', keys: Object.keys(entry?.env ?? {}), agents: entry?.agents ?? [], projects: scopeOf(entry), scoped: isScoped(entry),
      editing: typeof edits?.[name] === 'string' && isDir(edits[name]) ? edits[name] : null };
  });
  // The connectors that are not a folder of core (a package run with npx, a program of the PC).
  const connectors = servers.filter((s) => !used.has(s.name)).map((s) => ({ kind: 'connector', name: s.name, command: s.command, args: s.args ?? [], enabled: s.enabled !== false, keys: Object.keys(s.env ?? {}), agents: s.agents ?? [], source: s.source ?? 'usuario', projects: scopeOf(s), scoped: isScoped(s) }));
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

// project: whose chat or task gets them. The skills without a scope make the usual plugin (core/skills/.activas); a project
// that also receives scoped skills gets its own plugin folder for that exact set (core/skills/.ambitos/<hash of the names>),
// beside the usual one, so the folder every other project loads never holds a skill that is not theirs.
const setHash = (names) => crypto.createHash('sha1').update(names.join(',')).digest('hex').slice(0, 12);
const liveSkillNames = (config) => (config.skills ?? []).filter((s) => s?.enabled === true && SKILL_NAME.test(s.name ?? ''));
const namesOf = (list) => list.map((s) => s.name).sort();

// The folders of scoped sets that no project uses any more go (a set changes when a skill is turned off, removed or
// re-scoped); so do the copies a kept folder holds of skills that are no longer on. Called whenever the skills change.
export function pruneScoped(core, config = {}) {
  const P = extensionPaths(core);
  const on = liveSkillNames(config);
  const common = namesOf(on.filter((s) => reaches(s, null))).join(',');
  const sets = new Map();
  for (const project of new Set(on.flatMap((s) => scopeOf(s)))) {
    const names = namesOf(on.filter((s) => reaches(s, project)));
    if (names.join(',') !== common) sets.set(setHash(names), new Set(names));
  }
  let have = []; try { have = fs.readdirSync(P.scoped, { withFileTypes: true }); } catch { return; }
  for (const e of have) {
    const at = path.join(P.scoped, e.name);
    if (!sets.has(e.name)) { fs.rmSync(at, { recursive: true, force: true }); continue; }
    let copies = []; try { copies = fs.readdirSync(path.join(at, 'skills')); } catch { copies = []; }
    for (const c of copies) if (!sets.get(e.name).has(c)) fs.rmSync(path.join(at, 'skills', c), { recursive: true, force: true });
  }
}
export function exposeSkills(core, config = {}, { project = null } = {}) {
  const P0 = extensionPaths(core);
  const enabled = liveSkillNames(config);
  const seen = namesOf(enabled.filter((s) => reaches(s, project)));
  const variant = seen.join(',') !== namesOf(enabled.filter((s) => reaches(s, null))).join(',');
  const P = variant ? { ...P0, live: path.join(P0.scoped, setHash(seen)) } : P0;
  const into = path.join(P.live, 'skills');
  fs.mkdirSync(into, { recursive: true });
  const manifest = path.join(P.live, '.claude-plugin', 'plugin.json');
  const want = JSON.stringify({ name: PLUGIN_NAME, description: 'Skills de Orb (core\\skills)', version: '1.0.0' }, null, 2);
  try { if (fs.readFileSync(manifest, 'utf8') !== want) throw new Error('changed'); } catch { fs.mkdirSync(path.dirname(manifest), { recursive: true }); fs.writeFileSync(manifest, want); }
  const on = new Set(seen);
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
export function placeInCore(core, kind, name, from, { replace = false, tr = null } = {}) {
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
export function reuseDeps(core, name, to) {
  const old = path.join(extensionPaths(core).mcp, OLD_DIR, name, 'node_modules');
  try { if (isDir(old) && !isLink(old) && !exists(path.join(to, 'node_modules'))) fs.renameSync(old, path.join(to, 'node_modules')); } catch { /* the server says it lacks them when it starts */ }
  // A link in them that leads out of the new folder: they go (the server says it lacks them; turning it on installs).
  if (linkOut(to)) fs.rmSync(path.join(to, 'node_modules'), { recursive: true, force: true });
}

export const quarantineFor = (core, id) => path.join(extensionPaths(core).quarantine, `${id}-${crypto.randomBytes(3).toString('hex')}`);

// A quarantine Orb made (inside core\datos\cuarentena, a real folder) with the same files as when it was checked.
export function sameQuarantine(core, dir, hash, name, tr) {
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
    // and its copy in every project's own plugin
    try { for (const e of fs.readdirSync(P.scoped)) fs.rmSync(path.join(P.scoped, e, 'skills', name), { recursive: true, force: true }); } catch { /* none */ }
    drop();
    return { skills: (config.skills ?? []).filter((s) => s.name !== name) };
  }
  drop();
  return { mcpServers: (config.mcpServers ?? []).filter((s) => !(s.args ?? []).some((a) => typeof a === 'string' && path.isAbsolute(a) && norm(a).startsWith(norm(dir) + path.sep))) };
}

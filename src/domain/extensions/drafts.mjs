// Extensions made by agents: drafts, activation requests, the quarantine copy, and editing a core server in a project.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CATEGORIES } from '../../shared/layout.mjs';
import { ExtensionError, MANIFESTS, MCP_NAME, SKILL_FILE, SKILL_NAME, SKIP, TOOL_CONFIG, exists, extensionPaths, installDeps, isDir, isLink, needsDeps, norm, startCommand } from './basics.mjs';
import { carrySecrets, checkMcp, checkSkill, cleanGitConfig, copyTree, fingerprint, holdsKeys, privateTest, secretTest, skillAsks, walkTree } from './checks.mjs';
import { keepsState, mcpWith, placeInCore, quarantineFor, realFolder, reuseDeps, sameQuarantine, skillsWith } from './catalog.mjs';

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
  // An improvement of something scoped to projects (or that was, and was turned off by taking its last project away) keeps
  // its state: approving it never turns it on for every project. Anything without a scope is turned on, as it always was.
  const prev = request.update ? (request.kind === 'skill' ? config.skills ?? [] : config.mcpServers ?? []).find((s) => s.name === request.name) : null;
  const keep = keepsState(prev);
  const enabled = keep ? (request.kind === 'skill' ? prev.enabled === true : prev.enabled !== false) : true;
  const keptOff = keep && !enabled;
  if (request.kind === 'skill') return { to, keptOff, patch: { skills: skillsWith(config, request.name, { enabled, source: request.update ? prev?.source ?? 'creado' : 'creado' }) } };
  return { to, keptOff, patch: { mcpServers: refreshStart(core, config, request.name, { enabled, source: request.update ? null : 'creado' }) ?? config.mcpServers ?? [] } };
}

// at every start, what nothing points to any more goes: folders of core\preparacion and of the
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

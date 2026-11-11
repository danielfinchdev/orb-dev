// Tree walking and copying, the skill and server checks, the fingerprint, and the secret detection that keeps keys out of core.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEP_DIRS, ExtensionError, FRONTMATTER, LIMITS, SKILL_FILE, SKILL_NAME, SKIP, TOOL_CONFIG, exists, extensionPaths, isDir, isFile, isLink, localDep, mcpDescription, norm, secretName, skillMeta, startCommand } from './basics.mjs';

// ---- checks
// Every entry of a folder, walked without ever following a link: { files: [{ rel, full, size }], dirs, bytes, link }
// (link: the first symlink, junction or hard link found; '.' when the folder itself is one). skip(name, rel, isDir):
// what is left out and not looked into (by default dependencies, git, caches and the package managers' settings).
export function walkTree(dir, { skip = SKIP } = {}) {
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
export function carrySecrets(from, to) {
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

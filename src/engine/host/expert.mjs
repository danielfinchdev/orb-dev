// Expert mode (PC only): read-only views of a project for demanding users — file tree, file viewer, git status / diff /
// history — and the machine's load. Everything stays inside the project's folder (symlinks included), secret files are
// listed but never read, and every answer is size-limited.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitAsyncWith, BRANCH_PREFIX } from '../../platform/git.mjs';
import { isSecretPath, redactSecrets } from '../../shared/secrets-scan.mjs';
import { tr } from '../../platform/context.mjs';

const MAX_ENTRIES = 600;
const MAX_READ = 512 * 1024;
const MAX_DIFF = 400 * 1024;
const HIDDEN = new Set(['.git', '.orb', '.orb-adjuntos']); // compared in lower case (Windows ignores case)
const isHidden = (part) => HIDDEN.has(part.toLowerCase());
const realpath = fs.realpathSync.native ?? fs.realpathSync; // native: the real case and long names (not ENV~1) on Windows

// git without blocking the engine, with paths taken literally (never as patterns: "*" or "[.]env" would match .env). It is
// Orb's own git: the project's hooks and fsmonitor never run here, and the engine's environment is not handed over.
const git = (cwd, args, { max = 32 * 1024 * 1024 } = {}) => gitAsyncWith(cwd, { max, timeout: 30_000, literal: true }, ...args);
const userError = (message) => { const e = new Error(message); e.userFacing = true; return e; };

// Absolute path of `rel` inside the project, refusing anything that leaves it (.., absolute paths, links pointing out).
// Windows reads «.env::$DATA», «.env.» and «.env » as .env: names like these are refused before anything else.
const sneaky = (clean) => clean.includes(':') || clean.split('/').some((part) => /[. ]$/.test(part) && part !== '.' && part !== '..');
export function insideProject(root, rel = '') {
  const real = realpath(root);
  const clean = String(rel ?? '').replace(/\\/g, '/');
  if (clean.includes('\0') || path.isAbsolute(clean) || /^[a-z]:/i.test(clean) || sneaky(clean)) throw userError(tr('msg.expert.badPath'));
  const abs = path.resolve(real, clean);
  let resolved; try { resolved = realpath(abs); } catch { throw userError(tr('msg.expert.notFound')); }
  const back = path.relative(real, resolved);
  if (back.startsWith('..') || path.isAbsolute(back)) throw userError(tr('msg.expert.outside'));
  if (back.split(path.sep).some(isHidden)) throw userError(tr('msg.expert.internal'));
  return { abs: resolved, rel: back.split(path.sep).join('/') };
}

export function tree(root, dir = '') {
  const { abs, rel } = insideProject(root, dir);
  if (!fs.statSync(abs).isDirectory()) throw userError(tr('msg.expert.notFolder'));
  const entries = [];
  const list = fs.readdirSync(abs, { withFileTypes: true }).filter((e) => !isHidden(e.name));
  for (const e of list.slice(0, MAX_ENTRIES)) {
    const child = rel ? `${rel}/${e.name}` : e.name;
    let kind = e.isDirectory() ? 'dir' : e.isFile() ? 'file' : e.isSymbolicLink() ? 'link' : 'other';
    let size = null;
    if (kind === 'link') { try { const st = fs.statSync(path.join(abs, e.name)); kind = st.isDirectory() ? 'dir' : 'file'; size = st.size; } catch { kind = 'other'; } }
    else if (kind === 'file') { try { size = fs.statSync(path.join(abs, e.name)).size; } catch { /* gone */ } }
    entries.push({ name: e.name, path: child, kind, size, secret: kind === 'file' && isSecretPath(child) });
  }
  entries.sort((a, b) => (a.kind === 'dir') === (b.kind === 'dir') ? a.name.localeCompare(b.name, 'es', { numeric: true }) : a.kind === 'dir' ? -1 : 1);
  return { dir: rel, entries, cut: list.length > MAX_ENTRIES };
}

export function readFile(root, file) {
  const { abs, rel } = insideProject(root, file);
  if (isSecretPath(rel) || isSecretPath(rel.toLowerCase())) throw userError(tr('msg.expert.secrets'));
  const st = fs.statSync(abs);
  if (!st.isFile()) throw userError(tr('msg.expert.notFile'));
  const fd = fs.openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(Math.min(st.size, MAX_READ));
    fs.readSync(fd, buf, 0, buf.length, 0);
    if (buf.subarray(0, 8000).includes(0)) return { path: rel, size: st.size, binary: true, text: '' };
    const cut = st.size > MAX_READ;
    const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    // Real facts about the bytes read: «utf-8» only when they decode strictly (a character split by the size limit is
    // not an error); lines are only counted when the whole file was read.
    let encoding = 'utf-8';
    try { new TextDecoder('utf-8', { fatal: true }).decode(buf, { stream: cut }); } catch { encoding = 'unknown'; }
    const text = buf.toString('utf8');
    const lines = cut ? null : text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    return { path: rel, size: st.size, binary: false, cut, text: redactSecrets(text), encoding, bom, lines };
  } finally { fs.closeSync(fd); }
}

// ---- «Nuevo archivo»: the only thing God mode writes. It creates an empty file that does not exist yet, directly in a
// folder of the project; it never overwrites, renames or deletes.
const WIN_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$|clock\$)\s*(\..*)?$/i;
const PROTECTED_DIRS = new Set(['pizarra']); // plus HIDDEN: compared in lower case
const isProtected = (part) => isHidden(part) || PROTECTED_DIRS.has(part.toLowerCase());
export function checkNewName(name) {
  const n = String(name ?? '').trim();
  if (!n || n.length > 200 || n === '.' || n === '..' || /[\\/:*?"<>|\0-\x1f]/.test(n) || /[. ]$/.test(n) || WIN_RESERVED.test(n)) throw userError(tr('msg.expert.badName'));
  if (isProtected(n)) throw userError(tr('msg.expert.protectedPath'));
  return n;
}
export function createFile(root, dir, name) {
  const n = checkNewName(name);
  const { abs: parent, rel: parentRel } = insideProject(root, dir ?? ''); // the real folder, links already followed
  if (!fs.statSync(parent).isDirectory()) throw userError(tr('msg.expert.notFolder'));
  if (parentRel.split('/').some(isProtected)) throw userError(tr('msg.expert.protectedPath'));
  const rel = parentRel ? `${parentRel}/${n}` : n;
  if (isSecretPath(rel) || isSecretPath(rel.toLowerCase())) throw userError(tr('msg.expert.secretName'));
  const target = path.join(parent, n);
  // Anything already there (a dangling link included, which Windows would follow when creating) means «exists».
  let there = false; try { fs.lstatSync(target); there = true; } catch { /* free */ }
  if (there) throw userError(tr('msg.expert.exists', { name: n }));
  let fd;
  try { fd = fs.openSync(target, 'wx'); } // wx: fails when anything (even a link) is already there, so nothing is overwritten
  catch (e) { throw e.code === 'EEXIST' ? userError(tr('msg.expert.exists', { name: n })) : userError(tr('msg.expert.cannotCreate')); }
  // which file this call made, to never remove another one below
  let made = null; try { made = fs.fstatSync(fd, { bigint: true }); } catch { /* unknown: nothing will be removed */ }
  fs.closeSync(fd);
  // A link planted between the check and the open: the file made (empty, ours) is removed and nothing is reported. Only
  // the very file created here goes (same file id, a plain file): whatever a swapped link points at is never touched.
  let landed = null; try { landed = realpath(target); } catch { /* gone */ }
  if (!landed || path.dirname(landed).toLowerCase() !== parent.toLowerCase()) {
    try { const now = fs.lstatSync(target, { bigint: true }); if (made && now.isFile() && now.ino === made.ino && now.dev === made.dev) fs.unlinkSync(target); } catch { /* nothing */ }
    throw userError(tr('msg.expert.cannotCreate'));
  }
  return { path: rel, name: n, dir: parentRel };
}

const hasHead = async (root) => (await git(root, ['rev-parse', '--verify', '-q', 'HEAD'])).status === 0;
const isRepo = async (root) => (await git(root, ['rev-parse', '--is-inside-work-tree'])).stdout.trim() === 'true';
// git status names files from the repository's root: a project that is a subfolder of a bigger repository sees its own
// files only, relative to itself (like every other path here). Untracked folders are listed as folders (not every file
// inside an unignored node_modules).
async function changed(root) {
  const prefix = (await git(root, ['rev-parse', '--show-prefix'])).stdout.trim();
  const [tracked, others] = await Promise.all([
    git(root, ['status', '--porcelain=v1', '-z', '-uno', '--', '.']),
    git(root, ['ls-files', '--others', '--exclude-standard', '--directory', '--no-empty-directory', '-z']) // relative to the project
  ]);
  const parts = tracked.stdout.split('\0'); const out = [];
  for (let i = 0; i < parts.length && out.length < 1000; i++) {
    const entry = parts[i]; if (entry.length < 4) continue;
    const code = entry.slice(0, 2); let file = entry.slice(3).replace(/\\/g, '/');
    if (/^[RC]/.test(code)) i++;
    if (prefix) { if (!file.startsWith(prefix)) continue; file = file.slice(prefix.length); }
    out.push({ code, path: file });
  }
  let untracked = others.stdout.split('\0').filter(Boolean);
  // A project that git does not track at all comes back as «./»: then its files, one by one (within the size limit).
  if (untracked.includes('./')) untracked = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z'], { max: 4 * 1024 * 1024 })).stdout.split('\0').filter(Boolean);
  for (const file of untracked) { if (out.length >= 1000) break; out.push({ code: '??', path: file.replace(/\\/g, '/') }); }
  return out;
}

export async function gitStatus(root) {
  if (!(await isRepo(root))) return { repo: false, files: [] };
  const branch = (await git(root, ['branch', '--show-current'])).stdout.trim() || (await git(root, ['rev-parse', '--short', 'HEAD'])).stdout.trim() || '(sin commits)';
  const files = (await changed(root)).map(({ code, path: file }) => ({ path: file, code, state: code === '??' ? 'nuevo' : /D/.test(code) ? 'borrado' : /R/.test(code) ? 'renombrado' : /A/.test(code) ? 'añadido' : 'cambiado', staged: code[0] !== ' ' && code[0] !== '?', secret: isSecretPath(file) }));
  const ab = await git(root, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
  const [behind, ahead] = ab.status === 0 ? ab.stdout.trim().split(/\s+/).map(Number) : [null, null];
  const upstream = ab.status === 0 ? (await git(root, ['rev-parse', '--abbrev-ref', '@{upstream}'])).stdout.trim() || null : null;
  // lines added and removed per tracked file (numbers only, never the content; secret files get none). Never a program of
  // the project (no ext-diff, no textconv), and no lock on the index an agent may be using.
  const counts = new Map();
  const ns = await git(root, ['--no-optional-locks', 'diff', '--numstat', '--no-color', '--no-ext-diff', '--no-textconv', '--relative', ...((await hasHead(root)) ? ['HEAD'] : ['--cached']), '--', '.']);
  if (ns.status === 0) for (const line of ns.stdout.split('\n')) { const m = /^(\d+)\t(\d+)\t(.+)$/.exec(line); if (m) counts.set(m[3], { add: Number(m[1]), del: Number(m[2]) }); }
  for (const f of files) { const c = !f.secret && counts.get(f.path); if (c) { f.add = c.add; f.del = c.del; } }
  return { repo: true, branch, files, ahead, behind, upstream };
}

// Leaves out of a diff the sections of secret files (whatever name git printed: renames included).
function withoutSecrets(diff) {
  return diff.split(/(?=^diff --git )/m).filter((part) => {
    const m = part.match(/^diff --git a\/(.*?) b\/(.*)$/m);
    return !m || (!isSecretPath(m[1]) && !isSecretPath(m[2]));
  }).join('');
}

// The changes of one changed file, or of every changed file (secret files left out), against the last commit.
export async function gitDiff(root, file) {
  if (!(await isRepo(root))) throw userError(tr('msg.expert.noGit'));
  const list = await changed(root);
  let paths;
  if (file) {
    // Only a file of the changes list, by its exact name.
    const f = list.find((x) => x.path === String(file));
    if (!f) throw userError(tr('msg.expert.noChanges'));
    if (isSecretPath(f.path) || sneaky(f.path)) throw userError(tr('msg.expert.secrets'));
    paths = [f.path];
  } else paths = ['.'];
  const head = await hasHead(root);
  const args = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--relative', '-M', ...(head ? ['HEAD'] : ['--cached']), '--', ...paths];
  const r = await git(root, args, { max: MAX_DIFF * 4 });
  let out = withoutSecrets(r.stdout);
  // New files git does not track yet: shown whole, as added lines.
  const untracked = list.filter((x) => x.code === '??' && (!file || x.path === file) && !x.path.endsWith('/') && !isSecretPath(x.path));
  for (const { path: p } of untracked) {
    if (out.length > MAX_DIFF) break;
    try { const f = readFile(root, p); out += `diff --git a/${p} b/${p}\nnew file\n--- /dev/null\n+++ b/${p}\n${f.binary ? '(archivo binario)\n' : f.text.split('\n').map((l) => `+${l}`).join('\n')}\n`; } catch { /* unreadable */ }
  }
  return { diff: redactSecrets(out.slice(0, MAX_DIFF)), cut: r.cut || out.length > MAX_DIFF };
}

export async function gitLog(root, limit = 40) {
  if (!(await isRepo(root)) || !(await hasHead(root))) return [];
  const n = Math.max(1, Math.min(Number(limit) || 40, 200));
  const r = await git(root, ['log', `-${n}`, '--date=iso-strict', '--pretty=format:%h%x1f%an%x1f%ad%x1f%s%x1f%D%x1e']);
  return r.stdout.split('\x1e').map((l) => l.trim()).filter(Boolean).map((l) => { const [hash, author, date, subject, refs] = l.split('\x1f'); return { hash, author, date, subject, refs }; });
}

// Machine load: CPU since the previous call, memory, the disk of the assistant's folder and the engine's own memory.
let lastCpu = null;
export function systemStats(home) {
  const cpus = os.cpus();
  const total = cpus.reduce((acc, c) => { for (const [k, v] of Object.entries(c.times)) acc[k === 'idle' ? 'idle' : 'busy'] += v; return acc; }, { idle: 0, busy: 0 });
  let cpu = null;
  if (lastCpu) { const busy = total.busy - lastCpu.busy; const idle = total.idle - lastCpu.idle; cpu = busy + idle > 0 ? Math.round((busy / (busy + idle)) * 100) : 0; }
  lastCpu = total;
  let disk = null;
  try { const s = fs.statfsSync(home); disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { /* not available */ }
  return { cpu, cores: cpus.length, memory: { free: os.freemem(), total: os.totalmem() }, disk, engine: process.memoryUsage().rss, uptime: Math.round(os.uptime()), platform: `${os.type()} ${os.release()}` };
}

// ---- branches and the last save (God mode's git panel). Nothing here ever forces, discards or stashes: a switch needs a
// clean tree and refuses anything that could overwrite a file of the folder, a new branch leaves the tree as it is and
// undoing a save is a soft reset (the changes go back to the tree).
const BRANCH_RE = /^[\w./-]{1,255}$/;
// `orb/…` branches belong to Orb's tasks and chats: the panel neither creates nor switches to them.
const ORB_PREFIX = `${BRANCH_PREFIX}/`;
const isOrbBranch = (name) => name.startsWith(ORB_PREFIX);
const plainBranch = (name) => {
  const b = String(name ?? '');
  if (!BRANCH_RE.test(b) || b.startsWith('-') || b.includes('..') || b === 'HEAD') throw userError(tr('msg.expert.badBranch'));
  if (isOrbBranch(b)) throw userError(tr('msg.expert.orbBranch'));
  return b;
};
// Orb's own folders never count as the user's unsaved work.
const OWN_DIRS = /^\.(orb|orb-adjuntos)\//;
const dirty = async (root) => (await changed(root)).filter((f) => !OWN_DIRS.test(f.path));
const worktreesOf = async (root) => {
  const out = (await git(root, ['worktree', 'list', '--porcelain'])).stdout.split(/\r?\n\r?\n/).map((block) => {
    const at = /^worktree (.+)$/m.exec(block)?.[1]; const ref = /^branch (.+)$/m.exec(block)?.[1];
    return at && ref ? { at, ref } : null;
  }).filter(Boolean);
  return out;
};
const samePath = (a, b) => { try { return realpath(a).toLowerCase() === realpath(b).toLowerCase(); } catch { return a === b; } };
const nul = (text) => text.split('\0').filter(Boolean);
const names = (list) => list.slice(0, 5).join(', ');

// Branch, switch and undo act on the whole repository: a project that is only a folder of a bigger repository (shared with
// other projects) is not touched from here.
async function ownRepo(root) {
  const top = (await git(root, ['rev-parse', '--show-toplevel'])).stdout.trim();
  if (!top || !samePath(top, root)) throw userError(tr('msg.expert.sharesRepo'));
  return top;
}
// A merge, rebase or cherry-pick half done (the real git directory: it may be a file that points elsewhere).
async function operationInProgress(root) {
  const dir = (await git(root, ['rev-parse', '--git-dir'])).stdout.trim();
  if (!dir) return false;
  const abs = path.resolve(root, dir);
  return ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'].some((n) => fs.existsSync(path.join(abs, n)));
}
const isDetached = async (root) => (await git(root, ['symbolic-ref', '-q', 'HEAD'])).status !== 0;
// Commits of a detached HEAD that no branch (other than Orb's own) or tag holds would be lost track of by leaving.
async function orphanHead(root) {
  const head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  if (!head) return false;
  const c = await git(root, ['for-each-ref', '--contains', head, '--format=%(refname)', 'refs/heads', 'refs/tags']);
  return !c.stdout.split(/\r?\n/).some((r) => r.trim() && !r.startsWith(`refs/heads/${ORB_PREFIX}`));
}
// Everything that must hold before the working tree is changed by a switch.
async function readyToSwitch(root, target) {
  await ownRepo(root);
  if (await operationInProgress(root)) throw userError(tr('msg.expert.inProgress'));
  if ((await dirty(root)).length) throw userError(tr('msg.expert.switchDirty'));
  if (await isDetached(root) && await orphanHead(root)) throw userError(tr('msg.expert.orphanCommits'));
  // files hidden from git's status by a flag would be replaced without it noticing
  const flagged = nul((await git(root, ['ls-files', '-v', '-z'])).stdout).filter((e) => /^[a-zS] /.test(e)).map((e) => e.slice(2));
  if (flagged.length) throw userError(tr('msg.expert.hiddenChanges', { files: names(flagged) }));
  if (target) {
    // a file the other branch tracks and this one does not, that already exists here (ignored or not), would be overwritten
    const mine = new Set(nul((await git(root, ['ls-files', '-z'])).stdout));
    const theirs = nul((await git(root, ['ls-tree', '-r', '-z', '--name-only', `refs/heads/${target}`])).stdout);
    const clash = [];
    for (const f of theirs) { if (mine.has(f)) continue; try { fs.lstatSync(path.join(root, f)); clash.push(f); } catch { /* not there */ } }
    if (clash.length) throw userError(tr('msg.expert.switchOverwrite', { files: names(clash) }));
  }
}

// Local branches for the selector (read-only): name, whether it is the current one, last commit date, its remote branch.
export async function listBranches(root) {
  if (!(await isRepo(root))) return { repo: false, branches: [] };
  const r = await git(root, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)%1f%(HEAD)%1f%(committerdate:iso-strict)%1f%(upstream:short)%1f%(upstream:track)', 'refs/heads']);
  const branches = r.stdout.split('\n').filter(Boolean).slice(0, 200).map((l) => {
    const [name, head, date, upstream, track] = l.split('\x1f');
    return { name, current: head === '*', date, upstream: upstream || null, gone: /gone/.test(track ?? ''), orb: isOrbBranch(name) };
  });
  return { repo: true, branches };
}

export async function switchBranch(root, branch) {
  const name = String(branch ?? '');
  // any existing local branch, whatever its characters: what makes it safe is that it exists as typed and cannot read as an option
  if (!name || name.length > 255 || name.startsWith('-') || /[\0\r\n]/.test(name)) throw userError(tr('msg.expert.badBranch'));
  if (!(await isRepo(root))) throw userError(tr('msg.expert.noRepo'));
  const all = (await git(root, ['for-each-ref', '--format=%(refname)%00', 'refs/heads'])).stdout.split('\0').map((s) => s.trim());
  if (!all.includes(`refs/heads/${name}`)) throw userError(tr('msg.expert.noBranch', { branch: name }));
  if (isOrbBranch(name)) throw userError(tr('msg.expert.orbBranch'));
  const now = (await git(root, ['branch', '--show-current'])).stdout.trim();
  if (now === name) return { ok: true, branch: name, from: now, already: true };
  const top = (await git(root, ['rev-parse', '--show-toplevel'])).stdout.trim();
  if ((await worktreesOf(root)).some((w) => w.ref === `refs/heads/${name}` && !samePath(w.at, top))) throw userError(tr('msg.expert.branchElsewhere', { branch: name }));
  await readyToSwitch(root, name);
  const r = await git(root, ['switch', '--no-guess', '--no-overwrite-ignore', name]);
  if (r.status !== 0) throw userError(tr('msg.expert.switchFailed', { detail: redactSecrets(r.stderr).trim().slice(0, 300) }));
  return { ok: true, branch: name, from: now, already: false };
}

export async function createBranch(root, name, { switchTo = false } = {}) {
  const b = plainBranch(name);
  if (!(await isRepo(root))) throw userError(tr('msg.expert.noRepo'));
  if ((await git(root, ['check-ref-format', '--branch', b])).status !== 0) throw userError(tr('msg.expert.badBranch'));
  if (!(await hasHead(root))) throw userError(tr('msg.expert.noCommits'));
  if ((await git(root, ['rev-parse', '--verify', '-q', `refs/heads/${b}`])).status === 0) throw userError(tr('msg.expert.branchExists', { branch: b }));
  const from = (await git(root, ['branch', '--show-current'])).stdout.trim();
  // The new branch starts at HEAD, so nothing in the tree changes; the switch is then only a move of HEAD. Still checked as a
  // switch: a half-done operation or a detached head would be left behind.
  if (switchTo) { await ownRepo(root); if (await operationInProgress(root)) throw userError(tr('msg.expert.inProgress')); if (await isDetached(root) && await orphanHead(root)) throw userError(tr('msg.expert.orphanCommits')); }
  const r = await git(root, switchTo ? ['switch', '--no-guess', '--no-overwrite-ignore', '-c', b] : ['branch', b, 'HEAD']);
  if (r.status !== 0) throw userError(tr('msg.expert.switchFailed', { detail: redactSecrets(r.stderr).trim().slice(0, 300) }));
  return { ok: true, branch: b, from, switched: switchTo };
}

// The last save and whether it can be undone: only a commit that no remote branch has, that is not a merge and has a parent,
// on a branch (not a detached head), in the project's own repository and with no merge or rebase half done.
export async function lastCommit(root) {
  if (!(await isRepo(root)) || !(await hasHead(root))) return { repo: false, canUndo: false, reason: 'none' };
  const hash = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const subject = (await git(root, ['log', '-1', '--pretty=format:%s'])).stdout.trim();
  const parents = (await git(root, ['rev-list', '--parents', '-n', '1', 'HEAD'])).stdout.trim().split(/\s+/).length - 1;
  const base = { repo: true, hash, short: hash.slice(0, 7), subject };
  const top = (await git(root, ['rev-parse', '--show-toplevel'])).stdout.trim();
  if (!top || !samePath(top, root)) return { ...base, canUndo: false, reason: 'shared' };
  if (await isDetached(root)) return { ...base, canUndo: false, reason: 'detached' };
  if (await operationInProgress(root)) return { ...base, canUndo: false, reason: 'busy' };
  if (parents === 0) return { ...base, canUndo: false, reason: 'first' };
  if (parents > 1) return { ...base, canUndo: false, reason: 'merge' };
  const remote = (await git(root, ['branch', '-r', '--contains', 'HEAD'])).stdout.trim();
  if (remote) return { ...base, canUndo: false, reason: 'pushed' };
  return { ...base, canUndo: true, reason: null };
}

export async function undoCommit(root, expect) {
  const last = await lastCommit(root);
  if (!last.repo) throw userError(tr('msg.expert.noCommits'));
  if (expect && expect !== last.hash) throw userError(tr('msg.expert.undoMoved'));
  if (!last.canUndo) throw userError({ first: tr('msg.expert.undoFirst'), merge: tr('msg.expert.undoMerge'), pushed: tr('msg.expert.undoPushed'), shared: tr('msg.expert.sharesRepo'), detached: tr('msg.expert.undoDetached'), busy: tr('msg.expert.inProgress') }[last.reason]);
  const r = await git(root, ['reset', '--soft', 'HEAD~1']);
  if (r.status !== 0) throw userError(tr('msg.expert.switchFailed', { detail: redactSecrets(r.stderr).trim().slice(0, 300) }));
  return { ok: true, hash: last.hash, subject: last.subject };
}

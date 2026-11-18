// Where a task works.
// - "carpeta" (the default): the project folder itself, one writing task at a time per project, so every agent sees the
//   latest files. Before each task Orb takes a checkpoint (a hidden git ref, or a file copy without git) and the panel can
//   undo exactly the files that task changed.
// - "aislada": a git worktree on its own branch, for experiments or parallel work that must not collide. It starts from the
//   branch of the task it depends on, or from what is really in the folder (uncommitted work included, never secrets).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { isSecretPath, redactSecrets, porcelainPaths } from '../../shared/secrets-scan.mjs';
import { tr } from '../../platform/context.mjs';
import { git, gitEnv, gitAsync, gitBuffer, gitBufferAsync, slug, BRANCH_PREFIX, REF_PREFIX, ORB_GIT, isGitRepo, repoRoot } from '../../platform/git.mjs';

// The logic of the functions that ask git many things (snapshot, diff, join) is written once as a generator that yields each
// request to git, { env, args, buffer }, and gets the answer back. runSync answers with the synchronous git (launch, tests);
// runAsync with the asynchronous one (what the engine does while the app is open), so both do exactly the same.
const ask = (env, ...args) => ({ env, args });
const askBuffer = (...args) => ({ args, buffer: true });
function runSync(repo, flow) {
  let step = flow.next();
  while (!step.done) { const { env, args, buffer } = step.value; step = flow.next(buffer ? gitBuffer(repo, ...args) : gitEnv(repo, env ?? {}, ...args)); }
  return step.value;
}
async function runAsync(repo, flow) {
  let step = flow.next();
  while (!step.done) { const { env, args, buffer } = step.value; step = flow.next(buffer ? await gitBufferAsync(repo, ...args) : await gitAsync(repo, env ?? {}, ...args)); }
  return step.value;
}
// A commit with the folder exactly as it is now (committed + modified + new files not ignored), on top of HEAD.
// Built with a temporary index, so the user's own index and files are never touched. Secret-looking files stay out, and that is
// checked on the result: if one is still inside, no snapshot is made. Returns { commit, files } (files = paths not in HEAD as-is),
// or null on failure. always=false returns null when there is nothing uncommitted.
// raw (the checkpoints): every file as it is on disk, byte for byte. core.autocrlf is off for it, and the tracked
// files are hashed again (not taken from the stat cache, which may hold the normalized form of a file now written with
// other line endings), so «Deshacer» gives back LF, CRLF or mixed endings exactly. The attributes (.gitattributes) still apply.
export const RAW_GIT = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false'];
// The raw snapshots keep their own index next to git's (`.git/orb/index-raw`, per worktree): its stat cache holds the
// raw blobs, so the next raw snapshot hashes again only the files that changed since the last one. Hashing every
// tracked file again (`add --renormalize`) happens once per repository, the first time; measured on 10 000 files of
// 4 KB: 5,9 s → 0,6 s per snapshot, and the engine is synchronous while it takes one.
export const RAW_INDEX = 'orb/index-raw';
export const snapshotCommit = (repo, opts = {}) => runSync(repo, snapshotFlow(repo, opts));
export const snapshotCommitAsync = (repo, opts = {}) => runAsync(repo, snapshotFlow(repo, opts));
function* snapshotFlow(repo, { raw = false, always: wanted = false, message = 'orb: punto de partida (lo que había en la carpeta principal sin commitear; no es trabajo del agente)' } = {}) {
  const status = yield ask({}, 'status', '--porcelain=v1', '-z', '-uall');
  const changed = status.status === 0 ? porcelainPaths(status.stdout) : null; if (changed === null) return null;
  // A repository without any commit yet (git init and nothing more): the snapshot is a first commit with no parent, and it
  // is always made, since checkpoints and isolated copies need something to start from.
  const head = (yield ask({}, 'rev-parse', '--verify', '--quiet', 'HEAD')).stdout.trim();
  const always = wanted || !head;
  if (!changed.length && !always) return null;
  // both index paths in one process: every git call is ~90 ms on Windows
  const paths = (yield ask({}, 'rev-parse', '--git-path', 'index', ...(raw ? ['--git-path', RAW_INDEX] : []))).stdout.split('\n').map((l) => l.trim());
  const realIndex = path.resolve(repo, paths[0]);
  const rawIndex = raw ? path.resolve(repo, paths[1]) : null;
  const startedAt = raw ? fsNow(rawIndex) : 0;
  const tmp = path.join(os.tmpdir(), `orb-index-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    const env = { GIT_INDEX_FILE: tmp };
    const cfg = raw ? RAW_GIT : [];
    // Fill the temporary index: from the last raw snapshot's index when there is one (only changed files are read), else
    // from the user's index plus a full renormalization. A raw index git cannot use any more is dropped and rebuilt.
    // `add -A` skips what .gitignore ignores, and a raw index written before `git add -f` + commit does not hold such a file,
    // so the snapshot would miss a tracked file and a rewind would delete it. Files of HEAD missing from the temporary
    // index and still on disk are put back; the ones gone from disk are the user's deletions and stay out. HEAD only
    // gets the check when it moved since the raw index was written, which spares two git calls per snapshot.
    // The marker names the HEAD and the exact index file (its trailing checksum) it was reconciled with, so another snapshot
    // replacing the index between our copy and our read can never make us skip a check that our copy still needs.
    const headFile = raw ? `${rawIndex}.head` : null;
    let reconciled = false;
    // Folders to check for names that differ only in letter case: those touched since the raw index was written (0 = all).
    let since = 0;
    const restoreForced = function* (seedTail) {
      let seen = null; try { seen = fs.readFileSync(headFile, 'utf8').trim(); } catch { /* none yet: check */ }
      if (seedTail && seen === `${head}:${seedTail}`) return true;
      const out = yield ask(env, ...cfg, 'diff-index', '--cached', '--name-only', '-z', '--diff-filter=D', head);
      if (out.status !== 0) return false;
      // Only plain files and links: a directory now standing where HEAD had a file would drag in everything inside it
      // (secrets, dependencies), and a path behind a linked directory cannot be added at all.
      const parents = new Map();
      const behindLink = (f) => {
        const dir = path.dirname(f); if (dir === '.') return false;
        if (!parents.has(dir)) { let bad = behindLink(dir); if (!bad) { try { bad = !fs.lstatSync(path.join(repo, dir)).isDirectory(); } catch { bad = true; } } parents.set(dir, bad); }
        return parents.get(dir);
      };
      const back = out.stdout.split('\0').filter((f) => {
        if (!f || behindLink(f)) return false;
        try { const st = fs.lstatSync(path.join(repo, f)); return st.isFile() || st.isSymbolicLink(); } catch { return false; }
      });
      for (let i = 0; i < back.length;) {
        let size = 0; const batch = [];
        while (i < back.length && (!batch.length || size + back[i].length < 24000)) { size += back[i].length + 1; batch.push(back[i++]); }
        // a failure keeps the warm index but leaves the marker unwritten, so the next snapshot tries again
        if ((yield ask(env, ...cfg, '--literal-pathspecs', 'add', '-f', '--', ...batch)).status !== 0) return false;
      }
      return true;
    };
    const stage = function* (seed) {
      fs.rmSync(tmp, { force: true });
      if (seed && fs.existsSync(seed)) fs.copyFileSync(seed, tmp);
      const seedTail = raw && seed === rawIndex ? indexId(tmp) : null;
      since = seedTail ? scanSince(rawIndex, seedTail) : 0;
      if ((yield ask(env, ...cfg, 'add', '-A')).status !== 0) return false;
      if (raw && seed === rawIndex && head) reconciled = yield* restoreForced(seedTail);
      return !raw || seed === rawIndex || (yield ask(env, ...cfg, 'add', '--renormalize', '--', '.')).status === 0;
    };
    const warm = raw && fs.existsSync(rawIndex);
    const warmOk = warm && (yield* stage(rawIndex));
    if (!warmOk) { reconciled = false; if (warm) fs.rmSync(rawIndex, { force: true }); if (!(yield* stage(realIndex))) return null; }
    // Remove anything secret-looking from the snapshot (also files already tracked by mistake) and verify.
    const listed = function* () { return (yield ask(env, 'ls-files', '-z')).stdout.split('\0').filter(Boolean); };
    let files = yield* listed();
    let allDirs = null;
    if (raw) {
      // `add -A` keeps the old spelling of a file the user renamed only in letter case when core.ignorecase is on
      if (!foldsCase.has(repo)) foldsCase.set(repo, (yield ask({}, 'config', '--bool', 'core.ignorecase')).stdout.trim() === 'true');
      if (foldsCase.get(repo)) {
        allDirs = dirsOf(files);
        const moves = caseMovesSync(repo, files, changedDirs(repo, allDirs, since));
        if (moves.length) {
          let ok = true;
          for (const batch of inBatches(moves.map((m) => m[0]))) ok = ((yield ask(env, ...cfg, '--literal-pathspecs', 'rm', '-q', '--cached', '--ignore-unmatch', '--', ...batch)).status === 0) && ok;
          for (const batch of inBatches(moves.map((m) => m[1]))) ok = ((yield ask(env, ...cfg, '--literal-pathspecs', 'add', '-f', '--', ...batch)).status === 0) && ok;
          if (!ok) return null;
          files = yield* listed(); allDirs = dirsOf(files);
        }
      }
    }
    const secret = files.filter(isSecretPath);
    for (const file of secret) yield ask(env, 'rm', '-q', '--cached', '--ignore-unmatch', '--', file);
    // the check only means something after a removal: with none, the index is the list just read
    if (secret.length && (yield* listed()).some(isSecretPath)) return null;
    const tree = (yield ask(env, 'write-tree')).stdout.trim(); if (!tree) return null;
    // the marker is written only when HEAD's files are known to be in the index; a cold start or a failed restore leaves it out so the next snapshot checks
    if (raw) keepRawIndex(tmp, rawIndex, reconciled ? head : null, startedAt, allDirs);
    if (!always && head && tree === (yield ask({}, 'rev-parse', 'HEAD^{tree}')).stdout.trim()) return null;
    const commit = (yield ask(env, ...ORB_GIT, 'commit-tree', tree, ...(head ? ['-p', head] : []), '-m', message)).stdout.trim();
    return commit ? { commit, files: changed.length } : null;
  } finally { fs.rmSync(tmp, { force: true }); }
}
// the raw index trusts a file's date and size, as git does: a file changed and given back its
// date and size, or a raw index written by hand, slips past the fast snapshot. The rare actions that must not be fooled
// («Deshacer», the diff of a task held for review) take this one instead: a fresh index from HEAD (no stat cache, no
// skip-worktree bits), every file read and hashed again, with git off the event loop (10 000 files: seconds, the engine
// keeps answering). Its index becomes the raw index, whatever the old one said. Secrets stay out, as above. → { commit } | null
export async function fullSnapshot(repo, { message }) {
  const tmp = path.join(os.tmpdir(), `orb-index-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  const run = (...args) => gitAsync(repo, { GIT_INDEX_FILE: tmp }, ...args);
  try {
    const rawIndex = path.resolve(repo, (await gitAsync(repo, {}, 'rev-parse', '--git-path', RAW_INDEX)).stdout.trim());
    const startedAt = fsNow(rawIndex);
    const head = (await run('rev-parse', '--verify', '--quiet', 'HEAD')).stdout.trim();
    if (head && (await run('read-tree', head)).status !== 0) return null;
    if ((await run(...RAW_GIT, 'add', '-A')).status !== 0) return null;
    const listed = async () => (await run('ls-files', '-z')).stdout.split('\0').filter(Boolean);
    let files = await listed();
    const folds = await foldsCaseOf(repo);
    let allDirs = folds ? dirsOf(files) : null;
    const moves = folds ? await caseMovesAsync(repo, files, changedDirs(repo, allDirs, 0)) : [];
    if (moves.length) {
      let ok = true;
      for (const batch of inBatches(moves.map((m) => m[0]))) ok = ((await run(...RAW_GIT, '--literal-pathspecs', 'rm', '-q', '--cached', '--ignore-unmatch', '--', ...batch)).status === 0) && ok;
      for (const batch of inBatches(moves.map((m) => m[1]))) ok = ((await run(...RAW_GIT, '--literal-pathspecs', 'add', '-f', '--', ...batch)).status === 0) && ok;
      if (!ok) return null;
      files = await listed(); allDirs = dirsOf(files);
    }
    const secret = files.filter(isSecretPath);
    for (const file of secret) await run('rm', '-q', '--cached', '--ignore-unmatch', '--', file);
    if (secret.length && (await listed()).some(isSecretPath)) return null;
    const tree = (await run('write-tree')).stdout.trim(); if (!tree) return null;
    keepRawIndex(tmp, rawIndex, head, startedAt, allDirs);
    const commit = (await run(...ORB_GIT, 'commit-tree', tree, ...(head ? ['-p', head] : []), '-m', message)).stdout.trim();
    return commit ? { commit } : null;
  } finally { fs.rmSync(tmp, { force: true }); }
}
// What a fast snapshot `after` missed, by a full one taken later: files whose content now is not the one it recorded
// although their date says nobody wrote them after it was taken (at: when it started; an older one without it, its
// commit's second). A file written after it (the user's later edit) has a newer date and is not counted. → [{ status, path }]
export function missedBy(repo, after, full) {
  const at = after.at ?? Number(git(repo, 'show', '-s', '--format=%ct', after.commit).stdout.trim()) * 1000;
  return changedBetween(repo, after.commit, full.commit).filter((c) => {
    if (isSecretPath(c.path)) return false;
    try { return fs.statSync(path.join(repo, c.path)).mtimeMs < at; } catch { return false; } // gone: git always sees that
  });
}
// Whole or not at all (another snapshot may be reading it): written beside and renamed over. Losing it only costs time.
// A hash of the whole index file identifies that exact file. Its own trailing checksum is not enough: with index.skipHash
// (turned on by feature.manyFiles) git writes it as zeros, and two different indexes may then end alike.
export const indexId = (file) => {
  try { return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex'); } catch { return null; }
};
// head: the HEAD the index was reconciled with (see restoreForced), kept beside it together with the index's checksum;
// without one the marker is dropped. scanAt: when this snapshot started, kept the same way for the letter-case check.
function keepRawIndex(tmp, rawIndex, head = null, scanAt = null, dirs = null) {
  const part = `${rawIndex}.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.mkdirSync(path.dirname(rawIndex), { recursive: true });
    fs.rmSync(`${rawIndex}.head`, { force: true }); fs.rmSync(`${rawIndex}.scan`, { force: true });
    fs.copyFileSync(tmp, part); fs.renameSync(part, rawIndex);
    const tail = indexId(tmp);
    if (tail && head) { fs.writeFileSync(part, `${head}:${tail}`); fs.renameSync(part, `${rawIndex}.head`); }
    if (tail && scanAt) { fs.writeFileSync(part, `${scanAt}:${tail}`); fs.renameSync(part, `${rawIndex}.scan`); }
    // the folder list of the index just written, so the next check need not list the index again (only in this process)
    if (tail && dirs) { knownDirs.set(rawIndex, { id: tail, dirs }); if (knownDirs.size > 16) knownDirs.delete(knownDirs.keys().next().value); } else knownDirs.delete(rawIndex);
  } catch { fs.rmSync(part, { force: true }); }
}

// ---- letter-case renames
// With core.ignorecase (Windows, macOS) `add -A` leaves the old spelling in the index when a file or folder is renamed only
// in letter case, so a photo would hold the old name. A rename always changes the modification date of the folder that
// holds the name, so only the folders touched since the previous raw snapshot started are read; the folders come from the
// index list the snapshot already asked for, with no extra git process. The start time is kept in `index-raw.scan`
// together with the checksum of the index it belongs to: a raw index another snapshot replaced, or one with no such
// file, means checking every folder. The margin covers coarse file-system dates.
const foldsCase = new Map();
const knownDirs = new Map();
const SCAN_MARGIN_MS = 2000;
function scanSince(rawIndex, tail) {
  try {
    const [at, id] = fs.readFileSync(`${rawIndex}.scan`, 'utf8').trim().split(':');
    return id === tail && Number(at) > 0 ? Number(at) - SCAN_MARGIN_MS : 0;
  } catch { return 0; }
}
// every folder holding an index entry, ancestors included, as the index spells them ('' is the root)
function dirsOf(files) {
  const all = new Set();
  for (const f of files) {
    let dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
    while (!all.has(dir)) { all.add(dir); if (!dir) break; dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''; }
  }
  return all;
}
function changedDirs(repo, all, since) {
  const dirs = new Set();
  for (const dir of all) {
    let hit = since <= 0;
    if (!hit) { try { hit = fs.statSync(path.join(repo, dir)).mtimeMs >= since; } catch { hit = true; } }
    if (hit) dirs.add(dir);
  }
  return dirs;
}
// [[old index path, path as spelled on disk]] for the files whose name differs from the disk only in letter case;
// a name is looked up only inside the folders in `dirs` (named as the index spells them). A generator that asks its driver
// for the listing of a folder (a path relative to the repository) so that it runs both sync and async. A move is dropped
// when its target is already another entry of the index, or is not a plain file or link on disk (a folder, a submodule).
function* caseMovesFlow(repo, files, dirs) {
  const listing = new Map(); const entries = new Set(files);
  const list = function* (real) {
    if (!listing.has(real)) {
      const names = yield real;
      listing.set(real, names && { names: new Set(names), lower: new Map(names.map((n) => [n.toLowerCase(), n])) });
    }
    return listing.get(real);
  };
  const moves = [];
  for (const f of files) {
    const out = [];
    let old = ''; let real = ''; let ok = true;
    for (const name of f.split('/')) {
      let actual = name;
      if (dirs.has(old)) {
        const l = yield* list(real);
        if (!l) { ok = false; break; }
        if (!l.names.has(name)) { actual = l.lower.get(name.toLowerCase()); if (!actual) { ok = false; break; } }
      }
      out.push(actual); old = old ? `${old}/${name}` : name; real = real ? `${real}/${actual}` : actual;
    }
    const now = out.join('/');
    if (!ok || now === f || entries.has(now)) continue;
    try { const st = fs.lstatSync(path.join(repo, now)); if (st.isFile() || st.isSymbolicLink()) moves.push([f, now]); } catch { /* gone meanwhile */ }
  }
  return moves;
}
function caseMovesSync(repo, files, dirs) {
  const flow = caseMovesFlow(repo, files, dirs);
  for (let r = flow.next(); ; ) {
    if (r.done) return r.value;
    let names = null; try { names = fs.readdirSync(path.join(repo, r.value)); } catch { /* gone */ }
    r = flow.next(names);
  }
}
async function caseMovesAsync(repo, files, dirs) {
  const flow = caseMovesFlow(repo, files, dirs);
  for (let r = flow.next(); ; ) {
    if (r.done) return r.value;
    let names = null; try { names = await fs.promises.readdir(path.join(repo, r.value)); } catch { /* gone */ }
    r = flow.next(names);
  }
}
// core.ignorecase of a repository, asked once.
async function foldsCaseOf(repo) {
  if (!foldsCase.has(repo)) foldsCase.set(repo, (await gitAsync(repo, {}, 'config', '--bool', 'core.ignorecase')).stdout.trim() === 'true');
  return foldsCase.get(repo);
}
// True when the folder holds a file named in another letter case than a photo made from this raw index would say, so the
// last photo cannot be reused. `index` is a copy of the raw index (the caller's temporary one).
export async function caseRenamed(repo, rawIndex, index) {
  if (!(await foldsCaseOf(repo))) return false;
  // the id of the copy that was compared, not of the raw index as it is now: another snapshot may have replaced it since
  const id = indexId(index);
  const since = scanSince(rawIndex, id);
  const listIndex = async () => (await gitAsync(repo, { GIT_INDEX_FILE: index }, 'ls-files', '-z')).stdout.split('\0').filter(Boolean);
  const known = knownDirs.get(rawIndex);
  let files = null;
  let all = known && known.id === id ? known.dirs : null;
  if (!all) { files = await listIndex(); all = dirsOf(files); }
  const dirs = changedDirs(repo, all, since);
  if (!dirs.size) return false; // the usual case: no folder was touched since the last photo
  files ??= await listIndex();
  return (await caseMovesAsync(repo, files, dirs)).length > 0;
}
// The file system's own clock: the date of a file written now, so a folder's date and this stamp are comparable even on a
// network drive whose clock differs from ours.
function fsNow(rawIndex) {
  const probe = `${rawIndex}.probe.${process.pid}.${crypto.randomBytes(3).toString('hex')}`;
  try {
    fs.mkdirSync(path.dirname(rawIndex), { recursive: true });
    fs.writeFileSync(probe, ''); return fs.statSync(probe).mtimeMs;
  } catch { return Date.now(); } finally { fs.rmSync(probe, { force: true }); }
}
function* inBatches(list) {
  for (let i = 0; i < list.length;) {
    let size = 0; const batch = [];
    while (i < list.length && (!batch.length || size + list[i].length < 24000)) { size += list[i].length + 1; batch.push(list[i++]); }
    yield batch;
  }
}

// Blob ids of `paths` in `commit`, in one git process per batch.
function blobsOf(repo, commit, paths) {
  const ids = new Set();
  for (const batch of inBatches(paths)) {
    const out = git(repo, '--literal-pathspecs', 'ls-tree', '-r', '-z', commit, '--', ...batch);
    for (const entry of out.stdout.split('\0')) { const m = /^\d+ blob ([0-9a-f]+)\t/.exec(entry); if (m) ids.add(m[1]); }
  }
  return ids;
}
// True when a folder between the repository and the file was created or changed (date of the folder itself) at or after `since`.
function newFolderAbove(repo, rel, since) {
  for (let dir = path.dirname(rel); dir && dir !== '.'; dir = path.dirname(dir)) {
    try { const st = fs.lstatSync(path.join(repo, dir)); if (Math.max(st.birthtimeMs, st.ctimeMs) >= since) return true; } catch { return false; }
  }
  return false;
}

// ---- checkpoints of the "carpeta" mode
// Git: a hidden ref (refs/orb/…), invisible in the user's branches and log, that keeps the snapshot from being garbage collected.
// Without git: a copy of the folder in backups/checkpoints (without node_modules, .git, secrets or files over 50 MB).
export function takeCheckpoint(dir, name, backups) {
  if (isGitRepo(dir)) {
    const top = repoRoot(dir);
    const snap = snapshotCommit(top, { raw: true, always: true, message: `orb: foto ${name}` });
    if (!snap) throw new Error(tr('msg.workspace.noSnapshot'));
    git(top, 'update-ref', `${REF_PREFIX}/${name}`, snap.commit);
    return { kind: 'git', repo: top, ref: `${REF_PREFIX}/${name}`, commit: snap.commit, raw: true };
  }
  const target = path.join(backups, name);
  fs.rmSync(target, { recursive: true, force: true });
  copyTree(dir, target);
  return { kind: 'copia', dir, copy: target, at: Date.now() - 2000 };
}

const MAX_COPY_FILE = 50 * 1024 * 1024;
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true, force: true, dereference: false, filter: (src) => {
    const rel = path.relative(from, src).replace(/\\/g, '/');
    if (!rel) return true;
    if (/(^|\/)(\.git|node_modules)(\/|$)/.test(rel) || isSecretPath(rel)) return false;
    try { const st = fs.lstatSync(src); return !st.isSymbolicLink() && (st.isDirectory() || st.size <= MAX_COPY_FILE); } catch { return false; }
  } });
}

// Files a task changed: [{ status: 'A'|'M'|'D', path }] between the checkpoint before and the one after (git paths).
export const changedBetween = (repo, before, after) => runSync(repo, changedFlow(before, after));
export const changedBetweenAsync = (repo, before, after) => runAsync(repo, changedFlow(before, after));
function* changedFlow(before, after) {
  const r = yield ask({}, 'diff', '--name-status', '-z', '--no-renames', before, after);
  const parts = r.stdout.split('\0'); const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) if (parts[i]) out.push({ status: parts[i][0], path: parts[i + 1] });
  return out;
}

// what a task changed, file by file, for the window's diff panel. Read only: one `git diff` between the checkpoint
// before the task and the one after (commits, so line endings and the user's index never matter). Secret-looking paths
// are left out (the snapshots already keep them out) and secret-looking text in the patches is hidden. Each file's patch and the whole answer are capped, and a binary file
// has no patch. → { files: [{ status, path, added, removed, binary, patch, cut }], more, hidden } (hidden: changed files not shown because they look like secrets)
export function diffBetween(repo, before, after, { maxFiles = 300, maxPatch = 200_000, maxTotal = 2_000_000 } = {}) {
  const range = ['--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', before, after]; // never a program of the project
  const stats = git(repo, 'diff', '--numstat', '-z', ...range);
  if (stats.status !== 0) throw new Error(oneLineOf(stats.stderr) || 'git diff');
  // --numstat -z: «added\tremoved\tpath\0» per file, in the same order as the patch below.
  const list = stats.stdout.split('\0').filter(Boolean).map((row) => {
    const [added, removed, ...rest] = row.split('\t');
    return { path: rest.join('\t'), binary: added === '-', added: Number(added) || 0, removed: Number(removed) || 0 };
  });
  const status = new Map(changedBetween(repo, before, after).map((c) => [c.path, c.status]));
  const whole = git(repo, 'diff', ...range);
  const parts = whole.status === 0 ? whole.stdout.split(/^(?=diff --git )/m).filter((p) => p.startsWith('diff --git ')) : [];
  const patches = parts.length === list.length ? parts : null; // never a patch next to the wrong file
  const files = []; let total = 0;
  list.forEach((f, i) => {
    if (isSecretPath(f.path) || files.length >= maxFiles) return;
    // a key written in an ordinary file (a token in a config.js) is hidden too, as in the chat:
    // the diff also goes to a linked phone.
    let patch = f.binary || !patches ? '' : redactSecrets(patches[i]);
    const cut = patch.length > maxPatch || total + patch.length > maxTotal;
    if (cut) patch = '';
    total += patch.length;
    files.push({ status: status.get(f.path) ?? 'M', ...f, patch, cut });
  });
  return { files, more: list.filter((f) => !isSecretPath(f.path)).length - files.length, hidden: list.filter((f) => isSecretPath(f.path)).length };
}

// One file of that diff whole, before and after the task, for the «Antes» / «Después» views. Only a path the diff itself lists
// (never any other file of the repository), no secret-looking path, never a program of the project (cat-file applies no
// textconv). A side over maxBytes is not read at all: { tooBig: true }. A binary file is told apart, not shown.
// → { path, status, binary, tooBig, before, after } (a side that does not exist is null).
export function fileBetween(repo, before, after, file, { maxBytes = 512 * 1024 } = {}) {
  const rel = String(file ?? '').replace(/\\/g, '/');
  const bad = (key) => Object.assign(new Error(tr(key)), { userFacing: true });
  if (!rel || rel.includes('\0') || isSecretPath(rel) || isSecretPath(rel.toLowerCase())) throw bad('msg.api.fileNotInDiff');
  const entry = changedBetween(repo, before, after).find((c) => c.path === rel);
  if (!entry) throw bad('msg.api.fileNotInDiff');
  const out = { path: rel, status: entry.status, binary: false, tooBig: false, before: null, after: null };
  const read = (commit) => {
    const spec = `${commit}:${rel}`; // a revision, so the path is taken literally
    const size = git(repo, 'cat-file', '-s', spec);
    if (size.status !== 0) return null;
    if (Number(size.stdout.trim()) > maxBytes) { out.tooBig = true; return null; }
    const blob = gitBuffer(repo, 'cat-file', 'blob', spec);
    if (blob.status !== 0) return null;
    const buf = blob.stdout;
    if (buf.subarray(0, 8000).includes(0)) { out.binary = true; return null; }
    return redactSecrets(buf.toString('utf8'));
  };
  if (entry.status !== 'A') out.before = read(before);
  if (entry.status !== 'D') out.after = read(after);
  if (out.binary || out.tooBig) { out.before = null; out.after = null; }
  return out;
}

// The line counts of diffBetween without its patches: the same range and options, one `git diff --numstat`, so the numbers
// are the ones the patch shows. Read only. → { files: [{ status, path, added, removed, binary }], more } (secret-looking paths left out, as in
// diffBetween), at most maxFiles of them; `more` is how many were left past the cap, `hidden` how many were left out as secrets.
export const statBetween = (repo, before, after, opts) => finishStat(runSync(repo, statFlow(before, after)), opts);
export const statBetweenAsync = async (repo, before, after, opts) => finishStat(await runAsync(repo, statFlow(before, after)), opts);
function* statFlow(before, after) {
  const r = yield ask({}, 'diff', '--numstat', '-z', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', before, after);
  if (r.status !== 0) throw new Error(oneLineOf(r.stderr) || 'git diff');
  const status = new Map((yield* changedFlow(before, after)).map((c) => [c.path, c.status]));
  return r.stdout.split('\0').filter(Boolean).map((row) => {
    const [added, removed, ...rest] = row.split('\t');
    const path = rest.join('\t');
    return { status: status.get(path) ?? 'M', path, binary: added === '-', added: Number(added) || 0, removed: Number(removed) || 0 };
  });
}
function finishStat(list, { maxFiles = 300 } = {}) {
  const shown = list.filter((f) => !isSecretPath(f.path));
  return { files: shown.slice(0, maxFiles), more: Math.max(0, shown.length - maxFiles), hidden: list.length - shown.length };
}

const walkFiles = (root, rel = '') => fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => {
  const r = rel ? `${rel}/${e.name}` : e.name;
  if (/(^|\/)(\.git|node_modules)$/.test(r) || isSecretPath(r) || e.isSymbolicLink()) return [];
  return e.isDirectory() ? walkFiles(root, r) : [r];
});
const statOf = (file) => { try { const st = fs.statSync(file); return [Math.round(st.mtimeMs), st.size]; } catch { return null; } };
const stateKey = (s) => (s ? s.join(':') : '');

// Without git: date and size of every file the copy would hold, taken when the task ends, so undo can tell what the task
// left from what the user changed after it. Stats only, no reads, and async so the engine loop never waits on a big folder.
export async function treeState(dir) {
  const files = {};
  const walk = async (rel) => {
    let entries; try { entries = await fs.promises.readdir(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (/(^|\/)(\.git|node_modules)$/.test(r) || isSecretPath(r) || e.isSymbolicLink()) continue;
      if (e.isDirectory()) { await walk(r); continue; }
      try { const st = await fs.promises.stat(path.join(dir, r)); files[r] = [Math.round(st.mtimeMs), st.size]; } catch { /* gone meanwhile */ }
    }
  };
  await walk('');
  return files;
}

// The per-file map lives beside the copy, not in the board setting: it can weigh megabytes and the setting is parsed on
// every task read. Written to a temp file and renamed so a crash never leaves half a JSON that undo would trust.
export const stateFileOf = (copy) => `${copy}.estado.json`;
export async function saveTreeState(file, at, files) {
  const tmp = `${file}.tmp`;
  try { await fs.promises.writeFile(tmp, JSON.stringify({ at, files })); await fs.promises.rename(tmp, file); }
  catch (error) { await fs.promises.rm(tmp, { force: true }).catch(() => {}); throw error; }
}
export const dropTreeState = (copy) => { for (const f of [stateFileOf(copy), `${stateFileOf(copy)}.tmp`]) { try { fs.rmSync(f, { force: true }); } catch { /* best effort */ } } };
// The map of an "after" mark, or null (never written, unreadable, or from another round: its `at` must match).
function loadTreeState(after) {
  if (after?.files) return after.files;
  if (!after?.state) return null;
  try { const j = JSON.parse(fs.readFileSync(after.state, 'utf8')); return j?.at === after.at && j.files && typeof j.files === 'object' ? j.files : null; } catch { return null; }
}
// Slack for filesystem timestamp granularity (FAT rounds mtimes up to 2 s): the task's own writes all happen before
// `after.at`, so anything newer than that plus this slack was written by somebody else.
const MTIME_SLACK_MS = 2000;

// Undo a task in "carpeta" mode: only the files it changed go back to how they were before it. A file that somebody changed
// again after the task is left alone and reported. Never touches git history, branches or the index.
// only: a Set of paths to limit it to (the files a fast snapshot missed, after a full one).
// madeAfter: ms timestamp; a file that is in `after` but not in `before` is only removed when it was created after it. One
// that already existed (e.g. it was ignored when `before` was taken and stopped being ignored later) or whose creation date
// cannot be trusted is kept and reported.
// safe: a file behind a link or junction is skipped, and a file that cannot be written or removed is reported in `skipped`
// instead of stopping the whole undo (a conversation's rewind must always finish so that it can itself be undone).
export function undoCheckpoint(before, after, { only = null, safe = false, madeAfter = null } = {}) {
  const restored = []; const removed = []; const skipped = []; const kept = [];
  if (before.kind === 'git') {
    const repo = before.repo; const cfg = before.raw ? RAW_GIT : []; // a raw checkpoint is read and compared raw
    const attempt = (rel, write) => { try { write(); return true; } catch (error) { if (!safe) throw error; skipped.push(rel); return false; } };
    const list = changedBetween(repo, before.commit, after.commit).filter((c) => !only || only.has(c.path));
    // On a file system that ignores letter case, a file renamed only in case shows up as a deleted path and an added one that
    // are the same file on disk: removing the added one would delete the file for good, so such a pair is put back by renaming.
    const twins = caseTwins(list, (a, b) => sameFile(path.join(repo, a), path.join(repo, b)));
    const respelled = new Set();
    let deletedBlobs = null;
    for (const { status, path: rel } of list) {
      const file = path.join(repo, rel);
      if (twins.has(rel)) {
        // the pair is handled once, from its added path (the spelling the folder has now)
        if (status !== 'A') continue;
        const target = twins.get(rel);
        if (safe && (!linkFree(repo, file) || !linkFree(repo, path.join(repo, target)))) { skipped.push(target); continue; }
        const blobAfter = git(repo, 'rev-parse', '--verify', '--quiet', `${after.commit}:${rel}`).stdout.trim();
        if (![cfg, ...(cfg.length ? [[]] : [])].some((c) => git(repo, ...c, 'hash-object', '--', file).stdout.trim() === blobAfter)) { skipped.push(target); continue; }
        const old = gitBuffer(repo, ...cfg, 'cat-file', '--filters', `${before.commit}:${target}`);
        if (old.status !== 0) { skipped.push(target); continue; }
        try { respellPath(repo, rel, target, respelled); fs.writeFileSync(path.join(repo, target), old.stdout); restored.push(target); }
        catch (error) { if (!safe) throw error; skipped.push(`${target}: ${error.message}`); }
        continue;
      }

      if (safe && !linkFree(repo, file)) { skipped.push(rel); continue; }
      const nowExists = fs.existsSync(file);
      const blobAfter = git(repo, 'rev-parse', '--verify', '--quiet', `${after.commit}:${rel}`).stdout.trim();
      // (The snapshot after may have been taken either way: an older one, normalized.)
      const same = nowExists ? [cfg, ...(cfg.length ? [[]] : [])].some((c) => git(repo, ...c, 'hash-object', '--', file).stdout.trim() === blobAfter) : blobAfter === '';
      // a file the task removed that is on disk and already as it was before: nothing to put back (a rewind kept it)
      if (!same && status === 'D' && nowExists && !blobAfter && [cfg, ...(cfg.length ? [[]] : [])].some((c) => git(repo, ...c, 'hash-object', '--', file).stdout.trim() === git(repo, 'rev-parse', '--verify', '--quiet', `${before.commit}:${rel}`).stdout.trim())) continue;
      if (!same) { skipped.push(rel); continue; } // changed again after the task: the user decides
      // Only a file the task created is removed; whatever else cannot be read back is left alone and reported.
      if (status === 'A') {
        // never remove a path whose letter-case twin is on the list and still on disk: on a file system that ignores case
        // it may be the very same file, and when that cannot be told the file is left alone
        const low = rel.toLowerCase();
        if (nowExists && list.some((c) => c.status !== 'A' && c.path !== rel && c.path.toLowerCase() === low && fs.existsSync(path.join(repo, c.path)))) { skipped.push(rel); continue; }
        if (nowExists && madeAfter !== null) {
          // Made by the turn: created after the cutoff. A file that already existed and was written during the turn is kept.
          // One brought from elsewhere or renamed keeps its creation and write dates but gets a new change date: removed.
          // A file inside a moved folder keeps all three, so there the content of a deleted file and a folder that is new
          // (or changed) since the cutoff stand for the move.
          let st = null; try { st = fs.lstatSync(file); } catch { /* unreadable: keep it */ }
          const made = st && (st.birthtimeMs >= madeAfter || (st.mtimeMs < madeAfter && st.ctimeMs >= madeAfter));
          if (st && !made && st.mtimeMs < madeAfter && blobAfter) {
            deletedBlobs ??= blobsOf(repo, before.commit, list.filter((c) => c.status === 'D').map((c) => c.path));
            if (deletedBlobs.has(blobAfter) && newFolderAbove(repo, rel, madeAfter)) { /* a moved file: remove it */ } else { kept.push(rel); continue; }
          } else if (!made) { kept.push(rel); continue; }
        }
        if (nowExists && attempt(rel, () => fs.rmSync(file, { force: true }))) removed.push(rel);
        continue;
      }
      // --filters: the file as it was on disk (the attributes' line endings, Git LFS), not git's stored form; a raw
      // checkpoint holds it byte for byte (core.autocrlf off).
      const old = gitBuffer(repo, ...cfg, 'cat-file', '--filters', `${before.commit}:${rel}`);
      if (old.status === 0) { if (attempt(rel, () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, old.stdout); })) restored.push(rel); }
      else skipped.push(rel);
    }
    return { restored, removed, skipped, kept };
  }
  // Copy checkpoint: files that differ from the copy come back; files the task created (not in the copy) are removed.
  // A file is the user's, not the task's, when it was written after the task ended (mtime rule, always available because
  // `after.at` is saved synchronously) or when it differs from the end-of-task map (when that background capture landed).
  // Without `after.at` (an older snapshot) everything is trusted as before.
  const end = loadTreeState(after);
  const untouched = (rel) => {
    const now = statOf(path.join(before.dir, rel));
    if (!now) return true;
    if (after?.at && now[0] > after.at + MTIME_SLACK_MS) return false;
    return !end || stateKey(now) === stateKey(end[rel]);
  };
  const inCopy = new Set(walkFiles(before.copy));
  for (const rel of inCopy) {
    const src = path.join(before.copy, rel); const dst = path.join(before.dir, rel);
    if (!fs.existsSync(dst) || !fs.readFileSync(src).equals(fs.readFileSync(dst))) {
      if (!untouched(rel)) { skipped.push(rel); continue; }
      fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); restored.push(rel);
    }
  }
  for (const rel of walkFiles(before.dir)) {
    if (inCopy.has(rel)) continue;
    const file = path.join(before.dir, rel); const st = fs.statSync(file);
    if (st.mtimeMs < before.at) continue;
    if (!untouched(rel)) { skipped.push(rel); continue; }
    if (st.size > MAX_COPY_FILE) { skipped.push(rel); continue; } // never in the copy, so it may predate the task: the user decides
    fs.rmSync(file, { force: true }); removed.push(rel);
  }
  return { restored, removed, skipped };
}

// Pairs of changed paths (a deleted one and an added one) that differ only in letter case and are one file on disk:
// Map(path -> its partner). `same(a, b)` tells whether two paths are one file on disk.
function caseTwins(list, same) {
  const byLower = new Map(); const twins = new Map();
  for (const c of list) { const k = c.path.toLowerCase(); byLower.set(k, [...(byLower.get(k) ?? []), c]); }
  for (const group of byLower.values()) {
    const gone = group.filter((c) => c.status === 'D'); const added = group.filter((c) => c.status === 'A');
    if (gone.length !== 1 || added.length !== 1) continue;
    if (same(added[0].path, gone[0].path)) { twins.set(added[0].path, gone[0].path); twins.set(gone[0].path, added[0].path); }
  }
  return twins;
}
// Two paths are one file on disk: same device and inode; where the file system gives no inode (network drives), the same real
// path once letter case is ignored. A path that is not there is never the same.
function sameFile(a, b) {
  try {
    const x = fs.lstatSync(a, { bigint: true }); const y = fs.lstatSync(b, { bigint: true });
    if (x.ino && y.ino) return x.dev === y.dev && x.ino === y.ino;
    return fs.realpathSync.native(a).toLowerCase() === fs.realpathSync.native(b).toLowerCase();
  } catch { return false; }
}
// Gives the file at `now` the spelling of `want` (folders first, then the name), through a temporary name because the
// file system will not rename a name onto its own spelling. `done` remembers the folders already respelled.
function respellPath(repo, now, want, done) {
  const a = now.split('/'); const b = want.split('/');
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    const from = path.join(repo, ...a.slice(0, i + 1)); const to = path.join(repo, ...b.slice(0, i + 1));
    if (done.has(from)) continue;
    const tmp = `${from}.orb-case-${process.pid}`;
    fs.renameSync(from, tmp);
    try { fs.renameSync(tmp, to); } catch (error) {
      // put it back; if even that fails, say where the file is now
      try { fs.renameSync(tmp, from); } catch { throw new Error(`no se pudo renombrar; queda como ${path.basename(tmp)}`); }
      throw error;
    }
    done.add(from);
  }
}

// ---- "aislada" mode
// deps: [{ id, branch, workdir }] of finished tasks. The copy starts from the first dependency's branch (its work is already
// there, no merge needed); further dependencies are merged in; a conflict is reported, not forced.
export function prepareWorkdir(task, project, worktrees, deps = []) {
  if (!isGitRepo(project.path)) return { workdir: project.path, cwd: project.path, branch: null, isGit: false, notes: [] };
  const branch = `${BRANCH_PREFIX}/${task.id}-${slug(task.title)}`;
  const workdir = path.join(worktrees, `${slug(project.name)}-${task.id}`);
  const notes = [];
  if (!fs.existsSync(workdir)) {
    fs.mkdirSync(worktrees, { recursive: true });
    // A copy deleted by hand is still registered in git ("missing but already registered worktree"): forget it first.
    git(project.path, 'worktree', 'prune');
    const exists = git(project.path, 'rev-parse', '--verify', '--quiet', branch).status === 0;
    const withBranch = deps.filter((d) => d.branch && git(project.path, 'rev-parse', '--verify', '--quiet', d.branch).status === 0);
    let base = null; let toMerge = withBranch;
    if (!exists && withBranch.length) {
      base = withBranch[0].branch; toMerge = withBranch.slice(1);
      notes.push(`La copia parte de la rama de la tarea #${withBranch[0].id} (${base}): ya tiene su trabajo.`);
    } else if (!exists) {
      const snap = snapshotCommit(repoRoot(project.path));
      if (snap) { base = snap.commit; notes.push(`La copia incluye los ${snap.files} archivo(s) sin commitear de la carpeta principal (commit «punto de partida»).`); }
    }
    const res = exists ? git(project.path, 'worktree', 'add', workdir, branch) : git(project.path, 'worktree', 'add', '-b', branch, workdir, ...(base ? [base] : []));
    if (res.status !== 0) throw new Error(tr('msg.workspace.worktreeFailed', { error: res.stderr.trim() }));
    for (const dep of exists ? [] : toMerge) {
      const merge = git(workdir, ...ORB_GIT, 'merge', '--no-edit', '-m', `orb: trae el trabajo de la tarea #${dep.id}`, dep.branch);
      if (merge.status === 0) notes.push(`Ya tiene el trabajo de la tarea #${dep.id} (rama ${dep.branch}).`);
      else { git(workdir, 'merge', '--abort'); notes.push(`No se pudo unir sola la rama ${dep.branch} de la tarea #${dep.id} (conflicto): sus archivos están en ${dep.workdir ?? 'esa rama'}; puedes leerlos de ahí.`); }
    }
  } else {
    // A folder with the right name but another branch is somebody else's work: never reuse it.
    const head = git(workdir, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
    if (head !== branch) throw new Error(tr('msg.workspace.wrongBranch', { workdir, head: head || '?', branch }));
  }
  // A project that lives in a subfolder of a repo works in the same subfolder of its worktree.
  const prefix = git(project.path, 'rev-parse', '--show-prefix').stdout.trim().replace(/[\/]$/, '');
  return { workdir, cwd: prefix ? path.join(workdir, prefix) : workdir, branch, isGit: true, notes };
}

// brings the work of an isolated copy back into the project folder, the way a "carpeta" task would have left it:
// files only, never git history, branches or the user's index. base: the commit the copy started from; tip: its branch
// after the task. A three-way merge (git merge-tree) of the folder as it is NOW (uncommitted work of other tasks included)
// with the task's work. Clean: the files that change are written (and a file that changed on disk meanwhile stops it all,
// before anything is written). Conflict: nothing is touched and the conflicting paths are returned.
// → { ok: true, before, after, changed } | { ok: false, conflicts: [paths] } | { ok: false, error }
export const integrateInto = (repo, range) => runSync(repo, integrateFlow(repo, range));
export const integrateIntoAsync = (repo, range) => runAsync(repo, integrateFlow(repo, range));
function* integrateFlow(repo, { base, tip }) {
  const now = yield* snapshotFlow(repo, { always: true, message: 'orb: carpeta antes de unir el trabajo de una copia aislada' });
  if (!now) return { ok: false, error: tr('msg.workspace.noSnapshot') };
  const m = yield ask({}, 'merge-tree', '--write-tree', '--name-only', '--no-messages', `--merge-base=${base}`, now.commit, tip);
  const lines = m.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (m.status === 1) return { ok: false, conflicts: [...new Set(lines.slice(1))] };
  if (m.status !== 0 || !/^[0-9a-f]{40,64}$/.test(lines[0] ?? '')) return { ok: false, error: oneLineOf(m.stderr) || 'git merge-tree' };
  const tree = lines[0];
  const changed = (yield* changedFlow(now.commit, tree)).filter((c) => !isSecretPath(c.path));
  // Everything is checked and read BEFORE the first file is touched, so a join either happens whole or not at all:
  // nothing may have moved since the snapshot, no path goes through a link, and every new content can be read.
  const plan = [];
  for (const { status, path: rel } of changed) {
    const file = path.join(repo, rel);
    const before = (yield ask({}, 'rev-parse', '--verify', '--quiet', `${now.commit}:${rel}`)).stdout.trim();
    const onDisk = fs.existsSync(file) ? (yield ask({}, 'hash-object', '--', file)).stdout.trim() : '';
    if (status !== 'A' && onDisk !== before) return { ok: false, conflicts: [rel] };
    if (status === 'A' && onDisk) return { ok: false, conflicts: [rel] };
    if (!linkFree(repo, file)) return { ok: false, error: `${rel}: pasa por un enlace` };
    if (status === 'D') { plan.push({ file }); continue; }
    // --filters: as the file is on disk (line endings of core.autocrlf), not git's stored form.
    const blob = yield askBuffer('cat-file', '--filters', `${tree}:${rel}`);
    if (blob.status !== 0) return { ok: false, error: `${rel}: ${String(blob.stderr ?? '').trim()}` };
    plan.push({ file, data: blob.stdout });
  }
  for (const { file, data } of plan) {
    if (data === undefined) { fs.rmSync(file, { force: true }); continue; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  }
  const after = yield* snapshotFlow(repo, { always: true, message: 'orb: carpeta después de unir el trabajo de una copia aislada' });
  return { ok: true, before: now.commit, after: after?.commit ?? tree, changed };
}
const oneLineOf = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);

// No component of `target` (from root down) may be a link or junction: a link in the middle could point outside the project.
function linkFree(root, target) {
  let cur = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    cur = path.join(cur, part);
    try { if (fs.lstatSync(cur).isSymbolicLink()) return false; } catch { return true; } // the rest does not exist yet
  }
  return true;
}

// Orb hands files to an isolated task: relative paths copied from the main folder (or another task's copy) into the task's copy.
// Paths must stay inside both folders (also after resolving links and junctions); private or secret-looking files are never copied.
export function copyIntoWorkdir(sourceRoot, targetRoot, files) {
  const copied = []; const skipped = [];
  const realSource = fs.realpathSync(sourceRoot); const realTarget = fs.realpathSync(targetRoot);
  const inside = (root, p) => { const rel = path.relative(root, p); return rel && !rel.startsWith('..') && !path.isAbsolute(rel); };
  for (const raw of files) {
    const rel = String(raw ?? '').replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
    if (!rel || path.isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.split('/').includes('..')) { skipped.push(`${raw} (ruta no válida: usa rutas relativas al proyecto)`); continue; }
    const from = path.resolve(realSource, rel); const to = path.resolve(realTarget, rel);
    if (!inside(realSource, from) || !inside(realTarget, to)) { skipped.push(`${rel} (fuera de la carpeta)`); continue; }
    if (isSecretPath(rel) || /(^|\/)\.git(\/|$)/.test(rel)) { skipped.push(`${rel} (privado o parece un secreto)`); continue; }
    if (!fs.existsSync(from)) { skipped.push(`${rel} (no existe en ${sourceRoot})`); continue; }
    let realFrom; try { realFrom = fs.realpathSync(from); } catch { realFrom = ''; }
    if (!inside(realSource, realFrom) || !linkFree(realSource, from) || !linkFree(realTarget, to)) { skipped.push(`${rel} (pasa por un enlace que sale de la carpeta)`); continue; }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true, force: true, dereference: false, filter: (src) => {
      const r = path.relative(realSource, src).replace(/\\/g, '/');
      try { if (fs.lstatSync(src).isSymbolicLink()) return false; } catch { return false; }
      return !/(^|\/)(\.git|node_modules)(\/|$)/.test(r) && !isSecretPath(r);
    } });
    copied.push(rel);
  }
  return { copied, skipped };
}

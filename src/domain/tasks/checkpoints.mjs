// Where a task works.
// - "carpeta" (default since 1.5): the project folder itself, one writing task at a time per project, so every agent sees the
//   latest files. Before each task Orb takes a checkpoint (a hidden git ref, or a file copy without git) and the panel can
//   undo exactly the files that task changed.
// - "aislada": a git worktree on its own branch, for experiments or parallel work that must not collide. It starts from the
//   branch of the task it depends on, or from what is really in the folder (uncommitted work included, never secrets).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { isSecretPath, redactSecrets } from '../../shared/secrets-scan.mjs';
import { tr } from '../../platform/context.mjs';
import { git, gitEnv, gitBuffer, slug, BRANCH_PREFIX, REF_PREFIX, ORB_GIT, isGitRepo, repoRoot, changedPaths } from '../../platform/git.mjs';

// A commit with the folder exactly as it is now (committed + modified + new files not ignored), on top of HEAD.
// Built with a temporary index, so the user's own index and files are never touched. Secret-looking files stay out, and that is
// checked on the result: if one is still inside, no snapshot is made. Returns { commit, files } (files = paths not in HEAD as-is),
// or null on failure. always=false returns null when there is nothing uncommitted.
// 3.8.3: raw (the checkpoints): every file as it is on disk, byte for byte. core.autocrlf is off for it, and the tracked
// files are hashed again (not taken from the stat cache, which may hold the normalized form of a file now written with
// other line endings), so «Deshacer» gives back LF, CRLF or mixed endings exactly. The attributes (.gitattributes) still apply.
export const RAW_GIT = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false'];
// The raw snapshots keep their own index next to git's (`.git/orb/index-raw`, per worktree): its stat cache holds the
// raw blobs, so the next raw snapshot hashes again only the files that changed since the last one. Hashing every
// tracked file again (`add --renormalize`) happens once per repository, the first time; measured on 10 000 files of
// 4 KB: 5,9 s → 0,6 s per snapshot, and the engine is synchronous while it takes one.
export const RAW_INDEX = 'orb/index-raw';
export function snapshotCommit(repo, { raw = false, always: wanted = false, message = 'orb: punto de partida (lo que había en la carpeta principal sin commitear; no es trabajo del agente)' } = {}) {
  const changed = changedPaths(repo); if (changed === null) return null;
  // A repository without any commit yet (git init and nothing more): the snapshot is a first commit with no parent, and it
  // is always made, since checkpoints and isolated copies need something to start from.
  const head = git(repo, 'rev-parse', '--verify', '--quiet', 'HEAD').stdout.trim();
  const always = wanted || !head;
  if (!changed.length && !always) return null;
  const gitPath = (p) => path.resolve(repo, git(repo, 'rev-parse', '--git-path', p).stdout.trim());
  const realIndex = gitPath('index');
  const rawIndex = raw ? gitPath(RAW_INDEX) : null;
  const tmp = path.join(os.tmpdir(), `orb-index-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    const env = { GIT_INDEX_FILE: tmp };
    const cfg = raw ? RAW_GIT : [];
    // Fill the temporary index: from the last raw snapshot's index when there is one (only changed files are read), else
    // from the user's index plus a full renormalization. A raw index git cannot use any more is dropped and rebuilt.
    const stage = (seed) => {
      fs.rmSync(tmp, { force: true });
      if (seed && fs.existsSync(seed)) fs.copyFileSync(seed, tmp);
      if (gitEnv(repo, env, ...cfg, 'add', '-A').status !== 0) return false;
      return !raw || seed === rawIndex || gitEnv(repo, env, ...cfg, 'add', '--renormalize', '--', '.').status === 0;
    };
    const warm = raw && fs.existsSync(rawIndex);
    if (!(warm && stage(rawIndex))) { if (warm) fs.rmSync(rawIndex, { force: true }); if (!stage(realIndex)) return null; }
    // Remove anything secret-looking from the snapshot (also files already tracked by mistake) and verify.
    const listed = () => gitEnv(repo, env, 'ls-files', '-z').stdout.split('\0').filter(Boolean);
    for (const file of listed().filter(isSecretPath)) gitEnv(repo, env, 'rm', '-q', '--cached', '--ignore-unmatch', '--', file);
    if (listed().some(isSecretPath)) return null;
    const tree = gitEnv(repo, env, 'write-tree').stdout.trim(); if (!tree) return null;
    if (raw) keepRawIndex(tmp, rawIndex);
    if (head && tree === git(repo, 'rev-parse', 'HEAD^{tree}').stdout.trim() && !always) return null;
    const commit = gitEnv(repo, env, ...ORB_GIT, 'commit-tree', tree, ...(head ? ['-p', head] : []), '-m', message).stdout.trim();
    return commit ? { commit, files: changed.length } : null;
  } finally { fs.rmSync(tmp, { force: true }); }
}
// Whole or not at all (another snapshot may be reading it): written beside and renamed over. Losing it only costs time.
function keepRawIndex(tmp, rawIndex) {
  const part = `${rawIndex}.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  try { fs.mkdirSync(path.dirname(rawIndex), { recursive: true }); fs.copyFileSync(tmp, part); fs.renameSync(part, rawIndex); }
  catch { fs.rmSync(part, { force: true }); }
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
export function changedBetween(repo, before, after) {
  const r = git(repo, 'diff', '--name-status', '-z', '--no-renames', before, after);
  const parts = r.stdout.split('\0'); const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) if (parts[i]) out.push({ status: parts[i][0], path: parts[i + 1] });
  return out;
}

// 3.8.2: what a task changed, file by file, for the window's diff panel. Read only: one `git diff` between the checkpoint
// before the task and the one after (commits, so line endings and the user's index never matter). Secret-looking paths
// are left out (the snapshots already keep them out) and secret-looking text in the patches is hidden. Each file's patch and the whole answer are capped, and a binary file
// has no patch. → { files: [{ status, path, added, removed, binary, patch, cut }], more }
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
    // 3.8.2 (security review): a key written in an ordinary file (a token in a config.js) is hidden too, as in the chat:
    // the diff also goes to a linked phone.
    let patch = f.binary || !patches ? '' : redactSecrets(patches[i]);
    const cut = patch.length > maxPatch || total + patch.length > maxTotal;
    if (cut) patch = '';
    total += patch.length;
    files.push({ status: status.get(f.path) ?? 'M', ...f, patch, cut });
  });
  return { files, more: list.filter((f) => !isSecretPath(f.path)).length - files.length };
}

// Undo a task in "carpeta" mode: only the files it changed go back to how they were before it. A file that somebody changed
// again after the task is left alone and reported. Never touches git history, branches or the index.
export function undoCheckpoint(before, after) {
  const restored = []; const removed = []; const skipped = [];
  if (before.kind === 'git') {
    const repo = before.repo; const cfg = before.raw ? RAW_GIT : []; // 3.8.3: a raw checkpoint is read and compared raw
    for (const { status, path: rel } of changedBetween(repo, before.commit, after.commit)) {
      const file = path.join(repo, rel);
      const nowExists = fs.existsSync(file);
      const blobAfter = git(repo, 'rev-parse', '--verify', '--quiet', `${after.commit}:${rel}`).stdout.trim();
      // (The snapshot after may have been taken either way: an older one, normalized.)
      const same = nowExists ? [cfg, ...(cfg.length ? [[]] : [])].some((c) => git(repo, ...c, 'hash-object', '--', file).stdout.trim() === blobAfter) : blobAfter === '';
      if (!same) { skipped.push(rel); continue; } // changed again after the task: the user decides
      // Only a file the task created is removed; whatever else cannot be read back is left alone and reported.
      if (status === 'A') { if (nowExists) { fs.rmSync(file, { force: true }); removed.push(rel); } continue; }
      // --filters: the file as it was on disk (the attributes' line endings, Git LFS), not git's stored form; a raw
      // checkpoint holds it byte for byte (core.autocrlf off).
      const old = gitBuffer(repo, ...cfg, 'cat-file', '--filters', `${before.commit}:${rel}`);
      if (old.status === 0) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, old.stdout); restored.push(rel); }
      else skipped.push(rel);
    }
    return { restored, removed, skipped };
  }
  // Copy checkpoint: files that differ from the copy come back; files the task created (not in the copy) are removed.
  const walk = (root, rel = '') => fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (/(^|\/)(\.git|node_modules)$/.test(r) || isSecretPath(r) || e.isSymbolicLink()) return [];
    return e.isDirectory() ? walk(root, r) : [r];
  });
  const inCopy = new Set(walk(before.copy));
  for (const rel of inCopy) {
    const src = path.join(before.copy, rel); const dst = path.join(before.dir, rel);
    if (!fs.existsSync(dst) || !fs.readFileSync(src).equals(fs.readFileSync(dst))) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); restored.push(rel); }
  }
  for (const rel of walk(before.dir)) {
    if (inCopy.has(rel)) continue;
    const file = path.join(before.dir, rel); const st = fs.statSync(file);
    if (st.mtimeMs < before.at) continue;
    if (st.size > MAX_COPY_FILE) { skipped.push(rel); continue; } // never in the copy, so it may predate the task: the user decides
    fs.rmSync(file, { force: true }); removed.push(rel);
  }
  return { restored, removed, skipped };
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

// 3.1: brings the work of an isolated copy back into the project folder, the way a "carpeta" task would have left it:
// files only, never git history, branches or the user's index. base: the commit the copy started from; tip: its branch
// after the task. A three-way merge (git merge-tree) of the folder as it is NOW (uncommitted work of other tasks included)
// with the task's work. Clean: the files that change are written (and a file that changed on disk meanwhile stops it all,
// before anything is written). Conflict: nothing is touched and the conflicting paths are returned.
// → { ok: true, before, after, changed } | { ok: false, conflicts: [paths] } | { ok: false, error }
export function integrateInto(repo, { base, tip }) {
  const now = snapshotCommit(repo, { always: true, message: 'orb: carpeta antes de unir el trabajo de una copia aislada' });
  if (!now) return { ok: false, error: tr('msg.workspace.noSnapshot') };
  const m = git(repo, 'merge-tree', '--write-tree', '--name-only', '--no-messages', `--merge-base=${base}`, now.commit, tip);
  const lines = m.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (m.status === 1) return { ok: false, conflicts: [...new Set(lines.slice(1))] };
  if (m.status !== 0 || !/^[0-9a-f]{40,64}$/.test(lines[0] ?? '')) return { ok: false, error: oneLineOf(m.stderr) || 'git merge-tree' };
  const tree = lines[0];
  const changed = changedBetween(repo, now.commit, tree).filter((c) => !isSecretPath(c.path));
  // Everything is checked and read BEFORE the first file is touched, so a join either happens whole or not at all:
  // nothing may have moved since the snapshot, no path goes through a link, and every new content can be read.
  const plan = [];
  for (const { status, path: rel } of changed) {
    const file = path.join(repo, rel);
    const before = git(repo, 'rev-parse', '--verify', '--quiet', `${now.commit}:${rel}`).stdout.trim();
    const onDisk = fs.existsSync(file) ? git(repo, 'hash-object', '--', file).stdout.trim() : '';
    if (status !== 'A' && onDisk !== before) return { ok: false, conflicts: [rel] };
    if (status === 'A' && onDisk) return { ok: false, conflicts: [rel] };
    if (!linkFree(repo, file)) return { ok: false, error: `${rel}: pasa por un enlace` };
    if (status === 'D') { plan.push({ file }); continue; }
    // --filters: as the file is on disk (line endings of core.autocrlf), not git's stored form.
    const blob = gitBuffer(repo, 'cat-file', '--filters', `${tree}:${rel}`);
    if (blob.status !== 0) return { ok: false, error: `${rel}: ${String(blob.stderr ?? '').trim()}` };
    plan.push({ file, data: blob.stdout });
  }
  for (const { file, data } of plan) {
    if (data === undefined) { fs.rmSync(file, { force: true }); continue; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  }
  const after = snapshotCommit(repo, { always: true, message: 'orb: carpeta después de unir el trabajo de una copia aislada' });
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

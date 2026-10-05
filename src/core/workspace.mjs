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
import { spawnSync } from 'node:child_process';
import { isSecretPath, porcelainPaths } from './safety.mjs';
import { PRODUCT } from './product.mjs';
import { tr } from './context.mjs';

// Never throws and never returns null output: if git cannot start or times out, status is -1 and stderr carries the reason.
export const git = (cwd, ...args) => gitEnv(cwd, {}, ...args);
export const gitEnv = (cwd, env, ...args) => {
  const res = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 120_000, env: { ...process.env, ...env } });
  return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr || res.error?.message || '' };
};
const gitBuffer = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { windowsHide: true, maxBuffer: 512 * 1024 * 1024, timeout: 120_000 });
export const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'tarea';
// Branches and hidden refs of this app use their own prefix, so they never collide with other tools in a shared repository.
export const BRANCH_PREFIX = 'orb';
export const REF_PREFIX = 'refs/orb';
export const ORB_GIT = ['-c', `user.name=${PRODUCT.name}`, '-c', 'user.email=orb@localhost'];
export const isGitRepo = (dir) => git(dir, 'rev-parse', '--is-inside-work-tree').stdout.trim() === 'true';
export const repoRoot = (dir) => git(dir, 'rev-parse', '--show-toplevel').stdout.trim().replace(/\//g, path.sep);
export const changedPaths = (repo) => { const r = git(repo, 'status', '--porcelain=v1', '-z', '-uall'); return r.status === 0 ? porcelainPaths(r.stdout) : null; };

// A commit with the folder exactly as it is now (committed + modified + new files not ignored), on top of HEAD.
// Built with a temporary index, so the user's own index and files are never touched. Secret-looking files stay out, and that is
// checked on the result: if one is still inside, no snapshot is made. Returns { commit, files } (files = paths not in HEAD as-is),
// or null on failure. always=false returns null when there is nothing uncommitted.
export function snapshotCommit(repo, { always = false, message = 'orb: punto de partida (lo que había en la carpeta principal sin commitear; no es trabajo del agente)' } = {}) {
  const changed = changedPaths(repo); if (changed === null) return null;
  if (!changed.length && !always) return null;
  const head = git(repo, 'rev-parse', 'HEAD').stdout.trim(); if (!head) return null;
  const realIndex = path.resolve(repo, git(repo, 'rev-parse', '--git-path', 'index').stdout.trim());
  const tmp = path.join(os.tmpdir(), `orb-index-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    if (fs.existsSync(realIndex)) fs.copyFileSync(realIndex, tmp);
    const env = { GIT_INDEX_FILE: tmp };
    if (gitEnv(repo, env, 'add', '-A').status !== 0) return null;
    // Remove anything secret-looking from the snapshot (also files already tracked by mistake) and verify.
    const listed = () => gitEnv(repo, env, 'ls-files', '-z').stdout.split('\0').filter(Boolean);
    for (const file of listed().filter(isSecretPath)) gitEnv(repo, env, 'rm', '-q', '--cached', '--ignore-unmatch', '--', file);
    if (listed().some(isSecretPath)) return null;
    const tree = gitEnv(repo, env, 'write-tree').stdout.trim(); if (!tree) return null;
    if (tree === git(repo, 'rev-parse', 'HEAD^{tree}').stdout.trim() && !always) return null;
    const commit = gitEnv(repo, env, ...ORB_GIT, 'commit-tree', tree, '-p', head, '-m', message).stdout.trim();
    return commit ? { commit, files: changed.length } : null;
  } finally { fs.rmSync(tmp, { force: true }); }
}

// ---- checkpoints of the "carpeta" mode
// Git: a hidden ref (refs/orb/…), invisible in the user's branches and log, that keeps the snapshot from being garbage collected.
// Without git: a copy of the folder in backups/checkpoints (without node_modules, .git, secrets or files over 50 MB).
export function takeCheckpoint(dir, name, backups) {
  if (isGitRepo(dir)) {
    const top = repoRoot(dir);
    const snap = snapshotCommit(top, { always: true, message: `orb: foto ${name}` });
    if (!snap) throw new Error(tr('msg.workspace.noSnapshot'));
    git(top, 'update-ref', `${REF_PREFIX}/${name}`, snap.commit);
    return { kind: 'git', repo: top, ref: `${REF_PREFIX}/${name}`, commit: snap.commit };
  }
  const target = path.join(backups, name);
  fs.rmSync(target, { recursive: true, force: true });
  copyTree(dir, target);
  return { kind: 'copia', dir, copy: target, at: Date.now() - 2000 };
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true, force: true, dereference: false, filter: (src) => {
    const rel = path.relative(from, src).replace(/\\/g, '/');
    if (!rel) return true;
    if (/(^|\/)(\.git|node_modules)(\/|$)/.test(rel) || isSecretPath(rel)) return false;
    try { const st = fs.lstatSync(src); return !st.isSymbolicLink() && (st.isDirectory() || st.size <= 50 * 1024 * 1024); } catch { return false; }
  } });
}

// Files a task changed: [{ status: 'A'|'M'|'D', path }] between the checkpoint before and the one after (git paths).
export function changedBetween(repo, before, after) {
  const r = git(repo, 'diff', '--name-status', '-z', '--no-renames', before, after);
  const parts = r.stdout.split('\0'); const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) if (parts[i]) out.push({ status: parts[i][0], path: parts[i + 1] });
  return out;
}

// Undo a task in "carpeta" mode: only the files it changed go back to how they were before it. A file that somebody changed
// again after the task is left alone and reported. Never touches git history, branches or the index.
export function undoCheckpoint(before, after) {
  const restored = []; const removed = []; const skipped = [];
  if (before.kind === 'git') {
    const repo = before.repo;
    for (const { path: rel } of changedBetween(repo, before.commit, after.commit)) {
      const file = path.join(repo, rel);
      const nowExists = fs.existsSync(file);
      const blobAfter = git(repo, 'rev-parse', '--verify', '--quiet', `${after.commit}:${rel}`).stdout.trim();
      const blobNow = nowExists ? git(repo, 'hash-object', '--', file).stdout.trim() : '';
      if (blobNow !== blobAfter) { skipped.push(rel); continue; } // changed again after the task: the user decides
      const old = gitBuffer(repo, 'cat-file', 'blob', `${before.commit}:${rel}`);
      if (old.status === 0) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, old.stdout); restored.push(rel); }
      else if (nowExists) { fs.rmSync(file, { force: true }); removed.push(rel); }
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
  for (const rel of walk(before.dir)) if (!inCopy.has(rel) && fs.statSync(path.join(before.dir, rel)).mtimeMs >= before.at) { fs.rmSync(path.join(before.dir, rel), { force: true }); removed.push(rel); }
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

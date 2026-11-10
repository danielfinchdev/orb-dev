// git for Orb: one way to run it (never throws; a failure or a timeout is status -1 with the reason in stderr), Orb's
// branch and ref prefixes, and quick questions about a repository. Synchronous (src/engine moves to async in 3.8.4).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { porcelainPaths } from '../shared/secrets-scan.mjs';
import { PRODUCT } from '../shared/product.mjs';

// Never throws and never returns null output: if git cannot start or times out, status is -1 and stderr carries the reason.
export const git = (cwd, ...args) => gitEnv(cwd, {}, ...args);
export const gitEnv = (cwd, env, ...args) => {
  const res = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 120_000, env: { ...process.env, ...env } });
  return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr || res.error?.message || '' };
};
export const gitBuffer = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { windowsHide: true, maxBuffer: 512 * 1024 * 1024, timeout: 120_000 });
export const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'tarea';
// Branches and hidden refs of this app use their own prefix, so they never collide with other tools in a shared repository.
export const BRANCH_PREFIX = 'orb';
export const REF_PREFIX = 'refs/orb';
export const ORB_GIT = ['-c', `user.name=${PRODUCT.name}`, '-c', 'user.email=orb@localhost'];
export const isGitRepo = (dir) => git(dir, 'rev-parse', '--is-inside-work-tree').stdout.trim() === 'true';
export const repoRoot = (dir) => git(dir, 'rev-parse', '--show-toplevel').stdout.trim().replace(/\//g, path.sep);
// 3.8.1: whether the repository a folder belongs to may have linked worktrees, told from its files alone (each git call is
// a process: ~40 ms on Windows, and the engine's start asked two per project). false: no repository, or one whose .git
// folder has no linked worktree; true: it has some, or it cannot be told this way (a .git file: the folder is itself a
// worktree or a submodule; GIT_DIR set; a file that cannot be read for another reason than not being there).
// The walk up starts from the folder's real path, as git's (a junction to a subfolder of a repository is in that
// repository). cache: a Map shared by the calls of one pass (folders of the same workspace share their parents).
const missing = (error) => error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
export function mayHaveWorktrees(dir, cache = new Map()) {
  if (process.env.GIT_DIR || process.env.GIT_COMMON_DIR) return true;
  const seen = [];
  const answer = (v) => { for (const d of seen) cache.set(d, v); return v; };
  let d;
  try { d = fs.realpathSync.native(path.resolve(String(dir))); } catch (error) { return !missing(error); }
  for (;;) {
    if (cache.has(d)) return answer(cache.get(d));
    seen.push(d);
    let st = null; try { st = fs.statSync(path.join(d, '.git')); } catch (error) { if (!missing(error)) return answer(true); }
    if (st) { if (!st.isDirectory()) return answer(true); try { return answer(fs.readdirSync(path.join(d, '.git', 'worktrees')).length > 0); } catch (error) { return answer(!missing(error)); } }
    const up = path.dirname(d); if (up === d) return answer(false); d = up;
  }
}
export const changedPaths = (repo) => { const r = git(repo, 'status', '--porcelain=v1', '-z', '-uall'); return r.status === 0 ? porcelainPaths(r.stdout) : null; };

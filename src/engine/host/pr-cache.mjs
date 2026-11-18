// What the engine last learned about a project's current branch and open pull requests, kept in memory so a list of
// chats can name a chat's branch and PR without asking git or gh. It is filled only by the calls that already ask for
// that (projects.info, projects.prs); reading it never runs a process. Each field lives from its own last real read,
// so an old answer is never used and a later read of one field does not keep the other alive.
import path from 'node:path';

const TTL_MS = 30 * 60_000;
const MAX = 200;
const seen = new Map();
let now = () => Date.now();
// Tests move the clock instead of waiting; null puts the real one back.
export const setCacheClock = (fn) => { now = typeof fn === 'function' ? fn : () => Date.now(); };

// One key for every spelling of the same folder (tree.repo, session cwd and project path come from different places).
const keyOf = (dir) => {
  const raw = String(dir ?? '').trim(); if (!raw) return '';
  const key = path.resolve(raw).replace(/[\\]/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? key.toLowerCase() : key;
};

// A PR opened from a fork shares its branch name with ours without being ours (a fork's `main`): never remembered.
const ours = (p) => Number.isInteger(p?.number) && typeof p.headRefName === 'string' && p.isCrossRepository !== true;

// branch: given only by a call that read it ('HEAD' = detached and '' = failed read both mean no branch);
// prs: given only by a call that read them (left out when gh could not be read, so the old list just expires).
export function rememberRepo(dir, { branch, prs } = {}) {
  const key = keyOf(dir); if (!key) return;
  const old = seen.get(key) ?? {};
  const next = { ...old };
  if (typeof branch === 'string') { next.branch = branch && branch !== 'HEAD' ? branch : null; next.branchAt = now(); }
  if (Array.isArray(prs)) { next.prs = prs.filter(ours).map((p) => ({ number: p.number, headRefName: p.headRefName })); next.prsAt = now(); }
  seen.delete(key);
  seen.set(key, next);
  if (seen.size > MAX) seen.delete(seen.keys().next().value);
}

const live = (dir, field) => { const e = seen.get(keyOf(dir)); return e && e[`${field}At`] != null && now() - e[`${field}At`] < TTL_MS ? e : null; };
// The project's current branch, as last read; null when unknown.
export const cachedBranch = (dir) => live(dir, 'branch')?.branch ?? null;
// The open PR whose head is `branch` in the repository at `dir`, as last read; null when unknown or none.
export const cachedPr = (dir, branch) => (branch ? live(dir, 'prs')?.prs?.find((p) => p.headRefName === branch)?.number ?? null : null);
export const forgetRepos = () => seen.clear();

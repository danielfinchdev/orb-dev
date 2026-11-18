// What the engine last learned about a project's current branch and open pull requests, kept in memory so a list of
// chats can name a chat's branch and PR without asking git or gh. It is filled only by the calls that already ask for
// that (projects.info, projects.prs); reading it never runs a process. Each field lives from its own last real read,
// so an old answer is never used and a later read of one field does not keep the other alive.
import fs from 'node:fs';
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

// A PR opened from a fork shares its branch name with ours without being ours (a fork's `main`): never remembered. One that
// arrives without the field (an old gh does not know it) cannot be told apart, so it is left out too.
const ours = (p) => Number.isInteger(p?.number) && typeof p.headRefName === 'string' && p.isCrossRepository === false;

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
export const forgetRepos = () => { seen.clear(); liveSeen.clear(); };

// The branch a folder is on right now, read from its .git/HEAD alone (no git process, no lock on the index), so a chat
// that works in the project's own folder shows the branch it is on today and not the one a 30-minute-old read saw.
// A folder's answer is kept 5 s: a list of 50 chats of one project reads the file once.
// → a name; null (detached HEAD, or not inside a repository); undefined (the file could not be read: ask the older cache).
const LIVE_TTL_MS = 5_000;
const liveSeen = new Map();
// At most 4 KB of a file, whatever it is (a `.git` or HEAD that is huge or never ends is not read whole).
function readSmall(file) {
  const fd = fs.openSync(file, 'r');
  try { const buf = Buffer.alloc(4096); const n = fs.readSync(fd, buf, 0, buf.length, 0); return buf.toString('utf8', 0, n); } finally { fs.closeSync(fd); }
}
const BRANCH_RE = /^[\w./-]{1,255}$/;
function readHead(dir) {
  let at = path.resolve(dir);
  for (let depth = 0; depth < 8; depth++) {
    const dot = path.join(at, '.git');
    let stat = null;
    try { stat = fs.statSync(dot); } catch { /* none here: look in the parent */ }
    if (stat) {
      try {
        // A linked worktree or a submodule has a `.git` file that points to the real directory; one that points to a network
        // share (UNC) is never followed.
        let gitDir = dot;
        if (!stat.isDirectory()) {
          const target = /^gitdir:[ \t]*(.+)$/m.exec(readSmall(dot))?.[1].trim();
          if (!target || /^[\\/]{2}/.test(target)) return undefined;
          gitDir = path.resolve(at, target);
        }
        const ref = /^ref:[ \t]*refs\/heads\/(.+)$/m.exec(readSmall(path.join(gitDir, 'HEAD')));
        const name = ref?.[1].trim();
        return name ? (BRANCH_RE.test(name) ? name : null) : null;
      } catch { return undefined; }
    }
    const up = path.dirname(at);
    if (up === at) break;
    at = up;
  }
  return null;
}
export function liveBranch(dir) {
  const key = keyOf(dir); if (!key) return undefined;
  const hit = liveSeen.get(key);
  if (hit && now() - hit.at < LIVE_TTL_MS) return hit.branch;
  const branch = readHead(dir);
  liveSeen.delete(key);
  liveSeen.set(key, { branch, at: now() });
  if (liveSeen.size > MAX) liveSeen.delete(liveSeen.keys().next().value);
  return branch;
}

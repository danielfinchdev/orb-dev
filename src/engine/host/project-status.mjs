// The branch and the number of uncommitted files of many projects, for a phone's project grid. One git process per
// project (`status -b`), never gh and never the network, run a few at a time with a time limit each and one for the
// whole pass, so a slow or huge repository can only leave its own fields out. Only a branch name and a count are
// returned: no file name and no path ever leaves here.
import { gitAsyncWith } from '../../platform/git.mjs';
import { rememberRepo } from './pr-cache.mjs';

const EACH_MS = 4_000;
const TOTAL_MS = 10_000;
const PARALLEL = 4;
const MAX_PROJECTS = 100;
// Answers are kept a few seconds: a phone that reopens the list does not run git again in every project.
const KEEP_MS = 5_000;
const MAX_KEPT = 200;
const kept = new Map();
let clock = () => Date.now();
// Tests move the clock instead of waiting; null puts the real one back.
export const setStatusClock = (fn) => { clock = typeof fn === 'function' ? fn : () => Date.now(); };
export const forgetStatuses = () => kept.clear();

// `## main...origin/main [ahead 1]`, `## main`, `## HEAD (no branch)`, `## No commits yet on main`, `## Initial commit on main`.
function parse(out) {
  const lines = out.split(/\r?\n/).filter(Boolean);
  const head = lines[0]?.startsWith('## ') ? lines.shift().slice(3) : null;
  if (head === null) return null;
  let branch = null;
  const unborn = /^(?:No commits yet on|Initial commit on) (.+)$/.exec(head);
  if (unborn) branch = unborn[1];
  else if (!head.startsWith('HEAD (no branch)')) branch = head.split('...')[0].trim() || null;
  return { branch, changes: lines.length };
}

async function read(dir, timeout) {
  const r = await gitAsyncWith(dir, { timeout, max: 4 * 1024 * 1024 }, '--no-optional-locks', 'status', '--porcelain=v1', '-b', '-uall');
  return r.status === 0 ? parse(r.stdout) : null;
}

// → Map(name → { branch: string|null, changes: number }); a project that is not a repository, has no folder, timed out
// or was left past the deadline is not in it.
export async function projectStatuses(projects, { eachMs = EACH_MS, totalMs = TOTAL_MS, parallel = PARALLEL } = {}) {
  const out = new Map();
  const queue = (projects ?? []).filter((p) => p?.path).slice(0, MAX_PROJECTS);
  const stop = clock() + totalMs;
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const hit = kept.get(p.path);
      let st = hit && clock() - hit.at < KEEP_MS ? hit.st : undefined;
      if (st === undefined) {
        if (clock() >= stop) continue;
        try { st = await read(p.path, Math.min(eachMs, Math.max(1, stop - clock()))); } catch { st = null; }
        kept.delete(p.path);
        if (st) { kept.set(p.path, { at: clock(), st }); if (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value); }
      }
      if (st) { out.set(p.name, st); rememberRepo(p.path, { branch: st.branch ?? 'HEAD' }); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, 8)) }, worker));
  return out;
}

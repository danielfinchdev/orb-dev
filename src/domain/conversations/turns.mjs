// What each turn of a direct chat changed. When an agent's turn ends the engine takes a light snapshot of the working
// tree (the same raw, secret-free commit the task checkpoints use, built with a temporary index) and keeps it under
// refs/orb/turnos/<session>/<n>. n = 0 is the folder as it was before the first turn; turn n changed what lies between
// n-1 and n. Nothing here touches the user's files, index, branches or stash, and the refs sit outside refs/heads and
// refs/tags, so no default push or fetch refspec ever carries them (turns.test.mjs checks it). Diffs are read from the
// commits (`git diff <a> <b>`), never by checking anything out.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { git, gitAsync, REF_PREFIX, isGitRepoAsync, repoRootAsync } from '../../platform/git.mjs';
import { snapshotCommitAsync, diffBetween, RAW_GIT, RAW_INDEX, caseRenamed } from '../tasks/checkpoints.mjs';
import { isSecretPath } from '../../shared/secrets-scan.mjs';

const TURNS = `${REF_PREFIX}/turnos`;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const refDir = (sid) => { if (!ID.test(String(sid))) throw new Error('conversación no válida'); return `${TURNS}/${sid}`; };

// one chain per conversation: the snapshot at the start and at the end of a turn never run at once, so numbers do not repeat.
const chains = new Map();
const serial = (sid, fn) => {
  const next = (chains.get(sid) ?? Promise.resolve()).catch(() => {}).then(fn);
  chains.set(sid, next.finally(() => { if (chains.get(sid) === next) chains.delete(sid); }));
  return next;
};

async function listRefs(repo, sid) {
  const r = await gitAsync(repo, {}, 'for-each-ref', '--format=%(refname) %(objectname) %(creatordate:unix)', `${refDir(sid)}/`);
  if (r.status !== 0) return [];
  return r.stdout.split('\n').filter(Boolean).map((line) => {
    const [name, commit, at] = line.split(' ');
    return { n: Number(name.slice(refDir(sid).length + 1)), commit, at: Number(at) * 1000 };
  }).filter((t) => Number.isInteger(t.n) && t.n >= 0).sort((a, b) => a.n - b.n);
}

// Where a folder's repository is, remembered per folder: every git call is a process (~90 ms on Windows) and a message
// asked for two just to find the root. A remembered root is only trusted while no `.git` appeared between the folder and
// that root (a repository started inside a project) and the root still has its own.
const roots = new Map();
const sameDir = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
function rootHolds(cwd, repo) {
  try {
    let d = path.resolve(cwd);
    for (let i = 0; i < 64; i++) {
      if (sameDir(d, path.resolve(repo))) return fs.existsSync(path.join(d, '.git'));
      if (fs.existsSync(path.join(d, '.git'))) return false;
      const up = path.dirname(d); if (up === d) return false; d = up;
    }
  } catch { /* cannot tell: ask git */ }
  return false;
}
async function locate(cwd) {
  const known = roots.get(cwd);
  if (known && rootHolds(cwd, known.repo)) return known;
  roots.delete(cwd);
  const r = await gitAsync(cwd, {}, 'rev-parse', '--is-inside-work-tree', '--show-toplevel', '--git-path', RAW_INDEX);
  const [inside, top, raw] = r.stdout.split('\n').map((l) => l.trim());
  if (r.status !== 0 || inside !== 'true' || !top || !raw) return null;
  const found = { repo: top.replace(/\//g, path.sep), rawIndex: path.resolve(cwd, raw) };
  if (roots.size > 64) roots.clear();
  roots.set(cwd, found);
  return found;
}

// The last photo of each conversation (a numbered one or a message's own): the next message may reuse it.
const lastPhoto = new Map();

// True when the folder is still exactly the one in `ref`'s photo, so a message does not need a new photo. Same trust as the
// fast snapshot (a file's date and size, as git does), checked against a copy of the raw index (the photo's own stat cache):
// - diff-index: every file the photo has is on disk with the same content, and the index has nothing the photo lacks;
// - ls-files --others: no new file that is not ignored (a secret-looking one is never in a photo, so it does not count);
// - letter case: on a file system that ignores it, a file renamed only in case is invisible to both, so it is looked for apart.
// Any doubt (no raw index, a failing git, a vanished ref, a difference) answers false and the caller takes a full photo.
async function unchanged(repo, rawIndex, ref) {
  const tmp = path.join(os.tmpdir(), `orb-index-check-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    const st = fs.statSync(rawIndex);
    fs.copyFileSync(rawIndex, tmp); fs.utimesSync(tmp, st.atime, st.mtime); // git's «racy» test compares file dates with the index's
    const env = { GIT_INDEX_FILE: tmp };
    const [diff, others] = await Promise.all([
      gitAsync(repo, env, ...RAW_GIT, 'diff-index', '--quiet', `${ref}^{commit}`),
      gitAsync(repo, env, ...RAW_GIT, 'ls-files', '--others', '--exclude-standard', '-z'),
    ]);
    if (diff.status !== 0 || others.status !== 0) return false;
    if (!others.stdout.split('\0').filter(Boolean).every(isSecretPath)) return false;
    return !(await caseRenamed(repo, rawIndex, tmp));
  } catch { return false; } finally { fs.rmSync(tmp, { force: true }); }
}

async function take(cwd, sid, { start, alive, mark = 0 }) {
  const where = await locate(cwd);
  if (!where) return null;
  // the chat was archived or deleted while the turn ran: nothing is left behind
  if (alive && !alive()) { dropNow(cwd, sid); return null; }
  const { repo } = where;
  // A message's photo is the last one when nothing changed since (the usual case: the turn before ended with one).
  const last = start && mark ? lastPhoto.get(sid) : null;
  if (last && last.repo === repo) {
    if (await unchanged(repo, where.rawIndex, last.ref)) {
      // the photo's ref name as the new value: git resolves it, one process less than asking for its hash first
      const ref = `${refDir(sid)}/antes/${mark}`;
      if ((await gitAsync(repo, {}, 'update-ref', ref, `${last.ref}^{commit}`)).status === 0) { lastPhoto.set(sid, { repo, ref }); return null; }
    }
  }
  const have = await listRefs(repo, sid);
  const baseline = start && have.length > 0; // the numbered baseline is only the folder before the very first turn
  if (baseline && !mark) return null;
  const snap = await snapshotCommitAsync(repo, { raw: true, always: true, message: `orb: turno ${sid}` });
  if (!snap) return null;
  // A message's own photo is not a turn: it carries no number, so «Cambios» never shows it.
  if (start && mark) {
    const ref = `${refDir(sid)}/antes/${mark}`;
    if ((await gitAsync(repo, {}, 'update-ref', ref, snap.commit)).status === 0) lastPhoto.set(sid, { repo, ref });
  }
  if (baseline) return null;
  const n = have.length ? have[have.length - 1].n + 1 : 0;
  const ref = `${refDir(sid)}/${n}`;
  const r = await gitAsync(repo, {}, 'update-ref', ref, snap.commit);
  if (r.status === 0) lastPhoto.set(sid, { repo, ref });
  return r.status === 0 ? { n, commit: snap.commit } : null;
}

// Before a turn starts: the baseline, once per conversation. Never throws: a failed photo only means no panel.
// mark: the id of the user message this turn answers; refs/orb/turnos/<sid>/antes/<mark> keeps the folder as it was before it.
export const snapshotBeforeTurn = (cwd, sid, alive, { mark } = {}) => serial(sid, () => take(cwd, sid, { start: true, alive, mark: Number.isInteger(mark) && mark > 0 ? mark : 0 })).catch(() => null);

// The photo taken right before a user message, or null when there is none (an older chat, a turn without photo, a dropped chat).
export async function photoBefore(cwd, sid, itemId) {
  const id = Number(itemId);
  if (!Number.isInteger(id) || id < 1 || !cwd || !(await isGitRepoAsync(cwd))) return null;
  const repo = await repoRootAsync(cwd);
  const r = await gitAsync(repo, {}, 'rev-parse', '--verify', '--quiet', `${refDir(sid)}/antes/${id}^{commit}`);
  const commit = r.status === 0 ? r.stdout.trim() : '';
  return /^[0-9a-f]{40,64}$/.test(commit) ? { repo, commit } : null;
}
// When a turn ends.
export const snapshotAfterTurn = (cwd, sid, alive) => serial(sid, () => take(cwd, sid, { start: false, alive })).catch(() => null);

// → { available, turns: [{ n, at }] }: n = 1… are turns; the baseline (0) is not listed.
export async function listTurns(cwd, sid) {
  if (!cwd || !(await isGitRepoAsync(cwd))) return { available: false, turns: [] };
  const repo = await repoRootAsync(cwd);
  const refs = await listRefs(repo, sid);
  return { available: refs.length > 1, turns: refs.filter((t) => t.n > 0).map((t) => ({ n: t.n, at: t.at })) };
}

// scope: 'last' | 'all' | 'turn' (with n) | 'head' (the last photo against the current HEAD commit).
export async function turnDiff(cwd, sid, { scope = 'last', n } = {}) {
  if (!cwd || !(await isGitRepoAsync(cwd))) return { available: false, files: [], more: 0 };
  const repo = await repoRootAsync(cwd);
  const refs = await listRefs(repo, sid);
  if (refs.length < 2) return { available: false, files: [], more: 0 };
  const byN = new Map(refs.map((t) => [t.n, t]));
  const last = refs[refs.length - 1];
  let a; let b = last; let label;
  if (scope === 'all') { a = refs[0]; label = 'all'; }
  else if (scope === 'turn') {
    b = byN.get(Number(n)); a = b && byN.get(b.n - 1);
    if (!b || b.n < 1 || !a) return { available: false, files: [], more: 0 };
    label = b.n;
  } else if (scope === 'head') {
    const head = (await gitAsync(repo, {}, 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}')).stdout.trim();
    if (!head) return { available: false, files: [], more: 0 };
    a = { commit: head }; label = 'head';
  } else { a = refs[refs.length - 2]; label = last.n; }
  return { available: true, scope: label, ...diffBetween(repo, a.commit, b.commit) };
}

// An archived or deleted conversation leaves nothing behind. Sync on purpose: it runs where the conversation is removed.
// It queues behind a snapshot still being taken, so that one cannot write its ref after the drop.
export const dropTurns = (cwd, sid) => serial(sid, async () => dropNow(cwd, sid)).catch(() => 0);
function dropNow(cwd, sid) {
  lastPhoto.delete(sid);
  try {
    const refs = git(cwd, 'for-each-ref', '--format=%(refname)', `${refDir(sid)}/`);
    if (refs.status !== 0) return 0;
    const names = refs.stdout.split('\n').filter(Boolean);
    for (const name of names) git(cwd, 'update-ref', '-d', name);
    return names.length;
  } catch { return 0; }
}

// The comments the user wrote on lines of a diff travel with the next message as one block. They are data for the agent,
// capped so a pasted wall of text cannot flood a turn. → '' when there is nothing to send.
const clip = (v, n) => String(v ?? '').replace(/\r/g, '').trim().slice(0, n);
export function commentsBlock(comments) {
  const list = (Array.isArray(comments) ? comments : []).slice(0, 50).map((c) => ({
    path: clip(c?.path, 300).replace(/\n/g, ' '), line: Math.max(0, Math.trunc(Number(c?.line)) || 0), side: c?.side === 'old' ? 'old' : 'new', text: clip(c?.text, 2000).replace(/\n/g, ' '),
  })).filter((c) => c.path && c.text);
  if (!list.length) return '';
  return ['Comentarios sobre el código:', ...list.map((c) => `- ${c.path}${c.line ? `:${c.line}` : ''}${c.side === 'old' ? ' (antes del cambio)' : ''}: ${c.text}`)].join('\n');
}

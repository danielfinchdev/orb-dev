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
import { snapshotCommitAsync, diffBetween, statBetweenAsync, RAW_GIT, RAW_INDEX, caseRenamed, indexId } from '../tasks/checkpoints.mjs';
import { isSecretPath } from '../../shared/secrets-scan.mjs';

const TURNS = `${REF_PREFIX}/turnos`;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const refDir = (sid) => { if (!ID.test(String(sid))) throw new Error('conversación no válida'); return `${TURNS}/${sid}`; };

// one chain per conversation: the snapshot at the start and at the end of a turn never run at once, so numbers do not repeat.
const chains = new Map();
const serial = (sid, fn) => {
  const next = (chains.get(sid) ?? Promise.resolve()).then(fn);
  // The stored link must never reject: nobody awaits it, so a failed photo (git gone, the database already closed at
  // shutdown) would surface as an unhandledRejection. The caller still gets the real error through `next`.
  const link = next.then(() => {}, () => {}).then(() => { if (chains.get(sid) === link) chains.delete(sid); });
  chains.set(sid, link);
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
// Trailer of a photo's commit message: when the folder was read (ms), so a rewind can tell which files were already there.
export const PHOTO_AT = 'orb-photo-at: ';
// Trailer of the baseline photo: the files that already differed from HEAD when the chat started (base64 of a JSON list). A photo
// is raw (line endings as on disk) and HEAD is not, so this cannot be read back from the two commits on a checkout with CRLF.
const START_DIRTY = 'orb-start-dirty: ';

// The files that differ from HEAD right now, as git itself judges them (line endings, the index): path → 'D' | 'M'.
// Ignored and secret-looking files are left out: no photo holds them.
export async function dirtyFiles(repo) {
  const r = await gitAsync(repo, {}, 'status', '--porcelain=v1', '-z', '-uall');
  const out = new Map();
  if (r.status !== 0) return out;
  const parts = r.stdout.split(String.fromCharCode(0));
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]; if (e.length < 4) continue;
    const file = e.slice(3).split(String.fromCharCode(92)).join('/');
    if (/^[RC]/.test(e)) i++; // the old path of a rename comes next
    if (!isSecretPath(file)) out.set(file, e[0] === 'D' || e[1] === 'D' ? 'D' : 'M');
  }
  return out;
}
// What the baseline of a chat says about the folder at its start; null for a baseline taken before this was recorded.
export async function startDirtyOf(repo, zeroCommit) {
  const msg = (await gitAsync(repo, {}, 'show', '-s', '--format=%B', zeroCommit)).stdout;
  const line = msg.split(String.fromCharCode(10)).map((l) => l.trim()).find((l) => l.startsWith(START_DIRTY));
  if (!line) return null;
  try { return new Set(JSON.parse(Buffer.from(line.slice(START_DIRTY.length), 'base64').toString('utf8'))); } catch { return null; }
}
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
    // The marker says which HEAD this index was reconciled with. A file added with `add -f` and committed since is in HEAD
    // but neither in the index nor in `ls-files --others`, so only a moved HEAD (or a missing marker) reveals it.
    const [markedHead, markedId] = fs.readFileSync(`${rawIndex}.head`, 'utf8').trim().split(':');
    const id = indexId(tmp);
    if (!id || markedId !== id) return false;
    const env = { GIT_INDEX_FILE: tmp };
    const [head, diff, others] = await Promise.all([
      gitAsync(repo, {}, 'rev-parse', '--verify', '--quiet', 'HEAD'),
      gitAsync(repo, env, ...RAW_GIT, 'diff-index', '--quiet', `${ref}^{commit}`),
      gitAsync(repo, env, ...RAW_GIT, 'ls-files', '--others', '--exclude-standard', '-z'),
    ]);
    if (head.stdout.trim() !== markedHead || diff.status !== 0 || others.status !== 0) return false;
    if (!others.stdout.split('\0').filter(Boolean).every(isSecretPath)) return false;
    return !(await caseRenamed(repo, rawIndex, tmp));
  } catch { return false; } finally { fs.rmSync(tmp, { force: true }); }
}

// Every turn n keeps two photos: `pre/<n>` (the folder right before the turn starts) and `<n>` (right after it ends).
// What turn n changed is the diff between those two, never between turn n-1 and n, which would also hold what the user
// or another chat changed in between. A turn with no user message (automatic) takes its `pre` photo too.
// `n` of lastPhoto is the last numbered turn this process knows; without it the fast path is skipped.
async function take(cwd, sid, { start, alive, mark = 0 }) {
  const where = await locate(cwd);
  if (!where) return null;
  // the chat was archived or deleted while the turn ran: nothing is left behind
  if (alive && !alive()) { dropNow(cwd, sid); return null; }
  const { repo } = where;
  const names = (next) => [`${refDir(sid)}/pre/${next}`, ...(mark ? [`${refDir(sid)}/antes/${mark}`] : [])];
  if (start) {
    // The last photo is this turn's when nothing changed since (the usual case: the turn before ended with one).
    const last = lastPhoto.get(sid);
    if (last && last.repo === repo && Number.isInteger(last.n) && await unchanged(repo, where.rawIndex, last.ref)) {
      const refs = names(last.n + 1);
      let ok = true;
      // the photo's ref name as the new value: git resolves it, one process less than asking for its hash first
      for (const ref of refs) ok = ok && (await gitAsync(repo, {}, 'update-ref', ref, `${last.ref}^{commit}`)).status === 0;
      if (ok) { lastPhoto.set(sid, { repo, ref: refs[0], n: last.n }); return null; }
    }
  }
  const have = await listRefs(repo, sid);
  const lastN = have.length ? have[have.length - 1].n : 0;
  // the first photo of a chat also says which files were already changed (it is the folder before the chat touched anything)
  const first = start && !have.length;
  const dirty = first ? [...(await dirtyFiles(repo)).keys()].slice(0, 3000) : null;
  const snap = await snapshotCommitAsync(repo, { raw: true, always: true, message: `orb: turno ${sid}

${PHOTO_AT}${Date.now()}${dirty ? `
${START_DIRTY}${Buffer.from(JSON.stringify(dirty)).toString('base64')}` : ''}` });
  if (!snap) return null;
  if (start) {
    // The folder before the very first turn is also turn 0 (the start of the numbering).
    const refs = [...names(lastN + 1), ...(have.length ? [] : [`${refDir(sid)}/0`])];
    let ok = true;
    for (const ref of refs) ok = ok && (await gitAsync(repo, {}, 'update-ref', ref, snap.commit)).status === 0;
    if (ok) lastPhoto.set(sid, { repo, ref: refs[0], n: lastN });
    return null;
  }
  const n = have.length ? lastN + 1 : 0;
  const ref = `${refDir(sid)}/${n}`;
  const r = await gitAsync(repo, {}, 'update-ref', ref, snap.commit);
  if (r.status === 0) lastPhoto.set(sid, { repo, ref, n });
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
  // A read that arrives while a photo is being taken (the engine marks the chat idle before it ends) waits for it, so the
  // turn that just finished is listed. The stored link never rejects, so this cannot hang or throw.
  await chains.get(sid);
  const refs = await listRefs(repo, sid);
  return { available: refs.length > 1, turns: refs.filter((t) => t.n > 0).map((t) => ({ n: t.n, at: t.at })) };
}

// The photo taken right before turn `t` started, when this version took it.
async function preOf(repo, sid, t) {
  const r = await gitAsync(repo, {}, 'rev-parse', '--verify', '--quiet', `${refDir(sid)}/pre/${t.n}^{commit}`);
  return r.status === 0 && r.stdout.trim() ? { commit: r.stdout.trim() } : null;
}

// scope: 'last' | 'all' | 'turn' (with n) | 'head' (the last photo against the current HEAD commit).
// stat: only the line counts per file (statBetween), no patches.
export async function turnDiff(cwd, sid, { scope = 'last', n, stat = false } = {}) {
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
    a = await preOf(repo, sid, b) ?? a;
    label = b.n;
  } else if (scope === 'head') {
    const head = (await gitAsync(repo, {}, 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}')).stdout.trim();
    if (!head) return { available: false, files: [], more: 0 };
    a = { commit: head }; label = 'head';
  } else { a = refs[refs.length - 2]; label = last.n; a = await preOf(repo, sid, last) ?? a; }
  return { available: true, scope: label, ...(stat ? await statBetweenAsync(repo, a.commit, b.commit) : diffBetween(repo, a.commit, b.commit)) };
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

// The pairs of photos that say what a conversation's turns changed: `pre` (before) and `post` (after) of each turn, in order.
// → { ok: true, repo, zero, turns: [{ n, pre, post }] } | { ok: false, why: 'none' | 'old' }.
// 'old': some turn has no `pre` photo (a conversation of a version before 3.8.12), so what it changed cannot be told apart
// from what someone else changed in between. Turn 1 falls back to the baseline (0), which is the folder before it.
export async function turnPairs(cwd, sid) {
  if (!cwd || !(await isGitRepoAsync(cwd))) return { ok: false, why: 'none' };
  const repo = await repoRootAsync(cwd);
  await chains.get(sid);
  const refs = await listRefs(repo, sid);
  const zero = refs.find((t) => t.n === 0);
  const posts = refs.filter((t) => t.n > 0);
  if (!posts.length) return { ok: false, why: 'none' };
  const pre = new Map();
  const r = await gitAsync(repo, {}, 'for-each-ref', '--format=%(refname) %(objectname)', `${refDir(sid)}/pre/`);
  for (const line of r.status === 0 ? r.stdout.split('\n').filter(Boolean) : []) {
    const [name, commit] = line.split(' ');
    const n = Number(name.slice(`${refDir(sid)}/pre/`.length));
    if (Number.isInteger(n) && n > 0) pre.set(n, commit);
  }
  const turns = [];
  for (let i = 0; i < posts.length; i++) {
    const t = posts[i];
    // numbers are consecutive from 1: a hole means a photo is gone
    if (t.n !== i + 1) return { ok: false, why: 'old' };
    const before = pre.get(t.n) ?? (t.n === 1 ? zero?.commit : null);
    if (!before) return { ok: false, why: 'old' };
    turns.push({ n: t.n, pre: before, post: t.commit });
  }
  return { ok: true, repo, zero: zero?.commit ?? turns[0].pre, turns };
}
// The next message takes a new photo: used when the conversation moves to another folder.
export const forgetPhotos = (sid) => { lastPhoto.delete(sid); };

// When a conversation moves to another folder, the photos taken before each of its messages stop being a valid place to go
// back to: they show the other folder. They are renamed (not deleted) so a rewind says why it is not available, and a
// switch that is undone puts them back. Checked here, in the engine, so no caller can rewind across the change.
const MOVED = (sid) => `${refDir(sid)}/antes-movidos`;
async function renameRefs(repo, from, to) {
  const r = await gitAsync(repo, {}, 'for-each-ref', '--format=%(refname) %(objectname)', `${from}/`);
  let n = 0;
  for (const line of r.status === 0 ? r.stdout.split('\n').filter(Boolean) : []) {
    const [name, commit] = line.split(' ');
    const dest = `${to}/${name.slice(from.length + 1)}`;
    if ((await gitAsync(repo, {}, 'update-ref', dest, commit)).status === 0) { await gitAsync(repo, {}, 'update-ref', '-d', name); n++; }
  }
  return n;
}
export const retirePhotos = (repo, sid) => serial(sid, () => { lastPhoto.delete(sid); return renameRefs(repo, `${refDir(sid)}/antes`, MOVED(sid)); });
export const restorePhotos = (repo, sid) => serial(sid, () => renameRefs(repo, MOVED(sid), `${refDir(sid)}/antes`));
// True when the photo before that message exists but belongs to the folder the conversation left.
export async function photoMoved(cwd, sid, itemId) {
  const id = Number(itemId);
  if (!Number.isInteger(id) || id < 1 || !cwd || !(await isGitRepoAsync(cwd))) return false;
  const repo = await repoRootAsync(cwd);
  return (await gitAsync(repo, {}, 'rev-parse', '--verify', '--quiet', `${MOVED(sid)}/${id}^{commit}`)).status === 0;
}

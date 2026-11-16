// What each turn of a direct chat changed. When an agent's turn ends the engine takes a light snapshot of the working
// tree (the same raw, secret-free commit the task checkpoints use, built with a temporary index) and keeps it under
// refs/orb/turnos/<session>/<n>. n = 0 is the folder as it was before the first turn; turn n changed what lies between
// n-1 and n. Nothing here touches the user's files, index, branches or stash, and the refs sit outside refs/heads and
// refs/tags, so no default push or fetch refspec ever carries them (turns.test.mjs checks it). Diffs are read from the
// commits (`git diff <a> <b>`), never by checking anything out.
import { git, gitAsync, REF_PREFIX, isGitRepoAsync, repoRootAsync } from '../../platform/git.mjs';
import { snapshotCommitAsync, diffBetween } from '../tasks/checkpoints.mjs';

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

async function take(cwd, sid, { start, alive }) {
  if (!(await isGitRepoAsync(cwd))) return null;
  // the chat was archived or deleted while the turn ran: nothing is left behind
  if (alive && !alive()) { dropNow(cwd, sid); return null; }
  const repo = await repoRootAsync(cwd);
  const have = await listRefs(repo, sid);
  if (start && have.length) return null; // the baseline is only the folder before the very first turn
  const snap = await snapshotCommitAsync(repo, { raw: true, always: true, message: `orb: turno ${sid}` });
  if (!snap) return null;
  const n = have.length ? have[have.length - 1].n + 1 : 0;
  const r = await gitAsync(repo, {}, 'update-ref', `${refDir(sid)}/${n}`, snap.commit);
  return r.status === 0 ? { n, commit: snap.commit } : null;
}

// Before a turn starts: the baseline, once per conversation. Never throws: a failed photo only means no panel.
export const snapshotBeforeTurn = (cwd, sid, alive) => serial(sid, () => take(cwd, sid, { start: true, alive })).catch(() => null);
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

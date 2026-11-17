// «Volver los archivos a como estaban antes de este mensaje». The folder goes back to the photo taken right before that
// message (turns.mjs › photoBefore). Before anything is written a rescue copy of the folder as it is now is kept, so the
// rewind itself can be undone. Only files change: HEAD, the index, branches and the stash are never touched, and
// ignored or secret-looking files are not in either photo, so they are never read or written. Commits an agent made
// since then stay in the history; their files are what goes back.
import { git, gitAsync, REF_PREFIX } from '../../platform/git.mjs';
import { fullSnapshot, undoCheckpoint } from '../tasks/checkpoints.mjs';
import { photoBefore, PHOTO_AT } from './turns.mjs';

const RESCUE = `${REF_PREFIX}/rescate`;
const KEEP = 10; // rescue copies kept per chat; the oldest go first
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const HASH = /^[0-9a-f]{40,64}$/;
// the item that shows the result is one stored line (20.000 characters): a few paths per list, each clipped
const MAX_PATHS = 20;
const rescueDir = (sid) => { if (!ID.test(String(sid))) throw new Error('conversación no válida'); return `${RESCUE}/${sid}`; };
const cut = (list) => list.slice(0, MAX_PATHS).map((p) => (p.length > 150 ? `…${p.slice(-149)}` : p));

async function prune(repo, sid) {
  const r = await gitAsync(repo, {}, 'for-each-ref', '--format=%(refname)', `${rescueDir(sid)}/`);
  if (r.status !== 0) return;
  const names = r.stdout.split('\n').filter(Boolean).sort((a, b) => Number(a.split('/').pop()) - Number(b.split('/').pop()));
  for (const name of names.slice(0, Math.max(0, names.length - KEEP))) await gitAsync(repo, {}, 'update-ref', '-d', name);
}

// The photo a rewind to `itemId` would go back to, or null.
export const rewindTarget = (cwd, sid, itemId) => photoBefore(cwd, sid, itemId);

// → { rescue, target, ref, restored, removed, skipped } (paths capped; the counts are whole). Throws when no rescue copy can be made.
export async function rewindFiles(cwd, sid, itemId) {
  const photo = await photoBefore(cwd, sid, itemId);
  if (!photo) throw new Error('no photo');
  const { repo, commit: target } = photo;
  const rescue = await fullSnapshot(repo, { message: `orb: rescate antes de rebobinar ${sid}` });
  if (!rescue?.commit) throw new Error('no rescue');
  const ref = `${rescueDir(sid)}/${Date.now()}`;
  if ((await gitAsync(repo, {}, 'update-ref', ref, rescue.commit)).status !== 0) throw new Error('no rescue ref');
  await prune(repo, sid);
  // Files in the rescue copy but not in the photo count as created after it, unless they are older than the photo
  // (they were ignored then and stopped being so). Photos without the exact time fall back to the commit's whole
  // seconds plus a margin that leans toward keeping files.
  const msg = (await gitAsync(repo, {}, 'show', '-s', '--format=%ct%n%B', target)).stdout;
  const lines = msg.split(/\r?\n/);
  const exact = Number(lines.find((l) => l.startsWith(PHOTO_AT))?.slice(PHOTO_AT.length));
  const taken = Number(lines[0]);
  const madeAfter = exact > 0 ? exact : taken > 0 ? taken * 1000 + 2000 : Infinity;
  const out = undoCheckpoint({ kind: 'git', repo, commit: target, raw: true }, { commit: rescue.commit }, { safe: true, madeAfter });
  return { rescue: rescue.commit, target, ref, restored: out.restored.length, removed: out.removed.length, skipped: out.skipped.length,
    files: { restored: cut(out.restored), removed: cut(out.removed), skipped: cut(out.skipped) } };
}

// Puts back what the rewind removed or replaced, only in files still as the rewind left them (the rest come back as
// `skipped`). The rescue ref must still exist and point at the copy this rewind made.
export async function undoRewindFiles(cwd, body) {
  const rescue = String(body?.rescue ?? ''); const target = String(body?.target ?? ''); const ref = String(body?.ref ?? '');
  if (!HASH.test(rescue) || !HASH.test(target) || !ref.startsWith(`${RESCUE}/`)) throw new Error('bad rewind');
  const repo = (await gitAsync(cwd, {}, 'rev-parse', '--show-toplevel')).stdout.trim();
  if (!repo) throw new Error('no repo');
  const now = await gitAsync(repo, {}, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
  if (now.stdout.trim() !== rescue) throw new Error('rescue gone');
  const out = undoCheckpoint({ kind: 'git', repo, commit: rescue, raw: true }, { commit: target }, { safe: true });
  return { restored: out.restored.length, removed: out.removed.length, skipped: out.skipped.length,
    files: { restored: cut(out.restored), removed: cut(out.removed), skipped: cut(out.skipped) } };
}

// A conversation deleted for good takes its rescue copies with it (an archived one keeps them: its rewind can still be undone).
// Sync on purpose, like dropTurns: it runs where the conversation is removed.
export function dropRescues(cwd, sid) {
  try {
    const refs = git(cwd, 'for-each-ref', '--format=%(refname)', `${rescueDir(sid)}/`);
    if (refs.status !== 0) return 0;
    const names = refs.stdout.split(/\r?\n/).filter(Boolean);
    for (const name of names) git(cwd, 'update-ref', '-d', name);
    return names.length;
  } catch { return 0; }
}

// Which run of a task a stored checkpoint belongs to. A run is told apart by the id of the task's last 'task.launched'
// event: it is written at every start and nothing else moves it (a folder without git reuses its copy, a git one keeps
// its first commit, so the checkpoint alone cannot tell two runs apart).
import { createHash } from 'node:crypto';

export function lastLaunch(board, taskId) {
  return board.one("SELECT id, at FROM events WHERE task_id = ? AND kind = 'task.launched' ORDER BY id DESC LIMIT 1", Number(taskId)) ?? null;
}
export const lastLaunchId = (board, taskId) => lastLaunch(board, taskId)?.id ?? 0;

// The identifier a phone keeps. Without an undo point it still tells runs apart (null only for a task never launched).
export function runIdentifier(before, run) {
  if (!before && !run) return null;
  return createHash('sha1').update(JSON.stringify([before?.kind ?? 'none', before ? (before.commit ?? before.copy ?? null) : null, run])).digest('hex').slice(0, 16);
}

// The run the undo point's end photo (after) was taken for; null when it predates the mark (cannot be known).
export function runOfAfter(board, taskId, cp, current) {
  const after = cp?.after;
  if (abandonSettled(board, taskId)) return current;
  if (after && Number.isInteger(after.run)) return after.run;
  const last = lastLaunch(board, taskId);
  if (!last) return null;
  // an old mark: still the current run only if nothing was launched after its photo was taken
  if (Number.isFinite(after?.at) && Date.parse(last.at) <= after.at) return current;
  // an older one still (neither run nor time): the 'files.changed' event is written together with the photo, so one
  // newer than the last launch means the photo was taken for that launch
  if (after && !Number.isFinite(after.at)) {
    const ended = board.one("SELECT id FROM events WHERE task_id = ? AND kind = 'files.changed' ORDER BY id DESC LIMIT 1", Number(taskId));
    if (ended && ended.id > last.id) return current;
  }
  return null;
}

// The last launch's join events, newest first: 'integrate.conflict' (left to a task that joins by hand), 'integrate.skipped'
// (that join was given up, or there was no branch) and 'branch.merged' (the user pressed «Unir» in the PC).
const joinEvents = (board, taskId) => board.all("SELECT kind FROM events WHERE task_id = ? AND id > ? AND kind IN ('integrate.conflict', 'integrate.skipped', 'branch.merged') ORDER BY id DESC", Number(taskId), lastLaunchId(board, taskId)).map((r) => r.kind);

// True when the user joined the task's branch by hand in the PC after its last launch: the copy is gone, so the next
// automatic join finds no branch and must not claim the kept point for the new run.
export const mergedByHand = (board, taskId) => joinEvents(board, taskId).includes('branch.merged');

// True while the work of the last run was left to a task that joins it by hand (a conflict joining its copy) or the user
// joined it by hand: the stored diff then no longer describes what the folder has. It ends with a new launch or when
// that join is given up.
export function joinedByHand(board, taskId) {
  const kinds = joinEvents(board, taskId);
  return kinds.includes('branch.merged') || kinds[0] === 'integrate.conflict';
}

// The id of the newest event of a kind after the last launch (0 when none).
const lastOf = (board, taskId, kind) => board.one('SELECT id FROM events WHERE task_id = ? AND id > ? AND kind = ? ORDER BY id DESC LIMIT 1', Number(taskId), lastLaunchId(board, taskId), kind)?.id ?? 0;

// True when a hand join was given up (its task failed or was cancelled) and the point is still of an earlier run.
function givenUp(board, taskId) {
  const kinds = joinEvents(board, taskId);
  if (kinds[0] !== 'integrate.skipped' || !kinds.includes('integrate.conflict') || kinds.includes('branch.merged')) return false;
  const cp = board.settingJson(`checkpoint:${taskId}`);
  return Boolean(cp?.before) && cp.after?.run !== lastLaunchId(board, taskId);
}

// True once that join was given up and the user discarded the copy, in either order (the copy can be discarded while the
// joining task still runs): nothing is left to join, so the kept point is the one of the folder as it is. A discard empties
// the task's branch, so no later join of this launch can follow it.
export const abandonSettled = (board, taskId) => givenUp(board, taskId) && lastOf(board, taskId, 'branch.discarded') > 0;

// True when the task that joined this run by hand failed or was cancelled and the point is still of an earlier run:
// nothing will ever bring the folder and the stored diff together, so only the PC can settle it (discarding the copy does).
export const joinAbandoned = (board, taskId) => givenUp(board, taskId) && !abandonSettled(board, taskId);

// True while a given-up hand join is still half-done: its join task is still the one that failed or was cancelled, in the
// same launch it gave up in. A join task started again (retry) or finished since is no longer a half-done join.
export function partialJoin(board, taskId) {
  const partial = board.settingJson(`joinpartial:${taskId}`);
  if (!partial || !joinAbandoned(board, taskId)) return null;
  const by = board.task(partial.by);
  if (!by || !['failed', 'cancelled'].includes(by.status)) return null;
  if (Number.isInteger(partial.run) && partial.run !== lastLaunchId(board, by.id)) return null;
  return partial;
}

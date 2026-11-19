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
  if (after && Number.isInteger(after.run)) return after.run;
  const last = lastLaunch(board, taskId);
  if (!last) return null;
  // an old mark: still the current run only if nothing was launched after its photo was taken
  if (Number.isFinite(after?.at) && Date.parse(last.at) <= after.at) return current;
  return null;
}

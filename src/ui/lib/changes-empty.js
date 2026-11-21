// What the Cambios tab of a task says when it has no files: the reason is worked out from the task and from what tasks.diff really answered.
export const diffOf = (raw) => (raw?.available && raw.files?.length ? raw : null);

// Why the Cambios tab has no files, from the task and what tasks.diff really answered (reason, files).
export function emptyReason(task, raw, canUndo) {
  if (['queued', 'awaiting_approval', 'running'].includes(task.status) && !task.hasCheckpoint) return 'notDone';
  if (task.status === 'running') return 'notDone';
  if (task.undone && !diffOf(raw)) return 'undone';
  if (!task.hasCheckpoint) return 'nophoto';
  if (!raw) return 'loading';
  if (raw.available === false) {
    if (raw.reason === 'nogit') return canUndo ? 'nogitUndo' : 'nogit';
    // «notdone» is true only while the task has not finished; a finished one without its final photo cannot show anything
    if (raw.reason === 'notdone') return ['queued', 'awaiting_approval', 'waiting', 'running'].includes(task.status) ? 'notDone' : 'nophotoAfter';
    return raw.reason === 'error' ? 'error' : 'gone';
  }
  // only secret-looking files changed: they are never shown, and saying «no changes» would be false
  if (raw.hidden > 0 && !diffOf(raw)) return 'protected';
  return 'unchanged';
}

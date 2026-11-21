// Whether a notice about a task (held, done and reviewed) may go to the phones: not when its schedule was told not to
// notify, and not when the chat the task belongs to is muted. The chat lines of the same fact use this to stay quiet
// when the notice is the one that goes out (the phone gets one message per fact, not one per line).
import { scheduleEndMeta } from '../schedules/schedules.mjs';
import { isMuted } from '../conversations/inbox.mjs';

export function phoneNoticeAllowed(board, task) {
  if (!task) return false;
  try {
    if (scheduleEndMeta(board, task).quiet) return false;
    const conversation = board.conversationOfTask(task.id);
    if (conversation != null && isMuted(board, conversation)) return false;
  } catch { return false; }
  return true;
}

// The reviewed task a «correct» verdict of this finished review announces as done, or null.
export function reviewedDoneOf(board, task) {
  if (!task?.review_of || !/VEREDICTO:\s*CORRECTO/i.test(task.result ?? '')) return null;
  const reviewed = board.task(task.review_of);
  return reviewed?.status === 'done' ? reviewed : null;
}

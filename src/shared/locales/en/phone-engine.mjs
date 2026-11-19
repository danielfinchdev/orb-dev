// Engine texts the phone shows as they come: notices of its notice centre and the refusals of task and queue actions.
export default {
  'msg.notice.done': '#{id} finished and reviewed',
  'msg.notice.held': 'Orb stopped #{id} · {reasons}',
  'msg.notice.heldNoReason': 'Orb stopped #{id} · needs your review',
  'msg.notice.update': 'Orb {version} is available on the PC',
  'msg.notice.limit': '{account} has usage available again',
  'msg.notice.hidden': 'You have a new notice',
  'msg.board.waitFolder': 'waiting for task #{by} to finish writing in the same folder',
  'msg.queue.changed': 'the waiting message has changed since you saw it; open it again',
  'msg.queue.slashCommand': 'a waiting message cannot become a command (/clear, /compact): remove it and send the command',
  'msg.undo.joinUnfinished': 'the join of this task was left unfinished; resolve it on the PC',
  'msg.undo.runNotReady': 'the changes of the last run are not ready yet; open it again in a moment',
  'msg.undo.runUnknown': 'cannot tell which run this undo point belongs to; undo it from the PC',
  'msg.undo.rerunSinceUndo': 'the task has run again since you opened “Undo”; open it again to review it',
  'msg.undo.joinedByHand': 'this task was joined by hand on the PC; undo it from the PC',
  'msg.undo.noFinalState': 'the PC did not save the final state of this task; undoing it would put its whole folder back as it was before, including what changed afterwards. Do it from the PC if you really want that',
  'msg.accept.rerunSinceSeen': 'the task has run again since you saw it; open it again to review it',
  'msg.accept.held': 'the task is held by the guard; review its changes on the PC before accepting it',
  'msg.accept.statusChanged': 'the task can no longer be accepted: its status has changed; open it again'
};

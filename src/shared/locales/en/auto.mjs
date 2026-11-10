// 3.8.3: the «Auto» permission level (src/domain/security/guard.mjs) and its switch in the chats and in Settings.
export default {
  'msg.guard.diskWipe': 'wipes or formats a disk, or changes how the PC boots',
  'msg.guard.credentials': 'touches personal credentials (SSH keys, browsers, the agents’ logins or the Windows credential store), which Orb doesn’t allow',
  'msg.guard.otherSecret': 'reads another project’s secrets (.env, keys or certificates), which Orb doesn’t allow',
  'msg.guard.outside': 'writes outside the project folder ({what})',
  'msg.guard.publishAsked': 'publishes because you asked for it in your message',
  'msg.sessions.autoAllowed': 'Auto: {what} ({why}). It can be undone.',
  'msg.auto.notice': 'Agents work without asking inside the project folder and everything can be undone. They still ask before publishing, sending data or leaving it.',
  'auto.noticeTitle': 'Auto mode is on',
  'auto.noticeAsk': 'Use Ask',
  'msg.board.publishWords': 'publishing',
  'msg.scheduler.safetyDeletedShare': 'deleted {deleted} of the project’s {total} files ({pct} %)',
  'session.autoMode': 'Auto',
  'session.askMode': 'Ask',
  'session.autoTip': 'Works on its own inside the folder; asks before publishing, sending data or leaving it',
  'session.askTip': 'Asks before deleting folders, undoing git changes or writing outside the folder',
  'session.moreModes': 'More permission options',
  'session.autoOn': 'Auto mode',
  'session.askOn': 'Ask mode',
  'chat.autoGlobalTip': 'For every chat and task that doesn’t choose another mode',
  'settings.autonomy': 'Agent permissions',
  'settings.autonomyHint': 'Auto: they work without asking inside the project folder (it can be undone). Ask: they ask before anything risky. They always ask before publishing, sending data or leaving the folder.'
};

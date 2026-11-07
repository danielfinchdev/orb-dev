// 3.6 "Personas", WS5: backups, templates, moving the Orb, exporting and deleting a person, time zones
export default {
  'data.person.deletedLine': '(message deleted)',
  'data.tz.late': '{n} min late',

  'data.templates.unknown': 'There is no template called "{id}".',
  'data.templates.bad': 'Something in "{what}" does not fit in this template. Check it and try again.',

  'data.backup.restored': 'Backup restored (from {created}).',
  'data.backup.dailyFailed': 'Today\'s backup could not be made: {error}. It will try again in an hour.',
  'data.backup.err.badKind': 'That kind of backup does not exist.',
  'data.backup.err.damaged': 'The backup is damaged or someone changed it: it cannot be used.',
  'data.backup.err.needsPassphrase': 'This backup was made on another computer: type your recovery code.',
  'data.backup.err.wrongPassphrase': 'The recovery code is not right.',
  'data.backup.err.otherMachine': 'This backup was made on another computer and has no recovery code: it only opens there.',
  'data.backup.err.newerFormat': 'This backup comes from a newer version of Orb. Update Orb and try again.',
  'data.backup.err.noKey': 'Nothing to lock the backup with: set a recovery code.',
  'data.backup.err.notBackup': 'That file is not an Orb backup (.orbbak).',
  'data.backup.err.missing': 'I cannot find that backup.',
  'data.backup.err.shortPassphrase': 'The code must be at least 12 characters long.',

  'data.move.notMove': 'That backup is not for moving an Orb: use "Restore".',
  'data.move.movedAway': 'This Orb was moved to another computer and is no longer used here. In Settings › Data you can undo it or keep both.',

  'data.server.notEmpty': 'That folder already holds an Orb. Pick a new folder.'
};

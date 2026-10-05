// labels.js (statuses, permissions, decisions…) and relative times.
export default {
  'status.queued': 'Queued', 'status.awaiting_approval': 'Awaiting approval', 'status.running': 'Working', 'status.done': 'Done',
  'status.failed': 'Failed', 'status.blocked': 'Blocked', 'status.cancelled': 'Cancelled', 'status.limited': 'Waiting for quota',
  'sessionStatus.running': 'Working', 'sessionStatus.error': 'Errored', 'sessionStatus.interrupted': 'Halfway', 'sessionStatus.limited': 'Waiting for quota',
  'agent.any': 'Any', 'agent.user': 'You',
  'permission.leer': 'Read only', 'permission.editar': 'Edit files', 'permission.preguntar': 'Ask first', 'permission.total': 'Full access',
  'permissionHint.leer': 'Can read the project but changes nothing.',
  'permissionHint.editar': 'Edits files and runs commands in the project. Anything risky (push, downloads, deleting folders…) it asks you about first.',
  'permissionHint.preguntar': 'Edits files, but asks before every command. For keeping a close eye on things.',
  'permissionHint.total': 'No checks at all. Only use it if you know what you are doing.',
  'decision.allowed': 'Allowed', 'decision.always': 'Always allowed', 'decision.denied': 'Denied', 'decision.expired': 'No longer active',
  'reasoning.low': 'Low', 'reasoning.medium': 'Medium', 'reasoning.high': 'High',
  'mode.carpeta': 'In the project folder', 'mode.aislada': 'Isolated copy (own branch)',
  'sensitive.external_write': 'writes outside', 'sensitive.publish': 'publishes', 'sensitive.financial': 'payments', 'sensitive.credential_access': 'credentials',
  'sensitive.destructive': 'deletes data', 'sensitive.razonamiento_alto': 'high reasoning', 'sensitive.creada_por_agente': 'created by an agent', 'sensitive.ruta_cambiada': 'the folder changed',
  'login.si': 'Signed in', 'login.no': 'Not signed in', 'login.desconocido': 'Not checked',
  'time.now': 'now', 'time.minAgo': '{n} min ago', 'time.hAgo': '{n} h ago'
};

// labels.js (statuses, permissions, decisions…) and relative times.
export default {
  'status.queued': 'Queued', 'status.awaiting_approval': 'Awaiting approval', 'status.running': 'In progress', 'status.done': 'Completed',
  'status.failed': 'Failed', 'status.blocked': 'Blocked', 'status.cancelled': 'Cancelled', 'status.limited': 'Waiting for quota',
  'sessionStatus.running': 'In progress', 'sessionStatus.error': 'Error', 'sessionStatus.interrupted': 'Interrupted', 'sessionStatus.limited': 'Waiting for quota',
  'agent.any': 'Any', 'agent.user': 'You',
  'permission.leer': 'Read-only', 'permission.editar': 'Edit files', 'permission.preguntar': 'Ask first', 'permission.total': 'Full access',
  'permissionHint.leer': 'Can read the project but not modify it.',
  'permissionHint.editar': 'Edits files and runs commands in the project. Asks for confirmation before risky actions (push, downloads, folder deletion…).',
  'permissionHint.preguntar': 'Edits files and asks for confirmation before each command.',
  'permissionHint.total': 'No confirmations. Use with caution.',
  'decision.allowed': 'Allowed', 'decision.always': 'Always allowed', 'decision.denied': 'Denied', 'decision.expired': 'Expired',
  'reasoning.low': 'Low', 'reasoning.medium': 'Medium', 'reasoning.high': 'High',
  'mode.carpeta': 'In the project folder', 'mode.aislada': 'Isolated copy (own branch)',
  'sensitive.external_write': 'writes outside the project', 'sensitive.publish': 'publishes', 'sensitive.financial': 'payments', 'sensitive.credential_access': 'credentials',
  'sensitive.destructive': 'deletes data', 'sensitive.razonamiento_alto': 'high reasoning', 'sensitive.creada_por_agente': 'created by an agent', 'sensitive.ruta_cambiada': 'folder changed',
  'login.si': 'Signed in', 'login.no': 'Not signed in', 'login.desconocido': 'Not checked',
  'time.now': 'now', 'time.minAgo': '{n} min ago', 'time.hAgo': '{n} h ago'
};

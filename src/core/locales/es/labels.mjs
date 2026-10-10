// labels.js (estados, permisos, decisiones…) y tiempos relativos.
export default {
  'status.queued': 'En cola', 'status.awaiting_approval': 'Pendiente de aprobación', 'status.running': 'En curso', 'status.done': 'Completada',
  'status.failed': 'Fallida', 'status.blocked': 'Bloqueada', 'status.cancelled': 'Cancelada', 'status.limited': 'Esperando cupo',
  'sessionStatus.running': 'En curso', 'sessionStatus.error': 'Error', 'sessionStatus.interrupted': 'Interrumpida', 'sessionStatus.limited': 'Esperando cupo',
  'agent.any': 'Cualquiera', 'agent.user': 'Tú',
  'permission.leer': 'Solo lectura', 'permission.editar': 'Editar archivos', 'permission.preguntar': 'Preguntar antes', 'permission.total': 'Acceso total',
  'permissionHint.leer': 'Puede leer el proyecto, pero no modificarlo.',
  'permissionHint.editar': 'Edita archivos y ejecuta comandos en el proyecto. Pide confirmación para las acciones de riesgo (push, descargas, eliminación de carpetas…).',
  'permissionHint.preguntar': 'Edita archivos y pide confirmación antes de cada comando.',
  'permissionHint.total': 'Sin confirmaciones. Úsalo con precaución.',
  'decision.allowed': 'Permitido', 'decision.always': 'Permitido siempre', 'decision.denied': 'Denegado', 'decision.expired': 'Caducado',
  'reasoning.low': 'Bajo', 'reasoning.medium': 'Medio', 'reasoning.high': 'Alto',
  'mode.carpeta': 'En la carpeta del proyecto', 'mode.aislada': 'Copia aislada (rama propia)',
  'sensitive.external_write': 'escribe fuera del proyecto', 'sensitive.publish': 'publica', 'sensitive.financial': 'pagos', 'sensitive.credential_access': 'credenciales',
  'sensitive.destructive': 'elimina datos', 'sensitive.razonamiento_alto': 'razonamiento alto', 'sensitive.creada_por_agente': 'creada por un agente', 'sensitive.ruta_cambiada': 'carpeta modificada',
  'login.si': 'Sesión iniciada', 'login.no': 'Sesión no iniciada', 'login.desconocido': 'Sin comprobar',
  'time.now': 'ahora', 'time.minAgo': 'hace {n} min', 'time.hAgo': 'hace {n} h'
};

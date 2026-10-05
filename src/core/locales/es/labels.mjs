// labels.js (estados, permisos, decisiones…) y tiempos relativos.
export default {
  'status.queued': 'En cola', 'status.awaiting_approval': 'Espera aprobación', 'status.running': 'Trabajando', 'status.done': 'Hecha',
  'status.failed': 'Fallida', 'status.blocked': 'Bloqueada', 'status.cancelled': 'Cancelada', 'status.limited': 'Esperando cupo',
  'sessionStatus.running': 'Trabajando', 'sessionStatus.error': 'Con error', 'sessionStatus.interrupted': 'A medias', 'sessionStatus.limited': 'Esperando cupo',
  'agent.any': 'Cualquiera', 'agent.user': 'Tú',
  'permission.leer': 'Solo leer', 'permission.editar': 'Editar archivos', 'permission.preguntar': 'Preguntar antes', 'permission.total': 'Acceso total',
  'permissionHint.leer': 'Puede leer el proyecto pero no cambia nada.',
  'permissionHint.editar': 'Edita archivos y ejecuta comandos en el proyecto. Lo arriesgado (push, descargas, borrar carpetas…) te lo pregunta antes.',
  'permissionHint.preguntar': 'Edita archivos, pero te pregunta antes de cada comando. Para vigilar de cerca.',
  'permissionHint.total': 'Sin comprobaciones. Úsalo solo si sabes lo que haces.',
  'decision.allowed': 'Permitido', 'decision.always': 'Permitido siempre', 'decision.denied': 'Denegado', 'decision.expired': 'Ya no está activo',
  'reasoning.low': 'Bajo', 'reasoning.medium': 'Medio', 'reasoning.high': 'Alto',
  'mode.carpeta': 'En la carpeta del proyecto', 'mode.aislada': 'Copia aislada (rama propia)',
  'sensitive.external_write': 'escribe fuera', 'sensitive.publish': 'publica', 'sensitive.financial': 'pagos', 'sensitive.credential_access': 'credenciales',
  'sensitive.destructive': 'borra datos', 'sensitive.razonamiento_alto': 'razonamiento alto', 'sensitive.creada_por_agente': 'creada por un agente', 'sensitive.ruta_cambiada': 'la carpeta cambió',
  'login.si': 'Sesión iniciada', 'login.no': 'Sin sesión', 'login.desconocido': 'Sin comprobar',
  'time.now': 'ahora', 'time.minAgo': 'hace {n} min', 'time.hAgo': 'hace {n} h'
};

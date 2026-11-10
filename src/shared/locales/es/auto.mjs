// 3.8.3: the «Auto» permission level (src/domain/security/guard.mjs) and its switch in the chats and in Ajustes.
export default {
  'msg.guard.diskWipe': 'borra o formatea un disco, o cambia el arranque del PC',
  'msg.guard.credentials': 'toca credenciales personales (claves SSH, navegadores, sesiones de los agentes o el almacén de Windows), que Orb no permite',
  'msg.guard.otherSecret': 'lee secretos de otro proyecto (.env, claves o certificados), que Orb no permite',
  'msg.guard.outside': 'escribe fuera de la carpeta del proyecto ({what})',
  'msg.guard.publishAsked': 'publica porque lo pediste en tu mensaje',
  'msg.sessions.autoAllowed': 'Auto: {what} ({why}). Se puede deshacer.',
  'msg.auto.notice': 'Nuevo: modo «Auto». Los agentes trabajan sin preguntar dentro de la carpeta del proyecto y todo se puede deshacer; siguen preguntando antes de publicar, enviar datos o salir de ella. Para volver a «Preguntar»: un clic bajo la caja del chat o en Ajustes › Agentes.',
  'msg.board.publishWords': 'publicar',
  'msg.scheduler.safetyDeletedShare': 'ha eliminado {deleted} de {total} archivos del proyecto ({pct} %)',
  'session.autoMode': 'Auto',
  'session.askMode': 'Preguntar',
  'session.autoTip': 'Trabaja solo dentro de la carpeta; pregunta antes de publicar, enviar datos o salir de ella',
  'session.askTip': 'Pregunta antes de borrar carpetas, deshacer cambios de git o escribir fuera de la carpeta',
  'session.moreModes': 'Más opciones de permisos',
  'session.autoOn': 'Modo Auto',
  'session.askOn': 'Modo Preguntar',
  'chat.autoGlobalTip': 'Para todos los chats y tareas que no elijan otro modo',
  'settings.autonomy': 'Permisos de los agentes',
  'settings.autonomyHint': 'Auto: trabajan sin preguntar dentro de la carpeta del proyecto (se puede deshacer). Preguntar: piden permiso antes de lo arriesgado. Siempre preguntan antes de publicar, enviar datos o salir de la carpeta.'
};

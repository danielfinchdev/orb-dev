// 3.6 «Personas» (WS4, bots por persona): bots compartidos, tarjetas de cada uno, memorias con historial, la casa y
// «Llevar mis bots».
export default {
  'msg.bots.brainNotConfined': '{agent} no puede ser el cerebro de un bot: podría leer cualquier archivo del equipo. Elige Claude o Codex.',
  'msg.bots.brainBrokeOut': 'Este Codex no deja apagar sus comandos, así que ya no se usa para bots. Actualiza Codex o elige Claude.',
  'msg.bots.accountNotYours': 'La cuenta elegida para {name} no es tuya ni te la han prestado para bots. Elige otra en el editor del bot.',
  'msg.bots.notApprover': 'Esta tarjeta no la puedes aprobar tú.',
  'msg.bots.card.memory.mine': '{bot} quiere guardar en tu memoria: {text}',
  'msg.bots.card.memory.bot': '{bot} quiere guardar en la memoria del bot (la leen todos los que hablan con él): {text}',
  'msg.bots.card.memory.global': '{bot} quiere guardar en tu memoria global: {text}',
  'msg.bots.reminderLate': '(con {n} min de retraso)',
  'msg.bots.memoryGone': 'Ese cambio de la memoria ya no está pendiente.',
  'msg.bots.badHaAllow': 'No entiendo «{entry}». Escribe dominio.servicio y la entidad, por ejemplo: light.turn_on light.salon',
  'msg.bots.moveMismatch': 'La copia de {name} no ha quedado igual.',
  'sys.botmcp.memoryPending': 'Guardado como pendiente: {user} tiene que aprobarlo antes.',
  'msg.guard.botOtherPerson': 'quiere leer lo que otra persona guarda de este bot'
};

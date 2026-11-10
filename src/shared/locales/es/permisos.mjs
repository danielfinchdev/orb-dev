// Who may do what (src/domain/security/permissions.mjs).
export default {
  'msg.authz.denied': 'No tienes acceso a esto.',
  'msg.authz.messageNeedsTask': 'Un mensaje a otro agente debe ser sobre una de tus tareas (task_id).',
  'msg.authz.notYourLog': 'La bitácora de {name} no es de un proyecto de esta conversación.',
  'msg.authz.notYourScope': 'La tarea #{id} no es de tu conversación: solo puedes escribir a las tareas de tu misma conversación.',
  'msg.authz.notYourTask': 'La tarea #{id} no es de esta conversación ni de tu tarea.',
  'msg.authz.busy': 'Orb está ocupado y no ha podido confirmar tu firma: vuelve a intentarlo en unos segundos.',
  'msg.authz.wrongAgent': 'La tarea #{id} es de {agent}: para que le llegue, escribe con to: "{agent}".',
  'msg.authz.unsigned': 'Orb no ha firmado este proceso: no puede usar el tablero.'
};

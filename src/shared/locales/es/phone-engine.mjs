// Engine texts the phone shows as they come: notices of its notice centre and the refusals of task and queue actions.
export default {
  'msg.notice.done': '#{id} terminada y revisada',
  'msg.notice.held': 'Orb paró la #{id} · {reasons}',
  'msg.notice.heldNoReason': 'Orb paró la #{id} · necesita tu revisión',
  'msg.notice.update': 'Orb {version} disponible en el PC',
  // «Tiene límite» means the account has usage available again (the wording of the approved mock-up).
  'msg.notice.limit': '{account} ya tiene límite otra vez',
  'msg.notice.hidden': 'Tienes un aviso nuevo',
  'msg.board.waitFolder': 'espera a que la tarea #{by} termine de escribir en la misma carpeta',
  'msg.queue.changed': 'el mensaje en cola ha cambiado desde que lo viste; ábrelo de nuevo',
  'msg.queue.slashCommand': 'un mensaje en cola no puede ser un comando (/clear, /compact): quítalo y envía el comando',
  'msg.undo.joinUnfinished': 'la unión de esta tarea quedó sin terminar; resuélvela en el PC',
  'msg.undo.runNotReady': 'los cambios de la última ejecución aún no están listos; vuelve a abrirla en un momento',
  'msg.undo.runUnknown': 'no se puede comprobar a qué ejecución pertenece este punto de vuelta; deshazla desde el PC',
  'msg.undo.rerunSinceUndo': 'la tarea se ha vuelto a ejecutar desde que abriste «Deshacer»; ábrela de nuevo para revisarla',
  'msg.undo.joinedByHand': 'esta tarea se unió a mano en el PC; deshazla desde el PC',
  'msg.undo.noFinalState': 'el PC no guardó el estado final de esta tarea; deshacerla devolvería toda su carpeta a como estaba antes, también lo que se cambió después. Hazlo desde el PC si de verdad quieres eso',
  'msg.accept.rerunSinceSeen': 'la tarea se ha vuelto a ejecutar desde que la viste; ábrela de nuevo para revisarla',
  'msg.accept.held': 'la tarea está retenida por la guardia; revisa sus cambios en el PC antes de aceptarla',
  'msg.accept.statusChanged': 'la tarea ya no se puede aceptar: su estado ha cambiado; ábrela de nuevo'
};

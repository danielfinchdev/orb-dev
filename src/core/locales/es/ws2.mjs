// 3.6 «Personas» (WS2, la puerta): dispositivos y enlaces de cada persona, versiones, bloqueo de la ventana y
// Orb Server.
export default {
  'msg.persons.lockedWindow': 'La ventana está bloqueada. Desbloquéala con tu PIN.',
  'msg.link.clone': '{name} parece una copia de otro Orb. No lo atiendo hasta que lo revises en Ajustes › Magic Link.',
  'msg.link.cloneRefused': 'Este Orb te ve como una copia de otro. Revisa el enlace en los dos Orbs.',
  'msg.link.moved': '{name} se ha mudado a otro equipo. El enlace sigue funcionando.',
  'msg.link.updateClient': 'Actualiza esta app: tiene la {has} y hace falta la {need}.',
  'msg.link.updateOrb': 'Actualiza {name}: tiene la {has} y hace falta la {need}.',
  'msg.link.notYourTaller': 'Ese Orb para programar no está enlazado para ti.',
  'msg.link.tallerUnknown': '{name} no ha contestado a tiempo. No sé si lo hizo: compruébalo o vuelve a intentarlo desde la cola.',
  'msg.link.noQueued': 'Esa petición ya no está en la cola.',
  'msg.link.backupNotYours': 'Solo un Orb del admin, confirmado aquí, puede guardar sus copias en este.',
  'msg.link.backupBad': 'La copia no llegó bien. Vuelve a enviarla.',
  'msg.link.backupTooBig': 'La copia es demasiado grande (el máximo son {mb} MB).',
  'msg.link.adminOwnerOnly': '«Puede administrar» solo se da a un dispositivo del admin.',
  'msg.link.qrForOthers': 'Solo el admin puede enlazar dispositivos para otro usuario.',
  'msg.link.noPeer': 'Ese enlace no existe.',
  'term.server.isOwner': 'admin',
  'term.server.hasPin': 'con PIN',
  'term.server.personDevices': '{n} dispositivos',
  'term.server.personsHint': 'Para enlazar un dispositivo de alguien: {cmd}',
  'term.server.personCreated': 'Listo: {name} ya usa este Orb.',
  'term.server.noPerson': 'No hay nadie llamado «{name}» en este Orb (mira orb-server usuarios).',
  'term.server.pinReset': 'Listo: {name} ya no tiene PIN. Puede elegir otro desde su perfil.',
  'term.server.forPerson': 'Este código es para {name}.'
};

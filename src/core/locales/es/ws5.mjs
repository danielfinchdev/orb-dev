// 3.6 «Personas», WS5: copias de seguridad, plantillas, mover el Orb, exportar y borrar una persona, zonas horarias
export default {
  'data.person.deletedLine': '(mensaje borrado)',
  'data.tz.late': 'con {n} min de retraso',

  'data.templates.unknown': 'No hay ninguna plantilla «{id}».',
  'data.templates.bad': 'La plantilla tiene algo que no cuadra en «{what}». Revísalo y vuelve a probar.',

  'data.backup.restored': 'Copia de seguridad restaurada (del {created}).',
  'data.backup.dailyFailed': 'No se pudo hacer la copia de seguridad de hoy: {error}. Se vuelve a probar dentro de una hora.',
  'data.backup.err.badKind': 'Ese tipo de copia no existe.',
  'data.backup.err.damaged': 'La copia está dañada o alguien la ha cambiado: no se puede usar.',
  'data.backup.err.needsPassphrase': 'Esta copia se hizo en otro equipo: escribe tu código de recuperación.',
  'data.backup.err.wrongPassphrase': 'El código de recuperación no es correcto.',
  'data.backup.err.otherMachine': 'Esta copia se hizo en otro equipo y no tiene código de recuperación: solo se abre allí.',
  'data.backup.err.newerFormat': 'Esta copia es de una versión más nueva de Orb. Actualiza Orb y vuelve a probar.',
  'data.backup.err.noKey': 'No hay con qué cerrar la copia: pon un código de recuperación.',
  'data.backup.err.notBackup': 'Ese archivo no es una copia de Orb (.orbbak).',
  'data.backup.err.missing': 'No encuentro esa copia.',
  'data.backup.err.shortPassphrase': 'El código tiene que tener al menos 12 caracteres.',

  'data.move.notMove': 'Esa copia no es para mover un Orb: usa «Restaurar».',
  'data.move.movedAway': 'Este Orb se ha movido a otro equipo y ya no se usa aquí. En Ajustes › Datos puedes deshacerlo o mantener los dos.',

  'data.server.backupDone': 'Copia hecha: {file} ({files} archivos).',
  'data.server.noBackups': 'Todavía no hay copias.',
  'data.server.backupsIn': 'Copias en {folder}',
  'data.server.restoreReady': 'Copia comprobada ({files} archivos). Se pone en marcha al arrancar Orb otra vez.',
  'data.server.restoreDone': 'Copia restaurada. Lo que había antes está en {aside}.',
  'data.server.restartService': 'Reinicia el servicio para usarla: systemctl --user restart orb-server',
  'data.server.recoveryCode': 'Tu código de recuperación (apúntalo y guárdalo fuera de este equipo; no se vuelve a mostrar):',
  'data.server.recoverySet': 'Código de recuperación guardado. Las copias nuevas se abren con él en otro equipo.',
  'data.server.moveDone': 'Copia para mover hecha: {file}. Llévala al equipo nuevo con su código.',
  'data.server.moveImported': 'Orb importado en {home}. Este es ya el Orb que manda; el de antes deja de funcionar.',
  'data.server.needCode': 'Falta el código: --clave <código> (o la variable ORB_BACKUP_CODE).',
  'data.server.notEmpty': 'Esa carpeta ya tiene un Orb. Elige una carpeta nueva.'
};

// data.* — 3.6: copias de seguridad, plantillas del asistente de inicio, mover el Orb y zonas horarias
export default {
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

  'data.nucleo.backupDone': 'Copia hecha: {file} ({files} archivos).',
  'data.nucleo.noBackups': 'Todavía no hay copias.',
  'data.nucleo.backupsIn': 'Copias en {folder}',
  'data.nucleo.restoreReady': 'Copia comprobada ({files} archivos). Se pone en marcha al arrancar Orb otra vez.',
  'data.nucleo.restoreDone': 'Copia restaurada. Lo que había antes está en {aside}.',
  'data.nucleo.restartService': 'Reinicia el servicio para usarla: systemctl --user restart orb-nucleo',
  'data.nucleo.recoveryCode': 'Tu código de recuperación (apúntalo y guárdalo fuera de este equipo; no se vuelve a mostrar):',
  'data.nucleo.recoverySet': 'Código de recuperación guardado. Las copias nuevas se abren con él en otro equipo.',
  'data.nucleo.moveDone': 'Copia para mover hecha: {file}. Llévala al equipo nuevo con su código.',
  'data.nucleo.moveImported': 'Orb importado en {home}. Este es ya el Orb que manda; el de antes deja de funcionar.',
  'data.nucleo.needCode': 'Falta el código: --clave <código> (o la variable ORB_BACKUP_CODE).',
  'data.nucleo.notEmpty': 'Esa carpeta ya tiene un Orb. Elige una carpeta nueva.'
};

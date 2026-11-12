package dev.orb.app.ui.notes

/** Every text of the notices center, in Spanish and with the words the desktop app uses. */
object NotesTexts {
    const val TITLE = "Notificaciones"
    const val BACK = "Volver"
    const val BELL = "Notificaciones"
    const val MARK_ALL = "Marcar todo leído"
    const val EMPTY = "No hay notificaciones"
    const val EMPTY_HINT = "Aquí aparecen los mensajes y permisos que llegan mientras tienes Orb abierto."
    const val OFFLINE_STRIP = "Sin conexión con el PC. Se muestra lo último recibido."
    const val PC_NOT_TOLD = "Marcados aquí, pero el PC no se ha enterado"
    const val KIND_APPROVAL = "Permiso"
    const val KIND_TASK = "Tarea"
    const val KIND_MESSAGE = "Mensaje"

    fun kind(kind: String) = when (kind) {
        "approval" -> KIND_APPROVAL
        "task" -> KIND_TASK
        else -> KIND_MESSAGE
    }

    fun unreadDescription(n: Int) = if (n == 1) "Notificaciones, 1 sin leer" else "Notificaciones, $n sin leer"
}

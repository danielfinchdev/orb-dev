package dev.orb.app.ui.projects

/** Every text of the project screens, in Spanish and with the words the desktop app uses. */
object ProjectTexts {
    const val TITLE = "Proyectos"
    const val FILTER_ACTIVE = "Activos"
    const val FILTER_FINISHED = "Terminados"

    const val EMPTY = "No hay proyectos"
    const val EMPTY_HINT = "Crea uno con «Nuevo»."
    const val EMPTY_FINISHED = "No hay proyectos terminados"
    const val LOAD_ERROR = "No se pudieron cargar los proyectos desde el PC."
    const val RETRY = "Reintentar"
    const val OFFLINE_STRIP = "Sin conexión con el PC. Se muestra lo último recibido."
    const val ACTION_OFFLINE = "Sin conexión con el PC: no se ha cambiado nada."
    const val ACTION_FAILED = "No se pudo hacer en el PC"

    const val NEW = "Nuevo"
    const val NEW_TITLE = "Nuevo proyecto"
    const val NEW_NAME = "Nombre"
    const val NEW_NOTES = "Notas (opcional)"
    const val NEW_CATEGORY = "Categoría"
    const val NEW_CREATE = "Crear proyecto"
    const val CREATED = "Proyecto creado"

    const val ACTIVE_BADGE = "Activo"
    const val CALM = "Tranquilo"
    const val MAKE_ACTIVE = "Hacer activo"
    const val CLEAR_ACTIVE = "Quitar de activo"
    const val ACTIVE_SET = "Proyecto activo"
    const val ACTIVE_CLEARED = "Ya no hay proyecto activo"

    const val REOPEN = "Reabrir"
    const val REOPENED = "Proyecto reabierto"
    const val CANCEL = "Cancelar"

    fun open(n: Int) = if (n == 1) "1 tarea" else "$n tareas"
    fun finishedOn(at: String?) = if (at.isNullOrBlank()) "Terminado" else "Terminado el ${at.take(10)}"
}

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

    const val BACK = "Volver"
    const val SECTION_CHATS = "Chats"
    const val SECTION_TASKS = "Tareas"
    const val SECTION_MORE = "Más del proyecto"
    const val NO_CHATS = "Este proyecto no tiene chats"
    const val NO_TASKS = "Este proyecto no tiene tareas"
    const val DETAIL_ERROR = "No se pudo cargar el proyecto desde el PC."
    const val BRANCH = "Rama y cambios"
    const val NO_GIT = "Sin git"
    const val REVIEW = "Revisión"
    const val SECURITY_REVIEW = "Revisión de seguridad"
    const val LOG = "Bitácora del proyecto"
    const val LOG_EMPTY = "La bitácora está vacía"
    const val CLOSE = "Cerrar"
    const val FINISH = "Terminar proyecto"
    const val FINISH_ASK = "¿Terminar este proyecto?"
    const val FINISH_BODY = "Sale de la lista y pasa a «Terminados»; sus tareas pendientes se cancelan y sus programadas se pausan. Podrás reabrirlo."
    const val FINISH_CONFIRM = "Terminar"
    const val FINISHED = "Proyecto terminado"
    const val PRS = "Pull requests"

    fun branchValue(g: ProjectGit?): String {
        if (g == null) return NO_GIT
        val parts = listOfNotNull(
            g.branch,
            g.changes?.takeIf { it > 0 }?.let { if (it == 1) "1 cambio" else "$it cambios" },
            g.ahead?.takeIf { it > 0 }?.let { "$it por subir" },
        )
        return if (parts.isEmpty()) "al día" else parts.joinToString(" · ")
    }

    fun reviewStarted(id: Long?) = if (id == null) "Revisión pedida" else "Revisión pedida (tarea #$id)"
    fun securityStarted(id: Long?) = if (id == null) "Revisión de seguridad pedida" else "Revisión de seguridad pedida (tarea #$id)"
}

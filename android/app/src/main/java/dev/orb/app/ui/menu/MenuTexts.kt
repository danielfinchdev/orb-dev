package dev.orb.app.ui.menu

/** Every text of the menu and of «Memorias y actividad», in Spanish and with the words the desktop app uses. */
object MenuTexts {
    const val MENU = "Menú"
    const val SECTION_WORK = "Trabajo"
    const val SECTION_SETTINGS = "Ajustes"
    const val NOTICES = "Notificaciones"
    const val SCHEDULES = "Programadas"
    const val ACTIVITY = "Memorias y actividad"
    const val USAGE = "Uso y agentes"
    const val TUTORIALS = "Tutoriales"
    const val THIS_PHONE = "Este móvil"
    const val APPEARANCE = "Apariencia"
    const val LINK_TEST = "Prueba de conexión"
    const val UNLINK = "Desenlazar este móvil"
    const val CLOSE = "Cerrar"

    const val BACK = "Volver"
    const val TAB_ACTIVITY = "Actividad"
    const val TAB_LOGS = "Bitácoras"
    const val EMPTY_ACTIVITY = "No hay actividad"
    const val EMPTY_LOGS = "No hay bitácoras"
    const val LOAD_ERROR = "No se pudo cargar desde el PC."
    const val KEPT_SAVED = "No se pudo actualizar desde el PC. Se muestra lo último guardado."
    const val TUT_SEARCH = "Buscar en los tutoriales…"
    const val TUT_SECTION_HOW = "Cómo funciona"
    const val TUT_SECTION_FAQ = "Preguntas frecuentes"
    const val TUT_EXPAND = "Mostrar"
    const val TUT_COLLAPSE = "Ocultar"
    const val TUT_CLEAR = "Borrar la búsqueda"

    fun tutNoResults(q: String) = "No hay resultados para «$q»."

    const val RETRY = "Reintentar"
    const val LOG_LOADING = "Cargando…"

    fun unread(n: Int) = if (n == 1) "1 sin leer" else "$n sin leer"

    fun logSize(bytes: Long) = if (bytes < 1024) "$bytes B" else "${bytes / 1024} KB"

    fun kind(kind: String): String = KINDS[kind] ?: kind.replace('_', ' ').replaceFirstChar { it.uppercase() }

    private val KINDS = mapOf(
        "task_created" to "Tarea creada",
        "task_updated" to "Tarea actualizada",
        "task_approved" to "Tarea aprobada",
        "task_rejected" to "Tarea rechazada",
        "task_accepted" to "Resultado aceptado",
        "task_usage" to "Uso de la tarea",
        "task_undone" to "Tarea deshecha",
        "task_followup" to "Mensaje a la tarea",
        "task_held" to "Tarea retenida para revisar",
        "agent_reply" to "Respuesta del agente",
        "agent_problem" to "Problema del agente",
        "log_written" to "Bitácora actualizada",
        "note" to "Nota",
        "git_commit" to "Cambios guardados (commit)",
        "files_changed" to "Archivos cambiados",
        "user_message" to "Mensaje del usuario",
        "review_verdict" to "Veredicto de la revisión",
        "project_saved" to "Proyecto guardado",
        "project_removed" to "Proyecto quitado",
        "branch_merged" to "Rama unida a la carpeta",
        "followup_sent" to "Seguimiento enviado",
    )
}

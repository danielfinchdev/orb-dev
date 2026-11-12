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

    const val PRS_TITLE = "Pull requests"
    const val PRS_EMPTY = "No hay pull requests abiertas"
    const val PRS_ERROR = "No se pudieron cargar las pull requests."
    const val PR_ERROR = "No se pudo cargar la pull request."
    const val PR_DRAFT = "Borrador"
    const val PR_OPEN = "Abierta"
    const val PR_MERGED = "Fusionada"
    const val PR_CLOSED = "Cerrada"
    const val PR_MERGE = "Fusionar"
    const val PR_MERGE_ASK = "¿Fusionar esta pull request?"
    const val PR_MERGE_NOTE = "El PC la fusionará con su cuenta de GitHub. Desde el móvil no se puede deshacer."
    const val PR_MERGE_METHOD = "Método"
    const val PR_MERGED_DONE = "Pull request fusionada"
    const val PR_STATE = "Estado"
    const val PR_MERGE_STATE = "Fusión"
    const val PR_BRANCH = "Rama"
    const val PR_AUTHOR = "Autor"
    const val PR_CHANGES = "Cambios"
    const val PR_CHECKS = "Comprobaciones"
    const val PR_NO_CHECKS = "Sin comprobaciones"
    const val PR_REVIEW = "Revisión"
    const val PR_MERGEABLE = "Se puede fusionar"
    const val PR_CONFLICTS = "Tiene conflictos"
    const val PR_DESCRIPTION = "Descripción"

    fun prState(d: PrDetail) = when {
        d.merged -> PR_MERGED
        d.open -> if (d.draft) PR_DRAFT else PR_OPEN
        else -> PR_CLOSED
    }

    fun reviewDecision(r: String?) = when (r) {
        "APPROVED" -> "Aprobada"
        "CHANGES_REQUESTED" -> "Piden cambios"
        "REVIEW_REQUIRED" -> "Falta revisión"
        else -> null
    }

    fun mergeable(m: String?) = when (m) {
        "MERGEABLE" -> PR_MERGEABLE
        "CONFLICTING" -> PR_CONFLICTS
        else -> null
    }

    fun checksSummary(checks: List<PrCheck>): String {
        if (checks.isEmpty()) return PR_NO_CHECKS
        val ok = checks.count { it.passed }
        val bad = checks.count { it.failed }
        return buildString {
            append("$ok de ${checks.size} correctas")
            if (bad > 0) append(" · $bad con fallo")
        }
    }

    fun changes(d: PrDetail) = "${d.changedFiles} archivos · +${d.additions} −${d.deletions}"

    /** The PC's own words when it refused, so «gh no está instalado» reaches the person unchanged. */
    fun pcError(e: Throwable): String {
        val refused = (e as? dev.orb.app.link.net.LinkException)?.error as? dev.orb.app.link.net.LinkError.Refused
        return refused?.error?.takeIf { it.isNotBlank() } ?: dev.orb.app.ui.linkErrorText(e)
    }

    fun mergeMethod(m: String) = when (m) {
        "squash" -> "Squash (un solo commit)"
        "rebase" -> "Rebase"
        else -> "Merge (commit de fusión)"
    }
}

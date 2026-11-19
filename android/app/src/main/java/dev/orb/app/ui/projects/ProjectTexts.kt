package dev.orb.app.ui.projects

/** Every text of the project screens, in Spanish and with the words the desktop app uses. */
object ProjectTexts {
    const val TITLE = "Proyectos"
    const val FILTER_ACTIVE = "Activos"
    const val FILTER_FINISHED = "Terminados"

    const val EMPTY = "Aún no hay proyectos"
    const val EMPTY_HINT = "Crea uno para agrupar sus chats y tareas."
    const val EMPTY_NEW = "Nuevo proyecto"
    const val LOADING = "Cargando proyectos"
    fun activeLine(n: Int) = if (n == 1) "1 activo" else "$n activos"
    const val EMPTY_FINISHED = "No hay proyectos terminados"
    const val LOAD_ERROR = "No se pudieron cargar los proyectos desde el PC."
    const val RETRY = "Reintentar"
    const val ACTION_OFFLINE = "Sin conexión con el PC: no se ha cambiado nada."
    const val ACTION_FAILED = "No se pudo hacer en el PC"

    const val NEW = "Nuevo"
    const val NEW_TITLE = "Nuevo proyecto"
    const val NEW_NAME = "Nombre del proyecto"
    const val NEW_NOTES = "Notas (opcional)"
    const val NEW_CATEGORY = "Categoría"
    const val NO_CATEGORY = "Sin categoría"
    const val NEW_ICON = "Icono"
    const val NEW_ICON_NOTE = "El punto sale del nombre del proyecto; no se guarda nada más."
    const val NEW_MORE = "Más opciones"
    const val EXPANDED = "Desplegado"
    const val COLLAPSED = "Plegado"
    const val NEW_PC_NOTE = "Clonar, importar, renombrar y eliminar proyectos: en el PC."
    const val NEW_CREATE = "Crear"
    fun iconOf(name: String) = if (name.isBlank()) "Icono: aún sin nombre" else "Icono de $name"
    const val CREATED = "Proyecto creado"

    const val CALM = "Tranquilo"
    const val ACTIVE_STATE = "Proyecto activo"
    const val ACTIVE_NOTE = "Es el proyecto activo del PC."
    const val DETACHED_HEAD = "HEAD suelto"
    const val MAKE_ACTIVE = "Hacer activo"
    const val CLEAR_ACTIVE = "Quitar de activo"
    const val ACTIVE_SET = "Proyecto activo"
    const val ACTIVE_CLEARED = "Ya no hay proyecto activo"

    const val REOPEN = "Reabrir"
    const val REOPENED = "Proyecto reabierto"
    const val CANCEL = "Cancelar"

    fun open(n: Int) = if (n == 1) "1 tarea" else "$n tareas"
    fun toApprove(n: Int) = "$n por aprobar"

    /** «dev · 2 archivos sin confirmar», «main · al día»; null when git said nothing about the project, so the card has no such line. */
    fun gitLine(g: ProjectGit?): String? {
        val changes = g?.changes ?: return null
        val where = g.branch ?: DETACHED_HEAD
        return "$where · " + if (changes == 0) "al día" else uncommitted(changes)
    }
    fun finishedOn(at: String?) = if (at.isNullOrBlank()) "Terminado" else "Terminado el ${at.take(10)}"

    const val BACK = "Volver"
    const val MORE = "Más"
    const val TASK = "Tarea"
    const val NEW_CHAT = "Nuevo chat"
    const val NEW_TASK_FIXED = "Nueva tarea"
    const val TASK_CREATED = "Tarea creada"
    const val CHATS_COUNT = "Chats"
    const val SECTION_CHATS = "Chats"
    const val SECTION_TASKS = "Tareas"
    const val SECTION_MORE = "Más del proyecto"
    const val NO_CHATS = "Este proyecto no tiene chats"
    const val NO_TASKS = "Este proyecto no tiene tareas"
    const val DETAIL_ERROR = "No se pudo cargar el proyecto desde el PC."
    const val BRANCH = "Rama y cambios"
    const val BRANCH_NAME = "Rama"
    const val BRANCH_CHANGES = "Cambios"
    const val BRANCH_TASKS = "Tareas"
    const val BRANCH_AHEAD = "Por subir"
    fun ahead(n: Int) = if (n == 1) "1 commit sin subir" else "$n commits sin subir"
    const val NO_GIT = "Sin git"
    const val CROSS_REVIEW = "Revisión cruzada"
    const val SEE_CHANGES = "Ver cambios"
    const val NO_TASK_CHANGES = "No hay cambios de tareas sin aceptar"
    const val PICK_CHANGES = "Cambios sin aceptar"
    const val TASKS_ROW = "Tareas del proyecto"
    const val SEE_IN_PC = "Los cambios sin confirmar de todo el proyecto solo se ven en el PC."

    /** What git says: files changed in the folder and not committed yet. */
    fun uncommitted(n: Int) = if (n == 1) "1 archivo sin confirmar" else "$n archivos sin confirmar"

    /** What the tasks say: finished work whose changes the person has not accepted or undone yet. */
    fun unaccepted(n: Int) = when (n) { 0 -> "Ninguna tarea con cambios sin aceptar"; 1 -> "1 tarea con cambios sin aceptar"; else -> "$n tareas con cambios sin aceptar" }

    fun branchMeta(g: ProjectGit?): String? {
        if (g == null) return null
        val changes = g.changes?.takeIf { it > 0 }
        return listOfNotNull(g.branch ?: DETACHED_HEAD, changes?.let { "$it sin confirmar" }).joinToString(" · ")
    }

    fun headerLine(open: Int) = if (open == 0) "Sin tareas en curso" else if (open == 1) "1 tarea en curso" else "$open tareas en curso"
    fun barLine(category: String?, g: ProjectGit?) = listOfNotNull(category, g?.let { "rama " + (it.branch ?: DETACHED_HEAD) }).joinToString(" · ").ifEmpty { null }

    const val FINISHED_TITLE = "Proyecto terminado"
    const val FINISHED_HINT = "Está en «Terminados»"
    const val WHITEBOARD_META = "Se abre en el móvil"
    fun finishAsk(name: String) = "¿Terminar «$name»?"
    const val REVIEW_ASK = "¿Pedir la revisión del proyecto?"
    const val SECURITY_ASK = "¿Pedir la revisión de seguridad?"
    const val REVIEW_BODY = "Un agente revisará el proyecto y gastará parte de tu plan."
    const val REVIEW_CONFIRM = "Pedir revisión"
    const val SECURITY_REVIEW = "Revisión de seguridad"
    const val LOG = "Bitácora del proyecto"
    const val LOG_EMPTY = "La bitácora está vacía"
    const val CLOSE = "Cerrar"
    const val FINISH = "Terminar proyecto"
    const val FINISH_BODY = "Sale de la lista y pasa a «Terminados»; sus tareas pendientes se cancelan y sus programadas se pausan. Podrás reabrirlo."
    const val FINISH_CONFIRM = "Terminar"
    const val FINISHED = "Proyecto terminado"
    const val WHITEBOARD = "Pizarra"
    const val PRS = "Pull requests"

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
    const val PR_MERGE_UPDATE_PC = "Actualiza Orb en el PC para fusionar."
    const val PR_MERGE_ASK = "¿Fusionar esta pull request?"
    const val PR_MERGE_NOTE = "El PC la fusionará con su cuenta de GitHub. Desde el móvil no se puede deshacer."
    const val PR_MERGE_METHOD = "Método"
    const val PR_MERGE_CHECKING = "Puede que la PR ya se haya fusionado; comprobando…"
    const val PR_BRANCH_CHANGED = "La rama del pull request cambió desde que la viste. Se ha vuelto a cargar: revisa los cambios nuevos y vuelve a fusionar si todo sigue bien."
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

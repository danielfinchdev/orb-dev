package dev.orb.app.ui.tasks

/** Every text of the task screens, in Spanish and with the words the desktop app uses. */
object TaskTexts {
    const val TITLE = "Tareas"
    const val SEARCH = "Buscar tareas"
    const val SEARCH_HINT = "Buscar en el título y el resultado"
    const val CLOSE_SEARCH = "Cerrar la búsqueda"
    const val NO_RESULTS = "No hay tareas con ese texto"

    // The sections of the board, in the order the mockup draws them
    const val SECTION_APPROVE = "Por aprobar"
    const val SECTION_RUNNING = "En curso"
    const val SECTION_QUEUED = "En cola"
    const val SECTION_PROBLEMS = "Incidencias"
    const val SECTION_DONE = "Completadas"

    // What the board shows, chosen in the «⋯» menu
    const val VIEW_LABEL = "Mostrar"
    const val VIEW_ACTIVE = "Activas"
    const val VIEW_ALL = "Todas"
    const val VIEW_DONE = "Completadas"
    const val MORE = "Más opciones"

    const val EMPTY = "No hay tareas"
    const val EMPTY_HINT = "Cuando Orbe o un agente creen una, aparecerá aquí."
    const val ALL_CLEAR = "Todo al día"
    const val ALL_CLEAR_HINT = "No hay nada por aprobar, en curso ni esperando."
    const val EMPTY_DONE = "Ninguna tarea completada"
    const val SHOW_ALL = "Ver todas"
    const val LOAD_ERROR = "No se pudieron cargar las tareas desde el PC."
    const val RETRY = "Reintentar"
    const val ACTION_OFFLINE = "Sin conexión con el PC: no se ha cambiado nada."
    const val ACTION_FAILED = "No se pudo hacer en el PC"
    const val ACCEPT_CHANGED = "La tarea ha cambiado en el PC desde que la viste: revisa lo nuevo antes de aceptarla."

    const val NEW_TASK = "Nueva tarea"
    const val NEW_TASK_PROJECT = "Proyecto"
    const val NEW_TASK_TITLE = "Título"
    const val NEW_TASK_DESCRIPTION = "Qué tiene que hacer"
    const val NEW_TASK_CREATE = "Crear tarea"
    const val NEW_TASK_NO_PROJECTS = "El PC no tiene proyectos todavía."
    const val NEW_TASK_LOADING = "Cargando proyectos…"
    const val TASK_CREATED = "Tarea creada"

    const val PAUSED_TITLE = "Cola en pausa"
    fun waitingCount(n: Int) = "$n esperando"
    fun pausedBanner(waiting: Int) = if (waiting == 0) PAUSED_TITLE else "$PAUSED_TITLE · ${waitingCount(waiting)}"
    const val RESUME = "Reanudar"
    const val PAUSE = "Pausar la cola"
    const val RESUME_QUEUE = "Reanudar la cola"
    const val QUEUE_RESUMED = "Cola reanudada"
    const val QUEUE_PAUSED = "Cola en pausa"

    /** The line under the title of the bar: what the queue is doing. */
    fun queueLine(paused: Boolean, running: Int, waiting: Int): String = when {
        paused -> pausedBanner(waiting)
        running == 0 && waiting == 0 -> "Cola en marcha"
        else -> listOfNotNull(running.takeIf { it > 0 }?.let { "$it en curso" }, waiting.takeIf { it > 0 }?.let(::waitingCount)).joinToString(" · ")
    }

    // The two buttons of a row that waits for the OK. The first only opens the task: the OK itself is given where all of it is shown.
    const val SEE_AND_APPROVE = "Ver y aprobar"
    const val SEE_AND_REVIEW = "Revisar"
    const val WAITS_FOR_OK = "Espera tu OK"
    fun waitsForOk(reasons: String?) = if (reasons.isNullOrBlank()) WAITS_FOR_OK else "$WAITS_FOR_OK: $reasons"
    fun rejectAsk(id: Long) = "¿Rechazar la #$id?"
    fun rejectBodyFor(id: Long, title: String) = "«$title» (#$id) se cancela y no se ejecuta."
    const val TASK_CHANGED = "La tarea ha cambiado: ábrela para revisarla."

    // Why a queued task waits (the same words as the desktop app)
    const val WAIT_PAUSED = "En pausa"
    const val WAIT_MANUAL = "Inicio manual"
    const val WAIT_NOTICE = "En espera"
    const val WAIT_TURN = "En cola"
    const val WAIT_MANUAL_NOTE = "Las tareas no se inician solas (Ajustes del PC › Iniciar las tareas automáticamente). Pulsa «Iniciar de todos modos» para iniciar esta."
    const val WAIT_PAUSED_NOTE = "La cola de tareas está en pausa: ninguna tarea empieza hasta que la reanudes."

    private val STUCK = setOf("failed", "blocked", "cancelled")

    const val WAIT_FOLDER = "Otra tarea escribe en esta carpeta"
    fun waitFolder(by: Long?) = if (by == null) WAIT_FOLDER else "$WAIT_FOLDER (#$by)"

    /** «Espera a la #43», «Espera a las #2, #5»; the reason comes after when a dependency needs the person. */
    fun waitsFor(on: List<WaitDep>): String {
        val ids = on.joinToString(", ") { "#${it.id}" }
        val held = on.firstOrNull { it.held }
        val stuck = on.firstOrNull { it.status in STUCK }
        val lead = if (on.size == 1) "Espera a la $ids" else "Espera a las $ids"
        return when {
            held != null -> "$lead: #${held.id} está por aprobar"
            stuck != null -> "$lead: #${stuck.id} está detenida"
            else -> lead
        }
    }

    /** «Claude al 94 % del límite · vuelve a las 15:00»; the PC's own words when it did not say the account or the time. */
    fun noticeText(w: TaskWait, clock: String?): String {
        val account = w.account
        if (account != null && clock != null) {
            val level = w.percent?.let { "al $it % del límite" } ?: "al límite"
            return "$account $level · vuelve a las $clock"
        }
        return w.text?.takeIf { it.isNotBlank() } ?: WAIT_NOTICE
    }

    const val LIMITED = "Límite de uso"
    fun limitedBack(clock: String?) = if (clock == null) LIMITED else "$LIMITED · vuelve a las $clock"

    fun waitText(w: TaskWait?): String = when {
        w == null -> WAIT_TURN
        w.kind == "paused" -> WAIT_PAUSED
        w.kind == "manual" -> WAIT_MANUAL
        w.kind == "deps" && w.on.isNotEmpty() -> {
            val ids = w.on.joinToString(", ") { "#${it.id}" }
            val held = w.on.firstOrNull { it.held }
            val stuck = w.on.firstOrNull { it.status in STUCK }
            when {
                held != null -> "Espera a $ids: #${held.id} está por aprobar"
                stuck != null -> "Espera a $ids: #${stuck.id} está detenida"
                else -> "Espera a $ids"
            }
        }
        w.kind == "folder" -> waitFolder(w.by)
        w.kind == "notice" -> w.text?.takeIf { it.isNotBlank() } ?: WAIT_NOTICE
        else -> WAIT_TURN
    }

    fun status(s: String?, held: Boolean = false): String = when {
        held -> "Por aprobar"
        s == "running" -> "En curso"
        s == "done" -> "Completada"
        s == "failed" -> "Fallida"
        s == "blocked" -> "Bloqueada"
        s == "cancelled" -> "Cancelada"
        s == "limited" -> "Límite de uso"
        s == "queued" || s == "pending" -> "En cola"
        s == "awaiting_approval" -> "Espera tu OK"
        else -> s.orEmpty()
    }

    fun projectAgent(project: String?, agent: String?): String =
        listOfNotNull(project?.takeIf { it.isNotBlank() }, agent?.takeIf { it.isNotBlank() }).joinToString(" · ")

    // Detail
    const val BACK = "Volver"
    const val DETAIL_ERROR = "No se pudo leer la tarea desde el PC."
    const val WHY_WAITS = "¿Por qué espera?"
    const val WHAT_TO_DO = "Qué tiene que hacer"
    const val RESULT = "Resultado"
    const val DETAILS = "Detalles"
    const val HISTORY = "Historial"
    const val SUBTASKS = "Subtareas"
    const val DEPENDS_ON = "Depende de"
    const val FOLDER = "Carpeta"
    const val MODE = "Modo"
    const val FOLDER_SHARED = "En la carpeta del proyecto"
    const val FOLDER_ISOLATED = "Copia aislada"
    const val BRANCH = "Rama"
    const val AGENT = "Agente"
    const val MODEL = "Modelo"
    const val REASONING = "Razonamiento"
    const val READ_ONLY = "Solo lectura"
    const val ACCOUNT = "Cuenta"
    const val CREATED = "Creada"
    const val YES = "Sí"
    const val UNDONE = "Deshecha"
    const val UNDONE_NOTE = "Los archivos volvieron a como estaban antes de la tarea."

    const val LAUNCH_ANYWAY = "Iniciar de todos modos"
    const val LAUNCH_ASK = "¿Iniciar esta tarea ahora?"
    const val LAUNCH_BODY = "Se salta la espera y empieza ya, aunque la cola siga en pausa."
    const val LAUNCH_CONFIRM = "Iniciar"
    const val REJECT_ASK = "¿Rechazar esta tarea?"
    const val REJECT_BODY = "Rechazarla cancela la tarea."
    const val REJECT_CONFIRM = "Rechazar y cancelar"
    const val SEE_ALL = "Ver todo"
    fun createdBy(who: String) = " por $who"
    const val NO_CONTENT_CHANGES = "Sin cambios de contenido en este archivo"
    const val LAUNCH_STARTED = "Se inicia ahora"
    const val LAUNCH_PAUSED_NOTE = "Se inicia ahora; el resto de la cola sigue en pausa."
    const val REASSIGN = "Reasignar"
    const val FOLLOWUP = "Seguir"
    const val RETRY_TASK = "Reintentar"
    const val RETRY_DONE = "Añadida de nuevo a la cola"
    const val CANCEL_TASK = "Cancelar"
    const val CANCEL_ASK = "¿Cancelar esta tarea?"
    const val CANCEL_RUNNING = "El agente se detendrá de inmediato."
    const val CANCEL_BACK = "Volver"
    const val CANCEL_CONFIRM = "Cancelar tarea"
    const val CANCELLED = "Tarea cancelada"
    const val REVIEW = "Revisar tarea"
    const val REVIEW_DONE = "Revisión solicitada"
    const val SEE_CHANGES = "Ver cambios"
    const val APPROVE = "Aprobar"
    const val REJECT = "Rechazar"
    const val APPROVED = "Tarea aprobada"
    const val REJECTED = "Tarea rechazada"
    const val ACCEPT = "Aceptar"
    const val ACCEPTED = "Cambios aceptados"
    const val UNDO = "Deshacer"
    const val UNDO_TASK_TITLE = "Deshacer esta tarea"
    const val UNDO_TASK_BODY = "Se restauran los archivos modificados por esta tarea. Los cambios posteriores se conservan."
    const val UNDO_DONE = "Deshecho"
    fun heldLine(reasons: String, folder: String?) =
        if (folder.isNullOrBlank()) "Retenida para que la revises: $reasons." else "Retenida para que la revises: $reasons en $folder."

    const val REASSIGN_TITLE = "Reasignar la tarea"
    const val REASSIGN_AGENT = "Agente"
    const val REASSIGN_AUTO = "Automático"
    const val REASSIGN_REASONING = "Razonamiento"
    const val REASSIGN_OK = "Reasignar"
    const val REASSIGNED = "Tarea reasignada"
    const val FOLLOWUP_TITLE = "Seguir con la tarea"
    const val FOLLOWUP_HINT = "Qué más tiene que hacer"
    const val FOLLOWUP_SEND = "Enviar"
    const val FOLLOWUP_SENT = "Mensaje enviado a la tarea"
    const val DISMISS = "Cancelar"

    fun reasoning(r: String?): String = when (r) {
        "low" -> "bajo"
        "medium" -> "medio"
        "high" -> "alto"
        "xhigh" -> "máximo"
        else -> r.orEmpty()
    }

    // Changes
    fun changesOf(id: Long) = "Cambios de la #$id"
    fun filesCount(n: Int) = if (n == 1) "1 archivo" else "$n archivos"
    fun changesSummary(files: Int, added: Int, removed: Int) = "${filesCount(files)} · +$added −$removed"
    fun moreFiles(n: Int) = "$n archivos más sin mostrar."
    const val NO_CHANGES = "No hay cambios que mostrar"
    const val NO_CHANGES_HINT = "La tarea no cambió archivos, sigue en marcha, se deshizo o el proyecto no usa git."
    const val CHANGES_ERROR = "No se pudieron leer los cambios desde el PC."
    const val BINARY_FILE = "Archivo binario: no hay vista previa."
    const val TOO_BIG = "El cambio es demasiado grande para verlo aquí. Ábrelo en el PC."
    const val SWIPE_HINT = "Desliza a los lados para cambiar de archivo"
    const val ALREADY_ACCEPTED = "Aceptada"
}

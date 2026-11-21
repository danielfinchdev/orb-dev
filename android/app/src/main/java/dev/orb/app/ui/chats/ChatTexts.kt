package dev.orb.app.ui.chats

/** Texts of the chat list, its actions and the search. Everything that changes something says it happens on the PC. */
object ChatTexts {
    const val UNTITLED = "Chat sin título"

    // Shell
    const val TAB_CHATS = "Chats"
    const val TAB_TASKS = "Tareas"
    const val TAB_PROJECTS = "Proyectos"
    const val MENU = "Menú"
    const val MENU_APPEARANCE = "Apariencia"
    const val MENU_LINK_TEST = "Prueba de conexión"
    const val CANCEL = "Cancelar"
    const val SOON_TASKS = "Las tareas llegan al móvil pronto"
    const val SOON_PROJECTS = "Los proyectos llegan al móvil pronto"
    const val SOON_HINT = "Pronto en el móvil; mientras, en el PC."

    // List
    const val SEARCH = "Buscar chats y proyectos"
    const val FILTER_GROUP = "Filtrar chats"
    const val FILTER_ALL = "Todos"
    const val FILTER_UNREAD = "No leídos"
    const val FILTER_WORKING = "Trabajando"
    const val FILTER_DIRECT = "Directos"
    const val PINNED = "Fijados"
    const val NO_PROJECT = "Sin proyecto"
    const val NEW_CHAT = "Nuevo chat"
    const val WORKING = "Trabajando"
    const val WAITING_PERMISSION = "Esperando tu aprobación"
    const val ASKING = "Te pregunta"
    const val MORE_OPTIONS = "Más opciones"
    const val ORDER_PRIORITY = "Ordenar por prioridad"
    const val ORDER_PRIORITY_ON = "Activado"
    const val ORDER_PRIORITY_OFF = "Desactivado"
    const val DAY_SUMMARY = "Resumen del día"
    const val NO_DIGEST = "No hay nada registrado de ayer."
    const val ARCHIVED_SNACK = "Chat archivado"
    const val UNARCHIVE_FAILED = "No se pudo deshacer en el PC"
    const val MARK_READ_SWIPE = "Leído"
    const val FOLDED = "Plegado"
    const val UNFOLDED = "Desplegado"
    const val SHOW_ALL = "Ver todos"
    const val RESTORE_CHAT = "Restaurar"
    const val DONE_LABEL = "Hecha"
    const val PAUSED = "En pausa"
    const val MUTED = "Silenciado"
    const val SNOOZED = "Pospuesto"
    const val EMPTY_TITLE = "Aún no hay chats"
    const val EMPTY_BODY = "Empieza uno nuevo: el PC hace el trabajo y aquí lo ves."
    const val EMPTY_FILTER = "Ningún chat con este filtro"
    const val LOAD_ERROR = "No se pudo cargar la lista desde el PC."
    const val RETRY = "Reintentar"
    const val LOADING = "Cargando chats…"
    const val DIRECT_WITH = "Chat directo con"
    const val YOU = "Tú"
    const val ORBE = "Orbe"

    // Actions
    const val ACTIONS_FOR = "Acciones del chat"
    const val PIN = "Fijar arriba"
    const val UNPIN = "Quitar de fijados"
    const val MARK_READ = "Marcar como leído"
    const val MARK_UNREAD = "Marcar como no leído"
    const val MUTE = "Silenciar"
    const val MUTE_META = "1 h · 8 h · siempre"
    const val MUTE_TITLE = "Silenciar este chat"
    const val MUTE_1H = "1 hora"
    const val MUTE_8H = "8 horas"
    const val MUTE_ALWAYS = "Siempre"
    const val UNMUTE = "Quitar el silencio"
    const val UNMUTE_FOREVER = "Silenciado siempre"
    const val SNOOZE = "Posponer"
    const val SNOOZE_TITLE = "Posponer: vuelve a avisarte"
    const val UNSNOOZE = "Quitar el aplazamiento"
    const val SNOOZE_1H = "En 1 hora"
    const val SNOOZE_AFTERNOON = "Esta tarde"
    const val SNOOZE_TOMORROW = "Mañana"
    const val MOVE_SECTION = "Mover a sección"
    const val NO_SECTION = "Sin sección"
    const val CURRENT = "Actual"
    const val NEW_SECTION = "Nueva sección…"
    const val SECTION_NAME = "Nombre de la sección"
    const val RENAME = "Renombrar"
    const val RENAME_TITLE = "Renombrar el chat en el PC"
    const val TITLE_FIELD = "Título"
    const val SAVE = "Guardar"
    const val CREATE = "Crear"
    const val ARCHIVE = "Archivar"
    const val ARCHIVE_HINT = "Lo guarda el PC; se sigue encontrando al buscar"
    const val DELETE = "Borrar el chat en el PC"
    const val DELETE_HINT = "Se puede deshacer"
    const val NEEDS_PC = "Sin conexión con el PC"
    const val NEEDS_PC_HINT = "Las acciones se hacen en el PC; reconecta para usarlas."
    const val ACTION_FAILED = "No se pudo hacer en el PC"
    const val ACTION_OFFLINE = "Sin conexión con el PC: no se ha cambiado nada."

    // Search
    const val SEARCH_PLACEHOLDER = "Buscar chats, mensajes, tareas y proyectos"
    const val SEARCH_TITLE = "Buscar"
    const val SEARCH_SUBTITLE = "Chats, mensajes, tareas y proyectos"
    const val SEARCH_HINT_BODY = "Busca por contenido en chats, mensajes, tareas y proyectos."
    const val GROUP_IN_MESSAGES = "En mensajes"
    const val SEARCH_HINT_SHORT = "Escribe al menos 2 letras"
    const val SCOPE_ALL = "Todo"
    const val GROUP_CHATS = "Chats"
    const val GROUP_MESSAGES = "Mensajes"
    const val GROUP_TASKS = "Tareas"
    const val GROUP_PROJECTS = "Proyectos"
    const val SEARCH_EMPTY = "Sin resultados"
    const val SEARCH_ERROR = "No se pudo buscar en el PC."
    const val SEARCH_OFFLINE = "Sin conexión con el PC: se busca solo en los chats guardados en el móvil."
    const val SEARCHING = "Buscando en el PC…"
    fun searchNothing(q: String) = "No hay nada con «${q.trim()}»."
    fun projectLine(chats: Int, tasks: Int?) = chatsOf(chats) + (if (tasks != null && tasks > 0) " · " + tasksOf(tasks) else "")
    fun tasksOf(n: Int) = if (n == 1) "1 tarea" else "$n tareas"
    fun completed(n: Int) = "Completados · $n"
    fun taskLine(project: String?, status: String?) = listOfNotNull(project?.takeIf { it.isNotBlank() }, status?.let(::taskStatus)?.takeIf { it.isNotBlank() }).joinToString(" · ")

    /** The line under the wordmark: which PC and how the link is. */
    fun linkLine(s: dev.orb.app.link.net.ConnectionState): String = when (s) {
        is dev.orb.app.link.net.ConnectionState.Online -> "${s.pcName?.takeIf { it.isNotBlank() } ?: "El PC"} · conectado"
        dev.orb.app.link.net.ConnectionState.Connecting -> "Conectando…"
        is dev.orb.app.link.net.ConnectionState.Offline -> "Sin conexión"
        else -> dev.orb.app.ui.connectionText(s)
    }
    const val BACK = "Volver"
    const val CLEAR = "Borrar texto"
    const val PROJECT_ON_PC = "Proyecto en el PC"

    // Placeholders of routes other pieces fill in

    // New chat
    const val NEW_CHAT_ORBE = "Con Orbe"
    const val NEW_CHAT_ORBE_HINT = "Lo divide en tareas y elige agentes"
    const val NEW_CHAT_DIRECT = "Directo con un agente"
    const val NEW_CHAT_DIRECT_HINT_NONE = "Hablas con un agente en una carpeta"
    const val NEW_CHAT_AGENT = "Agente"
    const val NEW_CHAT_FOLDER = "Carpeta"
    const val NEW_CHAT_FOLDER_PROJECT = "la del proyecto"
    const val NEW_CHAT_FOLDER_NONE = "Sin carpeta"
    const val NEW_CHAT_FOLDER_READ_ONLY = "el agente solo puede leer"
    const val NEW_CHAT_RECOMMENDED = "Recomendado"
    const val NEW_CHAT_PROJECT = "Proyecto"
    const val NEW_CHAT_NEW_PROJECT = "Nuevo"
    const val NEW_CHAT_BRAIN = "Cerebro"
    const val NEW_CHAT_BRAIN_AUTO = "El que usa el PC"
    const val NEW_CHAT_BRAIN_AGENT = "Con quién piensa"
    const val NEW_CHAT_MODEL = "Modelo"
    const val NEW_CHAT_EFFORT = "Razonamiento"
    const val NEW_CHAT_MODEL_DEFAULT = "El del PC"
    const val NEW_CHAT_MODEL_DEFAULT_ROW = "modelo por defecto"
    const val NEW_CHAT_USE_PC_CHOICE = "Dejar la elección del PC"
    const val NEW_CHAT_ACCOUNT = "La cuenta la elige el PC."
    const val NEW_CHAT_DONE = "Listo"
    const val NEW_CHAT_START = "Empezar"
    const val NEW_CHAT_STARTING = "Creando…"
    const val NEW_CHAT_CANCEL = "Cancelar"
    const val NEW_CHAT_FAILED = "No se pudo crear el chat en el PC"
    const val NEW_CHAT_LOADING = "Leyendo lo que ofrece el PC…"
    const val NEW_CHAT_OPTIONS_FAILED = "No se pudo leer lo que ofrece el PC. Puedes hablar con Orbe igualmente."
    const val NEW_CHAT_OLD_PC = "Este PC tiene una versión antigua de Orb: actualízala para elegir agente y cerebro. Puedes hablar con Orbe igualmente."
    const val NEW_CHAT_NO_AGENTS = "El PC no tiene ningún agente listo para hablar directo."
    const val NEW_CHAT_OFFLINE = "Sin conexión con el PC. Para empezar un chat hace falta conexión."
    const val NEW_CHAT_PROJECT_TITLE = "Nuevo proyecto"
    const val NEW_CHAT_PROJECT_NAME = "Nombre del proyecto"
    const val NEW_CHAT_PROJECT_CREATE = "Crear"
    const val NEW_CHAT_PROJECT_OFFLINE = "Sin conexión con el PC: no se ha creado el proyecto."
    const val DRAFT_HINT = "Escribe lo primero que necesitas. El chat se crea en el PC al enviarlo."
    const val DRAFT_OFFLINE = "Sin conexión con el PC. Para enviar el primer mensaje hace falta conexión."


    // Delete in the PC
    const val DELETE_TITLE = "¿Eliminar este chat en el PC?"
    const val DELETE_CONFIRM = "Eliminar el chat en el PC"
    const val DELETE_NOTE = "La orden la ejecuta el PC. Las tareas y los cambios del chat no se tocan."
    fun deleteBody(title: String) = "«$title» se eliminará del PC y de lo guardado en este móvil. Se puede deshacer justo después, desde el aviso «Deshacer»."
    const val DELETED_SNACK = "Chat borrado en el PC"
    const val UNDO = "Deshacer"
    const val RESTORED_SNACK = "Chat restaurado en el PC"
    const val DELETE_FAILED = "No se pudo borrar el chat en el PC"
    const val RESTORE_FAILED = "No se pudo deshacer en el PC"
    const val RESTORE_ASK = "Pedir al PC que lo restaure"
    const val CHAT_SOON = "El chat se abre aquí en el siguiente paso."

    // Orbe chat
    const val MESSAGE_FIELD = "Escribe a Orbe…"
    const val SEND = "Enviar"
    const val STOP = "Parar"
    const val STOP_HINT = "Para el turno de Orbe en el PC"
    const val MORE = "Más opciones"
    const val COMPACT = "Compactar la conversación"
    const val COMPACT_ASKED = "Pedido al PC: compactar la conversación."
    const val THINKING = "Pensando…"
    const val WRITING = "Escribiendo…"
    const val WAITING_TURN = "Espera su turno: hay otras conversaciones respondiendo."
    const val NEW_BELOW = "Nuevos"
    const val NEW_BELOW_DESC = "Ir a los mensajes nuevos"
    const val LOADING_OLDER = "Cargando mensajes anteriores…"
    const val ORBE_OFFLINE_TITLE = "Sin conexión con el PC"
    const val ORBE_OFFLINE_BODY = "Leyendo lo guardado en el móvil. Lo que escribas se enviará al reconectar."
    const val NEEDS_PC_TO_ANSWER = "Para responder hace falta conexión con el PC."
    const val ORBE_LOAD_ERROR = "No se pudo leer la conversación desde el PC."
    const val EMPTY_CHAT = "Escribe lo que necesitas: el PC lo hace y aquí lo ves."
    const val CODE_ON_PC = "Se ve en el PC"
    const val COPY_CODE_HINT = "Diagrama o fórmula: el móvil lo muestra como texto."
    const val QUESTION_GONE = "Esa pregunta ya estaba respondida."
    const val REQUEST_GONE = "Esa petición ya no está activa: el agente terminó o se detuvo."

    // Pending messages
    const val PENDING_SENDING = "Enviando…"
    const val PENDING_WAITING = "Se enviará al volver"
    const val PENDING_UPDATE_PC = "No saldrá hasta actualizar Orb en el PC"
    const val PENDING_UPDATE_APP = "No saldrá hasta actualizar la app"
    const val PENDING_UNLINKED = "No saldrá: el móvil ya no está enlazado"
    const val PENDING_ATTENTION = "Saldrá cuando el PC esté listo"
    const val PENDING_FAILED = "No enviado"
    const val PENDING_DISCARD = "Descartar"
    const val SEND_FAILED_SNACK = "No se pudo enviar."
    const val PENDING_KEPT = "Tu mensaje sigue en este móvil y no se ha perdido."
    const val REMOVE = "Quitar"

    // Permission mode
    const val MODE_AUTO = "Auto"
    const val MODE_ASK = "Preguntar"
    const val MODE_AUTO_HINT = "El PC decide solo lo que es seguro"
    const val MODE_ASK_HINT = "El PC te pregunta antes de lo delicado"
    const val MODE_MENU = "Permisos en el PC"
    const val MODE_UNKNOWN = "Permisos"

    // Writing box
    const val BRAIN_UNKNOWN = "El del PC"
    const val BRAIN_DESC = "Cerebro de este chat"
    const val MIC = "Dictar por voz"
    const val MIC_NONE = "Este móvil no tiene dictado por voz"
    const val MENTION_TITLE = "Mencionar"
    const val COMMANDS_TITLE = "Comandos"
    const val COMPACT_COMMAND = "/compact"
    const val COMPACT_COMMAND_HINT = "Resume la conversación para liberar contexto"
    const val ATTACH_CLOSE = "Cerrar adjuntos"
    fun suggestionCount(title: String, n: Int) = if (n == 1) "$title, 1 resultado" else "$title, $n resultados"
    const val STATE_WORKING = "Orbe trabajando"
    const val STATE_WAITING = "Orbe espera su turno"
    const val STATE_IDLE = "al día"
    const val STATE_RECONNECTING = "Reconectando…"
    const val TASK_RUNNING = "En curso"
    const val TASK_WAITING_PERMISSION = "Espera un permiso"
    const val TASK_EDIT_QUEUED = "Editar mensaje en cola"
    const val TASK_EDIT = "Editar"
    const val QUEUED_REMOVE = "Quitar"
    const val QUEUED_SAVE = "Guardar"
    fun chatLine(project: String?, state: String) = if (project.isNullOrBlank()) state.replaceFirstChar { it.uppercase() } else "$project · $state"
    fun queuedLine(n: Int, first: String?) = if (first.isNullOrBlank()) queuedTurns(n) else "${queuedTurns(n)}: «$first»"
    fun taskTitle(id: Long, title: String?) = if (title.isNullOrBlank()) "Tarea #$id" else "#$id $title"
    fun taskLiveLine(agent: String?, doing: String?, percent: Int?): String =
        listOfNotNull(agent?.takeIf { it.isNotBlank() }, doing?.takeIf { it.isNotBlank() }, percent?.let { "$it %" }).joinToString(" · ")

    // Cards
    const val ANSWER_OTHER = "Otra respuesta"
    const val ANSWER_OTHER_CHIP = "Otra respuesta…"
    /** In the card's «⋯»: skipping is a real action of the PC, kept off the card itself. */
    const val ANSWER_SKIP = "Saltar esta pregunta"
    fun asks(name: String) = "$name pregunta"
    fun answerField(name: String) = "Responde a $name…"
    fun answeringBar(name: String) = "Respondiendo a $name"
    const val ANSWER_MANY_HINT = "Elige hasta 4 opciones y envía, o escribe otra respuesta."
    const val ANSWERED = "Respondida"
    const val SKIPPED = "Saltada"
    const val ASKED_BY_ORBE = "Orbe te pregunta"
    const val ACCEPT_REPORT = "Aceptar"
    const val REPORT_ACCEPTED = "Aceptado"
    const val REJECT = "Rechazar"
    const val DENY = "Denegar"
    const val SEE_DETAILS = "Ver detalles"
    const val HIDE_DETAILS = "Ocultar detalles"
    const val SEE_RESULT = "Ver el resultado"
    const val ALLOWED = "Permitido"
    const val ALWAYS_ALLOWED = "Permitido siempre"
    const val DENIED = "Denegado"
    const val EXPIRED = "Ya no está activa"
    const val TASK_WAITING_OK = "Espera tu aprobación"

    // Direct chat with an agent
    const val TOOL_RESULT = "Resultado"
    const val IMAGE_ATTACHED = "Imagen adjunta"
    const val STEER = "Corregir"
    const val QUEUE_IT = "Encolar"
    const val STEERED = "Corrección"
    const val STEER_HINT = "Corregir: el agente lo lee en su siguiente paso. Encolar: se envía al terminar el turno."
    const val QUEUE_UP = "Subir"
    const val QUEUE_DOWN = "Bajar"
    const val QUEUE_EDIT = "Editar"
    const val QUEUE_EDIT_TITLE = "Editar mensaje en cola"
    const val QUEUE_NOTE = "Se enviarán en orden al terminar el turno, desde el PC."
    const val THINKING_SHOW = "Pensando…"
    const val PERMIT = "Permitir"
    const val PERMIT_ALWAYS = "Permitir siempre aquí"
    const val CLOSED_ALWAYS = "Permitido siempre"
    const val CLOSED_EXPIRED = "Caducado"
    const val CLOSED_TIMEOUT = "Sin respuesta: denegado"
    const val REQUEST_EXPIRED = "Esa petición ya caducó"
    const val WANTS_RUN = "quiere ejecutar un comando"
    const val WANTS_EDIT = "quiere editar archivos"
    const val WANTS_GENERIC = "pide permiso"
    const val ASKED_RUN = "pidió ejecutar un comando"
    const val ASKED_EDIT = "pidió editar archivos"
    const val ASKED_GENERIC = "pidió permiso"
    const val FORK = "Bifurcar"
    const val COMPACT_CONTEXT = "Compactar contexto"
    const val INTERRUPT = "Interrumpir"
    const val RESUME = "Reanudar"
    const val CONTINUE = "Continuar"
    const val SETTLE = "Marcar como resuelto"
    const val STALLED_LIMIT = "Se detuvo al alcanzar el límite de uso de la cuenta."
    const val STALLED_HALF = "Se interrumpió porque Orb se cerró en el PC durante la ejecución."
    const val ASKED_RESUME = "Pedido al PC: reanudar la conversación."
    const val ASKED_SETTLE = "Pedido al PC: marcar como resuelta."
    const val ASKED_ARCHIVE = "Pedido al PC: archivar."
    const val FORKED = "Conversación bifurcada en el PC. La original se conserva."
    const val PERMISSION_READ = "Solo leer"
    const val PERMISSION_EDIT = "Editar archivos"
    const val PERMISSION_AUTO = "Auto"
    const val PERMISSION_TOTAL = "Acceso total"
    const val IN_THE_PC = "en el PC"
    const val PLAN = "Plan"
    const val AGENT_FALLBACK = "El agente"

    fun directField(agent: String?) = "Escribe a ${agent ?: "el agente"}…"
    fun emptyDirect(agent: String?) = "Conversación con ${agent ?: "el agente"}. Lo que escribas lo hace el agente en el PC."
    fun queueTitle(n: Int) = "En cola ($n)"
    fun agentWorking(agent: String?) = "${agent ?: "El agente"} está trabajando…"
    fun compactContext(percent: Int?) = if (percent == null) COMPACT_CONTEXT else "$COMPACT_CONTEXT $percent %"
    fun rewind(undone: Boolean) = if (undone) "Rebobinado deshecho en el PC" else "Archivos rebobinados en el PC"
    fun handoff(from: String?, to: String?) = "Traspasado de ${from.orEmpty().replaceFirstChar { it.uppercase() }} a ${to.orEmpty().replaceFirstChar { it.uppercase() }}"
    fun usage(input: Long?, output: Long?) =
        listOfNotNull(input?.let { "$it tokens de entrada" }, output?.let { "$it de salida" }).joinToString(" · ")
    fun permissionName(p: String?) = when (p) {
        "leer" -> PERMISSION_READ; "editar" -> PERMISSION_EDIT; "auto" -> PERMISSION_AUTO; "total" -> PERMISSION_TOTAL; else -> p.orEmpty()
    }

    // Deleted chat
    const val DELETED_TITLE = "Este chat ya no existe"
    const val DELETED_BODY = "Se borró en el PC."
    const val BACK_TO_CHATS = "Ir a Chats"

    fun reportAccepted(ids: List<Long>) = "Aceptado · tareas " + ids.joinToString(", ") { "#$it" }
    fun reportTasks(ids: List<Long>) = "Tareas " + ids.joinToString(", ") { "#$it" }
    fun queuedTurns(n: Int) = "$n en cola"
    /** What a queued message says, never promising a send the link cannot make. */
    fun pendingLine(c: dev.orb.app.link.net.ConnectionState?): String = when (c) {
        dev.orb.app.link.net.ConnectionState.UpdatePc -> PENDING_UPDATE_PC
        dev.orb.app.link.net.ConnectionState.UpdateApp -> PENDING_UPDATE_APP
        dev.orb.app.link.net.ConnectionState.Unlinked -> PENDING_UNLINKED
        is dev.orb.app.link.net.ConnectionState.Attention -> PENDING_ATTENTION
        else -> PENDING_WAITING
    }
    /** The outbox keeps a technical word for why a send failed; the screen says it in plain Spanish and leaves the word to the screen reader. */
    fun pendingFailed(reason: String?): String {
        val plain = failedPlain(reason)
        return if (plain == null) PENDING_FAILED else "$PENDING_FAILED: $plain"
    }

    fun failedPlain(reason: String?): String? = when {
        reason.isNullOrBlank() -> null
        reason.startsWith("refused") -> "el PC lo rechazó"
        reason == "not linked" -> "este móvil ya no está enlazado"
        reason == "bad answer" -> "no se entiende la respuesta del PC"
        reason.startsWith("unsupported") -> "esta versión del PC no lo admite"
        reason.startsWith("not retried") -> "pasó demasiado tiempo y puede que ya haya llegado"
        else -> null
    }

    fun pendingFailedSpoken(reason: String?): String =
        if (reason.isNullOrBlank()) pendingFailed(reason) else "${pendingFailed(reason)}. Motivo técnico: $reason"

    fun unread(n: Int) = if (n == 1) "1 sin leer" else "$n sin leer"
    fun chatsOf(n: Int) = if (n == 1) "1 chat" else "$n chats"
    fun files(n: Int) = if (n == 1) "1 archivo" else "$n archivos"
    fun withOrbe(project: String?) = if (project == null) "con Orbe" else "$project · con Orbe"
    fun withAgent(project: String?, agent: String?) = (project?.let { "$it · " } ?: "") + "con ${agent ?: "un agente"}"

    /** The agent with its model, as the PC's approval window writes it: «Claude (opus)». */
    fun agentWithModel(agent: String, model: String?): String = if (model.isNullOrBlank()) agent else "$agent ($model)"

    /** Why a task waits for approval, in words (the codes are the PC's own). */
    fun reason(code: String): String = when (code) {
        "external_write" -> "escribe fuera del proyecto"
        "publish" -> "publica"
        "financial" -> "pagos"
        "credential_access" -> "credenciales"
        "destructive" -> "elimina datos"
        "razonamiento_alto" -> "razonamiento alto"
        "creada_por_agente" -> "creada por un agente"
        "ruta_cambiada" -> "carpeta modificada"
        else -> code
    }

    // Permissions selector under the header
    const val MODE_SELECTOR = "Permisos de las tareas"
    const val MODE_NOTE_ASK = "Preguntar: te pido el OK antes de cada cambio."
    const val MODE_NOTE_AUTO = "Auto: Orb aprueba lo normal y te pregunta lo delicado."
    fun modeLabel(mode: String?) = when (mode) { "auto" -> MODE_AUTO; "preguntar" -> MODE_ASK; else -> MODE_UNKNOWN }

    // Task cards
    const val SEE_AND_APPROVE = "Ver y aprobar"
    /** What the OK is about, on one line: who runs it, with which model, where, and why it asks. */
    fun approvalLine(agent: String?, model: String?, project: String?, reasons: List<String>): String = listOfNotNull(
        agent?.takeIf { it.isNotBlank() }?.let { agentWithModel(it, model) },
        project?.takeIf { it.isNotBlank() },
        reasons.joinToString(", ") { reason(it) }.ifBlank { null },
    ).joinToString(" · ")
    /** Who runs it and how, in the words of everything the PC's fingerprint covers besides the description, folder and reasons. */
    fun approvalWho(agent: String, model: String?, reasoning: String?, fast: Boolean, mode: String?, readonly: Boolean, autonomy: String?): String = listOfNotNull(
        agentWithModel(agent, model),
        reasoning?.takeIf { it.isNotBlank() }?.let { reasoningText(it) },
        if (fast) "modo rápido" else null,
        if (mode == "aislada") "en una copia aislada" else null,
        if (readonly) "solo lectura" else null,
        if (autonomy == "preguntar") "permiso: Preguntar" else null,
    ).joinToString(" · ")
    fun asksBecause(reasons: List<String>) = "Pide tu OK porque: " + reasons.joinToString(", ") { reason(it) }
    const val AGENT_ANY = "Automático"
    const val FOLDER_CHANGED_NOTE = "La carpeta del proyecto ha cambiado desde que se creó la tarea."
    const val FOLDER_OUTSIDE_NOTE = "Fuera de la carpeta de Orb: el móvil solo ve el último nombre de la carpeta."
    const val DESCRIPTION_CUT_NOTE = "Este texto nombra carpetas de tu PC que el móvil abrevia."
    const val USER_ASKED_LABEL = "Lo que pidió tu mensaje:"
    const val ACCEPT_CHANGED = "La tarea ha cambiado; revísala antes de aceptar."
    const val ACCEPT_UNAVAILABLE = "Esa tarea ha cambiado en el PC y ya no se puede aceptar desde aquí: no se ha tocado nada."
    const val UNDO_CHANGED = "Esa tarea se ha vuelto a ejecutar: ábrela de nuevo para revisarla. No se ha deshecho nada."
    const val QUEUE_CHANGED_REMOVE = "Ese mensaje ha cambiado en el PC: no se ha quitado. Revísalo y quítalo de nuevo si quieres."
    const val TASK_HELD_BADGE = "Retenida"
    const val TASK_SEE_CHANGES = "Ver cambios"
    const val TASK_SEE_TASK = "Ver la tarea"
    const val TASK_ENDED_BADGE = "Terminada"
    const val UNDO_UNAVAILABLE = "Esa tarea ha cambiado en el PC y ya no se puede deshacer desde aquí: no se ha tocado nada."
    const val QUEUE_CHANGED = "Este mensaje ha cambiado en el PC. Se ha cargado el texto nuevo: revísalo y guarda otra vez si quieres cambiarlo."
    const val TASK_CHANGES = "Cambios"
    const val TASK_UNDO = "Deshacer"
    const val TASK_ACCEPT = "Aceptar"
    const val TASK_DONE = "Hecha"
    const val TASK_ACCEPTED_BADGE = "Completada"
    const val TASK_UNDONE_BADGE = "Deshecha"
    const val TASK_REJECTED_BADGE = "Rechazada"
    const val TASK_SENSITIVE = "Delicado: pide tu OK"
    const val TASK_AUTO_PASSED = "Aprobada sola por Auto: es lo normal"
    const val TASK_ACCEPTED = "Aceptada"
    const val TASK_CHANGED = "La tarea ha cambiado desde que la viste: revisa lo nuevo antes de aprobar."
    const val TASK_UNDONE_SNACK = "Deshecho"
    const val TASK_SEE = "Ver"
    fun taskApproved(id: Long) = "#$id Aprobada"
    fun taskRejected(id: Long) = "#$id Rechazada"
    fun taskAccepted(id: Long) = "#$id Aceptada"
    fun reviewedBy(who: String) = "revisada por $who"
    fun taskFiles(n: Int) = if (n == 1) "1 archivo" else "$n archivos"
    fun undoAskTitle(id: Long) = "¿Deshacer la tarea #$id?"
    fun undoAskBody(files: Int?) =
        (if (files == null) "Se revierten los archivos que cambió." else "Se revierten los ${taskFiles(files)} que cambió.") + " Los cambios posteriores se conservan."
    const val UNDO_CONFIRM = "Deshacer esta tarea"
    fun rejectAskTitle(id: Long) = "¿Rechazar la tarea #$id?"
    fun rejectAskBody(title: String?) = (title?.takeIf { it.isNotBlank() }?.let { "«$it». " } ?: "") + "Rechazarla cancela la tarea."
    const val REJECT_CONFIRM = "Rechazar y cancelar"
    const val REJECT_BACK = "Volver"

    // Queue of messages behind the running turn
    const val QUEUE_STARTED = "Ese mensaje ya salió de la cola: no se pudo cambiar."
    const val QUEUE_EMPTY = "El mensaje no puede quedar vacío."
    const val QUEUE_CLOSE = "Cerrar"
    const val QUEUE_LIST_TITLE = "Mensajes en cola"
    const val QUEUE_SAVING = "Guardando…"

    fun taskStatus(s: String?): String = when (s) {
        "running" -> "Trabajando"
        "done" -> "Completada"
        "failed" -> "Fallida"
        "blocked" -> "Bloqueada"
        "cancelled" -> "Cancelada"
        "queued", "pending" -> "En cola"
        "awaiting_approval" -> "Espera tu OK"
        else -> s.orEmpty()
    }
}

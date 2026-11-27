package dev.orb.app.ui.chats

/** Texts of the direct chat that are new in its redesign: the chat sheet, the context bar, the card of a stopped session. */
object DirectTexts {
    fun sheetTitle(agent: String?) = "Chat con ${agent ?: "el agente"}"
    const val FORK_HERE = "Bifurcar desde aquí"
    const val COMPACT = "Compactar contexto"
    const val RESUME = "Reanudar sesión"
    const val SETTLE = "Dar por terminado"
    const val STOP = "Parar"
    const val MORE_OPTIONS = "Más opciones"
    const val MORE_BUTTON = "Más acciones del chat"
    const val ONLY_ON_PC = "Acceso total, Usar mi móvil, bóveda y terminal: solo en el PC."
    const val MODEL = "Modelo"
    const val PERMISSIONS = "Permisos"

    // Why a row of the sheet is off
    const val WHY_WORKING = "Trabajando"
    const val WHY_NOT_STALLED = "No está parada"
    const val WHY_NOT_WORKING = "No está trabajando"
    const val WHY_SETTLED = "Ya terminado"
    const val WHY_AGENT = "No disponible"

    fun context(percent: Int) = "Contexto $percent %"
    const val CONTEXT_FORK = "Bifurcar"
    const val CONTEXT_COMPACT = "Compactar"

    const val COMPACT_ASK_TITLE = "¿Compactar el contexto?"
    fun compactAskBody(agent: String?) = "${agent ?: "El agente"} resume la conversación para liberar espacio. Puede tardar unos segundos."
    const val COMPACT_CONFIRM = "Compactar"

    const val PERMISSION_CARD = "Permiso"
    const val PENDING_BADGE = "Pendiente"
    const val PERMIT_ALWAYS_SHORT = "Siempre"
    const val PERMIT_ALWAYS_SCOPE = "«Siempre» vale solo en este chat."

    const val STALLED_TITLE = "Sesión parada"
    const val STALLED_FORK_HINT = " Puedes reanudarla donde iba o bifurcar desde un mensaje."
    const val STALLED_RESUME_HINT = " Puedes reanudarla donde iba."
    const val STALLED_PLACEHOLDER = "Escribe para reanudar…"
    const val WORKING_PLACEHOLDER = "Corrige o añade algo…"

    const val MESSAGE_SHEET = "Este mensaje"
    const val FORK_FROM_NOTE = "Copia la conversación hasta este mensaje, sin archivos. El chat nuevo empieza con un resumen."
    const val FORK_ASKING = "Preguntando al PC…"
    const val FORK_FROM_OLD_PC = "Actualiza Orb en el PC para bifurcar desde un mensaje."
    const val FORKED_FROM = "Chat bifurcado en el PC desde ese mensaje. El original se conserva."

    const val STEER_SENT = "Corrección enviada"
    const val STEER_REACHES = " · llega al agente en marcha"

    const val QUEUE_GROUP = "En cola"
    const val QUEUE_EDIT_BAR = "Editando un mensaje de la cola"
    const val QUEUE_EDITING_ROW = "Editando este mensaje de la cola"
    const val QUEUE_REMOVE = "Quitar de la cola"
    const val QUEUE_MORE = "Más opciones del mensaje en cola"
    const val QUEUE_ITEM_SHEET = "Mensaje en cola"
    fun queueCount(n: Int) = "En cola · $n"

    const val FORK_ACTION = "Bifurcar desde aquí"
    const val FORK_ACTION_DESC = "Bifurcar el chat desde este mensaje"

    fun infoLine(agent: String, project: String?, state: String?): String =
        listOfNotNull(agent, project ?: ChatTexts.NO_PROJECT, state?.takeIf { it.isNotEmpty() }).joinToString(" · ")
    const val STATE_WORKING = "trabajando"

    const val RENAME_FIELD = "Título"
    const val PERMISSION_LABEL = "Permisos del agente"
    const val NEEDS_PC_SHEET = "Sin conexión con el PC. Las acciones se harán cuando vuelva."
}

package dev.orb.app.ui.notes

/** Every text of the notices center, in Spanish and with the words the desktop app uses. */
object NotesTexts {
    const val TITLE = "Avisos"
    const val BACK = "Volver"
    const val BELL = "Notificaciones"
    const val MARK_ALL = "Marcar todo"
    const val TODAY = "Hoy"
    const val YESTERDAY = "Ayer"
    const val EARLIER = "Antes"

    // A PC that keeps its list (3.8.8): an empty list is the truth about the last days.
    const val EMPTY_CLEAR = "Todo al día"
    const val EMPTY_CLEAR_HINT = "No hay avisos nuevos del PC."

    // An older PC keeps none: the phone only knows what arrived while Orb was open.
    const val EMPTY = "No hay notificaciones"
    const val EMPTY_HINT = "Aquí aparecen los mensajes y permisos que llegan mientras tienes Orb abierto."

    const val FOOTNOTE = "Desliza un aviso para descartarlo. Tocarlo te lleva a la tarea o al chat."
    const val DISMISSED = "Aviso descartado"
    const val CHAT_GONE = "Ese chat ya no existe"
    const val UNDO = "Deshacer"
    const val DISMISS = "Descartar aviso"
    const val NEWS = "Novedades"
    const val UNREAD = "Sin leer"
    const val PC_NOT_TOLD = "Marcados aquí, pero el PC no se ha enterado"
    const val KIND_APPROVAL = "Permiso"
    const val KIND_TASK = "Tarea"
    const val KIND_MESSAGE = "Mensaje"

    fun kind(kind: String) = when (kind) {
        NoticeKinds.APPROVAL -> KIND_APPROVAL
        NoticeKinds.TASK -> KIND_TASK
        else -> KIND_MESSAGE
    }

    fun unreadDescription(n: Int) = if (n == 1) "Notificaciones, 1 sin leer" else "Notificaciones, $n sin leer"

    /** The line under the title of the top bar. */
    fun unreadLine(n: Int) = "$n sin leer"

    fun day(d: NoticeDay) = when (d) {
        NoticeDay.Today -> TODAY
        NoticeDay.Yesterday -> YESTERDAY
        NoticeDay.Earlier -> EARLIER
    }

    /**
     * The two lines of a row. A notice of the PC's own events is one sentence («Orb paró la #39 · borró 12 archivos»): the
     * part before « · » is the title and the rest the line under it. A chat's notice keeps its chat as title and the text under it.
     */
    fun lines(n: Notice): Pair<String, String?> {
        if (!NoticeKinds.isInfo(n.kind)) return n.title to n.body.takeIf { it.isNotBlank() }
        // A hidden preview says nothing about the event: the generic text stays under «Orb».
        if (n.hidden) return n.title to n.body.takeIf { it.isNotBlank() }
        val at = n.body.indexOf(" · ")
        if (at > 0) return n.body.substring(0, at) to n.body.substring(at + 3).trim().takeIf { it.isNotEmpty() }
        return n.body to if (n.kind == NoticeKinds.UPDATE) NEWS else null
    }
}

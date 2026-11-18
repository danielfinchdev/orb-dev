package dev.orb.app.ui.offline

object OfflineTexts {
    const val TITLE = "Sin conexión con el PC"
    const val FALLBACK = "Sin conexión con el PC. Se muestra lo último guardado en el móvil."
    const val RETRY_NOW = "Reintentar ahora"
    const val CONNECTING = "Conectando…"
    const val RETRYING = "Reintentando…"
    const val SAVED_UNKNOWN = "Datos guardados en el móvil"
    const val NEVER = "Aún no se ha conectado con este PC"
    const val NEEDS_PC = "Necesita el PC"
    const val NO_PC_TITLE = "No llego a tu PC"
    const val NO_PC_BODY = "Cuando vuelva, tus mensajes en espera saldrán solos."
    const val NOTHING_SAVED = "Todavía no hay nada guardado en el móvil. Se verá en cuanto el PC responda."

    const val BAND_RETRY = "Reintentar"
    const val BAND_CONNECTED = "Conectado"

    /**
     * The band of a chat: what is happening with the link and what that means for what is written. Only the states in
     * which the queue really does leave when the link is back say so; the others say why it does not.
     */
    fun band(c: dev.orb.app.link.net.ConnectionState, now: Long): String? = when (c) {
        is dev.orb.app.link.net.ConnectionState.Online -> null
        is dev.orb.app.link.net.ConnectionState.Offline -> {
            val s = c.nextRetryAt?.let { (it - now + 999) / 1000 }
            if (s != null && s > 0) "Sin conexión con tu PC. Reintento\u00A0en\u00A0$s\u00A0s." else "Sin conexión con tu PC. Reintentando…"
        }
        dev.orb.app.link.net.ConnectionState.Connecting -> "Sin conexión con tu PC. Conectando…"
        dev.orb.app.link.net.ConnectionState.UpdatePc -> "Hay que actualizar Orb en tu PC. Lo que escribas se queda en este móvil y no sale hasta entonces."
        dev.orb.app.link.net.ConnectionState.UpdateApp -> "Hay que actualizar la app para hablar con tu PC. Lo que escribas se queda en este móvil hasta entonces."
        dev.orb.app.link.net.ConnectionState.Unlinked -> "Este móvil ya no está enlazado con tu PC. Lo que escribas no saldrá hasta enlazarlo de nuevo."
        is dev.orb.app.link.net.ConnectionState.Attention -> "Tu PC necesita atención (${c.code}). Lo que escribas saldrá cuando esté listo."
    }

    /** «hace un momento», «hace 5 min», «hace 3 h», «hace 2 días». */
    fun ago(at: Long, now: Long): String {
        val s = ((now - at) / 1000).coerceAtLeast(0)
        return when {
            s < 60 -> "hace un momento"
            s < 3600 -> "hace ${s / 60} min"
            s < 86_400 -> "hace ${s / 3600} h"
            else -> (s / 86_400).let { if (it == 1L) "hace 1 día" else "hace $it días" }
        }
    }

    fun lastConnection(at: Long?, now: Long) = if (at == null) NEVER else "Última conexión ${ago(at, now)}"

    fun savedNote(at: Long?, now: Long) = if (at == null) SAVED_UNKNOWN else "Datos guardados de ${ago(at, now)}"

    /** Counts down to the next attempt; a retry already due reads «Reintentando…». */
    fun retryIn(nextRetryAt: Long?, now: Long): String {
        if (nextRetryAt == null) return RETRYING
        val s = (nextRetryAt - now + 999) / 1000
        return if (s <= 0) RETRYING else "Reintentando en $s s"
    }
}

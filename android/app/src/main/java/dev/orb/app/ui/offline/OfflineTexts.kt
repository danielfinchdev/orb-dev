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
    const val READ_SAVED = "Leer lo guardado"

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

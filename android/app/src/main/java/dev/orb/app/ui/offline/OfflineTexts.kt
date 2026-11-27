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

    /** After half a minute without a link: what is going on and what to do, never a bare «Conectando…». */
    const val STUCK = "Tu PC no responde por Wi-Fi ni por Tailscale. ¿Está Orb abierto?"

    /** True when the link has been down long enough that the person should be told what to check. */
    fun isStuck(c: dev.orb.app.link.net.ConnectionState, now: Long): Boolean {
        val since = (c as? dev.orb.app.link.net.ConnectionState.Offline)?.since ?: return false
        return now - since >= dev.orb.app.link.net.STUCK_AFTER_MS
    }

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
            val head = if (isStuck(c, now)) STUCK else "Sin conexión con tu PC."
            if (s != null && s > 0) "$head Reintento\u00A0en\u00A0$s\u00A0s." else "$head Reintentando…"
        }
        dev.orb.app.link.net.ConnectionState.Connecting -> "Sin conexión con tu PC. Conectando…"
        dev.orb.app.link.net.ConnectionState.UpdatePc -> "Actualiza Orb en tu PC. Lo que escribas se queda en este móvil hasta entonces."
        dev.orb.app.link.net.ConnectionState.UpdateApp -> "Actualiza la app para hablar con tu PC. Lo que escribas se queda en este móvil hasta entonces."
        dev.orb.app.link.net.ConnectionState.Unlinked -> "Este móvil ya no está enlazado con tu PC. Lo que escribas no saldrá hasta enlazarlo de nuevo."
        is dev.orb.app.link.net.ConnectionState.Attention -> "Tu PC necesita atención. Lo que escribas saldrá cuando esté listo."
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

    /**
     * The moment as a person reads a clock: «hoy, 19:52», «ayer, 19:52», «12 nov, 19:52» (with the year when it is not this
     * one). Plain java.util on purpose: the app supports Android 7, where java.time is not there.
     */
    fun absolute(at: Long, now: Long, tz: java.util.TimeZone = java.util.TimeZone.getDefault()): String {
        val then = java.util.GregorianCalendar(tz).apply { timeInMillis = at }
        val today = java.util.GregorianCalendar(tz).apply { timeInMillis = now }
        val clock = "${then.get(java.util.Calendar.HOUR_OF_DAY).toString().padStart(2, '0')}:${then.get(java.util.Calendar.MINUTE).toString().padStart(2, '0')}"
        val days = dayNumber(today) - dayNumber(then)
        return when {
            days == 0L -> "hoy, $clock"
            days == 1L -> "ayer, $clock"
            else -> {
                val year = then.get(java.util.Calendar.YEAR)
                val date = "${then.get(java.util.Calendar.DAY_OF_MONTH)} ${MONTHS[then.get(java.util.Calendar.MONTH)]}"
                (if (year == today.get(java.util.Calendar.YEAR)) date else "$date $year") + ", $clock"
            }
        }
    }

    private val MONTHS = arrayOf("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")

    private fun dayNumber(c: java.util.Calendar): Long =
        java.util.GregorianCalendar(java.util.TimeZone.getTimeZone("UTC")).apply {
            clear(); set(c.get(java.util.Calendar.YEAR), c.get(java.util.Calendar.MONTH), c.get(java.util.Calendar.DAY_OF_MONTH))
        }.timeInMillis / 86_400_000L

    /** «Última conexión: hoy, 19:52.»; with no record, that the app never reached this PC. */
    fun lastConnectionAbsolute(at: Long?, now: Long, tz: java.util.TimeZone = java.util.TimeZone.getDefault()) =
        if (at == null) "$NEVER." else "Última conexión: ${absolute(at, now, tz)}."

    const val READ_ONLY_TITLE = "Sin conexión · solo lectura"

    /** The note of the read-only app. A chat still takes messages: they wait in the queue, so the note says so. */
    fun readOnlyBanner(at: Long?, now: Long, tz: java.util.TimeZone = java.util.TimeZone.getDefault()) = "$READ_ONLY_TITLE. " + readOnlyNote(at, now, tz)

    /** The same note without its title, for the header that already says «Sin conexión · solo lectura» under ORB·E. */
    fun readOnlyNote(at: Long?, now: Long, tz: java.util.TimeZone = java.util.TimeZone.getDefault()) =
        (if (at == null) "$SAVED_UNKNOWN." else "Última conexión ${absolute(at, now, tz)}.") + " Lo que escribas en un chat sale al volver la conexión."

    /** Milliseconds until the next local midnight (plus a second, so the wake-up lands on the new day). */
    fun untilNextDay(now: Long, tz: java.util.TimeZone = java.util.TimeZone.getDefault()): Long {
        val c = java.util.GregorianCalendar(tz).apply { timeInMillis = now }
        c.set(java.util.Calendar.HOUR_OF_DAY, 0); c.set(java.util.Calendar.MINUTE, 0); c.set(java.util.Calendar.SECOND, 0); c.set(java.util.Calendar.MILLISECOND, 0)
        c.add(java.util.Calendar.DAY_OF_MONTH, 1)
        return c.timeInMillis - now + 1_000
    }

    fun savedNote(at: Long?, now: Long) = if (at == null) SAVED_UNKNOWN else "Datos guardados de ${ago(at, now)}"

    /** Counts down to the next attempt; a retry already due reads «Reintentando…». */
    fun retryIn(nextRetryAt: Long?, now: Long): String {
        if (nextRetryAt == null) return RETRYING
        val s = (nextRetryAt - now + 999) / 1000
        return if (s <= 0) RETRYING else "Reintentando en $s s"
    }
}

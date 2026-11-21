package dev.orb.app.ui.usage

/** Every text of the usage and agents screen, in Spanish and with the words the desktop app uses. */
object UsageTexts {
    const val TITLE = "Uso y agentes"
    const val BACK = "Volver"
    const val LOAD_ERROR = "No se pudo cargar el uso desde el PC."
    const val RETRY = "Reintentar"
    const val UPDATE = "Actualizar"
    const val UPDATING = "Actualizando…"
    const val ACTION_OFFLINE = "Sin conexión con el PC: no se ha cambiado nada."
    const val ACTION_FAILED = "No se pudo hacer en el PC"
    const val UPDATED = "Uso actualizado"

    const val ACCOUNTS = "Uso por cuenta"
    const val AGENTS_ON_PC = "Agentes en tu PC"
    const val FOOTNOTE = "Iniciar sesión, cuentas y planes: en el PC."
    const val NO_AGENTS = "Orb no ha encontrado agentes en el PC."
    const val UPDATING_BAND = "Actualizando el uso…"
    const val EMPTY = "Aún no hay uso que mostrar"
    const val EMPTY_HINT = "Cuando el PC lo tenga, saldrá aquí. Tira hacia abajo para volver a mirar."
    const val CLOSE = "Cerrar"
    const val MORE_OPTIONS = "Más opciones"
    const val EXPANDED = "Desplegado"
    const val COLLAPSED = "Plegado"

    const val HISTORY = "Historial de uso"
    const val HISTORY_HINT = "Los últimos días"
    const val SPEND_PER_DAY = "Gasto por día"
    const val NO_DAY_SPEND = "Sin gasto en este periodo."

    const val GUIDE_ROW = "Guía de modelos"
    const val GUIDE_ROW_HINT = "Cuál conviene para cada trabajo"
    const val GUIDE_PICKS = "Qué modelo elegir"
    const val GUIDE_ALL = "Todos los modelos"

    const val READY = "Listo"
    const val NEAR_LIMIT_AT = 0.85

    /** The share of a window or of the tasks that is spent, as the PC reports it. */
    fun percent(fraction: Double) = Math.round(fraction * 100).toInt()

    /** Amber from 85 % on, judged on the figure the person reads. */
    fun nearLimit(fraction: Double) = percent(fraction) >= Math.round(NEAR_LIMIT_AT * 100)
    fun percentText(fraction: Double) = "${percent(fraction)} %"
    fun barLabel(title: String, value: String) = "$title: $value"
    fun tasksWindow(hours: Int?) = if (hours == null) TASKS_USED else "$TASKS_USED · ventana de $hours h"
    fun periodTotal(n: Int, cost: String, tokens: String) = "Total de $n días: $cost · $tokens tokens"

    const val NO_LIMITS = "Los límites aparecerán cuando los agentes respondan."
    const val NO_ACCOUNTS = "No hay cuentas con uso que mostrar."
    const val TASKS_USED = "Tareas"
    fun tasksOf(used: Int, max: Int) = "$used de $max"
    fun paused(until: String, reason: String?) = listOfNotNull("En pausa hasta $until", reason?.takeIf { it.isNotBlank() }).joinToString(". ")

    const val SPEND = "Gasto"
    fun days(n: Int) = "$n días"
    const val COST = "Coste"
    const val TOKENS_IN = "Tokens de entrada"
    const val TOKENS_OUT = "Tokens de salida"
    const val TURNS = "Turnos"
    const val BY_DAY = "Uso por día"
    const val BY_AGENT = "Por agente"
    const val EMPTY_SPEND = "Sin uso en este periodo."
    const val SPEND_ERROR = "No se pudo cargar el uso"

    const val AGENTS = "Agentes"
    const val INSTALLED = "Instalado"
    const val NOT_INSTALLED = "No instalado"
    const val LOGGED_IN = "Sesión iniciada"
    const val NO_LOGIN = "Sin sesión"
    const val UNKNOWN_LOGIN = "Sesión sin comprobar"
    const val OFF = "Desactivado"

    const val GUIDE_HINT = "Según el nivel de uso elegido. Puedes pedir un modelo concreto en el chat."

    fun levelLabel(level: String) = when (level) {
        "simple" -> "Para lo sencillo"
        "normal" -> "Para lo habitual"
        else -> "Para lo complejo"
    }

    fun tierLabel(tier: String) = when (tier) {
        "light" -> "Rápidos y económicos"
        "balanced" -> "Equilibrados"
        else -> "Los más potentes"
    }

    fun reasoning(r: String) = "Razonamiento " + when (r) {
        "low" -> "bajo"
        "medium" -> "medio"
        "high" -> "alto"
        "xhigh" -> "máximo"
        else -> r
    }

    /** `five_hour`, `seven_day_opus`, `300min`… in words. */
    fun windowLabel(w: String): String {
        val model = Regex("seven_day_(\\w+)").find(w)?.groupValues?.get(1)
        if (Regex("five_hour|^300min$|^5h$").containsMatchIn(w)) return "Límite de sesión"
        if (model != null) return "Semanal · " + model.replaceFirstChar { it.uppercase() }
        if (Regex("seven_day|^10080min$").containsMatchIn(w)) return "Semanal · todos los modelos"
        val min = Regex("^(\\d+)min$").find(w)?.groupValues?.get(1)?.toIntOrNull()
        if (min != null) return if (min % 1440 == 0) "Límite de ${min / 1440} días" else "Límite de ${Math.round(min / 60f)} h"
        return w
    }

    fun resetText(resetAt: Long?, nowMs: Long): String {
        if (resetAt == null) return ""
        val ms = resetAt - nowMs
        if (ms <= 0) return "Se restablece ahora"
        if (ms < 86_400_000) {
            val h = ms / 3_600_000
            val m = (ms % 3_600_000) / 60_000
            return "Se restablece en " + if (h > 0) "$h h $m min" else "$m min"
        }
        val d = ms / 86_400_000
        return "Se restablece en $d ${if (d == 1L) "día" else "días"}"
    }

    /** The length of a window by its name (`five_hour`, `300min`, `seven_day_opus`…), or null when the name does not say. */
    fun windowMinutes(w: String): Int? {
        if (Regex("five_hour|^5h$").containsMatchIn(w)) return 300
        if (Regex("seven_day").containsMatchIn(w)) return 10_080
        return Regex("^(\\d+)min$").find(w)?.groupValues?.get(1)?.toIntOrNull()
    }

    private fun span(minutes: Int) = if (minutes % 1440 == 0) "${minutes / 1440} ${if (minutes == 1440) "día" else "días"}" else "${Math.round(minutes / 60f)} h"

    /**
     * «Esta ventana de 5 h · vuelve 15:00»: the window of the account that comes back first (the shortest one when it
     * is a tie), with its length only when the PC names it, and the hour in the phone's zone (with the day when it is
     * not within a day). Null while no window has a reset time to tell.
     */
    fun windowHeader(accounts: List<UsageAccount>, nowMs: Long, zone: java.util.TimeZone = java.util.TimeZone.getDefault()): String? {
        val next = accounts.flatMap { it.windows }.filter { (it.resetAt ?: 0L) > nowMs }
            .minWithOrNull(compareBy<UsageWindow>({ windowMinutes(it.window) ?: Int.MAX_VALUE }, { it.resetAt }))
            ?: return null
        val reset = next.resetAt ?: return null
        val es = java.util.Locale.forLanguageTag("es-ES")
        val within = reset - nowMs < 86_400_000
        val at = java.text.SimpleDateFormat(if (within) "HH:mm" else "EEE HH:mm", es).apply { timeZone = zone }.format(java.util.Date(reset))
        val length = windowMinutes(next.window)?.let { " de " + span(it) }.orEmpty()
        return "Esta ventana$length · vuelve $at"
    }

    /** «Hoy», «Ayer», «Anteayer», then «12 nov»; [day] is the PC's `yyyy-mm-dd`. */
    fun dayLabel(day: String, nowMs: Long, zone: java.util.TimeZone = java.util.TimeZone.getDefault()): String {
        val date = runCatching { java.time.LocalDate.parse(day) }.getOrNull() ?: return day
        val today = java.time.Instant.ofEpochMilli(nowMs).atZone(zone.toZoneId()).toLocalDate()
        return when (java.time.temporal.ChronoUnit.DAYS.between(date, today)) {
            0L -> "Hoy"
            1L -> "Ayer"
            2L -> "Anteayer"
            else -> "${date.dayOfMonth} " + date.month.getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.forLanguageTag("es-ES")).trimEnd('.')
        }
    }

    /** One day of «Historial de uso»: its name, what the PC spent and the share of the busiest day of the period. */
    data class DayRow(val label: String, val value: String, val fraction: Float)

    /** The days that spent something, newest first; the bar is the day's spend (tokens when nothing was priced) over the period's top. */
    fun historyRows(days: List<DaySpend>, nowMs: Long, zone: java.util.TimeZone = java.util.TimeZone.getDefault()): List<DayRow> {
        val used = days.filter { it.usd > 0 || it.tokens > 0 }.sortedByDescending { it.day }
        val priced = used.any { it.usd > 0 }
        fun amount(d: DaySpend) = if (priced) d.usd else d.tokens.toDouble()
        val top = used.maxOfOrNull(::amount)?.takeIf { it > 0 } ?: 1.0
        return used.map { DayRow(dayLabel(it.day, nowMs, zone), if (it.usd > 0) money(it.usd) else tokens(it.tokens) + " tokens", (amount(it) / top).toFloat()) }
    }

    fun money(usd: Double) = String.format(java.util.Locale.forLanguageTag("es-ES"), "$%.2f", usd)

    fun tokens(n: Long) = when {
        n >= 1_000_000 -> String.format(java.util.Locale.forLanguageTag("es-ES"), "%.1f M", n / 1_000_000.0)
        n >= 1_000 -> String.format(java.util.Locale.forLanguageTag("es-ES"), "%.1f k", n / 1_000.0)
        else -> n.toString()
    }
}

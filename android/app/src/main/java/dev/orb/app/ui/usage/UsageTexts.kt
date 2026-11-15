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

    const val LIMITS = "Límites de las cuentas"
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

    const val GUIDE = "Modelos por tipo de tarea"
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

    fun money(usd: Double) = String.format(java.util.Locale.forLanguageTag("es-ES"), "$%.2f", usd)

    fun tokens(n: Long) = when {
        n >= 1_000_000 -> String.format(java.util.Locale.forLanguageTag("es-ES"), "%.1f M", n / 1_000_000.0)
        n >= 1_000 -> String.format(java.util.Locale.forLanguageTag("es-ES"), "%.1f k", n / 1_000.0)
        else -> n.toString()
    }
}

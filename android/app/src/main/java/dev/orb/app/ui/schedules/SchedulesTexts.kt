package dev.orb.app.ui.schedules

/** Every text of the scheduled-tasks screen, in Spanish and with the words the desktop app uses. */
object SchedulesTexts {
    const val TITLE = "Programadas"
    const val BACK = "Volver"
    const val EMPTY = "No hay tareas programadas"
    const val EMPTY_HINT = "Programa una para que Orb la lance sola a su hora."
    const val LOAD_ERROR = "No se pudieron cargar las tareas programadas desde el PC."
    const val RETRY = "Reintentar"
    const val ACTION_OFFLINE = "Sin conexión con el PC: no se ha cambiado nada."
    const val ACTION_FAILED = "No se pudo hacer en el PC"
    const val CANCEL = "Cancelar"
    const val ROWS_HINT = "Mantén pulsada una para «Ejecutar ahora». Borrarla: en el PC."
    const val DELETE_AT_PC = "Borrarla: en el PC."

    fun count(n: Int) = when (n) {
        0 -> null
        1 -> "1 tarea programada"
        else -> "$n tareas programadas"
    }

    const val NEXT = "Próxima"
    const val LAST = "Última"
    const val NO_FIXED_TIME = "Sin hora fija"
    const val PC_ZONE_NOTE = "hora del PC"

    const val NEW = "Programar"
    const val NEW_TITLE = "Programar"
    const val NEW_NOTE = "Cada ejecución crea una tarea. Si la anterior sigue abierta, espera a que termine."
    const val NEW_OK = "Programar"
    const val CREATED = "Tarea programada"
    const val NO_PROJECT = "Crea un proyecto antes de programar tareas."
    const val FIELD_PROJECT = "Proyecto"
    const val FIELD_NAME = "Nombre de la tarea"
    const val FIELD_WHAT = "Instrucciones"
    const val FIELD_WHAT_HINT = "Qué hacer, dónde y cuándo se da por terminada."
    const val FIELD_FREQUENCY = "Frecuencia"
    const val FIELD_HOURS = "Cada cuántas horas"
    const val FIELD_MONTH_DAY = "Día del mes"
    const val FIELD_MONTH_DAY_HINT = "Un mes sin ese día se ejecuta el último."
    const val FIELD_TIME = "Hora"
    const val FIELD_DATE = "Fecha"
    const val FIELD_AGENT = "Agente"
    const val FIELD_MODEL = "Modelo"
    const val ANY_AGENT = "Cualquiera"
    const val DEFAULT_MODEL = "Predeterminado"
    const val ZONE_OF_PC = "la zona del PC"
    const val ZONE_CHOSEN = "zona elegida"
    const val PICK_TIME = "Elige la hora"
    const val PICK_DATE = "Elige la fecha"
    const val PICK_OK = "Aceptar"
    const val PICK_PLACEHOLDER = "Elegir"
    const val FIELD_DAYS = "Días de la semana"
    const val DAYS_NEED_ONE = "Elige al menos un día."
    const val DAYS_HELP = "Con los siete días se ejecuta cada día."

    const val MORE_OPTIONS = "Más opciones"
    const val FIELD_READONLY = "Solo lectura"
    const val FIELD_READONLY_HINT = "Revisa o investiga sin modificar archivos."
    const val FIELD_READONLY_LOCKED = "Quitarlo, solo en el PC."
    const val FIELD_SAME_CHAT = "Ejecutar siempre en el mismo chat"
    const val FIELD_SAME_CHAT_HINT = "Los resultados y la conversación quedan juntos."
    const val FIELD_NOTIFY = "Avisar al móvil"
    const val FIELD_NOTIFY_HINT = "Cada ejecución te avisa en este móvil."
    const val FIELD_ASK = "Pedir permiso siempre"
    const val FIELD_ASK_HINT = "Cada ejecución pregunta antes de actuar; si no, sigue los permisos del PC."
    const val FIELD_ASK_LOCKED = "Quitarlo, solo en el PC."
    const val FIELD_ZONE = "Zona horaria"
    const val ZONE_HINT = "Por ejemplo Europe/Madrid. Vacío: la del PC."
    const val ZONE_PHONE = "La de este móvil"
    const val ZONE_PC = "La del PC"
    const val FOREIGN_NOTE = "Esta tarea se repite de una forma que solo se cambia en el PC: aquí se deja como está."
    const val KIND_DAYS = "Días de la semana"

    const val EDIT_TITLE = "Editar tarea"
    const val EDIT_OK = "Guardar"
    const val SAVING = "Guardando…"
    const val SAVED = "Cambios guardados"
    const val NOTHING_TO_SAVE = "No hay cambios"

    const val EVERY_DAILY = "Cada día"
    const val EVERY_WEEKLY = "Cada semana"
    const val EVERY_HOURS = "Cada N horas"
    const val EVERY_HOURLY = "Cada hora"
    const val EVERY_ONCE = "Una sola vez"
    const val EVERY_MONTHLY = "Cada mes"
    const val EVERY_UNKNOWN = "Frecuencia definida en el PC"

    /** A frequency this app does not know is said as such: calling it «once» would tell the person a falsehood. */
    fun everyLabel(every: String) = when (every) {
        "daily" -> EVERY_DAILY
        "weekly" -> EVERY_WEEKLY
        "monthly" -> EVERY_MONTHLY
        "every_hours" -> EVERY_HOURS
        "hourly" -> EVERY_HOURLY
        "once" -> EVERY_ONCE
        else -> EVERY_UNKNOWN
    }

    private val ZERO_HOUR = Regex("""(?<!\d)0(\d:\d{2})""")

    /**
     * What a schedule says about when it runs: the PC's own sentence (capitalised, «9:00» for «09:00»), or one built from
     * the fields when the PC sent none, or the plain admission that the frequency is the PC's own.
     */
    fun whenLine(s: ScheduleItem): String {
        if (s.every !in KNOWN_EVERY) return EVERY_UNKNOWN
        val text = s.whenText.takeIf { it.isNotBlank() && it != s.every } ?: built(s)
        return text.replace(ZERO_HOUR, "$1").replaceFirstChar { it.uppercase() }
    }

    private val KNOWN_EVERY = setOf("daily", "weekly", "monthly", "every_hours", "hourly", "once")
    private val DAY_NAMES = listOf("domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado")

    private fun built(s: ScheduleItem): String = when (s.every) {
        "daily" -> "cada día a las ${s.atTime}"
        "weekly" -> "cada ${(s.weekdays.ifEmpty { listOf(1) }).joinToString(", ") { DAY_NAMES.getOrElse(it) { "?" } }} a las ${s.atTime}"
        "monthly" -> "el día ${s.monthDay ?: 1} de cada mes a las ${s.atTime}"
        "every_hours" -> "cada ${s.atTime} h"
        "hourly" -> "cada hora"
        else -> "una vez, el ${s.atTime.substringBefore('T')} a las ${s.atTime.substringAfter('T', "")}"
    }

    /** The letters on the day chips (Monday first) and the day names a screen reader says. */
    val WEEK = listOf("L" to 1, "M" to 2, "X" to 3, "J" to 4, "V" to 5, "S" to 6, "D" to 0)
    fun dayName(day: Int) = DAY_NAMES.getOrElse(day) { "" }

    const val AWAITING = "Pendiente de aprobación"
    const val READONLY_BADGE = "Solo lectura"
    const val PAUSED = "En pausa"
    const val APPROVE = "Aprobar"
    const val REVIEW_APPROVE = "Revisar y aprobar…"
    const val APPROVED = "Aprobada. Se ejecutará automáticamente."
    const val TURNED_ON = "Tarea programada activada"
    const val TURNED_OFF = "Tarea programada desactivada"
    const val EDIT = "Editar"
    const val MORE = "Más acciones"
    const val ROW_ACTIONS = "Abrir acciones"
    const val SWITCH = "Activar"
    const val ENABLE = "Activar"
    const val DISABLE = "Desactivar"
    const val RUN_NOW = "Ejecutar ahora"
    const val RUN_DONE = "Tarea creada"
    const val FIRST_APPROVE = "Primero hay que aprobarla"

    const val RUN_TITLE = "¿Ejecutar ahora?"
    fun runBody(title: String) = "«$title» creará una tarea ahora mismo, además de su programación."
    const val DISABLE_TITLE = "¿Desactivar esta tarea programada?"
    fun disableBody(title: String) = "«$title» dejará de ejecutarse hasta que la actives de nuevo."
    const val DISABLE_CONFIRM = "Desactivar"

    const val APPROVE_TITLE = "Aprobar tarea programada"
    const val APPROVE_WARN = "Una vez aprobada, se ejecuta sola a su hora, con lo que ves aquí."
    const val APPROVE_READING = "Leyendo la tarea del PC…"
    const val APPROVE_FAILED = "No se pudo leer del PC. No se aprueba nada sin verlo entero."
    const val APPROVE_CHANGED = "Ha cambiado en el PC desde que abriste la lista. Esto es lo que se aprobaría ahora."
    const val APPROVE_GONE = "Esa tarea programada ya no existe en el PC."
    const val APPROVE_ALREADY = "Esa tarea programada ya estaba aprobada."
    const val LABEL_NAME = "Nombre"
    const val LABEL_WHAT = "Instrucciones"
    const val LABEL_WHEN = "Frecuencia"
    const val LABEL_CLOCK = "Hora y zona"
    const val LABEL_PROJECT = "Proyecto"
    const val LABEL_BRAIN = "Agente y modelo"
    const val LABEL_READONLY = "Solo lectura"
    const val LABEL_PERMISSIONS = "Permisos"
    const val LABEL_CHAT = "Chat"
    const val LABEL_NOTIFY = "Aviso al móvil"
    const val YES = "Sí"
    const val NO = "No"
    const val PERMISSIONS_PC = "Los de Ajustes del PC"
    const val PERMISSIONS_ASK = "Pregunta antes de cada acción"
    const val CHAT_SAME = "Siempre el mismo"
    const val CHAT_EACH = "Uno por ejecución"
    const val MODEL_DEFAULT = "modelo predeterminado"

    fun agentName(id: String) = if (id == "any") ANY_AGENT else id.replaceFirstChar { it.uppercase() }
}

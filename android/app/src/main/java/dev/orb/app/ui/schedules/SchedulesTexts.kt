package dev.orb.app.ui.schedules

/** Every text of the scheduled-tasks screen, in Spanish and with the words the desktop app uses. */
object SchedulesTexts {
    const val TITLE = "Programadas"
    const val BACK = "Volver"
    const val META = "Tareas que se ejecutan periódicamente: revisiones, pruebas, informes…"
    const val EMPTY = "No hay tareas programadas"
    const val EMPTY_HINT = "Por ejemplo: «Cada lunes a las 9:00, revisa si hay dependencias vulnerables». También puedes pedírselo al asistente."
    const val LOAD_ERROR = "No se pudieron cargar las tareas programadas desde el PC."
    const val RETRY = "Reintentar"
    const val ACTION_OFFLINE = "Sin conexión con el PC: no se ha cambiado nada."
    const val ACTION_FAILED = "No se pudo hacer en el PC"
    const val CANCEL = "Cancelar"

    const val NEW = "Nueva"
    const val NEW_TITLE = "Nueva tarea programada"
    const val NEW_DESC = "Cada ejecución crea una tarea. Si la anterior sigue abierta, espera a que termine."
    const val NEW_OK = "Programar"
    const val CREATED = "Tarea programada"
    const val NO_PROJECT = "Crea un proyecto antes de programar tareas."
    const val FIELD_PROJECT = "Proyecto"
    const val FIELD_TITLE = "Título"
    const val FIELD_TITLE_PH = "Revisar dependencias"
    const val FIELD_WHAT = "Instrucciones"
    const val FIELD_WHAT_HINT = "Indica qué hacer, dónde y cuándo se considera terminada."
    const val FIELD_FREQUENCY = "Frecuencia"
    const val FIELD_HOURS = "Cada cuántas horas"
    const val FIELD_TIME = "Hora"
    const val FIELD_DATE = "Fecha"
    const val FIELD_AGENT = "Agente"
    const val FIELD_MODEL = "Modelo"
    const val ANY_AGENT = "Cualquiera"
    const val DEFAULT_MODEL = "Predeterminado"
    const val PC_TIME_NOTE = "Hora del PC"
    const val PICK_TIME = "Elige la hora"
    const val PICK_OK = "Aceptar"
    const val PICK_PLACEHOLDER = "Elegir"
    const val FIELD_DAYS = "Días"
    const val FIELD_READONLY = "Solo lectura (revisar o investigar sin modificar archivos)"
    const val FIELD_SAME_CHAT = "Ejecutar siempre en el mismo chat"

    const val EDIT_TITLE = "Editar tarea programada"
    const val EDIT_OK = "Guardar"
    const val SAVED = "Cambios guardados"

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
    val DAYS = listOf("D", "L", "M", "X", "J", "V", "S")

    const val AWAITING = "Pendiente de aprobación"
    const val READONLY_BADGE = "Solo lectura"
    const val PAUSED = "en pausa"
    const val SPENT = "ya ejecutada"
    const val APPROVE = "Aprobar"
    const val APPROVED = "Aprobada. Se ejecutará automáticamente."
    const val ENABLED = "Activada"
    const val TURNED_ON = "Tarea programada activada"
    const val TURNED_OFF = "Tarea programada desactivada"
    const val EDIT = "Editar"
    const val MORE = "Más acciones"
    const val RUN_NOW = "Ejecutar ahora"
    const val RUN_DONE = "Tarea creada"

    const val RUN_TITLE = "¿Ejecutar ahora?"
    fun runBody(title: String) = "«$title» creará una tarea ahora mismo, además de su programación."
    const val DISABLE_TITLE = "¿Desactivar esta tarea programada?"
    fun disableBody(title: String) = "«$title» dejará de ejecutarse hasta que la actives de nuevo."
    const val DISABLE_CONFIRM = "Desactivar"

    fun nextLine(whenText: String, project: String, next: String?) =
        listOfNotNull(whenText, project, next?.let { "próxima: ${it.take(16).replace('T', ' ')}" }).joinToString(" · ")
}

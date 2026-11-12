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
    const val OFFLINE_STRIP = "Sin conexión con el PC. Se muestra lo último recibido."
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
    fun everyLabel(every: String) = when (every) {
        "daily" -> EVERY_DAILY
        "weekly" -> EVERY_WEEKLY
        "every_hours" -> EVERY_HOURS
        "hourly" -> EVERY_HOURLY
        else -> EVERY_ONCE
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

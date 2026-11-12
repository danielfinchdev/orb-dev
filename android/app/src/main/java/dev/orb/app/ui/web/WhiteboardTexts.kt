package dev.orb.app.ui.web

/** Every text of the Pizarra screen. */
object WhiteboardTexts {
    const val TITLE = "Pizarra"
    const val BACK = "Volver"
    const val NEEDS_PC = "La Pizarra necesita el PC conectado"
    const val NEEDS_PC_BODY = "El dibujo vive en el PC: así no se pierde ni se pisa. Conéctalo y reintenta."
    const val UNSUPPORTED = "Este PC no tiene la Pizarra para el móvil"
    const val UNSUPPORTED_BODY = "Actualiza Orb en el PC para usarla desde aquí."
    const val LOAD_FAILED = "No se pudo abrir la Pizarra"
    const val RETRY = "Reintentar"
    const val CHOOSE = "Elige un proyecto"
    const val CHOOSE_BODY = "Cada proyecto tiene su Pizarra."
    const val NO_PROJECTS = "No hay proyectos"
    const val NO_PROJECTS_BODY = "Crea un proyecto en Orb para tener su Pizarra."
    const val CHANGE_PROJECT = "Cambiar de proyecto"
    const val SAVED = "Guardado"
    const val SAVING = "Guardando…"
    const val UNSAVED = "Sin conexión (no se ha guardado)"
    const val DAMAGED = "El dibujo guardado estaba dañado. El PC lo ha apartado y la Pizarra empieza vacía."
    const val SWITCH_BLOCKED = "Aún no se ha guardado el dibujo. Espera a tener conexión con el PC."
    const val LEAVE_TITLE = "El dibujo no se ha guardado"
    const val LEAVE_BODY = "Sin conexión con el PC, los últimos cambios solo están en esta pantalla. Si sales ahora se perderán."
    const val STAY = "Seguir aquí"
    const val LEAVE = "Salir sin guardar"
    const val CLOSE = "Cerrar"
    const val GONE_TITLE = "La página se ha detenido"
    const val RELOAD = "Recargar"
    const val REJECTED = "No se pudo guardar el último cambio. Los siguientes sí se intentarán guardar."

    fun dropped(n: Int) = if (n == 1) "Se ha quitado 1 elemento que la Pizarra del móvil no admite." else "Se han quitado $n elementos que la Pizarra del móvil no admite."
}

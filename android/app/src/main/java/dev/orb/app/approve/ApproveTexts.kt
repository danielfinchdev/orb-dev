package dev.orb.app.approve

/** The words of the approvals (the app is in Spanish; the PC's own window speaks es and en). */
object ApproveTexts {
    const val PROMPT_TITLE = "Aprobar en Orb"
    const val CANCEL = "Cancelar"
    const val APPROVE = "Aprobar"
    const val REJECT = "Rechazar"
    const val CLOSE = "Cerrar"

    const val ENROLL_TITLE = "Permitir aprobaciones"
    const val APPROVE_BODY = "Tu PC pide que lo apruebes con tu huella o tu cara. Si no lo has pedido tú, rechaza."
    const val REBUILD_TITLE = "Poner contraseña y código nuevos"
    const val REBUILD_BODY = "Tu PC quiere crear una contraseña maestra y un código nuevos porque no tienes los anteriores. Si no lo has pedido tú, rechaza."
    const val ENROLLED_TITLE = "Listo"
    const val ENROLLED_BODY = "Este móvil ya puede aprobar acciones delicadas del PC con tu huella o tu cara."
    const val DONE_TITLE = "Aprobado"
    const val DONE_BODY = "Ya puedes seguir en el PC."
    const val REREGISTER_TITLE = "Vuelve a permitir las aprobaciones desde el PC"
    const val REREGISTER_BODY = "Este móvil no puede aprobar ahora (se añadió una huella o se perdió la clave). En el PC: Ajustes › Dispositivos › Permitir que apruebe."

    const val NO_STRONG = "Hace falta una huella o una cara de seguridad alta (clase 3) en este móvil."
    const val NOT_RECOGNIZED = "No se reconoció. Prueba otra vez."
    const val BLOCKED = "Demasiados intentos. Espera un momento."
    const val FAILED = "No se pudo comprobar. Inténtalo otra vez."
    const val REFUSED = "El PC no ha aceptado la respuesta. Empieza de nuevo desde el PC."

    fun enrollBody(name: String) = "Tu PC pide que «$name» pueda aprobar acciones delicadas con tu huella o tu cara. Si no lo has pedido tú, rechaza."
    fun promptSubtitle(r: ApproveRequest) = when (r.kind) {
        ApproveKind.Enroll -> "Confirma con tu huella o tu cara para permitirlo"
        ApproveKind.Rebuild -> "Confirma con tu huella o tu cara"
        ApproveKind.Approve -> actionTitle(r.payload.action)
    }

    /** The action as the person reads it; anything not listed shows its own name, which is what was signed. */
    fun actionTitle(action: String) = when (action) {
        "secrets.connector" -> "Ver las claves de un conector"
        "secrets.saveConnector" -> "Guardar las claves de un conector"
        "agentKeys.save" -> "Guardar la clave de un agente"
        "mcpExt.createToken" -> "Crear un acceso para otro agente"
        "mcpExt.setProjects" -> "Ampliar los proyectos de un acceso externo"
        "sessions.grantTotal" -> "Dar acceso total al PC a un chat"
        "backup.restore" -> "Restaurar una copia de seguridad"
        "secrets.answer" -> "Guardar o usar una clave que pidió un agente"
        "config.save" -> "Cambiar un conector que tiene claves"
        else -> action
    }
}

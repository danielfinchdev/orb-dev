package dev.orb.app.approve

import java.util.Locale

/** The words of the approvals; they follow the phone's language (Spanish by default), like the PC's window. */
object ApproveTexts {
    private fun tr(es: String, en: String) = if (Locale.getDefault().language == "en") en else es

    val PROMPT_TITLE get() = tr("Aprobar en Orb", "Approve in Orb")
    val CANCEL get() = tr("Cancelar", "Cancel")
    val APPROVE get() = tr("Aprobar", "Approve")
    val REJECT get() = tr("Rechazar", "Reject")
    val CLOSE get() = tr("Cerrar", "Close")

    val ENROLL_TITLE get() = tr("Permitir aprobaciones", "Allow approvals")
    val APPROVE_BODY get() = tr("Tu PC pide que lo apruebes con tu huella o tu cara. Si no lo has pedido tú, rechaza.", "Your PC asks you to approve this with your fingerprint or face. If you did not ask for it, reject.")
    val REBUILD_TITLE get() = tr("Poner contraseña y código nuevos", "Set a new password and code")
    val REBUILD_BODY get() = tr("Tu PC quiere crear una contraseña maestra y un código nuevos porque no tienes los anteriores. Si no lo has pedido tú, rechaza.", "Your PC wants to create a new master password and code because you no longer have the old ones. If you did not ask for it, reject.")
    val ENROLLED_TITLE get() = tr("Listo", "Done")
    val ENROLLED_BODY get() = tr("Este móvil ya puede aprobar acciones delicadas del PC con tu huella o tu cara.", "This phone can now approve sensitive PC actions with your fingerprint or face.")
    val DONE_TITLE get() = tr("Aprobado", "Approved")
    val DONE_BODY get() = tr("Ya puedes seguir en el PC.", "You can go on at the PC.")
    val REREGISTER_TITLE get() = tr("Vuelve a permitir las aprobaciones desde el PC", "Allow approvals again from your PC")
    val REREGISTER_BODY get() = tr("Este móvil ya no puede aprobar: cambió su huella o su cara. En el PC, ve a Ajustes › Dispositivos y elige «Permitir que apruebe».", "This phone can no longer approve: its fingerprint or face changed. On the PC, go to Settings › Devices and choose \"Let it approve\".")

    val NO_STRONG get() = tr("Este móvil no tiene una huella o una cara de seguridad alta, así que no puede aprobar.", "This phone has no strong fingerprint or face unlock, so it cannot approve.")
    val NOT_RECOGNIZED get() = tr("No se reconoció. Prueba otra vez.", "Not recognized. Try again.")
    val BLOCKED get() = tr("Demasiados intentos. Espera un momento.", "Too many tries. Wait a moment.")
    val FAILED get() = tr("No se pudo comprobar. Inténtalo otra vez.", "It could not be checked. Try again.")
    val REFUSED get() = tr("El PC no ha aceptado la respuesta. Empieza de nuevo desde el PC.", "The PC did not accept the answer. Start again from the PC.")

    fun enrollBody(name: String) = tr("Tu PC pide que «$name» pueda aprobar acciones delicadas con tu huella o tu cara. Si no lo has pedido tú, rechaza.", "Your PC asks that \"$name\" be able to approve sensitive actions with your fingerprint or face. If you did not ask for it, reject.")
    /** What the fingerprint prompt says: the action, and for an approval the start of its parameters. */
    fun promptTitle(r: ApproveRequest) = when (r.kind) {
        ApproveKind.Enroll -> ENROLL_TITLE
        ApproveKind.Rebuild -> REBUILD_TITLE
        ApproveKind.Approve -> actionTitle(r.payload.action)
    }

    fun promptSubtitle(r: ApproveRequest) = when (r.kind) {
        ApproveKind.Enroll -> tr("Confirma con tu huella o tu cara para permitirlo", "Confirm with your fingerprint or face to allow it")
        ApproveKind.Rebuild -> tr("Confirma con tu huella o tu cara", "Confirm with your fingerprint or face")
        ApproveKind.Approve -> r.summary.let { if (it.length > 90) it.take(90) + "…" else it }
    }

    /** The action as the person reads it; anything not listed shows its own name, which is what was signed. */
    fun actionTitle(action: String) = when (action) {
        "secrets.connector" -> tr("Ver las claves de un conector", "See a connector's keys")
        "secrets.saveConnector" -> tr("Guardar las claves de un conector", "Save a connector's keys")
        "agentKeys.save" -> tr("Guardar la clave de un agente", "Save an agent's key")
        "mcpExt.createToken" -> tr("Crear un acceso para otro agente", "Create access for another agent")
        "mcpExt.setProjects" -> tr("Ampliar los proyectos de un acceso externo", "Widen the projects of an outside access")
        "sessions.grantTotal" -> tr("Dar acceso total al PC a un chat", "Give a chat full access to the PC")
        "backup.restore" -> tr("Restaurar una copia de seguridad", "Restore a backup")
        "secrets.answer" -> tr("Guardar o usar una clave que pidió un agente", "Save or use a key an agent asked for")
        "config.save" -> tr("Cambiar un conector que tiene claves", "Change a connector that has keys")
        else -> action
    }
}

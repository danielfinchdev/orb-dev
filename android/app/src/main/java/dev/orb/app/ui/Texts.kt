package dev.orb.app.ui

import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.PairError
import dev.orb.app.link.net.UpdateSide
import dev.orb.app.link.payload.LinkErrors

/** Plain Spanish for what linking can fail with. The PC's own words are shown only when nothing better is known. */
/** [via] tells a mistyped short code (the PC cannot tell it from a spent one) from a QR or link that really expired. */
fun pairErrorText(e: PairError, via: dev.orb.app.link.payload.LinkVia? = null): String = when (e) {
    is PairError.Offline ->
        if (e.overLan) "No se pudo llegar al PC. Comprueba que está encendido, que Orb está abierto y que el cortafuegos permite la conexión."
        else "No se pudo llegar al PC. Comprueba que está encendido y que Orb está abierto."
    PairError.BadAnswer -> "La respuesta no es la del PC de este código. No se ha enlazado."
    is PairError.Refused -> when {
        e.update != null || e.status == 426 -> "Hay que actualizar la app para enlazar con este PC."
        e.reason == "password" -> e.left?.let { "No es la contraseña. Te quedan $it ${if (it == 1) "intento" else "intentos"} con este código." } ?: "No es la contraseña."
        e.reason == "newCode" -> "Demasiados intentos: el código ya no vale. Genera uno nuevo en el PC."
        e.reason == "declined" -> "El PC no ha confirmado el enlace. Genera un código nuevo en el PC si quieres volver a intentarlo."
        e.reason == "timeout" -> "El PC no ha confirmado el enlace a tiempo. Genera un código nuevo en el PC y vuelve a probar."
        e.reason == "wait" -> "Espera un momento antes de volver a probar."
        e.reason == "noMaster" || e.reason == "noVerifier" -> "El PC no tiene contraseña maestra para enlazar. Créala en Orb y vuelve a probar."
        e.reason == "tries" -> "Demasiados intentos. Espera un rato o desbloquea el PC."
        e.reason == null && e.status == 401 && (via == dev.orb.app.link.payload.LinkVia.CODE || via == dev.orb.app.link.payload.LinkVia.LINKCODE) -> "El código no coincide o ya no vale. Compruébalo o genera uno nuevo en el PC."
        e.reason == null && e.status == 401 -> "Este código ya no vale: ha caducado, se ha usado o se ha anulado. Genera uno nuevo en el PC."
        e.reason == null && e.status == 429 -> "Demasiados intentos desde este móvil. Espera unos minutos."
        e.reason == null && (e.status == 404 || e.status == 410) -> "Esa dirección no responde como un Orb. Revisa la dirección del PC."
        else -> dev.orb.app.link.net.pcMessage(e.error, "El PC rechazó el enlace.")
    }
    PairError.KdfTooHeavy -> "El PC pide más memoria de la que tiene este móvil para comprobar la contraseña."
    PairError.NoShortCode -> "Ese Orb no tiene un código en pantalla. Muestra el código de enlace en el PC."
    PairError.OldOrb, PairError.OldQr -> "Este Orb o este código son demasiado antiguos. Actualiza Orb en el PC y genera un código nuevo."
}

fun payloadErrorText(key: String): String = when (key) {
    LinkErrors.NO_ADDRESS -> "Falta la dirección del PC."
    LinkErrors.BAD_ADDRESS -> "La dirección no es válida."
    LinkErrors.BAD_QR -> "El enlace no es válido."
    LinkErrors.OLD_QR -> "El código es demasiado antiguo. Genera uno nuevo en el PC."
    LinkErrors.INSECURE -> "Esa dirección no es privada: usa el Wi-Fi de casa o Tailscale."
    LinkErrors.NO_CODE -> "Escribe el código de enlace (6 caracteres o más) o pega el enlace."
    else -> "Revisa los datos del enlace."
}

fun linkErrorText(e: Throwable): String = when (val err = (e as? dev.orb.app.link.net.LinkException)?.error) {
    LinkError.Offline -> "Sin conexión con el PC."
    LinkError.Timeout -> "El PC no ha contestado a tiempo."
    LinkError.NotLinked -> "El PC ya no reconoce este móvil. Vuelve a enlazar."
    is LinkError.Refused -> "El PC lo rechazó (${err.status})."
    is LinkError.Attention -> "El PC necesita atención (${err.code})."
    is LinkError.Update -> if (err.side == UpdateSide.App) "Hay que actualizar la app." else "Hay que actualizar Orb en el PC."
    LinkError.BadAnswer -> "La respuesta del PC no es de fiar."
    is LinkError.Unsupported -> "Este PC no tiene ${err.method}."
    null -> "Error inesperado (${e.javaClass.simpleName})."
}

fun connectionText(s: ConnectionState): String = when (s) {
    ConnectionState.Connecting -> "Conectando…"
    is ConnectionState.Online -> "Conectado" + (s.pcName?.let { " a $it" } ?: "")
    is ConnectionState.Offline -> "Sin conexión"
    ConnectionState.UpdateApp -> "Hay que actualizar la app"
    ConnectionState.UpdatePc -> "Hay que actualizar Orb en el PC"
    ConnectionState.Unlinked -> "Desvinculado: el PC no reconoce este móvil"
    is ConnectionState.Attention -> "El PC necesita atención (${s.code})"
}

/** Texts of the appearance sheet. */
object AppearanceTexts {
    const val TITLE = "Apariencia"
    const val BUTTON = "Apariencia"
    const val MODE_GROUP = "Modo"
    const val PALETTE_GROUP = "Paleta"
    const val SYSTEM = "Según el sistema"
    const val LIGHT = "Claro"
    const val DARK = "Oscuro"
    fun paletteDescription(name: String) = "Paleta $name"
}

package dev.orb.app.ui

import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.PairError
import dev.orb.app.link.net.UpdateSide
import dev.orb.app.link.payload.LinkErrors

/** Plain Spanish for what linking can fail with. The PC's own words are shown only when nothing better is known. */
fun pairErrorText(e: PairError): String = when (e) {
    is PairError.Offline ->
        if (e.overLan) "No se pudo llegar al PC. Comprueba que está encendido, que Orb está abierto y que el cortafuegos permite la conexión."
        else "No se pudo llegar al PC. Comprueba que está encendido y que Orb está abierto."
    PairError.BadAnswer -> "La respuesta no es la del PC de este código. No se ha enlazado."
    is PairError.Refused -> when {
        e.update != null || e.status == 426 -> "Hay que actualizar la app para enlazar con este PC."
        e.reason == "password" -> e.left?.let { "Contraseña incorrecta. Te quedan $it ${if (it == 1) "intento" else "intentos"}." } ?: "Contraseña incorrecta."
        e.reason == "newCode" -> "Demasiados intentos: el código ya no vale. Genera uno nuevo en el PC."
        e.reason == "wait" -> "Espera un momento antes de volver a probar."
        e.reason == "noMaster" || e.reason == "noVerifier" -> "El PC no tiene contraseña maestra para enlazar. Créala en Orb y vuelve a probar."
        e.reason == "tries" -> "Demasiados intentos. Espera un rato o desbloquea el PC."
        e.reason == "expired" || e.status == 410 || e.status == 404 -> "El código ha caducado. Genera uno nuevo en el PC."
        else -> e.error
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
    LinkErrors.INSECURE -> "Solo se permite http con direcciones de tu red local o de Tailscale."
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
    const val FOLLOW_PC = "Igual que el PC"
    const val ORBITA = "Órbita"
    const val CRISTAL = "Órbita – Cristal"
    const val GRAFITO = "Grafito"
    const val DYNAMIC = "Colores del fondo"
    const val DYNAMIC_HINT = "Usa los colores de tu fondo de pantalla"
    const val DYNAMIC_UNAVAILABLE = "Necesita Android 12 o más reciente"
    const val LIGHT = "Claro"
    const val DARK = "Oscuro"
    const val SYSTEM = "Sistema"
    const val THEME_GROUP = "Tema"
    const val MODE_GROUP = "Modo"
}

package dev.orb.app.ui.update

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.PcVersions
import dev.orb.app.link.payload.PAIR_PROTOCOL
import dev.orb.app.link.payload.PROTOCOL
import dev.orb.app.link.payload.versionOfProtocol

/**
 * Where the app is updated: the project's Releases page. Fixed in the code on purpose, never an address the PC could send,
 * and the app neither downloads nor installs anything itself: the browser does.
 */
object UpdateLinks {
    const val RELEASES = "https://github.com/danielfinchdev/orb-dev/releases/latest"
}

/** What the update page says, from the link's state and what the PC reported in its last answer. */
sealed interface UpdateView {
    val appVersion: String

    /** The PC speaks a newer link than this app: [pcMin] is the link it asks for, [pcVersion] its Orb version, when known. */
    data class App(override val appVersion: String, val pcMin: Int?, val pcVersion: String?) : UpdateView

    /** The PC is too old for this app; [pcLink] and [pcVersion] are what it said, when it said. */
    data class Pc(override val appVersion: String, val pcLink: Int?, val pcVersion: String?) : UpdateView

    /** Nothing to update: the link works. */
    data class UpToDate(override val appVersion: String, val pcLink: Int?, val pcVersion: String?) : UpdateView

    /** Nothing is known about the PC now, so nothing can be said about versions. */
    data class Unknown(override val appVersion: String) : UpdateView
}

fun updateView(connection: ConnectionState, versions: PcVersions?, appVersion: String): UpdateView = when (connection) {
    ConnectionState.UpdateApp -> UpdateView.App(appVersion, versions?.min?.takeIf { it > PROTOCOL }, versions?.version)
    ConnectionState.UpdatePc -> UpdateView.Pc(appVersion, versions?.v, versions?.version)
    is ConnectionState.Online -> UpdateView.UpToDate(appVersion, connection.versions.v, connection.versions.version)
    else -> UpdateView.Unknown(appVersion)
}

object UpdateTexts {
    const val TITLE_APP = "Actualiza la app"
    const val TITLE_PC = "Actualiza Orb en el PC"
    const val TITLE_OK = "Todo está al día"
    const val TITLE_UNKNOWN = "No puedo comprobarlo ahora"
    const val ON_PHONE = "En el móvil"
    const val PC_ASKS = "Tu Orb pide"
    const val PC_IS = "Tu Orb"
    const val DOWNLOAD = "Ir a la descarga"
    const val DOWNLOADS = "Ver las descargas"
    const val DOWNLOAD_NOTE = "Se abre la página de descarga en el navegador. Instala la nueva versión encima y sigue enlazado."
    const val RETRY = "Reintentar"
    const val PC_NOTE = "Actualiza Orb en el PC y vuelve a abrir la app."
    const val BODY_OK = "Esta app y tu Orb hablan el mismo enlace."
    const val BODY_UNKNOWN = "Sin conexión con tu PC no sé qué enlace habla. Cuando responda lo verás aquí."
    const val NO_BROWSER = "No hay navegador en este móvil. Abre esta dirección desde otro: github.com/danielfinchdev/orb-dev/releases/latest"
    const val BACK = "Volver"
    const val UNKNOWN_VALUE = "sin respuesta del PC"

    fun phone(appVersion: String) = "$appVersion · enlace $PROTOCOL"

    fun bodyApp(v: UpdateView.App) =
        (v.pcVersion?.let { "Tu Orb ($it) habla" } ?: "Tu Orb habla") + " una versión más nueva del enlace. Esta app es la ${v.appVersion}."

    fun asks(v: UpdateView.App) = v.pcMin?.let { "enlace $it o más" } ?: "un enlace más nuevo"

    /** Under the PC's age: «anterior a la 3.8» is what the link number means, since 3.8 is the first Orb that speaks it. */
    fun bodyPc() = "Tu Orb es anterior a la ${versionOfProtocol(PAIR_PROTOCOL)} y esta app no puede hablar con él."

    fun pcOld(v: UpdateView.Pc) =
        if (v.pcLink != null && v.pcVersion != null) "${v.pcVersion} · enlace ${v.pcLink}" else "anterior a la ${versionOfProtocol(PAIR_PROTOCOL)}"

    fun pcNow(pcLink: Int?, pcVersion: String?) = when {
        pcVersion != null && pcLink != null -> "$pcVersion · enlace $pcLink"
        pcLink != null -> "enlace $pcLink"
        pcVersion != null -> pcVersion
        else -> UNKNOWN_VALUE
    }
}

/**
 * Opens the download page in whatever browser the phone has: a plain view of the fixed address, no download, no install and
 * no permission. [start] launches the intent; false means there is nothing on the phone that can show a page.
 */
fun openDownloadPage(start: (Intent) -> Unit): Boolean = try {
    start(Intent(Intent.ACTION_VIEW, Uri.parse(UpdateLinks.RELEASES)))
    true
} catch (_: ActivityNotFoundException) {
    false
}

package dev.orb.app.ui.welcome

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.net.PairError
import dev.orb.app.link.net.PairOk
import dev.orb.app.link.net.pcNameOrNull
import dev.orb.app.link.net.PairingException
import dev.orb.app.link.net.ResolvedLink
import dev.orb.app.link.payload.LinkErrors
import dev.orb.app.link.payload.LinkPayloadException
import dev.orb.app.link.payload.LinkVia
import dev.orb.app.link.payload.parseManual
import dev.orb.app.ui.Linker
import dev.orb.app.ui.pairErrorText
import dev.orb.app.ui.payloadErrorText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class WelcomeStage {
    /** Welcome: the scan button and, in a sheet, the short code. */
    Entry,

    /** The PC answered: its name and fingerprint are shown and the master password is asked. */
    Fingerprint,

    /** The password was accepted; the key is being saved. */
    Linking,

    /** Linked; the person leaves with the «Ir a Chats» button. */
    Done,
}

/** A failure of the first steps that the entry page shows as a banner with its own button. */
enum class WelcomeErrorKind {
    /** The code expired, ran out of tries or was never going to work again: a new one is needed. */
    CodeSpent,

    /** The address is not on the home network or Tailscale. */
    NotPrivate,
}

/** What the PC answered, for the person to compare with the PC's own screen. */
data class PcIdentity(val name: String, val groups: List<String>, val viaCode: Boolean)

data class WelcomeUiState(
    val stage: WelcomeStage = WelcomeStage.Entry,
    val sheet: Boolean = false,
    // The sheet asks only for the link (the scanner's «Pegar el enlace del QR»); false adds the short code and the address.
    val linkOnly: Boolean = false,
    val link: String = "",
    val code: String = "",
    val address: String = "",
    val pc: PcIdentity? = null,
    // Lives only in memory, is cleared as soon as it is sent and is never logged.
    val password: String = "",
    // How many characters were typed, so the field can still be drawn as dots while the password is being checked.
    val passwordLength: Int = 0,
    val showPassword: Boolean = false,
    // Resolving the PC (step a).
    val busy: Boolean = false,
    // Checking the password with the PC (step b).
    val checking: Boolean = false,
    // The error that belongs under the password field, and the one that belongs to the stage as a whole.
    val passwordError: String? = null,
    val error: String? = null,
    // What kind of failure [error] is when it needs more than a line of text: a banner with its own way out.
    val errorKind: WelcomeErrorKind? = null,
    val noticeDialog: Boolean = false,
    // The person said «Ahora no» to notices: the bottom message points to «Este móvil».
    val noticesLater: Boolean = false,
    val noticesOn: Boolean = false,
) {
    /** How many of the three steps of «Enlazando» really happened: the PC's code, the password, the key saved. */
    val stepsDone: Int get() = when (stage) {
        WelcomeStage.Entry, WelcomeStage.Fingerprint -> 0
        WelcomeStage.Linking -> 2
        WelcomeStage.Done -> 3
    }
}

/** Android's notification permission as the first-run flow needs it. */
interface NoticeGate {
    /** True while Android would still need the person's OK: version 13 or later and notices not allowed. */
    fun shouldAsk(): Boolean
    val enabled: Boolean

    /** Android's own permission request. */
    fun request()
}

/** The fingerprint as the groups the person compares with the PC's screen (the same ones the PC shows). */
fun fingerprintGroups(fp: String): List<String> = fp.split('-', ' ').filter { it.isNotBlank() }

class WelcomeViewModel(
    private val linker: Linker,
    private val deviceName: String,
    // Saves the new link and starts using it; runs on [dispatcher].
    private val onLinked: (PairOk) -> Unit,
    private val dispatcher: CoroutineDispatcher = Dispatchers.Default,
    private val notices: NoticeGate? = null,
) : ViewModel() {
    private val _state = MutableStateFlow(WelcomeUiState())
    val state: StateFlow<WelcomeUiState> = _state.asStateFlow()

    // What step (a) resolved; the password step links against it. It never leaves the view model.
    private var resolved: ResolvedLink? = null

    fun openSheet() = _state.update { it.copy(sheet = true, linkOnly = false, error = null) }
    fun openLinkSheet() = _state.update { it.copy(sheet = true, linkOnly = true, error = null) }
    fun closeSheet() = _state.update { if (it.busy) it else it.copy(sheet = false, linkOnly = false, error = null, errorKind = null) }

    /** The banner's button: the failure is acknowledged and the entry page is as it was. */
    fun dismissError() = _state.update { it.copy(error = null, errorKind = null) }

    /** A valid Orb link read from the QR: it takes the same road as a pasted one, so errors show in the sheet with the link in it. */
    fun scanned(text: String) {
        if (_state.value.busy) return
        _state.update { it.copy(link = text, code = "", address = "", sheet = true, error = null, errorKind = null) }
        resolve()
    }

    fun setLink(v: String) = _state.update { it.copy(link = v, error = null) }
    fun setCode(v: String) = _state.update { it.copy(code = v, error = null) }
    fun setAddress(v: String) = _state.update { it.copy(address = v, error = null) }

    /** The «Pegar» button: whatever the clipboard holds replaces the link field. */
    fun paste(text: String?) {
        val t = text?.trim().orEmpty()
        if (t.isNotEmpty()) setLink(t)
    }

    fun setPassword(v: String) = _state.update { it.copy(password = v, passwordLength = v.length, passwordError = null, error = null) }
    fun toggleShowPassword() = _state.update { it.copy(showPassword = !it.showPassword) }

    /** Step (a): asks the PC who it is. Nothing is linked yet; the person first sees the name and the fingerprint. */
    fun resolve() {
        val s = _state.value
        if (s.busy || s.stage != WelcomeStage.Entry) return
        val payload = try {
            parseManual(text = s.link.ifBlank { null }, code = s.code, address = s.address)
        } catch (e: LinkPayloadException) {
            return fail(payloadErrorText(e.key), if (e.key == LinkErrors.INSECURE) WelcomeErrorKind.NotPrivate else null)
        } catch (e: Exception) {
            return fail(payloadErrorText(""))
        }
        _state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch(dispatcher) {
            try {
                val r = linker.resolve(payload).getOrElse { return@launch rejected(it, linking = false) }
                resolved = r
                _state.update {
                    it.copy(
                        busy = false, sheet = false, stage = WelcomeStage.Fingerprint,
                        pc = PcIdentity(pcNameOrNull(r.name) ?: "Tu PC", fingerprintGroups(r.fp), r.via == LinkVia.CODE),
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                fail("Error inesperado (${e.javaClass.simpleName}).")
            }
        }
    }

    /** Step (b): the person saw the fingerprint and typed the master password; this proves it to the PC and saves the link. */
    fun confirm() {
        val s = _state.value
        val r = resolved
        if (s.checking || s.stage != WelcomeStage.Fingerprint || r == null) return
        if (s.password.isEmpty()) return _state.update { it.copy(passwordError = "Escribe la contraseña maestra del PC.") }
        val password = s.password
        _state.update { it.copy(checking = true, error = null, passwordError = null, password = "", showPassword = false) }
        viewModelScope.launch(dispatcher) {
            val ok = try {
                linker.link(r, password, deviceName).getOrElse { return@launch rejected(it, linking = true) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                return@launch _state.update { it.copy(checking = false, stage = WelcomeStage.Fingerprint, error = "Error inesperado (${e.javaClass.simpleName}).") }
            }
            // The PC has accepted: its code is spent, so nothing below may send the person back to the fingerprint.
            try {
                _state.update { it.copy(stage = WelcomeStage.Linking) }
                onLinked(ok)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                return@launch backToEntry("El PC aceptó el enlace, pero no se pudo guardar en este móvil. Genera un código nuevo en el PC y vuelve a probar.")
            }
            resolved = null
            val ask = try { notices?.shouldAsk() == true } catch (e: Exception) { false }
            val on = try { notices?.enabled == true } catch (e: Exception) { false }
            _state.update { it.copy(checking = false, stage = WelcomeStage.Done, passwordLength = 0, noticeDialog = ask, noticesOn = on) }
        }
    }

    /** Back from the fingerprint to the welcome: what the PC answered and the password are forgotten. */
    fun back() {
        if (_state.value.checking || _state.value.stage != WelcomeStage.Fingerprint) return
        resolved = null
        _state.update { it.copy(stage = WelcomeStage.Entry, pc = null, password = "", passwordLength = 0, showPassword = false, error = null, passwordError = null) }
    }

    /** «Activar» in «¿Avisos de Orb?»: only now does Android's own permission request appear. */
    fun activateNotices() {
        _state.update { it.copy(noticeDialog = false) }
        notices?.request()
    }

    /** «Ahora no»: Android is not asked; the bottom message points to «Este móvil». Nothing asks again by itself. */
    fun declineNotices() = _state.update { it.copy(noticeDialog = false, noticesLater = true) }

    /** The permission changed (the activity came back from Android's dialog or settings). */
    fun noticesChanged(on: Boolean) = _state.update { it.copy(noticesOn = on, noticesLater = it.noticesLater && !on) }

    private fun rejected(e: Throwable, linking: Boolean) {
        val refused = (e as? PairingException)?.error as? PairError.Refused
        when {
            // A wrong password with tries left stays on the fingerprint; with none left the code is dead.
            refused?.reason == "password" && refused.left != 0 -> _state.update { it.copy(checking = false, passwordError = errorOf(e)) }
            refused != null && linking && isSpent(refused) -> backToEntry(
                if (refused.reason == "password") pairErrorText(refused.copy(reason = "newCode")) else errorOf(e, resolved?.via), WelcomeErrorKind.CodeSpent,
            )
            else -> fail(errorOf(e))
        }
    }

    // The PC answers 401 without a reason for a code that expired, was used, was replaced or was voided by too many
    // tries, and "newCode" when the last password try failed. "tries" is the master password's general lock (the code
    // is still good), and 404/410 mean the address is not an Orb: none of those spend the code.
    private fun isSpent(r: PairError.Refused) =
        r.reason == "password" && r.left == 0 || r.reason == "newCode" || r.reason == null && r.status == 401

    /** Forgets what the PC answered and shows the first page again with [message]; the spent code is not kept. */
    private fun backToEntry(message: String, kind: WelcomeErrorKind = WelcomeErrorKind.CodeSpent) {
        resolved = null
        _state.update {
            it.copy(
                stage = WelcomeStage.Entry, pc = null, password = "", passwordLength = 0, showPassword = false, passwordError = null,
                busy = false, checking = false, sheet = false, link = "", code = "", error = message, errorKind = kind,
            )
        }
    }

    private fun errorOf(e: Throwable, via: LinkVia? = null): String = (e as? PairingException)?.let { pairErrorText(it.error, via) } ?: pairErrorText(PairError.BadAnswer)

    /** A [kind] leaves the sheet: the banner on the entry page carries the way out. */
    private fun fail(message: String, kind: WelcomeErrorKind? = null) =
        _state.update { it.copy(busy = false, checking = false, error = message, errorKind = kind, sheet = it.sheet && kind == null) }

    override fun onCleared() {
        resolved = null
    }
}
